import { chatTerms } from '../AiChatRetrieval';

export interface RagLexicalTerms { version: 1; length: number; counts: Array<[string, number]> }

/** Persist term frequencies once; query-time scoring never retokenizes unchanged passages. */
export function ragLexicalTerms(text: string): RagLexicalTerms {
	const counts = new Map<string, number>(); let length = 0;
	for (const token of text.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []) {
		for (const [term, weight] of chatTerms(token)) { counts.set(term, (counts.get(term) ?? 0) + weight); length += weight; }
	}
	return { version: 1, length, counts: [...counts] };
}

export function ragBm25(terms: RagLexicalTerms, query: Map<string, number>, frequencies: Map<string, number>, documents: number, averageLength: number): number {
	let score = 0;
	for (const [term, frequency] of terms.counts) {
		const weight = query.get(term); if (!weight) continue;
		const df = frequencies.get(term) ?? 0, idf = Math.log(1 + (documents - df + 0.5) / (df + 0.5));
		score += weight * idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * terms.length / Math.max(1, averageLength)));
	}
	return score;
}
