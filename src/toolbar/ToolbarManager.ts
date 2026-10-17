import { MarkdownView, WorkspaceLeaf, setIcon, Platform, Notice, App } from 'obsidian';
import type { Editor, EditorPosition } from 'obsidian';
import { HwpExportModal, TxtExportModal } from '../export';
import type WritingMenuPlugin from '../../main';
import { PagedWritingView, PAGED_WRITING_VIEW_TYPE } from '../paged/PagedWritingView';
import { WritingToolbar, type WritingToolbarSurface } from './WritingToolbar';
import type { PagedInlineFormatKind } from '../types';

interface SettingTabLike {
	searchInputEl?: HTMLInputElement;
	searchComponent?: { inputEl?: HTMLInputElement };
}

interface AppWithSettings extends App {
	setting?: { open(): void; openTabById(id: string): SettingTabLike | null };
}

export class ToolbarManager {
	private readonly writingToolbars = new Map<WorkspaceLeaf, WritingToolbar>();

	constructor(private plugin: WritingMenuPlugin) {}

	private isWritingView(view: unknown): view is MarkdownView | PagedWritingView {
		return view instanceof MarkdownView || view instanceof PagedWritingView;
	}

	private isProjectWritingView(view: MarkdownView | PagedWritingView): boolean {
		return this.plugin.projectContext.getProjectForFile(view.file) !== null;
	}

	private getViewText(view: MarkdownView | PagedWritingView): string {
		return view instanceof MarkdownView ? view.editor.getValue() : view.getEditableData();
	}

	private getViewHeader(view: MarkdownView | PagedWritingView): HTMLElement | null {
		const container = view.containerEl;
		if (container.matches('.view-header')) return container;
		return container.querySelector<HTMLElement>(':scope > .view-header')
			?? container.querySelector<HTMLElement>('.view-header')
			?? container.closest<HTMLElement>('.workspace-leaf-content')?.querySelector<HTMLElement>(':scope > .view-header')
			?? null;
	}

	private forgetToolbar(leaf: WorkspaceLeaf): void {
		this.writingToolbars.get(leaf)?.destroy();
		this.writingToolbars.delete(leaf);
		this.plugin.toolbarElements.get(leaf)?.remove();
		this.plugin.toolbarElements.delete(leaf);
		if (leaf.view instanceof MarkdownView) {
			const contentEl = (leaf.view.containerEl.children[1] as HTMLElement | undefined)
				?? leaf.view.containerEl.querySelector<HTMLElement>('.view-content');
			contentEl?.removeClass('wm-markdown-toolbar-content');
		}
		this.plugin.headerCharCountElements.get(leaf)?.remove();
		this.plugin.headerCharCountElements.delete(leaf);
		this.plugin.charCountElements.delete(leaf);
	}

	updateAllToolbars() {
		const writingLeaves = [
			...this.plugin.app.workspace.getLeavesOfType('markdown'),
			...this.plugin.app.workspace.getLeavesOfType(PAGED_WRITING_VIEW_TYPE),
		];
		const leafSet = new Set(writingLeaves);
		this.plugin.toolbarElements.forEach((toolbar, leaf) => {
			if (!leafSet.has(leaf)) {
				this.forgetToolbar(leaf);
			}
		});
		writingLeaves.forEach(leaf => {
			const view = leaf.view;
			if (!this.isWritingView(view)) return;
			if (!this.isProjectWritingView(view)) {
				this.forgetToolbar(leaf);
				return;
			}
			const existing = this.plugin.toolbarElements.get(leaf);
			if (existing && !existing.isConnected) {
				this.forgetToolbar(leaf);
			}
			if (!this.plugin.toolbarElements.has(leaf)) {
				if (!Platform.isMobile && view instanceof PagedWritingView) view.refreshToolbarMount();
				else this.addToolbarToLeaf(leaf);
			}
		});
	}

