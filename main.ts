import { App, Plugin, MarkdownView, WorkspaceLeaf, TFile, TFolder, TAbstractFile, Notice, Platform, EventRef, MenuItem } from 'obsidian';
import { Compartment } from '@codemirror/state';
import { SymbolSuggester } from './SymbolSuggester';
import { WritingMenuSettings, DEFAULT_SETTINGS } from './src/types';
import { MobilePreviewFloating } from './src/preview';
import { TimeTrackingView, TIME_TRACKING_VIEW_TYPE } from './src/views/TimeTrackingView';
import { HwpExportModal, TxtExportModal, BatchExportModal } from './src/export';
import { WritingMenuSettingTab } from './src/settings';
import { ensureConverterScript, openFolderPicker, openTemplatePicker, runPicker, convertToHwp, getDefaultExportPath, cleanMarkdownFrontmatter, removeHeadings, copyWithOptions, applySpaceIndent, convertToTxt, convertFolderToTxt, convertFilesToTxt, convertFolderToHwp, convertFilesToHwp, convertFolderToTxtMerged, convertFilesToTxtMerged, convertFolderToHwpMerged, convertFilesToHwpMerged } from './src/export/converterMethods';
import { addCompactControl, addCompactToggle, addCompactStepper, addCompactSlider, addDualColorControl } from './src/ui/controls';
import { openDictionary } from './src/dictionary';
import { openSpecialChars } from './src/special-chars/SpecialCharsModal';
import { CalendarView, VIEW_TYPE_CALENDAR } from './src/calendar/views/CalendarView';
import { DailyCharStore } from './src/dashboard/data/DailyCharStore';
import { MusicPlayer } from './src/dashboard/MusicPlayer';
import { LeafStyleManager } from './src/editor/LeafStyleManager';
import { ToolbarManager } from './src/toolbar/ToolbarManager';
import { StopwatchManager } from './src/dashboard/StopwatchManager';
import { StatusBarManager } from './src/ui/StatusBarManager';
import { getSmartEnterExtension, getSmartQuoteExtension, getTypewriterExtension, getTextSubstitutionExtension, getBackspaceUndoExtension, createHeadingLinkFixExtension, createSelectionExtension, createFocusExtension, updateEditorExtensions } from './src/editor/extensions';

export default class WritingMenuPlugin extends Plugin {
	settings: WritingMenuSettings;
	mobilePreviewFloating: MobilePreviewFloating;
	charStore: DailyCharStore;
	settingTab: WritingMenuSettingTab | null = null;
	wikiPanelRerender: (() => void) | null = null;
	toolbarElements: Map<WorkspaceLeaf, HTMLElement> = new Map();
	leafIdCounter: number = 0;
	charCountElements: Map<WorkspaceLeaf, HTMLElement> = new Map();
	headerCharCountElements: Map<WorkspaceLeaf, HTMLElement> = new Map();
	charCountDebounceTimers: Map<WorkspaceLeaf, number> = new Map();
	cachedCSSTemplate: string = '';
	cssSettingsVersion: number = 0;
	leafStyleVersions: Map<WorkspaceLeaf, number> = new Map();
	pendingTimeUpdates: Map<string, { file: TFile; mode: string; seconds: number }> = new Map();
	private nnMenuUnregisterFns: Array<() => void> = [];
	stopwatchSeconds: number = 0;
	stopwatchInterval: number | null = null;
	stopwatchDisplayEl: HTMLElement | null = null;
	stopwatchDashboardEl: HTMLElement | null = null;
	stopwatchDashboardSegs: HTMLElement[] = [];
	smartEnterCompartment = new Compartment();
	smartQuoteCompartment = new Compartment();
	typewriterCompartment = new Compartment();
	textSubstitutionCompartment = new Compartment();
	lastTypedAt: number = 0;
	lastSubstitution: { from: string; to: string; endPos: number } | null = null;
	zenState: 'off' | 'wide' | 'focus' = 'off';
	zenLeaf: WorkspaceLeaf | null = null;
	zenLeafEventRef: EventRef | null = null;
	statusBarItemEl: HTMLElement | null = null;
	statusBarTimeEl: HTMLElement | null = null;
	musicPlayer: MusicPlayer | null = null;

	leafStyleManager: LeafStyleManager;
	toolbarManager: ToolbarManager;
	stopwatchManager: StopwatchManager;
	statusBarManager: StatusBarManager;

