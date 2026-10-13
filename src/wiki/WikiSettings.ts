import { Notice, Setting } from 'obsidian';
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
		.setName('헤더 자동 숨김')
		.setDesc('켜면 상단 툴바가 평소엔 숨겨져 있다가 마우스를 올렸을 때만 나타납니다.')
		.addToggle(t => t.setValue(plugin.settings.wikiToolbarAutoHide ?? false)
			.onChange(async v => { plugin.settings.wikiToolbarAutoHide = v; await plugin.saveSettings(); }));

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
	propBox.createDiv({
		cls: 'wm-settings-item-desc',
		text: '프론트매터의 순수 위키링크를 사용해 관계를 시각화합니다. 관계 필드명이 그래프의 관계명과 색상 분류로 사용됩니다.',
	});

	new Setting(propBox)
		.setName('그래프 분류 필드')
		.setDesc('그래프의 분류 메뉴에서 강조할 프론트매터 키입니다. 비워두면 태그를 사용합니다.')
		.addText(t => t
			.setPlaceholder('예: 소속')
			.setValue(plugin.settings.wikiDefaultGroupField === 'None' ? '' : plugin.settings.wikiDefaultGroupField)
			.onChange(async value => {
				plugin.settings.wikiDefaultGroupField = value.trim() || 'None';
				await plugin.saveSettings();
			}));

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
	const notifyGraphStyleChange = () => {
		const EventConstructor = containerEl.ownerDocument.defaultView?.Event;
		if (EventConstructor) containerEl.ownerDocument.dispatchEvent(new EventConstructor('writing-menu-wiki-graph-style-change'));
	};
	styleBox.createDiv({
		cls: 'wm-settings-item-desc',
		text: '프론트매터 관계 키를 직접 입력해 관계명 색상을 지정합니다. 지정하지 않은 관계명은 테마 기본 색상을 사용합니다.',
	});
	for (const [storedKey, storedColor] of Object.entries(plugin.settings.wikiGraphRelationLabelColors ?? {})) {
		let currentKey = storedKey;
		new Setting(styleBox)
			.setName('관계명 색상')
			.addText(text => text
				.setPlaceholder('프론트매터 키')
				.setValue(storedKey)
				.onChange(async value => {
					const nextKey = value.trim();
					if (!nextKey || nextKey === currentKey) return;
					const colors = { ...(plugin.settings.wikiGraphRelationLabelColors ?? {}) };
					const color = colors[currentKey] ?? storedColor;
					delete colors[currentKey];
					colors[nextKey] = color;
					currentKey = nextKey;
					plugin.settings.wikiGraphRelationLabelColors = colors;
					await plugin.saveSettings();
					notifyGraphStyleChange();
				}))
			.addColorPicker(picker => picker
				.setValue(storedColor)
				.onChange(async value => {
					plugin.settings.wikiGraphRelationLabelColors = {
						...(plugin.settings.wikiGraphRelationLabelColors ?? {}),
						[currentKey]: value,
					};
					await plugin.saveSettings();
					notifyGraphStyleChange();
				}))
			.addExtraButton(button => button
				.setIcon('trash-2')
				.setTooltip('색상 설정 삭제')
				.onClick(async () => {
					const colors = { ...(plugin.settings.wikiGraphRelationLabelColors ?? {}) };
					delete colors[currentKey];
					plugin.settings.wikiGraphRelationLabelColors = colors;
					await plugin.saveSettings();
					notifyGraphStyleChange();
					rerender();
				}));
	}

	let draftKey = '';
	let draftColor = '#888888';
	new Setting(styleBox)
		.setName('관계명 색상 추가')
		.addText(text => text
			.setPlaceholder('프론트매터 키')
			.onChange(value => { draftKey = value.trim(); }))
		.addColorPicker(picker => picker
			.setValue(draftColor)
			.onChange(value => { draftColor = value; }))
		.addButton(button => button
			.setButtonText('추가')
			.onClick(async () => {
				if (!draftKey) {
					new Notice('프론트매터 키를 입력하세요.');
					return;
				}
				plugin.settings.wikiGraphRelationLabelColors = {
					...(plugin.settings.wikiGraphRelationLabelColors ?? {}),
					[draftKey]: draftColor,
				};
				await plugin.saveSettings();
				notifyGraphStyleChange();
				rerender();
			}));

	new Setting(styleBox)
		.setName('프로필 제목 폰트 크기')
		.addSlider(s => s.setLimits(10, 30, 1).setValue(plugin.settings.wikiProfileHeaderSize ?? 18)
			.onChange(async v => { plugin.settings.wikiProfileHeaderSize = v; await plugin.saveSettings(); rerender(); }));

	new Setting(styleBox)
		.setName('프로필 속성 폰트 크기')
		.addSlider(s => s.setLimits(8, 20, 1).setValue(plugin.settings.wikiProfileKeySize ?? 13)
			.onChange(async v => { plugin.settings.wikiProfileKeySize = v; await plugin.saveSettings(); rerender(); }));
}
