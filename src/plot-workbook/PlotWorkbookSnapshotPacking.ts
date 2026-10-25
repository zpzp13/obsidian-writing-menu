import { wmT } from '../i18n/index';
import type { PlotWorkbookCell, PlotWorkbookCellStyle, PlotWorkbookSheet, PlotWorkbookSnapshotData } from './PlotWorkbookTypes';

/** Pool repeated styles/cells and identical rows without dropping empty-cell formatting. */
interface PackedCells {
	encoding: 'cell-templates-v1';
	columnKeys: string[];
	styles: PlotWorkbookCellStyle[];
	templates: Array<Omit<PlotWorkbookCell, 'style'> & { style?: number }>;
	/** [first column index, number of consecutive cells, cell template index]. */
	patterns: Array<Array<[number, number, number]>>;
	rows: Array<[string, number]>;
}
type PackedSheet = Omit<PlotWorkbookSheet, 'cells'> & { cells: PackedCells };
export type PackedSnapshotData = Omit<PlotWorkbookSnapshotData, 'sheets'> & { sheets: PackedSheet[] };

// Packed files must not be able to expand into unbounded memory on import.
const MAX_EXPANDED_CELLS = 1_000_000;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const safeKey = (value: unknown): value is string => typeof value === 'string'
	&& /^[a-zA-Z0-9_-]{1,160}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);

export function packPlotSnapshotData(data: PlotWorkbookSnapshotData): PackedSnapshotData {
	let expandedCells = 0, expandedBytes = 0;
	const encoder = new TextEncoder();
	return { ...data, sheets: data.sheets.map(sheet => {
		const columnKeys = Object.keys(sheet.columns);
		const columnIndices = new Map(columnKeys.map((id, index) => [id, index]));
		const block: PackedCells = { encoding: 'cell-templates-v1', columnKeys, styles: [], templates: [], patterns: [], rows: [] };
		const styleIndices = new Map<string, number>();
		const templateIndices = new Map<string, number>();
		const templateSizes: number[] = [];
		const patternIndices = new Map<string, number>();
		for (const [rowId, cells] of Object.entries(sheet.cells)) {
			const runs: Array<[number, number, number]> = [];
			for (const [columnId, cell] of Object.entries(cells)) {
				const columnIndex = columnIndices.get(columnId);
				if (columnIndex === undefined) throw new Error(wmT("스냅샷에 등록되지 않은 열의 셀이 있습니다."));
				const template: Omit<PlotWorkbookCell, 'style'> & { style?: number } = { ...cell, style: undefined };
				if (cell.style !== undefined) {
					const key = JSON.stringify(cell.style);
					let index = styleIndices.get(key);
					if (index === undefined) {
						index = block.styles.length; styleIndices.set(key, index); block.styles.push(cell.style);
					}
					template.style = index;
				} else delete template.style;
				const key = JSON.stringify(template);
				let templateIndex = templateIndices.get(key);
				if (templateIndex === undefined) {
					templateIndex = block.templates.length; templateIndices.set(key, templateIndex); block.templates.push(template);
					templateSizes.push(encoder.encode(JSON.stringify(cell)).length + 180);
				}
				expandedCells++; expandedBytes += templateSizes[templateIndex];
				if (expandedCells > MAX_EXPANDED_CELLS || expandedBytes > MAX_EXPANDED_BYTES) throw new Error(wmT("복원할 데이터가 안전한 메모리 범위를 초과하여 스냅샷 저장을 중단했습니다."));
				const previous = runs[runs.length - 1];
				if (previous && previous[0] + previous[1] === columnIndex && previous[2] === templateIndex) previous[1]++;
				else runs.push([columnIndex, 1, templateIndex]);
			}
			const key = JSON.stringify(runs);
			let patternIndex = patternIndices.get(key);
			if (patternIndex === undefined) {
				patternIndex = block.patterns.length; patternIndices.set(key, patternIndex); block.patterns.push(runs);
			}
			block.rows.push([rowId, patternIndex]);
		}
		return { ...sheet, cells: block };
	}) };
}

