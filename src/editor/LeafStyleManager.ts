import { MarkdownView, Platform, WorkspaceLeaf, setIcon, sanitizeHTMLToDom } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { MUNPIA_SVG, NOVELPIA_SVG } from '../assets/platformLogos';
import { calcAllCharCounts } from '../utils/charCount';
import { PagedWritingView, PAGED_WRITING_VIEW_TYPE } from '../paged/PagedWritingView';
import type { EditorView } from '@codemirror/view';
import { setRepetitionHighlights } from './repetitionHighlight';
import { setSpellcheckHighlights } from './spellcheckHighlight';

type PlatformCharCounts = { munpia: number; novelpia: number };

const LARGE_PAGED_DOCUMENT_THRESHOLD = 50_000;
const LARGE_PAGED_COUNT_IDLE_DELAY = 500;

export class LeafStyleManager {
	private charCountCache: { path: string; text: string; counts: PlatformCharCounts } | null = null;

	constructor(private plugin: WritingMenuPlugin) {}

	private isWritingView(view: unknown): view is MarkdownView | PagedWritingView {
		return view instanceof MarkdownView || view instanceof PagedWritingView;
	}

	private getWritingLeaves(): WorkspaceLeaf[] {
		return [
			...this.plugin.app.workspace.getLeavesOfType('markdown'),
			...this.plugin.app.workspace.getLeavesOfType(PAGED_WRITING_VIEW_TYPE),
		];
	}

	private getViewText(view: MarkdownView | PagedWritingView): string {
		return view instanceof MarkdownView ? view.editor.getValue() : view.getEditableData();
	}

	private getSelectedText(view: MarkdownView | PagedWritingView): string {
		return view instanceof MarkdownView ? view.editor.getSelection() : view.getSelectedText();
	}

	shouldApplyToFile(file: { path: string } | null): boolean {
		// Registered projects now own editor scope; older vaults can still retain
		// applyToFolder, but it must not silently veto the project toolbar's actions.
		return !!file && this.plugin.projectContext.getProjectForPath(file.path) !== null;
	}

	private getLeafId(leaf: WorkspaceLeaf): string {
		const dataAttr = leaf.view.containerEl.getAttribute('data-writing-menu-id');
		if (dataAttr) return dataAttr;
		const newId = `wm-leaf-${this.plugin.leafIdCounter++}`;
		leaf.view.containerEl.setAttribute('data-writing-menu-id', newId);
		return newId;
	}

	private resolveThemeColor(color: string | { light: string; dark: string }): string {
		if (typeof color === 'string') return color;
		const theme = activeDocument.body.classList.contains('theme-dark') ? 'dark' : 'light';
		return color[theme] || color.light || 'inherit';
	}

	calculateCharCount(text: string): number {
		const counts = calcAllCharCounts(text);
		return counts[this.plugin.settings.charCountMode ?? 'munpia'];
	}

	calculateAllCharCounts(text: string, path?: string): PlatformCharCounts {
		if (path && this.charCountCache?.path === path && this.charCountCache.text === text) {
			return this.charCountCache.counts;
		}
		const counts = calcAllCharCounts(text);
		if (path) this.charCountCache = { path, text, counts };
		return counts;
	}

	formatCharCount(count: number): string {
		return count.toLocaleString('ko-KR') + ' 자';
	}

	updateCharCount(leaf: WorkspaceLeaf) {
		try {
			if (!leaf || !leaf.view) return;
			const view = leaf.view;
			if (!this.isWritingView(view)) return;
			const selectedText = this.getSelectedText(view);
			const text = this.getViewText(view);
			const counts = this.calculateAllCharCounts(text, view.file?.path);
			const totalCount = counts[this.plugin.settings.charCountMode ?? 'munpia'];
			if (view.file) this.plugin.charStore?.updateLiveCount(view.file, totalCount);
			const totalFormatted = this.formatCharCount(totalCount);
			let displayText: string;
			if (selectedText) {
				const selCount = this.calculateCharCount(selectedText);
				displayText = `${this.formatCharCount(selCount)} / ${totalFormatted}`;
			} else {
				displayText = totalFormatted;
			}
			const charCountEl = this.plugin.charCountElements.get(leaf);
			if (charCountEl) charCountEl.textContent = displayText;
			const selectedCounts = selectedText ? this.calculateAllCharCounts(selectedText) : null;
			this.plugin.toolbarManager.updateWidgetCharCounts(leaf, counts, selectedCounts);
		} catch {
			// Silently ignore errors during char count update
		}
	}

