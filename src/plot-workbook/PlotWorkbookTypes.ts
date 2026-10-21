import type { ThemeAwareColor } from '../types';

export const PLOT_WORKBOOK_VIEW_TYPE = 'writing-menu-plot-workbook';
export const PLOT_WORKBOOK_SIDEBAR_TYPE = 'writing-menu-plot-sidebar';
export const PLOT_WORKBOOK_FORMAT_VERSION = 1;
export const PLOT_WORKBOOK_MANIFEST_VERSION = 2;
export const DEFAULT_PLOTBOOK_FONT_SIZE = 10;

export interface PlotWorkbookManifest {
	formatVersion: number;
	projectId: string;
	projectName: string;
	activeSheetId: string;
	sheets: PlotWorkbookSheetRef[];
	deletedSheets?: PlotWorkbookDeletedSheetRef[];
	labels?: PlotWorkbookLabel[];
	statuses?: PlotWorkbookStatus[];
	snapshots?: PlotWorkbookCellSnapshotRef[];
	legacyImports?: PlotWorkbookLegacyImport[];
	/** A fully verified restore is published by switching this pointer last. */
	storageGeneration?: string;
}

export interface PlotWorkbookSnapshotData {
	manifest: PlotWorkbookManifest;
	sheets: PlotWorkbookSheet[];
	foreshadows: PlotWorkbookForeshadow[];
	cellSnapshots: PlotWorkbookCellSnapshot[];
}

export interface PlotWorkbookStatus {
	id: string;
	name: string;
	color?: string;
	/** Removed from new choices; existing cell references retain their names. */
	hidden?: boolean;
}

export interface PlotWorkbookForeshadowLocation {
	sheetId: string;
	rowId: string;
	columnId: string;
}

export interface PlotWorkbookForeshadow {
	id: string;
	title: string;
	note?: string;
	status: 'open' | 'resolved';
	plantedAt: PlotWorkbookForeshadowLocation[];
	resolvedAt: PlotWorkbookForeshadowLocation[];
	createdAt: number;
	updatedAt: number;
}

export interface PlotWorkbookForeshadowRegistry {
	formatVersion: 1;
	items: PlotWorkbookForeshadow[];
}

export interface PlotWorkbookCellSnapshotRef {
	id: string;
	sheetId: string;
	rowId: string;
	columnId: string;
	title: string;
	createdAt: number;
}

export interface PlotWorkbookCellSnapshot extends PlotWorkbookCellSnapshotRef {
	value: string;
}

export const DEFAULT_PLOT_WORKBOOK_STATUSES: readonly PlotWorkbookStatus[] = [
	{ id: 'idea', name: '아이디어' },
	{ id: 'draft', name: '초고' },
	{ id: 'revised', name: '수정' },
	{ id: 'done', name: '완료' },
];

export interface PlotWorkbookLegacyImport {
	sourcePath: string;
	importedAt: number;
	sheetId: string;
}

export interface PlotWorkbookLabel {
	id: string;
	name: string;
	color: string;
}

export interface PlotWorkbookSheetRef {
	id: string;
	name: string;
}

export interface PlotWorkbookDeletedSheetRef extends PlotWorkbookSheetRef {
	deletedAt: number;
	originalIndex: number;
}

export interface PlotWorkbookRow {
	id: string;
	linkedNotePath?: string;
	height?: number;
	style?: PlotWorkbookCellStyle;
	cellStyle?: PlotWorkbookCellStyle;
	depth?: number;
	collapsed?: boolean;
	parentRowId?: string;
}

export interface PlotWorkbookColumn {
	id: string;
	width?: number;
	title?: string;
	style?: PlotWorkbookCellStyle;
	cellStyle?: PlotWorkbookCellStyle;
	role?: PlotWorkbookColumnRole;
	characterNotePath?: string;
	labelId?: string;
	trackingEnabled?: boolean;
	collapsed?: boolean;
}

export type PlotWorkbookColumnRole = 'text' | 'plot' | 'character' | 'cast' | 'status' | 'date' | 'foreshadow' | 'checklist';

