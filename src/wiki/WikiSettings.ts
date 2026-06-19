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
		.setDesc('프로필 이미지로 사용할 프론트매터 키')
		.addText(t => t.setValue(plugin.settings.wikiImageFieldName)
			.onChange(async v => { plugin.settings.wikiImageFieldName = v; await plugin.saveSettings(); }));

	new Setting(propBox)
		.setName('이름 필드')
		.setDesc('프로필 헤더에 표시할 프론트매터 키')
		.addText(t => t.setValue(plugin.settings.wikiNameFieldName)
			.onChange(async v => { plugin.settings.wikiNameFieldName = v; await plugin.saveSettings(); }));

	new Setting(propBox)
		.setName('관계 필드')
		.setDesc('관계 스트립에 표시할 프론트매터 키 (쉼표 구분, 예: 조력자, 적대자)')
		.addText(t => t.setValue(plugin.settings.wikiRelationFields || '')
			.onChange(async v => { plugin.settings.wikiRelationFields = v; await plugin.saveSettings(); }));

	new Setting(propBox)
		.setName('숨길 속성')
		.setDesc('프로필 테이블에서 숨길 프론트매터 키 (쉼표 구분)')
		.setClass('wiki-settings-textarea')
		.addTextArea(t => t.setValue((plugin.settings.wikiHiddenProperties || []).join(', '))
			.onChange(async v => {
				plugin.settings.wikiHiddenProperties = v.split(',').map(s => s.trim()).filter(s => s.length > 0);
				await plugin.saveSettings();
			}));

	groupTitle(containerEl, '스타일');
	const styleBox = groupBox(containerEl);

	new Setting(styleBox)
		.setName('프로필 제목 폰트 크기')
		.addSlider(s => s.setLimits(10, 30, 1).setValue(plugin.settings.wikiProfileHeaderSize ?? 18).setDynamicTooltip()
			.onChange(async v => { plugin.settings.wikiProfileHeaderSize = v; await plugin.saveSettings(); rerender(); }));

	new Setting(styleBox)
		.setName('프로필 속성 폰트 크기')
		.addSlider(s => s.setLimits(8, 20, 1).setValue(plugin.settings.wikiProfileKeySize ?? 13).setDynamicTooltip()
			.onChange(async v => { plugin.settings.wikiProfileKeySize = v; await plugin.saveSettings(); rerender(); }));
}
