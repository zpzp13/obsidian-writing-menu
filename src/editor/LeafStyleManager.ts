import { MarkdownView, WorkspaceLeaf, setIcon, sanitizeHTMLToDom } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { cleanMarkdownFrontmatter } from '../export/converterMethods';
import { MUNPIA_SVG, NOVELPIA_SVG } from '../assets/platformLogos';

export class LeafStyleManager {
	constructor(private plugin: WritingMenuPlugin) {}

	shouldApplyToFile(file: { path: string } | null): boolean {
		if (!file) return false;
		if (!this.plugin.settings.applyToFolder) return true;
		const folderName = this.plugin.settings.applyToFolder.trim().toLowerCase();
		if (folderName === '') return true;
		const pathSegments = file.path.split('/');
		for (let i = 0; i < pathSegments.length - 1; i++) {
			if (pathSegments[i].toLowerCase() === folderName) return true;
		}
		return false;
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
		const withoutFrontmatter = cleanMarkdownFrontmatter(this.plugin, text);
		const lines = withoutFrontmatter.split('\n')
			.filter(l => !l.trim().match(/^#{1,6}\s/))
			.filter(l => !l.trim().match(/^\[\^[^\]]+\]:/))
			.map(l => l.replace(/\[\^[^\]]+\]/g, ''))
			.map(l => l.trim())
			.filter(l => l);
		const base = lines.join('');

		if (this.plugin.settings.charCountMode === 'novelpia') {
			return base.replace(/ /g, '').replace(/[.,!?"']/g, '').replace(/[\s ]/g, '').length;
		} else {
			const ellipsisCount = (base.match(/…/g) || []).length;
			return base.length + (ellipsisCount * 2);
		}
	}

	formatCharCount(count: number): string {
		return count.toLocaleString('ko-KR') + ' 자';
	}

	updateCharCount(leaf: WorkspaceLeaf) {
		try {
			if (!leaf || !leaf.view) return;
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) return;
			if (!view.editor) return;
			const selectedText = view.editor.getSelection();
			const totalCount = this.calculateCharCount(view.editor.getValue());
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
			const headerCharCountEl = this.plugin.headerCharCountElements.get(leaf);
			if (headerCharCountEl) headerCharCountEl.textContent = displayText;
		} catch {
			// Silently ignore errors during char count update
		}
	}

	updateCharCountDebounced(leaf: WorkspaceLeaf) {
		if (!leaf) return;
		const existingTimer = this.plugin.charCountDebounceTimers.get(leaf);
		if (existingTimer) window.clearTimeout(existingTimer);
		const timer = window.setTimeout(() => {
			this.updateCharCount(leaf);
			this.plugin.charCountDebounceTimers.delete(leaf);
		}, 150);
		this.plugin.charCountDebounceTimers.set(leaf, timer);
	}

	updateDynamicStyles() {
		activeDocument.body.classList.toggle('writing-menu-focus-enabled', this.plugin.settings.enableFocusMode);
		activeDocument.body.style.setProperty('--writing-menu-focus-opacity', this.plugin.settings.focusOpacity.toString());
		activeDocument.body.classList.toggle('writing-menu-typewriter-active', this.plugin.settings.enableTypewriterScrolling);
	}

	regenerateCSSTemplate(): void {
		this.plugin.cssSettingsVersion++;
	}

	updateLeafStyles(leaf: WorkspaceLeaf, force: boolean = false): void {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		const file = view.file;
		const shouldApply = this.shouldApplyToFile(file);
		const container = view.containerEl;

		if (!shouldApply) {
			container.removeAttribute('data-writing-menu-id');
			this.plugin.leafStyleVersions.delete(leaf);
			return;
		}

		const currentVersion = this.plugin.leafStyleVersions.get(leaf);
		if (!force && currentVersion === this.plugin.cssSettingsVersion && container.hasAttribute('data-writing-menu-id')) return;

		const leafId = this.getLeafId(leaf);
		container.setAttribute('data-writing-menu-id', leafId);
		this.applyLeafCssProps(container);
		this.plugin.leafStyleVersions.set(leaf, this.plugin.cssSettingsVersion);
	}

	private applyLeafCssProps(container: HTMLElement): void {
		const { fontFamily, fontSize, fontColor, lineHeight, paragraphSpacing, indentation, lineWidth, inlinePadding, backgroundColor, h1FontFamily, h1FontSize, h1LineHeight, h1Color, footnoteFontFamily, footnoteFontSize, footnoteLineHeight, footnoteColor, disableLinkColor } = this.plugin.settings;
		const inlinePad = inlinePadding ?? 40;
		const fontFamilyValue = fontFamily === 'inherit' ? 'inherit' : fontFamily.includes(' ') ? `"${fontFamily}", serif` : `${fontFamily}, serif`;
		const resolvedFontColor = this.resolveThemeColor(fontColor);
		const fontColorValue = resolvedFontColor === 'inherit' ? 'var(--text-normal)' : resolvedFontColor;
		const resolvedBgColor = this.resolveThemeColor(backgroundColor);
		const bgColorValue = resolvedBgColor === 'transparent' ? 'transparent' : resolvedBgColor;
		const h1FontFamilyValue = h1FontFamily === 'inherit' ? 'inherit' : h1FontFamily.includes(' ') ? `"${h1FontFamily}", serif` : `${h1FontFamily}, serif`;
		const h1ColorValue = (h1Color && h1Color !== 'inherit') ? h1Color : '';
		const footnoteFontFamilyValue = footnoteFontFamily === 'inherit' ? 'inherit' : footnoteFontFamily.includes(' ') ? `"${footnoteFontFamily}", serif` : `${footnoteFontFamily}, serif`;
		const footnoteColorValue = (footnoteColor && footnoteColor !== 'inherit') ? footnoteColor : '';

		container.setCssProps({
			'--wm-font-family': fontFamilyValue,
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
		const markdownLeaves = this.plugin.app.workspace.getLeavesOfType('markdown');
		const leafSet = new Set(markdownLeaves);
		markdownLeaves.forEach(leaf => this.updateLeafStyles(leaf));
		this.plugin.leafStyleVersions.forEach((_, leaf) => {
			if (!leafSet.has(leaf)) {
				if (leaf.view instanceof MarkdownView) {
					leaf.view.containerEl.removeAttribute('data-writing-menu-id');
				}
				this.plugin.leafStyleVersions.delete(leaf);
			}
		});
	}

	applyZenState(state: 'off' | 'wide' | 'focus') {
		const prevState = this.plugin.zenState;
		this.plugin.zenState = state;

		if (state === 'off') {
			if (prevState === 'focus' && activeDocument.fullscreenElement) {
				activeDocument.exitFullscreen().catch(() => this.exitZenFocus());
			} else {
				this.exitZenFocus();
			}
			return;
		}

		if (state === 'wide') {
			if (prevState === 'focus') {
				activeDocument.body.classList.remove('wm-focus-mode');
				this.clearZenLeaf();
				if (this.plugin.zenLeafEventRef) { this.plugin.app.workspace.offref(this.plugin.zenLeafEventRef); this.plugin.zenLeafEventRef = null; }
				if (activeDocument.fullscreenElement) activeDocument.exitFullscreen().catch(() => {});
			}
			activeDocument.body.classList.add('wm-wide-mode');
			return;
		}

		if (activeDocument.fullscreenElement) {
			activeDocument.body.classList.remove('wm-wide-mode');
			this.activateFocusMode();
		} else {
			activeDocument.documentElement.requestFullscreen().catch(() => {
				this.plugin.zenState = 'off';
				activeDocument.body.classList.remove('wm-wide-mode');
			});
		}
	}

	exitZenFocus() {
		activeDocument.body.classList.remove('wm-focus-mode', 'wm-wide-mode');
		this.clearZenLeaf();
		if (this.plugin.zenLeafEventRef) {
			this.plugin.app.workspace.offref(this.plugin.zenLeafEventRef);
			this.plugin.zenLeafEventRef = null;
		}
	}

	activateFocusMode() {
		activeDocument.body.classList.remove('wm-wide-mode');
		activeDocument.body.classList.add('wm-focus-mode');
		const activeLeaf =
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

	cycleZenMode() {
		const wideOn = this.plugin.settings.zenWideEnabled;
		const focusOn = this.plugin.settings.zenFocusEnabled;
		if (!wideOn && !focusOn) return;

		if (wideOn && focusOn) {
			if (this.plugin.zenState === 'off') this.applyZenState('wide');
			else if (this.plugin.zenState === 'wide') this.applyZenState('focus');
			else this.applyZenState('off');
		} else if (wideOn) {
			this.applyZenState(this.plugin.zenState === 'off' ? 'wide' : 'off');
		} else {
			this.applyZenState(this.plugin.zenState === 'off' ? 'focus' : 'off');
		}
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
			void this.plugin.saveSettings().then(() => {
				this.updateAllCharCounts();
				mBtn.addClass('is-active');
				nBtn.removeClass('is-active');
				const view = leaf.view;
				if (view instanceof MarkdownView && view.editor) {
					const newCount = this.calculateCharCount(view.editor.getValue());
					valueSpan.textContent = this.formatCharCount(newCount);
				}
			});
		};

		const nBtn = modeGroup.createDiv('writing-menu-logo-btn');
		nBtn.appendChild(sanitizeHTMLToDom(NOVELPIA_SVG));
		if (!isMunpia) nBtn.addClass('is-active');
		nBtn.onclick = () => {
			this.plugin.settings.charCountMode = 'novelpia';
			void this.plugin.saveSettings().then(() => {
				this.updateAllCharCounts();
				nBtn.addClass('is-active');
				mBtn.removeClass('is-active');
				const view = leaf.view;
				if (view instanceof MarkdownView && view.editor) {
					const newCount = this.calculateCharCount(view.editor.getValue());
					valueSpan.textContent = this.formatCharCount(newCount);
				}
			});
		};
	}

	updateAllCharCounts() {
		this.plugin.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
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
