import { setIcon, TFile, TFolder, normalizePath, Modal } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { PlotProject, PlotLine, PlotScene, PlotEpisode, PlotCharacter } from './PlotTypes';
import type { SymbolOption } from '../types';
import { CellSelection, newId } from './PlotTypes';
import { CharacterNoteModal } from './CharacterNoteModal';
import { FolderSuggestModal, NoteSuggestModal } from '../wiki/WikiModals';
import { attachWikilinkAutocomplete, renderWithWikilinks } from './WikilinkHelper';
import { getToneColor } from '../wiki/WikiTypes';
import { addOutsideClickListener, openChapterSearchPopup } from './PlotUtils';
import { fireAndForget } from '../utils/asyncUtils';

interface Layout1Callbacks {
	onSave(): void;
	onCellSelect(selection: CellSelection): void;
	onPageChange?(): void;
	onHiddenCharsChange?(hidden: Set<string>): void;
	onUndoRedoChange?(canUndo: boolean, canRedo: boolean): void;
	onBeforeTrash?(path: string): void;
}

interface GridCell {
	el: HTMLElement;
	r: number;
	c: number;
	rowKind: 'plotLine' | 'char';
	rowId: string;
	sceneId: string;
}

type FormatFields = {
	rowHeight?: number;
	fontSize?: number;
	fontColor?: string;
	fontColorDark?: string;
	bgColor?: string;
	bgColorDark?: string;
};

class DeleteCharConfirmModal extends Modal {
	constructor(
		app: import('obsidian').App,
		private charName: string,
		private filePath: string,
		private onConfirm: () => void,
	) { super(app); }

	onOpen() {
		this.titleEl.setText('캐릭터 삭제');
		this.contentEl.createEl('p', { text: `"${this.charName}" 캐릭터와 연결된 노트 파일을 함께 삭제할까요?` });
		this.contentEl.createEl('p', { text: `파일: ${this.filePath}`, cls: 'wm-delete-confirm-path' });
		const btns = this.contentEl.createDiv({ cls: 'modal-button-container' });
		btns.createEl('button', { text: '취소' }).addEventListener('click', () => this.close());
		const ok = btns.createEl('button', { text: '삭제', cls: 'mod-warning' });
		ok.addEventListener('click', () => { this.close(); this.onConfirm(); });
	}

	onClose() { this.contentEl.empty(); }
}

// ─────────────────────────────────────────────────────────────────────────────

export class Layout1Grid {
	private wrapper: HTMLElement;
	private cellGrid: (GridCell | null)[][] = [];
	private selectedCell: GridCell | null = null;
	private scenes: PlotScene[] = [];
	private charTbodyRows: HTMLElement[] = [];
	private charsTbody: HTMLTableSectionElement | null = null;
	private lastReorderedCol = -1;
	private chapterPage = 0;
	private readonly CHAPTERS_PER_PAGE = 25;
	private visibleEps: PlotEpisode[] = [];
	private fmtHistory = new Map<string, { undo: FormatFields[], redo: FormatFields[] }>();
	private charGridRowMap = new Map<string, number>();
	private charDomOrderedRows: number[] = [];
	private plotRowCount = 0;
	private plotSortedLines: PlotLine[] = [];
	private _rendering = false;
	private scrollRafId: number | null = null;
	private reorderRafId: number | null = null;
	private sectionEl: HTMLElement | null = null; // cached .wm-plot-section ancestor
	private structUndoStack: string[] = [];
	private structRedoStack: string[] = [];
	private readonly STRUCT_UNDO_MAX = 20;

	constructor(
		container: HTMLElement,
		private project: PlotProject,
		private plugin: WritingMenuPlugin,
		private callbacks: Layout1Callbacks,
		private hiddenCharIds: Set<string> = new Set<string>(),
	) {
		this.wrapper = container.createDiv({ cls: 'wm-plot-table-wrapper' });
		this.wrapper.setAttribute('tabindex', '-1');
		this.wrapper.addEventListener('keydown', this.onKeydown);
		// Cache the scroll container once — closest() traversal on every keypress is wasteful
		requestAnimationFrame(() => {
			this.sectionEl = this.wrapper.closest<HTMLElement>('.wm-plot-section');
		});
	}

	render() {
		// Guard against re-entrant calls (e.g. blur fires synchronously when wrapper.empty() removes focused textarea)
		if (this._rendering) return;
		this._rendering = true;

		// Wrap everything so _rendering is ALWAYS reset — even if renderThead/renderPlotTbody/
		// renderCharTbody throws. Without this, a single exception permanently blocks future renders
		// (callers like scrollToChapter update the page label but cells never rebuild).
		try {
			// Cancel stale RAFs before clearing DOM — prevents detached-element scrollIntoView
			// or visibility updates from firing after the DOM is rebuilt for a different page.
			if (this.scrollRafId !== null) { cancelAnimationFrame(this.scrollRafId); this.scrollRafId = null; }
			if (this.reorderRafId !== null) { cancelAnimationFrame(this.reorderRafId); this.reorderRafId = null; }

			// Preserve selection before clearing
			const prevSelected = this.selectedCell
				? { rowKind: this.selectedCell.rowKind, rowId: this.selectedCell.rowId, sceneId: this.selectedCell.sceneId }
				: null;

			// Save scroll BEFORE empty() — emptying the wrapper shrinks scrollable content to zero,
			// causing the browser to clamp scrollTop/scrollLeft to 0 before content is rebuilt.
			const section = this.sectionEl;
			const savedScrollTop = section?.scrollTop ?? 0;
			const savedScrollLeft = section?.scrollLeft ?? 0;

			this.wrapper.empty();
			this.cellGrid = [];
			this.selectedCell = null;
			this.charTbodyRows = [];
			this.charsTbody = null;
			this.lastReorderedCol = -1;

			const { visibleEps, scenes } = this.getPageScenes();
			this.visibleEps = visibleEps;
			this.scenes = scenes;

			const table = this.wrapper.createEl('table', { cls: 'wm-plot-table wm-plot-grid-lines' });

			this.renderThead(table);
			this.renderPlotTbody(table);
			this.plotRowCount = this.cellGrid.length;

			if (this.project.characters.length > 0) {
				this.renderCharDivider(table);
				this.charGridRowMap.clear();
				this.renderCharTbody(table);
				this.updateCharDomOrder();
			}

			// Restore selection BEFORE scroll — applySelection may unhide rows (hidden chars
			// temporarily visible), which changes the scrollable height. Restoring scroll before
			// unhiding would cause the browser to clamp scrollTop to the reduced height.
			if (prevSelected) {
				for (const row of this.cellGrid) {
					if (!row) continue;
					for (const cell of row) {
						if (!cell) continue;
						if (cell.rowKind === prevSelected.rowKind && cell.rowId === prevSelected.rowId && cell.sceneId === prevSelected.sceneId) {
							this.applySelection(cell, false);
							// Restore scroll AFTER selection so any newly-visible rows are in the DOM
							if (section) { section.scrollTop = savedScrollTop; section.scrollLeft = savedScrollLeft; }
							requestAnimationFrame(() => this.applyPinnedSticky());
							return;
						}
					}
				}
			}
			// Selection not found (e.g. deleted character row) — still restore scroll
			if (section) { section.scrollTop = savedScrollTop; section.scrollLeft = savedScrollLeft; }
			requestAnimationFrame(() => this.applyPinnedSticky());
		} finally {
			this._rendering = false;
		}
	}

	refreshPinnedSticky() {
		requestAnimationFrame(() => this.applyPinnedSticky());
	}

	private applyPinnedSticky() {
		// Clear sticky-top only from tds that had it previously applied (avoids full grid traversal)
		Array.from(this.wrapper.querySelectorAll<HTMLElement>('tbody td'))
			.filter(td => td.style.top !== '')
			.forEach(td => {
				td.style.removeProperty('top');
				td.style.removeProperty('z-index');
				if (!td.classList.contains('wm-plot-sticky-col')) {
					td.classList.remove('wm-plot-sticky-td');
				}
			});

		const thead = this.wrapper.querySelector('thead');
		let offset = thead ? thead.offsetHeight : 112;
		const pinnedRows = Array.from(this.wrapper.querySelectorAll<HTMLElement>('tbody tr.wm-plot-row-pinned'));
		for (const row of pinnedRows) {
			const cells = Array.from(row.querySelectorAll('td'));
			cells.forEach((td: HTMLElement, i: number) => {
				td.classList.add('wm-plot-sticky-td');
				td.style.top = `${offset}px`;
				td.style.zIndex = i === 0 ? '6' : '5';
			});
			offset += row.offsetHeight;
		}
	}

	private handlePinToggle(lineId: string) {
		const line = this.project.plotLines.find(l => l.id === lineId);
		if (!line) return;
		line.pinned = !line.pinned;
		this.callbacks.onSave();

		const plotTbody = this.wrapper.querySelector('tbody.wm-plot-tbody');
		if (!plotTbody) { this.render(); return; }

		const tr = plotTbody.querySelector(`tr[data-line-id="${lineId}"]`);
		if (!tr) { this.render(); return; }

		tr.toggleClass('wm-plot-row-pinned', !!line.pinned);
		tr.querySelectorAll('.wm-plot-pin-btn').forEach(btn => {
			(btn as HTMLElement).toggleClass('is-pinned', !!line.pinned);
			btn.setAttribute('title', line.pinned ? '고정 해제' : '고정');
		});

		// New sorted order after toggle
		const newSortedLines = [...this.project.plotLines].sort((a, b) =>
			(a.pinned ? 0 : 1) - (b.pinned ? 0 : 1)
		);

		// Re-sort DOM rows
		const allRows = Array.from(plotTbody.querySelectorAll<HTMLElement>('tr[data-line-id]'));
		allRows.sort((a, b) =>
			newSortedLines.findIndex(l => l.id === a.dataset.lineId) -
			newSortedLines.findIndex(l => l.id === b.dataset.lineId)
		);
		allRows.forEach(r => plotTbody.appendChild(r));

		// Rebuild cellGrid plot rows to match new DOM order
		const lineToGridRow = new Map<string, (GridCell | null)[]>();
		this.plotSortedLines.forEach((l, i) => {
			lineToGridRow.set(l.id, this.cellGrid[i] ?? []);
		});
		const charRows = this.cellGrid.slice(this.plotRowCount);
		const newPlotRows = newSortedLines.map(l => lineToGridRow.get(l.id) ?? []);
		this.cellGrid = [...newPlotRows, ...charRows];

		// Update GridCell.r values to reflect new positions
		newPlotRows.forEach((row, newR) => {
			if (row) row.forEach(cell => { if (cell) cell.r = newR; });
		});

		// Update selectedCell.r if it pointed to a plot row that moved
		if (this.selectedCell && this.selectedCell.r < this.plotRowCount) {
			const selLine = this.plotSortedLines[this.selectedCell.r];
			if (selLine) {
				const newR = newSortedLines.findIndex(l => l.id === selLine.id);
				if (newR >= 0) this.selectedCell = { ...this.selectedCell, r: newR };
			}
		}
		this.plotSortedLines = newSortedLines;

		requestAnimationFrame(() => this.applyPinnedSticky());
	}

	getTableEl(): HTMLElement { return this.wrapper; }

	clearGridSelection() {
		if (!this.selectedCell) return;
		this.selectedCell.el.classList.remove('is-selected');
		this.selectedCell = null;
		this.callbacks.onCellSelect?.(null);
	}

	// ── Thead ────────────────────────────────────────────────────────────────

