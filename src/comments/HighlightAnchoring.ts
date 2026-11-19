import type { HighlightThread } from './HighlightCommentTypes';
import type { SourceHighlight } from './HighlightAnchors';

export interface AnchorResult { threadId: string; state: 'attached' | 'detached'; highlight?: SourceHighlight; quoteChanged: boolean }

function contextScore(a: { prefix: string; suffix: string }, b: { prefix: string; suffix: string }): number {
	let before = 0, after = 0;
	while (before < Math.min(32, a.prefix.length, b.prefix.length) && a.prefix.at(-before - 1) === b.prefix.at(-before - 1)) before++;
	while (after < Math.min(32, a.suffix.length, b.suffix.length) && a.suffix[after] === b.suffix[after]) after++;
	return before + after;
}

export function quoteSimilarity(a: string, b: string): number {
	if (a === b) return 1;
	if (a.length < 2 || b.length < 2) return 0;
	const pairs = new Map<string, number>();
	for (let i = 0; i < a.length - 1; i++) { const pair = a.slice(i, i + 2); pairs.set(pair, (pairs.get(pair) ?? 0) + 1); }
	let overlap = 0;
	for (let i = 0; i < b.length - 1; i++) { const pair = b.slice(i, i + 2), n = pairs.get(pair) ?? 0; if (n) { overlap++; pairs.set(pair, n - 1); } }
	return 2 * overlap / (a.length + b.length - 2);
}

export function anchorThreads(threads: HighlightThread[], highlights: SourceHighlight[]): AnchorResult[] {
	const results = new Map<string, AnchorResult>(), used = new Set<SourceHighlight>();
	for (const fuzzy of [false, true]) {
		const candidates: Array<{ t: HighlightThread; h: SourceHighlight; score: number }> = [];
		for (const t of threads) if (!results.has(t.id)) for (const h of highlights) if (!used.has(h)) {
			const context = contextScore(t, h), distance = Math.abs(h.from - t.offset);
			if (!fuzzy && h.text === t.quote) candidates.push({ t, h, score: context * 10 - distance / 1000 });
			if (fuzzy) { const similarity = quoteSimilarity(t.quote, h.text); if (similarity >= 0.5 && (context >= 8 || distance <= 2000)) candidates.push({ t, h, score: similarity * 100 + context }); }
		}
		candidates.sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id) || a.h.from - b.h.from);
		for (const { t, h } of candidates) if (!results.has(t.id) && !used.has(h)) {
			results.set(t.id, { threadId: t.id, state: 'attached', highlight: h, quoteChanged: h.text !== t.quote }); used.add(h);
		}
	}
	return threads.map(t => results.get(t.id) ?? { threadId: t.id, state: 'detached', quoteChanged: false });
}
