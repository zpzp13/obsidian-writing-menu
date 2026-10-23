import { App, Notice, PluginSettingTab, Setting, setIcon, Platform, ToggleComponent, requireApiVersion } from 'obsidian';
import type { SettingDefinitionItem, SettingDefinitionPage } from 'obsidian';
import { SETTINGS_SEARCH_PAGES } from './settingsSearch.generated';
import type WritingMenuPlugin from '../../main';
import { renderWikiSettingsPage } from '../wiki/WikiSettings';
import { renderPlotWorkbookSettingsPage, renderPlotSnapshotSettings } from '../plot-workbook/PlotWorkbookSettings';
import { FolderSuggestModal } from '../wiki/WikiModals';
import { downloadGaruAssets, GARU_VERSION, getGaruAssetStatus } from '../repetition/GaruAssets';
import { isMorphAnalysisSupported } from '../repetition/MorphAnalyzer';
import { fireAndForget } from '../utils/asyncUtils';
import { renderDeusSettings } from '../aichat/DeusSettings';

import { configureApiKeyInput } from './ApiKeyInput';
import { MOBILE_WEB_FONTS } from '../fonts/MobileFontManager';


export class WritingMenuSettingTab extends PluginSettingTab {
	plugin: WritingMenuPlugin;
	private pendingGroup: { containerEl: HTMLElement; itemsEl: HTMLElement } | null = null;
	private renderingNativePage = false;
	private nativePage: string | null = null;

	constructor(app: App, plugin: WritingMenuPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.containerEl.addClass('wm-settings-tab');
		this.renderPage('main');
	}

