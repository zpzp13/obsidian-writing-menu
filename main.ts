import { App, Plugin, MarkdownView, WorkspaceLeaf, setIcon, TFile, TFolder, TAbstractFile, Notice, Platform, EventRef, sanitizeHTMLToDom, MenuItem } from 'obsidian';
import { EditorView, ViewPlugin, Decoration, DecorationSet, ViewUpdate } from '@codemirror/view';
import { Extension, EditorState, ChangeSpec, RangeSetBuilder, Prec, Compartment, Transaction } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { SymbolSuggester } from './SymbolSuggester';
import { WritingMenuSettings, DEFAULT_SETTINGS } from './src/types';
import { MobilePreviewFloating } from './src/preview';
import { HeadingRawWidget } from './src/editor/HeadingRawWidget';
import { TimeTrackingView, TIME_TRACKING_VIEW_TYPE } from './src/views/TimeTrackingView';
import { HwpExportModal, TxtExportModal, BatchExportModal } from './src/export';
import { WritingMenuSettingTab } from './src/settings';
import { ensureConverterScript, openFolderPicker, openTemplatePicker, runPicker, convertToHwp, getDefaultExportPath, cleanMarkdownFrontmatter, removeHeadings, copyWithOptions, applySpaceIndent, convertToTxt, convertFolderToTxt, convertFilesToTxt, convertFolderToHwp, convertFilesToHwp, convertFolderToTxtMerged, convertFilesToTxtMerged, convertFolderToHwpMerged, convertFilesToHwpMerged } from './src/export/converterMethods';
import { addCompactControl, addCompactToggle, addCompactStepper, addCompactSlider, addDualColorControl } from './src/ui/controls';
import { openDictionary } from './src/dictionary';
import { CalendarView, VIEW_TYPE_CALENDAR } from './src/calendar/views/CalendarView';
import { MUNPIA_SVG, NOVELPIA_SVG } from './src/assets/platformLogos';
import { DailyCharStore } from './src/dashboard/data/DailyCharStore';
import { MusicPlayer } from './src/dashboard/MusicPlayer';

export default class WritingMenuPlugin extends Plugin {
	settings: WritingMenuSettings;
	mobilePreviewFloating: MobilePreviewFloating;
	charStore: DailyCharStore;
	settingTab: WritingMenuSettingTab | null = null;
	wikiPanelRerender: (() => void) | null = null;
	toolbarElements: Map<WorkspaceLeaf, HTMLElement> = new Map();
	private leafIdCounter: number = 0;
	charCountElements: Map<WorkspaceLeaf, HTMLElement> = new Map();
	headerCharCountElements: Map<WorkspaceLeaf, HTMLElement> = new Map();
	private charCountDebounceTimers: Map<WorkspaceLeaf, number> = new Map();
	private cachedCSSTemplate: string = '';
	private cssSettingsVersion: number = 0;
	private leafStyleVersions: Map<WorkspaceLeaf, number> = new Map();
	pendingTimeUpdates: Map<string, { file: TFile; mode: string; seconds: number }> = new Map();
	private nnMenuUnregisterFns: Array<() => void> = [];
	stopwatchSeconds: number = 0;
	stopwatchInterval: number | null = null;
	private stopwatchDisplayEl: HTMLElement | null = null;
	stopwatchDashboardEl: HTMLElement | null = null;
	stopwatchDashboardSegs: HTMLElement[] = [];
	smartEnterCompartment = new Compartment();
	smartQuoteCompartment = new Compartment();
	typewriterCompartment = new Compartment();
	textSubstitutionCompartment = new Compartment();
	private lastSubstitution: { from: string; to: string; endPos: number } | null = null;
	private zenState: 'off' | 'wide' | 'focus' = 'off';
	private zenLeaf: WorkspaceLeaf | null = null;
	private zenLeafEventRef: EventRef | null = null;
	private statusBarItemEl: HTMLElement | null = null;
	private statusBarTimeEl: HTMLElement | null = null;
	musicPlayer: MusicPlayer | null = null;

