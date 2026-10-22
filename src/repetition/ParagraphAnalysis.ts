import type { WritingMenuSettings } from '../types';

export type ParagraphKind = 'narration' | 'dialogue' | 'monologue' | 'special';
export const PARAGRAPH_KINDS: ParagraphKind[] = ['narration', 'dialogue', 'monologue', 'special'];
export const PARAGRAPH_LABELS: Record<ParagraphKind, string> = { narration: '서술', dialogue: '대사', monologue: '독백', special: '특수 대사' };
export interface ParagraphUnit { from: number; to: number; text: string; kind: ParagraphKind; chars: number; lines: number }
export interface ParagraphResult { units: ParagraphUnit[]; empty: number; chars: number; average: number; mobileLines: number; counts: Record<ParagraphKind, number>; characters: Record<ParagraphKind, number>; analysisText: string }
export type ParagraphOptions = WritingMenuSettings['paragraphAnalysis'];

/** Classify leading quote pairs, using the configured kinds for single quotes and parentheses. */
export function classifyParagraph(text: string, options: ParagraphOptions): ParagraphKind {
	const value = text.trim();
	const pairs: Array<[string, string, ParagraphKind]> = [
		['“', '”', 'dialogue'], ['"', '"', 'dialogue'], ['「', '」', 'dialogue'], ['«', '»', 'dialogue'],
		['‘', '’', options.singleQuote], ["'", "'", options.singleQuote], ['(', ')', options.roundBracket], ['（', '）', options.roundBracket],
		...['[]', '［］', '【】', '〔〕', '〈〉', '《》', '『』', '{}'].map(pair => [pair[0], pair[1], 'special'] as [string, string, ParagraphKind]),
	];
	for (const [open, close, kind] of pairs) {
		if (!value.startsWith(open)) continue;
		let at = value.indexOf(close, open.length);
		while (at >= 0) {
			if (open !== close || at + 1 === value.length || /[\s,.;:!?~…—–\-)\]}」』】〉》"'”’]/.test(value[at + 1])) return kind;
			at = value.indexOf(close, at + close.length);
		}
		return 'narration';
	}
	return 'narration';
}

/** Mask syntax in place so morphology offsets still address the unmodified original source. */
export function proseLine(raw: string, mask = ' '): { text: string; masked: string } {
	const output = raw.split('');
	const hide = (from: number, to: number) => { for (let i = from; i < to; i++) output[i] = ''; };
	const patterns: Array<[RegExp, (match: RegExpExecArray) => void]> = [
		[/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)|`+[^`]*`+/g, match => hide(match.index, match.index + match[0].length)],
		[/\[\[([^\]\n]+)\]\]/g, match => {
			const label = match[1].includes('|') ? match[1].slice(match[1].lastIndexOf('|') + 1) : match[1];
			const at = match.index + 2 + match[1].lastIndexOf(label);
			hide(match.index, at); hide(at + label.length, match.index + match[0].length);
		}],
		[/\[([^\]\n]+)\]\([^)]*\)/g, match => { hide(match.index, match.index + 1); hide(match.index + 1 + match[1].length, match.index + match[0].length); }],
		[/\[\^[^\]]+\]/g, match => hide(match.index, match.index + match[0].length)],
		[/\*\*|__|~~|(?<!\w)[*_]|[*_](?!\w)/g, match => hide(match.index, match.index + match[0].length)],
	];
	for (const [pattern, apply] of patterns) { let match: RegExpExecArray | null; while ((match = pattern.exec(raw))) apply(match); }
	return { text: output.join(''), masked: output.map(char => char === '' ? mask : char).join('') };
}

export function analyzeParagraphs(source: string, options: ParagraphOptions): ParagraphResult {
	const counts = { narration: 0, dialogue: 0, monologue: 0, special: 0 };
	const characters = { ...counts };
	const result: ParagraphResult = { units: [], empty: 0, chars: 0, average: 0, mobileLines: 0, counts, characters, analysisText: '' };
	const masked: string[] = [];
	let offset = 0, properties = /^\uFEFF?---\s*\r?\n/.test(source), fence: { character: string; length: number } | null = null;
	let block: { from: number; to: number; text: string } | null = null;
	const add = (from: number, to: number, text: string) => {
		text = text.trim(); if (!text) return;
		const kind = classifyParagraph(text, options);
		const chars = Array.from(options.countSpaces ? text : text.replace(/\s/g, '')).length;
		const lines = Math.max(1, Math.ceil(Array.from(text).length / Math.max(1, options.mobileLineChars)));
		result.units.push({ from, to, text, kind, chars, lines }); counts[kind]++; characters[kind] += chars;
		result.chars += chars; result.mobileLines += lines;
	};
	const flush = () => { if (block) { add(block.from, block.to, block.text); block = null; } };
	for (const raw of source.split('\n')) {
		const start = offset, end = start + raw.length; offset = end + 1;
		const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
		let skipped = false;
		if (properties) { skipped = true; if (start > 0 && /^(---|\.\.\.)\s*$/.test(raw)) properties = false; }
		else if (fence) {
			skipped = true;
			if (fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length && raw.slice(fenceMatch[0].length).trim() === '') fence = null;
		} else if (fenceMatch) { skipped = true; fence = { character: fenceMatch[1][0], length: fenceMatch[1].length }; }
		else skipped = /^ {0,3}#{1,6}\s|^\[\^[^\]]+\]:|^ {0,3}(?:[-*_]\s*){3,}$/.test(raw);
		if (skipped) { flush(); masked.push(raw.replace(/[^\r]/g, ' ')); continue; }
		const { text: visible, masked: analysisLine } = proseLine(raw);
		masked.push(analysisLine);
		if (!visible.trim()) { flush(); if (!raw.trim()) result.empty++; continue; }
		const leading = analysisLine.length - analysisLine.trimStart().length;
		if (options.boundary === 'block') {
			if (block) { block.text += `\n${visible.trim()}`; block.to = end; }
			else block = { from: start + leading, to: end, text: visible.trim() };
		} else add(start + leading, end, visible);
	}
	flush(); result.analysisText = masked.join('\n');
	if (result.units.length) { result.average = result.chars / result.units.length; result.mobileLines /= result.units.length; }
	return result;
}
