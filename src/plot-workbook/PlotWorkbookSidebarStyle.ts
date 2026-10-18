import type { PlotWorkbookCellStyle } from './PlotWorkbookTypes';

/** Sidebar typography deliberately excludes cell backgrounds and alignment. */
export function applySidebarTextStyle(element: HTMLElement, style: PlotWorkbookCellStyle, fontSize?: number): void {
	element.addClass('wm-plotbook-sidebar-text-style');
	element.style.fontFamily = style.fontFamily ?? '';
	element.style.fontSize = fontSize === undefined ? '' : `${fontSize}px`;
	for (const mode of ['light', 'dark'] as const) {
		const variable = `--wm-plotbook-sidebar-text-${mode}`;
		const color = typeof style.color === 'string' ? style.color : style.color?.[mode];
		if (color) element.style.setProperty(variable, color);
		else element.style.removeProperty(variable);
	}
}