export function unpackPlotSnapshotData(data: PackedSnapshotData): PlotWorkbookSnapshotData {
	if (!data || !Array.isArray(data.sheets)) throw new Error(wmT("스냅샷의 시트 목록이 올바르지 않습니다."));
	let totalCells = 0;
	let totalBytes = 0;
	let validatedPatternCells = 0;
	const fail = (): never => { throw new Error(wmT("스냅샷의 셀 복원 정보가 올바르지 않습니다.")); };
	return { ...data, sheets: data.sheets.map(sheet => {
		const block = sheet?.cells;
		if (!block || block.encoding !== 'cell-templates-v1' || !Array.isArray(block.columnKeys)
			|| !Array.isArray(block.styles) || !Array.isArray(block.templates) || !Array.isArray(block.patterns) || !Array.isArray(block.rows)
			|| !sheet.rows || !sheet.columns || new Set(block.columnKeys).size !== block.columnKeys.length
			|| block.columnKeys.some(id => !safeKey(id) || !Object.prototype.hasOwnProperty.call(sheet.columns, id))) fail();
		const serialized = block.templates.map(template => {
			if (!template || template.type !== 'text' || typeof template.value !== 'string') fail();
			const cell: PlotWorkbookCell = { ...template, style: undefined };
			if (template.style !== undefined) {
				if (!Number.isInteger(template.style) || template.style < 0 || template.style >= block.styles.length) fail();
				cell.style = block.styles[template.style];
				if (!cell.style || typeof cell.style !== 'object' || Array.isArray(cell.style)) fail();
			} else delete cell.style;
			return JSON.stringify(cell);
		});
		const lengths = serialized.map(value => new TextEncoder().encode(value).length);
		const patternSizes = block.patterns.map(pattern => {
			if (!Array.isArray(pattern)) fail();
			const columns = new Set<number>();
			let cells = 0, bytes = 0;
			for (const run of pattern) {
				if (!Array.isArray(run) || run.length !== 3 || !run.every(Number.isSafeInteger)) fail();
				const [start, count, template] = run;
				if (start < 0 || count < 1 || start + count > block.columnKeys.length || template < 0 || template >= serialized.length) fail();
				validatedPatternCells += count;
				if (validatedPatternCells > MAX_EXPANDED_CELLS) throw new Error(wmT("복원할 셀 패턴이 안전한 처리 범위를 초과합니다."));
				for (let column = start; column < start + count; column++) {
					if (columns.has(column)) fail(); columns.add(column);
				}
				cells += count;
				bytes += count * (lengths[template] + 180); // Include key/object overhead conservatively.
			}
			return { cells, bytes };
		});
		const rowIds = new Set<string>();
		// Validate the total expansion before constructing any large cell map.
		for (const row of block.rows) {
			if (!Array.isArray(row) || row.length !== 2 || !safeKey(row[0]) || rowIds.has(row[0]) || !Object.prototype.hasOwnProperty.call(sheet.rows, row[0])
				|| !Number.isInteger(row[1]) || row[1] < 0 || row[1] >= block.patterns.length) fail();
			rowIds.add(row[0]);
			totalCells += patternSizes[row[1]].cells;
			totalBytes += patternSizes[row[1]].bytes;
			if (totalCells > MAX_EXPANDED_CELLS || totalBytes > MAX_EXPANDED_BYTES) throw new Error(wmT("복원할 데이터가 안전한 메모리 범위를 초과합니다."));
		}
		const cells: PlotWorkbookSheet['cells'] = {};
		for (const [rowId, pattern] of block.rows) {
			const row: Record<string, PlotWorkbookCell> = {};
			for (const [start, count, template] of block.patterns[pattern]) for (let column = start; column < start + count; column++) {
				// Every cell/style gets its own object; later edits cannot affect neighbours.
				row[block.columnKeys[column]] = JSON.parse(serialized[template]) as PlotWorkbookCell;
			}
			cells[rowId] = row;
		}
		return { ...sheet, cells };
	}) };
}
