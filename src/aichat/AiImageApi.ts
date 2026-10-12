import { requestUrl } from 'obsidian';
import { RATE_LIMIT_MSG, SERVER_ERROR_MSG, isTransientServerError, withRetry } from './AiApiCommon';

const GEMINI_GENERATE_CONTENT_URL = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const OPENAI_IMAGE_GENERATE_URL = 'https://api.openai.com/v1/images/generations';

export type AiImageProvider = 'gemini-image' | 'openai';

/** 모델 ID는 각 제공사 공식 문서 기준 추정치. 특히 'gemini-3-pro-image-preview'(Nano Banana Pro)는
 * 확정 명칭이 아닐 수 있으니 400/404가 나면 Google AI Studio 모델 목록에서 정확한 ID로 교체할 것.
 * Imagen 4는 얼굴 참고 이미지 첨부가 불가능하고 실측 결과 품질도 만족스럽지 않아 목록에서 제외함. */
export const AI_IMAGE_MODELS: Array<{ id: string; label: string; provider: AiImageProvider }> = [
	{ id: 'gemini-2.5-flash-image', label: 'Nano Banana (Gemini 2.5 Flash Image, 대화형 편집에 강함)', provider: 'gemini-image' },
	{ id: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro (Gemini 3 Pro Image, 최고 품질·텍스트 렌더링, ID 확인 필요)', provider: 'gemini-image' },
	{ id: 'gpt-image-1', label: 'GPT Image 1 (OpenAI, 텍스트 렌더링·지시 순응도 우수)', provider: 'openai' },
	{ id: 'gpt-image-2', label: 'GPT Image 2 (OpenAI, 2026.4 출시 최신 모델, 텍스트/UI 렌더링 더 강화)', provider: 'openai' },
];
export const DEFAULT_AI_IMAGE_MODEL = AI_IMAGE_MODELS[0].id;

export function getImageProvider(model: string): AiImageProvider {
	return AI_IMAGE_MODELS.find(m => m.id === model)?.provider ?? 'gemini-image';
}

/** Nano Banana가 실제로 지원하는 종횡비 값 (4:5 등 임의 비율은 400 에러가 남). GPT Image는 이 값을 size로 변환해서 사용한다. */
export const IMAGE_ASPECT_RATIOS: Array<{ id: string; label: string }> = [
	{ id: '1:1', label: '1:1' },
	{ id: '3:4', label: '3:4' },
	{ id: '4:3', label: '4:3' },
	{ id: '9:16', label: '9:16' },
	{ id: '16:9', label: '16:9' },
];
export const DEFAULT_AI_IMAGE_ASPECT_RATIO = '3:4';

/** GPT Image(gpt-image-1)는 종횡비가 아니라 정해진 size 목록만 받는다 (1024x1024/1024x1536/1536x1024) — 가장 가까운 값으로 매핑. */
function aspectRatioToOpenAiSize(aspectRatio: string): string {
	if (aspectRatio === '3:4' || aspectRatio === '9:16') return '1024x1536';
	if (aspectRatio === '4:3' || aspectRatio === '16:9') return '1536x1024';
	return '1024x1024';
}

export interface AiImageApiKeys {
	gemini: string;
	openai: string;
}

interface GeminiContentPart {
	text?: string;
	inlineData?: { data?: string; mimeType?: string };
}

interface GeminiGenerateContentResponse {
	candidates?: Array<{ content?: { parts?: GeminiContentPart[] } }>;
}

interface OpenAiImageResponse {
	data?: Array<{ b64_json?: string }>;
}

interface ApiErrorResponse {
	error?: { code?: number; message?: string; status?: string };
}

function extractErrorDetail(json: unknown): string {
	try { return (json as ApiErrorResponse)?.error?.message ?? ''; } catch { return ''; }
}

function checkCommonErrors(status: number, json: unknown): void {
	if (status === 429) throw new Error(RATE_LIMIT_MSG);
	if (isTransientServerError(status)) throw new Error(SERVER_ERROR_MSG);
	if (status < 200 || status >= 300) {
		const detail = extractErrorDetail(json);
		throw new Error(detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`);
	}
}

export interface ImageInput {
	mimeType: string;
	base64: string;
}

/** Nano Banana / Nano Banana Pro (:generateContent, responseModalities: IMAGE) 호출.
 * referenceImage를 넣으면 실제 이미지 데이터를 함께 보내 모델이 직접 화풍/구도를 참고하게 한다. */
async function generateGeminiImageOnce(apiKey: string, prompt: string, model: string, aspectRatio: string, referenceImage?: ImageInput): Promise<string> {
	const parts: GeminiContentPart[] = [];
	if (referenceImage) parts.push({ inlineData: { mimeType: referenceImage.mimeType, data: referenceImage.base64 } });
	parts.push({ text: prompt });

	const res = await requestUrl({
		url: GEMINI_GENERATE_CONTENT_URL(model),
		method: 'POST',
		headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			contents: [{ parts }],
			generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } },
		}),
		throw: false,
	});
	checkCommonErrors(res.status, res.json);
	const resParts = (res.json as GeminiGenerateContentResponse).candidates?.[0]?.content?.parts ?? [];
	const base64 = resParts.find(p => p.inlineData?.data)?.inlineData?.data;
	if (!base64) throw new Error('이미지 생성 실패 (안전 필터에 의해 차단되었을 수 있음)');
	return base64;
}

/** GPT Image 1 (/v1/images/generations) 호출. 참고 이미지 입력은 지원하지 않음(별도의 /images/edits 엔드포인트 필요). */
async function generateOpenAiImageOnce(apiKey: string, prompt: string, model: string, aspectRatio: string): Promise<string> {
	const res = await requestUrl({
		url: OPENAI_IMAGE_GENERATE_URL,
		method: 'POST',
		headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model,
			prompt,
			n: 1,
			size: aspectRatioToOpenAiSize(aspectRatio),
		}),
		throw: false,
	});
	checkCommonErrors(res.status, res.json);
	const base64 = (res.json as OpenAiImageResponse).data?.[0]?.b64_json;
	if (!base64) throw new Error('이미지 생성 실패 (안전 필터에 의해 차단되었을 수 있음)');
	return base64;
}

export async function callImageGenerate(apiKeys: AiImageApiKeys, prompt: string, model = DEFAULT_AI_IMAGE_MODEL, aspectRatio = DEFAULT_AI_IMAGE_ASPECT_RATIO, referenceImage?: ImageInput): Promise<string> {
	const provider = getImageProvider(model);
	if (provider === 'openai' && referenceImage) {
		throw new Error('GPT Image 모델은 참고 이미지를 지원하지 않습니다. Nano Banana 계열 모델을 선택하거나 참고 이미지를 해제하세요.');
	}
	const call = () => provider === 'openai'
		? generateOpenAiImageOnce(apiKeys.openai, prompt, model, aspectRatio)
		: generateGeminiImageOnce(apiKeys.gemini, prompt, model, aspectRatio, referenceImage);
	return withRetry(call, 3);
}

/** 참고 이미지 첨부 시 팝업에 안내로 보여주는 예시 문구 — 참고 이미지의 얼굴/신원을 복제하지 않도록 사용자가 직접 프롬프트에 반영하게 유도한다. */
export const EXAMPLE_PROMPT_WITH_REFERENCE = '한국인 28세 여성, 부드러운 눈매, 갈색 머리칼, 여성스러운 제복, 시선은 멍함.';

export const EXAMPLE_PROMPT_WITHOUT_REFERENCE = '한국인 20대 후반 여성, 슬림한 체형, 검은 단발머리, 날카로운 눈매, 자신감 있는 표정, 상반신 클로즈업. 애니메이션풍 디지털 일러스트, 부드러운 조명.';
