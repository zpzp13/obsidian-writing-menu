export const RATE_LIMIT_MSG = '분당 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
export const SERVER_ERROR_MSG = '서버가 일시적으로 응답하지 않습니다 (503). 잠시 후 다시 시도해 주세요.';

export function isTransientServerError(status: number): boolean {
	return status === 502 || status === 503 || status === 504;
}
