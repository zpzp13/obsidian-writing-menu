import type { CorpusDocument } from './ChatCorpusProvider';
import { chatTerms } from '../AiChatRetrieval';

/** Navigate only explicit project metadata. A navigation edge is not a story fact. */
export function relatedDocumentDistances(documents: CorpusDocument[], origin: string, hops: number, query = '', limit = 96): { distances: Map<string, number>; truncated: boolean } {
	const byId = new Map(documents.map(document => [document.id, document]));
	const byPath = new Map<string, Set<string>>(), incoming = new Map<string, Set<string>>();
	for (const document of documents) {
		if (document.path) { const ids = byPath.get(document.path) ?? new Set<string>(); ids.add(document.id); byPath.set(document.path, ids); }
		for (const path of new Set([...document.links, ...(document.characterPaths ?? [])])) {
			const ids = incoming.get(path) ?? new Set<string>(); ids.add(document.id); incoming.set(path, ids);
		}
	}
	const words = chatTerms(query), scores = new Map<string, number>();
	if (words.size) for (const document of documents) {
		const terms = chatTerms(`${document.title}\n${(document.names ?? []).join(' ')}`);
		let score = 0; for (const [word, weight] of words) if (terms.has(word)) score += weight;
		scores.set(document.id, score);
	}
	const distances = new Map<string, number>();
	if (!byId.has(origin)) return { distances, truncated: false };
	distances.set(origin, 0); let frontier = [origin], truncated = false;
	for (let depth = 1; depth <= hops && frontier.length; depth++) {
		const next = new Set<string>();
		for (const id of frontier) {
			const document = byId.get(id)!;
			const add = (ids?: Set<string>) => { for (const target of ids ?? []) if (!distances.has(target)) next.add(target); };
			// Shared manuscript path joins plot rows and prose. Reverse links allow
			// traversal from a character profile into explicitly assigned scenes.
			if (document.path) { add(byPath.get(document.path)); add(incoming.get(document.path)); }
			for (const path of new Set([...document.links, ...(document.characterPaths ?? [])])) add(byPath.get(path));
		}
		const ranked = [...next].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || a.localeCompare(b));
		const capacity = Math.max(0, limit - distances.size); if (ranked.length > capacity) truncated = true;
		frontier = ranked.slice(0, capacity); for (const id of frontier) distances.set(id, depth);
	}
	return { distances, truncated };
}
