import { wmT } from '../i18n/index';
import {
	Platform,
	TFile,
	WorkspaceLeaf,
	sanitizeHTMLToDom,
	setIcon,
} from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { HwpxExportModal, TxtExportModal } from '../export';
import { TimerStopwatchWidget } from '../dashboard/TimerStopwatchWidget';
import { FONT_COLOR_ICON_PATH, FONT_COLOR_ICON_VIEWBOX } from '../assets/fontColorIcon';
import { MARKDOWN_ICON_SVG } from '../assets/markdownIcon';
import { MUNPIA_SVG, NOVELPIA_SVG } from '../assets/platformLogos';
import type { PagedInlineFormatKind, PagedParagraphAlignmentValue, WritingWidgetId } from '../types';
import { appendToolbarChevron, createToolbarActionOption, createToolbarIconButton, createToolbarOption, createToolbarSelect } from './toolbarUi';
import { InstalledFontCache } from './InstalledFontCache';
import { bindMobileToolbarPopover } from './MobileToolbarPopover';
import { MOBILE_WEB_FONTS, mobileFontName } from '../fonts/MobileFontManager';
import { fontWeightOptions } from '../fonts/FontWeights';
import { openSnapshotManager } from '../snapshots/SnapshotManager';
import { CSS_PX_PER_MM as PX_PER_MM, CSS_PX_PER_PT, formatTypographyNumber, pixelsToPoints } from '../utils/typography';

export interface WritingToolbarSurface {
	kind: 'markdown' | 'paged';
	leaf: WorkspaceLeaf;
	getFile(): TFile | null;
	getText(): string;
	focus(): void;
	undo(): void;
	redo(): void;
	toggleFormat(kind: PagedInlineFormatKind): void;
	isFormatActive(kind: PagedInlineFormatKind): boolean;
	preserveSelection?(event: PointerEvent): void;
	getAlignment(): PagedParagraphAlignmentValue | null;
	setAlignment(alignment: PagedParagraphAlignmentValue): void;
	applyTextColor(color: string, target: 'text' | 'background'): void;
	clearTextColors(): void;
	getRecentTextColor(): string;
	switchView(): void | Promise<void>;
	getZoom(): number;
	setZoom(value: number): void;
}

export class WritingToolbar {
	readonly toolbarEl: HTMLElement;
	private activePopover: HTMLElement | null = null;
	private popoverLayoutCleanup: (() => void) | null = null;
	private activeAnchor: HTMLElement | null = null;
	private fontLabelEl: HTMLElement | null = null;
	private weightLabelEl: HTMLElement | null = null;
	private sizeLabelEl: HTMLElement | null = null;
	private textColorButtonEl: HTMLButtonElement | null = null;
	private widgetDockEl: HTMLElement | null = null;
	private timerWidgetValueEl: HTMLElement | null = null;
	private zoomValueEl: HTMLElement | null = null;
	private readonly formatButtons = new Map<PagedInlineFormatKind, HTMLButtonElement>();
	private readonly widgetCharCountElements = new Map<'munpia' | 'novelpia', HTMLElement>();
	private stopwatchUnsubscribe: (() => void) | null = null;
	private timerModeUnsubscribe: (() => void) | null = null;
	private widgetDragActive = false;
	private wideModeButtonEl: HTMLButtonElement | null = null;
	private focusModeButtonEl: HTMLButtonElement | null = null;
	private readonly fontCache = new InstalledFontCache();
	private get installedFontFamilies(): string[] | null { return this.fontCache.families; }
	private readonly ownerDocument: Document;
	private readonly outsidePointerHandler: (event: PointerEvent) => void;
	private pendingColorCommit: (() => void) | null = null;
	private autoHideCollapseTimer = 0;

	constructor(
		private readonly plugin: WritingMenuPlugin,
		private readonly mountEl: HTMLElement,
		private readonly surface: WritingToolbarSurface,
	) {
		this.ownerDocument = mountEl.ownerDocument;
		this.toolbarEl = mountEl.createDiv({
			cls: `wm-paged-toolbar wm-writing-toolbar is-${surface.kind}`,
			attr: { role: 'toolbar' },
		});
		this.toolbarEl.addEventListener('pointerenter', () => this.revealAutoHiddenToolbar());
		this.toolbarEl.addEventListener('pointerleave', event => {
			if (this.activePopover?.contains(event.relatedTarget as Node | null)) return;
			this.scheduleAutoHideCollapse();
		});
		this.toolbarEl.addEventListener('focusin', () => this.revealAutoHiddenToolbar());
		this.toolbarEl.addEventListener('focusout', event => {
			const next = event.relatedTarget as Node | null;
			if (next && (this.toolbarEl.contains(next) || this.activePopover?.contains(next))) return;
			this.scheduleAutoHideCollapse();
		});
		this.render();
		this.stopwatchUnsubscribe = this.plugin.stopwatchManager.subscribeWidget(() => this.refreshTimerWidget());
		this.timerModeUnsubscribe = TimerStopwatchWidget.subscribeMode(() => this.refreshTimerWidget());
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
		window.clearTimeout(this.autoHideCollapseTimer);
		this.stopwatchUnsubscribe?.();
		this.stopwatchUnsubscribe = null;
		this.timerModeUnsubscribe?.();
		this.timerModeUnsubscribe = null;
		this.widgetDockEl?.remove();
		this.widgetDockEl = null;
		this.toolbarEl.remove();
	}

	refresh(): void {
		const settings = this.plugin.settings;
		this.refreshAutoHideState();
		this.fontLabelEl?.setText(Platform.isMobile ? mobileFontName(settings.mobileFontFamily)
			: settings.fontFamily === 'inherit' ? wmT("시스템 폰트") : settings.fontFamily);
		const weight = settings.fontWeight || 400;
		this.weightLabelEl?.setText(fontWeightOptions().find(([value]) => value === weight)?.[1] ?? String(weight));
		this.sizeLabelEl?.setText(`${this.formatNumber(this.pixelsToPoints(settings.fontSize))} pt`);
		this.refreshSelectionState();
		this.renderWidgetDock();
		this.updateWidgetCharCounts(this.plugin.calculateAllCharCounts(this.surface.getText()));
		this.refreshTimerWidget();
		this.refreshZenModeButtons();
		if (this.zoomValueEl) this.zoomValueEl.setText(`${Math.round(this.surface.getZoom() * 100)}%`);
	}

	updateWidgetCharCounts(
		counts: { munpia: number; novelpia: number },
		selectedCounts: { munpia: number; novelpia: number } | null = null,
	): void {
		for (const mode of ['munpia', 'novelpia'] as const) {
			const valueEl = this.widgetCharCountElements.get(mode);
			if (!valueEl) continue;
			const total = this.plugin.formatCharCount(counts[mode]);
			valueEl.setText(selectedCounts
				? `${this.plugin.formatCharCount(selectedCounts[mode])} / ${total}`
				: total);
		}
	}

