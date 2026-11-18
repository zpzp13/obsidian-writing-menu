import MarkdownIt from 'markdown-it';
import type { PagedInlineFormatKind, PagedInlineFormatRange, PagedTextColorRange } from '../types';
import { highlightOpeningMarker, normalizeHighlightColor, readHighlightPrefix, type HighlightColor } from '../utils/ObsidianHighlights';

export interface LineSource {
	visibleText: string;
	formatSignature: string;
	markdown: string;
}
export interface InlineFormatState {
	visible: string;
	inline: PagedInlineFormatRange[];
	colors: PagedTextColorRange[];
	highlights: Array<{ from: number; to: number; color?: HighlightColor }>;
	lines: LineSource[];
}
/** Line separators/edge whitespace do not create gaps in a multi-line style. */
export function inlineRangesCover(text: string, ranges: Array<{ from: number; to: number }>, from: number, to: number): boolean {
	// Whitespace is ignored below, so a selection of only blank lines/spaces
	// (e.g. dragging through the gap between pages) would count as "covered"
	// by every format and light up B/I/U/S. Nothing visible is formatted there.
	if (!text.slice(from, to).trim()) return false;
	let cursor = from;
	for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
		if (range.to <= cursor) continue;
		if (range.from > cursor && text.slice(cursor, Math.min(to, range.from)).trim()) return false;
		cursor = Math.max(cursor, range.to);
		if (cursor >= to) return true;
	}
	return !text.slice(cursor, to).trim();
}
interface Span { from: number; to: number; kind: PagedInlineFormatKind | 'color' | 'highlight'; color?: string }
interface SourceSpan extends Span { open: number; close: number }
interface Line { text: string; ending: string; from: number }
interface ParseEnvironment { spans: SourceSpan[]; trailingComment?: boolean; tags: Array<{ name: string; from: number; to: number; kind: Span['kind']; color?: string }> }

