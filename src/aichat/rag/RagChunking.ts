export interface TextWindow { from: number; to: number; text: string; location: string }
/** Token-aware windows, with original UTF-16 offsets and paragraph/heading boundaries. */
export function ragTextWindows(text: string, title: string, count: (text: string) => number): TextWindow[] {
	const result: TextWindow[] = [];
	const lineStarts = [0]; for (let index = 0; index < text.length; index++) if (text[index] === '\n') lineStarts.push(index + 1);
	const headings = [...text.matchAll(/^#{1,6}\s/gm)].map(match => match.index);
	const lineAt = (offset: number) => { let low = 0, high = lineStarts.length; while (low < high) { const middle = (low + high) >>> 1; if (lineStarts[middle] <= offset) low = middle + 1; else high = middle; } return low; };
	let from = 0, headingIndex = 0;
	while (from < text.length) {
		let low = from + 1, high = Math.min(text.length, from + 2400), to = low;
		while (low <= high) { const middle = (low + high) >>> 1; if (count(`passage: ${title.slice(0, 160)}\n${text.slice(from, middle)}`) <= 448) { to = middle; low = middle + 1; } else high = middle - 1; }
		while (headingIndex < headings.length && headings[headingIndex] <= from) headingIndex++;
		const heading = headings[headingIndex] < to ? headings[headingIndex] : undefined;
		if (heading !== undefined) to = heading;
		if (to < text.length && heading === undefined) {
			const boundary = text.lastIndexOf('\n', to - 1);
			if (boundary > from + (to - from) * 0.5) to = boundary + 1;
			if (to > from && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
		}
		if (to <= from) to = Math.min(text.length, from + 2);
		const part = text.slice(from, to), line = lineAt(from), end = lineAt(to);
		if (part.trim()) result.push({ from, to, text: part, location: `${line}–${end}행` });
		if (to === text.length) break;
		// About 48 tokens of overlap, without splitting a surrogate pair.
		let overlap = heading !== undefined ? 0 : Math.min(96, Math.floor((to - from) / 5));
		while (overlap > 0 && count(text.slice(to - overlap, to)) > 48) overlap = Math.floor(overlap / 2);
		from = Math.max(from + 1, to - overlap);
		if (from > 0 && /[\uDC00-\uDFFF]/.test(text[from])) from++;
	}
	return result;
}