export interface PlotWorkbookColumnRoleChange {
	columnId: string;
	before?: PlotWorkbookColumnRole;
	after?: PlotWorkbookColumnRole;
}

export interface PlotWorkbookColumnStateChange extends PlotWorkbookColumnRoleChange {
	beforeTitle?: string;
	afterTitle?: string;
	beforeCharacterNotePath?: string;
	afterCharacterNotePath?: string;
	beforeLabelId?: string;
	afterLabelId?: string;
	beforeTrackingEnabled?: boolean;
	afterTrackingEnabled?: boolean;
}

export interface PlotWorkbookCell {
	type: 'text';
	value: string;
	style?: PlotWorkbookCellStyle;
}

export interface PlotWorkbookCellStyle {
	fontFamily?: string;
	fontSize?: number;
	color?: ThemeAwareColor;
	backgroundColor?: ThemeAwareColor;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	alignment?: 'left' | 'center' | 'right';
}

export interface PlotWorkbookCellStyleChange {
	rowId: string;
	columnId: string;
	before?: PlotWorkbookCellStyle;
	after?: PlotWorkbookCellStyle;
}

export interface PlotWorkbookRowStyleChange {
	rowId: string;
	before?: PlotWorkbookCellStyle;
	after?: PlotWorkbookCellStyle;
}

export interface PlotWorkbookColumnStyleChange {
	columnId: string;
	before?: PlotWorkbookCellStyle;
	after?: PlotWorkbookCellStyle;
}

export interface PlotWorkbookRowDimensionChange {
	rowId: string;
	before?: number;
	after?: number;
}

export interface PlotWorkbookColumnDimensionChange {
	columnId: string;
	before?: number;
	after?: number;
}

export interface PlotWorkbookCellChange {
	rowId: string;
	columnId: string;
	before: string;
	after: string;
}

export interface PlotWorkbookSheet {
	formatVersion: number;
	sheetId: string;
	name: string;
	revision: number;
	lastSeq: number;
	rowOrder: string[];
	columnOrder: string[];
	rows: Record<string, PlotWorkbookRow>;
	columns: Record<string, PlotWorkbookColumn>;
	cells: Record<string, Record<string, PlotWorkbookCell>>;
	view?: {
		frozenRowCount?: number;
		frozenColumnCount?: number;
		rowHeaderWidth?: number;
		columnHeaderHeight?: number;
		defaultRowHeight?: number;
		defaultColumnWidth?: number;
		rowNumberStart?: number;
	};
}

interface PlotWorkbookOperationBase {
	seq: number;
	tx: string;
	at: number;
	sheetId: string;
}

