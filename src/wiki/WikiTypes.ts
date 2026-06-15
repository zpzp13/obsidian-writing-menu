export interface WikiSavedView {
	name: string;
	folderPath: string;
	groupField: string;
	properties: string[];
	paletteName?: string;
}

export interface WikiGroupRule {
	id: string;
	field: string;
	operator: 'contains' | 'does not contain' | 'is' | 'is not';
	value: string;
	isPinned?: boolean;
	groupName?: string;
	condition?: 'and' | 'or';
	field2?: string;
	value2?: string;
}

export interface SortRule {
	property: string;
	groupOrder: string[];
	itemOrder: string[];
}

export const PRESET_PALETTES: Record<string, string[]> = {
	'TierList': ['#ff7f7f', '#ffbf7f', '#ffdf7f', '#ffff7f', '#bfff7f', '#7fff7f', '#7fffff', '#7fbfff', '#7f7fff', '#bf7fff', '#ff7fff'],
	'Pastel Rainbow': ['#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF', '#E2F0CB', '#FFDAC1', '#FF9AA2'],
	'Monochrome': ['#444444', '#555555', '#666666', '#777777', '#888888', '#999999'],
	'Vivid': ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#9400D3'],
};

export function getToneColor(hex: string): string {
	let r = 0, g = 0, b = 0;
	if (!hex) return '#ffffff';
	let c = hex;
	if (c.startsWith('#')) c = c.slice(1);
	if (c.length === 3) { r = parseInt(c[0] + c[0], 16); g = parseInt(c[1] + c[1], 16); b = parseInt(c[2] + c[2], 16); }
	else if (c.length === 6) { r = parseInt(c.substring(0, 2), 16); g = parseInt(c.substring(2, 4), 16); b = parseInt(c.substring(4, 6), 16); }
	else return '#ffffff';
	const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return lum > 0.5 ? `color-mix(in srgb, ${hex}, black 85%)` : `color-mix(in srgb, ${hex}, white 90%)`;
}
