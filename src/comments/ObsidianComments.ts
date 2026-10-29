/** Native Obsidian comments. Offsets address the unmodified UTF-16 source. */
export interface CommentRange {
	from: number;
	to: number;
	bodyFrom: number;
	bodyTo: number;
	startLine: number;
	endLine: number;
	closed: boolean;
}

function escaped(source: string, at: number): boolean {
	let slashes = 0;
	while (at > 0 && source[--at] === '\\') slashes++;
	return slashes % 2 === 1;
}

/** Quotes/list prefixes are containers, rather than part of a code fence. */
function containerBody(line: string): string {
	return line.replace(/^(?: {0,3}>[ \t]?)+/, '').replace(/^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/, '');
}

export function markdownBodyStart(source: string): number {
	if (!/^\uFEFF?---[ \t]*\r?\n/.test(source)) return 0;
	const closing = /^(?:---|\.\.\.)[ \t]*\r?$/gm;
	closing.lastIndex = source.indexOf('\n') + 1;
	const match = closing.exec(source);
	if (!match) return source.length;
	const end = match.index + match[0].length;
	return end + (source[end] === '\n' ? 1 : 0);
}

export function parseObsidianComments(source: string): CommentRange[] {
	if (!source.includes('%%')) return [];
	const comments: CommentRange[] = [];
	const starts = [0];
	for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
	const lineOf = (at: number): number => {
		let lo = 0, hi = starts.length - 1;
		while (lo < hi) { const mid = (lo + hi + 1) >>> 1; if (starts[mid] <= at) lo = mid; else hi = mid - 1; }
		return lo;
	};
	let at = markdownBodyStart(source);
	let fence: { char: string; length: number } | null = null;
	let lineStart = -1, lineEnd = -1;
	while (at < source.length) {
		if (at > lineEnd || lineStart < 0) {
			lineStart = at === 0 ? 0 : source.lastIndexOf('\n', at - 1) + 1;
			lineEnd = source.indexOf('\n', at);
			if (lineEnd < 0) lineEnd = source.length;
		}
		if (at === lineStart) {
			const body = containerBody(source.slice(at, lineEnd).replace(/\r$/, ''));
			const mark = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(body);
			if (fence) {
				if (mark && mark[1][0] === fence.char && mark[1].length >= fence.length && !mark[2].trim()) fence = null;
				at = lineEnd + 1; continue;
			}
			if (mark && (mark[1][0] !== '`' || !mark[2].includes('`'))) {
				fence = { char: mark[1][0], length: mark[1].length }; at = lineEnd + 1; continue;
			}
			if (/^(?: {4}|\t)/.test(body)) { at = lineEnd + 1; continue; }
		}
		if (source[at] === '`' && !escaped(source, at)) {
			let end = at + 1;
			while (source[end] === '`') end++;
			const marker = source.slice(at, end);
			let close = source.indexOf(marker, end);
			while (close >= 0 && (source[close - 1] === '`' || source[close + marker.length] === '`')) close = source.indexOf(marker, close + marker.length);
			if (close >= 0 && !/\r?\n[ \t]*\r?\n/.test(source.slice(end, close))) { at = close + marker.length; continue; }
			at = end; continue;
		}
		if (source.startsWith('%%', at) && !escaped(source, at)) {
			const block = /^ {0,3}$/.test(containerBody(source.slice(lineStart, at)));
			let close = source.indexOf('%%', at + 2);
			while (close >= 0 && escaped(source, close)) close = source.indexOf('%%', close + 2);
			if (block || (close >= 0 && close < lineEnd)) {
				const closed = close >= 0, to = closed ? close + 2 : source.length;
				comments.push({ from: at, to, bodyFrom: at + 2, bodyTo: closed ? close : to, startLine: lineOf(at), endLine: lineOf(Math.max(at, to - 1)), closed });
				at = to; continue;
			}
		}
		at++;
	}
	return comments;
}

/** Remove a comment-only line, without consuming surrounding manuscript blank lines. */
export function commentRemovalRange(source: string, comment: Pick<CommentRange, 'from' | 'to'>): { from: number; to: number } {
	const start = source.lastIndexOf('\n', comment.from - 1) + 1;
	const newline = source.indexOf('\n', comment.to);
	const end = newline < 0 ? source.length : newline;
	if (/^[ \t]*$/.test(source.slice(start, comment.from)) && /^[ \t\r]*$/.test(source.slice(comment.to, end))) return { from: start, to: newline < 0 ? end : end + 1 };
	return { from: comment.from, to: comment.to };
}

export interface CommentProjection {
	text: string;
	ranges: CommentRange[];
	originalOffset(offset: number, bias?: 'left' | 'right'): number;
	projectedOffset(offset: number): number;
	projectMask(masked: string): string;
	restoreMask(masked: string): string;
}

/** A compact source map is also used to project export formatting and analysis hits. */
export function projectObsidianComments(source: string): CommentProjection {
	const ranges = parseObsidianComments(source);
	const removals: Array<{ from: number; to: number; projected: number }> = [];
	let removed = 0;
	for (const range of ranges) {
		const next = commentRemovalRange(source, range), last = removals.at(-1);
		if (last && next.from <= last.to) { removed += Math.max(0, next.to - last.to); last.to = Math.max(last.to, next.to); }
		else { removals.push({ ...next, projected: next.from - removed }); removed += next.to - next.from; }
	}
	const chunks: string[] = [];
	let cursor = 0;
	for (const removal of removals) { chunks.push(source.slice(cursor, removal.from)); cursor = removal.to; }
	chunks.push(source.slice(cursor));
	const text = chunks.join('');
	return {
		text, ranges,
		originalOffset(offset, bias = 'right') {
			let lo = 0, hi = removals.length;
			while (lo < hi) { const mid = (lo + hi) >>> 1; if (removals[mid].projected < offset || (bias === 'right' && removals[mid].projected === offset)) lo = mid + 1; else hi = mid; }
			const last = removals[lo - 1], shift = last ? last.to - last.projected : 0;
			return Math.min(source.length, Math.max(0, offset + shift));
		},
		projectedOffset(offset) {
			let lo = 0, hi = removals.length;
			while (lo < hi) { const mid = (lo + hi) >>> 1; if (removals[mid].from < offset) lo = mid + 1; else hi = mid; }
			const last = removals[lo - 1], shift = last ? Math.min(offset, last.to) - last.projected : 0;
			return Math.max(0, Math.min(text.length, offset - shift));
		},
		projectMask(masked) {
			const output: string[] = []; let from = 0;
			for (const removal of removals) { output.push(masked.slice(from, removal.from)); from = removal.to; }
			output.push(masked.slice(from)); return output.join('');
		},
		restoreMask(masked) {
			const output: string[] = [];
			let from = 0, projected = 0;
			for (const removal of removals) {
				const length = removal.from - from;
				output.push(masked.slice(projected, projected + length), source.slice(removal.from, removal.to).replace(/[^\r\n]/g, ' '));
				projected += length; from = removal.to;
			}
			output.push(masked.slice(projected)); return output.join('');
		},
	};
}
