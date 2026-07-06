import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { PLOT_TIMELINE_VIEW_TYPE } from './PlotTypes';
import type { PlotProject, CellSelection } from './PlotTypes';
import { renderWithWikilinks } from './WikilinkHelper';
import { addOutsideClickListener, openChapterSearchPopup } from './PlotUtils';

export { PLOT_TIMELINE_VIEW_TYPE };

export class PlotTimelineView extends ItemView {
	private project: PlotProject | null = null;
	private selection: CellSelection = null;
	private latestSelection: CellSelection = null;
	private onCardClick: ((sel: CellSelection) => void) | null = null;
	private pageSceneIds: Set<string> | null = null;
	private pageInfo: { page: number; totalPages: number; chStart: number; chEnd: number } | null = null;
	private onPageChange: ((delta: number) => void) | null = null;
	private selfClicked = false;
	private isPinned = false;

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
		this.latestSelection = selection;
		if (onCardClick !== undefined) this.onCardClick = onCardClick;
		if (pageSceneIds !== undefined) this.pageSceneIds = pageSceneIds;
		if (pageInfo !== undefined) this.pageInfo = pageInfo;
		if (onPageChange !== undefined) this.onPageChange = onPageChange;
		if (!this.isPinned) {
			this.selection = selection;
			this.renderTimeline();
		}
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

		// Title row: pin + TIMELINE label + chapter search button
		const titleRow = header.createDiv({ cls: 'wm-tl-title-row' });
		const pinBtn = titleRow.createEl('button', { cls: 'wm-plot-tool-btn wm-tl-pin-btn' + (this.isPinned ? ' is-active' : ''), attr: { title: this.isPinned ? '고정 해제' : '타임라인 고정' } });
		setIcon(pinBtn, 'pin');
		pinBtn.addEventListener('click', () => {
			this.isPinned = !this.isPinned;
			if (!this.isPinned) {
				this.selection = this.latestSelection;
				this.renderTimeline();
			} else {
				pinBtn.classList.toggle('is-active', true);
				pinBtn.setAttribute('title', '고정 해제');
			}
		});
		titleRow.createSpan({ cls: 'wm-tl-title', text: 'TIMELINE' });
		const chSearchBtn = titleRow.createEl('button', { cls: 'wm-plot-tool-btn wm-tl-ch-search-btn', attr: { title: '회차 검색' } });
		setIcon(chSearchBtn, 'search');
		chSearchBtn.addEventListener('click', () => this.openChapterSearch());

		// Row name: clickable to switch plot line / character
		const headerRow = header.createDiv({ cls: 'wm-tl-header-row' });
		const rowNameEl = headerRow.createSpan({ cls: 'wm-tl-row-name wm-tl-row-name-btn', text: rowName, attr: { title: '행 선택' } });
		rowNameEl.addEventListener('click', () => this.openRowPicker());

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
					const node = nodeList.createDiv({ cls: 'wm-tl-node', attr: { 'data-scene-id': sc.id, 'data-ch-name': ch.name } });
					node.createDiv({ cls: 'wm-tl-dot' + (isActive ? ' is-active' : '') });

					const card = node.createDiv({ cls: 'wm-tl-card' + (isActive ? ' is-active' : '') });

					const chipWrap = card.createDiv({ cls: 'wm-tl-chip-wrap' });
					const chipIcon = chipWrap.createDiv({ cls: 'wm-tl-chip-icon' });
					setIcon(chipIcon, 'hash');
					chipWrap.createSpan({ cls: 'wm-tl-chip-label', text: sc.name });

