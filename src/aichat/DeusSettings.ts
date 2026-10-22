import { Setting } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { deusChatModels, effectiveChatModel } from './AiChatApi';
import { renderRagSettings } from './rag/RagSettings';

interface DeusSettingsLayout {
	section(title: string): HTMLElement;
	openApi(): void;
}

/** Only controls used by Deus; the surrounding settings tab owns navigation/layout. */
export function renderDeusSettings(plugin: WritingMenuPlugin, layout: DeusSettingsLayout): void {
	renderRagSettings(layout.section('알아둬야 할 것들'));
	const container = layout.section('대화'), settings = plugin.settings;
	new Setting(container).setName('모델').addDropdown(select => {
		for (const model of deusChatModels(settings)) select.addOption(model.id, model.label);
		select.setValue(effectiveChatModel(settings)).onChange(async value => {
			if (settings.aiChatFreeOnly) settings.aiChatFreeModel = value;
			else settings.aiChatModel = value;
			await plugin.saveSettings();
		});
	});
	new Setting(container).setName('API 키').addButton(button => button.setButtonText('API 열기').onClick(() => layout.openApi()));
	new Setting(container).setName('스트리밍').setDesc('답변을 생성되는 순서대로 표시합니다.')
		.addToggle(toggle => toggle.setValue(settings.aiChatStreaming).onChange(async value => { settings.aiChatStreaming = value; await plugin.saveSettings(); }));
	new Setting(container).setName('각주 열기').setDesc('채팅 답변의 각주와 출처 목록을 열 위치입니다.')
		.addDropdown(select => select.addOption('current', '현재 탭에서 열기').addOption('tab', '새 탭에서 열기')
			.setValue(settings.aiChatCitationOpenMode === 'tab' ? 'tab' : 'current').onChange(async value => {
				settings.aiChatCitationOpenMode = value === 'tab' ? 'tab' : 'current';
				await plugin.saveSettings();
			}));
	const integer = (name: string, key: 'aiChatMaxOutputTokens' | 'aiChatHistoryTurns', minimum: number) => {
		new Setting(container).setName(name).addText(text => text.setValue(String(settings[key])).onChange(async value => {
			const number = Number(value);
			if (Number.isSafeInteger(number) && number >= minimum) { settings[key] = number; await plugin.saveSettings(); }
		}));
	};
	integer('최대 응답 토큰', 'aiChatMaxOutputTokens', 1);
	integer('최근 대화 왕복 수 (0: 전체)', 'aiChatHistoryTurns', 0);
	for (const [key, name] of [['aiChatNarrationFontSize', '지문 크기'], ['aiChatDialogueFontSize', '대사 크기']] as const) {
		new Setting(container).setName(name).setDesc('Character 스킬의 글자 크기 배율입니다.').addText(text => text.setValue(String(settings[key])).onChange(async value => {
			const number = Number(value);
			if (Number.isFinite(number) && number > 0 && number <= 3) { settings[key] = number; await plugin.saveSettings(); }
		}));
	}
}