	refreshSelectionState(): void {
		for (const [kind, button] of this.formatButtons) {
			const active = this.surface.isFormatActive(kind);
			button.toggleClass('is-active', active);
			button.setAttribute('aria-pressed', String(active));
		}
		if (this.textColorButtonEl) {
			const color = this.plugin.settings.pagedLastTextColor;
			this.textColorButtonEl.style.color = /^#[0-9a-f]{6}$/i.test(color) ? color : 'var(--text-muted)';
		}
	}

	private render(): void {
		if (!Platform.isMobile) {
			const history = this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-group is-history' });
			this.createIconButton(history, 'undo-2', wmT("이전 (Ctrl/Cmd+Z)"), () => this.surface.undo());
			this.createIconButton(history, 'redo-2', wmT("다음 (Ctrl/Cmd+Shift+Z)"), () => this.surface.redo());
		}

		const typography = this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-group is-typography' });
		const font = this.createSelect(typography, wmT("글꼴"), wmT("시스템 폰트"), 'is-font');
		this.fontLabelEl = font.querySelector('.wm-paged-select-label');
		font.addEventListener('click', event => { event.stopPropagation(); this.openFontPopover(font); });
		const weight = this.createSelect(typography, wmT("글꼴 두께"), wmT("보통"), 'is-weight');
		this.weightLabelEl = weight.querySelector('.wm-paged-select-label');
		weight.addEventListener('click', event => { event.stopPropagation(); this.openWeightPopover(weight); });
		const size = this.createSelect(typography, wmT("글꼴 크기"), '12 pt', 'is-size');
		this.sizeLabelEl = size.querySelector('.wm-paged-select-label');
		size.addEventListener('click', event => { event.stopPropagation(); this.openFontSizePopover(size); });
		const format = this.createSelect(typography, wmT("서식"), wmT("서식"), 'is-format');
		format.addEventListener('pointerdown', event => this.preserveSelection(event));
		format.addEventListener('click', event => { event.stopPropagation(); this.openFormatPopover(format); });

		const formatting = this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-group is-formatting' });
		for (const [icon, label, kind] of [
			['bold', wmT("굵게 (Ctrl/Cmd+B)"), 'bold'],
			['italic', wmT("이탤릭체 (Ctrl/Cmd+I)"), 'italic'],
			['underline', wmT("밑줄 (Ctrl/Cmd+U)"), 'underline'],
			['strikethrough', wmT("취소선 (Ctrl/Cmd+Shift+S)"), 'strikethrough'],
		] as const) {
			const button = this.createIconButton(formatting, icon, label, () => {
				this.surface.toggleFormat(kind);
				this.refresh();
			});
			button.setAttribute('aria-pressed', 'false');
			button.addEventListener('pointerdown', event => this.preserveSelection(event));
			this.formatButtons.set(kind, button);
		}

		this.createTextColorControl(formatting);

		const actions = this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-group is-document' });
		const layout = this.createIconButton(actions, 'panels-top-left', wmT("레이아웃"), () => {});
		layout.addEventListener('click', event => { event.stopPropagation(); this.openLayoutPopover(layout); });

		this.createIconButton(actions, 'copy', wmT("복사하기"), () => { void this.plugin.copyWithOptions(this.surface.leaf); });
		const exportButton = this.createIconButton(actions, 'file-output', wmT("내보내기"), () => {});
		exportButton.addEventListener('click', event => { event.stopPropagation(); this.openExportPopover(exportButton); });

		this.wideModeButtonEl = this.createIconButton(actions, 'maximize-2', wmT("길게 보기"), () => {
			this.plugin.toggleZenMode('wide', this.surface.leaf);
		});
		this.wideModeButtonEl.addClass('wm-writing-wide-mode-button');
		this.wideModeButtonEl.setAttribute('aria-pressed', 'false');
		this.focusModeButtonEl = this.createIconButton(actions, 'flame', wmT("집중 모드"), () => {
			this.plugin.toggleZenMode('focus', this.surface.leaf);
		});
		this.focusModeButtonEl.addClass('wm-writing-focus-mode-button');
		this.focusModeButtonEl.setAttribute('aria-pressed', 'false');
		this.createIconButton(actions, 'git-branch', wmT("플롯 매니저를 새 탭에서 열기"), () => {
			void this.plugin.openPlotManagerInNewTab();
		});
		this.createIconButton(actions, 'panel-right', wmT("플롯 매니저 사이드바"), () => {
			const project = this.plugin.projectContext.getProjectForFile(this.surface.getFile());
			void this.plugin.openPlotWorkbookSidebar(project ? { projectId:project.id } : {});
		});

		const tower = this.createIconButton(actions, 'toggle-left', wmT("기능 제어"), () => {});
		tower.addEventListener('click', event => { event.stopPropagation(); this.openControlTowerPopover(tower); });

		this.createIconButton(actions, 'camera', wmT("스냅샷 관리"), () => openSnapshotManager(this.plugin, this.surface.leaf));
		if (!Platform.isMobile) {
			const switchButton = this.createIconButton(
				actions,
				null,
				this.surface.kind === 'markdown' ? wmT("여러 쪽 보기로 전환") : wmT("Markdown으로 전환"),
				() => { void this.surface.switchView(); },
			);
			switchButton.addClass('wm-writing-toolbar-switch');
			switchButton.addClass(this.surface.kind === 'markdown' ? 'is-paged-target' : 'is-markdown-target');
			if (this.surface.kind === 'markdown') setIcon(switchButton, 'layout-grid');
			else switchButton.appendChild(sanitizeHTMLToDom(MARKDOWN_ICON_SVG));
		}

		this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-spacer', attr: { 'aria-hidden': 'true' } });
		const settingsGroup = this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-group is-settings' });
		const settings = this.createIconButton(settingsGroup, 'settings', wmT("플러그인 설정"), () => {});
		settings.addEventListener('click', event => {
			event.stopPropagation();
			this.closePopover();
			this.plugin.openSettings();
		});

		if (!Platform.isMobile && this.surface.kind === 'paged') this.renderZoomControls();
		this.widgetDockEl = this.mountEl.createDiv({
			cls: `wm-writing-widget-dock is-${this.surface.kind}`,
			attr: { 'aria-label': wmT("작성 위젯") },
		});
	}

	private renderZoomControls(): void {
		const zoom = this.toolbarEl.createDiv({ cls: 'wm-paged-toolbar-group is-zoom' });
		const zoomOut = this.createIconButton(zoom, 'zoom-out', wmT("축소 (Ctrl/Cmd+마우스 휠 아래)"), () => {
			this.surface.setZoom(this.surface.getZoom() - 0.1);
			this.refresh();
		});
		const zoomReset = zoom.createEl('button', {
			cls: 'wm-paged-zoom-reset',
			attr: { type: 'button', 'aria-label': wmT("배율을 100%로 초기화") },
		});
		this.zoomValueEl = zoomReset.createSpan({ cls: 'wm-paged-zoom-value', text: '100%' });
		zoomReset.addEventListener('click', () => { this.surface.setZoom(1); this.refresh(); });
		const zoomIn = this.createIconButton(zoom, 'zoom-in', wmT("확대 (Ctrl/Cmd+마우스 휠 위)"), () => {
			this.surface.setZoom(this.surface.getZoom() + 0.1);
			this.refresh();
		});
		const zoomDisabled = this.surface.kind === 'markdown';
		for (const button of [zoomOut, zoomReset, zoomIn]) {
			button.disabled = zoomDisabled;
			button.setAttribute('aria-disabled', String(zoomDisabled));
		}
	}

