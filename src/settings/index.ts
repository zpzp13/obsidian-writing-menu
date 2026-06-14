import { App, PluginSettingTab, Setting, setIcon, Platform } from 'obsidian';
import type WritingMenuPlugin from '../../main';

/** CSS --interactive-accent 값을 hex로 변환 (canvas 픽셀 읽기) */
function accentColorToHex(): string {
	try {
		const raw = getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim();
		if (!raw) return '#4f9cf9';
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 1;
		const ctx = canvas.getContext('2d');
		if (!ctx) return '#4f9cf9';
		ctx.fillStyle = raw;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data);
		return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
	} catch {
		return '#4f9cf9';
	}
}

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
			case 'time':             this.renderTimePage(containerEl); break;
			case 'dictionary':       this.renderDictionaryPage(containerEl); break;
			case 'version-control':  this.renderVersionPage(containerEl); break;
			case 'calendar':         this.renderCalendarPage(containerEl); break;
			case 'calendar-chars':   this.renderCalendarCharsPage(containerEl); break;
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
		this.addNavCard(editorBox, '타이포그래피', 'H1, 각주 글꼴 · 크기 · 행간 · 색상', 'type', 'typography');
		this.addNavCard(editorBox, '입력 보조', '자동완성 기호, 텍스트 치환', 'keyboard', 'input');
		this.addNavCard(editorBox, '복사 및 내보내기', '복사 옵션, TXT · HWP 내보내기', 'file-output', 'copy-export');

		this.addGroupTitle(containerEl, '캘린더');
		const calBox = this.createGroupBox(containerEl);
		this.addNavCard(calBox, '캘린더 설정', '캘린더 표시, 탭, 위젯, 대시보드 설정', 'calendar', 'calendar');

		this.addGroupTitle(containerEl, '기타');
		const etcBox = this.createGroupBox(containerEl);
		this.addNavCard(etcBox, '작업 시간', '스톱워치 · 알람, 메뉴 표시 설정', 'timer', 'time');
		this.addNavCard(etcBox, '사전', '표준국어대사전 API 키', 'book-open', 'dictionary');
		this.addNavCard(etcBox, '버전 관리', '스냅샷 저장 위치 및 최대 보관 개수', 'history', 'version-control');
	}

	// ── 타이포그래피 ────────────────────────────────────────────────────

	private renderTypographyPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '타이포그래피');

		this.addGroupTitle(containerEl, '헤딩(H1) 스타일');
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

		this.addGroupTitle(containerEl, '각주 스타일');
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

		if (Platform.isMobile) {
			this.addGroupTitle(containerEl, '색상 설정 (HEX)');
			const hexBox = this.createGroupBox(containerEl);

			const fontColorVal = this.plugin.settings.fontColor;
			const fontColorLight = typeof fontColorVal === 'string' ? fontColorVal : fontColorVal.light;
			const fontColorDark  = typeof fontColorVal === 'string' ? fontColorVal : fontColorVal.dark;

			new Setting(hexBox).setName('글자색 (라이트 모드)')
				.addText(text => text.setPlaceholder('#000000 또는 inherit').setValue(fontColorLight)
					.onChange(async value => {
						this.plugin.settings.fontColor = { light: value || 'inherit', dark: fontColorDark };
						await this.plugin.saveSettings();
					}));

			new Setting(hexBox).setName('글자색 (다크 모드)')
				.addText(text => text.setPlaceholder('#ffffff 또는 inherit').setValue(fontColorDark)
					.onChange(async value => {
						const light = typeof this.plugin.settings.fontColor === 'string' ? this.plugin.settings.fontColor : this.plugin.settings.fontColor.light;
						this.plugin.settings.fontColor = { light, dark: value || 'inherit' };
						await this.plugin.saveSettings();
					}));

			const bgColorVal = this.plugin.settings.backgroundColor;
			const bgColorLight = typeof bgColorVal === 'string' ? bgColorVal : bgColorVal.light;
			const bgColorDark  = typeof bgColorVal === 'string' ? bgColorVal : bgColorVal.dark;

			new Setting(hexBox).setName('배경색 (라이트 모드)')
				.addText(text => text.setPlaceholder('#ffffff 또는 transparent').setValue(bgColorLight)
					.onChange(async value => {
						this.plugin.settings.backgroundColor = { light: value || 'transparent', dark: bgColorDark };
						await this.plugin.saveSettings();
					}));

			new Setting(hexBox).setName('배경색 (다크 모드)')
				.addText(text => text.setPlaceholder('#000000 또는 transparent').setValue(bgColorDark)
					.onChange(async value => {
						const light = typeof this.plugin.settings.backgroundColor === 'string' ? this.plugin.settings.backgroundColor : this.plugin.settings.backgroundColor.light;
						this.plugin.settings.backgroundColor = { light, dark: value || 'transparent' };
						await this.plugin.saveSettings();
					}));
		}
	}

	// ── 입력 보조 ───────────────────────────────────────────────────────

	private renderInputPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '입력 보조');

		this.addGroupTitle(containerEl, '자동완성');
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
				reqNote.style.cssText = 'font-size:12px; color:var(--text-muted); margin-bottom:8px; padding: 0 2px;';
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

	private renderTimePage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '작업 시간');

		this.addGroupTitle(containerEl, '표시');
		const displayBox = this.createGroupBox(containerEl);
		new Setting(displayBox).setName('작업 시간 숨기기').setDesc('드롭다운 메뉴에서 작업 시간 항목을 숨깁니다.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.hideTimeTracking)
				.onChange(async value => { this.plugin.settings.hideTimeTracking = value; await this.plugin.saveSettings(); }));

		this.addGroupTitle(containerEl, '스톱워치');
		const swBox = this.createGroupBox(containerEl);

		new Setting(swBox).setName('기본 시간 (분)').setDesc('카운트다운 기본 시간')
			.addText(text => text.setValue(String(this.plugin.settings.stopwatchMinutes))
				.onChange(async value => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) { this.plugin.settings.stopwatchMinutes = num; await this.plugin.saveSettings(); }
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

		this.addGroupTitle(containerEl, '집필 시간 목표');
		const tgBox = this.createGroupBox(containerEl);
		const goalDefs: Array<{ key: 'draft' | 'writing' | 'editing'; label: string }> = [
			{ key: 'draft',   label: '초고 목표 시간 (분)' },
			{ key: 'writing', label: '집필 목표 시간 (분)' },
			{ key: 'editing', label: '퇴고 목표 시간 (분)' },
		];
		const ensureGoals = () => {
			if (!this.plugin.settings.timeGoals) {
				this.plugin.settings.timeGoals = { draft: 0, writing: 0, editing: 0 };
			}
			return this.plugin.settings.timeGoals;
		};
		for (const { key, label } of goalDefs) {
			new Setting(tgBox).setName(label).setDesc('0 = 미설정 (폴더 평균 기준으로 표시)')
				.addText(t => {
					t.setPlaceholder('0')
					 .setValue(String(Math.round((ensureGoals()[key] ?? 0) / 60)))
					 .onChange(async v => {
						const min = parseInt(v) || 0;
						ensureGoals()[key] = min * 60;
						await this.plugin.saveSettings();
					 });
					t.inputEl.type = 'number';
					t.inputEl.min  = '0';
				});
		}

		this.addGroupTitle(containerEl, '집필 시간 프론트매터 키');
		const tkBox = this.createGroupBox(containerEl);
		const timeKeyDefs: Array<{ key: 'draft' | 'writing' | 'editing' | 'total'; label: string }> = [
			{ key: 'draft',   label: '초고 모드 키' },
			{ key: 'writing', label: '집필 모드 키' },
			{ key: 'editing', label: '퇴고 모드 키' },
			{ key: 'total',   label: '총 시간 키' },
		];
		const ensureTimeKeys = () => {
			if (!this.plugin.settings.timeKeys) {
				this.plugin.settings.timeKeys = { draft: '초고_시간', writing: '집필_시간', editing: '퇴고_시간', total: '총_시간' };
			}
			return this.plugin.settings.timeKeys;
		};
		for (const { key, label } of timeKeyDefs) {
			new Setting(tkBox).setName(label)
				.addText(t => t
					.setValue(ensureTimeKeys()[key])
					.onChange(async v => {
						ensureTimeKeys()[key] = v.trim();
						await this.plugin.saveSettings();
					}));
		}
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
						text.inputEl.style.cssText = 'width:167px; height:30px;';
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
		this.addBackButton(containerEl, '캘린더 설정');

		this.addGroupTitle(containerEl, '히트맵');
		const heatBox = this.createGroupBox(containerEl);

		new Setting(heatBox)
			.setName('히트맵 기준')
			.setDesc('달력 각 날짜의 색상 강도를 결정하는 데이터 기준')
			.addDropdown(dd => dd
				.addOption('files', '전체 파일 — 수정된 파일 수')
				.addOption('daily-notes', '데일리 노트 — YYYY-MM-DD 형식 파일')
				.addOption('time', '작업 시간 — 시간 추적 데이터')
				.addOption('tasks', '완료 태스크 — 체크박스 완료 수')
				.setValue(this.plugin.settings.calendarHeatmapSource)
				.onChange(async v => {
					this.plugin.settings.calendarHeatmapSource = v as 'files' | 'daily-notes' | 'time' | 'tasks';
					await this.plugin.saveSettings();
				}));

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

		this.addGroupTitle(containerEl, '대시보드');
		const dashBox = this.createGroupBox(containerEl);
		this.addNavCard(dashBox, '글자수', '추적 폴더, 목표 글자수, 히트맵 색상', 'type', 'calendar-chars');
	}

	private renderCalendarCharsPage(containerEl: HTMLElement) {
		this.addBackButton(containerEl, '글자수 설정');

		this.addGroupTitle(containerEl, '오늘 글자수');
		const todayBox = this.createGroupBox(containerEl);

		new Setting(todayBox)
			.setName('추적 폴더')
			.setDesc('이 폴더 안의 파일만 오늘 글자수에 집계합니다. 비워 두면 전체 노트를 집계합니다.')
			.addText(t => t
				.setPlaceholder('예: 소설/집필')
				.setValue(this.plugin.settings.heatmapFolder ?? '')
				.onChange(async v => {
					this.plugin.settings.heatmapFolder = v.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(todayBox)
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

		this.addGroupTitle(containerEl, '히트맵');
		const hmBox = this.createGroupBox(containerEl);

		let colorPickerRef: any = null;
		new Setting(hmBox)
			.setName('히트맵 색상')
			.setDesc('강조 색상 베이스 (레벨 4 기준)')
			.addExtraButton(btn => btn
				.setIcon('rotate-ccw')
				.setTooltip('테마 강조색으로 되돌리기')
				.onClick(async () => {
					const hex = accentColorToHex();
					this.plugin.settings.heatmapColor = hex;
					await this.plugin.saveSettings();
					colorPickerRef?.setValue(hex);
				}))
			.addColorPicker(cp => {
				colorPickerRef = cp;
				cp.setValue(this.plugin.settings.heatmapColor ?? '#4f9cf9')
					.onChange(async v => {
						this.plugin.settings.heatmapColor = v;
						await this.plugin.saveSettings();
					});
			});

		const levelLabels = ['레벨 1', '레벨 2', '레벨 3', '레벨 4'];
		const levelDescs  = ['가장 연한 색', '중간 연한 색', '중간 진한 색', '가장 진한 색'];
		const defaultLevels: [number, number, number, number] = [2000, 4000, 6000, 8000];

		new Setting(hmBox)
			.setName('레벨 기준 (글자수)')
			.setDesc('각 색상 레벨의 최소 글자수 기준. 레벨 4 이상은 모두 동일 색상.');

		levelLabels.forEach((label, i) => {
			new Setting(hmBox)
				.setName(label)
				.setDesc(levelDescs[i])
				.addText(t => {
					const levels = this.plugin.settings.heatmapLevels ?? defaultLevels;
					t.setPlaceholder(String(defaultLevels[i]))
					 .setValue(String(levels[i]))
					 .onChange(async v => {
						const n = parseInt(v);
						if (isNaN(n) || n < 0) return;
						const cur = [...(this.plugin.settings.heatmapLevels ?? defaultLevels)] as [number, number, number, number];
						cur[i] = n;
						this.plugin.settings.heatmapLevels = cur;
						await this.plugin.saveSettings();
					 });
					t.inputEl.type = 'number';
					t.inputEl.min = '0';
				});
		});
	}

	// ── 자동완성 심볼 ────────────────────────────────────────────────────

	displaySymbolPairs(container: HTMLElement) {
		container.empty();
		const addBtnRow = container.createDiv();
		addBtnRow.style.cssText = 'display:flex; justify-content:flex-start; margin-bottom:12px;';
		addBtnRow.createEl('button', { text: '새 트리거 추가', cls: 'mod-cta' }).onclick = async () => {
			this.plugin.settings.symbolTriggers.push({ trigger: '', options: [{ open: '', close: '' }], enabled: true });
			await this.plugin.saveSettings();
			this.displaySymbolPairs(container);
		};

		const kanban = container.createDiv('writing-menu-kanban');
		kanban.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:12px; list-style:none; width:60%;';

		this.plugin.settings.symbolTriggers.forEach((trigger, tIndex) => {
			const card = kanban.createDiv('writing-menu-card');
			card.style.cssText = `border:1px solid var(--background-modifier-border); border-radius:10px;
				background:var(--background-primary); padding:12px; direction:ltr;
				box-shadow:0 1px 2px rgba(0,0,0,0.05); display:flex; flex-direction:column; gap:10px;
				opacity:${trigger.enabled !== false ? '1' : '0.7'}; transition:opacity 0.2s;`;

			const header = card.createDiv();
			header.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:4px;';

			const toggleDiv = header.createDiv();
			toggleDiv.style.cssText = 'display:flex; align-items:center;';
			new Setting(toggleDiv).addToggle(t => t.setValue(trigger.enabled !== false).onChange(async v => {
				trigger.enabled = v; await this.plugin.saveSettings(); this.displaySymbolPairs(container);
			})).setName('').setDesc('');
			(toggleDiv.querySelector('.setting-item') as HTMLElement)?.setAttribute('style', 'border:none;padding:0;margin:0;min-height:auto;display:flex;align-items:center;');
			(toggleDiv.querySelector('.setting-item-info') as HTMLElement)?.setAttribute('style', 'display:none;');
			(toggleDiv.querySelector('.setting-item-control') as HTMLElement)?.setAttribute('style', 'padding:0;margin:0;');

			const input = header.createEl('input', { type: 'text', value: trigger.trigger });
			input.style.cssText = 'flex:1; text-align:center; font-weight:bold; border-radius:4px; border:1px solid var(--background-modifier-border); padding:4px; min-width:0;';
			input.onchange = async () => { trigger.trigger = input.value; await this.plugin.saveSettings(); };

			const del = header.createDiv('clickable-icon');
			setIcon(del, 'trash-2');
			del.style.cssText = 'color:var(--text-muted); cursor:pointer;';
			del.onclick = async () => { this.plugin.settings.symbolTriggers.splice(tIndex, 1); await this.plugin.saveSettings(); this.displaySymbolPairs(container); };

			card.createDiv().style.cssText = 'height:1px; background:var(--background-modifier-border);';

			const pairs = card.createDiv();
			pairs.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
			trigger.options.forEach((opt, oIndex) => {
				const row = pairs.createDiv();
				row.style.cssText = 'display:flex; align-items:center; gap:6px;';
				const inputStyle = 'flex:1; text-align:center; border:1px solid var(--background-modifier-border); border-radius:4px; padding:4px; background:var(--background-primary-alt); min-width:0;';

				const open = row.createEl('input', { type: 'text', value: opt.open });
				open.style.cssText = inputStyle;
				open.onchange = async () => { opt.open = open.value; await this.plugin.saveSettings(); };

				row.createSpan({ text: '→' }).style.cssText = 'color:var(--text-muted); font-size:12px; flex-shrink:0;';

				const close = row.createEl('input', { type: 'text', value: opt.close });
				close.style.cssText = inputStyle;
				close.onchange = async () => { opt.close = close.value; await this.plugin.saveSettings(); };

				const rm = row.createDiv('clickable-icon');
				setIcon(rm, 'x');
				rm.style.cssText = 'color:var(--text-muted); opacity:0.6; cursor:pointer; flex-shrink:0;';
				rm.onclick = async () => { trigger.options.splice(oIndex, 1); await this.plugin.saveSettings(); this.displaySymbolPairs(container); };
			});

			const addP = card.createDiv();
			addP.textContent = '+';
			addP.style.cssText = 'text-align:center; color:var(--text-accent); cursor:pointer; font-size:16px;';
			addP.onclick = async () => { trigger.options.push({ open: '', close: '' }); await this.plugin.saveSettings(); this.displaySymbolPairs(container); };
		});
	}

	// ── 텍스트 치환 ─────────────────────────────────────────────────────

	displayTextSubstitutions(container: HTMLElement) {
		container.empty();

		const addBtnRow = container.createDiv();
		addBtnRow.style.cssText = 'display:flex; justify-content:flex-start; margin-bottom:12px;';
		addBtnRow.createEl('button', { text: '새 치환 추가', cls: 'mod-cta' }).onclick = async () => {
			this.plugin.settings.textSubstitutions.push({ from: '', to: '', enabled: true });
			await this.plugin.saveSettings();
			this.displayTextSubstitutions(container);
		};

		const list = container.createDiv();
		list.style.cssText = `display:flex; flex-direction:column; gap:8px; width:${Platform.isMobile ? '100%' : '60%'};`;

		this.plugin.settings.textSubstitutions.forEach((sub, index) => {
			const row = list.createDiv();
			row.style.cssText = `display:flex; align-items:center; gap:10px; padding:8px 12px;
				border:1px solid var(--background-modifier-border); border-radius:8px;
				background:var(--background-primary); opacity:${sub.enabled ? '1' : '0.6'}; transition:opacity 0.2s;`;

			const toggleDiv = row.createDiv();
			toggleDiv.style.cssText = 'display:flex; align-items:center;';
			new Setting(toggleDiv).addToggle(t => t.setValue(sub.enabled).onChange(async v => {
				sub.enabled = v; await this.plugin.saveSettings(); this.displayTextSubstitutions(container);
			})).setName('').setDesc('');
			(toggleDiv.querySelector('.setting-item') as HTMLElement)?.setAttribute('style', 'border:none;padding:0;margin:0;min-height:auto;display:flex;align-items:center;');
			(toggleDiv.querySelector('.setting-item-info') as HTMLElement)?.setAttribute('style', 'display:none;');
			(toggleDiv.querySelector('.setting-item-control') as HTMLElement)?.setAttribute('style', 'padding:0;margin:0;');

			const fromInput = row.createEl('input', { type: 'text', value: sub.from });
			fromInput.style.cssText = 'flex:1; text-align:center; border:1px solid var(--background-modifier-border); border-radius:4px; padding:6px; min-width:60px;';
			fromInput.placeholder = '입력';
			fromInput.onchange = async () => { sub.from = fromInput.value; await this.plugin.saveSettings(); };

			row.createSpan({ text: '→' }).style.cssText = 'color:var(--text-muted); font-size:14px;';

			const toInput = row.createEl('input', { type: 'text', value: sub.to });
			toInput.style.cssText = 'flex:1; text-align:center; border:1px solid var(--background-modifier-border); border-radius:4px; padding:6px; min-width:60px;';
			toInput.placeholder = '변환';
			toInput.onchange = async () => { sub.to = toInput.value; await this.plugin.saveSettings(); };

			const del = row.createDiv('clickable-icon');
			setIcon(del, 'trash-2');
			del.style.cssText = 'color:var(--text-muted); cursor:pointer;';
			del.onclick = async () => {
				this.plugin.settings.textSubstitutions.splice(index, 1);
				await this.plugin.saveSettings();
				this.displayTextSubstitutions(container);
			};
		});
	}
}
