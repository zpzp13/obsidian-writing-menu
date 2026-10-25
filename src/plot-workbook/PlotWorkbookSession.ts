import { wmT } from '../i18n/index';
import {
	DEFAULT_PLOTBOOK_COLUMN_WIDTH,
	DEFAULT_PLOTBOOK_ROW_HEIGHT,
	MAX_PLOTBOOK_COLUMN_WIDTH,
	MAX_PLOTBOOK_ROW_HEIGHT,
	MIN_PLOTBOOK_COLUMN_WIDTH,
	MIN_PLOTBOOK_ROW_HEIGHT,
	applyPlotWorkbookOperation,
	newPlotWorkbookId,
	type PlotWorkbookColumn,
	type PlotWorkbookCell,
	type PlotWorkbookCellChange,
	type PlotWorkbookCellStyle,
	type PlotWorkbookCellStyleChange,
	type PlotWorkbookRowStyleChange,
	type PlotWorkbookColumnStyleChange,
	type PlotWorkbookLabel,
	type PlotWorkbookManifest,
	type PlotWorkbookOperation,
	type PlotWorkbookRow,
	type PlotWorkbookSheet,
	type PlotWorkbookColumnRole,
	type PlotWorkbookColumnStateChange,
	type PlotWorkbookStatus,
	type PlotWorkbookForeshadow,
	type PlotWorkbookForeshadowLocation,
	type PlotWorkbookCellSnapshot,
	type PlotWorkbookCellSnapshotRef,
	type PlotWorkbookRowDimensionChange,
	type PlotWorkbookColumnDimensionChange,
	type PlotWorkbookSnapshotData,
} from './PlotWorkbookTypes';
import { plotWorkbookStatusName, plotWorkbookStatuses, plotWorkbookStatusColor } from './PlotWorkbookStatus';
import { PlotWorkbookRepository } from './PlotWorkbookRepository';
import { isThemeAwareColor } from '../utils/themeColor';
import { appendChecklistTask, changeChecklistTask, normalizeChecklistValue, type ChecklistTask, type ChecklistChange } from './PlotWorkbookChecklist';

interface HistoryEntry {
	sheetId: string;
	undo: PlotWorkbookOperation | PlotWorkbookOperation[];
	redo: PlotWorkbookOperation | PlotWorkbookOperation[];
}

export type PlotWorkbookStylePatch = Partial<PlotWorkbookCellStyle>
	| ((current: PlotWorkbookCellStyle) => Partial<PlotWorkbookCellStyle>);

type PlotWorkbookOperationDraft = PlotWorkbookOperation extends infer Operation
	? Operation extends PlotWorkbookOperation
		? Omit<Operation, 'seq' | 'at' | 'sheetId'>
		: never
	: never;

export class PlotWorkbookSession {
	private listeners = new Set<() => void>();
	private undoStack: HistoryEntry[] = [];
	private redoStack: HistoryEntry[] = [];
	private snapshotBusy = false;
	private foreshadowLocationIndex: Map<string, PlotWorkbookForeshadow[]> | null = null;
	private readonly appearanceCache = new WeakMap<PlotWorkbookSheet, { seq: number; children: Map<string, string[]>; paths: Map<string, string[]> }>();

	constructor(
		readonly repository: PlotWorkbookRepository,
		readonly manifest: PlotWorkbookManifest,
		readonly sheets: Map<string, PlotWorkbookSheet>,
		readonly foreshadows: PlotWorkbookForeshadow[],
		readonly warnings: string[],
	) {}

	get activeSheet(): PlotWorkbookSheet {
		const sheet = this.sheets.get(this.manifest.activeSheetId);
		if (!sheet) throw new Error(wmT("활성 시트를 찾을 수 없습니다."));
		return sheet;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async selectSheet(sheetId: string): Promise<void> {
		this.assertEditable();
		if (!this.sheets.has(sheetId) || sheetId === this.manifest.activeSheetId) return;
		this.manifest.activeSheetId = sheetId;
		await this.repository.setActiveSheet(sheetId);
		this.emit();
	}

	async addSheet(): Promise<PlotWorkbookSheet> {
		this.assertEditable();
		const used = new Set(this.manifest.sheets.map(sheet => sheet.name));
		let index = this.manifest.sheets.length + 1;
		while (used.has(wmT('시트 {0}', index))) index++;
		const sheet = await this.repository.createSheet(wmT('시트 {0}', index));
		this.sheets.set(sheet.sheetId, sheet);
		this.manifest.activeSheetId = sheet.sheetId;
		this.emit();
		return sheet;
	}

	getCell(sheet: PlotWorkbookSheet, rowId: string, columnId: string): string {
		return sheet.cells[rowId]?.[columnId]?.value ?? '';
	}

	getCellStyle(sheet: PlotWorkbookSheet, rowId: string, columnId: string): PlotWorkbookCellStyle {
		return cloneCellStyle({
			...(sheet.columns[columnId]?.cellStyle ?? {}),
			...(sheet.rows[rowId]?.cellStyle ?? {}),
			...(sheet.cells[rowId]?.[columnId]?.style ?? {}),
		}) ?? {};
	}

	setCell(rowId: string, columnId: string, value: string): void {
		const sheet = this.activeSheet;
		if (sheet.columns[columnId]?.role === 'checklist') value = normalizeChecklistValue(value);
		if (!this.canSetCellValue(sheet, rowId, columnId, value)) return;
		const before = this.getCell(sheet, rowId, columnId);
		if (before === value || !sheet.rows[rowId] || !sheet.columns[columnId]) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'setCell', rowId, columnId, before, after: value, tx });
		const undo = this.makeOperation(sheet, { op: 'setCell', rowId, columnId, before: value, after: before, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	setCells(updates: Array<{ rowId: string; columnId: string; value: string }>): void {
		const sheet = this.activeSheet;
		const unique = new Map<string, { rowId: string; columnId: string; value: string }>();
		for (const update of updates) {
			if (!sheet.rows[update.rowId] || !sheet.columns[update.columnId]
				|| !this.canSetCellValue(sheet, update.rowId, update.columnId, update.value)) continue;
			unique.set(`${update.rowId}\u0000${update.columnId}`, sheet.columns[update.columnId].role === 'checklist'
				? { ...update, value:normalizeChecklistValue(update.value) } : update);
		}
		const changes: PlotWorkbookCellChange[] = [];
		for (const update of unique.values()) {
			const before = this.getCell(sheet, update.rowId, update.columnId);
			if (before === update.value) continue;
			changes.push({ ...update, before, after: update.value });
		}
		this.commitCellChanges(changes);
	}

	private commitCellChanges(changes: PlotWorkbookCellChange[]): void {
		if (changes.length === 0) return;
		const sheet = this.activeSheet;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'setCells', changes, tx });
		const undo = this.makeOperation(sheet, {
			op: 'setCells',
			changes: changes.map(change => ({ ...change, before: change.after, after: change.before })),
			tx,
		});
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	setCellStyles(
		targets: Array<{ rowId: string; columnId: string }>,
		patch: PlotWorkbookStylePatch,
	): void {
		const sheet = this.activeSheet;
		const unique = new Map<string, { rowId: string; columnId: string }>();
		for (const target of targets) {
			if (!sheet.rows[target.rowId] || !sheet.columns[target.columnId]) continue;
			unique.set(`${target.rowId}\u0000${target.columnId}`, target);
		}
		const changes: PlotWorkbookCellStyleChange[] = [];
		for (const target of unique.values()) {
			const before = cloneCellStyle(sheet.cells[target.rowId]?.[target.columnId]?.style);
			const after = mergeCellStylePatch(before, patch, this.getCellStyle(sheet, target.rowId, target.columnId));
			if (cellStylesEqual(before, after)) continue;
			changes.push({ ...target, before, after });
		}
		if (changes.length === 0) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'setCellStyles', changes, tx });
		const undo = this.makeOperation(sheet, {
			op: 'setCellStyles',
			changes: changes.map(change => ({
				rowId: change.rowId,
				columnId: change.columnId,
				before: change.after,
				after: change.before,
			})),
			tx,
		});
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	getRowHeaderStyle(rowId: string): PlotWorkbookCellStyle {
		return cloneCellStyle(this.activeSheet.rows[rowId]?.style) ?? {};
	}

	getColumnHeaderStyle(columnId: string): PlotWorkbookCellStyle {
		return cloneCellStyle(this.activeSheet.columns[columnId]?.style) ?? {};
	}

