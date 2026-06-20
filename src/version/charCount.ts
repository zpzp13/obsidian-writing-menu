function preprocessContent(text: string): string {
	const body = text.replace(/^---\s*\n.*?\n---\s*\n?/s, '').trim();
	return body.split('\n')
		.filter(l => !l.trim().match(/^#{1,6}\s/))
		.filter(l => !l.trim().match(/^\[\^[^\]]+\]:/))
		.map(l => l.replace(/\[\^[^\]]+\]/g, ''))
		.map(l => l.trim())
		.filter(l => l)
		.join('');
}

function countBase(base: string, mode: 'munpia' | 'novelpia'): number {
	if (mode === 'novelpia') {
		return base.replace(/[.,!?"'']/g, '').replace(/\s/g, '').length;
	}
	const ellipsisCount = (base.match(/…/g) || []).length;
	return base.length + (ellipsisCount * 2);
}

export function calcVersionCharCount(text: string, mode: 'munpia' | 'novelpia'): number {
	return countBase(preprocessContent(text), mode);
}

/** 전처리를 한 번만 수행하고 두 플랫폼 글자수를 함께 반환 */
export function calcAllCharCounts(text: string): { munpia: number; novelpia: number } {
	const base = preprocessContent(text);
	return { munpia: countBase(base, 'munpia'), novelpia: countBase(base, 'novelpia') };
}
