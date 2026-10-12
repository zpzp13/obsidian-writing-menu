import { App, Editor, EventRef, Modal, Notice, Platform, Scope, setIcon } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { clearEditorSpellcheckHighlights, setEditorSpellcheckHighlights } from '../editor/spellcheckHighlight';
import type { Correction } from './index';

export type CorrectionState = 'error' | 'corrected' | 'original-kept' | 'user-edited';

interface StateInfo {
	state: CorrectionState;
	value: string;
}

interface Occurrence {
	corrIdx: number;
	pos: number;
}

type MobilePanel = 'list' | 'detail';

export interface ModalConfig {
	text: string;
	bodyOffset: number;
	editor: Editor;
	corrections: Correction[];
	onIgnoredWordAdded?: (words: string[]) => void;
}

class SpellcheckApplyConfirmModal extends Modal {
	constructor(app: App, private readonly errorCount: number, private readonly onConfirm: () => void) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass('wm-spell-apply-confirm-modal');
		this.contentEl.empty();
		this.contentEl.createEl('h3', { text: '남은 오류를 모두 교정할까요?' });
		this.contentEl.createDiv({
			cls: 'wm-spell-apply-confirm-description',
			text: `${this.errorCount}개 오류에 첫 번째 제안을 적용합니다.`,
		});
		const actions = this.contentEl.createDiv({ cls: 'wm-spell-apply-confirm-actions' });
		const cancel = actions.createEl('button', { text: '취소' });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', { cls: 'mod-cta', text: '일괄 적용' });
		confirm.addEventListener('click', () => {
			this.close();
			this.onConfirm();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

class SpellcheckMobileGuideModal extends Modal {
	onOpen() {
		this.modalEl.addClass('wm-spell-mobile-guide-modal');
		this.contentEl.empty();
		this.contentEl.createEl('h3', { text: '모바일 맞춤법 검사' });
		const guide = this.contentEl.createDiv({ cls: 'wm-spell-mobile-guide-copy' });
		guide.createEl('p', { text: '오류 목록에서 항목을 선택하면 해당 문장으로 이동하고 교정 상세가 열립니다.' });
		guide.createEl('p', { text: '유지는 원문을 그대로 두고, 수정은 제안된 표현을 문서에 바로 반영합니다.' });
		guide.createEl('p', { text: '상단 도구에서 직접 수정, 사전 제외, 남은 오류 일괄 적용을 사용할 수 있습니다.' });
		const close = this.contentEl.createEl('button', { cls: 'mod-cta', text: '확인' });
		close.addEventListener('click', () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}

const STATE_COLORS: Record<CorrectionState, string> = {
	'error': 'var(--color-red)',
	'corrected': 'var(--color-green)',
	'original-kept': 'var(--color-yellow)',
	'user-edited': 'var(--color-purple)',
};

const TYPE_BADGE_MAP: Record<string, { label: string; color: string }> = {
	// Daum 영문 타입
	'space': { label: '띄어쓰기', color: 'var(--color-orange)' },
	'spell': { label: '문법', color: 'var(--color-red)' },
	'red': { label: '맞춤법', color: 'var(--color-red)' },
	'green': { label: '띄어쓰기', color: 'var(--color-orange)' },
	'blue': { label: '의심', color: 'var(--color-purple)' },
	'violet': { label: '통계', color: 'var(--color-purple)' },
	// Daum 한글 타입
	'교체': { label: '교체', color: 'var(--color-red)' },
	'의심': { label: '의심', color: 'var(--color-purple)' },
	'삽입': { label: '삽입', color: 'var(--color-orange)' },
	'삭제': { label: '삭제', color: 'var(--color-red)' },
	'맞춤법': { label: '맞춤법', color: 'var(--color-red)' },
	'표준어 의심': { label: '의심', color: 'var(--color-purple)' },
	'비표준어': { label: '비표준', color: 'var(--color-yellow)' },
	'띄어쓰기': { label: '띄어쓰기', color: 'var(--color-orange)' },
	'통계적 교정': { label: '통계', color: 'var(--color-purple)' },
	'doubt': { label: '의심', color: 'var(--color-purple)' },
};

const STATE_BADGE_LABELS: Partial<Record<CorrectionState, string>> = {
	'corrected': '수정',
	'original-kept': '유지',
	'user-edited': '직접',
};

// 한국어 조사 제거 (긴 것부터 시도, 어근 2자 이상 보장)
const KOREAN_PARTICLES = [
	'으로부터', '에서부터', '에게서', '한테서', '으로서', '으로써',
	'에게', '한테', '로부터', '에서', '으로', '이라도', '라도', '까지', '부터', '처럼', '만큼', '보다', '마저', '조차',
	'이든지', '든지', '이든', '든', '이며', '이고', '이나', '이랑', '이라', '이면',
	'에다가', '에다', '로서', '로써', '과는', '와는', '와도', '과도', '을랑', '를랑',
	'은', '는', '이', '가', '을', '를', '의', '에', '과', '와', '로', '도', '만', '며', '고', '나', '랑', '라', '면',
];

function stripKoreanParticle(word: string): string {
	for (const p of KOREAN_PARTICLES) {
		if (word.endsWith(p) && word.length - p.length >= 2) return word.substring(0, word.length - p.length);
	}
	return word;
}

function matchesIgnoredStem(original: string, stem: string): boolean {
	return original === stem || (stem.length >= 2 && original.startsWith(stem));
}

function isSpacingCorrection(original: string, corrected: string): boolean {
	return original !== corrected && original.replace(/\s+/g, '') === corrected.replace(/\s+/g, '');
}

function toProofreadingMarks(original: string, corrected: string): string {
	if (!isSpacingCorrection(original, corrected)) return corrected;
	let result = '';
	let oi = 0, ci = 0;
	while (ci < corrected.length || oi < original.length) {
		const co = corrected[ci];
		const org = original[oi];
		if (co === ' ') {
			if (org === ' ') { result += ' '; oi++; ci++; }
			else { result += '∨'; ci++; }
		} else if (org === ' ') {
			result += '⌒'; oi++;
		} else if (co !== undefined) {
			result += co; oi++; ci++;
		} else {
			break;
		}
	}
	return result;
}

function displayText(original: string, value: string): string {
	return isSpacingCorrection(original, value) ? toProofreadingMarks(original, value) : value;
}

function appendMarkedDisplayText(parent: HTMLElement, original: string, value: string) {
	const displayed = displayText(original, value);
	displayed.split(/([∨⌒]+)/).filter(Boolean).forEach(part => {
		if (/^[∨⌒]+$/.test(part)) parent.createSpan({ cls: 'wm-spell-mobile-proof-mark', text: part });
		else parent.appendText(part);
	});
}

function appendMobileHelpText(parent: HTMLElement, helpText: string) {
	const marker = helpText.match(/^([①②③④⑤⑥⑦⑧⑨⑩])\s*/);
	if (!marker) {
		parent.setText(helpText);
		return;
	}
	parent.createSpan({ cls: 'wm-spell-mobile-help-index', text: marker[1] });
	parent.appendText(` ${helpText.substring(marker[0].length)}`);
}

function oneUiScrollEasing(progress: number): number {
	// Samsung One UI basic path: cubic-bezier(0.22, 0.25, 0, 1).
	const x1 = 0.22, y1 = 0.25, x2 = 0, y2 = 1;
	const sample = (t: number, a1: number, a2: number) => {
		const inverse = 1 - t;
		return 3 * inverse * inverse * t * a1 + 3 * inverse * t * t * a2 + t * t * t;
	};
	const slope = (t: number, a1: number, a2: number) =>
		3 * (1 - t) * (1 - t) * a1 + 6 * (1 - t) * t * (a2 - a1) + 3 * t * t * (1 - a2);

	let t = progress;
	for (let i = 0; i < 5; i++) {
		const currentX = sample(t, x1, x2) - progress;
		const currentSlope = slope(t, x1, x2);
		if (Math.abs(currentSlope) < 1e-6) break;
		t = Math.max(0, Math.min(1, t - currentX / currentSlope));
	}
	return sample(t, y1, y2);
}

function appendTypeBadge(parent: HTMLElement, type: string | undefined, extraCls?: string) {
	if (!type) return;
	const badge = TYPE_BADGE_MAP[type];
	if (!badge) {
		parent.createSpan({ cls: ['wm-spell-type-tag', ...(extraCls ? [extraCls] : [])], text: type.substring(0, 5) });
		return;
	}
	const tag = parent.createSpan({ cls: ['wm-spell-type-tag', ...(extraCls ? [extraCls] : [])], text: badge.label });
	if (badge.color !== 'var(--text-muted)') tag.style.color = badge.color;
}

export class CorrectionModal extends Modal {
	private config: ModalConfig;
	private occurrences: Occurrence[] = [];
	private occStates: Map<number, StateInfo> = new Map();
	private focusedOccIdx = 0;
	private previewEl!: HTMLElement;
	private listEl!: HTMLElement;
	private detailEl!: HTMLElement;
	private footerEl!: HTMLElement;
	private headerCountsEl!: HTMLElement;
	private keyboardScope: Scope;
	private keyboardScopeActive = false;
	private editOverlayEl: HTMLElement | null = null;
	private editConfirmFn: (() => void) | null = null;
	private editViewportCleanup: (() => void) | null = null;
	private readonly isMobileLayout: boolean;
	private mobileEditorChangeRef: EventRef | null = null;
	private mobileEditorText = '';
	private mobileSyncTimer: number | null = null;
	private mobileEditorClickHandler: ((event: MouseEvent) => void) | null = null;
	private totalOccurrenceCount = 0;
	private mobileToolbarEl!: HTMLElement;
	private mobilePanel: MobilePanel = 'list';
	private mobileCenterFocusedItem = false;
	private mobileListScrollTop = 0;
	private mobileListScrollFrame: number | null = null;

	constructor(app: App, config: ModalConfig) {
		super(app);
		this.config = config;
		this.keyboardScope = new Scope();
		this.isMobileLayout = Platform.isMobile;

		this.modalEl.addClass('wm-spell-modal');

		this.buildOccurrences();
		this.totalOccurrenceCount = this.occurrences.length;
	}

	private get bodyText(): string {
		return this.config.text.substring(this.config.bodyOffset);
	}

	private buildOccurrences() {
		const body = this.bodyText;
		const occs: Occurrence[] = [];

		this.config.corrections.forEach((c, ci) => {
			let from = 0;
			for (;;) {
				const pos = body.indexOf(c.original, from);
				if (pos === -1) break;
				occs.push({ corrIdx: ci, pos });
				from = pos + c.original.length;
			}
		});

		occs.sort((a, b) => a.pos - b.pos);

		// 겹치는 항목 제거 → 목록과 미리보기가 항상 동기화됨
		const nonOverlapping: Occurrence[] = [];
		let lastEnd = 0;
		for (const occ of occs) {
			const end = occ.pos + this.config.corrections[occ.corrIdx].original.length;
			if (occ.pos >= lastEnd) { nonOverlapping.push(occ); lastEnd = end; }
		}
		this.occurrences = nonOverlapping;

		this.occurrences.forEach((occ, oi) => {
			this.occStates.set(oi, { state: 'error', value: this.config.corrections[occ.corrIdx].original });
		});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass('wm-spell-modal');

		if (this.isMobileLayout) {
			this.openMobileLayout();
			return;
		}

		const header = contentEl.createDiv({ cls: 'wm-spell-header' });
		header.createEl('span', { cls: 'wm-spell-header-title', text: '맞춤법 검사' });
		this.headerCountsEl = header.createDiv({ cls: 'wm-spell-header-counts' });

		const split = contentEl.createDiv({ cls: 'wm-spell-split' });

		const listPanel = split.createDiv({ cls: 'wm-spell-list-panel' });
		listPanel.createEl('div', { cls: 'wm-spell-panel-title', text: '오류 목록' });
		this.listEl = listPanel.createDiv({ cls: 'wm-spell-list' });

		const previewPanel = split.createDiv({ cls: 'wm-spell-preview-panel' });
		previewPanel.createEl('div', { cls: 'wm-spell-panel-title', text: '미리보기' });
		this.previewEl = previewPanel.createDiv({ cls: 'wm-spell-preview-content' });

		this.detailEl = split.createDiv({ cls: 'wm-spell-detail' });
		this.footerEl = contentEl.createDiv({ cls: 'wm-spell-footer' });

		this.refresh();
		this.setupKeyboard();
	}

	onClose() {
		this.closeEditPopup();
		this.cancelMobileListScroll();
		if (this.keyboardScopeActive) {
			this.app.keymap.popScope(this.keyboardScope);
			this.keyboardScopeActive = false;
		}
		if (this.mobileEditorChangeRef) {
			this.app.workspace.offref(this.mobileEditorChangeRef);
			this.mobileEditorChangeRef = null;
		}
		if (this.mobileSyncTimer !== null) {
			window.clearTimeout(this.mobileSyncTimer);
			this.mobileSyncTimer = null;
		}
		this.containerEl.removeClass('wm-spell-mobile-container');
		this.modalEl.removeClass('wm-spell-mobile-sheet');
		this.modalEl.ownerDocument.body.removeClass('wm-spell-mobile-session');
		if (this.isMobileLayout) {
			const editorView = this.getMobileEditorView();
			if (editorView) {
				clearEditorSpellcheckHighlights(editorView);
				if (this.mobileEditorClickHandler) editorView.dom.removeEventListener('click', this.mobileEditorClickHandler);
			}
			this.mobileEditorClickHandler = null;
		}
		this.contentEl.empty();
	}

	private openMobileLayout() {
		this.containerEl.addClass('wm-spell-mobile-container');
		this.modalEl.addClass('wm-spell-mobile-sheet');
		this.modalEl.ownerDocument.body.addClass('wm-spell-mobile-session');
		this.shouldRestoreSelection = false;
		this.mobileEditorText = this.config.editor.getValue();

		this.mobileToolbarEl = this.contentEl.createDiv({ cls: 'wm-spell-mobile-toolbar' });
		this.detailEl = this.contentEl.createDiv({ cls: 'wm-spell-mobile-content' });

		this.mobileEditorChangeRef = this.app.workspace.on('editor-change', editor => {
			if (editor !== this.config.editor) return;
			this.scheduleMobileEditorSync();
		});
		const editorView = this.getMobileEditorView();
		if (editorView) {
			this.mobileEditorClickHandler = event => this.handleMobileEditorErrorClick(event);
			editorView.dom.addEventListener('click', this.mobileEditorClickHandler);
		}

		this.refresh();
		this.setupKeyboard();
		window.requestAnimationFrame(() => this.scrollEditorToOccurrence(this.focusedOccIdx));
	}

	// ── 렌더 ────────────────────────────────────────────────────────────────

	private refresh() {
		if (this.isMobileLayout) {
			this.renderMobile();
			return;
		}
		this.renderPreview();
		this.renderList();
		this.renderDetail();
		this.renderFooter();
	}

	private updateHeaderCount() {
		this.headerCountsEl.empty();
		if (this.isMobileLayout) {
			this.headerCountsEl.createSpan({
				cls: 'wm-spell-header-count',
				text: this.occurrences.length > 0
					? `${this.focusedOccIdx + 1} / ${this.occurrences.length}`
					: '0 / 0',
			});
			return;
		}
		let errorCount = 0, correctedCount = 0;
		this.occStates.forEach(info => {
			if (info.state === 'error') errorCount++;
			else if (info.state !== 'original-kept') correctedCount++;
		});
		this.headerCountsEl.createSpan({ cls: 'wm-spell-header-count', text: `오류 ${errorCount}개` });
		if (correctedCount > 0) {
			this.headerCountsEl.createSpan({ cls: 'wm-spell-header-count', text: `수정 ${correctedCount}개` });
		}
	}

	private renderMobile() {
		this.updateMobileEditorHighlights();
		const currentList = this.detailEl.querySelector<HTMLElement>('.wm-spell-mobile-error-list');
		if (currentList) this.mobileListScrollTop = currentList.scrollTop;
		this.cancelMobileListScroll();
		this.mobileToolbarEl.empty();
		this.detailEl.empty();
		this.renderMobileToolbar();

		const occ = this.occurrences[this.focusedOccIdx];
		const c = this.config.corrections[occ?.corrIdx ?? 0];
		const info = this.occStates.get(this.focusedOccIdx);
		if (!occ || !c || !info) {
			this.detailEl.createDiv({ cls: 'wm-spell-mobile-empty', text: '확인할 오류가 없습니다.' });
			return;
		}
		this.renderMobileNavigator();

		if (this.mobilePanel === 'list') {
			this.renderMobileList();
			return;
		}

		this.renderMobileDetail(c, info);
	}

	private renderMobileNavigator() {
		const row = this.detailEl.createDiv({ cls: 'wm-spell-mobile-navigator-row' });
		const nav = row.createDiv({ cls: 'wm-spell-mobile-navigator' });
		const previous = nav.createEl('button', { attr: { 'aria-label': '이전 오류' } });
		setIcon(previous, 'chevron-left');
		previous.addEventListener('click', () => this.moveFocus(-1));
		const digits = Math.max(2, String(this.occurrences.length).length);
		nav.createSpan({
			cls: 'wm-spell-mobile-navigator-count',
			text: `${String(this.focusedOccIdx + 1).padStart(digits, '0')} / ${this.occurrences.length}`,
		});
		const next = nav.createEl('button', { attr: { 'aria-label': '다음 오류' } });
		setIcon(next, 'chevron-right');
		next.addEventListener('click', () => this.moveFocus(1));
	}

	private renderMobileToolbar() {
		const addAction = (
			icon: string,
			label: string,
			onClick: () => void,
			options: { active?: boolean; disabled?: boolean } = {},
		) => {
			const button = this.mobileToolbarEl.createEl('button', {
				cls: 'wm-spell-mobile-tool',
				attr: { 'aria-label': label, title: label },
			});
			setIcon(button, icon);
			button.toggleClass('is-active', options.active === true);
			button.disabled = options.disabled === true;
			button.addEventListener('click', onClick);
			return button;
		};

		const hasSelection = this.occurrences.length > 0;
		addAction('pencil', '직접 수정', () => this.showEditPopup(this.focusedOccIdx), { disabled: !hasSelection });
		addAction('book-plus', '고유명사 사전에 추가', () => {
			if (!hasSelection) return;
			this.mobilePanel = 'list';
			this.ignoreWord(this.focusedOccIdx);
		}, { disabled: !hasSelection });
		addAction('check-check', '남은 오류 일괄 적용', () => this.confirmApplyRemainingMobile(), { disabled: !hasSelection });
		addAction('circle-help', '사용 방법', () => new SpellcheckMobileGuideModal(this.app).open());
		addAction('log-out', '맞춤법 검사 나가기', () => this.close());
	}

	private renderMobileList() {
		const panel = this.detailEl.createDiv({ cls: 'wm-spell-mobile-panel wm-spell-mobile-list-panel' });
		const list = panel.createDiv({ cls: 'wm-spell-mobile-error-list' });

		this.occurrences.forEach((occurrence, oi) => {
			const correction = this.config.corrections[occurrence.corrIdx];
			const stateInfo = this.occStates.get(oi)!;
			const item = list.createDiv({
				cls: 'wm-spell-list-item wm-spell-mobile-list-item',
				attr: { tabindex: '0', role: 'button', 'aria-label': `${oi + 1}번 오류 상세 열기` },
			});
			if (oi === this.focusedOccIdx) item.addClass('is-focused');
			item.createSpan({ cls: 'wm-spell-num-tag', text: String(oi + 1) });
			const textEl = item.createSpan({ cls: 'wm-spell-list-text' });
			textEl.style.color = STATE_COLORS[stateInfo.state];
			textEl.setText(stateInfo.state === 'error' ? correction.original : stateInfo.value);
			if (stateInfo.state === 'error') appendTypeBadge(item, correction.type);
			else {
				const badge = item.createSpan({ cls: 'wm-spell-type-tag', text: STATE_BADGE_LABELS[stateInfo.state] ?? '' });
				badge.style.color = STATE_COLORS[stateInfo.state];
			}
			const chevron = item.createSpan({ cls: 'wm-spell-mobile-list-chevron' });
			setIcon(chevron, 'chevron-right');
			item.addEventListener('click', () => {
				this.focusedOccIdx = oi;
				this.mobilePanel = 'detail';
				this.refresh();
				window.requestAnimationFrame(() => this.scrollEditorToOccurrence(oi));
			});
		});

		list.scrollTop = this.mobileListScrollTop;
		const focusedItem = list.children[this.focusedOccIdx] as HTMLElement | undefined;
		const shouldCenter = this.mobileCenterFocusedItem;
		this.mobileCenterFocusedItem = false;
		window.requestAnimationFrame(() => {
			if (!focusedItem) return;
			const listRect = list.getBoundingClientRect();
			const itemRect = focusedItem.getBoundingClientRect();
			const itemTop = list.scrollTop + itemRect.top - listRect.top;
			const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
			let targetScrollTop = list.scrollTop;
			if (shouldCenter) {
				const focusAnchor = list.clientHeight * 0.36;
				targetScrollTop = itemTop + itemRect.height / 2 - focusAnchor;
			} else if (itemRect.top < listRect.top) {
				targetScrollTop = itemTop;
			} else if (itemRect.bottom > listRect.bottom) {
				targetScrollTop = itemTop - list.clientHeight + itemRect.height;
			}
			targetScrollTop = Math.max(0, Math.min(maxScrollTop, targetScrollTop));
			if (shouldCenter) this.animateMobileListScroll(list, targetScrollTop);
			else list.scrollTop = targetScrollTop;
		});
	}

	private cancelMobileListScroll() {
		if (this.mobileListScrollFrame === null) return;
		window.cancelAnimationFrame(this.mobileListScrollFrame);
		this.mobileListScrollFrame = null;
	}

	private animateMobileListScroll(list: HTMLElement, targetScrollTop: number) {
		this.cancelMobileListScroll();
		const startScrollTop = list.scrollTop;
		const distance = targetScrollTop - startScrollTop;
		const reduceMotion = list.ownerDocument.defaultView
			?.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
		if (reduceMotion || Math.abs(distance) < 1) {
			list.scrollTop = targetScrollTop;
			this.mobileListScrollTop = targetScrollTop;
			return;
		}

		const duration = Math.min(320, Math.max(160, 150 + Math.abs(distance) * 0.18));
		const startTime = performance.now();
		const animate = (now: number) => {
			if (!list.isConnected) {
				this.mobileListScrollFrame = null;
				return;
			}
			const progress = Math.min(1, (now - startTime) / duration);
			const eased = oneUiScrollEasing(progress);
			const nextScrollTop = startScrollTop + distance * eased;
			list.scrollTop = nextScrollTop;
			this.mobileListScrollTop = nextScrollTop;
			if (progress < 1) this.mobileListScrollFrame = window.requestAnimationFrame(animate);
			else {
				list.scrollTop = targetScrollTop;
				this.mobileListScrollTop = targetScrollTop;
				this.mobileListScrollFrame = null;
			}
		};
		this.mobileListScrollFrame = window.requestAnimationFrame(animate);
	}

	private renderMobileDetail(c: Correction, info: StateInfo) {
		const panel = this.detailEl.createDiv({ cls: 'wm-spell-mobile-panel wm-spell-mobile-detail-panel' });

		const card = panel.createDiv({ cls: 'wm-spell-orig-card wm-spell-mobile-orig-card' });
		const originalRow = card.createDiv({
			cls: 'wm-spell-orig-card-row',
			attr: { tabindex: '0', role: 'button', 'aria-label': '원문 유지' },
		});
		originalRow.createSpan({ cls: 'wm-spell-orig-card-label wm-spell-mobile-keep-label', text: '유지' });
		originalRow.createSpan({ cls: 'wm-spell-orig-card-value wm-spell-orig-card-value--error', text: c.original });
		appendTypeBadge(originalRow, c.type, 'wm-spell-orig-type-tag');
		if (info.state === 'original-kept') originalRow.addClass('is-active');
		originalRow.addEventListener('click', () => {
			this.applyMobileChoice(this.focusedOccIdx, 'original-kept', c.original);
		});

		const primarySuggestion = c.corrected[0] ?? c.original;
		const helpText = (c.help || '').replace(/^도움말\s*[:-]?\s*/i, '').trim();
		const correctionRow = card.createDiv({
			cls: 'wm-spell-orig-card-row',
			attr: { tabindex: '0', role: 'button', 'aria-label': '제안된 표현으로 수정' },
		});
		correctionRow.createSpan({ cls: 'wm-spell-orig-card-label wm-spell-mobile-correct-label', text: '수정' });
		const correctionValue = correctionRow.createSpan({ cls: 'wm-spell-orig-card-value' });
		appendMarkedDisplayText(correctionValue, c.original, primarySuggestion);
		if ((info.state === 'corrected' || info.state === 'user-edited') && info.value === primarySuggestion) {
			correctionRow.addClass('is-active');
		}
		correctionRow.addEventListener('click', () => {
			this.applyMobileChoice(this.focusedOccIdx, 'corrected', primarySuggestion);
		});
		if (helpText) {
			const helpPanel = card.createDiv({ cls: 'wm-spell-mobile-help-panel wm-spell-help' });
			appendMobileHelpText(helpPanel, helpText);
		}

		if (c.corrected.length > 1) {
			const suggestions = panel.createDiv({ cls: 'wm-spell-section' }).createDiv({ cls: 'wm-spell-sug-list wm-spell-mobile-sug-list' });
			c.corrected.forEach((suggestion, index) => {
				const button = suggestions.createDiv({
					cls: 'wm-spell-sug-item',
					attr: { tabindex: '0', role: 'button', 'aria-label': `${index + 1}번 제안 적용` },
				});
				button.createSpan({ cls: 'wm-spell-sug-num', text: String(index + 1) });
				button.createSpan({ text: displayText(c.original, suggestion) });
				if ((info.state === 'corrected' || info.state === 'user-edited') && info.value === suggestion) {
					button.addClass('is-active');
				}
				button.addEventListener('click', () => {
					this.applyMobileChoice(this.focusedOccIdx, 'corrected', suggestion);
				});
			});
		}
	}

	private renderList() {
		this.listEl.empty();

		this.occurrences.forEach((occ, oi) => {
			const c = this.config.corrections[occ.corrIdx];
			const info = this.occStates.get(oi)!;

			const item = this.listEl.createDiv({ cls: 'wm-spell-list-item' });
			if (oi === this.focusedOccIdx) item.addClass('is-focused');

			item.createSpan({ cls: 'wm-spell-num-tag', text: String(oi + 1) });

			const textEl = item.createSpan({ cls: 'wm-spell-list-text' });
			textEl.style.color = STATE_COLORS[info.state];
			textEl.setText(info.state === 'error' ? c.original : info.value);

			if (info.state !== 'error') {
				const tag = item.createSpan({ cls: 'wm-spell-type-tag', text: STATE_BADGE_LABELS[info.state] ?? '' });
				tag.style.color = STATE_COLORS[info.state];
			} else {
				appendTypeBadge(item, c.type);
			}

			item.addEventListener('click', () => {
				this.focusedOccIdx = oi;
				this.refresh();
				window.requestAnimationFrame(() => this.scrollPreviewToOcc(oi));
			});
		});

		(this.listEl.children[this.focusedOccIdx] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
	}

	private renderPreview() {
		this.previewEl.empty();
		const full = this.config.text;
		const bo = this.config.bodyOffset;
		const body = full.substring(bo);

		if (bo > 0) this.previewEl.createSpan({ cls: 'wm-spell-frontmatter', text: full.substring(0, bo) });

		let cursor = 0;
		for (let oi = 0; oi < this.occurrences.length; oi++) {
			const occ = this.occurrences[oi];
			const c = this.config.corrections[occ.corrIdx];
			const info = this.occStates.get(oi)!;
			const { pos } = occ;
			const end = pos + c.original.length;

			if (cursor < pos) this.previewEl.appendChild(activeDocument.createTextNode(body.substring(cursor, pos)));

			const span = this.previewEl.createSpan({ cls: 'wm-spell-error-span' });
			span.setAttribute('data-occ-idx', String(oi));
			span.style.color = STATE_COLORS[info.state];
			if (oi === this.focusedOccIdx) span.addClass('is-focused');
			span.setText(
				info.state !== 'error' && info.value !== c.original
					? displayText(c.original, info.value)
					: c.original
			);
			span.addEventListener('click', () => { this.focusedOccIdx = oi; this.refresh(); });

			cursor = end;
		}

		if (cursor < body.length) this.previewEl.appendChild(activeDocument.createTextNode(body.substring(cursor)));
	}

	private renderDetail() {
		this.detailEl.empty();

		const occ = this.occurrences[this.focusedOccIdx];
		const c = this.config.corrections[occ?.corrIdx ?? 0];
		const info = this.occStates.get(this.focusedOccIdx);

		const mobileNav = this.detailEl.createDiv({ cls: 'wm-spell-mobile-nav' });
		const previousBtn = mobileNav.createEl('button', {
			cls: 'wm-spell-mobile-nav-btn',
			attr: { 'aria-label': '이전 오류' },
		});
		setIcon(previousBtn, 'chevron-left');
		mobileNav.createSpan({
			cls: 'wm-spell-mobile-nav-count',
			text: this.occurrences.length > 0 ? `${this.focusedOccIdx + 1} / ${this.occurrences.length}` : '0 / 0',
		});
		const nextBtn = mobileNav.createEl('button', {
			cls: 'wm-spell-mobile-nav-btn',
			attr: { 'aria-label': '다음 오류' },
		});
		setIcon(nextBtn, 'chevron-right');
		previousBtn.addEventListener('click', () => this.moveFocus(-1));
		nextBtn.addEventListener('click', () => this.moveFocus(1));

		// 고정 영역: 타이틀 + 카드 + 제안
		const fixed = this.detailEl.createDiv({ cls: 'wm-spell-detail-fixed' });
		fixed.createEl('div', { cls: 'wm-spell-panel-title', text: '상세' });

		if (!c || !info) return;

		const isCorrActive = info.state === 'corrected' || info.state === 'user-edited';
		const corrDisplay = isCorrActive ? info.value : (c.corrected[0] ?? c.original);

		const card = fixed.createDiv({ cls: 'wm-spell-orig-card' });

		const origRow = card.createDiv({ cls: 'wm-spell-orig-card-row' });
		origRow.createSpan({ cls: 'wm-spell-orig-card-label', text: '원문' });
		origRow.createSpan({ cls: 'wm-spell-orig-card-value wm-spell-orig-card-value--error', text: c.original });
		appendTypeBadge(origRow, c.type, 'wm-spell-orig-type-tag');
		origRow.addEventListener('click', () => this.applyState(this.focusedOccIdx, 'original-kept', c.original));

		const corrRow = card.createDiv({ cls: 'wm-spell-orig-card-row' });
		corrRow.createSpan({ cls: 'wm-spell-orig-card-label', text: '제안' });
		const corrSpan = corrRow.createSpan({ cls: 'wm-spell-orig-card-value' });
		corrSpan.style.color = isCorrActive ? STATE_COLORS[info.state] : 'var(--color-green)';
		corrSpan.setText(displayText(c.original, corrDisplay));
		corrRow.addEventListener('click', () => this.applyState(this.focusedOccIdx, 'corrected', c.corrected[0] ?? c.original));

		if (c.corrected.length > 0) {
			const sugList = fixed.createDiv({ cls: 'wm-spell-section' }).createDiv({ cls: 'wm-spell-sug-list' });
			c.corrected.forEach((sug, si) => {
				const item = sugList.createDiv({ cls: 'wm-spell-sug-item' });
				if (isCorrActive && info.value === sug) item.addClass('is-active');
				item.createSpan({ cls: 'wm-spell-sug-num', text: String(si + 1) });
				item.createSpan({ text: displayText(c.original, sug) });
				item.addEventListener('click', () => this.applyState(this.focusedOccIdx, 'corrected', sug));
			});
		}

		// 스크롤 영역: 도움말만
		const helpText = (c.help || '').replace(/^도움말\s*[:-]?\s*/i, '').trim();
		if (helpText) {
			const scroll = this.detailEl.createDiv({ cls: 'wm-spell-detail-scroll' });
			scroll.createEl('div', { cls: 'wm-spell-labeled-divider', text: '도움말' });
			scroll.createDiv({ cls: 'wm-spell-section wm-spell-help-section' }).createDiv({ cls: 'wm-spell-help', text: helpText });
		}
	}

	private renderFooter() {
		this.footerEl.empty();
		this.updateHeaderCount();

		const hint = this.footerEl.createDiv({ cls: 'wm-spell-footer-hint' });
		const addKey = (key: string, desc: string) => {
			const group = hint.createSpan({ cls: 'wm-spell-hint-group' });
			key.split('+').forEach((k, i) => {
				if (i > 0) group.createSpan({ cls: 'wm-spell-hint-plus', text: '+' });
				group.createSpan({ cls: 'wm-spell-key', text: k });
			});
			group.appendText(' ' + desc);
		};
		addKey('↑↓', '이동');
		addKey('1-9', '제안');
		addKey('Tab', '상태');
		addKey('Del', '무시');
		addKey('Alt+↵', '적용');

		const applyBtn = this.footerEl.createDiv({ cls: 'wm-spell-apply-btn' });
		setIcon(applyBtn.createSpan(), 'check');
		applyBtn.createSpan({ text: '전체 적용' });
		applyBtn.addEventListener('click', () => this.applyAll());
	}

	// ── 상태 변경 ────────────────────────────────────────────────────────────

	private applyState(oi: number, state: CorrectionState, value: string) {
		if (this.isMobileLayout) {
			this.applyMobileState(oi, state, value);
			return;
		}
		this.occStates.set(oi, { state, value });
		this.refresh();
	}

	private applyMobileState(oi: number, state: CorrectionState, value: string) {
		this.syncMobileEditorText();
		const occ = this.occurrences[oi];
		const info = this.occStates.get(oi);
		if (!occ || !info) return;

		const editor = this.config.editor;
		const fromOffset = this.config.bodyOffset + occ.pos;
		const oldValue = info.value;
		const toOffset = fromOffset + oldValue.length;
		if (oldValue !== value) {
			editor.replaceRange(value, editor.offsetToPos(fromOffset), editor.offsetToPos(toOffset), 'wm-spellcheck');
			const delta = value.length - oldValue.length;
			if (delta !== 0) {
				this.occurrences.forEach((other, otherIdx) => {
					if (otherIdx !== oi && other.pos > occ.pos) other.pos += delta;
				});
			}
		}

		this.occStates.set(oi, { state, value });
		this.mobileEditorText = editor.getValue();
		this.refresh();
		window.requestAnimationFrame(() => this.scrollEditorToOccurrence(oi));
	}

	private applyMobileChoice(oi: number, state: CorrectionState, value: string) {
		this.syncMobileEditorText();
		const occ = this.occurrences[oi];
		const info = this.occStates.get(oi);
		if (!occ || !info) return;

		const editor = this.config.editor;
		const fromOffset = this.config.bodyOffset + occ.pos;
		const oldValue = info.value;
		if (oldValue !== value) {
			editor.replaceRange(
				value,
				editor.offsetToPos(fromOffset),
				editor.offsetToPos(fromOffset + oldValue.length),
				'wm-spellcheck',
			);
			const delta = value.length - oldValue.length;
			if (delta !== 0) {
				this.occurrences.forEach((other, otherIdx) => {
					if (otherIdx !== oi && other.pos > occ.pos) other.pos += delta;
				});
			}
		}

		this.occStates.set(oi, { state, value });
		this.mobileEditorText = editor.getValue();
		this.mobilePanel = 'list';
		this.focusedOccIdx = this.findNextMobileError(oi);
		this.mobileCenterFocusedItem = true;
		this.refresh();
		window.requestAnimationFrame(() => this.scrollEditorToOccurrence(this.focusedOccIdx));
	}

	private findNextMobileError(fromIndex: number): number {
		const count = this.occurrences.length;
		if (count === 0) return 0;
		for (let step = 1; step <= count; step++) {
			const candidate = (fromIndex + step) % count;
			if (this.occStates.get(candidate)?.state === 'error') return candidate;
		}
		return Math.min(fromIndex + 1, count - 1);
	}

	private confirmApplyRemainingMobile() {
		const errorCount = Array.from(this.occStates.values()).filter(info => info.state === 'error').length;
		if (errorCount === 0) {
			new Notice('남은 오류가 없습니다.');
			return;
		}
		new SpellcheckApplyConfirmModal(this.app, errorCount, () => this.applyRemainingMobile()).open();
	}

	private applyRemainingMobile() {
		this.syncMobileEditorText();
		const pending = this.occurrences
			.map((occ, oi) => ({ occ, oi }))
			.filter(({ oi }) => this.occStates.get(oi)?.state === 'error')
			.sort((a, b) => b.occ.pos - a.occ.pos);
		if (pending.length === 0) {
			new Notice('남은 오류가 없습니다.');
			return;
		}

		const editor = this.config.editor;
		let applied = 0;
		for (const { occ, oi } of pending) {
			const info = this.occStates.get(oi);
			const correction = this.config.corrections[occ.corrIdx];
			const replacement = correction?.corrected[0];
			if (!info || !replacement || replacement === info.value) continue;

			const fromOffset = this.config.bodyOffset + occ.pos;
			editor.replaceRange(
				replacement,
				editor.offsetToPos(fromOffset),
				editor.offsetToPos(fromOffset + info.value.length),
				'wm-spellcheck',
			);
			const delta = replacement.length - info.value.length;
			this.occStates.set(oi, { state: 'corrected', value: replacement });
			if (delta !== 0) {
				this.occurrences.forEach((other, otherIdx) => {
					if (otherIdx !== oi && other.pos > occ.pos) other.pos += delta;
				});
			}
			applied++;
		}

		this.mobileEditorText = editor.getValue();
		this.mobilePanel = 'list';
		this.refresh();
		window.requestAnimationFrame(() => this.scrollEditorToOccurrence(this.focusedOccIdx));
		new Notice(`${applied}개 오류를 일괄 적용했습니다.`);
	}

	private handleMobileEditorErrorClick(event: MouseEvent) {
		const target = event.target as HTMLElement | null;
		const marker = target?.closest<HTMLElement>('[data-wm-spell-occurrence]');
		if (!marker) return;
		const oi = Number(marker.dataset.wmSpellOccurrence);
		if (!Number.isInteger(oi) || !this.occurrences[oi]) return;
		this.focusedOccIdx = oi;
		this.mobilePanel = 'detail';
		window.requestAnimationFrame(() => this.refresh());
	}

	private scheduleMobileEditorSync() {
		if (this.mobileSyncTimer !== null) window.clearTimeout(this.mobileSyncTimer);
		this.mobileSyncTimer = window.setTimeout(() => {
			this.mobileSyncTimer = null;
			if (!this.syncMobileEditorText()) return;
			this.refresh();
		}, 80);
	}

	private syncMobileEditorText(): boolean {
		if (!this.isMobileLayout) return false;
		const nextText = this.config.editor.getValue();
		const previousText = this.mobileEditorText;
		if (nextText === previousText) return false;

		let changeStart = 0;
		const shortest = Math.min(previousText.length, nextText.length);
		while (changeStart < shortest && previousText[changeStart] === nextText[changeStart]) changeStart++;

		let previousEnd = previousText.length;
		let nextEnd = nextText.length;
		while (
			previousEnd > changeStart &&
			nextEnd > changeStart &&
			previousText[previousEnd - 1] === nextText[nextEnd - 1]
		) {
			previousEnd--;
			nextEnd--;
		}

		const inserted = nextText.substring(changeStart, nextEnd);
		const delta = (nextEnd - changeStart) - (previousEnd - changeStart);
		const isInsertion = changeStart === previousEnd;

		this.occurrences.forEach((occ, oi) => {
			const info = this.occStates.get(oi);
			if (!info) return;
			const absoluteStart = this.config.bodyOffset + occ.pos;
			const absoluteEnd = absoluteStart + info.value.length;
			const overlaps = isInsertion
				? changeStart >= absoluteStart && changeStart <= absoluteEnd
				: changeStart < absoluteEnd && previousEnd > absoluteStart;

			if (overlaps) {
				const relativeStart = Math.max(0, Math.min(info.value.length, changeStart - absoluteStart));
				const relativeEnd = Math.max(relativeStart, Math.min(info.value.length, previousEnd - absoluteStart));
				const editedValue = info.value.substring(0, relativeStart) + inserted + info.value.substring(relativeEnd);
				this.occStates.set(oi, { state: 'user-edited', value: editedValue });
				if (changeStart < absoluteStart) occ.pos = Math.max(0, changeStart - this.config.bodyOffset);
			} else if (absoluteStart >= previousEnd) {
				occ.pos += delta;
			}
		});

		this.mobileEditorText = nextText;
		return true;
	}

	private cycleState(oi: number) {
		const info = this.occStates.get(oi)!;
		const c = this.config.corrections[this.occurrences[oi].corrIdx];
		const cycle: CorrectionState[] = ['error', 'corrected', 'original-kept', 'user-edited'];
		const curIdx = cycle.indexOf(info.state);
		const next = cycle[(curIdx !== -1 ? curIdx + 1 : 1) % cycle.length];
		if (next === 'user-edited') { this.showEditPopup(oi); return; }
		this.applyState(oi, next, next === 'corrected' ? (c.corrected[0] ?? c.original) : c.original);
	}

	private ignoreWord(oi: number) {
		const word = this.config.corrections[this.occurrences[oi].corrIdx].original;
		const stem = stripKoreanParticle(word);
		const focusedOcc = this.occurrences[this.focusedOccIdx];
		const focusedOrig = this.config.corrections[focusedOcc?.corrIdx ?? -1]?.original ?? '';
		const focusedIsRemoved = matchesIgnoredStem(focusedOrig, stem);

		const newOccs: Occurrence[] = [];
		const newStates = new Map<number, StateInfo>();
		this.occurrences.forEach((occ, oldIdx) => {
			if (matchesIgnoredStem(this.config.corrections[occ.corrIdx].original, stem)) return;
			const newIdx = newOccs.length;
			newOccs.push(occ);
			newStates.set(newIdx, this.occStates.get(oldIdx)!);
		});
		this.occurrences = newOccs;
		this.occStates = newStates;

		this.config.onIgnoredWordAdded?.([stem]);
		new Notice('고유명사 사전에 추가되었습니다.');

		if (this.occurrences.length === 0) { this.close(); return; }

		this.focusedOccIdx = focusedIsRemoved
			? Math.min(oi, this.occurrences.length - 1)
			: Math.max(this.occurrences.indexOf(focusedOcc), 0);

		this.refresh();
	}

	// ── 직접 입력 팝업 ───────────────────────────────────────────────────────

	private closeEditPopup() {
		this.editViewportCleanup?.();
		this.editViewportCleanup = null;
		this.editOverlayEl?.remove();
		this.editOverlayEl = null;
		this.editConfirmFn = null;
	}

	private showEditPopup(oi: number) {
		this.closeEditPopup();

		const c = this.config.corrections[this.occurrences[oi].corrIdx];
		const info = this.occStates.get(oi)!;

		const overlayHost = this.isMobileLayout ? this.containerEl : this.modalEl;
		const overlay = overlayHost.createDiv({
			cls: this.isMobileLayout ? 'wm-spell-edit-overlay wm-spell-mobile-edit-overlay' : 'wm-spell-edit-overlay',
		});
		this.editOverlayEl = overlay;
		if (this.isMobileLayout) {
			const viewWindow = overlay.ownerDocument.defaultView;
			const viewport = viewWindow?.visualViewport;
			const updateViewportBounds = () => {
				const top = viewport?.offsetTop ?? 0;
				const left = viewport?.offsetLeft ?? 0;
				const width = viewport?.width ?? viewWindow?.innerWidth ?? overlay.ownerDocument.documentElement.clientWidth;
				const height = viewport?.height ?? viewWindow?.innerHeight ?? overlay.ownerDocument.documentElement.clientHeight;
				overlay.setCssStyles({
					top: `${top}px`,
					left: `${left}px`,
					width: `${width}px`,
					height: `${height}px`,
				});
			};
			viewport?.addEventListener('resize', updateViewportBounds);
			viewport?.addEventListener('scroll', updateViewportBounds);
			this.editViewportCleanup = () => {
				viewport?.removeEventListener('resize', updateViewportBounds);
				viewport?.removeEventListener('scroll', updateViewportBounds);
			};
			updateViewportBounds();
		}

		const popup = overlay.createDiv({ cls: 'wm-spell-edit-popup' });
		popup.createEl('div', { cls: 'wm-spell-edit-label', text: '직접 수정' });

		const input = popup.createEl('input', { cls: 'wm-spell-edit-input', type: 'text' });
		input.value = info.state === 'user-edited' ? info.value : c.original;

		const btnRow = popup.createDiv({ cls: 'wm-spell-edit-btns' });
		btnRow.createDiv({ cls: 'wm-spell-edit-cancel', text: '취소' }).addEventListener('click', () => this.closeEditPopup());

		const confirm = () => {
			const val = input.value.trim();
			if (!val) return;
			this.closeEditPopup();
			if (this.isMobileLayout) this.applyMobileChoice(oi, 'user-edited', val);
			else this.applyState(oi, 'user-edited', val);
		};
		this.editConfirmFn = confirm;
		btnRow.createDiv({ cls: 'wm-spell-edit-confirm', text: '적용' }).addEventListener('click', confirm);
		input.addEventListener('keydown', e => {
			if (e.key === 'Escape') { e.preventDefault(); this.closeEditPopup(); }
		});
		overlay.addEventListener('click', e => { if (e.target === overlay) this.closeEditPopup(); });

		window.setTimeout(() => {
			input.focus();
			input.select();
			if (this.isMobileLayout) popup.scrollIntoView({ block: 'start' });
		}, 10);
	}

	// ── 전체 교정 적용 ───────────────────────────────────────────────────────

	private applyAll() {
		let text = this.config.text;
		const bo = this.config.bodyOffset;

		const changes: { pos: number; original: string; replacement: string }[] = [];
		this.occurrences.forEach((occ, oi) => {
			const info = this.occStates.get(oi)!;
			const c = this.config.corrections[occ.corrIdx];
			if (info.value !== c.original) changes.push({ pos: bo + occ.pos, original: c.original, replacement: info.value });
		});

		changes.sort((a, b) => b.pos - a.pos);
		for (const { pos, original, replacement } of changes) {
			text = text.substring(0, pos) + replacement + text.substring(pos + original.length);
		}

		this.config.editor.setValue(text);
		new Notice(`${changes.length}개 교정 적용 완료`);
		this.close();
	}

	// ── 키보드 ──────────────────────────────────────────────────────────────

	private setupKeyboard() {
		const scope = this.keyboardScope;
		if (this.isMobileLayout) {
			scope.register([], 'ArrowUp', e => {
				e.preventDefault();
				this.mobileCenterFocusedItem = this.mobilePanel === 'list';
				this.moveFocus(-1);
				this.focusMobileKeyboardTarget();
				return false;
			});
			scope.register([], 'ArrowDown', e => {
				e.preventDefault();
				this.mobileCenterFocusedItem = this.mobilePanel === 'list';
				this.moveFocus(1);
				this.focusMobileKeyboardTarget();
				return false;
			});
			scope.register([], 'ArrowLeft', e => {
				e.preventDefault();
				if (this.mobilePanel === 'detail') {
					this.mobilePanel = 'list';
					this.refresh();
					this.focusMobileKeyboardTarget();
				}
				return false;
			});
			scope.register([], 'ArrowRight', e => {
				e.preventDefault();
				if (this.mobilePanel === 'list' && this.occurrences.length > 0) {
					this.mobilePanel = 'detail';
					this.refresh();
					this.focusMobileKeyboardTarget();
				}
				return false;
			});
			scope.register([], 'Enter', e => {
				e.preventDefault();
				this.activateMobileKeyboardTarget();
				return false;
			});
			scope.register([], 'Tab', e => {
				e.preventDefault();
				this.moveMobileTabFocus(1);
				return false;
			});
			scope.register(['Shift'], 'Tab', e => {
				e.preventDefault();
				this.moveMobileTabFocus(-1);
				return false;
			});
			this.app.keymap.pushScope(scope);
			this.keyboardScopeActive = true;
			return;
		}

		scope.register([], 'ArrowUp', e => { e.preventDefault(); this.moveFocus(-1); return false; });
		scope.register([], 'ArrowDown', e => { e.preventDefault(); this.moveFocus(1); return false; });
		scope.register([], 'Tab', e => {
			e.preventDefault();
			if (this.editOverlayEl) { this.closeEditPopup(); this.moveFocus(1); return false; }
			this.cycleState(this.focusedOccIdx);
			return false;
		});
		scope.register([], 'Delete', e => {
			e.preventDefault();
			if (!this.editOverlayEl) this.ignoreWord(this.focusedOccIdx);
			return false;
		});
		scope.register(['Alt'], 'Enter', e => { e.preventDefault(); this.applyAll(); return false; });
		scope.register([], 'Enter', e => {
			e.preventDefault();
			if (this.editOverlayEl) { this.editConfirmFn?.(); return false; }
			const occ = this.occurrences[this.focusedOccIdx];
			const sug = this.config.corrections[occ?.corrIdx ?? 0]?.corrected[0];
			if (sug) this.applyState(this.focusedOccIdx, 'corrected', sug);
			return false;
		});

		for (let n = 1; n <= 9; n++) {
			scope.register([], String(n), e => {
				e.preventDefault();
				if (this.editOverlayEl) return false;
				const occ = this.occurrences[this.focusedOccIdx];
				const sug = this.config.corrections[occ?.corrIdx ?? 0]?.corrected[n - 1];
				if (sug) this.applyState(this.focusedOccIdx, 'corrected', sug);
				return false;
			});
		}

		this.app.keymap.pushScope(scope);
		this.keyboardScopeActive = true;
	}

	private focusMobileKeyboardTarget() {
		window.requestAnimationFrame(() => {
			const selector = this.mobilePanel === 'list'
				? '.wm-spell-mobile-list-item.is-focused'
				: '.wm-spell-mobile-orig-card .wm-spell-orig-card-row';
			this.detailEl.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
		});
	}

	private activateMobileKeyboardTarget() {
		const active = this.modalEl.ownerDocument.activeElement as HTMLElement | null;
		const actionable = active?.closest<HTMLElement>(
			'.wm-spell-mobile-tool, .wm-spell-mobile-navigator button, .wm-spell-mobile-list-item, .wm-spell-mobile-orig-card-row, .wm-spell-mobile-sug-item',
		);
		if (actionable && this.containerEl.contains(actionable)) {
			actionable.click();
			return;
		}
		if (this.mobilePanel === 'list' && this.occurrences.length > 0) {
			this.mobilePanel = 'detail';
			this.refresh();
			this.focusMobileKeyboardTarget();
			return;
		}
		this.detailEl.querySelector<HTMLElement>('.wm-spell-mobile-correct-label')
			?.closest<HTMLElement>('.wm-spell-orig-card-row')?.click();
	}

	private moveMobileTabFocus(direction: 1 | -1) {
		const selector = [
			'.wm-spell-mobile-tool:not(:disabled)',
			'.wm-spell-mobile-navigator button:not(:disabled)',
			'.wm-spell-mobile-list-item',
			'.wm-spell-mobile-orig-card-row',
			'.wm-spell-mobile-sug-item',
		].join(', ');
		const actions = Array.from(this.containerEl.querySelectorAll<HTMLElement>(selector))
			.filter(element => element.offsetParent !== null);
		if (actions.length === 0) return;
		const active = this.modalEl.ownerDocument.activeElement as HTMLElement | null;
		const currentIndex = active ? actions.indexOf(active) : -1;
		const nextIndex = currentIndex === -1
			? (direction === 1 ? 0 : actions.length - 1)
			: (currentIndex + direction + actions.length) % actions.length;
		actions[nextIndex].focus({ preventScroll: true });
	}

	private scrollPreviewToOcc(oi: number) {
		this.previewEl.querySelector(`[data-occ-idx="${oi}"]`)
			?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	private getMobileEditorView(): EditorView | null {
		// Obsidian's Editor wraps the active CM6 EditorView in the internal `cm` field.
		// @ts-ignore Obsidian does not expose this field in the public Editor type.
		return (this.config.editor.cm as EditorView) ?? null;
	}

	private updateMobileEditorHighlights() {
		const editorView = this.getMobileEditorView();
		if (!editorView) return;
		const documentLength = editorView.state.doc.length;
		setEditorSpellcheckHighlights(editorView, this.occurrences.map((occ, oi) => {
			const info = this.occStates.get(oi)!;
			const from = Math.max(0, Math.min(documentLength, this.config.bodyOffset + occ.pos));
			return {
				from,
				to: Math.max(from, Math.min(documentLength, from + info.value.length)),
				state: info.state,
				focused: oi === this.focusedOccIdx,
				occurrenceIndex: oi,
			};
		}));
	}

	private scrollEditorToOccurrence(oi: number) {
		const occ = this.occurrences[oi];
		const info = this.occStates.get(oi);
		if (!occ || !info) return;
		const editor = this.config.editor;
		const documentLength = editor.getValue().length;
		const fromOffset = Math.max(0, Math.min(documentLength, this.config.bodyOffset + occ.pos));
		const toOffset = Math.max(fromOffset, Math.min(documentLength, fromOffset + info.value.length));
		const from = editor.offsetToPos(fromOffset);
		const to = editor.offsetToPos(toOffset);
		editor.scrollIntoView({ from, to }, true);
		window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
			const editorView = this.getMobileEditorView();
			const coords = editorView?.coordsAtPos(fromOffset);
			if (!editorView || !coords) return;
			const viewport = editorView.scrollDOM.getBoundingClientRect();
			const desiredTop = viewport.top + viewport.height * 0.32;
			const delta = coords.top - desiredTop;
			if (Math.abs(delta) > 4) editorView.scrollDOM.scrollBy({ top: delta, behavior: 'smooth' });
		}));
	}

	private moveFocus(delta: number) {
		if (this.editOverlayEl) return;
		if (this.isMobileLayout) this.syncMobileEditorText();
		const len = this.occurrences.length;
		if (len === 0) return;
		this.focusedOccIdx = (this.focusedOccIdx + delta + len) % len;
		this.refresh();
		window.requestAnimationFrame(() => {
			if (this.isMobileLayout) this.scrollEditorToOccurrence(this.focusedOccIdx);
			else this.scrollPreviewToOcc(this.focusedOccIdx);
		});
	}
}
