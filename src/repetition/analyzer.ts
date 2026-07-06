import type { MorphToken, Occurrence, RepetitionEntry, RepetitionResult } from './types';

// Sejong 품사 태그: 실질 의미를 가진 명사/동사/형용사 어간 (garu-ko가 활용형을 이미 어간으로 정규화해줌)
const CONTENT_POS_PREFIXES = ['NNG', 'NNP', 'VV', 'VA'];

function isContentWord(pos: string): boolean {
	return CONTENT_POS_PREFIXES.some(p => pos.startsWith(p));
}

function hasHangul(text: string): boolean {
	return /[가-힣]/.test(text);
}

function pushOccurrence(map: Map<string, Occurrence[]>, key: string, occ: Occurrence) {
	const list = map.get(key);
	if (list) list.push(occ);
	else map.set(key, [occ]);
}

function rank(map: Map<string, Occurrence[]>, minCount: number, limit: number): RepetitionEntry[] {
	const entries: RepetitionEntry[] = [];
	for (const [text, occurrences] of map) {
		if (occurrences.length < minCount) continue;
		occurrences.sort((a, b) => a.start - b.start);
		entries.push({ text, count: occurrences.length, occurrences });
	}
	entries.sort((a, b) => b.count - a.count);
	return entries.slice(0, limit);
}

export interface ClassifyOptions {
	/** 이 이상 등장해야 "반복"으로 취급 */
	minCount?: number;
	/** 카테고리별 상위 N개까지만 반환 */
	limit?: number;
}

/**
 * 형태소 토큰을 세 가지 관점으로 분류해 반복 랭킹을 만든다.
 * - word(단어): 명사/동사·형용사 어간 반복 (활용형은 garu-ko가 이미 정규화) — 단어 구간만 표시
 * - eojeol(어절): 원문 그대로의 어절(공백 구분 단위) 반복 — 같은 구절을 통째로 반복하는 경우 포착
 * - eomi(어미): 문장 종결어미(EF) 반복 — "~았다"처럼 문체가 단조로워지는 경우 포착. 어절 전체를 표시
 */
export function classifyTokens(tokens: MorphToken[], originalText: string, opts: ClassifyOptions = {}): RepetitionResult {
	const minCount = opts.minCount ?? 3;
	const limit = opts.limit ?? 30;

	const wordMap = new Map<string, Occurrence[]>();
	const eomiMap = new Map<string, Occurrence[]>();
	const eojeolMap = new Map<string, Occurrence[]>();
	const seenSpans = new Set<string>();

	for (const t of tokens) {
		if (isContentWord(t.pos) && t.text.length >= 2) {
			pushOccurrence(wordMap, t.text, { start: t.start, end: t.start + t.text.length, pos: t.pos });
		}
		if (t.pos === 'EF' && t.text.length >= 1) {
			// 어미 반복은 어절 전체(t.start~t.end)에 음영을 둔다 — 어미 자체는 어절 안 일부일 뿐
			pushOccurrence(eomiMap, t.text, { start: t.start, end: t.end, pos: t.pos });
		}

		const spanKey = `${t.start}:${t.end}`;
		if (!seenSpans.has(spanKey)) {
			seenSpans.add(spanKey);
			const surface = originalText.slice(t.start, t.end);
			const trimmed = surface.trim();
			if (trimmed.length >= 2 && hasHangul(trimmed)) {
				const leading = surface.length - surface.trimStart().length;
				pushOccurrence(eojeolMap, trimmed, { start: t.start + leading, end: t.start + leading + trimmed.length, pos: t.pos });
			}
		}
	}

	return {
		word: rank(wordMap, minCount, limit),
		eojeol: rank(eojeolMap, minCount, limit),
		eomi: rank(eomiMap, minCount, limit),
	};
}
