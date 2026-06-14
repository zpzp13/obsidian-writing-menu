import { App, Plugin, Setting, MarkdownView, WorkspaceLeaf, setIcon, TFile, TFolder, TAbstractFile, Vault, PluginSettingTab, ItemView, Modal, Notice, Platform, MarkdownRenderer, FuzzySuggestModal, EventRef } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { EditorView, ViewPlugin, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { Extension, EditorState, ChangeSpec, RangeSetBuilder, Prec, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { SymbolSuggester } from './SymbolSuggester';
import { SymbolOption, SymbolTrigger, TextSubstitution, PreviewTypography, WritingMenuSettings, DEFAULT_SETTINGS, IWritingMenuPlugin } from './src/types';
import { FilePickerModal, MobilePreviewFloating } from './src/preview';
import { HeadingRawWidget } from './src/editor/HeadingRawWidget';
import { TimeTrackingView, TIME_TRACKING_VIEW_TYPE } from './src/views/TimeTrackingView';
import { HwpExportModal, TxtExportModal, BatchExportModal } from './src/export';
import { WritingMenuSettingTab } from './src/settings';
import { CONVERTER_PY_CONTENT } from './src/export/converterScript';
import { GLOBAL_STYLES_CSS } from './src/ui/globalStyles';
import { ensureConverterScript, openFolderPicker, openTemplatePicker, runPicker, convertToHwp, getDefaultExportPath, cleanMarkdownFrontmatter, removeHeadings, copyWithOptions, applySpaceIndent, convertToTxt, convertFolderToTxt, convertFilesToTxt, convertFolderToHwp, convertFilesToHwp, convertFolderToTxtMerged, convertFilesToTxtMerged, convertFolderToHwpMerged, convertFilesToHwpMerged } from './src/export/converterMethods';
import { addCompactControl, addCompactToggle, addCompactStepper, addCompactSlider, addDualColorControl } from './src/ui/controls';
import { openDictionary } from './src/dictionary';
import { VersionHistoryView, VERSION_HISTORY_VIEW_TYPE } from './src/version/VersionHistoryView';
import { SaveVersionModal } from './src/version/SaveVersionModal';
import { CalendarView, VIEW_TYPE_CALENDAR } from './src/calendar/views/CalendarView';
import { HeatmapStore } from './src/dashboard/data/HeatmapStore';

export default class WritingMenuPlugin extends Plugin {
	settings: WritingMenuSettings;
	mobilePreviewFloating: MobilePreviewFloating;
	heatmapStore: HeatmapStore;
	settingTab: WritingMenuSettingTab | null = null;
	toolbarElements: Map<WorkspaceLeaf, HTMLElement> = new Map();
	leafStyleElements: Map<WorkspaceLeaf, HTMLStyleElement> = new Map();
	private leafIdCounter: number = 0;
	charCountElements: Map<WorkspaceLeaf, HTMLElement> = new Map();
	headerCharCountElements: Map<WorkspaceLeaf, HTMLElement> = new Map();
	private charCountDebounceTimers: Map<WorkspaceLeaf, number> = new Map();
	private cachedCSSTemplate: string = '';
	private cssSettingsVersion: number = 0;
	private leafStyleVersions: Map<WorkspaceLeaf, number> = new Map();
	pendingTimeUpdates: Map<string, { file: TFile; mode: 'draft' | 'writing' | 'editing' | 'total'; seconds: number }> = new Map();
	private nnMenuUnregisterFns: Array<() => void> = [];
	stopwatchSeconds: number = 0;
	stopwatchInterval: number | null = null;
	private stopwatchDisplayEl: HTMLElement | null = null;
	smartEnterCompartment = new Compartment();
	smartQuoteCompartment = new Compartment();
	typewriterCompartment = new Compartment();
	textSubstitutionCompartment = new Compartment();
	private lastSubstitution: { from: string; to: string; endPos: number } | null = null;
	private isFullscreenMode: boolean = false;
	private zenLeaf: WorkspaceLeaf | null = null;
	private zenLeafEventRef: EventRef | null = null;
	private statusBarItemEl: HTMLElement | null = null;
	private statusBarTimeEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();
		this.initStopwatch();
		this.mobilePreviewFloating = new MobilePreviewFloating(this);

		this.heatmapStore = new HeatmapStore(this);
		this.heatmapStore.init().catch(() => {});
		this.registerEvent(this.app.vault.on('modify', file => {
			if (file instanceof TFile) this.heatmapStore.onFileModify(file);
		}));

		if (Platform.isWin) {
			await this.ensureConverterScript();
		}

		this.addGoogleFonts();
		this.addGlobalStyles();

		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this.updateAllToolbars();
			// rAF ensures DOM (mod-visible class) is settled before checking preview mode
			window.requestAnimationFrame(() => this.updateAllLeafStyles());
		}));

		this.registerEvent(this.app.workspace.on('file-open', () => {
			const activeLeaf = this.app.workspace.activeLeaf;
			if (activeLeaf) this.updateLeafStyles(activeLeaf);
		}));

		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			if (leaf) this.updateLeafStyles(leaf);
		}));

		this.registerEvent(this.app.workspace.on('editor-change', () => {
			const activeLeaf = this.app.workspace.activeLeaf;
			if (activeLeaf) {
				this.updateCharCountDebounced(activeLeaf);
			}
		}));

		this.updateAllToolbars();
		this.updateAllLeafStyles();

		const themeObserver = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
					if (mutation.target === document.body) {
						this.regenerateCSSTemplate();
						this.updateAllLeafStyles();
					}
				}
			});
		});
		themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
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
				if ((file as any).extension === 'md') {
					if (Platform.isDesktopApp) {
						menu.addItem((item) => {
							item
								.setTitle('TXT로 내보내기')
								.setIcon('file-text')
								.onClick(() => {
									new TxtExportModal(this.app, this, file as TFile).open();
								});
						});
					}
					if (Platform.isWin) {
						menu.addItem((item) => {
							item
								.setTitle('HWP로 내보내기')
								.setIcon('file')
								.onClick(() => {
									new HwpExportModal(this.app, this, file as TFile).open();
								});
						});
					}
				} else if ((file as any).children) {
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
				const mdFiles = files.filter((f: any) => f.extension === 'md');
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
			VERSION_HISTORY_VIEW_TYPE,
			(leaf) => new VersionHistoryView(leaf, this)
		);

		// 캘린더 뷰 등록
		this.registerView(
			VIEW_TYPE_CALENDAR,
			(leaf) => new CalendarView(leaf, this)
		);

		this.addCommand({
			id: 'toggle-calendar-view',
			name: '캘린더 열기/닫기',
			callback: () => this.toggleCalendarView(),
		});

		this.addRibbonIcon('calendar', '캘린더', () => this.toggleCalendarView());

		this.addCommand({
			id: 'toggle-time-tracking-sidebar',
			name: '작업 시간 사이드바 열기/닫기',
			callback: () => {
				this.toggleTimeTrackingSidebar();
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
				this.refreshVersionHistorySidebar();
				new Notice(`버전 "${name}"이 저장되었습니다.`);
			}
		});

		this.addCommand({
			id: 'version-history',
			name: '버전 기록 보기',
			callback: () => {
				this.toggleVersionHistorySidebar();
			}
		});

		this.addCommand({
			id: 'copy-without-excluded',
			name: '복사하기 (헤딩·각주 제외)',
			hotkeys: [{ modifiers: ['Alt'], key: 'c' }],
			callback: async () => {
				const activeLeaf = this.app.workspace.activeLeaf;
				if (activeLeaf) await this.copyWithOptions(activeLeaf);
			}
		});

		this.addCommand({
			id: 'zen-mode',
			name: 'Zen Mode',
			callback: () => this.toggleFullscreenMode()
		});

		this.addCommand({
			id: 'hanja-convert',
			name: '사전 / 한자 변환',
			hotkeys: [{ modifiers: [], key: 'F3' }],
			callback: () => openDictionary(this),
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
		statusBarItem.style.display = 'none';
		this.statusBarItemEl = statusBarItem;
		this.statusBarTimeEl = statusBarItem.createEl('span', { cls: 'wm-status-time' });
		statusBarItem.addEventListener('click', (e) => {
			e.stopPropagation();
			this.toggleStatusPopup(statusBarItem);
		});
		this.updateStatusBarDisplay();

		document.addEventListener('fullscreenchange', () => {
			if (!document.fullscreenElement && this.isFullscreenMode) {
				this.isFullscreenMode = false;
				document.body.classList.remove('wm-fullscreen-mode');
			}
		});

		this.app.workspace.onLayoutReady(() => {
			this.registerNotebookNavigatorMenus();
		});
	}

	private registerNotebookNavigatorMenus() {
		const nn = ((this.app as any).plugins as any)?.plugins?.['notebook-navigator'];
		if (!nn?.api?.menus) return;

		const unregFile = nn.api.menus.registerFileMenu((ctx: {
			addItem: (fn: (item: any) => void) => void;
			file: TFile;
			selection: { mode: string; files: TAbstractFile[] };
		}) => {
			const mdFiles = ctx.selection.files.filter((f: any) => f.extension === 'md') as TFile[];
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
			addItem: (fn: (item: any) => void) => void;
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

		if (typeof unregFile === 'function') this.nnMenuUnregisterFns.push(unregFile);
		if (typeof unregFolder === 'function') this.nnMenuUnregisterFns.push(unregFolder);
	}

	async toggleCalendarView() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
		if (leaves.length > 0) {
			leaves.forEach(leaf => leaf.detach());
		} else {
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: true });
				this.app.workspace.revealLeaf(leaf);
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
				this.app.workspace.revealLeaf(leaf);
			}
		}
	}

	async toggleVersionHistorySidebar() {
		const leaves = this.app.workspace.getLeavesOfType(VERSION_HISTORY_VIEW_TYPE);
		if (leaves.length > 0) {
			leaves.forEach(leaf => leaf.detach());
		} else {
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VERSION_HISTORY_VIEW_TYPE, active: true });
				this.app.workspace.revealLeaf(leaf);
			}
		}
	}

	refreshVersionHistorySidebar() {
		const leaves = this.app.workspace.getLeavesOfType(VERSION_HISTORY_VIEW_TYPE);
		leaves.forEach(leaf => {
			const view = leaf.view as VersionHistoryView;
			if (view && typeof view.refresh === 'function') view.refresh();
		});
	}

	async onunload() {
		for (const unregister of this.nnMenuUnregisterFns) {
			try { unregister(); } catch {}
		}
		this.nnMenuUnregisterFns = [];

		this.charCountDebounceTimers.forEach((timer) => window.clearTimeout(timer));
		this.charCountDebounceTimers.clear();
		this.toolbarElements.forEach((toolbar) => toolbar.remove());
		this.toolbarElements.clear();
		this.headerCharCountElements.forEach((el) => el.remove());
		this.headerCharCountElements.clear();
		this.charCountElements.clear();
		this.leafStyleElements.forEach((styleEl, leaf) => {
			styleEl.remove();
			leaf.view.containerEl.removeAttribute('data-writing-menu-id');
		});
		this.leafStyleElements.clear();

		const fontLink = document.getElementById('writing-menu-fonts');
		if (fontLink) fontLink.remove();

		const globalStyles = document.getElementById('writing-menu-global-styles');
		if (globalStyles) globalStyles.remove();

		document.body.classList.remove('writing-menu-focus-enabled');
		document.body.classList.remove('writing-menu-typewriter-active');
		document.body.classList.remove('wm-fullscreen-mode');
		document.body.style.removeProperty('--writing-menu-focus-opacity');
		this.clearZenLeaf();
		if (this.zenLeafEventRef) {
			this.app.workspace.offref(this.zenLeafEventRef);
			this.zenLeafEventRef = null;
		}
		this.mobilePreviewFloating.close();
	}

	addGoogleFonts() {
		const link = document.createElement('link');
		link.id = 'writing-menu-fonts';
		link.rel = 'stylesheet';
		link.href = 'https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700;800&family=Hahmlet:wght@100..900&family=Noto+Serif+KR:wght@200..900&family=Gowun+Batang:wght@400;700&display=swap';
		document.head.appendChild(link);
	}


	addGlobalStyles() {
		const style = document.createElement('style');
		style.id = 'writing-menu-global-styles';
		style.textContent = GLOBAL_STYLES_CSS;
		document.head.appendChild(style);
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

	updateStopwatchDisplay() {
		if (this.stopwatchDisplayEl) {
			this.stopwatchDisplayEl.textContent = this.formatTime(this.stopwatchSeconds);
		}
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
				setTimeout(() => {
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
				setTimeout(() => {
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

				const prevChar = state.doc.sliceString(cursor - 1, cursor);
				const nextChar = state.doc.sliceString(cursor, cursor + 1);

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
				const isOpening = fromA === 0 || /[\s\(\[\{\<]$/.test(context);

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
		const plugin = this;
		return ViewPlugin.fromClass(class {
			constructor(public view: EditorView) { }
			update(update: any) {
				// Only center if text was changed by user interaction (typing/deleting)
				// avoiding scroll on simple cursor movement or click
				const isUserInput = update.transactions.some((tr: any) => tr.isUserEvent("input") || tr.isUserEvent("delete"));
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

		const plugin = this;
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

			plugin.lastSubstitution = {
				from: match.from,
				to: match.to,
				endPos: replaceFrom + match.to.length
			};

			return true;
		});
	}

	getBackspaceUndoExtension(): Extension {
		if (!this.settings.enableSmartInput || !this.settings.enableTextSubstitution) return [];

		const plugin = this;
		return EditorView.updateListener.of((update) => {
			// Check for backspace
			const isBackspace = update.transactions.some(tr => tr.isUserEvent("delete.backward"));
			if (!isBackspace || !plugin.lastSubstitution) return;

			const cursor = update.state.selection.main.head;
			const sub = plugin.lastSubstitution;

			// Only undo if cursor is at the end of substitution
			if (cursor !== sub.endPos - 1) {
				plugin.lastSubstitution = null;
				return;
			}

			// Revert: replace 'to' back to 'from'
			const revertFrom = cursor - sub.to.length + 1;
			const revertTo = cursor;

			update.view.dispatch({
				changes: { from: revertFrom, to: revertTo, insert: sub.from },
				selection: { anchor: revertFrom + sub.from.length }
			});

			plugin.lastSubstitution = null;
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
		const theme = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
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
		} catch (e) {
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
			update(update: any) {
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
						const re = /\[([^\[\]]*)\]\s?\[([^\[\]]*)\]/g;
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
		}, { decorations: (v: any) => v.decorations }));
	}

	private createSelectionExtension() {
		const plugin = this;
		let lastSelectionLength = 0;
		return ViewPlugin.fromClass(class {
			constructor(view: EditorView) { }
			update(update: any) {
				// Only process if selection actually changed
				if (!update.selectionSet) return;

				const selection = update.state.selection.main;
				const currentLength = selection.to - selection.from;

				// Skip if selection length unchanged (avoid redundant updates)
				if (currentLength === lastSelectionLength && currentLength === 0) return;
				lastSelectionLength = currentLength;

				// Update char count on selection change (both select and deselect)
				if (currentLength > 0 || lastSelectionLength > 0) {
					const activeLeaf = plugin.app.workspace.activeLeaf;
					if (activeLeaf?.view instanceof MarkdownView) {
						plugin.updateCharCountDebounced(activeLeaf);
					}
				}
			}
		});
	}

	private createFocusExtension() {
		const plugin = this;
		return ViewPlugin.fromClass(class {
			decorations: DecorationSet;
			lastCursorLine: number = -1;
			lastDocLength: number = 0;
			constructor(view: EditorView) { this.decorations = Decoration.none; }
			update(update: any) {
				if (!plugin.settings.enableFocusMode) {
					if (this.decorations !== Decoration.none) {
						this.decorations = Decoration.none;
						this.lastCursorLine = -1;
					}
					return;
				}

				const isUserInput = update.transactions.some((tr: any) =>
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
				if (!plugin.settings.enableFocusMode || !view.state.selection.main.empty) return Decoration.none;
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
		}, { decorations: (v: any) => v.decorations });
	}

	private updateDynamicStyles() {
		document.body.classList.toggle('writing-menu-focus-enabled', this.settings.enableFocusMode);
		document.body.style.setProperty('--writing-menu-focus-opacity', this.settings.focusOpacity.toString());
		document.body.classList.toggle('writing-menu-typewriter-active', this.settings.enableTypewriterScrolling);
	}

	// Regenerate CSS template only when settings change
	private regenerateCSSTemplate(): void {
		const { fontFamily, fontSize, fontColor, lineHeight, paragraphSpacing, indentation, lineWidth, backgroundColor, h1FontFamily, h1FontSize, h1LineHeight, h1Color, footnoteFontFamily, footnoteFontSize, footnoteLineHeight, footnoteColor, disableLinkColor } = this.settings;
		const fontFamilyValue = fontFamily === 'inherit' ? 'inherit' : fontFamily.includes(' ') ? `"${fontFamily}", serif` : `${fontFamily}, serif`;
		const resolvedFontColor = this.resolveThemeColor(fontColor);
		const fontColorValue = resolvedFontColor === 'inherit' ? 'var(--text-normal)' : resolvedFontColor;
		const resolvedBgColor = this.resolveThemeColor(backgroundColor);
		const bgColorValue = resolvedBgColor === 'transparent' ? 'transparent' : resolvedBgColor;
		const h1FontFamilyValue = h1FontFamily === 'inherit' ? 'inherit' : h1FontFamily.includes(' ') ? `"${h1FontFamily}", serif` : `${h1FontFamily}, serif`;
		const h1ColorValue = (h1Color && h1Color !== 'inherit') ? h1Color : '';

		const footnoteFontFamilyValue = footnoteFontFamily === 'inherit' ? 'inherit' : footnoteFontFamily.includes(' ') ? `"${footnoteFontFamily}", serif` : `${footnoteFontFamily}, serif`;
		const footnoteColorValue = (footnoteColor && footnoteColor !== 'inherit') ? footnoteColor : '';

		// Use __LEAF_ID__ as placeholder for quick string replacement per leaf
		const linkColorCSS = disableLinkColor ? `
[data-writing-menu-id="__LEAF_ID__"] .cm-content .cm-link,
[data-writing-menu-id="__LEAF_ID__"] a { color: ${fontColorValue} !important; text-decoration: none !important; }` : '';

		const h1ColorCSS = h1ColorValue ? `
body [data-writing-menu-id="__LEAF_ID__"] .cm-line.HyperMD-header-1 { color: ${h1ColorValue} !important; }
body [data-writing-menu-id="__LEAF_ID__"] .cm-line.HyperMD-header-1 * { color: ${h1ColorValue} !important; }
body [data-writing-menu-id="__LEAF_ID__"] .cm-header-1 { color: ${h1ColorValue} !important; }
body [data-writing-menu-id="__LEAF_ID__"] .markdown-reading-view h1 { color: ${h1ColorValue} !important; }
body [data-writing-menu-id="__LEAF_ID__"] .markdown-reading-view h1 * { color: ${h1ColorValue} !important; }` : '';

		const footnoteColorCSS = footnoteColorValue ? `
body [data-writing-menu-id="__LEAF_ID__"] .cm-line.HyperMD-footnote { color: ${footnoteColorValue} !important; }
body [data-writing-menu-id="__LEAF_ID__"] .cm-line.HyperMD-footnote * { color: ${footnoteColorValue} !important; }
body [data-writing-menu-id="__LEAF_ID__"] .cm-footref { color: ${footnoteColorValue} !important; }
body [data-writing-menu-id="__LEAF_ID__"] .markdown-reading-view .footnotes { color: ${footnoteColorValue} !important; }
body [data-writing-menu-id="__LEAF_ID__"] .markdown-reading-view .footnotes * { color: ${footnoteColorValue} !important; }
body [data-writing-menu-id="__LEAF_ID__"] .markdown-reading-view sup.footnote-ref a { color: ${footnoteColorValue} !important; }` : '';

		const sel = `[data-writing-menu-id="__LEAF_ID__"]`;
		this.cachedCSSTemplate = `
${sel} .cm-scroller, ${sel} .cm-content, ${sel} .markdown-reading-view {
	font-family: ${fontFamilyValue} !important; font-size: ${fontSize}px !important; line-height: ${lineHeight} !important; color: ${fontColorValue} !important; text-align: justify !important;
}
${sel} .cm-content { text-indent: ${indentation}px !important; caret-color: ${fontColorValue} !important; }
${sel} .markdown-reading-view p { margin-bottom: ${paragraphSpacing}em !important; text-indent: ${indentation}px !important; }
${sel} .cm-line { padding-bottom: ${paragraphSpacing}em !important; }
${sel} .cm-sizer { max-width: ${lineWidth}px !important; margin: 0 auto !important; background-color: ${bgColorValue} !important; padding: 20px 40px !important; transition: max-width 0.3s ease !important; }
${sel} .cm-cursor, ${sel} .cm-cursor-primary { border-left-color: ${fontColorValue} !important; }
${linkColorCSS}
${sel} .cm-highlight { color: ${fontColorValue} !important; }
body ${sel} .obsidian-search-match-highlight { mix-blend-mode: normal !important; background: color-mix(in srgb, var(--text-accent) 45%, transparent) !important; background-color: color-mix(in srgb, var(--text-accent) 45%, transparent) !important; box-shadow: none !important; border-radius: 2px !important; }
body ${sel} .cm-searchMatch { background: color-mix(in srgb, var(--text-accent) 55%, transparent) !important; background-color: color-mix(in srgb, var(--text-accent) 55%, transparent) !important; border-radius: 2px !important; }
body ${sel} .cm-searchMatch-selected { background: color-mix(in srgb, var(--text-accent) 80%, transparent) !important; background-color: color-mix(in srgb, var(--text-accent) 80%, transparent) !important; border-radius: 2px !important; }
body ${sel} .markdown-reading-view mark { background: color-mix(in srgb, var(--text-accent) 45%, transparent) !important; background-color: color-mix(in srgb, var(--text-accent) 45%, transparent) !important; }
${sel} .cm-line.HyperMD-header-1 { font-family: ${h1FontFamilyValue} !important; font-size: ${h1FontSize}px !important; line-height: ${h1LineHeight} !important; }
${sel} .cm-line.HyperMD-header-1 * { font-family: ${h1FontFamilyValue} !important; font-size: ${h1FontSize}px !important; }
${sel} .markdown-reading-view h1 { font-family: ${h1FontFamilyValue} !important; font-size: ${h1FontSize}px !important; line-height: ${h1LineHeight} !important; }
${h1ColorCSS}
${sel} .cm-line.HyperMD-footnote { font-family: ${footnoteFontFamilyValue} !important; font-size: ${footnoteFontSize}px !important; line-height: ${footnoteLineHeight} !important; }
${sel} .cm-line.HyperMD-footnote * { font-family: ${footnoteFontFamilyValue} !important; font-size: ${footnoteFontSize}px !important; }
${sel} .cm-footref { font-family: ${footnoteFontFamilyValue} !important; font-size: ${footnoteFontSize}px !important; }
${sel} .markdown-reading-view .footnotes { font-family: ${footnoteFontFamilyValue} !important; font-size: ${footnoteFontSize}px !important; line-height: ${footnoteLineHeight} !important; }
${sel} .markdown-reading-view sup.footnote-ref { font-size: ${footnoteFontSize}px !important; }
${footnoteColorCSS}
${sel} .cm-line.HyperMD-header-1 .cm-link,
${sel} .cm-line.HyperMD-header-1 .cm-hmd-internal-link { color: inherit !important; text-decoration: none !important; }
${sel} .cm-line.HyperMD-header-1 a { color: inherit !important; text-decoration: none !important; pointer-events: none !important; cursor: text !important; }
${sel} .markdown-reading-view h1 a { color: inherit !important; text-decoration: none !important; pointer-events: none !important; cursor: text !important; }
${sel} .cm-line.HyperMD-header-2, ${sel} .cm-line.HyperMD-header-3, ${sel} .cm-line.HyperMD-header-4,
${sel} .cm-line.HyperMD-header-5, ${sel} .cm-line.HyperMD-header-6,
${sel} .cm-line.HyperMD-header-2 *, ${sel} .cm-line.HyperMD-header-3 *, ${sel} .cm-line.HyperMD-header-4 *,
${sel} .cm-line.HyperMD-header-5 *, ${sel} .cm-line.HyperMD-header-6 * { color: unset !important; }
${sel} .markdown-reading-view h2, ${sel} .markdown-reading-view h3, ${sel} .markdown-reading-view h4,
${sel} .markdown-reading-view h5, ${sel} .markdown-reading-view h6 { color: unset !important; }
`;
		this.cssSettingsVersion++;
	}

	// Generate CSS for a specific leaf by replacing placeholder in cached template
	private generateScopedCSS(leafId: string): string {
		if (!this.cachedCSSTemplate) {
			this.regenerateCSSTemplate();
		}
		return this.cachedCSSTemplate.replace(/__LEAF_ID__/g, leafId);
	}

	private updateLeafStyles(leaf: WorkspaceLeaf, force: boolean = false): void {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		const file = view.file;
		const shouldApply = this.shouldApplyToFile(file);
		const leafId = this.getLeafId(leaf);

		// Skip if already up-to-date (same version and same apply state)
		const currentVersion = this.leafStyleVersions.get(leaf);
		const styleEl = this.leafStyleElements.get(leaf);
		if (!force && styleEl && currentVersion === this.cssSettingsVersion) {
			const hasContent = styleEl.textContent !== '';
			if (hasContent === shouldApply) return; // No change needed
		}

		let el = styleEl;
		if (!el) {
			el = document.createElement('style');
			el.id = `writing-menu-styles-${leafId}`;
			document.head.appendChild(el);
			this.leafStyleElements.set(leaf, el);
		}
		el.textContent = shouldApply ? this.generateScopedCSS(leafId) : '';
		this.leafStyleVersions.set(leaf, this.cssSettingsVersion);

	}

	updateAllLeafStyles(): void {
		const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
		const leafSet = new Set(markdownLeaves); // O(1) lookup instead of O(n)
		markdownLeaves.forEach(leaf => this.updateLeafStyles(leaf));
		this.leafStyleElements.forEach((styleEl, leaf) => {
			if (!leafSet.has(leaf)) {
				styleEl.remove();
				this.leafStyleElements.delete(leaf);
				this.leafStyleVersions.delete(leaf);
			}
		});
	}

	toggleFullscreenMode() {
		this.isFullscreenMode = !this.isFullscreenMode;
		document.body.classList.toggle('wm-fullscreen-mode', this.isFullscreenMode);
		if (this.isFullscreenMode) {
			if (!document.fullscreenElement) {
				document.documentElement.requestFullscreen().catch(() => {});
			}
			const activeLeaf =
				this.app.workspace.getMostRecentLeaf() ??
				(this.app.workspace as any).activeLeaf ??
				this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ??
				null;
			if (activeLeaf) {
				this.applyZenLeaf(activeLeaf);
			}
			this.zenLeafEventRef = this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf && this.isFullscreenMode) this.applyZenLeaf(leaf);
			});
		} else {
			if (document.fullscreenElement) {
				document.exitFullscreen().catch(() => {});
			}
			this.clearZenLeaf();
			if (this.zenLeafEventRef) {
				this.app.workspace.offref(this.zenLeafEventRef);
				this.zenLeafEventRef = null;
			}
		}
	}

	private applyZenLeaf(leaf: WorkspaceLeaf) {
		this.clearZenLeaf();
		this.zenLeaf = leaf;
		const el: HTMLElement | undefined = (leaf as any).containerEl;
		if (el) {
			el.classList.add('wm-zen-leaf');
			document.body.classList.add('wm-has-zen-leaf');
		}
	}

	private clearZenLeaf() {
		document.querySelectorAll('.wm-zen-leaf').forEach(el => el.classList.remove('wm-zen-leaf'));
		document.body.classList.remove('wm-has-zen-leaf');
		this.zenLeaf = null;
	}

	updateStatusBarDisplay() {
		if (!this.statusBarTimeEl || !this.statusBarItemEl) return;
		if (!this.settings.enableTimeTracking) {
			this.statusBarItemEl.style.display = 'none';
			return;
		}
		this.statusBarItemEl.style.display = 'inline-flex';
		this.statusBarTimeEl.textContent = this.formatTime(this.stopwatchSeconds);
	}

	toggleStatusPopup(anchor: HTMLElement) {
		const existing = document.querySelector('.wm-status-popup');
		if (existing) { existing.remove(); return; }

		const popup = document.createElement('div');
		popup.className = 'wm-status-popup';
		document.body.appendChild(popup);

		// Position above anchor
		const rect = anchor.getBoundingClientRect();
		popup.style.left = `${rect.left}px`;
		// Adjust after render to handle overflow
		requestAnimationFrame(() => {
			const popupRect = popup.getBoundingClientRect();
			popup.style.bottom = `${window.innerHeight - rect.top + 6}px`;
			if (rect.left + popupRect.width > window.innerWidth - 8) {
				popup.style.left = `${window.innerWidth - popupRect.width - 8}px`;
			}
		});
		popup.style.bottom = `${window.innerHeight - rect.top + 6}px`;

		this.buildStatusPopup(popup);

		const closePopup = (e: MouseEvent) => {
			// If click target was removed from DOM (e.g. icon swap via setIcon), ignore
			if (!document.contains(e.target as Node)) return;
			if (!popup.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
				popup.remove();
				document.removeEventListener('click', closePopup);
			}
		};
		setTimeout(() => document.addEventListener('click', closePopup), 10);
	}

	buildStatusPopup(container: HTMLElement) {
		// ── Row 1: circular timer (click to edit) ──
		const RADIUS = 63;
		const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
		const timerWrap = container.createDiv('wm-popup-timer-wrap');
		const svgNS = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(svgNS, 'svg') as SVGSVGElement;
		svg.setAttribute('viewBox', '0 0 156 156');
		svg.setAttribute('class', 'wm-popup-circle');
		const track = document.createElementNS(svgNS, 'circle') as SVGCircleElement;
		track.setAttribute('cx', '78'); track.setAttribute('cy', '78'); track.setAttribute('r', String(RADIUS));
		track.setAttribute('class', 'wm-popup-circle-track');
		const circleFill = document.createElementNS(svgNS, 'circle') as SVGCircleElement;
		circleFill.setAttribute('cx', '78'); circleFill.setAttribute('cy', '78'); circleFill.setAttribute('r', String(RADIUS));
		circleFill.setAttribute('class', 'wm-popup-circle-fill');
		circleFill.style.strokeDasharray = String(CIRCUMFERENCE);
		circleFill.style.strokeDashoffset = String(CIRCUMFERENCE);
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
				circleFill.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - pct));
			} else {
				circleFill.style.strokeDashoffset = String(CIRCUMFERENCE);
			}
		};
		updateProgress();

		// ── Row 3: play + reset (centered, below circle) ──
		const playResetRow = container.createDiv('wm-popup-row');
		playResetRow.style.cssText = 'justify-content:center; gap:20px; padding:2px 0 4px;';

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
		addRow.style.cssText = 'justify-content:space-between; padding-bottom:2px;';
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
			if (!document.querySelector('.wm-status-popup')) {
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

		const charCountEl = document.createElement('div');
		charCountEl.className = 'writing-menu-char-count';
		charCountEl.style.cssText = `font-size: 12px; color: var(--text-muted); padding: 0 8px; display: flex; align-items: center; white-space: nowrap;`;
		this.headerCharCountElements.set(leaf, charCountEl);
		this.updateCharCount(leaf);

		const button = document.createElement('div');
		button.className = 'clickable-icon writing-menu-button';
		setIcon(button, 'settings');
		button.style.cssText = `cursor: pointer; display: flex; align-items: center; justify-content: center;`;
		button.addEventListener('click', (e) => { e.stopPropagation(); this.showDropdown(button, leaf); });

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
		const existingDropdown = document.querySelector('.writing-menu-dropdown');
		if (existingDropdown) { existingDropdown.remove(); return; }

		const dropdown = document.createElement('div');
		dropdown.className = 'writing-menu-dropdown';
		const rect = button.getBoundingClientRect();
		dropdown.style.cssText = `position: fixed; top: ${rect.bottom + 5}px; right: ${window.innerWidth - rect.right}px;`;

		this.buildDropdownMenu(dropdown, leaf);

		document.body.appendChild(dropdown);
		if (dropdown.getBoundingClientRect().right > window.innerWidth) dropdown.style.right = '10px';
		const closeDropdown = (e: MouseEvent) => {
			if (!dropdown.contains(e.target as Node) && !button.contains(e.target as Node)) {
				dropdown.remove(); document.removeEventListener('click', closeDropdown);
			}
		};
		setTimeout(() => document.addEventListener('click', closeDropdown), 10);
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
	}

	addMenuNavCard(container: HTMLElement, title: string, desc: string, icon: string, onClick: () => void) {
		const card = container.createDiv({ cls: 'wm-menu-nav-card' });
		const iconEl = card.createDiv({ cls: 'wm-menu-nav-icon' });
		setIcon(iconEl, icon);
		const body = card.createDiv({ cls: 'wm-menu-nav-body' });
		body.createEl('div', { cls: 'wm-menu-nav-title', text: title });
		body.createEl('div', { cls: 'wm-menu-nav-desc', text: desc });
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
		this.addCompactControl(container, '폴더', this.settings.applyToFolder, async (v) => { this.settings.applyToFolder = v; await this.saveSettings(); }, 'folder');

		{
			const copyDiv = container.createDiv('writing-menu-control');
			const copyLabelGroup = copyDiv.createDiv('writing-menu-control-label-group');
			setIcon(copyLabelGroup.createSpan('writing-menu-icon'), 'copy');
			copyLabelGroup.createEl('label', { text: '복사하기' });
			const copyBtn = copyDiv.createDiv();
			copyBtn.style.cssText = 'display:flex; align-items:center; cursor:pointer; color:var(--text-muted); font-size:12px;';
			copyBtn.setText('Alt + C');
			copyBtn.onclick = async () => {
				await this.copyWithOptions(leaf);
				const dropdown = document.querySelector('.writing-menu-dropdown');
				if (dropdown) dropdown.remove();
			};
		}

		if (Platform.isDesktopApp) {
			const exportDiv = container.createDiv('writing-menu-control');
			const exportLabelGroup = exportDiv.createDiv('writing-menu-control-label-group');
			setIcon(exportLabelGroup.createSpan('writing-menu-icon'), 'file-output');
			exportLabelGroup.createEl('label', { text: '내보내기' });
			const exportRightGroup = exportDiv.createDiv();
			exportRightGroup.style.cssText = 'display:flex; align-items:center; gap:8px;';
			if (Platform.isWin) {
				const hwpBtn = exportRightGroup.createDiv('writing-menu-text-btn');
				hwpBtn.setText('HWP');
				hwpBtn.onclick = () => {
					const view = leaf.view;
					if (view instanceof MarkdownView && view.file && view.file.extension === 'md') {
						(document.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
						new HwpExportModal(this.app, this, view.file).open();
					} else { new Notice('마크다운 파일을 열어주세요.', 3000); }
				};
			}
			const txtBtn = exportRightGroup.createDiv('writing-menu-text-btn');
			txtBtn.setText('TXT');
			txtBtn.onclick = () => {
				const view = leaf.view;
				if (view instanceof MarkdownView && view.file && view.file.extension === 'md') {
					(document.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
					new TxtExportModal(this.app, this, view.file).open();
				} else { new Notice('마크다운 파일을 열어주세요.', 3000); }
			};
		}

		try {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.editor) {
				this.addCharCountWithModeSelector(container, this.calculateCharCount(view.editor.getValue()), leaf);
			}
		} catch (e) {}

		if (!this.settings.hideTimeTracking) {
			this.addTimeTrackingSection(container, leaf);
		}

		this.addSeparator(container);

		this.addMenuNavCard(container, '타이포그래피', '글꼴, 크기, 줄간격, 문단간격, 너비, 들여쓰기', 'type', () => this.renderMenuPage(container, 'typography', leaf));
		this.addMenuNavCard(container, '색상', '글자색, 배경색, 링크 색상', 'palette', () => this.renderMenuPage(container, 'color', leaf));
		this.addMenuNavCard(container, '보기', '타자기 스크롤, 포커스 모드', 'eye', () => this.renderMenuPage(container, 'view', leaf));
		this.addMenuNavCard(container, '입력 보조', '스마트 따옴표, 엔터, 자동완성, 텍스트 치환', 'keyboard', () => this.renderMenuPage(container, 'input', leaf));
		this.addMenuNavCard(container, '버전 관리', '초고 저장 및 비교', 'history', () => this.renderMenuPage(container, 'version', leaf));

		this.addSeparator(container);

		const btnContainer = container.createDiv();
		btnContainer.style.cssText = 'margin-top:4px; display:flex; justify-content:center; align-items:center;';
		const btn = btnContainer.createEl('a');
		btn.style.cssText = 'cursor:pointer; color:var(--text-accent); font-size:13px; text-decoration:none; display:flex; align-items:center; gap:6px;';
		const btnIcon = btn.createSpan();
		setIcon(btnIcon, 'settings');
		btnIcon.style.cssText = 'display:flex; align-items:center;';
		btn.createSpan({ text: '플러그인 설정' });
		btn.onclick = () => {
			(document.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
			this.openSettings();
		};
	}

	renderTypographyPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '타이포그래피', () => this.renderMenuPage(container, 'main', leaf));

		const fontDiv = container.createDiv('writing-menu-control');
		const fontLabelGroup = fontDiv.createDiv('writing-menu-control-label-group');
		const hanIcon = fontLabelGroup.createSpan('writing-menu-icon');
		hanIcon.setText('한');
		hanIcon.style.cssText = 'font-weight:bold; display:inline-block; line-height:1; vertical-align:text-bottom;';
		fontLabelGroup.createEl('label', { text: '글꼴' });
		const fontInput = fontDiv.createEl('input', { type: 'text', value: this.settings.fontFamily });
		fontInput.style.width = '100px';
		fontInput.style.textAlign = 'right';
		fontInput.onchange = async (e) => { this.settings.fontFamily = (e.target as HTMLInputElement).value; await this.saveSettings(); };

		this.addCompactStepper(container, '글자 크기', this.settings.fontSize, 1, 1, async (v) => { this.settings.fontSize = v; await this.saveSettings(); }, 'type');
		this.addCompactStepper(container, '줄간격', this.settings.lineHeight, 0.1, 0, async (v) => { this.settings.lineHeight = v; await this.saveSettings(); }, 'align-justify');
		this.addCompactStepper(container, '문단간격', this.settings.paragraphSpacing, 0.5, 0, async (v) => { this.settings.paragraphSpacing = v; await this.saveSettings(); }, 'pilcrow');
		this.addCompactStepper(container, '너비', this.settings.lineWidth, 100, 0, async (v) => { this.settings.lineWidth = v; await this.saveSettings(); }, 'move-horizontal');
		this.addCompactStepper(container, '들여쓰기', this.settings.indentation, 5, 0, async (v) => { this.settings.indentation = v; await this.saveSettings(); }, 'indent');
	}

	renderColorPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '색상', () => this.renderMenuPage(container, 'main', leaf));
		this.addDualColorControl(container, '글자색', this.settings.fontColor, async (v) => { this.settings.fontColor = v; await this.saveSettings(); }, 'palette');
		this.addDualColorControl(container, '배경색', this.settings.backgroundColor, async (v) => { this.settings.backgroundColor = v; await this.saveSettings(); }, 'droplet');
		this.addCompactToggle(container, '링크 색상', !this.settings.disableLinkColor, async (v) => { this.settings.disableLinkColor = !v; await this.saveSettings(); }, 'link');
	}

	renderViewPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '보기', () => this.renderMenuPage(container, 'main', leaf));
		this.addCompactToggle(container, '타자기 스크롤', this.settings.enableTypewriterScrolling, async (v) => { this.settings.enableTypewriterScrolling = v; await this.saveSettings(); }, 'align-vertical-justify-center');
		this.addCompactToggle(container, '포커스 모드', this.settings.enableFocusMode, async (v) => {
			this.settings.enableFocusMode = v;
			await this.saveSettings();
			this.renderMenuPage(container, 'view', leaf);
		}, 'eye');
		if (this.settings.enableFocusMode) {
			this.addCompactSlider(container, '투명도', this.settings.focusOpacity, 0, 1, 0.05, async (v) => { this.settings.focusOpacity = v; await this.saveSettings(); }, 'sun');
		}
	}

	renderInputPage(container: HTMLElement, leaf: WorkspaceLeaf) {
		this.addMenuBackButton(container, '입력 보조', () => this.renderMenuPage(container, 'main', leaf));
		this.addCompactToggle(container, '스마트 따옴표', this.settings.enableSmartQuotes, async (v) => { this.settings.enableSmartQuotes = v; await this.saveSettings(); }, 'quote-glyph');
		this.addCompactToggle(container, '스마트 엔터', this.settings.enableSmartEnter, async (v) => { this.settings.enableSmartEnter = v; await this.saveSettings(); }, 'corner-down-left');
		this.addCompactToggle(container, '자동완성', this.settings.enableSmartInput, async (v) => { this.settings.enableSmartInput = v; await this.saveSettings(); }, 'keyboard');
		this.addCompactToggle(container, '텍스트 치환', this.settings.enableTextSubstitution, async (v) => { this.settings.enableTextSubstitution = v; await this.saveSettings(); }, 'replace');
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
		saveHk.style.cssText = 'display:flex; align-items:center; cursor:pointer; color:var(--text-muted); font-size:12px;';
		const saveHkStr = getHotkey('save-version');
		saveHk.setText(saveHkStr || '단축키 없음');
		saveRow.style.cursor = 'pointer';
		saveRow.addEventListener('click', async (e) => {
			e.stopPropagation();
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			const file = activeView?.file;
			if (!file || !activeView) { new Notice('마크다운 파일을 먼저 열어주세요.'); return; }
			(document.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
			const { VersionManager } = await import('./src/version/manager');
			const manager = new VersionManager(this.app, this);
			const now = new Date();
			const name = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
			await manager.saveVersion(file, name, activeView.editor.getValue());
			this.refreshVersionHistorySidebar();
			new Notice(`버전 "${name}"이 저장되었습니다.`);
		});

		// 버전 기록
		const histRow = container.createDiv('writing-menu-control');
		const histLabelGroup = histRow.createDiv('writing-menu-control-label-group');
		setIcon(histLabelGroup.createSpan('writing-menu-icon'), 'history');
		histLabelGroup.createEl('label', { text: '버전 기록' });
		const histHk = histRow.createDiv();
		histHk.style.cssText = 'display:flex; align-items:center; cursor:pointer; color:var(--text-muted); font-size:12px;';
		const histHkStr = getHotkey('version-history');
		histHk.setText(histHkStr || '단축키 없음');
		histRow.style.cursor = 'pointer';
		histRow.addEventListener('click', (e) => {
			e.stopPropagation();
			(document.querySelector('.writing-menu-dropdown') as HTMLElement)?.remove();
			this.toggleVersionHistorySidebar();
		});
	}

	addSeparator(container: HTMLElement) {
		container.createDiv('writing-menu-separator').style.cssText = 'height:1px; background:var(--background-modifier-border); margin:8px 0; opacity:0.5;';
	}

	async loadSettings() {
		const savedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);
		// @ts-ignore
		if (this.settings.symbolPairs && !this.settings.symbolTriggers) {
			this.settings.symbolTriggers = [];
			// @ts-ignore
			this.settings.symbolPairs.forEach((pair: any) => {
				this.settings.symbolTriggers.push({
					trigger: pair.trigger,
					options: [{ open: pair.openSymbol, close: pair.closeSymbol }],
					enabled: true
				});
			});
			// @ts-ignore
			delete this.settings.symbolPairs;
			this.saveSettings();
		}
		if (!this.settings.customFonts) this.settings.customFonts = [];
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.regenerateCSSTemplate();
		this.updateEditorExtensions();
		this.updateAllLeafStyles();
		this.updateDynamicStyles();
		this.updateStatusBarDisplay();
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

	async addCompactControl(container: HTMLElement, label: string, value: any, callback: (v: any) => void, icon?: string, type: string = 'text'){ return await addCompactControl(this, container, label, value, callback, icon, type); }

	addCharCountWithModeSelector(container: HTMLElement, count: number, leaf: WorkspaceLeaf) {
		const div = container.createDiv('writing-menu-control');
		const labelGroup = div.createDiv('writing-menu-control-label-group');
		const iconSpan = labelGroup.createSpan('writing-menu-icon');
		setIcon(iconSpan, 'binary');
		labelGroup.createEl('label', { text: '글자수' });

		// Right side: count + M/N buttons
		const rightGroup = div.createDiv();
		rightGroup.style.cssText = 'display:flex; align-items:center; gap:8px;';

		// Count display
		const valueSpan = rightGroup.createEl('span', { text: this.formatCharCount(count) });
		valueSpan.style.cssText = 'color:var(--text-muted); font-size:12px;';

		// Separator
		const separator = rightGroup.createEl('span', { text: '/' });
		separator.style.cssText = 'color:var(--text-muted); font-size:12px;';

		// M/N button container
		const modeGroup = rightGroup.createDiv();
		modeGroup.style.cssText = 'display:flex; gap:8px;';

		const isMunpia = this.settings.charCountMode === 'munpia';

		// M button (문피아)
		const mBtn = modeGroup.createDiv('writing-menu-text-btn');
		mBtn.setText('M');
		if (isMunpia) mBtn.addClass('is-active');
		mBtn.onclick = async () => {
			this.settings.charCountMode = 'munpia';
			await this.saveSettings();
			this.updateAllCharCounts();
			mBtn.addClass('is-active');
			nBtn.removeClass('is-active');
			const view = leaf.view;
			if (view instanceof MarkdownView && view.editor) {
				const newCount = this.calculateCharCount(view.editor.getValue());
				valueSpan.textContent = this.formatCharCount(newCount);
			}
		};

		// N button (노벨피아)
		const nBtn = modeGroup.createDiv('writing-menu-text-btn');
		nBtn.setText('N');
		if (!isMunpia) nBtn.addClass('is-active');
		nBtn.onclick = async () => {
			this.settings.charCountMode = 'novelpia';
			await this.saveSettings();
			this.updateAllCharCounts();
			nBtn.addClass('is-active');
			mBtn.removeClass('is-active');
			const view = leaf.view;
			if (view instanceof MarkdownView && view.editor) {
				const newCount = this.calculateCharCount(view.editor.getValue());
				valueSpan.textContent = this.formatCharCount(newCount);
			}
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
		btn.style.setProperty('width', '20px', 'important');
		btn.style.setProperty('height', '20px', 'important');
		btn.style.setProperty('min-width', '20px', 'important');
		btn.style.setProperty('min-height', '20px', 'important');
		btn.style.setProperty('padding', '0', 'important');
		btn.style.setProperty('display', 'flex', 'important');
		btn.style.setProperty('align-items', 'center', 'important');
		btn.style.setProperty('justify-content', 'center', 'important');
		btn.style.setProperty('margin', '0', 'important');
		btn.style.cursor = 'pointer';
		if (opacity < 1) btn.style.opacity = String(opacity);
		const svg = btn.querySelector('svg');
		if (svg) {
			svg.setAttribute('width', '15'); svg.setAttribute('height', '15');
			svg.style.width = '15px'; svg.style.height = '15px';
		}
	}

	addTimeTrackingSection(container: HTMLElement, leaf: WorkspaceLeaf) {
		// Initialize stopwatch if needed
		if (this.stopwatchSeconds <= 0) {
			this.initStopwatch();
		}

		// === Main row: 작업 시간 [토글] ===
		const mainDiv = container.createDiv('writing-menu-control');
		mainDiv.style.cssText = 'padding: 0px 8px;';
		const mainLabelGroup = mainDiv.createDiv('writing-menu-control-label-group');
		const mainIcon = mainLabelGroup.createSpan('writing-menu-icon');
		setIcon(mainIcon, 'clock');
		mainLabelGroup.createEl('label', { text: '작업 시간' });

		const mainToggle = mainDiv.createDiv(`writing-menu-toggle ${this.settings.enableTimeTracking ? 'is-enabled' : ''}`);
		mainToggle.createDiv('writing-menu-toggle-thumb');
		mainToggle.onclick = async () => {
			const newVal = !mainToggle.classList.contains('is-enabled');
			mainToggle.classList.toggle('is-enabled', newVal);
			this.settings.enableTimeTracking = newVal;
			await this.saveSettings();

			// 하위 항목 표시/숨김
			stopwatchDiv.style.display = newVal ? 'flex' : 'none';
		};

		// === Sub row: └ 스톱워치 [countdown] [play/pause] [reset] ===
		const stopwatchDiv = container.createDiv('writing-menu-control');
		stopwatchDiv.style.cssText = `padding: 0px 4px 0px 8px; padding-left: 24px; display: ${this.settings.enableTimeTracking ? 'flex' : 'none'};`;

		const stopwatchLabelGroup = stopwatchDiv.createDiv('writing-menu-control-label-group');
		stopwatchLabelGroup.style.cssText = 'gap: 0;';
		const cornerIcon1 = stopwatchLabelGroup.createSpan('writing-menu-icon');
		setIcon(cornerIcon1, 'corner-down-right');
		cornerIcon1.style.opacity = '0.5';
		stopwatchLabelGroup.createEl('label', { text: '스톱워치' });

		// Right side: countdown + play/pause + reset
		const stopwatchRightGroup = stopwatchDiv.createDiv();
		stopwatchRightGroup.style.cssText = 'display:flex; align-items:center; gap:8px;';

		const stopwatchSpan = stopwatchRightGroup.createEl('span');
		stopwatchSpan.style.cssText = 'font-size:14px; color:var(--text-muted); line-height:16px; height:16px;';
		stopwatchSpan.textContent = this.formatTime(this.stopwatchSeconds);
		this.stopwatchDisplayEl = stopwatchSpan;

		const btnGroup = stopwatchRightGroup.createDiv();
		btnGroup.style.cssText = 'display:flex; align-items:center; gap:0;';

		const playPauseBtn = btnGroup.createDiv('clickable-icon');
		setIcon(playPauseBtn, this.stopwatchInterval ? 'pause' : 'play');
		this.styleIconButton(playPauseBtn);

		const resetBtn = btnGroup.createDiv('clickable-icon');
		setIcon(resetBtn, 'rotate-ccw');
		this.styleIconButton(resetBtn, 0.6);

		resetBtn.onclick = (e) => {
			e.stopPropagation();
			this.resetStopwatch();
		};

		playPauseBtn.onclick = (e) => {
			e.stopPropagation();
			if (this.stopwatchInterval) {
				this.stopStopwatch();
			} else {
				this.startStopwatch();
			}
			playPauseBtn.empty();
			setIcon(playPauseBtn, this.stopwatchInterval ? 'pause' : 'play');
			this.styleIconButton(playPauseBtn);
		};
	}

	async addCompactToggle(container: HTMLElement, label: string, value: boolean, callback: (v: boolean) => void, icon?: string){ return await addCompactToggle(this, container, label, value, callback, icon); }

	async addCompactStepper(container: HTMLElement, label: string, value: number, step: number, min: number, callback: (v: number) => void, icon?: string){ return await addCompactStepper(this, container, label, value, step, min, callback, icon); }

	async addCompactSlider(container: HTMLElement, label: string, value: number, min: number, max: number, step: number, callback: (v: number) => void, icon?: string){ return await addCompactSlider(this, container, label, value, min, max, step, callback, icon); }

	async addDualColorControl(container: HTMLElement, label: string, value: string | { light: string, dark: string }, callback: (v: any) => void, icon?: string){ return await addDualColorControl(this, container, label, value, callback, icon); }

	// Helper for Settings Tab (Settings Button)
	openSettings() {
		// @ts-ignore
		this.app.setting.open();
		// @ts-ignore
		this.app.setting.openTabById(this.manifest.id);
	}
}


