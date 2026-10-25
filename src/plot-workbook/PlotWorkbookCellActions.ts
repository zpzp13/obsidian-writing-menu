import { wmT } from '../i18n/index';
import { Menu, Notice, TFile, normalizePath } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { PlotWorkbookSession } from './PlotWorkbookSession';
import type { PlotWorkbookForeshadowLocation } from './PlotWorkbookTypes';
import { plotWorkbookStatusName, plotWorkbookStatusIcon } from './PlotWorkbookStatus';
import { PlotWorkbookStatusModal } from './PlotWorkbookStatusModal';

export function isCurrentPlotCell(session: PlotWorkbookSession, location: PlotWorkbookForeshadowLocation, role?: string): boolean {
	const sheet = session.activeSheet;
	return sheet.sheetId === location.sheetId && !!sheet.rows[location.rowId] && !!sheet.columns[location.columnId]
		&& (!role || sheet.columns[location.columnId].role === role);
}

export function openPlotWorkbookStatusMenu(plugin: WritingMenuPlugin, session: PlotWorkbookSession, event: MouseEvent, rowId: string, columnId: string): void {
	event.preventDefault(); event.stopPropagation();
	const location = {sheetId:session.activeSheet.sheetId,rowId,columnId};
	const current = session.getCell(session.activeSheet,rowId,columnId);
	const write = (value: string) => { if (isCurrentPlotCell(session,location,'status')) session.setCell(rowId,columnId,value); };
	const menu = new Menu();
	for (const status of session.getStatuses()) menu.addItem(item => {
		item.setTitle(plotWorkbookStatusName(status)).setIcon(plotWorkbookStatusIcon(status.id)).onClick(() => write(status.id));
		const element = (item as unknown as {dom:HTMLElement}).dom;
		element.addClass('wm-plotbook-status-option', status.id === 'done' ? 'is-done' : 'is-open');
		element.toggleClass('is-current', current === status.id);
		element.style.setProperty('--wm-plotbook-status-color',session.statusColor(status.id));
	});
	menu.addSeparator();
	menu.addItem(item => item.setTitle(wmT("새 상태…")).setIcon('plus').onClick(() => new PlotWorkbookStatusModal(plugin,async name=>{
		const status = await session.addStatus(name); if(status)write(status.id);
	}).open()));
	menu.addItem(item=>item.setTitle(wmT("상태 없음")).setIcon('x').setDisabled(!current).onClick(()=>write('')));
	menu.showAtMouseEvent(event);
}

export async function openPlotWorkbookCharacter(plugin: WritingMenuPlugin, notePath: string): Promise<void> {
	const file = plugin.app.vault.getAbstractFileByPath(normalizePath(notePath));
	if (!(file instanceof TFile)) { new Notice(wmT("연결된 인물 노트를 찾을 수 없습니다.")); return; }
	const mode = plugin.settings.plotCharacterLinkOpenMode ?? 'sidebar';
	if (plugin.settings.plotCharacterLinkFormat === 'wiki') { await plugin.openFileInWiki(file,mode); return; }
	const leaf = mode === 'sidebar' ? plugin.app.workspace.getRightLeaf(false)
		: mode === 'tab' ? plugin.app.workspace.getLeaf('tab')
			: (plugin.app.workspace.getLeaf(false));
	if (!leaf) return;
	await leaf.openFile(file); await plugin.app.workspace.revealLeaf(leaf);
}
