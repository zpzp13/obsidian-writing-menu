import { ItemView, WorkspaceLeaf, setIcon, normalizePath, TAbstractFile, Notice } from 'obsidian';
import { FolderSuggestModal } from '../wiki/WikiModals';
import type WritingMenuPlugin from '../../main';
import { PLOT_VIEW_TYPE, PLOT_TIMELINE_VIEW_TYPE } from './PlotTypes';
import type { PlotProject, CellSelection } from './PlotTypes';
import { PlotManager } from './PlotManager';
import { Layout1Grid } from './Layout1Grid';
import type { PlotTimelineView } from './PlotTimelineView';
import { addOutsideClickListener, openChapterSearchPopup } from './PlotUtils';
import { fireAndForget } from '../utils/asyncUtils';

export { PLOT_VIEW_TYPE };

export class PlotManagerView extends ItemView {
	private plotManager: PlotManager;
	private project: PlotProject | null = null;
	private grid: Layout1Grid | null = null;
	private hiddenCharIds = new Set<string>();
	private lastSelection: CellSelection = null;
	private zoom = 1.0;
	private zoomLabelEl: HTMLElement | null = null;
	private pageLabel: HTMLElement | null = null;
	private _suppressDeletePath: string | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: WritingMenuPlugin) {
		super(leaf);
	}

	getViewType(): string { return PLOT_VIEW_TYPE; }
	getDisplayText(): string { return '플롯 매니저'; }
	getIcon(): string { return 'network'; }

	async onOpen() {
		this.plotManager = new PlotManager(this.plugin);
		this.hiddenCharIds = new Set(this.plugin.settings.plotHiddenCharIds ?? []);
		this.project = await this.plotManager.load();
		if (this.project.episodes.length === 0) {
			const defaults = this.plotManager.createEmptyProject();
			this.project.episodes = defaults.episodes;
			await this.plotManager.save(this.project);
		}
		this.render();

		// Global event listeners — registered once per view lifecycle (not per render)
		const contentEl = this.containerEl.children[1] as HTMLElement;

		this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
			if (e.shiftKey && e.key === 'F') {
				const active = document.activeElement;
				const isEditing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
				const isInView = contentEl.contains(active);
				const isActiveView = this.app.workspace.getActiveViewOfType(PlotManagerView) === this;
				if (!isEditing && (isInView || isActiveView)) {
					e.preventDefault();
					this.openChapterSearch();
				}
			}
		});
		this.registerDomEvent(contentEl, 'wheel', (e: WheelEvent) => {
			if (!e.ctrlKey) return;
			e.preventDefault();
			this.applyZoom(this.zoom - e.deltaY * 0.001);
		}, { passive: false });

		// Reload when plot folder files change
		this.registerEvent(
			this.app.vault.on('delete', (file: TAbstractFile) => {
				// Skip reload when deletion was triggered internally (e.g. deleteCharacter)
				if (this._suppressDeletePath && normalizePath(file.path) === normalizePath(this._suppressDeletePath)) {
					this._suppressDeletePath = null;
					return;
				}
				const folder = (this.plugin.settings.plotManagerFolder ?? '').trim();
				if (!folder) return;
				const folderPath = normalizePath(folder);
				if (file.path.startsWith(folderPath + '/') || file.path === folderPath) {
					void this.reload();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				const folder = (this.plugin.settings.plotManagerFolder ?? '').trim();
				if (!folder) return;
				const folderPath = normalizePath(folder);
				// 폴더 자체가 이름 변경된 경우 — 설정 경로를 새 경로로 갱신
				if (normalizePath(oldPath) === folderPath) {
					this.plugin.settings.plotManagerFolder = file.path;
					void this.plugin.saveSettings();
					void this.reload();
					return;
				}
				if (oldPath.startsWith(folderPath + '/')) {
					void this.reload();
					return;
				}
				// 인물 노트 경로 갱신 — 이름 변경 시 filePath 자동 업데이트
				if (this.project) {
					let changed = false;
					for (const char of this.project.characters) {
						if (char.filePath && normalizePath(char.filePath) === normalizePath(oldPath)) {
							char.filePath = file.path;
							changed = true;
						}
					}
					if (changed) {
						void this.plotManager.save(this.project);
						this.render();
					}
				}
			})
		);
		// 테마 전환 시 row 색상 opacity를 재계산하기 위해 re-render
		this.registerEvent(
			this.app.workspace.on('css-change', () => { this.render(); })
		);
	}

	async onClose() {
		this.grid?.destroy();
	}

	private async reload() {
		this.project = await this.plotManager.load();
		this.render();
	}

	private render() {
		const content = this.containerEl.children[1] as HTMLElement;
		// Save scroll before wiping DOM — content.empty() destroys the section element itself
		const oldSection = content.querySelector<HTMLElement>('.wm-plot-section');
		const savedScrollTop = oldSection?.scrollTop ?? 0;
		const savedScrollLeft = oldSection?.scrollLeft ?? 0;
		content.empty();
		content.addClass('wm-plot-view');

		if (!this.project) return;

		// ── Toolbar ──
		const toolbar = content.createDiv({ cls: 'wm-plot-toolbar' });

		// 페이지 그룹 (분류명 없음): prev | label | next
		const pageGroup = toolbar.createDiv({ cls: 'wm-plot-toolbar-group' });
		const prevPageBtn = pageGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '이전 페이지' } });
		setIcon(prevPageBtn, 'chevron-left');
		prevPageBtn.addEventListener('click', () => this.grid?.prevPage());
		this.pageLabel = pageGroup.createEl('span', { cls: 'wm-plot-page-label', text: '' });
		const nextPageBtn = pageGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '다음 페이지' } });
		setIcon(nextPageBtn, 'chevron-right');
		nextPageBtn.addEventListener('click', () => this.grid?.nextPage());

		// 줌 그룹 (분류명 없음): zoom- | label | zoom+
		const zoomGroup = toolbar.createDiv({ cls: 'wm-plot-toolbar-group' });
		const zoomOutBtn = zoomGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '축소 (Ctrl+휠)' } });
		setIcon(zoomOutBtn, 'zoom-out');
		zoomOutBtn.addEventListener('click', () => this.applyZoom(this.zoom - 0.1));
		this.zoomLabelEl = zoomGroup.createEl('span', { cls: 'wm-plot-zoom-label', text: `${Math.round(this.zoom * 100)}%` });
		const zoomInBtn = zoomGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '확대 (Ctrl+휠)' } });
		setIcon(zoomInBtn, 'zoom-in');
		zoomInBtn.addEventListener('click', () => this.applyZoom(this.zoom + 0.1));

		// 플롯 그룹: label | 행 추가 | 셀 일괄 생성 | 셀 일괄 삭제
		const plotGroup = toolbar.createDiv({ cls: 'wm-plot-toolbar-group wm-plot-toolbar-group-open' });
		plotGroup.createDiv({ cls: 'wm-plot-toolbar-group-label', text: '플롯' });
		const addPlotLineBtn = plotGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '행 추가' } });
		setIcon(addPlotLineBtn, 'layers');
		addPlotLineBtn.addEventListener('click', () => this.grid?.addPlotLine());
		const bulkBtn = plotGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '셀 일괄 생성' } });
		setIcon(bulkBtn, 'list-plus');
		bulkBtn.addEventListener('click', () => this.grid?.openBulkCreatePopup(bulkBtn));
		const bulkDelBtn = plotGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '셀 일괄 삭제' } });
		setIcon(bulkDelBtn, 'list-minus');
		bulkDelBtn.addEventListener('click', () => this.grid?.openBulkDeletePopup(bulkDelBtn));

		// 캐릭터 그룹: label | 캐릭터 추가 | 선택 보기 | 폴더 동기화
		const charGroup = toolbar.createDiv({ cls: 'wm-plot-toolbar-group wm-plot-toolbar-group-open' });
		charGroup.createDiv({ cls: 'wm-plot-toolbar-group-label', text: '캐릭터' });
		const addCharBtn = charGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '캐릭터 추가' } });
		setIcon(addCharBtn, 'user-round-plus');
		addCharBtn.addEventListener('click', () => this.grid?.openAddCharPopup(addCharBtn));
		const charVisBtn = charGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '선택 보기' } });
		setIcon(charVisBtn, 'user-round-check');
		charVisBtn.addEventListener('click', () => this.grid?.openCharVisibilityPopup());
		const syncCharBtn = charGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '폴더 동기화' } });
		setIcon(syncCharBtn, 'folder-sync');
		syncCharBtn.addEventListener('click', () => void this.grid?.syncCharsFromFolder());

		// 되돌리기 그룹: label | 실행 취소 | 다시 실행
		const undoGroup = toolbar.createDiv({ cls: 'wm-plot-toolbar-group wm-plot-toolbar-group-open' });
		undoGroup.createDiv({ cls: 'wm-plot-toolbar-group-label', text: '되돌리기' });
		const undoBtn = undoGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '실행 취소 (구조 변경)' } });
		setIcon(undoBtn, 'arrow-left');
		undoBtn.disabled = true;
		undoBtn.addEventListener('click', () => this.grid?.undo());
		const redoBtn = undoGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '다시 실행' } });
		setIcon(redoBtn, 'arrow-right');
		redoBtn.disabled = true;
		redoBtn.addEventListener('click', () => this.grid?.redo());

		// 기본 그룹: label | 정보 | 새로고침 | 회차 검색 | 단축키 | 설정
		const baseGroup = toolbar.createDiv({ cls: 'wm-plot-toolbar-group wm-plot-toolbar-group-open' });
		baseGroup.createDiv({ cls: 'wm-plot-toolbar-group-label', text: '기본' });
		const infoBtn = baseGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '사용법' } });
		setIcon(infoBtn, 'info');
		infoBtn.addEventListener('click', () => this.openInfoPopup());
		const reloadBtn = baseGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '새로고침' } });
		setIcon(reloadBtn, 'refresh-ccw');
		reloadBtn.addEventListener('click', () => void this.reload());
		const searchBtn = baseGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '회차 검색 (Shift+F)' } });
		setIcon(searchBtn, 'search');
		searchBtn.addEventListener('click', () => this.openChapterSearch());
		const sortBtn = baseGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '구조 정렬' } });
		setIcon(sortBtn, 'list-tree');
		sortBtn.addEventListener('click', () => this.grid?.openSortPopup(sortBtn));
		const shortcutBtn = baseGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '단축키' } });
		setIcon(shortcutBtn, 'keyboard');
		shortcutBtn.addEventListener('click', () => this.openShortcutDropdown(shortcutBtn));
		const folderBtn = baseGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '폴더 변경' } });
		setIcon(folderBtn, 'folder');
		folderBtn.addEventListener('click', () => this.openFolderPicker());
		const settingsBtn = baseGroup.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '설정' } });
		setIcon(settingsBtn, 'settings');
		settingsBtn.addEventListener('click', () => this.plugin.openPlotSettings());

		// ── Single scrollable content area ──
		const contentArea = content.createDiv({ cls: 'wm-plot-content-area' });
		const section = contentArea.createDiv({ cls: 'wm-plot-section' });
		const layout1El = section.createDiv({ cls: 'wm-plot-layout1' });

		this.grid = new Layout1Grid(layout1El, this.project, this.plugin, {
			onSave: () => void this.saveAndRefresh(),
			onCellSelect: (sel: CellSelection) => this.notifyTimeline(sel),
			onPageChange: () => { this.updatePageLabel(); this.syncTimelinePage(); },
			onHiddenCharsChange: (hidden) => {
				this.plugin.settings.plotHiddenCharIds = [...hidden];
				void this.plugin.saveSettings();
			},
			onUndoRedoChange: (canUndo, canRedo) => {
				undoBtn.disabled = !canUndo;
				redoBtn.disabled = !canRedo;
			},
			onBeforeTrash: (path) => { this._suppressDeletePath = path; },
		}, this.hiddenCharIds);
		this.grid.render();
		this.updatePageLabel();
		this.applyZoomStyle();
		// Restore scroll after DOM rebuild — the section element was recreated above
		if (savedScrollTop || savedScrollLeft) {
			const newSection = content.querySelector<HTMLElement>('.wm-plot-section');
			if (newSection) { newSection.scrollTop = savedScrollTop; newSection.scrollLeft = savedScrollLeft; }
		}
	}

	private applyZoom(value: number) {
		this.zoom = Math.min(2.0, Math.max(0.3, value));
		if (this.zoomLabelEl) {
			this.zoomLabelEl.textContent = `${Math.round(this.zoom * 100)}%`;
		}
		this.applyZoomStyle();
	}

	private applyZoomStyle() {
		const wrappers = this.containerEl.querySelectorAll<HTMLElement>(
			'.wm-plot-table-wrapper, .wm-plot-canvas-wrapper'
		);
		wrappers.forEach(w => {
			// CSS zoom (not transform) preserves position:sticky behaviour
			(w.style as CSSStyleDeclaration & { zoom: string }).zoom = String(this.zoom);
			w.style.removeProperty('transform');
			w.style.removeProperty('width');
			w.style.removeProperty('height');
		});
		// Pinned row sticky top values must be recalculated after zoom changes row heights
		this.grid?.refreshPinnedSticky();
	}

	private getTimelineArgs() {
		return {
			onCardClick: (newSel: CellSelection) => { this.grid?.selectCellBySelection(newSel); },
			pageSceneIds: this.grid?.getPageSceneIds(),
			pageInfo: this.grid?.getPageInfo(),
			onPageChange: (delta: number) => this.timelinePageChange(delta),
		};
	}

	private notifyTimeline(sel: CellSelection) {
		this.lastSelection = sel;
		if (!this.project) return;
		const { onCardClick, pageSceneIds, pageInfo, onPageChange } = this.getTimelineArgs();
		const leaves = this.app.workspace.getLeavesOfType(PLOT_TIMELINE_VIEW_TYPE);
		if (leaves.length === 0 && sel !== null) {
			const leaf = this.app.workspace.getLeftLeaf(false);
			if (leaf) {
				void leaf.setViewState({ type: PLOT_TIMELINE_VIEW_TYPE, active: false }).then(() => {
					(leaf.view as PlotTimelineView).refresh(this.project!, sel, onCardClick, pageSceneIds, pageInfo, onPageChange);
				});
			}
		} else {
			leaves.forEach(leaf => {
				(leaf.view as PlotTimelineView).refresh(this.project!, sel, onCardClick, pageSceneIds, pageInfo, onPageChange);
			});
		}
	}

	private timelinePageChange(delta: number) {
		if (delta < 0) this.grid?.prevPage();
		else this.grid?.nextPage();
		this.syncTimelinePage();
	}

	private syncTimelinePage() {
		if (!this.project) return;
		const { onCardClick, pageSceneIds, pageInfo, onPageChange } = this.getTimelineArgs();
		this.app.workspace.getLeavesOfType(PLOT_TIMELINE_VIEW_TYPE).forEach(leaf => {
			(leaf.view as PlotTimelineView).refresh(this.project!, this.lastSelection, onCardClick, pageSceneIds, pageInfo, onPageChange);
		});
	}

	private updatePageLabel() {
		if (!this.pageLabel || !this.grid) return;
		const { page, totalPages, chStart, chEnd } = this.grid.getPageInfo();
		const range = chStart === 0 ? '(없음)' : `${chStart}–${chEnd}화`;
		this.pageLabel.textContent = `${range} (${page + 1}/${totalPages})`;
	}

	private openChapterSearch() {
		const existing = document.querySelector('.wm-plot-ch-search-popup');
		if (existing) { existing.remove(); return; }
		const restoreFocus = () => {
			const wrapper = this.grid?.getTableEl();
			if (wrapper) wrapper.focus({ preventScroll: true });
		};
		openChapterSearchPopup(
			'wm-plot-ch-search-popup',
			(q) => this.grid?.scrollToChapter(q),
			restoreFocus,
		);
	}

	private openShortcutDropdown(anchor: HTMLElement) {
		const existing = document.querySelector('.wm-plot-shortcut-dropdown');
		if (existing) { existing.remove(); return; }
		const rect = anchor.getBoundingClientRect();
		const dropdown = document.body.createDiv({ cls: 'wm-plot-shortcut-dropdown' });

		const shortcuts: [string, string][] = [
			['Shift+F', '회차 검색'],
			['Ctrl+휠', '확대 / 축소'],
			['↑↓←→', '셀 이동'],
			['Ctrl+↑↓←→', '내용 있는 셀로 이동'],
			['Enter', '셀 편집'],
			['더블클릭', '셀 편집'],
			['Esc', '선택 해제'],
			['PgUp / PgDn', '셀 내용 스크롤'],
		];

		for (const [key, desc] of shortcuts) {
			const row = dropdown.createDiv({ cls: 'wm-plot-shortcut-row' });
			row.createEl('kbd', { cls: 'wm-plot-shortcut-key', text: key });
			row.createSpan({ cls: 'wm-plot-shortcut-desc', text: desc });
		}

		// Position: prefer below, flip above if overflow
		requestAnimationFrame(() => {
			const dh = dropdown.getBoundingClientRect().height;
			const dw = dropdown.getBoundingClientRect().width;
			const top = rect.bottom + 4 + dh > window.innerHeight
				? rect.top - dh - 4
				: rect.bottom + 4;
			dropdown.style.top = `${top}px`;
			dropdown.style.left = `${Math.min(rect.left, window.innerWidth - dw - 8)}px`;
		});

		addOutsideClickListener(dropdown, () => dropdown.remove());
	}

	private openInfoPopup() {
		const existing = document.querySelector('.wm-plot-info-popup');
		if (existing) { existing.remove(); return; }
		const popup = document.body.createDiv({ cls: 'wm-plot-info-popup' });

		const sections: { title: string; items: string[] }[] = [
			{
				title: '플롯 매니저',
				items: [
					'에피소드 › 회차 › 장면 구조로 열 관리',
					'플롯 라인 행: 장면별 내용 메모',
					'인물 행: 등장인물 해당 장면 역할 메모',
					'셀 더블클릭 또는 Enter 키로 편집',
					'셀 내용을 드래그해 다른 셀로 이동 가능',
					'플롯 라인 선택 시 인물 행 자동 정렬 (해당 장면 등장 인물 위로)',
					'숨긴 인물: 선택된 장면에 내용 있으면 자동 표시',
				],
			},
			{
				title: '플롯 타임라인',
				items: [
					'플롯 매니저에서 셀을 선택하면 해당 라인/인물 타임라인 표시',
					'카드 클릭 시 플롯 매니저에서 해당 장면으로 이동',
					'← → 버튼으로 페이지 이동 (플롯 매니저와 동기화)',
					'플롯 매니저 셀 선택 시 타임라인은 스크롤 유지',
					'타임라인 카드 클릭 시 플롯 매니저 중앙 스크롤',
				],
			},
		];

		for (const sec of sections) {
			popup.createEl('h4', { cls: 'wm-plot-info-title', text: sec.title });
			const ul = popup.createEl('ul', { cls: 'wm-plot-info-list' });
			for (const item of sec.items) {
				ul.createEl('li', { text: item });
			}
		}

		const closeBtn = popup.createEl('button', { cls: 'wm-plot-info-close', text: '닫기' });
		closeBtn.addEventListener('click', () => popup.remove());

		addOutsideClickListener(popup, () => popup.remove());
	}

	private openFolderPicker() {
		new FolderSuggestModal(this.app, (folder) => {
			fireAndForget(async () => {
				this.plugin.settings.plotManagerFolder = folder.path;
				await this.plugin.saveSettings();
				new Notice(`플롯 폴더: ${folder.path}`);
				await this.reload();
			});
		}).open();
	}

	private async saveAndRefresh() {
		if (!this.project) return;
		await this.plotManager.save(this.project);
		// No render here — every onSave caller already calls render() synchronously,
		// so a second render after the async file write is redundant and causes scroll jumps.
	}
}
