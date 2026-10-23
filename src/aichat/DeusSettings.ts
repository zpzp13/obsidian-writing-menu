import { Setting } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { cliChatProvider, deusChatModels, effectiveChatModel, selectChatModel } from './AiChatApi';
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
			selectChatModel(settings, value);
			await plugin.saveSettings();
			renderConnection();
		});
	});
	const connection = container.createDiv();
	const renderConnection = () => {
		connection.empty();
		const cli = cliChatProvider(effectiveChatModel(settings));
		if (!cli) { new Setting(connection).setName('API 키').addButton(button => button.setButtonText('API 열기').onClick(() => layout.openApi())); return; }
		const pathKey = cli === 'claude' ? 'aiChatClaudeCliPath' : 'aiChatCodexCliPath', modelKey = cli === 'claude' ? 'aiChatClaudeCliModel' : 'aiChatCodexCliModel';
		new Setting(connection).setName('CLI 경로').setDesc('설치하고 로그인한 CLI를 사용합니다. 비워 두면 자동으로 찾습니다. 데스크톱에서 사용할 수 있습니다.')
			.addText(text => text.setValue(settings[pathKey]).onChange(async value => { settings[pathKey] = value.trim(); await plugin.saveSettings(); }));
		new Setting(connection).setName('CLI 모델').setDesc('비워 두면 CLI 기본 모델을 사용합니다. 기존 프로젝트 자료와 검색 도구는 그대로 전달됩니다.')
			.addText(text => text.setValue(settings[modelKey]).onChange(async value => { settings[modelKey] = value.trim(); await plugin.saveSettings(); }));
	};
	renderConnection();
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