	/** Pure metadata: no settings values, DOM, vault reads or API keys are indexed. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		if (!requireApiVersion('1.13.0')) return [];
		const pageDefinition = (page: typeof SETTINGS_SEARCH_PAGES[number]): SettingDefinitionPage => ({
			type: 'page', name: page.name, desc: page.desc,
			visible: page.visible && (!page.mobile || Platform.isMobile),
			items: [{
				name: page.name, desc: page.desc, aliases: [...page.aliases],
				render: setting => {
					// A custom row owns the existing page renderer; saves still use saveSettings().
					// The native host adds a card around this row; our page already owns its section cards.
					const hostItemsEl = setting.settingEl.parentElement;
					hostItemsEl?.addClass('wm-settings-page-items');
					// The native host reuses this row on update(), including its custom content.
					setting.settingEl.empty();
					setting.settingEl.removeClass('setting-item');
					setting.settingEl.addClasses(['wm-settings-tab', 'wm-settings-custom-page']);
					this.nativePage = page.id;
					this.renderingNativePage = true;
					this.pendingGroup = null;
					try { this.renderPageContent(page.id, setting.settingEl); }
					finally { this.renderingNativePage = false; }
					this.adoptNativeSettingDescriptions(setting.settingEl);
					return () => {
						hostItemsEl?.removeClass('wm-settings-page-items');
						if (this.nativePage === page.id) this.nativePage = null;
					};
				},
			}, ...SETTINGS_SEARCH_PAGES.filter(child => child.parent === page.id && !child.group).map(pageDefinition),
			...[...new Set(SETTINGS_SEARCH_PAGES.filter(child => child.parent === page.id && child.group).map(child => child.group))].map(group => ({
				type: 'group' as const, heading: group,
				items: SETTINGS_SEARCH_PAGES.filter(child => child.parent === page.id && child.group === group).map(pageDefinition),
			}))],
		});
		const groups = [...new Set(SETTINGS_SEARCH_PAGES.filter(page => page.parent === 'main').map(page => page.group))];
		return groups.map(group => ({ type: 'group', heading: group || undefined, items: SETTINGS_SEARCH_PAGES.filter(page => page.parent === 'main' && page.group === group).map(pageDefinition) }));
	}

	// ── 페이지 라우터 (항상 this.containerEl 기준) ─────────────────────

	public renderPage(page: string) {
		if (page === 'mobile-fonts' && !Platform.isMobile) page = 'main';
		const aliases: Record<string, string> = { footnotes: 'main', 'document-styles': 'main', typography: 'divider', input: 'autocomplete', 'copy-export': 'export', 'writing-stats': 'char-count', time: 'writing-time', 'calendar-chars': 'char-count' };
		page = aliases[page] ?? page;
		if (requireApiVersion('1.13.0')) {
			// Obsidian's settings host owns navigation; never replace its page stack's DOM.
			const host = (this.app as App & { setting?: { openPagePath?(tabId: string, path: string[]): unknown } }).setting;
			if (host?.openPagePath) {
				if (this.nativePage === page) { this.update(); return; }
				const path: string[] = [];
				let current: string = page;
				while (current !== 'main') {
					const entry = SETTINGS_SEARCH_PAGES.find(entry => entry.id === current);
					if (!entry) break;
					path.unshift(entry.name); current = entry.parent;
				}
				host.openPagePath(this.plugin.manifest.id, path);
				return;
			}
		}
		const { containerEl } = this;
		containerEl.empty();
		this.pendingGroup = null;
		const isSettingPage = page !== 'main';
		containerEl.toggleClass('setting-page', isSettingPage);
		const pageContainerEl = isSettingPage
			? containerEl.createDiv({ cls: 'setting-page-content' })
			: containerEl;
		this.renderPageContent(page, pageContainerEl);
		this.adoptNativeSettingDescriptions(containerEl);
	}

	private renderPageContent(page: string, pageContainerEl: HTMLElement): void {
		switch (page) {
			case 'main':             this.renderMainPage(pageContainerEl); break;
			case 'projects':         this.renderProjectsPage(pageContainerEl); break;
			case 'statistics-scope': this.renderStatisticsScopePage(pageContainerEl); break;
			case 'api':              this.renderApiPage(pageContainerEl); break;
			case 'control':          this.renderControlPage(pageContainerEl); break;
			case 'misc':             this.renderMiscPage(pageContainerEl); break;
			case 'divider':          this.renderDividerPage(pageContainerEl); break;
			case 'mobile-fonts':     this.renderMobileFontsPage(pageContainerEl); break;
			case 'autocomplete':     this.renderAutocompletePage(pageContainerEl); break;
			case 'substitutions':    this.renderTextSubstitutionPage(pageContainerEl); break;
			case 'copy':             this.renderCopyPage(pageContainerEl); break;
			case 'export':           this.renderExportPage(pageContainerEl); break;
			case 'char-count':       this.renderCharCountPage(pageContainerEl); break;
			case 'writing-time':     this.renderWritingTimePage(pageContainerEl); break;
			case 'typography':       this.renderDividerPage(pageContainerEl); break;
			case 'input':            this.renderAutocompletePage(pageContainerEl); break;
			case 'copy-export':      this.renderExportPage(pageContainerEl); break;
			case 'writing-stats':    this.renderCharCountPage(pageContainerEl); break;
			case 'time':             this.renderWritingTimePage(pageContainerEl); break;
			case 'calendar-chars':   this.renderCharCountPage(pageContainerEl); break;
			case 'snapshots':        this.renderSnapshotPage(pageContainerEl); break;
			case 'stopwatch':        this.renderStopwatchPage(pageContainerEl); break;
			case 'music':            this.renderMusicPage(pageContainerEl); break;
			case 'calendar':         this.renderCalendarPage(pageContainerEl); break;
			case 'wiki':             this.renderWikiPage(pageContainerEl); break;
			case 'plot':             this.renderPlotPage(pageContainerEl); break;
			case 'special-chars':    this.renderSpecialCharsPage(pageContainerEl); break;
			case 'spellcheck':       this.renderSpellCheckPage(pageContainerEl); break;
			case 'spellcheck-words': this.renderSpellCheckWordsPage(pageContainerEl); break;
			case 'repetition':       this.renderRepetitionPage(pageContainerEl); break;
			case 'ai':               this.renderAiPage(pageContainerEl); break;
		}
	}

	// ── 공통 UI 헬퍼 ───────────────────────────────────────────────────

	private addNavCard(box: HTMLElement, title: string, desc: string, _icon: string, page: string) {
		const setting = new Setting(box)
			.setName(title)
			.setDesc(desc);
		setting.settingEl.addClasses(['mod-navigable', 'tappable']);
		const chevronEl = setting.controlEl.createDiv({ cls: 'setting-item-chevron' });
		setIcon(chevronEl, 'chevron-right');
		setting.settingEl.setAttribute('role', 'button');
		setting.settingEl.tabIndex = 0;
		setting.settingEl.addEventListener('click', () => this.renderPage(page));
		setting.settingEl.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			this.renderPage(page);
		});
	}

	private addBackButton(containerEl: HTMLElement, title: string, parentPage = 'main') {
		if (this.renderingNativePage) return;
		const rootEl = containerEl.parentElement;
		if (!rootEl) return;
		const titlebarEl = rootEl.createDiv({ cls: 'setting-page-titlebar' });
		rootEl.insertBefore(titlebarEl, containerEl);
		const backButtonEl = titlebarEl.createDiv({ cls: 'clickable-icon setting-page-back-button' });
		setIcon(backButtonEl, 'chevron-left');
		backButtonEl.setAttribute('aria-label', '전체 설정으로 돌아가기');
		backButtonEl.addEventListener('click', () => this.renderPage(parentPage));
		titlebarEl.createDiv({ cls: 'setting-page-title', text: title });
	}

	private addGroupTitle(containerEl: HTMLElement, title: string) {
		const groupEl = containerEl.createDiv({ cls: 'setting-group' });
		const headingEl = groupEl.createDiv({ cls: 'setting-item setting-item-heading' });
		headingEl.createDiv({ cls: 'setting-item-name', text: title });
		headingEl.createDiv({ cls: 'setting-item-control' });
		groupEl.createDiv({ cls: 'setting-group-search', attr: { tabindex: '-1' } });
		const itemsEl = groupEl.createDiv({ cls: 'setting-items' });
		this.pendingGroup = { containerEl, itemsEl };
	}

	private createGroupBox(containerEl: HTMLElement): HTMLElement {
		if (this.pendingGroup?.containerEl === containerEl) {
			const { itemsEl } = this.pendingGroup;
			this.pendingGroup = null;
			return itemsEl;
		}

		const groupEl = containerEl.createDiv({ cls: 'setting-group' });
		groupEl.createDiv({ cls: 'setting-group-search', attr: { tabindex: '-1' } });
		return groupEl.createDiv({ cls: 'setting-items' });
	}

	private adoptNativeSettingDescriptions(containerEl: HTMLElement): void {
		for (const description of Array.from(containerEl.querySelectorAll<HTMLElement>('.wm-settings-item-desc'))) {
			const previous = description.previousElementSibling;
			const target = previous?.matches('.setting-item')
				? previous.querySelector<HTMLElement>('.setting-item-description')
				: null;
			if (target) {
				while (description.firstChild) target.appendChild(description.firstChild);
				description.remove();
				continue;
			}
			description.removeClass('wm-settings-item-desc');
			description.addClass('setting-item-description');
		}
	}

	// ── 메인 페이지 ────────────────────────────────────────────────────

	private renderMainPage(containerEl: HTMLElement) {
		const basicBox = this.createGroupBox(containerEl);
		this.addNavCard(basicBox, '프로젝트', '프로젝트를 관리할 폴더를 등록합니다.', 'folder-kanban', 'projects');
		this.addNavCard(basicBox, '통계 범위', '글자수와 작업시간 통계를 프로젝트별 폴더로 제한합니다.', 'chart-no-axes-combined', 'statistics-scope');
		this.addNavCard(basicBox, 'API', '플러그인에서 사용하는 API 키를 한곳에서 관리합니다.', 'key-round', 'api');
		this.addNavCard(basicBox, '제어', '플러그인의 토글 방식 설정을 한곳에서 관리합니다.', 'sliders-horizontal', 'control');
		this.addNavCard(basicBox, '스냅샷', '편집기와 플롯 매니저의 스냅샷을 관리합니다.', 'camera', 'snapshots');
		this.addNavCard(basicBox, '기타', '타이머와 맞춤법 검사 등 부가 기능을 관리합니다.', 'ellipsis', 'misc');

		this.addGroupTitle(containerEl, '편집기');
		const editorBox = this.createGroupBox(containerEl);
		this.addNavCard(editorBox, '플롯 매니저', '프로젝트별 플롯 시트와 기존 데이터 가져오기를 관리합니다.', 'table-2', 'plot');
		if (Platform.isMobile) this.addNavCard(editorBox, '모바일 글꼴', 'PC와 별도로 사용할 웹폰트를 선택하고 내려받습니다.', 'type', 'mobile-fonts');
		this.addNavCard(editorBox, '커스텀 구분선', '마크다운 구분선의 모양과 배치를 설정합니다.', 'minus', 'divider');
		this.addNavCard(editorBox, '자동 완성', '트리거와 자동 완성 기호를 관리합니다.', 'keyboard', 'autocomplete');
		this.addNavCard(editorBox, '텍스트 치환', '입력 중 자동으로 바꿀 문자열을 관리합니다.', 'replace', 'substitutions');
		this.addNavCard(editorBox, '복사', '헤딩과 각주를 제외하는 복사 동작을 설정합니다.', 'copy', 'copy');
		this.addNavCard(editorBox, '내보내기', 'TXT · HWP 내보내기 기본값을 설정합니다.', 'file-output', 'export');

		this.addGroupTitle(containerEl, '대시보드');
		const calBox = this.createGroupBox(containerEl);
		this.addNavCard(calBox, '일정', '일일노트와 연동해 Task를 시각적으로 보여줍니다.', 'calendar', 'calendar');
		this.addNavCard(calBox, '글자수', '목표 글자수와 일일 노트 기록 방식을 설정합니다.', 'text-cursor-input', 'char-count');
		this.addNavCard(calBox, '작업 시간', '작업 분류와 누적 시간 기록 방식을 설정합니다.', 'clock-3', 'writing-time');
		this.addNavCard(calBox, '위키', '위키 스타일 캐릭터 카드 설정', 'git-graph', 'wiki');
		this.addNavCard(calBox, '교정', '분석 엔진과 문단 분류 규칙을 관리합니다.', 'book-check', 'repetition');
		this.addNavCard(calBox, 'Deus AI', '작품 자료 조사와 캐릭터·묘사·대사·문장 스킬을 설정합니다.', 'bot', 'ai');
		this.addNavCard(calBox, '음악 플레이어', '음악 파일이 저장된 폴더를 관리합니다.', 'music', 'music');

	}

	private renderMobileFontsPage(containerEl: HTMLElement): void {
		this.addBackButton(containerEl, '모바일 글꼴');
		const box = this.createGroupBox(containerEl);
		new Setting(box).setName('모바일 전용 글꼴')
			.setDesc('PC 글꼴 선택은 유지합니다. 모바일의 프로젝트 문서 본문·제목·각주에 적용하며, 웹폰트는 선택할 때만 공식 배포처에 접속합니다.')
			.addDropdown(dropdown => {
				dropdown.addOption('inherit', '시스템 폰트');
				for (const font of MOBILE_WEB_FONTS) dropdown.addOption(font.id, font.name);
				dropdown.setValue(this.plugin.settings.mobileFontFamily || 'inherit').onChange(async value => {
					this.plugin.settings.mobileFontFamily = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(box).setName('다운로드 · 다시 시도')
			.setDesc('현재 기기에 글꼴을 보관합니다. 앱을 다시 열어도 저장된 글꼴을 먼저 사용합니다.')
			.addButton(button => button.setButtonText('내려받기').onClick(async () => {
				button.setDisabled(true);
				try {
					await this.plugin.mobileFonts.ensureSelected(containerEl.ownerDocument, true);
					new Notice(this.plugin.mobileFonts.cssFamily(containerEl.ownerDocument) !== 'inherit' ? '글꼴을 사용할 준비가 되었습니다.' : '시스템 글꼴을 사용합니다.');
				} finally { button.setDisabled(false); }
			}));
		const sources = this.createGroupBox(containerEl);
		for (const font of MOBILE_WEB_FONTS) new Setting(sources).setName(font.name).setDesc(font.source);
	}

	private renderMiscPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '기타');

		this.addGroupTitle(containerEl, '타이머');
		const timerBox = this.createGroupBox(containerEl);
		new Setting(timerBox)
			.setName('스톱워치')
			.setDesc('스톱워치의 기본값을 설정하세요.')
			.addText(text => {
				text.setValue(String(this.plugin.settings.stopwatchMinutes));
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
				text.onChange(async value => {
					const minutes = Number.parseInt(value, 10);
					if (!Number.isFinite(minutes) || minutes <= 0) return;
					this.plugin.settings.stopwatchMinutes = minutes;
					await this.plugin.saveSettings();
					if (!this.plugin.stopwatchInterval) {
						this.plugin.initStopwatch();
						this.plugin.updateStopwatchDisplay();
					}
				});
			});
		new Setting(timerBox)
			.setName('알람 소리')
			.setDesc('마감 효과음을 선택하세요.')
			.addDropdown(dropdown => dropdown
				.addOption('bell', '벨')
				.addOption('chime', '차임')
				.addOption('beep', '비프')
				.addOption('ding', '딩')
				.addOption('gong', '공')
				.setValue(this.plugin.settings.stopwatchAlarmSound)
				.onChange(async (value: 'bell' | 'chime' | 'beep' | 'ding' | 'gong') => {
					this.plugin.settings.stopwatchAlarmSound = value;
					await this.plugin.saveSettings();
					this.plugin.playAlarm();
				}));

		// Native child-page definitions already provide this heading and navigation row.
		if (!this.renderingNativePage) {
			this.addGroupTitle(containerEl, '맞춤법 검사');
			const spellcheckBox = this.createGroupBox(containerEl);
			this.addNavCard(spellcheckBox, '고유명사 관리', '등록한 고유명사를 검사에서 제외합니다.', 'list', 'spellcheck-words');
		}
	}

	private renderProjectsPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '프로젝트');
		const projects = this.plugin.settings.projects;

		if (projects.length === 0) {
			const emptyBox = this.createGroupBox(containerEl);
			new Setting(emptyBox)
				.setName('등록된 프로젝트가 없습니다')
				.setDesc('프로젝트 루트로 사용할 폴더를 등록하세요. 한 문서는 가장 구체적으로 일치하는 프로젝트에 속합니다.');
		}

		projects.forEach((project, index) => {
			this.addGroupTitle(containerEl, project.name || `프로젝트 ${index + 1}`);
			const projectBox = this.createGroupBox(containerEl);

			new Setting(projectBox)
				.setName('이름')
				.setDesc('대시보드와 통계에 표시할 프로젝트 이름입니다.')
				.addText(text => text
					.setPlaceholder(`프로젝트 ${index + 1}`)
					.setValue(project.name)
					.onChange(async value => {
						project.name = value.trim();
						await this.plugin.saveSettings();
					}));

			let folderText: import('obsidian').TextComponent;
			new Setting(projectBox)
				.setName('프로젝트 폴더')
				.setDesc('이 폴더와 모든 하위 폴더를 하나의 프로젝트로 취급합니다.')
				.addExtraButton(button => button
					.setIcon('folder')
					.setTooltip('폴더 선택')
					.onClick(() => {
						new FolderSuggestModal(this.app, folder => {
							fireAndForget(async () => {
								const duplicate = projects.some(item => item !== project && item.rootFolder === folder.path);
								if (duplicate) {
									new Notice('이미 등록된 프로젝트 폴더입니다.');
									return;
								}
								project.rootFolder = folder.path;
								if (!project.name.trim()) project.name = folder.name;
								folderText.setValue(folder.path);
								await this.plugin.saveSettings();
								await this.plugin.charStore.reinitSnapshot();
							});
						}).open();
					}))
				.addText(text => {
					folderText = text;
					text.setPlaceholder('예: 소설/작품명')
						.setValue(project.rootFolder)
						.onChange(async value => {
							project.rootFolder = value.trim().replace(/^\/+|\/+$/g, '');
							await this.plugin.saveSettings();
							await this.plugin.charStore.reinitSnapshot();
						});
				});

			const addProjectSubfolderSetting = (
				name: string,
				description: string,
				key: 'manuscriptFolder' | 'characterFolder',
				placeholder: string,
			) => {
				let pathText: import('obsidian').TextComponent;
				new Setting(projectBox)
					.setName(name)
					.setDesc(description)
					.addExtraButton(button => button
						.setIcon('folder')
						.setTooltip('폴더 선택')
						.onClick(() => {
							new FolderSuggestModal(this.app, folder => {
								const root = project.rootFolder.replace(/^\/+|\/+$/g, '');
								const inside = !root || folder.path === root || folder.path.startsWith(`${root}/`);
								if (!inside) {
									new Notice('프로젝트 폴더 안의 폴더를 선택해주세요.');
									return;
								}
								project[key] = folder.path;
								pathText.setValue(folder.path);
								void this.plugin.saveSettings();
							}).open();
						}))
					.addText(text => {
						pathText = text;
						text.setPlaceholder(placeholder)
							.setValue(project[key] ?? '')
							.onChange(async value => {
								project[key] = value.trim().replace(/^\/+|\/+$/g, '');
								await this.plugin.saveSettings();
							});
					});
			};

			addProjectSubfolderSetting(
				'본문 폴더',
				'플롯 행과 연결할 본문 노트를 만들 기본 폴더입니다.',
				'manuscriptFolder',
				project.rootFolder ? `${project.rootFolder}/본문` : '본문',
			);
			addProjectSubfolderSetting(
				'인물 폴더',
				'플롯 매니저에서 선택하거나 만들 인물 노트의 폴더입니다.',
				'characterFolder',
				project.rootFolder ? `${project.rootFolder}/인물` : '인물',
			);

			new Setting(projectBox)
				.setName('프로젝트 삭제')
				.setDesc('프로젝트 등록만 삭제하며 폴더와 문서는 삭제하지 않습니다.')
				.addButton(button => button
					.setButtonText('삭제')
					.setClass('mod-warning')
					.onClick(async () => {
						projects.splice(index, 1);
						await this.plugin.saveSettings();
						await this.plugin.charStore.reinitSnapshot();
						this.renderPage('projects');
					}));
		});

		const addBox = this.createGroupBox(containerEl);
		new Setting(addBox)
			.setName('프로젝트 추가')
			.setDesc('볼트 안의 폴더를 새 프로젝트로 등록합니다.')
			.addButton(button => button
				.setButtonText('폴더 선택')
				.setCta()
				.onClick(() => {
					new FolderSuggestModal(this.app, folder => {
						fireAndForget(async () => {
							if (projects.some(project => project.rootFolder === folder.path)) {
								new Notice('이미 등록된 프로젝트 폴더입니다.');
								return;
							}
							projects.push(this.plugin.projectContext.createProject(folder.path, folder.name));
							await this.plugin.saveSettings();
							await this.plugin.charStore.reinitSnapshot();
							this.renderPage('projects');
						});
					}).open();
				}));
	}

	private renderStatisticsScopePage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '통계 범위');
		const projects = this.plugin.settings.projects;
		const policyBox = this.createGroupBox(containerEl);
		new Setting(policyBox)
			.setName('프로젝트 내부만 집계')
			.setDesc('활성화하면 등록된 프로젝트의 통계 폴더에 속한 문서만 글자수와 작업시간에 반영합니다.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.restrictStatisticsToProjects)
				.onChange(async value => {
					this.plugin.settings.restrictStatisticsToProjects = value;
					await this.plugin.saveSettings();
					await this.plugin.charStore.reinitSnapshot();
				}));

		if (projects.length === 0) {
			const emptyBox = this.createGroupBox(containerEl);
			new Setting(emptyBox)
				.setName('먼저 프로젝트를 등록하세요')
				.setDesc('통계 범위는 등록된 프로젝트를 기준으로 구성됩니다.')
				.addButton(button => button
					.setButtonText('프로젝트 설정')
					.onClick(() => this.renderPage('projects')));
			return;
		}

		projects.forEach(project => {
			this.addGroupTitle(containerEl, project.name || '프로젝트');
			const scopeBox = this.createGroupBox(containerEl);
			new Setting(scopeBox)
				.setName('통계에 포함')
				.setDesc('이 프로젝트의 글자수와 작업시간을 집계합니다.')
				.addToggle(toggle => toggle
					.setValue(project.statisticsEnabled)
					.onChange(async value => {
						project.statisticsEnabled = value;
						await this.plugin.saveSettings();
						await this.plugin.charStore.reinitSnapshot();
					}));

			new Setting(scopeBox)
				.setName('집계 폴더')
				.setDesc(`볼트 기준 경로를 한 줄에 하나씩 입력합니다. 비워 두면 ${project.rootFolder || '볼트 루트'} 전체를 집계합니다.`)
				.addTextArea(textarea => textarea
					.setPlaceholder(project.rootFolder ? `${project.rootFolder}/원고` : '원고')
					.setValue((project.statisticsFolders ?? []).join('\n'))
					.onChange(async value => {
						project.statisticsFolders = value.split('\n').map(path => path.trim()).filter(Boolean);
						await this.plugin.saveSettings();
						await this.plugin.charStore.reinitSnapshot();
					}));

			new Setting(scopeBox)
				.setName('제외 폴더')
				.setDesc('참고자료나 임시 폴더처럼 통계에서 제외할 경로를 한 줄에 하나씩 입력합니다.')
				.addTextArea(textarea => textarea
					.setPlaceholder(project.rootFolder ? `${project.rootFolder}/참고자료` : '참고자료')
					.setValue((project.statisticsExcludeFolders ?? []).join('\n'))
					.onChange(async value => {
						project.statisticsExcludeFolders = value.split('\n').map(path => path.trim()).filter(Boolean);
						await this.plugin.saveSettings();
						await this.plugin.charStore.reinitSnapshot();
					}));
		});
	}

	private renderApiPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, 'API');
		const noticeBox = this.createGroupBox(containerEl);
		new Setting(noticeBox)
			.setName('API 키 저장 방식')
			.setDesc('API 키는 Obsidian 볼트의 플러그인 데이터에 저장됩니다. 별도의 암호화 저장소는 사용하지 않습니다.');

		this.addGroupTitle(containerEl, '국어사전');
		const dictionaryBox = this.createGroupBox(containerEl);
		new Setting(dictionaryBox)
			.setName('표준국어대사전')
			.setDesc('표준국어대사전 개발 지원에서 발급받은 무료 API 키입니다.')
			.addText(text => {
				text.setPlaceholder('API 키 입력')
					.setValue(this.plugin.settings.stdictApiKey)
					.onChange(async value => {
						this.plugin.settings.stdictApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				configureApiKeyInput(text.inputEl);
			});

		this.addGroupTitle(containerEl, 'AI');
		const aiBox = this.createGroupBox(containerEl);
		new Setting(aiBox)
			.setName('NVIDIA Build')
			.setDesc('NVIDIA에서 제공하는 AI 모델 호출에 사용합니다.')
			.addText(text => {
				text.setPlaceholder('nvapi-...')
					.setValue(this.plugin.settings.aiChatApiKey)
					.onChange(async value => {
						this.plugin.settings.aiChatApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				configureApiKeyInput(text.inputEl);
			});
		new Setting(aiBox)
			.setName('Google AI Studio')
			.setDesc('Gemini 채팅에 사용합니다.')
			.addText(text => {
				text.setPlaceholder('AIza...')
					.setValue(this.plugin.settings.aiChatGeminiApiKey)
					.onChange(async value => {
						this.plugin.settings.aiChatGeminiApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				configureApiKeyInput(text.inputEl);
			});

	}

	private renderControlPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '제어');
		const addToggle = (
			box: HTMLElement,
			name: string,
			description: string,
			value: boolean,
			onChange: (value: boolean) => void | Promise<void>,
		) => {
			new Setting(box)
				.setName(name)
				.setDesc(description)
				.addToggle(toggle => toggle
					.setValue(value)
					.onChange(async next => { await onChange(next); }));
		};

		this.addGroupTitle(containerEl, '편집');
		const editingBox = this.createGroupBox(containerEl);
		addToggle(editingBox, '커스텀 구분선', '마크다운 구분선을 지정한 텍스트 또는 SVG로 표시합니다.', this.plugin.settings.hrEnabled, async value => {
			this.plugin.settings.hrEnabled = value;
			await this.plugin.saveSettings();
			this.plugin.leafStyleManager.updateDynamicStyles();
		});
		addToggle(editingBox, '링크 색상', '마크다운 링크에 지정된 링크 색상을 적용합니다.', !this.plugin.settings.disableLinkColor, async value => {
			this.plugin.settings.disableLinkColor = !value;
			await this.plugin.saveSettings();
		});
		addToggle(editingBox, '한자', '한자 변환 시 괄호를 병기합니다.', this.plugin.settings.hanjaBracketMode, async value => {
			this.plugin.settings.hanjaBracketMode = value;
			await this.plugin.saveSettings();
		});
		addToggle(editingBox, '특수문자', '특수문자 삽입 후 창을 닫습니다.', this.plugin.settings.specialCharCloseOnInsert, async value => {
			this.plugin.settings.specialCharCloseOnInsert = value;
			await this.plugin.saveSettings();
		});

		this.addGroupTitle(containerEl, '자동 숨김');
		const viewBox = this.createGroupBox(containerEl);
		addToggle(viewBox, '마크다운', '마크다운 툴바를 자동으로 숨깁니다.', this.plugin.settings.markdownToolbarAutoHide, async value => {
			this.plugin.settings.markdownToolbarAutoHide = value;
			await this.plugin.saveSettings();
		});
		addToggle(viewBox, '페이지', '페이지 툴바를 자동으로 숨깁니다.', this.plugin.settings.pagedToolbarAutoHide, async value => {
			this.plugin.settings.pagedToolbarAutoHide = value;
			await this.plugin.saveSettings();
		});
		addToggle(viewBox, '위키', '위키 툴바를 자동으로 숨깁니다.', this.plugin.settings.wikiToolbarAutoHide, async value => {
			this.plugin.settings.wikiToolbarAutoHide = value;
			await this.plugin.saveSettings();
		});


		this.addGroupTitle(containerEl, '위젯');
		const widgetBox = this.createGroupBox(containerEl);
		addToggle(widgetBox, 'MUNPIA 글자수', '편집기 위젯에 문피아 기준 글자수를 표시합니다.', this.plugin.settings.showMunpiaWidget, async value => {
			this.plugin.settings.showMunpiaWidget = value;
			await this.plugin.saveSettings();
		});
		addToggle(widgetBox, 'NOVELPIA 글자수', '편집기 위젯에 노벨피아 기준 글자수를 표시합니다.', this.plugin.settings.showNovelpiaWidget, async value => {
			this.plugin.settings.showNovelpiaWidget = value;
			await this.plugin.saveSettings();
		});
		addToggle(widgetBox, '타이머/스톱워치', '편집기 위젯에 타이머 또는 스톱워치를 표시합니다.', this.plugin.settings.showTimerWidget, async value => {
			this.plugin.settings.showTimerWidget = value;
			await this.plugin.saveSettings();
		});

		this.addGroupTitle(containerEl, '통계');
		const statisticsBox = this.createGroupBox(containerEl);
		addToggle(statisticsBox, '작업 시간 추적', '통계 범위 안의 문서를 편집하는 시간을 기록합니다.', this.plugin.settings.enableTimeTracking, async value => {
			this.plugin.settings.enableTimeTracking = value;
			await this.plugin.saveSettings();
		});

		this.addGroupTitle(containerEl, '복사');
		const copyBox = this.createGroupBox(containerEl);
		addToggle(copyBox, '헤딩 제외', '복사할 때 헤딩을 항상 제외합니다.', this.plugin.settings.copyExcludeHeadings, async value => {
			this.plugin.settings.copyExcludeHeadings = value;
			await this.plugin.saveSettings();
		});
		addToggle(copyBox, '각주 제외', '복사할 때 각주를 항상 제외합니다.', this.plugin.settings.copyExcludeFootnotes, async value => {
			this.plugin.settings.copyExcludeFootnotes = value;
			await this.plugin.saveSettings();
		});

		this.addGroupTitle(containerEl, '내보내기');
		const exportBox = this.createGroupBox(containerEl);
		addToggle(exportBox, '들여쓰기', '내보낼 때 문단 들여쓰기를 기본으로 활성화합니다.', this.plugin.settings.exportDefaultSpaceIndent, async value => {
			this.plugin.settings.exportDefaultSpaceIndent = value;
			await this.plugin.saveSettings();
		});
		addToggle(exportBox, '헤딩 제외', '내보낼 때 헤딩을 항상 제외합니다.', this.plugin.settings.exportDefaultExcludeHeadings, async value => {
			this.plugin.settings.exportDefaultExcludeHeadings = value;
			await this.plugin.saveSettings();
		});
	}

	// ── 커스텀 구분선 ───────────────────────────────────────────────────
	private renderDividerPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '커스텀 구분선');

		const hrBox = this.createGroupBox(containerEl);
		const refreshDivider = () => this.plugin.leafStyleManager.updateDynamicStyles();

		new Setting(hrBox)
			.setName('종류')
			.setDesc('구분선을 텍스트 또는 SVG로 표시합니다.')
			.addDropdown(dropdown => dropdown
				.addOption('text', '텍스트')
				.addOption('svg', 'SVG')
				.setValue(this.plugin.settings.hrType)
				.onChange(async value => {
					this.plugin.settings.hrType = value as 'text' | 'svg';
					await this.plugin.saveSettings();
					refreshDivider();
				}));

		new Setting(hrBox)
			.setName('색상')
			.setDesc('비워 두면 테마의 기본 텍스트 색상을 사용합니다.')
			.addExtraButton(button => button
				.setIcon('reset')
				.setTooltip('기본값으로 초기화')
				.onClick(async () => {
					this.plugin.settings.hrColor = '';
					await this.plugin.saveSettings();
					refreshDivider();
					this.renderPage('divider');
				}))
			.addColorPicker(picker => picker
				.setValue(this.plugin.settings.hrColor || '#888888')
				.onChange(async value => {
					this.plugin.settings.hrColor = value;
					await this.plugin.saveSettings();
					refreshDivider();
				}));

		new Setting(hrBox)
			.setName('상하 여백(em)')
			.setDesc('구분선 상하 여백입니다.')
			.addText(text => {
				text.setPlaceholder('0.5')
					.setValue(String(this.plugin.settings.hrMargin ?? 0.5))
					.onChange(async value => {
						const parsed = Number.parseFloat(value);
						this.plugin.settings.hrMargin = Number.isFinite(parsed) ? Math.max(0, parsed) : 0.5;
						await this.plugin.saveSettings();
						refreshDivider();
					});
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
				text.inputEl.step = '0.1';
			});

		this.addGroupTitle(containerEl, '텍스트');
		const textBox = this.createGroupBox(containerEl);
		new Setting(textBox)
			.setName('내용')
			.setDesc('구분선 대신 표시할 내용을 입력하세요.')
			.addText(text => text
				.setPlaceholder('✦ ✦ ✦')
				.setValue(this.plugin.settings.hrContent)
				.onChange(async value => {
					this.plugin.settings.hrContent = value;
					await this.plugin.saveSettings();
					refreshDivider();
				}));

		const alignSetting = new Setting(textBox)
			.setName('정렬')
			.setDesc('구분선의 정렬값을 지정해주세요.');
		const alignControls = alignSetting.controlEl.createDiv({ cls: 'wm-align-btn-group' });
		(['left', 'center', 'right'] as const).forEach(align => {
			const icons = { left: 'align-left', center: 'align-center', right: 'align-right' } as const;
			const labels = { left: '왼쪽', center: '가운데', right: '오른쪽' } as const;
			const button = alignControls.createEl('button', {
				cls: `wm-align-btn${this.plugin.settings.hrAlign === align ? ' is-active' : ''}`,
				attr: { 'aria-label': labels[align] },
			});
			setIcon(button, icons[align]);
			button.addEventListener('click', () => {
				fireAndForget(async () => {
					this.plugin.settings.hrAlign = align;
					await this.plugin.saveSettings();
					refreshDivider();
					alignControls.querySelectorAll('.wm-align-btn').forEach(item => item.removeClass('is-active'));
					button.addClass('is-active');
				});
			});
		});

		this.addGroupTitle(containerEl, 'SVG');
		const svgBox = this.createGroupBox(containerEl);
		new Setting(svgBox)
			.setName('코드')
			.setDesc('구분선 대신 표시할 SVG 코드를 입력하세요.')
			.addTextArea(textarea => textarea
				.setPlaceholder('<svg xmlns="http://www.w3.org/2000/svg" ...>...</svg>')
				.setValue(this.plugin.settings.hrSvg)
				.onChange(async value => {
					this.plugin.settings.hrSvg = value;
					await this.plugin.saveSettings();
					refreshDivider();
				}));

		new Setting(svgBox)
			.setName('크기')
			.setDesc('SVG의 크기값(em)을 지정하세요.')
			.addText(text => {
				text.setPlaceholder('2')
					.setValue(String(this.plugin.settings.hrSvgSize ?? 2))
					.onChange(async value => {
						const parsed = Number.parseFloat(value);
						this.plugin.settings.hrSvgSize = Number.isFinite(parsed) ? Math.max(0.1, parsed) : 2;
						await this.plugin.saveSettings();
						refreshDivider();
					});
				text.inputEl.type = 'number';
				text.inputEl.min = '0.1';
				text.inputEl.step = '0.1';
			});
	}

	// ── 자동 완성 · 텍스트 치환 ─────────────────────────────────────────

	private renderAutocompletePage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '자동 완성');
		this.displaySymbolPairs(containerEl);
	}

	private renderTextSubstitutionPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '텍스트 치환');
		this.displayTextSubstitutions(containerEl);
	}

	// ── 복사 · 내보내기 ─────────────────────────────────────────────────

	private renderCopyPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '복사');
		const copyBox = this.createGroupBox(containerEl);
		new Setting(copyBox)
			.setName('헤딩 제외')
			.setDesc('복사할 때 헤딩을 항상 제외합니다.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.copyExcludeHeadings)
				.onChange(async value => {
					this.plugin.settings.copyExcludeHeadings = value;
					await this.plugin.saveSettings();
				}));
		new Setting(copyBox)
			.setName('각주 제외')
			.setDesc('복사할 때 각주를 항상 제외합니다.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.copyExcludeFootnotes)
				.onChange(async value => {
					this.plugin.settings.copyExcludeFootnotes = value;
					await this.plugin.saveSettings();
				}));
	}

	private renderExportPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '내보내기');
		const exportBox = this.createGroupBox(containerEl);
		if (Platform.isDesktop) {
			if (Platform.isDesktop && Platform.isWin) {
				new Setting(exportBox).setDesc('한컴오피스 한글, Python, pywin32 필요');

				let hwpPathText: import('obsidian').TextComponent;
				new Setting(exportBox)
					.setName('저장 경로(기본값)')
					.setDesc('비어 있으면 바탕화면에 저장됩니다.')
					.addExtraButton(btn => btn.setIcon('folder').setTooltip('폴더 선택')
						.onClick(async () => {
							const picked = await this.plugin.openFolderPicker();
							if (picked) { this.plugin.settings.hwpExportPath = picked; await this.plugin.saveSettings(); hwpPathText.setValue(picked); }
						}))
					.addText(text => {
						hwpPathText = text;
						text.setPlaceholder('C:\\Users\\사용자\\Desktop')
							.setValue(this.plugin.settings.hwpExportPath)
							.onChange(async value => { this.plugin.settings.hwpExportPath = value; await this.plugin.saveSettings(); });
					});

				let hwpTplText: import('obsidian').TextComponent;
				new Setting(exportBox)
					.setName('템플릿')
					.setDesc('HWP 문서를 템플릿 파일로 지정해 원하는 양식을 적용할 수 있습니다.')
					.addExtraButton(btn => btn.setIcon('document').setTooltip('파일 선택')
						.onClick(async () => {
							const picked = await this.plugin.openTemplatePicker();
							if (picked) { this.plugin.settings.hwpTemplatePath = picked; await this.plugin.saveSettings(); hwpTplText.setValue(picked); }
						}))
					.addText(text => {
						hwpTplText = text;
						text.setPlaceholder('C:\\path\\to\\template.hwp')
							.setValue(this.plugin.settings.hwpTemplatePath)
							.onChange(async value => { this.plugin.settings.hwpTemplatePath = value; await this.plugin.saveSettings(); });
					});
			}
		}
		new Setting(exportBox)
			.setName('들여쓰기')
			.setDesc('내보낼 때 문단 들여쓰기를 기본으로 활성화합니다.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.exportDefaultSpaceIndent)
				.onChange(async value => {
					this.plugin.settings.exportDefaultSpaceIndent = value;
					await this.plugin.saveSettings();
				}));
		new Setting(exportBox)
			.setName('헤딩 제외')
			.setDesc('내보낼 때 헤딩을 항상 제외합니다.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.exportDefaultExcludeHeadings)
				.onChange(async value => {
					this.plugin.settings.exportDefaultExcludeHeadings = value;
					await this.plugin.saveSettings();
				}));
	}

	// ── 작업 시간 ───────────────────────────────────────────────────────

	private renderStopwatchPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '타이머', 'misc');
		const swBox = this.createGroupBox(containerEl);

		new Setting(swBox).setName('스톱워치').setDesc('스톱워치의 기본값을 설정하세요.')
			.addText(text => text.setValue(String(this.plugin.settings.stopwatchMinutes))
				.onChange(async value => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.stopwatchMinutes = num;
						await this.plugin.saveSettings();
						if (!this.plugin.stopwatchInterval) {
							this.plugin.initStopwatch();
							this.plugin.updateStopwatchDisplay();
						}
					}
				}));

		new Setting(swBox).setName('알람 소리').setDesc('마감 효과음을 선택하세요.')
			.addDropdown(dropdown => dropdown
				.addOption('bell', '벨').addOption('chime', '차임').addOption('beep', '비프')
				.addOption('ding', '딩').addOption('gong', '공')
				.setValue(this.plugin.settings.stopwatchAlarmSound)
				.onChange(async (value: 'bell' | 'chime' | 'beep' | 'ding' | 'gong') => {
					this.plugin.settings.stopwatchAlarmSound = value;
					await this.plugin.saveSettings();
					this.plugin.playAlarm();
				}));
	}

	private renderCharCountPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '글자수');
		const charsBox = this.createGroupBox(containerEl);
		new Setting(charsBox)
			.setName('표시')
			.setDesc('카드에 표시할 플랫폼을 선택합니다.')
			.addDropdown(dd => dd
				.addOption('both', '문피아 + 노벨피아')
				.addOption('munpia', '문피아만')
				.addOption('novelpia', '노벨피아만')
				.setValue(this.plugin.settings.statCardDisplay ?? 'both')
				.onChange(async v => {
					this.plugin.settings.statCardDisplay = v as 'munpia' | 'novelpia' | 'both';
					await this.plugin.saveSettings();
					await this.plugin.refreshDashboardView();
				}));
		new Setting(charsBox)
			.setName('목표 글자수')
			.setDesc('대시보드 목표 막대에 표시할 일일 목표 글자수')
			.addText(t => {
				t.setPlaceholder('예: 2000')
				 .setValue(String(this.plugin.settings.writingGoalChars || 10000))
				 .onChange(async v => {
					const n = Math.max(1, parseInt(v) || 10000);
					this.plugin.settings.writingGoalChars = n;
					await this.plugin.saveSettings();
				 });
				t.inputEl.type = 'number';
				t.inputEl.min = '1';
			});
		new Setting(charsBox)
			.setName('기록')
			.setDesc('일일 노트에 누적 글자수를 기록할 프론트매터 키를 입력하세요.')
			.addText(text => {
				text.setPlaceholder('글자수')
					.setValue(this.plugin.settings.dailyCharCountKey ?? '글자수')
					.onChange(async value => {
						this.plugin.settings.dailyCharCountKey = value.trim() || '글자수';
						await this.plugin.saveSettings();
					});
				text.inputEl.addEventListener('blur', () => {
					fireAndForget(async () => {
						await this.plugin.charStore.syncTodayRecord();
						await this.plugin.charStore.refreshDailyHistory();
					});
				});
			});
	}

	private renderWritingTimePage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '작업 시간');
		this.addGroupTitle(containerEl, '분류');
		const modeBox = this.createGroupBox(containerEl);
		const modeGroup = modeBox.closest<HTMLElement>('.setting-group');
		modeGroup?.addClasses(['mod-list', 'mod-no-icon']);

		const ensureModes = () => {
			if (!this.plugin.settings.timeModes?.length) {
				this.plugin.settings.timeModes = [
					{ id: 'draft',   label: '기획', icon: 'lightbulb',  frontmatterKey: '초고_시간', goalSeconds: 7200 },
					{ id: 'writing', label: '초고', icon: 'pencil',      frontmatterKey: '집필_시간', goalSeconds: 7200 },
					{ id: 'editing', label: '퇴고', icon: 'spell-check', frontmatterKey: '퇴고_시간', goalSeconds: 7200 },
				];
			}
			return this.plugin.settings.timeModes;
		};

		const renderModeList = () => {
			modeBox.empty();
			const modes = ensureModes();
			for (const [i, m] of modes.entries()) {
				const setting = new Setting(modeBox)
					.setName(`분류 ${i + 1}`)
					.addText(t => {
						t.setPlaceholder('표시명').setValue(m.label);
						t.inputEl.addClass('wm-mode-label-input');
						t.onChange(async v => { m.label = v; await this.plugin.saveSettings(); });
					})
					.addText(t => {
						t.setPlaceholder('아이콘 (Lucide)').setValue(m.icon ?? '');
						t.inputEl.addClass('wm-mode-icon-input');
						t.onChange(async v => { m.icon = v.trim() || undefined; await this.plugin.saveSettings(); });
					})
					.addText(t => {
						t.setPlaceholder('프론트매터 키').setValue(m.frontmatterKey);
						t.inputEl.addClass('wm-mode-key-input');
						t.onChange(async v => { m.frontmatterKey = v.trim(); await this.plugin.saveSettings(); });
					})
					.addText(t => {
						t.setPlaceholder('목표(분)').setValue(String(Math.round(m.goalSeconds / 60)));
						t.inputEl.type = 'number';
						t.inputEl.min  = '0';
						t.inputEl.addClass('wm-mode-goal-input');
						t.onChange(async v => {
							m.goalSeconds = (parseInt(v) || 0) * 60;
							await this.plugin.saveSettings();
						});
						const wrap = createDiv({ cls: 'wm-mode-goal-wrap' });
						t.inputEl.parentElement?.insertBefore(wrap, t.inputEl);
						wrap.appendChild(t.inputEl);
						wrap.createSpan({ cls: 'wm-mode-goal-unit', text: '분' });
					})
					.addExtraButton(btn => btn.setIcon('x').setTooltip('삭제')
						.onClick(async () => {
							if (modes.length <= 1) return;
							modes.splice(i, 1);
							if (this.plugin.settings.currentTimeMode === m.id)
								this.plugin.settings.currentTimeMode = modes[0].id;
							await this.plugin.saveSettings();
							renderModeList();
						}));
				setting.settingEl.addClasses(['wm-mode-setting-row', 'setting-list-item']);
			}
		};
		const addModeHost = modeGroup?.querySelector<HTMLElement>(':scope > .setting-item-heading > .setting-item-control') ?? modeBox;
		const addModeIcon = addModeHost.createDiv({ cls: 'clickable-icon wm-muted-icon' });
		setIcon(addModeIcon, 'plus');
		addModeIcon.setAttribute('aria-label', '분류 추가');
		addModeIcon.addEventListener('click', () => {
			fireAndForget(async () => {
				const newId = `mode_${Date.now()}`;
				ensureModes().push({ id: newId, label: '', frontmatterKey: '', goalSeconds: 0 });
				await this.plugin.saveSettings();
				renderModeList();
			});
		});
		renderModeList();

		this.addGroupTitle(containerEl, '기록');
		const totalBox = this.createGroupBox(containerEl);
		new Setting(totalBox)
			.setName('누적 시간')
			.setDesc('작업 시간의 합계를 기록할 프론트매터 키를 입력해주세요.')
			.addText(t => t
				.setPlaceholder('총_시간')
				.setValue(this.plugin.settings.timeTotalKey ?? '총_시간')
				.onChange(async v => {
					this.plugin.settings.timeTotalKey = v.trim() || '총_시간';
					await this.plugin.saveSettings();
				}));
	}

	// ── 음악 플레이어 ────────────────────────────────────────────────────

	private renderMusicPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '음악 플레이어');

		this.addGroupTitle(containerEl, '폴더');
		const folderBox = this.createGroupBox(containerEl);
		const folderGroup = folderBox.closest<HTMLElement>('.setting-group');
		folderGroup?.addClasses(['mod-list', 'mod-no-icon']);
		const paths = this.plugin.settings.musicFolderPaths ?? [];

		const renderFolderList = () => {
			folderBox.empty();
			paths.forEach((p, idx) => {
				const setting = new Setting(folderBox)
					.setName('폴더')
					.setDesc('음악 파일이 저장된 폴더를 지정하세요.')
					.addText(text => text
						.setPlaceholder('Music/BGM')
						.setValue(p)
						.onChange(async (v) => {
							paths[idx] = v.trim();
							this.plugin.settings.musicFolderPaths = paths;
							await this.plugin.saveSettings();
							this.plugin.musicPlayer?.loadPlaylist().catch(() => {});
						}))
					.addExtraButton(btn => btn
						.setIcon('x').setTooltip('삭제')
						.onClick(async () => {
							paths.splice(idx, 1);
							this.plugin.settings.musicFolderPaths = paths;
							await this.plugin.saveSettings();
							this.plugin.musicPlayer?.loadPlaylist().catch(() => {});
							renderFolderList();
						}));
				setting.settingEl.addClass('setting-list-item');
			});
		};
		renderFolderList();
		const addFolderHost = folderGroup?.querySelector<HTMLElement>(':scope > .setting-item-heading > .setting-item-control') ?? folderBox;
		const addFolderIcon = addFolderHost.createDiv({ cls: 'clickable-icon wm-muted-icon' });
		setIcon(addFolderIcon, 'plus');
		addFolderIcon.setAttribute('aria-label', '폴더 추가');
		addFolderIcon.addEventListener('click', () => { paths.push(''); renderFolderList(); });
	}

	private renderAiPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, 'Deus AI');
		renderDeusSettings(this.plugin, {
			section: title => { this.addGroupTitle(containerEl, title); return this.createGroupBox(containerEl); },
			openApi: () => this.renderPage('api'),
		});
	}

	private renderSnapshotPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '스냅샷');
		this.addGroupTitle(containerEl, '편집기');
		const box = this.createGroupBox(containerEl);
		new Setting(box).setName('저장 위치').setDesc('기존 기록은 유지됩니다. 폴더를 바꾸면 이전 기록을 자동 이동하지 않습니다.')
			.addText(text => text.setValue(this.plugin.settings.snapshotStoragePath).onChange(async value => {
				const root = value.trim() || '.writing-menu-versions';
				if (/^[\\\\/]|:/.test(root) || root.split('/').some(part => !part || part === '.' || part === '..')) return;
				this.plugin.settings.snapshotStoragePath = root; await this.plugin.saveSettings();
			}));
		new Setting(box).setName('최근 기록 표시 개수').setDesc('이전 기록은 삭제하지 않습니다. 스냅샷 창의 보관 기록에서 확인할 수 있습니다.')
			.addText(text => text.setValue(String(this.plugin.settings.snapshotMaxCount)).onChange(async value => {
				const count = Number(value);
				if (Number.isInteger(count) && count >= 10 && count <= 200) { this.plugin.settings.snapshotMaxCount = count; await this.plugin.saveSettings(); }
			}));
		this.addGroupTitle(containerEl, '플롯 매니저');
		renderPlotSnapshotSettings(this.createGroupBox(containerEl), this.plugin);
	}

	// ── 캘린더 설정 ─────────────────────────────────────────────────────

	private renderCalendarPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '일정');
		const taskBox = this.createGroupBox(containerEl);
		new Setting(taskBox)
			.setName('일일 노트')
			.setDesc('일일 노트의 경로(헤딩)을 지정하세요. 대시보드에서 추가한 할 일이 해당 경로에 기록됩니다.')
			.addText(t => t
				.setPlaceholder('할 일')
				.setValue(this.plugin.settings.taskAddHeader ?? '할 일')
				.onChange(async v => {
					this.plugin.settings.taskAddHeader = v.trim() || '할 일';
					await this.plugin.saveSettings();
				}));

	}

	// ── 위키 ────────────────────────────────────────────────────────────

	private renderWikiPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '위키');
		renderWikiSettingsPage(containerEl, this.plugin, () => this.renderPage('wiki'));
	}

	private renderPlotPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '플롯 매니저');
		renderPlotWorkbookSettingsPage(containerEl, this.plugin);
	}

	// ── 특수문자 ─────────────────────────────────────────────────────────

	private renderSpecialCharsPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '특수문자');

		// 즐겨찾기 섹션
		const favs = this.plugin.settings.specialCharFavorites ?? [];
		const favHdr = new Setting(containerEl).setName('즐겨찾기').setHeading();
		const favHdrBtns = favHdr.controlEl;
		if (favs.length > 0) {
			const trashFavs = favHdrBtns.createDiv({ cls: 'clickable-icon wm-muted-icon' });
			setIcon(trashFavs, 'trash-2');
			trashFavs.setAttribute('aria-label', '전체 삭제');
			trashFavs.addEventListener('click', () => {
				fireAndForget(async () => {
					this.plugin.settings.specialCharFavorites = [];
					await this.plugin.saveSettings();
					this.renderPage('special-chars');
				});
			});
		}
		const favBox = this.createGroupBox(containerEl);
		if (favs.length === 0) {
			new Setting(favBox).setDesc('특수문자 모달에서 ★를 클릭해 즐겨찾기를 추가하세요.');
		} else {
			for (const ch of favs) {
				new Setting(favBox)
					.setName(ch)
					.addExtraButton(btn => btn
						.setIcon('x')
						.setTooltip('제거')
						.onClick(async () => {
							const idx = this.plugin.settings.specialCharFavorites.indexOf(ch);
							if (idx >= 0) this.plugin.settings.specialCharFavorites.splice(idx, 1);
							await this.plugin.saveSettings();
							this.renderPage('special-chars');
						}));
			}
		}

		// 사용자 지정 섹션
		const customs = this.plugin.settings.specialCharCustom ?? [];
		const customHdr = new Setting(containerEl).setName('사용자 지정').setHeading();
		const customHdrBtns = customHdr.controlEl;

		const popup = containerEl.createDiv({ cls: 'wm-sc-add-popup wm-sc-add-popup-right wm-sc-add-popup-up is-hidden' });
		const charRow = popup.createDiv({ cls: 'wm-sc-add-row' });
		const charInput = charRow.createEl('input', { attr: { type: 'text', placeholder: '특수문자', maxlength: '4' } });
		const descRow = popup.createDiv({ cls: 'wm-sc-add-row' });
		const descInput = descRow.createEl('input', { attr: { type: 'text', placeholder: '이름 또는 설명' } });
		const submitBtn = popup.createEl('button', { cls: 'wm-sc-add-submit', text: '추가' });

		let popupOpen = false;
		const showPopup = () => { popup.removeClass('is-hidden'); popupOpen = true; charInput.focus(); };
		const hidePopup = () => { popup.addClass('is-hidden'); popupOpen = false; };

		const doAdd = async () => {
			const char = charInput.value.trim();
			const desc = descInput.value.trim();
			if (!char) { charInput.focus(); return; }
			const list = this.plugin.settings.specialCharCustom ?? [];
			if (!list.some(c => c.char === char)) {
				list.push({ char, desc });
				this.plugin.settings.specialCharCustom = list;
				await this.plugin.saveSettings();
			}
			charInput.value = '';
			descInput.value = '';
			hidePopup();
			this.renderPage('special-chars');
		};

		submitBtn.addEventListener('click', () => fireAndForget(doAdd));
		descInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') fireAndForget(doAdd); });
		charInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') descInput.focus(); });

		if (customs.length > 0) {
			const trashCustoms = customHdrBtns.createDiv({ cls: 'clickable-icon wm-muted-icon' });
			setIcon(trashCustoms, 'trash-2');
			trashCustoms.setAttribute('aria-label', '전체 삭제');
			trashCustoms.addEventListener('click', () => {
				fireAndForget(async () => {
					this.plugin.settings.specialCharCustom = [];
					await this.plugin.saveSettings();
					this.renderPage('special-chars');
				});
			});
		}
		const customBox = this.createGroupBox(containerEl);
		if (customs.length === 0) {
			new Setting(customBox).setDesc('아래 + 버튼으로 특수문자를 지정하세요.');
		} else {
			for (let i = 0; i < customs.length; i++) {
				const item = customs[i];
				new Setting(customBox)
					.setName(item.char)
					.setDesc(item.desc ?? '')
					.addExtraButton(btn => btn
						.setIcon('x')
						.setTooltip('제거')
						.onClick(async () => {
							this.plugin.settings.specialCharCustom.splice(i, 1);
							await this.plugin.saveSettings();
							this.renderPage('special-chars');
						}));
			}
		}
		const addIconRow = containerEl.createDiv({ cls: 'wm-settings-group-add-row' });
		const addWrap = addIconRow.createDiv({ cls: 'wm-sc-add-wrap' });
		const addBtn = addWrap.createDiv({ cls: 'clickable-icon wm-muted-icon' });
		setIcon(addBtn, 'plus');
		addWrap.appendChild(popup);
		addBtn.addEventListener('click', (e) => { e.stopPropagation(); if (popupOpen) hidePopup(); else showPopup(); });
		activeDocument.addEventListener('mousedown', (e) => {
			if (popupOpen && !addWrap.contains(e.target as Node)) hidePopup();
		});
	}

	// ── 맞춤법 검사 ─────────────────────────────────────────────────────────

	private renderSpellCheckPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '맞춤법 검사', 'misc');

		this.addGroupTitle(containerEl, '고유명사');
		const spellcheckBox = this.createGroupBox(containerEl);
		this.addNavCard(spellcheckBox, '고유명사 관리', '등록한 고유명사를 검사에서 제외합니다.', 'list', 'spellcheck-words');
	}

	private renderSpellCheckWordsPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '고유명사 목록', 'misc');

		const ignoredHdr = new Setting(containerEl).setName('고유명사').setHeading();
		const ignoredHdrBtns = ignoredHdr.controlEl;

		const ignoredWords: string[] = this.plugin.settings.spellCheckIgnoredWords ?? [];
		const ignoredBox = this.createGroupBox(containerEl);
		const ignoredGroup = ignoredBox.closest<HTMLElement>('.setting-group');
		ignoredGroup?.addClasses(['mod-list', 'mod-no-icon']);

		const addWord = async (word: string) => {
			const normalized = word.trim();
			if (!normalized || ignoredWords.includes(normalized)) return;
			ignoredWords.push(normalized);
			this.plugin.settings.spellCheckIgnoredWords = ignoredWords;
			await this.plugin.saveSettings();
			this.renderPage('spellcheck-words');
		};
		const showAddRow = () => {
			if (ignoredBox.querySelector('.wm-spellcheck-add-row')) return;
			const addRow = new Setting(ignoredBox).setName('고유명사 추가');
			addRow.settingEl.addClasses(['setting-list-item', 'wm-spellcheck-add-row']);
			addRow.addText(text => {
				text.setPlaceholder('단어 입력 후 Enter');
				text.inputEl.addEventListener('keydown', event => {
					if (event.key === 'Enter') void addWord(text.getValue());
					if (event.key === 'Escape') addRow.settingEl.remove();
				});
				window.setTimeout(() => text.inputEl.focus(), 0);
			});
		};
		const addButton = ignoredHdrBtns.createDiv({ cls: 'clickable-icon wm-muted-icon' });
		setIcon(addButton, 'plus');
		addButton.setAttribute('aria-label', '고유명사 추가');
		addButton.addEventListener('click', showAddRow);

		if (ignoredWords.length === 0) {
			new Setting(ignoredBox)
				.setName('등록된 고유명사가 없습니다.')
				.setDesc('오른쪽 위의 + 버튼을 눌러 추가하세요.');
		} else {
			for (const word of ignoredWords) {
				const row = new Setting(ignoredBox)
					.setName(word)
					.addExtraButton(button => button
						.setIcon('x')
						.setTooltip('삭제')
						.onClick(async () => {
							const index = ignoredWords.indexOf(word);
							if (index >= 0) ignoredWords.splice(index, 1);
							this.plugin.settings.spellCheckIgnoredWords = ignoredWords;
							await this.plugin.saveSettings();
							this.renderPage('spellcheck-words');
						}));
				row.settingEl.addClass('setting-list-item');
			}
		}
	}

	// ── 교정 ────────────────────────────────────────────────────────
	private renderRepetitionPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '교정');
		const repetitionBox = this.createGroupBox(containerEl);

		if (isMorphAnalysisSupported()) {
			const modelSetting = new Setting(repetitionBox)
				.setName('오프라인 형태소 분석 모델')
				.setDesc('확인 중…');
			const setGaruDescription = (status: string) => {
				modelSetting.descEl.empty();
				modelSetting.descEl.createEl('a', {
					text: 'Garu',
					href: 'https://github.com/ongjin/garu',
					attr: { target: '_blank', rel: 'noopener' },
				});
				modelSetting.descEl.appendText(` · ${status}`);
			};
			setGaruDescription('확인 중…');
			fireAndForget(async () => {
				const assetStatus = await getGaruAssetStatus(this.plugin);
				const downloaded = assetStatus === 'current';
				setGaruDescription(downloaded
					? `v${GARU_VERSION} 설치 완료 · 완전히 오프라인으로 동작합니다.`
					: assetStatus === 'outdated'
						? `새 엔진 v${GARU_VERSION} 업데이트가 있습니다.`
						: `반복 표현 탐지에 필요합니다. 최초 1회만 다운로드하면 됩니다 (약 1.6MB).`);
				if (downloaded) {
					modelSetting.addExtraButton(btn => {
						btn.setIcon('check').setTooltip('다운로드됨').setDisabled(true);
						btn.extraSettingsEl.addClass('wm-settings-status-success');
					});
				} else {
					modelSetting.addButton(btn => btn.setButtonText(assetStatus === 'outdated' ? '업데이트' : '다운로드').setCta()
						.onClick(() => {
							fireAndForget(async () => {
								btn.setDisabled(true);
								try {
									await downloadGaruAssets(this.plugin, step => { btn.setButtonText(step); });
									this.renderPage('repetition');
								} catch (e) {
									btn.setDisabled(false).setButtonText(assetStatus === 'outdated' ? '업데이트' : '다운로드');
									modelSetting.descEl.appendText(` · 실패: ${e instanceof Error ? e.message : String(e)}`);
								}
							});
						}));
				}
			});
		}

		this.addGroupTitle(containerEl, '문단 분석');
		const paragraphBox = this.createGroupBox(containerEl);
		const options = this.plugin.settings.paragraphAnalysis;
		new Setting(paragraphBox).setName('문단 구분').addDropdown(select => select.addOptions({ line: '줄바꿈마다', block: '빈 줄로 나눈 Markdown 블록' }).setValue(options.boundary).onChange(async value => { options.boundary = value as typeof options.boundary; await this.plugin.saveSettings(); }));
		new Setting(paragraphBox).setName('공백 포함').addToggle(toggle => toggle.setValue(options.countSpaces).onChange(async value => { options.countSpaces = value; await this.plugin.saveSettings(); }));
		const kinds = { narration: '서술', dialogue: '대사', monologue: '독백', special: '특수 대사' };
		for (const [key, title] of [['singleQuote', '작은따옴표'], ['roundBracket', '소괄호']] as const) new Setting(paragraphBox).setName(title).addDropdown(select => select.addOptions(kinds).setValue(options[key]).onChange(async value => { options[key] = value as typeof options[typeof key]; await this.plugin.saveSettings(); }));
	}

	// ── 자동완성 심볼 ────────────────────────────────────────────────────

	displaySymbolPairs(container: HTMLElement) {
		container.empty();
		this.addGroupTitle(container, '목록');
		const list = this.createGroupBox(container);
		const listGroup = list.closest<HTMLElement>('.setting-group');
		listGroup?.addClasses(['mod-list', 'mod-no-icon']);
		const addHost = listGroup?.querySelector<HTMLElement>(':scope > .setting-item-heading > .setting-item-control') ?? list;
		const addButton = addHost.createDiv({ cls: 'clickable-icon wm-muted-icon' });
		setIcon(addButton, 'plus');
		addButton.setAttribute('aria-label', '자동 완성 추가');
		addButton.addEventListener('click', () => {
			fireAndForget(async () => {
			this.plugin.settings.symbolTriggers.push({ trigger: '', options: [{ open: '', close: '' }], enabled: true });
			await this.plugin.saveSettings();
			this.displaySymbolPairs(container);
			const inputs = container.querySelectorAll<HTMLInputElement>('.wm-autocomplete-trigger-input');
			inputs.item(inputs.length - 1)?.focus();
			});
		});

		if (this.plugin.settings.symbolTriggers.length === 0) {
			new Setting(list)
				.setName('등록된 자동 완성이 없습니다.')
				.setDesc('오른쪽 위의 + 버튼을 눌러 추가하세요.');
			return;
		}

		this.plugin.settings.symbolTriggers.forEach((trigger, tIndex) => {
			const setting = new Setting(list);
			setting.settingEl.addClasses(['setting-list-item', 'wm-autocomplete-setting-row']);
			setting.settingEl.toggleClass('wm-row-disabled', trigger.enabled === false);
			setting.infoEl.remove();
			setting.controlEl.empty();

			const header = setting.controlEl.createDiv({ cls: 'wm-autocomplete-rule-header' });
			new ToggleComponent(header)
				.setValue(trigger.enabled !== false)
				.onChange(async value => {
					trigger.enabled = value;
					setting.settingEl.toggleClass('wm-row-disabled', !value);
					await this.plugin.saveSettings();
				});
			const triggerInput = header.createEl('input', {
				type: 'text',
				value: trigger.trigger,
				cls: 'wm-autocomplete-trigger-input',
			});
			triggerInput.placeholder = '트리거';
			triggerInput.onchange = async () => {
				trigger.trigger = triggerInput.value;
				await this.plugin.saveSettings();
			};
			const deleteButton = header.createDiv({ cls: 'clickable-icon wm-muted-icon wm-autocomplete-delete-button' });
			setIcon(deleteButton, 'trash-2');
			deleteButton.setAttribute('aria-label', '자동 완성 삭제');
			deleteButton.onclick = async () => {
				this.plugin.settings.symbolTriggers.splice(tIndex, 1);
				await this.plugin.saveSettings();
				this.displaySymbolPairs(container);
			};

			const pairs = setting.controlEl.createDiv({ cls: 'wm-autocomplete-pairs' });
			trigger.options.forEach((opt, oIndex) => {
				const row = pairs.createDiv({ cls: 'wm-autocomplete-pair-row' });
				const open = row.createEl('input', { type: 'text', value: opt.open, cls: 'wm-autocomplete-pair-input' });
				open.placeholder = '열기';
				open.onchange = async () => { opt.open = open.value; await this.plugin.saveSettings(); };

				row.createSpan({ text: '→', cls: 'wm-substitution-arrow' });

				const close = row.createEl('input', { type: 'text', value: opt.close, cls: 'wm-autocomplete-pair-input' });
				close.placeholder = '닫기';
				close.onchange = async () => { opt.close = close.value; await this.plugin.saveSettings(); };

				const rm = row.createDiv({ cls: 'clickable-icon wm-muted-icon' });
				setIcon(rm, 'x');
				rm.setAttribute('aria-label', '기호 삭제');
				rm.onclick = async () => { trigger.options.splice(oIndex, 1); await this.plugin.saveSettings(); this.displaySymbolPairs(container); };
			});

			const addPairButton = pairs.createDiv({ cls: 'wm-autocomplete-pair-add' });
			const addPairIcon = addPairButton.createSpan({ cls: 'wm-autocomplete-pair-add-icon' });
			setIcon(addPairIcon, 'plus');
			addPairButton.createSpan({ text: '기호 추가' });
			addPairButton.setAttribute('role', 'button');
			addPairButton.tabIndex = 0;
			const addPair = async () => {
				trigger.options.push({ open: '', close: '' });
				await this.plugin.saveSettings();
				this.displaySymbolPairs(container);
			};
			addPairButton.onclick = () => { void addPair(); };
			addPairButton.addEventListener('keydown', event => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				void addPair();
			});
		});
	}

	// ── 텍스트 치환 ─────────────────────────────────────────────────────

	displayTextSubstitutions(container: HTMLElement) {
		container.empty();
		this.addGroupTitle(container, '목록');
		const list = this.createGroupBox(container);
		const listGroup = list.closest<HTMLElement>('.setting-group');
		listGroup?.addClasses(['mod-list', 'mod-no-icon']);
		const addHost = listGroup?.querySelector<HTMLElement>(':scope > .setting-item-heading > .setting-item-control') ?? list;
		const addButton = addHost.createDiv({ cls: 'clickable-icon wm-muted-icon' });
		setIcon(addButton, 'plus');
		addButton.setAttribute('aria-label', '텍스트 치환 추가');
		addButton.addEventListener('click', () => {
			fireAndForget(async () => {
			this.plugin.settings.textSubstitutions.push({ from: '', to: '', enabled: true });
			await this.plugin.saveSettings();
			this.displayTextSubstitutions(container);
			const inputs = container.querySelectorAll<HTMLInputElement>('.wm-substitution-input');
			inputs.item(Math.max(0, inputs.length - 2))?.focus();
			});
		});

		if (this.plugin.settings.textSubstitutions.length === 0) {
			new Setting(list)
				.setName('등록된 텍스트 치환이 없습니다.')
				.setDesc('오른쪽 위의 + 버튼을 눌러 추가하세요.');
			return;
		}

		this.plugin.settings.textSubstitutions.forEach((sub, index) => {
			const setting = new Setting(list)
				.setName(String(index + 1))
				.addToggle(toggle => toggle
					.setValue(sub.enabled)
					.onChange(async value => {
						sub.enabled = value;
						setting.settingEl.toggleClass('wm-row-disabled', !value);
						await this.plugin.saveSettings();
					}))
				.addText(text => {
					text.setPlaceholder('입력')
						.setValue(sub.from)
						.onChange(async value => {
							sub.from = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.addClass('wm-substitution-input');
				});
			setting.controlEl.createSpan({ text: '→', cls: 'wm-substitution-arrow' });
			setting.addText(text => {
				text.setPlaceholder('변환')
					.setValue(sub.to)
					.onChange(async value => {
						sub.to = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('wm-substitution-input');
			});
			setting.addExtraButton(button => button
				.setIcon('trash-2')
				.setTooltip('삭제')
				.onClick(async () => {
					this.plugin.settings.textSubstitutions.splice(index, 1);
					await this.plugin.saveSettings();
					this.displayTextSubstitutions(container);
				}));
			setting.settingEl.addClasses(['setting-list-item', 'wm-substitution-setting-row']);
			setting.settingEl.toggleClass('wm-row-disabled', !sub.enabled);
		});
	}
}
