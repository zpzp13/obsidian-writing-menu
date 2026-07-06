import { MarkdownView, Notice, setIcon } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type WritingMenuPlugin from '../../main';
import type { RepetitionEntry, RepetitionKind, RepetitionResult } from './types';
import { analyzeText, isMorphAnalysisSupported } from './MorphAnalyzer';
import { downloadGaruAssets, isGaruAssetsDownloaded } from './GaruAssets';
import { classifyTokens } from './analyzer';
import { buildOccurrenceContexts, clipAroundHighlight } from './sentenceContext';
import { loadSynonymDict } from './SynonymDict';
import { saveToVocabNote } from './VocabNote';
import { renderDonutChart, renderBarChart, buildTopSegments } from './DonutChart';
import { KIND_LABEL, KINDS, buildKindStats, renderKindDropdown } from './KindOverview';
import { setEditorRepetitionHighlights, clearEditorRepetitionHighlights } from '../editor/repetitionHighlight';

// 대시보드가 다른 이유(설정 저장, 리프 전환 등)로 재렌더될 때마다 RepetitionSection.render()가
// 처음부터 다시 호출되어 로컬 클로저 상태가 날아간다. 파일 경로 기준 모듈 레벨 캐시로 유지한다.
interface CachedAnalysis {
	filePath: string;
	text: string;
	result: RepetitionResult;
}
let cache: CachedAnalysis | null = null;

export class RepetitionSection {
	static render(container: HTMLElement, plugin: WritingMenuPlugin, compact?: HTMLElement) {
		const root = container.createDiv({ cls: 'wm-rep-root' });
		renderInto(root, plugin, compact);
	}
}

function renderInto(root: HTMLElement, plugin: WritingMenuPlugin, compact?: HTMLElement) {
	root.empty();

	if (!isMorphAnalysisSupported()) {
		root.createDiv({
			cls: 'wm-rep-empty',
			text: '퇴고 매니저는 데스크톱 앱에서만 사용할 수 있습니다.',
		});
		if (compact) compact.classList.add('is-hidden');
		return;
	}

	if (compact) compact.classList.add('is-hidden');

	if (!isGaruAssetsDownloaded(plugin)) {
		renderDownloadPrompt(root, plugin, compact);
		return;
	}

	const view = getLastMarkdownView(plugin);
	const filePath = view?.file?.path;
	if (cache && filePath && cache.filePath === filePath) {
		const statCard = root.createDiv({ cls: 'wm-rep-stat-card' });
		const listEl = root.createDiv({ cls: 'wm-rep-list' });
		renderWithResult(statCard, listEl, cache.result, cache.text, plugin, view.editor, compact);
	} else {
		renderEmptyState(root, plugin, compact);
	}
}

function renderDownloadPrompt(root: HTMLElement, plugin: WritingMenuPlugin, compact?: HTMLElement) {
	root.createDiv({ cls: 'wm-rep-empty', text: '형태소 분석 모델이 아직 없습니다. 처음 한 번만 내려받으면 이후 완전히 오프라인으로 동작합니다. (약 1.4MB)' });
	const btn = root.createEl('button', { cls: 'wm-rep-btn', text: '모델 다운로드' });
	btn.addEventListener('click', () => void (async () => {
		btn.disabled = true;
		const originalText = btn.textContent ?? '';
		try {
			await downloadGaruAssets(plugin, step => btn.setText(step));
			new Notice('형태소 분석 모델을 내려받았습니다.');
			renderInto(root, plugin, compact);
		} catch (e) {
			new Notice(`다운로드 실패: ${e instanceof Error ? e.message : String(e)}`);
			btn.disabled = false;
			btn.setText(originalText);
		}
	})());
}

function getLastMarkdownView(plugin: WritingMenuPlugin): MarkdownView | null {
	// 대시보드는 보통 사이드바에 있어 버튼 클릭 시 "활성 리프"가 사이드바 자신이 되는 경우가 많다.
	const recentLeaf = plugin.app.workspace.getMostRecentLeaf();
	if (recentLeaf?.view instanceof MarkdownView) return recentLeaf.view;
	return plugin.app.workspace.getActiveViewOfType(MarkdownView);
}

