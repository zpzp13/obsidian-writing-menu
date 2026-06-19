import { App, PluginSettingTab, Setting, setIcon, Platform } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { renderWikiSettingsPage } from '../wiki/WikiSettings';


export class WritingMenuSettingTab extends PluginSettingTab {
	plugin: WritingMenuPlugin;

	constructor(app: App, plugin: WritingMenuPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.renderPage('main');
	}

	// ── 페이지 라우터 (항상 this.containerEl 기준) ─────────────────────

	public renderPage(page: string) {
		const { containerEl } = this;
		containerEl.empty();
		switch (page) {
			case 'main':             this.renderMainPage(containerEl); break;
			case 'typography':       this.renderTypographyPage(containerEl); break;
			case 'input':            this.renderInputPage(containerEl); break;
			case 'copy-export':      this.renderCopyExportPage(containerEl); break;
			case 'writing-stats':    this.renderWritingStatsPage(containerEl); break;
			case 'time':             this.renderWritingStatsPage(containerEl); break;
			case 'calendar-chars':   this.renderWritingStatsPage(containerEl); break;
			case 'dictionary':       this.renderDictionaryPage(containerEl); break;
			case 'version-control':  this.renderVersionPage(containerEl); break;
			case 'stopwatch':         this.renderStopwatchPage(containerEl); break;
			case 'music':             this.renderMusicPage(containerEl); break;
			case 'calendar':         this.renderCalendarPage(containerEl); break;
			case 'wiki':             this.renderWikiPage(containerEl); break;
		}
	}

	// ── 공통 UI 헬퍼 ───────────────────────────────────────────────────

	private addNavCard(box: HTMLElement, title: string, desc: string, icon: string, page: string) {
		const card = box.createDiv({ cls: 'wm-settings-nav-card' });
		const iconEl = card.createDiv({ cls: 'wm-settings-nav-card-icon' });
		setIcon(iconEl, icon);
		const body = card.createDiv({ cls: 'wm-settings-nav-card-body' });
		body.createEl('div', { cls: 'wm-settings-nav-card-title', text: title });
		body.createEl('div', { cls: 'wm-settings-nav-card-desc', text: desc });
		const chevron = card.createDiv({ cls: 'wm-settings-nav-card-chevron' });
		setIcon(chevron, 'chevron-right');
		card.addEventListener('click', () => this.renderPage(page));
	}

	private addBackButton(containerEl: HTMLElement, title: string) {
		const btn = containerEl.createDiv({ cls: 'wm-settings-back-btn' });
		const iconEl = btn.createSpan();
		setIcon(iconEl, 'chevron-left');
		btn.createEl('span', { text: title });
		btn.addEventListener('click', () => this.renderPage('main'));
	}

	private addGroupTitle(containerEl: HTMLElement, title: string) {
		containerEl.createDiv({ cls: 'wm-settings-group-title', text: title });
	}

	private createGroupBox(containerEl: HTMLElement): HTMLElement {
		return containerEl.createDiv({ cls: 'wm-settings-group-box' });
	}

	// ── 메인 페이지 ────────────────────────────────────────────────────

	private renderMainPage(containerEl: HTMLElement) {
		this.addGroupTitle(containerEl, '편집기');
		const editorBox = this.createGroupBox(containerEl);
		this.addNavCard(editorBox, '서식', '글꼴 · 크기 · 행간 · 색상 · 헤딩 · 각주', 'type', 'typography');
		this.addNavCard(editorBox, '입력 보조', '스마트 입력, 자동완성 기호, 텍스트 치환', 'keyboard', 'input');
		this.addNavCard(editorBox, '복사 및 내보내기', '복사 옵션, TXT · HWP 내보내기', 'file-output', 'copy-export');

		this.addGroupTitle(containerEl, '대시보드');
		const calBox = this.createGroupBox(containerEl);
		this.addNavCard(calBox, '캘린더 & 일정 관리', '할 일 헤더 설정', 'calendar', 'calendar');
		this.addNavCard(calBox, '글자수 & 작업 시간', '추적 폴더, 목표 글자수, 작업 모드 설정', 'activity', 'writing-stats');
		this.addNavCard(calBox, '버전 관리', '스냅샷 저장 위치 및 최대 보관 개수', 'history', 'version-control');
		this.addNavCard(calBox, '위키 뷰', '위키 스타일 캐릭터 카드 뷰 설정', 'git-graph', 'wiki');

		this.addGroupTitle(containerEl, '기타');
		const etcBox = this.createGroupBox(containerEl);
		this.addNavCard(etcBox, '스톱워치', '카운트다운 시간 · 알람 설정', 'timer', 'stopwatch');
		this.addNavCard(etcBox, '사전', '표준국어대사전 API 키', 'book-open', 'dictionary');
		this.addNavCard(etcBox, '음악 플레이어', '음악 폴더 · 볼륨 · 재생 모드', 'music', 'music');
	}

	// ── 서식 ────────────────────────────────────────────────────────────

