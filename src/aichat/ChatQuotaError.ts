export class ChatQuotaError extends Error {
	readonly name = 'ChatQuotaError';
	constructor(readonly retryAt?: number, readonly details: string[] = [], readonly providerMessage?: string) {
		super(`Gemini API 사용 한도에 도달했습니다 (HTTP 429).${details.length ? `\n${details.join('\n')}` : providerMessage ? `\n${providerMessage}` : ''}${retryAt ? `\n${new Date(retryAt).toLocaleTimeString('ko-KR')} 이후 다시 시도할 수 있습니다.` : '\nAI Studio에서 해당 프로젝트·모델의 사용량을 확인해 주세요.'}`);
	}
}
export function quotaError(body: unknown, retryAfter?: string | null): ChatQuotaError {
	const error = (body as { error?: { message?: string; details?: Array<{ violations?: unknown[] }> } })?.error;
	const details: string[] = [];
	for (const detail of Array.isArray(error?.details) ? error.details : []) for (const raw of Array.isArray(detail?.violations) ? detail.violations : []) {
		if (!raw || typeof raw !== 'object') continue;
		const item = raw as { quotaMetric?: string; quotaId?: string; quotaValue?: string | number; quotaDimensions?: { model?: string } };
		const metric = typeof item.quotaMetric === 'string' ? item.quotaMetric : '', id = typeof item.quotaId === 'string' ? item.quotaId : '';
		if (!metric && !id) continue;
		const identifier = `${metric} ${id}`.toLowerCase().replace(/[^a-z]/g, '');
		const tokens = identifier.includes('token'), perMinute = identifier.includes('perminute') || identifier.includes('permodelperminute'), perDay = identifier.includes('perday') || identifier.includes('permodelperday');
		const label = perMinute ? tokens ? '분당 입력 토큰(TPM)' : '분당 요청 수(RPM)' : perDay ? tokens ? '일일 토큰(TPD)' : '일일 요청 수(RPD)' : `API 할당량 (${id || metric})`;
		const limit = typeof item.quotaValue === 'string' || typeof item.quotaValue === 'number' ? ` · 한도 ${item.quotaValue}` : '';
		const model = typeof item.quotaDimensions?.model === 'string' ? ` · ${item.quotaDimensions.model}` : '';
		const description = `${label}${limit}${model}`;
		if (!details.includes(description)) details.push(description);
	}
	return new ChatQuotaError(responseRetryAt(body, retryAfter), details, typeof error?.message === 'string' ? error.message : undefined);
}
/** Only use an explicit provider delay; never invent a quota reset time. */
export function responseRetryAt(body: unknown, retryAfter?: string | null): number | undefined {
	let seconds = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : undefined;
	const details = (body as { error?: { details?: Array<{ retryDelay?: string }> } })?.error?.details;
	const delay = Array.isArray(details) ? details.find(item => item && typeof item.retryDelay === 'string')?.retryDelay : undefined;
	if (seconds === undefined && delay && /^\d+(?:\.\d+)?s$/.test(delay)) seconds = Number(delay.slice(0, -1));
	const date = retryAfter && seconds === undefined ? Date.parse(retryAfter) : NaN;
	const retryAt = seconds !== undefined && Number.isFinite(seconds) ? Date.now() + seconds * 1000 : date;
	return Number.isFinite(retryAt) && retryAt <= 8.64e15 ? retryAt : undefined;
}
