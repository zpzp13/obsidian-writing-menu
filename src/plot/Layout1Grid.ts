import { setIcon, TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { PlotProject, PlotLine, PlotScene, PlotEpisode, PlotCharacter } from './PlotTypes';
import { CellSelection, newId } from './PlotTypes';
import { CharacterNoteModal } from './CharacterNoteModal';

interface Layout1Callbacks {
	onSave(): void;
	onCellSelect(selection: CellSelection): void;
	onPageChange?(): void;
	onHiddenCharsChange?(hidden: Set<string>): void;
}

interface GridCell {
	el: HTMLElement;
	r: number;
	c: number;
	rowKind: 'plotLine' | 'char';
	rowId: string;
	sceneId: string;
}

const PALETTE = ['#e74c3c','#e67e22','#f39c12','#27ae60','#2980b9','#8e44ad','#16a085','#d63384'];

function hexToRgb(hex: string): [number, number, number] | null {
	if (!hex.startsWith('#') || hex.length !== 7) return null;
	return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function isDark(): boolean {
	return document.body.classList.contains('theme-dark');
}

function applyLabelColor(el: HTMLElement, hex: string) {
	const rgb = hexToRgb(hex);
	if (rgb) {
		const a = isDark() ? 0.6 : 0.35;
		el.style.background = `linear-gradient(rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a}), rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})), var(--background-secondary)`;
	} else {
		el.style.backgroundColor = hex;
	}
}

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

	constructor(
		private container: HTMLElement,
		private project: PlotProject,
		private plugin: WritingMenuPlugin,
		private callbacks: Layout1Callbacks,
		private hiddenCharIds: Set<string> = new Set<string>(),
	) {
		this.wrapper = container.createDiv({ cls: 'wm-plot-table-wrapper' });
		this.wrapper.setAttribute('tabindex', '-1');
		this.wrapper.addEventListener('keydown', this.onKeydown);
	}

	render() {
		// Preserve selection before clearing
		const prevSelected = this.selectedCell
			? { rowKind: this.selectedCell.rowKind, rowId: this.selectedCell.rowId, sceneId: this.selectedCell.sceneId }
			: null;

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

		if (this.project.characters.length > 0) {
			this.renderCharDivider(table);
			this.renderCharTbody(table);
		}

		// Restore selection after re-render — no scroll so viewport doesn't jump
		if (prevSelected) {
			for (const row of this.cellGrid) {
				if (!row) continue;
				for (const cell of row) {
					if (!cell) continue;
					if (cell.rowKind === prevSelected.rowKind && cell.rowId === prevSelected.rowId && cell.sceneId === prevSelected.sceneId) {
						this.applySelection(cell, false);
						return;
					}
				}
			}
		}
	}

	getTableEl(): HTMLElement { return this.wrapper; }

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
				addEpBtn.addEventListener('click', (e) => { e.stopPropagation(); this.addEpisode(); });
			}
			const delEpBtn = epAct.createEl('button', { cls: 'wm-plot-act-btn wm-plot-act-del', attr: { title: '에피소드 삭제' } });
			setIcon(delEpBtn, 'x');
			delEpBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteEpisode(ep.id); });
		}
		// If no episodes, add an add-episode button in the empty area
		if (this.project.episodes.length === 0) {
			const th = epRow.createEl('th');
			const btn = th.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '에피소드 추가' } });
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
		if (this.project.episodes.length === 0) chRow.createEl('th');

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
		if (scenes.length === 0) scRow.createEl('th', { text: '(장면 없음)' });
	}

	// ── Plot line tbody ───────────────────────────────────────────────────────

	private renderPlotTbody(table: HTMLTableElement) {
		const scenes = this.scenes;
		const tbody = table.createEl('tbody');

		let rowIdx = this.cellGrid.length;

		for (const line of this.project.plotLines) {
			this.cellGrid[rowIdx] = [];
			const tr = tbody.createEl('tr');
			const rowColor = line.color;

			// Sticky label cell — tinted gradient adapts to light/dark mode
			const labelTd = tr.createEl('td', { cls: 'wm-plot-sticky-col' });
			if (rowColor) applyLabelColor(labelTd, rowColor);

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

				const td = tr.createEl('td', { attr: { colspan: String(Math.max(scenes.length, 1)) } });
				td.addClass('wm-plot-collapsed-row');
				if (rowColor) td.style.backgroundColor = rowColor + (isDark() ? '55' : '28');
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

			const labelAct = labelInner.createDiv({ cls: 'wm-plot-label-actions' });

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

			const paletteBtn = labelAct.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '행 색상' } });
			setIcon(paletteBtn, 'palette');
			paletteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.openColorPalette(paletteBtn, (color) => {
					line.color = color || undefined;
					this.callbacks.onSave();
					this.render();
				}, line.color);
			});

			const delBtn = labelAct.createEl('button', { cls: 'wm-plot-act-btn wm-plot-act-del', attr: { title: '삭제' } });
			setIcon(delBtn, 'trash-2');
			delBtn.addEventListener('click', () => this.deletePlotLine(line.id));

			if (scenes.length === 0) {
				tr.createEl('td', { cls: 'wm-plot-cell' })
					.createDiv({ cls: 'wm-plot-cell-inner' })
					.createSpan({ text: '에피소드와 장면을 추가하세요', cls: 'wm-plot-cell-text' });
			} else {
				for (let c = 0; c < scenes.length; c++) {
					const sc = scenes[c];
					const td = this.renderPlotCell(tr, line, sc, rowColor);
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

	private renderPlotCell(tr: HTMLTableRowElement, line: PlotLine, sc: PlotScene, rowColor: string | undefined): HTMLElement {
		const key = `${line.id}__${sc.id}`;
		const cell = this.project.plotCells[key];
		const td = tr.createEl('td', { cls: 'wm-plot-cell' });
		if (cell) td.addClass('is-filled');
		if (rowColor) td.style.backgroundColor = rowColor + '28';

		const inner = td.createDiv({ cls: 'wm-plot-cell-inner' });
		if (cell) {
			inner.setAttribute('draggable', 'true');
			inner.createDiv({ cls: 'wm-plot-cell-text', text: cell.content ?? '' });
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

		const textarea = td.createEl('textarea', { cls: 'wm-plot-cell-editor' });
		textarea.setAttribute('spellcheck', 'false');
		textarea.value = cell?.content || '';
		textarea.focus();

		const save = () => {
			const val = textarea.value.trim();
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
			if (e.key === 'Escape') { e.preventDefault(); this.render(); }
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
			if (!isHidden) this.cellGrid[rowIdx] = [];
			const rowColor = char.color;

			const labelTd = tr.createEl('td', { cls: 'wm-plot-sticky-col' });
			if (rowColor) applyLabelColor(labelTd, rowColor);

			const labelInner = labelTd.createDiv({ cls: 'wm-plot-label wm-plot-char-label' });

			// 프로필 이미지 — 셀 전체 배경에 반투명 오버레이로
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

			const nameSpan = labelInner.createEl('span', { text: char.name, cls: 'wm-plot-char-name' });

			const labelAct = labelInner.createDiv({ cls: 'wm-plot-label-actions' });

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

			const openNoteBtn = labelAct.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '노트 열기' } });
			setIcon(openNoteBtn, 'external-link');
			openNoteBtn.addEventListener('click', () => {
				resolveCharFile((f) => {
					const mode = this.plugin.settings.plotCharNoteOpenMode ?? 'tab';
					void this.plugin.app.workspace.getLeaf(mode === 'window' ? 'window' : 'tab').openFile(f);
				});
			});

			const wikiViewBtn = labelAct.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '위키 뷰' } });
			setIcon(wikiViewBtn, 'git-graph');
			wikiViewBtn.addEventListener('click', () => {
				resolveCharFile((f) => void this.plugin.openFileInWiki(f));
			});

			const paletteBtn = labelAct.createEl('button', { cls: 'wm-plot-act-btn', attr: { title: '행 색상' } });
			setIcon(paletteBtn, 'palette');
			paletteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.openColorPalette(paletteBtn, (color) => {
					void this.updateCharColor(char, color || undefined);
				}, char.color);
			});

			const delBtn = labelAct.createEl('button', { cls: 'wm-plot-act-btn wm-plot-act-del', attr: { title: '삭제' } });
			setIcon(delBtn, 'trash-2');
			delBtn.addEventListener('click', () => this.deleteCharacter(char.id));

			if (scenes.length === 0) {
				tr.createEl('td', { cls: 'wm-plot-cell wm-plot-char-cell' });
			} else {
				for (let c = 0; c < scenes.length; c++) {
					const sc = scenes[c];
					const td = this.renderCharCell(tr, char, sc, rowColor);
					const gcell: GridCell = { el: td, r: isHidden ? -1 : rowIdx, c, rowKind: 'char', rowId: char.id, sceneId: sc.id };
					if (!isHidden) this.cellGrid[rowIdx][c] = gcell;

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
			if (!isHidden) rowIdx++;
		}
	}

	private renderCharCell(tr: HTMLTableRowElement, char: PlotCharacter, sc: PlotScene, rowColor: string | undefined): HTMLElement {
		const key = `${char.id}__${sc.id}`;
		const cell = this.project.charCells[key];
		const td = tr.createEl('td', { cls: 'wm-plot-cell wm-plot-char-cell' });
		if (cell?.content) td.addClass('is-filled');
		if (rowColor) td.style.backgroundColor = rowColor + '28';

		const inner = td.createDiv({ cls: 'wm-plot-cell-inner' });
		if (cell?.content) {
			inner.setAttribute('draggable', 'true');
			inner.createDiv({ cls: 'wm-plot-cell-text', text: cell.content });
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

		const textarea = td.createEl('textarea', { cls: 'wm-plot-cell-editor' });
		textarea.setAttribute('spellcheck', 'false');
		textarea.value = cell?.content || '';
		textarea.focus();

		const save = () => {
			const val = textarea.value.trim();
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
			if (e.key === 'Escape') { e.preventDefault(); this.render(); }
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
		});
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
		this.wrapper.focus({ preventScroll: true });
		if (cell.rowKind === 'plotLine') {
			// Defer char reorder + visibility update to the next frame so keyboard nav stays snappy
			requestAnimationFrame(() => {
				if (this.selectedCell === cell) {
					this.reorderCharsByColumn(cell.c);
					this.updateHiddenCharVisibility(cell.sceneId);
				}
			});
		} else {
			this.updateHiddenCharVisibility(null);
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

	private clearSelection() {
		if (this.cellSelectDebounce) { clearTimeout(this.cellSelectDebounce); this.cellSelectDebounce = null; }
		this.selectedCell?.el.classList.remove('is-selected');
		this.selectedCell = null;
		this.lastReorderedCol = -1;
		this.restoreCharOrder();
		this.updateHiddenCharVisibility(null);
		this.callbacks.onCellSelect(null);
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
		// Skip collapsed rows (empty cellGrid entries) when moving vertically
		if (dr !== 0) {
			while (targetR >= 0 && targetR < rows) {
				const row = this.cellGrid[targetR];
				if (row && row.length > 0) break;
				targetR += dr;
			}
			if (targetR < 0 || targetR >= rows) return;
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
		const pos = center ? 'center' : 'nearest';
		el.scrollIntoView({ block: pos as ScrollLogicalPosition, inline: pos as ScrollLogicalPosition });
		if (!center) {
			// Correct for sticky header overlap only in nearest mode
			requestAnimationFrame(() => {
				const section = this.wrapper.closest('.wm-plot-section') as HTMLElement | null;
				if (!section) return;
				const STICKY_H = 112; // 48 (ep) + 32 (ch) + 32 (sc)
				const sRect = section.getBoundingClientRect();
				const cRect = el.getBoundingClientRect();
				if (cRect.top < sRect.top + STICKY_H) {
					section.scrollTop -= (sRect.top + STICKY_H - cRect.top) + 2;
				}
			});
		}
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
	}

	private restoreCharOrder() {
		if (this.charTbodyRows.length === 0 || !this.charsTbody) return;
		for (const tr of this.charTbodyRows) {
			this.charsTbody.appendChild(tr);
		}
	}

	private readonly onKeydown = (e: KeyboardEvent) => {
		if (!this.selectedCell) return;
		// When a textarea (cell editor) is active, let all keys pass through natively.
		// Arrow keys should move the cursor, Shift+Arrow should select text, etc.
		// Only re-enable cell navigation after the editor commits (Enter/Escape).
		if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;

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
			case 'ArrowRight': e.preventDefault(); this.navigateTo(r, c + 1, 0);  break;
			case 'ArrowLeft':  e.preventDefault(); this.navigateTo(r, c - 1, 0);  break;
			case 'ArrowDown':  e.preventDefault(); this.navigateTo(r + 1, c, 1);  break;
			case 'ArrowUp':    e.preventDefault(); this.navigateTo(r - 1, c, -1); break;
			case 'Enter':      e.preventDefault(); this.editSelectedCell(); break;
			case 'Escape':     e.preventDefault(); this.clearSelection(); break;
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

	// ── Color palette ─────────────────────────────────────────────────────────

	private openColorPalette(anchor: HTMLElement, onPick: (color: string | null) => void, current?: string) {
		document.querySelector('.wm-plot-palette-popup')?.remove();

		const rect = anchor.getBoundingClientRect();
		const popup = document.body.createDiv({ cls: 'wm-plot-palette-popup' });
		popup.style.position = 'fixed';
		popup.style.top = `${rect.bottom + 4}px`;
		popup.style.left = `${rect.left}px`;
		popup.style.zIndex = '10000';
		// After render, flip above anchor if popup overflows viewport bottom
		requestAnimationFrame(() => {
			const popupH = popup.getBoundingClientRect().height;
			if (rect.bottom + 4 + popupH > window.innerHeight) {
				popup.style.top = `${rect.top - popupH - 4}px`;
			}
		});

		const clearBtn = popup.createDiv({ cls: 'wm-plot-palette-clear', text: '없음' });
		clearBtn.addEventListener('click', () => { popup.remove(); onPick(null); });

		const grid = popup.createDiv({ cls: 'wm-plot-palette-grid' });
		for (const color of PALETTE) {
			const swatch = grid.createDiv({ cls: 'wm-plot-palette-swatch' + (current === color ? ' is-active' : '') });
			swatch.style.background = color;
			swatch.addEventListener('click', () => { popup.remove(); onPick(color); });
		}

		// Custom color picker
		const customRow = popup.createDiv({ cls: 'wm-plot-palette-custom' });
		customRow.createEl('span', { cls: 'wm-plot-palette-custom-label', text: '직접 선택' });
		const colorInp = customRow.createEl('input', {
			cls: 'wm-plot-palette-custom-input',
			attr: { type: 'color', value: current ?? '#3498db' },
		}) as HTMLInputElement;
		colorInp.addEventListener('click', (e) => e.stopPropagation());
		colorInp.addEventListener('change', () => { popup.remove(); onPick(colorInp.value); });

		const outsideHandler = (e: MouseEvent) => {
			if (!popup.contains(e.target as Node)) {
				popup.remove();
				document.removeEventListener('click', outsideHandler, true);
			}
		};
		setTimeout(() => document.addEventListener('click', outsideHandler, true), 0);
	}

	// ── Episode subtitle input ────────────────────────────────────────────────

	private openSubtitleInput(ep: PlotEpisode, anchor: HTMLElement) {
		document.querySelector('.wm-plot-subtitle-popup')?.remove();
		const rect = anchor.getBoundingClientRect();
		const popup = document.body.createDiv({ cls: 'wm-plot-subtitle-popup' });
		popup.style.position = 'fixed';
		popup.style.top = `${rect.bottom + 4}px`;
		popup.style.left = `${Math.max(4, rect.left - 80)}px`;
		popup.style.zIndex = '10000';

		const input = popup.createEl('input', { cls: 'wm-plot-subtitle-input', attr: { type: 'text', placeholder: '소제목 입력…', spellcheck: 'false' } }) as HTMLInputElement;
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
			if (e.key === 'Escape') { e.preventDefault(); popup.remove(); }
		});
		input.focus();
		input.select();
	}

	// ── Wiki color sync ───────────────────────────────────────────────────────

	private async updateCharColor(char: PlotCharacter, color: string | undefined) {
		char.color = color;
		if (char.filePath) {
			const file = this.plugin.app.vault.getAbstractFileByPath(char.filePath);
			if (file instanceof TFile) {
				await this.plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					if (color) { fm['wikiColor'] = color; } else { delete fm['wikiColor']; }
				});
			}
		}
		this.callbacks.onSave();
		this.render();
	}

	// ── Renumbering ──────────────────────────────────────────────────────────

	private renumberAll() {
		this.project.episodes.forEach((ep, i) => { ep.name = `EPISODE ${i + 1}`; });
		let globalCh = 0;
		for (const ep of this.project.episodes) {
			for (const ch of ep.chapters) {
				globalCh++;
				ch.name = `${globalCh}화`;
				let localSc = 0;
				for (const sc of ch.scenes) {
					localSc++;
					sc.name = `${globalCh}-${localSc}`;
				}
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

	addPlotLine() {
		const n = this.project.plotLines.length + 1;
		this.project.plotLines.push({ id: newId(), name: `플롯 라인 ${n}`, collapsed: false });
		this.callbacks.onSave();
		this.render();
	}

	addCharacter() {
		new CharacterNoteModal(this.plugin, (name, filePath) => {
			let color: string | undefined;
			if (filePath) {
				const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
				if (file instanceof TFile) {
					const cfm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
					if (typeof cfm?.['wikiColor'] === 'string') color = cfm['wikiColor'];
				}
			}
			this.project.characters.push({ id: newId(), name, color, ...(filePath ? { filePath } : {}) });
			this.callbacks.onSave();
			this.render();
		}).open();
	}

	// ── Private mutations ─────────────────────────────────────────────────────

	private scrollToSceneHeader(sceneId: string) {
		const th = this.wrapper.querySelector<HTMLElement>(`th[data-scene-id="${sceneId}"]`);
		if (th) th.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	private addEpisode() {
		const chId = newId();
		const firstScId = newId();
		const ep: PlotEpisode = {
			id: newId(),
			name: '',
			chapters: [{ id: chId, name: '', scenes: [{ id: firstScId, name: '' }] }],
		};
		this.project.episodes.push(ep);
		this.renumberAll();
		this.callbacks.onSave();
		this.chapterPage = this.findPageForScene(firstScId);
		this.callbacks.onPageChange?.();
		this.render();
		this.scrollToSceneHeader(firstScId);
	}

	private deleteEpisode(epId: string) {
		this.project.episodes = this.project.episodes.filter(e => e.id !== epId);
		this.renumberAll();
		this.callbacks.onSave();
		this.render();
	}

	private addChapter(epId: string) {
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
		const ep = this.project.episodes.find(e => e.id === epId);
		if (!ep) return;
		ep.chapters = ep.chapters.filter(c => c.id !== chId);
		this.renumberAll();
		this.callbacks.onSave();
		this.render();
	}

	private addSceneForScene(sceneId: string) {
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
		for (const ep of this.project.episodes) {
			for (const ch of ep.chapters) {
				const idx = ch.scenes.findIndex(s => s.id === sceneId);
				if (idx !== -1) {
					ch.scenes.splice(idx, 1);
					this.renumberAll();
					this.callbacks.onSave();
					this.render();
					return;
				}
			}
		}
	}

	private deletePlotLine(id: string) {
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
		this.project.characters = this.project.characters.filter(c => c.id !== charId);
		for (const key of Object.keys(this.project.charCells)) {
			if (key.startsWith(charId + '__')) delete this.project.charCells[key];
		}
		this.callbacks.onSave();
		this.render();
	}

	openBulkCreatePopup(anchor: HTMLElement) {
		document.querySelector('.wm-plot-bulk-popup')?.remove();

		const popup = document.body.createDiv({ cls: 'wm-plot-bulk-popup wm-plot-bulk-dropdown' });
		popup.style.position = 'fixed';
		popup.style.zIndex = '10001';

		const makeRow = (label: string, value: string) => {
			const row = popup.createDiv({ cls: 'wm-plot-bulk-row' });
			row.createEl('label', { text: label });
			const inp = row.createEl('input', { attr: { type: 'number', min: '1', max: '200', value } }) as HTMLInputElement;
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

			// Fill existing chapters that are short on scenes
			for (const ep of this.project.episodes) {
				for (const ch of ep.chapters) {
					while (ch.scenes.length < scPerCh) {
						ch.scenes.push({ id: newId(), name: '' });
					}
				}
			}

			// Add new chapters/episodes until we reach the target
			let toAdd = targetCh - this.project.episodes.reduce((s, ep) => s + ep.chapters.length, 0);
			if (toAdd > 0) {
				// First fill existing episodes up to perEp chapters each
				for (const ep of this.project.episodes) {
					while (ep.chapters.length < perEp && toAdd > 0) {
						const scenes = Array.from({ length: scPerCh }, () => ({ id: newId(), name: '' }));
						ep.chapters.push({ id: newId(), name: '', scenes });
						toAdd--;
					}
				}
				// Then add new episodes for any remaining
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
			}

			this.renumberAll();
			this.callbacks.onSave();
			const maxPage = Math.max(0, Math.ceil(this.project.episodes.reduce((s, ep) => s + ep.chapters.length, 0) / this.CHAPTERS_PER_PAGE) - 1);
			this.chapterPage = Math.min(this.chapterPage, maxPage);
			this.render();
			this.callbacks.onPageChange?.();
			dismiss();
		});

		const outsideHandler = (e: MouseEvent) => {
			if (!popup.contains(e.target as Node)) {
				dismiss();
				document.removeEventListener('click', outsideHandler, true);
			}
		};
		setTimeout(() => document.addEventListener('click', outsideHandler, true), 0);
	}

	openBulkDeletePopup(anchor: HTMLElement) {
		document.querySelector('.wm-plot-bulk-popup')?.remove();

		const totalChs = this.project.episodes.reduce((s, ep) => s + ep.chapters.length, 0);
		if (totalChs === 0) return;

		const popup = document.body.createDiv({ cls: 'wm-plot-bulk-popup wm-plot-bulk-dropdown' });
		popup.style.position = 'fixed';
		popup.style.zIndex = '10001';

		const rangeRow = popup.createDiv({ cls: 'wm-plot-bulk-row' });
		rangeRow.createEl('label', { text: '삭제 범위' });
		const rangeWrap = rangeRow.createDiv({ cls: 'wm-plot-bulk-range' });
		const fromInput = rangeWrap.createEl('input', { attr: { type: 'number', min: '1', max: String(totalChs), value: '1' } }) as HTMLInputElement;
		rangeWrap.createEl('span', { text: '~' });
		const toInput = rangeWrap.createEl('input', { attr: { type: 'number', min: '1', max: String(totalChs), value: String(totalChs) } }) as HTMLInputElement;
		rangeWrap.createEl('span', { text: `/ ${totalChs}화`, cls: 'wm-plot-bulk-total' });

		const infoEl = popup.createDiv({ cls: 'wm-plot-bulk-info' });
		const updateInfo = () => {
			const from = Math.max(1, parseInt(fromInput.value) || 1);
			const to = Math.min(totalChs, parseInt(toInput.value) || totalChs);
			infoEl.textContent = `회차 ${Math.max(0, to - from + 1)}개 삭제`;
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
			const from = Math.max(1, parseInt(fromInput.value) || 1);
			const to   = Math.min(totalChs, parseInt(toInput.value) || totalChs);
			if (from > to) { dismiss(); return; }

			// Collect deleted scene IDs before removing chapters
			const deletedSceneIds = new Set<string>();
			let globalChIdx = 0;
			for (const ep of this.project.episodes) {
				for (const ch of ep.chapters) {
					globalChIdx++;
					if (globalChIdx >= from && globalChIdx <= to) {
						ch.scenes.forEach(s => deletedSceneIds.add(s.id));
					}
				}
			}

			// Remove chapters in range
			globalChIdx = 0;
			for (const ep of this.project.episodes) {
				ep.chapters = ep.chapters.filter(() => {
					globalChIdx++;
					return globalChIdx < from || globalChIdx > to;
				});
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

		const outsideHandler = (e: MouseEvent) => {
			if (!popup.contains(e.target as Node)) {
				dismiss();
				document.removeEventListener('click', outsideHandler, true);
			}
		};
		setTimeout(() => document.addEventListener('click', outsideHandler, true), 0);
	}

	openCharVisibilityPopup() {
		document.querySelector('.wm-plot-char-vis-popup')?.remove();

		const popup = document.body.createDiv({ cls: 'wm-plot-char-vis-popup' });
		popup.style.position = 'fixed';
		popup.style.top = '50%';
		popup.style.left = '50%';
		popup.style.transform = 'translate(-50%, -50%)';
		popup.style.zIndex = '10001';

		popup.createEl('h3', { cls: 'wm-plot-bulk-title', text: '선택 보기' });

		// ── 검색창 (wm-dict-search-box 스타일) + 우측 토글 아이콘 ──
		const searchBox = popup.createDiv({ cls: 'wm-plot-char-vis-search-box' });
		const searchIconEl = searchBox.createDiv({ cls: 'wm-plot-char-vis-search-icon' });
		setIcon(searchIconEl, 'search');
		const searchInput = searchBox.createEl('input', {
			cls: 'wm-plot-char-vis-search',
			attr: { type: 'text', placeholder: '인물 검색…', spellcheck: 'false' },
		}) as HTMLInputElement;
		const toggleAllBtn = searchBox.createEl('button', { cls: 'wm-plot-char-vis-toggle-all clickable-icon' });
		const toggleIconEl = toggleAllBtn.createSpan({ cls: 'wm-plot-char-vis-toggle-icon' });

		const list = popup.createDiv({ cls: 'wm-plot-char-vis-list' });
		const checkboxes: { cb: HTMLInputElement; charId: string; item: HTMLElement; name: string }[] = [];

		for (const char of this.project.characters) {
			const item = list.createDiv({ cls: 'wm-plot-char-vis-item' });
			const cb = item.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
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

		const outsideHandler = (e: MouseEvent) => {
			if (!popup.contains(e.target as Node)) {
				dismiss();
				document.removeEventListener('click', outsideHandler, true);
			}
		};
		setTimeout(() => document.addEventListener('click', outsideHandler, true), 0);
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
		// Sort by 화 number in chapter name so pagination order matches display order
		// regardless of episode array order (e.g. alphabetical file loading)
		const allChs = this.project.episodes.flatMap(ep => ep.chapters.map(ch => ({ ep, ch })));
		allChs.sort((a, b) => (parseInt(a.ch.name) || Infinity) - (parseInt(b.ch.name) || Infinity));
		return allChs;
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
		document.querySelector('.wm-plot-bulk-popup')?.remove();
		document.querySelector('.wm-plot-char-vis-popup')?.remove();
		this.wrapper.empty();
	}
}