export type PlotWorkbookOperation = PlotWorkbookOperationBase & (
	| {
		op: 'setCell';
		rowId: string;
		columnId: string;
		before: string;
		after: string;
	}
	| {
		op: 'setCells';
		changes: PlotWorkbookCellChange[];
	}
	| {
		op: 'setCellStyles';
		changes: PlotWorkbookCellStyleChange[];
	}
	| {
		op: 'setHeaderStyles';
		rowChanges: PlotWorkbookRowStyleChange[];
		columnChanges: PlotWorkbookColumnStyleChange[];
	}
	| {
		op: 'setAxisCellStyles';
		rowChanges: PlotWorkbookRowStyleChange[];
		columnChanges: PlotWorkbookColumnStyleChange[];
	}
	| {
		op: 'resizeRow';
		rowId: string;
		before?: number;
		after?: number;
	}
	| {
		op: 'resizeColumn';
		columnId: string;
		before?: number;
		after?: number;
	}
	| {
		op: 'renameColumn';
		columnId: string;
		before: string;
		after: string;
	}
	| {
		op: 'setColumnRoles';
		changes: PlotWorkbookColumnRoleChange[];
	}
	| {
		op: 'setColumnStates';
		changes: PlotWorkbookColumnStateChange[];
		cellChanges?: PlotWorkbookCellChange[];
	}
	| {
		op: 'setRowDepth';
		rowId: string;
		before: number;
		after: number;
	}
	| {
		op: 'setRowCollapsed';
		rowId: string;
		before: boolean;
		after: boolean;
	}
	| {
		op: 'setRowLinkedNote';
		rowId: string;
		before?: string;
		after?: string;
	}
	| {
		op: 'setColumnCollapsed';
		columnId: string;
		before: boolean;
		after: boolean;
	}
	| {
		op: 'appendRows';
		rows: PlotWorkbookRow[];
	}
	| {
		op: 'insertRows';
		index: number;
		rows: PlotWorkbookRow[];
		cells: Record<string, Record<string, PlotWorkbookCell>>;
	}
	| {
		op: 'removeRows';
		index: number;
		rows: PlotWorkbookRow[];
		cells: Record<string, Record<string, PlotWorkbookCell>>;
	}
	| {
		op: 'swapRowBlocks';
		firstIds: string[];
		secondIds: string[];
	}
	| {
		op: 'appendColumns';
		columns: PlotWorkbookColumn[];
	}
	| {
		op: 'insertColumns';
		index: number;
		columns: PlotWorkbookColumn[];
		cells: Record<string, Record<string, PlotWorkbookCell>>;
	}
	| {
		op: 'removeColumns';
		index: number;
		columns: PlotWorkbookColumn[];
		cells: Record<string, Record<string, PlotWorkbookCell>>;
	}
	| {
		op: 'swapColumnBlocks';
		firstIds: string[];
		secondIds: string[];
	}
	| {
		op: 'setFrozenPanes';
		beforeRows: number;
		afterRows: number;
		beforeColumns: number;
		afterColumns: number;
	}
	| {
		op: 'resizeHeaders';
		beforeWidth: number;
		afterWidth: number;
		beforeHeight: number;
		afterHeight: number;
	}
	| {
		op: 'setDefaultDimensions';
		beforeRowHeight?: number;
		afterRowHeight: number;
		beforeColumnWidth?: number;
		afterColumnWidth: number;
		rowChanges: PlotWorkbookRowDimensionChange[];
		columnChanges: PlotWorkbookColumnDimensionChange[];
	}
	| {
		op: 'setRowNumberStart';
		before: number;
		after: number;
	}
);

export interface PlotWorkbookLoadResult {
	manifest: PlotWorkbookManifest;
	sheets: Map<string, PlotWorkbookSheet>;
	foreshadows: PlotWorkbookForeshadow[];
	warnings: string[];
}

export const DEFAULT_PLOTBOOK_ROW_HEIGHT = 50;
export const DEFAULT_PLOTBOOK_COLUMN_WIDTH = 200;
export const MIN_PLOTBOOK_ROW_HEIGHT = 22;
export const MAX_PLOTBOOK_ROW_HEIGHT = 240;
export const MIN_PLOTBOOK_COLUMN_WIDTH = 56;
export const MAX_PLOTBOOK_COLUMN_WIDTH = 640;

