import { App, Plugin, MarkdownView, WorkspaceLeaf, TFile, TFolder, TAbstractFile, Notice, Platform, EventRef, MenuItem, normalizePath } from 'obsidian';
import type { Editor } from 'obsidian';
import { WhatsNewModal, getLatestReleaseNote, shouldShowWhatsNew } from './src/ui/WhatsNewModal';
import { Compartment } from '@codemirror/state';
import { SymbolSuggester } from './SymbolSuggester';
import { WritingMenuSettings, DEFAULT_SETTINGS } from './src/types';
import { MusicLibraryView, MUSIC_LIBRARY_VIEW_TYPE } from './src/views/MusicLibraryView';
import { HwpExportModal, TxtExportModal, BatchExportModal } from './src/export';
import { WritingMenuSettingTab } from './src/settings';
import { ensureConverterScript, openFolderPicker, openTemplatePicker, runPicker, convertToHwp, getDefaultExportPath, cleanMarkdownFrontmatter, removeHeadings, copyWithOptions, applySpaceIndent, convertToTxt, convertFolderToTxt, convertFilesToTxt, convertFolderToHwp, convertFilesToHwp, convertFolderToTxtMerged, convertFilesToTxtMerged, convertFolderToHwpMerged, convertFilesToHwpMerged } from './src/export/converterMethods';
import { addCompactControl, addCompactToggle, addCompactStepper, addCompactSlider, addDualColorControl } from './src/ui/controls';
import { openDictionary } from './src/dictionary';
import { openSpecialChars } from './src/special-chars/SpecialCharsModal';
import { CalendarView, VIEW_TYPE_CALENDAR } from './src/calendar/views/CalendarView';
import { PlotWorkbookView } from './src/plot-workbook/PlotWorkbookView';
import { PLOT_WORKBOOK_VIEW_TYPE, PLOT_WORKBOOK_SIDEBAR_TYPE } from './src/plot-workbook/PlotWorkbookTypes';
import { PlotWorkbookSidebarView } from './src/plot-workbook/PlotWorkbookSidebarView';
import { disposePlotWorkbookSessions } from './src/plot-workbook/PlotWorkbookSessionStore';
import { LegacyPlotViewRedirect } from './src/plot-workbook/LegacyPlotViewRedirect';
import { DailyCharStore } from './src/dashboard/data/DailyCharStore';
import { stripTrackedTimeFieldsFromPaste } from './src/utils/timeUtils';
import { MusicPlayer } from './src/dashboard/MusicPlayer';
import { LeafStyleManager } from './src/editor/LeafStyleManager';
import { ToolbarManager } from './src/toolbar/ToolbarManager';
import { StopwatchManager } from './src/dashboard/StopwatchManager';
import { SpellCheckerService } from './src/spellcheck/index';
import { initializeWritingDocuments } from './src/writing/WritingDocument';
import { openSnapshotManager, snapshotTarget } from './src/snapshots/SnapshotManager';
import { initializeManuscriptSnapshots } from './src/snapshots/ManuscriptSnapshotLifecycle';
import { migrateDashboardSettings, takeLegacyTrackingFolder } from './src/settings/migrateDashboardSettings';

const LEGACY_PLOT_VIEW_TYPE = 'writing-menu-plot-manager';
const LEGACY_PLOT_TIMELINE_VIEW_TYPE = 'writing-menu-plot-timeline';
import { getSmartEnterExtension, getSmartQuoteExtension, getTypewriterExtension, getTextSubstitutionExtension, getBackspaceUndoExtension, createHeadingLinkFixExtension, createSelectionExtension, createFocusExtension, updateEditorExtensions } from './src/editor/extensions';
import { repetitionHighlightExtension } from './src/editor/repetitionHighlight';
import { spellcheckHighlightExtension } from './src/editor/spellcheckHighlight';
import { PagedWritingView, PAGED_WRITING_VIEW_TYPE } from './src/paged/PagedWritingView';
import { ProjectContextService } from './src/projects/ProjectContextService';
import { MobileFontManager } from './src/fonts/MobileFontManager';
import { observeThemeMode } from './src/utils/themeColor';

interface WritingMenuRuntimeWindow extends Window {
	__writingMenuPluginInstance?: WritingMenuPlugin;
}

