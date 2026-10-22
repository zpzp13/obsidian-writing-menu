/** External JSON and host APIs must be narrowed before reading their properties. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isUnknownArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

/** Text fields accept scalars, never an object's implicit '[object Object]'. */
export function scalarText(value: unknown, fallback = ''): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
	return fallback;
}

/** Legacy YAML sometimes contains numeric IDs or scalar lists; keep those losslessly. */
export function legacyText(value: unknown, fallback = ''): string {
	if (value === null || value === undefined) return fallback;
	if (isUnknownArray(value)) return value.map(item => legacyText(item)).join(',');
	if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'number' && Number.isFinite(value)) return String(value);
	throw new Error('텍스트 필드에 지원하지 않는 객체가 들어 있습니다. 원본 자료는 변경하지 않았습니다.');
}

export function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

/** Paths and link targets cannot contain ASCII control characters. */
export function hasControlCharacters(value: string): boolean {
	return Array.from(value).some(character => character.charCodeAt(0) < 32);
}

export function replaceControlCharacters(value: string, replacement: string): string {
	return Array.from(value, character => character.charCodeAt(0) < 32 ? replacement : character).join('');
}