	updateCharCountDebounced(leaf: WorkspaceLeaf) {
		if (!leaf) return;
		const existingTimer = this.plugin.charCountDebounceTimers.get(leaf);
		if (existingTimer) window.clearTimeout(existingTimer);
		const view = leaf.view;
		const delay = view instanceof PagedWritingView
			&& view.getEditableData().length >= LARGE_PAGED_DOCUMENT_THRESHOLD
			? LARGE_PAGED_COUNT_IDLE_DELAY
			: 80;
		const timer = window.setTimeout(() => {
			this.updateCharCount(leaf);
			this.plugin.charCountDebounceTimers.delete(leaf);
		}, delay);
		this.plugin.charCountDebounceTimers.set(leaf, timer);
	}

	updateDynamicStyles() {
		activeDocument.body.classList.toggle('writing-menu-focus-enabled', this.plugin.settings.enableFocusMode);
		activeDocument.body.style.setProperty('--writing-menu-focus-opacity', this.plugin.settings.focusOpacity.toString());
		activeDocument.body.classList.toggle('writing-menu-typewriter-active', this.plugin.settings.enableTypewriterScrolling);

		const { hrContent, hrColor, hrAlign, hrType, hrSvg, hrSvgSize, hrMargin } = this.plugin.settings;
		activeDocument.body.style.setProperty('--wm-hr-content', `"${(hrContent || '✦ ✦ ✦').replace(/"/g, '\\"')}"`);
		activeDocument.body.style.setProperty('--wm-hr-color', hrColor || 'var(--text-muted)');
		activeDocument.body.style.setProperty('--wm-hr-align', hrAlign || 'center');
		activeDocument.body.style.setProperty('--wm-hr-svg-height', `${hrSvgSize ?? 2}em`);
		activeDocument.body.style.setProperty('--wm-hr-margin', `${hrMargin ?? 0.5}em`);
		if (hrType === 'svg' && hrSvg) {
			activeDocument.body.style.setProperty('--wm-hr-svg-url', `url("data:image/svg+xml,${encodeURIComponent(hrSvg)}")`);
		}
		const activeLeaf = this.plugin.app.workspace.getMostRecentLeaf();
		this.updateHrClasses(activeLeaf);
	}

	updateHrClasses(_leaf?: WorkspaceLeaf | null): void {
		const { hrEnabled, hrType } = this.plugin.settings;
		this.getWritingLeaves().forEach(l => {
			if (!this.isWritingView(l.view)) return;
			const shouldApply = hrEnabled && this.shouldApplyToFile(l.view.file);
			l.view.containerEl.classList.toggle('wm-hr-custom', shouldApply);
			l.view.containerEl.classList.toggle('wm-hr-svg', shouldApply && hrType === 'svg');
		});
	}

	regenerateCSSTemplate(): void {
		this.plugin.cssSettingsVersion++;
	}

	updateLeafStyles(leaf: WorkspaceLeaf, force: boolean = false): void {
		const view = leaf.view;
		if (!this.isWritingView(view)) return;
		const file = view.file;
		const shouldApply = this.shouldApplyToFile(file);
		const container = view.containerEl;

		if (!shouldApply) {
			container.removeAttribute('data-writing-menu-id');
			container.removeClass('wm-disable-link-color', 'wm-hr-custom', 'wm-hr-svg');
			for (const property of Array.from(container.style)) {
				if (property.startsWith('--wm-')) container.style.removeProperty(property);
			}
			container.querySelector('.cm-editor.wm-focus-typing')?.classList.remove('wm-focus-typing');
			if (view instanceof MarkdownView) {
				const editor = view.editor as typeof view.editor & { cm?: EditorView };
				editor?.cm?.dispatch({ effects: [setRepetitionHighlights.of([]), setSpellcheckHighlights.of([])] });
			}
			this.plugin.leafStyleVersions.delete(leaf);
			if (view instanceof PagedWritingView && file && !this.plugin.projectContext.getProjectForFile(file)) {
				view.enforceProjectScope();
			}
			return;
		}

		const currentVersion = this.plugin.leafStyleVersions.get(leaf);
		if (!force && currentVersion === this.plugin.cssSettingsVersion && container.hasAttribute('data-writing-menu-id')) return;

		const leafId = this.getLeafId(leaf);
		container.setAttribute('data-writing-menu-id', leafId);
		this.applyLeafCssProps(container);
		if (view instanceof PagedWritingView) view.refreshFromSettings();
		this.plugin.leafStyleVersions.set(leaf, this.plugin.cssSettingsVersion);
	}

