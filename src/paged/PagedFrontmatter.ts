export function splitPagedFrontmatter(source: string): { prefix: string; body: string } {
	const firstLineEnd = source.indexOf('\n');
	if (firstLineEnd < 0 || source.slice(0, firstLineEnd).replace(/\r$/, '').trim() !== '---') return { prefix: '', body: source };
	let start = firstLineEnd + 1;
	while (start <= source.length) {
		const end = source.indexOf('\n', start), line = source.slice(start, end < 0 ? source.length : end).replace(/\r$/, '').trim();
		if (line === '---' || line === '...') {
			const offset = end < 0 ? source.length : end + 1; return { prefix: source.slice(0, offset), body: source.slice(offset) };
		}
		if (end < 0) break; start = end + 1;
	}
	return { prefix: '', body: source };
}