	async onload() {
		await this.loadSettings();
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

		this.registerEditorExtension(this.createFocusExtension());
		this.registerEditorExtension(this.createSelectionExtension());
		this.registerEditorExtension(this.createHeadingLinkFixExtension());
		this.registerEditorSuggest(new SymbolSuggester(this));

		this.registerEditorExtension(this.smartEnterCompartment.of(this.getSmartEnterExtension()));
		this.registerEditorExtension(this.smartQuoteCompartment.of(this.getSmartQuoteExtension()));
		this.registerEditorExtension(this.typewriterCompartment.of(this.getTypewriterExtension()));
		this.registerEditorExtension(this.textSubstitutionCompartment.of([
			this.getTextSubstitutionExtension(),
			this.getBackspaceUndoExtension()
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

		// 캘린더 뷰 등록
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
				// Fullscreen entered — apply focus CSS now (prevents pre-fullscreen flash)
				if (this.zenState === 'focus') this.activateFocusMode();
			} else {
				// Fullscreen exited (F4 exit or Escape key)
				// Check for wm-focus-mode class even if zenState is already 'off' (covers the F4 exit path)
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
		// showHoursWhenNeeded: 60분 이상일 때 시간 표시 (모드 시간용)
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

	initStopwatch() {
		this.stopwatchSeconds = this.settings.stopwatchMinutes * 60;
	}

	startStopwatch() {
		if (this.stopwatchInterval) return;

		if (this.stopwatchSeconds <= 0) {
			this.initStopwatch();
		}

		this.stopwatchInterval = window.setInterval(() => {
			this.stopwatchSeconds--;
			this.updateStopwatchDisplay();

			if (this.stopwatchSeconds <= 0) {
				this.stopStopwatch();
				if (this.settings.enableStopwatchAlarm) {
					this.playAlarm();
				}
				this.initStopwatch();
				this.updateStopwatchDisplay();
			}
		}, 1000);
	}

	stopStopwatch() {
		if (this.stopwatchInterval) {
			window.clearInterval(this.stopwatchInterval);
			this.stopwatchInterval = null;
		}
	}

	resetStopwatch() {
		this.stopStopwatch();
		this.initStopwatch();
		this.updateStopwatchDisplay();
	}

	updateStopwatchSegments() {
		if (!this.stopwatchDashboardSegs.length) return;
		const total = this.settings.stopwatchMinutes * 60;
		const elapsed = total - this.stopwatchSeconds;
		const pct = total > 0 ? elapsed / total : 0;
		const filled = Math.round(pct * this.stopwatchDashboardSegs.length);
		this.stopwatchDashboardSegs.forEach((seg, i) => {
			seg.toggleClass('is-filled', i < filled);
		});
	}

	updateStopwatchDisplay() {
		const formatted = this.formatTime(this.stopwatchSeconds);
		if (this.stopwatchDisplayEl) this.stopwatchDisplayEl.textContent = formatted;
		if (this.stopwatchDashboardEl) this.stopwatchDashboardEl.textContent = formatted;
		this.updateStopwatchSegments();
		this.updateStatusBarDisplay();
	}

	playAlarm() {
		const audioContext = new AudioContext();
		const oscillator = audioContext.createOscillator();
		const gainNode = audioContext.createGain();

		oscillator.connect(gainNode);
		gainNode.connect(audioContext.destination);

		switch (this.settings.stopwatchAlarmSound) {
			case 'bell':
				oscillator.frequency.value = 830;
				oscillator.type = 'sine';
				gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
				gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);
				oscillator.start(audioContext.currentTime);
				oscillator.stop(audioContext.currentTime + 1);
				break;
			case 'chime':
				oscillator.frequency.value = 523;
				oscillator.type = 'sine';
				gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
				gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
				oscillator.start(audioContext.currentTime);
				oscillator.stop(audioContext.currentTime + 0.5);
				window.setTimeout(() => {
					const osc2 = audioContext.createOscillator();
					const gain2 = audioContext.createGain();
					osc2.connect(gain2);
					gain2.connect(audioContext.destination);
					osc2.frequency.value = 659;
					osc2.type = 'sine';
					gain2.gain.setValueAtTime(0.2, audioContext.currentTime);
					gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
					osc2.start(audioContext.currentTime);
					osc2.stop(audioContext.currentTime + 0.5);
				}, 300);
				break;
			case 'beep':
				oscillator.frequency.value = 1000;
				oscillator.type = 'square';
				gainNode.gain.value = 0.1;
				oscillator.start(audioContext.currentTime);
				oscillator.stop(audioContext.currentTime + 0.2);
				window.setTimeout(() => {
					const osc2 = audioContext.createOscillator();
					const gain2 = audioContext.createGain();
					osc2.connect(gain2);
					gain2.connect(audioContext.destination);
					osc2.frequency.value = 1000;
					osc2.type = 'square';
					gain2.gain.value = 0.1;
					osc2.start(audioContext.currentTime);
					osc2.stop(audioContext.currentTime + 0.2);
				}, 300);
				break;
			case 'ding':
				oscillator.frequency.value = 1200;
				oscillator.type = 'sine';
				gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
				gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
				oscillator.start(audioContext.currentTime);
				oscillator.stop(audioContext.currentTime + 0.8);
				break;
			case 'gong':
				oscillator.frequency.value = 150;
				oscillator.type = 'sine';
				gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
				gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 2);
				oscillator.start(audioContext.currentTime);
				oscillator.stop(audioContext.currentTime + 2);
				break;
		}
	}

	// Dynamic Extension reconfiguration
	updateEditorExtensions() {
		this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
			const view = leaf.view as MarkdownView;
			if (view && view.editor) {
				// @ts-ignore
				const editorView = view.editor.cm as EditorView;
				if (editorView) {
					editorView.dispatch({
						effects: [
							this.smartEnterCompartment.reconfigure(this.getSmartEnterExtension()),
							this.smartQuoteCompartment.reconfigure(this.getSmartQuoteExtension()),
							this.typewriterCompartment.reconfigure(this.getTypewriterExtension()),
							this.textSubstitutionCompartment.reconfigure([
								this.getTextSubstitutionExtension(),
								this.getBackspaceUndoExtension()
							])
						]
					});
				}
			}
		});
	}

	getSmartEnterExtension(): Extension {
		if (!this.settings.enableSmartInput || !this.settings.enableSmartEnter) return [];
		return Prec.highest(keymap.of([{
			key: 'Enter',
			run: (view: EditorView) => {
				const state = view.state;
				const cursor = state.selection.main.head;
				if (cursor === 0 || cursor >= state.doc.length) return false;

				// Default pairs with proper unicode escapes
				const defaultPairs = [
					'()', '[]', '{}', '<>', '""', "''",
					'\u201C\u201D', '\u2018\u2019',  // "" ''
					'\u300C\u300D', '\u300E\u300F',  // 「」『』
					'\u3010\u3011', '\u300A\u300B'   // 【】《》
				];

				// Use settings if available, otherwise use defaults
				const settingsPairs = this.settings.smartEnterPairs || [];

				// Add dynamic pairs from symbolTriggers
				const dynamicPairs: string[] = [];
				if (this.settings.symbolTriggers) {
					this.settings.symbolTriggers.forEach(trigger => {
						if (trigger.enabled !== false && trigger.options) {
							trigger.options.forEach(opt => {
								if (opt.open && opt.close) {
									dynamicPairs.push(opt.open + opt.close);
								}
							});
						}
					});
				}

				const allPairs = Array.from(new Set([...defaultPairs, ...settingsPairs, ...dynamicPairs]));

				for (const pair of allPairs) {
					// Handle pairs of any length (some brackets are multi-byte)
					const mid = Math.floor(pair.length / 2);
					const openBracket = pair.slice(0, mid);
					const closeBracket = pair.slice(mid);

					if (openBracket && closeBracket) {
						const afterCursor = state.doc.sliceString(cursor, cursor + closeBracket.length);

						// Trigger when cursor is right before closing bracket
						if (afterCursor === closeBracket) {
							const lineText = state.doc.lineAt(cursor).text;
							const currentIndent = lineText.match(/^\s*/)?.[0] || '';

							// Insert newline AFTER the closing bracket, keep brackets in place
							const insertPos = cursor + closeBracket.length;
							const tx = state.update({
								changes: { from: insertPos, insert: `\n${currentIndent}` },
								selection: { anchor: insertPos + 1 + currentIndent.length },
								userEvent: "input.enter"
							});
							view.dispatch(tx);
							return true;
						}
					}
				}
				return false;
			}
		}]));
	}