	private renderThead(table: HTMLTableElement) {
		const scenes = this.scenes;
		const thead = table.createEl('thead');

		// Pre-compute last chapter/scene for add buttons
		const lastChapterIds = new Set<string>();
		const lastSceneIds = new Set<string>();
		for (const ep of this.visibleEps) {
			if (ep.chapters.length > 0) {
				lastChapterIds.add(ep.chapters[ep.chapters.length - 1].id);
			}
			for (const ch of ep.chapters) {
				if (ch.scenes.length > 0) {
					lastSceneIds.add(ch.scenes[ch.scenes.length - 1].id);
				}
			}
		}

		// ── Row 1: Episodes ──
		const epRow = thead.createEl('tr');
		epRow.createEl('th', {
			attr: { rowspan: '3' },
			cls: 'wm-plot-sticky-col wm-plot-corner-cell',
			text: '플롯 라인',
		});

		for (const ep of this.visibleEps) {
			const chCount = ep.chapters.length === 0
				? 1
				: ep.chapters.reduce((s, ch) => s + Math.max(ch.scenes.length, 1), 0);
			const th = epRow.createEl('th', { attr: { colspan: String(chCount) }, cls: 'wm-plot-ep-header' });

			// Centered content block (absolute actions don't affect centering)
			const epContent = th.createDiv({ cls: 'wm-plot-ep-content' });
			epContent.createEl('span', { text: ep.name, cls: 'wm-plot-ep-name' });
			if (ep.subtitle) {
				epContent.createEl('span', { text: ep.subtitle, cls: 'wm-plot-ep-subtitle' });
			}

			const epAct = th.createDiv({ cls: 'wm-plot-actions' });
			// Subtitle edit
			const subBtn = epAct.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '소제목 편집' } });
			setIcon(subBtn, 'pencil');
			subBtn.addEventListener('click', (e) => { e.stopPropagation(); this.openSubtitleInput(ep, subBtn); });
			// Add episode button on last visible episode of current page
			if (ep === this.visibleEps[this.visibleEps.length - 1]) {
				const addEpBtn = epAct.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '에피소드 추가' } });
				setIcon(addEpBtn, 'plus');
				addEpBtn.addEventListener('click', (e) => { e.stopPropagation(); this.addEpisodeAfter(ep.id); });
			}
			const delEpBtn = epAct.createEl('button', { cls: 'wm-plot-act-btn wm-plot-act-del', attr: { title: '에피소드 삭제' } });
			setIcon(delEpBtn, 'x');
			delEpBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteEpisode(ep.id); });
		}
		// If no episodes, add a styled episode header with a visible add button
		if (this.project.episodes.length === 0) {
			const th = epRow.createEl('th', { cls: 'wm-plot-ep-header' });
			const epAct = th.createDiv({ cls: 'wm-plot-actions', attr: { style: 'opacity:1;pointer-events:auto;' } });
			const btn = epAct.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '에피소드 추가' } });
			setIcon(btn, 'plus');
			btn.addEventListener('click', () => this.addEpisode());
		}

		// ── Row 2: Chapters ──
		const chRow = thead.createEl('tr');
		for (const ep of this.visibleEps) {
			if (ep.chapters.length === 0) {
				chRow.createEl('th', { cls: 'wm-plot-ch-empty' });
			} else {
				for (const ch of ep.chapters) {
					const scCount = Math.max(ch.scenes.length, 1);
					const th = chRow.createEl('th', { attr: { colspan: String(scCount), 'data-ch-id': ch.id }, cls: 'wm-plot-ch-header' });
					th.createSpan({ text: ch.name, cls: 'wm-plot-header-text' });
					const chAct = th.createDiv({ cls: 'wm-plot-actions' });
					// Add chapter only on last chapter of this episode
					if (lastChapterIds.has(ch.id)) {
						const addChBtn = chAct.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '회차 추가' } });
						setIcon(addChBtn, 'plus');
						addChBtn.addEventListener('click', (e) => { e.stopPropagation(); this.addChapter(ep.id); });
					}
					const delChBtn = chAct.createEl('button', { cls: 'wm-plot-act-btn wm-plot-act-del', attr: { title: '회차 삭제' } });
					setIcon(delChBtn, 'x');
					delChBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteChapter(ep.id, ch.id); });
				}
			}
		}
		if (this.project.episodes.length === 0) chRow.createEl('th', { cls: 'wm-plot-ch-header' });

		// ── Row 3: Scenes ──
		const scRow = thead.createEl('tr');
		for (const sc of scenes) {
			const th = scRow.createEl('th', { cls: 'wm-plot-sc-header' });
			th.dataset['sceneId'] = sc.id;
			th.createSpan({ text: sc.name, cls: 'wm-plot-header-text' });
			const scAct = th.createDiv({ cls: 'wm-plot-actions' });
			// Add scene only on last scene of its chapter
			if (lastSceneIds.has(sc.id)) {
				const addScBtn = scAct.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '장면 추가' } });
				setIcon(addScBtn, 'plus');
				addScBtn.addEventListener('click', (e) => { e.stopPropagation(); this.addSceneForScene(sc.id); });
			}
			const delScBtn = scAct.createEl('button', { cls: 'wm-plot-act-btn wm-plot-act-del', attr: { title: '장면 삭제' } });
			setIcon(delScBtn, 'x');
			delScBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteScene(sc.id); });
		}
		if (scenes.length === 0) scRow.createEl('th', { cls: 'wm-plot-sc-header', text: '(장면 없음)' });
	}

	// ── Plot line tbody ───────────────────────────────────────────────────────

	private renderPlotTbody(table: HTMLTableElement) {
		const scenes = this.scenes;
		const tbody = table.createEl('tbody', { cls: 'wm-plot-tbody' });

		let rowIdx = this.cellGrid.length;

		// Pinned rows first (preserving original relative order), then unpinned
		const sortedLines = [...this.project.plotLines].sort((a, b) =>
			(a.pinned ? 0 : 1) - (b.pinned ? 0 : 1)
		);
		this.plotSortedLines = sortedLines;

		for (const line of sortedLines) {
			this.cellGrid[rowIdx] = [];
			const tr = tbody.createEl('tr');
			tr.dataset.lineId = line.id;
			if (line.pinned) tr.addClass('wm-plot-row-pinned');
			this.applyLineStyle(line, tr);

			const labelTd = tr.createEl('td', { cls: 'wm-plot-sticky-col' });

			if (line.collapsed) {
				// Compact collapsed label: always-visible expand icon + name only
				const labelInner = labelTd.createDiv({ cls: 'wm-plot-label wm-plot-line-label wm-plot-label-compact' });
				const expandBtn = labelInner.createEl('button', {
					cls: 'wm-plot-act-btn wm-plot-expand-btn',
					attr: { title: '펼치기' },
				});
				setIcon(expandBtn, 'eye-off');
				expandBtn.addEventListener('click', () => {
					line.collapsed = false;
					this.callbacks.onSave();
					this.render();
				});
				// Pin button in collapsed row
				const pinBtnC = labelInner.createEl('button', {
					cls: 'wm-plot-act-btn wm-plot-pin-btn' + (line.pinned ? ' is-pinned' : ''),
					attr: { title: line.pinned ? '고정 해제' : '고정' },
				});
				setIcon(pinBtnC, 'pin');
				pinBtnC.addEventListener('click', () => {
					this.handlePinToggle(line.id);
				});
				const nameSpan = labelInner.createEl('span', { text: line.name, cls: 'wm-plot-line-name' });
				nameSpan.setAttribute('contenteditable', 'true');
				nameSpan.setAttribute('spellcheck', 'false');
				nameSpan.addEventListener('blur', () => {
					line.name = nameSpan.textContent?.trim() || line.name;
					this.callbacks.onSave();
				});
				nameSpan.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') { e.preventDefault(); nameSpan.blur(); }
				});

				tr.createEl('td', { attr: { colspan: String(Math.max(scenes.length, 1)) } })
					.addClass('wm-plot-collapsed-row');
				rowIdx++;
				continue;
			}

			const labelInner = labelTd.createDiv({ cls: 'wm-plot-label wm-plot-line-label' });
			const nameSpan = labelInner.createEl('span', { text: line.name, cls: 'wm-plot-line-name' });
			nameSpan.setAttribute('contenteditable', 'true');
			nameSpan.setAttribute('spellcheck', 'false');
			nameSpan.addEventListener('blur', () => {
				line.name = nameSpan.textContent?.trim() || line.name;
				this.callbacks.onSave();
			});
			nameSpan.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') { e.preventDefault(); nameSpan.blur(); }
			});

			// Row 1: [pin][eye][format]
			const labelAct = labelInner.createDiv({ cls: 'wm-plot-label-actions' });
			const pinBtn = labelAct.createEl('button', {
				cls: 'wm-plot-act-btn wm-plot-pin-btn' + (line.pinned ? ' is-pinned' : ''),
				attr: { title: line.pinned ? '고정 해제' : '고정' },
			});
			setIcon(pinBtn, 'pin');
			pinBtn.addEventListener('click', () => {
				this.handlePinToggle(line.id);
			});
			const collapseBtn = labelAct.createEl('button', {
				cls: 'wm-plot-act-btn wm-plot-collapse-btn',
				attr: { title: '접기' },
			});
			setIcon(collapseBtn, 'eye');
			collapseBtn.addEventListener('click', () => {
				line.collapsed = true;
				this.callbacks.onSave();
				this.render();
			});
			const fmtBtn = labelAct.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '서식' } });
			setIcon(fmtBtn, 'settings');
			fmtBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.openFormatPopup(
					fmtBtn,
					() => ({
						rowHeight: line.rowHeight, fontSize: line.fontSize,
						fontColor: line.fontColor, fontColorDark: line.fontColorDark,
						bgColor: line.color, bgColorDark: line.colorDark,
					}),
					(f) => {
						line.rowHeight = f.rowHeight;
						line.fontSize = f.fontSize;
						line.fontColor = f.fontColor;
						line.fontColorDark = f.fontColorDark;
						line.color = f.bgColor;
						line.colorDark = f.bgColorDark;
						this.applyLineStyle(line, tr);
						this.callbacks.onSave();
					},
					'wm-plot-line-fmt-popup',
					line.id,
				);
			});

			// Row 2: [↑][↓][delete]
			const labelAct2 = labelInner.createDiv({ cls: 'wm-plot-label-actions-2' });
			const lineIdx = this.project.plotLines.indexOf(line);
			const upBtn = labelAct2.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '위로 이동' } });
			setIcon(upBtn, 'arrow-up');
			if (lineIdx <= 0) upBtn.disabled = true;
			upBtn.addEventListener('click', () => {
				const idx = this.project.plotLines.indexOf(line);
				if (idx <= 0) return;
				[this.project.plotLines[idx - 1], this.project.plotLines[idx]] =
					[this.project.plotLines[idx], this.project.plotLines[idx - 1]];
				this.callbacks.onSave();
				this.render();
			});
			const downBtn = labelAct2.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '아래로 이동' } });
			setIcon(downBtn, 'arrow-down');
			if (lineIdx >= this.project.plotLines.length - 1) downBtn.disabled = true;
			downBtn.addEventListener('click', () => {
				const idx = this.project.plotLines.indexOf(line);
				if (idx >= this.project.plotLines.length - 1) return;
				[this.project.plotLines[idx], this.project.plotLines[idx + 1]] =
					[this.project.plotLines[idx + 1], this.project.plotLines[idx]];
				this.callbacks.onSave();
				this.render();
			});
			const delBtn = labelAct2.createEl('button', { cls: 'wm-plot-act-btn wm-plot-act-del', attr: { title: '삭제' } });
			setIcon(delBtn, 'trash-2');
			delBtn.addEventListener('click', () => this.deletePlotLine(line.id));

			if (scenes.length === 0) {
				tr.createEl('td', { cls: 'wm-plot-cell' })
					.createDiv({ cls: 'wm-plot-cell-inner' })
					.createSpan({ text: '에피소드와 장면을 추가하세요', cls: 'wm-plot-cell-text' });
			} else {
				for (let c = 0; c < scenes.length; c++) {
					const sc = scenes[c];
					const td = this.renderPlotCell(tr, line, sc);
					const gcell: GridCell = { el: td, r: rowIdx, c, rowKind: 'plotLine', rowId: line.id, sceneId: sc.id };
					this.cellGrid[rowIdx][c] = gcell;

					td.addEventListener('click', (e) => {
						e.stopPropagation();
						this.selectCell(gcell);
					});
					td.addEventListener('dblclick', (e) => {
						e.stopPropagation();
						this.openPlotCellEditor(td, line.id, sc.id);
					});
				}
			}
			rowIdx++;
		}
	}

	private renderPlotCell(tr: HTMLTableRowElement, line: PlotLine, sc: PlotScene): HTMLElement {
		const key = `${line.id}__${sc.id}`;
		const cell = this.project.plotCells[key];
		const td = tr.createEl('td', { cls: 'wm-plot-cell' });
		if (cell) td.addClass('is-filled');

		const inner = td.createDiv({ cls: 'wm-plot-cell-inner' });
		if (cell) {
			inner.setAttribute('draggable', 'true');
			const textDiv = inner.createDiv({ cls: 'wm-plot-cell-text' });
			renderWithWikilinks(textDiv, cell.content ?? '', this.plugin.app, () => this.plugin.settings.plotLinkOpenMode ?? 'tab');
			inner.addEventListener('dragstart', (e) => {
				e.dataTransfer!.setData('text/plain', key);
				e.dataTransfer!.effectAllowed = 'move';
			});
		}

		td.addEventListener('dragover', (e) => { e.preventDefault(); td.addClass('wm-plot-drop-over'); });
		td.addEventListener('dragleave', () => td.removeClass('wm-plot-drop-over'));
		td.addEventListener('drop', (e) => {
			e.preventDefault();
			td.removeClass('wm-plot-drop-over');
			const srcKey = e.dataTransfer!.getData('text/plain');
			if (srcKey === key) return;
			this.movePlotCell(srcKey, key, line.id, sc.id);
		});

		return td;
	}

	private movePlotCell(srcKey: string, dstKey: string, dstLineId: string, dstSceneId: string) {
		const src = this.project.plotCells[srcKey];
		if (!src) return;
		const dst = this.project.plotCells[dstKey];
		if (dst) {
			const [srcLineId, srcSceneId] = srcKey.split('__');
			this.project.plotCells[srcKey] = { ...dst, plotLineId: srcLineId, sceneId: srcSceneId };
		} else {
			delete this.project.plotCells[srcKey];
		}
		this.project.plotCells[dstKey] = { ...src, plotLineId: dstLineId, sceneId: dstSceneId };
		this.callbacks.onSave();
		this.render();
	}

	private openPlotCellEditor(td: HTMLElement, plotLineId: string, sceneId: string) {
		td.empty();
		td.removeClass('is-selected');
		const key = `${plotLineId}__${sceneId}`;
		const cell = this.project.plotCells[key];
		const originalVal = cell?.content || '';

		const textarea = td.createEl('textarea', { cls: 'wm-plot-cell-editor' });
		textarea.setAttribute('spellcheck', 'false');
		textarea.value = originalVal;

		const ac = attachWikilinkAutocomplete(textarea, this.plugin.app);
		textarea.focus();

		this.attachCellInputFeatures(textarea, () => ac.isOpen());

		let saved = false;
		const save = () => {
			if (saved) return;
			saved = true;
			ac.dismiss();
			const val = textarea.value.trim();
			if (val !== originalVal) this.pushStructUndo();
			if (val) {
				this.project.plotCells[key] = { plotLineId, sceneId, content: val };
			} else {
				delete this.project.plotCells[key];
			}
			this.callbacks.onSave();
			this.render();
		};

		textarea.addEventListener('blur', save);
		textarea.addEventListener('keydown', (e) => {
			if (ac.isOpen()) return;
			if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.render(); }
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
		});
	}

	// ── Character divider & tbody ─────────────────────────────────────────────

	private renderCharDivider(table: HTMLTableElement) {
		const tbody = table.createEl('tbody', { cls: 'wm-plot-char-divider-tbody' });
		const tr = tbody.createEl('tr', { cls: 'wm-plot-section-divider-row' });
		tr.createEl('td', {
			attr: { colspan: String(Math.max(this.scenes.length, 1) + 1) },
			cls: 'wm-plot-section-divider-cell',
		});
	}

	private renderCharTbody(table: HTMLTableElement) {
		const scenes = this.scenes;
		const tbody = table.createEl('tbody', { cls: 'wm-plot-chars-tbody' });
		this.charsTbody = tbody;
		let rowIdx = this.cellGrid.length;

		for (const char of this.project.characters) {
			const isHidden = this.hiddenCharIds.has(char.id);
			const tr = tbody.createEl('tr');
			tr.dataset['charId'] = char.id;
			this.charTbodyRows.push(tr);
			if (isHidden) tr.addClass('wm-plot-char-hidden');
			this.cellGrid[rowIdx] = [];
			if (char.color) tr.style.setProperty('--char-wiki-color', char.color);
			this.applyCharStyle(char, tr);

			const labelTd = tr.createEl('td', { cls: 'wm-plot-sticky-col' });
			if (char.color) {
				labelTd.style.setProperty('--char-wiki-color', char.color);
				labelTd.style.setProperty('--char-wiki-text', getToneColor(char.color));
			}

			const labelInner = labelTd.createDiv({ cls: 'wm-plot-char-label' });

			// 프로필 이미지 — 전체 셀 배경 (::before)
			if (char.filePath) {
				const charFile = this.plugin.app.vault.getAbstractFileByPath(char.filePath);
				if (charFile instanceof TFile) {
					const imgSrc = this.getCharImgSrc(charFile);
					if (imgSrc) {
						const testImg = new Image();
						testImg.onload = () => {
							labelTd.style.setProperty('--char-profile-img', `url("${imgSrc}")`);
							labelTd.classList.add('wm-plot-char-has-profile');
						};
						testImg.src = imgSrc;
					}
				}
			}

			// 액션 버튼 (labelInner 안 — 이름 헤더 위에 표시)
			const labelAct = labelInner.createDiv({ cls: 'wm-plot-label-actions' });

			// 이름 헤더 — labelTd에 직접 배치 (position: absolute, 하단 전체 너비)
			const nameHeader = labelTd.createDiv({ cls: 'wm-plot-char-name-header' });
			nameHeader.createEl('span', { text: char.name, cls: 'wm-plot-char-name' });

			// 노트 파일을 resolve. filePath 없거나 파일 없으면 연결 모달 먼저 띄움
			const resolveCharFile = (callback: (file: TFile) => void) => {
				const f = char.filePath ? this.plugin.app.vault.getAbstractFileByPath(char.filePath) : null;
				if (f instanceof TFile) { callback(f); return; }
				new CharacterNoteModal(this.plugin, (_name, fp) => {
					if (!fp) return;
					char.filePath = fp;
					this.callbacks.onSave();
					this.render();
					const linked = this.plugin.app.vault.getAbstractFileByPath(fp);
					if (linked instanceof TFile) callback(linked);
				}).open();
			};

			// Row 1: [노트 열기][위키 뷰][서식]
			const openNoteBtn = labelAct.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '노트 열기' } });
			setIcon(openNoteBtn, 'external-link');
			openNoteBtn.addEventListener('click', () => {
				resolveCharFile((f) => {
					const mode = this.plugin.settings.plotCharNoteOpenMode ?? 'tab';
					if (mode === 'current') {
						const leaf = this.plugin.app.workspace.getMostRecentLeaf() ?? this.plugin.app.workspace.getLeaf(false);
						void leaf.openFile(f);
					} else {
						void this.plugin.app.workspace.getLeaf(mode).openFile(f);
					}
				});
			});

			const wikiViewBtn = labelAct.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '위키 뷰' } });
			setIcon(wikiViewBtn, 'git-graph');
			wikiViewBtn.addEventListener('click', () => {
				resolveCharFile((f) => void this.plugin.openFileInWiki(f));
			});

			const fmtBtn = labelAct.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '서식' } });
			setIcon(fmtBtn, 'settings');
			fmtBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.openFormatPopup(
					fmtBtn,
					() => ({
						rowHeight: char.rowHeight, fontSize: char.fontSize,
						fontColor: char.fontColor, fontColorDark: char.fontColorDark,
						bgColor: char.bgColor, bgColorDark: char.bgColorDark,
					}),
					(f) => {
						char.rowHeight = f.rowHeight;
						char.fontSize = f.fontSize;
						char.fontColor = f.fontColor;
						char.fontColorDark = f.fontColorDark;
						char.bgColor = f.bgColor;
						char.bgColorDark = f.bgColorDark;
						this.applyCharStyle(char, tr);
						this.callbacks.onSave();
					},
					'wm-plot-char-fmt-popup',
					char.id,
				);
			});

			// Row 2: [↑][↓][삭제]
			const labelAct2 = labelInner.createDiv({ cls: 'wm-plot-label-actions-2' });
			const charIdx = this.project.characters.indexOf(char);
			const upBtn = labelAct2.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '위로 이동' } });
			setIcon(upBtn, 'arrow-up');
			if (charIdx <= 0) upBtn.disabled = true;
			upBtn.addEventListener('click', () => {
				const idx = this.project.characters.indexOf(char);
				if (idx <= 0) return;
				[this.project.characters[idx - 1], this.project.characters[idx]] =
					[this.project.characters[idx], this.project.characters[idx - 1]];
				this.callbacks.onSave();
				this.render();
			});
			const downBtn = labelAct2.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '아래로 이동' } });
			setIcon(downBtn, 'arrow-down');
			if (charIdx >= this.project.characters.length - 1) downBtn.disabled = true;
			downBtn.addEventListener('click', () => {
				const idx = this.project.characters.indexOf(char);
				if (idx >= this.project.characters.length - 1) return;
				[this.project.characters[idx], this.project.characters[idx + 1]] =
					[this.project.characters[idx + 1], this.project.characters[idx]];
				this.callbacks.onSave();
				this.render();
			});
			const delBtn = labelAct2.createEl('button', { cls: 'wm-plot-act-btn wm-plot-act-del', attr: { title: '삭제' } });
			setIcon(delBtn, 'trash-2');
			delBtn.addEventListener('click', () => this.deleteCharacter(char.id));

			if (scenes.length === 0) {
				tr.createEl('td', { cls: 'wm-plot-cell wm-plot-char-cell' });
			} else {
				for (let c = 0; c < scenes.length; c++) {
					const sc = scenes[c];
					const td = this.renderCharCell(tr, char, sc);
					const gcell: GridCell = { el: td, r: rowIdx, c, rowKind: 'char', rowId: char.id, sceneId: sc.id };
					this.cellGrid[rowIdx][c] = gcell;

					td.addEventListener('click', (e) => {
						e.stopPropagation();
						this.selectCell(gcell);
					});
					td.addEventListener('dblclick', (e) => {
						e.stopPropagation();
						this.openCharCellEditor(td, char.id, sc.id);
					});
				}
			}
			this.charGridRowMap.set(char.id, rowIdx);
			rowIdx++;
		}
	}

	private updateCharDomOrder() {
		if (!this.charsTbody) { this.charDomOrderedRows = []; return; }
		this.charDomOrderedRows = [];
		for (const tr of Array.from(this.charsTbody.rows)) {
			const charId = tr.dataset['charId'];
			if (!charId || tr.classList.contains('wm-plot-char-hidden')) continue;
			const row = this.charGridRowMap.get(charId);
			if (row !== undefined) this.charDomOrderedRows.push(row);
		}
	}

	private renderCharCell(tr: HTMLTableRowElement, char: PlotCharacter, sc: PlotScene): HTMLElement {
		const key = `${char.id}__${sc.id}`;
		const cell = this.project.charCells[key];
		const td = tr.createEl('td', { cls: 'wm-plot-cell wm-plot-char-cell' });
		if (cell?.content) td.addClass('is-filled'); // color via CSS --char-wiki-color on tr

		const inner = td.createDiv({ cls: 'wm-plot-cell-inner' });
		if (cell?.content) {
			inner.setAttribute('draggable', 'true');
			const textDiv = inner.createDiv({ cls: 'wm-plot-cell-text' });
			renderWithWikilinks(textDiv, cell.content, this.plugin.app, () => this.plugin.settings.plotLinkOpenMode ?? 'tab');
			inner.addEventListener('dragstart', (e) => {
				e.dataTransfer!.setData('text/plain', key);
				e.dataTransfer!.effectAllowed = 'move';
			});
		}

		td.addEventListener('dragover', (e) => { e.preventDefault(); td.addClass('wm-plot-drop-over'); });
		td.addEventListener('dragleave', () => td.removeClass('wm-plot-drop-over'));
		td.addEventListener('drop', (e) => {
			e.preventDefault();
			td.removeClass('wm-plot-drop-over');
			const srcKey = e.dataTransfer!.getData('text/plain');
			if (srcKey === key) return;
			this.moveCharCell(srcKey, key, char.id, sc.id);
		});

		return td;
	}

	private moveCharCell(srcKey: string, dstKey: string, dstCharId: string, dstSceneId: string) {
		const src = this.project.charCells[srcKey];
		if (!src) return;
		const dst = this.project.charCells[dstKey];
		if (dst) {
			const [srcCharId, srcSceneId] = srcKey.split('__');
			this.project.charCells[srcKey] = { ...dst, charId: srcCharId, sceneId: srcSceneId };
		} else {
			delete this.project.charCells[srcKey];
		}
		this.project.charCells[dstKey] = { ...src, charId: dstCharId, sceneId: dstSceneId };
		this.callbacks.onSave();
		this.render();
	}

	private openCharCellEditor(td: HTMLElement, charId: string, sceneId: string) {
		td.empty();
		td.removeClass('is-selected');
		const key = `${charId}__${sceneId}`;
		const cell = this.project.charCells[key];
		const originalVal = cell?.content || '';

		const textarea = td.createEl('textarea', { cls: 'wm-plot-cell-editor' });
		textarea.setAttribute('spellcheck', 'false');
		textarea.value = originalVal;

		const ac = attachWikilinkAutocomplete(textarea, this.plugin.app);
		textarea.focus();

		this.attachCellInputFeatures(textarea, () => ac.isOpen());

		let saved = false;
		const save = () => {
			if (saved) return;
			saved = true;
			ac.dismiss();
			const val = textarea.value.trim();
			if (val !== originalVal) this.pushStructUndo();
			if (val) {
				this.project.charCells[key] = { charId, sceneId, content: val };
			} else {
				delete this.project.charCells[key];
			}
			this.callbacks.onSave();
			this.render();
		};

		textarea.addEventListener('blur', save);
		textarea.addEventListener('keydown', (e) => {
			if (ac.isOpen()) return;
			if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.render(); }
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
		});
	}

	// ── Textarea input features ──────────────────────────────────────────────

	private attachCellInputFeatures(textarea: HTMLTextAreaElement, acIsOpen: () => boolean) {
		const plugin = this.plugin;
		if (!plugin.settings.enableSmartInput) return;

		// Trigger popup state
		let trigPopup: HTMLElement | null = null;
		let trigBtns: HTMLElement[] = [];
		let trigFocusIdx = 0;
		let trigCharPos = -1; // position of the trigger character in textarea

		const updateTrigHighlight = () => {
			trigBtns.forEach((b, i) => b.classList.toggle('is-selected', i === trigFocusIdx));
		};

		const dismissTrigPopup = () => {
			trigPopup?.remove();
			trigPopup = null;
			trigBtns = [];
			trigFocusIdx = 0;
			trigCharPos = -1;
		};

		// Text substitution + trigger detection (input event)
		const triggerMap = new Map(
			(plugin.settings.symbolTriggers ?? [])
				.filter(t => t.enabled && t.options?.length > 0)
				.map(t => [t.trigger, t])
		);

		let subSorted: typeof plugin.settings.textSubstitutions = [];
		let subMaxLen = 0;
		if (plugin.settings.enableTextSubstitution) {
			const enabled = plugin.settings.textSubstitutions.filter(s => s.enabled && s.from && s.to);
			if (enabled.length > 0) {
				subSorted = [...enabled].sort((a, b) => b.from.length - a.from.length);
				subMaxLen = subSorted[0].from.length;
			}
		}

		textarea.addEventListener('input', () => {
			if (acIsOpen()) { dismissTrigPopup(); return; }

			const pos = textarea.selectionStart ?? 0;
			const val = textarea.value;

			// Text substitution
			if (subSorted.length > 0) {
				const recent = val.slice(Math.max(0, pos - subMaxLen), pos);
				const match = subSorted.find(s => recent.endsWith(s.from));
				if (match) {
					textarea.setRangeText(match.to, pos - match.from.length, pos, 'end');
					dismissTrigPopup();
					return;
				}
			}

			// Trigger detection: check if last typed character is a trigger key
			if (triggerMap.size > 0 && pos > 0) {
				const lastChar = val[pos - 1];
				const trig = triggerMap.get(lastChar);
				if (trig) {
					trigCharPos = pos - 1;
					if (trig.options.length === 1) {
						const { open, close } = trig.options[0];
						textarea.setRangeText(open + close, trigCharPos, pos, 'end');
						textarea.setSelectionRange(trigCharPos + open.length, trigCharPos + open.length);
						trigCharPos = -1;
					} else {
						trigPopup = this.showTriggerOptionPopup(textarea, trig.options, trigCharPos, pos, dismissTrigPopup);
						trigBtns = Array.from(trigPopup.querySelectorAll<HTMLElement>('.wm-cell-trigger-btn'));
						trigFocusIdx = 0;
						updateTrigHighlight();
					}
					return;
				}
			}

			// Any other input: dismiss trigger popup
			dismissTrigPopup();
		});

		// Trigger popup keyboard navigation
		textarea.addEventListener('keydown', (e) => {
			if (!trigPopup) return;
			if (e.key === 'Escape') {
				e.preventDefault(); e.stopImmediatePropagation();
				dismissTrigPopup();
			} else if (e.key === 'Enter') {
				e.preventDefault(); e.stopImmediatePropagation();
				trigBtns[trigFocusIdx]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
			} else if (e.key === 'ArrowRight' || e.key === 'Tab') {
				e.preventDefault();
				trigFocusIdx = (trigFocusIdx + 1) % trigBtns.length;
				updateTrigHighlight();
			} else if (e.key === 'ArrowLeft') {
				e.preventDefault();
				trigFocusIdx = (trigFocusIdx - 1 + trigBtns.length) % trigBtns.length;
				updateTrigHighlight();
			} else {
				dismissTrigPopup();
			}
		});

		textarea.addEventListener('blur', dismissTrigPopup);
	}

	private showTriggerOptionPopup(
		textarea: HTMLTextAreaElement,
		options: SymbolOption[],
		trigStart: number,  // position of trigger character
		trigEnd: number,    // position after trigger character
		onDismiss: () => void,
	): HTMLElement {
		document.querySelectorAll('.wm-cell-trigger-popup').forEach(el => el.remove());
		const popup = document.body.createDiv({ cls: 'wm-cell-trigger-popup' });
		const rect = textarea.getBoundingClientRect();
		popup.style.left = `${rect.left}px`;
		popup.style.top = `${rect.top - 4}px`;

		for (const opt of options) {
			const btn = popup.createEl('button', { cls: 'wm-cell-trigger-btn', text: opt.open + opt.close });
			btn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				// Replace trigger character with bracket pair, cursor inside
				textarea.setRangeText(opt.open + opt.close, trigStart, trigEnd, 'end');
				textarea.setSelectionRange(trigStart + opt.open.length, trigStart + opt.open.length);
				onDismiss();
				textarea.focus();
			});
		}

		const outsideHandler = (e: MouseEvent) => {
			if (!popup.contains(e.target as Node)) {
				onDismiss();
				document.removeEventListener('mousedown', outsideHandler, true);
			}
		};
		setTimeout(() => document.addEventListener('mousedown', outsideHandler, true), 0);
		return popup;
	}

	// ── Cell selection ────────────────────────────────────────────────────────

	private cellSelectDebounce: ReturnType<typeof setTimeout> | null = null;

	private selectCell(cell: GridCell, scrollToCenter = false) {
		if (this.selectedCell === cell) return; // no-op if same cell (boundary clamp etc.)
		this.selectedCell?.el.classList.remove('is-selected');
		this.selectedCell = cell;
		this.applySelection(cell, true, scrollToCenter);
	}

	private applySelection(cell: GridCell, scroll = true, scrollToCenter = false) {
		this.selectedCell = cell;
		cell.el.classList.add('is-selected');
		if (scroll) this.scrollCellIntoView(cell.el, scrollToCenter);

		// Re-focus wrapper so keyboard events keep firing after a mouse click.
		// Skip entirely when wrapper is already focused (keyboard navigation) —
		// reading scrollTop/scrollLeft forces a synchronous layout on every keypress.
		if (document.activeElement !== this.wrapper) {
			const section = this.sectionEl;
			const savedTop = section?.scrollTop ?? 0;
			const savedLeft = section?.scrollLeft ?? 0;
			this.wrapper.focus({ preventScroll: true });
			if (section) { section.scrollTop = savedTop; section.scrollLeft = savedLeft; }
		}

		if (cell.rowKind === 'plotLine') {
			// Cancel pending reorder RAF to avoid pile-up during rapid key presses
			if (this.reorderRafId !== null) cancelAnimationFrame(this.reorderRafId);
			this.reorderRafId = requestAnimationFrame(() => {
				this.reorderRafId = null;
				if (this.selectedCell === cell) {
					this.reorderCharsByColumn(cell.c);
					this.updateHiddenCharVisibility(cell.sceneId);
					this.updateCharDomOrder();
				}
			});
		} else {
			if (this.reorderRafId !== null) {
				cancelAnimationFrame(this.reorderRafId);
				this.reorderRafId = null;
			}
			if (!scroll) {
				// Restoring from render() — must be synchronous and re-apply column sort
				this.reorderCharsByColumn(cell.c);
				this.updateHiddenCharVisibility(cell.sceneId);
				this.updateCharDomOrder();
			} else {
				// During navigation, defer DOM visibility + order updates to next frame.
				// Cancels previous pending RAF so only the final cell in a rapid sequence
				// triggers the update — eliminates style recalculations per keypress.
				const sceneId = cell.sceneId;
				this.reorderRafId = requestAnimationFrame(() => {
					this.reorderRafId = null;
					if (this.selectedCell === cell) {
						this.updateHiddenCharVisibility(sceneId);
						this.updateCharDomOrder();
					}
				});
			}
		}
		// Debounce onCellSelect — rapid arrow key presses only fire the callback
		// after 80ms pause, preventing excessive timeline re-renders
		if (this.cellSelectDebounce) clearTimeout(this.cellSelectDebounce);
		this.cellSelectDebounce = setTimeout(() => {
			this.cellSelectDebounce = null;
			if (this.selectedCell === cell) {
				this.callbacks.onCellSelect({
					kind: cell.rowKind === 'plotLine' ? 'plotLine' : 'char',
					...(cell.rowKind === 'plotLine' ? { lineId: cell.rowId } : { charId: cell.rowId }),
					sceneId: cell.sceneId,
				} as NonNullable<CellSelection>);
			}
		}, 80);
	}

	private updateHiddenCharVisibility(sceneId: string | null) {
		for (const tr of this.charTbodyRows) {
			const charId = tr.dataset['charId'];
			if (!charId || !this.hiddenCharIds.has(charId)) continue;
			const hasContent = sceneId
				? !!this.project.charCells[`${charId}__${sceneId}`]?.content
				: false;
			tr.classList.toggle('wm-plot-char-hidden', !hasContent);
		}
	}

	private navigateTo(r: number, c: number, dr = 0) {
		const rows = this.cellGrid.length;
		if (rows === 0) return;
		let targetR = Math.max(0, Math.min(rows - 1, r));

		if (dr !== 0) {
			// r is the destination (current + dr); currentR is the actual current row
			const currentR = r - dr;
			const wasInCharSection = currentR >= this.plotRowCount;

			if (wasInCharSection) {
				// Moving from a char row: always navigate via DOM order
				const curIdx = this.charDomOrderedRows.indexOf(currentR);
				if (dr > 0) {
					const nextIdx = curIdx + 1;
					targetR = nextIdx < this.charDomOrderedRows.length ? this.charDomOrderedRows[nextIdx] : -1;
				} else {
					if (curIdx <= 0) {
						// First char in DOM order → exit up to last plot row
						targetR = this.plotRowCount - 1;
						while (targetR >= 0 && (!this.cellGrid[targetR] || this.cellGrid[targetR].length === 0)) {
							targetR--;
						}
					} else {
						targetR = this.charDomOrderedRows[curIdx - 1];
					}
				}
				if (targetR < 0 || targetR >= rows) return;
			} else if (dr > 0 && targetR >= this.plotRowCount && this.charDomOrderedRows.length > 0) {
				// Entering char section from plot: cancel pending RAF and sync everything
				if (this.reorderRafId !== null) {
					cancelAnimationFrame(this.reorderRafId);
					this.reorderRafId = null;
				}
				// Ensure hidden chars with content in this column are visible before computing DOM order
				const enterSceneId = this.scenes[c]?.id ?? null;
				this.updateHiddenCharVisibility(enterSceneId);
				this.reorderCharsByColumn(c);
				this.updateCharDomOrder(); // force refresh after visibility change
				targetR = this.charDomOrderedRows[0] ?? -1;
				if (targetR < 0 || targetR >= rows) return;
			} else {
				// Navigate within plot: skip collapsed rows, stay within plot section
				while (targetR >= 0 && targetR < this.plotRowCount) {
					const row = this.cellGrid[targetR];
					if (row && row.length > 0) break;
					targetR += dr;
				}
				if (targetR < 0 || targetR >= this.plotRowCount) return;
			}
		}

		const row = this.cellGrid[targetR];
		if (!row) return;
		const cols = row.length;
		c = Math.max(0, Math.min(cols - 1, c));
		const cell = row[c];
		if (cell) this.selectCell(cell);
	}

	private jumpToFilled(r: number, c: number, dr: number, dc: number) {
		let nr = r + dr;
		let nc = c + dc;
		while (nr >= 0 && nr < this.cellGrid.length && nc >= 0) {
			const row = this.cellGrid[nr];
			if (!row) break;
			if (nc >= row.length) break;
			const cell = row[nc];
			if (cell) {
				const isFilled = cell.rowKind === 'plotLine'
					? !!this.project.plotCells[`${cell.rowId}__${cell.sceneId}`]?.content
					: !!this.project.charCells[`${cell.rowId}__${cell.sceneId}`]?.content;
				if (isFilled) { this.selectCell(cell); return; }
			}
			nr += dr;
			nc += dc;
		}
	}

	private scrollCellIntoView(el: HTMLElement, center = false) {
		// Cancel any pending scroll RAF to avoid pile-up during rapid key presses
		if (this.scrollRafId !== null) {
			cancelAnimationFrame(this.scrollRafId);
			this.scrollRafId = null;
		}
		if (center) {
			el.scrollIntoView({ block: 'center', inline: 'center' });
			return;
		}
		// Defer scroll to RAF so rapid keydown events don't block input processing
		this.scrollRafId = requestAnimationFrame(() => {
			this.scrollRafId = null;
			el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			// Correct for sticky header overlap
			const section = this.sectionEl;
			if (!section) return;
			const STICKY_H = 112; // 48 (ep) + 32 (ch) + 32 (sc)
			const sRect = section.getBoundingClientRect();
			const cRect = el.getBoundingClientRect();
			if (cRect.top < sRect.top + STICKY_H) {
				section.scrollTop -= (sRect.top + STICKY_H - cRect.top) + 2;
			}
		});
	}

	private reorderCharsByColumn(colIdx: number) {
		if (this.charTbodyRows.length === 0 || !this.charsTbody) return;
		if (!this.scenes[colIdx]) return;
		if (colIdx === this.lastReorderedCol) return; // already in correct order for this column
		this.lastReorderedCol = colIdx;
		const sceneId = this.scenes[colIdx].id;
		const filled: HTMLElement[] = [];
		const empty: HTMLElement[] = [];
		for (const tr of this.charTbodyRows) {
			const charId = tr.dataset['charId'];
			if (charId && this.project.charCells[`${charId}__${sceneId}`]?.content) {
				filled.push(tr);
			} else {
				empty.push(tr);
			}
		}
		for (const tr of [...filled, ...empty]) {
			this.charsTbody.appendChild(tr);
		}
		this.updateCharDomOrder();
	}

	private readonly onKeydown = (e: KeyboardEvent) => {
		// When a textarea (cell editor) is active, let all keys pass through natively.
		if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;

		if (!this.selectedCell) return;

		const { r, c } = this.selectedCell;

		// PgUp / PgDn: scroll the selected cell's inner content if it overflows
		if (e.key === 'PageUp' || e.key === 'PageDown') {
			const inner = this.selectedCell.el.querySelector<HTMLElement>('.wm-plot-cell-inner');
			if (inner && inner.scrollHeight > inner.clientHeight) {
				e.preventDefault();
				inner.scrollTop += e.key === 'PageDown' ? inner.clientHeight : -inner.clientHeight;
				return;
			}
		}

		if (e.ctrlKey) {
			switch (e.key) {
				case 'ArrowRight': e.preventDefault(); this.jumpToFilled(r, c, 0, 1); return;
				case 'ArrowLeft':  e.preventDefault(); this.jumpToFilled(r, c, 0, -1); return;
				case 'ArrowDown':  e.preventDefault(); this.jumpToFilled(r, c, 1, 0); return;
				case 'ArrowUp':    e.preventDefault(); this.jumpToFilled(r, c, -1, 0); return;
			}
		}

		switch (e.key) {
			case 'Escape':     e.preventDefault(); e.stopPropagation(); this.clearGridSelection(); break;
			case 'ArrowRight': e.preventDefault(); this.navigateTo(r, c + 1, 0);  break;
			case 'ArrowLeft':  e.preventDefault(); this.navigateTo(r, c - 1, 0);  break;
			case 'ArrowDown':  e.preventDefault(); this.navigateTo(r + 1, c, 1);  break;
			case 'ArrowUp':    e.preventDefault(); this.navigateTo(r - 1, c, -1); break;
			case 'Enter':      e.preventDefault(); this.editSelectedCell(); break;
		}
	};

	private editSelectedCell() {
		if (!this.selectedCell) return;
		const { el, rowKind, rowId, sceneId } = this.selectedCell;
		if (rowKind === 'plotLine') {
			this.openPlotCellEditor(el, rowId, sceneId);
		} else {
			this.openCharCellEditor(el, rowId, sceneId);
		}
	}

	// ── Episode subtitle input ────────────────────────────────────────────────

	private openSubtitleInput(ep: PlotEpisode, anchor: HTMLElement) {
		document.querySelector('.wm-plot-subtitle-popup')?.remove();
		const rect = anchor.getBoundingClientRect();
		const popup = document.body.createDiv({ cls: 'wm-plot-subtitle-popup' });
		popup.style.top = `${rect.bottom + 4}px`;
		popup.style.left = `${Math.max(4, rect.left - 80)}px`;

		const input = popup.createEl('input', { cls: 'wm-plot-subtitle-input', attr: { type: 'text', placeholder: '소제목 입력…', spellcheck: 'false' } });
		input.value = ep.subtitle ?? '';

		const save = () => {
			const originalEp = this.project.episodes.find(e => e.id === ep.id);
			if (originalEp) originalEp.subtitle = input.value.trim() || undefined;
			popup.remove();
			this.callbacks.onSave();
			this.render();
		};
		input.addEventListener('blur', save);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); save(); }
			if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); popup.remove(); }
		});
		input.focus();
		input.select();
	}

	// ── Sort Popup ───────────────────────────────────────────────────────────

	openSortPopup(anchor: HTMLElement): void {
		document.querySelector('.wm-plot-sort-popup')?.remove();
		const rect = anchor.getBoundingClientRect();
		const popup = document.body.createDiv({ cls: 'wm-plot-sort-popup' });
		popup.style.top = `${rect.bottom + 4}px`;
		popup.style.left = `${Math.max(4, rect.left)}px`;
		requestAnimationFrame(() => {
			const pw = popup.offsetWidth;
			const ph = popup.offsetHeight;
			popup.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - pw - 8))}px`;
			if (rect.bottom + 4 + ph > window.innerHeight)
				popup.style.top = `${Math.max(4, rect.top - ph - 4)}px`;
		});

		const eps = this.project.episodes;
		const PAGE_SIZE = this.plugin.settings.plotSortPageSize ?? 5;
		let currentPage = 0;
		const collapsedEps = new Set<string>();

		let dragType: 'ch' | 'sc' | null = null;
		let dragEpFromIdx = -1;
		let dragChFromIdx = -1;
		let dragFromIdx = -1;

		const clearDrop = () => {
			popup.querySelectorAll('.wm-sort-drop-over').forEach(el => el.classList.remove('wm-sort-drop-over'));
		};

		const renderTree = (container: HTMLElement) => {
			container.empty();
			if (eps.length === 0) return;

			const totalPages = Math.ceil(eps.length / PAGE_SIZE);
			const startIdx = currentPage * PAGE_SIZE;
			const endIdx = Math.min(startIdx + PAGE_SIZE, eps.length);

			// ── Page navigation (toolbar style) ──
			const navRow = container.createDiv({ cls: 'wm-sort-page-nav-row' });
			const nav = navRow.createDiv({ cls: 'wm-sort-page-nav' });
			const prevBtn = nav.createEl('button', { cls: 'wm-sort-btn', attr: { title: '이전 페이지' } });
			setIcon(prevBtn, 'chevron-left');
			if (currentPage === 0) prevBtn.disabled = true;
			prevBtn.addEventListener('click', () => { currentPage--; renderTree(container); });
			const pageLabel = nav.createSpan({ cls: 'wm-sort-page-label' });
			pageLabel.textContent = eps[startIdx].name + (endIdx > startIdx + 1 ? ` ~ ${eps[endIdx - 1].name}` : '');
			const nextBtn = nav.createEl('button', { cls: 'wm-sort-btn', attr: { title: '다음 페이지' } });
			setIcon(nextBtn, 'chevron-right');
			if (currentPage >= totalPages - 1) nextBtn.disabled = true;
			nextBtn.addEventListener('click', () => { currentPage++; renderTree(container); });

			// Search button (right of nav)
			const searchBtn = navRow.createEl('button', { cls: 'wm-sort-btn', attr: { title: '회차 검색' } });
			setIcon(searchBtn, 'search');
			searchBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				openChapterSearchPopup('wm-plot-ch-search-popup', (q) => {
					const trimmed = q.trim();
					if (!trimmed) return;
					for (let ei = 0; ei < eps.length; ei++) {
						const ep = eps[ei];
						const ch = ep.chapters.find(c => c.name === trimmed || c.name.includes(trimmed));
						if (ch) {
							currentPage = Math.floor(ei / PAGE_SIZE);
							collapsedEps.delete(ep.id);
							renderTree(container);
							requestAnimationFrame(() => {
								const rows = container.querySelectorAll<HTMLElement>('.wm-sort-ch-row');
								for (const row of Array.from(rows)) {
									const lbl = row.querySelector('.wm-sort-label');
									if (lbl && (lbl.textContent === trimmed || lbl.textContent?.includes(trimmed))) {
										row.scrollIntoView({ block: 'nearest' });
										row.classList.remove('wm-sort-ch-flash');
										void row.offsetWidth;
										row.classList.add('wm-sort-ch-flash');
										setTimeout(() => row.classList.remove('wm-sort-ch-flash'), 1200);
										break;
									}
								}
							});
							return;
						}
					}
				});
			});

			// ── Episodes on current page ──
			const body = container.createDiv({ cls: 'wm-sort-body' });

			for (let epIdx = startIdx; epIdx < endIdx; epIdx++) {
				const ep = eps[epIdx];
				const isCollapsed = collapsedEps.has(ep.id);

				const epRow = body.createDiv({ cls: 'wm-sort-ep-row' });
				const toggleBtn = epRow.createEl('button', { cls: 'wm-sort-btn', attr: { title: isCollapsed ? '펼치기' : '접기' } });
				setIcon(toggleBtn, isCollapsed ? 'chevron-down' : 'chevron-up');
				toggleBtn.addEventListener('click', () => {
					if (collapsedEps.has(ep.id)) collapsedEps.delete(ep.id); else collapsedEps.add(ep.id);
					renderTree(container);
				});
				const epLabel = epRow.createSpan({ cls: 'wm-sort-label wm-sort-ep-label' });
				epLabel.textContent = ep.name;
				epLabel.addEventListener('click', () => {
					if (collapsedEps.has(ep.id)) collapsedEps.delete(ep.id); else collapsedEps.add(ep.id);
					renderTree(container);
				});
				const epUpBtn = epRow.createEl('button', { cls: 'wm-sort-btn', attr: { title: '위로' } });
				setIcon(epUpBtn, 'arrow-up');
				if (epIdx === 0) epUpBtn.disabled = true;
				epUpBtn.addEventListener('click', () => {
					this.pushStructUndo();
					[eps[epIdx - 1], eps[epIdx]] = [eps[epIdx], eps[epIdx - 1]];
					if (epIdx === startIdx && currentPage > 0) currentPage--;
					this.renumberSortOrder(); this.callbacks.onSave(); this.render();
					renderTree(container);
				});
				const epDownBtn = epRow.createEl('button', { cls: 'wm-sort-btn', attr: { title: '아래로' } });
				setIcon(epDownBtn, 'arrow-down');
				if (epIdx === eps.length - 1) epDownBtn.disabled = true;
				epDownBtn.addEventListener('click', () => {
					this.pushStructUndo();
					[eps[epIdx], eps[epIdx + 1]] = [eps[epIdx + 1], eps[epIdx]];
					if (epIdx === endIdx - 1 && currentPage < totalPages - 1) currentPage++;
					this.renumberSortOrder(); this.callbacks.onSave(); this.render();
					renderTree(container);
				});

				if (isCollapsed) continue;

				ep.chapters.forEach((ch, chIdx) => {
					const chRow = body.createDiv({ cls: 'wm-sort-ch-row' });
					chRow.createSpan({ cls: 'wm-sort-label', text: ch.name });

					const chUpBtn = chRow.createEl('button', { cls: 'wm-sort-btn', attr: { title: '위로' } });
					setIcon(chUpBtn, 'arrow-up');
					if (chIdx === 0 && epIdx === 0) chUpBtn.disabled = true;
					chUpBtn.addEventListener('click', () => {
						this.pushStructUndo();
						if (chIdx === 0) {
							const [moved] = ep.chapters.splice(0, 1);
							eps[epIdx - 1].chapters.push(moved);
							const pg = Math.floor((epIdx - 1) / PAGE_SIZE);
							if (pg !== currentPage) currentPage = pg;
						} else {
							[ep.chapters[chIdx - 1], ep.chapters[chIdx]] = [ep.chapters[chIdx], ep.chapters[chIdx - 1]];
						}
						this.renumberSortOrder(); this.callbacks.onSave(); this.render();
						renderTree(container);
					});

					const chDownBtn = chRow.createEl('button', { cls: 'wm-sort-btn', attr: { title: '아래로' } });
					setIcon(chDownBtn, 'arrow-down');
					if (chIdx === ep.chapters.length - 1 && epIdx === eps.length - 1) chDownBtn.disabled = true;
					chDownBtn.addEventListener('click', () => {
						this.pushStructUndo();
						if (chIdx === ep.chapters.length - 1) {
							const [moved] = ep.chapters.splice(ep.chapters.length - 1, 1);
							eps[epIdx + 1].chapters.unshift(moved);
							const pg = Math.floor((epIdx + 1) / PAGE_SIZE);
							if (pg !== currentPage) currentPage = pg;
						} else {
							[ep.chapters[chIdx], ep.chapters[chIdx + 1]] = [ep.chapters[chIdx + 1], ep.chapters[chIdx]];
						}
						this.renumberSortOrder(); this.callbacks.onSave(); this.render();
						renderTree(container);
					});

					chRow.draggable = true;
					chRow.addEventListener('dragstart', (e) => {
						dragType = 'ch'; dragEpFromIdx = epIdx; dragChFromIdx = -1; dragFromIdx = chIdx;
						e.dataTransfer!.effectAllowed = 'move';
						e.dataTransfer!.setData('text/plain', '');
						setTimeout(() => chRow.classList.add('wm-sort-dragging'), 0);
					});
					chRow.addEventListener('dragend', () => {
						dragType = null; dragEpFromIdx = -1; dragChFromIdx = -1; dragFromIdx = -1;
						chRow.classList.remove('wm-sort-dragging'); clearDrop();
					});
					chRow.addEventListener('dragover', (e) => {
						if (dragType !== 'ch') return;
						if (dragEpFromIdx === epIdx && dragFromIdx === chIdx) return;
						e.preventDefault(); clearDrop(); chRow.classList.add('wm-sort-drop-over');
					});
					chRow.addEventListener('dragleave', (e) => {
						if (!chRow.contains(e.relatedTarget as Node)) chRow.classList.remove('wm-sort-drop-over');
					});
					chRow.addEventListener('drop', (e) => {
						e.preventDefault(); chRow.classList.remove('wm-sort-drop-over');
						if (dragType !== 'ch') return;
						const fromEp = dragEpFromIdx; const from = dragFromIdx; const to = chIdx;
						if (fromEp < 0 || (fromEp === epIdx && from === to)) return;
						this.pushStructUndo();
						const [moved] = eps[fromEp].chapters.splice(from, 1);
						const sameEp = fromEp === epIdx;
						ep.chapters.splice(sameEp && to > from ? to - 1 : to, 0, moved);
						this.renumberSortOrder(); this.callbacks.onSave(); this.render();
						renderTree(container);
					});

					ch.scenes.forEach((sc, scIdx) => {
						const scRow = body.createDiv({ cls: 'wm-sort-sc-row' });
						scRow.createSpan({ cls: 'wm-sort-label', text: sc.name });

						const scUpBtn = scRow.createEl('button', { cls: 'wm-sort-btn', attr: { title: '위로' } });
						setIcon(scUpBtn, 'arrow-up');
						if (scIdx === 0 && chIdx === 0 && epIdx === 0) scUpBtn.disabled = true;
						scUpBtn.addEventListener('click', () => {
							this.pushStructUndo();
							if (scIdx === 0) {
								if (chIdx === 0) {
									const prevEp = eps[epIdx - 1];
									const lastCh = prevEp.chapters[prevEp.chapters.length - 1];
									const [moved] = ch.scenes.splice(0, 1);
									lastCh.scenes.push(moved);
									const pg = Math.floor((epIdx - 1) / PAGE_SIZE);
									if (pg !== currentPage) currentPage = pg;
								} else {
									const [moved] = ch.scenes.splice(0, 1);
									ep.chapters[chIdx - 1].scenes.push(moved);
								}
							} else {
								[ch.scenes[scIdx - 1], ch.scenes[scIdx]] = [ch.scenes[scIdx], ch.scenes[scIdx - 1]];
							}
							this.renumberSortOrder(); this.callbacks.onSave(); this.render();
							renderTree(container);
						});

						const scDownBtn = scRow.createEl('button', { cls: 'wm-sort-btn', attr: { title: '아래로' } });
						setIcon(scDownBtn, 'arrow-down');
						const atLastSc = scIdx === ch.scenes.length - 1;
						const atLastCh = chIdx === ep.chapters.length - 1;
						if (atLastSc && atLastCh && epIdx === eps.length - 1) scDownBtn.disabled = true;
						scDownBtn.addEventListener('click', () => {
							this.pushStructUndo();
							if (atLastSc) {
								if (atLastCh) {
									const nextEp = eps[epIdx + 1];
									const [moved] = ch.scenes.splice(ch.scenes.length - 1, 1);
									nextEp.chapters[0].scenes.unshift(moved);
									const pg = Math.floor((epIdx + 1) / PAGE_SIZE);
									if (pg !== currentPage) currentPage = pg;
								} else {
									const [moved] = ch.scenes.splice(ch.scenes.length - 1, 1);
									ep.chapters[chIdx + 1].scenes.unshift(moved);
								}
							} else {
								[ch.scenes[scIdx], ch.scenes[scIdx + 1]] = [ch.scenes[scIdx + 1], ch.scenes[scIdx]];
							}
							this.renumberSortOrder(); this.callbacks.onSave(); this.render();
							renderTree(container);
						});

						scRow.draggable = true;
						scRow.addEventListener('dragstart', (e) => {
							dragType = 'sc'; dragEpFromIdx = epIdx; dragChFromIdx = chIdx; dragFromIdx = scIdx;
							e.dataTransfer!.effectAllowed = 'move';
							e.dataTransfer!.setData('text/plain', '');
							setTimeout(() => scRow.classList.add('wm-sort-dragging'), 0);
						});
						scRow.addEventListener('dragend', () => {
							dragType = null; dragEpFromIdx = -1; dragChFromIdx = -1; dragFromIdx = -1;
							scRow.classList.remove('wm-sort-dragging'); clearDrop();
						});
						scRow.addEventListener('dragover', (e) => {
							if (dragType !== 'sc') return;
							if (dragEpFromIdx === epIdx && dragChFromIdx === chIdx && dragFromIdx === scIdx) return;
							e.preventDefault(); clearDrop(); scRow.classList.add('wm-sort-drop-over');
						});
						scRow.addEventListener('dragleave', (e) => {
							if (!scRow.contains(e.relatedTarget as Node)) scRow.classList.remove('wm-sort-drop-over');
						});
						scRow.addEventListener('drop', (e) => {
							e.preventDefault(); scRow.classList.remove('wm-sort-drop-over');
							if (dragType !== 'sc') return;
							const fromEp = dragEpFromIdx; const fromCh = dragChFromIdx; const fromSc = dragFromIdx;
							if (fromEp < 0 || (fromEp === epIdx && fromCh === chIdx && fromSc === scIdx)) return;
							this.pushStructUndo();
							const [moved] = eps[fromEp].chapters[fromCh].scenes.splice(fromSc, 1);
							const sameCh = fromEp === epIdx && fromCh === chIdx;
							ch.scenes.splice(sameCh && scIdx > fromSc ? scIdx - 1 : scIdx, 0, moved);
							this.renumberSortOrder(); this.callbacks.onSave(); this.render();
							renderTree(container);
						});
					});
				});
			}
		};

		renderTree(popup);
		// Outside-click: also allow clicks inside the chapter search popup
		setTimeout(() => {
			const handler = (e: MouseEvent) => {
				const searchPop = document.querySelector('.wm-plot-ch-search-popup');
				if (popup.contains(e.target as Node) || (searchPop && searchPop.contains(e.target as Node))) return;
				popup.remove();
				document.removeEventListener('click', handler, true);
			};
			document.addEventListener('click', handler, true);
		}, 0);
	}

	// ── Renumbering ──────────────────────────────────────────────────────────

	// Renumber by array order (used by sort popup so grid column order reflects the new array order)
	private renumberSortOrder() {
		let epNum = 0;
		let chNum = 0;
		for (const ep of this.project.episodes) {
			epNum++;
			ep.name = `EPISODE ${epNum}`;
			for (const ch of ep.chapters) {
				chNum++;
				ch.name = `${chNum}화`;
				ch.scenes.forEach((sc, scIdx) => {
					sc.name = `${chNum}-${scIdx + 1}`;
				});
			}
		}
	}

	private renumberAll() {
		// Use sorted display order so chapter names always match what the grid shows
		const sortedChs = this.getSortedAllChapters();
		const epNumbers = new Map<string, number>();
		let epNum = 0;
		let globalCh = 0;
		for (const { ep, ch } of sortedChs) {
			if (!epNumbers.has(ep.id)) {
				epNum++;
				epNumbers.set(ep.id, epNum);
				ep.name = `EPISODE ${epNum}`;
			}
			globalCh++;
			ch.name = `${globalCh}화`;
			let localSc = 0;
			for (const sc of ch.scenes) {
				localSc++;
				sc.name = `${globalCh}-${localSc}`;
			}
		}
	}

	// ── Public mutations ──────────────────────────────────────────────────────

	selectCellBySelection(sel: CellSelection) {
		if (!sel) return;
		if (this.trySelectInGrid(sel, true)) return;
		// Scene is not on current page — navigate to it
		const targetPage = this.findPageForScene(sel.sceneId);
		if (targetPage !== this.chapterPage) {
			this.chapterPage = targetPage;
			this.callbacks.onPageChange?.();
			this.render();
			this.trySelectInGrid(sel, true);
		}
	}

	private trySelectInGrid(sel: NonNullable<CellSelection>, scrollToCenter = false): boolean {
		for (const row of this.cellGrid) {
			if (!row) continue;
			for (const cell of row) {
				if (!cell || cell.sceneId !== sel.sceneId) continue;
				if (sel.kind === 'plotLine' && cell.rowKind === 'plotLine' && cell.rowId === sel.lineId) {
					this.selectCell(cell, scrollToCenter);
					return true;
				}
				if (sel.kind === 'char' && cell.rowKind === 'char' && cell.rowId === sel.charId) {
					this.selectCell(cell, scrollToCenter);
					return true;
				}
			}
		}
		return false;
	}

	// ── Structural undo / redo ──────────────────────────────────────────────

	private pushStructUndo() {
		this.structUndoStack.push(JSON.stringify(this.project));
		if (this.structUndoStack.length > this.STRUCT_UNDO_MAX) this.structUndoStack.shift();
		this.structRedoStack = [];
		this.callbacks.onUndoRedoChange?.(true, false);
	}

	private restoreProjectSnapshot(snapshot: string) {
		const r = JSON.parse(snapshot) as PlotProject;
		this.project.plotLines  = r.plotLines;
		this.project.episodes   = r.episodes;
		this.project.characters = r.characters;
		this.project.plotCells  = r.plotCells;
		this.project.charCells  = r.charCells;
	}

	undo() {
		if (this.structUndoStack.length === 0) return;
		this.structRedoStack.push(JSON.stringify(this.project));
		this.restoreProjectSnapshot(this.structUndoStack.pop()!);
		this.chapterPage = 0;
		this.callbacks.onSave();
		this.render();
		this.callbacks.onPageChange?.();
		this.callbacks.onUndoRedoChange?.(this.structUndoStack.length > 0, true);
	}

	redo() {
		if (this.structRedoStack.length === 0) return;
		this.structUndoStack.push(JSON.stringify(this.project));
		this.restoreProjectSnapshot(this.structRedoStack.pop()!);
		this.chapterPage = 0;
		this.callbacks.onSave();
		this.render();
		this.callbacks.onPageChange?.();
		this.callbacks.onUndoRedoChange?.(true, this.structRedoStack.length > 0);
	}

	addPlotLine() {
		this.pushStructUndo();
		const n = this.project.plotLines.length + 1;
		this.project.plotLines.push({ id: newId(), name: `플롯 라인 ${n}`, collapsed: false });
		this.callbacks.onSave();
		this.render();
	}

	openAddCharPopup(anchor: HTMLElement) {
		const existingAddChar = document.querySelector('.wm-plot-addchar-popup');
		if (existingAddChar) { existingAddChar.remove(); return; }
		document.querySelector('.wm-bulk-create-popup')?.remove();
		document.querySelector('.wm-bulk-delete-popup')?.remove();
		const popup = document.body.createDiv({ cls: 'wm-plot-addchar-popup wm-plot-bulk-popup wm-plot-bulk-dropdown' });

		const root = this.plugin.settings.plotManagerFolder?.trim() ?? '';
		const charSub = this.plugin.settings.plotCharFolder?.trim() ?? '';
		const charRoot = root && charSub ? normalizePath(root + '/' + charSub) : (root || '');

		// 루트 폴더: 읽기 전용 표시만
		const rootRow = popup.createDiv({ cls: 'wm-plot-bulk-row' });
		rootRow.createEl('label', { text: '루트 폴더' });
		const rootDisplay = rootRow.createEl('span', {
			cls: 'wm-plot-addchar-root-display' + (charRoot ? '' : ' wm-plot-addchar-root-unset'),
			text: charRoot || '(미설정 — 설정에서 지정)',
		});
		void rootDisplay; // read-only, no input

		// 아이콘(왼쪽 외부) + 입력창, 아이콘 클릭 → 선택 팝업
		const makeIconRow = (label: string, placeholder: string, initVal: string, iconName: string, onIconClick: (inp: HTMLInputElement) => void): HTMLInputElement => {
			const row = popup.createDiv({ cls: 'wm-plot-bulk-row' });
			row.createEl('label', { text: label });
			const wrap = row.createDiv({ cls: 'wm-plot-addchar-input-wrap' });
			const ic = wrap.createSpan({ cls: 'wm-plot-addchar-icon clickable-icon', attr: { title: '선택' } });
			setIcon(ic, iconName);
			const inp = wrap.createEl('input', { attr: { type: 'text', placeholder, value: initVal } });
			ic.addEventListener('click', () => onIconClick(inp));
			return inp;
		};

		const subInp = makeIconRow('하위 폴더', '예: 주인공 (선택)', '', 'folder-open', (inp) => {
			new FolderSuggestModal(this.plugin.app, (folder: TFolder) => {
				const rel = charRoot && folder.path.startsWith(charRoot + '/') ? folder.path.slice(charRoot.length + 1) : folder.path;
				inp.value = rel;
			}).open();
		});

		const nameRow = popup.createDiv({ cls: 'wm-plot-bulk-row' });
		nameRow.createEl('label', { text: '캐릭터 이름' });
		const nameInp = nameRow.createEl('input', { attr: { type: 'text', placeholder: '이름 입력' } });

		const tmplInp = makeIconRow('템플릿', '예: 템플릿/인물.md', this.plugin.settings.plotCharNoteTemplate ?? '', 'file-text', (inp) => {
			new NoteSuggestModal(this.plugin.app, (file: TFile) => {
				inp.value = file.path;
			}).open();
		});

		const actions = popup.createDiv({ cls: 'wm-plot-bulk-actions' });
		const confirmBtn = actions.createEl('button', { cls: 'wm-plot-bulk-confirm', text: '추가' });

		requestAnimationFrame(() => {
			const rect = anchor.getBoundingClientRect();
			const ph = popup.getBoundingClientRect().height;
			const top = rect.bottom + 4 + ph > window.innerHeight ? rect.top - ph - 4 : rect.bottom + 4;
			popup.style.top = `${top}px`;
			popup.style.left = `${rect.left}px`;
			nameInp.focus();
		});

		const dismiss = () => popup.remove();

		confirmBtn.addEventListener('click', () => {
			fireAndForget(async () => {
				const name = nameInp.value.trim();
				if (!name) { nameInp.focus(); return; }
				this.pushStructUndo();

				const sub = subInp.value.trim();
				const folder = charRoot && sub ? normalizePath(charRoot + '/' + sub) : (charRoot || sub || '');
				const filePath = folder ? normalizePath(folder + '/' + name + '.md') : (name + '.md');

				let content = '';
				const tmplPath = tmplInp.value.trim();
				if (tmplPath) {
					const tmplFile = this.plugin.app.vault.getAbstractFileByPath(tmplPath);
					if (tmplFile instanceof TFile) {
						content = await this.plugin.app.vault.read(tmplFile);
					}
				}

				if (folder) {
					const existing = this.plugin.app.vault.getAbstractFileByPath(folder);
					if (!existing) {
						try { await this.plugin.app.vault.createFolder(folder); } catch { /* already exists */ }
					}
				}

				let file = this.plugin.app.vault.getAbstractFileByPath(filePath);
				if (!(file instanceof TFile)) {
					file = await this.plugin.app.vault.create(filePath, content);
				}

				const cfm = this.plugin.app.metadataCache.getFileCache(file as TFile)?.frontmatter;
				const color = typeof cfm?.['wikiColor'] === 'string' ? cfm['wikiColor'] : undefined;

				this.project.characters.push({ id: newId(), name, color, filePath });
				this.callbacks.onSave();
				this.render();
				dismiss();
			});
		});

		nameInp.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); }
			if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
		});

		addOutsideClickListener(popup, dismiss);
	}

	async syncCharsFromFolder() {
		const root = this.plugin.settings.plotManagerFolder?.trim() ?? '';
		const charSub = this.plugin.settings.plotCharFolder?.trim() ?? '';
		if (!root) return;
		this.pushStructUndo();
		const charFolder = charSub ? normalizePath(root + '/' + charSub) : root;

		const vault = this.plugin.app.vault;
		const charFiles = vault.getAllLoadedFiles().filter(f =>
			f instanceof TFile &&
			f.extension === 'md' &&
			(f.path.startsWith(charFolder + '/') || f.path === charFolder + '.md')
		) as TFile[];

		// Build map of existing chars by filePath
		const existingByPath = new Map<string, PlotCharacter>();
		for (const ch of this.project.characters) {
			if (ch.filePath) existingByPath.set(ch.filePath, ch);
		}

		// Add files not yet in project
		for (const file of charFiles) {
			if (!existingByPath.has(file.path)) {
				const cfm = vault.getAbstractFileByPath(file.path) instanceof TFile
					? this.plugin.app.metadataCache.getFileCache(file)?.frontmatter
					: undefined;
				const color = typeof cfm?.['wikiColor'] === 'string' ? cfm['wikiColor'] : undefined;
				this.project.characters.push({ id: newId(), name: file.basename, color, filePath: file.path });
			}
		}

		// Remove chars whose file no longer exists in this folder
		const validPaths = new Set(charFiles.map(f => f.path));
		this.project.characters = this.project.characters.filter(ch => {
			if (!ch.filePath) return true;
			// Only remove if the filePath is under the charFolder
			const underFolder = ch.filePath.startsWith(charFolder + '/') || ch.filePath === charFolder + '.md';
			return !underFolder || validPaths.has(ch.filePath);
		});

		this.callbacks.onSave();
		this.render();
	}

	// ── Private mutations ─────────────────────────────────────────────────────

	private scrollToSceneHeader(sceneId: string) {
		const th = this.wrapper.querySelector<HTMLElement>(`th[data-scene-id="${sceneId}"]`);
		if (th) th.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	private addEpisode() {
		this.addEpisodeAfter(null);
	}

	private addEpisodeAfter(afterEpId: string | null) {
		this.pushStructUndo();
		const firstScId = newId();
		const newEp: PlotEpisode = {
			id: newId(),
			name: '',
			chapters: [{ id: newId(), name: '', scenes: [{ id: firstScId, name: '' }] }],
		};
		if (afterEpId !== null) {
			const idx = this.project.episodes.findIndex(e => e.id === afterEpId);
			if (idx >= 0) {
				this.project.episodes.splice(idx + 1, 0, newEp);
			} else {
				this.project.episodes.push(newEp);
			}
		} else {
			this.project.episodes.push(newEp);
		}
		this.renumberAll();
		this.callbacks.onSave();
		this.chapterPage = this.findPageForScene(firstScId);
		this.callbacks.onPageChange?.();
		this.render();
		this.scrollToSceneHeader(firstScId);
	}

	private deleteEpisode(epId: string) {
		this.pushStructUndo();
		this.project.episodes = this.project.episodes.filter(e => e.id !== epId);
		this.renumberAll();
		this.callbacks.onSave();
		this.render();
	}

	private addChapter(epId: string) {
		this.pushStructUndo();
		const ep = this.project.episodes.find(e => e.id === epId);
		if (!ep) return;
		const firstScId = newId();
		ep.chapters.push({ id: newId(), name: '', scenes: [{ id: firstScId, name: '' }] });
		this.renumberAll();
		this.callbacks.onSave();
		this.chapterPage = this.findPageForScene(firstScId);
		this.callbacks.onPageChange?.();
		this.render();
		this.scrollToSceneHeader(firstScId);
	}

	private deleteChapter(epId: string, chId: string) {
		this.pushStructUndo();
		const ep = this.project.episodes.find(e => e.id === epId);
		if (!ep) return;
		ep.chapters = ep.chapters.filter(c => c.id !== chId);
		this.renumberAll();
		this.callbacks.onSave();
		this.render();
	}

	private addSceneForScene(sceneId: string) {
		this.pushStructUndo();
		for (const ep of this.project.episodes) {
			for (const ch of ep.chapters) {
				if (ch.scenes.some(s => s.id === sceneId)) {
					const newScId = newId();
					ch.scenes.push({ id: newScId, name: '' });
					this.renumberAll();
					this.callbacks.onSave();
					this.chapterPage = this.findPageForScene(newScId);
					this.callbacks.onPageChange?.();
					this.render();
					this.scrollToSceneHeader(newScId);
					return;
				}
			}
		}
	}

	private deleteScene(sceneId: string) {
		this.pushStructUndo();
		for (const ep of this.project.episodes) {
			for (const ch of ep.chapters) {
				const idx = ch.scenes.findIndex(s => s.id === sceneId);
				if (idx !== -1) {
					ch.scenes.splice(idx, 1);
					// A chapter with no scenes causes table misalignment (chapter th exists
					// but no scene th below it). Auto-delete the now-empty chapter.
					if (ch.scenes.length === 0) {
						ep.chapters = ep.chapters.filter(c => c.id !== ch.id);
					}
					this.renumberAll();
					this.callbacks.onSave();
					this.render();
					return;
				}
			}
		}
	}

	private applyLineStyle(line: PlotLine, tr: HTMLElement): void {
		if (line.rowHeight !== undefined) tr.style.setProperty('--plot-row-height', `${line.rowHeight}px`);
		else tr.style.removeProperty('--plot-row-height');

		if (line.fontSize !== undefined) tr.style.setProperty('--plot-row-font-size', `${line.fontSize}px`);
		else tr.style.removeProperty('--plot-row-font-size');

		if (line.fontColor) tr.style.setProperty('--plot-row-font-color', line.fontColor);
		else tr.style.removeProperty('--plot-row-font-color');

		if (line.fontColorDark) tr.style.setProperty('--plot-row-font-color-dark', line.fontColorDark);
		else tr.style.removeProperty('--plot-row-font-color-dark');

		if (line.color) tr.style.setProperty('--plot-row-bg', line.color);
		else tr.style.removeProperty('--plot-row-bg');

		if (line.colorDark) tr.style.setProperty('--plot-row-bg-dark', line.colorDark);
		else tr.style.removeProperty('--plot-row-bg-dark');
	}

	private applyCharStyle(char: PlotCharacter, tr: HTMLElement): void {
		if (char.rowHeight !== undefined) tr.style.setProperty('--plot-row-height', `${char.rowHeight}px`);
		else tr.style.removeProperty('--plot-row-height');

		if (char.fontSize !== undefined) tr.style.setProperty('--plot-row-font-size', `${char.fontSize}px`);
		else tr.style.removeProperty('--plot-row-font-size');

		if (char.fontColor) tr.style.setProperty('--plot-row-font-color', char.fontColor);
		else tr.style.removeProperty('--plot-row-font-color');

		if (char.fontColorDark) tr.style.setProperty('--plot-row-font-color-dark', char.fontColorDark);
		else tr.style.removeProperty('--plot-row-font-color-dark');

		if (char.bgColor) tr.style.setProperty('--plot-row-bg', char.bgColor);
		else tr.style.removeProperty('--plot-row-bg');

		if (char.bgColorDark) tr.style.setProperty('--plot-row-bg-dark', char.bgColorDark);
		else tr.style.removeProperty('--plot-row-bg-dark');
	}

	private openFormatPopup(
		anchor: HTMLElement,
		getSnap: () => FormatFields,
		applySnap: (f: FormatFields) => void,
		popupClass: string,
		histKey: string,
	): void {
		const existingFmt = document.querySelector(`.${popupClass}`);
		if (existingFmt) { existingFmt.remove(); return; }
		const popup = document.body.createDiv({ cls: `writing-menu-dropdown ${popupClass}` });

		if (!this.fmtHistory.has(histKey)) {
			this.fmtHistory.set(histKey, { undo: [], redo: [] });
		}
		const hist = this.fmtHistory.get(histKey)!;
		const undoStack = hist.undo;
		const redoStack = hist.redo;
		let undoBtnEl: HTMLElement | null = null;
		let redoBtnEl: HTMLElement | null = null;

		const updateBtns = () => {
			undoBtnEl?.classList.toggle('is-disabled', undoStack.length === 0);
			redoBtnEl?.classList.toggle('is-disabled', redoStack.length === 0);
		};

		const pushUndo = (before: FormatFields) => {
			undoStack.push(before);
			if (undoStack.length > 8) undoStack.shift();
			redoStack.length = 0;
			updateBtns();
		};

		const addStepper = (label: string, icon: string, val: number, step: number, min: number, onSet: (v: number) => void) => {
			const div = popup.createDiv({ cls: 'writing-menu-control wm-stepper-control' });
			const lg = div.createDiv({ cls: 'writing-menu-control-label-group' });
			const ic = lg.createSpan({ cls: 'writing-menu-icon' }); setIcon(ic, icon);
			lg.createEl('label', { text: label });
			const grp = div.createDiv({ cls: 'writing-menu-control-group wm-stepper-group' });
			const inp = grp.createEl('input', { type: 'number', value: String(val), cls: 'wm-stepper-input' });

			const change = (newVal: number) => {
				const before = getSnap();
				inp.value = String(newVal);
				onSet(newVal);
				pushUndo(before);
			};

			inp.onchange = () => change(Math.max(Number(inp.value), min));

			const minusBtn = grp.createDiv({ cls: 'clickable-icon wm-icon-btn-20' });
			setIcon(minusBtn, 'minus');
			requestAnimationFrame(() => {
				const svg = minusBtn.querySelector('svg');
				if (svg) { svg.setAttribute('width', '15'); svg.setAttribute('height', '15'); }
			});
			minusBtn.onclick = () => change(Math.max(Math.round((Number(inp.value) - step) * 100) / 100, min));

			const plusBtn = grp.createDiv({ cls: 'clickable-icon wm-icon-btn-20' });
			setIcon(plusBtn, 'plus');
			requestAnimationFrame(() => {
				const svg = plusBtn.querySelector('svg');
				if (svg) { svg.setAttribute('width', '15'); svg.setAttribute('height', '15'); }
			});
			plusBtn.onclick = () => change(Math.round((Number(inp.value) + step) * 100) / 100);
		};

		const addDualColor = (label: string, icon: string, lightVal: string, darkVal: string, onLight: (v: string) => void, onDark: (v: string) => void) => {
			const div = popup.createDiv({ cls: 'writing-menu-control' });
			const lg = div.createDiv({ cls: 'writing-menu-control-label-group' });
			const ic = lg.createSpan({ cls: 'writing-menu-icon' }); setIcon(ic, icon);
			lg.createEl('label', { text: label });
			const grp = div.createDiv({ cls: 'writing-menu-control-group wm-color-group' });
			const li = grp.createEl('input', { type: 'color', value: lightVal, cls: 'wm-compact-color-input' });
			const di = grp.createEl('input', { type: 'color', value: darkVal, cls: 'wm-compact-color-input' });
			li.onchange = () => { const before = getSnap(); onLight(li.value); pushUndo(before); };
			di.onchange = () => { const before = getSnap(); onDark(di.value); pushUndo(before); };
		};

		const renderContent = () => {
			popup.empty();
			const cur = getSnap();

			addStepper('행 높이', 'rows', cur.rowHeight ?? 140, 10, 40, (v) => applySnap({ ...getSnap(), rowHeight: v }));
			addStepper('글자 크기', 'type', cur.fontSize ?? 14, 1, 8, (v) => applySnap({ ...getSnap(), fontSize: v }));
			addDualColor('글자색', 'a-large-small',
				cur.fontColor ?? '#000000', cur.fontColorDark ?? '#ffffff',
				(v) => applySnap({ ...getSnap(), fontColor: v }),
				(v) => applySnap({ ...getSnap(), fontColorDark: v }),
			);
			addDualColor('배경색', 'paint-bucket',
				cur.bgColor ?? '#ffffff', cur.bgColorDark ?? '#1e1e1e',
				(v) => applySnap({ ...getSnap(), bgColor: v }),
				(v) => applySnap({ ...getSnap(), bgColorDark: v }),
			);

			// ── 되돌리기
			const undoDiv = popup.createDiv({ cls: 'writing-menu-control wm-plot-fmt-undo-row' });
			const undoLg = undoDiv.createDiv({ cls: 'writing-menu-control-label-group' });
			const undoIc = undoLg.createSpan({ cls: 'writing-menu-icon' }); setIcon(undoIc, 'refresh-cw');
			undoLg.createEl('label', { text: '되돌리기' });
			const undoGrp = undoDiv.createDiv({ cls: 'writing-menu-control-group' });

			undoBtnEl = undoGrp.createDiv({ cls: 'clickable-icon wm-icon-btn-20' });
			setIcon(undoBtnEl, 'arrow-left');
			undoBtnEl.addEventListener('click', () => {
				if (!undoStack.length) return;
				const c = getSnap();
				const prev = undoStack.pop()!;
				redoStack.push(c);
				applySnap(prev);
				renderContent();
			});

			const rstBtn = undoGrp.createDiv({ cls: 'clickable-icon wm-icon-btn-20' });
			setIcon(rstBtn, 'rotate-cw');
			rstBtn.addEventListener('click', () => {
				const c = getSnap();
				undoStack.push(c);
				redoStack.length = 0;
				applySnap({ rowHeight: undefined, fontSize: undefined, fontColor: undefined, fontColorDark: undefined, bgColor: undefined, bgColorDark: undefined });
				renderContent();
			});

			redoBtnEl = undoGrp.createDiv({ cls: 'clickable-icon wm-icon-btn-20' });
			setIcon(redoBtnEl, 'arrow-right');
			redoBtnEl.addEventListener('click', () => {
				if (!redoStack.length) return;
				const c = getSnap();
				const next = redoStack.pop()!;
				undoStack.push(c);
				applySnap(next);
				renderContent();
			});

			updateBtns();
		};

		renderContent();

		requestAnimationFrame(() => {
			const rect = anchor.getBoundingClientRect();
			const ph = popup.getBoundingClientRect().height;
			const pw = popup.getBoundingClientRect().width;
			const top = rect.bottom + 4 + ph > window.innerHeight ? rect.top - ph - 4 : rect.bottom + 4;
			popup.style.top = `${top}px`;
			popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - pw - 8))}px`;
		});

		addOutsideClickListener(popup, () => popup.remove());
	}

	private deletePlotLine(id: string) {
		this.pushStructUndo();
		this.project.plotLines = this.project.plotLines.filter(l => l.id !== id);
		this.callbacks.onSave();
		this.render();
	}

	private getCharImgSrc(file: TFile): string {
		const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		const fieldName = this.plugin.settings.wikiImageFieldName || 'image';
		const val = String(fm?.[fieldName] || '');
		if (!val) return '';
		if (val.startsWith('[[') && val.endsWith(']]')) {
			const linked = this.plugin.app.metadataCache.getFirstLinkpathDest(val.slice(2, -2), file.path);
			if (linked) return this.plugin.app.vault.getResourcePath(linked);
		}
		if (val.startsWith('http://') || val.startsWith('https://')) return val;
		const imgFile = this.plugin.app.vault.getAbstractFileByPath(val);
		if (imgFile instanceof TFile) return this.plugin.app.vault.getResourcePath(imgFile);
		return '';
	}

	private deleteCharacter(charId: string) {
		const char = this.project.characters.find(c => c.id === charId);
		if (!char) return;

		const doDelete = async () => {
			this.pushStructUndo();
			if (char.filePath) {
				const file = this.plugin.app.vault.getAbstractFileByPath(char.filePath);
				if (file instanceof TFile) {
					this.callbacks.onBeforeTrash?.(char.filePath);
					await this.plugin.app.vault.trash(file, true);
				}
			}
			this.project.characters = this.project.characters.filter(c => c.id !== charId);
			for (const key of Object.keys(this.project.charCells)) {
				if (key.startsWith(charId + '__')) delete this.project.charCells[key];
			}
			this.callbacks.onSave();
			this.render();
		};

		if (char.filePath && this.plugin.app.vault.getAbstractFileByPath(char.filePath) instanceof TFile) {
			new DeleteCharConfirmModal(this.plugin.app, char.name, char.filePath, () => void doDelete()).open();
		} else {
			void doDelete();
		}
	}

	openBulkCreatePopup(anchor: HTMLElement) {
		const existingCreate = document.querySelector('.wm-bulk-create-popup');
		if (existingCreate) { existingCreate.remove(); return; }
		document.querySelector('.wm-bulk-delete-popup')?.remove();
		document.querySelector('.wm-plot-addchar-popup')?.remove();

		const popup = document.body.createDiv({ cls: 'wm-bulk-create-popup wm-plot-bulk-popup wm-plot-bulk-dropdown' });

		const makeRow = (label: string, value: string) => {
			const row = popup.createDiv({ cls: 'wm-plot-bulk-row' });
			row.createEl('label', { text: label });
			const inp = row.createEl('input', { attr: { type: 'number', min: '1', max: '200', value } });
			return inp;
		};

		const totalChInput = makeRow('총 회차 수', '12');
		const perEpInput   = makeRow('에피소드당 회차 수', '4');
		const scPerChInput = makeRow('회차당 장면 수', '3');

		const infoEl = popup.createDiv({ cls: 'wm-plot-bulk-info' });
		const updateInfo = () => {
			const total = Math.max(1, parseInt(totalChInput.value) || 1);
			const perEp = Math.max(1, parseInt(perEpInput.value) || 1);
			infoEl.textContent = `에피소드 ${Math.ceil(total / perEp)}개, 회차 ${total}개`;
		};
		updateInfo();
		totalChInput.addEventListener('input', updateInfo);
		perEpInput.addEventListener('input', updateInfo);

		const actions = popup.createDiv({ cls: 'wm-plot-bulk-actions' });
		const confirmBtn = actions.createEl('button', { cls: 'wm-plot-bulk-confirm', text: '생성' });

		// Position below anchor
		requestAnimationFrame(() => {
			const rect = anchor.getBoundingClientRect();
			const ph = popup.getBoundingClientRect().height;
			const top = rect.bottom + 4 + ph > window.innerHeight ? rect.top - ph - 4 : rect.bottom + 4;
			popup.style.top = `${top}px`;
			popup.style.left = `${rect.left}px`;
		});

		const dismiss = () => popup.remove();

		confirmBtn.addEventListener('click', () => {
			const targetCh = Math.max(1, Math.min(200, parseInt(totalChInput.value) || 1));
			const perEp    = Math.max(1, Math.min(50,  parseInt(perEpInput.value)   || 1));
			const scPerCh  = Math.max(1, Math.min(20,  parseInt(scPerChInput.value) || 1));
			this.pushStructUndo();

			// Fill existing chapters that are short on scenes
			for (const ep of this.project.episodes) {
				for (const ch of ep.chapters) {
					while (ch.scenes.length < scPerCh) {
						ch.scenes.push({ id: newId(), name: '' });
					}
				}
			}

			// Add new chapters as new episodes only — never insert into existing episodes
			// (inserting into existing episodes would shift renumbered indices and scatter data)
			let toAdd = targetCh - this.project.episodes.reduce((s, ep) => s + ep.chapters.length, 0);
			while (toAdd > 0) {
				const chapters = [];
				const chInEp = Math.min(perEp, toAdd);
				for (let ci = 0; ci < chInEp; ci++) {
					const scenes = Array.from({ length: scPerCh }, () => ({ id: newId(), name: '' }));
					chapters.push({ id: newId(), name: '', scenes });
					toAdd--;
				}
				this.project.episodes.push({ id: newId(), name: '', chapters });
			}

			this.renumberAll();
			this.callbacks.onSave();
			const maxPage = Math.max(0, Math.ceil(this.project.episodes.reduce((s, ep) => s + ep.chapters.length, 0) / this.CHAPTERS_PER_PAGE) - 1);
			this.chapterPage = Math.min(this.chapterPage, maxPage);
			this.render();
			this.callbacks.onPageChange?.();
			dismiss();
		});

		addOutsideClickListener(popup, dismiss);
	}

	openBulkDeletePopup(anchor: HTMLElement) {
		const existingDelete = document.querySelector('.wm-bulk-delete-popup');
		if (existingDelete) { existingDelete.remove(); return; }
		document.querySelector('.wm-bulk-create-popup')?.remove();
		document.querySelector('.wm-plot-addchar-popup')?.remove();

		const sortedAll = this.getSortedAllChapters();
		if (sortedAll.length === 0) return;
		// Use chapter number (화 번호) for the input range so it matches what users see
		const firstNum = parseInt(sortedAll[0].ch.name) || 1;
		const lastNum  = parseInt(sortedAll[sortedAll.length - 1].ch.name) || sortedAll.length;

		const popup = document.body.createDiv({ cls: 'wm-bulk-delete-popup wm-plot-bulk-popup wm-plot-bulk-dropdown' });

		const rangeRow = popup.createDiv({ cls: 'wm-plot-bulk-row' });
		rangeRow.createEl('label', { text: '삭제 범위' });
		const rangeWrap = rangeRow.createDiv({ cls: 'wm-plot-bulk-range' });
		const fromInput = rangeWrap.createEl('input', { attr: { type: 'number', min: String(firstNum), max: String(lastNum), value: String(firstNum) } });
		rangeWrap.createEl('span', { text: '~' });
		const toInput = rangeWrap.createEl('input', { attr: { type: 'number', min: String(firstNum), max: String(lastNum), value: String(lastNum) } });
		rangeWrap.createEl('span', { text: `화`, cls: 'wm-plot-bulk-total' });

		const infoEl = popup.createDiv({ cls: 'wm-plot-bulk-info' });
		const updateInfo = () => {
			const from = parseInt(fromInput.value) || firstNum;
			const to   = parseInt(toInput.value)   || lastNum;
			const count = sortedAll.filter(({ ch }) => {
				const n = parseInt(ch.name);
				return !isNaN(n) && n >= from && n <= to;
			}).length;
			infoEl.textContent = `회차 ${count}개 삭제`;
		};
		updateInfo();
		fromInput.addEventListener('input', updateInfo);
		toInput.addEventListener('input', updateInfo);

		const actions = popup.createDiv({ cls: 'wm-plot-bulk-actions' });
		const confirmBtn = actions.createEl('button', { cls: 'wm-plot-bulk-confirm', text: '삭제' });

		// Position below anchor
		requestAnimationFrame(() => {
			const rect = anchor.getBoundingClientRect();
			const ph = popup.getBoundingClientRect().height;
			const top = rect.bottom + 4 + ph > window.innerHeight ? rect.top - ph - 4 : rect.bottom + 4;
			popup.style.top = `${top}px`;
			popup.style.left = `${rect.left}px`;
		});

		const dismiss = () => popup.remove();

		confirmBtn.addEventListener('click', () => {
			const from = parseInt(fromInput.value) || firstNum;
			const to   = parseInt(toInput.value)   || lastNum;
			if (from > to) { dismiss(); return; }
			this.pushStructUndo();

			// Delete by chapter number (화 번호) — matches what user sees on screen
			const sortedChs = this.getSortedAllChapters();
			const deletedChIds = new Set<string>();
			const deletedSceneIds = new Set<string>();
			for (const { ch } of sortedChs) {
				const n = parseInt(ch.name);
				if (!isNaN(n) && n >= from && n <= to) {
					deletedChIds.add(ch.id);
					ch.scenes.forEach(s => deletedSceneIds.add(s.id));
				}
			}

			// Remove chapters by ID
			for (const ep of this.project.episodes) {
				ep.chapters = ep.chapters.filter(ch => !deletedChIds.has(ch.id));
			}
			// Remove episodes with no chapters left
			this.project.episodes = this.project.episodes.filter(ep => ep.chapters.length > 0);

			// Clean up orphaned cells
			for (const key of Object.keys(this.project.plotCells)) {
				if (deletedSceneIds.has(key.split('__')[1])) delete this.project.plotCells[key];
			}
			for (const key of Object.keys(this.project.charCells)) {
				if (deletedSceneIds.has(key.split('__')[1])) delete this.project.charCells[key];
			}

			// Clamp current page
			const remaining = this.project.episodes.reduce((s, ep) => s + ep.chapters.length, 0);
			const maxPage = Math.max(0, Math.ceil(remaining / this.CHAPTERS_PER_PAGE) - 1);
			this.chapterPage = Math.min(this.chapterPage, maxPage);

			this.renumberAll();
			this.callbacks.onSave();
			this.render();
			this.callbacks.onPageChange?.();
			dismiss();
		});

		addOutsideClickListener(popup, dismiss);
	}

	openCharVisibilityPopup() {
		const existingVis = document.querySelector('.wm-plot-char-vis-popup');
		if (existingVis) { existingVis.remove(); return; }

		const popup = document.body.createDiv({ cls: 'wm-plot-char-vis-popup' });

		popup.createEl('h3', { cls: 'wm-plot-bulk-title', text: '선택 보기' });

		// ── 검색창 (wm-dict-search-box 스타일) + 우측 토글 아이콘 ──
		const searchBox = popup.createDiv({ cls: 'wm-plot-char-vis-search-box' });
		const searchIconEl = searchBox.createDiv({ cls: 'wm-plot-char-vis-search-icon' });
		setIcon(searchIconEl, 'search');
		const searchInput = searchBox.createEl('input', {
			cls: 'wm-plot-char-vis-search',
			attr: { type: 'text', placeholder: '인물 검색…', spellcheck: 'false' },
		});
		const toggleAllBtn = searchBox.createEl('button', { cls: 'wm-plot-char-vis-toggle-all clickable-icon' });
		const toggleIconEl = toggleAllBtn.createSpan({ cls: 'wm-plot-char-vis-toggle-icon' });

		const list = popup.createDiv({ cls: 'wm-plot-char-vis-list' });
		const checkboxes: { cb: HTMLInputElement; charId: string; item: HTMLElement; name: string }[] = [];

		for (const char of this.project.characters) {
			const item = list.createDiv({ cls: 'wm-plot-char-vis-item' });
			const cb = item.createEl('input', { attr: { type: 'checkbox' } });
			cb.checked = !this.hiddenCharIds.has(char.id);
			checkboxes.push({ cb, charId: char.id, item, name: char.name.toLowerCase() });
			item.createEl('label', { text: char.name });
			item.addEventListener('click', (e) => {
				if ((e.target as HTMLElement).tagName !== 'INPUT') {
					cb.checked = !cb.checked;
					updateToggleIcon();
				}
			});
			cb.addEventListener('change', updateToggleIcon);
		}

		const visibleCheckboxes = () => checkboxes.filter(({ item }) => item.style.display !== 'none');

		function updateToggleIcon() {
			const visible = visibleCheckboxes();
			const allChecked = visible.length > 0 && visible.every(({ cb }) => cb.checked);
			setIcon(toggleIconEl, allChecked ? 'toggle-right' : 'toggle-left');
			toggleIconEl.style.color = allChecked ? 'var(--interactive-accent)' : 'var(--text-muted)';
		}
		updateToggleIcon();

		toggleAllBtn.addEventListener('click', () => {
			const visible = visibleCheckboxes();
			const allChecked = visible.every(({ cb }) => cb.checked);
			visible.forEach(({ cb }) => { cb.checked = !allChecked; });
			updateToggleIcon();
		});

		searchInput.addEventListener('input', () => {
			const q = searchInput.value.toLowerCase();
			for (const { item, name } of checkboxes) {
				item.style.display = !q || name.includes(q) ? '' : 'none';
			}
			updateToggleIcon();
		});

		const actions = popup.createDiv({ cls: 'wm-plot-bulk-actions' });
		const confirmBtn = actions.createEl('button', { cls: 'mod-cta', text: '적용' });
		const cancelBtn  = actions.createEl('button', { text: '취소' });

		const dismiss = () => popup.remove();
		cancelBtn.addEventListener('click', dismiss);

		confirmBtn.addEventListener('click', () => {
			this.hiddenCharIds.clear();
			for (const { cb, charId } of checkboxes) {
				if (!cb.checked) this.hiddenCharIds.add(charId);
			}
			dismiss();
			this.callbacks.onHiddenCharsChange?.(this.hiddenCharIds);
			this.render();
		});

		addOutsideClickListener(popup, dismiss);
		setTimeout(() => searchInput.focus(), 50);
	}

	prevPage() {
		if (this.chapterPage > 0) {
			this.chapterPage--;
			this.render();
			this.callbacks.onPageChange?.();
		}
	}

	nextPage() {
		const total = this.project.episodes.reduce((s, ep) => s + ep.chapters.length, 0);
		const maxPage = Math.max(0, Math.ceil(total / this.CHAPTERS_PER_PAGE) - 1);
		if (this.chapterPage < maxPage) {
			this.chapterPage++;
			this.render();
			this.callbacks.onPageChange?.();
		}
	}

	getPageSceneIds(): Set<string> {
		return new Set(this.scenes.map(s => s.id));
	}

	getPageInfo(): { page: number; totalPages: number; chStart: number; chEnd: number } {
		const total = this.project.episodes.reduce((s, ep) => s + ep.chapters.length, 0);
		const totalPages = Math.max(1, Math.ceil(total / this.CHAPTERS_PER_PAGE));
		const chStart = total === 0 ? 0 : this.chapterPage * this.CHAPTERS_PER_PAGE + 1;
		const chEnd   = Math.min((this.chapterPage + 1) * this.CHAPTERS_PER_PAGE, total);
		return { page: this.chapterPage, totalPages, chStart, chEnd };
	}

	private getSortedAllChapters() {
		// Use episode ARRAY ORDER as the canonical episode order (maintained by insertion and
		// by PlotManager.load() sorting on startup). Within each episode, sort existing chapters
		// by number; new/unnamed chapters (name='') go to the end of their episode. This gives
		// insertion semantics: addChapter to ep1 inserts after ep1's last chapter, shifting ep2+.
		return this.project.episodes.flatMap(ep => {
			const sorted = [...ep.chapters].sort((a, b) => {
				const na = parseInt(a.name);
				const nb = parseInt(b.name);
				if (isNaN(na) && isNaN(nb)) return 0;
				if (isNaN(na)) return 1;
				if (isNaN(nb)) return -1;
				return na - nb;
			});
			return sorted.map(ch => ({ ep, ch }));
		});
	}

	private getPageScenes(): { visibleEps: PlotEpisode[]; scenes: PlotScene[] } {
		const allChs = this.getSortedAllChapters();
		const start = this.chapterPage * this.CHAPTERS_PER_PAGE;
		const pageChPairs = allChs.slice(start, start + this.CHAPTERS_PER_PAGE);
		const pageChIds = new Set(pageChPairs.map(p => p.ch.id));

		// Track first occurrence index in pageChPairs to preserve column order
		const epFirstIdx = new Map<string, number>();
		pageChPairs.forEach(({ ep }, i) => { if (!epFirstIdx.has(ep.id)) epFirstIdx.set(ep.id, i); });

		const visibleEps: PlotEpisode[] = this.project.episodes
			.filter(ep => epFirstIdx.has(ep.id))
			.map(ep => ({
				...ep,
				chapters: ep.chapters
					.filter(ch => pageChIds.has(ch.id))
					.sort((a, b) => (parseInt(a.name) || Infinity) - (parseInt(b.name) || Infinity)),
			}))
			.sort((a, b) => (epFirstIdx.get(a.id) ?? 0) - (epFirstIdx.get(b.id) ?? 0));

		const scenes: PlotScene[] = visibleEps.flatMap(ep => ep.chapters.flatMap(ch => ch.scenes));
		return { visibleEps, scenes };
	}

	private findPageForScene(sceneId: string): number {
		const allChs = this.getSortedAllChapters();
		for (let i = 0; i < allChs.length; i++) {
			if (allChs[i].ch.scenes.some(s => s.id === sceneId)) {
				return Math.floor(i / this.CHAPTERS_PER_PAGE);
			}
		}
		return this.chapterPage;
	}

	scrollToChapter(query: string) {
		const q = query.trim();
		if (!q) return;
		const allChs = this.getSortedAllChapters();
		const idx = allChs.findIndex(({ ch }) =>
			ch.name === q || ch.name.includes(q)
		);
		if (idx === -1) return;
		const targetPage = Math.floor(idx / this.CHAPTERS_PER_PAGE);
		if (targetPage !== this.chapterPage) {
			this.chapterPage = targetPage;
			this.callbacks.onPageChange?.();
			this.render();
		}
		requestAnimationFrame(() => {
			const ch = allChs[idx].ch;
			const th = this.wrapper.querySelector<HTMLElement>(`[data-ch-id="${ch.id}"]`);
			if (!th) return;
			th.scrollIntoView({ block: 'nearest', inline: 'center' });
			// Flash highlight: chapter header + all its scene headers
			const flash = (el: HTMLElement) => {
				el.classList.remove('wm-plot-ch-flash');
				void el.offsetWidth;
				el.classList.add('wm-plot-ch-flash');
				window.setTimeout(() => el.classList.remove('wm-plot-ch-flash'), 1200);
			};
			flash(th);
			for (const sc of allChs[idx].ch.scenes) {
				const scTh = this.wrapper.querySelector<HTMLElement>(`[data-scene-id="${sc.id}"]`);
				if (scTh) flash(scTh);
			}
		});
	}

	destroy() {
		document.querySelector('.wm-plot-palette-popup')?.remove();
		document.querySelector('.wm-bulk-create-popup')?.remove();
		document.querySelector('.wm-bulk-delete-popup')?.remove();
		document.querySelector('.wm-plot-addchar-popup')?.remove();
		document.querySelector('.wm-plot-char-vis-popup')?.remove();
		if (this.scrollRafId !== null) cancelAnimationFrame(this.scrollRafId);
		if (this.reorderRafId !== null) cancelAnimationFrame(this.reorderRafId);
		this.fmtHistory.clear();
		this.wrapper.empty();
	}
}
