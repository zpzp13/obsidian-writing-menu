import { InfinitePlotSheet } from '../src/plot-workbook/InfinitePlotSheet';
import { PlotWorkbookSession } from '../src/plot-workbook/PlotWorkbookSession';
import { createPlotWorkbookSheet } from '../src/plot-workbook/PlotWorkbookTypes';

/** Measure the live cell input path, including layout reads, without writing vault files. */
export async function verifyPlotCellInput(plugin) {
	const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
	const host = document.body.createDiv({ cls: 'plot-test-host' });
	const sheet = createPlotWorkbookSheet('입력 성능', 2000, 10);
	const [rowId] = sheet.rowOrder, [columnId] = sheet.columnOrder;
	const repository = { recordOperation() {}, dispose() {}, async flushAll() {} };
	const session = new PlotWorkbookSession(repository, { activeSheetId: sheet.sheetId, sheets: [{ id: sheet.sheetId, name: sheet.name }] }, new Map([[sheet.sheetId, sheet]]), [], []);
	const grid = new InfinitePlotSheet(host, plugin, 'Project', '', '', session);
	clearTimeout(grid.frontmatterSyncTimer); grid.frontmatterSyncTimer = null; grid.scheduleFrontmatterSync = () => {};
	const metrics = [];
	try {
		for (const size of [5000, 50000]) {
			session.setCell(rowId, columnId, '긴 셀 내용과 줄바꿈을 확인합니다. '.repeat(Math.ceil(size / 21)).slice(0, size));
			await frame(); await frame();
			grid.select(0, 0, false); grid.beginEditingSelected();
			const editor = grid.editingCell;
			editor.setSelectionRange(editor.value.length, editor.value.length);
			let layoutReads = 0;
			const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight').get;
			Object.defineProperty(editor, 'scrollHeight', { configurable: true, get() { layoutReads++; return scrollHeight.call(this); } });
			const samples = [];
			const sequence = sheet.lastSeq;
			for (let burst = 0; burst < 12; burst++) {
				for (let input = 0; input < 4; input++) {
					editor.setRangeText('ㅇ', editor.value.length, editor.value.length, 'end');
					const start = performance.now();
					editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'ㅇ', inputType: 'insertText' }));
					samples.push(performance.now() - start);
				}
				await frame();
			}
			if (sheet.lastSeq !== sequence || !editor.isConnected) throw new Error('Typing saved or replaced the live cell editor');
			if (layoutReads > 12) throw new Error('Cell editor measured the entire textarea more than once per frame');
			metrics.push({ characters: size, inputs: samples.length, layoutReads, maxInputMs: +Math.max(...samples).toFixed(2), meanInputMs: +(samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(2) });
			delete editor.scrollHeight;
			editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
			await frame();
		}
		console.info('Cell editor input measurements', JSON.stringify(metrics));
		return metrics;
	} finally { grid.destroy(); session.dispose(); host.remove(); }
}
