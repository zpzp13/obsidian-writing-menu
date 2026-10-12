import { requestUrl } from 'obsidian';
import type { AiChatMessage } from './AiChatTypes';
import { RATE_LIMIT_MSG, SERVER_ERROR_MSG, isTransientServerError, withRetry } from './AiApiCommon';

const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const GEMINI_CHAT_URL = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export type AiChatProvider = 'nvidia' | 'gemini';

export interface AiChatApiKeys {
	nvidia: string;
	gemini: string;
}

export const AI_CHAT_MODELS: Array<{ id: string; label: string; provider: AiChatProvider }> = [
	{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (추천 · 최고 품질)', provider: 'gemini' },
	{ id: 'gemma-4-31b-it', label: 'Gemma 4 31B IT (창작 · 오픈 모델)', provider: 'gemini' },
	{ id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (빠른 고빈도 작업)', provider: 'gemini' },
	{ id: 'google/diffusiongemma-26b-a4b-it', label: 'DiffusionGemma 26B (NVIDIA · 실험적)', provider: 'nvidia' },
];
export const DEFAULT_AI_CHAT_MODEL = AI_CHAT_MODELS[0].id;

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

function formatUserContent(m: AiChatMessage): string {
	const body = m.kind === 'narration' ? `*${m.content}*` : m.content;
	return m.speakerName ? `[${m.speakerName}] ${body}` : body;
}

interface NvidiaChatResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

async function callNvidiaChat(apiKey: string, systemPrompt: string, history: AiChatMessage[], temperature: number, model: string, maxTokens: number): Promise<string> {
	const messages = [
		{ role: 'system', content: systemPrompt },
		...history.map(m => ({
			role: m.role,
			content: m.role === 'user' ? formatUserContent(m) : m.content,
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
		parts: [{ text: m.role === 'user' ? formatUserContent(m) : m.content }],
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

export async function callAiChat(apiKeys: AiChatApiKeys, systemPrompt: string, history: AiChatMessage[], temperature = 1.0, model = DEFAULT_AI_CHAT_MODEL, maxTokens = 8192): Promise<string> {
	const provider = getModelProvider(model);
	const call = () => {
		if (provider === 'gemini') return callGeminiChat(apiKeys.gemini, systemPrompt, history, temperature, model, maxTokens);
		return callNvidiaChat(apiKeys.nvidia, systemPrompt, history, temperature, model, maxTokens);
	};
	return withRetry(call, 5);
}
