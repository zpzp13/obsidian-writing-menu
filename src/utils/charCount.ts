function preprocessContent(text: string): string {
	const body = text.replace(/^---\s*\n.*?\n---\s*\n?/s, '').trim();
	const kept: string[] = [];
	for (const rawLine of body.split('\n')) {
		let line = rawLine.trim();
		if (!line || /^#{1,6}\s/.test(line) || /^\[\^[^\]]+\]:/.test(line)) continue;
		line = line.replace(/\[\^[^\]]+\]/g, '').trim();
		if (line) kept.push(line);
	}
	return kept.join('');
}

function countBase(base: string, mode: 'munpia' | 'novelpia'): number {
	if (mode === 'novelpia') {
		return base.replace(/[.,!?"'']/g, '').replace(/\s/g, '').length;
	}
	const ellipsisCount = (base.match(/…/g) || []).length;
	return base.length + (ellipsisCount * 2);
}

export function calcSnapshotCharCount(text: string, mode: 'munpia' | 'novelpia'): number {
	return countBase(preprocessContent(text), mode);
}

/** 전처리를 한 번만 수행하고 두 플랫폼 글자수를 함께 반환 */
export function calcAllCharCounts(text: string): { munpia: number; novelpia: number } {
	const base = preprocessContent(text);
	let ellipsisCount = 0;
	let novelpia = 0;
	for (let index = 0; index < base.length; index++) {
		const char = base[index];
		const code = base.charCodeAt(index);
		if (char === '…') ellipsisCount++;
		const isWhitespace = code <= 0x20 || code === 0xa0 || code === 0x1680
			|| (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029
			|| code === 0x202f || code === 0x205f || code === 0x3000;
		if (!isWhitespace && char !== '.' && char !== ',' && char !== '!'
			&& char !== '?' && char !== '"' && char !== "'") novelpia++;
	}
	return { munpia: base.length + ellipsisCount * 2, novelpia };
}