	getSmartQuoteExtension(): Extension {
		if (!this.settings.enableSmartQuotes) return [];
		return EditorState.transactionFilter.of((tr) => {
			if (!tr.isUserEvent("input.type") || !tr.docChanged) return tr;

			const changes: ChangeSpec[] = [];
			const replacements: Record<string, { open: string, close: string }> = {
				'"': { open: '\u201C', close: '\u201D' },
				"'": { open: '\u2018', close: '\u2019' }
			};

			tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
				const text = inserted.sliceString(0);

				// For paired quotes (Obsidian auto-pair), convert both - check FIRST
				if (text === '""') {
					changes.push({ from: fromA, to: toA, insert: '\u201C\u201D' });
					return;
				}
				if (text === "''") {
					changes.push({ from: fromA, to: toA, insert: '\u2018\u2019' });
					return;
				}

				// For single quote
				const rule = replacements[text];
				if (!rule) return;

				// Get context from ORIGINAL doc (before insertion)
				const context = tr.startState.doc.sliceString(Math.max(0, fromA - 1), fromA);
				// Opening quote: at start, after space, or after opening brackets/quotes
				const isOpening = fromA === 0 || /[\s([{<]$/.test(context);

				const replacement = isOpening ? rule.open : rule.close;
				changes.push({ from: fromA, to: toA, insert: replacement });
			});

			if (changes.length > 0) {
				// Replace original transaction instead of appending
				return {
					changes,
					selection: tr.newSelection,
					scrollIntoView: tr.scrollIntoView
				};
			}
			return tr;
		});
	}

	getTypewriterExtension(): Extension {
		if (!this.settings.enableTypewriterScrolling) return [];
		return ViewPlugin.fromClass(class {
			constructor(public view: EditorView) { }
			update(update: ViewUpdate) {
				// Only center if text was changed by user interaction (typing/deleting)
				// avoiding scroll on simple cursor movement or click
				const isUserInput = update.transactions.some((tr: Transaction) => tr.isUserEvent("input") || tr.isUserEvent("delete"));
				if (update.docChanged && isUserInput) {
					this.centerCursor(update.view);
				}
			}
			centerCursor(view: EditorView) {
				if (!view) return;
				const state = view.state;
				const ranges = state.selection.ranges;
				if (!ranges.length || !ranges[0].empty) return;
				const head = ranges[0].head;
				view.requestMeasure({
					read: (view) => {
						const cursorCoords = view.coordsAtPos(head);
						if (!cursorCoords) return null;
						const scroller = view.scrollDOM;
						const scrollerRect = scroller.getBoundingClientRect();
						const centerY = scrollerRect.top + scrollerRect.height / 2;
						const diff = cursorCoords.top - centerY;
						return { diff, scroller };
					},
					write: (measure, view) => {
						if (!measure) return;
						const { diff, scroller } = measure;
						if (Math.abs(diff) > 10) {
							scroller.scrollTo({ top: scroller.scrollTop + diff, behavior: 'auto' });
						}
					}
				});
			}
		});
	}

	getTextSubstitutionExtension(): Extension {
		if (!this.settings.enableSmartInput || !this.settings.enableTextSubstitution) return [];

		const enabledSubs = this.settings.textSubstitutions.filter(s => s.enabled && s.from && s.to);
		if (enabledSubs.length === 0) return [];

		// Pre-sort and cache (longest match first)
		const sortedSubs = enabledSubs.sort((a, b) => b.from.length - a.from.length);
		const maxLength = sortedSubs[0].from.length;

		return EditorView.inputHandler.of((view, from, to, text) => {
			if (text.length !== 1) return false;

			const start = Math.max(0, to - maxLength + 1);
			const recentText = view.state.doc.sliceString(start, to) + text;

			const match = sortedSubs.find(s => recentText.endsWith(s.from));
			if (!match) return false;

			const replaceFrom = to - match.from.length + 1;
			view.dispatch({
				changes: { from: replaceFrom, to, insert: match.to },
				selection: { anchor: replaceFrom + match.to.length }
			});

			this.lastSubstitution = {
				from: match.from,
				to: match.to,
				endPos: replaceFrom + match.to.length
			};

			return true;
		});
	}

	getBackspaceUndoExtension(): Extension {
		if (!this.settings.enableSmartInput || !this.settings.enableTextSubstitution) return [];

		return EditorView.updateListener.of((update) => {
			// Check for backspace
			const isBackspace = update.transactions.some(tr => tr.isUserEvent("delete.backward"));
			if (!isBackspace || !this.lastSubstitution) return;

			const cursor = update.state.selection.main.head;
			const sub = this.lastSubstitution;

			// Only undo if cursor is at the end of substitution
			if (cursor !== sub.endPos - 1) {
				this.lastSubstitution = null;
				return;
			}

			// Revert: replace 'to' back to 'from'
			const revertFrom = cursor - sub.to.length + 1;
			const revertTo = cursor;

			update.view.dispatch({
				changes: { from: revertFrom, to: revertTo, insert: sub.from },
				selection: { anchor: revertFrom + sub.from.length }
			});

			this.lastSubstitution = null;
		});
	}

	shouldApplyToFile(file: TFile | null): boolean {
		if (!file) return false;
		if (!this.settings.applyToFolder) return true;
		const folderName = this.settings.applyToFolder.trim().toLowerCase();
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
		const newId = `wm-leaf-${this.leafIdCounter++}`;
		leaf.view.containerEl.setAttribute('data-writing-menu-id', newId);
		return newId;
	}

	private resolveThemeColor(color: string | { light: string; dark: string }): string {
		if (typeof color === 'string') return color;
		const theme = activeDocument.body.classList.contains('theme-dark') ? 'dark' : 'light';
		return color[theme] || color.light || 'inherit';
	}

	private calculateCharCount(text: string): number {
		const withoutFrontmatter = this.cleanMarkdownFrontmatter(text);
		const lines = withoutFrontmatter.split('\n')
			.filter(l => !l.trim().match(/^#{1,6}\s/))      // 헤딩 제외
			.filter(l => !l.trim().match(/^\[\^[^\]]+\]:/)) // 각주 정의 제외
			.map(l => l.replace(/\[\^[^\]]+\]/g, ''))       // 인라인 각주 참조 제외
			.map(l => l.trim())
			.filter(l => l);
		const base = lines.join('');

		if (this.settings.charCountMode === 'novelpia') {
			// 노벨피아: 공백 제거 + 구두점(.,!?) 제거 + 일반따옴표("') 제거 + 특수공백 제거
			// 둥근 따옴표("" '')는 특수문자로 취급하여 포함
			return base.replace(/ /g, '').replace(/[.,!?"']/g, '').replace(/[\s\u00A0]/g, '').length;
		} else {
			// 문피아: 기본 + 말줄임표(…)를 3자로 계산
			const ellipsisCount = (base.match(/…/g) || []).length;
			return base.length + (ellipsisCount * 2);
		}
	}

	private formatCharCount(count: number): string {
		return count.toLocaleString('ko-KR') + ' 자';
	}

	private updateCharCount(leaf: WorkspaceLeaf) {
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
			const charCountEl = this.charCountElements.get(leaf);
			if (charCountEl) charCountEl.textContent = displayText;
			const headerCharCountEl = this.headerCharCountElements.get(leaf);
			if (headerCharCountEl) headerCharCountEl.textContent = displayText;
		} catch {
			// Silently ignore errors during char count update
		}
	}

	private updateCharCountDebounced(leaf: WorkspaceLeaf) {
		if (!leaf) return;
		const existingTimer = this.charCountDebounceTimers.get(leaf);
		if (existingTimer) window.clearTimeout(existingTimer);
		const timer = window.setTimeout(() => {
			this.updateCharCount(leaf);
			this.charCountDebounceTimers.delete(leaf);
		}, 150);
		this.charCountDebounceTimers.set(leaf, timer);
	}

	private createHeadingLinkFixExtension() {
		return Prec.highest(ViewPlugin.fromClass(class {
			decorations: DecorationSet;
			constructor(view: EditorView) { this.decorations = this.build(view); }
			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = this.build(update.view);
				}
			}
			build(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();
				for (const { from, to } of view.visibleRanges) {
					const fl = view.state.doc.lineAt(from).number;
					const tl = view.state.doc.lineAt(Math.min(to, view.state.doc.length)).number;
					for (let i = fl; i <= tl; i++) {
						const line = view.state.doc.line(i);
						if (!/^#{1,6}\s/.test(line.text)) continue;
						const re = /\[([^\]]*)\]\s?\[([^\]]*)\]/g;
						let m;
						while ((m = re.exec(line.text)) !== null) {
							const mFrom = line.from + m.index;
							const mTo = mFrom + m[0].length;
							builder.add(mFrom, mTo, Decoration.replace({
								widget: new HeadingRawWidget(m[0])
							}));
						}
					}
				}
				return builder.finish();
			}
		}, { decorations: (v: { decorations: DecorationSet }) => v.decorations }));
	}

	private createSelectionExtension() {
		let lastSelectionLength = 0;
		return EditorView.updateListener.of((update) => {
			if (!update.selectionSet) return;
			const selection = update.state.selection.main;
			const currentLength = selection.to - selection.from;
			if (currentLength === lastSelectionLength && currentLength === 0) return;
			lastSelectionLength = currentLength;
			if (currentLength > 0 || lastSelectionLength > 0) {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView?.leaf) {
					this.updateCharCountDebounced(activeView.leaf);
				}
			}
		});
	}

	private createFocusExtension() {
		const pluginSettings = this.settings;
		return ViewPlugin.fromClass(class {
			decorations: DecorationSet;
			lastCursorLine: number = -1;
			lastDocLength: number = 0;
			constructor(_view: EditorView) { this.decorations = Decoration.none; }
			update(update: ViewUpdate) {
				if (!pluginSettings.enableFocusMode) {
					if (this.decorations !== Decoration.none) {
						this.decorations = Decoration.none;
						this.lastCursorLine = -1;
					}
					return;
				}

				const isUserInput = update.transactions.some((tr: Transaction) =>
					tr.isUserEvent("input") || tr.isUserEvent("delete")
				);

				if (isUserInput && update.docChanged) {
					const cursorLine = update.view.state.doc.lineAt(update.view.state.selection.main.head).number;
					const docLength = update.view.state.doc.length;
					// Skip rebuild only if cursor on same line AND doc length unchanged
					if (cursorLine === this.lastCursorLine && docLength === this.lastDocLength && this.decorations !== Decoration.none) {
						return;
					}
					this.decorations = this.buildDecorations(update.view);
					this.lastCursorLine = cursorLine;
					this.lastDocLength = docLength;
				} else if (update.selectionSet && !update.docChanged) {
					this.decorations = Decoration.none;
					this.lastCursorLine = -1;
				}
			}
			buildDecorations(view: EditorView): DecorationSet {
				if (!pluginSettings.enableFocusMode || !view.state.selection.main.empty) return Decoration.none;
				const builder = new RangeSetBuilder<Decoration>();
				const dimmedLine = Decoration.line({ class: 'writing-menu-dimmed-line' });
				const cursorLine = view.state.doc.lineAt(view.state.selection.main.head);
				for (const { from, to } of view.visibleRanges) {
					let pos = from;
					while (pos <= to) {
						const line = view.state.doc.lineAt(pos);
						if (line.number !== cursorLine.number) builder.add(line.from, line.from, dimmedLine);
						if (line.to >= to) break;
						pos = line.to + 1;
					}
				}
				return builder.finish();
			}
		}, { decorations: (v: { decorations: DecorationSet }) => v.decorations });
	}

	private updateDynamicStyles() {
		activeDocument.body.classList.toggle('writing-menu-focus-enabled', this.settings.enableFocusMode);
		activeDocument.body.style.setProperty('--writing-menu-focus-opacity', this.settings.focusOpacity.toString());
		activeDocument.body.classList.toggle('writing-menu-typewriter-active', this.settings.enableTypewriterScrolling);
	}

	// Increment version counter when settings change so leaves know to refresh
	private regenerateCSSTemplate(): void {
		this.cssSettingsVersion++;
	}

	private updateLeafStyles(leaf: WorkspaceLeaf, force: boolean = false): void {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		const file = view.file;
		const shouldApply = this.shouldApplyToFile(file);
		const container = view.containerEl;

		if (!shouldApply) {
			container.removeAttribute('data-writing-menu-id');
			this.leafStyleVersions.delete(leaf);
			return;
		}

		const currentVersion = this.leafStyleVersions.get(leaf);
		if (!force && currentVersion === this.cssSettingsVersion && container.hasAttribute('data-writing-menu-id')) return;

		const leafId = this.getLeafId(leaf);
		container.setAttribute('data-writing-menu-id', leafId);
		this.applyLeafCssProps(container);
		this.leafStyleVersions.set(leaf, this.cssSettingsVersion);
	}

	private applyLeafCssProps(container: HTMLElement): void {
		const { fontFamily, fontSize, fontColor, lineHeight, paragraphSpacing, indentation, lineWidth, inlinePadding, backgroundColor, h1FontFamily, h1FontSize, h1LineHeight, h1Color, footnoteFontFamily, footnoteFontSize, footnoteLineHeight, footnoteColor, disableLinkColor } = this.settings;
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
		const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
		const leafSet = new Set(markdownLeaves);
		markdownLeaves.forEach(leaf => this.updateLeafStyles(leaf));
		this.leafStyleVersions.forEach((_, leaf) => {
			if (!leafSet.has(leaf)) {
				if (leaf.view instanceof MarkdownView) {
					leaf.view.containerEl.removeAttribute('data-writing-menu-id');
				}
				this.leafStyleVersions.delete(leaf);
			}
		});
	}

	applyZenState(state: 'off' | 'wide' | 'focus') {
		const prevState = this.zenState;
		this.zenState = state;

		if (state === 'off') {
			if (prevState === 'focus' && activeDocument.fullscreenElement) {
				// Defer CSS cleanup to fullscreenchange — avoids flash while still in fullscreen
				activeDocument.exitFullscreen().catch(() => this.exitZenFocus());
			} else {
				this.exitZenFocus();
			}
			return;
		}

		if (state === 'wide') {
			// Clean up focus state if transitioning from focus
			if (prevState === 'focus') {
				activeDocument.body.classList.remove('wm-focus-mode');
				this.clearZenLeaf();
				if (this.zenLeafEventRef) { this.app.workspace.offref(this.zenLeafEventRef); this.zenLeafEventRef = null; }
				if (activeDocument.fullscreenElement) activeDocument.exitFullscreen().catch(() => {});
			}
			activeDocument.body.classList.add('wm-wide-mode');
			return;
		}

		// state === 'focus':
		// Keep wm-wide-mode active during fullscreen animation — prevents flash to unstyled view
		if (activeDocument.fullscreenElement) {
			activeDocument.body.classList.remove('wm-wide-mode');
			this.activateFocusMode();
		} else {
			// wm-wide-mode (if active) stays until fullscreenchange fires → activateFocusMode removes it
			activeDocument.documentElement.requestFullscreen().catch(() => {
				this.zenState = 'off';
				activeDocument.body.classList.remove('wm-wide-mode');
			});
		}
	}

	private exitZenFocus() {
		activeDocument.body.classList.remove('wm-focus-mode', 'wm-wide-mode');
		this.clearZenLeaf();
		if (this.zenLeafEventRef) {
			this.app.workspace.offref(this.zenLeafEventRef);
			this.zenLeafEventRef = null;
		}
	}

	private activateFocusMode() {
		activeDocument.body.classList.remove('wm-wide-mode');
		activeDocument.body.classList.add('wm-focus-mode');
		const activeLeaf =
			this.app.workspace.getMostRecentLeaf() ??
			this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ??
			null;
		if (activeLeaf) this.applyZenLeaf(activeLeaf);
		if (!this.zenLeafEventRef) {
			this.zenLeafEventRef = this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf && this.zenState === 'focus') this.applyZenLeaf(leaf);
			});
		}
	}

	cycleZenMode() {
		const wideOn = this.settings.zenWideEnabled;
		const focusOn = this.settings.zenFocusEnabled;
		if (!wideOn && !focusOn) return;

		if (wideOn && focusOn) {
			if (this.zenState === 'off') this.applyZenState('wide');
			else if (this.zenState === 'wide') this.applyZenState('focus');
			else this.applyZenState('off');
		} else if (wideOn) {
			this.applyZenState(this.zenState === 'off' ? 'wide' : 'off');
		} else {
			this.applyZenState(this.zenState === 'off' ? 'focus' : 'off');
		}
	}

	private applyZenLeaf(leaf: WorkspaceLeaf) {
		this.clearZenLeaf();
		this.zenLeaf = leaf;
		const el: HTMLElement | undefined = (leaf as WorkspaceLeaf & { containerEl?: HTMLElement }).containerEl;
		if (el) {
			el.classList.add('wm-zen-leaf');
			activeDocument.body.classList.add('wm-has-zen-leaf');
		}
	}

	private clearZenLeaf() {
		activeDocument.querySelectorAll('.wm-zen-leaf').forEach((el: Element) => el.classList.remove('wm-zen-leaf'));
		activeDocument.body.classList.remove('wm-has-zen-leaf');
		this.zenLeaf = null;
	}

	toggleDashboardStopwatchPopup(anchor: HTMLElement) {
		const ownerDoc = anchor.ownerDocument;
		const ownerWin = ownerDoc.defaultView ?? window;
		const existing = ownerDoc.querySelector('.wm-status-popup');
		if (existing) { existing.remove(); return; }

		const popup = ownerDoc.createElement('div');
		popup.className = 'wm-status-popup';
		ownerDoc.body.appendChild(popup);

		this.buildStatusPopup(popup);

		window.requestAnimationFrame(() => {
			const r  = anchor.getBoundingClientRect();
			const pr = popup.getBoundingClientRect();
			let top  = r.bottom + 6;
			let left = r.left;
			if (top + pr.height > ownerWin.innerHeight - 8) top = r.top - pr.height - 6;
			if (left + pr.width  > ownerWin.innerWidth  - 8) left = r.right - pr.width;
			popup.setCssStyles({ top: `${top}px`, left: `${left}px` });
		});

		const closePopup = (e: MouseEvent) => {
			if (!ownerDoc.contains(e.target as Node)) return;
			if (!popup.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
				popup.remove();
				ownerDoc.removeEventListener('click', closePopup);
			}
		};
		window.setTimeout(() => ownerDoc.addEventListener('click', closePopup), 10);
	}

	updateStatusBarDisplay() {
		if (!this.statusBarTimeEl || !this.statusBarItemEl) return;
		if (!this.settings.showTimeInStatusBar) {
			this.statusBarItemEl.setCssStyles({ display: 'none' });
			return;
		}
		this.statusBarItemEl.setCssStyles({ display: 'inline-flex' });
		this.statusBarTimeEl.textContent = this.formatTime(this.stopwatchSeconds);
	}

	toggleStatusPopup(anchor: HTMLElement) {
		const existing = activeDocument.querySelector('.wm-status-popup');
		if (existing) { existing.remove(); return; }

		const popup = activeDocument.createElement('div');
		popup.className = 'wm-status-popup';
		activeDocument.body.appendChild(popup);

		// Position above anchor
		const rect = anchor.getBoundingClientRect();
		popup.setCssStyles({ left: `${rect.left}px` });
		// Adjust after render to handle overflow
		window.requestAnimationFrame(() => {
			const popupRect = popup.getBoundingClientRect();
			popup.setCssStyles({ bottom: `${window.innerHeight - rect.top + 6}px` });
			if (rect.left + popupRect.width > window.innerWidth - 8) {
				popup.setCssStyles({ left: `${window.innerWidth - popupRect.width - 8}px` });
			}
		});
		popup.setCssStyles({ bottom: `${window.innerHeight - rect.top + 6}px` });

		this.buildStatusPopup(popup);

		const closePopup = (e: MouseEvent) => {
			// If click target was removed from DOM (e.g. icon swap via setIcon), ignore
			if (!activeDocument.contains(e.target as Node)) return;
			if (!popup.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
				popup.remove();
				activeDocument.removeEventListener('click', closePopup);
			}
		};
		window.setTimeout(() => activeDocument.addEventListener('click', closePopup), 10);
	}

	buildStatusPopup(container: HTMLElement) {
		// ── Row 1: circular timer (click to edit) ──
		const RADIUS = 63;
		const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
		const timerWrap = container.createDiv('wm-popup-timer-wrap');
		const svgNS = 'http://www.w3.org/2000/svg';
		const svg = activeDocument.createElementNS(svgNS, 'svg');
		svg.setAttribute('viewBox', '0 0 156 156');
		svg.setAttribute('class', 'wm-popup-circle');
		const track = activeDocument.createElementNS(svgNS, 'circle');
		track.setAttribute('cx', '78'); track.setAttribute('cy', '78'); track.setAttribute('r', String(RADIUS));
		track.setAttribute('class', 'wm-popup-circle-track');
		const circleFill = activeDocument.createElementNS(svgNS, 'circle');
		circleFill.setAttribute('cx', '78'); circleFill.setAttribute('cy', '78'); circleFill.setAttribute('r', String(RADIUS));
		circleFill.setAttribute('class', 'wm-popup-circle-fill');
		circleFill.setCssStyles({ strokeDasharray: String(CIRCUMFERENCE), strokeDashoffset: String(CIRCUMFERENCE) });
		svg.appendChild(track);
		svg.appendChild(circleFill);
		timerWrap.appendChild(svg);

		const swTimeEl = timerWrap.createEl('span', { text: this.formatTime(this.stopwatchSeconds), cls: 'wm-popup-timer-big' });
		if (this.stopwatchInterval) swTimeEl.addClass('is-running');

		const updateProgress = () => {
			const totalSecs = this.settings.stopwatchMinutes * 60;
			if (totalSecs > 0) {
				const elapsed = totalSecs - this.stopwatchSeconds;
				const pct = Math.min(1, Math.max(0, elapsed / totalSecs));
				circleFill.setCssStyles({ strokeDashoffset: String(CIRCUMFERENCE * (1 - pct)) });
			} else {
				circleFill.setAttribute('stroke-dashoffset', String(CIRCUMFERENCE));
			}
		};
		updateProgress();

		// ── Row 3: play + reset (centered, below circle) ──
		const playResetRow = container.createDiv('wm-popup-row');
		playResetRow.setCssStyles({ justifyContent: 'center', gap: '20px', padding: '2px 0 4px' });

		const playBtn = playResetRow.createDiv('wm-popup-icon-action');
		setIcon(playBtn, this.stopwatchInterval ? 'pause' : 'play');
		playBtn.onclick = () => {
			if (this.stopwatchInterval) this.stopStopwatch();
			else this.startStopwatch();
			setIcon(playBtn, this.stopwatchInterval ? 'pause' : 'play');
			swTimeEl.textContent = this.formatTime(this.stopwatchSeconds);
			swTimeEl.toggleClass('is-running', !!this.stopwatchInterval);
			updateProgress();
		};

		const resetBtn = playResetRow.createDiv('wm-popup-icon-action');
		setIcon(resetBtn, 'rotate-ccw');
		resetBtn.onclick = () => {
			this.resetStopwatch();
			setIcon(playBtn, 'play');
			swTimeEl.removeClass('is-running');
			swTimeEl.textContent = this.formatTime(this.stopwatchSeconds);
			updateProgress();
		};

		// ── Row 4: add-time buttons (+1/+5/+10/+25) ──
		const addRow = container.createDiv('wm-popup-row');
		addRow.setCssStyles({ justifyContent: 'space-between', paddingBottom: '2px' });
		[1, 5, 10, 25].forEach(mins => {
			const btn = addRow.createEl('button', { text: `+${mins}`, cls: 'wm-popup-action-btn' });
			btn.onclick = () => {
				this.stopwatchSeconds += mins * 60;
				this.updateStatusBarDisplay();
				swTimeEl.textContent = this.formatTime(this.stopwatchSeconds);
				updateProgress();
			};
		});

		// ── Live update ──
		const popupInterval = window.setInterval(() => {
			if (!activeDocument.querySelector('.wm-status-popup')) {
				window.clearInterval(popupInterval);
				return;
			}
			swTimeEl.textContent = this.formatTime(this.stopwatchSeconds);
			swTimeEl.toggleClass('is-running', !!this.stopwatchInterval);
			updateProgress();
			setIcon(playBtn, this.stopwatchInterval ? 'pause' : 'play');
		}, 1000);
	}

	updateAllToolbars() {
		const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
		const leafSet = new Set(markdownLeaves); // O(1) lookup instead of O(n)
		this.toolbarElements.forEach((toolbar, leaf) => {
			if (!leafSet.has(leaf)) {
				toolbar.remove();
				this.toolbarElements.delete(leaf);
				const headerCharCountEl = this.headerCharCountElements.get(leaf);
				if (headerCharCountEl) headerCharCountEl.remove();
				this.headerCharCountElements.delete(leaf);
				this.charCountElements.delete(leaf);
			}
		});
		markdownLeaves.forEach(leaf => {
			if (!this.toolbarElements.has(leaf)) this.addToolbarToLeaf(leaf);
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
		this.headerCharCountElements.set(leaf, charCountEl);
		this.updateCharCount(leaf);

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
		this.toolbarElements.set(leaf, button);
		this.updateLeafStyles(leaf);
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

	addMenuNavCard(container: HTMLElement, title: string, desc: string, icon: string, onClick: () => void) {
		const card = container.createDiv({ cls: 'wm-menu-nav-card' });
		const iconEl = card.createDiv({ cls: 'wm-menu-nav-icon' });
		setIcon(iconEl, icon);
		const body = card.createDiv({ cls: 'wm-menu-nav-body' });
		body.createEl('div', { cls: 'wm-menu-nav-title', text: title });
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

	renderMainMenuPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		void this.addCompactControl(container, '폴더', this.settings.applyToFolder, async (v) => { this.settings.applyToFolder = v; await this.saveSettings(); }, 'folder');

		{
			const copyDiv = container.createDiv('writing-menu-control');
			const copyLabelGroup = copyDiv.createDiv('writing-menu-control-label-group');
			setIcon(copyLabelGroup.createSpan('writing-menu-icon'), 'copy');
			copyLabelGroup.createEl('label', { text: '복사하기' });
			const copyBtn = copyDiv.createDiv();
			copyBtn.setCssStyles({ display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '12px' });
			copyBtn.setText('Alt + C');
			copyBtn.onclick = () => {
				void this.copyWithOptions(leaf).then(() => {
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
						new HwpExportModal(this.app, this, view.file).open();
					} else { new Notice('마크다운 파일을 열어주세요.', 3000); }
				};
			}
			const txtBtn = exportRightGroup.createDiv('writing-menu-text-btn');
			txtBtn.setText('TXT');
			txtBtn.onclick = () => {
				const view = leaf.view;
				if (view instanceof MarkdownView && view.file && view.file.extension === 'md') {
					(activeDocument.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
					new TxtExportModal(this.app, this, view.file).open();
				} else { new Notice('마크다운 파일을 열어주세요.', 3000); }
			};
		}

		try {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.editor) {
				this.addCharCountWithModeSelector(container, this.calculateCharCount(view.editor.getValue()), leaf);
			}
		} catch { /* intentional */ }

		this.addSeparator(container);

		this.addMenuNavCard(container, '서식', '', 'type', () => this.renderMenuPage(container, 'typography', leaf));
		this.addMenuNavCard(container, '색상', '', 'palette', () => this.renderMenuPage(container, 'color', leaf));
		this.addMenuNavCard(container, '입력 보조', '', 'keyboard', () => this.renderMenuPage(container, 'input', leaf));
		this.addMenuNavCard(container, '스톱워치', '', 'clock', () => this.renderMenuPage(container, 'time-tracking', leaf));
		this.addMenuNavCard(container, '보기', '', 'eye', () => this.renderMenuPage(container, 'view', leaf));

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
			this.openSettings();
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
		const fontInput = fontDiv.createEl('input', { type: 'text', value: this.settings.fontFamily });
		fontInput.setCssStyles({ width: '100px', textAlign: 'right' });
		fontInput.onchange = (e) => { this.settings.fontFamily = (e.target as HTMLInputElement).value; void this.saveSettings(); };

		void this.addCompactStepper(container, '글자 크기', this.settings.fontSize, 1, 1, async (v) => { this.settings.fontSize = v; await this.saveSettings(); }, 'type');
		void this.addCompactStepper(container, '줄간격', this.settings.lineHeight, 0.1, 0, async (v) => { this.settings.lineHeight = v; await this.saveSettings(); }, 'align-justify');
		void this.addCompactStepper(container, '문단간격', this.settings.paragraphSpacing, 0.5, 0, async (v) => { this.settings.paragraphSpacing = v; await this.saveSettings(); }, 'pilcrow');
		void this.addCompactStepper(container, '너비', this.settings.lineWidth, 100, 0, async (v) => { this.settings.lineWidth = v; await this.saveSettings(); }, 'move-horizontal');
		void this.addCompactStepper(container, '좌우 여백', this.settings.inlinePadding ?? 40, 10, 0, async (v) => { this.settings.inlinePadding = v; await this.saveSettings(); }, 'arrow-left-right');
		void this.addCompactStepper(container, '들여쓰기', this.settings.indentation, 5, 0, async (v) => { this.settings.indentation = v; await this.saveSettings(); }, 'indent');
	}

	renderColorPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '색상', () => this.renderMenuPage(container, 'main', leaf));
		void this.addDualColorControl(container, '글자색', this.settings.fontColor, async (v) => { this.settings.fontColor = v; await this.saveSettings(); }, 'palette');
		void this.addDualColorControl(container, '배경색', this.settings.backgroundColor, async (v) => { this.settings.backgroundColor = v; await this.saveSettings(); }, 'droplet');
		void this.addCompactToggle(container, '링크 색상', !this.settings.disableLinkColor, async (v) => { this.settings.disableLinkColor = !v; await this.saveSettings(); }, 'link');
	}

	renderViewPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '보기', () => this.renderMenuPage(container, 'main', leaf));
		void this.addCompactToggle(container, '타자기 스크롤', this.settings.enableTypewriterScrolling, async (v) => { this.settings.enableTypewriterScrolling = v; await this.saveSettings(); }, 'align-vertical-justify-center');
		void this.addCompactToggle(container, '포커스 모드', this.settings.enableFocusMode, async (v) => {
			this.settings.enableFocusMode = v;
			await this.saveSettings();
			this.renderMenuPage(container, 'view', leaf);
		}, 'eye');
		if (this.settings.enableFocusMode) {
			void this.addCompactSlider(container, '투명도', this.settings.focusOpacity, 0, 1, 0.05, async (v) => { this.settings.focusOpacity = v; await this.saveSettings(); }, 'sun');
		}

		this.addSeparator(container);

		// 단축키 모드 행
		const shortcutRow = container.createDiv('writing-menu-control');
		const shortcutLabel = shortcutRow.createDiv('writing-menu-control-label-group');
		setIcon(shortcutLabel.createSpan('writing-menu-icon'), 'keyboard');
		shortcutLabel.createEl('label', { text: '단축키' });
		const f4Badge = shortcutRow.createDiv();
		f4Badge.setCssStyles({ display: 'flex', alignItems: 'center', cursor: 'default', color: 'var(--text-muted)', fontSize: '12px' });
		f4Badge.setText('F4');

		// 길게 보기 토글 (zenWideEnabled)
		void this.addCompactToggle(container, '길게 보기', this.settings.zenWideEnabled, async (v) => {
			this.settings.zenWideEnabled = v;
			await this.saveSettings();
		}, 'move-vertical');

		// 집중 모드 토글 (zenFocusEnabled)
		void this.addCompactToggle(container, '집중 모드', this.settings.zenFocusEnabled, async (v) => {
			this.settings.zenFocusEnabled = v;
			await this.saveSettings();
		}, 'expand');
	}

	renderInputPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '입력 보조', () => this.renderMenuPage(container, 'main', leaf));
		void this.addCompactToggle(container, '스마트 따옴표', this.settings.enableSmartQuotes, async (v) => { this.settings.enableSmartQuotes = v; await this.saveSettings(); }, 'quote-glyph');
		void this.addCompactToggle(container, '스마트 엔터', this.settings.enableSmartEnter, async (v) => { this.settings.enableSmartEnter = v; await this.saveSettings(); }, 'corner-down-left');
		void this.addCompactToggle(container, '자동완성', this.settings.enableSmartInput, async (v) => { this.settings.enableSmartInput = v; await this.saveSettings(); }, 'keyboard');
		void this.addCompactToggle(container, '텍스트 치환', this.settings.enableTextSubstitution, async (v) => { this.settings.enableTextSubstitution = v; await this.saveSettings(); }, 'replace');
	}

	renderVersionMenuPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '버전 관리', () => this.renderMenuPage(container, 'main', leaf));

		const getHotkey = (commandId: string): string => {
			const hotkeys = (this.app as any).hotkeyManager?.getHotkeys(`writing-menu:${commandId}`) as Array<{ modifiers: string[]; key: string }> | undefined;
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

		// 버전 저장
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
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				const file = activeView?.file;
				if (!file || !activeView) { new Notice('마크다운 파일을 먼저 열어주세요.'); return; }
				(activeDocument.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
				const { VersionManager } = await import('./src/version/manager');
				const manager = new VersionManager(this.app, this);
				const now = new Date();
				const name = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
				await manager.saveVersion(file, name, activeView.editor.getValue());
				new Notice(`버전 "${name}"이 저장되었습니다.`);
			})();
		});
	}

	addSeparator(container: HTMLElement) {
		container.createDiv('writing-menu-separator').setCssStyles({ height: '1px', background: 'var(--background-modifier-border)', margin: '8px 0', opacity: '0.5' });
	}

	async loadSettings() {
		const savedData = await this.loadData();
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

	// HWP Converter Script Management
	async ensureConverterScript(){ return await ensureConverterScript(this); }

	async openFolderPicker(): Promise<string | null>{ return await openFolderPicker(this); }

	async openTemplatePicker(): Promise<string | null>{ return await openTemplatePicker(this); }

	async runPicker(mode: 'folder' | 'file'): Promise<string | null>{ return await runPicker(this, mode); }

	async convertToHwp(file: TFile, fileName: string, exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<boolean>{ return await convertToHwp(this, file, fileName, exportPath, useSpaceIndent, excludeHeadings); }

	getDefaultExportPath(): string{ return getDefaultExportPath(this); }

	// Clean markdown frontmatter
	cleanMarkdownFrontmatter(content: string): string{ return cleanMarkdownFrontmatter(this, content); }

	// Remove headings from text (for copy without headings)
	removeHeadings(content: string): string{ return removeHeadings(this, content); }

	async copyWithOptions(leaf: WorkspaceLeaf){ return await copyWithOptions(this, leaf); }

	// Add space indent to each non-empty line
	applySpaceIndent(text: string): string{ return applySpaceIndent(this, text); }

	// TXT Export Functions
	async convertToTxt(file: TFile, fileName: string, exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<boolean>{ return await convertToTxt(this, file, fileName, exportPath, useSpaceIndent, excludeHeadings); }

	async convertFolderToTxt(folderPath: string, exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFolderToTxt(this, folderPath, exportPath, useSpaceIndent, excludeHeadings); }

	async convertFilesToTxt(files: TFile[], exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFilesToTxt(this, files, exportPath, useSpaceIndent, excludeHeadings); }

	// HWP Folder/Multi-file Export Functions
	async convertFolderToHwp(folderPath: string, exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFolderToHwp(this, folderPath, exportPath, useSpaceIndent, excludeHeadings); }

	async convertFilesToHwp(files: TFile[], exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFilesToHwp(this, files, exportPath, useSpaceIndent, excludeHeadings); }

	// Merged TXT Export Functions
	async convertFolderToTxtMerged(folderPath: string, exportPath: string, fileName: string, useSpaceIndent: boolean): Promise<void>{ return await convertFolderToTxtMerged(this, folderPath, exportPath, fileName, useSpaceIndent); }

	async convertFilesToTxtMerged(files: TFile[], exportPath: string, fileName: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFilesToTxtMerged(this, files, exportPath, fileName, useSpaceIndent, excludeHeadings); }

	// Merged HWP Export Functions
	async convertFolderToHwpMerged(folderPath: string, exportPath: string, fileName: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFolderToHwpMerged(this, folderPath, exportPath, fileName, useSpaceIndent, excludeHeadings); }

	async convertFilesToHwpMerged(files: TFile[], exportPath: string, fileName: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{ return await convertFilesToHwpMerged(this, files, exportPath, fileName, useSpaceIndent, excludeHeadings); }

	async addCompactControl(container: HTMLElement, label: string, value: string, callback: (v: string) => void | Promise<void>, icon?: string, type: string = 'text'){ return await addCompactControl(this, container, label, value, callback, icon, type); }

	addCharCountWithModeSelector(container: HTMLElement, count: number, leaf: WorkspaceLeaf) {
		const div = container.createDiv('writing-menu-control');
		const labelGroup = div.createDiv('writing-menu-control-label-group');
		const iconSpan = labelGroup.createSpan('writing-menu-icon');
		setIcon(iconSpan, 'binary');
		labelGroup.createEl('label', { text: '글자수' });

		// Right side: count + logo buttons
		const rightGroup = div.createDiv();
		rightGroup.setCssStyles({ display: 'flex', alignItems: 'center', gap: '8px' });

		// Count display
		const valueSpan = rightGroup.createEl('span', { text: this.formatCharCount(count) });
		valueSpan.setCssStyles({ color: 'var(--text-muted)', fontSize: '12px' });

		// Logo button container
		const modeGroup = rightGroup.createDiv();
		modeGroup.setCssStyles({ display: 'flex', gap: '6px', alignItems: 'center' });

		const isMunpia = this.settings.charCountMode === 'munpia';

		// 문피아 로고 버튼
		const mBtn = modeGroup.createDiv('writing-menu-logo-btn');
		mBtn.appendChild(sanitizeHTMLToDom(MUNPIA_SVG));
		if (isMunpia) mBtn.addClass('is-active');
		mBtn.onclick = () => {
			this.settings.charCountMode = 'munpia';
			void this.saveSettings().then(() => {
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

		// 노벨피아 로고 버튼
		const nBtn = modeGroup.createDiv('writing-menu-logo-btn');
		nBtn.appendChild(sanitizeHTMLToDom(NOVELPIA_SVG));
		if (!isMunpia) nBtn.addClass('is-active');
		nBtn.onclick = () => {
			this.settings.charCountMode = 'novelpia';
			void this.saveSettings().then(() => {
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

	// Update all character counts across all leaves
	updateAllCharCounts() {
		this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
			this.updateCharCount(leaf);
		});
	}

	// Time Tracking UI Section
	// Helper to style icon buttons uniformly
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

	renderTimeTrackingPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '스톱워치', () => this.renderMenuPage(container, 'main', leaf));
		void this.addCompactToggle(container, '상태바 표시', this.settings.showTimeInStatusBar, async (v) => {
			this.settings.showTimeInStatusBar = v;
			this.settings.enableTimeTracking = v || this.settings.showTimeInDashboard;
			await this.saveSettings();
			this.updateStatusBarDisplay();
		}, 'activity');
		void this.addCompactToggle(container, '대시보드 표시', this.settings.showTimeInDashboard, async (v) => {
			this.settings.showTimeInDashboard = v;
			this.settings.enableTimeTracking = this.settings.showTimeInStatusBar || v;
			await this.saveSettings();
		}, 'layout-dashboard');
	}

	async addCompactToggle(container: HTMLElement, label: string, value: boolean, callback: (v: boolean) => void | Promise<void>, icon?: string){ return await addCompactToggle(this, container, label, value, callback, icon); }

	async addCompactStepper(container: HTMLElement, label: string, value: number, step: number, min: number, callback: (v: number) => void | Promise<void>, icon?: string){ return await addCompactStepper(this, container, label, value, step, min, callback, icon); }

	async addCompactSlider(container: HTMLElement, label: string, value: number, min: number, max: number, step: number, callback: (v: number) => void | Promise<void>, icon?: string){ return await addCompactSlider(this, container, label, value, min, max, step, callback, icon); }

	async addDualColorControl(container: HTMLElement, label: string, value: string | { light: string, dark: string }, callback: (v: string | { light: string; dark: string }) => void | Promise<void>, icon?: string){ return await addDualColorControl(this, container, label, value, callback, icon); }

	// Helper for Settings Tab (Settings Button)
	openSettings() {
		interface AppWithSettings extends App { setting?: { open(): void; openTabById(id: string): void } }
		(this.app as AppWithSettings).setting?.open();
		(this.app as AppWithSettings).setting?.openTabById(this.manifest.id);
	}
}


