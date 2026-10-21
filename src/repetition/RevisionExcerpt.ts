/** Morphology offsets use UTF-16; context is limited by Unicode characters, not code units. */
export function repetitionExcerpt(source: string, from: number, to: number, context = 10): { before: string; match: string; after: string; leading: boolean; trailing: boolean } {
	const before = Array.from(source.slice(Math.max(0, from - context * 2), from)).slice(-context).join('');
	const after = Array.from(source.slice(to, to + context * 2)).slice(0, context).join('');
	return { before, match: source.slice(from, to), after, leading: before.length < from, trailing: to + after.length < source.length };
}
