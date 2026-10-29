import { proseLine, type ParagraphKind, type ParagraphResult } from './ParagraphAnalysis';
import { projectObsidianComments } from '../comments/ObsidianComments';

export interface SentenceUnit { from: number; to: number; text: string; chars: number; kind: ParagraphKind }

/** Punctuation-based prose units, not visual lines. Offsets always address the original Markdown. */
export function analyzeSentences(source: string, paragraphs: ParagraphResult, countSpaces: boolean): SentenceUnit[] {
	const projection = projectObsidianComments(source);
	if (projection.ranges.length) {
		const visible = { ...paragraphs, units: paragraphs.units.map(unit => ({ ...unit, from: projection.projectedOffset(unit.from), to: projection.projectedOffset(unit.to) })) };
		return analyzeVisibleSentences(projection.text, visible, countSpaces).map(unit => ({ ...unit, from: projection.originalOffset(unit.from), to: projection.originalOffset(unit.to, 'left') }));
	}
	return analyzeVisibleSentences(source, paragraphs, countSpaces);
}

function analyzeVisibleSentences(source: string, paragraphs: ParagraphResult, countSpaces: boolean): SentenceUnit[] {
	const sentences: SentenceUnit[] = [];
	for (const paragraph of paragraphs.units) {
		// NUL distinguishes removed Markdown syntax from real, countable spaces.
		// The paragraph may begin inside a link label or emphasis. Mask from the
		// original line start first, so stripping its opening syntax cannot expose URLs.
		const lineStart = source.lastIndexOf('\n', paragraph.from - 1) + 1;
		const masked = proseLine(source.slice(lineStart, paragraph.to), '\0').masked.slice(paragraph.from - lineStart);
		let start = 0;
		const add = (end: number) => {
			let from = start, to = end;
			while (from < to && /[\s\0]/.test(masked[from])) from++;
			while (to > from && /[\s\0]/.test(masked[to - 1])) to--;
			const text = masked.slice(from, to).replace(/\0/g, '');
			if (text.trim()) sentences.push({ from: paragraph.from + from, to: paragraph.from + to, text, chars: Array.from(countSpaces ? text : text.replace(/\s/g, '')).length, kind: paragraph.kind });
			start = end;
		};
		for (let index = 0; index < masked.length; index++) {
			if (!/[.!?。！？…]/.test(masked[index])) continue;
			if (masked[index] === '.') {
				if (/\d/.test(masked[index - 1] ?? '') && /\d/.test(masked[index + 1] ?? '')) continue;
				if (/[A-Za-z]/.test(masked[index - 1] ?? '') && /[A-Za-z]/.test(masked[index + 1] ?? '')) continue;
				const abbreviation = /([A-Za-z.]+)$/.exec(masked.slice(Math.max(start, index - 12), index))?.[1] ?? '';
				if (/^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)$/i.test(abbreviation)) continue;
			}
			while (/[.!?。！？…]/.test(masked[index + 1] ?? '')) index++;
			while (/[”’"'」』】〉》〕）)\]}]/.test(masked[index + 1] ?? '')) index++;
			add(index + 1);
		}
		add(masked.length);
	}
	return sentences;
}
