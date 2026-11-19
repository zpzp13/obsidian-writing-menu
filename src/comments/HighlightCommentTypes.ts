import { HIGHLIGHT_COLORS, type HighlightColor } from '../utils/ObsidianHighlights';

export interface HighlightComment { id: string; body: string; createdAt: number; updatedAt: number }
export interface HighlightThread {
	id: string; path: string; quote: string; prefix: string; suffix: string; offset: number;
	color: HighlightColor | ''; status: 'open' | 'done'; comments: HighlightComment[]; createdAt: number; updatedAt: number;
}
export interface HighlightCommentStore { version: 1; threads: Record<string, HighlightThread> }

export function normalizeHighlightComments(value: unknown): HighlightCommentStore {
	const result: HighlightCommentStore = { version: 1, threads: {} };
	if (value === undefined) return result;
	const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
	const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 8.64e15;
	if (!record(value) || value.version !== 1 || !record(value.threads)) { console.warn('Writing Menu: invalid highlight comment store'); return result; }
	for (const [id, t] of Object.entries(value.threads)) {
		if (!record(t) || t.id !== id || !id || !['path', 'quote', 'prefix', 'suffix'].every(key => typeof t[key] === 'string')
			|| !t.path || !t.quote || !Number.isInteger(t.offset) || !time(t.offset) || !time(t.createdAt) || !time(t.updatedAt) || (t.status !== 'open' && t.status !== 'done')
			|| (t.color !== '' && !(HIGHLIGHT_COLORS as readonly unknown[]).includes(t.color)) || !Array.isArray(t.comments)) {
			console.warn('Writing Menu: discarded invalid highlight thread', id); continue;
		}
		const seen = new Set<string>();
		const comments = t.comments.filter((c: unknown): c is HighlightComment => {
			if (!record(c) || typeof c.id !== 'string' || !c.id || seen.has(c.id) || typeof c.body !== 'string' || !c.body.trim() || !time(c.createdAt) || !time(c.updatedAt)) { console.warn('Writing Menu: discarded invalid highlight comment', id); return false; }
			seen.add(c.id); return true;
		});
		if (comments.length) Object.defineProperty(result.threads, id, { enumerable: true, configurable: true, writable: true, value: { ...t, comments: comments.map(c => ({ ...c })) } });
	}
	return result;
}
