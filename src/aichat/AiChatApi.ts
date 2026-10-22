import { requestUrl } from 'obsidian';
import type { AiChatMessage } from './AiChatTypes';
import { RATE_LIMIT_MSG, SERVER_ERROR_MSG, isTransientServerError } from './AiApiCommon';
import { abortableChat, checkChatAbort, readGeminiStream } from './ChatStream';
import { formatChatMessage } from './AiChatPrompt';
import { requestGeminiStream } from './GeminiTransport';

const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const GEMINI_CHAT_URL = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export type AiChatProvider = 'nvidia' | 'gemini';

export interface AiChatApiKeys {
	nvidia: string;
	gemini: string;
}

export const AI_CHAT_MODELS: Array<{ id: string; label: string; provider: AiChatProvider }> = [
	{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', provider: 'gemini' },
	{ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', provider: 'gemini' },
	{ id: 'gemma-4-31b-it', label: 'Gemma 4 31B IT (창작 · 오픈 모델)', provider: 'gemini' },
	{ id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', provider: 'gemini' },
	{ id: 'google/diffusiongemma-26b-a4b-it', label: 'DiffusionGemma 26B (NVIDIA · 실험적)', provider: 'nvidia' },
];
export const DEFAULT_AI_CHAT_MODEL = 'gemini-3.5-flash-lite';
export const FREE_CHAT_MODELS = AI_CHAT_MODELS.filter(model => ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'].includes(model.id));
const DEUS_CHAT_MODELS = AI_CHAT_MODELS.filter(model => model.id.startsWith('gemini-'));
export function deusChatModels(settings: { aiChatFreeOnly: boolean }): typeof AI_CHAT_MODELS {
	return settings.aiChatFreeOnly ? FREE_CHAT_MODELS : DEUS_CHAT_MODELS;
}
export function effectiveChatModel(settings: { aiChatModel: string; aiChatFreeOnly: boolean; aiChatFreeModel?: string }): string { return settings.aiChatFreeOnly ? FREE_CHAT_MODELS.some(model => model.id === settings.aiChatFreeModel) ? settings.aiChatFreeModel! : DEFAULT_AI_CHAT_MODEL : settings.aiChatModel; }

export function getModelProvider(model: string): AiChatProvider {
	const configured = AI_CHAT_MODELS.find(m => m.id === model)?.provider;
	if (configured) return configured;
	return model.startsWith('gemini-') || model.startsWith('gemma-4-') ? 'gemini' : 'nvidia';
}

export function hasApiKeyForModel(apiKeys: AiChatApiKeys, model: string): boolean {
	return Boolean(apiKeys[getModelProvider(model)]?.trim());
}

// enable_thinking chat_template_kwargs를 지원하는 모델들 (Gemma 계열 채팅 템플릿 전용 옵션, NVIDIA 라우팅 모델만 해당)
const THINKING_SUPPORTED_MODELS = new Set(['google/diffusiongemma-26b-a4b-it']);

function buildExtraParams(model: string): Record<string, unknown> {
	const extra: Record<string, unknown> = {};
	if (THINKING_SUPPORTED_MODELS.has(model)) extra.chat_template_kwargs = { enable_thinking: true };
	return extra;
}

interface NvidiaChatResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

async function callNvidiaChat(apiKey: string, systemPrompt: string, history: AiChatMessage[], temperature: number, model: string, maxTokens: number): Promise<string> {
	const messages = [
		{ role: 'system', content: systemPrompt },
		...history.map(m => ({
			role: m.role,
			content: formatChatMessage(m),
		})),
	];

	const extra = buildExtraParams(model);

	const res = await requestUrl({
		url: NVIDIA_CHAT_URL,
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'Accept': 'application/json',
		},
		body: JSON.stringify({
			model,
			messages,
			max_tokens: maxTokens,
			temperature,
			top_p: 0.95,
			stream: false,
			...extra,
		}),
		throw: false,
	});

	if (res.status === 429) {
		throw new Error(RATE_LIMIT_MSG);
	}
	if (isTransientServerError(res.status)) {
		throw new Error(SERVER_ERROR_MSG);
	}
	if (res.status < 200 || res.status >= 300) {
		throw new Error(`HTTP ${res.status}`);
	}

	const data = res.json as NvidiaChatResponse;
	const content = data.choices?.[0]?.message?.content;
	if (!content) throw new Error('빈 응답');
	return content.trim();
}

interface GeminiChatResponse {
	candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
	error?: { message?: string };
}

function buildGeminiGenerationConfig(model: string, temperature: number, maxTokens: number): Record<string, unknown> {
	if (model.startsWith('gemma-4-')) {
		return {
			temperature,
			topP: 0.95,
			maxOutputTokens: maxTokens,
			thinkingConfig: { thinkingLevel: 'minimal' },
		};
	}

	// Gemini 3 계열은 sampling 파라미터 대신 thinkingLevel 사용을 권장한다.
	return {
		maxOutputTokens: maxTokens,
		thinkingConfig: { thinkingLevel: model === 'gemini-3.8-flash' ? 'low' : 'minimal' },
	};
}

async function callGeminiChat(apiKey: string, systemPrompt: string, history: AiChatMessage[], temperature: number, model: string, maxTokens: number): Promise<string> {
	const contents = history.map(m => ({
		role: m.role === 'user' ? 'user' : 'model',
		parts: [{ text: formatChatMessage(m) }],
	}));

	const res = await requestUrl({
		url: GEMINI_CHAT_URL(model),
		method: 'POST',
		headers: {
			'x-goog-api-key': apiKey,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			system_instruction: { parts: [{ text: systemPrompt }] },
			contents,
			generationConfig: buildGeminiGenerationConfig(model, temperature, maxTokens),
		}),
		throw: false,
	});

	if (res.status === 429) {
		throw new Error(RATE_LIMIT_MSG);
	}
	if (isTransientServerError(res.status)) {
		throw new Error(SERVER_ERROR_MSG);
	}
	if (res.status < 200 || res.status >= 300) {
		const detail = (res.json as GeminiChatResponse | undefined)?.error?.message;
		throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
	}

	const data = res.json as GeminiChatResponse;
	const content = data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('');
	if (!content) throw new Error('빈 응답');
	return content.trim();
}

export interface AiChatRequestOptions { signal?: AbortSignal; stream?: boolean; onText?: (text: string) => void }

export async function callAiChat(apiKeys: AiChatApiKeys, systemPrompt: string, history: AiChatMessage[], temperature = 1.0, model = DEFAULT_AI_CHAT_MODEL, maxTokens = 8192, options: AiChatRequestOptions = {}): Promise<string> {
	checkChatAbort(options.signal);
	if (getModelProvider(model) === 'gemini' && options.stream) {
		let response: Response;
		try {
			// requestUrl does not expose an SSE body reader or AbortSignal cancellation.
			response = await requestGeminiStream(GEMINI_CHAT_URL(model).replace(':generateContent', ':streamGenerateContent?alt=sse'), apiKeys.gemini, JSON.stringify({
					system_instruction: { parts: [{ text: systemPrompt }] },
					contents: history.map(message => ({ role: message.role === 'user' ? 'user' : 'model', parts: [{ text: formatChatMessage(message) }] })),
					generationConfig: buildGeminiGenerationConfig(model, temperature, maxTokens),
				}), options.signal);
		} catch {
			checkChatAbort(options.signal);
			throw new Error('스트리밍에 연결하지 못했습니다. AI 챗 설정에서 스트리밍을 끄고 다시 시도해 주세요.');
		}
		if (!response.ok || !response.body) throw new Error(`AI 연결 오류 (HTTP ${response.status})`);
		return readGeminiStream(response.body, options.signal, options.onText);
	}
	const task = getModelProvider(model) === 'gemini'
		? callGeminiChat(apiKeys.gemini, systemPrompt, history, temperature, model, maxTokens)
		: callNvidiaChat(apiKeys.nvidia, systemPrompt, history, temperature, model, maxTokens);
	const result = await abortableChat(task, options.signal); checkChatAbort(options.signal); return result;
}
