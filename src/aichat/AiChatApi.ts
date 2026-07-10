import { requestUrl } from 'obsidian';
import type { AiChatMessage } from './AiChatTypes';

const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const GEMINI_CHAT_URL = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const CEREBRAS_CHAT_URL = 'https://api.cerebras.ai/v1/chat/completions';

export type AiChatProvider = 'nvidia' | 'gemini' | 'cerebras';

export interface AiChatApiKeys {
	nvidia: string;
	gemini: string;
	cerebras: string;
}

export const AI_CHAT_MODELS: Array<{ id: string; label: string; provider: AiChatProvider }> = [
	{ id: 'google/diffusiongemma-26b-a4b-it', label: 'DiffusionGemma 26B (기본, 창작 특화)', provider: 'nvidia' },
	{ id: 'gemma-4-31b', label: 'Gemma 4 31B (dense, 형식 준수 더 정확, Cerebras — 매우 빠름)', provider: 'cerebras' },
	{ id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (Google AI Studio, 빠르고 형식 준수 좋음)', provider: 'gemini' },
];
export const DEFAULT_AI_CHAT_MODEL = AI_CHAT_MODELS[0].id;

export function getModelProvider(model: string): AiChatProvider {
	return AI_CHAT_MODELS.find(m => m.id === model)?.provider ?? 'nvidia';
}

// enable_thinking chat_template_kwargs를 지원하는 모델들 (Gemma 계열 채팅 템플릿 전용 옵션, NVIDIA 라우팅 모델만 해당)
const THINKING_SUPPORTED_MODELS = new Set(['google/diffusiongemma-26b-a4b-it']);
// 참고: mistralai/mistral-medium-3.5-128b, z-ai/glm-5.2, openai/gpt-oss-120b, qwen/qwen3-next-80b-a3b-instruct,
// nvidia/nemotron-3-ultra-550b-a55b, gemini-3.5-flash는 실측 검증 결과 다국어/문자 깨짐, 지문·대사 균형 붕괴,
// 어색한 번역투, 또는 속도 대비 이점 부족으로 제외함. gemma-4-31b는 Google 라우팅(사고를 끌 수 없어 매우 느림) 대신
// Cerebras로 옮김 — 같은 모델인데 15배 가까이 빠름(실측: 33초 → 2.5초).

function buildExtraParams(model: string): Record<string, unknown> {
	const extra: Record<string, unknown> = {};
	if (THINKING_SUPPORTED_MODELS.has(model)) extra.chat_template_kwargs = { enable_thinking: true };
	return extra;
}

const RATE_LIMIT_MSG = '분당 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
const SERVER_ERROR_MSG = '서버가 일시적으로 응답하지 않습니다 (503). 잠시 후 다시 시도해 주세요.';

function isTransientServerError(status: number): boolean {
	return status === 502 || status === 503 || status === 504;
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
			generationConfig: { temperature, topP: 0.95, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
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

	const data = res.json as GeminiChatResponse;
	const content = data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('');
	if (!content) throw new Error('빈 응답');
	return content.trim();
}

interface CerebrasChatResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

/** Cerebras는 OpenAI 호환 엔드포인트지만 파라미터명이 max_tokens가 아니라 max_completion_tokens이고,
 * reasoning_effort로 사고 강도를 조절한다(gemma-4-31b는 무료 티어에서도 매우 빠르게 응답함 — 실측 2~4초). */
async function callCerebrasChat(apiKey: string, systemPrompt: string, history: AiChatMessage[], temperature: number, model: string, maxTokens: number): Promise<string> {
	const messages = [
		{ role: 'system', content: systemPrompt },
		...history.map(m => ({
			role: m.role,
			content: m.role === 'user' ? formatUserContent(m) : m.content,
		})),
	];

	const res = await requestUrl({
		url: CEREBRAS_CHAT_URL,
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model,
			messages,
			max_completion_tokens: maxTokens,
			temperature,
			top_p: 0.95,
			stream: false,
			reasoning_effort: 'medium',
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

	const data = res.json as CerebrasChatResponse;
	const content = data.choices?.[0]?.message?.content;
	if (!content) throw new Error('빈 응답');
	return content.trim();
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, ms));
}

/** 분당 요청 한도(429)·일시적 서버 오류(502/503/504)는 대기 후 재시도, 빈 응답(일시적 디코딩 실패)은 즉시 재시도. 그 외 에러는 재시도하지 않고 바로 전파한다. */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number): Promise<T> {
	let lastErr: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (e) {
			lastErr = e;
			if (attempt >= maxAttempts) break;
			const msg = e instanceof Error ? e.message : String(e);
			if (msg === RATE_LIMIT_MSG) {
				await sleep(20_000);
				continue;
			}
			if (msg === SERVER_ERROR_MSG) {
				await sleep(10_000);
				continue;
			}
			if (msg === '빈 응답') continue;
			break;
		}
	}
	throw lastErr;
}

export async function callAiChat(apiKeys: AiChatApiKeys, systemPrompt: string, history: AiChatMessage[], temperature = 1.0, model = DEFAULT_AI_CHAT_MODEL, maxTokens = 8192): Promise<string> {
	const provider = getModelProvider(model);
	const call = () => {
		if (provider === 'gemini') return callGeminiChat(apiKeys.gemini, systemPrompt, history, temperature, model, maxTokens);
		if (provider === 'cerebras') return callCerebrasChat(apiKeys.cerebras, systemPrompt, history, temperature, model, maxTokens);
		return callNvidiaChat(apiKeys.nvidia, systemPrompt, history, temperature, model, maxTokens);
	};
	return withRetry(call, 5);
}