export function newPlotWorkbookId(prefix: string): string {
	const cryptoApi = globalThis.crypto;
	const random = cryptoApi?.randomUUID
		? cryptoApi.randomUUID().replace(/-/g, '')
		: `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
	return `${prefix}-${random.slice(0, 16)}`;
}

export function createPlotWorkbookSheet(name = '시트 1', rowCount = 200, columnCount = 32): PlotWorkbookSheet {
	const sheetId = newPlotWorkbookId('sheet');
	const rows: Record<string, PlotWorkbookRow> = {};
	const columns: Record<string, PlotWorkbookColumn> = {};
	const rowOrder: string[] = [];
	const columnOrder: string[] = [];

	for (let index = 0; index < rowCount; index++) {
		const id = newPlotWorkbookId('row');
		rows[id] = { id };
		rowOrder.push(id);
	}
	for (let index = 0; index < columnCount; index++) {
		const id = newPlotWorkbookId('column');
		columns[id] = { id };
		columnOrder.push(id);
	}

	return {
		formatVersion: PLOT_WORKBOOK_FORMAT_VERSION,
		sheetId,
		name,
		revision: 0,
		lastSeq: 0,
		rowOrder,
		columnOrder,
		rows,
		columns,
		cells: {},
	};
}

export function clonePlotWorkbookSheet(sheet: PlotWorkbookSheet): PlotWorkbookSheet {
	return JSON.parse(JSON.stringify(sheet)) as PlotWorkbookSheet;
}

export function applyPlotWorkbookOperation(sheet: PlotWorkbookSheet, operation: PlotWorkbookOperation): void {
	if (operation.sheetId !== sheet.sheetId || operation.seq <= sheet.lastSeq) return;

	switch (operation.op) {
		case 'setCell': {
			setPlotWorkbookCell(sheet, operation.rowId, operation.columnId, operation.after);
			break;
		}
		case 'setCells': {
			for (const change of operation.changes) {
				setPlotWorkbookCell(sheet, change.rowId, change.columnId, change.after);
			}
			break;
		}
		case 'setCellStyles': {
			for (const change of operation.changes) {
				setPlotWorkbookCellStyle(sheet, change.rowId, change.columnId, change.after);
			}
			break;
		}
		case 'setHeaderStyles': {
			for (const change of operation.rowChanges) {
				const row = sheet.rows[change.rowId];
				if (!row) continue;
				if (change.after && Object.keys(change.after).length > 0) row.style = { ...change.after };
				else delete row.style;
			}
			for (const change of operation.columnChanges) {
				const column = sheet.columns[change.columnId];
				if (!column) continue;
				if (change.after && Object.keys(change.after).length > 0) column.style = { ...change.after };
				else delete column.style;
			}
			break;
		}
		case 'setAxisCellStyles': {
			for (const change of operation.rowChanges) {
				const row = sheet.rows[change.rowId];
				if (!row) continue;
				if (change.after && Object.keys(change.after).length > 0) row.cellStyle = { ...change.after };
				else delete row.cellStyle;
			}
			for (const change of operation.columnChanges) {
				const column = sheet.columns[change.columnId];
				if (!column) continue;
				if (change.after && Object.keys(change.after).length > 0) column.cellStyle = { ...change.after };
				else delete column.cellStyle;
			}
			break;
		}
		case 'resizeRow':
			if (sheet.rows[operation.rowId]) {
				if (operation.after === undefined) delete sheet.rows[operation.rowId].height;
				else sheet.rows[operation.rowId].height = operation.after;
			}
			break;
		case 'resizeColumn':
			if (sheet.columns[operation.columnId]) {
				if (operation.after === undefined) delete sheet.columns[operation.columnId].width;
				else sheet.columns[operation.columnId].width = operation.after;
			}
			break;
		case 'renameColumn':
			if (sheet.columns[operation.columnId]) {
				if (operation.after) sheet.columns[operation.columnId].title = operation.after;
				else delete sheet.columns[operation.columnId].title;
			}
			break;
		case 'setColumnRoles':
			for (const change of operation.changes) {
				const column = sheet.columns[change.columnId];
				if (!column) continue;
				if (change.after && change.after !== 'text') column.role = change.after;
				else delete column.role;
			}
			break;
		case 'setColumnStates':
			for (const change of operation.changes) {
				const column = sheet.columns[change.columnId];
				if (!column) continue;
				if ('afterTitle' in change) {
					if (change.afterTitle) column.title = change.afterTitle;
					else delete column.title;
				}
				if (change.after && change.after !== 'text') column.role = change.after;
				else delete column.role;
				if (change.afterCharacterNotePath) column.characterNotePath = change.afterCharacterNotePath;
				else delete column.characterNotePath;
				if (change.afterLabelId) column.labelId = change.afterLabelId;
				else delete column.labelId;
				if (change.afterTrackingEnabled) column.trackingEnabled = true;
				else delete column.trackingEnabled;
			}
			for (const change of operation.cellChanges ?? []) {
				setPlotWorkbookCell(sheet, change.rowId, change.columnId, change.after);
			}
			break;
		case 'setRowDepth':
			if (sheet.rows[operation.rowId]) sheet.rows[operation.rowId].depth = operation.after;
			break;
		case 'setRowCollapsed':
			if (sheet.rows[operation.rowId]) {
				if (operation.after) sheet.rows[operation.rowId].collapsed = true;
				else delete sheet.rows[operation.rowId].collapsed;
			}
			break;
		case 'setRowLinkedNote': {
			const row = sheet.rows[operation.rowId];
			if (!row) break;
			if (operation.after) row.linkedNotePath = operation.after;
			else delete row.linkedNotePath;
			break;
		}
		case 'setColumnCollapsed':
			if (sheet.columns[operation.columnId]) {
				if (operation.after) sheet.columns[operation.columnId].collapsed = true;
				else delete sheet.columns[operation.columnId].collapsed;
			}
			break;
		case 'appendRows':
			for (const row of operation.rows) {
				if (sheet.rows[row.id]) continue;
				sheet.rows[row.id] = { ...row };
				sheet.rowOrder.push(row.id);
			}
			break;
		case 'insertRows': {
			const rows = operation.rows.filter(row => !sheet.rows[row.id]);
			const index = Math.max(0, Math.min(sheet.rowOrder.length, operation.index));
			for (const row of rows) sheet.rows[row.id] = { ...row };
			sheet.rowOrder.splice(index, 0, ...rows.map(row => row.id));
			for (const row of rows) {
				const cells = operation.cells[row.id];
				if (cells && Object.keys(cells).length > 0) {
					sheet.cells[row.id] = JSON.parse(JSON.stringify(cells)) as Record<string, PlotWorkbookCell>;
				}
			}
			break;
		}
		case 'removeRows': {
			const ids = new Set(operation.rows.map(row => row.id));
			sheet.rowOrder = sheet.rowOrder.filter(id => !ids.has(id));
			for (const id of ids) {
				delete sheet.rows[id];
				delete sheet.cells[id];
			}
			break;
		}
		case 'swapRowBlocks':
			sheet.rowOrder = swapPlotWorkbookBlocks(sheet.rowOrder, operation.firstIds, operation.secondIds);
			break;
		case 'appendColumns':
			for (const column of operation.columns) {
				if (sheet.columns[column.id]) continue;
				sheet.columns[column.id] = { ...column };
				sheet.columnOrder.push(column.id);
			}
			break;
		case 'insertColumns': {
			const columns = operation.columns.filter(column => !sheet.columns[column.id]);
			const index = Math.max(0, Math.min(sheet.columnOrder.length, operation.index));
			for (const column of columns) sheet.columns[column.id] = { ...column };
			sheet.columnOrder.splice(index, 0, ...columns.map(column => column.id));
			for (const [rowId, cells] of Object.entries(operation.cells)) {
				if (!sheet.rows[rowId]) continue;
				const row = sheet.cells[rowId] ?? (sheet.cells[rowId] = {});
				for (const column of columns) {
					const cell = cells[column.id];
					if (cell) row[column.id] = { ...cell };
				}
			}
			break;
		}
		case 'removeColumns': {
			const ids = new Set(operation.columns.map(column => column.id));
			sheet.columnOrder = sheet.columnOrder.filter(id => !ids.has(id));
			for (const id of ids) delete sheet.columns[id];
			for (const [rowId, row] of Object.entries(sheet.cells)) {
				for (const id of ids) delete row[id];
				if (Object.keys(row).length === 0) delete sheet.cells[rowId];
			}
			break;
		}
		case 'swapColumnBlocks':
			sheet.columnOrder = swapPlotWorkbookBlocks(sheet.columnOrder, operation.firstIds, operation.secondIds);
			break;
		case 'setFrozenPanes': {
			const view = sheet.view ?? (sheet.view = {});
			if (operation.afterRows > 0) view.frozenRowCount = operation.afterRows;
			else delete view.frozenRowCount;
			if (operation.afterColumns > 0) view.frozenColumnCount = operation.afterColumns;
			else delete view.frozenColumnCount;
			if (!view.frozenRowCount && !view.frozenColumnCount
				&& view.rowHeaderWidth === undefined && view.columnHeaderHeight === undefined
				&& view.defaultRowHeight === undefined && view.defaultColumnWidth === undefined
				&& view.rowNumberStart === undefined) delete sheet.view;
			break;
		}
		case 'resizeHeaders': {
			const view = sheet.view ?? (sheet.view = {});
			view.rowHeaderWidth = operation.afterWidth;
			view.columnHeaderHeight = operation.afterHeight;
			break;
		}
		case 'setDefaultDimensions': {
			const view = sheet.view ?? (sheet.view = {});
			view.defaultRowHeight = operation.afterRowHeight;
			view.defaultColumnWidth = operation.afterColumnWidth;
			for (const change of operation.rowChanges) {
				const row = sheet.rows[change.rowId];
				if (!row) continue;
				if (change.after === undefined) delete row.height;
				else row.height = change.after;
			}
			for (const change of operation.columnChanges) {
				const column = sheet.columns[change.columnId];
				if (!column) continue;
				if (change.after === undefined) delete column.width;
				else column.width = change.after;
			}
			break;
		}
		case 'setRowNumberStart': {
			const view = sheet.view ?? (sheet.view = {});
			if (operation.after === 1) delete view.rowNumberStart;
			else view.rowNumberStart = operation.after;
			break;
		}
	}

	sheet.lastSeq = operation.seq;
}

function swapPlotWorkbookBlocks(order: string[], firstIds: string[], secondIds: string[]): string[] {
	const firstSet = new Set(firstIds);
	const secondSet = new Set(secondIds);
	if (firstSet.size === 0 || secondSet.size === 0) return order;
	for (const id of firstSet) if (secondSet.has(id)) return order;
	const first = order.filter(id => firstSet.has(id));
	const second = order.filter(id => secondSet.has(id));
	if (first.length !== firstSet.size || second.length !== secondSet.size) return order;
	const firstStart = order.indexOf(first[0]);
	const secondStart = order.indexOf(second[0]);
	if (firstStart < 0 || secondStart < 0) return order;
	const firstEnd = firstStart + first.length;
	const secondEnd = secondStart + second.length;
	if (!order.slice(firstStart, firstEnd).every(id => firstSet.has(id))
		|| !order.slice(secondStart, secondEnd).every(id => secondSet.has(id))) return order;
	if (firstStart < secondStart) {
		return [
			...order.slice(0, firstStart),
			...second,
			...order.slice(firstEnd, secondStart),
			...first,
			...order.slice(secondEnd),
		];
	}
	return [
		...order.slice(0, secondStart),
		...first,
		...order.slice(secondEnd, firstStart),
		...second,
		...order.slice(firstEnd),
	];
}

function setPlotWorkbookCell(sheet: PlotWorkbookSheet, rowId: string, columnId: string, value: string): void {
	if (value) {
		const row = sheet.cells[rowId] ?? (sheet.cells[rowId] = {});
		const existing = row[columnId];
		row[columnId] = existing ? { ...existing, value } : { type: 'text', value };
		return;
	}
	const row = sheet.cells[rowId];
	if (!row) return;
	const existing = row[columnId];
	if (existing?.style && Object.keys(existing.style).length > 0) row[columnId] = { ...existing, value: '' };
	else delete row[columnId];
	if (Object.keys(row).length === 0) delete sheet.cells[rowId];
}

function setPlotWorkbookCellStyle(
	sheet: PlotWorkbookSheet,
	rowId: string,
	columnId: string,
	style?: PlotWorkbookCellStyle,
): void {
	if (style && Object.keys(style).length > 0) {
		const row = sheet.cells[rowId] ?? (sheet.cells[rowId] = {});
		const existing = row[columnId];
		row[columnId] = {
			type: 'text',
			value: existing?.value ?? '',
			style: { ...style },
		};
		return;
	}
	const row = sheet.cells[rowId];
	if (!row?.[columnId]) return;
	const existing = row[columnId];
	if (existing.value) row[columnId] = { type: 'text', value: existing.value };
	else delete row[columnId];
	if (Object.keys(row).length === 0) delete sheet.cells[rowId];
}

export function columnLabel(index: number): string {
	let value = index + 1;
	let label = '';
	while (value > 0) {
		value--;
		label = String.fromCharCode(65 + (value % 26)) + label;
		value = Math.floor(value / 26);
	}
	return label;
}