	setHeaderStyles(rowIds: string[], columnIds: string[], patch: PlotWorkbookStylePatch): void {
		const sheet = this.activeSheet;
		const rowChanges: PlotWorkbookRowStyleChange[] = [];
		for (const rowId of new Set(rowIds)) {
			const row = sheet.rows[rowId];
			if (!row) continue;
			const before = cloneCellStyle(row.style);
			const after = mergeCellStylePatch(before, patch);
			if (!cellStylesEqual(before, after)) rowChanges.push({ rowId, before, after });
		}
		const columnChanges: PlotWorkbookColumnStyleChange[] = [];
		for (const columnId of new Set(columnIds)) {
			const column = sheet.columns[columnId];
			if (!column) continue;
			const before = cloneCellStyle(column.style);
			const after = mergeCellStylePatch(before, patch);
			if (!cellStylesEqual(before, after)) columnChanges.push({ columnId, before, after });
		}
		if (rowChanges.length === 0 && columnChanges.length === 0) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'setHeaderStyles', rowChanges, columnChanges, tx });
		const undo = this.makeOperation(sheet, {
			op: 'setHeaderStyles',
			rowChanges: rowChanges.map(change => ({ rowId: change.rowId, before: change.after, after: change.before })),
			columnChanges: columnChanges.map(change => ({ columnId: change.columnId, before: change.after, after: change.before })),
			tx,
		});
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	setAxisCellStyles(rowIds: string[], columnIds: string[], patch: Partial<PlotWorkbookCellStyle>): void {
		const sheet = this.activeSheet;
		const rowChanges: PlotWorkbookRowStyleChange[] = [];
		for (const rowId of new Set(rowIds)) {
			const row = sheet.rows[rowId];
			if (!row) continue;
			const before = cloneCellStyle(row.cellStyle);
			const after = normalizeCellStyle({ ...(before ?? {}), ...patch });
			if (!cellStylesEqual(before, after)) rowChanges.push({ rowId, before, after });
		}
		const columnChanges: PlotWorkbookColumnStyleChange[] = [];
		for (const columnId of new Set(columnIds)) {
			const column = sheet.columns[columnId];
			if (!column) continue;
			const before = cloneCellStyle(column.cellStyle);
			const after = normalizeCellStyle({ ...(before ?? {}), ...patch });
			if (!cellStylesEqual(before, after)) columnChanges.push({ columnId, before, after });
		}
		if (rowChanges.length === 0 && columnChanges.length === 0) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'setAxisCellStyles', rowChanges, columnChanges, tx });
		const undo = this.makeOperation(sheet, {
			op: 'setAxisCellStyles',
			rowChanges: rowChanges.map(change => ({ rowId: change.rowId, before: change.after, after: change.before })),
			columnChanges: columnChanges.map(change => ({ columnId: change.columnId, before: change.after, after: change.before })),
			tx,
		});
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	setCellAndAxisStyles(
		targets: Array<{ rowId: string; columnId: string }>,
		rowIds: string[],
		columnIds: string[],
		patch: PlotWorkbookStylePatch,
	): void {
		const sheet = this.activeSheet;
		const cellChanges: PlotWorkbookCellStyleChange[] = [];
		const uniqueTargets = new Map<string, { rowId: string; columnId: string }>();
		for (const target of targets) {
			if (!sheet.rows[target.rowId] || !sheet.columns[target.columnId]) continue;
			uniqueTargets.set(`${target.rowId}\u0000${target.columnId}`, target);
		}
		for (const target of uniqueTargets.values()) {
			const before = cloneCellStyle(sheet.cells[target.rowId]?.[target.columnId]?.style);
			const after = mergeCellStylePatch(before, patch, this.getCellStyle(sheet, target.rowId, target.columnId));
			if (!cellStylesEqual(before, after)) cellChanges.push({ ...target, before, after });
		}
		const rowChanges: PlotWorkbookRowStyleChange[] = [];
		for (const rowId of new Set(rowIds)) {
			const row = sheet.rows[rowId];
			if (!row) continue;
			const before = cloneCellStyle(row.cellStyle);
			const after = mergeCellStylePatch(before, patch);
			if (!cellStylesEqual(before, after)) rowChanges.push({ rowId, before, after });
		}
		const columnChanges: PlotWorkbookColumnStyleChange[] = [];
		for (const columnId of new Set(columnIds)) {
			const column = sheet.columns[columnId];
			if (!column) continue;
			const before = cloneCellStyle(column.cellStyle);
			const after = mergeCellStylePatch(before, patch);
			if (!cellStylesEqual(before, after)) columnChanges.push({ columnId, before, after });
		}
		if (cellChanges.length === 0 && rowChanges.length === 0 && columnChanges.length === 0) return;
		const tx = newPlotWorkbookId('tx');
		const redoOperations: PlotWorkbookOperation[] = [];
		const undoOperations: PlotWorkbookOperation[] = [];
		if (cellChanges.length > 0) {
			const redo = this.makeOperation(sheet, { op: 'setCellStyles', changes: cellChanges, tx });
			const undo = this.makeOperation(sheet, {
				op: 'setCellStyles',
				changes: cellChanges.map(change => ({
					rowId: change.rowId,
					columnId: change.columnId,
					before: change.after,
					after: change.before,
				})),
				tx,
			});
			this.commit(redo);
			redoOperations.push(redo);
			undoOperations.unshift(undo);
		}
		if (rowChanges.length > 0 || columnChanges.length > 0) {
			const redo = this.makeOperation(sheet, { op: 'setAxisCellStyles', rowChanges, columnChanges, tx });
			const undo = this.makeOperation(sheet, {
				op: 'setAxisCellStyles',
				rowChanges: rowChanges.map(change => ({ rowId: change.rowId, before: change.after, after: change.before })),
				columnChanges: columnChanges.map(change => ({ columnId: change.columnId, before: change.after, after: change.before })),
				tx,
			});
			this.commit(redo, {
				sheetId: sheet.sheetId,
				undo: [undo, ...undoOperations],
				redo: [...redoOperations, redo],
			});
			return;
		}
		const redo = redoOperations[0];
		const undo = undoOperations[0];
		if (redo && undo) {
			this.undoStack.push({ sheetId: sheet.sheetId, undo, redo });
			this.redoStack = [];
			if (this.undoStack.length > 200) this.undoStack.shift();
			this.emit();
		}
	}

	swapCells(firstRowId: string, firstColumnId: string, secondRowId: string, secondColumnId: string): void {
		const sheet = this.activeSheet;
		if (firstRowId === secondRowId && firstColumnId === secondColumnId) return;
		const firstRole = sheet.columns[firstColumnId]?.role ?? 'text';
		const secondRole = sheet.columns[secondColumnId]?.role ?? 'text';
		if (firstRole === 'cast' || secondRole === 'cast') return;
		if ((firstRole === 'status' || firstRole === 'date' || secondRole === 'status' || secondRole === 'date')
			&& firstRole !== secondRole) return;
		const first = this.getCell(sheet, firstRowId, firstColumnId);
		const second = this.getCell(sheet, secondRowId, secondColumnId);
		this.setCells([
			{ rowId: firstRowId, columnId: firstColumnId, value: second },
			{ rowId: secondRowId, columnId: secondColumnId, value: first },
		]);
	}

	resizeRow(rowId: string, height?: number): void {
		const sheet = this.activeSheet;
		const row = sheet.rows[rowId];
		if (!row) return;
		const before = row.height;
		const after = height === undefined
			? undefined
			: Math.round(Math.max(MIN_PLOTBOOK_ROW_HEIGHT, Math.min(MAX_PLOTBOOK_ROW_HEIGHT, height)));
		if (before === after) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'resizeRow', rowId, before, after, tx });
		const undo = this.makeOperation(sheet, { op: 'resizeRow', rowId, before: after, after: before, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	resizeColumn(columnId: string, width?: number): void {
		const sheet = this.activeSheet;
		const column = sheet.columns[columnId];
		if (!column) return;
		const before = column.width;
		const after = width === undefined
			? undefined
			: Math.round(Math.max(MIN_PLOTBOOK_COLUMN_WIDTH, Math.min(MAX_PLOTBOOK_COLUMN_WIDTH, width)));
		if (before === after) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'resizeColumn', columnId, before, after, tx });
		const undo = this.makeOperation(sheet, { op: 'resizeColumn', columnId, before: after, after: before, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	renameColumn(columnId: string, title: string): void {
		const sheet = this.activeSheet;
		const column = sheet.columns[columnId];
		if (!column || column.role === 'cast' || column.role === 'status' || column.role === 'foreshadow') return;
		const before = column.title ?? '';
		const after = title.trim();
		if (before === after) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'renameColumn', columnId, before, after, tx });
		const undo = this.makeOperation(sheet, { op: 'renameColumn', columnId, before: after, after: before, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	setColumnRoles(columnIds: string[], role: PlotWorkbookColumnRole): void {
		const sheet = this.activeSheet;
		const changes = columnIds
			.filter(columnId => sheet.columns[columnId])
			.map(columnId => ({
				columnId,
				before: sheet.columns[columnId].role ?? 'text',
				after: role,
			}))
			.filter(change => change.before !== change.after);
		if (changes.length === 0) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'setColumnRoles', changes, tx });
		const undo = this.makeOperation(sheet, {
			op: 'setColumnRoles',
			changes: changes.map(change => ({ columnId: change.columnId, before: change.after, after: change.before })),
			tx,
		});
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	setColumnRole(columnIds: string[], role: PlotWorkbookColumnRole): void {
		const sheet = this.activeSheet;
		const changes: PlotWorkbookColumnStateChange[] = columnIds
			.filter(columnId => sheet.columns[columnId])
			.map(columnId => {
				const column = sheet.columns[columnId];
				return {
					columnId,
					before: column.role ?? 'text',
					after: role,
					beforeCharacterNotePath: column.characterNotePath,
					afterCharacterNotePath: role === 'character' ? column.characterNotePath : undefined,
					beforeLabelId: column.labelId,
					afterLabelId: column.labelId,
					beforeTrackingEnabled: column.trackingEnabled,
					afterTrackingEnabled: role === 'cast' ? undefined : column.trackingEnabled,
				};
			})
			.filter(change => change.before !== change.after
				|| change.beforeCharacterNotePath !== change.afterCharacterNotePath
				|| change.beforeTrackingEnabled !== change.afterTrackingEnabled);
		this.commitColumnStates(changes, this.statusValuesToTextChanges(changes));
	}

	assignCharacterColumn(columnId: string, notePath: string): void {
		const sheet = this.activeSheet;
		const column = sheet.columns[columnId];
		const path = notePath.trim();
		if (!column || !path) return;
		const changes: PlotWorkbookColumnStateChange[] = [{
			columnId,
			before: column.role ?? 'text',
			after: 'character',
			beforeCharacterNotePath: column.characterNotePath,
			afterCharacterNotePath: path,
			beforeLabelId: column.labelId,
			afterLabelId: column.labelId,
			beforeTrackingEnabled: column.trackingEnabled,
			afterTrackingEnabled: column.trackingEnabled,
		}];
		this.commitColumnStates(changes, this.statusValuesToTextChanges(changes));
	}

	relinkCharacterNote(beforePath: string, afterPath: string): void {
		for (const sheet of this.sheets.values()) {
			const changes: PlotWorkbookColumnStateChange[] = sheet.columnOrder
				.filter(columnId => sheet.columns[columnId]?.characterNotePath === beforePath)
				.map(columnId => ({
					columnId,
					before: sheet.columns[columnId].role ?? 'character',
					after: sheet.columns[columnId].role ?? 'character',
					beforeCharacterNotePath: beforePath,
					afterCharacterNotePath: afterPath,
					beforeLabelId: sheet.columns[columnId].labelId,
					afterLabelId: sheet.columns[columnId].labelId,
					beforeTrackingEnabled: sheet.columns[columnId].trackingEnabled,
					afterTrackingEnabled: sheet.columns[columnId].trackingEnabled,
				}));
			const appearanceChanges: PlotWorkbookCellChange[] = [];
			for (const rowId of sheet.rowOrder) {
				for (const columnId of sheet.columnOrder) {
					if (sheet.columns[columnId]?.role !== 'cast') continue;
					const before = this.getCell(sheet, rowId, columnId);
					const state = parseAppearanceState(before);
					if (!state.paths.includes(beforePath) && !state.excluded.includes(beforePath)) continue;
					const after = serializeAppearancePaths(
						state.paths.map(path => path === beforePath ? afterPath : path),
						state.excluded.map(path => path === beforePath ? afterPath : path),
					);
					appearanceChanges.push({ rowId, columnId, before, after });
				}
			}
			if (changes.length > 0 || appearanceChanges.length > 0) {
				this.commit(this.makeOperation(sheet, {
					op: 'setColumnStates',
					changes,
					cellChanges: appearanceChanges,
					tx: newPlotWorkbookId('tx'),
				}));
			}
			for (const rowId of sheet.rowOrder) {
				if (sheet.rows[rowId]?.linkedNotePath !== beforePath) continue;
				this.commit(this.makeOperation(sheet, {
					op: 'setRowLinkedNote',
					rowId,
					before: beforePath,
					after: afterPath,
					tx: newPlotWorkbookId('tx'),
				}));
			}
		}
	}

	setCastColumns(columnIds: string[]): void {
		const sheet = this.activeSheet;
		const selected = new Set(columnIds.filter(columnId => sheet.columns[columnId]));
		const changes: PlotWorkbookColumnStateChange[] = sheet.columnOrder
			.filter(columnId => selected.has(columnId))
			.map(columnId => {
				const column = sheet.columns[columnId];
				return {
					columnId,
					before: column.role ?? 'text',
					after: 'cast',
					beforeCharacterNotePath: column.characterNotePath,
					afterCharacterNotePath: undefined,
					beforeLabelId: column.labelId,
					afterLabelId: column.labelId,
					beforeTrackingEnabled: column.trackingEnabled,
					afterTrackingEnabled: undefined,
				};
			});
		const cellChanges: PlotWorkbookCellChange[] = [];
		for (const [rowId, row] of Object.entries(sheet.cells)) {
			for (const columnId of selected) {
				const before = row[columnId]?.value ?? '';
				if (before) cellChanges.push({ rowId, columnId, before, after: '' });
			}
		}
		this.commitColumnStates(changes, cellChanges);
	}

	getExplicitAppearancePaths(sheet: PlotWorkbookSheet, rowId: string, columnId: string): string[] {
		if (sheet.columns[columnId]?.role !== 'cast') return [];
		return parseAppearancePaths(this.getCell(sheet, rowId, columnId));
	}

	getAppearancePaths(sheet: PlotWorkbookSheet, rowId: string, columnId: string): string[] {
		if (sheet.columns[columnId]?.role !== 'cast' || !sheet.rows[rowId]) return [];
		let cache = this.appearanceCache.get(sheet);
		if (!cache || cache.seq !== sheet.lastSeq) {
			const children = new Map<string, string[]>();
			for (const id of sheet.rowOrder) {
				const parent = sheet.rows[id]?.parentRowId;
				if (parent) {
					const ids = children.get(parent) ?? [];
					ids.push(id);
					children.set(parent, ids);
				}
			}
			cache = { seq: sheet.lastSeq, children, paths: new Map() };
			this.appearanceCache.set(sheet, cache);
		}
		const key = JSON.stringify([rowId, columnId]);
		const cached = cache.paths.get(key);
		if (cached) return [...cached];
		const rowIds = sheet.rows[rowId].parentRowId
			? [rowId]
			: [rowId, ...(cache.children.get(rowId) ?? [])];
		const paths: string[] = [];
		const inheritedFromSubrows = new Set<string>();
		const excluded = new Set(parseAppearanceState(this.getCell(sheet, rowId, columnId)).excluded);
		const add = (path: string, inherited: boolean) => {
			const normalized = path.trim();
			if (!normalized) return;
			if (!paths.includes(normalized)) paths.push(normalized);
			if (inherited) inheritedFromSubrows.add(normalized);
		};
		for (const targetRowId of rowIds) {
			const inherited = targetRowId !== rowId;
			for (const path of this.getExplicitAppearancePaths(sheet, targetRowId, columnId)) add(path, inherited);
			for (const characterColumnId of sheet.columnOrder) {
				const column = sheet.columns[characterColumnId];
				if (column?.role === 'character' && column.characterNotePath
					&& this.getCell(sheet, targetRowId, characterColumnId).trim()) add(column.characterNotePath, inherited);
			}
		}
		const result = paths.filter(path => inheritedFromSubrows.has(path) || !excluded.has(path));
		cache.paths.set(key, result);
		return [...result];
	}

	setAppearancePaths(rowId: string, columnId: string, paths: string[]): void {
		const sheet = this.activeSheet;
		if (!sheet.rows[rowId] || sheet.columns[columnId]?.role !== 'cast') return;
		const before = this.getCell(sheet, rowId, columnId);
		const state = parseAppearanceState(before);
		const normalized = [...new Set(paths.map(path => path.trim()).filter(Boolean))];
		const after = serializeAppearancePaths(
			normalized,
			state.excluded.filter(path => !normalized.includes(path)),
		);
		if (before === after) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'setCell', rowId, columnId, before, after, tx });
		const undo = this.makeOperation(sheet, { op: 'setCell', rowId, columnId, before: after, after: before, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	removeAppearancePath(rowId: string, columnId: string, notePath: string): void {
		const sheet = this.activeSheet;
		if (!sheet.rows[rowId] || sheet.columns[columnId]?.role !== 'cast') return;
		const path = notePath.trim();
		if (!path) return;
		if (!sheet.rows[rowId].parentRowId && sheet.rowOrder.some(candidateRowId =>
			sheet.rows[candidateRowId]?.parentRowId === rowId
			&& this.getAppearancePaths(sheet, candidateRowId, columnId).includes(path))) return;
		const before = this.getCell(sheet, rowId, columnId);
		const state = parseAppearanceState(before);
		const after = serializeAppearancePaths(
			state.paths.filter(candidate => candidate !== path),
			[...state.excluded, path],
		);
		const changes: PlotWorkbookCellChange[] = before === after ? [] : [{ rowId, columnId, before, after }];
		for (const characterColumnId of sheet.columnOrder) {
			const column = sheet.columns[characterColumnId];
			if (column?.role !== 'character' || column.characterNotePath !== path) continue;
			const value = this.getCell(sheet, rowId, characterColumnId);
			if (value) changes.push({ rowId, columnId: characterColumnId, before: value, after: '' });
		}
		this.commitCellChanges(changes);
	}

	ensureCharacterColumn(notePath: string, afterColumnId: string): string | null {
		const sheet = this.activeSheet;
		const path = notePath.trim();
		if (!path) return null;
		const existing = sheet.columnOrder.find(columnId => {
			const column = sheet.columns[columnId];
			return column?.role === 'character' && column.characterNotePath === path;
		});
		if (existing) return existing;
		const anchorIndex = sheet.columnOrder.indexOf(afterColumnId);
		const [columnId] = this.insertColumns(anchorIndex >= 0 ? anchorIndex + 1 : sheet.columnOrder.length, 1);
		if (!columnId) return null;
		this.assignCharacterColumn(columnId, path);
		return columnId;
	}

	setRowLinkedNote(rowId: string, notePath?: string): boolean {
		const sheet = this.activeSheet;
		const row = sheet.rows[rowId];
		const after = notePath?.trim() || undefined;
		if (!row || row.parentRowId) return false;
		if (after && [...this.sheets.values()].some(candidate => candidate.rowOrder.some(candidateRowId =>
			candidateRowId !== rowId && candidate.rows[candidateRowId]?.linkedNotePath === after))) return false;
		const before = row.linkedNotePath;
		if (before === after) return true;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'setRowLinkedNote', rowId, before, after, tx });
		const undo = this.makeOperation(sheet, { op: 'setRowLinkedNote', rowId, before: after, after: before, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
		return true;
	}

	setRowNumberStart(start: number): void {
		const sheet = this.activeSheet;
		const before = sheet.view?.rowNumberStart ?? 1;
		const after = Math.max(0, Math.round(start));
		if (before === after) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'setRowNumberStart', before, after, tx });
		const undo = this.makeOperation(sheet, { op: 'setRowNumberStart', before: after, after: before, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	setStructuredColumns(columnIds: string[], role: 'status' | 'date' | 'foreshadow' | 'checklist'): void {
		const sheet = this.activeSheet;
		const selected = new Set(columnIds.filter(columnId =>
			sheet.columns[columnId] && (sheet.columns[columnId].role ?? 'text') !== role));
		const changes: PlotWorkbookColumnStateChange[] = sheet.columnOrder
			.filter(columnId => selected.has(columnId))
			.map(columnId => {
				const column = sheet.columns[columnId];
				return {
					columnId,
					before: column.role ?? 'text',
					after: role,
					beforeTitle: column.title,
					afterTitle: role === 'status' ? wmT('상태') : role === 'foreshadow' ? wmT('복선') : role === 'checklist' ? (column.title || wmT('체크리스트')) : (column.title || wmT('날짜')),
					beforeCharacterNotePath: column.characterNotePath,
					afterCharacterNotePath: undefined,
					beforeLabelId: column.labelId,
					afterLabelId: column.labelId,
					beforeTrackingEnabled: column.trackingEnabled,
					afterTrackingEnabled: undefined,
				};
			});
		const cellChanges: PlotWorkbookCellChange[] = [];
		for (const [rowId, row] of Object.entries(sheet.cells)) {
			for (const columnId of selected) {
				const before = row[columnId]?.value ?? '';
				if (before) cellChanges.push({ rowId, columnId, before, after: '' });
			}
		}
		this.commitColumnStates(changes, cellChanges);
	}

	addChecklistTask(sheetId: string, rowId: string, columnId: string, text: string): boolean {
		const sheet = this.activeSheet;
		if (sheet.sheetId !== sheetId || !sheet.rows[rowId] || sheet.columns[columnId]?.role !== 'checklist') return false;
		const value = this.getCell(sheet, rowId, columnId);
		const next = appendChecklistTask(value, text);
		if (next === value) return false;
		this.setCell(rowId, columnId, next);
		return true;
	}

	changeChecklistTask(sheetId: string, rowId: string, columnId: string, task: ChecklistTask, change: ChecklistChange): boolean {
		const sheet = this.activeSheet;
		if (sheet.sheetId !== sheetId || !sheet.rows[rowId] || sheet.columns[columnId]?.role !== 'checklist') return false;
		const value = this.getCell(sheet, rowId, columnId);
		const next = changeChecklistTask(value, task, change);
		if (next === null) return false;
		if (next !== value) this.setCell(rowId, columnId, next);
		return true;
	}

	setColumnTracking(columnIds: string[], enabled: boolean): void {
		const sheet = this.activeSheet;
		const changes: PlotWorkbookColumnStateChange[] = columnIds
			.filter(columnId => sheet.columns[columnId] && sheet.columns[columnId].role !== 'cast')
			.map(columnId => {
				const column = sheet.columns[columnId];
				return {
					columnId,
					before: column.role ?? 'text',
					after: column.role ?? 'text',
					beforeCharacterNotePath: column.characterNotePath,
					afterCharacterNotePath: column.characterNotePath,
					beforeLabelId: column.labelId,
					afterLabelId: column.labelId,
					beforeTrackingEnabled: column.trackingEnabled,
					afterTrackingEnabled: enabled ? true : undefined,
				};
			})
			.filter(change => change.beforeTrackingEnabled !== change.afterTrackingEnabled);
		this.commitColumnStates(changes);
	}

	setColumnLabel(columnIds: string[], labelId?: string): void {
		const sheet = this.activeSheet;
		const validLabelId = labelId && this.manifest.labels?.some(label => label.id === labelId)
			? labelId
			: undefined;
		const changes: PlotWorkbookColumnStateChange[] = columnIds
			.filter(columnId => sheet.columns[columnId])
			.map(columnId => {
				const column = sheet.columns[columnId];
				return {
					columnId,
					before: column.role ?? 'text',
					after: column.role ?? 'text',
					beforeCharacterNotePath: column.characterNotePath,
					afterCharacterNotePath: column.characterNotePath,
					beforeLabelId: column.labelId,
					afterLabelId: validLabelId,
					beforeTrackingEnabled: column.trackingEnabled,
					afterTrackingEnabled: column.trackingEnabled,
				};
			})
			.filter(change => change.beforeLabelId !== change.afterLabelId);
		this.commitColumnStates(changes);
	}

	async addLabel(name: string, color: string): Promise<PlotWorkbookLabel | null> {
		this.assertEditable();
		const cleanName = name.trim();
		if (!cleanName) return null;
		const cleanColor = /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : '#7c8cf8';
		const label: PlotWorkbookLabel = {
			id: newPlotWorkbookId('label'),
			name: cleanName,
			color: cleanColor,
		};
		(this.manifest.labels ?? (this.manifest.labels = [])).push(label);
		await this.repository.saveManifestState();
		this.emit();
		return label;
	}

	getStatuses(): PlotWorkbookStatus[] {
		return plotWorkbookStatuses(this.manifest.statuses);
	}

	refreshStatusSettings(statuses: PlotWorkbookStatus[] | undefined): void {
		this.assertEditable();
		this.manifest.statuses = statuses?.map(status => ({ ...status }));
		this.emit();
	}

	statusDisplayName(statusId: string): string {
		const status = plotWorkbookStatuses(this.manifest.statuses, true).find(item => item.id === statusId);
		return status ? plotWorkbookStatusName(status) : statusId;
	}

	statusName(statusId: string): string {
		return plotWorkbookStatuses(this.manifest.statuses, true).find(status => status.id === statusId)?.name ?? statusId;
	}

	statusColor(statusId: string): string {
		return plotWorkbookStatusColor(statusId, this.manifest.statuses?.find(status => status.id === statusId)?.color);
	}

	async setStatusColor(id: string, color?: string): Promise<boolean> {
		const status = this.getStatuses().find(item => item.id === id);
		if (!status || (color !== undefined && !/^#[0-9a-f]{6}$/i.test(color))) return false;
		const next = { ...status };
		if (color === undefined) delete next.color;
		else next.color = color;
		return this.saveStatusOverride(next);
	}

	async renameStatus(id: string, name: string): Promise<boolean> {
		const cleanName = name.trim();
		const status = this.getStatuses().find(item => item.id === id);
		if (!status || !cleanName || this.getStatuses().some(item => item.id !== id
			&& item.name.toLocaleLowerCase('ko-KR') === cleanName.toLocaleLowerCase('ko-KR'))) return false;
		return this.saveStatusOverride({ ...status, name: cleanName });
	}

	async deleteStatus(id: string): Promise<boolean> {
		const status = this.getStatuses().find(item => item.id === id);
		return status ? this.saveStatusOverride({ ...status, hidden: true }) : false;
	}

	private async saveStatusOverride(status: PlotWorkbookStatus): Promise<boolean> {
		this.assertEditable();
		const previous = this.manifest.statuses;
		this.manifest.statuses = [...(previous ?? []).filter(item => item.id !== status.id), status];
		try { await this.repository.saveManifestState(); }
		catch (error) { this.manifest.statuses = previous; throw error; }
		this.emit();
		return true;
	}

	async addStatus(name: string): Promise<PlotWorkbookStatus | null> {
		const cleanName = name.trim();
		if (!cleanName) return null;
		const existing = this.getStatuses().find(status => status.name.toLocaleLowerCase('ko-KR') === cleanName.toLocaleLowerCase('ko-KR'));
		if (existing) return existing;
		const status = { id: newPlotWorkbookId('status'), name: cleanName };
		await this.saveStatusOverride(status);
		return status;
	}

	listForeshadows(): PlotWorkbookForeshadow[] {
		return [...this.foreshadows]
			.sort((left, right) => {
				if (left.status !== right.status) return left.status === 'open' ? -1 : 1;
				return right.updatedAt - left.updatedAt;
			});
	}

	foreshadowsAt(location: PlotWorkbookForeshadowLocation): PlotWorkbookForeshadow[] {
		if (!this.foreshadowLocationIndex) {
			this.foreshadowLocationIndex = new Map();
			for (const item of this.foreshadows) {
				const keys = new Set([...item.plantedAt, ...item.resolvedAt].flatMap(point => [
					foreshadowLocationKey(point), JSON.stringify([point.sheetId, point.rowId]),
				]));
				for (const key of keys) {
					const entries = this.foreshadowLocationIndex.get(key) ?? [];
					entries.push(item);
					this.foreshadowLocationIndex.set(key, entries);
				}
			}
		}
		return [...(this.foreshadowLocationIndex.get(foreshadowLocationKey(location)) ?? [])]
			.sort((left, right) => left.status === right.status ? right.updatedAt - left.updatedAt : left.status === 'open' ? -1 : 1);
	}

	foreshadowsInRow(sheetId: string, rowId: string): PlotWorkbookForeshadow[] {
		if (!this.foreshadowLocationIndex) this.foreshadowsAt({ sheetId, rowId, columnId: '' });
		return [...(this.foreshadowLocationIndex?.get(JSON.stringify([sheetId, rowId])) ?? [])];
	}

	async createForeshadow(
		title: string,
		note = '',
		plantedAt?: PlotWorkbookForeshadowLocation,
		resolvedAt?: PlotWorkbookForeshadowLocation,
		status: 'open' | 'resolved' = 'open',
	): Promise<PlotWorkbookForeshadow | null> {
		this.assertEditable();
		const cleanTitle = title.trim();
		if (!cleanTitle) return null;
		if ((plantedAt && !this.validForeshadowLocation(plantedAt))
			|| (resolvedAt && !this.validForeshadowLocation(resolvedAt))
			|| !this.isForeshadowRouteInOrder(plantedAt, resolvedAt)) return null;
		const now = Date.now();
		const location = plantedAt && this.validForeshadowLocation(plantedAt) ? { ...plantedAt } : null;
		const payoff = resolvedAt && this.validForeshadowLocation(resolvedAt) ? { ...resolvedAt } : null;
		const foreshadow: PlotWorkbookForeshadow = {
			id: newPlotWorkbookId('foreshadow'),
			title: cleanTitle,
			note: note.trim() || undefined,
			status: payoff ? status : 'open',
			plantedAt: location ? [location] : [],
			resolvedAt: payoff ? [payoff] : [],
			createdAt: now,
			updatedAt: now,
		};
		this.foreshadows.push(foreshadow);
		this.foreshadowLocationIndex = null;
		await this.repository.saveForeshadowsState(this.foreshadows);
		this.emit();
		return foreshadow;
	}

	async saveForeshadowDetail(id: string, detail: {
		title: string;
		note: string;
		plant: PlotWorkbookForeshadowLocation;
		payoff?: PlotWorkbookForeshadowLocation;
		status: 'open' | 'resolved';
	}): Promise<boolean> {
		this.assertEditable();
		const item = this.foreshadows.find(candidate => candidate.id === id);
		if (!item || !detail.title.trim() || !this.validForeshadowLocation(detail.plant)
			|| (detail.payoff && !this.validForeshadowLocation(detail.payoff))
			|| !this.isForeshadowRouteInOrder(detail.plant, detail.payoff)
			|| (detail.status === 'resolved' && !detail.payoff)) return false;
		item.title = detail.title.trim();
		item.note = detail.note.trim() || undefined;
		item.plantedAt = [{ ...detail.plant }];
		item.resolvedAt = detail.payoff ? [{ ...detail.payoff }] : [];
		item.status = detail.status;
		item.updatedAt = Date.now();
		this.foreshadowLocationIndex = null;
		await this.repository.saveForeshadowsState(this.foreshadows);
		this.emit();
		return true;
	}

	rowLabels(sheet: PlotWorkbookSheet): Map<string, string> {
		const labels = new Map<string, string>();
		const mainNumbers = new Map<string, number>();
		let mainNumber = (sheet.view?.rowNumberStart ?? 1) - 1;
		for (const rowId of sheet.rowOrder) {
			const row = sheet.rows[rowId];
			if (!row.parentRowId || !sheet.rows[row.parentRowId]) {
				mainNumbers.set(rowId, ++mainNumber);
				labels.set(rowId, String(mainNumber));
			}
		}
		const childNumbers = new Map<string, number>();
		for (const rowId of sheet.rowOrder) {
			const parentId = sheet.rows[rowId]?.parentRowId;
			if (!parentId || !mainNumbers.has(parentId)) continue;
			const number = (childNumbers.get(parentId) ?? 0) + 1;
			childNumbers.set(parentId, number);
			labels.set(rowId, `${mainNumbers.get(parentId)}-${number}`);
		}
		return labels;
	}

	async addForeshadowPlant(id: string, location: PlotWorkbookForeshadowLocation): Promise<void> {
		this.assertEditable();
		const foreshadow = this.foreshadows.find(item => item.id === id);
		if (!foreshadow || !this.validForeshadowLocation(location)
			|| !this.isForeshadowRouteInOrder(location, foreshadow.resolvedAt[foreshadow.resolvedAt.length - 1])) return;
		if (foreshadow.plantedAt.length === 1
			&& sameForeshadowLocation(foreshadow.plantedAt[0], location)) return;
		// The arrays remain in the persisted v1 format for compatibility, but the
		// current workflow has one setup point and one payoff point per foreshadow.
		foreshadow.plantedAt = [{ ...location }];
		foreshadow.updatedAt = Date.now();
		this.foreshadowLocationIndex = null;
		await this.repository.saveForeshadowsState(this.foreshadows);
		this.emit();
	}

	async removeForeshadowPlant(id: string, location: PlotWorkbookForeshadowLocation): Promise<void> {
		this.assertEditable();
		const foreshadow = this.foreshadows.find(item => item.id === id);
		if (!foreshadow) return;
		if (!foreshadow.plantedAt.some(candidate => sameForeshadowLocation(candidate, location))) return;
		foreshadow.plantedAt = [];
		foreshadow.updatedAt = Date.now();
		this.foreshadowLocationIndex = null;
		await this.repository.saveForeshadowsState(this.foreshadows);
		this.emit();
	}

	async resolveForeshadow(id: string, location: PlotWorkbookForeshadowLocation): Promise<void> {
		this.assertEditable();
		const foreshadow = this.foreshadows.find(item => item.id === id);
		if (!foreshadow || !this.validForeshadowLocation(location)
			|| !this.isForeshadowRouteInOrder(foreshadow.plantedAt[foreshadow.plantedAt.length - 1], location)) return;
		foreshadow.resolvedAt = [{ ...location }];
		foreshadow.status = 'resolved';
		foreshadow.updatedAt = Date.now();
		this.foreshadowLocationIndex = null;
		await this.repository.saveForeshadowsState(this.foreshadows);
		this.emit();
	}

	async removeForeshadowResolution(id: string, location: PlotWorkbookForeshadowLocation): Promise<void> {
		this.assertEditable();
		const foreshadow = this.foreshadows.find(item => item.id === id);
		if (!foreshadow) return;
		if (!foreshadow.resolvedAt.some(candidate => sameForeshadowLocation(candidate, location))) return;
		foreshadow.resolvedAt = [];
		foreshadow.status = 'open';
		foreshadow.updatedAt = Date.now();
		this.foreshadowLocationIndex = null;
		await this.repository.saveForeshadowsState(this.foreshadows);
		this.emit();
	}

	async updateForeshadow(id: string, title: string, note = ''): Promise<void> {
		this.assertEditable();
		const foreshadow = this.foreshadows.find(item => item.id === id);
		const cleanTitle = title.trim();
		if (!foreshadow || !cleanTitle) return;
		foreshadow.title = cleanTitle;
		foreshadow.note = note.trim() || undefined;
		foreshadow.updatedAt = Date.now();
		this.foreshadowLocationIndex = null;
		await this.repository.saveForeshadowsState(this.foreshadows);
		this.emit();
	}

	async deleteForeshadow(id: string): Promise<void> {
		this.assertEditable();
		const index = this.foreshadows.findIndex(item => item.id === id);
		if (index < 0) return;
		this.foreshadows.splice(index, 1);
		this.foreshadowLocationIndex = null;
		await this.repository.saveForeshadowsState(this.foreshadows);
		this.emit();
	}

	isForeshadowRouteInOrder(plant?: PlotWorkbookForeshadowLocation, payoff?: PlotWorkbookForeshadowLocation): boolean {
		// A sheet's actual row order includes subrows (1, 1-1, 1-2, 2, ...).
		// Separate sheets have no shared timeline; retain existing cross-sheet data.
		if (!plant || !payoff || plant.sheetId !== payoff.sheetId) return true;
		const sheet = this.sheets.get(plant.sheetId);
		if (!sheet) return false;
		const plantIndex = sheet.rowOrder.indexOf(plant.rowId);
		return plantIndex >= 0 && sheet.rowOrder.indexOf(payoff.rowId) >= plantIndex;
	}

	private validForeshadowLocation(location: PlotWorkbookForeshadowLocation): boolean {
		const sheet = this.sheets.get(location.sheetId);
		return Boolean(sheet?.rows[location.rowId] && sheet.columns[location.columnId]?.role === 'plot');
	}

	async createCellSnapshots(
		targets: Array<{ rowId: string; columnId: string; label?: string }>,
		title: string,
	): Promise<number> {
		this.assertEditable();
		const sheet = this.activeSheet;
		const cleanTitle = title.trim();
		let count = 0;
		for (const target of targets) {
			this.assertEditable();
			if (!sheet.rows[target.rowId] || !sheet.columns[target.columnId]) continue;
			const value = this.getCell(sheet, target.rowId, target.columnId);
			if (!value) continue;
			const createdAt = Date.now();
			const snapshot: PlotWorkbookCellSnapshot = {
				id: newPlotWorkbookId('snapshot'),
				sheetId: sheet.sheetId,
				rowId: target.rowId,
				columnId: target.columnId,
				title: cleanTitle || target.label?.trim() || new Date(createdAt).toLocaleString('ko-KR'),
				createdAt,
				value,
			};
			await this.repository.createCellSnapshot(snapshot);
			count++;
		}
		this.emit();
		return count;
	}

	listCellSnapshots(sheetId: string, rowId: string, columnId: string): PlotWorkbookCellSnapshotRef[] {
		return (this.manifest.snapshots ?? [])
			.filter(snapshot => snapshot.sheetId === sheetId && snapshot.rowId === rowId && snapshot.columnId === columnId)
			.sort((left, right) => right.createdAt - left.createdAt);
	}

	readCellSnapshot(snapshotId: string): Promise<PlotWorkbookCellSnapshot | null> {
		return this.repository.readCellSnapshot(snapshotId);
	}

	renameCellSnapshot(snapshotId: string, title: string): Promise<void> {
		this.assertEditable();
		return this.repository.renameCellSnapshot(snapshotId, title).then(() => this.emit());
	}

	deleteCellSnapshot(snapshotId: string): Promise<void> {
		this.assertEditable();
		return this.repository.deleteCellSnapshot(snapshotId).then(() => this.emit());
	}

	private commitColumnStates(changes: PlotWorkbookColumnStateChange[], cellChanges: PlotWorkbookCellChange[] = []): void {
		if (changes.length === 0 && cellChanges.length === 0) return;
		const sheet = this.activeSheet;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'setColumnStates', changes, cellChanges, tx });
		const undo = this.makeOperation(sheet, {
			op: 'setColumnStates',
			changes: changes.map(change => ({
				columnId: change.columnId,
				before: change.after,
				after: change.before,
				...('afterTitle' in change || 'beforeTitle' in change ? {
					beforeTitle: change.afterTitle,
					afterTitle: change.beforeTitle,
				} : {}),
				beforeCharacterNotePath: change.afterCharacterNotePath,
				afterCharacterNotePath: change.beforeCharacterNotePath,
				beforeLabelId: change.afterLabelId,
				afterLabelId: change.beforeLabelId,
				beforeTrackingEnabled: change.afterTrackingEnabled,
				afterTrackingEnabled: change.beforeTrackingEnabled,
			})),
			cellChanges: cellChanges.map(change => ({ ...change, before: change.after, after: change.before })),
			tx,
		});
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	private statusValuesToTextChanges(changes: PlotWorkbookColumnStateChange[]): PlotWorkbookCellChange[] {
		const sheet = this.activeSheet;
		const columnIds = new Set(changes
			.filter(change => change.before === 'status' && change.after !== 'status')
			.map(change => change.columnId));
		if (columnIds.size === 0) return [];
		const result: PlotWorkbookCellChange[] = [];
		for (const [rowId, row] of Object.entries(sheet.cells)) {
			for (const columnId of columnIds) {
				const before = row[columnId]?.value ?? '';
				if (!before) continue;
				const after = this.statusName(before);
				if (after !== before) result.push({ rowId, columnId, before, after });
			}
		}
		return result;
	}

	setRowCollapsed(rowId: string, collapsed: boolean): void {
		const sheet = this.activeSheet;
		const row = sheet.rows[rowId];
		if (!row) return;
		const before = row.collapsed === true;
		if (before === collapsed) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'setRowCollapsed', rowId, before, after: collapsed, tx });
		const undo = this.makeOperation(sheet, { op: 'setRowCollapsed', rowId, before: collapsed, after: before, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	setColumnCollapsed(columnId: string, collapsed: boolean): void {
		const sheet = this.activeSheet;
		const column = sheet.columns[columnId];
		if (!column) return;
		const before = column.collapsed === true;
		if (before === collapsed) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'setColumnCollapsed', columnId, before, after: collapsed, tx });
		const undo = this.makeOperation(sheet, { op: 'setColumnCollapsed', columnId, before: collapsed, after: before, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	appendRows(count = 100): void {
		const sheet = this.activeSheet;
		const source = sheet.rows[sheet.rowOrder[sheet.rowOrder.length - 1]];
		const rows: PlotWorkbookRow[] = Array.from({ length: count }, () => ({
			id: newPlotWorkbookId('row'),
			...(source?.style ? { style: cloneCellStyle(source.style) } : {}),
			...(source?.cellStyle ? { cellStyle: cloneCellStyle(source.cellStyle) } : {}),
		}));
		this.commit(this.makeOperation(sheet, { op: 'appendRows', rows, tx: newPlotWorkbookId('tx') }));
	}

	insertRows(index: number, count = 1): string[] {
		const sheet = this.activeSheet;
		const target = Math.max(0, Math.min(sheet.rowOrder.length, Math.round(index)));
		const sourceRowId = sheet.rowOrder[Math.max(0, Math.min(sheet.rowOrder.length - 1, target > 0 ? target - 1 : target))];
		const rows: PlotWorkbookRow[] = Array.from({ length: Math.max(1, Math.round(count)) }, () => ({
			id: newPlotWorkbookId('row'),
			...(sourceRowId && sheet.rows[sourceRowId]?.style
				? { style: cloneCellStyle(sheet.rows[sourceRowId].style) }
				: {}),
			...(sourceRowId && sheet.rows[sourceRowId]?.cellStyle
				? { cellStyle: cloneCellStyle(sheet.rows[sourceRowId].cellStyle) }
				: {}),
		}));
		const cells: Record<string, Record<string, PlotWorkbookCell>> = {};
		if (sourceRowId) {
			for (const row of rows) {
				for (const columnId of sheet.columnOrder) {
					const style = normalizeCellStyle(this.getCellStyle(sheet, sourceRowId, columnId));
					if (style) (cells[row.id] ?? (cells[row.id] = {}))[columnId] = { type: 'text', value: '', style };
				}
			}
		}
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'insertRows', index: target, rows, cells, tx });
		const undo = this.makeOperation(sheet, { op: 'removeRows', index: target, rows, cells, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
		return rows.map(row => row.id);
	}

	addSubrow(rowId: string): string | null {
		const sheet = this.activeSheet;
		const source = sheet.rows[rowId];
		if (!source) return null;
		const parentRowId = source.parentRowId && sheet.rows[source.parentRowId]
			? source.parentRowId
			: rowId;
		const parentIndex = sheet.rowOrder.indexOf(parentRowId);
		if (parentIndex < 0) return null;
		let index = parentIndex + 1;
		while (index < sheet.rowOrder.length && sheet.rows[sheet.rowOrder[index]]?.parentRowId === parentRowId) index++;
		const row: PlotWorkbookRow = {
			id: newPlotWorkbookId('row'),
			parentRowId,
			...(source.style ? { style: cloneCellStyle(source.style) } : {}),
			...(source.cellStyle ? { cellStyle: cloneCellStyle(source.cellStyle) } : {}),
		};
		const rowCells: Record<string, PlotWorkbookCell> = {};
		for (const columnId of sheet.columnOrder) {
			const style = normalizeCellStyle(this.getCellStyle(sheet, rowId, columnId));
			if (style) rowCells[columnId] = { type: 'text', value: '', style };
		}
		const cells: Record<string, Record<string, PlotWorkbookCell>> = Object.keys(rowCells).length > 0
			? { [row.id]: rowCells }
			: {};
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'insertRows', index, rows: [row], cells, tx });
		const undo = this.makeOperation(sheet, { op: 'removeRows', index, rows: [row], cells, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
		return row.id;
	}

	deleteRows(requestedIds: string[]): boolean {
		const sheet = this.activeSheet;
		const selected = new Set(requestedIds.filter(id => sheet.rows[id]));
		for (const rowId of [...selected]) {
			if (sheet.rows[rowId]?.parentRowId) continue;
			for (const candidate of sheet.rowOrder) {
				if (sheet.rows[candidate]?.parentRowId === rowId) selected.add(candidate);
			}
		}
		const rowIds = sheet.rowOrder.filter(id => selected.has(id));
		if (rowIds.length === 0) return false;
		if (rowIds.length >= sheet.rowOrder.length) return false;
		const index = Math.min(...rowIds.map(id => sheet.rowOrder.indexOf(id)).filter(value => value >= 0));
		if (!Number.isFinite(index)) return false;
		const rows = rowIds.map(id => ({ ...sheet.rows[id] }));
		const cells: Record<string, Record<string, PlotWorkbookCell>> = {};
		for (const id of rowIds) {
			if (sheet.cells[id]) cells[id] = JSON.parse(JSON.stringify(sheet.cells[id])) as Record<string, PlotWorkbookCell>;
		}
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'removeRows', index, rows, cells, tx });
		const undo = this.makeOperation(sheet, { op: 'insertRows', index, rows, cells, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
		return true;
	}

	duplicateRows(requestedIds: string[]): string[] {
		const sheet = this.activeSheet;
		const selected = new Set(requestedIds.filter(id => sheet.rows[id]));
		for (const rowId of [...selected]) {
			if (sheet.rows[rowId]?.parentRowId) continue;
			for (const candidate of sheet.rowOrder) {
				if (sheet.rows[candidate]?.parentRowId === rowId) selected.add(candidate);
			}
		}
		const sourceIds = sheet.rowOrder.filter(id => selected.has(id));
		if (sourceIds.length === 0) return [];
		const remap = new Map(sourceIds.map(id => [id, newPlotWorkbookId('row')]));
		const rows: PlotWorkbookRow[] = sourceIds.map(id => {
			const source = sheet.rows[id];
			const parentRowId = source.parentRowId ? (remap.get(source.parentRowId) ?? source.parentRowId) : undefined;
			const duplicate = { ...source, id: remap.get(id)!, parentRowId };
			delete duplicate.linkedNotePath;
			return duplicate;
		});
		const cells: Record<string, Record<string, PlotWorkbookCell>> = {};
		for (const sourceId of sourceIds) {
			const targetId = remap.get(sourceId)!;
			if (sheet.cells[sourceId]) {
				cells[targetId] = JSON.parse(JSON.stringify(sheet.cells[sourceId])) as Record<string, PlotWorkbookCell>;
			}
		}
		const index = Math.max(...sourceIds.map(id => sheet.rowOrder.indexOf(id))) + 1;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'insertRows', index, rows, cells, tx });
		const undo = this.makeOperation(sheet, { op: 'removeRows', index, rows, cells, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
		return rows.map(row => row.id);
	}

	swapRowBlocks(firstIds: string[], secondIds: string[]): boolean {
		const sheet = this.activeSheet;
		const first = firstIds.filter(id => sheet.rows[id]);
		const second = secondIds.filter(id => sheet.rows[id]);
		if (first.length === 0 || second.length === 0 || first.some(id => second.includes(id))) return false;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'swapRowBlocks', firstIds: first, secondIds: second, tx });
		const undo = this.makeOperation(sheet, { op: 'swapRowBlocks', firstIds: first, secondIds: second, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
		return true;
	}

	swapColumnBlocks(firstIds: string[], secondIds: string[]): boolean {
		const sheet = this.activeSheet;
		const first = firstIds.filter(id => sheet.columns[id]);
		const second = secondIds.filter(id => sheet.columns[id]);
		if (first.length === 0 || second.length === 0 || first.some(id => second.includes(id))) return false;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'swapColumnBlocks', firstIds: first, secondIds: second, tx });
		const undo = this.makeOperation(sheet, { op: 'swapColumnBlocks', firstIds: first, secondIds: second, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
		return true;
	}

	setFrozenRows(count: number): void {
		const sheet = this.activeSheet;
		this.setFrozenPanes(Math.max(0, Math.min(sheet.rowOrder.length, Math.round(count))), sheet.view?.frozenColumnCount ?? 0);
	}

	setFrozenColumns(count: number): void {
		const sheet = this.activeSheet;
		this.setFrozenPanes(sheet.view?.frozenRowCount ?? 0, Math.max(0, Math.min(sheet.columnOrder.length, Math.round(count))));
	}

	resizeHeaders(width: number, height: number): void {
		const sheet = this.activeSheet;
		const beforeWidth = sheet.view?.rowHeaderWidth ?? 100;
		const beforeHeight = sheet.view?.columnHeaderHeight ?? 50;
		const afterWidth = Math.round(Math.max(36, Math.min(240, width)));
		const afterHeight = Math.round(Math.max(48, Math.min(120, height)));
		if (beforeWidth === afterWidth && beforeHeight === afterHeight) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, {
			op: 'resizeHeaders', beforeWidth, afterWidth, beforeHeight, afterHeight, tx,
		});
		const undo = this.makeOperation(sheet, {
			op: 'resizeHeaders', beforeWidth: afterWidth, afterWidth: beforeWidth,
			beforeHeight: afterHeight, afterHeight: beforeHeight, tx,
		});
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	getDefaultDimensions(): { rowHeight: number; columnWidth: number } {
		const sheet = this.activeSheet;
		return {
			rowHeight: sheet.view?.defaultRowHeight ?? DEFAULT_PLOTBOOK_ROW_HEIGHT,
			columnWidth: sheet.view?.defaultColumnWidth ?? DEFAULT_PLOTBOOK_COLUMN_WIDTH,
		};
	}

	setDefaultDimensions(rowHeight: number, columnWidth: number): void {
		const sheet = this.activeSheet;
		const beforeRowHeight = sheet.view?.defaultRowHeight ?? DEFAULT_PLOTBOOK_ROW_HEIGHT;
		const beforeColumnWidth = sheet.view?.defaultColumnWidth ?? DEFAULT_PLOTBOOK_COLUMN_WIDTH;
		const safeRowHeight = Number.isFinite(rowHeight) ? rowHeight : beforeRowHeight;
		const safeColumnWidth = Number.isFinite(columnWidth) ? columnWidth : beforeColumnWidth;
		const afterRowHeight = Math.round(Math.max(MIN_PLOTBOOK_ROW_HEIGHT, Math.min(MAX_PLOTBOOK_ROW_HEIGHT, safeRowHeight)));
		const afterColumnWidth = Math.round(Math.max(MIN_PLOTBOOK_COLUMN_WIDTH, Math.min(MAX_PLOTBOOK_COLUMN_WIDTH, safeColumnWidth)));
		const rowChanges: PlotWorkbookRowDimensionChange[] = sheet.rowOrder.map(rowId => ({
			rowId,
			before: sheet.rows[rowId]?.height,
			after: undefined,
		}));
		const columnChanges: PlotWorkbookColumnDimensionChange[] = sheet.columnOrder.map(columnId => ({
			columnId,
			before: sheet.columns[columnId]?.width,
			after: undefined,
		}));
		if (beforeRowHeight === afterRowHeight && beforeColumnWidth === afterColumnWidth
			&& rowChanges.every(change => change.before === undefined)
			&& columnChanges.every(change => change.before === undefined)) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, {
			op: 'setDefaultDimensions',
			beforeRowHeight,
			afterRowHeight,
			beforeColumnWidth,
			afterColumnWidth,
			rowChanges,
			columnChanges,
			tx,
		});
		const undo = this.makeOperation(sheet, {
			op: 'setDefaultDimensions',
			beforeRowHeight: afterRowHeight,
			afterRowHeight: beforeRowHeight,
			beforeColumnWidth: afterColumnWidth,
			afterColumnWidth: beforeColumnWidth,
			rowChanges: rowChanges.map(change => ({ rowId: change.rowId, before: change.after, after: change.before })),
			columnChanges: columnChanges.map(change => ({ columnId: change.columnId, before: change.after, after: change.before })),
			tx,
		});
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	async renameSheet(sheetId: string, name: string): Promise<void> {
		this.assertEditable();
		const ref = this.manifest.sheets.find(sheet => sheet.id === sheetId);
		const sheet = this.sheets.get(sheetId);
		const next = name.trim();
		if (!ref || !sheet || !next || ref.name === next) return;
		ref.name = next;
		sheet.name = next;
		await this.repository.saveManifestState();
		this.emit();
	}

	async deleteSheet(sheetId: string): Promise<boolean> {
		this.assertEditable();
		if (this.manifest.sheets.length <= 1) return false;
		const index = this.manifest.sheets.findIndex(sheet => sheet.id === sheetId);
		if (index < 0) return false;
		const sheet = this.sheets.get(sheetId);
		if (sheet) await this.repository.flushSheet(sheet);
		this.assertEditable();
		const [ref] = this.manifest.sheets.splice(index, 1);
		const deleted = this.manifest.deletedSheets ?? (this.manifest.deletedSheets = []);
		deleted.push({ ...ref, deletedAt: Date.now(), originalIndex: index });
		if (this.manifest.activeSheetId === sheetId) {
			this.manifest.activeSheetId = this.manifest.sheets[Math.min(index, this.manifest.sheets.length - 1)].id;
		}
		await this.repository.saveManifestState();
		this.emit();
		return true;
	}

	async restoreSheet(sheetId: string): Promise<boolean> {
		this.assertEditable();
		const deleted = this.manifest.deletedSheets ?? [];
		const index = deleted.findIndex(sheet => sheet.id === sheetId);
		if (index < 0 || !this.sheets.has(sheetId)) return false;
		const [ref] = deleted.splice(index, 1);
		const target = Math.max(0, Math.min(this.manifest.sheets.length, ref.originalIndex));
		this.manifest.sheets.splice(target, 0, { id: ref.id, name: ref.name });
		this.manifest.activeSheetId = ref.id;
		await this.repository.saveManifestState();
		this.emit();
		return true;
	}

	async permanentlyDeleteSheet(sheetId: string): Promise<boolean> {
		this.assertEditable();
		const deleted = this.manifest.deletedSheets ?? [];
		const index = deleted.findIndex(sheet => sheet.id === sheetId);
		if (index < 0) return false;
		const snapshotIds = (this.manifest.snapshots ?? [])
			.filter(snapshot => snapshot.sheetId === sheetId)
			.map(snapshot => snapshot.id);
		deleted.splice(index, 1);
		if (this.manifest.snapshots) {
			this.manifest.snapshots = this.manifest.snapshots
				.filter(snapshot => snapshot.sheetId !== sheetId);
		}
		let foreshadowsChanged = false;
		for (const item of this.foreshadows) {
			const plantedAt = item.plantedAt.filter(location => location.sheetId !== sheetId);
			const resolvedAt = item.resolvedAt.filter(location => location.sheetId !== sheetId);
			if (plantedAt.length === item.plantedAt.length && resolvedAt.length === item.resolvedAt.length) continue;
			item.plantedAt = plantedAt;
			item.resolvedAt = resolvedAt;
			item.status = item.status === 'resolved' && resolvedAt.length > 0 ? 'resolved' : 'open';
			item.updatedAt = Date.now();
			foreshadowsChanged = true;
		}
		await this.repository.saveManifestState();
		if (foreshadowsChanged) {
			this.foreshadowLocationIndex = null;
			await this.repository.saveForeshadowsState(this.foreshadows);
		}
		this.assertEditable();
		this.sheets.delete(sheetId);
		await this.repository.deleteSheetStorage(sheetId, snapshotIds);
		// Refresh the automatic previous copies as well so a later recovery does
		// not resurrect a permanently deleted sheet or its location references.
		await this.repository.saveManifestState();
		if (foreshadowsChanged) await this.repository.saveForeshadowsState(this.foreshadows);
		this.emit();
		return true;
	}

	appendColumns(count = 16): void {
		const sheet = this.activeSheet;
		const source = sheet.columns[sheet.columnOrder[sheet.columnOrder.length - 1]];
		const columns: PlotWorkbookColumn[] = Array.from({ length: count }, () => ({
			id: newPlotWorkbookId('column'),
			...(source?.style ? { style: cloneCellStyle(source.style) } : {}),
			...(source?.cellStyle ? { cellStyle: cloneCellStyle(source.cellStyle) } : {}),
		}));
		this.commit(this.makeOperation(sheet, { op: 'appendColumns', columns, tx: newPlotWorkbookId('tx') }));
	}

	insertColumns(index: number, count = 1): string[] {
		const sheet = this.activeSheet;
		const target = Math.max(0, Math.min(sheet.columnOrder.length, Math.round(index)));
		const sourceColumnId = sheet.columnOrder[Math.max(0, Math.min(sheet.columnOrder.length - 1, target > 0 ? target - 1 : target))];
		const columns: PlotWorkbookColumn[] = Array.from({ length: Math.max(1, Math.round(count)) }, () => ({
			id: newPlotWorkbookId('column'),
			...(sourceColumnId && sheet.columns[sourceColumnId]?.style
				? { style: cloneCellStyle(sheet.columns[sourceColumnId].style) }
				: {}),
			...(sourceColumnId && sheet.columns[sourceColumnId]?.cellStyle
				? { cellStyle: cloneCellStyle(sheet.columns[sourceColumnId].cellStyle) }
				: {}),
		}));
		const cells: Record<string, Record<string, PlotWorkbookCell>> = {};
		if (sourceColumnId) {
			for (const rowId of sheet.rowOrder) {
				const style = normalizeCellStyle(this.getCellStyle(sheet, rowId, sourceColumnId));
				if (!style) continue;
				for (const column of columns) {
					(cells[rowId] ?? (cells[rowId] = {}))[column.id] = { type: 'text', value: '', style: cloneCellStyle(style) };
				}
			}
		}
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'insertColumns', index: target, columns, cells, tx });
		const undo = this.makeOperation(sheet, { op: 'removeColumns', index: target, columns, cells, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
		return columns.map(column => column.id);
	}

	duplicateColumns(requestedIds: string[]): string[] {
		const sheet = this.activeSheet;
		const sourceIds = sheet.columnOrder.filter(id => requestedIds.includes(id));
		if (sourceIds.length === 0) return [];
		const remap = new Map(sourceIds.map(id => [id, newPlotWorkbookId('column')]));
		const columns: PlotWorkbookColumn[] = sourceIds.map(id => {
			const source = sheet.columns[id];
			return {
				...source,
				id: remap.get(id)!,
				title: source.title ? wmT('{0} 복사본', source.title) : undefined,
			};
		});
		const cells: Record<string, Record<string, PlotWorkbookCell>> = {};
		for (const [rowId, sourceRow] of Object.entries(sheet.cells)) {
			for (const sourceId of sourceIds) {
				const cell = sourceRow[sourceId];
				if (!cell) continue;
				const row = cells[rowId] ?? (cells[rowId] = {});
				row[remap.get(sourceId)!] = { ...cell };
			}
		}
		const index = Math.max(...sourceIds.map(id => sheet.columnOrder.indexOf(id))) + 1;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'insertColumns', index, columns, cells, tx });
		const undo = this.makeOperation(sheet, { op: 'removeColumns', index, columns, cells, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
		return columns.map(column => column.id);
	}

	deleteColumns(requestedIds: string[]): boolean {
		const sheet = this.activeSheet;
		const columnIds = sheet.columnOrder.filter(id => requestedIds.includes(id));
		if (columnIds.length === 0 || columnIds.length >= sheet.columnOrder.length) return false;
		const index = Math.min(...columnIds.map(id => sheet.columnOrder.indexOf(id)));
		const columns = columnIds.map(id => ({ ...sheet.columns[id] }));
		const cells: Record<string, Record<string, PlotWorkbookCell>> = {};
		for (const [rowId, sourceRow] of Object.entries(sheet.cells)) {
			for (const columnId of columnIds) {
				const cell = sourceRow[columnId];
				if (!cell) continue;
				const row = cells[rowId] ?? (cells[rowId] = {});
				row[columnId] = { ...cell };
			}
		}
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, { op: 'removeColumns', index, columns, cells, tx });
		const undo = this.makeOperation(sheet, { op: 'insertColumns', index, columns, cells, tx });
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
		return true;
	}

	async moveColumnsToSheet(requestedIds: string[], targetSheetId: string): Promise<boolean> {
		const source = this.activeSheet;
		const target = this.sheets.get(targetSheetId);
		if (!target || target.sheetId === source.sheetId) return false;
		const columnIds = source.columnOrder.filter(id => requestedIds.includes(id));
		if (columnIds.length === 0 || columnIds.length >= source.columnOrder.length) return false;

		const sourceIndex = Math.min(...columnIds.map(id => source.columnOrder.indexOf(id)));
		const targetIndex = target.columnOrder.length;
		const columns = columnIds.map(id => JSON.parse(JSON.stringify(source.columns[id])) as PlotWorkbookColumn);
		const sourceCells: Record<string, Record<string, PlotWorkbookCell>> = {};
		for (const [rowId, row] of Object.entries(source.cells)) {
			for (const columnId of columnIds) {
				const cell = row[columnId];
				if (!cell) continue;
				(sourceCells[rowId] ?? (sourceCells[rowId] = {}))[columnId] = JSON.parse(JSON.stringify(cell)) as PlotWorkbookCell;
			}
		}

		const extraCount = Math.max(0, source.rowOrder.length - target.rowOrder.length);
		const extraRows: PlotWorkbookRow[] = Array.from({ length: extraCount }, () => ({ id: newPlotWorkbookId('row') }));
		const targetRowOrder = [...target.rowOrder, ...extraRows.map(row => row.id)];
		const targetCells: Record<string, Record<string, PlotWorkbookCell>> = {};
		for (let rowIndex = 0; rowIndex < source.rowOrder.length; rowIndex++) {
			const sourceRow = source.cells[source.rowOrder[rowIndex]];
			const targetRowId = targetRowOrder[rowIndex];
			if (!sourceRow || !targetRowId) continue;
			for (const columnId of columnIds) {
				const cell = sourceRow[columnId];
				if (!cell) continue;
				(targetCells[targetRowId] ?? (targetCells[targetRowId] = {}))[columnId] = JSON.parse(JSON.stringify(cell)) as PlotWorkbookCell;
			}
		}

		const tx = newPlotWorkbookId('tx');
		let targetSeq = target.lastSeq;
		const redo: PlotWorkbookOperation[] = [];
		const undo: PlotWorkbookOperation[] = [];
		if (extraRows.length > 0) {
			redo.push({
				op: 'insertRows', index: target.rowOrder.length, rows: extraRows, cells: {}, tx,
				seq: ++targetSeq, at: Date.now(), sheetId: target.sheetId,
			});
		}
		redo.push({
			op: 'insertColumns', index: targetIndex, columns, cells: targetCells, tx,
			seq: ++targetSeq, at: Date.now(), sheetId: target.sheetId,
		});
		redo.push(this.makeOperation(source, {
			op: 'removeColumns', index: sourceIndex, columns, cells: sourceCells, tx,
		}));

		undo.push(this.makeOperation(source, {
			op: 'insertColumns', index: sourceIndex, columns, cells: sourceCells, tx,
		}));
		undo.push({
			op: 'removeColumns', index: targetIndex, columns, cells: targetCells, tx,
			seq: target.lastSeq + 1, at: Date.now(), sheetId: target.sheetId,
		});
		if (extraRows.length > 0) {
			undo.push({
				op: 'removeRows', index: target.rowOrder.length, rows: extraRows, cells: {}, tx,
				seq: target.lastSeq + 2, at: Date.now(), sheetId: target.sheetId,
			});
		}

		const targetRedo = redo.filter(operation => operation.sheetId === target.sheetId);
		const sourceRedo = redo.find(operation => operation.sheetId === source.sheetId);
		this.commitBatch(targetRedo);
		await this.repository.flushSheet(target);
		if (!sourceRedo) return false;
		this.commit(sourceRedo, { sheetId: source.sheetId, undo, redo });
		await this.repository.flushSheet(source);
		return true;
	}

	private setFrozenPanes(rows: number, columns: number): void {
		const sheet = this.activeSheet;
		const beforeRows = sheet.view?.frozenRowCount ?? 0;
		const beforeColumns = sheet.view?.frozenColumnCount ?? 0;
		if (beforeRows === rows && beforeColumns === columns) return;
		const tx = newPlotWorkbookId('tx');
		const redo = this.makeOperation(sheet, {
			op: 'setFrozenPanes', beforeRows, afterRows: rows, beforeColumns, afterColumns: columns, tx,
		});
		const undo = this.makeOperation(sheet, {
			op: 'setFrozenPanes', beforeRows: rows, afterRows: beforeRows, beforeColumns: columns, afterColumns: beforeColumns, tx,
		});
		this.commit(redo, { sheetId: sheet.sheetId, undo, redo });
	}

	undo(): void {
		this.assertEditable();
		const entry = this.undoStack.pop();
		if (!entry) return;
		this.commitReplayBatch(Array.isArray(entry.undo) ? entry.undo : [entry.undo]);
		this.redoStack.push(entry);
	}

	redo(): void {
		this.assertEditable();
		const entry = this.redoStack.pop();
		if (!entry) return;
		this.commitReplayBatch(Array.isArray(entry.redo) ? entry.redo : [entry.redo]);
		this.undoStack.push(entry);
	}

	get canUndo(): boolean { return this.undoStack.length > 0; }
	get canRedo(): boolean { return this.redoStack.length > 0; }

	async flush(): Promise<void> {
		await this.repository.flushAll(this.sheets.values());
	}

	/** A modal owns this short lock; no open view may mutate the transfer image. */
	async withSnapshot<T>(action: (data: PlotWorkbookSnapshotData) => Promise<T>): Promise<T> {
		this.assertEditable();
		this.snapshotBusy = true;
		try {
			await this.flush();
			const data = JSON.parse(JSON.stringify({
				manifest: this.manifest, sheets: [...this.sheets.values()], foreshadows: this.foreshadows, cellSnapshots: [],
			})) as PlotWorkbookSnapshotData;
			delete data.manifest.storageGeneration;
			for (const ref of data.manifest.snapshots ?? []) {
				const snapshot = await this.repository.readCellSnapshot(ref.id);
				if (!snapshot) throw new Error(wmT("셀 스냅샷이 누락되어 저장을 중단했습니다: {0}", ref.title));
				data.cellSnapshots.push(snapshot);
			}
			this.repository.validateSnapshotData(data);
			return await action(data);
		} finally { this.snapshotBusy = false; }
	}

	/** Must be called only inside withSnapshot, after the caller's backup succeeds. */
	async restoreSnapshot(data: PlotWorkbookSnapshotData): Promise<void> {
		if (!this.snapshotBusy) throw new Error(wmT("스냅샷 작업 잠금이 필요합니다."));
		await this.repository.restoreSnapshot(data);
		for (const key of Object.keys(this.manifest)) delete (this.manifest as unknown as Record<string, unknown>)[key];
		Object.assign(this.manifest, data.manifest);
		// Repository and views must continue sharing the same manifest object.
		this.repository.adoptManifest(this.manifest);
		this.sheets.clear();
		for (const sheet of data.sheets) this.sheets.set(sheet.sheetId, sheet);
		this.foreshadows.splice(0, this.foreshadows.length, ...data.foreshadows);
		this.foreshadowLocationIndex = null;
		this.undoStack = [];
		this.redoStack = [];
		this.emit();
	}

	private assertEditable(): void {
		if (this.repository.isRecoveryRequired) throw new Error(wmT("저장 목록을 확인할 수 없습니다. 플롯을 다시 열어 복구해주세요. 교체 전 백업은 보존되어 있습니다."));
		if (this.snapshotBusy) throw new Error(wmT("스냅샷을 처리하고 있습니다. 완료 후 다시 시도해주세요."));
	}

	dispose(): void {
		this.repository.dispose();
		this.listeners.clear();
	}

	private makeOperation<T extends PlotWorkbookOperation>(
		sheet: PlotWorkbookSheet,
		data: PlotWorkbookOperationDraft,
	): T {
		return {
			...data,
			seq: sheet.lastSeq + 1,
			at: Date.now(),
			sheetId: sheet.sheetId,
		} as T;
	}

	private commit(operation: PlotWorkbookOperation, history?: HistoryEntry): void {
		this.assertEditable();
		const sheet = this.sheets.get(operation.sheetId);
		if (!sheet) return;
		applyPlotWorkbookOperation(sheet, operation);
		this.repository.recordOperation(sheet, operation);
		if (history) {
			this.undoStack.push(history);
			this.redoStack = [];
			if (this.undoStack.length > 200) this.undoStack.shift();
		}
		this.emit();
	}

	private commitBatch(operations: PlotWorkbookOperation[], history?: HistoryEntry): void {
		this.assertEditable();
		for (const operation of operations) {
			const sheet = this.sheets.get(operation.sheetId);
			if (!sheet) continue;
			applyPlotWorkbookOperation(sheet, operation);
			this.repository.recordOperation(sheet, operation);
		}
		if (history) {
			this.undoStack.push(history);
			this.redoStack = [];
			if (this.undoStack.length > 200) this.undoStack.shift();
		}
		this.emit();
	}

	private commitReplay(sheet: PlotWorkbookSheet, template: PlotWorkbookOperation): void {
		const operation = {
			...template,
			seq: sheet.lastSeq + 1,
			at: Date.now(),
			tx: newPlotWorkbookId('tx'),
		};
		applyPlotWorkbookOperation(sheet, operation);
		this.repository.recordOperation(sheet, operation);
	}

	private commitReplayBatch(templates: PlotWorkbookOperation[]): void {
		for (const template of templates) {
			const sheet = this.sheets.get(template.sheetId);
			if (sheet) this.commitReplay(sheet, template);
		}
		this.emit();
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	private canSetCellValue(sheet: PlotWorkbookSheet, rowId: string, columnId: string, value: string): boolean {
		const role = sheet.columns[columnId]?.role ?? 'text';
		if (role === 'cast' || role === 'foreshadow') return value.length === 0;
		if (sheet.rows[rowId]?.parentRowId && (role === 'status' || role === 'date')) return value.length === 0;
		if (role === 'status') return !value || this.getStatuses().some(status => status.id === value);
		if (role === 'date') return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
		return true;
	}
}

interface AppearanceState {
	paths: string[];
	excluded: string[];
}

function sameForeshadowLocation(
	left: PlotWorkbookForeshadowLocation,
	right: PlotWorkbookForeshadowLocation,
): boolean {
	return left.sheetId === right.sheetId && left.rowId === right.rowId && left.columnId === right.columnId;
}

function foreshadowLocationKey(location: PlotWorkbookForeshadowLocation): string {
	return `${location.sheetId}\u0000${location.rowId}\u0000${location.columnId}`;
}

function normalizedAppearancePaths(value: unknown): string[] {
	return Array.isArray(value)
		? [...new Set(value.filter((item): item is string => typeof item === 'string')
			.map(item => item.trim()).filter(Boolean))]
		: [];
}

function parseAppearanceState(value: string): AppearanceState {
	if (!value.trim()) return { paths: [], excluded: [] };
	try {
		const parsed = JSON.parse(value) as unknown;
		if (Array.isArray(parsed)) return { paths: normalizedAppearancePaths(parsed), excluded: [] };
		if (!parsed || typeof parsed !== 'object') return { paths: [], excluded: [] };
		const state = parsed as { paths?: unknown; excluded?: unknown };
		return {
			paths: normalizedAppearancePaths(state.paths),
			excluded: normalizedAppearancePaths(state.excluded),
		};
	} catch {
		return { paths: [], excluded: [] };
	}
}

function parseAppearancePaths(value: string): string[] {
	return parseAppearanceState(value).paths;
}

function serializeAppearancePaths(paths: string[], excluded: string[] = []): string {
	const unique = [...new Set(paths.map(path => path.trim()).filter(Boolean))];
	const hidden = [...new Set(excluded.map(path => path.trim()).filter(path => path && !unique.includes(path)))];
	if (hidden.length > 0) return JSON.stringify({ paths: unique, excluded: hidden });
	return unique.length > 0 ? JSON.stringify(unique) : '';
}

export function plotRowHeight(sheet: PlotWorkbookSheet, rowId: string): number {
	if (sheet.rows[rowId]?.collapsed) return 10;
	const height = sheet.rows[rowId]?.height ?? sheet.view?.defaultRowHeight ?? DEFAULT_PLOTBOOK_ROW_HEIGHT;
	return sheet.columnOrder.some(columnId => sheet.columns[columnId]?.role === 'cast')
		? Math.max(38, height)
		: height;
}

export function plotColumnWidth(sheet: PlotWorkbookSheet, columnId: string): number {
	if (sheet.columns[columnId]?.collapsed) return 18;
	return sheet.columns[columnId]?.width ?? sheet.view?.defaultColumnWidth ?? DEFAULT_PLOTBOOK_COLUMN_WIDTH;
}

function normalizeCellStyle(style: Partial<PlotWorkbookCellStyle>): PlotWorkbookCellStyle | undefined {
	const normalized: PlotWorkbookCellStyle = {};
	if (typeof style.fontFamily === 'string' && style.fontFamily.trim() && style.fontFamily !== 'inherit') {
		normalized.fontFamily = style.fontFamily.trim();
	}
	if (typeof style.fontSize === 'number' && Number.isFinite(style.fontSize)) {
		normalized.fontSize = Math.max(4, Math.min(400, style.fontSize));
	}
	if (isThemeAwareColor(style.color)) {
		normalized.color = typeof style.color === 'string' ? style.color.trim() : { ...style.color };
	}
	if (isThemeAwareColor(style.backgroundColor)) {
		normalized.backgroundColor = typeof style.backgroundColor === 'string'
			? style.backgroundColor.trim()
			: { ...style.backgroundColor };
	}
	if (typeof style.bold === 'boolean') normalized.bold = style.bold;
	if (typeof style.italic === 'boolean') normalized.italic = style.italic;
	if (typeof style.underline === 'boolean') normalized.underline = style.underline;
	if (typeof style.strikethrough === 'boolean') normalized.strikethrough = style.strikethrough;
	if (style.alignment === 'left' || style.alignment === 'center' || style.alignment === 'right') {
		normalized.alignment = style.alignment;
	}
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function cloneCellStyle(style?: PlotWorkbookCellStyle): PlotWorkbookCellStyle | undefined {
	const normalized = style ? normalizeCellStyle(style) : undefined;
	return normalized ? { ...normalized } : undefined;
}

function mergeCellStylePatch(before: PlotWorkbookCellStyle | undefined, patch: PlotWorkbookStylePatch, effective = before ?? {}): PlotWorkbookCellStyle | undefined {
	return normalizeCellStyle({ ...(before ?? {}), ...(typeof patch === 'function' ? patch(effective) : patch) });
}

function cellStylesEqual(left?: PlotWorkbookCellStyle, right?: PlotWorkbookCellStyle): boolean {
	return JSON.stringify(normalizeCellStyle(left ?? {})) === JSON.stringify(normalizeCellStyle(right ?? {}));
}
