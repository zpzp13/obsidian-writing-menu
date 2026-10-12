export const RATE_LIMIT_MSG = '분당 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
export const SERVER_ERROR_MSG = '서버가 일시적으로 응답하지 않습니다 (503). 잠시 후 다시 시도해 주세요.';

export function isTransientServerError(status: number): boolean {
	return status === 502 || status === 503 || status === 504;
}

export function sleep(ms: number): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, ms));
}

/** 분당 요청 한도(429)·일시적 서버 오류(502/503/504)는 대기 후 재시도, 빈 응답(일시적 디코딩 실패)은 즉시 재시도. 그 외 에러는 재시도하지 않고 바로 전파한다. */
export async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number): Promise<T> {
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