	private getWidgetOrder(): WritingWidgetId[] {
		const configured = this.plugin.settings.writingWidgetOrder ?? [];
		return (['munpia', 'novelpia', 'timer'] as WritingWidgetId[])
			.filter(id => configured.includes(id))
			.sort((left, right) => configured.indexOf(left) - configured.indexOf(right));
	}

	private isWidgetVisible(id: WritingWidgetId): boolean {
		if (id === 'munpia') return this.plugin.settings.showMunpiaWidget;
		if (id === 'novelpia') return this.plugin.settings.showNovelpiaWidget;
		return this.plugin.settings.showTimerWidget;
	}

	private renderWidgetDock(): void {
		const dock = this.widgetDockEl;
		if (!dock) return;
		const order = this.getWidgetOrder();
		const visible = order.filter(id => this.isWidgetVisible(id));
		const signature = visible.join('|');
		if (dock.dataset.signature === signature) return;
		dock.dataset.signature = signature;
		dock.empty();
		this.widgetCharCountElements.clear();
		this.timerWidgetValueEl = null;
		dock.toggleAttribute('hidden', visible.length === 0);

		for (const id of visible) {
			const card = dock.createEl('button', {
				cls: 'wm-writing-widget-card',
				attr: {
					type: 'button',
					draggable: 'true',
					'data-widget-id': id,
					'aria-label': wmT("{0} 위젯. 드래그하여 순서 변경", id === 'munpia' ? wmT("문피아 글자수") : id === 'novelpia' ? wmT("노벨피아 글자수") : wmT("타이머/스톱워치")),
				},
			});
			if (id !== 'timer') {
				const icon = card.createSpan({ cls: 'wm-writing-widget-icon', attr: { 'aria-hidden': 'true' } });
				icon.appendChild(sanitizeHTMLToDom(id === 'munpia' ? MUNPIA_SVG : NOVELPIA_SVG));
			}

			const value = card.createSpan({ cls: 'wm-writing-widget-value' });
			if (id === 'munpia' || id === 'novelpia') this.widgetCharCountElements.set(id, value);
			else {
				this.timerWidgetValueEl = value;
				card.addEventListener('click', event => {
					if (this.widgetDragActive) return;
					event.stopPropagation();
					this.openPopover(card, 'wm-writing-timer-popover', popover => {
						TimerStopwatchWidget.render(popover, this.plugin);
					});
				});
			}
			this.installWidgetDragHandlers(card, id);
		}
	}

	private installWidgetDragHandlers(card: HTMLButtonElement, id: WritingWidgetId): void {
		card.addEventListener('dragstart', event => {
			this.widgetDragActive = true;
			card.addClass('is-dragging');
			event.dataTransfer?.setData('text/plain', id);
			if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
		});
		card.addEventListener('dragend', () => {
			card.removeClass('is-dragging');
			window.setTimeout(() => { this.widgetDragActive = false; }, 0);
		});
		card.addEventListener('dragover', event => {
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		});
		card.addEventListener('drop', event => {
			event.preventDefault();
			event.stopPropagation();
			const source = event.dataTransfer?.getData('text/plain') as WritingWidgetId | undefined;
			if (!source || source === id || !['munpia', 'novelpia', 'timer'].includes(source)) return;
			const next = this.getWidgetOrder().filter(widgetId => widgetId !== source);
			let targetIndex = next.indexOf(id);
			if (event.clientX > card.getBoundingClientRect().left + card.offsetWidth / 2) targetIndex += 1;
			next.splice(Math.max(0, targetIndex), 0, source);
			this.plugin.settings.writingWidgetOrder = next;
			void this.plugin.saveSettings();
		});
	}

	private refreshTimerWidget(): void {
		if (!this.timerWidgetValueEl) return;
		this.timerWidgetValueEl.setText(TimerStopwatchWidget.getDisplayTime(this.plugin));
		this.timerWidgetValueEl.parentElement?.toggleClass('is-running', TimerStopwatchWidget.isRunning(this.plugin));
	}

	refreshZenModeButtons(): void {
		const wideActive = this.plugin.zenState === 'wide' || activeDocument.body.classList.contains('wm-wide-mode');
		const focusActive = this.plugin.zenState === 'focus' || activeDocument.body.classList.contains('wm-focus-mode');
		this.wideModeButtonEl?.toggleClass('is-active', wideActive);
		this.wideModeButtonEl?.setAttribute('aria-pressed', String(wideActive));
		this.focusModeButtonEl?.toggleClass('is-active', focusActive);
		this.focusModeButtonEl?.setAttribute('aria-pressed', String(focusActive));
	}

	private readonly createIconButton = createToolbarIconButton;

	private readonly createSelect = createToolbarSelect;

	private readonly appendChevron = appendToolbarChevron;

	private preserveSelection(event: PointerEvent): void {
		event.preventDefault();
		this.surface.preserveSelection?.(event);
	}

