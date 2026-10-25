import { wmT, getLocale } from '../i18n/index';
import { quotaError, responseRetryAt } from './ChatQuotaError';

export class GeminiServiceError extends Error {
	readonly name = 'GeminiServiceError';
	constructor(readonly status: number, readonly retryAt?: number) {
		super(wmT("Gemini 서버가 혼잡하거나 일시적으로 응답하지 않습니다 (HTTP {0}). {1}", status, retryAt ? wmT("{0} 이후 재시도해 주세요.", new Date(retryAt).toLocaleTimeString(getLocale())) : wmT("잠시 후 재시도해 주세요.")));
	}
}

/** Both HTTP errors and error events inside a successful SSE connection use this mapping. */
export function geminiApiError(httpStatus: number, body?: unknown, retryAfter?: string | null): Error {
	const error = (body as { error?: { code?: number; status?: string; message?: string } })?.error;
	let status = httpStatus;
	if (status >= 200 && status < 300) {
		const code = error?.code;
		status = typeof code === 'number' && Number.isSafeInteger(code) && code >= 400 && code <= 599 ? code
			: error?.status === 'RESOURCE_EXHAUSTED' ? 429 : error?.status === 'UNAVAILABLE' ? 503 : error?.status === 'INTERNAL' ? 500 : 0;
	}
	if (status === 429) return quotaError(body, retryAfter);
	if ([500, 502, 503, 504].includes(status)) return new GeminiServiceError(status, responseRetryAt(body, retryAfter));
	return new Error(`${status ? wmT("Gemini 요청 오류 (HTTP {0})", status) : wmT("Gemini 응답에 오류가 있습니다.")}${typeof error?.message === 'string' && error.message ? `: ${error.message}` : ''}`);
}
