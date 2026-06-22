import { App, Editor, Modal, Notice, Scope, setIcon } from 'obsidian';
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

export interface ModalConfig {
	text: string;
	bodyOffset: number;
	editor: Editor;
	corrections: Correction[];
	onIgnoredWordAdded?: (words: string[]) => void;
}

const STATE_COLORS: Record<CorrectionState, string> = {
	'error': 'var(--color-red)',
	'corrected': 'var(--color-green)',
	'original-kept': 'var(--color-orange)',
	'user-edited': 'var(--color-purple)',
};

const TYPE_BADGE_MAP: Record<string, { label: string; color: string }> = {
	// PNU: correctMethod (1-4)
	'1': { label: '어법', color: '#ee335c' },
	'2': { label: '문맥', color: '#009666' },
	'3': { label: '흔한 실수', color: '#d69e2e' },
	'4': { label: '분석 실패', color: '#495eff' },
	// PNU 구버전 type 문자열
	'SPELL': { label: '맞춤법', color: 'var(--color-red)' },
	'SPACE': { label: '띄어쓰기', color: 'var(--color-orange)' },
	// Daum 영문 타입
	'space': { label: '띄어쓰기', color: 'var(--color-orange)' },
	'spell': { label: '문법', color: 'var(--color-red)' },
	'red': { label: '맞춤법', color: 'var(--color-red)' },
	'green': { label: '띄어쓰기', color: 'var(--color-orange)' },
	'blue': { label: '의심', color: 'var(--color-yellow)' },
	'violet': { label: '통계', color: 'var(--color-purple)' },
	// Daum 한글 타입
	'교체': { label: '교체', color: 'var(--color-red)' },
	'의심': { label: '의심', color: 'var(--color-yellow)' },
	'삽입': { label: '삽입', color: 'var(--color-orange)' },
	'삭제': { label: '삭제', color: 'var(--color-red)' },
	'맞춤법': { label: '맞춤법', color: 'var(--color-red)' },
	'표준어 의심': { label: '의심', color: 'var(--color-yellow)' },
	'비표준어': { label: '비표준', color: 'var(--color-yellow)' },
	'띄어쓰기': { label: '띄어쓰기', color: 'var(--color-orange)' },
	'통계적 교정': { label: '통계', color: 'var(--color-purple)' },
	'doubt': { label: '의심', color: 'var(--color-yellow)' },
	// PNU 폴백
	'pnu': { label: 'PNU', color: 'var(--text-muted)' },
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
	private editOverlayEl: HTMLElement | null = null;
	private editConfirmFn: (() => void) | null = null;

	constructor(app: App, config: ModalConfig) {
		super(app);
		this.config = config;
		this.keyboardScope = new Scope();

		this.modalEl.style.width = '60vw';
		this.modalEl.style.maxWidth = '980px';
		this.modalEl.style.height = '80vh';

		this.buildOccurrences();
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
		this.app.keymap.popScope(this.keyboardScope);
		this.contentEl.empty();
	}

	// ── 렌더 ────────────────────────────────────────────────────────────────

	private refresh() {
		this.renderPreview();
		this.renderList();
		this.renderDetail();
		this.renderFooter();
	}

	private updateHeaderCount() {
		this.headerCountsEl.empty();
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
				requestAnimationFrame(() => this.scrollPreviewToOcc(oi));
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

			if (cursor < pos) this.previewEl.appendChild(document.createTextNode(body.substring(cursor, pos)));

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

		if (cursor < body.length) this.previewEl.appendChild(document.createTextNode(body.substring(cursor)));
	}

	private renderDetail() {
		this.detailEl.empty();

		const occ = this.occurrences[this.focusedOccIdx];
		const c = this.config.corrections[occ?.corrIdx ?? 0];
		const info = this.occStates.get(this.focusedOccIdx);

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
		corrRow.createSpan({ cls: 'wm-spell-orig-card-label', text: '수정' });
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
		const helpText = (c.help || '').replace(/^도움말\s*[:\-]?\s*/i, '').trim();
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
		this.occStates.set(oi, { state, value });
		this.refresh();
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

		if (this.occurrences.length === 0) { new Notice('모든 오류를 처리했습니다.'); this.close(); return; }

		this.focusedOccIdx = focusedIsRemoved
			? Math.min(oi, this.occurrences.length - 1)
			: Math.max(this.occurrences.indexOf(focusedOcc), 0);

		this.refresh();
	}

	// ── 직접 입력 팝업 ───────────────────────────────────────────────────────

	private closeEditPopup() {
		this.editOverlayEl?.remove();
		this.editOverlayEl = null;
		this.editConfirmFn = null;
	}

	private showEditPopup(oi: number) {
		this.closeEditPopup();

		const c = this.config.corrections[this.occurrences[oi].corrIdx];
		const info = this.occStates.get(oi)!;

		const overlay = this.modalEl.createDiv({ cls: 'wm-spell-edit-overlay' });
		this.editOverlayEl = overlay;

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
			this.applyState(oi, 'user-edited', val);
		};
		this.editConfirmFn = confirm;
		btnRow.createDiv({ cls: 'wm-spell-edit-confirm', text: '적용' }).addEventListener('click', confirm);
		input.addEventListener('keydown', e => {
			if (e.key === 'Escape') { e.preventDefault(); this.closeEditPopup(); }
		});
		overlay.addEventListener('click', e => { if (e.target === overlay) this.closeEditPopup(); });

		setTimeout(() => { input.focus(); input.select(); }, 10);
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
	}

	private scrollPreviewToOcc(oi: number) {
		(this.previewEl.querySelector(`[data-occ-idx="${oi}"]`) as HTMLElement | null)
			?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	private moveFocus(delta: number) {
		if (this.editOverlayEl) return;
		const len = this.occurrences.length;
		if (len === 0) return;
		this.focusedOccIdx = (this.focusedOccIdx + delta + len) % len;
		this.refresh();
		requestAnimationFrame(() => this.scrollPreviewToOcc(this.focusedOccIdx));
	}
}
