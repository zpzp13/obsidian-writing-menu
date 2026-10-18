import { TFile, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { PlotWorkbookSession } from './PlotWorkbookSession';
import type { PlotWorkbookColumn, PlotWorkbookForeshadowLocation, PlotWorkbookSheet } from './PlotWorkbookTypes';
import { getWikiColor, getWikiDisplayName } from '../wiki/wikiProfileUtils';
import { isCurrentPlotCell, openPlotWorkbookCharacter, openPlotWorkbookStatusMenu } from './PlotWorkbookCellActions';
import { renderForeshadowBadge } from './PlotWorkbookForeshadowCard';

export function sidebarCharacterName(plugin: WritingMenuPlugin, path: string): string {
	const file = plugin.app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? getWikiDisplayName(plugin.app,plugin,file) : path.split('/').pop()?.replace(/\.md$/i,'') ?? path;
}

export function sidebarCharacterColor(plugin: WritingMenuPlugin, path: string): string {
	const file = plugin.app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? getWikiColor(plugin.app,plugin,file) : plugin.settings.wikiColor || '#7025db';
}

export function sidebarCharacterColumn(plugin: WritingMenuPlugin, column: PlotWorkbookColumn): {name: string; color: string} {
	const path = column.characterNotePath ?? '';
	const file = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
	return file instanceof TFile
		? { name:getWikiDisplayName(plugin.app,plugin,file), color:getWikiColor(plugin.app,plugin,file) }
		: { name:column.title || path.split('/').pop()?.replace(/\.md$/i,'') || '인물', color:plugin.settings.wikiColor || '#7025db' };
}

/** Role-specific controls use the same session writes and link settings as the grid. */
export function renderSidebarCell(parent: HTMLElement, plugin: WritingMenuPlugin, session: PlotWorkbookSession, sheet: PlotWorkbookSheet,
	location: PlotWorkbookForeshadowLocation, expanded: boolean, openForeshadow: (foreshadowId?: string)=>void): void {
	parent.empty();
	const {rowId,columnId} = location, role = sheet.columns[columnId].role;
	const value = session.getCell(sheet,rowId,columnId);
	if((role === 'status' || role === 'date') && sheet.rows[rowId].parentRowId) {
		parent.createSpan({cls:'wm-plotbook-sidebar-cell-empty',text:'정식 행에서 설정할 수 있습니다.'});
		return;
	}
	if(role === 'status') {
		const button = parent.createEl('button',{cls:'wm-plotbook-sidebar-status',attr:{type:'button','aria-label':'상태 선택','aria-haspopup':'menu'}});
		const badge = button.createSpan({cls:`wm-plotbook-status-value${value ? '' : ' is-empty'}`,text:value ? session.statusName(value) : '상태 없음'});
		badge.style.setProperty('--wm-plotbook-status-color',session.statusColor(value));
		setIcon(button.createSpan({'attr':{'aria-hidden':'true'}}),'chevron-down');
		button.addEventListener('click',event=>openPlotWorkbookStatusMenu(plugin,session,event,rowId,columnId));
	} else if(role === 'date') {
		const field = parent.createDiv({cls:'wm-plotbook-sidebar-date'});
		const button = field.createEl('button',{cls:'wm-plotbook-sidebar-date-open',attr:{type:'button','aria-label':'달력 열기'}});
		button.createSpan({text:value || '날짜 선택'}); setIcon(button.createSpan({'attr':{'aria-hidden':'true'}}),'calendar-days');
		const picker = field.createEl('input',{cls:'wm-plotbook-sidebar-date-input',type:'date',attr:{'aria-label':'날짜 선택',tabindex:'-1'}});
		picker.value = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
		button.addEventListener('click',()=>{
			try { picker.showPicker(); } catch { picker.focus(); picker.click(); }
		});
		picker.addEventListener('change',()=>{if(isCurrentPlotCell(session,location,'date'))session.setCell(rowId,columnId,picker.value);});
	} else if(role === 'cast') {
		const paths = session.getAppearancePaths(sheet,rowId,columnId);
		const list = parent.createDiv({cls:'wm-plotbook-sidebar-characters'});
		for(const path of expanded ? paths : paths.slice(0,6)) {
			const link = list.createEl('a',{cls:'wm-plotbook-sidebar-character-link',text:sidebarCharacterName(plugin,path),attr:{href:path}});
			link.style.setProperty('--wm-plotbook-character-color',sidebarCharacterColor(plugin,path));
			link.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void openPlotWorkbookCharacter(plugin,path);});
		}
		if(!paths.length)list.createSpan({cls:'wm-plotbook-sidebar-cell-empty',text:'등장 인물이 없습니다.'});
	} else if(role === 'foreshadow') {
		const items = session.foreshadowsInRow(sheet.sheetId,rowId);
		for(const item of expanded ? items : items.slice(0,4)) {
			const row = parent.createDiv({cls:'wm-plotbook-sidebar-foreshadow'});
			renderForeshadowBadge(row,item.status);
			const title = row.createEl('button',{text:item.title,attr:{type:'button'}});
			title.addEventListener('click',()=>openForeshadow(item.id));
		}
		if(!items.length)parent.createSpan({cls:'wm-plotbook-sidebar-cell-empty',text:value || '등록된 복선이 없습니다.'});
	} else {
		parent.createDiv({cls:'wm-plotbook-sidebar-cell-text',text:value ? (expanded ? value : value.slice(0,1200)) : '내용 없음'});
	}
}