	async onload() {
		await this.loadSettings();

		this.leafStyleManager = new LeafStyleManager(this);
		this.toolbarManager = new ToolbarManager(this);
		this.stopwatchManager = new StopwatchManager(this);
		this.statusBarManager = new StatusBarManager(this);

		this.initStopwatch();
		this.mobilePreviewFloating = new MobilePreviewFloating(this);

		this.charStore = new DailyCharStore(this);
		this.charStore.init().catch(() => {});

		this.musicPlayer = new MusicPlayer(this);
		this.app.workspace.onLayoutReady(() => {
			this.musicPlayer?.loadPlaylist()
				.then(() => this.refreshDashboardView())
				.catch(() => {});
		});
		this.registerEvent(this.app.vault.on('modify', file => {
			if (file instanceof TFile) void this.charStore.onFileModify(file);
		}));

		if (Platform.isWin) {
			await this.ensureConverterScript();
		}

		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this.updateAllToolbars();
			// rAF ensures DOM (mod-visible class) is settled before checking preview mode
			window.requestAnimationFrame(() => this.updateAllLeafStyles());
		}));

		this.registerEvent(this.app.workspace.on('file-open', () => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView?.leaf) this.updateLeafStyles(activeView.leaf);
		}));

		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			if (leaf) this.updateLeafStyles(leaf);
		}));

		this.registerEvent(this.app.workspace.on('editor-change', () => {
			this.lastTypedAt = Date.now();
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView?.leaf) {
				this.updateCharCountDebounced(activeView.leaf);
			}
		}));

		this.updateAllToolbars();
		this.updateAllLeafStyles();

		const themeObserver = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
					if (mutation.target === activeDocument.body) {
						this.regenerateCSSTemplate();
						this.updateAllLeafStyles();
					}
				}
			});
		});
		themeObserver.observe(activeDocument.body, { attributes: true, attributeFilter: ['class'] });
		this.register(() => themeObserver.disconnect());

		this.registerEditorExtension(createFocusExtension(this));
		this.registerEditorExtension(createSelectionExtension(this));
		this.registerEditorExtension(createHeadingLinkFixExtension());
		this.registerEditorSuggest(new SymbolSuggester(this));

		this.registerEditorExtension(this.smartEnterCompartment.of(getSmartEnterExtension(this)));
		this.registerEditorExtension(this.smartQuoteCompartment.of(getSmartQuoteExtension(this)));
		this.registerEditorExtension(this.typewriterCompartment.of(getTypewriterExtension(this)));
		this.registerEditorExtension(this.textSubstitutionCompartment.of([
			getTextSubstitutionExtension(this),
			getBackspaceUndoExtension(this)
		]));

		this.updateDynamicStyles();

		this.settingTab = new WritingMenuSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && file.extension === 'md') {
					if (Platform.isDesktopApp) {
						menu.addItem((item) => {
							item
								.setTitle('TXT로 내보내기')
								.setIcon('file-text')
								.onClick(() => {
									new TxtExportModal(this.app, this, file).open();
								});
						});
					}
					if (Platform.isWin) {
						menu.addItem((item) => {
							item
								.setTitle('HWP로 내보내기')
								.setIcon('file')
								.onClick(() => {
									new HwpExportModal(this.app, this, file).open();
								});
						});
					}
				} else if (file instanceof TFolder) {
					if (Platform.isDesktopApp) {
						menu.addItem((item) => {
							item
								.setTitle('폴더를 TXT로 내보내기')
								.setIcon('folder-output')
								.onClick(() => {
									new BatchExportModal(this.app, this, file, 'txt').open();
								});
						});
					}

					if (Platform.isWin) {
						menu.addItem((item) => {
							item
								.setTitle('폴더를 HWP로 내보내기')
								.setIcon('folder-output')
								.onClick(() => {
									new BatchExportModal(this.app, this, file, 'hwp').open();
								});
						});
					}
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('files-menu', (menu, files) => {
				const mdFiles = files.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
				if (mdFiles.length > 0) {
					if (Platform.isDesktopApp) {
						menu.addItem((item) => {
							item
								.setTitle(`${mdFiles.length}개 파일을 TXT로 내보내기`)
								.setIcon('files')
								.onClick(() => {
									new BatchExportModal(this.app, this, mdFiles, 'txt').open();
								});
						});
					}

					if (Platform.isWin) {
						menu.addItem((item) => {
							item
								.setTitle(`${mdFiles.length}개 파일을 HWP로 내보내기`)
								.setIcon('files')
								.onClick(() => {
									new BatchExportModal(this.app, this, mdFiles, 'hwp').open();
								});
						});
					}
				}
			})
		);

		this.registerView(
			TIME_TRACKING_VIEW_TYPE,
			(leaf) => new TimeTrackingView(leaf, this)
		);

		this.registerView(
			VIEW_TYPE_CALENDAR,
			(leaf) => new CalendarView(leaf, this)
		);

		this.addCommand({
			id: 'toggle-dashboard-view',
			name: '대시보드 열기/닫기',
			callback: () => this.toggleCalendarView(),
		});

		this.addRibbonIcon('layout-dashboard', '대시보드', () => this.toggleCalendarView());

		this.addCommand({
			id: 'toggle-time-tracking-sidebar',
			name: '작업 시간 사이드바 열기/닫기',
			callback: () => {
				void this.toggleTimeTrackingSidebar();
			}
		});

		this.addCommand({
			id: 'save-version',
			name: '버전 저장',
			editorCallback: async (editor, ctx) => {
				const file = ctx.file;
				if (!file) return;
				const { VersionManager } = await import('./src/version/manager');
				const manager = new VersionManager(this.app, this);
				const now = new Date();
				const name = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
				await manager.saveVersion(file, name, editor.getValue());
				new Notice(`버전 "${name}"이 저장되었습니다.`);
			}
		});

		this.addCommand({
			id: 'copy-without-excluded',
			name: '복사하기 (헤딩·각주 제외)',
			callback: async () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView?.leaf) await this.copyWithOptions(activeView.leaf);
			}
		});

		this.addCommand({
			id: 'zen-mode',
			name: '집중/길게 보기',
			callback: () => { this.cycleZenMode(); },
		});

		this.addCommand({
			id: 'hanja-convert',
			name: '사전 / 한자 변환',
			callback: () => openDictionary(this),
		});

		this.addCommand({
			id: 'special-chars',
			name: '특수문자',
			hotkeys: [{ modifiers: [], key: 'F10' }],
			callback: () => openSpecialChars(this),
		});

		this.addCommand({
			id: 'wiki-folder-picker',
			name: '옵시위키: 폴더·노트 선택',
			callback: async () => {
				let leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
				if (leaves.length === 0) {
					const leaf = this.app.workspace.getRightLeaf(false);
					if (!leaf) return;
					await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: true });
					await this.app.workspace.revealLeaf(leaf);
					leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
				}
				if (leaves.length === 0) return;
				const leaf = leaves[0];
				await this.app.workspace.revealLeaf(leaf);
				(leaf.view as CalendarView).activateWikiPicker();
			},
		});

		this.addCommand({
			id: 'toggle-mobile-preview',
			name: '모바일 미리보기',
			callback: () => {
				if (this.mobilePreviewFloating.isOpen()) this.mobilePreviewFloating.close();
				else this.mobilePreviewFloating.open();
			}
		});

		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			if (this.mobilePreviewFloating.isOpen()) this.mobilePreviewFloating.scheduleRefresh(600);
		}));
		this.registerEvent(this.app.vault.on('modify', () => {
			if (this.mobilePreviewFloating.isOpen()) this.mobilePreviewFloating.scheduleRefresh(400);
		}));

		// Status bar: stopwatch tag button
		const statusBarItem = this.addStatusBarItem();
		statusBarItem.addClass('wm-status-bar-item');
		statusBarItem.setCssStyles({ display: 'none' });
		this.statusBarItemEl = statusBarItem;
		this.statusBarTimeEl = statusBarItem.createEl('span', { cls: 'wm-status-time' });
		statusBarItem.addEventListener('click', (e) => {
			e.stopPropagation();
			this.toggleStatusPopup(statusBarItem);
		});
		this.updateStatusBarDisplay();

		activeDocument.addEventListener('fullscreenchange', () => {
			if (activeDocument.fullscreenElement) {
				if (this.zenState === 'focus') this.leafStyleManager.activateFocusMode();
			} else {
				if (activeDocument.body.classList.contains('wm-focus-mode') || this.zenState === 'focus') {
					this.zenState = 'off';
					this.exitZenFocus();
				}
			}
		});

		this.app.workspace.onLayoutReady(() => {
			this.registerNotebookNavigatorMenus();
		});
	}

	private registerNotebookNavigatorMenus() {
		interface AppWithPlugins { plugins?: { plugins?: Record<string, unknown> } }
		const nn = (this.app as unknown as AppWithPlugins).plugins?.plugins?.['notebook-navigator'] as { api?: { menus?: { registerFileMenu(fn: (ctx: unknown) => void): unknown; registerFolderMenu(fn: (ctx: unknown) => void): unknown } } } | undefined;
		if (!nn?.api?.menus) return;

		const unregFile = nn.api.menus.registerFileMenu((ctx: {
			addItem: (fn: (item: MenuItem) => void) => void;
			file: TFile;
			selection: { mode: string; files: TAbstractFile[] };
		}) => {
			const mdFiles = ctx.selection.files.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
			const isMulti = mdFiles.length > 1;

			if (isMulti) {
				if (Platform.isDesktopApp) {
					ctx.addItem(item => item
						.setTitle(`${mdFiles.length}개 파일을 TXT로 내보내기`)
						.setIcon('files')
						.onClick(() => new BatchExportModal(this.app, this, mdFiles, 'txt').open()));
				}
				if (Platform.isWin) {
					ctx.addItem(item => item
						.setTitle(`${mdFiles.length}개 파일을 HWP로 내보내기`)
						.setIcon('files')
						.onClick(() => new BatchExportModal(this.app, this, mdFiles, 'hwp').open()));
				}
			} else if (ctx.file.extension === 'md') {
				if (Platform.isDesktopApp) {
					ctx.addItem(item => item
						.setTitle('TXT로 내보내기')
						.setIcon('file-text')
						.onClick(() => new TxtExportModal(this.app, this, ctx.file).open()));
				}
				if (Platform.isWin) {
					ctx.addItem(item => item
						.setTitle('HWP로 내보내기')
						.setIcon('file')
						.onClick(() => new HwpExportModal(this.app, this, ctx.file).open()));
				}
			}
		});

		const unregFolder = nn.api.menus.registerFolderMenu((ctx: {
			addItem: (fn: (item: MenuItem) => void) => void;
			folder: TFolder;
		}) => {
			if (Platform.isDesktopApp) {
				ctx.addItem(item => item
					.setTitle('폴더를 TXT로 내보내기')
					.setIcon('folder-output')
					.onClick(() => new BatchExportModal(this.app, this, ctx.folder, 'txt').open()));
			}
			if (Platform.isWin) {
				ctx.addItem(item => item
					.setTitle('폴더를 HWP로 내보내기')
					.setIcon('folder-output')
					.onClick(() => new BatchExportModal(this.app, this, ctx.folder, 'hwp').open()));
			}
		});

		if (typeof unregFile === 'function') this.nnMenuUnregisterFns.push(unregFile as () => void);
		if (typeof unregFolder === 'function') this.nnMenuUnregisterFns.push(unregFolder as () => void);
	}


	async toggleCalendarView() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
		if (leaves.length > 0) {
			leaves.forEach(leaf => leaf.detach());
		} else {
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: true });
				await this.app.workspace.revealLeaf(leaf);
			}
		}
	}

	async toggleTimeTrackingSidebar() {
		const leaves = this.app.workspace.getLeavesOfType(TIME_TRACKING_VIEW_TYPE);
		if (leaves.length > 0) {
			leaves.forEach(leaf => leaf.detach());
		} else {
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: TIME_TRACKING_VIEW_TYPE,
					active: true
				});
				await this.app.workspace.revealLeaf(leaf);
			}
		}
	}

	onunload(): void {
		this.musicPlayer?.destroy();
		this.musicPlayer = null;

		for (const unregister of this.nnMenuUnregisterFns) {
			try { unregister(); } catch { /* intentional */ }
		}
		this.nnMenuUnregisterFns = [];

		this.charCountDebounceTimers.forEach((timer) => window.clearTimeout(timer));
		this.charCountDebounceTimers.clear();
		this.toolbarElements.forEach((toolbar) => toolbar.remove());
		this.toolbarElements.clear();
		this.headerCharCountElements.forEach((el) => el.remove());
		this.headerCharCountElements.clear();
		this.charCountElements.clear();
		this.leafStyleVersions.forEach((_, leaf) => {
			if (leaf.view instanceof MarkdownView) {
				leaf.view.containerEl.removeAttribute('data-writing-menu-id');
			}
		});
		this.leafStyleVersions.clear();

		activeDocument.body.classList.remove('writing-menu-focus-enabled');
		activeDocument.body.classList.remove('writing-menu-typewriter-active');
		activeDocument.body.classList.remove('wm-focus-mode');
		activeDocument.body.classList.remove('wm-wide-mode');
		activeDocument.body.style.removeProperty('--writing-menu-focus-opacity');
		this.clearZenLeaf();
		if (this.zenLeafEventRef) {
			this.app.workspace.offref(this.zenLeafEventRef);
			this.zenLeafEventRef = null;
		}
		this.mobilePreviewFloating.close();
	}

	formatTime(seconds: number, showHoursWhenNeeded: boolean = false): string {
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		const s = seconds % 60;
		if (showHoursWhenNeeded && h > 0) {
			return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
		}
		return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
	}

	private parseTime(timeStr: string): number {
		if (!timeStr) return 0;
		const parts = timeStr.split(':');
		if (parts.length === 2) {
			const [m, s] = parts.map(p => parseInt(p, 10) || 0);
			return m * 60 + s;
		} else if (parts.length === 3) {
			const [h, m, s] = parts.map(p => parseInt(p, 10) || 0);
			return h * 3600 + m * 60 + s;
		}
		return 0;
	}

	async loadSettings() {
		const savedData = await this.loadData() as Partial<WritingMenuSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);
		// @ts-ignore
		if (this.settings.symbolPairs && !this.settings.symbolTriggers) {
			this.settings.symbolTriggers = [];
			// @ts-ignore
			(this.settings.symbolPairs as Array<{ trigger: string; openSymbol: string; closeSymbol: string }>).forEach((pair) => {
				this.settings.symbolTriggers.push({
					trigger: pair.trigger,
					options: [{ open: pair.openSymbol, close: pair.closeSymbol }],
					enabled: true
				});
			});
			// @ts-ignore
			delete this.settings.symbolPairs;
			void this.saveSettings();
		}
		if (!this.settings.customFonts) this.settings.customFonts = [];

		// trackingFolder 마이그레이션: heatmapFolder + timeTrackingFolder → trackingFolder
		if (!this.settings.trackingFolder) {
			// @ts-ignore
			const tf = this.settings.timeTrackingFolder as string | undefined;
			// @ts-ignore
			const hf = this.settings.heatmapFolder as string | undefined;
			this.settings.trackingFolder = tf || hf || '';
			// @ts-ignore
			delete this.settings.timeTrackingFolder;
			// @ts-ignore
			delete this.settings.heatmapFolder;
			void this.saveSettings();
		}

		// timeModes 마이그레이션: 구버전 timeKeys/timeGoals → timeModes
		if (!this.settings.timeModes?.length && this.settings.timeKeys) {
			const tk = this.settings.timeKeys;
			const tg = this.settings.timeGoals ?? {} as { draft?: number; writing?: number; editing?: number };
			this.settings.timeModes = [
				{ id: 'draft',   label: '초고', frontmatterKey: tk.draft   ?? '초고_시간', goalSeconds: tg.draft   ?? 7200 },
				{ id: 'writing', label: '집필', frontmatterKey: tk.writing ?? '집필_시간', goalSeconds: tg.writing ?? 7200 },
				{ id: 'editing', label: '퇴고', frontmatterKey: tk.editing ?? '퇴고_시간', goalSeconds: tg.editing ?? 7200 },
			];
			this.settings.timeTotalKey = tk.total ?? '총_시간';
			void this.saveSettings();
		}

		// dashboardSections에 새 섹션 누락 시 추가 (마이그레이션)
		if (this.settings.dashboardSections) {
			const existingIds = new Set(this.settings.dashboardSections.map(s => s.id));
			if (!existingIds.has('music')) {
				this.settings.dashboardSections.push({ id: 'music', label: '음악', visible: true });
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.regenerateCSSTemplate();
		this.updateEditorExtensions();
		this.updateAllLeafStyles();
		this.updateDynamicStyles();
		this.updateStatusBarDisplay();
		await this.refreshDashboardView();
	}

	async refreshDashboardView() {
		await this.charStore.reinitSnapshot().catch(() => {});
		const { VIEW_TYPE_CALENDAR: VTC } = await import('./src/calendar/views/CalendarView');
		this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			if (leaf.view.getViewType() === VTC) {
				(leaf.view as unknown as { render?: () => void }).render?.();
			}
		});
	}

	// ── LeafStyleManager wrappers ──
	shouldApplyToFile(file: { path: string } | null): boolean { return this.leafStyleManager.shouldApplyToFile(file); }
	calculateCharCount(text: string): number { return this.leafStyleManager.calculateCharCount(text); }
	formatCharCount(count: number): string { return this.leafStyleManager.formatCharCount(count); }
	updateCharCount(leaf: WorkspaceLeaf) { this.leafStyleManager.updateCharCount(leaf); }
	updateCharCountDebounced(leaf: WorkspaceLeaf) { this.leafStyleManager.updateCharCountDebounced(leaf); }
	updateDynamicStyles() { this.leafStyleManager.updateDynamicStyles(); }
	regenerateCSSTemplate() { this.leafStyleManager.regenerateCSSTemplate(); }
	updateLeafStyles(leaf: WorkspaceLeaf, force: boolean = false) { this.leafStyleManager.updateLeafStyles(leaf, force); }
	updateAllLeafStyles() { this.leafStyleManager.updateAllLeafStyles(); }
	applyZenState(state: 'off' | 'wide' | 'focus') { this.leafStyleManager.applyZenState(state); }
	exitZenFocus() { this.leafStyleManager.exitZenFocus(); }
	activateFocusMode() { this.leafStyleManager.activateFocusMode(); }
	cycleZenMode() { this.leafStyleManager.cycleZenMode(); }
	applyZenLeaf(leaf: WorkspaceLeaf) { this.leafStyleManager.applyZenLeaf(leaf); }
	clearZenLeaf() { this.leafStyleManager.clearZenLeaf(); }
	addCharCountWithModeSelector(container: HTMLElement, count: number, leaf: WorkspaceLeaf) { this.leafStyleManager.addCharCountWithModeSelector(container, count, leaf); }
	updateAllCharCounts() { this.leafStyleManager.updateAllCharCounts(); }
	styleIconButton(btn: HTMLElement, opacity: number = 1) { this.leafStyleManager.styleIconButton(btn, opacity); }

	// ── StopwatchManager wrappers ──
	initStopwatch() { this.stopwatchManager.initStopwatch(); }
	startStopwatch() { this.stopwatchManager.startStopwatch(); }
	stopStopwatch() { this.stopwatchManager.stopStopwatch(); }
	resetStopwatch() { this.stopwatchManager.resetStopwatch(); }
	updateStopwatchDisplay() { this.stopwatchManager.updateStopwatchDisplay(); }
	updateStopwatchSegments() { this.stopwatchManager.updateStopwatchSegments(); }
	buildStatusPopup(container: HTMLElement) { this.stopwatchManager.buildStatusPopup(container); }
	toggleDashboardStopwatchPopup(anchor: HTMLElement) { this.stopwatchManager.toggleDashboardStopwatchPopup(anchor); }
	playAlarm() { this.stopwatchManager.playAlarm(); }

	// ── StatusBarManager wrappers ──
	updateStatusBarDisplay() { this.statusBarManager.updateStatusBarDisplay(); }
	toggleStatusPopup(anchor: HTMLElement) { this.statusBarManager.toggleStatusPopup(anchor); }

	// ── ToolbarManager wrappers ──
	updateAllToolbars() { this.toolbarManager.updateAllToolbars(); }
	addToolbarToLeaf(leaf: WorkspaceLeaf) { this.toolbarManager.addToolbarToLeaf(leaf); }
	showDropdown(button: HTMLElement, leaf: WorkspaceLeaf) { this.toolbarManager.showDropdown(button, leaf); }
	buildDropdownMenu(container: HTMLElement, leaf: WorkspaceLeaf) { this.toolbarManager.buildDropdownMenu(container, leaf); }
	renderMenuPage(container: HTMLElement, page: string, leaf: WorkspaceLeaf) { this.toolbarManager.renderMenuPage(container, page, leaf); }
	addMenuNavCard(container: HTMLElement, title: string, desc: string, icon: string, onClick: () => void) { this.toolbarManager.addMenuNavCard(container, title, desc, icon, onClick); }
	addMenuBackButton(container: HTMLElement, title: string, onBack: () => void) { this.toolbarManager.addMenuBackButton(container, title, onBack); }
	addSeparator(container: HTMLElement) { this.toolbarManager.addSeparator(container); }

	// ── Extension wrappers ──
	updateEditorExtensions() { updateEditorExtensions(this); }

	// ── HWP Converter Script Management ──
	async ensureConverterScript(){ return await ensureConverterScript(this); }
	async openFolderPicker(): Promise<string | null>{ return await openFolderPicker(this); }
	async openTemplatePicker(): Promise<string | null>{ return await openTemplatePicker(this); }
	async runPicker(mode: 'folder' | 'file'): Promise<string | null>{ return await runPicker(this, mode); }
	async convertToHwp(file: TFile, fileName: string, exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<boolean>{ return await convertToHwp(this, file, fileName, exportPath, useSpaceIndent, excludeHeadings); }
	getDefaultExportPath(): string{ return getDefaultExportPath(this); }
	cleanMarkdownFrontmatter(content: string): string{ return cleanMarkdownFrontmatter(this, content); }
	removeHeadings(content: string): string{ return removeHeadings(this, content); }
	async copyWithOptions(leaf: WorkspaceLeaf){ return await copyWithOptions(this, leaf); }
	applySpaceIndent(text: string): string{ return applySpaceIndent(this, text); }
	async convertToTxt(file: TFile, fileName: string, exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<boolean>{ return await convertToTxt(this, file, fileName, exportPath, useSpaceIndent, excludeHeadings); }
	async convertFolderToTxt(folderPath: string, exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFolderToTxt(this, folderPath, exportPath, useSpaceIndent, excludeHeadings); }
	async convertFilesToTxt(files: TFile[], exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFilesToTxt(this, files, exportPath, useSpaceIndent, excludeHeadings); }
	async convertFolderToHwp(folderPath: string, exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFolderToHwp(this, folderPath, exportPath, useSpaceIndent, excludeHeadings); }
	async convertFilesToHwp(files: TFile[], exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFilesToHwp(this, files, exportPath, useSpaceIndent, excludeHeadings); }
	async convertFolderToTxtMerged(folderPath: string, exportPath: string, fileName: string, useSpaceIndent: boolean): Promise<void>{ return await convertFolderToTxtMerged(this, folderPath, exportPath, fileName, useSpaceIndent); }
	async convertFilesToTxtMerged(files: TFile[], exportPath: string, fileName: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFilesToTxtMerged(this, files, exportPath, fileName, useSpaceIndent, excludeHeadings); }
	async convertFolderToHwpMerged(folderPath: string, exportPath: string, fileName: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFolderToHwpMerged(this, folderPath, exportPath, fileName, useSpaceIndent, excludeHeadings); }
	async convertFilesToHwpMerged(files: TFile[], exportPath: string, fileName: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFilesToHwpMerged(this, files, exportPath, fileName, useSpaceIndent, excludeHeadings); }

	async addCompactControl(container: HTMLElement, label: string, value: string, callback: (v: string) => void | Promise<void>, icon?: string, type: string = 'text'){ return await addCompactControl(this, container, label, value, callback, icon, type); }
	async addCompactToggle(container: HTMLElement, label: string, value: boolean, callback: (v: boolean) => void | Promise<void>, icon?: string){ return await addCompactToggle(this, container, label, value, callback, icon); }
	async addCompactStepper(container: HTMLElement, label: string, value: number, step: number, min: number, callback: (v: number) => void | Promise<void>, icon?: string){ return await addCompactStepper(this, container, label, value, step, min, callback, icon); }
	async addCompactSlider(container: HTMLElement, label: string, value: number, min: number, max: number, step: number, callback: (v: number) => void | Promise<void>, icon?: string){ return await addCompactSlider(this, container, label, value, min, max, step, callback, icon); }
	async addDualColorControl(container: HTMLElement, label: string, value: string | { light: string, dark: string }, callback: (v: string | { light: string; dark: string }) => void | Promise<void>, icon?: string){ return await addDualColorControl(this, container, label, value, callback, icon); }

	openSettings() {
		interface AppWithSettings extends App { setting?: { open(): void; openTabById(id: string): void } }
		(this.app as AppWithSettings).setting?.open();
		(this.app as AppWithSettings).setting?.openTabById(this.manifest.id);
	}
}