	private applyLeafCssProps(container: HTMLElement): void {
		const { fontFamily, fontWeight, fontSize, fontColor, lineHeight, paragraphSpacing, indentation, lineWidth, inlinePadding, backgroundColor, h1FontFamily, h1FontSize, h1LineHeight, h1Color, footnoteFontFamily, footnoteFontSize, footnoteLineHeight, footnoteColor, disableLinkColor } = this.plugin.settings;
		const inlinePad = inlinePadding ?? 40;
		if (Platform.isMobile) void this.plugin.mobileFonts?.ensureSelected(container.ownerDocument);
		const fontFamilyValue = Platform.isMobile ? this.plugin.mobileFonts?.cssFamily(container.ownerDocument) ?? 'inherit'
			: fontFamily === 'inherit' ? 'inherit' : fontFamily.includes(' ') ? `"${fontFamily}", serif` : `${fontFamily}, serif`;
		const resolvedFontColor = this.resolveThemeColor(fontColor);
		const fontColorValue = resolvedFontColor === 'inherit' ? 'var(--text-normal)' : resolvedFontColor;
		const resolvedBgColor = this.resolveThemeColor(backgroundColor);
		const bgColorValue = resolvedBgColor === 'transparent' ? 'transparent' : resolvedBgColor;
		const h1FontFamilyValue = Platform.isMobile || h1FontFamily === 'inherit' ? 'inherit' : h1FontFamily.includes(' ') ? `"${h1FontFamily}", serif` : `${h1FontFamily}, serif`;
		const h1ColorValue = (h1Color && h1Color !== 'inherit') ? h1Color : '';
		const footnoteFontFamilyValue = Platform.isMobile || footnoteFontFamily === 'inherit' ? 'inherit' : footnoteFontFamily.includes(' ') ? `"${footnoteFontFamily}", serif` : `${footnoteFontFamily}, serif`;
		const footnoteColorValue = (footnoteColor && footnoteColor !== 'inherit') ? footnoteColor : '';

		container.setCssProps({
			'--wm-font-family': fontFamilyValue,
			'--wm-font-weight': String(fontWeight || 400),
			'--wm-font-size': `${fontSize}px`,
			'--wm-line-height': String(lineHeight),
			'--wm-font-color': fontColorValue,
			'--wm-text-indent': `${indentation}px`,
			'--wm-paragraph-spacing': `${paragraphSpacing}em`,
			'--wm-line-width': `${lineWidth}px`,
			'--wm-inline-padding': `${inlinePad}px`,
			'--wm-bg-color': bgColorValue,
			'--wm-h1-font-family': h1FontFamilyValue,
			'--wm-h1-font-size': `${h1FontSize}px`,
			'--wm-h1-line-height': String(h1LineHeight),
			'--wm-h1-color': h1ColorValue,
			'--wm-footnote-font-family': footnoteFontFamilyValue,
			'--wm-footnote-font-size': `${footnoteFontSize}px`,
			'--wm-footnote-line-height': String(footnoteLineHeight),
			'--wm-footnote-color': footnoteColorValue,
		});
		container.toggleClass('wm-disable-link-color', !!disableLinkColor);
	}