export default class WritingMenuPlugin extends Plugin {
	settings: WritingMenuSettings;
	charStore: DailyCharStore;
	settingTab: WritingMenuSettingTab | null = null;
	wikiPanelRerender: (() => void) | null = null;
	toolbarElements: Map<WorkspaceLeaf, HTMLElement> = new Map();
	leafIdCounter: number = 0;
	charCountElements: Map<WorkspaceLeaf, HTMLElement> = new Map();
	charCountDebounceTimers: Map<WorkspaceLeaf, number> = new Map();
	cachedCSSTemplate: string = '';
	cssSettingsVersion: number = 0;
	leafStyleVersions: Map<WorkspaceLeaf, number> = new Map();
	pendingTimeUpdates: Map<string, { file: TFile; mode: string; seconds: number; dailySavedSeconds: number }> = new Map();
	pendingTimeSaveInFlight: Set<string> = new Set();
	lastTimeAccumAt: number = 0;
	timeTrackingRevision: number = 0;
	private nnMenuUnregisterFns: Array<() => void> = [];
	stopwatchSeconds: number = 0;
	stopwatchInterval: number | null = null;
	smartEnterCompartment = new Compartment();
	smartQuoteCompartment = new Compartment();
	typewriterCompartment = new Compartment();
	textSubstitutionCompartment = new Compartment();
	lastTypedAt: number = 0;
	lastSubstitution: { from: string; to: string; endPos: number } | null = null;
	zenState: 'off' | 'wide' | 'focus' = 'off';
	zenLeaf: WorkspaceLeaf | null = null;
	zenLeafEventRef: EventRef | null = null;
	musicPlayer: MusicPlayer | null = null;
	private readonly pagedEditorChangeListeners = new Set<(view: PagedWritingView) => void>();

	leafStyleManager: LeafStyleManager;
	toolbarManager: ToolbarManager;
	stopwatchManager: StopwatchManager;
	projectContext: ProjectContextService;
	mobileFonts: MobileFontManager;

	async onload() {
		initializeWritingDocuments(this);
		const runtimeWindow = window as WritingMenuRuntimeWindow;
		const previousInstance = runtimeWindow.__writingMenuPluginInstance;
		if (previousInstance && previousInstance !== this) previousInstance.unload();
		runtimeWindow.__writingMenuPluginInstance = this;

		try {
			await this.initialize();
		} catch (error) {
			if (runtimeWindow.__writingMenuPluginInstance === this) {
				delete runtimeWindow.__writingMenuPluginInstance;
			}
			this.unload();
			throw error;
		}
	}

