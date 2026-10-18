import { InfinitePlotSheet } from '../src/plot-workbook/InfinitePlotSheet';
import { PlotWorkbookSession } from '../src/plot-workbook/PlotWorkbookSession';
import { createPlotWorkbookSheet } from '../src/plot-workbook/PlotWorkbookTypes';

// Used by CDP's trusted mouse/keyboard events; never touches a real vault.
export function installNativePlotSelectionChecks(plugin) {
	const assert = (condition,message) => {if (!condition) throw new Error(message);};
	const settle = () => new Promise(resolve=>setTimeout(resolve,45));
	let host, grid, session, sheet, drags, originalSequence;
	const dispose = () => {grid?.destroy(); host?.remove(); grid = null; host = null;};
	const mount = async zoom => {
		dispose();
		sheet = createPlotWorkbookSheet('선택 동작 검증',60,10);
		const source = '문장의 일부를 마우스로 선택할 수 있어야 합니다. '.repeat(60);
		for (const [row,column,value] of [[0,0,source],[1,0,source],[0,2,source],[0,1,'짧은 내용']]) {
			(sheet.cells[sheet.rowOrder[row]] ??= {})[sheet.columnOrder[column]] = {type:'text',value};
		}
		const repository = {recordOperation() {}};
		session = new PlotWorkbookSession(repository,{activeSheetId:sheet.sheetId,sheets:[{id:sheet.sheetId,name:sheet.name}]},new Map([[sheet.sheetId,sheet]]),[],[]);
		host = document.body.createDiv({cls:'plot-test-host'});
		host.setCssStyles({position:'fixed',top:'0',left:'0',zIndex:'2000',background:'white'});
		grid = new InfinitePlotSheet(host,plugin,'Project','','',session);
		clearTimeout(grid.frontmatterSyncTimer); grid.frontmatterSyncTimer = null; grid.scheduleFrontmatterSync = () => {};
		grid.setZoom(zoom); await settle();
		drags = 0; originalSequence = sheet.lastSeq;
		grid.canvas.addEventListener('dragstart',event=>{if(event.isTrusted) drags++;});
	};
	const point = (row,column) => {
		const bounds = grid.canvas.querySelector(`.wm-plotbook-cell[data-row="${row}"][data-column="${column}"]`).getBoundingClientRect();
		return {x:bounds.left + bounds.width / 2,y:bounds.top + bounds.height / 2};
	};
	globalThis.plotSelectionProbe = {
		async beginEditor(zoom) {
			await mount(zoom); grid.select(0,0,false); grid.refreshSelectionPreview(); grid.viewport.focus();
			assert(!grid.selectedCellPreview.hasClass('is-hidden'),'Editor test did not begin in preview mode');
			const bounds = grid.selectedCellPreview.getBoundingClientRect();
			return {x:bounds.left+70*zoom,y:bounds.top+16*zoom};
		},
		editorPoints(zoom) {
			const editor = grid.editingCell;
			assert(editor && !editor.parentElement.draggable && !grid.selectedCellPreview.draggable,'The edited cell or hidden preview is still draggable');
			const bounds = editor.getBoundingClientRect(), style = getComputedStyle(editor);
			const x = bounds.left + parseFloat(style.paddingLeft) * zoom + 12 * zoom;
			const y = bounds.top + (parseFloat(style.paddingTop) + parseFloat(style.fontSize) * .7) * zoom;
			return {from:{x,y},to:{x:x+65*zoom,y}};
		},
		editorSnapshot() {
			const editor = grid.editingCell;
			return {editing:Boolean(editor?.isConnected),focused:document.activeElement === editor,
				selected:editor ? editor.selectionEnd-editor.selectionStart : 0,drags,
				unchanged:sheet.lastSeq === originalSequence,cellDrag:Boolean(grid.dragSource)};
		},
		async beginRange(zoom,kind) {
			await mount(zoom);
			const from = kind === 'short-to-long' ? [0,1] : [0,0];
			const to = kind === 'covered' ? [1,0] : kind === 'short-to-long' ? [0,0] : [0,2];
			grid.select(...from,false); grid.refreshSelectionPreview();
			return {point:point(...to),bounds:{top:0,bottom:Math.max(from[0],to[0]),left:Math.min(from[1],to[1]),right:Math.max(from[1],to[1])}};
		},
		rangeSnapshot() {
			return {bounds:grid.selectionBounds(),previewHidden:grid.selectedCellPreview.hasClass('is-hidden'),
				boxVisible:!grid.selectionBox.hasClass('is-previewing-cell'),unchanged:sheet.lastSeq === originalSequence,drags};
		},
		dispose,
	};
}