	updateAllLeafStyles(): void {
		const writingLeaves = this.getWritingLeaves();
		const leafSet = new Set(writingLeaves);
		writingLeaves.forEach(leaf => this.updateLeafStyles(leaf));
		this.plugin.leafStyleVersions.forEach((_, leaf) => {
			if (!leafSet.has(leaf)) {
				if (this.isWritingView(leaf.view)) {
					leaf.view.containerEl.removeAttribute('data-writing-menu-id');
				}
				this.plugin.leafStyleVersions.delete(leaf);
			}
		});
		const activeLeaf = this.plugin.app.workspace.getMostRecentLeaf();
		this.updateHrClasses(activeLeaf);
	}

	applyZenState(state: 'off' | 'wide' | 'focus', leaf?: WorkspaceLeaf) {
		const prevState = this.plugin.zenState;
		this.plugin.zenState = state;

		if (state === 'off') {
			// 전체화면 이벤트를 기다리지 않고 먼저 UI를 복원한다. Electron/브라우저가
			// fullscreenchange를 누락해도 탭이 숨겨진 채 남지 않아야 한다.
			this.exitZenFocus();
			if (prevState === 'focus' && activeDocument.fullscreenElement) {
				void activeDocument.exitFullscreen().catch(() => {});
			}
			return;
		}

		if (state === 'wide') {
			activeDocument.body.classList.remove('wm-focus-mode');
			this.clearZenLeaf();
			if (this.plugin.zenLeafEventRef) { this.plugin.app.workspace.offref(this.plugin.zenLeafEventRef); this.plugin.zenLeafEventRef = null; }
			if (prevState === 'focus' && activeDocument.fullscreenElement) void activeDocument.exitFullscreen().catch(() => {});
			activeDocument.body.classList.add('wm-wide-mode');
			return;
		}

		// 집중 UI는 전체화면 성공 여부와 무관하게 즉시 적용한다. 전체화면은 부가 효과다.
		this.activateFocusMode(leaf);
		if (!activeDocument.fullscreenElement) {
			void activeDocument.documentElement.requestFullscreen().catch(() => {});
		}
	}

	exitZenFocus() {
		this.plugin.zenState = 'off';
		activeDocument.body.classList.remove('wm-focus-mode', 'wm-wide-mode');
		this.clearZenLeaf();
		if (this.plugin.zenLeafEventRef) {
			this.plugin.app.workspace.offref(this.plugin.zenLeafEventRef);
			this.plugin.zenLeafEventRef = null;
		}
	}

