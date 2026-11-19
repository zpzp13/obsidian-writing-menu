import { splitPagedFrontmatter } from '../paged/PagedFrontmatter';
import { parseInlineMarkdown, sourceOffsetToVisible, parsedHighlightSources, serializeInlineMarkdown } from '../paged/MarkdownInlineFormat';
import type { HighlightColor } from '../utils/ObsidianHighlights';
import { parseObsidianComments } from './ObsidianComments';

export interface SourceHighlight { from: number; to: number; text: string; color: HighlightColor | ''; prefix: string; suffix: string; line: number }

function fencedRanges(source: string): Array<{ from: number; to: number }> {
	const ranges: Array<{ from: number; to: number }> = [];
	let offset = 0, fence: { marker: string; length: number; from: number } | null = null;
	for (const line of source.split('\n')) {
		const match = /^ {0,3}(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/.exec(line);
		if (!fence && match) fence = { marker: match[1][0], length: match[1].length, from: offset };
		else if (fence && match && match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim()) {
			ranges.push({ from: fence.from, to: offset + line.length }); fence = null;
		}
		offset += line.length + 1;
	}
	if (fence) ranges.push({ from: fence.from, to: source.length });
	return ranges;
}

export function findHighlights(source: string): SourceHighlight[] {
	const { prefix, body } = splitPagedFrontmatter(source), state = parseInlineMarkdown(body), comments = parseObsidianComments(source);
	const fences = fencedRanges(body);
	const ranges = parsedHighlightSources(state).sort((a, b) => a.sourceFrom - b.sourceFrom), merged: typeof ranges = [];
	for (const range of ranges) {
		const previous = merged.at(-1);
		if (previous && previous.color === range.color && /^[\r\n]+$/.test(body.slice(previous.sourceTo, range.sourceFrom))) {
			previous.to = range.to; previous.sourceTo = range.sourceTo;
		} else merged.push({ ...range });
	}
	return merged.filter(h => !fences.some(c => c.from < h.sourceTo && c.to > h.sourceFrom)
		&& !comments.some(c => c.from < h.sourceTo + prefix.length && c.to > h.sourceFrom + prefix.length)).map(h => ({
		from: h.sourceFrom + prefix.length, to: h.sourceTo + prefix.length, text: state.visible.slice(h.from, h.to), color: h.color ?? '',
		prefix: state.visible.slice(Math.max(0, h.from - 32), h.from), suffix: state.visible.slice(h.to, h.to + 32),
		line: source.slice(0, h.sourceFrom + prefix.length).split('\n').length,
	}));
}

/** Use the same range subtraction and serializer as toolbar formatting. */
export function removeHighlightMarkup(source: string, highlight: SourceHighlight): string {
	const { prefix, body } = splitPagedFrontmatter(source), state = parseInlineMarkdown(body);
	const from = sourceOffsetToVisible(state, highlight.from - prefix.length), to = sourceOffsetToVisible(state, highlight.to - prefix.length);
	state.highlights = state.highlights.flatMap(h => h.to <= from || h.from >= to ? [h] : [
		...(h.from < from ? [{ ...h, to: from }] : []), ...(h.to > to ? [{ ...h, from: to }] : []),
	]);
	return prefix + serializeInlineMarkdown(state);
}

/** Offsets address the visible body, excluding frontmatter. */
export function addHighlightMarkup(source: string, from: number, to: number, color: HighlightColor | ''): string {
	const { prefix, body } = splitPagedFrontmatter(source), state = parseInlineMarkdown(body);
	if (from < 0 || to > state.visible.length || from >= to || !state.visible.slice(from, to).trim()) return source;
	state.highlights = [...state.highlights.flatMap(h => h.to <= from || h.from >= to ? [h] : [
		...(h.from < from ? [{ ...h, to: from }] : []), ...(h.to > to ? [{ ...h, from: to }] : []),
	]), { from, to, ...(color ? { color } : {}) }];
	return prefix + serializeInlineMarkdown(state);
}
