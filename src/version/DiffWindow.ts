import { App, setIcon, Editor, TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { VersionManager } from './manager';
import type { VersionEntry } from './types';
import { computeLineDiff, computeInlineDiff, DIFF_DELETE, DIFF_INSERT } from './diff';

export class DiffWindow {
	private el: HTMLElement;
	private contentEl: HTMLElement;
	private posX = 0;
	private posY = 0;
	private viewMode: 'unified' | 'split' = 'split';
	private entryB: VersionEntry | null = null;
	private allVersions: VersionEntry[] = [];

	constructor(
		private app: App,
		private plugin: WritingMenuPlugin,
		private file: TFile,
		private entryA: VersionEntry,
		private editorOrNull: Editor | null,
		private compareMode: 'current' | 'other' = 'current'
	) {}

	async open() {
		activeDocument.querySelector('.wm-diff-window')?.remove();

		const manager = new VersionManager(this.app, this.plugin);
		const manifest = await manager.getManifest(this.file);
		this.allVersions = manifest.versions.filter(v => v.id !== this.entryA.id);

		if (this.compareMode === 'other' && this.allVersions.length > 0) {
			this.entryB = this.allVersions[0];
		}

		const W = Math.min(760, window.innerWidth * 0.85);
		const H = Math.min(620, window.innerHeight * 0.85);
		this.posX = (window.innerWidth - W) / 2;
		this.posY = (window.innerHeight - H) / 2;

		this.el = activeDocument.body.createDiv({ cls: 'wm-diff-window' });
		this.el.setCssStyles({ transform: `translate(${this.posX}px, ${this.posY}px)` });
		this.el.setCssStyles({ width: `${W}px` });
		this.el.setCssStyles({ height: `${H}px` });

		this.render();
	}

	private render() {
		this.el.empty();

		// ── Window header (drag handle) ───────────────────────────────────
		const header = this.el.createDiv({ cls: 'wm-diff-window-header' });

		const controls = header.createDiv({ cls: 'wm-diff-window-controls' });

		// unified/split toggle
		const splitBtn = controls.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': '분할 보기' } });
		setIcon(splitBtn, this.viewMode === 'split' ? 'columns-2' : 'align-justify');
		splitBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.viewMode = this.viewMode === 'split' ? 'unified' : 'split';
			this.renderContent();
		});

		const closeBtn = controls.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': '닫기' } });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		this.makeDraggable(header);

		// ── Content area ──────────────────────────────────────────────────
		this.contentEl = this.el.createDiv({ cls: 'wm-diff-window-content' });
		this.renderContent();
	}

	private async renderContent() {
		this.contentEl.empty();

		const manager = new VersionManager(this.app, this.plugin);

		// ── Diff content ─────────────────────────────────────────────────
		const diffWrap = this.contentEl.createDiv({ cls: 'wm-diff-panel-body' });

		const loadingEl = diffWrap.createDiv({ cls: 'wm-diff-loading', text: 'diff 계산 중…' });

		try {
			const textA = await manager.readVersion(this.file, this.entryA);
			let textB: string;
			if (this.compareMode === 'current') {
				textB = this.editorOrNull?.getValue() ?? await this.app.vault.read(this.file);
			} else {
				if (!this.entryB) { loadingEl.setText('비교할 버전을 선택하세요.'); return; }
				textB = await manager.readVersion(this.file, this.entryB);
			}

			loadingEl.remove();
			const hunks = computeLineDiff(textA, textB);

			if (hunks.every(h => h.type === 'equal')) {
				diffWrap.createDiv({ cls: 'wm-diff-no-change', text: '두 버전이 동일합니다.' });
				return;
			}

			const labelA = this.entryA.name;
			const labelB = this.compareMode === 'current' ? '본문' : (this.entryB?.name ?? '—');
			if (this.viewMode === 'split') {
				this.renderSplitDiff(diffWrap, hunks, textA, textB, labelA, labelB);
			} else {
				this.renderUnifiedDiff(diffWrap, hunks, textA, textB);
			}
		} catch {
			loadingEl.setText('diff 계산에 실패했습니다.');
		}
	}

	// ── Split (side-by-side) diff ─────────────────────────────────────────

	private renderSplitDiff(container: HTMLElement, hunks: ReturnType<typeof computeLineDiff>, textA: string, textB: string, labelA = 'Base', labelB = 'Compared') {
		const linesA = textA.split('\n');
		const linesB = textB.split('\n');

		const colHeaders = container.createDiv({ cls: 'wm-diff-col-headers' });
		colHeaders.createDiv({ cls: 'wm-diff-col-header', text: labelA });
		colHeaders.createDiv({ cls: 'wm-diff-col-header', text: labelB });

		const scroll = container.createDiv({ cls: 'wm-diff-scroll' });
		const table = scroll.createDiv({ cls: 'wm-diff-table' });

		let equalGroupFlush: (() => void) | null = null;

		const flushEqual = () => {
			if (equalGroupFlush) { equalGroupFlush(); equalGroupFlush = null; }
		};

		for (const hunk of hunks) {
			if (hunk.type === 'equal') {
				const lines = linesA.slice(hunk.aStart, hunk.aStart + hunk.aLines.length);
				if (lines.length <= 4) {
					for (const line of lines) {
						const row = table.createDiv({ cls: 'wm-diff-row wm-diff-equal-row' });
						row.createDiv({ cls: 'wm-diff-cell', text: line });
						row.createDiv({ cls: 'wm-diff-cell', text: line });
					}
				} else {
					const collapsedContainer = table.createDiv();
					const shown = 2;
					// show first 2
					for (let i = 0; i < shown && i < lines.length; i++) {
						const row = collapsedContainer.createDiv({ cls: 'wm-diff-row wm-diff-equal-row' });
						row.createDiv({ cls: 'wm-diff-cell', text: lines[i] });
						row.createDiv({ cls: 'wm-diff-cell', text: lines[i] });
					}
					// collapse row
					const lineCount = lines.length - shown * 2;
					const colRow = collapsedContainer.createDiv({ cls: 'wm-diff-collapse-row' });
					const colBtn = colRow.createEl('button', { cls: 'wm-diff-collapse-btn' });
					setIcon(colBtn.createDiv(), 'chevrons-down-up');
					const colBtnLabel = colBtn.createSpan({ text: `${lineCount}줄 숨김` });
					const hiddenLines = collapsedContainer.createDiv({ cls: 'wm-diff-hidden' });
					for (let i = shown; i < lines.length - shown; i++) {
						const row = hiddenLines.createDiv({ cls: 'wm-diff-row wm-diff-equal-row' });
						row.createDiv({ cls: 'wm-diff-cell', text: lines[i] });
						row.createDiv({ cls: 'wm-diff-cell', text: lines[i] });
					}
					colBtn.addEventListener('click', () => {
						const nowHidden = hiddenLines.hasClass('wm-diff-hidden');
						hiddenLines.toggleClass('wm-diff-hidden', !nowHidden);
						colBtnLabel.textContent = nowHidden ? `${lineCount}줄 접기` : `${lineCount}줄 숨김`;
					});
					// show last 2
					for (let i = Math.max(shown, lines.length - shown); i < lines.length; i++) {
						const row = collapsedContainer.createDiv({ cls: 'wm-diff-row wm-diff-equal-row' });
						row.createDiv({ cls: 'wm-diff-cell', text: lines[i] });
						row.createDiv({ cls: 'wm-diff-cell', text: lines[i] });
					}
				}
				continue;
			}

			if (hunk.type === 'insert') {
				const bLines = linesB.slice(hunk.bStart, hunk.bStart + hunk.bLines.length);
				for (const line of bLines) {
					const row = table.createDiv({ cls: 'wm-diff-row' });
					row.createDiv({ cls: 'wm-diff-cell wm-diff-cell-empty' });
					const cellB = row.createDiv({ cls: 'wm-diff-cell wm-diff-cell-b' });
					cellB.createDiv({ cls: 'wm-diff-line', text: line });
				}
				continue;
			}

			if (hunk.type === 'delete') {
				const aLines = linesA.slice(hunk.aStart, hunk.aStart + hunk.aLines.length);
				for (const line of aLines) {
					const row = table.createDiv({ cls: 'wm-diff-row' });
					const cellA = row.createDiv({ cls: 'wm-diff-cell wm-diff-cell-a' });
					cellA.createDiv({ cls: 'wm-diff-line', text: line });
					row.createDiv({ cls: 'wm-diff-cell wm-diff-cell-empty' });
				}
				continue;
			}

			if (hunk.type === 'replace') {
				const aLines = linesA.slice(hunk.aStart, hunk.aStart + hunk.aLines.length);
				const bLines = linesB.slice(hunk.bStart, hunk.bStart + hunk.bLines.length);
				const maxLen = Math.max(aLines.length, bLines.length);
				for (let i = 0; i < maxLen; i++) {
					const row = table.createDiv({ cls: 'wm-diff-row' });
					const cellA = row.createDiv({ cls: 'wm-diff-cell wm-diff-cell-a' });
					const cellB = row.createDiv({ cls: 'wm-diff-cell wm-diff-cell-b' });
					if (i < aLines.length && i < bLines.length) {
						// inline word diff
						const segs = computeInlineDiff(aLines[i], bLines[i]);
						const lineA = cellA.createDiv({ cls: 'wm-diff-line' });
						const lineB = cellB.createDiv({ cls: 'wm-diff-line' });
						for (const seg of segs) {
							if (seg.op === DIFF_DELETE || seg.op === 0) {
								lineA.createSpan({ cls: seg.op === DIFF_DELETE ? 'wm-diff-word-del' : '', text: seg.text });
							}
							if (seg.op === DIFF_INSERT || seg.op === 0) {
								lineB.createSpan({ cls: seg.op === DIFF_INSERT ? 'wm-diff-word-add' : '', text: seg.text });
							}
						}
					} else if (i < aLines.length) {
						cellA.createDiv({ cls: 'wm-diff-line', text: aLines[i] });
					} else {
						cellB.createDiv({ cls: 'wm-diff-line', text: bLines[i] });
					}
				}
			}
		}
	}

	// ── Unified diff ─────────────────────────────────────────────────────

	private renderUnifiedDiff(container: HTMLElement, hunks: ReturnType<typeof computeLineDiff>, textA: string, textB: string) {
		const linesA = textA.split('\n');
		const linesB = textB.split('\n');
		const scroll = container.createDiv({ cls: 'wm-diff-scroll wm-diff-scroll-unified' });
		const table = scroll.createDiv({ cls: 'wm-diff-table-unified' });

		for (const hunk of hunks) {
			if (hunk.type === 'equal') {
				const lines = linesA.slice(hunk.aStart, hunk.aStart + hunk.aLines.length);
				if (lines.length <= 4) {
					for (const line of lines) {
						const row = table.createDiv({ cls: 'wm-diff-urow wm-diff-urow-eq' });
						row.createSpan({ cls: 'wm-diff-umarker', text: ' ' });
						row.createSpan({ text: line });
					}
				} else {
					const shown = 2;
					for (let i = 0; i < shown && i < lines.length; i++) {
						const row = table.createDiv({ cls: 'wm-diff-urow wm-diff-urow-eq' });
						row.createSpan({ cls: 'wm-diff-umarker', text: ' ' });
						row.createSpan({ text: lines[i] });
					}
					const uLineCount = lines.length - shown * 2;
					const colBtn = table.createEl('button', { cls: 'wm-diff-ucollapse' });
					setIcon(colBtn.createDiv(), 'chevrons-down-up');
					const uBtnLabel = colBtn.createSpan({ text: `${uLineCount}줄 숨김` });
					const hidden = table.createDiv({ cls: 'wm-diff-hidden' });
					for (let i = shown; i < lines.length - shown; i++) {
						const row = hidden.createDiv({ cls: 'wm-diff-urow wm-diff-urow-eq' });
						row.createSpan({ cls: 'wm-diff-umarker', text: ' ' });
						row.createSpan({ text: lines[i] });
					}
					colBtn.addEventListener('click', () => {
						const nowHidden = hidden.hasClass('wm-diff-hidden');
						hidden.toggleClass('wm-diff-hidden', !nowHidden);
						uBtnLabel.textContent = nowHidden ? `${uLineCount}줄 접기` : `${uLineCount}줄 숨김`;
					});
					for (let i = Math.max(shown, lines.length - shown); i < lines.length; i++) {
						const row = table.createDiv({ cls: 'wm-diff-urow wm-diff-urow-eq' });
						row.createSpan({ cls: 'wm-diff-umarker', text: ' ' });
						row.createSpan({ text: lines[i] });
					}
				}
				continue;
			}

			if (hunk.type === 'delete' || hunk.type === 'replace') {
				const aLines = linesA.slice(hunk.aStart, hunk.aStart + hunk.aLines.length);
				for (const line of aLines) {
					const row = table.createDiv({ cls: 'wm-diff-urow wm-diff-urow-del' });
					row.createSpan({ cls: 'wm-diff-umarker', text: '−' });
					row.createSpan({ text: line });
				}
			}

			if (hunk.type === 'insert' || hunk.type === 'replace') {
				const bLines = linesB.slice(hunk.bStart, hunk.bStart + hunk.bLines.length);
				for (const line of bLines) {
					const row = table.createDiv({ cls: 'wm-diff-urow wm-diff-urow-add' });
					row.createSpan({ cls: 'wm-diff-umarker', text: '+' });
					row.createSpan({ text: line });
				}
			}
		}
	}

	// ── Drag ─────────────────────────────────────────────────────────────

	private makeDraggable(handle: HTMLElement) {
		handle.addEventListener('mousedown', (e: MouseEvent) => {
			if ((e.target as HTMLElement).closest('button')) return;
			e.preventDefault();
			const startX = e.clientX - this.posX;
			const startY = e.clientY - this.posY;
			this.el.addClass('wm-diff-window-dragging');

			const onMove = (e: MouseEvent) => {
				this.posX = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - startX));
				this.posY = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - startY));
				this.el.setCssStyles({ transform: `translate(${this.posX}px, ${this.posY}px)` });
			};
			const onUp = () => {
				this.el.removeClass('wm-diff-window-dragging');
				activeDocument.removeEventListener('mousemove', onMove);
				activeDocument.removeEventListener('mouseup', onUp);
			};
			activeDocument.addEventListener('mousemove', onMove);
			activeDocument.addEventListener('mouseup', onUp);
		});
	}

	close() {
		this.el?.remove();
	}
}
