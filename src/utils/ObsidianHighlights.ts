// Obsidian's native colored highlights use an emoji immediately after ==.
export const HIGHLIGHT_MARKERS = {
	red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢', blue: '🔵', purple: '🟣',
} as const;
export type HighlightColor = keyof typeof HIGHLIGHT_MARKERS;
export const HIGHLIGHT_COLORS = Object.keys(HIGHLIGHT_MARKERS) as HighlightColor[];

export function normalizeHighlightColor(value?: string): HighlightColor | '' {
	return HIGHLIGHT_COLORS.find(color => color === value) ?? '';
}

export function readHighlightPrefix(text: string, offset = 0): { color: HighlightColor | ''; length: number } {
	const marker = String.fromCodePoint(text.codePointAt(offset) ?? 0);
	const squares = ['🟥', '🟧', '🟨', '🟩', '🟦', '🟪'];
	const color = HIGHLIGHT_COLORS.find((color, index) => HIGHLIGHT_MARKERS[color] === marker || squares[index] === marker) ?? '';
	return { color, length: color ? marker.length : 0 };
}

export function highlightOpeningMarker(color?: string): string {
	const normalized = normalizeHighlightColor(color);
	return '==' + (normalized ? HIGHLIGHT_MARKERS[normalized] : '');
}

export function highlightBackground(color?: string): string {
	const normalized = normalizeHighlightColor(color);
	return normalized ? `var(--highlight-background-${normalized})` : 'var(--highlight-background, var(--text-highlight-bg))';
}

// Portable export colors; the editor uses the current Obsidian theme instead.
export function highlightExportColor(color?: string): string {
	const colors: Record<HighlightColor, string> = {
		red: '#ff0000', orange: '#ffa500', yellow: '#ffff00', green: '#00ff00', blue: '#0000ff', purple: '#800080',
	};
	const normalized = normalizeHighlightColor(color);
	return normalized ? colors[normalized] : '#ffff00';
}
