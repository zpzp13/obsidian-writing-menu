import { setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { FONT_COLOR_ICON_PATH, FONT_COLOR_ICON_VIEWBOX } from '../assets/fontColorIcon';
import type { ColorThemeMode, ThemeAwareColor, WritingProject } from '../types';
import {
	BACKGROUND_COLOR_PALETTE,
	DEFAULT_BACKGROUND_COLORS,
	DEFAULT_TEXT_COLORS,
	TEXT_COLOR_PALETTE,
	resolveThemeColor,
	themeModeFromDocument,
	toThemeColorPair,
} from '../utils/themeColor';
import type { InfinitePlotSheet } from './InfinitePlotSheet';
import { DEFAULT_PLOTBOOK_FONT_SIZE, MAX_PLOTBOOK_COLUMN_WIDTH, MAX_PLOTBOOK_ROW_HEIGHT, MIN_PLOTBOOK_COLUMN_WIDTH, MIN_PLOTBOOK_ROW_HEIGHT } from './PlotWorkbookTypes';
import type { PlotWorkbookSession } from './PlotWorkbookSession';
import { createToolbarActionOption, createToolbarIconButton, createToolbarOption, createToolbarSelect } from '../toolbar/toolbarUi';
import { PlotWorkbookMarkdownExportModal } from './PlotWorkbookMarkdownExport';
import { openPlotSnapshots } from './PlotWorkbookTransferModal';
import { InstalledFontCache } from '../toolbar/InstalledFontCache';
import { CSS_PX_PER_PT, formatTypographyNumber, pixelsToPoints } from '../utils/typography';

type PlotWorkbookColorTarget = 'color' | 'backgroundColor';

export class PlotWorkbookToolbar {
	readonly toolbarEl: HTMLElement;
	private activePopover: HTMLElement | null = null;
	private activeAnchor: HTMLElement | null = null;
	private projectLabelEl: HTMLElement | null = null;
	private fontLabelEl: HTMLElement | null = null;
	private sizeLabelEl: HTMLElement | null = null;
	private undoButton: HTMLButtonElement | null = null;
	private redoButton: HTMLButtonElement | null = null;
	private textColorButton: HTMLButtonElement | null = null;
	private backgroundColorButton: HTMLButtonElement | null = null;
	private alignmentButton: HTMLButtonElement | null = null;
	private filterButton: HTMLButtonElement | null = null;
	private zoomValueEl: HTMLElement | null = null;
	private readonly fontCache = new InstalledFontCache();
	private get installedFontFamilies(): string[] | null { return this.fontCache.families; }
	private readonly formatButtons = new Map<'bold' | 'italic' | 'underline' | 'strikethrough', HTMLButtonElement>();
	private readonly ownerDocument: Document;
	private readonly outsidePointerHandler: (event: PointerEvent) => void;
	private pendingColorCommit: (() => void) | null = null;

	constructor(
		private readonly plugin: WritingMenuPlugin,
		private readonly mountEl: HTMLElement,
		private readonly session: PlotWorkbookSession,
		private readonly sheet: InfinitePlotSheet,
		private readonly projects: WritingProject[],
		private readonly projectId: string | null,
		private readonly selectProject: (projectId: string) => void,
	) {
		this.ownerDocument = mountEl.ownerDocument;
		this.toolbarEl = mountEl.createDiv({
			cls: 'wm-paged-toolbar wm-plotbook-toolbar',
			attr: { role: 'toolbar' },
		});
		this.render();
		this.outsidePointerHandler = event => {
			const target = event.target as Node | null;
			if (!target || this.activePopover?.contains(target) || this.activeAnchor?.contains(target)) return;
			this.closePopover();
		};
		this.ownerDocument.addEventListener('pointerdown', this.outsidePointerHandler, true);
		this.refresh();
	}

	destroy(): void {
		this.ownerDocument.removeEventListener('pointerdown', this.outsidePointerHandler, true);
		this.closePopover();
		this.toolbarEl.remove();
	}

	openSearch(focusReplace = false): void {
		if (!this.filterButton) return;
		if (this.activeAnchor === this.filterButton && this.activePopover) {
			const selector = focusReplace ? '.wm-plotbook-search-replace-input' : '.wm-plotbook-search-input';
			const input = this.activePopover.querySelector<HTMLInputElement>(selector);
			input?.focus();
			input?.select();
			return;
		}
		this.openFilterPopover(this.filterButton, focusReplace);
	}

	refresh(): void {
		const style = this.sheet.getSelectionStyle();
		const project = this.projects.find(item => item.id === this.projectId);
		this.projectLabelEl?.setText(project?.name ?? '프로젝트');
		this.fontLabelEl?.setText(style.fontFamily ?? '시스템 폰트');
		this.sizeLabelEl?.setText(`${this.formatNumber(this.pixelsToPoints(style.fontSize ?? DEFAULT_PLOTBOOK_FONT_SIZE))} pt`);
		if (this.undoButton) this.undoButton.disabled = !this.session.canUndo;
		if (this.redoButton) this.redoButton.disabled = !this.session.canRedo;
		const mode = themeModeFromDocument(this.ownerDocument);
		if (this.textColorButton) {
			this.textColorButton.style.color = resolveThemeColor(this.getRecentTextColor(), mode, DEFAULT_TEXT_COLORS);
		}
		if (this.backgroundColorButton) {
			this.backgroundColorButton.style.color = resolveThemeColor(
				this.getRecentBackgroundColor(), mode, DEFAULT_BACKGROUND_COLORS);
		}
		if (this.alignmentButton) setIcon(this.alignmentButton, `align-${style.alignment ?? 'left'}`);
		this.zoomValueEl?.setText(`${Math.round(this.sheet.getZoom() * 100)}%`);
		if (this.filterButton) {
			const active = this.sheet.getFilterQuery().trim().length > 0;
			this.filterButton.toggleClass('is-active', active);
			this.filterButton.setAttribute('aria-pressed', String(active));
		}
		for (const [kind, button] of this.formatButtons) {
			const active = style[kind] === true;
			button.toggleClass('is-active', active);
			button.setAttribute('aria-pressed', String(active));
		}
	}

	private render(): void {
		const history = this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-group is-history' });
		this.undoButton = this.createIconButton(history, 'undo-2', '이전 (Ctrl/Cmd+Z)', () => this.session.undo());
		this.redoButton = this.createIconButton(history, 'redo-2', '다음 (Ctrl/Cmd+Shift+Z)', () => this.session.redo());

		const projectGroup = this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-group is-project' });
		const project = this.createSelect(projectGroup, '프로젝트 폴더', '프로젝트', 'is-project', 'folder');
		project.addClass('wm-project-select-field');
		this.projectLabelEl = project.querySelector('.wm-paged-select-label');
		project.addEventListener('click', event => {
			event.stopPropagation();
			this.openProjectPopover(project);
		});
		const typography = this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-group is-typography' });
		const font = this.createSelect(typography, '글꼴', '시스템 폰트', 'is-font');
		this.fontLabelEl = font.querySelector('.wm-paged-select-label');
		font.addEventListener('click', event => {
			event.stopPropagation();
			this.openFontPopover(font);
		});
		const size = this.createSelect(typography, '글꼴 크기', '7.5 pt', 'is-size');
		this.sizeLabelEl = size.querySelector('.wm-paged-select-label');
		size.addEventListener('click', event => {
			event.stopPropagation();
			this.openFontSizePopover(size);
		});
		const dimensions = this.createSelect(typography, '행·열 기본 크기', '기본값', 'is-dimensions');
		dimensions.addEventListener('click', event => {
			event.stopPropagation();
			this.openDimensionsPopover(dimensions);
		});
		dimensions.setAttribute('aria-haspopup', 'menu');
		const formatting = this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-group is-formatting' });
		this.filterButton = this.createIconButton(formatting, 'list-filter', '검색 · 필터 (Ctrl/Cmd+F)', () => {
			if (this.activeAnchor === this.filterButton && this.activePopover) {
				this.closePopover();
				this.sheet.focus();
				return;
			}
			this.openSearch(false);
		});
		this.filterButton.setAttribute('aria-haspopup', 'menu');
		this.filterButton.setAttribute('aria-pressed', 'false');
		this.alignmentButton = this.createIconButton(formatting, 'align-left', '정렬', () => {
			if (!this.alignmentButton) return;
			this.openAlignmentPopover(this.alignmentButton);
		});
		this.alignmentButton.setAttribute('aria-haspopup', 'menu');
		for (const [icon, label, kind] of [
			['bold', '굵게 (Ctrl/Cmd+B)', 'bold'],
			['italic', '이탤릭체 (Ctrl/Cmd+I)', 'italic'],
			['underline', '밑줄 (Ctrl/Cmd+U)', 'underline'],
			['strikethrough', '취소선 (Ctrl/Cmd+Shift+S)', 'strikethrough'],
		] as const) {
			const button = this.createIconButton(formatting, icon, label, () => this.sheet.toggleSelectionStyle(kind));
			button.setAttribute('aria-pressed', 'false');
			this.formatButtons.set(kind, button);
		}
		this.createColorControl(formatting, 'color');
		this.createColorControl(formatting, 'backgroundColor');
		const exportButton = this.createIconButton(formatting, 'file-output', '내보내기', () => {
			this.sheet.commitEditing();
			this.openPopover(exportButton, 'wm-writing-action-popover', popover => {
				createToolbarActionOption(popover, 'file-text', 'Markdown으로 내보내기', () => {
					this.closePopover();
					const project = this.projects.find(item => item.id === this.projectId);
					new PlotWorkbookMarkdownExportModal(this.plugin.app, this.session, project?.rootFolder ?? '').open();
				});
			});
		});
		exportButton.setAttribute('aria-haspopup', 'menu');
		const snapshots = this.createIconButton(formatting, 'camera', '플롯 스냅샷', () => {
			this.sheet.commitEditing();
			this.closePopover();
			const project = this.projects.find(item => item.id === this.projectId);
			if (project) void openPlotSnapshots(this.plugin, project);
		});
		snapshots.disabled = !this.projects.some(item => item.id === this.projectId);
		this.createIconButton(formatting, 'panel-right', '플롯 매니저 사이드바', () => {
			void this.plugin.openPlotWorkbookSidebar({ projectId:this.projectId ?? undefined, ...this.sheet.getSelectedLocation() });
		});

		this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-spacer', attr: { 'aria-hidden': 'true' } });
		const settings = this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-group is-settings' });
		this.createIconButton(settings, 'settings', '플롯 매니저 설정', () => {
			this.plugin.openSettings();
			this.plugin.settingTab?.renderPage('plot');
		});
		const zoom = this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-group is-zoom' });
		this.createIconButton(zoom, 'zoom-out', '축소', () => {
			this.sheet.setZoom(this.sheet.getZoom() - 0.1);
			this.refresh();
		});
		const zoomReset = zoom.createEl('button', {
			cls: 'wm-paged-zoom-reset',
			attr: { type: 'button', 'aria-label': '배율을 100%로 초기화' },
		});
		this.zoomValueEl = zoomReset.createSpan({ cls: 'wm-paged-zoom-value', text: '100%' });
		zoomReset.addEventListener('click', () => {
			this.sheet.setZoom(1);
			this.refresh();
		});
		this.createIconButton(zoom, 'zoom-in', '확대', () => {
			this.sheet.setZoom(this.sheet.getZoom() + 0.1);
			this.refresh();
		});
	}

	private openDimensionsPopover(anchor: HTMLElement): void {
		const current = this.session.getDefaultDimensions();
		this.openPopover(anchor, 'wm-paged-layout-popover wm-plotbook-dimensions-popover', popover => {
			const header = popover.createDiv({ cls: 'wm-paged-layout-header' });
			header.createSpan({ cls: 'wm-paged-layout-title', text: '기본 셀 크기' });
			const body = popover.createDiv({ cls: 'wm-paged-layout-body wm-plotbook-dimension-body' });
			const previewWrap = body.createDiv({ cls: 'wm-paged-layout-preview wm-plotbook-dimension-preview-wrap' });
			const preview = previewWrap.createDiv({ cls: 'wm-plotbook-dimension-preview' });
			for (let index = 0; index < 9; index++) {
				preview.createDiv({ cls: `wm-plotbook-dimension-preview-cell${index === 4 ? ' is-active' : ''}` });
			}
			const fields = body.createDiv({ cls: 'wm-plotbook-dimension-fields' });
			const createField = (
				label: string,
				value: number,
				min: number,
				max: number,
			): HTMLInputElement => {
				const row = fields.createEl('label', { cls: 'wm-plotbook-dimension-field' });
				row.createSpan({ text: label });
				const input = row.createEl('input', {
					type: 'number',
					value: String(Math.round(value)),
					attr: { min: String(min), max: String(max), step: '1' },
				});
				row.createSpan({ cls: 'wm-plotbook-dimension-unit', text: 'px' });
				return input;
			};
			const rowHeight = createField('행 높이', current.rowHeight, MIN_PLOTBOOK_ROW_HEIGHT, MAX_PLOTBOOK_ROW_HEIGHT);
			const columnWidth = createField('열 너비', current.columnWidth, MIN_PLOTBOOK_COLUMN_WIDTH, MAX_PLOTBOOK_COLUMN_WIDTH);
			const updatePreview = () => {
				const height = Math.max(MIN_PLOTBOOK_ROW_HEIGHT, Math.min(MAX_PLOTBOOK_ROW_HEIGHT, Number(rowHeight.value) || current.rowHeight));
				const width = Math.max(MIN_PLOTBOOK_COLUMN_WIDTH, Math.min(MAX_PLOTBOOK_COLUMN_WIDTH, Number(columnWidth.value) || current.columnWidth));
				preview.style.setProperty('--wm-plotbook-preview-row', `${Math.max(12, Math.min(40, height * 0.7))}px`);
				preview.style.setProperty('--wm-plotbook-preview-column', `${Math.max(26, Math.min(50, width * 0.25))}px`);
			};
			rowHeight.addEventListener('input', updatePreview);
			columnWidth.addEventListener('input', updatePreview);
			updatePreview();
			const actions = popover.createDiv({ cls: 'wm-paged-layout-actions wm-plotbook-dimension-actions' });
			actions.createEl('button', { cls: 'wm-paged-layout-cancel', text: '취소' })
				.addEventListener('click', () => this.closePopover());
			const apply = actions.createEl('button', { cls: 'wm-paged-layout-apply', text: '적용' });
			const commit = () => {
				this.session.setDefaultDimensions(Number(rowHeight.value), Number(columnWidth.value));
				this.closePopover();
			};
			apply.addEventListener('click', commit);
			for (const input of [rowHeight, columnWidth]) {
				input.addEventListener('keydown', event => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					commit();
				});
			}
			window.setTimeout(() => rowHeight.select(), 0);
		});
	}

	private openFilterPopover(anchor: HTMLElement, focusReplace = false): void {
		this.openPopover(anchor, 'wm-plotbook-filter-popover', popover => {
			const searchFrame = popover.createDiv({ cls: 'wm-plotbook-search-frame' });
			const searchBox = searchFrame.createDiv({ cls: 'wm-plotbook-search-box' });
			const icon = searchBox.createSpan({ cls: 'wm-plotbook-search-icon' });
			setIcon(icon, 'search');
			const input = searchBox.createEl('input', {
				cls: 'wm-plotbook-search-input',
				attr: {
					type: 'search',
					placeholder: '검색...',
					spellcheck: 'false',
					'aria-label': '플롯 검색',
				},
			});
			input.value = this.sheet.getSearchQuery();
			const info = searchBox.createEl('button', {
				cls: 'wm-plotbook-search-info',
				attr: { type: 'button', 'aria-label': '필터 사용법' },
			});
			setIcon(info, 'info');
			const help = popover.createDiv({ cls: 'wm-search-help' });
			const coverageRow = help.createDiv({ cls: 'wm-search-help-row' });
			coverageRow.createEl('strong', { text: '검색 대상' });
			coverageRow.createSpan({ text: '본문, 인물 이름, 등장인물, 복선 제목·메모, 상태, 날짜를 검색합니다. 바꾸기는 직접 입력한 본문에만 적용됩니다.' });
			const helpRow = help.createDiv({ cls: 'wm-search-help-row' });
			helpRow.createEl('strong', { text: '범위 조합' });
			helpRow.createSpan({ text: '@B #2-3 검색어 — @는 열 문자·제목·종류, #는 행 번호입니다. @"메인 플롯", @cast, @foreshadow도 사용할 수 있습니다.' });
			const details = searchFrame.createDiv({ cls: 'wm-plotbook-search-details' });
			const navigation = details.createDiv({ cls: 'wm-plotbook-search-navigation' });
			const result = navigation.createDiv({ cls: 'wm-plotbook-filter-result' });
			const previous = navigation.createEl('button', {
				cls: 'clickable-icon',
				attr: { type: 'button', 'aria-label': '이전 검색 결과' },
			});
			setIcon(previous, 'chevron-up');
			const next = navigation.createEl('button', {
				cls: 'clickable-icon',
				attr: { type: 'button', 'aria-label': '다음 검색 결과' },
			});
			setIcon(next, 'chevron-down');
			const replaceRow = details.createDiv({ cls: 'wm-plotbook-search-replace-row' });
			const replaceIcon = replaceRow.createSpan({ cls: 'wm-plotbook-search-replace-icon', attr: { 'aria-hidden': 'true' } });
			setIcon(replaceIcon, 'replace');
			const replaceInput = replaceRow.createEl('input', {
				cls: 'wm-plotbook-search-replace-input',
				type: 'text',
				placeholder: '바꿀 내용',
				attr: { autocomplete: 'off', spellcheck: 'false' },
			});
			const replaceOne = replaceRow.createEl('button', { text: '바꾸기', attr: { type: 'button' } });
			const replaceAll = replaceRow.createEl('button', { text: '모두', attr: { type: 'button', 'aria-label': '모두 바꾸기' } });
			const updateResult = () => {
				const summary = this.sheet.getSearchSummary();
				const hasQuery = input.value.trim().length > 0;
				searchFrame.toggleClass('is-expanded', hasQuery || focusReplace);
				result.setText(hasQuery
					? (summary.matches === 0 ? '일치 없음' : `${summary.matches}개 중 ${summary.current}번째`)
					: '');
			};
			info.addEventListener('click', event => {
				event.stopPropagation();
				help.toggleClass('is-open', !help.hasClass('is-open'));
			});
			input.addEventListener('input', () => {
				this.sheet.setSearchQuery(input.value, false);
				updateResult();
				const active = input.value.trim().length > 0;
				this.filterButton?.toggleClass('is-active', active);
				this.filterButton?.setAttribute('aria-pressed', String(active));
			});
			input.addEventListener('keydown', event => {
				if (event.key === 'Enter') {
					event.preventDefault();
					this.sheet.navigateSearch(event.shiftKey ? -1 : 1);
					updateResult();
				} else if (event.key === 'Escape') {
					event.preventDefault();
					this.closePopover();
					this.sheet.focus();
				}
			});
			previous.addEventListener('click', () => { this.sheet.navigateSearch(-1); updateResult(); });
			next.addEventListener('click', () => { this.sheet.navigateSearch(1); updateResult(); });
			replaceInput.addEventListener('keydown', event => {
				if (event.key === 'Enter') {
					event.preventDefault();
					this.sheet.replaceCurrentSearch(replaceInput.value);
					updateResult();
				} else if (event.key === 'Escape') {
					event.preventDefault();
					this.closePopover();
					this.sheet.focus();
				}
			});
			replaceOne.addEventListener('click', () => { this.sheet.replaceCurrentSearch(replaceInput.value); updateResult(); });
			replaceAll.addEventListener('click', () => { this.sheet.replaceAllSearch(replaceInput.value); updateResult(); });
			window.setTimeout(() => {
				const target = focusReplace ? replaceInput : input;
				target.focus();
				target.setSelectionRange(target.value.length, target.value.length);
			}, 0);
			updateResult();
		});
	}

	private openAlignmentPopover(anchor: HTMLElement): void {
		const current = this.sheet.getSelectionStyle().alignment ?? 'left';
		this.openPopover(anchor, 'wm-paged-compact-popover wm-plotbook-alignment-popover', popover => {
			for (const option of [
				{ value: 'left', label: '왼쪽 정렬', icon: 'align-left' },
				{ value: 'center', label: '가운데 정렬', icon: 'align-center' },
				{ value: 'right', label: '오른쪽 정렬', icon: 'align-right' },
			] as const) {
				const button = this.createOption(popover, option.label, current === option.value, () => {
					this.sheet.applySelectionStyle({ alignment: option.value });
					this.closePopover();
				});
				const icon = button.createSpan({ cls: 'wm-plotbook-alignment-option-icon', attr: { 'aria-hidden': 'true' } });
				setIcon(icon, option.icon);
				button.prepend(icon);
			}
		});
	}

	private openProjectPopover(anchor: HTMLElement): void {
		this.openPopover(anchor, 'wm-paged-compact-popover', popover => {
			for (const project of this.projects) {
				this.createOption(popover, project.name, project.id === this.projectId, () => {
					this.closePopover();
					this.selectProject(project.id);
				});
			}
		});
	}

	private openFontPopover(anchor: HTMLElement): void {
		this.openPopover(anchor, 'wm-paged-font-popover', popover => {
			const searchRow = popover.createDiv({ cls: 'wm-paged-popover-search' });
			const icon = searchRow.createSpan({ attr: { 'aria-hidden': 'true' } });
			setIcon(icon, 'search');
			const search = searchRow.createEl('input', { type: 'text', placeholder: '시스템 글꼴 검색' });
			const list = popover.createDiv({ cls: 'wm-paged-popover-list' });
			const registeredFonts = () => Array.from(new Set([
				'inherit',
				...(this.plugin.settings.customFonts ?? []),
				this.plugin.settings.fontFamily,
			].filter(Boolean)));
			const render = () => {
				list.empty();
				const raw = search.value.trim();
				const query = raw.toLocaleLowerCase('ko-KR');
				const registered = registeredFonts();
				let fonts = query
					? (this.installedFontFamilies ?? []).filter(font => font.toLocaleLowerCase('ko-KR').includes(query))
					: registered;
				if (query && fonts.length === 0) fonts = [raw];
				const current = this.sheet.getSelectionStyle().fontFamily ?? 'inherit';
				for (const font of fonts.slice(0, 80)) {
					const item = this.createOption(list, font === 'inherit' ? '시스템 폰트' : font, font === current, () => {
						if (font !== 'inherit' && !(this.plugin.settings.customFonts ?? []).includes(font)) {
							this.plugin.settings.customFonts = [...(this.plugin.settings.customFonts ?? []), font];
							void this.plugin.saveSettings();
						}
						this.sheet.applySelectionStyle({ fontFamily: font === 'inherit' ? undefined : font });
						this.closePopover();
					});
					item.style.fontFamily = font === 'inherit' ? 'var(--font-interface)' : font;
					if (font !== current && query && !registered.includes(font)) {
						const plus = item.createSpan({ cls: 'wm-paged-popover-check', attr: { 'aria-hidden': 'true' } });
						setIcon(plus, 'plus');
					}
				}
			};
			search.addEventListener('input', render);
			render();
			void this.loadInstalledFonts().then(() => { if (popover.isConnected) render(); });
			window.setTimeout(() => search.focus(), 0);
		});
	}

	private openFontSizePopover(anchor: HTMLElement): void {
		const current = this.pixelsToPoints(this.sheet.getSelectionStyle().fontSize ?? DEFAULT_PLOTBOOK_FONT_SIZE);
		const sizes = Array.from(new Set([8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, current]))
			.sort((left, right) => left - right);
		this.openPopover(anchor, 'wm-paged-size-popover', popover => {
			const direct = popover.createEl('label', { cls: 'wm-paged-size-input-row' });
			const input = direct.createEl('input', {
				type: 'number',
				value: this.formatNumber(current),
				attr: { min: '1', max: '300', step: '1', 'aria-label': '글자 크기 직접 입력' },
			});
			direct.createSpan({ cls: 'wm-paged-size-input-unit', text: 'pt' });
			const apply = () => {
				const points = Math.max(1, Math.min(300, Number(input.value) || current));
				this.sheet.applySelectionStyle({ fontSize: points * CSS_PX_PER_PT });
				this.closePopover();
			};
			input.addEventListener('keydown', event => {
				if (event.key !== 'Enter') return;
				event.preventDefault();
				apply();
			});
			input.addEventListener('change', apply);
			const list = popover.createDiv({ cls: 'wm-paged-size-list' });
			for (const size of sizes) {
				const item = list.createEl('button', {
					cls: `wm-paged-popover-item wm-paged-size-option${size === current ? ' is-active' : ''}`,
					attr: { type: 'button' },
				});
				const sample = item.createSpan({ cls: 'wm-paged-size-option-sample', text: `${this.formatNumber(size)} pt` });
				sample.style.fontSize = `${Math.max(10, Math.min(42, size))}px`;
				item.addEventListener('pointerenter', () => {
					input.value = this.formatNumber(size);
				});
				item.addEventListener('click', () => {
					this.sheet.applySelectionStyle({ fontSize: size * CSS_PX_PER_PT });
					this.closePopover();
				});
			}
			window.setTimeout(() => input.select(), 0);
		});
	}

	private createColorControl(container: HTMLElement, target: PlotWorkbookColorTarget): void {
		const textTarget = target === 'color';
		const label = textTarget ? '글자색' : '배경색';
		const control = container.createDiv({
			cls: `wm-paged-text-color-control wm-plotbook-color-control is-${textTarget ? 'text' : 'background'}`,
		});
		const button = control.createEl('button', {
			cls: 'wm-paged-toolbar-button wm-paged-text-color-button clickable-icon',
			attr: { type: 'button', 'aria-label': `최근 ${label} 적용` },
		});
		if (textTarget) {
			const svg = this.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.setAttribute('viewBox', FONT_COLOR_ICON_VIEWBOX);
			const path = this.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', FONT_COLOR_ICON_PATH);
			path.setAttribute('fill', 'currentColor');
			svg.appendChild(path);
			button.appendChild(svg);
			this.textColorButton = button;
		} else {
			setIcon(button, 'paintbrush');
			this.backgroundColorButton = button;
		}
		button.addEventListener('click', () => {
			const color = textTarget ? this.getRecentTextColor() : this.getRecentBackgroundColor();
			this.sheet.applySelectionStyle({ [target]: color });
		});
		const chevron = control.createEl('button', {
			cls: 'wm-paged-text-color-chevron clickable-icon',
			attr: { type: 'button', 'aria-label': `${label} 메뉴 열기`, 'aria-haspopup': 'menu' },
		});
		setIcon(chevron, 'chevron-down');
		chevron.addEventListener('click', event => {
			event.stopPropagation();
			this.openColorPopover(chevron, target);
		});
	}

	private openColorPopover(anchor: HTMLElement, target: PlotWorkbookColorTarget): void {
		const textTarget = target === 'color';
		const label = textTarget ? '글자색' : '배경색';
		const colors = textTarget ? TEXT_COLOR_PALETTE : BACKGROUND_COLOR_PALETTE;
		const fallback = textTarget ? DEFAULT_TEXT_COLORS : DEFAULT_BACKGROUND_COLORS;
		let mode: ColorThemeMode = themeModeFromDocument(this.ownerDocument);
		this.openPopover(anchor, 'wm-paged-color-popover wm-plotbook-color-popover', popover => {
			const render = () => {
				const editingMode = mode;
				popover.empty();
				this.renderColorModeSegmented(popover, mode, next => {
					this.flushPendingColorCommit();
					mode = next;
					render();
				});
				const currentPair = () => toThemeColorPair(this.sheet.getSelectionStyle()[target]
					?? (textTarget ? this.getRecentTextColor() : this.getRecentBackgroundColor()), fallback);
				const applyModeColor = (color: string) => {
					const recent = { ...currentPair(), [editingMode]: color };
					if (target === 'color') this.plugin.settings.plotWorkbookLastTextColor = recent;
					else this.plugin.settings.plotWorkbookLastBackgroundColor = recent;
					// A mixed selection has no common pair. Preserve each target's
					// opposite theme instead of replacing it with the recent color.
					this.sheet.applySelectionStyle(style => ({
						[target]: { ...toThemeColorPair(style[target], fallback), [editingMode]: color },
					}));
					void this.plugin.saveSettings();
					this.refresh();
				};
				const row = popover.createDiv({ cls: 'wm-paged-color-row' });
				row.createSpan({ cls: 'wm-paged-color-row-label', text: label });
				const palette = row.createDiv({ cls: 'wm-paged-color-row-palette' });
				for (const color of colors) {
					const swatch = palette.createEl('button', {
						cls: 'wm-paged-color-swatch wm-writing-color-swatch',
						attr: { type: 'button', 'aria-label': `${editingMode === 'light' ? '라이트' : '다크'} ${label} ${color[editingMode]}` },
					});
					swatch.style.backgroundColor = color[editingMode];
					swatch.addEventListener('click', () => {
						this.flushPendingColorCommit();
						applyModeColor(color[editingMode]);
						render();
					});
				}
				const custom = popover.createDiv({ cls: 'wm-paged-color-custom' });
				custom.createSpan({ text: '사용자 색상' });
				const actions = custom.createDiv({ cls: 'wm-paged-color-custom-actions' });
				const reset = actions.createEl('button', {
					cls: 'wm-paged-color-reset clickable-icon',
					attr: { type: 'button', 'aria-label': `${label} 지우기` },
				});
				setIcon(reset, 'rotate-ccw');
				reset.addEventListener('click', () => {
					this.flushPendingColorCommit();
					this.sheet.applySelectionStyle({ [target]: undefined });
					render();
				});
				const input = actions.createEl('input', {
					cls: 'wm-compact-color-input wm-paged-color-custom-input',
					type: 'color',
					attr: { 'aria-label': `사용자 ${label} 선택` },
				});
				input.value = currentPair()[editingMode];
				this.trackColorInput(input, applyModeColor);
			};
			render();
		});
	}

	private renderColorModeSegmented(
		container: HTMLElement,
		mode: ColorThemeMode,
		onChange: (mode: ColorThemeMode) => void,
	): void {
		const segmented = container.createDiv({
			cls: 'wm-dash-char-range-seg wm-writing-layout-segmented wm-writing-color-mode-segmented',
			attr: { role: 'group', 'aria-label': '색상 테마' },
		});
		const thumb = segmented.createSpan({ cls: 'wm-dash-char-range-thumb' });
		const buttons = new Map<ColorThemeMode, HTMLButtonElement>();
		for (const [key, label] of [['light', '라이트'], ['dark', '다크']] as const) {
			const button = segmented.createEl('button', {
				text: label,
				attr: { type: 'button', 'aria-pressed': String(mode === key) },
			});
			buttons.set(key, button);
			button.addEventListener('click', () => onChange(key));
		}
		window.requestAnimationFrame(() => {
			const active = buttons.get(mode);
			if (!active || !segmented.isConnected) return;
			thumb.setCssStyles({
				width: `${active.offsetWidth}px`,
				height: `${active.offsetHeight}px`,
				transform: `translate(${active.offsetLeft}px, ${active.offsetTop}px)`,
			});
		});
	}

	private getRecentTextColor(): ThemeAwareColor {
		return this.plugin.settings.plotWorkbookLastTextColor || { ...DEFAULT_TEXT_COLORS };
	}

	private getRecentBackgroundColor(): ThemeAwareColor {
		return this.plugin.settings.plotWorkbookLastBackgroundColor || { ...DEFAULT_BACKGROUND_COLORS };
	}

	private readonly createIconButton = createToolbarIconButton;

	private createSelect(container: HTMLElement, label: string, text: string, extraClass: string, icon?: string): HTMLButtonElement {
		return createToolbarSelect(container, label, text, extraClass, icon ? { name: icon, className: 'wm-plotbook-select-icon' } : undefined);
	}

	private readonly createOption = createToolbarOption;

	private openPopover(anchor: HTMLElement, className: string, render: (popover: HTMLElement) => void): void {
		if (this.activeAnchor === anchor) {
			this.closePopover();
			return;
		}
		this.closePopover();
		const popover = this.mountEl.createDiv({
			cls: `wm-paged-toolbar-popover ${className}`,
			attr: { role: 'menu' },
		});
		this.activePopover = popover;
		this.activeAnchor = anchor;
		anchor.addClass('is-open');
		render(popover);
		const rootRect = this.mountEl.getBoundingClientRect();
		const anchorRect = anchor.getBoundingClientRect();
		const popoverRect = popover.getBoundingClientRect();
		const desiredLeft = anchorRect.left - rootRect.left;
		const maxLeft = Math.max(8, rootRect.width - popoverRect.width - 8);
		popover.style.left = `${Math.max(8, Math.min(maxLeft, desiredLeft))}px`;
		popover.style.top = `${anchorRect.bottom - rootRect.top + 7}px`;
	}

	private closePopover(): void {
		const closingSearch = this.activeAnchor === this.filterButton;
		this.flushPendingColorCommit();
		this.activeAnchor?.removeClass('is-open');
		this.activePopover?.remove();
		this.activePopover = null;
		this.activeAnchor = null;
		if (closingSearch) {
			this.sheet.setSearchQuery('', false);
			this.filterButton?.removeClass('is-active');
			this.filterButton?.setAttribute('aria-pressed', 'false');
		}
	}

	private trackColorInput(input: HTMLInputElement, apply: (color: string) => void): void {
		let pending: string | null = null;
		const queue = () => {
			pending = input.value;
			this.pendingColorCommit = () => {
				const color = pending;
				pending = null;
				if (color) apply(color);
			};
		};
		input.addEventListener('input', queue);
		input.addEventListener('change', () => {
			queue();
			this.flushPendingColorCommit();
		});
	}

	private flushPendingColorCommit(): void {
		const commit = this.pendingColorCommit;
		this.pendingColorCommit = null;
		commit?.();
	}

	private loadInstalledFonts(): Promise<string[]> { return this.fontCache.load(this.ownerDocument); }

	private readonly pixelsToPoints = pixelsToPoints;

	private readonly formatNumber = formatTypographyNumber;
}