function getCmView(editor: import('obsidian').Editor): EditorView | null {
	// @ts-ignore Obsidian의 Editor는 내부적으로 CM6 EditorView를 .cm에 보관한다 (비공식 필드)
	return (editor.cm as EditorView) ?? null;
}

/** 분석 전 상태: 카드에 종속시키지 않고 "동어 반복 분석" 버튼(wm-tasks-add-btn)만 root에 바로 얹는다 */
function renderEmptyState(root: HTMLElement, plugin: WritingMenuPlugin, compact?: HTMLElement) {
	root.empty();

	const body = root.createDiv({ cls: 'wm-rep-stat-empty-body' });
	const analyzeBtn = body.createDiv({ cls: 'wm-tasks-add-btn' });
	analyzeBtn.createSpan({ cls: 'wm-tasks-add-label', text: '동어 반복 분석' });

	analyzeBtn.addEventListener('click', () => void runAnalysis(plugin, root, analyzeBtn, compact));
}

/** 문서를 분석해 캐시에 저장한다. 실패/빈 결과면 Notice를 띄우고 null을 반환한다. */
async function performAnalysis(plugin: WritingMenuPlugin): Promise<{ text: string; result: RepetitionResult; editor: import('obsidian').Editor } | null> {
	const view = getLastMarkdownView(plugin);
	if (!view?.file) { new Notice('활성화된 문서가 없습니다.'); return null; }

	const editor = view.editor;
	const text = editor.getValue();
	if (!text.trim()) { new Notice('분석할 본문이 없습니다.'); return null; }

	const tokens = await analyzeText(text, plugin);
	const result = classifyTokens(tokens, text);
	const total = result.word.length + result.eojeol.length + result.eomi.length;
	if (total === 0) { new Notice('반복된 표현이 없습니다.'); return null; }

	cache = { filePath: view.file.path, text, result };
	return { text, result, editor };
}

async function runAnalysis(plugin: WritingMenuPlugin, root: HTMLElement, btn: HTMLElement, compact?: HTMLElement) {
	const label = btn.querySelector('.wm-tasks-add-label');
	const originalText = label?.textContent ?? '동어 반복 분석';
	if (label) label.textContent = '분석 중…';
	btn.toggleClass('is-disabled', true);
	try {
		const out = await performAnalysis(plugin);
		if (out) {
			root.empty();
			const statCard = root.createDiv({ cls: 'wm-rep-stat-card' });
			const listEl = root.createDiv({ cls: 'wm-rep-list' });
			renderWithResult(statCard, listEl, out.result, out.text, plugin, out.editor, compact);
		}
	} catch (e) {
		new Notice(`분석 실패: ${e instanceof Error ? e.message : String(e)}`);
	} finally {
		if (label) label.textContent = originalText;
		btn.toggleClass('is-disabled', false);
	}
}

