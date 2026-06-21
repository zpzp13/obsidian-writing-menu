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
			case 'special-chars':    this.renderSpecialCharsPage(containerEl); break;
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
		this.addNavCard(etcBox, '특수문자', '삽입 후 닫기 · 즐겨찾기 관리', 'omega', 'special-chars');
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

		// ── 구분선 ──────────────────────────────────────────────────
		this.addGroupTitle(containerEl, '구분선');
		const hrBox = this.createGroupBox(containerEl);

		new Setting(hrBox)
			.setName('커스텀 구분선')
			.setDesc('활성화 시 ***, --- 등을 아래 설정대로 렌더링')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hrEnabled)
				.onChange(async value => {
					this.plugin.settings.hrEnabled = value;
					await this.plugin.saveSettings();
					this.plugin.leafStyleManager.updateDynamicStyles();
				}));

		new Setting(hrBox)
			.setName('종류')
			.addDropdown(dd => {
				dd.addOption('text', '텍스트')
				  .addOption('svg', 'SVG')
				  .setValue(this.plugin.settings.hrType)
				  .onChange(async value => {
					this.plugin.settings.hrType = value as 'text' | 'svg';
					await this.plugin.saveSettings();
					this.plugin.leafStyleManager.updateDynamicStyles();
				  });
				});

		new Setting(hrBox)
			.setName('텍스트 내용')
			.setDesc('텍스트 모드에서 구분선 대신 표시할 내용')
			.addText(text => text
				.setPlaceholder('✦ ✦ ✦')
				.setValue(this.plugin.settings.hrContent)
				.onChange(async value => {
					this.plugin.settings.hrContent = value;
					await this.plugin.saveSettings();
					this.plugin.leafStyleManager.updateDynamicStyles();
				}));

		new Setting(hrBox)
			.setName('색상')
			.setDesc('텍스트 모드 색상. 비워두면 기본 텍스트 색상 사용.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.hrColor || '#888888')
				.onChange(async value => {
					this.plugin.settings.hrColor = value;
					await this.plugin.saveSettings();
					this.plugin.leafStyleManager.updateDynamicStyles();
				}))
			.addExtraButton(btn => btn.setIcon('reset').setTooltip('색상 초기화 (기본값)')
				.onClick(async () => {
					this.plugin.settings.hrColor = '';
					await this.plugin.saveSettings();
					this.plugin.leafStyleManager.updateDynamicStyles();
					this.renderPage('typography');
				}));

		// 정렬 버튼 (좌/중앙/우)
		const hrAlignSetting = new Setting(hrBox).setName('정렬');
		const hrAlignBtnContainer = hrAlignSetting.controlEl.createDiv({ cls: 'wm-align-btn-group' });
		(['left', 'center', 'right'] as const).forEach(align => {
			const iconMap = { left: 'align-left', center: 'align-center', right: 'align-right' } as const;
			const labelMap = { left: '좌', center: '중앙', right: '우' } as const;
			const btn = hrAlignBtnContainer.createEl('button', { cls: 'wm-align-btn' + (this.plugin.settings.hrAlign === align ? ' is-active' : '') });
			setIcon(btn, iconMap[align]);
			btn.title = labelMap[align];
			btn.onclick = async () => {
				this.plugin.settings.hrAlign = align;
				await this.plugin.saveSettings();
				this.plugin.leafStyleManager.updateDynamicStyles();
				hrAlignBtnContainer.querySelectorAll('.wm-align-btn').forEach(b => b.removeClass('is-active'));
				btn.addClass('is-active');
			};
		});

		new Setting(hrBox)
			.setName('SVG 코드')
			.setDesc('SVG 모드에서 사용할 SVG 코드를 붙여넣으세요')
			.addTextArea(ta => ta
				.setPlaceholder('<svg xmlns="http://www.w3.org/2000/svg" ...>...</svg>')
				.setValue(this.plugin.settings.hrSvg)
				.onChange(async value => {
					this.plugin.settings.hrSvg = value;
					await this.plugin.saveSettings();
					this.plugin.leafStyleManager.updateDynamicStyles();
				}));

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

				const reqNote = containerEl.createDiv('wm-settings-req-note');
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
		const modeTitleRow = containerEl.createDiv({ cls: 'wm-settings-section-hdr' });
		const modeTitleLeft = modeTitleRow.createDiv({ cls: 'wm-settings-section-hdr-label' });
		modeTitleLeft.createSpan({ cls: 'wm-settings-group-title', text: '작업 모드' });
		modeTitleLeft.createSpan({ cls: 'wm-settings-group-title-desc', text: '모드명 · 아이콘 · 프론트매터 키 · 목표(분)' });
		const modeTitleBtns = modeTitleRow.createDiv({ cls: 'wm-settings-section-hdr-btns' });
		const deleteAllModesBtn = modeTitleBtns.createDiv({ cls: 'clickable-icon wm-muted-icon' });
		setIcon(deleteAllModesBtn, 'trash');
		deleteAllModesBtn.setAttribute('aria-label', '전체 삭제');
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
				setting.settingEl.addClass('wm-mode-setting-row');
			}
		};
		deleteAllModesBtn.addEventListener('click', async () => {
			this.plugin.settings.timeModes = [];
			await this.plugin.saveSettings();
			renderModeList();
		});
		renderModeList();

		const addModeRow = containerEl.createDiv({ cls: 'wm-settings-add-btn-row wm-settings-add-btn-right' });
		const addModeBtn = addModeRow.createEl('button', { text: '+ 모드 추가' });
		addModeBtn.addEventListener('click', async () => {
			const newId = `mode_${Date.now()}`;
			ensureModes().push({ id: newId, label: '', frontmatterKey: '', goalSeconds: 0 });
			await this.plugin.saveSettings();
			renderModeList();
		});

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
		};
		renderFolderList();

		const addFolderRow = containerEl.createDiv({ cls: 'wm-settings-add-btn-row wm-settings-add-btn-right' });
		const addFolderBtn = addFolderRow.createEl('button', { text: '+ 폴더 추가' });
		addFolderBtn.addEventListener('click', () => { paths.push(''); renderFolderList(); });

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
						text.inputEl.addClass('wm-stage-name-input');
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

	// ── 특수문자 ─────────────────────────────────────────────────────────

	private renderSpecialCharsPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '특수문자');

		this.addGroupTitle(containerEl, '동작');
		const box = this.createGroupBox(containerEl);

		new Setting(box)
			.setName('삽입 후 모달 닫기')
			.setDesc('특수문자를 삽입한 뒤 모달을 자동으로 닫습니다.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.specialCharCloseOnInsert ?? true)
				.onChange(async value => {
					this.plugin.settings.specialCharCloseOnInsert = value;
					await this.plugin.saveSettings();
				}));

		// 즐겨찾기 섹션
		const favs = this.plugin.settings.specialCharFavorites ?? [];
		const favHdr = containerEl.createDiv({ cls: 'wm-settings-section-hdr' });
		favHdr.createDiv({ cls: 'wm-settings-group-title', text: '즐겨찾기' });
		const favHdrBtns = favHdr.createDiv({ cls: 'wm-settings-section-hdr-btns' });
		if (favs.length > 0) {
			const trashFavs = favHdrBtns.createDiv({ cls: 'clickable-icon wm-muted-icon' });
			setIcon(trashFavs, 'trash-2');
			trashFavs.setAttribute('aria-label', '전체 삭제');
			trashFavs.addEventListener('click', async () => {
				this.plugin.settings.specialCharFavorites = [];
				await this.plugin.saveSettings();
				this.renderPage('special-chars');
			});
		}
		const favBox = this.createGroupBox(containerEl);
		if (favs.length === 0) {
			favBox.createDiv({ cls: 'wm-settings-hint', text: '특수문자 모달에서 ★를 클릭해 즐겨찾기를 추가하세요.' });
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
		const customHdr = containerEl.createDiv({ cls: 'wm-settings-section-hdr' });
		customHdr.createDiv({ cls: 'wm-settings-group-title', text: '사용자 지정 특수문자' });
		const customHdrBtns = customHdr.createDiv({ cls: 'wm-settings-section-hdr-btns' });

		// + 버튼 + inline popup
		const addWrap = customHdrBtns.createDiv({ cls: 'wm-sc-add-wrap' });
		const addBtn = addWrap.createDiv({ cls: 'clickable-icon wm-muted-icon' });
		setIcon(addBtn, 'plus');

		const popup = addWrap.createDiv({ cls: 'wm-sc-add-popup wm-sc-add-popup-right is-hidden' });
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

		submitBtn.addEventListener('click', doAdd);
		descInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
		charInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') descInput.focus(); });
		addBtn.addEventListener('click', (e) => { e.stopPropagation(); popupOpen ? hidePopup() : showPopup(); });
		document.addEventListener('mousedown', (e) => {
			if (popupOpen && !addWrap.contains(e.target as Node)) hidePopup();
		});

		if (customs.length > 0) {
			const trashCustoms = customHdrBtns.createDiv({ cls: 'clickable-icon wm-muted-icon' });
			setIcon(trashCustoms, 'trash-2');
			trashCustoms.setAttribute('aria-label', '전체 삭제');
			trashCustoms.addEventListener('click', async () => {
				this.plugin.settings.specialCharCustom = [];
				await this.plugin.saveSettings();
				this.renderPage('special-chars');
			});
		}
		const customBox = this.createGroupBox(containerEl);
		if (customs.length === 0) {
			customBox.createDiv({ cls: 'wm-settings-hint', text: '+ 버튼을 눌러 특수문자를 지정하세요.' });
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
	}

	// ── 자동완성 심볼 ────────────────────────────────────────────────────

	displaySymbolPairs(container: HTMLElement) {
		container.empty();
		const addBtnRow = container.createDiv('wm-settings-add-btn-row');
		addBtnRow.createEl('button', { text: '새 트리거 추가', cls: 'mod-cta' }).onclick = async () => {
			this.plugin.settings.symbolTriggers.push({ trigger: '', options: [{ open: '', close: '' }], enabled: true });
			await this.plugin.saveSettings();
			this.displaySymbolPairs(container);
		};

		const kanban = container.createDiv('writing-menu-kanban');

		this.plugin.settings.symbolTriggers.forEach((trigger, tIndex) => {
			const card = kanban.createDiv('writing-menu-card');
			if (trigger.enabled === false) card.addClass('wm-card-disabled');

			const header = card.createDiv('wm-card-header');

			const toggleDiv = header.createDiv('wm-card-toggle-div');
			new Setting(toggleDiv).addToggle(t => t.setValue(trigger.enabled !== false).onChange(async v => {
				trigger.enabled = v; await this.plugin.saveSettings(); this.displaySymbolPairs(container);
			})).setName('').setDesc('');
			(toggleDiv.querySelector('.setting-item') as HTMLElement)?.addClass('wm-inline-setting');
			(toggleDiv.querySelector('.setting-item-info') as HTMLElement)?.addClass('wm-inline-setting-info');
			(toggleDiv.querySelector('.setting-item-control') as HTMLElement)?.addClass('wm-inline-setting-ctrl');

			const input = header.createEl('input', { type: 'text', value: trigger.trigger, cls: 'wm-card-trigger-input' });
			input.onchange = async () => { trigger.trigger = input.value; await this.plugin.saveSettings(); };

			const del = header.createDiv('clickable-icon wm-muted-icon');
			setIcon(del, 'trash-2');
			del.onclick = async () => { this.plugin.settings.symbolTriggers.splice(tIndex, 1); await this.plugin.saveSettings(); this.displaySymbolPairs(container); };

			card.createDiv('wm-card-divider');

			const pairs = card.createDiv('wm-card-pairs');
			trigger.options.forEach((opt, oIndex) => {
				const row = pairs.createDiv('wm-card-pair-row');
				const open = row.createEl('input', { type: 'text', value: opt.open, cls: 'wm-card-pair-input' });
				open.onchange = async () => { opt.open = open.value; await this.plugin.saveSettings(); };

				row.createSpan({ text: '→', cls: 'wm-substitution-arrow' });

				const close = row.createEl('input', { type: 'text', value: opt.close, cls: 'wm-card-pair-input' });
				close.onchange = async () => { opt.close = close.value; await this.plugin.saveSettings(); };

				const rm = row.createDiv('clickable-icon wm-pair-delete-btn');
				setIcon(rm, 'x');
				rm.onclick = async () => { trigger.options.splice(oIndex, 1); await this.plugin.saveSettings(); this.displaySymbolPairs(container); };
			});

			const addP = card.createDiv({ text: '+', cls: 'wm-pair-add-btn' });
			addP.onclick = async () => { trigger.options.push({ open: '', close: '' }); await this.plugin.saveSettings(); this.displaySymbolPairs(container); };
		});
	}

	// ── 텍스트 치환 ─────────────────────────────────────────────────────

	displayTextSubstitutions(container: HTMLElement) {
		container.empty();

		const addBtnRow = container.createDiv('wm-settings-add-btn-row');
		addBtnRow.createEl('button', { text: '새 치환 추가', cls: 'mod-cta' }).onclick = async () => {
			this.plugin.settings.textSubstitutions.push({ from: '', to: '', enabled: true });
			await this.plugin.saveSettings();
			this.displayTextSubstitutions(container);
		};

		const list = container.createDiv(Platform.isMobile ? 'wm-substitution-list is-mobile-width' : 'wm-substitution-list');

		this.plugin.settings.textSubstitutions.forEach((sub, index) => {
			const row = list.createDiv('wm-substitution-row');
			if (!sub.enabled) row.addClass('wm-row-disabled');

			const toggleDiv = row.createDiv('wm-card-toggle-div');
			new Setting(toggleDiv).addToggle(t => t.setValue(sub.enabled).onChange(async v => {
				sub.enabled = v; await this.plugin.saveSettings(); this.displayTextSubstitutions(container);
			})).setName('').setDesc('');
			(toggleDiv.querySelector('.setting-item') as HTMLElement)?.addClass('wm-inline-setting');
			(toggleDiv.querySelector('.setting-item-info') as HTMLElement)?.addClass('wm-inline-setting-info');
			(toggleDiv.querySelector('.setting-item-control') as HTMLElement)?.addClass('wm-inline-setting-ctrl');

			const fromInput = row.createEl('input', { type: 'text', value: sub.from, cls: 'wm-substitution-input' });
			fromInput.placeholder = '입력';
			fromInput.onchange = async () => { sub.from = fromInput.value; await this.plugin.saveSettings(); };

			row.createSpan({ text: '→', cls: 'wm-substitution-arrow' });

			const toInput = row.createEl('input', { type: 'text', value: sub.to, cls: 'wm-substitution-input' });
			toInput.placeholder = '변환';
			toInput.onchange = async () => { sub.to = toInput.value; await this.plugin.saveSettings(); };

			const del = row.createDiv('clickable-icon wm-muted-icon');
			setIcon(del, 'trash-2');
			del.onclick = async () => {
				this.plugin.settings.textSubstitutions.splice(index, 1);
				await this.plugin.saveSettings();
				this.displayTextSubstitutions(container);
			};
		});
	}
}
