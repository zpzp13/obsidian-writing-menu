/** A Markdown text merge can splice two devices' decimal counts into one number. */
const RECORDS_KEY = '_writing_menu_char_counts';

function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function countRecord(date: string, key: string, count: number): string {
	const source = JSON.stringify([date, key, count]);
	let hash = 2166136261;
	for (let index = 0; index < source.length; index++) {
		hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
	}
	return `v1:${count}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function recordsIn(frontmatter: Record<string, unknown>): Record<string, unknown> {
	const value = frontmatter[RECORDS_KEY];
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown> : {};
}

/** Keep older numeric properties readable; validate every record written by this version. */
export function readDailyCharCount(frontmatter: Record<string, unknown>, date: string, key: string): number | null {
	const saved = frontmatter[RECORDS_KEY];
	if (saved !== undefined && (!saved || typeof saved !== 'object' || Array.isArray(saved))) return null;
	const records = recordsIn(frontmatter);
	if (!Object.prototype.hasOwnProperty.call(records, key)) {
		return isCount(frontmatter[key]) ? frontmatter[key] : null;
	}
	const record = records[key];
	if (typeof record !== 'string') return null;
	const match = /^v1:(\d+):[0-9a-f]{8}$/.exec(record);
	if (!match) return null;
	const count = Number(match[1]);
	return isCount(count) && record === countRecord(date, key, count) ? count : null;
}

export function hasDailyCharRecord(frontmatter: Record<string, unknown>, date: string, key: string, count: number): boolean {
	return isCount(count) && frontmatter[key] === count && recordsIn(frontmatter)[key] === countRecord(date, key, count);
}

/** Retain the numeric property for Dataview and templates, alongside a checked copy. */
export function writeDailyCharCount(frontmatter: Record<string, unknown>, date: string, key: string, count: number): void {
	if (!isCount(count)) return;
	frontmatter[key] = count;
	frontmatter[RECORDS_KEY] = { ...recordsIn(frontmatter), [key]: countRecord(date, key, count) };
}
