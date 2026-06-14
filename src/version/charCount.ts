/** main.ts calculateCharCount 과 동일한 로직 */
export function calcVersionCharCount(text: string, mode: 'munpia' | 'novelpia'): number {
	const withoutFrontmatter = text.replace(/^---\s*\n.*?\n---\s*\n?/s, '').trim();
	const lines = withoutFrontmatter.split('\n')
		.filter(l => !l.trim().match(/^#{1,6}\s/))
		.filter(l => !l.trim().match(/^\[\^[^\]]+\]:/))
		.map(l => l.replace(/\[\^[^\]]+\]/g, ''))
		.map(l => l.trim())
		.filter(l => l);
	const base = lines.join('');

	if (mode === 'novelpia') {
		return base.replace(/ /g, '').replace(/[.,!?"']/g, '').replace(/[\s ]/g, '').length;
	} else {
		const ellipsisCount = (base.match(/…/g) || []).length;
		return base.length + (ellipsisCount * 2);
	}
}
