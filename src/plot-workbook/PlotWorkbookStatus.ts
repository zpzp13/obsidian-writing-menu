import { getLanguage } from '../i18n/index';
import { DEFAULT_PLOT_WORKBOOK_STATUSES, type PlotWorkbookStatus } from './PlotWorkbookTypes';

export function plotWorkbookStatusName(status: PlotWorkbookStatus): string {
	const original = DEFAULT_PLOT_WORKBOOK_STATUSES.find(item => item.id === status.id);
	if (getLanguage() !== 'en' || original?.name !== status.name) return status.name;
	return ({ idea: 'Idea', draft: 'Draft', revised: 'Revised', done: 'Done' } as Record<string, string>)[status.id] ?? status.name;
}

export function plotWorkbookStatuses(overrides: readonly PlotWorkbookStatus[] = [], includeHidden = false): PlotWorkbookStatus[] {
	const statuses = new Map(DEFAULT_PLOT_WORKBOOK_STATUSES.map(status => [status.id, { ...status }]));
	for (const status of overrides) statuses.set(status.id, { ...status });
	return [...statuses.values()].filter(status => includeHidden || !status.hidden);
}

export function plotWorkbookStatusColor(id: string, color?: string): string {
	if (color) return color;
	const tone = ({ idea: 'neutral', draft: 'blue', revised: 'amber', done: 'green' } as Record<string, string>)[id] ?? 'neutral';
	return `var(--wm-plotbook-status-${tone})`;
}

export function plotWorkbookStatusDefaultColor(id: string, dark = false): string {
	const colors: Record<string, [string, string]> = {
		idea: ['#6b7078', '#a0a5ad'], draft: ['#54789f', '#96b6d2'],
		revised: ['#987637', '#cdb26e'], done: ['#4b7e5d', '#92bca0'],
	};
	return (colors[id] ?? colors.idea)[dark ? 1 : 0];
}

export function plotWorkbookStatusIcon(id: string): string { return id === 'done' ? 'circle' : 'circle-dashed'; }
