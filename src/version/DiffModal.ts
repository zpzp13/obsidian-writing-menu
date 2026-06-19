import { App, Modal, TFile, Editor, Notice, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { VersionManager } from './manager';
import { computeLineDiff, computeInlineDiff, DIFF_DELETE, DIFF_INSERT, DIFF_EQUAL } from './diff';
import type { VersionEntry } from './types';
import type { DiffHunk } from './diff';

type VersionOption = VersionEntry | 'current';

export class DiffModal extends Modal {
	private plugin: WritingMenuPlugin;
	private file: TFile;
	private manager: VersionManager;
	private editor: Editor | null;

	private versionA: VersionEntry;
	private versionB: VersionOption;
	private allVersions: VersionEntry[] = [];

	private headerEl!: HTMLElement;
	private diffBodyEl!: HTMLElement;
	private footerEl!: HTMLElement;

	constructor(app: App, plugin: WritingMenuPlugin, file: TFile, versionA: VersionEntry, editor: Editor | null) {
		super(app);
		this.plugin = plugin;
		this.file = file;
		this.manager = new VersionManager(app, plugin);
		this.versionA = versionA;
		this.editor = editor;
		this.versionB = editor ? 'current' : versionA;
	}

	async onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('wm-diff-modal');
		modalEl.addClass('wm-diff-modal-container');

		const manifest = await this.manager.getManifest(this.file);
		this.allVersions = manifest.versions;

		// Fallback if no editor
		if (this.versionB === 'current' && !this.editor && this.allVersions.length > 1) {
			const other = this.allVersions.find(v => v.id !== this.versionA.id);
			if (other) this.versionB = other;
		}

		this.headerEl = contentEl.createDiv({ cls: 'wm-diff-header' });
		this.diffBodyEl = contentEl.createDiv({ cls: 'wm-diff-body' });
		this.footerEl = contentEl.createDiv({ cls: 'wm-diff-footer' });

		this.renderHeader();
		this.renderFooter();
		await this.renderDiff();
	}

	// ── Header ──────────────────────────────────────────────────────────

	private renderHeader() {
		this.headerEl.empty();

		// A selector group
		const aGroup = this.headerEl.createDiv({ cls: 'wm-diff-sel-group' });
		aGroup.createEl('span', { text: 'A (원본)', cls: 'wm-diff-sel-label' });
		const aSelect = aGroup.createEl('select', { cls: 'wm-diff-select' });
		for (const v of this.allVersions) {
			const opt = aSelect.createEl('option', { text: v.name, value: v.id });
			if (v.id === this.versionA.id) opt.selected = true;
		}
		aSelect.addEventListener('change', async () => {
			const found = this.allVersions.find(v => v.id === aSelect.value);
			if (!found) return;
			this.versionA = found;
			this.renderHeader();
			this.renderFooter();
			await this.renderDiff();
		});

		// VS badge
		this.headerEl.createDiv({ cls: 'wm-diff-vs-badge', text: 'vs' });

		// B selector group
		const bGroup = this.headerEl.createDiv({ cls: 'wm-diff-sel-group' });
		bGroup.createEl('span', { text: 'B (비교 대상)', cls: 'wm-diff-sel-label' });
		const bSelect = bGroup.createEl('select', { cls: 'wm-diff-select' });

		if (this.editor) {
			const opt = bSelect.createEl('option', { text: '현재 본문', value: 'current' });
			if (this.versionB === 'current') opt.selected = true;
		}
		for (const v of this.allVersions) {
			if (v.id === this.versionA.id) continue;
			const opt = bSelect.createEl('option', { text: v.name, value: v.id });
			if (this.versionB !== 'current' && this.versionB.id === v.id) opt.selected = true;
		}
		bSelect.addEventListener('change', async () => {
			if (bSelect.value === 'current') {
				this.versionB = 'current';
			} else {
				const found = this.allVersions.find(v => v.id === bSelect.value);
				if (found) this.versionB = found;
			}
			this.renderFooter();
			await this.renderDiff();
		});

		// Swap A↔B button
		if (this.allVersions.length > 1) {
			const swapAB = this.headerEl.createEl('button', { cls: 'wm-diff-swap-ab', attr: { 'aria-label': 'A↔B 교환' } });
			setIcon(swapAB, 'arrow-left-right');
			swapAB.addEventListener('click', async () => {
				if (this.versionB === 'current') return;
				const tmp = this.versionA;
				this.versionA = this.versionB;
				this.versionB = tmp;
				this.renderHeader();
				this.renderFooter();
				await this.renderDiff();
			});
		}
	}

	// ── Footer ──────────────────────────────────────────────────────────

	private renderFooter() {
		this.footerEl.empty();

		const left = this.footerEl.createDiv({ cls: 'wm-diff-footer-left' });

		if (this.versionB === 'current' && this.editor) {
			const restoreBtn = left.createEl('button', { cls: 'wm-diff-restore-btn' });
			const icon = restoreBtn.createSpan();
			setIcon(icon, 'rotate-ccw');
			restoreBtn.createSpan({ text: 'A 버전으로 전체 복원' });
			restoreBtn.addEventListener('click', async () => {
				if (!this.editor) return;
				restoreBtn.disabled = true;
				restoreBtn.querySelector('span:last-child')!.textContent = '복원 중…';
				await this.manager.restoreVersion(this.file, this.versionA, this.editor);
				this.close();
				new Notice(`"${this.versionA.name}"으로 복원했습니다. 현재 내용은 자동 저장되었습니다.`);
			});
		}

		const closeBtn = this.footerEl.createEl('button', { text: '닫기', cls: 'wm-diff-close-btn' });
		closeBtn.addEventListener('click', () => this.close());
	}

	// ── Diff Rendering ──────────────────────────────────────────────────

	private async renderDiff() {
		this.diffBodyEl.empty();

		const loading = this.diffBodyEl.createDiv({ cls: 'wm-diff-loading', text: '비교 중…' });

		const textA = await this.manager.readVersion(this.file, this.versionA);
		let textB: string;
		if (this.versionB === 'current') {
			textB = this.editor ? this.editor.getValue() : '';
		} else {
			textB = await this.manager.readVersion(this.file, this.versionB);
		}

		loading.remove();

		const isBCurrent = this.versionB === 'current';
		const bLabel = isBCurrent ? '현재 본문' : (this.versionB as VersionEntry).name;

		// Col headers
		const colHeaders = this.diffBodyEl.createDiv({ cls: 'wm-diff-col-headers' });
		const hA = colHeaders.createDiv({ cls: 'wm-diff-col-header wm-diff-col-header-a' });
		hA.createEl('span', { cls: 'wm-diff-col-badge wm-diff-col-badge-a', text: 'A' });
		hA.createEl('span', { text: this.versionA.name });

		const hB = colHeaders.createDiv({ cls: 'wm-diff-col-header wm-diff-col-header-b' });
		hB.createEl('span', { cls: 'wm-diff-col-badge wm-diff-col-badge-b', text: 'B' });
		hB.createEl('span', { text: bLabel });

		const scroll = this.diffBodyEl.createDiv({ cls: 'wm-diff-scroll' });

		const hunks = computeLineDiff(textA, textB);
		const hasChanges = hunks.some(h => h.type !== 'equal');

		if (!hasChanges) {
			scroll.createDiv({ cls: 'wm-diff-no-change' });
			scroll.querySelector('.wm-diff-no-change')!.textContent = '두 버전이 동일합니다.';
			return;
		}

		const diffTable = scroll.createDiv({ cls: 'wm-diff-table' });
		for (const hunk of hunks) {
			this.renderHunk(diffTable, hunk, isBCurrent);
		}
	}

	private renderHunk(container: HTMLElement, hunk: DiffHunk, isBCurrent: boolean) {
		if (hunk.type === 'equal') {
			this.renderEqualHunk(container, hunk.aLines);
			return;
		}

		const row = container.createDiv({ cls: 'wm-diff-row' });
		const cellA = row.createDiv({ cls: 'wm-diff-cell wm-diff-cell-a' });
		const cellB = row.createDiv({ cls: 'wm-diff-cell wm-diff-cell-b' });

		const canInline = hunk.type === 'replace' && hunk.aLines.length === hunk.bLines.length;

		// A cell
		if (hunk.aLines.length > 0) {
			const aBlock = cellA.createDiv({ cls: 'wm-diff-block wm-diff-block-del' });
			if (canInline) {
				hunk.aLines.forEach((lineA, i) => {
					const lineEl = aBlock.createDiv({ cls: 'wm-diff-line' });
					this.renderInline(lineEl, computeInlineDiff(lineA, hunk.bLines[i]), 'del');
				});
			} else {
				hunk.aLines.forEach(line => {
					aBlock.createDiv({ cls: 'wm-diff-line', text: line || ' ' });
				});
			}

			// Swap button (A → current)
			if (isBCurrent && this.editor && (hunk.type === 'replace' || hunk.type === 'delete')) {
				const swapBtn = cellA.createEl('button', { cls: 'wm-diff-hunk-swap-btn' });
				setIcon(swapBtn.createSpan(), 'arrow-right');
				swapBtn.createSpan({ text: '이걸로 교체' });
				swapBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.applySwap(hunk);
				});
			}
		} else {
			cellA.addClass('wm-diff-cell-empty');
		}

		// B cell
		if (hunk.bLines.length > 0) {
			const bBlock = cellB.createDiv({ cls: 'wm-diff-block wm-diff-block-add' });
			if (canInline) {
				hunk.bLines.forEach((lineB, i) => {
					const lineEl = bBlock.createDiv({ cls: 'wm-diff-line' });
					this.renderInline(lineEl, computeInlineDiff(hunk.aLines[i], lineB), 'add');
				});
			} else {
				hunk.bLines.forEach(line => {
					bBlock.createDiv({ cls: 'wm-diff-line', text: line || ' ' });
				});
			}
		} else {
			cellB.addClass('wm-diff-cell-empty');
		}
	}

	private renderInline(lineEl: HTMLElement, segs: { op: number; text: string }[], side: 'del' | 'add') {
		const keepOp = side === 'del' ? DIFF_DELETE : DIFF_INSERT;
		for (const seg of segs) {
			if (seg.op === DIFF_EQUAL || seg.op === keepOp) {
				const span = lineEl.createEl('span');
				span.textContent = seg.text || '';
				if (seg.op === keepOp) {
					span.addClass(side === 'del' ? 'wm-diff-word-del' : 'wm-diff-word-add');
				}
			}
		}
		if (lineEl.childNodes.length === 0) lineEl.textContent = ' ';
	}

	private applySwap(hunk: DiffHunk) {
		if (!this.editor) return;
		const editor = this.editor;

		if (hunk.type === 'delete') {
			const insertPos = { line: hunk.bStart, ch: 0 };
			editor.replaceRange(hunk.aLines.join('\n') + '\n', insertPos, insertPos);
		} else {
			const from = { line: hunk.bStart, ch: 0 };
			const lastLine = hunk.bStart + hunk.bLines.length - 1;
			const to = { line: lastLine, ch: editor.getLine(lastLine)?.length ?? 0 };
			editor.replaceRange(hunk.aLines.join('\n'), from, to);
		}

		new Notice('교체했습니다.');
		void this.renderDiff();
	}

	private renderEqualHunk(container: HTMLElement, lines: string[]) {
		const CONTEXT = 3;

		if (lines.length <= CONTEXT * 2 + 1) {
			for (const line of lines) this.renderEqualRow(container, line);
			return;
		}

		for (let i = 0; i < CONTEXT; i++) this.renderEqualRow(container, lines[i]);

		// Collapse row
		const collapseRow = container.createDiv({ cls: 'wm-diff-collapse-row' });
		const collapseCount = lines.length - CONTEXT * 2;
		const colBtnA = collapseRow.createEl('button', { cls: 'wm-diff-collapse-btn' });
		setIcon(colBtnA.createSpan(), 'chevrons-down-up');
		colBtnA.createSpan({ text: `공통 ${collapseCount}줄` });
		const colBtnB = collapseRow.createEl('button', { cls: 'wm-diff-collapse-btn' });
		setIcon(colBtnB.createSpan(), 'chevrons-down-up');
		colBtnB.createSpan({ text: `공통 ${collapseCount}줄` });

		const hiddenRows: HTMLElement[] = [];
		for (let i = CONTEXT; i < lines.length - CONTEXT; i++) {
			const row = container.createDiv({ cls: 'wm-diff-row wm-diff-equal-row wm-diff-hidden' });
			row.createDiv({ cls: 'wm-diff-cell', text: lines[i] || ' ' });
			row.createDiv({ cls: 'wm-diff-cell', text: lines[i] || ' ' });
			hiddenRows.push(row);
		}

		const expand = () => {
			collapseRow.remove();
			hiddenRows.forEach(r => r.classList.remove('wm-diff-hidden'));
		};
		colBtnA.addEventListener('click', expand);
		colBtnB.addEventListener('click', expand);

		for (let i = lines.length - CONTEXT; i < lines.length; i++) this.renderEqualRow(container, lines[i]);
	}

	private renderEqualRow(container: HTMLElement, line: string) {
		const row = container.createDiv({ cls: 'wm-diff-row wm-diff-equal-row' });
		row.createDiv({ cls: 'wm-diff-cell', text: line || ' ' });
		row.createDiv({ cls: 'wm-diff-cell', text: line || ' ' });
	}

	onClose() {
		this.contentEl.empty();
	}
}
