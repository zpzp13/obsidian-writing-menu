import { MarkdownView, WorkspaceLeaf, setIcon, Platform, Notice } from 'obsidian';
import { HwpExportModal, TxtExportModal } from '../export';
import type WritingMenuPlugin from '../../main';

export class ToolbarManager {
	constructor(private plugin: WritingMenuPlugin) {}

	updateAllToolbars() {
		const markdownLeaves = this.plugin.app.workspace.getLeavesOfType('markdown');
		const leafSet = new Set(markdownLeaves);
		this.plugin.toolbarElements.forEach((toolbar, leaf) => {
			if (!leafSet.has(leaf)) {
				toolbar.remove();
				this.plugin.toolbarElements.delete(leaf);
				const headerCharCountEl = this.plugin.headerCharCountElements.get(leaf);
				if (headerCharCountEl) headerCharCountEl.remove();
				this.plugin.headerCharCountElements.delete(leaf);
				this.plugin.charCountElements.delete(leaf);
			}
		});
		markdownLeaves.forEach(leaf => {
			if (!this.plugin.toolbarElements.has(leaf)) this.addToolbarToLeaf(leaf);
		});
	}

	addToolbarToLeaf(leaf: WorkspaceLeaf) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		const viewHeader = view.containerEl.querySelector('.view-header');
		if (!viewHeader || viewHeader.querySelector('.writing-menu-button')) return;

		const charCountEl = activeDocument.createElement('div');
		charCountEl.className = 'writing-menu-char-count';
		charCountEl.setCssStyles({ fontSize: '12px', color: 'var(--text-muted)', padding: '0 8px', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' });
		this.plugin.headerCharCountElements.set(leaf, charCountEl);
		this.plugin.updateCharCount(leaf);

		const button = activeDocument.createElement('div');
		button.className = 'clickable-icon writing-menu-button';
		setIcon(button, 'settings');
		button.setCssStyles({ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' });
		button.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); this.showDropdown(button, leaf); });

		const viewActions = viewHeader.querySelector('.view-actions');
		if (viewActions) {
			viewActions.insertBefore(button, viewActions.firstChild);
			viewActions.insertBefore(charCountEl, button);
		} else {
			viewHeader.appendChild(button);
			viewHeader.appendChild(charCountEl);
		}
		this.plugin.toolbarElements.set(leaf, button);
		this.plugin.updateLeafStyles(leaf);
	}

	showDropdown(button: HTMLElement, leaf: WorkspaceLeaf) {
		const existingDropdown = activeDocument.querySelector('.writing-menu-dropdown');
		if (existingDropdown) { existingDropdown.remove(); return; }

		const dropdown = activeDocument.createElement('div');
		dropdown.className = 'writing-menu-dropdown';
		const rect = button.getBoundingClientRect();
		dropdown.setCssStyles({ position: 'fixed', top: `${rect.bottom + 5}px`, right: `${window.innerWidth - rect.right}px` });

		this.buildDropdownMenu(dropdown, leaf);

		activeDocument.body.appendChild(dropdown);
		if (dropdown.getBoundingClientRect().right > window.innerWidth) dropdown.setCssStyles({ right: '10px' });
		const closeDropdown = (e: MouseEvent) => {
			if (!dropdown.contains(e.target as Node) && !button.contains(e.target as Node)) {
				dropdown.remove(); activeDocument.removeEventListener('click', closeDropdown);
			}
		};
		window.setTimeout(() => activeDocument.addEventListener('click', closeDropdown), 10);
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
			const copyLabelGroup = copyDiv.createDiv('writing-menu-control-label-group');
			setIcon(copyLabelGroup.createSpan('writing-menu-icon'), 'copy');
			copyLabelGroup.createEl('label', { text: '복사하기' });
			const copyBtn = copyDiv.createDiv();
			copyBtn.setCssStyles({ display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '12px' });
			copyBtn.setText('Alt + C');
			copyBtn.onclick = () => {
				void this.plugin.copyWithOptions(leaf).then(() => {
					const dropdown = activeDocument.querySelector('.writing-menu-dropdown');
					if (dropdown) dropdown.remove();
				});
			};
		}