	addToolbarToLeaf(leaf: WorkspaceLeaf, attempt = 0) {
		const view = leaf.view;
		if (!this.isWritingView(view)) return;
		if (!this.isProjectWritingView(view)) {
			this.forgetToolbar(leaf);
			return;
		}
		if (Platform.isMobile) {
			this.addMobileHeaderMenu(leaf, view, attempt);
			return;
		}
		if (!(view instanceof MarkdownView)) return;
		const contentEl = (view.containerEl.children[1] as HTMLElement | undefined)
			?? view.containerEl.querySelector<HTMLElement>('.view-content');
		if (!contentEl) {
			if (attempt < 2) window.requestAnimationFrame(() => this.addToolbarToLeaf(leaf, attempt + 1));
			return;
		}
		const connected = this.plugin.toolbarElements.get(leaf);
		if (connected?.isConnected) return;
		if (this.plugin.toolbarElements.has(leaf)) this.forgetToolbar(leaf);
		contentEl.addClass('wm-markdown-toolbar-content');
		const host = contentEl.createDiv({ cls: 'wm-markdown-toolbar-host' });
		contentEl.prepend(host);
		const toolbar = new WritingToolbar(this.plugin, host, this.createMarkdownSurface(view));
		this.writingToolbars.set(leaf, toolbar);
		this.plugin.toolbarElements.set(leaf, host);
		this.plugin.updateLeafStyles(leaf);
	}

	mountPagedToolbar(container: HTMLElement, view: PagedWritingView): void {
		if (!this.isProjectWritingView(view)) {
			this.forgetToolbar(view.leaf);
			return;
		}
		const existing = this.plugin.toolbarElements.get(view.leaf);
		if (existing?.isConnected) {
			if (!Platform.isMobile && existing.parentElement === container && container.firstElementChild !== existing) container.prepend(existing);
			return;
		}
		this.forgetToolbar(view.leaf);
		if (Platform.isMobile) {
			this.addMobileHeaderMenu(view.leaf, view);
			return;
		}
		const toolbar = new WritingToolbar(this.plugin, container, this.createPagedSurface(view));
		container.prepend(toolbar.toolbarEl);
		this.writingToolbars.set(view.leaf, toolbar);
		this.plugin.toolbarElements.set(view.leaf, toolbar.toolbarEl);
	}