	private openFontPopover(anchor: HTMLElement): void {
		if (Platform.isMobile) {
			this.openMobileFontPopover(anchor);
			return;
		}
		this.openPopover(anchor, 'wm-paged-font-popover', popover => {
			const searchRow = popover.createDiv({ cls: 'wm-paged-popover-search' });
			const icon = searchRow.createSpan({ attr: { 'aria-hidden': 'true' } });
			setIcon(icon, 'search');
			const search = searchRow.createEl('input', { type: 'text', placeholder: wmT("시스템 글꼴 검색"),
				attr: { 'aria-label': wmT("글꼴 이름"), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' } });
			const list = popover.createDiv({ cls: 'wm-paged-popover-list' });
			if (Platform.isMobile) popover.createDiv({ cls: 'wm-paged-popover-heading', text: wmT("PC에서 등록한 글꼴은 모바일에 자동 설치되지 않습니다.") });
			const registeredFonts = () => Array.from(new Set([
				'inherit',
				...(this.plugin.settings.customFonts ?? []),
				this.plugin.settings.fontFamily,
			].filter(Boolean)));
			const selectFont = (font: string) => {
				if (font !== 'inherit' && !(this.plugin.settings.customFonts ?? []).includes(font)) {
					this.plugin.settings.customFonts = [...(this.plugin.settings.customFonts ?? []), font];
				}
				this.plugin.settings.fontFamily = font;
				void this.saveAndRefresh();
			};
			let choices: string[] = [];
			const render = () => {
				list.empty();
				const raw = search.value.trim();
				const query = raw.toLocaleLowerCase('ko-KR');
				const registered = registeredFonts();
				const available = Array.from(new Set([...registered, ...(this.installedFontFamilies ?? [])]));
				let fonts = query
					? available.filter(font => font.toLocaleLowerCase('ko-KR').includes(query))
					: registered;
				if (query && fonts.length === 0) fonts = [raw];
				choices = fonts.slice(0, 80);
				for (const font of choices) {
					const active = font === this.plugin.settings.fontFamily;
					const item = this.createOption(list, font === 'inherit' ? wmT("시스템 폰트") : font, active, () => selectFont(font));
					// Keep the IME/keyboard in place until click commits the choice.
					// Blurring on touch-down can resize/rebuild the list before click.
					item.addEventListener('pointerdown', event => {
						if (Platform.isMobile && event.button === 0) event.preventDefault();
					});
					item.style.fontFamily = font === 'inherit' ? 'var(--font-interface)' : `"${font}"`;
					if (!active && query && !registered.includes(font)) {
						const plus = item.createSpan({ cls: 'wm-paged-popover-check', attr: { 'aria-hidden': 'true' } });
						setIcon(plus, 'plus');
					}
				}
			};
			search.addEventListener('input', render);
			search.addEventListener('keydown', event => {
				if (event.key !== 'Enter' || event.isComposing) return;
				const raw = search.value.trim();
				if (!raw) return;
				const font = choices.find(font => font.toLocaleLowerCase('ko-KR') === raw.toLocaleLowerCase('ko-KR')) ?? choices[0] ?? raw;
				event.preventDefault();
				selectFont(font);
			});
			render();
			void this.loadInstalledFonts().then(() => { if (popover.isConnected) render(); });
			window.setTimeout(() => search.focus(), 0);
		});
	}

	private openMobileFontPopover(anchor: HTMLElement): void {
		this.openPopover(anchor, 'wm-paged-font-popover', popover => {
			const row = popover.createDiv({ cls: 'wm-paged-popover-search' });
			setIcon(row.createSpan({ attr: { 'aria-hidden': 'true' } }), 'search');
			const search = row.createEl('input', { type: 'text', placeholder: wmT("모바일 웹폰트 검색"),
				attr: { 'aria-label': wmT("글꼴 이름"), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' } });
			const list = popover.createDiv({ cls: 'wm-paged-popover-list' });
			let choices: Array<{ id: string; name: string }> = [];
			const select = (id: string) => {
				this.plugin.settings.mobileFontFamily = id;
				void this.plugin.mobileFonts?.ensureSelected(this.ownerDocument, true);
				void this.saveAndRefresh();
			};
			const render = () => {
				list.empty();
				const query = search.value.replace(/\s/g, '').toLocaleLowerCase('ko-KR');
				choices = [{ id: 'inherit', name: wmT("시스템 폰트") }, ...MOBILE_WEB_FONTS]
					.filter(font => `${font.name}${font.id}`.replace(/\s/g, '').toLocaleLowerCase('ko-KR').includes(query));
				for (const font of choices) {
					const option = this.createOption(list, font.name, (this.plugin.settings.mobileFontFamily || 'inherit') === font.id, () => select(font.id));
					option.addEventListener('pointerdown', event => { if (event.button === 0) event.preventDefault(); });
				}
				if (!choices.length) list.createDiv({ cls: 'wm-paged-popover-heading', text: wmT("지원하는 웹폰트가 없습니다.") });
			};
			search.addEventListener('input', render);
			search.addEventListener('keydown', event => {
				if (event.key !== 'Enter' || event.isComposing || !choices.length) return;
				event.preventDefault();
				select(choices[0].id);
			});
			render();
			window.setTimeout(() => search.focus(), 0);
		});
	}

	private loadInstalledFonts(): Promise<string[]> { return this.fontCache.load(this.ownerDocument); }

	private openWeightPopover(anchor: HTMLElement): void {
		this.openPopover(anchor, 'wm-paged-compact-popover', popover => {
			for (const [weight, label] of fontWeightOptions()) {
				const item = this.createOption(popover, label, weight === this.plugin.settings.fontWeight, () => {
					this.plugin.settings.fontWeight = weight;
					void this.saveAndRefresh();
				});
				item.style.fontWeight = String(weight);
			}
		});
	}

	private openFontSizePopover(anchor: HTMLElement): void {
		const current = this.pixelsToPoints(this.plugin.settings.fontSize);
		const sizes = Array.from(new Set([8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, current]))
			.sort((left, right) => left - right);
		this.openPopover(anchor, 'wm-paged-size-popover', popover => {
			const direct = popover.createEl('label', { cls: 'wm-paged-size-input-row' });
			const input = direct.createEl('input', {
				type: 'number',
				value: this.formatNumber(current),
				attr: { min: '1', max: '400', step: '1', 'aria-label': wmT("글자 크기 직접 입력") },
			});
			direct.createSpan({ cls: 'wm-paged-size-input-unit', text: 'pt' });
			const apply = () => this.applyFontSize(Math.max(1, Math.min(400, Number(input.value) || current)));
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
				const sample = item.createSpan({ cls: 'wm-paged-size-option-sample', text: wmT("가나다 Aa") });
				sample.style.fontSize = `${Math.max(10, Math.min(42, size))}px`;
				item.addEventListener('pointerenter', () => { input.value = this.formatNumber(size); });
				item.addEventListener('click', () => this.applyFontSize(size));
			}
			window.setTimeout(() => input.select(), 0);
		});
	}

	private applyFontSize(points: number): void {
		const next = points * CSS_PX_PER_PT;
		const old = Math.max(1, this.plugin.settings.fontSize);
		const indentationEm = this.plugin.settings.indentation / old;
		this.plugin.settings.fontSize = next;
		this.plugin.settings.indentation = indentationEm * next;
		void this.saveAndRefresh();
	}

	private openFormatPopover(anchor: HTMLElement): void {
		this.openPopover(anchor, 'wm-writing-format-popover writing-menu-dropdown', popover => {
			const fontSize = Math.max(1, this.plugin.settings.fontSize);
			this.createFormatSlider(
				popover,
				wmT("들여쓰기"),
				this.plugin.settings.indentation / fontSize,
				0,
				5,
				0.1,
				value => { this.plugin.settings.indentation = value * Math.max(1, this.plugin.settings.fontSize); },
			);
			this.createFormatSlider(
				popover,
				wmT("줄 간격"),
				this.plugin.settings.lineHeight,
				1,
				3,
				0.1,
				value => { this.plugin.settings.lineHeight = value; },
			);
			this.createFormatSlider(
				popover,
				wmT("문단 간격"),
				this.plugin.settings.paragraphSpacing,
				0,
				5,
				0.1,
				value => { this.plugin.settings.paragraphSpacing = value; },
			);

			const alignmentSection = popover.createDiv({
				cls: `wm-writing-format-section wm-writing-format-alignment${this.surface.kind === 'markdown' ? ' is-disabled' : ''}`,
			});
			alignmentSection.createDiv({ cls: 'wm-writing-format-section-title', text: wmT("문단 정렬") });
			this.renderAlignmentGrid(alignmentSection);

			const styleSection = popover.createDiv({ cls: 'wm-writing-format-section wm-writing-format-style' });
			styleSection.createDiv({ cls: 'wm-writing-format-section-title', text: wmT("스타일") });
			this.renderStyleControls(styleSection);
		});
	}

	private createFormatSlider(
		container: HTMLElement,
		label: string,
		value: number,
		min: number,
		max: number,
		step: number,
		applyValue: (value: number) => void,
	): void {
		const section = container.createDiv({ cls: 'wm-writing-format-section wm-writing-format-slider-section' });
		section.createDiv({ cls: 'wm-writing-format-section-title', text: label });
		const slider = section.createEl('input', {
			type: 'range',
			cls: 'slider wm-writing-format-slider',
			attr: {
				min: String(min),
				max: String(max),
				step: String(step),
				value: String(Math.max(min, Math.min(max, value))),
				'aria-label': label,
			},
		});
		const scale = section.createDiv({ cls: 'wm-writing-format-slider-scale' });
		const minEl = scale.createSpan({ cls: 'wm-writing-format-slider-limit' });
		const currentEl = scale.createSpan({ cls: 'wm-writing-format-slider-current' });
		const maxEl = scale.createSpan({ cls: 'wm-writing-format-slider-limit' });
		const display = (raw: number) => this.formatNumber(raw);
		minEl.setText(display(min));
		maxEl.setText(display(max));

		const sync = () => {
			const next = Math.max(min, Math.min(max, Number(slider.value)));
			const percent = max === min ? 0 : ((next - min) / (max - min)) * 100;
			currentEl.setText(display(next));
			slider.setAttribute('aria-valuetext', display(next));
			slider.setCssStyles({
				background: `linear-gradient(to right, var(--text-normal) ${percent}%, var(--background-modifier-border) ${percent}%)`,
			});
			return next;
		};
		sync();
		slider.addEventListener('input', () => {
			applyValue(sync());
		});
		slider.addEventListener('change', () => {
			applyValue(sync());
			void this.plugin.saveSettings().then(() => this.refresh());
		});
	}

	private createTextColorControl(container: HTMLElement): void {
		const control = container.createDiv({ cls: 'wm-paged-text-color-control' });
		const button = control.createEl('button', {
			cls: 'wm-paged-toolbar-button wm-paged-text-color-button clickable-icon',
			attr: { type: 'button', 'aria-label': wmT("최근 글자색 적용") },
		});
		const svg = button.createSvg('svg');
		svg.setAttribute('viewBox', FONT_COLOR_ICON_VIEWBOX);
		const path = svg.createSvg('path');
		path.setAttribute('d', FONT_COLOR_ICON_PATH);
		path.setAttribute('fill', 'currentColor');
		svg.appendChild(path);
		button.appendChild(svg);
		this.textColorButtonEl = button;
		button.addEventListener('pointerdown', event => this.preserveSelection(event));
		button.addEventListener('click', () => {
			this.surface.applyTextColor(this.surface.getRecentTextColor(), 'text');
			this.refresh();
		});
		const chevron = control.createEl('button', {
			cls: 'wm-paged-text-color-chevron clickable-icon',
			attr: { type: 'button', 'aria-label': wmT("색상 메뉴 열기"), 'aria-haspopup': 'menu' },
		});
		setIcon(chevron, 'chevron-down');
		chevron.addEventListener('pointerdown', event => this.preserveSelection(event));
		chevron.addEventListener('click', event => { event.stopPropagation(); this.openTextColorPopover(chevron); });
	}

	private openTextColorPopover(anchor: HTMLElement): void {
		this.openPopover(anchor, 'wm-paged-color-popover', popover => {
			const textColors = ['#111111', '#6b7280', '#ef4444', '#3b82f6', '#8b5cf6'];
			const backgroundColors = ['#fef3c7', '#fed7aa', '#fecaca', '#bfdbfe', '#bbf7d0'];
			const createRow = (label: string, colors: string[], target: 'text' | 'background') => {
				const row = popover.createDiv({ cls: 'wm-paged-color-row' });
				row.createSpan({ cls: 'wm-paged-color-row-label', text: label });
				const palette = row.createDiv({ cls: 'wm-paged-color-row-palette' });
				for (const color of colors) {
					const swatch = palette.createEl('button', {
						cls: 'wm-paged-color-swatch wm-writing-color-swatch',
						attr: { type: 'button', 'aria-label': `${label} ${color}` },
					});
					swatch.style.backgroundColor = color;
					swatch.addEventListener('pointerdown', event => this.preserveSelection(event));
					swatch.addEventListener('click', () => {
						if (target === 'background') {
							this.plugin.settings.pagedLastBackgroundColor = color;
							void this.plugin.saveSettings();
						}
						this.surface.applyTextColor(color, target);
						this.refresh();
					});
				}
			};
			createRow(wmT("글자색"), textColors, 'text');
			createRow(wmT("배경색"), backgroundColors, 'background');
			const custom = popover.createDiv({ cls: 'wm-paged-color-custom' });
			custom.createSpan({ text: wmT("사용자 색상") });
			const actions = custom.createDiv({ cls: 'wm-paged-color-custom-actions' });
			const reset = actions.createEl('button', {
				cls: 'wm-paged-color-reset clickable-icon',
				attr: { type: 'button', 'aria-label': wmT("선택한 색상 서식 되돌리기") },
			});
			setIcon(reset, 'rotate-ccw');
			reset.addEventListener('pointerdown', event => this.preserveSelection(event));
			reset.addEventListener('click', () => { this.surface.clearTextColors(); this.refresh(); });
			for (const [label, target, value] of [
				[wmT("사용자 글자색"), 'text', this.surface.getRecentTextColor()],
				[wmT("사용자 배경색"), 'background', this.getRecentBackgroundColor()],
			] as const) {
				const input = actions.createEl('input', {
					cls: 'wm-compact-color-input wm-paged-color-custom-input',
					type: 'color',
					attr: { 'aria-label': wmT("{0} 선택", label) },
				});
				input.value = value;
				input.addEventListener('pointerdown', event => this.preserveSelection(event));
				this.trackColorInput(input, selectedColor => {
					if (target === 'background') {
						this.plugin.settings.pagedLastBackgroundColor = selectedColor;
						void this.plugin.saveSettings();
					}
					this.surface.applyTextColor(selectedColor, target);
					this.refresh();
				});
			}
		});
	}

	private renderAlignmentGrid(container: HTMLElement): void {
		const grid = container.createDiv({ cls: 'wm-paged-alignment-grid' });
		const current = this.surface.getAlignment();
		const disabled = this.surface.kind === 'markdown';
		for (const [icon, label, alignment] of [
			['align-left', wmT("왼쪽 정렬"), 'left'],
			['align-center', wmT("가운데 정렬"), 'center'],
			['align-right', wmT("오른쪽 정렬"), 'right'],
			['align-justify', wmT("양쪽 정렬"), 'justify'],
		] as const) {
			const button = grid.createEl('button', {
				cls: `wm-paged-alignment-option${alignment === current ? ' is-active' : ''}`,
				attr: {
					type: 'button',
					'aria-label': label,
					'aria-pressed': String(alignment === current),
					'aria-disabled': String(disabled),
				},
			});
			button.disabled = disabled;
			setIcon(button, icon);
			button.addEventListener('pointerdown', event => this.preserveSelection(event));
			button.addEventListener('click', () => {
				if (disabled) return;
				this.surface.setAlignment(alignment);
				this.closePopover();
			});
		}
	}

	private openLayoutPopover(anchor: HTMLElement): void {
		let selected: 'markdown' | 'paged' = this.surface.kind;
		this.openPopover(anchor, 'wm-paged-layout-popover wm-writing-layout-popover', popover => {
			const render = () => {
				popover.empty();
				const segmented = popover.createDiv({
					cls: 'wm-dash-char-range-seg wm-writing-layout-segmented',
					attr: { role: 'group', 'aria-label': wmT("레이아웃 종류") },
				});
				const thumb = segmented.createSpan({ cls: 'wm-dash-char-range-thumb' });
				const buttons = new Map<'markdown' | 'paged', HTMLButtonElement>();
				for (const [key, label] of [['markdown', wmT("마크다운")], ['paged', wmT("페이지")]] as const) {
					const button = segmented.createEl('button', {
						text: label,
						attr: { type: 'button', 'aria-pressed': String(selected === key) },
					});
					buttons.set(key, button);
					button.addEventListener('click', () => { selected = key; render(); });
				}
				window.requestAnimationFrame(() => {
					const active = buttons.get(selected);
					if (!active || !segmented.isConnected) return;
					thumb.setCssStyles({
						width: `${active.offsetWidth}px`,
						height: `${active.offsetHeight}px`,
						transform: `translate(${active.offsetLeft}px, ${active.offsetTop}px)`,
					});
				});
				if (selected === 'markdown') this.renderMarkdownLayout(popover);
				else this.renderPagedLayout(popover);
			};
			render();
		});
	}

	private renderMarkdownLayout(container: HTMLElement): void {
		const settings = this.plugin.settings;
		const body = container.createDiv({ cls: 'wm-paged-layout-body wm-writing-markdown-layout-body' });
		const previewWrap = body.createDiv({ cls: 'wm-paged-layout-preview' });
		const preview = previewWrap.createDiv({ cls: 'wm-writing-markdown-preview' });
		const previewContent = preview.createDiv({ cls: 'wm-writing-markdown-preview-content' });
		for (let index = 0; index < 8; index++) previewContent.createSpan();
		const fields = body.createDiv({ cls: 'wm-paged-layout-margin-grid' });
		const width = this.createNumberField(fields, wmT("너비"), settings.lineWidth, 100, 4000, 'px');
		const padding = this.createNumberField(fields, wmT("좌우 여백"), settings.inlinePadding ?? 40, 0, 1000, 'px');
		const update = () => {
			const lineWidth = Math.max(100, Number(width.value) || settings.lineWidth);
			const inlinePadding = Math.max(0, Number(padding.value) || 0);
			const relativeWidth = Math.max(30, Math.min(100, lineWidth / 10));
			previewContent.style.width = `${relativeWidth}%`;
			previewContent.style.paddingInline = `${Math.min(32, inlinePadding / 5)}px`;
		};
		width.addEventListener('input', update);
		padding.addEventListener('input', update);
		update();
		this.createLayoutActions(container, () => {
			settings.lineWidth = Math.max(100, Math.min(4000, Number(width.value) || settings.lineWidth));
			settings.inlinePadding = Math.max(0, Math.min(1000, Number(padding.value) || 0));
		});
	}

	private renderPagedLayout(container: HTMLElement): void {
		const settings = this.plugin.settings;
		const presets = [
			{ name: 'A4', width: 210, height: 297, isDefault: true },
			{ name: 'A5', width: 148, height: 210 },
			{ name: 'B5', width: 176, height: 250 },
			{ name: 'Letter', width: 215.9, height: 279.4 },
			{ name: 'Legal', width: 215.9, height: 355.6 },
		];
		const values = {
			width: settings.pagedPageWidth / PX_PER_MM,
			height: settings.pagedPageHeight / PX_PER_MM,
			top: settings.pagedMarginTop / PX_PER_MM,
			right: settings.pagedMarginRight / PX_PER_MM,
			bottom: settings.pagedMarginBottom / PX_PER_MM,
			left: settings.pagedMarginLeft / PX_PER_MM,
		};
		const sizeRow = container.createDiv({ cls: 'wm-paged-layout-size-row wm-writing-layout-size-row' });
		const width = this.createNumberField(sizeRow, wmT("가로"), values.width, 80, 500, 'mm');
		sizeRow.createSpan({ cls: 'wm-paged-layout-cross', text: '×' });
		const height = this.createNumberField(sizeRow, wmT("세로"), values.height, 80, 500, 'mm');
		const presetWrap = sizeRow.createDiv({ cls: 'wm-paged-layout-preset-wrap' });
		const current = presets.find(preset => Math.abs(preset.width - values.width) < 0.2 && Math.abs(preset.height - values.height) < 0.2);
		const presetButton = presetWrap.createEl('button', {
			cls: 'wm-paged-layout-preset',
			attr: { type: 'button', 'aria-label': wmT("용지 프리셋"), 'aria-haspopup': 'menu' },
		});
		const presetLabel = presetButton.createSpan({ text: current?.name ?? wmT("프리셋") });
		this.appendChevron(presetButton, 'wm-paged-layout-preset-chevron');
		const menu = presetWrap.createDiv({ cls: 'wm-paged-layout-preset-menu' });
		menu.hidden = true;
		for (const preset of presets) {
			const option = menu.createEl('button', { cls: 'wm-paged-layout-preset-option', attr: { type: 'button' } });
			option.createSpan({ text: preset.name });
			if (preset.isDefault) option.createSpan({ cls: 'wm-paged-layout-preset-default', text: wmT("기본") });
			option.addEventListener('click', event => {
				event.stopPropagation();
				width.value = this.formatNumber(preset.width);
				height.value = this.formatNumber(preset.height);
				presetLabel.setText(preset.name);
				menu.hidden = true;
				updatePreview();
			});
		}
		presetButton.addEventListener('click', event => { event.stopPropagation(); menu.hidden = !menu.hidden; });
		const body = container.createDiv({ cls: 'wm-paged-layout-body' });
		const previewWrap = body.createDiv({ cls: 'wm-paged-layout-preview' });
		const preview = previewWrap.createDiv({ cls: 'wm-paged-layout-paper' });
		const content = preview.createDiv({ cls: 'wm-paged-layout-paper-content' });
		for (let index = 0; index < 7; index++) content.createSpan();
		const fields = body.createDiv({ cls: 'wm-paged-layout-margin-grid' });
		fields.createSpan({ cls: 'wm-paged-layout-section-label', text: wmT("여백") });
		const top = this.createNumberField(fields, wmT("위"), values.top, 0, 100, 'mm');
		const right = this.createNumberField(fields, wmT("오른쪽"), values.right, 0, 100, 'mm');
		const bottom = this.createNumberField(fields, wmT("아래"), values.bottom, 0, 100, 'mm');
		const left = this.createNumberField(fields, wmT("왼쪽"), values.left, 0, 100, 'mm');
		const updatePreview = () => {
			const w = Math.max(1, Number(width.value) || values.width);
			const h = Math.max(1, Number(height.value) || values.height);
			const ratio = w / h;
			preview.style.width = `${ratio >= 1 ? 104 : 82}px`;
			preview.style.height = `${ratio >= 1 ? 82 : 116}px`;
			const scaleX = preview.clientWidth / w;
			const scaleY = preview.clientHeight / h;
			content.style.inset = `${Math.max(3, Number(top.value) * scaleY)}px ${Math.max(3, Number(right.value) * scaleX)}px ${Math.max(3, Number(bottom.value) * scaleY)}px ${Math.max(3, Number(left.value) * scaleX)}px`;
		};
		for (const input of [width, height, top, right, bottom, left]) input.addEventListener('input', updatePreview);
		window.requestAnimationFrame(updatePreview);
		this.createLayoutActions(container, () => {
			const w = Math.max(80, Math.min(500, Number(width.value) || values.width));
			const h = Math.max(80, Math.min(500, Number(height.value) || values.height));
			settings.pagedPageWidth = w * PX_PER_MM;
			settings.pagedPageHeight = h * PX_PER_MM;
			settings.pagedMarginTop = Math.max(0, Math.min(h / 2 - 1, Number(top.value) || 0)) * PX_PER_MM;
			settings.pagedMarginRight = Math.max(0, Math.min(w / 2 - 1, Number(right.value) || 0)) * PX_PER_MM;
			settings.pagedMarginBottom = Math.max(0, Math.min(h / 2 - 1, Number(bottom.value) || 0)) * PX_PER_MM;
			settings.pagedMarginLeft = Math.max(0, Math.min(w / 2 - 1, Number(left.value) || 0)) * PX_PER_MM;
		});
	}

	private createLayoutActions(container: HTMLElement, apply: () => void): void {
		const actions = container.createDiv({ cls: 'wm-paged-layout-actions' });
		const cancel = actions.createEl('button', { cls: 'wm-paged-layout-cancel', text: wmT("취소"), attr: { type: 'button' } });
		const confirm = actions.createEl('button', { cls: 'wm-paged-layout-apply', text: wmT("적용"), attr: { type: 'button' } });
		cancel.addEventListener('click', () => this.closePopover());
		confirm.addEventListener('click', () => {
			apply();
			void this.saveAndRefresh();
		});
	}

	private createNumberField(
		container: HTMLElement,
		label: string,
		value: number,
		min: number,
		max: number,
		unit: string,
	): HTMLInputElement {
		const field = container.createEl('label', { cls: 'wm-paged-layout-field' });
		field.createSpan({ text: label });
		const input = field.createEl('input', {
			type: 'number',
			value: this.formatNumber(value),
			attr: { min: String(min), max: String(max), step: '0.1' },
		});
		field.createSpan({ cls: 'wm-paged-layout-unit', text: unit });
		return input;
	}

	private renderStyleControls(container: HTMLElement): void {
		void this.plugin.addDualColorControl(container, wmT("글자색"), this.plugin.settings.fontColor, async value => {
			this.plugin.settings.fontColor = value;
			await this.plugin.saveSettings();
			this.refresh();
		}, 'palette');
		void this.plugin.addDualColorControl(container, wmT("배경색"), this.plugin.settings.backgroundColor, async value => {
			this.plugin.settings.backgroundColor = value;
			await this.plugin.saveSettings();
			this.refresh();
		}, 'droplet');
	}

	private openExportPopover(anchor: HTMLElement): void {
		this.openPopover(anchor, 'wm-writing-action-popover', popover => {
			const file = this.surface.getFile();
			if (!file) return;
			if (Platform.isDesktop) {
				this.createActionOption(popover, 'file-output', wmT("HWPX로 내보내기"), () => {
					this.closePopover();
					new HwpxExportModal(this.plugin.app, this.plugin, file).open();
				});
			}
			if (Platform.isDesktop) {
				this.createActionOption(popover, 'file-text', wmT("TXT로 내보내기"), () => {
					this.closePopover();
					new TxtExportModal(this.plugin.app, this.plugin, file).open();
				});
			}
			if (!Platform.isDesktop) popover.createDiv({ cls: 'wm-paged-popover-heading', text: wmT("데스크톱에서 사용할 수 있습니다.") });
		});
	}

	private openControlTowerPopover(anchor: HTMLElement): void {
		this.openPopover(anchor, 'wm-writing-control-popover writing-menu-dropdown', popover => {
			popover.createDiv({ cls: 'wm-paged-popover-heading', text: wmT("입력 보조") });
			void this.plugin.addCompactToggle(popover, wmT("스마트 따옴표"), this.plugin.settings.enableSmartQuotes, async value => {
				this.plugin.settings.enableSmartQuotes = value; await this.plugin.saveSettings();
			}, 'quote-glyph');
			void this.plugin.addCompactToggle(popover, wmT("스마트 엔터"), this.plugin.settings.enableSmartEnter, async value => {
				this.plugin.settings.enableSmartEnter = value; await this.plugin.saveSettings();
			}, 'corner-down-left');
			void this.plugin.addCompactToggle(popover, wmT("자동완성"), this.plugin.settings.enableSmartInput, async value => {
				this.plugin.settings.enableSmartInput = value; await this.plugin.saveSettings();
			}, 'keyboard');
			void this.plugin.addCompactToggle(popover, wmT("텍스트 치환"), this.plugin.settings.enableTextSubstitution, async value => {
				this.plugin.settings.enableTextSubstitution = value; await this.plugin.saveSettings();
			}, 'replace');
			popover.createDiv({ cls: 'writing-menu-separator' });
			popover.createDiv({ cls: 'wm-paged-popover-heading', text: wmT("보기") });
			void this.plugin.addCompactToggle(popover, wmT("타자기 스크롤"), this.plugin.settings.enableTypewriterScrolling, async value => {
				this.plugin.settings.enableTypewriterScrolling = value; await this.plugin.saveSettings();
			}, 'align-vertical-justify-center');
			void this.plugin.addCompactToggle(popover, wmT("포커스 모드"), this.plugin.settings.enableFocusMode, async value => {
				this.plugin.settings.enableFocusMode = value; await this.plugin.saveSettings();
			}, 'eye');
			void this.plugin.addCompactToggle(popover, wmT("커스텀 구분선"), this.plugin.settings.hrEnabled, async value => {
				this.plugin.settings.hrEnabled = value; await this.plugin.saveSettings();
			}, 'minus');
			if (this.surface.kind === 'markdown') {
				void this.plugin.addCompactToggle(popover, wmT("링크 색상"), !this.plugin.settings.disableLinkColor, async value => {
					this.plugin.settings.disableLinkColor = !value;
					await this.plugin.saveSettings();
				}, 'link');
			}
			popover.createDiv({ cls: 'writing-menu-separator' });
			popover.createDiv({ cls: 'wm-paged-popover-heading', text: wmT("위젯") });
			this.createWidgetVisibilityToggle(popover, 'munpia', 'MUNPIA', MUNPIA_SVG);
			this.createWidgetVisibilityToggle(popover, 'novelpia', 'NOVELPIA', NOVELPIA_SVG);
			this.createWidgetVisibilityToggle(popover, 'timer', wmT("타이머/스톱워치 표시"), 'timer');
		});
	}

	private createWidgetVisibilityToggle(
		container: HTMLElement,
		id: WritingWidgetId,
		label: string,
		iconValue: string,
	): void {
		const row = container.createDiv({ cls: 'writing-menu-control wm-writing-widget-toggle-row' });
		const labelGroup = row.createDiv({ cls: 'writing-menu-control-label-group' });
		const icon = labelGroup.createSpan({ cls: 'writing-menu-icon wm-writing-widget-toggle-icon', attr: { 'aria-hidden': 'true' } });
		if (id === 'munpia' || id === 'novelpia') icon.appendChild(sanitizeHTMLToDom(iconValue));
		else setIcon(icon, iconValue);
		labelGroup.createEl('label', { text: label });
		const toggle = row.createDiv({
			cls: `writing-menu-toggle${this.isWidgetVisible(id) ? ' is-enabled' : ''}`,
			attr: { role: 'switch', tabindex: '0', 'aria-checked': String(this.isWidgetVisible(id)) },
		});
		toggle.createDiv({ cls: 'writing-menu-toggle-thumb' });
		const apply = () => {
			const enabled = !this.isWidgetVisible(id);
			if (id === 'munpia') this.plugin.settings.showMunpiaWidget = enabled;
			else if (id === 'novelpia') this.plugin.settings.showNovelpiaWidget = enabled;
			else this.plugin.settings.showTimerWidget = enabled;
			toggle.toggleClass('is-enabled', enabled);
			toggle.setAttribute('aria-checked', String(enabled));
			void this.plugin.saveSettings();
		};
		toggle.addEventListener('click', apply);
		toggle.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			apply();
		});
	}

	private readonly createActionOption = createToolbarActionOption;

	private readonly createOption = createToolbarOption;

	private openPopover(anchor: HTMLElement, className: string, render: (popover: HTMLElement) => void): void {
		if (this.activeAnchor === anchor) {
			this.closePopover();
			return;
		}
		this.closePopover();
		const popoverRoot = Platform.isMobile ? this.ownerDocument.body : this.mountEl;
		const popover = popoverRoot.createDiv({
			cls: `wm-paged-toolbar-popover ${className}${Platform.isMobile ? ' is-mobile-portal' : ''}`,
			attr: { role: 'menu' },
		});
		this.activePopover = popover;
		this.activeAnchor = anchor;
		this.revealAutoHiddenToolbar();
		anchor.addClass('is-open');
		render(popover);
		popover.addEventListener('pointerenter', () => this.revealAutoHiddenToolbar());
		popover.addEventListener('pointerleave', event => {
			if (this.toolbarEl.contains(event.relatedTarget as Node | null)) return;
			this.scheduleAutoHideCollapse();
		});
		if (Platform.isMobile) {
			this.popoverLayoutCleanup = bindMobileToolbarPopover(anchor, popover);
			return;
		}
		const rootRect = this.mountEl.getBoundingClientRect();
		const anchorRect = anchor.getBoundingClientRect();
		const popoverRect = popover.getBoundingClientRect();
		const desiredLeft = anchorRect.left - rootRect.left;
		const maxLeft = Math.max(8, rootRect.width - popoverRect.width - 8);
		popover.style.left = `${Math.max(8, Math.min(maxLeft, desiredLeft))}px`;
		popover.style.top = `${anchorRect.bottom - rootRect.top + 7}px`;
	}

	private closePopover(): void {
		this.flushPendingColorCommit();
		this.popoverLayoutCleanup?.();
		this.popoverLayoutCleanup = null;
		this.activeAnchor?.removeClass('is-open');
		this.activePopover?.remove();
		this.activePopover = null;
		this.activeAnchor = null;
		this.scheduleAutoHideCollapse();
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

	private isAutoHideEnabled(): boolean {
		if (Platform.isMobile) return false; // Mobile follows the native header, not a second height animation.
		return this.surface.kind === 'markdown'
			? this.plugin.settings.markdownToolbarAutoHide
			: this.plugin.settings.pagedToolbarAutoHide;
	}

	private refreshAutoHideState(): void {
		const enabled = this.isAutoHideEnabled();
		this.toolbarEl.toggleClass('is-auto-hide', enabled);
		if (!enabled) {
			window.clearTimeout(this.autoHideCollapseTimer);
			this.toolbarEl.removeClass('is-collapsed');
			return;
		}
		if (!this.toolbarEl.matches(':hover') && !this.toolbarEl.contains(this.ownerDocument.activeElement)) {
			this.toolbarEl.addClass('is-collapsed');
		}
	}

	private revealAutoHiddenToolbar(): void {
		if (!this.isAutoHideEnabled()) return;
		window.clearTimeout(this.autoHideCollapseTimer);
		this.toolbarEl.removeClass('is-collapsed');
	}

	private scheduleAutoHideCollapse(): void {
		window.clearTimeout(this.autoHideCollapseTimer);
		if (!this.isAutoHideEnabled() || this.activePopover) return;
		this.autoHideCollapseTimer = window.setTimeout(() => {
			if (!this.isAutoHideEnabled() || this.activePopover) return;
			if (this.toolbarEl.matches(':hover') || this.toolbarEl.contains(this.ownerDocument.activeElement)) return;
			this.toolbarEl.addClass('is-collapsed');
		}, 60);
	}

	private async saveAndRefresh(): Promise<void> {
		this.closePopover();
		await this.plugin.saveSettings();
		this.refresh();
	}

	private readonly pixelsToPoints = pixelsToPoints;

	private readonly formatNumber = formatTypographyNumber;

	private getRecentBackgroundColor(): string {
		const configured = this.plugin.settings.pagedLastBackgroundColor;
		return /^#[0-9a-f]{6}$/i.test(configured) ? configured : '#fef3c7';
	}
}