	activateFocusMode(leaf?: WorkspaceLeaf) {
		activeDocument.body.classList.remove('wm-wide-mode');
		activeDocument.body.classList.add('wm-focus-mode');
		const activeLeaf =
			leaf ??
			this.plugin.app.workspace.getMostRecentLeaf() ??
			this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ??
			null;
		if (activeLeaf) this.applyZenLeaf(activeLeaf);
		if (!this.plugin.zenLeafEventRef) {
			this.plugin.zenLeafEventRef = this.plugin.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf && this.plugin.zenState === 'focus') this.applyZenLeaf(leaf);
			});
		}
	}

	toggleZenMode(mode: 'wide' | 'focus', targetLeaf?: WorkspaceLeaf) {
		const body = activeDocument.body;
		const focusActive = this.plugin.zenState === 'focus' || body.classList.contains('wm-focus-mode');
		const wideActive = this.plugin.zenState === 'wide' || body.classList.contains('wm-wide-mode');
		const requestedModeActive = mode === 'focus' ? focusActive : wideActive;
		const leaf = targetLeaf ?? this.plugin.app.workspace.getMostRecentLeaf() ?? this.plugin.app.workspace.activeLeaf;
		const activeView = leaf?.view;
		if (!requestedModeActive && (!this.isWritingView(activeView) || !this.shouldApplyToFile(activeView.file))) return;
		this.applyZenState(requestedModeActive ? 'off' : mode, leaf ?? undefined);
	}

	applyZenLeaf(leaf: WorkspaceLeaf) {
		this.clearZenLeaf();
		this.plugin.zenLeaf = leaf;
		const el: HTMLElement | undefined = (leaf as WorkspaceLeaf & { containerEl?: HTMLElement }).containerEl;
		if (el) {
			el.classList.add('wm-zen-leaf');
			activeDocument.body.classList.add('wm-has-zen-leaf');
			const tabs = el.closest('.workspace-tabs');
			if (tabs) tabs.classList.add('wm-zen-tabs');
			let split = el.closest('.workspace-split');
			while (split) {
				split.classList.add('wm-zen-split');
				split = split.parentElement?.closest('.workspace-split') ?? null;
			}
		}
	}

	clearZenLeaf() {
		activeDocument.querySelectorAll('.wm-zen-leaf').forEach((el: Element) => el.classList.remove('wm-zen-leaf'));
		activeDocument.querySelectorAll('.wm-zen-tabs').forEach((el: Element) => el.classList.remove('wm-zen-tabs'));
		activeDocument.querySelectorAll('.wm-zen-split').forEach((el: Element) => el.classList.remove('wm-zen-split'));
		activeDocument.body.classList.remove('wm-has-zen-leaf');
		this.plugin.zenLeaf = null;
	}

	addCharCountWithModeSelector(container: HTMLElement, count: number, leaf: WorkspaceLeaf) {
		const div = container.createDiv('writing-menu-control');
		const labelGroup = div.createDiv('writing-menu-control-label-group');
		const iconSpan = labelGroup.createSpan('writing-menu-icon');
		setIcon(iconSpan, 'binary');
		labelGroup.createEl('label', { text: '글자수' });

		const rightGroup = div.createDiv();
		rightGroup.setCssStyles({ display: 'flex', alignItems: 'center', gap: '8px' });

		const valueSpan = rightGroup.createEl('span', { text: this.formatCharCount(count) });
		valueSpan.setCssStyles({ color: 'var(--text-muted)', fontSize: '12px' });

		const modeGroup = rightGroup.createDiv();
		modeGroup.setCssStyles({ display: 'flex', gap: '6px', alignItems: 'center' });

		const isMunpia = this.plugin.settings.charCountMode === 'munpia';

		const mBtn = modeGroup.createDiv('writing-menu-logo-btn');
		mBtn.appendChild(sanitizeHTMLToDom(MUNPIA_SVG));
		if (isMunpia) mBtn.addClass('is-active');
		mBtn.onclick = () => {
			this.plugin.settings.charCountMode = 'munpia';
			void this.plugin.charStore.reinitSnapshot().then(() => this.plugin.saveSettings()).then(() => {
				this.updateAllCharCounts();
				mBtn.addClass('is-active');
				nBtn.removeClass('is-active');
				const view = leaf.view;
				if (this.isWritingView(view)) {
					const newCount = this.calculateCharCount(this.getViewText(view));
					valueSpan.textContent = this.formatCharCount(newCount);
				}
			});
		};

		const nBtn = modeGroup.createDiv('writing-menu-logo-btn');
		nBtn.appendChild(sanitizeHTMLToDom(NOVELPIA_SVG));
		if (!isMunpia) nBtn.addClass('is-active');
		nBtn.onclick = () => {
			this.plugin.settings.charCountMode = 'novelpia';
			void this.plugin.charStore.reinitSnapshot().then(() => this.plugin.saveSettings()).then(() => {
				this.updateAllCharCounts();
				nBtn.addClass('is-active');
				mBtn.removeClass('is-active');
				const view = leaf.view;
				if (this.isWritingView(view)) {
					const newCount = this.calculateCharCount(this.getViewText(view));
					valueSpan.textContent = this.formatCharCount(newCount);
				}
			});
		};
	}

	updateAllCharCounts() {
		this.getWritingLeaves().forEach(leaf => {
			this.updateCharCount(leaf);
		});
	}

	styleIconButton(btn: HTMLElement, opacity: number = 1) {
		btn.addClass('wm-icon-btn-20');
		btn.setCssStyles({ cursor: 'pointer' });
		if (opacity < 1) btn.setCssStyles({ opacity: String(opacity) });
		const svg = btn.querySelector('svg');
		if (svg) {
			svg.setAttribute('width', '15'); svg.setAttribute('height', '15');
			(svg as unknown as HTMLElement).setCssStyles({ width: '15px', height: '15px' });
		}
	}
}
