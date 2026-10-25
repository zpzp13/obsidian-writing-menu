import { wmT } from '../i18n/index';
import { columnLabel, type PlotWorkbookColumnRole, type PlotWorkbookSheet } from './PlotWorkbookTypes';

export const PLOT_COLUMN_ICONS: Record<PlotWorkbookColumnRole,string> = {
	text:'text',plot:'git-branch',character:'user-round',cast:'users',status:'info',date:'calendar-days',foreshadow:'sprout',checklist:'list-checks',
};

export function plotColumnTitle(sheet: PlotWorkbookSheet, id: string): string {
	const column = sheet.columns[id];
	if (column.role === 'cast') return wmT("등장");
	if (column.role === 'foreshadow') return wmT("복선");
	return column.title || columnLabel(sheet.columnOrder.indexOf(id));
}
