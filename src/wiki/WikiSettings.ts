import { Setting } from 'obsidian';
import type WritingMenuPlugin from '../../main';

function groupTitle(el: HTMLElement, text: string) {
	el.createDiv({ cls: 'wm-settings-group-title', text });
}
function groupBox(el: HTMLElement): HTMLElement {
	return el.createDiv({ cls: 'wm-settings-group-box' });
}

export function renderWikiSettingsPage(containerEl: HTMLElement, plugin: WritingMenuPlugin, rerender: () => void) {
	groupTitle(containerEl, '기본');
	const basicBox = groupBox(containerEl);

	new Setting(basicBox)
		.setName('노트 선택 시 카드 목록 접기')
		.setDesc('검색창에서 노트를 선택했을 때 카드 스트립을 접힌 상태로 시작합니다')
		.addToggle(t => t.setValue(plugin.settings.wikiStripCollapsedDefault ?? false)
			.onChange(async v => { plugin.settings.wikiStripCollapsedDefault = v; await plugin.saveSettings(); }));

	groupTitle(containerEl, '속성');
	const propBox = groupBox(containerEl);

	new Setting(propBox)
		.setName('이미지 필드')
		.addText(t => t.setValue(plugin.settings.wikiImageFieldName)
			.onChange(async v => { plugin.settings.wikiImageFieldName = v; await plugin.saveSettings(); }));
	propBox.createDiv({ cls: 'wm-settings-item-desc', text: '위키 프로필의 이미지를 결정하는 프론트매터 키입니다.' });

	new Setting(propBox)
		.setName('이름 필드')
		.addText(t => t.setValue(plugin.settings.wikiNameFieldName)
			.onChange(async v => { plugin.settings.wikiNameFieldName = v; await plugin.saveSettings(); }));
	propBox.createDiv({ cls: 'wm-settings-item-desc', text: '위키 프로필의 제목을 결정하는 프론트매터 키입니다. 값이 없는 경우 노트명이 프로필 제목이 됩니다.' });

	new Setting(propBox)
		.setName('관계 필드')
		.addTextArea(t => t.setValue(plugin.settings.wikiRelationFields || '')
			.onChange(async v => { plugin.settings.wikiRelationFields = v; await plugin.saveSettings(); }));
	propBox.createDiv({ cls: 'wm-settings-item-desc', text: '프론트매터와 링크를 활용해 해당 노트의 관계성을 시각화해줍니다. 소설 집필의 예로 들면, \'대적자\'를 관계 필드로 등록하면 해당 프론트매터에 링크된 노트를 시각적으로 배열해줍니다.' });

	new Setting(propBox)
		.setName('숨길 속성')
		.setClass('wiki-settings-textarea')
		.addTextArea(t => t.setValue((plugin.settings.wikiHiddenProperties || []).join(', '))
			.onChange(async v => {
				plugin.settings.wikiHiddenProperties = v.split(',').map(s => s.trim()).filter(s => s.length > 0);
				await plugin.saveSettings();
			}));
	propBox.createDiv({ cls: 'wm-settings-item-desc', text: '위키 프로필상에서 숨기고 싶은 속성을 입력하세요.' });

	groupTitle(containerEl, '스타일');
	const styleBox = groupBox(containerEl);

	new Setting(styleBox)
		.setName('프로필 제목 폰트 크기')
		.addSlider(s => s.setLimits(10, 30, 1).setValue(plugin.settings.wikiProfileHeaderSize ?? 18)
			.onChange(async v => { plugin.settings.wikiProfileHeaderSize = v; await plugin.saveSettings(); rerender(); }));

	new Setting(styleBox)
		.setName('프로필 속성 폰트 크기')
		.addSlider(s => s.setLimits(8, 20, 1).setValue(plugin.settings.wikiProfileKeySize ?? 13)
			.onChange(async v => { plugin.settings.wikiProfileKeySize = v; await plugin.saveSettings(); rerender(); }));
}