function renderWithResult(
	statCard: HTMLElement,
	listEl: HTMLElement,
	result: RepetitionResult,
	docText: string,
	plugin: WritingMenuPlugin,
	editor: import('obsidian').Editor,
	compact?: HTMLElement,
) {
	const total = result.word.length + result.eojeol.length + result.eomi.length;
	if (compact) {
		compact.classList.remove('is-hidden');
		compact.empty();
		compact.createSpan({ cls: 'wm-dash-hdr-compact-num', text: `${total}개` });
	}

	let activeKind: RepetitionKind = KINDS.find(k => result[k].length > 0) ?? 'word';
	// 카드 하나만 동시에 펼쳐지도록 관리 — 다른 카드를 펼치거나 리스트가 바뀌면 이전 하이라이트를 지운다
	const activeDetail: { close: (() => void) | null } = { close: null };

	statCard.empty();
	const header = statCard.createDiv({ cls: 'wm-rep-stat-header' });
	const dropdownSlot = header.createDiv();
	const reanalyzeBtn = header.createEl('button', { cls: 'wm-rep-btn wm-rep-btn-muted wm-rep-reanalyze-btn', text: '분석하기' });
	reanalyzeBtn.addEventListener('click', () => void (async () => {
		const originalText = reanalyzeBtn.textContent ?? '분석하기';
		reanalyzeBtn.disabled = true;
		reanalyzeBtn.setText('분석 중…');
		try {
			const out = await performAnalysis(plugin);
			if (out) renderWithResult(statCard, listEl, out.result, out.text, plugin, out.editor, compact);
		} catch (e) {
			new Notice(`분석 실패: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			reanalyzeBtn.disabled = false;
			reanalyzeBtn.setText(originalText);
		}
	})());

	const renderDropdown = () => {
		dropdownSlot.empty();
		renderKindDropdown(dropdownSlot, activeKind, result, (kind) => {
			activeKind = kind;
			renderDropdown();
			renderBars();
			renderList();
		});
	};

	// ── 2열 개요: 왼쪽 막대그래프(선택된 종류의 상위 반복어), 오른쪽 도넛(단어/어절/어미 비율) ──
	const overview = statCard.createDiv({ cls: 'wm-rep-overview' });
	const barsCol = overview.createDiv({ cls: 'wm-rep-overview-col wm-rep-overview-col-bars' });
	const donutCol = overview.createDiv({ cls: 'wm-rep-overview-col wm-rep-overview-col-donut' });

	const renderBars = () => {
		barsCol.empty();
		const entries = result[activeKind];
		if (entries.length === 0) {
			barsCol.createDiv({ cls: 'wm-rep-empty', text: `반복된 ${KIND_LABEL[activeKind]}이(가) 없습니다.` });
			return;
		}
		renderBarChart(barsCol, buildTopSegments(entries.map(e => ({ stem: e.text, localCount: e.count })), 4));
	};

	const kindStats = buildKindStats(result);
	renderDonutChart(
		donutCol,
		kindStats.map(s => ({ label: s.label, value: s.count })),
		{ centerValue: '반복 표현' },
	);

	const renderList = () => {
		activeDetail.close?.();
		activeDetail.close = null;
		listEl.empty();
		for (const entry of result[activeKind]) {
			renderEntryCard(listEl, entry, activeKind, docText, plugin, editor, activeDetail);
		}
	};

	renderDropdown();
	renderBars();
	renderList();
}

function renderHighlightedText(container: HTMLElement, sentenceText: string, highlightStart: number, highlightEnd: number) {
	container.appendText(sentenceText.slice(0, highlightStart));
	container.createSpan({ cls: 'wm-rep-inline-hl', text: sentenceText.slice(highlightStart, highlightEnd) });
	container.appendText(sentenceText.slice(highlightEnd));
}

function renderEntryCard(
	listEl: HTMLElement,
	entry: RepetitionEntry,
	kind: RepetitionKind,
	docText: string,
	plugin: WritingMenuPlugin,
	editor: import('obsidian').Editor,
	activeDetail: { close: (() => void) | null },
) {
	const card = listEl.createDiv({ cls: 'wm-rep-card' });

	const row = card.createDiv({ cls: 'wm-rep-card-row' });
	const wordGroup = row.createDiv({ cls: 'wm-rep-card-word-group' });
	wordGroup.createDiv({ cls: 'wm-rep-count-badge', text: String(entry.count) });
	wordGroup.createSpan({ cls: 'wm-rep-word', text: kind === 'eomi' ? `─${entry.text}` : entry.text });

	const line2 = row.createDiv({ cls: 'wm-rep-card-line2' });
	const firstCtx = buildOccurrenceContexts(docText, entry.occurrences.slice(0, 1))[0];
	if (firstCtx) {
		const clipped = clipAroundHighlight(firstCtx.sentenceText, firstCtx.highlightStart, firstCtx.highlightEnd, 34);
		renderHighlightedText(line2, clipped.text, clipped.highlightStart, clipped.highlightEnd);
	}

	const saveBtn = row.createDiv({ cls: 'wm-rep-save-btn', attr: { 'aria-label': '단어장에 저장' } });
	setIcon(saveBtn, 'notebook-pen');
	saveBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		void handleSaveToVocab(plugin, entry.text);
	});

	const detail = card.createDiv({ cls: 'wm-rep-detail is-collapsed' });
	let loaded = false;

	const close = () => {
		detail.addClass('is-collapsed');
		card.removeClass('is-expanded');
		const cmView = getCmView(editor);
		if (cmView) clearEditorRepetitionHighlights(cmView);
		if (activeDetail.close === close) activeDetail.close = null;
	};

	card.addEventListener('click', (e) => {
		if ((e.target as HTMLElement).closest('.wm-rep-detail')) return;
		const collapsed = detail.hasClass('is-collapsed');
		if (collapsed) {
			activeDetail.close?.();
			detail.removeClass('is-collapsed');
			card.addClass('is-expanded');
			activeDetail.close = close;
			if (!loaded) {
				loaded = true;
				void populateDetail(detail, entry, docText, plugin, editor);
			}
		} else {
			close();
		}
	});
}

async function handleSaveToVocab(plugin: WritingMenuPlugin, word: string) {
	const notePath = plugin.settings.repetitionVocabNotePath;
	if (!notePath) { new Notice('설정 → 퇴고 매니저에서 단어장 노트를 먼저 지정하세요.'); return; }
	try {
		const outcome = await saveToVocabNote(plugin.app, notePath, word);
		new Notice(outcome === 'added' ? `"${word}"을(를) 단어장에 저장했습니다.` : `"${word}"은(는) 이미 단어장에 있습니다.`);
	} catch (e) {
		new Notice(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
	}
}

async function populateDetail(detail: HTMLElement, entry: RepetitionEntry, docText: string, plugin: WritingMenuPlugin, editor: import('obsidian').Editor) {
	detail.empty();

	// ── 등장 문장 미리보기 (클릭 시 에디터 점프, 반복어는 강조색으로 하이라이트) ──
	const ctxList = detail.createDiv({ cls: 'wm-rep-ctx-list' });
	const contexts = buildOccurrenceContexts(docText, entry.occurrences);
	contexts.forEach((ctx, i) => {
		const item = ctxList.createDiv({ cls: 'wm-rep-ctx-item' });
		item.createDiv({ cls: 'wm-rep-ctx-num', text: String(i + 1) });
		const textEl = item.createDiv({ cls: 'wm-rep-ctx-text' });
		// 한글은 라틴 문자보다 글자폭이 넓어 42자 예산도 한 줄 폭을 쉽게 넘겨 CSS 말줄임이 하이라이트를
		// 다시 잘라먹을 수 있었다. 여유 있게 줄여 한 줄에 실제로 다 들어오도록 한다.
		const clipped = clipAroundHighlight(ctx.sentenceText, ctx.highlightStart, ctx.highlightEnd, 22);
		renderHighlightedText(textEl, clipped.text, clipped.highlightStart, clipped.highlightEnd);
		item.addEventListener('click', (e) => {
			e.stopPropagation();
			const from = editor.offsetToPos(ctx.occurrence.start);
			const to = editor.offsetToPos(ctx.occurrence.end);
			editor.setSelection(from, to);
			editor.scrollIntoView({ from, to }, true);
			editor.focus();
			// 카드를 펼칠 때가 아니라, 이 등장 위치를 직접 클릭했을 때만 해당 한 곳을 인라인 음영 표시한다.
			const cmView = getCmView(editor);
			if (cmView) setEditorRepetitionHighlights(cmView, [{ from: ctx.occurrence.start, to: ctx.occurrence.end }]);
		});
	});

	// ── 단어장(유의어 후보) — 스크롤 영역과 분리해 카드 하단에 고정 ──
	const footer = detail.createDiv({ cls: 'wm-rep-detail-footer' });
	footer.createDiv({ cls: 'wm-rep-vocab-divider', text: '단어장' });
	const dict = await loadSynonymDict(plugin.app, plugin.settings.repetitionVocabNotePath);
	const dictCandidates = dict.get(entry.text);
	if (dictCandidates?.length) {
		renderChipRow(footer, dictCandidates, editor);
	} else {
		footer.createDiv({ cls: 'wm-rep-sense-empty', text: '단어장에 등록된 후보가 없습니다.' });
	}
}

function renderChipRow(container: HTMLElement, words: string[], editor: import('obsidian').Editor) {
	const wrap = container.createDiv({ cls: 'wm-rep-chip-row' });
	for (const word of words) {
		const chip = wrap.createSpan({ cls: 'wm-rep-chip', text: word });
		chip.addEventListener('click', (e) => {
			e.stopPropagation();
			if (!editor.somethingSelected()) { new Notice('먼저 등장 위치를 클릭해 치환할 자리를 선택하세요.'); return; }
			editor.replaceSelection(word);
			editor.focus();
		});
	}
}
