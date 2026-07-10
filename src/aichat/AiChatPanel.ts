import { App, Component, Editor, MarkdownView, Notice, TFile, setIcon, setTooltip } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { getWikiImgSrc, getWikiDisplayName, getWikiColor } from '../wiki/wikiProfileUtils';
import { AiChatStorage } from './AiChatStorage';
import { AiChatSuggestModal } from './AiChatSuggestModal';
import { getCharacterCandidateFiles } from './AiChatScope';
import { getEpisodePlotContext, getFullPlotHistoryContext, getPreviousChapterBody, extractChapterName, type PlotHistoryContext } from './AiChatEpisode';
import { generateEpisodeScene, type EpisodeChatSegment } from './EpisodeChatEngine';
import { AiChatRenameModal } from './AiChatRenameModal';
import { callAiChat, type AiChatApiKeys } from './AiChatApi';
import { extractPersonaContent, parseAssistantSegments, loadCustomStyleNote, buildCustomStyleBlock } from './AiChatContext';
import type { AiChatMessage, AiChatSegment, AiChatSession } from './AiChatTypes';

interface AppWithSettings extends App {
	setting?: { open(): void; openTabById(id: string): void };
}

type SubPage = 'summary' | 'chat' | 'episode';
type InputMode = 'dialogue' | 'narration';

interface ThoughtSegment { isThought: boolean; text: string; }

/** "(...)" 괄호로 표현된 인물의 속마음 구간과 일반 텍스트 구간을 분리한다. 괄호 안에 괄호가 중첩되는 경우는 다루지 않는다. */
function splitThoughtSegments(text: string): ThoughtSegment[] {
	const segments: ThoughtSegment[] = [];
	const re = /\(([^()]*)\)/g;
	let idx = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		if (m.index > idx) segments.push({ isThought: false, text: text.slice(idx, m.index) });
		segments.push({ isThought: true, text: m[1] });
		idx = m.index + m[0].length;
	}
	if (idx < text.length) segments.push({ isThought: false, text: text.slice(idx) });
	return segments;
}

const RESPONSE_TIMEOUT_MS = 90_000;

/** 응답이 비정상적으로 오래 걸려 영영 안 끝나는 경우, sending 상태가 그 세션에 영구히 걸려있지 않도록 시간 제한을 둔다. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => {
			window.setTimeout(() => reject(new Error('응답 시간이 너무 오래 걸려 요청을 취소했습니다.')), ms);
		}),
	]);
}

export class AiChatPanel {
	private subPage: SubPage = 'chat';
	private characterFile: TFile | null = null; // A: AI가 연기하는 인물
	private speakerFile: TFile | null = null;   // B: 사용자가 지금 연기하는 상대역
	private session: AiChatSession | null = null;
	private container: HTMLElement | null = null;
	/** 세션별로 "지금 응답 대기 중"인지 추적 — 세션 하나가 오래 걸린다고 다른 세션(새 대화 등)까지 막히면 안 됨 */
	private sendingSessionIds = new Set<string>();
	private storage: AiChatStorage;

	private toolbarTitleEl: HTMLElement | null = null;
	private toolbarHeaderEl: HTMLElement | null = null;
	private toolbarCollapseTimer = 0;
	private activeFile: TFile | null = null;
	private lastEditor: Editor | null = null;

	private inputMode: InputMode = 'dialogue';
	private modeLabelEl: HTMLElement | null = null;
	private inputWrapperEl: HTMLElement | null = null;

	/** 다음 renderMessages() 호출에서 이 인덱스의 assistant 메시지만 타자기 효과로 그리도록 예약 */
	private pendingTypewriterIndex: number | null = null;

	// ── 회차 챗 (에피소드 플롯 기반 씬 자동 생성) ─────────────────────────────
	private episodeSegments: EpisodeChatSegment[] = [];
	private episodeGenerating = false;
	private episodeStatus = '';
	/** 회차챗 생성 진행 상황이 갱신될 때만 스크롤을 최하단으로 내린다. 그 외(예: active-leaf-change로 인한
	 * 재렌더링) 렌더링에서는 사용자가 보던 스크롤 위치를 그대로 둔다. */
	private episodeAutoScroll = false;
	/** rerender()는 container를 통째로 비우고 다시 그리므로, 다시 그리기 직전 기존 스크롤 위치를 여기 저장해뒀다가 복원한다. */
	private episodeScrollTop = 0;
	/** 노트 전환 시 헤더(상태 문구·생성 버튼)만 갱신하기 위한 참조 — 전체 rerender()를 피해 씬 목록이 다시
	 * 그려지며 생기는 스크롤 깜빡임을 없앤다. */
	private episodeStatusEl: HTMLElement | null = null;
	private episodeGenBtnEl: HTMLElement | null = null;
	private currentPlotHistory: PlotHistoryContext | null = null;
	/** 씬별 진행 문구 참조 — 생성 도중 씬이 넘어갈 때마다 전체 rerender() 대신 이 텍스트만 갱신해 헤더가 깜빡이지 않게 한다. */
	private episodeProgressEl: HTMLElement | null = null;

	constructor(private plugin: WritingMenuPlugin, hostComponent: Component) {
		this.storage = new AiChatStorage(plugin.app);

		const lastChar = plugin.settings.aiChatLastCharacterPath;
		if (lastChar) {
			const f = plugin.app.vault.getAbstractFileByPath(lastChar);
			if (f instanceof TFile) this.characterFile = f;
		}
		const lastSpeaker = plugin.settings.aiChatLastSpeakerPath;
		if (lastSpeaker) {
			const f = plugin.app.vault.getAbstractFileByPath(lastSpeaker);
			if (f instanceof TFile) this.speakerFile = f;
		}

		const initialView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		this.activeFile = initialView?.file ?? null;
		this.lastEditor = initialView?.editor ?? null;

		hostComponent.registerEvent(
			plugin.app.workspace.on('active-leaf-change', (leaf) => {
				const view = leaf?.view;
				if (view instanceof MarkdownView) {
					this.activeFile = view.file;
					this.lastEditor = view.editor;
					this.toolbarTitleEl?.setText(this.activeFile ? this.activeFile.basename : 'AI');
					// 회차 챗 페이지는 활성 노트에 따라 상태 문구/버튼 활성화가 바뀌므로 갱신하되, 전체 rerender()는
					// 씬 목록까지 다시 그리며 스크롤이 깜빡이므로 헤더만 가볍게 갱신한다.
					if (this.subPage === 'episode') void this.refreshEpisodeHeader();
				}
			}),
		);
	}

	private get app() { return this.plugin.app; }

	async render(container: HTMLElement): Promise<void> {
		this.container = container;
		container.empty();

		const root = container.createDiv({ cls: 'wm-aichat-root' });
		this.renderToolbar(root);

		const body = root.createDiv({ cls: 'wm-aichat-body' });
		if (this.subPage === 'summary') this.renderSummaryPage(body);
		else if (this.subPage === 'episode') await this.renderEpisodeChatPage(body);
		else await this.renderChatPage(body);
	}

	private rerender(): void {
		if (!this.container) return;
		const existingList = this.container.querySelector<HTMLElement>('.wm-episodechat-list');
		if (existingList) this.episodeScrollTop = existingList.scrollTop;
		void this.render(this.container);
	}

	// ── 상단 툴바 (요약/캐릭터챗/AI설정 이동 전용, 평소엔 접혀있음) ──────────

	private renderToolbar(root: HTMLElement): void {
		const header = root.createDiv({ cls: 'wm-aichat-toolbar-header' });
		this.toolbarHeaderEl = header;
		if (this.plugin.settings.aiChatToolbarAutoHide) {
			header.addClass('is-collapsed');
			header.addEventListener('mouseenter', () => {
				window.clearTimeout(this.toolbarCollapseTimer);
				header.removeClass('is-collapsed');
			});
			header.addEventListener('mouseleave', () => {
				window.clearTimeout(this.toolbarCollapseTimer);
				this.toolbarCollapseTimer = window.setTimeout(() => header.addClass('is-collapsed'), 60);
			});
		}

		const row = header.createDiv({ cls: 'wm-aichat-toolbar-row' });
		const actions = row.createDiv({ cls: 'wm-aichat-toolbar-actions' });

		const summaryBtn = actions.createDiv({
			cls: 'wm-cal-icon-btn' + (this.subPage === 'summary' ? ' is-active' : ''),
			attr: { 'aria-label': '요약' },
		});
		setIcon(summaryBtn, 'notebook-text');
		summaryBtn.addEventListener('click', () => { this.subPage = 'summary'; this.rerender(); });

		const chatBtn = actions.createDiv({
			cls: 'wm-cal-icon-btn' + (this.subPage === 'chat' ? ' is-active' : ''),
			attr: { 'aria-label': '캐릭터 챗봇' },
		});
		setIcon(chatBtn, 'message-square-quote');
		chatBtn.addEventListener('click', () => { this.subPage = 'chat'; this.rerender(); });

		const episodeBtn = actions.createDiv({
			cls: 'wm-cal-icon-btn' + (this.subPage === 'episode' ? ' is-active' : ''),
			attr: { 'aria-label': '초고' },
		});
		setIcon(episodeBtn, 'clapperboard');
		episodeBtn.addEventListener('click', () => { this.subPage = 'episode'; this.rerender(); });

		const settingsBtn = actions.createDiv({ cls: 'wm-cal-icon-btn', attr: { 'aria-label': 'AI 설정' } });
		setIcon(settingsBtn, 'settings');
		settingsBtn.addEventListener('click', () => {
			(this.app as AppWithSettings).setting?.open();
			(this.app as AppWithSettings).setting?.openTabById(this.plugin.manifest.id);
			window.setTimeout(() => { this.plugin.settingTab?.renderPage('ai'); }, 60);
		});
	}

	// ── 요약 (설계만, 미구현) ────────────────────────────────────────────────

	private renderSummaryPage(body: HTMLElement): void {
		body.addClass('wm-aichat-placeholder');
		body.createDiv({ text: '요약 기능은 준비 중입니다.' });
	}

	// ── 회차 챗 (에피소드 플롯을 파싱해 씬을 자동 생성) ────────────────────────

