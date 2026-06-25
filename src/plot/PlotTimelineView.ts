import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { PLOT_TIMELINE_VIEW_TYPE } from './PlotTypes';
import type { PlotProject, PlotEpisode, PlotScene, CellSelection } from './PlotTypes';

export { PLOT_TIMELINE_VIEW_TYPE };

export class PlotTimelineView extends ItemView {
	private project: PlotProject | null = null;
	private selection: CellSelection = null;
	private onCardClick: ((sel: CellSelection) => void) | null = null;
	private pageSceneIds: Set<string> | null = null;
	private pageInfo: { page: number; totalPages: number; chStart: number; chEnd: number } | null = null;
	private onPageChange: ((delta: number) => void) | null = null;
	private selfClicked = false;

	constructor(leaf: WorkspaceLeaf, private plugin: WritingMenuPlugin) {
		super(leaf);
	}

	getViewType(): string { return PLOT_TIMELINE_VIEW_TYPE; }
	getDisplayText(): string { return '플롯 타임라인'; }
	getIcon(): string { return 'git-branch'; }

	async onOpen() { this.renderEmpty(); }
	async onClose() {}

	refresh(
		project: PlotProject,
		selection: CellSelection,
		onCardClick?: (sel: CellSelection) => void,
		pageSceneIds?: Set<string>,
		pageInfo?: { page: number; totalPages: number; chStart: number; chEnd: number },
		onPageChange?: (delta: number) => void,
	) {
		this.project = project;
		this.selection = selection;
		if (onCardClick !== undefined) this.onCardClick = onCardClick;
		if (pageSceneIds !== undefined) this.pageSceneIds = pageSceneIds;
		if (pageInfo !== undefined) this.pageInfo = pageInfo;
		if (onPageChange !== undefined) this.onPageChange = onPageChange;
		this.renderTimeline();
	}

	private renderEmpty() {
		const el = this.containerEl.children[1] as HTMLElement;
		el.empty();
		el.addClass('wm-tl-view');
		el.createDiv({ cls: 'wm-tl-empty', text: '셀을 선택하면 타임라인이 표시됩니다.' });
	}

	private renderTimeline() {
		const el = this.containerEl.children[1] as HTMLElement;
		el.empty();
		el.addClass('wm-tl-view');

		if (!this.project || !this.selection) { this.renderEmpty(); return; }

		const sel = this.selection;
		const project = this.project;
		const pageSceneIds = this.pageSceneIds;

		let rowName = '';
		if (sel.kind === 'plotLine') {
			rowName = project.plotLines.find(l => l.id === sel.lineId)?.name ?? '';
		} else {
			rowName = project.characters.find(c => c.id === sel.charId)?.name ?? '';
		}

		// ── Header (sticky) ──
		const header = el.createDiv({ cls: 'wm-tl-header' });
		header.createSpan({ cls: 'wm-tl-title', text: 'TIMELINE' });
		const headerRow = header.createDiv({ cls: 'wm-tl-header-row' });
		headerRow.createSpan({ cls: 'wm-tl-row-name', text: rowName });

		// Page nav (synced with plot manager)
		if (this.pageInfo && this.onPageChange) {
			const { page, totalPages, chStart, chEnd } = this.pageInfo;
			const pageNav = headerRow.createDiv({ cls: 'wm-tl-page-nav' });
			const prevBtn = pageNav.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '이전 페이지' } });
			setIcon(prevBtn, 'chevron-left');
			prevBtn.disabled = page <= 0;
			prevBtn.addEventListener('click', () => this.onPageChange?.(-1));
			const range = chStart === 0 ? '(없음)' : `${chStart}–${chEnd}화`;
			pageNav.createSpan({ cls: 'wm-tl-page-label', text: `${range} (${page + 1}/${totalPages})` });
			const nextBtn = pageNav.createEl('button', { cls: 'wm-plot-tool-btn', attr: { title: '다음 페이지' } });
			setIcon(nextBtn, 'chevron-right');
			nextBtn.disabled = page >= totalPages - 1;
			nextBtn.addEventListener('click', () => this.onPageChange?.(1));
		}

		// ── Body ──
		const body = el.createDiv({ cls: 'wm-tl-body' });

		// Render episodes that have content for the selected row (filtered to current page)
		let hasAny = false;
		for (const ep of project.episodes) {
			if (ep.chapters.length === 0) continue;

			// Check if any scene in this episode has content AND is on the current page
			const hasContent = ep.chapters.some(ch => ch.scenes.some(sc => {
				if (pageSceneIds && !pageSceneIds.has(sc.id)) return false;
				const content = sel.kind === 'plotLine'
					? project.plotCells[`${sel.lineId}__${sc.id}`]?.content
					: project.charCells[`${sel.charId}__${sc.id}`]?.content;
				return !!content;
			}));
			if (!hasContent) continue;

			hasAny = true;
			const epSection = body.createDiv({ cls: 'wm-tl-ep-section' });

			const epHeader = epSection.createDiv({ cls: 'wm-tl-ep-header' });
			epHeader.createDiv({ cls: 'wm-tl-ep-name', text: ep.name });
			if (ep.subtitle) epHeader.createDiv({ cls: 'wm-tl-ep-subtitle', text: ep.subtitle });

			const nodeList = epSection.createDiv({ cls: 'wm-tl-node-list' });

			for (const ch of ep.chapters) {
				for (const sc of ch.scenes) {
					if (pageSceneIds && !pageSceneIds.has(sc.id)) continue;

					let content = '';
					if (sel.kind === 'plotLine') {
						content = project.plotCells[`${sel.lineId}__${sc.id}`]?.content ?? '';
					} else {
						content = project.charCells[`${sel.charId}__${sc.id}`]?.content ?? '';
					}
					if (!content) continue;

					const isActive = sel.sceneId === sc.id;
					const node = nodeList.createDiv({ cls: 'wm-tl-node' });
					node.createDiv({ cls: 'wm-tl-dot' + (isActive ? ' is-active' : '') });

					const card = node.createDiv({ cls: 'wm-tl-card' + (isActive ? ' is-active' : '') });
					card.style.cursor = 'pointer';

					const chipWrap = card.createDiv({ cls: 'wm-tl-chip-wrap' });
					const chipIcon = chipWrap.createDiv({ cls: 'wm-tl-chip-icon' });
					setIcon(chipIcon, 'hash');
					chipWrap.createSpan({ cls: 'wm-tl-chip-label', text: sc.name });

					card.createDiv({ cls: 'wm-tl-card-text', text: content });

					card.addEventListener('click', () => {
						this.selfClicked = true;
						const newSel: CellSelection = sel.kind === 'plotLine'
							? { kind: 'plotLine', lineId: sel.lineId, sceneId: sc.id }
							: { kind: 'char', charId: sel.charId, sceneId: sc.id };
						this.onCardClick?.(newSel);
					});
				}
			}
		}

		if (!hasAny) {
			body.createDiv({ cls: 'wm-tl-empty', text: '이 페이지에 내용이 없습니다.' });
		}

		// 타임라인 자체 카드 클릭 시 스크롤 없음, 플롯 매니저에서 선택 변경 시에만 중앙 포커스
		const shouldScroll = !this.selfClicked;
		this.selfClicked = false;
		if (shouldScroll) {
			requestAnimationFrame(() => {
				const activeCard = el.querySelector<HTMLElement>('.wm-tl-card.is-active');
				if (activeCard) activeCard.scrollIntoView({ block: 'center' });
			});
		}
	}
}
