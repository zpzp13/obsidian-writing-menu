import type { Occurrence } from './types';

interface Sentence {
	start: number;
	end: number;
}

/** 마침표/물음표/느낌표/줄임표 뒤(공백·줄바꿈 또는 끝)를 문장 경계로 보는 단순 분리기. */
function splitSentences(text: string): Sentence[] {
	const sentences: Sentence[] = [];
	const re = /[^.!?…\n]*[.!?…]+|[^.!?…\n]+$/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		if (m[0].trim().length === 0) continue;
		sentences.push({ start: m.index, end: m.index + m[0].length });
	}
	return sentences;
}

function findSentenceFor(sentences: Sentence[], pos: number): Sentence | null {
	for (const s of sentences) {
		if (pos >= s.start && pos < s.end) return s;
	}
	return null;
}

export interface OccurrenceContext {
	occurrence: Occurrence;
	/** 문장(또는 줄) 전체 텍스트 — 앞뒤 공백 제거됨 */
	sentenceText: string;
	/** sentenceText 기준 하이라이트 시작/끝 오프셋 */
	highlightStart: number;
	highlightEnd: number;
}

/** 각 등장 위치를 포함하는 문장을 찾아 하이라이트용 상대 오프셋과 함께 반환한다. */
export function buildOccurrenceContexts(text: string, occurrences: Occurrence[]): OccurrenceContext[] {
	const sentences = splitSentences(text);
	return occurrences.map(occ => {
		const sentence = findSentenceFor(sentences, occ.start) ?? { start: Math.max(0, occ.start - 20), end: Math.min(text.length, occ.end + 20) };
		const rawSentence = text.slice(sentence.start, sentence.end);
		const leading = rawSentence.length - rawSentence.trimStart().length;
		const trimmed = rawSentence.trim();
		const base = sentence.start + leading;
		return {
			occurrence: occ,
			sentenceText: trimmed,
			highlightStart: Math.max(0, occ.start - base),
			highlightEnd: Math.max(0, Math.min(trimmed.length, occ.end - base)),
		};
	});
}

/**
 * 한 줄 말줄임(text-overflow:ellipsis)은 항상 뒤쪽만 자르므로, 문장이 길고 반복어가 뒷부분에
 * 있으면 정작 강조할 단어가 잘려 안 보일 수 있다. 하이라이트를 중심으로 앞뒤 글자수 예산을 나눠
 * 잘라내고, 잘린 쪽에는 "…"를 붙인다.
 */
export function clipAroundHighlight(text: string, highlightStart: number, highlightEnd: number, budget = 40): { text: string; highlightStart: number; highlightEnd: number } {
	if (text.length <= budget) return { text, highlightStart, highlightEnd };

	const hlLen = highlightEnd - highlightStart;
	const contextBudget = Math.max(0, budget - hlLen);
	let before = Math.floor(contextBudget / 2);
	let after = contextBudget - before;

	let start = highlightStart - before;
	let end = highlightEnd + after;
	if (start < 0) { after += -start; start = 0; }
	if (end > text.length) { before += end - text.length; end = text.length; start = Math.max(0, highlightStart - before); }

	const prefix = start > 0 ? '…' : '';
	const suffix = end < text.length ? '…' : '';
	return {
		text: prefix + text.slice(start, end) + suffix,
		highlightStart: highlightStart - start + prefix.length,
		highlightEnd: highlightEnd - start + prefix.length,
	};
}