/** 활성 노트를 바탕으로 회차 인식 여부와 플롯 컨텍스트를 계산한다. 전체 rerender()와 가벼운 헤더 갱신에서 공유. */
	private async computeEpisodeStatus(): Promise<{ chapterName: string | null; plotHistory: PlotHistoryContext | null }> {
		const chapterName = extractChapterName(this.activeFile);
		const root = this.plugin.settings.aiEpisodeRootFolder.trim();
		if (!root || !chapterName || !this.activeFile?.path.startsWith(root.endsWith('/') ? root : `${root}/`)) {
			return { chapterName: null, plotHistory: null };
		}
		const plotHistory = await getFullPlotHistoryContext(this.plugin, this.activeFile);
		return { chapterName: plotHistory ? chapterName : null, plotHistory };
	}

	/** 상태 표시 영역(아이콘+문구)을 계산 결과에 맞춰 그린다 — 인식 성공 시 회차명+체크, 실패 시 공통 안내 문구. */
	private renderEpisodeStatusContent(el: HTMLElement, chapterName: string | null): void {
		el.empty();
		if (chapterName) {
			el.createSpan({ text: chapterName });
			const check = el.createSpan({ cls: 'wm-episodechat-status-check' });
			setIcon(check, 'check');
		} else {
			el.createSpan({ text: '노트를 인식할 수 없습니다' });
		}
	}

	/** 노트 전환 등으로 헤더만 최신화할 때 쓴다 — 씬 목록(listEl)은 건드리지 않아 스크롤이 안 튄다. */
	private async refreshEpisodeHeader(): Promise<void> {
		if (this.subPage !== 'episode' || !this.episodeStatusEl || !this.episodeGenBtnEl) return;
		const { chapterName, plotHistory } = await this.computeEpisodeStatus();
		this.currentPlotHistory = plotHistory;
		this.renderEpisodeStatusContent(this.episodeStatusEl, chapterName);
		this.episodeGenBtnEl.toggleClass('is-disabled', this.episodeGenerating || !plotHistory);
	}

	/** 씬 하나를 다 쓰고 다음 씬으로 넘어갈 때처럼, 생성 도중 진행 문구만 바뀔 때 쓴다 — 헤더 전체를 다시 그리지
	 * 않으므로 깜빡임이 없다. 헤더가 아직 없는 시점(생성 시작 전)이면 전체 rerender()로 대체한다. */
	private updateEpisodeProgress(status: string): void {
		this.episodeStatus = status;
		if (!this.episodeProgressEl) { this.rerender(); return; }
		this.episodeProgressEl.find('.wm-episodechat-progress-text')?.setText(status);
		this.episodeProgressEl.toggleClass('is-hidden', !status);
	}

	private async renderEpisodeChatPage(body: HTMLElement): Promise<void> {
		body.addClass('wm-episodechat');

		const header = body.createDiv({ cls: 'wm-episodechat-header' });
		const { chapterName, plotHistory } = await this.computeEpisodeStatus();
		this.currentPlotHistory = plotHistory;

		const row = header.createDiv({ cls: 'wm-episodechat-header-row' });
		const statusWrap = row.createDiv({ cls: 'wm-episodechat-status-wrap' });
		const infoIcon = statusWrap.createDiv({ cls: 'wm-episodechat-status-icon' });
		setIcon(infoIcon, 'info');
		setTooltip(infoIcon, '인식된 노트(N화)의 상위 폴더를 추적해 에피소드 노트를 읽고, 집필 회차의 플롯을 토대로 초고를 생성합니다.', { placement: 'top' });
		this.episodeStatusEl = statusWrap.createDiv({ cls: 'wm-episodechat-status' });
		this.renderEpisodeStatusContent(this.episodeStatusEl, chapterName);

		const genBtn = row.createDiv({ cls: 'wm-episodechat-gen-btn wm-tasks-add-btn' });
		genBtn.createSpan({ cls: 'wm-tasks-add-label', text: this.episodeGenerating ? '생성 중...' : '생성' });
		genBtn.toggleClass('is-disabled', this.episodeGenerating || !plotHistory);
		genBtn.addEventListener('click', () => {
			if (this.episodeGenerating || !this.currentPlotHistory) return;
			void this.runEpisodeGeneration(this.currentPlotHistory);
		});
		this.episodeGenBtnEl = genBtn;

		const progress = header.createDiv({ cls: 'wm-episodechat-progress' });
		setIcon(progress.createDiv({ cls: 'wm-episodechat-progress-icon' }), 'loader-2');
		progress.createSpan({ cls: 'wm-episodechat-progress-text', text: this.episodeStatus });
		progress.toggleClass('is-hidden', !this.episodeStatus);
		this.episodeProgressEl = progress;

		const listWrap = body.createDiv({ cls: 'wm-episodechat-list-wrap' });
		const listEl = listWrap.createDiv({ cls: 'wm-episodechat-list' });
		this.renderScrollNavButtons(listWrap, listEl);
		if (this.episodeSegments.length > 0 || this.episodeGenerating) {
			const nameColor = new Map<string, string>();
			for (const f of getCharacterCandidateFiles(this.plugin, this.activeFile)) {
				nameColor.set(getWikiDisplayName(this.app, this.plugin, f), getWikiColor(this.app, this.plugin, f));
			}
			for (const seg of this.episodeSegments) this.renderEpisodeSegment(listEl, seg, nameColor);
			if (this.episodeAutoScroll) {
				listEl.scrollTop = listEl.scrollHeight;
				this.episodeAutoScroll = false;
			} else {
				listEl.scrollTop = this.episodeScrollTop;
			}
		}
	}

	private async runEpisodeGeneration(plotHistory: PlotHistoryContext | null): Promise<void> {
		if (this.episodeGenerating || !this.activeFile || !plotHistory) return;

		this.episodeGenerating = true;
		this.episodeSegments = [];
		this.episodeStatus = '초안을 쓰는 중...';
		this.episodeAutoScroll = true;
		this.rerender();

		const characterFiles = getCharacterCandidateFiles(this.plugin, this.activeFile);
		const previousChapterBody = await getPreviousChapterBody(this.plugin, this.activeFile);

		try {
			const segments = await generateEpisodeScene(
				this.app, this.plugin, plotHistory, characterFiles,
				this.getApiKeys(), this.plugin.settings.aiEpisodeModel, this.plugin.settings.aiChatTemperature,
				this.plugin.settings.aiChatPersonaHeading, previousChapterBody,
				(status) => this.updateEpisodeProgress(status),
			);
			this.episodeSegments = segments;
			this.episodeStatus = '';
			this.episodeAutoScroll = true;
		} catch (e) {
			this.episodeStatus = '';
			new Notice('회차 생성 중 오류: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			this.episodeGenerating = false;
			this.rerender();
		}
	}

	private renderEpisodeSegment(listEl: HTMLElement, seg: EpisodeChatSegment, nameColor: Map<string, string>): void {
		if (seg.type === 'scene-divider') {
			const divider = listEl.createDiv({ cls: 'wm-episodechat-scene-divider' });
			divider.createSpan({ cls: 'wm-episodechat-scene-divider-label', text: seg.sceneName ?? '' });
			return;
		}

		const rawFile = seg.characterPath ? this.app.vault.getAbstractFileByPath(seg.characterPath) : null;
		const characterFile = rawFile instanceof TFile ? rawFile : null;

		if (seg.type === 'narration') {
			const narrRow = listEl.createDiv({ cls: 'wm-aichat-narration-row' });
			const textEl = narrRow.createDiv({ cls: 'wm-aichat-narration-text' });
			textEl.style.fontSize = `${this.plugin.settings.aiChatNarrationFontSize}em`;
			this.renderEpisodeNarrationText(textEl, seg.text, nameColor);
			return;
		}

		const row = listEl.createDiv({ cls: 'wm-episodechat-row' });
		const avatar = row.createDiv({ cls: 'wm-episodechat-avatar' });
		if (characterFile) {
			const imgSrc = getWikiImgSrc(this.app, this.plugin, characterFile);
			const color = getWikiColor(this.app, this.plugin, characterFile);
			avatar.setCssStyles({ background: color });
			if (imgSrc) avatar.createEl('img', { attr: { src: imgSrc } });
			else avatar.createSpan({ text: (seg.speakerName ?? '?').charAt(0).toUpperCase() });
		} else {
			setIcon(avatar, 'circle-user-round');
		}

		const col = row.createDiv({ cls: 'wm-episodechat-content' });
		const nameEl = col.createDiv({ cls: 'wm-episodechat-name', text: seg.speakerName ?? '' });
		if (characterFile) nameEl.setCssStyles({ color: getWikiColor(this.app, this.plugin, characterFile) });
		const bubble = col.createDiv({ cls: 'wm-episodechat-bubble' });
		const speakerColor = characterFile ? getWikiColor(this.app, this.plugin, characterFile) : null;
		this.renderEpisodeNarrationText(bubble, seg.text, nameColor, speakerColor);
		if (speakerColor) {
			bubble.setCssStyles({ background: `color-mix(in srgb, ${speakerColor} 12%, var(--background-primary))` });
		}
	}

	// ── 캐릭터 챗 ───────────────────────────────────────────────────────────

	private async renderChatPage(body: HTMLElement): Promise<void> {
		body.addClass('wm-aichat-chat');

		this.renderChatHeader(body);

		const messagesWrap = body.createDiv({ cls: 'wm-aichat-messages-wrap' });
		const messagesEl = messagesWrap.createDiv({ cls: 'wm-aichat-messages' });
		this.renderScrollNavButtons(messagesWrap, messagesEl);

		if (this.characterFile) {
			// 캐릭터를 새로 골랐을 때만(세션이 없거나 다른 인물일 때만) "이어볼 세션"을 다시 찾는다.
			// 새 대화 생성/히스토리 선택으로 이미 세션이 정해져 있으면 그걸 그대로 유지.
			if (!this.session || this.session.characterPath !== this.characterFile.path) {
				const name = getWikiDisplayName(this.app, this.plugin, this.characterFile);
				this.session = await this.storage.getOrCreateActiveSession(this.characterFile.path, name);
			}
			this.renderMessages(messagesEl);
			if (this.session.messages.length === 0) void this.sendGreeting(messagesEl);
		} else {
			messagesEl.createDiv({ cls: 'wm-aichat-empty', text: '위 프로필을 눌러 대화할 캐릭터를 선택하세요.' });
		}
		messagesEl.scrollTop = messagesEl.scrollHeight;

		const inputArea = body.createDiv({ cls: 'wm-aichat-input-area' });
		this.renderInputNavRow(inputArea, messagesEl);
		this.renderInputWrapper(inputArea, messagesEl);
	}

	private renderScrollNavButtons(messagesWrap: HTMLElement, messagesEl: HTMLElement): void {
		const navBtns = messagesWrap.createDiv({ cls: 'wm-aichat-nav-buttons' });
		const upBtn = navBtns.createDiv({ cls: 'wm-aichat-nav-btn', attr: { 'aria-label': '최상단으로' } });
		setIcon(upBtn, 'chevrons-up');
		upBtn.addEventListener('click', () => messagesEl.scrollTo({ top: 0, behavior: 'smooth' }));

		const downBtn = navBtns.createDiv({ cls: 'wm-aichat-nav-btn', attr: { 'aria-label': '최하단으로' } });
		setIcon(downBtn, 'chevrons-down');
		downBtn.addEventListener('click', () => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' }));
	}

	private openCharacterPicker(): void {
		new AiChatSuggestModal(this.plugin, '대화할 캐릭터를 선택하세요...', getCharacterCandidateFiles(this.plugin, this.activeFile), (file) => {
			void (async () => {
				this.characterFile = file;
				this.plugin.settings.aiChatLastCharacterPath = file.path;
				await this.plugin.saveSettings();
				this.rerender();
			})();
		}).open();
	}

	private renderChatHeader(body: HTMLElement): void {
		const header = body.createDiv({ cls: 'wm-aichat-chat-header' });
		header.addEventListener('click', () => this.openCharacterPicker());

		const avatar = header.createDiv({ cls: 'wm-aichat-header-avatar' });
		if (this.characterFile) {
			const imgSrc = getWikiImgSrc(this.app, this.plugin, this.characterFile);
			const name = getWikiDisplayName(this.app, this.plugin, this.characterFile);
			const color = getWikiColor(this.app, this.plugin, this.characterFile);
			avatar.setCssStyles({ background: color });
			if (imgSrc) avatar.createEl('img', { attr: { src: imgSrc } });
			else avatar.createSpan({ text: name.charAt(0).toUpperCase() });
			const titleEl = header.createDiv({ cls: 'wm-aichat-header-title' });
			titleEl.createSpan({ text: name, attr: { style: `color: ${color};` } });
			titleEl.createSpan({ text: '님과의 대화' });
		} else {
			setIcon(avatar, 'user-round');
			header.createDiv({ cls: 'wm-aichat-header-title', text: '캐릭터를 선택하세요' });
		}
	}

	private renderMessages(messagesEl: HTMLElement): void {
		messagesEl.empty();
		const typewriterIndex = this.pendingTypewriterIndex;
		this.pendingTypewriterIndex = null;

		if (!this.session || this.session.messages.length === 0) {
			messagesEl.createDiv({ cls: 'wm-aichat-empty', text: '아직 대화가 없습니다. 대사를 입력해보세요.' });
			return;
		}
		this.session.messages.forEach((msg, idx) => {
			if (msg.role === 'user' && msg.kind === 'narration') {
				this.renderNarrationRow(messagesEl, msg.content, this.resolveSpeakerFile(msg));
				return;
			}

			if (msg.role === 'assistant') {
				if (idx === typewriterIndex) {
					void this.typeOutAssistantMessage(messagesEl, msg);
					return;
				}
				for (const seg of this.getAssistantSegments(msg)) {
					if (seg.type === 'narration') {
						this.renderNarrationRow(messagesEl, seg.text, this.characterFile);
					} else {
						this.renderBubbleRow(messagesEl, 'assistant', seg.text, this.characterFile);
					}
				}
				return;
			}

			this.renderBubbleRow(messagesEl, 'user', msg.content, this.resolveSpeakerFile(msg), msg.speakerName);
		});
	}

	/** 이미 다 받은 응답을, 빠른 타자기 효과로 한 글자씩 드러내며 그린다 (실제 스트리밍이 아니라 클라이언트 쪽 연출). */
	private async typeOutAssistantMessage(messagesEl: HTMLElement, msg: AiChatMessage): Promise<void> {
		const targetSessionId = this.session?.id;
		const isStillActive = () => this.session?.id === targetSessionId && messagesEl.isConnected;

		for (const seg of this.getAssistantSegments(msg)) {
			if (!isStillActive()) return;

			if (seg.type === 'narration') {
				const narrRow = messagesEl.createDiv({ cls: 'wm-aichat-narration-row' });
				const textEl = narrRow.createDiv({ cls: 'wm-aichat-narration-text' });
				textEl.style.fontSize = `${this.plugin.settings.aiChatNarrationFontSize}em`;
				await this.typeText(textEl, seg.text, messagesEl, isStillActive);
				if (!isStillActive()) return;
				textEl.empty();
				this.renderNarrationText(textEl, seg.text, this.characterFile);
			} else {
				const row = messagesEl.createDiv({ cls: 'wm-aichat-msg-row is-assistant' });
				const bubbleWrap = row.createDiv({ cls: 'wm-aichat-msg-bubble-wrap' });
				const bubble = bubbleWrap.createDiv({ cls: 'wm-aichat-msg-bubble' });
				bubble.style.fontSize = `${this.plugin.settings.aiChatDialogueFontSize}em`;
				if (this.characterFile) {
					const color = getWikiColor(this.app, this.plugin, this.characterFile);
					bubble.setCssStyles({ background: `color-mix(in srgb, ${color} 12%, var(--background-primary))` });
				}
				// 붙여넣기 버튼을 타이핑 시작 전에 미리 만들어둬야, 타이핑 도중과 완료 후의 wrap 레이아웃(너비)이 동일하게 유지된다.
				this.addPasteButton(bubbleWrap, seg.text, true);
				await this.typeText(bubble, seg.text, messagesEl, isStillActive);
				if (!isStillActive()) return;
			}
		}
	}

	/** N글자씩 빠르게 배치로 드러내는 타자기 애니메이션. 세션이 바뀌면 즉시 중단한다. */
	private typeText(container: HTMLElement, fullText: string, messagesEl: HTMLElement, isStillActive: () => boolean): Promise<void> {
		const CHARS_PER_TICK = 1;
		const TICK_MS = 25;
		return new Promise(resolve => {
			let i = 0;
			const tick = () => {
				if (!isStillActive()) { resolve(); return; }
				i = Math.min(fullText.length, i + CHARS_PER_TICK);
				container.setText(fullText.slice(0, i));
				messagesEl.scrollTop = messagesEl.scrollHeight;
				if (i >= fullText.length) { resolve(); return; }
				window.setTimeout(tick, TICK_MS);
			};
			tick();
		});
	}

	/** segments가 없는(예전 형식) 메시지도 렌더링되도록 폴백 처리 */
	private getAssistantSegments(msg: AiChatMessage): AiChatSegment[] {
		if (msg.segments) return msg.segments;
		const legacyNarration = (msg as unknown as { narration?: string }).narration;
		return legacyNarration
			? [{ type: 'narration', text: legacyNarration }, { type: 'dialogue', text: msg.content }]
			: [{ type: 'dialogue', text: msg.content }];
	}

	private renderBubbleRow(messagesEl: HTMLElement, role: 'user' | 'assistant', text: string, colorFile: TFile | null, speakerName?: string): void {
		const row = messagesEl.createDiv({ cls: `wm-aichat-msg-row is-${role}` });
		if (role === 'user' && speakerName) {
			row.createDiv({ cls: 'wm-aichat-msg-speaker', text: speakerName });
		}
		const bubbleWrap = row.createDiv({ cls: 'wm-aichat-msg-bubble-wrap' });
		const bubble = bubbleWrap.createDiv({ cls: 'wm-aichat-msg-bubble' });
		bubble.style.fontSize = `${this.plugin.settings.aiChatDialogueFontSize}em`;
		const speakerColor = colorFile ? getWikiColor(this.app, this.plugin, colorFile) : null;
		this.renderTextWithThoughts(bubble, text, speakerColor, (parent, chunk) => parent.createSpan({ text: chunk }));
		if (speakerColor) {
			bubble.setCssStyles({ background: `color-mix(in srgb, ${speakerColor} 12%, var(--background-primary))` });
		}
		this.addPasteButton(bubbleWrap, text, true);
	}

	/** 저장된 메시지가 가리키던 상대역 노트를 우선 사용하고, 없으면 현재 선택된 화자로 폴백 */
	private resolveSpeakerFile(msg: AiChatMessage): TFile | null {
		if (msg.speakerPath) {
			const f = this.app.vault.getAbstractFileByPath(msg.speakerPath);
			if (f instanceof TFile) return f;
		}
		return this.speakerFile;
	}

	/** 지문(narration)을 말풍선과 별개로, wm-aichat-messages 폭 전체를 쓰는 이탤릭체 한 줄로 렌더링.
	 * subjectFile이 주어지면 그 인물 이름이 등장하는 부분을 wikiColor로 강조한다. */
	private renderNarrationRow(messagesEl: HTMLElement, text: string, subjectFile: TFile | null): void {
		const narrRow = messagesEl.createDiv({ cls: 'wm-aichat-narration-row' });
		const textEl = narrRow.createDiv({ cls: 'wm-aichat-narration-text' });
		textEl.style.fontSize = `${this.plugin.settings.aiChatNarrationFontSize}em`;
		this.renderNarrationText(textEl, text, subjectFile);
	}

	/** "(...)" 로 표현된 속마음 구간을, 위아래 여백을 둔 독립된 줄로 분리해 색을 입힌다. 색이 없으면(narration처럼
	 * 특정 인물 소유가 불분명할 때) CSS 기본값(text-muted 톤)을 그대로 쓴다. 일반 텍스트 구간은 renderNormal로 위임해
	 * 호출부마다 다른 추가 처리(이름 강조, ** 강조 등)를 얹을 수 있게 한다. */
	private renderTextWithThoughts(container: HTMLElement, text: string, color: string | null, renderNormal: (parent: HTMLElement, chunk: string) => void): void {
		for (const seg of splitThoughtSegments(text)) {
			if (!seg.text) continue;
			if (seg.isThought) {
				const block = container.createDiv({ cls: 'wm-aichat-thought' });
				renderNormal(block, seg.text);
				if (color) block.setCssStyles({ borderColor: color, color });
			} else {
				renderNormal(container, seg.text);
			}
		}
	}

	/** 회차챗 지문·대사 렌더링: 여러 등장인물의 이름을 각자의 위키 컬러로 강조하고, **~** 인라인 표시는
	 * wm-episodechat-transition(장소 전환/중요 대목 강조)으로 감싼다. thoughtColor가 주어지면(대사의 화자)
	 * "(...)" 속마음 구간을 그 인물 색으로, 없으면(지문) 기본 톤으로 구분해 표시한다. */
	private renderEpisodeNarrationText(container: HTMLElement, text: string, nameColor: Map<string, string>, thoughtColor?: string | null): void {
		const names = [...nameColor.keys()].filter(n => n).sort((a, b) => b.length - a.length);
		const nameRe = names.length > 0
			? new RegExp(`(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')
			: null;

		const appendWithNames = (parent: HTMLElement, chunk: string) => {
			if (!chunk) return;
			if (!nameRe) { parent.createSpan({ text: chunk }); return; }
			let idx = 0;
			nameRe.lastIndex = 0;
			let nm: RegExpExecArray | null;
			while ((nm = nameRe.exec(chunk))) {
				if (nm.index > idx) parent.createSpan({ text: chunk.slice(idx, nm.index) });
				parent.createSpan({ text: nm[0], attr: { style: `color: ${nameColor.get(nm[0])};` } });
				idx = nm.index + nm[0].length;
			}
			if (idx < chunk.length) parent.createSpan({ text: chunk.slice(idx) });
		};

		const appendWithEmphasis = (parent: HTMLElement, chunk: string) => {
			const emphasisRe = /\*\*(.+?)\*\*/g;
			let lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = emphasisRe.exec(chunk))) {
				if (m.index > lastIndex) appendWithNames(parent, chunk.slice(lastIndex, m.index));
				const emphSpan = parent.createSpan({ cls: 'wm-episodechat-transition' });
				appendWithNames(emphSpan, m[1]);
				lastIndex = m.index + m[0].length;
			}
			if (lastIndex < chunk.length) appendWithNames(parent, chunk.slice(lastIndex));
		};

		this.renderTextWithThoughts(container, text, thoughtColor ?? null, appendWithEmphasis);
	}

	private renderNarrationText(container: HTMLElement, text: string, subjectFile: TFile | null): void {
		const name = subjectFile ? getWikiDisplayName(this.app, this.plugin, subjectFile) : '';
		const color = subjectFile ? getWikiColor(this.app, this.plugin, subjectFile) : null;

		if (!name) {
			this.renderTextWithThoughts(container, text, color, (parent, chunk) => parent.createSpan({ text: chunk }));
			return;
		}

		// 지문에 인물 이름이 없으면(사용자가 직접 짧게 지문만 친 경우 등) 3인칭 주어로 자동 추가
		const fullText = text.includes(name) ? text : `${name}, ${text}`;

		const appendWithName = (parent: HTMLElement, chunk: string) => {
			const parts = chunk.split(name);
			parts.forEach((part, i) => {
				if (part) parent.createSpan({ text: part });
				if (i < parts.length - 1) parent.createSpan({ text: name, attr: { style: `color: ${color};` } });
			});
		};

		this.renderTextWithThoughts(container, fullText, color, appendWithName);
	}

	/** 응답 대기 중 표시하는 말풍선 — 점 3개가 통통 튀는 타이핑 인디케이터 */
	private renderTypingBubble(messagesEl: HTMLElement): HTMLElement {
		const row = messagesEl.createDiv({ cls: 'wm-aichat-msg-row is-assistant wm-aichat-is-loading' });
		const bubble = row.createDiv({ cls: 'wm-aichat-msg-bubble wm-aichat-typing-bubble' });
		const dots = bubble.createDiv({ cls: 'wm-aichat-typing-dots', attr: { 'aria-label': '응답 작성 중' } });
		dots.createSpan();
		dots.createSpan();
		dots.createSpan();
		return row;
	}

	private addPasteButton(container: HTMLElement, text: string, wrapInQuotes: boolean): void {
		const pasteBtn = container.createDiv({ cls: 'wm-aichat-msg-paste-btn', attr: { 'aria-label': '붙여넣기' } });
		setIcon(pasteBtn, 'clipboard-paste');
		pasteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.pasteToCursor(text, wrapInQuotes);
		});
	}

	private pasteToCursor(text: string, wrapInQuotes: boolean): void {
		const editor = this.lastEditor;
		if (!editor) { new Notice('붙여넣을 에디터를 먼저 열어주세요.'); return; }
		const useSmartQuotes = this.plugin.settings.enableSmartQuotes;
		const wrapped = !wrapInQuotes ? text : (useSmartQuotes ? `“${text}”` : `"${text}"`);

		const cursor = editor.getCursor();
		const before = editor.getRange({ line: 0, ch: 0 }, cursor);
		let separator = '';
		if (before.length > 0 && !before.endsWith('\n\n')) {
			separator = before.endsWith('\n') ? '\n' : '\n\n';
		}
		editor.replaceSelection(separator + wrapped);
	}

	// ── 입력창 위 네비 행: 현재 노트 / 새 대화 / 히스토리 ─────────────────────

	private renderInputNavRow(inputArea: HTMLElement, messagesEl: HTMLElement): void {
		const nav = inputArea.createDiv({ cls: 'wm-aichat-input-nav-row' });

		const titleIcon = nav.createDiv({ cls: 'wm-cal-icon-btn' });
		setIcon(titleIcon, 'file-text');
		const titleGroup = nav.createDiv({ cls: 'wm-aichat-title-group' });
		this.toolbarTitleEl = titleGroup.createSpan({ text: this.activeFile ? this.activeFile.basename : 'AI' });

		const navActions = nav.createDiv({ cls: 'wm-aichat-input-nav-actions' });

		const newChatBtn = navActions.createDiv({ cls: 'wm-cal-icon-btn', attr: { 'aria-label': '새 대화' } });
		setIcon(newChatBtn, 'square-plus');
		newChatBtn.addEventListener('click', () => {
			void (async () => {
				if (!this.characterFile) { new Notice('먼저 캐릭터를 선택하세요.'); return; }
				// 기존 대화 내역은 히스토리에 그대로 남기고, 같은 인물과의 완전히 새 세션을 시작한다.
				const name = getWikiDisplayName(this.app, this.plugin, this.characterFile);
				this.session = await this.storage.createNewSession(this.characterFile.path, name);
				this.rerender();
			})();
		});

		const historyBtn = navActions.createDiv({ cls: 'wm-cal-icon-btn', attr: { 'aria-label': '히스토리' } });
		setIcon(historyBtn, 'history');
		historyBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.toggleHistoryDropdown(inputArea, messagesEl);
		});
	}

	/** claudian의 model-dropdown처럼 wm-aichat-input-area 위쪽에 뜨는 히스토리 드롭다운.
	 * 항목을 지워도 드롭다운이 닫히지 않아서 여러 개를 연달아 삭제할 수 있다. */
	private async toggleHistoryDropdown(inputArea: HTMLElement, messagesEl: HTMLElement): Promise<void> {
		const existing = inputArea.querySelector('.wm-aichat-history-dropdown');
		if (existing) { existing.remove(); return; }

		const sessions = await this.storage.listSessions();
		if (sessions.length === 0) { new Notice('저장된 대화가 없습니다.'); return; }

		const dropdown = inputArea.createDiv({ cls: 'wm-aichat-history-dropdown' });

		const renderRow = (session: AiChatSession) => {
			const file = this.app.vault.getAbstractFileByPath(session.characterPath);
			const charName = file instanceof TFile ? getWikiDisplayName(this.app, this.plugin, file) : session.characterPath;
			const imgSrc = file instanceof TFile ? getWikiImgSrc(this.app, this.plugin, file) : '';
			const lastMsg = session.messages[session.messages.length - 1];

			const row = dropdown.createDiv({ cls: 'wm-aichat-suggest-item' });
			row.dataset.sessionId = session.id;

			const avatar = row.createDiv({ cls: 'wm-aichat-suggest-avatar' });
			if (imgSrc) avatar.createEl('img', { attr: { src: imgSrc } });
			else avatar.createSpan({ text: charName.charAt(0).toUpperCase() });

			const textWrap = row.createDiv({ cls: 'wm-aichat-suggest-text' });
			const nameEl = textWrap.createDiv({ cls: 'wm-aichat-suggest-name', text: session.title });
			textWrap.createDiv({ cls: 'wm-aichat-suggest-preview', text: lastMsg ? lastMsg.content.slice(0, 40) : charName });

			row.addEventListener('click', () => {
				void (async () => {
					if (!(file instanceof TFile)) { new Notice('해당 캐릭터 노트를 찾을 수 없습니다.'); return; }
					this.characterFile = file;
					this.session = session;
					this.plugin.settings.aiChatLastCharacterPath = file.path;
					await this.plugin.saveSettings();
					dropdown.remove();
					this.rerender();
				})();
			});

			const actions = row.createDiv({ cls: 'wm-aichat-suggest-actions' });

			const renameBtn = actions.createDiv({ cls: 'wm-aichat-suggest-action', attr: { 'aria-label': '이름 수정' } });
			setIcon(renameBtn, 'pencil');
			renameBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				new AiChatRenameModal(this.app, session.title, (newTitle) => {
					void (async () => {
						await this.storage.rename(session.id, newTitle);
						session.title = newTitle;
						nameEl.setText(newTitle);
						if (this.session?.id === session.id) this.session.title = newTitle;
					})();
				}).open();
			});

			const deleteBtn = actions.createDiv({ cls: 'wm-aichat-suggest-action is-danger', attr: { 'aria-label': '대화 삭제' } });
			setIcon(deleteBtn, 'trash-2');
			deleteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void (async () => {
					await this.storage.deleteSession(session.id);
					row.remove();
					if (this.session?.id === session.id) {
						this.session = null;
						this.renderMessages(messagesEl);
					}
					if (dropdown.children.length === 0) dropdown.remove();
				})();
			});
		};

		for (const session of sessions) renderRow(session);

		window.setTimeout(() => {
			const close = (e: MouseEvent) => {
				if (!dropdown.contains(e.target as Node)) {
					dropdown.remove();
					activeDocument.removeEventListener('click', close);
				}
			};
			activeDocument.addEventListener('click', close);
		}, 10);
	}

	// ── 입력창 본체 (claudian 스타일: 화자 버튼 + 텍스트영역 + 전송) ──────────

	private renderInputWrapper(inputArea: HTMLElement, messagesEl: HTMLElement): void {
		const wrapper = inputArea.createDiv({ cls: 'wm-aichat-input-wrapper' });
		this.inputWrapperEl = wrapper;

		const textarea = wrapper.createEl('textarea', {
			cls: 'wm-aichat-textarea',
			attr: { placeholder: '대사를 입력하세요... (Shift+Tab: 지문 전환)', rows: '1' },
		});

		const toolbar = wrapper.createDiv({ cls: 'wm-aichat-input-toolbar' });

		const speakerBtn = toolbar.createDiv({ cls: 'wm-aichat-speaker-btn' });
		const speakerLabel = speakerBtn.createSpan({
			cls: 'wm-aichat-speaker-label',
			text: this.speakerFile ? getWikiDisplayName(this.app, this.plugin, this.speakerFile) : '화자 선택',
		});
		speakerBtn.addEventListener('click', () => {
			new AiChatSuggestModal(this.plugin, '지금 대사를 치는 상대역을 선택하세요...', getCharacterCandidateFiles(this.plugin, this.activeFile), (file) => {
				void (async () => {
					this.speakerFile = file;
					this.plugin.settings.aiChatLastSpeakerPath = file.path;
					await this.plugin.saveSettings();
					speakerLabel.setText(getWikiDisplayName(this.app, this.plugin, file));
				})();
			}).open();
		});

		const modeLabel = toolbar.createDiv({ cls: 'wm-aichat-mode-label', text: this.inputMode === 'narration' ? '지문' : '대사' });
		this.modeLabelEl = modeLabel;
		if (this.inputMode === 'narration') { wrapper.addClass('wm-aichat-input-narration-mode'); modeLabel.addClass('is-active'); }

		const toggleMode = () => {
			this.inputMode = this.inputMode === 'dialogue' ? 'narration' : 'dialogue';
			const isNarration = this.inputMode === 'narration';
			modeLabel.setText(isNarration ? '지문' : '대사');
			modeLabel.toggleClass('is-active', isNarration);
			wrapper.toggleClass('wm-aichat-input-narration-mode', isNarration);
			textarea.placeholder = isNarration ? '지문(행동/상황 묘사)을 입력하세요...' : '대사를 입력하세요... (Shift+Tab: 지문 전환)';
		};

		const send = () => { void this.handleSend(textarea, messagesEl); };
		textarea.addEventListener('keydown', (e) => {
			if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); toggleMode(); return; }
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
		});
	}

	private async handleSend(textarea: HTMLTextAreaElement, messagesEl: HTMLElement): Promise<void> {
		const content = textarea.value.trim();
		if (!content) return;
		if (!this.characterFile) { new Notice('먼저 대화할 캐릭터를 선택하세요.'); return; }
		if (!this.plugin.settings.aiChatApiKey) { new Notice('AI 설정에서 API 키를 먼저 입력하세요.'); return; }

		if (!this.session) {
			const name = getWikiDisplayName(this.app, this.plugin, this.characterFile);
			this.session = await this.storage.createNewSession(this.characterFile.path, name);
		}
		// 이 요청이 대상으로 하는 세션을 고정 — 응답을 기다리는 동안 사용자가 다른 세션/캐릭터로
		// 넘어가도(새 대화, 히스토리 전환 등) 이 세션 자체나 다른 세션의 전송 가능 여부에 영향 없게 함.
		const session = this.session;
		if (this.sendingSessionIds.has(session.id)) return;

		const sentKind = this.inputMode;
		textarea.value = '';
		this.sendingSessionIds.add(session.id);

		// 지문 입력 후에는 대사 모드로 되돌림
		if (this.inputMode === 'narration') {
			this.inputMode = 'dialogue';
			this.modeLabelEl?.setText('대사');
			this.modeLabelEl?.removeClass('is-active');
			this.inputWrapperEl?.removeClass('wm-aichat-input-narration-mode');
			textarea.placeholder = '대사를 입력하세요... (Shift+Tab: 지문 전환)';
		}

		const speakerName = this.speakerFile ? getWikiDisplayName(this.app, this.plugin, this.speakerFile) : undefined;
		const userMsg: AiChatMessage = {
			role: 'user',
			content,
			speakerPath: this.speakerFile?.path,
			speakerName,
			kind: sentKind,
			timestamp: Date.now(),
		};

		session.messages.push(userMsg);
		await this.storage.save(session);

		// messagesEl은 이 요청을 보낸 시점의 DOM 노드라, 응답을 기다리는 동안 사용자가 다른
		// 세션으로 넘어가면 이미 화면에서 떨어져나갔을 수 있다. 그럴 땐 건드리지 않는다.
		const isStillActive = () => this.session?.id === session.id;
		if (isStillActive()) this.renderMessages(messagesEl);
		const loadingRow = isStillActive() ? this.renderTypingBubble(messagesEl) : null;
		if (loadingRow) messagesEl.scrollTop = messagesEl.scrollHeight;

		try {
			const systemPrompt = await this.buildSystemPrompt();
			const raw = await withTimeout(
				callAiChat(this.getApiKeys(), systemPrompt, session.messages, this.plugin.settings.aiChatTemperature, this.plugin.settings.aiChatModel),
				RESPONSE_TIMEOUT_MS,
			);

			const assistantMsg: AiChatMessage = { role: 'assistant', content: raw, segments: parseAssistantSegments(raw), timestamp: Date.now() };
			session.messages.push(assistantMsg);
			await this.storage.save(session);

			this.sendingSessionIds.delete(session.id);
			if (isStillActive()) {
				loadingRow?.remove();
				this.pendingTypewriterIndex = session.messages.length - 1;
				this.renderMessages(messagesEl);
				messagesEl.scrollTop = messagesEl.scrollHeight;
			}
		} catch (e) {
			this.sendingSessionIds.delete(session.id);
			if (isStillActive()) {
				loadingRow?.remove();
				const errRow = messagesEl.createDiv({ cls: 'wm-aichat-error-row' });
				errRow.createSpan({ text: '응답을 받지 못했습니다. ' + (e instanceof Error ? e.message : '') });
				const retryBtn = errRow.createEl('button', { cls: 'wm-aichat-retry-btn', text: '재시도' });
				retryBtn.addEventListener('click', () => {
					errRow.remove();
					textarea.value = content;
					void this.handleSend(textarea, messagesEl);
				});
			}
		}
	}

	private getApiKeys(): AiChatApiKeys {
		return {
			nvidia: this.plugin.settings.aiChatApiKey,
			gemini: this.plugin.settings.aiChatGeminiApiKey,
			cerebras: this.plugin.settings.aiChatCerebrasApiKey,
		};
	}

	private async buildSystemPrompt(): Promise<string> {
		if (!this.characterFile) return '';
		const heading = this.plugin.settings.aiChatPersonaHeading;
		const aName = getWikiDisplayName(this.app, this.plugin, this.characterFile);
		const aBody = extractPersonaContent(await this.app.vault.read(this.characterFile), heading);

		let speakerBlock = '';
		if (this.speakerFile) {
			const bName = getWikiDisplayName(this.app, this.plugin, this.speakerFile);
			const bBody = extractPersonaContent(await this.app.vault.read(this.speakerFile), heading);
			speakerBlock = `\n\n지금 당신에게 말을 거는 사람은 "${bName}"입니다. 참고 설정:\n${bBody}`;
		}

		let sceneBlock = '';
		if (this.activeFile) {
			const sceneText = await this.app.vault.read(this.activeFile);
			sceneBlock = `\n\n다음은 현재 집필 중인 장면(참고 문맥)입니다:\n${sceneText}`;
		}

		let episodeBlock = '';
		const episodePlot = await getEpisodePlotContext(this.plugin, this.activeFile);
		if (episodePlot) {
			episodeBlock = `\n\n다음은 이 회차의 플롯 설계입니다. 대화가 이 흐름과 설정에서 벗어나지 않도록 참고하세요:\n${episodePlot}`;
		}

		const basePrompt = `당신은 숙련된 소설 작가입니다. 지금 독자(사용자)와 함께 인터랙티브 소설을 쓰고 있고, 당신이 맡은 역할은 등장인물 "${aName}"의 대사와 행동을 서술하는 것입니다. 다음은 이 인물의 설정입니다:\n${aBody}${speakerBlock}${sceneBlock}${episodeBlock}\n\n위 설정과 문맥에 맞게, 작가로서 "${aName}"이(가) 이 상황에서 보일 법한 반응과 대사를 서술하세요. 사용자 메시지가 *로 감싸여 있으면 그건 대사가 아니라 지문(행동/상황 묘사)이니, 대사가 아니라 그 상황에 대한 반응으로 받아들이세요.\n\n지문을 쓸 때는 감정을 직접 말하지 말고 행동·표정·신체 반응으로 보여주세요 (예: "부끄러워했다"가 아니라 "시선을 피하며 옷자락을 만지작거렸다"). 캐릭터의 말투와 어휘 습관은 항상 설정에 맞게 일관되게 유지하세요.\n\n반드시 다음 형식으로만 답하세요. 한 장면 안에서 행동과 대사가 여러 번 번갈아 나와도 되니, 필요한 만큼 [지문]과 [대사]를 반복하세요 (예: [지문]...[대사]...[지문]...[대사]... 처럼 여러 쌍이어도 됨. 절대 한 [지문]이나 [대사] 안에 다른 태그나 큰따옴표를 섞지 마세요):\n[지문] (이 순간 인물의 반응이나 행동을, 소설처럼 3인칭 시점으로 서술. 문장에 반드시 "${aName}"을(를) 주어로 명시할 것. 괄호나 따옴표로 감싸지 말 것)\n[대사] (실제로 "${aName}"이(가) 입 밖으로 내는 말만. 큰따옴표나 지문, 설명을 절대 섞지 말 것)`;

		const customStyleNote = await loadCustomStyleNote(this.app, this.plugin);
		return `${basePrompt}${buildCustomStyleBlock(customStyleNote)}`;
	}

	// ── 새 대화 시작 시 AI가 먼저 인사말 건네기 ────────────────────────────────

	private async sendGreeting(messagesEl: HTMLElement): Promise<void> {
		if (!this.characterFile || !this.session) return;
		if (!this.plugin.settings.aiChatApiKey) return;

		const session = this.session;
		if (this.sendingSessionIds.has(session.id)) return;
		const targetId = session.id;
		this.sendingSessionIds.add(targetId);
		messagesEl.empty();
		const loadingRow = this.renderTypingBubble(messagesEl);

		try {
			const basePrompt = await this.buildSystemPrompt();
			const greetingPrompt = `${basePrompt}\n\n지금은 대화가 막 시작되는 시점입니다. 사용자가 말을 걸기 전에, 먼저 자연스러운 인사말이나 대화를 여는 대사를 건네세요.`;
			// system 메시지만 보내면 채팅 템플릿이 완성되지 않는 API가 있어, 저장/표시되지 않는 더미 user 턴을 하나 끼워 넣는다.
			const kickoff: AiChatMessage = { role: 'user', content: '(대화 시작)', timestamp: Date.now() };
			const raw = await withTimeout(
				callAiChat(this.getApiKeys(), greetingPrompt, [kickoff], this.plugin.settings.aiChatTemperature, this.plugin.settings.aiChatModel),
				RESPONSE_TIMEOUT_MS,
			);

			session.messages.push({ role: 'assistant', content: raw, segments: parseAssistantSegments(raw), timestamp: Date.now() });
			await this.storage.save(session);

			this.sendingSessionIds.delete(targetId);
			// 응답을 기다리는 동안 패널이 다시 렌더링됐을 수 있어(탭 전환 등), messagesEl이 이미
			// 화면에서 떨어져나간 상태일 수 있다. 그래서 직접 DOM을 만지지 않고, 지금도 같은
			// 세션을 보고 있을 때만 전체를 다시 그린다.
			if (this.session?.id === targetId) {
				this.pendingTypewriterIndex = session.messages.length - 1;
				this.rerender();
			}
		} catch (e) {
			this.sendingSessionIds.delete(targetId);
			if (this.session?.id === targetId) {
				loadingRow.remove();
				this.renderMessages(messagesEl);
				const errRow = messagesEl.createDiv({ cls: 'wm-aichat-error-row' });
				errRow.createSpan({ text: '선인사를 받지 못했습니다. ' + (e instanceof Error ? e.message : '') });
			}
		}
	}
}