	private renderTypographyPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '서식');

		// ── 인라인 ──────────────────────────────────────────────────
		this.addGroupTitle(containerEl, '인라인');
		const inlineBox = this.createGroupBox(containerEl);

		new Setting(inlineBox)
			.setName('글꼴')
			.setDesc('비워두면 Obsidian 기본 글꼴 사용')
			.addText(text => text
				.setPlaceholder('inherit')
				.setValue(this.plugin.settings.fontFamily === 'inherit' ? '' : this.plugin.settings.fontFamily)
				.onChange(async value => {
					this.plugin.settings.fontFamily = value.trim() || 'inherit';
					await this.plugin.saveSettings();
				}));

		new Setting(inlineBox)
			.setName('글자 크기 (px)')
			.addText(text => {
				text.setPlaceholder('16')
					.setValue(String(this.plugin.settings.fontSize))
					.onChange(async value => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) { this.plugin.settings.fontSize = num; await this.plugin.saveSettings(); }
					});
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
			});

		new Setting(inlineBox)
			.setName('줄간격')
			.addText(text => {
				text.setPlaceholder('1.5')
					.setValue(String(this.plugin.settings.lineHeight))
					.onChange(async value => {
						const num = parseFloat(value);
						if (!isNaN(num) && num > 0) { this.plugin.settings.lineHeight = num; await this.plugin.saveSettings(); }
					});
				text.inputEl.type = 'number';
				text.inputEl.step = '0.1';
				text.inputEl.min = '0';
			});

		new Setting(inlineBox)
			.setName('문단간격')
			.addText(text => {
				text.setPlaceholder('1')
					.setValue(String(this.plugin.settings.paragraphSpacing))
					.onChange(async value => {
						const num = parseFloat(value);
						if (!isNaN(num) && num >= 0) { this.plugin.settings.paragraphSpacing = num; await this.plugin.saveSettings(); }
					});
				text.inputEl.type = 'number';
				text.inputEl.step = '0.5';
				text.inputEl.min = '0';
			});

		new Setting(inlineBox)
			.setName('너비 (px)')
			.addText(text => {
				text.setPlaceholder('700')
					.setValue(String(this.plugin.settings.lineWidth))
					.onChange(async value => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) { this.plugin.settings.lineWidth = num; await this.plugin.saveSettings(); }
					});
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
			});

		new Setting(inlineBox)
			.setName('좌우 여백 (px)')
			.addText(text => {
				text.setPlaceholder('40')
					.setValue(String(this.plugin.settings.inlinePadding ?? 40))
					.onChange(async value => {
						const num = parseInt(value);
						if (!isNaN(num) && num >= 0) { this.plugin.settings.inlinePadding = num; await this.plugin.saveSettings(); }
					});
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
			});

		new Setting(inlineBox)
			.setName('들여쓰기 (px)')
			.addText(text => {
				text.setPlaceholder('0')
					.setValue(String(this.plugin.settings.indentation))
					.onChange(async value => {
						const num = parseInt(value);
						if (!isNaN(num) && num >= 0) { this.plugin.settings.indentation = num; await this.plugin.saveSettings(); }
					});
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
			});

		// 글자색
		const fontColorVal = this.plugin.settings.fontColor;
		const fontColorLight = typeof fontColorVal === 'string' ? fontColorVal : fontColorVal.light;
		const fontColorDark  = typeof fontColorVal === 'string' ? fontColorVal : fontColorVal.dark;

		if (!Platform.isMobile) {
			new Setting(inlineBox)
				.setName('글자색 (라이트)')
				.addColorPicker(cp => cp
					.setValue(fontColorLight === 'inherit' || !fontColorLight ? '#000000' : fontColorLight)
					.onChange(async value => {
						const dark = typeof this.plugin.settings.fontColor === 'string' ? this.plugin.settings.fontColor : this.plugin.settings.fontColor.dark;
						this.plugin.settings.fontColor = { light: value, dark };
						await this.plugin.saveSettings();
					}))
				.addExtraButton(btn => btn.setIcon('reset').setTooltip('기본값으로 초기화')
					.onClick(async () => {
						const dark = typeof this.plugin.settings.fontColor === 'string' ? this.plugin.settings.fontColor : this.plugin.settings.fontColor.dark;
						this.plugin.settings.fontColor = { light: 'inherit', dark };
						await this.plugin.saveSettings();
						this.renderPage('typography');
					}));

			new Setting(inlineBox)
				.setName('글자색 (다크)')
				.addColorPicker(cp => cp
					.setValue(fontColorDark === 'inherit' || !fontColorDark ? '#ffffff' : fontColorDark)
					.onChange(async value => {
						const light = typeof this.plugin.settings.fontColor === 'string' ? this.plugin.settings.fontColor : this.plugin.settings.fontColor.light;
						this.plugin.settings.fontColor = { light, dark: value };
						await this.plugin.saveSettings();
					}))
				.addExtraButton(btn => btn.setIcon('reset').setTooltip('기본값으로 초기화')
					.onClick(async () => {
						const light = typeof this.plugin.settings.fontColor === 'string' ? this.plugin.settings.fontColor : this.plugin.settings.fontColor.light;
						this.plugin.settings.fontColor = { light, dark: 'inherit' };
						await this.plugin.saveSettings();
						this.renderPage('typography');
					}));
		} else {
			new Setting(inlineBox).setName('글자색 (라이트)')
				.addText(text => text.setPlaceholder('#000000 또는 inherit').setValue(fontColorLight)
					.onChange(async value => {
						const dark = typeof this.plugin.settings.fontColor === 'string' ? this.plugin.settings.fontColor : this.plugin.settings.fontColor.dark;
						this.plugin.settings.fontColor = { light: value || 'inherit', dark };
						await this.plugin.saveSettings();
					}));
			new Setting(inlineBox).setName('글자색 (다크)')
				.addText(text => text.setPlaceholder('#ffffff 또는 inherit').setValue(fontColorDark)
					.onChange(async value => {
						const light = typeof this.plugin.settings.fontColor === 'string' ? this.plugin.settings.fontColor : this.plugin.settings.fontColor.light;
						this.plugin.settings.fontColor = { light, dark: value || 'inherit' };
						await this.plugin.saveSettings();
					}));
		}

		// 배경색
		const bgColorVal = this.plugin.settings.backgroundColor;
		const bgColorLight = typeof bgColorVal === 'string' ? bgColorVal : bgColorVal.light;
		const bgColorDark  = typeof bgColorVal === 'string' ? bgColorVal : bgColorVal.dark;

		if (!Platform.isMobile) {
			new Setting(inlineBox)
				.setName('배경색 (라이트)')
				.addColorPicker(cp => cp
					.setValue(bgColorLight === 'transparent' || bgColorLight === 'inherit' || !bgColorLight ? '#ffffff' : bgColorLight)
					.onChange(async value => {
						const dark = typeof this.plugin.settings.backgroundColor === 'string' ? this.plugin.settings.backgroundColor : this.plugin.settings.backgroundColor.dark;
						this.plugin.settings.backgroundColor = { light: value, dark };
						await this.plugin.saveSettings();
					}))
				.addExtraButton(btn => btn.setIcon('reset').setTooltip('기본값으로 초기화')
					.onClick(async () => {
						const dark = typeof this.plugin.settings.backgroundColor === 'string' ? this.plugin.settings.backgroundColor : this.plugin.settings.backgroundColor.dark;
						this.plugin.settings.backgroundColor = { light: 'transparent', dark };
						await this.plugin.saveSettings();
						this.renderPage('typography');
					}));

			new Setting(inlineBox)
				.setName('배경색 (다크)')
				.addColorPicker(cp => cp
					.setValue(bgColorDark === 'transparent' || bgColorDark === 'inherit' || !bgColorDark ? '#000000' : bgColorDark)
					.onChange(async value => {
						const light = typeof this.plugin.settings.backgroundColor === 'string' ? this.plugin.settings.backgroundColor : this.plugin.settings.backgroundColor.light;
						this.plugin.settings.backgroundColor = { light, dark: value };
						await this.plugin.saveSettings();
					}))
				.addExtraButton(btn => btn.setIcon('reset').setTooltip('기본값으로 초기화')
					.onClick(async () => {
						const light = typeof this.plugin.settings.backgroundColor === 'string' ? this.plugin.settings.backgroundColor : this.plugin.settings.backgroundColor.light;
						this.plugin.settings.backgroundColor = { light, dark: 'transparent' };
						await this.plugin.saveSettings();
						this.renderPage('typography');
					}));
		} else {
			new Setting(inlineBox).setName('배경색 (라이트)')
				.addText(text => text.setPlaceholder('#ffffff 또는 transparent').setValue(bgColorLight)
					.onChange(async value => {
						const dark = typeof this.plugin.settings.backgroundColor === 'string' ? this.plugin.settings.backgroundColor : this.plugin.settings.backgroundColor.dark;
						this.plugin.settings.backgroundColor = { light: value || 'transparent', dark };
						await this.plugin.saveSettings();
					}));
			new Setting(inlineBox).setName('배경색 (다크)')
				.addText(text => text.setPlaceholder('#000000 또는 transparent').setValue(bgColorDark)
					.onChange(async value => {
						const light = typeof this.plugin.settings.backgroundColor === 'string' ? this.plugin.settings.backgroundColor : this.plugin.settings.backgroundColor.light;
						this.plugin.settings.backgroundColor = { light, dark: value || 'transparent' };
						await this.plugin.saveSettings();
					}));
		}

		new Setting(inlineBox)
			.setName('링크 색상')
			.setDesc('비활성화 시 링크 색상을 일반 텍스트 색상으로 표시')
			.addToggle(toggle => toggle
				.setValue(!this.plugin.settings.disableLinkColor)
				.onChange(async value => { this.plugin.settings.disableLinkColor = !value; await this.plugin.saveSettings(); }));

		new Setting(inlineBox)
			.setName('폴더별 적용')
			.setDesc('지정한 폴더의 노트에만 서식을 적용합니다. 비워두면 전체 적용.')
			.addText(text => text
				.setPlaceholder('예: 소설/집필')
				.setValue(this.plugin.settings.applyToFolder)
				.onChange(async value => { this.plugin.settings.applyToFolder = value.trim(); await this.plugin.saveSettings(); }));

		// ── 헤딩 ────────────────────────────────────────────────────
		this.addGroupTitle(containerEl, '헤딩');
		containerEl.createDiv({ cls: 'wm-settings-subgroup-title', text: 'H1' });
		const h1Box = this.createGroupBox(containerEl);

		new Setting(h1Box)
			.setName('글꼴')
			.addText(text => text
				.setPlaceholder('inherit')
				.setValue(this.plugin.settings.h1FontFamily)
				.onChange(async value => {
					this.plugin.settings.h1FontFamily = value || 'inherit';
					await this.plugin.saveSettings();
				}));

		new Setting(h1Box)
			.setName('크기 (px)')
			.addText(text => text
				.setPlaceholder('24')
				.setValue(String(this.plugin.settings.h1FontSize))
				.onChange(async value => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) { this.plugin.settings.h1FontSize = num; await this.plugin.saveSettings(); }
				}));

		new Setting(h1Box)
			.setName('행간')
			.addText(text => text
				.setPlaceholder('1.5')
				.setValue(String(this.plugin.settings.h1LineHeight))
				.onChange(async value => {
					const num = parseFloat(value);
					if (!isNaN(num) && num > 0) { this.plugin.settings.h1LineHeight = num; await this.plugin.saveSettings(); }
				}));

		new Setting(h1Box)
			.setName('색상')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.h1Color === 'inherit' || !this.plugin.settings.h1Color ? '#000000' : this.plugin.settings.h1Color)
				.onChange(async value => { this.plugin.settings.h1Color = value; await this.plugin.saveSettings(); }))
			.addExtraButton(btn => btn
				.setIcon('reset').setTooltip('기본값으로 초기화')
				.onClick(async () => {
					this.plugin.settings.h1Color = 'inherit';
					await this.plugin.saveSettings();
					this.renderPage('typography');
				}));

		// ── 각주 ────────────────────────────────────────────────────
		this.addGroupTitle(containerEl, '각주');
		const fnBox = this.createGroupBox(containerEl);

		new Setting(fnBox)
			.setName('글꼴')
			.addText(text => text
				.setPlaceholder('inherit')
				.setValue(this.plugin.settings.footnoteFontFamily)
				.onChange(async value => {
					this.plugin.settings.footnoteFontFamily = value || 'inherit';
					await this.plugin.saveSettings();
				}));

		new Setting(fnBox)
			.setName('크기 (px)')
			.addText(text => text
				.setPlaceholder('13')
				.setValue(String(this.plugin.settings.footnoteFontSize))
				.onChange(async value => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) { this.plugin.settings.footnoteFontSize = num; await this.plugin.saveSettings(); }
				}));

		new Setting(fnBox)
			.setName('행간')
			.addText(text => text
				.setPlaceholder('1.5')
				.setValue(String(this.plugin.settings.footnoteLineHeight))
				.onChange(async value => {
					const num = parseFloat(value);
					if (!isNaN(num) && num > 0) { this.plugin.settings.footnoteLineHeight = num; await this.plugin.saveSettings(); }
				}));

		new Setting(fnBox)
			.setName('색상')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.footnoteColor === 'inherit' || !this.plugin.settings.footnoteColor ? '#000000' : this.plugin.settings.footnoteColor)
				.onChange(async value => { this.plugin.settings.footnoteColor = value; await this.plugin.saveSettings(); }))
			.addExtraButton(btn => btn
				.setIcon('reset').setTooltip('기본값으로 초기화')
				.onClick(async () => {
					this.plugin.settings.footnoteColor = 'inherit';
					await this.plugin.saveSettings();
					this.renderPage('typography');
				}));
	}

	// ── 입력 보조 ───────────────────────────────────────────────────────

	private renderInputPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '입력 보조');

		this.addGroupTitle(containerEl, '스마트 입력');
		const smartBox = this.createGroupBox(containerEl);

		new Setting(smartBox)
			.setName('스마트 따옴표')
			.setDesc('곧은 따옴표("")를 둥근 따옴표(“”)로 자동 변환')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableSmartQuotes)
				.onChange(async value => { this.plugin.settings.enableSmartQuotes = value; await this.plugin.saveSettings(); }));

		new Setting(smartBox)
			.setName('스마트 엔터')
			.setDesc('괄호 안에서 엔터 입력 시 닫는 괄호 아래로 커서 이동')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableSmartEnter)
				.onChange(async value => { this.plugin.settings.enableSmartEnter = value; await this.plugin.saveSettings(); }));

		new Setting(smartBox)
			.setName('자동완성')
			.setDesc('트리거 키 입력 시 기호 쌍 팝업 표시')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableSmartInput)
				.onChange(async value => { this.plugin.settings.enableSmartInput = value; await this.plugin.saveSettings(); }));

		new Setting(smartBox)
			.setName('텍스트 치환')
			.setDesc('특정 텍스트를 다른 문자로 자동 변환')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableTextSubstitution)
				.onChange(async value => { this.plugin.settings.enableTextSubstitution = value; await this.plugin.saveSettings(); }));

		this.addGroupTitle(containerEl, '자동완성 기호');
		this.displaySymbolPairs(containerEl.createDiv({ cls: 'wm-settings-input-section' }));

		this.addGroupTitle(containerEl, '텍스트 치환');
		this.displayTextSubstitutions(containerEl.createDiv({ cls: 'wm-settings-input-section' }));
	}

	// ── 복사 및 내보내기 ────────────────────────────────────────────────

	private renderCopyExportPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '복사 및 내보내기');

		this.addGroupTitle(containerEl, '복사 옵션');
		const copyBox = this.createGroupBox(containerEl);

		new Setting(copyBox).setName('헤딩 제외').setDesc('Alt+C 복사 시 H1을 제외합니다.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.copyExcludeHeadings)
				.onChange(async value => { this.plugin.settings.copyExcludeHeadings = value; await this.plugin.saveSettings(); }));

		new Setting(copyBox).setName('각주 제외').setDesc('Alt+C 복사 시 각주 정의 및 참조를 제외합니다.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.copyExcludeFootnotes)
				.onChange(async value => { this.plugin.settings.copyExcludeFootnotes = value; await this.plugin.saveSettings(); }));

		if (Platform.isDesktopApp) {
			this.addGroupTitle(containerEl, '내보내기 기본값');
			const exportBox = this.createGroupBox(containerEl);

			new Setting(exportBox).setName('문단 들여쓰기').setDesc('내보내기 시 문단 들여쓰기를 기본으로 활성화합니다.')
				.addToggle(toggle => toggle.setValue(this.plugin.settings.exportDefaultSpaceIndent)
					.onChange(async value => { this.plugin.settings.exportDefaultSpaceIndent = value; await this.plugin.saveSettings(); }));

			new Setting(exportBox).setName('헤딩 제외').setDesc('내보내기 시 헤딩 제외를 기본으로 활성화합니다.')
				.addToggle(toggle => toggle.setValue(this.plugin.settings.exportDefaultExcludeHeadings)
					.onChange(async value => { this.plugin.settings.exportDefaultExcludeHeadings = value; await this.plugin.saveSettings(); }));

			if (Platform.isWin) {
				this.addGroupTitle(containerEl, 'HWP 변환');

				const reqNote = containerEl.createDiv();
				reqNote.setCssStyles({ 'fontSize': '12px', 'color': 'var(--text-muted)', 'marginBottom': '8px', 'padding': '0 2px' });
				reqNote.textContent = '한컴오피스 한글, Python, pywin32 필요';

				const hwpBox = this.createGroupBox(containerEl);

				new Setting(hwpBox)
					.setName('기본 저장 경로')
					.setDesc('비어 있으면 바탕화면에 저장됩니다.')
					.addText(text => text
						.setPlaceholder('C:\\Users\\사용자\\Desktop')
						.setValue(this.plugin.settings.hwpExportPath)
						.onChange(async value => { this.plugin.settings.hwpExportPath = value; await this.plugin.saveSettings(); }))
					.addExtraButton(btn => btn.setIcon('folder').setTooltip('폴더 선택')
						.onClick(async () => {
							const picked = await this.plugin.openFolderPicker();
							if (picked) { this.plugin.settings.hwpExportPath = picked; await this.plugin.saveSettings(); this.renderPage('copy-export'); }
						}));

				new Setting(hwpBox)
					.setName('템플릿 파일')
					.setDesc('스타일을 적용할 HWP 템플릿 (선택사항)')
					.addText(text => text
						.setPlaceholder('C:\\path\\to\\template.hwp')
						.setValue(this.plugin.settings.hwpTemplatePath)
						.onChange(async value => { this.plugin.settings.hwpTemplatePath = value; await this.plugin.saveSettings(); }))
					.addExtraButton(btn => btn.setIcon('document').setTooltip('파일 선택')
						.onClick(async () => {
							const picked = await this.plugin.openTemplatePicker();
							if (picked) { this.plugin.settings.hwpTemplatePath = picked; await this.plugin.saveSettings(); this.renderPage('copy-export'); }
						}));
			}
		}
	}

	// ── 작업 시간 ───────────────────────────────────────────────────────

	private renderStopwatchPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '스톱워치');

		this.addGroupTitle(containerEl, '스톱워치');
		const swBox = this.createGroupBox(containerEl);

		new Setting(swBox).setName('기본 시간 (분)').setDesc('카운트다운 기본 시간')
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

		new Setting(swBox).setName('알람 활성화').setDesc('카운트다운이 끝나면 알람 소리를 재생합니다.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.enableStopwatchAlarm)
				.onChange(async value => { this.plugin.settings.enableStopwatchAlarm = value; await this.plugin.saveSettings(); }));

		new Setting(swBox).setName('알람 소리')
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

	private renderWritingStatsPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '글자수 & 작업 시간');

		// ── 공통 ──
		this.addGroupTitle(containerEl, '공통');
		const commonBox = this.createGroupBox(containerEl);
		new Setting(commonBox)
			.setName('추적 폴더')
			.setDesc('글자수 히트맵·작업시간 추적에 사용할 폴더. 비워 두면 전체 노트를 집계합니다.')
			.addText(t => t
				.setPlaceholder('예: 소설/집필')
				.setValue(this.plugin.settings.trackingFolder ?? '')
				.onChange(async v => {
					this.plugin.settings.trackingFolder = v.trim();
					await this.plugin.saveSettings();
				}));
		new Setting(commonBox)
			.setName('시간 추적 제외 폴더')
			.setDesc('작업시간 기록에서 제외할 폴더 경로. 한 줄에 하나씩 입력.')
			.addTextArea(t => t
				.setPlaceholder('예:\n소설작품/임시\n소설작품/참고자료')
				.setValue((this.plugin.settings.timeExcludeFolders ?? []).join('\n'))
				.onChange(async v => {
					this.plugin.settings.timeExcludeFolders = v.split('\n').map(s => s.trim()).filter(Boolean);
					await this.plugin.saveSettings();
				}));

		// ── 글자수 ──
		this.addGroupTitle(containerEl, '글자수');
		const charsBox = this.createGroupBox(containerEl);
		new Setting(charsBox)
			.setName('글자수 플랫폼')
			.setDesc('히트맵·일평균·목표 비교에 사용할 글자수 기준을 선택합니다.')
			.addDropdown(dd => dd
				.addOption('munpia', '문피아 기준')
				.addOption('novelpia', '노벨피아 기준')
				.setValue(this.plugin.settings.charCountMode ?? 'munpia')
				.onChange(async v => {
					this.plugin.settings.charCountMode = v as 'munpia' | 'novelpia';
					await this.plugin.saveSettings();
				}));
		new Setting(charsBox)
			.setName('스탯카드 표시')
			.setDesc('stat 카드에 표시할 플랫폼을 선택합니다.')
			.addDropdown(dd => dd
				.addOption('both', '문피아 + 노벨피아')
				.addOption('munpia', '문피아만')
				.addOption('novelpia', '노벨피아만')
				.setValue(this.plugin.settings.statCardDisplay ?? 'both')
				.onChange(async v => {
					this.plugin.settings.statCardDisplay = v as 'munpia' | 'novelpia' | 'both';
					await this.plugin.saveSettings();
				}));
		new Setting(charsBox)
			.setName('목표 글자수')
			.setDesc('일일 목표 글자수 (0 = 비활성)')
			.addText(t => {
				t.setPlaceholder('예: 2000')
				 .setValue(String(this.plugin.settings.writingGoalChars ?? 0))
				 .onChange(async v => {
					const n = parseInt(v) || 0;
					this.plugin.settings.writingGoalChars = n;
					await this.plugin.saveSettings();
				 });
				t.inputEl.type = 'number';
				t.inputEl.min = '0';
			});
		new Setting(charsBox)
			.setName('데일리노트 글자수 키')
			.setDesc('하루가 끝나면 당일 데일리노트 프론트매터에 기록할 키 이름.')
			.addText(t => t
				.setPlaceholder('글자수')
				.setValue(this.plugin.settings.dailyCharCountKey ?? '글자수')
				.onChange(async v => {
					this.plugin.settings.dailyCharCountKey = v.trim() || '글자수';
					await this.plugin.saveSettings();
				}));

		// ── 작업 시간 ──
		this.addGroupTitle(containerEl, '작업 모드');
		const modeBox = this.createGroupBox(containerEl);

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
					.setName(`모드 ${i + 1}`)
					.addText(t => {
						t.setPlaceholder('표시명').setValue(m.label);
						t.inputEl.setCssStyles({ width: '65px' });
						t.onChange(async v => { m.label = v; await this.plugin.saveSettings(); });
					})
					.addText(t => {
						t.setPlaceholder('아이콘 (Lucide)').setValue(m.icon ?? '');
						t.inputEl.setCssStyles({ width: '100px' });
						t.onChange(async v => { m.icon = v.trim() || undefined; await this.plugin.saveSettings(); });
					})
					.addText(t => {
						t.setPlaceholder('프론트매터 키').setValue(m.frontmatterKey);
						t.inputEl.setCssStyles({ width: '110px' });
						t.onChange(async v => { m.frontmatterKey = v.trim(); await this.plugin.saveSettings(); });
					})
					.addText(t => {
						t.setPlaceholder('목표(분)').setValue(String(Math.round(m.goalSeconds / 60)));
						t.inputEl.type = 'number';
						t.inputEl.min  = '0';
						t.inputEl.setCssStyles({ width: '65px' });
						t.onChange(async v => {
							m.goalSeconds = (parseInt(v) || 0) * 60;
							await this.plugin.saveSettings();
						});
					})
					.addExtraButton(btn => btn.setIcon('trash').setTooltip('삭제')
						.onClick(async () => {
							if (modes.length <= 1) return;
							modes.splice(i, 1);
							if (this.plugin.settings.currentTimeMode === m.id)
								this.plugin.settings.currentTimeMode = modes[0].id;
							await this.plugin.saveSettings();
							renderModeList();
						}));
				setting.settingEl.setCssStyles({ flexWrap: 'wrap' });
			}
		};
		renderModeList();

		new Setting(containerEl)
			.addButton(btn => btn.setButtonText('+ 모드 추가')
				.onClick(async () => {
					const newId = `mode_${Date.now()}`;
					ensureModes().push({ id: newId, label: '', frontmatterKey: '', goalSeconds: 0 });
					await this.plugin.saveSettings();
					renderModeList();
				}));

		this.addGroupTitle(containerEl, '총 시간 키');
		const totalBox = this.createGroupBox(containerEl);
		new Setting(totalBox).setName('총 시간 프론트매터 키')
			.addText(t => t
				.setPlaceholder('총_시간')
				.setValue(this.plugin.settings.timeTotalKey ?? '총_시간')
				.onChange(async v => {
					this.plugin.settings.timeTotalKey = v.trim() || '총_시간';
					await this.plugin.saveSettings();
				}));

		this.addGroupTitle(containerEl, '평균 기준 폴더');
		const avgBox = this.createGroupBox(containerEl);
		new Setting(avgBox)
			.setName('평균 기준 상위 폴더 단계')
			.setDesc('0 = 추적 노트의 직속 폴더, 1 = 한 단계 위 폴더, … (추적 노트 기준, 노트 없으면 히트맵 폴더 사용)')
			.addSlider(s => s.setLimits(0, 5, 1)
				.setValue(this.plugin.settings.timeAvgFolderLevel ?? 0)
				.onChange(async v => { this.plugin.settings.timeAvgFolderLevel = v; await this.plugin.saveSettings(); }));

	}

	// ── 음악 플레이어 ────────────────────────────────────────────────────

	private renderMusicPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '음악 플레이어');

		this.addGroupTitle(containerEl, '음악 폴더');
		const folderBox = this.createGroupBox(containerEl);
		const paths = this.plugin.settings.musicFolderPaths ?? [];

		const renderFolderList = () => {
			folderBox.empty();
			paths.forEach((p, idx) => {
				new Setting(folderBox)
					.setName(`폴더 ${idx + 1}`)
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
			});
			new Setting(folderBox)
				.addButton(btn => btn
					.setButtonText('+ 폴더 추가')
					.onClick(() => { paths.push(''); renderFolderList(); }));
		};
		renderFolderList();

		this.addGroupTitle(containerEl, '재생 설정');
		const playBox = this.createGroupBox(containerEl);

		new Setting(playBox)
			.setName('재생 모드')
			.addDropdown(dd => dd
				.addOption('loop', '반복')
				.addOption('single', '한 곡 반복')
				.addOption('shuffle', '랜덤')
				.setValue(this.plugin.settings.musicPlaybackMode ?? 'loop')
				.onChange(async (v) => {
					const m = v as 'loop' | 'single' | 'shuffle';
					this.plugin.settings.musicPlaybackMode = m;
					await this.plugin.saveSettings();
					this.plugin.musicPlayer?.setMode(m);
				}));

		new Setting(playBox)
			.setName('즐겨찾기 최대 표시 수')
			.setDesc('재생목록 팝업에서 즐겨찾기를 최대 몇 개까지 표시할지 설정합니다')
			.addSlider(sl => sl
				.setLimits(1, 50, 1)
				.setValue(this.plugin.settings.musicFavoritesMax ?? 10)
				.onChange(async (v) => {
					this.plugin.settings.musicFavoritesMax = v;
					await this.plugin.saveSettings();
				}));
	}

	// ── 사전 ────────────────────────────────────────────────────────────

	private renderDictionaryPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '사전');

		this.addGroupTitle(containerEl, 'API 키 등록');
		const dictBox = this.createGroupBox(containerEl);
		new Setting(dictBox)
			.setName('표준국어대사전 API 키')
			.setDesc('stdict.korean.go.kr에서 발급받은 API 키')
			.addText(text => text
				.setPlaceholder('API 키 입력')
				.setValue(this.plugin.settings.stdictApiKey)
				.onChange(async value => { this.plugin.settings.stdictApiKey = value.trim(); await this.plugin.saveSettings(); }));

		this.addGroupTitle(containerEl, '한자 변환');
		const hanjaBox = this.createGroupBox(containerEl);
		new Setting(hanjaBox)
			.setName('괄호 병기')
			.setDesc('한자 변환 시 원문 한글을 괄호 안에 병기합니다. 예: 漢字(한자)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hanjaBracketMode ?? false)
				.onChange(async value => { this.plugin.settings.hanjaBracketMode = value; await this.plugin.saveSettings(); }));
	}

	// ── 버전 관리 ─────────────────────────────────────────────────────────

	private renderVersionPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '버전 관리');

		this.addGroupTitle(containerEl, '저장소');
		const verBox = this.createGroupBox(containerEl);

		new Setting(verBox)
			.setName('저장 경로')
			.setDesc('버전 파일이 저장되는 vault 내 폴더 경로')
			.addText(text => text
				.setPlaceholder('.writing-menu-versions')
				.setValue(this.plugin.settings.versionStoragePath)
				.onChange(async value => {
					this.plugin.settings.versionStoragePath = value.trim() || '.writing-menu-versions';
					await this.plugin.saveSettings();
				}));

		new Setting(verBox)
			.setName('최대 보관 개수')
			.setDesc('초과 시 오래된 버전부터 자동 삭제 (10~200)')
			.addText(text => text
				.setPlaceholder('50')
				.setValue(String(this.plugin.settings.versionMaxCount))
				.onChange(async value => {
					const n = parseInt(value);
					if (!isNaN(n) && n >= 10 && n <= 200) {
						this.plugin.settings.versionMaxCount = n;
						await this.plugin.saveSettings();
					}
				}));

		this.addGroupTitle(containerEl, '상태');
		const stageBox = this.createGroupBox(containerEl);
		const renderStageList = () => {
			stageBox.empty();
			const stages = this.plugin.settings.versionStages ?? [];
			for (let i = 0; i < stages.length; i++) {
				const s = stages[i];
				new Setting(stageBox)
					.addButton(btn => {
						btn.setIcon('trash-2')
							.setClass('wm-stage-del-btn')
							.setTooltip('삭제')
							.onClick(async () => {
								stages.splice(i, 1);
								await this.plugin.saveSettings();
								renderStageList();
							});
					})
					.addColorPicker(cp => {
						cp.setValue(s.color)
							.onChange(async (val) => {
								stages[i].color = val;
								await this.plugin.saveSettings();
							});
					})
					.addText(text => {
						text.setPlaceholder('상태 이름')
							.setValue(s.name);
						text.inputEl.setCssStyles({ 'width': '167px', 'height': '30px' });
						text.onChange(async (val) => {
							stages[i].name = val.trim() || s.name;
							await this.plugin.saveSettings();
						});
					});
			}
			new Setting(stageBox)
				.addButton(btn => btn
					.setButtonText('+ 상태 추가')
					.setCta()
					.onClick(async () => {
						(this.plugin.settings.versionStages ?? []).push({ name: '새 상태', color: '#6366f1' });
						await this.plugin.saveSettings();
						renderStageList();
					}));
		};
		renderStageList();
	}

	// ── 캘린더 설정 ─────────────────────────────────────────────────────

	private renderCalendarPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '캘린더 & 일정 관리');

		this.addGroupTitle(containerEl, '날짜 미리보기');
		const previewBox = this.createGroupBox(containerEl);
		const pref = this.plugin.settings.calendarPreviewItems;

		new Setting(previewBox).setName('할 일').addToggle(t => t.setValue(pref.tasks)
			.onChange(async v => { pref.tasks = v; await this.plugin.saveSettings(); }));
		new Setting(previewBox).setName('오늘 글자수').addToggle(t => t.setValue(pref.charCount)
			.onChange(async v => { pref.charCount = v; await this.plugin.saveSettings(); }));
		new Setting(previewBox).setName('일평균 글자수').addToggle(t => t.setValue(pref.avgCharCount)
			.onChange(async v => { pref.avgCharCount = v; await this.plugin.saveSettings(); }));
		new Setting(previewBox).setName('작업 모드별 시간').addToggle(t => t.setValue(pref.timeModes)
			.onChange(async v => { pref.timeModes = v; await this.plugin.saveSettings(); }));
		new Setting(previewBox).setName('총 작업 시간').addToggle(t => t.setValue(pref.totalTime)
			.onChange(async v => { pref.totalTime = v; await this.plugin.saveSettings(); }));

		this.addGroupTitle(containerEl, '할 일');
		const taskBox = this.createGroupBox(containerEl);
		new Setting(taskBox)
			.setName('할 일 추가 헤더')
			.setDesc('오늘 노트에서 할 일이 추가될 헤더 이름 (예: 할 일, Tasks)')
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
		this.addBackButton(containerEl, '위키 뷰');
		renderWikiSettingsPage(containerEl, this.plugin, () => this.renderPage('wiki'));
	}

	// ── 자동완성 심볼 ────────────────────────────────────────────────────

	displaySymbolPairs(container: HTMLElement) {
		container.empty();
		const addBtnRow = container.createDiv();
		addBtnRow.setCssStyles({ 'display': 'flex', 'justifyContent': 'flex-start', 'marginBottom': '12px' });
		addBtnRow.createEl('button', { text: '새 트리거 추가', cls: 'mod-cta' }).onclick = async () => {
			this.plugin.settings.symbolTriggers.push({ trigger: '', options: [{ open: '', close: '' }], enabled: true });
			await this.plugin.saveSettings();
			this.displaySymbolPairs(container);
		};

		const kanban = container.createDiv('writing-menu-kanban');
		kanban.setCssStyles({ 'display': 'grid', 'gridTemplateColumns': 'repeat(auto-fill, minmax(200px, 1fr))', 'gap': '12px', 'listStyle': 'none', 'width': '60%' });

		this.plugin.settings.symbolTriggers.forEach((trigger, tIndex) => {
			const card = kanban.createDiv('writing-menu-card');
			card.setCssStyles({ 'border': '1px solid var(--background-modifier-border)', 'borderRadius': '10px', 'background': 'var(--background-primary)', 'padding': '12px', 'direction': 'ltr', 'boxShadow': '0 1px 2px rgba(0,0,0,0.05)', 'display': 'flex', 'flexDirection': 'column', 'gap': '10px', 'opacity': trigger.enabled !== false ? '1' : '0.7', 'transition': 'opacity 0.2s' });

			const header = card.createDiv();
			header.setCssStyles({ 'display': 'flex', 'alignItems': 'center', 'gap': '8px', 'marginBottom': '4px' });

			const toggleDiv = header.createDiv();
			toggleDiv.setCssStyles({ 'display': 'flex', 'alignItems': 'center' });
			new Setting(toggleDiv).addToggle(t => t.setValue(trigger.enabled !== false).onChange(async v => {
				trigger.enabled = v; await this.plugin.saveSettings(); this.displaySymbolPairs(container);
			})).setName('').setDesc('');
			(toggleDiv.querySelector('.setting-item') as HTMLElement)?.setAttribute('style', 'border:none;padding:0;margin:0;min-height:auto;display:flex;align-items:center;');
			(toggleDiv.querySelector('.setting-item-info') as HTMLElement)?.setAttribute('style', 'display:none;');
			(toggleDiv.querySelector('.setting-item-control') as HTMLElement)?.setAttribute('style', 'padding:0;margin:0;');

			const input = header.createEl('input', { type: 'text', value: trigger.trigger });
			input.setCssStyles({ 'flex': '1', 'textAlign': 'center', 'fontWeight': 'bold', 'borderRadius': '4px', 'border': '1px solid var(--background-modifier-border)', 'padding': '4px', 'minWidth': '0' });
			input.onchange = async () => { trigger.trigger = input.value; await this.plugin.saveSettings(); };

			const del = header.createDiv('clickable-icon');
			setIcon(del, 'trash-2');
			del.setCssStyles({ 'color': 'var(--text-muted)', 'cursor': 'pointer' });
			del.onclick = async () => { this.plugin.settings.symbolTriggers.splice(tIndex, 1); await this.plugin.saveSettings(); this.displaySymbolPairs(container); };

			card.createDiv().setCssStyles({ 'height': '1px', 'background': 'var(--background-modifier-border)' });

			const pairs = card.createDiv();
			pairs.setCssStyles({ 'display': 'flex', 'flexDirection': 'column', 'gap': '6px' });
			trigger.options.forEach((opt, oIndex) => {
				const row = pairs.createDiv();
				row.setCssStyles({ 'display': 'flex', 'alignItems': 'center', 'gap': '6px' });
				const inputStyle = 'flex:1; text-align:center; border:1px solid var(--background-modifier-border); border-radius:4px; padding:4px; background:var(--background-primary-alt); min-width:0;';

				const open = row.createEl('input', { type: 'text', value: opt.open });
				open.setCssStyles({ cssText: inputStyle });
				open.onchange = async () => { opt.open = open.value; await this.plugin.saveSettings(); };

				row.createSpan({ text: '→' }).setCssStyles({ 'color': 'var(--text-muted)', 'fontSize': '12px', 'flexShrink': '0' });

				const close = row.createEl('input', { type: 'text', value: opt.close });
				close.setCssStyles({ cssText: inputStyle });
				close.onchange = async () => { opt.close = close.value; await this.plugin.saveSettings(); };

				const rm = row.createDiv('clickable-icon');
				setIcon(rm, 'x');
				rm.setCssStyles({ 'color': 'var(--text-muted)', 'opacity': '0.6', 'cursor': 'pointer', 'flexShrink': '0' });
				rm.onclick = async () => { trigger.options.splice(oIndex, 1); await this.plugin.saveSettings(); this.displaySymbolPairs(container); };
			});

			const addP = card.createDiv();
			addP.textContent = '+';
			addP.setCssStyles({ 'textAlign': 'center', 'color': 'var(--text-accent)', 'cursor': 'pointer', 'fontSize': '16px' });
			addP.onclick = async () => { trigger.options.push({ open: '', close: '' }); await this.plugin.saveSettings(); this.displaySymbolPairs(container); };
		});
	}

	// ── 텍스트 치환 ─────────────────────────────────────────────────────

	displayTextSubstitutions(container: HTMLElement) {
		container.empty();

		const addBtnRow = container.createDiv();
		addBtnRow.setCssStyles({ 'display': 'flex', 'justifyContent': 'flex-start', 'marginBottom': '12px' });
		addBtnRow.createEl('button', { text: '새 치환 추가', cls: 'mod-cta' }).onclick = async () => {
			this.plugin.settings.textSubstitutions.push({ from: '', to: '', enabled: true });
			await this.plugin.saveSettings();
			this.displayTextSubstitutions(container);
		};

		const list = container.createDiv();
		list.setCssStyles({ 'display': 'flex', 'flexDirection': 'column', 'gap': '8px', 'width': Platform.isMobile ? '100%' : '60%' });

		this.plugin.settings.textSubstitutions.forEach((sub, index) => {
			const row = list.createDiv();
			row.setCssStyles({ 'display': 'flex', 'alignItems': 'center', 'gap': '10px', 'padding': '8px 12px', 'border': '1px solid var(--background-modifier-border)', 'borderRadius': '8px', 'background': 'var(--background-primary)', 'opacity': sub.enabled ? '1' : '0.6', 'transition': 'opacity 0.2s' });

			const toggleDiv = row.createDiv();
			toggleDiv.setCssStyles({ 'display': 'flex', 'alignItems': 'center' });
			new Setting(toggleDiv).addToggle(t => t.setValue(sub.enabled).onChange(async v => {
				sub.enabled = v; await this.plugin.saveSettings(); this.displayTextSubstitutions(container);
			})).setName('').setDesc('');
			(toggleDiv.querySelector('.setting-item') as HTMLElement)?.setAttribute('style', 'border:none;padding:0;margin:0;min-height:auto;display:flex;align-items:center;');
			(toggleDiv.querySelector('.setting-item-info') as HTMLElement)?.setAttribute('style', 'display:none;');
			(toggleDiv.querySelector('.setting-item-control') as HTMLElement)?.setAttribute('style', 'padding:0;margin:0;');

			const fromInput = row.createEl('input', { type: 'text', value: sub.from });
			fromInput.setCssStyles({ 'flex': '1', 'textAlign': 'center', 'border': '1px solid var(--background-modifier-border)', 'borderRadius': '4px', 'padding': '6px', 'minWidth': '60px' });
			fromInput.placeholder = '입력';
			fromInput.onchange = async () => { sub.from = fromInput.value; await this.plugin.saveSettings(); };

			row.createSpan({ text: '→' }).setCssStyles({ 'color': 'var(--text-muted)', 'fontSize': '14px' });

			const toInput = row.createEl('input', { type: 'text', value: sub.to });
			toInput.setCssStyles({ 'flex': '1', 'textAlign': 'center', 'border': '1px solid var(--background-modifier-border)', 'borderRadius': '4px', 'padding': '6px', 'minWidth': '60px' });
			toInput.placeholder = '변환';
			toInput.onchange = async () => { sub.to = toInput.value; await this.plugin.saveSettings(); };

			const del = row.createDiv('clickable-icon');
			setIcon(del, 'trash-2');
			del.setCssStyles({ 'color': 'var(--text-muted)', 'cursor': 'pointer' });
			del.onclick = async () => {
				this.plugin.settings.textSubstitutions.splice(index, 1);
				await this.plugin.saveSettings();
				this.displayTextSubstitutions(container);
			};
		});
	}
}