	private addMobileHeaderMenu(
		leaf: WorkspaceLeaf,
		view: MarkdownView | PagedWritingView,
		attempt = 0,
	): void {
		if (!this.isProjectWritingView(view)) {
			this.forgetToolbar(leaf);
			return;
		}
		const viewHeader = this.getViewHeader(view);
		if (!viewHeader) {
			if (attempt < 2) window.requestAnimationFrame(() => this.addMobileHeaderMenu(leaf, view, attempt + 1));
			return;
		}
		const existing = viewHeader.querySelector<HTMLElement>('.writing-menu-button');
		if (existing) {
			this.plugin.toolbarElements.set(leaf, existing);
			return;
		}
		const charCountEl = viewHeader.createDiv({ cls: 'writing-menu-char-count' });
		this.plugin.headerCharCountElements.set(leaf, charCountEl);
		const button = viewHeader.createDiv({
			cls: 'clickable-icon writing-menu-button',
			attr: { role: 'button', tabindex: '0', 'aria-label': 'Writing Menu' },
		});
		setIcon(button, 'settings');
		const open = (event: Event) => {
			event.stopPropagation();
			this.showDropdown(button, leaf);
		};
		button.addEventListener('click', open);
		button.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			open(event);
		});
		const viewActions = viewHeader.querySelector('.view-actions');
		if (viewActions) {
			viewActions.insertBefore(button, viewActions.firstChild);
			viewActions.insertBefore(charCountEl, button);
		} else {
			viewHeader.appendChild(charCountEl);
			viewHeader.appendChild(button);
		}
		this.plugin.toolbarElements.set(leaf, button);
		this.plugin.updateCharCount(leaf);
		this.plugin.updateLeafStyles(leaf);
	}

	removeToolbarFromLeaf(leaf: WorkspaceLeaf): void {
		this.forgetToolbar(leaf);
	}

	refreshToolbar(leaf: WorkspaceLeaf): void {
		this.writingToolbars.get(leaf)?.refresh();
	}

	refreshToolbarSelection(leaf: WorkspaceLeaf): void {
		this.writingToolbars.get(leaf)?.refreshSelectionState();
	}

	updateWidgetCharCounts(
		leaf: WorkspaceLeaf,
		counts: { munpia: number; novelpia: number },
		selectedCounts: { munpia: number; novelpia: number } | null = null,
	): void {
		this.writingToolbars.get(leaf)?.updateWidgetCharCounts(counts, selectedCounts);
	}

	refreshAllToolbars(): void {
		this.writingToolbars.forEach(toolbar => toolbar.refresh());
	}

	destroy(): void {
		for (const leaf of Array.from(this.writingToolbars.keys())) this.forgetToolbar(leaf);
	}

	private createMarkdownSurface(view: MarkdownView): WritingToolbarSurface {
		const leaf = view.leaf;
		return {
			kind: 'markdown',
			leaf,
			getFile: () => view.file,
			getText: () => view.editor.getValue(),
			focus: () => view.editor.focus(),
			undo: () => { view.editor.focus(); view.editor.undo(); },
			redo: () => { view.editor.focus(); view.editor.redo(); },
			toggleFormat: kind => this.toggleMarkdownFormat(view.editor, kind),
			isFormatActive: () => false,
			getAlignment: () => null,
			setAlignment: () => {},
			applyTextColor: (color, target) => this.applyMarkdownColor(view.editor, color, target),
			clearTextColors: () => {
				this.plugin.settings.pagedLastTextColor = '';
				void this.plugin.saveData(this.plugin.settings);
			},
			getRecentTextColor: () => this.getRecentTextColor(view.containerEl.ownerDocument),
			switchView: () => {
				if (view.file) return this.plugin.openPagedWritingView(view.file);
			},
			getZoom: () => 1,
			setZoom: () => {},
		};
	}

	private createPagedSurface(view: PagedWritingView): WritingToolbarSurface {
		return {
			kind: 'paged',
			leaf: view.leaf,
			getFile: () => view.file,
			getText: () => view.getEditableData(),
			focus: () => view.focusEditorFromToolbar(),
			undo: () => view.undoFromToolbar(),
			redo: () => view.redoFromToolbar(),
			toggleFormat: kind => view.toggleFormatFromToolbar(kind),
			isFormatActive: kind => view.isFormatActiveForToolbar(kind),
			preserveSelection: event => view.preserveSelectionFromToolbar(event),
			getAlignment: () => view.getAlignmentForToolbar(),
			setAlignment: alignment => view.setAlignmentFromToolbar(alignment),
			applyTextColor: (color, target) => view.applyTextColorFromToolbar(color, target),
			clearTextColors: () => view.clearTextColorsFromToolbar(),
			getRecentTextColor: () => view.getRecentTextColorForToolbar(),
			switchView: () => view.openMarkdownFromToolbar(),
			getZoom: () => view.getZoomForToolbar(),
			setZoom: value => view.setZoomFromToolbar(value),
		};
	}

	private toggleMarkdownFormat(editor: Editor, kind: PagedInlineFormatKind): void {
		const markers: Record<PagedInlineFormatKind, [string, string]> = {
			bold: ['**', '**'],
			italic: ['*', '*'],
			underline: ['<u>', '</u>'],
			strikethrough: ['~~', '~~'],
		};
		const [open, close] = markers[kind];
		const from = editor.getCursor('from');
		const to = editor.getCursor('to');
		const selected = editor.getRange(from, to);
		const replacement = `${open}${selected}${close}`;
		editor.replaceRange(replacement, from, to);
		if (selected) {
			editor.setSelection(
				this.advancePosition(from, open),
				this.advancePosition(from, `${open}${selected}`),
			);
		} else {
			editor.setCursor(this.advancePosition(from, open));
		}
		editor.focus();
	}

	private applyMarkdownColor(editor: Editor, color: string, target: 'text' | 'background'): void {
		const recent = target === 'text'
			? this.getRecentTextColor(activeDocument)
			: this.getRecentBackgroundColor();
		const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color : recent;
		if (target === 'text') this.plugin.settings.pagedLastTextColor = normalized;
		else this.plugin.settings.pagedLastBackgroundColor = normalized;
		const from = editor.getCursor('from');
		const to = editor.getCursor('to');
		const selected = editor.getRange(from, to);
		if (!selected) {
			void this.plugin.saveData(this.plugin.settings);
			editor.focus();
			return;
		}
		const property = target === 'text' ? 'color' : 'background-color';
		const open = `<span style="${property}: ${normalized}">`;
		const close = '</span>';
		editor.replaceRange(`${open}${selected}${close}`, from, to);
		editor.setSelection(this.advancePosition(from, open), this.advancePosition(from, `${open}${selected}`));
		void this.plugin.saveData(this.plugin.settings);
		editor.focus();
	}

	private advancePosition(start: EditorPosition, text: string): EditorPosition {
		const lines = text.split('\n');
		return lines.length === 1
			? { line: start.line, ch: start.ch + lines[0].length }
			: { line: start.line + lines.length - 1, ch: lines[lines.length - 1].length };
	}

	private getRecentTextColor(ownerDocument: Document): string {
		const configured = this.plugin.settings.pagedLastTextColor;
		if (/^#[0-9a-f]{6}$/i.test(configured)) return configured;
		return ownerDocument.body.classList.contains('theme-dark') ? '#e5e7eb' : '#111111';
	}

	private getRecentBackgroundColor(): string {
		const configured = this.plugin.settings.pagedLastBackgroundColor;
		return /^#[0-9a-f]{6}$/i.test(configured) ? configured : '#fef3c7';
	}

	showDropdown(button: HTMLElement, leaf: WorkspaceLeaf) {
		const ownerDocument = button.ownerDocument;
		const ownerWindow = ownerDocument.defaultView ?? window;
		const existingDropdown = ownerDocument.querySelector('.writing-menu-dropdown:not(.wm-paged-toolbar-popover)');
		if (existingDropdown) { existingDropdown.remove(); return; }

		const dropdown = ownerDocument.body.createDiv({ cls: 'writing-menu-dropdown' });
		const rect = button.getBoundingClientRect();
		dropdown.setCssStyles({ position: 'fixed', top: `${rect.bottom + 5}px`, right: `${ownerWindow.innerWidth - rect.right}px` });

		this.buildDropdownMenu(dropdown, leaf);

		if (dropdown.getBoundingClientRect().right > ownerWindow.innerWidth) dropdown.setCssStyles({ right: '10px' });
		const closeDropdown = (e: MouseEvent) => {
			if (!dropdown.contains(e.target as Node) && !button.contains(e.target as Node)) {
				dropdown.remove(); ownerDocument.removeEventListener('click', closeDropdown);
			}
		};
		window.setTimeout(() => ownerDocument.addEventListener('click', closeDropdown), 10);
	}

	buildDropdownMenu(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.renderMenuPage(container, 'main', leaf);
	}

	renderMenuPage(container: HTMLElement, page: string, leaf: WorkspaceLeaf) {
		container.empty();
		if (page === 'main') this.renderMainMenuPage(container, leaf);
		else if (page === 'typography') this.renderTypographyPage(container, leaf);
		else if (page === 'color') this.renderColorPage(container, leaf);
		else if (page === 'view') this.renderViewPage(container, leaf);
		else if (page === 'input') this.renderInputPage(container, leaf);
		else if (page === 'version') this.renderVersionMenuPage(container, leaf);
		else if (page === 'time-tracking') this.renderTimeTrackingPage(container, leaf);
	}

	addMenuNavCard(container: HTMLElement, title: string, icon: string, onClick: () => void) {
		const card = container.createDiv({ cls: 'wm-menu-nav-card' });
		const iconEl = card.createDiv({ cls: 'wm-menu-nav-icon' });
		setIcon(iconEl, icon);
		card.createDiv({ cls: 'wm-menu-nav-body' }).createEl('div', { cls: 'wm-menu-nav-title', text: title });
		const chevron = card.createDiv({ cls: 'wm-menu-nav-chevron' });
		setIcon(chevron, 'chevron-right');
		card.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); onClick(); });
	}

	addMenuBackButton(container: HTMLElement, title: string, onBack: () => void) {
		const btn = container.createDiv({ cls: 'wm-menu-back-btn' });
		const iconEl = btn.createSpan();
		setIcon(iconEl, 'chevron-left');
		btn.createEl('span', { text: title });
		btn.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); onBack(); });
		this.addSeparator(container);
	}

	addSeparator(container: HTMLElement) {
		container.createDiv('writing-menu-separator').setCssStyles({ height: '1px', background: 'var(--background-modifier-border)', margin: '8px 0', opacity: '0.5' });
	}

	renderMainMenuPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		void this.plugin.addCompactControl(container, '폴더', this.plugin.settings.applyToFolder, async (v) => { this.plugin.settings.applyToFolder = v; await this.plugin.saveSettings(); }, 'folder');

		{
			const copyDiv = container.createDiv('writing-menu-control');
			copyDiv.setCssStyles({ cursor: 'pointer' });
			const copyLabelGroup = copyDiv.createDiv('writing-menu-control-label-group');
			setIcon(copyLabelGroup.createSpan('writing-menu-icon'), 'copy');
			copyLabelGroup.createEl('label', { text: '복사하기' });
			const copyHotkeyLink = copyDiv.createDiv();
			copyHotkeyLink.setCssStyles({ display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--text-muted)' });
			setIcon(copyHotkeyLink, 'keyboard');
			copyHotkeyLink.setAttribute('aria-label', '단축키 설정');
			copyHotkeyLink.addEventListener('click', (e) => {
				e.stopPropagation();
				const setting = (this.plugin.app as AppWithSettings).setting;
				setting?.open();
				const tab = setting?.openTabById('hotkeys');
				window.setTimeout(() => {
					const input = tab?.searchInputEl ?? tab?.searchComponent?.inputEl;
					if (input) {
						input.value = 'Writing Menu: 복사하기';
						input.dispatchEvent(new Event('input'));
					}
				}, 20);
				(activeDocument.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
			});
			copyDiv.addEventListener('click', () => {
				void this.plugin.copyWithOptions(leaf).then(() => {
					const dropdown = activeDocument.querySelector('.writing-menu-dropdown');
					if (dropdown) dropdown.remove();
				});
			});
		}

		if (Platform.isDesktop) {
			const exportDiv = container.createDiv('writing-menu-control');
			const exportLabelGroup = exportDiv.createDiv('writing-menu-control-label-group');
			setIcon(exportLabelGroup.createSpan('writing-menu-icon'), 'file-output');
			exportLabelGroup.createEl('label', { text: '내보내기' });
			const exportRightGroup = exportDiv.createDiv();
			exportRightGroup.setCssStyles({ display: 'flex', alignItems: 'center', gap: '8px' });
			if (Platform.isDesktop && Platform.isWin) {
				const hwpBtn = exportRightGroup.createDiv('writing-menu-text-btn');
				hwpBtn.setText('HWP');
				hwpBtn.onclick = () => { void (async () => {
					const view = leaf.view;
					if (this.isWritingView(view) && view.file && view.file.extension === 'md') {
						if (view instanceof PagedWritingView) await view.save();
						(activeDocument.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
						new HwpExportModal(this.plugin.app, this.plugin, view.file).open();
					} else { new Notice('마크다운 파일을 열어주세요.', 3000); }
				})(); };
			}
			const txtBtn = exportRightGroup.createDiv('writing-menu-text-btn');
			txtBtn.setText('TXT');
			txtBtn.onclick = () => { void (async () => {
				const view = leaf.view;
				if (this.isWritingView(view) && view.file && view.file.extension === 'md') {
					if (view instanceof PagedWritingView) await view.save();
					(activeDocument.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
					new TxtExportModal(this.plugin.app, this.plugin, view.file).open();
				} else { new Notice('마크다운 파일을 열어주세요.', 3000); }
			})(); };
		}

		try {
			const view = leaf.view;
			if (this.isWritingView(view)) {
				this.plugin.addCharCountWithModeSelector(container, this.plugin.calculateCharCount(this.getViewText(view)), leaf);
			}
		} catch { /* intentional */ }

		this.addSeparator(container);

		this.addMenuNavCard(container, '서식', 'type', () => this.renderMenuPage(container, 'typography', leaf));
		this.addMenuNavCard(container, '색상', 'palette', () => this.renderMenuPage(container, 'color', leaf));
		this.addMenuNavCard(container, '입력 보조', 'keyboard', () => this.renderMenuPage(container, 'input', leaf));
		this.addMenuNavCard(container, '타이머/스톱워치 표시', 'clock', () => this.renderMenuPage(container, 'time-tracking', leaf));
		this.addMenuNavCard(container, '보기', 'eye', () => this.renderMenuPage(container, 'view', leaf));

		this.addSeparator(container);

		const btnContainer = container.createDiv();
		btnContainer.setCssStyles({ marginTop: '4px', display: 'flex', justifyContent: 'center', alignItems: 'center' });
		const btn = btnContainer.createEl('a');
		btn.setCssStyles({ cursor: 'pointer', color: 'var(--text-accent)', fontSize: '13px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' });
		const btnIcon = btn.createSpan();
		setIcon(btnIcon, 'settings');
		btnIcon.setCssStyles({ display: 'flex', alignItems: 'center' });
		btn.createSpan({ text: '플러그인 설정' });
		btn.onclick = () => {
			(activeDocument.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
			this.plugin.openSettings();
		};
	}

	renderTypographyPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '서식', () => this.renderMenuPage(container, 'main', leaf));

		const fontDiv = container.createDiv('writing-menu-control');
		const fontLabelGroup = fontDiv.createDiv('writing-menu-control-label-group');
		const hanIcon = fontLabelGroup.createSpan('writing-menu-icon');
		hanIcon.setText('한');
		hanIcon.setCssStyles({ fontWeight: 'bold', display: 'inline-block', lineHeight: '1', verticalAlign: 'text-bottom' });
		fontLabelGroup.createEl('label', { text: '글꼴' });
		const fontInput = fontDiv.createEl('input', { type: 'text', value: this.plugin.settings.fontFamily });
		fontInput.setCssStyles({ width: '100px', textAlign: 'right' });
		fontInput.onchange = (e) => { this.plugin.settings.fontFamily = (e.target as HTMLInputElement).value; void this.plugin.saveSettings(); };

		void this.plugin.addCompactStepper(container, '글자 크기', this.plugin.settings.fontSize, 1, 1, async (v) => { this.plugin.settings.fontSize = v; await this.plugin.saveSettings(); }, 'type');
		void this.plugin.addCompactStepper(container, '줄간격', this.plugin.settings.lineHeight, 0.1, 0, async (v) => { this.plugin.settings.lineHeight = v; await this.plugin.saveSettings(); }, 'align-justify');
		void this.plugin.addCompactStepper(container, '문단간격', this.plugin.settings.paragraphSpacing, 0.5, 0, async (v) => { this.plugin.settings.paragraphSpacing = v; await this.plugin.saveSettings(); }, 'pilcrow');
		void this.plugin.addCompactStepper(container, '너비', this.plugin.settings.lineWidth, 100, 0, async (v) => { this.plugin.settings.lineWidth = v; await this.plugin.saveSettings(); }, 'move-horizontal');
		void this.plugin.addCompactStepper(container, '좌우 여백', this.plugin.settings.inlinePadding ?? 40, 10, 0, async (v) => { this.plugin.settings.inlinePadding = v; await this.plugin.saveSettings(); }, 'arrow-left-right');
		void this.plugin.addCompactStepper(container, '들여쓰기', this.plugin.settings.indentation, 5, 0, async (v) => { this.plugin.settings.indentation = v; await this.plugin.saveSettings(); }, 'indent');
	}

	renderColorPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '색상', () => this.renderMenuPage(container, 'main', leaf));
		void this.plugin.addDualColorControl(container, '글자색', this.plugin.settings.fontColor, async (v) => { this.plugin.settings.fontColor = v; await this.plugin.saveSettings(); }, 'palette');
		void this.plugin.addDualColorControl(container, '배경색', this.plugin.settings.backgroundColor, async (v) => { this.plugin.settings.backgroundColor = v; await this.plugin.saveSettings(); }, 'droplet');
		void this.plugin.addCompactToggle(container, '링크 색상', !this.plugin.settings.disableLinkColor, async (v) => { this.plugin.settings.disableLinkColor = !v; await this.plugin.saveSettings(); }, 'link');
	}

	renderViewPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '보기', () => this.renderMenuPage(container, 'main', leaf));
		void this.plugin.addCompactToggle(container, '타자기 스크롤', this.plugin.settings.enableTypewriterScrolling, async (v) => { this.plugin.settings.enableTypewriterScrolling = v; await this.plugin.saveSettings(); }, 'align-vertical-justify-center');
		void this.plugin.addCompactToggle(container, '포커스 모드', this.plugin.settings.enableFocusMode, async (v) => {
			this.plugin.settings.enableFocusMode = v;
			await this.plugin.saveSettings();
			this.renderMenuPage(container, 'view', leaf);
		}, 'eye');
		if (this.plugin.settings.enableFocusMode) {
			void this.plugin.addCompactSlider(container, '투명도', this.plugin.settings.focusOpacity, 0, 1, 0.05, async (v) => { this.plugin.settings.focusOpacity = v; await this.plugin.saveSettings(); }, 'sun');
		}
		void this.plugin.addCompactToggle(container, '커스텀 구분선', this.plugin.settings.hrEnabled, async (v) => {
			this.plugin.settings.hrEnabled = v;
			await this.plugin.saveSettings();
			this.plugin.leafStyleManager.updateDynamicStyles();
		}, 'minus');

	}

	renderInputPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '입력 보조', () => this.renderMenuPage(container, 'main', leaf));
		void this.plugin.addCompactToggle(container, '스마트 따옴표', this.plugin.settings.enableSmartQuotes, async (v) => { this.plugin.settings.enableSmartQuotes = v; await this.plugin.saveSettings(); }, 'quote-glyph');
		void this.plugin.addCompactToggle(container, '스마트 엔터', this.plugin.settings.enableSmartEnter, async (v) => { this.plugin.settings.enableSmartEnter = v; await this.plugin.saveSettings(); }, 'corner-down-left');
		void this.plugin.addCompactToggle(container, '자동완성', this.plugin.settings.enableSmartInput, async (v) => { this.plugin.settings.enableSmartInput = v; await this.plugin.saveSettings(); }, 'keyboard');
		void this.plugin.addCompactToggle(container, '텍스트 치환', this.plugin.settings.enableTextSubstitution, async (v) => { this.plugin.settings.enableTextSubstitution = v; await this.plugin.saveSettings(); }, 'replace');
	}

	renderVersionMenuPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '버전 관리', () => this.renderMenuPage(container, 'main', leaf));

		const getHotkey = (commandId: string): string => {
			type HotkeyManager = { getHotkeys(id: string): Array<{ modifiers: string[]; key: string }> };
			const hotkeys = (this.plugin.app as unknown as { hotkeyManager?: HotkeyManager }).hotkeyManager?.getHotkeys(`writing-menu:${commandId}`);
			if (!hotkeys || hotkeys.length === 0) return '';
			const hk = hotkeys[0];
			const mods = (hk.modifiers || []).map((m: string) => {
				if (m === 'Mod') return Platform.isMacOS ? '⌘' : 'Ctrl';
				if (m === 'Alt') return Platform.isMacOS ? '⌥' : 'Alt';
				if (m === 'Shift') return '⇧';
				return m;
			});
			return [...mods, hk.key].join('+');
		};

		const saveRow = container.createDiv('writing-menu-control');
		const saveLabelGroup = saveRow.createDiv('writing-menu-control-label-group');
		setIcon(saveLabelGroup.createSpan('writing-menu-icon'), 'save');
		saveLabelGroup.createEl('label', { text: '버전 저장' });
		const saveHk = saveRow.createDiv();
		saveHk.setCssStyles({ display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '12px' });
		const saveHkStr = getHotkey('save-version');
		saveHk.setText(saveHkStr || '단축키 없음');
		saveRow.setCssStyles({ cursor: 'pointer' });
		saveRow.addEventListener('click', (e) => {
			e.stopPropagation();
			void (async () => {
				const activeView = this.plugin.app.workspace.activeLeaf?.view;
				if (!this.isWritingView(activeView) || !activeView.file) { new Notice('마크다운 파일을 먼저 열어주세요.'); return; }
				const file = activeView.file;
				(activeDocument.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
				const { VersionManager } = await import('../version/manager');
				const manager = new VersionManager(this.plugin.app, this.plugin);
				const now = new Date();
				const name = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
				await manager.saveVersion(file, name, this.getViewText(activeView));
				new Notice(`버전 "${name}"이 저장되었습니다.`);
			})();
		});
	}

	renderTimeTrackingPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '타이머/스톱워치 표시', () => this.renderMenuPage(container, 'main', leaf));
		void this.plugin.addCompactToggle(container, '타이머/스톱워치 표시', this.plugin.settings.showTimerWidget, async (v) => {
			this.plugin.settings.showTimerWidget = v;
			await this.plugin.saveSettings();
		}, 'activity');
	}
}