		if (Platform.isDesktopApp) {
			const exportDiv = container.createDiv('writing-menu-control');
			const exportLabelGroup = exportDiv.createDiv('writing-menu-control-label-group');
			setIcon(exportLabelGroup.createSpan('writing-menu-icon'), 'file-output');
			exportLabelGroup.createEl('label', { text: '내보내기' });
			const exportRightGroup = exportDiv.createDiv();
			exportRightGroup.setCssStyles({ display: 'flex', alignItems: 'center', gap: '8px' });
			if (Platform.isWin) {
				const hwpBtn = exportRightGroup.createDiv('writing-menu-text-btn');
				hwpBtn.setText('HWP');
				hwpBtn.onclick = () => {
					const view = leaf.view;
					if (view instanceof MarkdownView && view.file && view.file.extension === 'md') {
						(activeDocument.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
						new HwpExportModal(this.plugin.app, this.plugin, view.file).open();
					} else { new Notice('마크다운 파일을 열어주세요.', 3000); }
				};
			}
			const txtBtn = exportRightGroup.createDiv('writing-menu-text-btn');
			txtBtn.setText('TXT');
			txtBtn.onclick = () => {
				const view = leaf.view;
				if (view instanceof MarkdownView && view.file && view.file.extension === 'md') {
					(activeDocument.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
					new TxtExportModal(this.plugin.app, this.plugin, view.file).open();
				} else { new Notice('마크다운 파일을 열어주세요.', 3000); }
			};
		}

		try {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.editor) {
				this.plugin.addCharCountWithModeSelector(container, this.plugin.calculateCharCount(view.editor.getValue()), leaf);
			}
		} catch { /* intentional */ }

		this.addSeparator(container);

		this.addMenuNavCard(container, '서식', 'type', () => this.renderMenuPage(container, 'typography', leaf));
		this.addMenuNavCard(container, '색상', 'palette', () => this.renderMenuPage(container, 'color', leaf));
		this.addMenuNavCard(container, '입력 보조', 'keyboard', () => this.renderMenuPage(container, 'input', leaf));
		this.addMenuNavCard(container, '스톱워치', 'clock', () => this.renderMenuPage(container, 'time-tracking', leaf));
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

		this.addSeparator(container);

		const shortcutRow = container.createDiv('writing-menu-control');
		const shortcutLabel = shortcutRow.createDiv('writing-menu-control-label-group');
		setIcon(shortcutLabel.createSpan('writing-menu-icon'), 'keyboard');
		shortcutLabel.createEl('label', { text: '단축키' });
		const f4Badge = shortcutRow.createDiv();
		f4Badge.setCssStyles({ display: 'flex', alignItems: 'center', cursor: 'default', color: 'var(--text-muted)', fontSize: '12px' });
		f4Badge.setText('F4');

		void this.plugin.addCompactToggle(container, '길게 보기', this.plugin.settings.zenWideEnabled, async (v) => {
			this.plugin.settings.zenWideEnabled = v;
			await this.plugin.saveSettings();
		}, 'move-vertical');

		void this.plugin.addCompactToggle(container, '집중 모드', this.plugin.settings.zenFocusEnabled, async (v) => {
			this.plugin.settings.zenFocusEnabled = v;
			await this.plugin.saveSettings();
		}, 'expand');
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
				const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
				const file = activeView?.file;
				if (!file || !activeView) { new Notice('마크다운 파일을 먼저 열어주세요.'); return; }
				(activeDocument.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
				const { VersionManager } = await import('../version/manager');
				const manager = new VersionManager(this.plugin.app, this.plugin);
				const now = new Date();
				const name = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
				await manager.saveVersion(file, name, activeView.editor.getValue());
				new Notice(`버전 "${name}"이 저장되었습니다.`);
			})();
		});
	}

	renderTimeTrackingPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '스톱워치', () => this.renderMenuPage(container, 'main', leaf));
		void this.plugin.addCompactToggle(container, '상태바 표시', this.plugin.settings.showTimeInStatusBar, async (v) => {
			this.plugin.settings.showTimeInStatusBar = v;
			this.plugin.settings.enableTimeTracking = v || this.plugin.settings.showTimeInDashboard;
			await this.plugin.saveSettings();
			this.plugin.updateStatusBarDisplay();
		}, 'activity');
		void this.plugin.addCompactToggle(container, '대시보드 표시', this.plugin.settings.showTimeInDashboard, async (v) => {
			this.plugin.settings.showTimeInDashboard = v;
			this.plugin.settings.enableTimeTracking = this.plugin.settings.showTimeInStatusBar || v;
			await this.plugin.saveSettings();
		}, 'layout-dashboard');
	}
}