	private async initialize() {
		await this.loadSettings();
		initializeManuscriptSnapshots(this);

		this.projectContext = new ProjectContextService(this);
		this.leafStyleManager = new LeafStyleManager(this);
		this.mobileFonts = new MobileFontManager(this, () => {
			this.regenerateCSSTemplate();
			this.updateAllLeafStyles();
		});
		this.register(() => this.mobileFonts.dispose());
		this.toolbarManager = new ToolbarManager(this);
		this.stopwatchManager = new StopwatchManager(this);
		const staleZenMode = activeDocument.body.classList.contains('wm-focus-mode')
			|| activeDocument.body.classList.contains('wm-wide-mode')
			|| activeDocument.body.classList.contains('wm-has-zen-leaf');
		if (staleZenMode) {
			this.leafStyleManager.exitZenFocus();
			if (activeDocument.fullscreenElement) void activeDocument.exitFullscreen().catch(() => {});
		}

		this.initStopwatch();

		this.charStore = new DailyCharStore(this);
		let initialMetadataRefreshDone = false;
		this.registerEvent(this.app.metadataCache.on('resolved', () => {
			if (initialMetadataRefreshDone) return;
			initialMetadataRefreshDone = true;
			void this.charStore.refreshDailyHistory().catch(() => {});
		}));

		this.musicPlayer = new MusicPlayer(this);
		this.app.workspace.onLayoutReady(() => {
			void this.charStore.init().catch(() => {});
			this.musicPlayer?.loadPlaylist().catch(() => {});
		});
		this.registerEvent(this.app.vault.on('modify', file => {
			if (file instanceof TFile) void this.charStore.onFileModify(file);
		}));

		if (Platform.isDesktop && Platform.isWin) {
			await this.ensureConverterScript();
		}

		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this.updateAllToolbars();
			// rAF ensures DOM (mod-visible class) is settled before checking preview mode
			window.requestAnimationFrame(() => this.updateAllLeafStyles());
		}));

		this.registerEvent(this.app.workspace.on('file-open', () => {
			this.updateAllToolbars();
			this.updateEditorExtensions();
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView?.leaf) {
				if (!this.shouldApplyToFile(activeView.file) && this.zenState !== 'off') this.leafStyleManager.applyZenState('off');
				this.updateLeafStyles(activeView.leaf);
				this.updateHrClasses(activeView.leaf);
			}
		}));

		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			if (leaf) {
				if ((leaf.view instanceof MarkdownView || leaf.view instanceof PagedWritingView)
					&& !this.shouldApplyToFile(leaf.view.file) && this.zenState !== 'off') this.leafStyleManager.applyZenState('off');
				if (!this.toolbarElements.has(leaf)) this.toolbarManager.addToolbarToLeaf(leaf);
				this.updateLeafStyles(leaf);
				this.updateHrClasses(leaf);
			}
		}));

		this.registerEvent(this.app.workspace.on('editor-change', () => {
			this.lastTypedAt = Date.now();
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView?.leaf) {
				this.updateCharCountDebounced(activeView.leaf);
			}
		}));

		this.registerEvent(this.app.workspace.on('editor-paste', (evt, editor) => {
			if (evt.defaultPrevented) return;
			const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
			if (!this.shouldApplyToFile(file)) return;

			const from = editor.getCursor('from');
			if (from.line !== 0 || from.ch !== 0) return;
			const pastedText = evt.clipboardData?.getData('text/plain');
			if (!pastedText) return;

			const timeKeys = [
				...(this.settings.timeModes ?? []).map(mode => mode.frontmatterKey),
				this.settings.timeTotalKey,
			];
			const sanitized = stripTrackedTimeFieldsFromPaste(pastedText, timeKeys);
			if (sanitized === pastedText) return;

			evt.preventDefault();
			editor.replaceSelection(sanitized);
			new Notice('붙여넣은 문서의 작업시간 메타데이터를 제외했습니다.');
		}));

		this.updateAllToolbars();
		this.updateAllLeafStyles();

		this.register(observeThemeMode(activeDocument, () => {
			this.regenerateCSSTemplate();
			this.updateAllLeafStyles();
		}));

		this.registerEditorExtension(createFocusExtension(this));
		this.registerEditorExtension(createSelectionExtension(this));
		this.registerEditorExtension(createHeadingLinkFixExtension(this));
		this.registerEditorExtension(repetitionHighlightExtension());
		this.registerEditorExtension(spellcheckHighlightExtension());
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

		this.app.workspace.onLayoutReady(() => {
			const note = getLatestReleaseNote();
			if (note && shouldShowWhatsNew(this.settings.lastSeenVersion, note.version)) {
				new WhatsNewModal(this.app, note, () => {
					this.settings.lastSeenVersion = note.version;
					void this.saveSettings();
				}).open();
			}
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && file.extension === 'md' && this.projectContext.getProjectForFile(file)) {
					if (Platform.isDesktop) {
						menu.addItem((item) => {
							item
								.setTitle('여러 쪽 보기로 열기')
								.setIcon('layout-grid')
								.onClick(() => { void this.openPagedWritingView(file); });
						});
						menu.addItem((item) => {
							item
								.setTitle('TXT로 내보내기')
								.setIcon('file-text')
								.onClick(() => {
									new TxtExportModal(this.app, this, file).open();
								});
						});
					}
					if (Platform.isDesktop && Platform.isWin) {
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
					if (Platform.isDesktop) {
						menu.addItem((item) => {
							item
								.setTitle('폴더를 TXT로 내보내기')
								.setIcon('folder-output')
								.onClick(() => {
									new BatchExportModal(this.app, this, file, 'txt').open();
								});
						});
					}

					if (Platform.isDesktop && Platform.isWin) {
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
					if (Platform.isDesktop) {
						menu.addItem((item) => {
							item
								.setTitle(`${mdFiles.length}개 파일을 TXT로 내보내기`)
								.setIcon('files')
								.onClick(() => {
									new BatchExportModal(this.app, this, mdFiles, 'txt').open();
								});
						});
					}

					if (Platform.isDesktop && Platform.isWin) {
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
			VIEW_TYPE_CALENDAR,
			(leaf) => new CalendarView(leaf, this)
		);

		this.registerView(
			MUSIC_LIBRARY_VIEW_TYPE,
			(leaf) => new MusicLibraryView(leaf, this)
		);

		this.registerView(
			PLOT_WORKBOOK_VIEW_TYPE,
			(leaf) => new PlotWorkbookView(leaf, this)
		);
		this.registerView(PLOT_WORKBOOK_SIDEBAR_TYPE, leaf => new PlotWorkbookSidebarView(leaf, this));
		this.registerView(
			LEGACY_PLOT_VIEW_TYPE,
			(leaf) => new LegacyPlotViewRedirect(leaf, LEGACY_PLOT_VIEW_TYPE),
		);
		this.registerView(
			LEGACY_PLOT_TIMELINE_VIEW_TYPE,
			(leaf) => new LegacyPlotViewRedirect(leaf, LEGACY_PLOT_TIMELINE_VIEW_TYPE),
		);
		this.app.workspace.onLayoutReady(() => { void this.migrateLegacyPlotViews(); });

		this.addCommand({ id: 'snapshot-manager', icon: 'camera', name: '스냅샷 관리', checkCallback: checking => {
			if (!snapshotTarget(this)) return false;
			if (!checking) openSnapshotManager(this);
			return true;
		} });

		this.registerView(
			PAGED_WRITING_VIEW_TYPE,
			(leaf) => new PagedWritingView(leaf, this)
		);

		this.addCommand({
			id: 'open-paged-writing-view',
			icon: 'files',
			name: '여러 쪽 보기',
			checkCallback: (checking) => {
				if (!Platform.isDesktop) return false;
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md' || !this.projectContext.getProjectForFile(file)) return false;
				if (!checking) void this.openPagedWritingView(file);
				return true;
			},
		});

		this.addCommand({
			id: 'toggle-plot-manager',
			icon: 'table-2',
			name: '플롯 매니저',
			callback: () => { void this.togglePlotWorkbookView(); }
		});
		this.addCommand({
			id: 'open-plot-manager-sidebar',
			icon: 'panel-right',
			name: '플롯 매니저 사이드바',
			callback: () => { void this.openPlotWorkbookSidebar(); },
		});

		this.addCommand({
			id: 'toggle-dashboard-view',
			icon: 'layout-dashboard',
			name: '대시보드',
			callback: () => this.toggleCalendarView(),
		});

		this.addRibbonIcon('layout-dashboard', '대시보드', () => this.toggleCalendarView());

		this.addCommand({
			id: 'copy-without-excluded',
			icon: 'copy',
			name: '복사하기',
			callback: async () => {
				const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? this.app.workspace.getActiveViewOfType(PagedWritingView)?.leaf;
				if (activeLeaf?.view instanceof MarkdownView || activeLeaf?.view instanceof PagedWritingView) {
					await this.copyWithOptions(activeLeaf);
				}
			}
		});

		this.addCommand({
			id: 'run-spell-check',
			icon: 'spell-check',
			name: '맞춤법 검사',
			checkCallback: checking => {
				const editor = this.getActiveWritingEditor();
				if (!editor) return false;
				if (!checking) new SpellCheckerService().run(editor, this).catch(() => {});
				return true;
			},
		});

		this.addCommand({
			id: 'zen-wide-mode',
			icon: 'move-horizontal',
			name: '길게 보기',
			callback: () => { this.toggleZenMode('wide'); },
		});

		this.addCommand({
			id: 'zen-focus-mode',
			icon: 'focus',
			name: '집중 모드',
			callback: () => { this.toggleZenMode('focus'); },
		});

		this.addCommand({
			id: 'hanja-convert',
			icon: 'book-open',
			name: '국어사전',
			callback: () => openDictionary(this, this.getActiveWritingEditor()),
		});

		this.addCommand({
			id: 'special-chars',
			icon: 'omega',
			name: '특수문자',
			callback: () => openSpecialChars(this, this.getActiveWritingEditor()),
		});

		this.addCommand({
			id: 'wiki-folder-picker',
			icon: 'notebook-tabs',
			name: '노트를 위키에서 보기',
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
				if (Platform.isDesktop) {
					ctx.addItem(item => item
						.setTitle(`${mdFiles.length}개 파일을 TXT로 내보내기`)
						.setIcon('files')
						.onClick(() => new BatchExportModal(this.app, this, mdFiles, 'txt').open()));
				}
				if (Platform.isDesktop && Platform.isWin) {
					ctx.addItem(item => item
						.setTitle(`${mdFiles.length}개 파일을 HWP로 내보내기`)
						.setIcon('files')
						.onClick(() => new BatchExportModal(this.app, this, mdFiles, 'hwp').open()));
				}
			} else if (ctx.file.extension === 'md') {
				if (Platform.isDesktop) {
					ctx.addItem(item => item
						.setTitle('TXT로 내보내기')
						.setIcon('file-text')
						.onClick(() => new TxtExportModal(this.app, this, ctx.file).open()));
				}
				if (Platform.isDesktop && Platform.isWin) {
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
			if (Platform.isDesktop) {
				ctx.addItem(item => item
					.setTitle('폴더를 TXT로 내보내기')
					.setIcon('folder-output')
					.onClick(() => new BatchExportModal(this.app, this, ctx.folder, 'txt').open()));
			}
			if (Platform.isDesktop && Platform.isWin) {
				ctx.addItem(item => item
					.setTitle('폴더를 HWP로 내보내기')
					.setIcon('folder-output')
					.onClick(() => new BatchExportModal(this.app, this, ctx.folder, 'hwp').open()));
			}
		});

		if (typeof unregFile === 'function') this.nnMenuUnregisterFns.push(unregFile as () => void);
		if (typeof unregFolder === 'function') this.nnMenuUnregisterFns.push(unregFolder as () => void);
	}


	async openPlotManagerInNewTab() {
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: PLOT_WORKBOOK_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	async openPlotWorkbookSidebar(state: { projectId?: string; sheetId?: string; columnId?: string; rowId?: string } = {}): Promise<void> {
		const leaf = this.app.workspace.getLeavesOfType(PLOT_WORKBOOK_SIDEBAR_TYPE)[0] ?? this.app.workspace.getRightLeaf(true);
		if (!leaf) return;
		await leaf.setViewState({ type: PLOT_WORKBOOK_SIDEBAR_TYPE, state, active:true });
		await this.app.workspace.revealLeaf(leaf);
	}

	async openPlotWorkbookCell(projectId: string, sheetId: string, rowId?: string, columnId?: string): Promise<void> {
		const leaf = this.app.workspace.getLeavesOfType(PLOT_WORKBOOK_VIEW_TYPE)
			.find(candidate => candidate.view instanceof PlotWorkbookView && candidate.view.getState().projectId === projectId)
			?? this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type:PLOT_WORKBOOK_VIEW_TYPE, state:{projectId}, active:true });
		await this.app.workspace.revealLeaf(leaf);
		if (rowId && columnId && leaf.view instanceof PlotWorkbookView) await leaf.view.revealCell(sheetId, rowId, columnId);
	}

	private async migrateLegacyPlotViews(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType(LEGACY_PLOT_VIEW_TYPE)) {
			await leaf.setViewState({ type: PLOT_WORKBOOK_VIEW_TYPE, active: false });
		}
		this.app.workspace.getLeavesOfType(LEGACY_PLOT_TIMELINE_VIEW_TYPE).forEach(leaf => leaf.detach());
	}

	async togglePlotWorkbookView() {
		const leaves = this.app.workspace.getLeavesOfType(PLOT_WORKBOOK_VIEW_TYPE);
		if (leaves.length > 0) {
			await this.app.workspace.revealLeaf(leaves[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: PLOT_WORKBOOK_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	async openPagedWritingView(file: TFile) {
		if (!Platform.isDesktop || !this.projectContext.getProjectForFile(file)) return;
		const existing = this.app.workspace.getLeavesOfType(PAGED_WRITING_VIEW_TYPE)
			.find(leaf => leaf.view instanceof PagedWritingView && leaf.view.file?.path === file.path);
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}

		const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
		const leaf = activeLeaf?.view instanceof MarkdownView && activeLeaf.view.file?.path === file.path
			? activeLeaf
			: this.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: PAGED_WRITING_VIEW_TYPE,
			state: { file: file.path },
			active: true,
		});
		await this.app.workspace.revealLeaf(leaf);
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

	async openFileInWiki(
		file: import('obsidian').TFile,
		target: 'tab' | 'current' | 'sidebar' = 'sidebar',
	) {
		const leaf = target === 'sidebar'
			? this.app.workspace.getRightLeaf(false)
			: target === 'tab'
				? this.app.workspace.getLeaf('tab')
				: (this.app.workspace.getLeaf(false));
		if (!leaf) return;
		if (leaf.view.getViewType() !== VIEW_TYPE_CALENDAR) {
			await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
		if (leaf.view instanceof CalendarView) leaf.view.openFileInWiki(file);
	}

	async openMusicLibrarySidebar() {
		const existing = this.app.workspace.getLeavesOfType(MUSIC_LIBRARY_VIEW_TYPE);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getLeftLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: MUSIC_LIBRARY_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	onunload(): void {
		const runtimeWindow = window as WritingMenuRuntimeWindow;
		if (runtimeWindow.__writingMenuPluginInstance === this) {
			delete runtimeWindow.__writingMenuPluginInstance;
		}
		this.stopwatchManager?.destroy();
		this.toolbarManager?.destroy();
		this.charStore?.destroy();
		this.musicPlayer?.destroy();
		this.musicPlayer = null;
		disposePlotWorkbookSessions(this);

		for (const unregister of this.nnMenuUnregisterFns) {
			try { unregister(); } catch { /* intentional */ }
		}
		this.nnMenuUnregisterFns = [];

		this.charCountDebounceTimers.forEach((timer) => window.clearTimeout(timer));
		this.charCountDebounceTimers.clear();
		this.toolbarElements.forEach((toolbar) => toolbar.remove());
		this.toolbarElements.clear();
		this.charCountElements.clear();
		this.pagedEditorChangeListeners.clear();
		this.leafStyleVersions.forEach((_, leaf) => {
			if (leaf.view instanceof MarkdownView || leaf.view instanceof PagedWritingView) {
				leaf.view.containerEl.removeAttribute('data-writing-menu-id');
			}
		});
		this.leafStyleVersions.clear();

		activeDocument.body.classList.remove('writing-menu-focus-enabled');
		activeDocument.body.classList.remove('writing-menu-typewriter-active');
		activeDocument.body.classList.remove('wm-focus-mode');
		activeDocument.body.classList.remove('wm-wide-mode');
		activeDocument.body.classList.remove('wm-hr-custom', 'wm-hr-svg');
		activeDocument.body.style.removeProperty('--writing-menu-focus-opacity');
		this.clearZenLeaf();
		if (this.zenLeafEventRef) {
			this.app.workspace.offref(this.zenLeafEventRef);
			this.zenLeafEventRef = null;
		}
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


	async loadSettings() {
		const savedData = (await this.loadData() ?? {}) as Partial<WritingMenuSettings> & { showTimeInStatusBar?: boolean };
		const legacyTrackingFolder = takeLegacyTrackingFolder(savedData);
		const dashboardSettingsMigrated = migrateDashboardSettings(savedData);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);
		const obsoleteSettings = this.settings as unknown as Record<string, unknown>;
		const currentTheme = activeDocument.body.classList.contains('theme-dark') ? 'dark' : 'light';
		for (const key of ['pagedLastTextColor', 'pagedLastBackgroundColor'] as const) {
			const value = obsoleteSettings[key];
			if (typeof value === 'string') continue;
			if (value && typeof value === 'object' && !Array.isArray(value)) {
				const candidate = (value as Record<string, unknown>)[currentTheme];
				obsoleteSettings[key] = typeof candidate === 'string' ? candidate : '';
			} else obsoleteSettings[key] = '';
		}
		delete obsoleteSettings.calendarPreviewItems;
		delete obsoleteSettings.timeAvgFolderLevel;
		delete obsoleteSettings.plotCharFolder;
		delete obsoleteSettings.plotCharNoteTemplate;
		delete obsoleteSettings.plotHiddenCharIds;
		delete obsoleteSettings.plotCharNoteOpenMode;
		delete obsoleteSettings.plotLinkOpenMode;
		delete obsoleteSettings.plotSortPageSize;
		delete obsoleteSettings.plotCellWidth;
		delete obsoleteSettings.wikiDefaultGroupField;
		delete obsoleteSettings.enableStopwatchAlarm;
		if (savedData.showMunpiaWidget === undefined && savedData.showNovelpiaWidget === undefined) {
			this.settings.showMunpiaWidget = this.settings.charCountMode !== 'novelpia';
			this.settings.showNovelpiaWidget = this.settings.charCountMode === 'novelpia';
		}
		if (savedData.showTimerWidget === undefined) {
			this.settings.showTimerWidget = savedData.showTimeInStatusBar === true;
		}
		const widgetOrder = this.settings.writingWidgetOrder ?? [];
		this.settings.writingWidgetOrder = ['munpia', 'novelpia', 'timer']
			.filter(id => widgetOrder.includes(id as 'munpia' | 'novelpia' | 'timer'))
			.concat(['munpia', 'novelpia', 'timer'].filter(id => !widgetOrder.includes(id as 'munpia' | 'novelpia' | 'timer'))) as WritingMenuSettings['writingWidgetOrder'];
		delete savedData.showTimeInStatusBar;
		delete (this.settings as WritingMenuSettings & { showTimeInStatusBar?: boolean }).showTimeInStatusBar;
		const legacyAiSettings = this.settings as WritingMenuSettings & {
			aiChatCerebrasApiKey?: string;
			zenWideEnabled?: boolean;
			zenFocusEnabled?: boolean;
		};
		let aiSettingsMigrated = false;
		if (legacyAiSettings.zenWideEnabled !== undefined) {
			delete legacyAiSettings.zenWideEnabled;
			aiSettingsMigrated = true;
		}
		if (legacyAiSettings.zenFocusEnabled !== undefined) {
			delete legacyAiSettings.zenFocusEnabled;
			aiSettingsMigrated = true;
		}
		if (legacyAiSettings.aiChatCerebrasApiKey !== undefined) {
			delete legacyAiSettings.aiChatCerebrasApiKey;
			aiSettingsMigrated = true;
		}
		if (this.settings.aiChatModel === 'gemma-4-31b') {
			this.settings.aiChatModel = 'gemma-4-31b-it';
			aiSettingsMigrated = true;
		} else if (this.settings.aiChatModel === 'google/diffusiongemma-26b-a4b-it') {
			this.settings.aiChatModel = 'gemini-3.8-flash';
			aiSettingsMigrated = true;
		}
		if (aiSettingsMigrated || dashboardSettingsMigrated) void this.saveSettings();
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

		let projectSettingsMigrated = false;
		this.settings.projects = Array.isArray(savedData.projects)
			? savedData.projects.map((project, index) => ({
				id: project.id || `project-${index + 1}`,
				name: project.name?.trim() || project.rootFolder?.split('/').pop() || `프로젝트 ${index + 1}`,
				rootFolder: normalizePath(project.rootFolder ?? '').replace(/^\/+|\/+$/g, ''),
				manuscriptFolder: normalizePath(project.manuscriptFolder ?? '').replace(/^\/+|\/+$/g, ''),
				characterFolder: normalizePath(project.characterFolder ?? '').replace(/^\/+|\/+$/g, ''),
				statisticsEnabled: project.statisticsEnabled !== false,
				statisticsFolders: Array.isArray(project.statisticsFolders) ? project.statisticsFolders : [],
				statisticsExcludeFolders: Array.isArray(project.statisticsExcludeFolders) ? project.statisticsExcludeFolders : [],
			}))
			: [];

		if (this.settings.projects.length === 0 && legacyTrackingFolder.trim()) {
			const rootFolder = normalizePath(legacyTrackingFolder).replace(/^\/+|\/+$/g, '');
			this.settings.projects.push({
				id: 'legacy-tracking-project',
				name: rootFolder.split('/').pop() || '프로젝트',
				rootFolder,
				manuscriptFolder: '',
				characterFolder: '',
				statisticsEnabled: true,
				statisticsFolders: [],
				statisticsExcludeFolders: [...(this.settings.timeExcludeFolders ?? [])],
			});
			projectSettingsMigrated = true;
		}
		if (savedData.restrictStatisticsToProjects === undefined) {
			this.settings.restrictStatisticsToProjects = true;
			projectSettingsMigrated = true;
		}
		if (projectSettingsMigrated) void this.saveSettings();

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

		// MAIN에는 이동 가능한 다섯 개 대시보드 섹션만 유지한다.
		if (this.settings.dashboardSections) {
			const labels = { calendar: '일정', chars: '글자수', timer: '타이머', time: '작업 시간', music: '음악' } as const;
			const allowed = new Set(Object.keys(labels));
			const migrated = this.settings.dashboardSections
				.map(section => section.id === 'tasks' ? { ...section, id: 'calendar' as const, label: labels.calendar } : section)
				.filter(section => allowed.has(section.id));
			const seen = new Set<string>();
			this.settings.dashboardSections = migrated.filter(section => {
				if (seen.has(section.id)) return false;
				seen.add(section.id);
				return true;
			});
			const defaults: Array<keyof typeof labels> = ['calendar', 'timer', 'chars', 'time', 'music'];
			for (const id of defaults) {
				if (seen.has(id)) continue;
				const section = { id, label: labels[id], visible: true };
				if (id === 'timer') {
					const calendarIndex = this.settings.dashboardSections.findIndex(item => item.id === 'calendar');
					this.settings.dashboardSections.splice(calendarIndex >= 0 ? calendarIndex + 1 : 0, 0, section);
				} else {
					this.settings.dashboardSections.push(section);
				}
				seen.add(id);
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.regenerateCSSTemplate();
		this.updateEditorExtensions();
		this.updateAllLeafStyles();
		this.updateDynamicStyles();
		this.toolbarManager.updateAllToolbars();
		this.toolbarManager.refreshAllToolbars();
	}

	async refreshDashboardView() {
		const { VIEW_TYPE_CALENDAR: VTC } = await import('./src/calendar/views/CalendarView');
		this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			if (leaf.view.getViewType() === VTC) {
				(leaf.view as unknown as { render?: () => void }).render?.();
			}
		});
	}

	getActiveWritingEditor(): Editor | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.app.workspace.getActiveViewOfType(PagedWritingView);
		if ((view instanceof MarkdownView || view instanceof PagedWritingView) && !this.shouldApplyToFile(view.file)) return null;
		if (view instanceof MarkdownView) return view.editor;
		if (view instanceof PagedWritingView) return view.getEditorAdapter();
		return null;
	}

	notifyPagedEditorChanged(view: PagedWritingView): void {
		this.lastTypedAt = Date.now();
		this.updateCharCountDebounced(view.leaf);
		for (const listener of this.pagedEditorChangeListeners) listener(view);
	}

	onPagedEditorChange(listener: (view: PagedWritingView) => void): () => void {
		this.pagedEditorChangeListeners.add(listener);
		return () => this.pagedEditorChangeListeners.delete(listener);
	}

	// ── LeafStyleManager wrappers ──
	shouldApplyToFile(file: { path: string } | null): boolean { return this.leafStyleManager.shouldApplyToFile(file); }
	calculateCharCount(text: string): number { return this.leafStyleManager.calculateCharCount(text); }
	calculateAllCharCounts(text: string, path?: string): { munpia: number; novelpia: number } {
		return this.leafStyleManager.calculateAllCharCounts(text, path);
	}
	formatCharCount(count: number): string { return this.leafStyleManager.formatCharCount(count); }
	updateCharCount(leaf: WorkspaceLeaf) { this.leafStyleManager.updateCharCount(leaf); }
	updateCharCountDebounced(leaf: WorkspaceLeaf) { this.leafStyleManager.updateCharCountDebounced(leaf); }
	updateDynamicStyles() { this.leafStyleManager.updateDynamicStyles(); }
	regenerateCSSTemplate() { this.leafStyleManager.regenerateCSSTemplate(); }
	updateLeafStyles(leaf: WorkspaceLeaf, force: boolean = false) { this.leafStyleManager.updateLeafStyles(leaf, force); }
	updateHrClasses(leaf: WorkspaceLeaf | null) { this.leafStyleManager.updateHrClasses(leaf); }
	updateAllLeafStyles() { this.leafStyleManager.updateAllLeafStyles(); }
	applyZenState(state: 'off' | 'wide' | 'focus') { this.leafStyleManager.applyZenState(state); }
	exitZenFocus() { this.leafStyleManager.exitZenFocus(); }
	activateFocusMode() { this.leafStyleManager.activateFocusMode(); }
	toggleZenMode(mode: 'wide' | 'focus', leaf?: WorkspaceLeaf) { this.leafStyleManager.toggleZenMode(mode, leaf); }
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
	playAlarm() { this.stopwatchManager.playAlarm(); }

	// ── ToolbarManager wrappers ──
	updateAllToolbars() { this.toolbarManager.updateAllToolbars(); }
	addToolbarToLeaf(leaf: WorkspaceLeaf) { this.toolbarManager.addToolbarToLeaf(leaf); }
	showDropdown(button: HTMLElement, leaf: WorkspaceLeaf) { this.toolbarManager.showDropdown(button, leaf); }
	buildDropdownMenu(container: HTMLElement, leaf: WorkspaceLeaf) { this.toolbarManager.buildDropdownMenu(container, leaf); }
	renderMenuPage(container: HTMLElement, page: string, leaf: WorkspaceLeaf) { this.toolbarManager.renderMenuPage(container, page, leaf); }
	addMenuNavCard(container: HTMLElement, title: string, icon: string, onClick: () => void) { this.toolbarManager.addMenuNavCard(container, title, icon, onClick); }
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

	openSettings(page?: string) {
		interface AppWithSettings extends App { setting?: { open(): void; openTabById(id: string): void } }
		(this.app as AppWithSettings).setting?.open();
		(this.app as AppWithSettings).setting?.openTabById(this.manifest.id);
		if (page) this.settingTab?.renderPage(page);
	}

}
