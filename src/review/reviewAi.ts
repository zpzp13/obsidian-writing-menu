import { wmT } from '../i18n/index';
import type WritingMenuPlugin from '../../main';
import { callAiChat, cliChatProvider, effectiveChatModel, hasApiKeyForModel, type AiChatApiKeys } from '../aichat/AiChatApi';
import { cliChatOptions } from '../aichat/CliChatApi';

/** One JSON-only request through the same providers Deus uses (Gemini/NVIDIA API or Claude Code/Codex CLI). */
export async function askReviewJson(plugin: WritingMenuPlugin, system: string, user: string, signal?: AbortSignal, maxTokens = 4096): Promise<unknown> {
	const model = effectiveChatModel(plugin.settings);
	const cli = cliChatProvider(model);
	let text: string;
	if (cli) {
		const { runCliChat } = await import('../aichat/CliChatProcess');
		text = await runCliChat(cliChatOptions(plugin, cli), `${user}\n\nJSON 객체 하나만 출력하세요. 설명, 코드 블록, 파일·셸·웹 도구 사용은 금지합니다.`, system, signal);
	} else {
		const keys: AiChatApiKeys = { nvidia: plugin.settings.aiChatApiKey, gemini: plugin.settings.aiChatGeminiApiKey };
		if (!hasApiKeyForModel(keys, model)) throw new Error(wmT('AI 챗 설정에서 API 키를 입력해 주세요.'));
		text = await callAiChat(keys, system, [{ role: 'user', content: user, timestamp: Date.now() }], 0.3, model, maxTokens, { signal });
	}
	return extractJson(text);
}

/** The first balanced JSON object in a reply that may carry fences or prose around it. */
export function extractJson(text: string): unknown {
	const start = text.indexOf('{');
	if (start < 0) throw new Error(wmT('AI 응답에서 JSON을 찾지 못했습니다.'));
	let depth = 0, inString = false, escaped = false;
	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
		if (char === '"') inString = true;
		else if (char === '{') depth++;
		else if (char === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
	}
	throw new Error(wmT('AI 응답의 JSON이 끝나지 않았습니다.'));
}

export const strings = (value: unknown, max = 12, length = 60): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).map(item => item.trim().slice(0, length)).slice(0, max) : [];
export const text = (value: unknown, length: number): string => typeof value === 'string' ? value.trim().slice(0, length) : '';
