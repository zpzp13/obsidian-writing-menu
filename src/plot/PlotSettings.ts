import { Setting, TextComponent } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { NoteSuggestModal } from '../wiki/WikiModals';

export function renderPlotSettingsPage(containerEl: HTMLElement, plugin: WritingMenuPlugin): void {
	const box = containerEl.createDiv({ cls: 'wm-settings-group-box' });

	new Setting(box)
		.setName('루트 폴더')
		.setDesc('플롯 관련 파일이 저장될 볼트 내 최상위 폴더 경로')
		.addText(text => text
			.setPlaceholder('예: 소설')
			.setValue(plugin.settings.plotManagerFolder)
			.onChange(async (val) => {
				plugin.settings.plotManagerFolder = val.trim();
				await plugin.saveSettings();
			}));

	new Setting(box)
		.setName('플롯 폴더명')
		.setDesc('루트 폴더 안에서 플롯 파일을 저장할 하위 폴더 이름 (예: 플롯 → 루트/플롯/)')
		.addText(text => text
			.setPlaceholder('예: 플롯')
			.setValue(plugin.settings.plotDataFolder)
			.onChange(async (val) => {
				plugin.settings.plotDataFolder = val.trim();
				await plugin.saveSettings();
			}));

	new Setting(box)
		.setName('캐릭터 노트 폴더명')
		.setDesc('루트 폴더 안에서 캐릭터 노트를 저장할 하위 폴더 이름 (예: 인물 → 루트/인물/)')
		.addText(text => text
			.setPlaceholder('예: 인물')
			.setValue(plugin.settings.plotCharFolder)
			.onChange(async (val) => {
				plugin.settings.plotCharFolder = val.trim();
				await plugin.saveSettings();
			}));

	let templateTextComp: TextComponent;
	new Setting(box)
		.setName('캐릭터 노트 템플릿')
		.setDesc('새 캐릭터 노트 생성 시 적용할 템플릿 파일 경로')
		.addExtraButton(btn => btn
			.setIcon('document')
			.setTooltip('파일 선택')
			.onClick(() => {
				new NoteSuggestModal(plugin.app, async (file) => {
					plugin.settings.plotCharNoteTemplate = file.path;
					await plugin.saveSettings();
					templateTextComp.setValue(file.path);
				}).open();
			}))
		.addText(text => {
			templateTextComp = text;
			text.setPlaceholder('예: 템플릿/인물 템플릿.md')
				.setValue(plugin.settings.plotCharNoteTemplate)
				.onChange(async (val) => {
					plugin.settings.plotCharNoteTemplate = val.trim();
					await plugin.saveSettings();
				});
		});

	new Setting(box)
		.setName('캐릭터 노트 열기')
		.setDesc('"노트 열기" 버튼을 눌렀을 때 노트를 여는 방식')
		.addDropdown(dd => dd
			.addOption('tab', '새 탭')
			.addOption('window', '새 창')
			.setValue(plugin.settings.plotCharNoteOpenMode ?? 'tab')
			.onChange(async (val) => {
				plugin.settings.plotCharNoteOpenMode = val as 'tab' | 'window';
				await plugin.saveSettings();
			}));
}