// Only the delimiter engine is used: other Markdown syntax remains literal on
// the canvas. scanDelims/balance_pairs supply CommonMark flanking and rule-of-3.
const inlineParser = new MarkdownIt('zero');
inlineParser.inline.ruler.enableOnly([]);
inlineParser.inline.ruler2.enableOnly(['balance_pairs']);
inlineParser.inline.ruler.push('paged-literal', (state, silent) => {
	const at = state.pos, rest = state.src.slice(at), env = state.env as ParseEnvironment;
	let length = 0;
	if (rest[0] === '\\') length = Math.min(2, rest.length);
	else if (rest[0] === '`') {
		const marker = /^`+/.exec(rest)![0];
		let end = at + marker.length;
		while ((end = state.src.indexOf(marker, end)) >= 0) {
			if (state.src[end - 1] !== '`' && state.src[end + marker.length] !== '`') { length = end + marker.length - at; break; }
			end += marker.length;
		}
	} else if (rest.startsWith('[[')) {
		const end = rest.indexOf(']]', 2); if (end >= 0) length = end + 2;
	} else if (rest.startsWith('%%')) {
		const end = rest.indexOf('%%', 2); length = end >= 0 ? end + 2 : rest.length;
		if (!silent && end < 0) env.trailingComment = true;
	} else if (rest[0] === '$') {
		const marker = rest.startsWith('$$') ? '$$' : '$';
		const end = rest.indexOf(marker, marker.length); if (end >= 0) length = end + marker.length;
	} else if (rest.startsWith('](')) {
		let depth = 1, end = 2;
		for (; end < rest.length && depth; end++) {
			if (rest[end] === '\\') end++;
			else if (rest[end] === '(') depth++;
			else if (rest[end] === ')') depth--;
		}
		if (!depth) length = end;
	} else if (rest[0] === '<') {
		const tag = /^<\/?[a-z][^>]*>/i.exec(rest)?.[0];
		if (tag) {
			length = tag.length;
			if (!silent) {
				const close = /^<\/(u|span|strong|em|mark)\s*>$/i.exec(tag);
				const underline = /^<u\s*>$/i.test(tag);
				const emphasis = /^<(strong|em)\s*>$/i.exec(tag);
				const span = /^<span\s+style\s*=\s*["']\s*(color|background-color)\s*:\s*(#[0-9a-f]{6})\s*;?\s*["']\s*>$/i.exec(tag);
				// Only the <mark> this editor writes (see HTML_MARK below). Other marks,
				// e.g. <mark style="background:#fff88f"> from another tool, stay literal.
				const mark = /^<mark(?:\s+data-highlight\s*=\s*["'](red|orange|yellow|green|blue|purple)["'])?(?:\s+style\s*=\s*["']\s*background-color\s*:\s*var\(--highlight-background[^"']*["'])?\s*>$/i.exec(tag);
				if (close) {
					const top = env.tags.at(-1);
					if ((close[1].toLowerCase() === 'span' && top?.name === 'unsupported-span') || (close[1].toLowerCase() === 'mark' && top?.name === 'unsupported-mark')) env.tags.pop();
					else if (top?.name === close[1].toLowerCase()) {
						env.tags.pop();
						if (at > top.to) env.spans.push({ from: top.to, to: at, open: top.from, close: at + length, kind: top.kind, color: top.color });
					}
				} else if (mark) env.tags.push({ name: 'mark', from: at, to: at + length, kind: 'highlight', color: mark[1]?.toLowerCase() });
				else if (underline || span || emphasis) env.tags.push({ name: underline ? 'u' : emphasis ? emphasis[1].toLowerCase() : 'span', from: at, to: at + length, kind: underline ? 'underline' : emphasis ? emphasis[1].toLowerCase() === 'strong' ? 'bold' : 'italic' : span![1].toLowerCase() === 'color' ? 'color' : 'highlight', color: span?.[2].toLowerCase() });
				// An unsupported nested span/mark must consume its own closing tag.
				else if (/^<span\b/i.test(tag)) env.tags.push({ name: 'unsupported-span', from: at, to: at + length, kind: 'color' });
				else if (/^<mark\b/i.test(tag)) env.tags.push({ name: 'unsupported-mark', from: at, to: at + length, kind: 'highlight' });
			}
		}
	}
	if (!length) return false;
	if (!silent) state.push('text', '', 0).content = rest.slice(0, length);
	state.pos += length;
	return true;
});
inlineParser.inline.ruler.push('paged-delimiter', (state, silent) => {
	const at = state.pos, marker = state.src.charCodeAt(at);
	if (silent || ![42, 95, 126, 61].includes(marker)) return false;
	const emphasis = marker === 42 || marker === 95;
	const scanned = state.scanDelims(at, marker !== 95), unit = emphasis ? 1 : 2;
	if (scanned.length < unit) return false;
	let canOpen = scanned.can_open, canClose = scanned.can_close;
	if (marker === 61) {
		// Obsidian highlights are not CommonMark emphasis: `==` may sit inside a
		// word and directly before its color emoji (`글==🟣글==`), which flanking
		// rules reject (an emoji counts as punctuation). Match Obsidian instead:
		// it opens before non-space text and closes after non-space text.
		const before = at > 0 ? state.src[at - 1] : '', after = state.src[at + scanned.length] ?? '';
		canOpen = after !== '' && !/\s/u.test(after);
		canClose = before !== '' && !/\s/u.test(before);
	}
	let offset = 0;
	if (!emphasis && scanned.length % 2) { state.push('text', '', 0).content = state.src[at]; offset++; }
	for (; offset < scanned.length; offset += unit) {
		const token = state.push('text', '', 0);
		token.content = state.src.slice(at + offset, at + offset + unit);
		token.meta = { from: at + offset, to: at + offset + unit };
		state.delimiters.push({ marker, length: emphasis ? scanned.length : 0, token: state.tokens.length - 1, end: -1, open: canOpen, close: canClose });
	}
	state.pos += scanned.length;
	return true;
});
inlineParser.inline.ruler2.push('paged-spans', state => {
	const env = state.env as ParseEnvironment, delims = state.delimiters;
	for (let i = delims.length - 1; i >= 0; i--) {
		const start = delims[i]; if (start.end < 0) continue;
		const end = delims[start.end];
		const open = state.tokens[start.token].meta as { from: number; to: number };
		const close = state.tokens[end.token].meta as { from: number; to: number };
		const strong = (start.marker === 42 || start.marker === 95) && i > 0 && delims[i - 1].end === start.end + 1
			&& delims[i - 1].marker === start.marker && delims[i - 1].token === start.token - 1 && delims[start.end + 1].token === end.token + 1;
		const highlight = start.marker === 61 ? readHighlightPrefix(state.src, open.to) : null;
		env.spans.push({ open: open.from - (strong ? 1 : 0), from: open.to + (highlight?.length ?? 0), to: close.from, close: close.to + (strong ? 1 : 0), kind: start.marker === 61 ? 'highlight' : start.marker === 126 ? 'strikethrough' : strong ? 'bold' : 'italic', ...(highlight?.color ? { color: highlight.color } : {}) });
		if (strong) i--;
	}
	return true;
});

function linesOf(text: string): Line[] {
	const lines: Line[] = []; let from = 0;
	for (const match of text.matchAll(/\r\n|\n|\r/g)) {
		lines.push({ text: text.slice(from, match.index), ending: match[0], from }); from = match.index + match[0].length;
	}
	lines.push({ text: text.slice(from), ending: '', from });
	return lines;
}
function spansOf(state: InlineFormatState): Span[] {
	return [...state.inline, ...state.colors.map(range => ({ ...range, kind: 'color' as const })), ...state.highlights.map(range => ({ ...range, kind: 'highlight' as const }))];
}
function lineSpans(spans: Span[], line: Line): Span[] {
	return spans.filter(range => range.from < line.from + line.text.length && range.to > line.from)
		.map(range => ({ ...range, from: Math.max(0, range.from - line.from), to: Math.min(line.text.length, range.to - line.from) }));
}
function signature(spans: Span[]): string {
	// Union identical styles, including adjacent fragments, for stable matching.
	const normalized: Span[] = [];
	for (const span of [...spans].sort((a, b) => a.kind.localeCompare(b.kind) || (a.color ?? '').localeCompare(b.color ?? '') || a.from - b.from || a.to - b.to)) {
		const prev = normalized.at(-1);
		if (prev && prev.kind === span.kind && prev.color === span.color && span.from <= prev.to) prev.to = Math.max(prev.to, span.to);
		else normalized.push({ ...span });
	}
	return JSON.stringify(normalized.map(s => [s.from, s.to, s.kind, s.color ?? '']));
}

/** Source offsets include literal Markdown; values point into the visible buffer. */
const sourceMaps = new WeakMap<InlineFormatState, Uint32Array>();
export function sourceOffsetToVisible(state: InlineFormatState, offset: number): number {
	const map = sourceMaps.get(state); return map ? map[Math.max(0, Math.min(map.length - 1, offset))] : Math.max(0, Math.min(state.visible.length, offset));
}
export function visibleOffsetToSource(state: InlineFormatState, offset: number, affinity: 'left' | 'right' = 'left'): number {
	const map = sourceMaps.get(state); if (!map) return offset;
	let lo = 0, hi = map.length - 1;
	while (lo < hi) { const mid = (lo + hi) >>> 1; if (map[mid] < offset) lo = mid + 1; else hi = mid; }
	if (affinity === 'right') { while (lo + 1 < map.length && map[lo + 1] === offset) lo++; }
	return lo;
}
export function parseInlineMarkdown(body: string): InlineFormatState {
	const state: InlineFormatState = { visible: '', inline: [], colors: [], highlights: [], lines: [] };
	const map = new Uint32Array(body.length + 1), visible: string[] = [];
	let fence = '', fenceLength = 0, comment = false, position = 0;
	for (const line of linesOf(body)) {
		const spans: SourceSpan[] = [], fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
		const protectedLine = !!fence || (!comment && !!fenceMatch);
		if (fenceMatch && !comment) {
			if (!fence) { fence = fenceMatch[1][0]; fenceLength = fenceMatch[1].length; }
			else if (fenceMatch[1][0] === fence && fenceMatch[1].length >= fenceLength && !line.text.slice(fenceMatch[0].length).trim()) fence = '';
		}
		if (!protectedLine) {
			let start = 0;
			if (comment) { const end = line.text.indexOf('%%'); start = end < 0 ? line.text.length : end + 2; comment = end < 0; }
			if (start < line.text.length && /[*_~=<`$%[\\]/.test(line.text.slice(start))) {
				const env: ParseEnvironment = { spans, tags: [] };
				inlineParser.inline.parse(line.text.slice(start), inlineParser, env, []);
				for (const span of spans) { span.from += start; span.to += start; span.open += start; span.close += start; }
				if (env.trailingComment) comment = true;
			}
		}
		const removed = new Uint8Array(line.text.length);
		for (const span of spans) { removed.fill(1, span.open, span.from); removed.fill(1, span.to, span.close); }
		const start = position, chars: string[] = [], visibleSpans: Span[] = [];
		for (let i = 0; i < line.text.length; i++) { map[line.from + i] = position; if (!removed[i]) { chars.push(line.text[i]); position++; } }
		map[line.from + line.text.length] = position;
		for (const span of spans) {
			const range = { from: map[line.from + span.from], to: map[line.from + span.to] };
			if (range.from >= range.to) continue;
			const highlightColor = span.kind === 'highlight' ? normalizeHighlightColor(span.color) : '';
			visibleSpans.push({ ...range, kind: span.kind, ...(span.kind === 'color' || highlightColor ? { color: highlightColor || span.color } : {}) });
			if (span.kind === 'color') state.colors.push({ ...range, color: span.color! });
			else if (span.kind === 'highlight') state.highlights.push({ ...range, ...(highlightColor ? { color: highlightColor } : {}) });
			else state.inline.push({ ...range, kind: span.kind });
		}
		for (let i = 0; i < line.ending.length; i++) map[line.from + line.text.length + i] = position++;
		const text = chars.join(''); visible.push(text, line.ending);
		state.lines.push({ visibleText: text + line.ending, formatSignature: signature(lineSpans(visibleSpans, { text, from: start, ending: line.ending })), markdown: line.text + line.ending });
	}
	map[body.length] = position;
	state.visible = visible.join(''); sourceMaps.set(state, map);
	state.inline.sort((a, b) => a.from - b.from || a.to - b.to);
	state.highlights.sort((a, b) => a.from - b.from || a.to - b.to);
	return state;
}