					const cardText = card.createDiv({ cls: 'wm-tl-card-text' });
					renderWithWikilinks(cardText, content, this.app, () => this.plugin.settings.plotLinkOpenMode ?? 'tab');

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
		const scrollToActive = !this.selfClicked;
		this.selfClicked = false;
		if (scrollToActive) {
			requestAnimationFrame(() => {
				const activeCard = el.querySelector<HTMLElement>('.wm-tl-card.is-active');
				if (activeCard) activeCard.scrollIntoView({ block: 'center' });
			});
		}
	}

	// ── Chapter search popup ─────────────────────────────────────────────

	private openChapterSearch() {
		openChapterSearchPopup('wm-tl-ch-search-popup', (q) => this.scrollToChapter(q));
	}

	private scrollToChapter(query: string) {
		const num = parseInt(query, 10);
		if (isNaN(num)) return;

		const el = this.containerEl.children[1] as HTMLElement;
		// Find nodes whose chapter name matches "N화"
		const allNodes = Array.from(el.querySelectorAll('.wm-tl-node[data-ch-name]')) as HTMLElement[];
		const matching = allNodes.filter(n => {
			const chName = n.getAttribute('data-ch-name') ?? '';
			return chName === `${num}화` || chName === `${num}` || chName.startsWith(`${num}화`);
		});

		if (matching.length === 0) return;

		// Scroll first match to center
		matching[0].scrollIntoView({ block: 'center', behavior: 'smooth' });

		// Briefly highlight all matching nodes' cards
		matching.forEach(n => {
			const card = n.querySelector('.wm-tl-card') as HTMLElement | null;
			if (!card) return;
			card.classList.add('wm-tl-card-flash');
			setTimeout(() => card.classList.remove('wm-tl-card-flash'), 1400);
		});
	}

	// ── Row picker popup ─────────────────────────────────────────────────

	private openRowPicker() {
		if (!this.project || !this.selection) return;
		document.querySelector('.wm-tl-row-picker')?.remove();

		const popup = document.body.createDiv({ cls: 'wm-tl-row-picker' });

		const searchWrap = popup.createDiv({ cls: 'wm-tl-row-picker-search' });
		const searchIconEl = searchWrap.createDiv({ cls: 'wm-tl-row-picker-search-icon' });
		setIcon(searchIconEl, 'search');
		const searchInput = searchWrap.createEl('input', {
			cls: 'wm-tl-row-picker-input',
			attr: { type: 'text', placeholder: '검색…', spellcheck: 'false' },
		}) as HTMLInputElement;

		const list = popup.createDiv({ cls: 'wm-tl-row-picker-list' });

		const renderList = (q: string) => {
			list.empty();
			const project = this.project!;
			const filter = (name: string) => !q || name.toLowerCase().includes(q.toLowerCase());

			const addItem = (container: HTMLElement, name: string, sel: CellSelection) => {
				const item = container.createDiv({ cls: 'wm-tl-row-picker-item' });
				item.createSpan({ text: name });
				const isActive = this.selection && (
					(sel?.kind === 'plotLine' && this.selection.kind === 'plotLine' && sel.lineId === this.selection.lineId) ||
					(sel?.kind === 'char' && this.selection.kind === 'char' && sel.charId === this.selection.charId)
				);
				if (isActive) item.addClass('is-active');
				item.addEventListener('click', () => {
					popup.remove();
					this.selfClicked = true;
					this.onCardClick?.(sel);
					if (sel) {
						const newSel: CellSelection = sel.kind === 'plotLine'
							? { kind: 'plotLine', lineId: sel.lineId, sceneId: this.selection?.sceneId ?? sel.lineId }
							: { kind: 'char', charId: sel.charId, sceneId: this.selection?.sceneId ?? sel.charId };
						this.selection = newSel;
						this.renderTimeline();
					}
				});
			};

			const filteredLines = project.plotLines.filter(pl => filter(pl.name));
			const filteredChars = project.characters.filter(ch => filter(ch.name));

			if (filteredLines.length > 0) {
				const sec = list.createDiv({ cls: 'wm-tl-row-picker-section' });
				filteredLines.forEach(pl => addItem(sec, pl.name, { kind: 'plotLine', lineId: pl.id, sceneId: '' }));
			}
			if (filteredChars.length > 0) {
				const sec = list.createDiv({ cls: 'wm-tl-row-picker-section' });
				filteredChars.forEach(ch => addItem(sec, ch.name, { kind: 'char', charId: ch.id, sceneId: '' }));
			}
		};

		renderList('');
		searchInput.addEventListener('input', () => renderList(searchInput.value));
		searchInput.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') popup.remove();
			if (e.key === 'Enter') {
				const first = list.querySelector<HTMLElement>('.wm-tl-row-picker-item');
				first?.click();
			}
		});

		// Position below row-name element
		const rowNameEl = (this.containerEl.children[1] as HTMLElement).querySelector('.wm-tl-row-name-btn');
		requestAnimationFrame(() => {
			const rect = rowNameEl?.getBoundingClientRect();
			if (rect) {
				const dh = popup.getBoundingClientRect().height;
				const top = rect.bottom + 4 + dh > window.innerHeight ? rect.top - dh - 4 : rect.bottom + 4;
				popup.style.top = `${top}px`;
				popup.style.left = `${Math.min(rect.left, window.innerWidth - popup.getBoundingClientRect().width - 8)}px`;
			}
		});

		setTimeout(() => searchInput.focus(), 0);
		addOutsideClickListener(popup, () => popup.remove());
	}
}
