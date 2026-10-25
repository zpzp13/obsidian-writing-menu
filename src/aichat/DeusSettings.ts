import { wmT } from '../i18n/index';
import { Setting, type DropdownComponent } from 'obsidian';
import { cliChatOptions } from './CliChatApi';
import { listCliModels } from './CliModelCatalog';
import { cliEffortLabel, selectedCliModel, supportedCliEffort, type CliModelOption } from './CliReasoning';
import { geminiThinkingLevels, resolveGeminiThinking } from './GeminiThinking';
import type WritingMenuPlugin from '../../main';
import { cliChatProvider, deusChatModels, effectiveChatModel, selectChatModel } from './AiChatApi';
import { renderRagSettings } from './rag/RagSettings';

interface DeusSettingsLayout {
	section(title: string): HTMLElement;
	openApi(): void;
}

/** Only controls used by Deus; the surrounding settings tab owns navigation/layout. */
export function renderDeusSettings(plugin: WritingMenuPlugin, layout: DeusSettingsLayout): void {
	renderRagSettings(layout.section(wmT("알아둬야 할 것들")));
	const container = layout.section(wmT("대화")), settings = plugin.settings;
	new Setting(container).setName(wmT("모델")).addDropdown(select => {
		for (const model of deusChatModels(settings)) select.addOption(model.id, model.label);
		select.setValue(effectiveChatModel(settings)).onChange(async value => {
			selectChatModel(settings, value);
			await plugin.saveSettings();
			renderConnection();
		});
	});
	const connection = container.createDiv();
	let connectionGeneration = 0;
	const renderConnection = () => {
		const generation = ++connectionGeneration;
		connection.empty();
		const cli = cliChatProvider(effectiveChatModel(settings));
		if (!cli) {
			new Setting(connection).setName(wmT("API 키")).addButton(button => button.setButtonText(wmT("API 열기")).onClick(() => layout.openApi()));
			const model = effectiveChatModel(settings);
			new Setting(connection).setName(wmT("Gemini 추론 강도")).addDropdown(select => {
				for (const level of geminiThinkingLevels(model)) select.addOption(level, cliEffortLabel(level));
				select.setValue(resolveGeminiThinking(model, settings.aiChatGeminiThinking[model])).onChange(async value => { settings.aiChatGeminiThinking[model] = resolveGeminiThinking(model, value); await plugin.saveSettings(); });
			}); return;
		}
		const pathKey = cli === 'claude' ? 'aiChatClaudeCliPath' : 'aiChatCodexCliPath', modelKey = cli === 'claude' ? 'aiChatClaudeCliModel' : 'aiChatCodexCliModel', effortKey = cli === 'claude' ? 'aiChatClaudeCliEffort' : 'aiChatCodexCliEffort';
		new Setting(connection).setName(wmT("CLI 경로")).setDesc(wmT("설치하고 로그인한 CLI를 사용합니다. 비워 두면 자동으로 찾습니다. 데스크톱에서 사용할 수 있습니다."))
			.addText(text => text.setValue(settings[pathKey]).onChange(async value => { settings[pathKey] = value.trim(); await plugin.saveSettings(); }));
		let dropdown: DropdownComponent, effortDropdown: DropdownComponent, models: CliModelOption[] = [];
		const modelSetting = new Setting(connection).setName(wmT("CLI 모델")).setDesc(wmT("설치된 CLI에서 모델 목록을 조회합니다. 기존 프로젝트 자료와 검색 도구는 그대로 전달됩니다."))
			.addDropdown(select => {
				dropdown = select; select.addOption('', wmT("기본 모델")); if (settings[modelKey]) select.addOption(settings[modelKey], settings[modelKey]);
				select.setValue(settings[modelKey]).onChange(async value => { settings[modelKey] = value; updateEfforts(); await plugin.saveSettings(); });
			});
		const effortSetting = new Setting(connection).setName('CLI effort').setDesc(wmT("모델 목록을 불러오면 지원하는 추론 단계를 선택할 수 있습니다."))
			.addDropdown(select => {
				effortDropdown = select; select.addOption('', wmT("기본")).setValue('').setDisabled(true).onChange(async value => {
					settings[effortKey] = supportedCliEffort(selectedCliModel(models, settings[modelKey]), value); await plugin.saveSettings();
				});
			});
		const updateEfforts = () => {
			const model = selectedCliModel(models, settings[modelKey]), selected = supportedCliEffort(model, settings[effortKey]);
			const changed = selected !== settings[effortKey]; settings[effortKey] = selected;
			effortDropdown.selectEl.replaceChildren(); effortDropdown.addOption('', model?.defaultEffort ? wmT("기본 · {0}", cliEffortLabel(model.defaultEffort)) : wmT("기본"));
			for (const effort of model?.efforts ?? []) effortDropdown.addOption(effort.id, effort.label);
			effortDropdown.setValue(selected).setDisabled(!model?.efforts.length);
			effortSetting.setDesc(model?.efforts.length ? wmT("낮은 단계는 빠른 응답을, 높은 단계는 더 깊은 추론을 우선합니다. 기본값은 CLI에 맡깁니다.") : wmT("이 모델은 선택 가능한 effort를 제공하지 않습니다."));
			return changed;
		};
		const loadModels = async (refresh = false) => {
			try {
				const discovered = await listCliModels(cliChatOptions(plugin, cli), undefined, refresh);
				if (generation !== connectionGeneration || !connection.isConnected) return;
				models = discovered;
				dropdown.selectEl.replaceChildren(); dropdown.addOption('', wmT("기본 모델"));
				for (const model of models) dropdown.addOption(model.id, model.label);
				if (settings[modelKey] && !models.some(model => model.id === settings[modelKey])) dropdown.addOption(settings[modelKey], settings[modelKey]);
				dropdown.setValue(settings[modelKey]); modelSetting.setDesc(wmT("설치된 CLI의 모델 목록입니다. 기존 프로젝트 자료와 검색 도구는 그대로 전달됩니다."));
				if (updateEfforts()) await plugin.saveSettings();
			} catch (error) { if (generation === connectionGeneration && connection.isConnected) modelSetting.setDesc(error instanceof Error ? error.message : String(error)); }
		};
		modelSetting.addButton(button => button.setButtonText(wmT("새로고침")).onClick(() => { void loadModels(true); }));
		void loadModels();
	};
	renderConnection();
	new Setting(container).setName(wmT("스트리밍")).setDesc(wmT("답변을 생성되는 순서대로 표시합니다."))
		.addToggle(toggle => toggle.setValue(settings.aiChatStreaming).onChange(async value => { settings.aiChatStreaming = value; await plugin.saveSettings(); }));
	new Setting(container).setName(wmT("각주 열기")).setDesc(wmT("채팅 답변의 각주와 출처 목록을 열 위치입니다."))
		.addDropdown(select => select.addOption('current', wmT("현재 탭에서 열기")).addOption('tab', wmT("새 탭에서 열기"))
			.setValue(settings.aiChatCitationOpenMode === 'tab' ? 'tab' : 'current').onChange(async value => {
				settings.aiChatCitationOpenMode = value === 'tab' ? 'tab' : 'current';
				await plugin.saveSettings();
			}));
	const integer = (name: string, key: 'aiChatMaxOutputTokens' | 'aiChatHistoryTurns', minimum: number) => {
		new Setting(container).setName(name).setDesc(key === 'aiChatMaxOutputTokens' ? wmT("API 모델에는 출력 한도로, CLI에는 목표 응답 길이로 전달합니다.") : '').addText(text => text.setValue(String(settings[key])).onChange(async value => {
			const number = Number(value);
			if (Number.isSafeInteger(number) && number >= minimum) { settings[key] = number; await plugin.saveSettings(); }
		}));
	};
	integer(wmT("최대 응답 토큰"), 'aiChatMaxOutputTokens', 1);
	integer(wmT("최근 대화 왕복 수 (0: 전체)"), 'aiChatHistoryTurns', 0);
	for (const [key, name] of [['aiChatNarrationFontSize', wmT("지문 크기")], ['aiChatDialogueFontSize', wmT("대사 크기")]] as const) {
		new Setting(container).setName(name).setDesc(wmT("Character 스킬의 글자 크기 배율입니다.")).addText(text => text.setValue(String(settings[key])).onChange(async value => {
			const number = Number(value);
			if (Number.isFinite(number) && number > 0 && number <= 3) { settings[key] = number; await plugin.saveSettings(); }
		}));
	}
}
