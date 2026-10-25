import { wmT } from '../i18n/index';
import { Setting } from 'obsidian';
import type WritingMenuPlugin from '../../main';

function titlelessGroup(el: HTMLElement): HTMLElement {
	const groupEl = el.createDiv({ cls: 'setting-group' });
	groupEl.createDiv({ cls: 'setting-group-search', attr: { tabindex: '-1' } });
	return groupEl.createDiv({ cls: 'setting-items' });
}

function groupBox(el: HTMLElement, heading: string): HTMLElement {
	const groupEl = el.createDiv({ cls: 'setting-group' });
	const headingEl = groupEl.createDiv({ cls: 'setting-item setting-item-heading' });
	headingEl.createDiv({ cls: 'setting-item-name', text: heading });
	headingEl.createDiv({ cls: 'setting-item-control' });
	groupEl.createDiv({ cls: 'setting-group-search', attr: { tabindex: '-1' } });
	return groupEl.createDiv({ cls: 'setting-items' });
}

export function renderWikiSettingsPage(containerEl: HTMLElement, plugin: WritingMenuPlugin, rerender: () => void) {
	const propertyBox = titlelessGroup(containerEl);

	new Setting(propertyBox)
		.setName(wmT("이미지"))
		.setDesc(wmT("프로필 이미지의 경로(속성)를 입력하세요."))
		.addText(text => text
			.setValue(plugin.settings.wikiImageFieldName)
			.onChange(async value => {
				plugin.settings.wikiImageFieldName = value.trim();
				await plugin.saveSettings();
			}));

	new Setting(propertyBox)
		.setName(wmT("제목"))
		.setDesc(wmT("프로필 제목의 경로(속성)를 입력하세요. 없으면 노트 제목을 적용합니다."))
		.addText(text => text
			.setValue(plugin.settings.wikiNameFieldName)
			.onChange(async value => {
				plugin.settings.wikiNameFieldName = value.trim();
				await plugin.saveSettings();
			}));

	new Setting(propertyBox)
		.setName(wmT("관계도"))
		.setDesc(wmT("속성을 입력하면 인물간 관계도를 시각화합니다. 단, 속성값에 인물 링크가 있어야 합니다."))
		.addTextArea(textarea => textarea
			.setValue(plugin.settings.wikiRelationFields || '')
			.onChange(async value => {
				plugin.settings.wikiRelationFields = value;
				await plugin.saveSettings();
			}));

	new Setting(propertyBox)
		.setName(wmT("숨길 속성"))
		.setDesc(wmT("프로필에서 숨기고 싶은 속성을 입력하세요."))
		.setClass('wiki-settings-textarea')
		.addTextArea(textarea => textarea
			.setValue((plugin.settings.wikiHiddenProperties || []).join(', '))
			.onChange(async value => {
				plugin.settings.wikiHiddenProperties = value
					.split(',')
					.map(item => item.trim())
					.filter(Boolean);
				await plugin.saveSettings();
			}));

	const styleBox = groupBox(containerEl, wmT("프로필 스타일"));
	new Setting(styleBox)
		.setName(wmT("제목 크기"))
		.addSlider(slider => slider
			.setLimits(10, 30, 1)
			.setValue(plugin.settings.wikiProfileHeaderSize ?? 18)
			.onChange(async value => {
				plugin.settings.wikiProfileHeaderSize = value;
				await plugin.saveSettings();
				rerender();
			}));

	new Setting(styleBox)
		.setName(wmT("속성 크기"))
		.addSlider(slider => slider
			.setLimits(8, 20, 1)
			.setValue(plugin.settings.wikiProfileKeySize ?? 13)
			.onChange(async value => {
				plugin.settings.wikiProfileKeySize = value;
				plugin.settings.wikiProfileValueSize = value;
				await plugin.saveSettings();
				rerender();
			}));
}
