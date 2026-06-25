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

		// Title row: TIMELINE label + chapter search button
		const titleRow = header.createDiv({ cls: 'wm-tl-title-row' });
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

	// ── Chapter search popup ─────────────────────────────────────────────

	private openChapterSearch() {
		document.querySelector('.wm-tl-ch-search-popup')?.remove();

		const popup = document.body.createDiv({ cls: 'wm-tl-ch-search-popup' });
		popup.createDiv({ cls: 'wm-plot-ch-search-popup-title', text: '회차 검색' });

		const inputWrap = popup.createDiv({ cls: 'wm-plot-ch-search-popup-wrap' });
		const input = inputWrap.createEl('input', {
			cls: 'wm-plot-ch-search-popup-input',
			attr: { type: 'text', placeholder: '화 번호 입력 (예: 5)', spellcheck: 'false' },
		}) as HTMLInputElement;

		const dismiss = () => popup.remove();
		const doSearch = () => {
			const q = input.value.trim();
			if (q) this.scrollToChapter(q);
			dismiss();
		};

		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') doSearch();
			else if (e.key === 'Escape') dismiss();
		});

		setTimeout(() => input.focus(), 0);
		setTimeout(() => {
			const outsideHandler = (e: MouseEvent) => {
				if (!popup.contains(e.target as Node)) {
					dismiss();
					document.removeEventListener('click', outsideHandler, true);
				}
			};
			document.addEventListener('click', outsideHandler, true);
		}, 0);
	}

	private scrollToChapter(query: string) {
		const el = this.containerEl.children[1] as HTMLElement;
		const num = parseInt(query, 10);
		if (isNaN(num)) return;

		// Find episode section whose name or subtitle contains the chapter number
		const epSections = Array.from(el.querySelectorAll('.wm-tl-ep-section')) as HTMLElement[];
		for (const section of epSections) {
			const nameEl = section.querySelector('.wm-tl-ep-name') as HTMLElement | null;
			const subtitle = section.querySelector('.wm-tl-ep-subtitle') as HTMLElement | null;
			const text = nameEl?.textContent ?? '';
			if (text.includes(String(num)) || subtitle?.textContent?.includes(`${num}화`)) {
				section.scrollIntoView({ block: 'start', behavior: 'smooth' });
				return;
			}
		}
		// Fallback: search chip labels for scene names like "1-5"
		const chips = Array.from(el.querySelectorAll('.wm-tl-chip-label')) as HTMLElement[];
		for (const chip of chips) {
			if (chip.textContent?.startsWith(`${num}-`)) {
				(chip.closest('.wm-tl-node') as HTMLElement | null)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
				return;
			}
		}
	}

	// ── Row picker popup ─────────────────────────────────────────────────

	private openRowPicker() {
		if (!this.project || !this.selection) return;
		document.querySelector('.wm-tl-row-picker')?.remove();

		const popup = document.body.createDiv({ cls: 'wm-tl-row-picker' });

		const searchWrap = popup.createDiv({ cls: 'wm-tl-row-picker-search' });
		setIcon(searchWrap.createDiv({ cls: 'wm-tl-row-picker-search-icon' }), 'search');
		const searchInput = searchWrap.createEl('input', {
			cls: 'wm-tl-row-picker-input',
			attr: { type: 'text', placeholder: '플롯 라인 또는 인물 검색…', spellcheck: 'false' },
		}) as HTMLInputElement;

		const list = popup.createDiv({ cls: 'wm-tl-row-picker-list' });

		const renderList = (q: string) => {
			list.empty();
			const project = this.project!;
			const filter = (name: string) => !q || name.toLowerCase().includes(q.toLowerCase());

			const addItem = (name: string, sel: CellSelection) => {
				const item = list.createDiv({ cls: 'wm-tl-row-picker-item' });
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
					// Update local selection and re-render
					if (sel) {
						const newSel: CellSelection = sel.kind === 'plotLine'
							? { kind: 'plotLine', lineId: sel.lineId, sceneId: this.selection?.sceneId ?? sel.lineId }
							: { kind: 'char', charId: sel.charId, sceneId: this.selection?.sceneId ?? sel.charId };
						this.selection = newSel;
						this.renderTimeline();
					}
				});
			};

			if (project.plotLines.length > 0) {
				list.createDiv({ cls: 'wm-tl-row-picker-group', text: '플롯 라인' });
				project.plotLines.filter(pl => filter(pl.name)).forEach(pl =>
					addItem(pl.name, { kind: 'plotLine', lineId: pl.id, sceneId: '' })
				);
			}
			if (project.characters.length > 0) {
				list.createDiv({ cls: 'wm-tl-row-picker-group', text: '인물' });
				project.characters.filter(ch => filter(ch.name)).forEach(ch =>
					addItem(ch.name, { kind: 'char', charId: ch.id, sceneId: '' })
				);
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

		setTimeout(() => {
			searchInput.focus();
			const outsideHandler = (e: MouseEvent) => {
				if (!popup.contains(e.target as Node)) {
					popup.remove();
					document.removeEventListener('click', outsideHandler, true);
				}
			};
			document.addEventListener('click', outsideHandler, true);
		}, 0);
	}
}
