import type { TimeModeConfig, WritingMenuSettings } from '../types';

/** Lucide icon for a work mode: the configured one, else the built-in default. */
export function getModeIcon(mode: TimeModeConfig): string {
	if (mode.icon) return mode.icon;
	const defaults: Record<string, string> = {
		draft: 'lightbulb', writing: 'pencil', editing: 'spell-check',
	};
	return defaults[mode.id] ?? 'clock';
}

/** Same color rule as the dashboard mode cards and chart: the mode's position in `timeModes`. */
export function getModeSeriesColor(settings: WritingMenuSettings, mode: TimeModeConfig): string {
	const index = Math.max(0, (settings.timeModes ?? []).findIndex(candidate => candidate.id === mode.id));
	return `var(--wm-wt-series-${index % 7 + 1})`;
}

/** The current work mode (shared by the dashboard and the editor widget). */
export function getCurrentTimeMode(settings: WritingMenuSettings): TimeModeConfig | null {
	const modes = settings.timeModes ?? [];
	return modes.find(mode => mode.id === settings.currentTimeMode) ?? modes[0] ?? null;
}
