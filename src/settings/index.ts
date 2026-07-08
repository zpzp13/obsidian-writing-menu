import { App, PluginSettingTab, Setting, setIcon, Platform } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { renderWikiSettingsPage } from '../wiki/WikiSettings';
import { renderPlotSettingsPage } from '../plot/PlotSettings';
import { NoteSuggestModal } from '../wiki/WikiModals';
import { isGaruAssetsDownloaded, downloadGaruAssets } from '../repetition/GaruAssets';
import { isMorphAnalysisSupported } from '../repetition/MorphAnalyzer';
import { fireAndForget } from '../utils/asyncUtils';


export class WritingMenuSettingTab extends PluginSettingTab {
	plugin: WritingMenuPlugin;

	constructor(app: App, plugin: WritingMenuPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.containerEl.addClass('wm-settings-tab');
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
			case 'plot':             this.renderPlotPage(containerEl); break;
			case 'special-chars':    this.renderSpecialCharsPage(containerEl); break;
			case 'spellcheck':       this.renderSpellCheckPage(containerEl); break;
			case 'repetition':       this.renderRepetitionPage(containerEl); break;
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
		this.addNavCard(calBox, '플롯 매니저', '에피소드·회차·장면·인물 플롯 관리', 'network', 'plot');

		this.addGroupTitle(containerEl, '기타');
		const etcBox = this.createGroupBox(containerEl);
		this.addNavCard(etcBox, '타이머', '카운트다운 시간 · 알람 설정', 'timer', 'stopwatch');
		this.addNavCard(etcBox, '사전', '표준국어대사전 API 키', 'book-open', 'dictionary');
		this.addNavCard(etcBox, '맞춤법 검사', '한국어 맞춤법 검사 엔진 · 무시 단어', 'spell-check', 'spellcheck');
		this.addNavCard(etcBox, '퇴고 매니저', '반복 표현 탐지 · 단어장 노트', 'book-check', 'repetition');
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
			.setName('폴더')
			.addText(text => text
				.setPlaceholder('예: 소설/집필')
				.setValue(this.plugin.settings.applyToFolder)
				.onChange(async value => { this.plugin.settings.applyToFolder = value.trim(); await this.plugin.saveSettings(); }));
		inlineBox.createDiv({ cls: 'wm-settings-item-desc', text: '폴더를 지정하세요. 해당 폴더의 하위 노트에 서식이 적용됩니다.' });

		new Setting(inlineBox)
			.setName('글꼴')
			.addText(text => text
				.setPlaceholder('inherit')
				.setValue(this.plugin.settings.fontFamily === 'inherit' ? '' : this.plugin.settings.fontFamily)
				.onChange(async value => {
					this.plugin.settings.fontFamily = value.trim() || 'inherit';
					await this.plugin.saveSettings();
				}));
		inlineBox.createDiv({ cls: 'wm-settings-item-desc', text: '시스템 폰트를 입력하세요. 저장된 모든 폰트를 사용할 수 있습니다.' });

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
		inlineBox.createDiv({ cls: 'wm-settings-item-desc', text: '에디터 본문의 글자 크기입니다. 기본값 16px.' });

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
		inlineBox.createDiv({ cls: 'wm-settings-item-desc', text: '줄과 줄 사이의 간격입니다. 1.5~2.0 권장.' });

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
		inlineBox.createDiv({ cls: 'wm-settings-item-desc', text: '문단(단락) 사이의 여백 배수입니다. 0이면 줄간격만 적용.' });

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
		inlineBox.createDiv({ cls: 'wm-settings-item-desc', text: '에디터 본문의 최대 너비입니다. 기본값 700px.' });

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
		inlineBox.createDiv({ cls: 'wm-settings-item-desc', text: '에디터 좌우 패딩입니다. 화면이 좁을 때 줄여 사용.' });

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
		inlineBox.createDiv({ cls: 'wm-settings-item-desc', text: '두 번째 문단부터 첫 줄 들여쓰기 크기입니다. 0이면 비활성.' });

		// 글자색
		const fontColorVal = this.plugin.settings.fontColor;
		const fontColorLight = typeof fontColorVal === 'string' ? fontColorVal : fontColorVal.light;
		const fontColorDark  = typeof fontColorVal === 'string' ? fontColorVal : fontColorVal.dark;

		if (!Platform.isMobile) {
			new Setting(inlineBox)
				.setName('글자색 (라이트)')
				.addExtraButton(btn => btn.setIcon('reset').setTooltip('기본값으로 초기화')
					.onClick(async () => {
						const dark = typeof this.plugin.settings.fontColor === 'string' ? this.plugin.settings.fontColor : this.plugin.settings.fontColor.dark;
						this.plugin.settings.fontColor = { light: 'inherit', dark };
						await this.plugin.saveSettings();
						this.renderPage('typography');
					}))
				.addColorPicker(cp => cp
					.setValue(fontColorLight === 'inherit' || !fontColorLight ? '#000000' : fontColorLight)
					.onChange(async value => {
						const dark = typeof this.plugin.settings.fontColor === 'string' ? this.plugin.settings.fontColor : this.plugin.settings.fontColor.dark;
						this.plugin.settings.fontColor = { light: value, dark };
						await this.plugin.saveSettings();
					}));

			new Setting(inlineBox)
				.setName('글자색 (다크)')
				.addExtraButton(btn => btn.setIcon('reset').setTooltip('기본값으로 초기화')
					.onClick(async () => {
						const light = typeof this.plugin.settings.fontColor === 'string' ? this.plugin.settings.fontColor : this.plugin.settings.fontColor.light;
						this.plugin.settings.fontColor = { light, dark: 'inherit' };
						await this.plugin.saveSettings();
						this.renderPage('typography');
					}))
				.addColorPicker(cp => cp
					.setValue(fontColorDark === 'inherit' || !fontColorDark ? '#ffffff' : fontColorDark)
					.onChange(async value => {
						const light = typeof this.plugin.settings.fontColor === 'string' ? this.plugin.settings.fontColor : this.plugin.settings.fontColor.light;
						this.plugin.settings.fontColor = { light, dark: value };
						await this.plugin.saveSettings();
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
				.addExtraButton(btn => btn.setIcon('reset').setTooltip('기본값으로 초기화')
					.onClick(async () => {
						const dark = typeof this.plugin.settings.backgroundColor === 'string' ? this.plugin.settings.backgroundColor : this.plugin.settings.backgroundColor.dark;
						this.plugin.settings.backgroundColor = { light: 'transparent', dark };
						await this.plugin.saveSettings();
						this.renderPage('typography');
					}))
				.addColorPicker(cp => cp
					.setValue(bgColorLight === 'transparent' || bgColorLight === 'inherit' || !bgColorLight ? '#ffffff' : bgColorLight)
					.onChange(async value => {
						const dark = typeof this.plugin.settings.backgroundColor === 'string' ? this.plugin.settings.backgroundColor : this.plugin.settings.backgroundColor.dark;
						this.plugin.settings.backgroundColor = { light: value, dark };
						await this.plugin.saveSettings();
					}));

			new Setting(inlineBox)
				.setName('배경색 (다크)')
				.addExtraButton(btn => btn.setIcon('reset').setTooltip('기본값으로 초기화')
					.onClick(async () => {
						const light = typeof this.plugin.settings.backgroundColor === 'string' ? this.plugin.settings.backgroundColor : this.plugin.settings.backgroundColor.light;
						this.plugin.settings.backgroundColor = { light, dark: 'transparent' };
						await this.plugin.saveSettings();
						this.renderPage('typography');
					}))
				.addColorPicker(cp => cp
					.setValue(bgColorDark === 'transparent' || bgColorDark === 'inherit' || !bgColorDark ? '#000000' : bgColorDark)
					.onChange(async value => {
						const light = typeof this.plugin.settings.backgroundColor === 'string' ? this.plugin.settings.backgroundColor : this.plugin.settings.backgroundColor.light;
						this.plugin.settings.backgroundColor = { light, dark: value };
						await this.plugin.saveSettings();
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
			.addToggle(toggle => toggle
				.setValue(!this.plugin.settings.disableLinkColor)
				.onChange(async value => { this.plugin.settings.disableLinkColor = !value; await this.plugin.saveSettings(); }));
		inlineBox.createDiv({ cls: 'wm-settings-item-desc', text: '비활성화 시 링크 구문의 자동 색상 보정을 무시합니다.' });

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
		hrBox.createDiv({ cls: 'wm-settings-item-desc', text: '구분선을 구성하는 텍스트 혹은 SVG 소스코드를 입력하세요.' });

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
			.addExtraButton(btn => btn.setIcon('reset').setTooltip('색상 초기화 (기본값)')
				.onClick(async () => {
					this.plugin.settings.hrColor = '';
					await this.plugin.saveSettings();
					this.plugin.leafStyleManager.updateDynamicStyles();
					this.renderPage('typography');
				}))
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.hrColor || '#888888')
				.onChange(async value => {
					this.plugin.settings.hrColor = value;
					await this.plugin.saveSettings();
					this.plugin.leafStyleManager.updateDynamicStyles();
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
		hrBox.createDiv({ cls: 'wm-settings-item-desc', text: '구분선의 가로 정렬 위치입니다. 텍스트 모드에서 적용됩니다.' });

		new Setting(hrBox)
			.setName('위아래 여백')
			.setDesc('구분선 위아래 여백 (em 단위, 기본값 0.5)')
			.addText(text => text
				.setPlaceholder('0.5')
				.setValue(String(this.plugin.settings.hrMargin ?? 0.5))
				.onChange(async value => {
					const n = parseFloat(value);
					this.plugin.settings.hrMargin = isNaN(n) ? 0.5 : Math.max(0, n);
					await this.plugin.saveSettings();
					this.plugin.leafStyleManager.updateDynamicStyles();
				}));

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

		new Setting(hrBox)
			.setName('SVG 크기')
			.setDesc('SVG 모드 구분선 높이 (em 단위, 기본값 2)')
			.addText(text => text
				.setPlaceholder('2')
				.setValue(String(this.plugin.settings.hrSvgSize ?? 2))
				.onChange(async value => {
					const n = parseFloat(value);
					this.plugin.settings.hrSvgSize = isNaN(n) ? 2 : Math.max(0.1, n);
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
		h1Box.createDiv({ cls: 'wm-settings-item-desc', text: 'H1 헤딩에만 적용되는 별도 글꼴입니다. 비워두면 본문 글꼴 사용.' });

		new Setting(h1Box)
			.setName('크기 (px)')
			.addText(text => text
				.setPlaceholder('24')
				.setValue(String(this.plugin.settings.h1FontSize))
				.onChange(async value => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) { this.plugin.settings.h1FontSize = num; await this.plugin.saveSettings(); }
				}));
		h1Box.createDiv({ cls: 'wm-settings-item-desc', text: 'H1 헤딩의 글자 크기입니다.' });

		new Setting(h1Box)
			.setName('행간')
			.addText(text => text
				.setPlaceholder('1.5')
				.setValue(String(this.plugin.settings.h1LineHeight))
				.onChange(async value => {
					const num = parseFloat(value);
					if (!isNaN(num) && num > 0) { this.plugin.settings.h1LineHeight = num; await this.plugin.saveSettings(); }
				}));
		h1Box.createDiv({ cls: 'wm-settings-item-desc', text: 'H1 헤딩의 줄간격입니다.' });

		new Setting(h1Box)
			.setName('색상')
			.addExtraButton(btn => btn
				.setIcon('reset').setTooltip('기본값으로 초기화')
				.onClick(async () => {
					this.plugin.settings.h1Color = 'inherit';
					await this.plugin.saveSettings();
					this.renderPage('typography');
				}))
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.h1Color === 'inherit' || !this.plugin.settings.h1Color ? '#000000' : this.plugin.settings.h1Color)
				.onChange(async value => { this.plugin.settings.h1Color = value; await this.plugin.saveSettings(); }));

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
		fnBox.createDiv({ cls: 'wm-settings-item-desc', text: '각주 텍스트에만 적용되는 별도 글꼴입니다. 비워두면 본문 글꼴 사용.' });

		new Setting(fnBox)
			.setName('크기 (px)')
			.addText(text => text
				.setPlaceholder('13')
				.setValue(String(this.plugin.settings.footnoteFontSize))
				.onChange(async value => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) { this.plugin.settings.footnoteFontSize = num; await this.plugin.saveSettings(); }
				}));
		fnBox.createDiv({ cls: 'wm-settings-item-desc', text: '각주 글자 크기입니다. 기본값 13px.' });

		new Setting(fnBox)
			.setName('행간')
			.addText(text => text
				.setPlaceholder('1.5')
				.setValue(String(this.plugin.settings.footnoteLineHeight))
				.onChange(async value => {
					const num = parseFloat(value);
					if (!isNaN(num) && num > 0) { this.plugin.settings.footnoteLineHeight = num; await this.plugin.saveSettings(); }
				}));
		fnBox.createDiv({ cls: 'wm-settings-item-desc', text: '각주 줄간격입니다.' });

		new Setting(fnBox)
			.setName('색상')
			.addExtraButton(btn => btn
				.setIcon('reset').setTooltip('기본값으로 초기화')
				.onClick(async () => {
					this.plugin.settings.footnoteColor = 'inherit';
					await this.plugin.saveSettings();
					this.renderPage('typography');
				}))
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.footnoteColor === 'inherit' || !this.plugin.settings.footnoteColor ? '#000000' : this.plugin.settings.footnoteColor)
				.onChange(async value => { this.plugin.settings.footnoteColor = value; await this.plugin.saveSettings(); }));
	}

	// ── 입력 보조 ───────────────────────────────────────────────────────

	private renderInputPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '입력 보조');

		this.addGroupTitle(containerEl, '스마트 입력');
		const smartBox = this.createGroupBox(containerEl);

		new Setting(smartBox)
			.setName('스마트 따옴표')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableSmartQuotes)
				.onChange(async value => { this.plugin.settings.enableSmartQuotes = value; await this.plugin.saveSettings(); }));
		smartBox.createDiv({ cls: 'wm-settings-item-desc', text: '곧은 따옴표를 둥근 따옴표로 치환합니다.' });