/**
 * HTML form of an Obsidian highlight. `data-highlight` keeps Reading view's own
 * color rules; the inline background/color make the Live Preview HTML widget
 * (outside `.markdown-rendered`) look the same instead of the browser's yellow.
 */
function htmlMarkOpening(color?: string): string {
	const normalized = normalizeHighlightColor(color);
	const background = normalized ? `var(--highlight-background-${normalized})` : 'var(--highlight-background, var(--text-highlight-bg))';
	return `<mark${normalized ? ` data-highlight="${normalized}"` : ''} style="background-color: ${background}; color: inherit">`;
}
const markers: Record<Span['kind'], [string, string]> = { bold: ['**', '**'], italic: ['*', '*'], underline: ['<u>', '</u>'], strikethrough: ['~~', '~~'], highlight: ['==', '=='], color: ['', '</span>'] };
function serializeLine(text: string, spans: Span[]): string {
	spans = spans.map(span => {
		if (!['bold', 'italic', 'strikethrough', 'highlight'].includes(span.kind)) return span;
		let { from, to } = span;
		while (from < to && /\s/.test(text[from])) from++;
		while (to > from && /\s/.test(text[to - 1])) to--;
		return { ...span, from, to };
	}).filter(span => span.from < span.to);
	const cuts = [...new Set([0, text.length, ...spans.flatMap(s => [s.from, s.to])])].sort((a, b) => a - b);
	let result = '', active: Span[] = [];
	// Crossing emphasis cannot always be expressed by adjacent star runs in
	// CommonMark. Use semantic inline HTML only for those exceptional lines.
	const htmlEmphasis = spans.some(a => (a.kind === 'bold' || a.kind === 'italic') && (
		/\s/.test(text[a.from] ?? '') || /\s/.test(text[a.to - 1] ?? '')
		|| spans.some(b => b.from > a.from && b.from < a.to && b.to > a.to)));
	// Obsidian does not render Markdown inside inline HTML: `<span>==x==</span>`
	// shows literal `==`. Markdown markers therefore wrap outermost and every
	// HTML tag (color, underline, and fallback <strong>/<em>) nests innermost.
	const isHtmlFormat = (span: Span) => span.kind === 'color' || span.kind === 'underline'
		|| (htmlEmphasis && (span.kind === 'bold' || span.kind === 'italic'));
	// Live Preview draws inline HTML as its own widget, so `==` around a <span>
	// leaves that text without a background. A highlight overlapping any HTML
	// format is written as an HTML <mark> instead (plain `==` everywhere else).
	const htmlMarks = new Set(spans.filter(h => h.kind === 'highlight'
		&& spans.some(s => s !== h && isHtmlFormat(s) && s.from < h.to && s.to > h.from)));
	const kindOf = (span: Span) => htmlMarks.has(span) ? 'mark' : span.kind;
	const order = htmlEmphasis
		? ['highlight', 'strikethrough', 'mark', 'bold', 'italic', 'underline', 'color']
		: ['highlight', 'bold', 'italic', 'strikethrough', 'mark', 'underline', 'color'];
	const htmlTag = (span: Span) => htmlEmphasis && (span.kind === 'bold' || span.kind === 'italic') ? span.kind === 'bold' ? 'strong' : 'em' : '';
	const close = (span: Span) => htmlMarks.has(span) ? '</mark>' : htmlTag(span) ? `</${htmlTag(span)}>` : markers[span.kind][1];
	const open = (span: Span) => htmlMarks.has(span) ? htmlMarkOpening(span.color)
		: htmlTag(span) ? `<${htmlTag(span)}>` : span.kind === 'color' ? `<span style="color: ${span.color}">` : span.kind === 'highlight' ? highlightOpeningMarker(span.color) : markers[span.kind][0];
	for (let i = 0; i < cuts.length; i++) {
		const at = cuts[i], next = spans.filter(s => s.from <= at && s.to > at).sort((a, b) => order.indexOf(kindOf(a)) - order.indexOf(kindOf(b)) || (a.kind === 'color' ? a.from - b.from || b.to - a.to || spans.indexOf(b) - spans.indexOf(a) : 0));
		let shared = 0;
		while (shared < active.length && shared < next.length && kindOf(active[shared]) === kindOf(next[shared]) && active[shared].color === next[shared].color) shared++;
		for (let j = active.length - 1; j >= shared; j--) result += close(active[j]);
		for (let j = shared; j < next.length; j++) result += open(next[j]);
		if (i + 1 < cuts.length) result += text.slice(at, cuts[i + 1]);
		active = next;
	}
	return result;
}
const serializationCaches = new WeakMap<InlineFormatState, { originals: Map<string, string[]>; cache: Map<string, string>; lines: LineSource[] }>();
export function serializeInlineMarkdown(state: InlineFormatState): string {
	// Ordinary manuscripts pay no line/signature/serialization cost per keystroke.
	if (!state.inline.length && !state.colors.length && !state.highlights.length && state.lines.every(line => line.visibleText === line.markdown)) return state.visible;
	let cached = serializationCaches.get(state);
	if (!cached || cached.lines !== state.lines) {
		cached = { originals: new Map(), cache: new Map(), lines: state.lines };
		for (const line of state.lines) {
			const key = JSON.stringify([line.visibleText, line.formatSignature]), bucket = cached.originals.get(key) ?? [];
			bucket.push(line.markdown); cached.originals.set(key, bucket);
		}
		serializationCaches.set(state, cached);
	}
	const spans = spansOf(state).sort((a, b) => a.from - b.from), used = new Map<string, number>(), result: string[] = [], nextCache = new Map<string, string>();
	let cursor = 0, active: Span[] = [];
	for (const line of linesOf(state.visible)) {
		active = active.filter(span => span.to > line.from);
		while (cursor < spans.length && spans[cursor].from < line.from + line.text.length) active.push(spans[cursor++]);
		const ranges = lineSpans(active, line), key = JSON.stringify([line.text + line.ending, signature(ranges)]), index = used.get(key) ?? 0;
		used.set(key, index + 1);
		const cacheKey = `${index}:${key}`;
		const markdown = cached.originals.get(key)?.[index] ?? cached.cache.get(cacheKey) ?? serializeLine(line.text, ranges) + line.ending;
		result.push(markdown); nextCache.set(cacheKey, markdown);
	}
	cached.cache = nextCache;
	return result.join('');
}
