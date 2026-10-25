import { wmT } from '../i18n/index';
import { plotColumnTitle } from './PlotWorkbookColumnPresentation';
import type { PlotWorkbookSheet, PlotWorkbookSnapshotData } from './PlotWorkbookTypes';

export const SNAPSHOT_PREVIEW_ROWS = 50;
export const SNAPSHOT_PREVIEW_CHARACTERS = 40_000;

export function plotSnapshotRows(data: PlotWorkbookSnapshotData, sheet: PlotWorkbookSheet): string[] {
	const linked = new Set(data.foreshadows.flatMap(item => [...item.plantedAt, ...item.resolvedAt])
		.filter(point => point.sheetId === sheet.sheetId).map(point => point.rowId));
	return sheet.rowOrder.filter(rowId => linked.has(rowId) || sheet.rows[rowId]?.linkedNotePath
		|| Object.values(sheet.cells[rowId] ?? {}).some(cell => cell.value.trim()));
}

/** Only the displayed page is formatted; the restoration payload is never truncated. */
export function plotSnapshotPreview(data: PlotWorkbookSnapshotData, sheet: PlotWorkbookSheet,
	labels: Map<string, string>, page: number, rows = plotSnapshotRows(data, sheet), full = false): { text: string; clipped: boolean } {
	const lines: string[] = [];
	let remaining = full ? 4_000_000 : SNAPSHOT_PREVIEW_CHARACTERS;
	let clipped = false;
	const append = (text: string) => {
		if (text.length > remaining) clipped = true;
		const part = text.slice(0, remaining);
		if (part) lines.push(part);
		remaining = Math.max(0, remaining - part.length - 2);
	};
	const start = page * SNAPSHOT_PREVIEW_ROWS;
	const rowIds = full ? rows : rows.slice(start, start + SNAPSHOT_PREVIEW_ROWS);
	const visibleRows = new Set(rowIds);
	const foreshadows = new Map<string, string[]>();
	for (const item of data.foreshadows) {
		const points = [...item.plantedAt, ...item.resolvedAt].filter(point => point.sheetId === sheet.sheetId && visibleRows.has(point.rowId));
		for (const rowId of new Set(points.map(point => point.rowId))) {
			const titles = foreshadows.get(rowId) ?? [];
			titles.push(`- [${item.status === 'resolved' ? 'x' : ' '}] ${item.title.slice(0, 4000)}`);
			foreshadows.set(rowId, titles);
		}
	}
	for (const rowId of rowIds) {
		if (!remaining) { clipped = true; break; }
		const fields: string[] = [];
		let fieldLength = 0;
		for (const columnId of sheet.columnOrder) {
			const column = sheet.columns[columnId];
			if (!column) continue;
			let value = sheet.cells[rowId]?.[columnId]?.value ?? '';
			if (column.role === 'status' && value) value = data.manifest.statuses?.find(status => status.id === value)?.name ?? value;
			if (column.role === 'foreshadow') value = foreshadows.get(rowId)?.join('\n') ?? '';
			if (!value.trim()) continue;
			const title = column.role === 'character' && column.characterNotePath
				? column.title || column.characterNotePath.split('/').pop()?.replace(/\.md$/i, '') || wmT("인물")
				: plotColumnTitle(sheet, columnId);
			const limit = full ? 4_000_000 : 4000;
			if (value.length > limit) clipped = true;
			const field = `### ${title.slice(0, 200)}\n\n${value.slice(0, Math.min(limit, remaining))}${value.length > limit ? '\n…' : ''}`;
			fields.push(field); fieldLength += field.length + 2;
			if (fieldLength >= remaining) { clipped = true; break; }
		}
		if (!fields.length && !sheet.rows[rowId]?.linkedNotePath) continue;
		append(wmT("## {0}행", labels.get(rowId) ?? '—'));
		if (sheet.rows[rowId]?.linkedNotePath) append(wmT("본문: {0}", sheet.rows[rowId].linkedNotePath));
		for (const field of fields) append(field);
	}
	if (full && clipped) throw new Error(wmT("복사할 내용이 너무 큽니다. Markdown 내보내기를 사용해주세요."));
	return { text: lines.join('\n\n'), clipped };
}