		new Setting(smartBox)
			.setName('스마트 엔터')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableSmartEnter)
				.onChange(async value => { this.plugin.settings.enableSmartEnter = value; await this.plugin.saveSettings(); }));
		smartBox.createDiv({ cls: 'wm-settings-item-desc', text: '따옴표와 괄호, 트리거에 등록된 기호쌍 안에서 엔터를 입력하면 커서가 다음 문단으로 이동합니다.' });

		new Setting(smartBox)
			.setName('자동완성')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableSmartInput)
				.onChange(async value => { this.plugin.settings.enableSmartInput = value; await this.plugin.saveSettings(); }));
		smartBox.createDiv({ cls: 'wm-settings-item-desc', text: '트리거를 입력하면 자동완성 팝업창이 나타납니다. 자주 쓰는 기호를 트리거로 입력 후 쉽게 적용하세요.' });

		new Setting(smartBox)
			.setName('텍스트 치환')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableTextSubstitution)
				.onChange(async value => { this.plugin.settings.enableTextSubstitution = value; await this.plugin.saveSettings(); }));
		smartBox.createDiv({ cls: 'wm-settings-item-desc', text: '대치어를 등록하면 자동으로 치환합니다.' });

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

				containerEl.createDiv({ cls: 'wm-settings-subgroup-title', text: '한컴오피스 한글, Python, pywin32 필요' });

				const hwpBox = this.createGroupBox(containerEl);

				let hwpPathText: import('obsidian').TextComponent;
				new Setting(hwpBox)
					.setName('기본 저장 경로')
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
				new Setting(hwpBox)
					.setName('템플릿 파일')
					.setDesc('스타일을 적용할 HWP 템플릿 (선택사항)')
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
				hwpBox.createDiv({ cls: 'wm-settings-item-desc', text: '원하는 양식이 적용된 HWP 문서를 템플릿으로 등록하세요. 변환 시 해당 문서의 양식이 적용됩니다.' });
			}
		}
	}

	// ── 작업 시간 ───────────────────────────────────────────────────────

	private renderStopwatchPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '타이머');

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
		swBox.createDiv({ cls: 'wm-settings-item-desc', text: '알람이 울릴 때 재생할 효과음을 선택합니다. 선택 즉시 미리 들을 수 있습니다.' });
	}

	private renderWritingStatsPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '글자수 & 작업 시간');

		// ── 공통 ──
		this.addGroupTitle(containerEl, '공통');
		const commonBox = this.createGroupBox(containerEl);
		new Setting(commonBox)
			.setName('추적 폴더')
			.addText(t => t
				.setPlaceholder('예: 소설/집필')
				.setValue(this.plugin.settings.trackingFolder ?? '')
				.onChange(async v => {
					this.plugin.settings.trackingFolder = v.trim();
					await this.plugin.saveSettings();
				}));
		commonBox.createDiv({ cls: 'wm-settings-item-desc', text: '추적 범위를 지정된 폴더로 제한합니다. 글자수와 작업 시간은 해당 폴더의 하위 노트에서만 누적 계산됩니다.' });
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
			.addText(t => t
				.setPlaceholder('글자수')
				.setValue(this.plugin.settings.dailyCharCountKey ?? '글자수')
				.onChange(async v => {
					this.plugin.settings.dailyCharCountKey = v.trim() || '글자수';
					await this.plugin.saveSettings();
				}));
		charsBox.createDiv({ cls: 'wm-settings-item-desc', text: '일일 노트에 해당 날짜의 누적 글자수를 기록합니다.' });

		// ── 작업 시간 ──
		containerEl.createDiv({ cls: 'wm-settings-group-title', text: '작업 시간' });
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
						const wrap = createEl('div', { cls: 'wm-mode-goal-wrap' });
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
				setting.settingEl.addClass('wm-mode-setting-row');
			}
		};
		renderModeList();
		const addModeRow = containerEl.createDiv({ cls: 'wm-settings-group-add-row' });
		const addModeIcon = addModeRow.createDiv({ cls: 'clickable-icon wm-muted-icon' });
		setIcon(addModeIcon, 'plus');
		addModeIcon.setAttribute('aria-label', '모드 추가');
		addModeIcon.addEventListener('click', () => {
			fireAndForget(async () => {
				const newId = `mode_${Date.now()}`;
				ensureModes().push({ id: newId, label: '', frontmatterKey: '', goalSeconds: 0 });
				await this.plugin.saveSettings();
				renderModeList();
			});
		});

		containerEl.createDiv({ cls: 'wm-settings-subgroup-title', text: '총 시간' });
		const totalBox = this.createGroupBox(containerEl);
		new Setting(totalBox).setName('프론트매터 키')
			.addText(t => t
				.setPlaceholder('총_시간')
				.setValue(this.plugin.settings.timeTotalKey ?? '총_시간')
				.onChange(async v => {
					this.plugin.settings.timeTotalKey = v.trim() || '총_시간';
					await this.plugin.saveSettings();
				}));
		totalBox.createDiv({ cls: 'wm-settings-item-desc', text: '모든 작업 모드 시간의 합계를 기록할 프론트매터 키 이름입니다.' });

		containerEl.createDiv({ cls: 'wm-settings-subgroup-title', text: '평균 기준 폴더' });
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
		const addFolderIconRow = containerEl.createDiv({ cls: 'wm-settings-group-add-row' });
		const addFolderIcon = addFolderIconRow.createDiv({ cls: 'clickable-icon wm-muted-icon' });
		setIcon(addFolderIcon, 'plus');
		addFolderIcon.setAttribute('aria-label', '폴더 추가');
		addFolderIcon.addEventListener('click', () => { paths.push(''); renderFolderList(); });

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
		playBox.createDiv({ cls: 'wm-settings-item-desc', text: '재생 모드(순환/한 곡 듣기/셔플)를 변경할 수 있습니다. 목록 범위는 현재 재생 중인 곡의 루트 폴더입니다.' });

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
			.addText(text => text
				.setPlaceholder('API 키 입력')
				.setValue(this.plugin.settings.stdictApiKey)
				.onChange(async value => { this.plugin.settings.stdictApiKey = value.trim(); await this.plugin.saveSettings(); }));
		const dictDesc = dictBox.createDiv({ cls: 'wm-settings-item-desc' });
		dictDesc.appendText('무료 API 발급: ');
		dictDesc.createEl('a', { text: 'stdict.korean.go.kr', href: 'https://stdict.korean.go.kr', attr: { target: '_blank', rel: 'noopener' } });
		dictDesc.appendText(' 개발 지원 탭에서 신청하세요.');

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
					.setName(`상태 ${i + 1}`)
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
					})
					.addExtraButton(btn => btn.setIcon('x').setTooltip('삭제')
						.onClick(async () => {
							stages.splice(i, 1);
							await this.plugin.saveSettings();
							renderStageList();
						}));
			}
		};
		renderStageList();
		const addStageIconRow = containerEl.createDiv({ cls: 'wm-settings-group-add-row' });
		const addStageIcon = addStageIconRow.createDiv({ cls: 'clickable-icon wm-muted-icon' });
		setIcon(addStageIcon, 'plus');
		addStageIcon.setAttribute('aria-label', '상태 추가');
		addStageIcon.addEventListener('click', () => {
			fireAndForget(async () => {
				(this.plugin.settings.versionStages ?? []).push({ name: '새 상태', color: '#6366f1' });
				await this.plugin.saveSettings();
				renderStageList();
			});
		});
	}

	// ── 캘린더 설정 ─────────────────────────────────────────────────────

	private renderCalendarPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '캘린더 & 일정 관리');

		this.addGroupTitle(containerEl, '날짜 미리보기');
		const previewBox = this.createGroupBox(containerEl);
		const pref = this.plugin.settings.calendarPreviewItems;

		new Setting(previewBox).setName('할 일').addToggle(t => t.setValue(pref.tasks)
			.onChange(async v => { pref.tasks = v; await this.plugin.saveSettings(); }));
		previewBox.createDiv({ cls: 'wm-settings-item-desc', text: '캘린더 날짜 셀에 마우스를 올리면 해당 항목을 미리 표시합니다.' });
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
			.setName('일일 노트 경로')
			.addText(t => t
				.setPlaceholder('할 일')
				.setValue(this.plugin.settings.taskAddHeader ?? '할 일')
				.onChange(async v => {
					this.plugin.settings.taskAddHeader = v.trim() || '할 일';
					await this.plugin.saveSettings();
				}));
		taskBox.createDiv({ cls: 'wm-settings-item-desc', text: '일일 노트의 경로(헤더 이름)를 지정하세요. 대시보드에서 추가한 할 일이 해당 경로에 기록됩니다.' });

	}

	// ── 위키 ────────────────────────────────────────────────────────────

	private renderWikiPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '위키 뷰');
		renderWikiSettingsPage(containerEl, this.plugin, () => this.renderPage('wiki'));
	}

	private renderPlotPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '플롯 매니저');
		renderPlotSettingsPage(containerEl, this.plugin);
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
		customHdr.createDiv({ cls: 'wm-settings-group-title', text: '사용자 지정' });
		const customHdrBtns = customHdr.createDiv({ cls: 'wm-settings-section-hdr-btns' });

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
			customBox.createDiv({ cls: 'wm-settings-hint', text: '아래 + 버튼으로 특수문자를 지정하세요.' });
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
		this.addBackButton(containerEl, '맞춤법 검사');

		// 고유명사 사전
		const ignoredHdr = containerEl.createDiv({ cls: 'wm-settings-section-hdr' });
		ignoredHdr.createDiv({ cls: 'wm-settings-group-title', text: '고유명사 사전' });
		const ignoredHdrBtns = ignoredHdr.createDiv({ cls: 'wm-settings-section-hdr-btns' });

		const ignoredWords: string[] = this.plugin.settings.spellCheckIgnoredWords ?? [];

		if (ignoredWords.length > 0) {
			const trashBtn = ignoredHdrBtns.createDiv({ cls: 'clickable-icon wm-muted-icon' });
			setIcon(trashBtn, 'trash-2');
			trashBtn.setAttribute('aria-label', '전체 삭제');
			trashBtn.addEventListener('click', () => {
				fireAndForget(async () => {
					this.plugin.settings.spellCheckIgnoredWords = [];
					await this.plugin.saveSettings();
					this.renderPage('spellcheck');
				});
			});
		}

		const ignoredBox = this.createGroupBox(containerEl);

		// 1행: 고유명사 추가 (Setting 구조 재사용)
		new Setting(ignoredBox).setName('고유명사 추가').addText(text => {
			text.setPlaceholder('단어 입력 후 Enter');
			const doAdd = async () => {
				const word = text.getValue().trim();
				if (!word) return;
				const list = this.plugin.settings.spellCheckIgnoredWords ?? [];
				if (!list.includes(word)) {
					list.push(word);
					this.plugin.settings.spellCheckIgnoredWords = list;
					await this.plugin.saveSettings();
				}
				text.setValue('');
				this.renderPage('spellcheck');
			};
			text.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') void doAdd(); });
		});
		ignoredBox.createDiv({ cls: 'wm-settings-item-desc', text: '맞춤법 검사에서 오류로 표시하지 않을 단어를 등록합니다. 조사를 제거한 어근 형태로 입력하세요. 예: 김정식' });

		// 2행: 목록 (태그 스타일, 전체 너비 별도 div)
		new Setting(ignoredBox).setName('목록');
		const tagsEl = ignoredBox.createDiv({ cls: 'wm-settings-dict-tags' });
		if (ignoredWords.length === 0) {
			tagsEl.createSpan({ cls: 'wm-settings-dict-empty', text: '등록된 단어가 없습니다.' });
		} else {
			for (const word of ignoredWords) {
				const tag = tagsEl.createSpan({ cls: 'wm-settings-dict-tag' });
				tag.createSpan({ text: word });
				tag.createSpan({ cls: 'wm-settings-dict-tag-remove', text: '×' })
					.addEventListener('click', () => {
						fireAndForget(async () => {
							const idx = this.plugin.settings.spellCheckIgnoredWords.indexOf(word);
							if (idx >= 0) this.plugin.settings.spellCheckIgnoredWords.splice(idx, 1);
							await this.plugin.saveSettings();
							this.renderPage('spellcheck');
						});
					});
			}
		}
	}

	// ── 퇴고 매니저 ────────────────────────────────────────────────────────
	private renderRepetitionPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '퇴고 매니저');

		if (isMorphAnalysisSupported()) {
			this.addGroupTitle(containerEl, '형태소 분석 모델');
			const modelBox = this.createGroupBox(containerEl);
			const modelSetting = new Setting(modelBox)
				.setName('오프라인 형태소 분석 모델')
				.setDesc('확인 중…');
			fireAndForget(async () => {
				const downloaded = await isGaruAssetsDownloaded(this.plugin);
				modelSetting.setDesc(downloaded ? '다운로드 완료 · 완전히 오프라인으로 동작합니다.' : '반복 표현 탐지에 필요합니다. 최초 1회만 다운로드하면 됩니다 (약 1.4MB).');
				if (downloaded) {
					modelSetting.addExtraButton(btn => btn.setIcon('check').setTooltip('다운로드됨').setDisabled(true));
				} else {
					modelSetting.addButton(btn => btn.setButtonText('다운로드').setCta()
						.onClick(() => {
							fireAndForget(async () => {
								btn.setDisabled(true);
								try {
									await downloadGaruAssets(this.plugin, step => { btn.setButtonText(step); });
									this.renderPage('repetition');
								} catch (e) {
									btn.setDisabled(false).setButtonText('다운로드');
									modelBox.createDiv({ cls: 'wm-settings-item-desc', text: `실패: ${e instanceof Error ? e.message : String(e)}` });
								}
							});
						}));
				}
			});
			const engineDesc = modelBox.createDiv({ cls: 'wm-settings-item-desc' });
			engineDesc.appendText('형태소 분석 엔진: ');
			engineDesc.createEl('a', { text: 'garu-ko', href: 'https://github.com/ongjin/garu', attr: { target: '_blank', rel: 'noopener' } });
			engineDesc.appendText(' (오프라인 WASM, 서버 전송 없음)');
		}

		this.addGroupTitle(containerEl, '단어장');
		const vocabBox = this.createGroupBox(containerEl);
		let vocabText: import('obsidian').TextComponent;
		new Setting(vocabBox)
			.setName('경로')
			.setDesc('반복어 카드의 노트북 아이콘을 누르면 이 노트에 단어가 표 형태로 한 행씩 추가됩니다(형태소 분석기가 이미 정규화한 형태이므로 활용형은 따로 만들지 않고 그대로 매칭합니다). 같은 표에 유의어 후보를 적어두면 카드를 펼쳤을 때 칩으로 표시되어 클릭 한 번으로 본문 치환도 가능합니다.')
			.addExtraButton(btn => btn.setIcon('file-text').setTooltip('노트 선택')
				.onClick(() => {
					new NoteSuggestModal(this.app, (file) => {
						fireAndForget(async () => {
							this.plugin.settings.repetitionVocabNotePath = file.path;
							await this.plugin.saveSettings();
							vocabText.setValue(file.path);
						});
					}).open();
				}))
			.addText(text => {
				vocabText = text;
				text.setPlaceholder('예: 단어장.md')
					.setValue(this.plugin.settings.repetitionVocabNotePath)
					.onChange(async value => { this.plugin.settings.repetitionVocabNotePath = value.trim(); await this.plugin.saveSettings(); });
			});
		const formatDesc = vocabBox.createDiv({ cls: 'wm-settings-item-desc' });
		formatDesc.createEl('div', { text: '형식(마크다운 표): | 단어 | 유의어 후보 |' });
		formatDesc.createEl('div', { text: '· 유의어 후보는 콤마로 구분, 비워둬도 됩니다. 예: | 구멍 | 틈, 공백 |' });
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
