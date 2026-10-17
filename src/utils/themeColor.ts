import type { ColorThemeMode, ThemeAwareColor, ThemeColorPair } from '../types';

export const DEFAULT_TEXT_COLORS: ThemeColorPair = { light: '#202020', dark: '#f1f1f1' };
export const DEFAULT_BACKGROUND_COLORS: ThemeColorPair = { light: '#fef3c7', dark: '#514719' };
export const TEXT_COLOR_PALETTE: ThemeColorPair[] = [
	{ light: '#111111', dark: '#f1f1f1' },
	{ light: '#6b7280', dark: '#a7afbd' },
	{ light: '#b64f5c', dark: '#e1848e' },
	{ light: '#3f6eae', dark: '#82a9df' },
	{ light: '#715aa4', dark: '#a28bd0' },
];
export const BACKGROUND_COLOR_PALETTE: ThemeColorPair[] = [
	{ light: '#f1e8bd', dark: '#4c4526' },
	{ light: '#efd2ad', dark: '#503922' },
	{ light: '#edc4c7', dark: '#4f2f34' },
	{ light: '#c7d9ec', dark: '#293e56' },
	{ light: '#c8e5d1', dark: '#294538' },
];

export function isHexColor(value: unknown): value is string {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function isThemeColorPair(value: unknown): value is ThemeColorPair {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = value as Partial<ThemeColorPair>;
	return isHexColor(candidate.light) && isHexColor(candidate.dark);
}

export function isThemeAwareColor(value: unknown): value is ThemeAwareColor {
	return isHexColor(value) || isThemeColorPair(value);
}

export function toThemeColorPair(value: ThemeAwareColor | undefined, fallback: ThemeColorPair): ThemeColorPair {
	if (isThemeColorPair(value)) return { light: value.light, dark: value.dark };
	if (isHexColor(value)) return { light: value, dark: value };
	return { ...fallback };
}

export function resolveThemeColor(
	value: ThemeAwareColor | undefined,
	mode: ColorThemeMode,
	fallback: ThemeColorPair,
): string {
	return toThemeColorPair(value, fallback)[mode];
}

export function themeModeFromDocument(ownerDocument: Document): ColorThemeMode {
	return ownerDocument.body.classList.contains('theme-dark') ? 'dark' : 'light';
}

