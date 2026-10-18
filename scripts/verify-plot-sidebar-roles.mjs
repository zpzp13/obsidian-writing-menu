import { TFile } from 'obsidian';
import { verifySidebarFormatting } from './verify-plot-sidebar-formatting.mjs';
import { verifySidebarNavigation } from './verify-plot-sidebar-navigation.mjs';

export async function verifySidebarRoles({plugin,sidebar,sidebarHost,session,grid,plotColumn,taskColumn,row}) {
	const assert = (value,message)=>{if(!value)throw new Error(message);};
	const settle = ()=>new Promise(resolve=>setTimeout(resolve,65));
	const sheet = session.activeSheet;
	const original = session.getCell(sheet,row,plotColumn), longText = '긴 내용의 장면을 확인합니다. '.repeat(800);
	session.setCell(row,plotColumn,longText);
	await sidebar.setState({mode:'column',columnId:plotColumn,rowId:row},{}); await settle();
	let card = sidebarHost.querySelector(`.wm-plotbook-timeline-card[data-row-id="${row}"]`);
	assert(card.querySelector('.wm-plotbook-timeline-card-body').getBoundingClientRect().height <= 112.5 && card.querySelector('.wm-plotbook-sidebar-cell-text').textContent.length <= 1200,'Collapsed card is not bounded in layout and DOM content');
	card.querySelector('.wm-plotbook-sidebar-card-title').click();
	assert(card.classList.contains('is-expanded') && card.querySelector('.wm-plotbook-sidebar-cell-text').textContent === longText,'Selecting a card did not reveal its complete content');
	card.querySelector('.wm-plotbook-sidebar-card-title').click();
	assert(!card.classList.contains('is-expanded') && card.querySelector('.wm-plotbook-timeline-card-body').getBoundingClientRect().height <= 112.5,'Collapsing a card retained its unbounded layout');
	session.setCell(row,plotColumn,original);
	await verifySidebarNavigation({sidebar,sidebarHost,session,row,plotColumn,taskColumn});
	const hide = sidebarHost.querySelector('[data-sidebar-hide-pickers]'); hide.click();
	assert(sidebarHost.querySelector('.wm-plotbook-sidebar-pickers').hidden && hide.getAttribute('aria-pressed') === 'true','Picker visibility toggle did not hide just the picker section');
	hide.click(); assert(!sidebarHost.querySelector('.wm-plotbook-sidebar-pickers').hidden,'Picker visibility toggle could not restore selectors');
	for(const label of ['프로젝트','시트']) {
		const trigger = sidebarHost.querySelector(`button[aria-label="${label} 선택"]`);trigger.click();
		const menu = document.querySelector('.wm-plotbook-scope-popover');
		assert(menu?.matches('.wm-paged-toolbar-popover.wm-paged-compact-popover') && menu.querySelector('.wm-paged-popover-item'),'Scope selector did not use the toolbar compact popover');
		menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
		assert(!document.querySelector('.wm-plotbook-scope-popover') && document.activeElement === trigger,'Scope popover Escape/focus restoration failed');
		assert(getComputedStyle(trigger.parentElement).outlineStyle === 'none','Selecting a scope still adds an outer focus border');
	}
	const [cast,foreshadow,status,date,character] = sheet.columnOrder.filter(id=>id!==plotColumn && id!==taskColumn);
	const file = new TFile(); Object.assign(file,{path:'ChecklistProject/Characters/영희.md',basename:'영희',extension:'md'});
	const oldVault=plugin.app.vault, oldWorkspace=plugin.app.workspace, oldWiki=plugin.openFileInWiki;
	let opened;
	const leaf = name=>({async openFile(value){opened={kind:'markdown',mode:name,file:value};}});
	const currentLeaf=leaf('current'),tabLeaf=leaf('tab'),sideLeaf=leaf('sidebar');
	plugin.app.vault={...oldVault,getAbstractFileByPath:path=>path===file.path?file:oldVault.getAbstractFileByPath(path)};
	plugin.app.workspace={...oldWorkspace,activeLeaf:currentLeaf,getLeaf:mode=>mode==='tab'?tabLeaf:currentLeaf,getRightLeaf:()=>sideLeaf,revealLeaf:async()=>{}};
	plugin.openFileInWiki=async(value,mode)=>{opened={kind:'wiki',mode,file:value};};
	const oldFormat=plugin.settings.plotCharacterLinkFormat,oldMode=plugin.settings.plotCharacterLinkOpenMode;
	try {
		for(const [id,role] of [[cast,'cast'],[foreshadow,'foreshadow'],[status,'status'],[date,'date'],[character,'character']]) {sheet.columns[id].role=role;sheet.columns[id].title='';}
		sheet.columns[character].characterNotePath=file.path;
		session.setCell(row,character,'인물의 셀 내용');
		session.setAppearancePaths(row,cast,[file.path]);
		await settle();
		const castIndex=sheet.columnOrder.indexOf(cast);
		const sourceCastCell=grid.canvas.querySelector(`.wm-plotbook-cell[data-row="0"][data-column="${castIndex}"]`);
		const sourceAvatar=sourceCastCell.querySelector('.wm-plotbook-profile-avatar');
		sourceAvatar.dataset.previewCloneGuard='source';
		let previewCastRenders=0;
		const renderCastCell=grid.renderCastCell.bind(grid);
		grid.renderCastCell=(...args)=>{previewCastRenders++;return renderCastCell(...args);};
		grid.selectedCellPreview.removeClass('is-hidden');
		grid.selectedCellPreview.style.width=`${sourceCastCell.clientWidth}px`;
		grid.selectedCellPreview.style.height='96px';
		grid.renderSelectionPreviewContent(sourceCastCell,sheet,row,cast,'cast',session.getCell(sheet,row,cast));
		await settle();
		const previewAvatar=grid.selectedCellPreviewContent.querySelector('.wm-plotbook-profile-avatar');
		const sourceAvatarRect=sourceAvatar.getBoundingClientRect(),previewAvatarRect=previewAvatar.getBoundingClientRect();
		assert(previewCastRenders>0 && previewAvatar && !previewAvatar.dataset.previewCloneGuard,
			'Appearance preview cloned canvas DOM instead of rendering character images');
		assert(Math.abs(sourceAvatarRect.width-previewAvatarRect.width)<=1 && Math.abs(sourceAvatarRect.height-previewAvatarRect.height)<=1,
			'Appearance preview changed the avatar size instead of only expanding the preview window');
		grid.renderCastCell=renderCastCell;
		grid.clearSelectionPreview();
		const longStatus = await session.addStatus('아주 긴 사용자 상태 이름으로 선택 미리보기 확인');
		session.setCell(row,status,longStatus.id);session.setCell(row,date,'2026-10-18');
		session.resizeColumn(status,48); session.resizeColumn(date,48); session.resizeColumn(foreshadow,70);
		const story=await session.createForeshadow('카드에서 추적할 아주 긴 복선 제목을 전부 확인합니다','', {sheetId:sheet.sheetId,rowId:row,columnId:plotColumn});
		const selectedStory=await session.createForeshadow('사이드바에서 정확히 선택할 복선','', {sheetId:sheet.sheetId,rowId:row,columnId:plotColumn});
		await settle();
		for (const [columnId,role,needle] of [[status,'status','아주 긴 사용자 상태'],[date,'date','2026-10-18'],[foreshadow,'foreshadow','아주 긴 복선 제목']]) {
			grid.select(0,sheet.columnOrder.indexOf(columnId),false); grid.refreshSelectionPreview();
			assert(!grid.selectedCellPreview.hasClass('is-hidden') && grid.selectedCellPreviewContent.dataset.role === role
				&& grid.selectedCellPreviewContent.textContent.includes(needle), `Selected ${role} cell did not reveal its clipped semantic content`);
		}
		grid.clearSelectionPreview();
		await sidebar.setState({mode:'row',columnId:cast,rowId:row},{});await settle();
		const getCard=id=>sidebarHost.querySelector(`.wm-plotbook-timeline-card[data-column-id="${id}"]`);
		assert(getCard(cast).querySelector('.wm-plotbook-sidebar-card-title').textContent==='등장' && getCard(foreshadow).querySelector('.wm-plotbook-sidebar-card-title').textContent==='복선','Typed column cards still use alphabet fallback titles');
		assert(getCard(cast).querySelector('.wm-plotbook-sidebar-card-icon svg')?.dataset.icon==='users' && !getCard(cast).querySelector('.wm-plotbook-sidebar-card-icon').hidden,'Row-mode cards lack role icons');
		const selectedStoryButton=[...getCard(foreshadow).querySelectorAll('.wm-plotbook-sidebar-foreshadow button')]
			.find(button=>button.textContent===selectedStory.title);
		assert(getComputedStyle(selectedStoryButton).cursor==='pointer' && getComputedStyle(selectedStoryButton).textDecorationLine==='none',
			'Sidebar foreshadow link lacks a pointer cursor or retains an underline');
		selectedStoryButton.click();
		assert(globalThis.lastTestModal?.selectedId===selectedStory.id,'Sidebar foreshadow title did not select that exact item in the manager');
		globalThis.lastTestModal.close();
		await session.deleteForeshadow(selectedStory.id);await settle();
		await verifySidebarFormatting({plugin,sidebar,sidebarHost,session,grid,row,plotColumn,taskColumn,cast,foreshadow,status,date,character,file});
		for(const format of ['wiki','markdown'])for(const mode of ['current','tab','sidebar']) {
			plugin.settings.plotCharacterLinkFormat=format;plugin.settings.plotCharacterLinkOpenMode=mode;
			getCard(cast).querySelector('.wm-plotbook-sidebar-character-link').click();await settle();
			assert(opened?.kind===format && opened.mode===mode && opened.file===file,'Appearance card ignored shared character link settings');
		}
		assert(getCard(foreshadow).querySelector('.wm-plotbook-foreshadow-marker')?.getAttribute('aria-label')==='미회수','Foreshadow card lacks an open marker');
		const manage=getCard(foreshadow).querySelector('[aria-label="복선 관리하기"]');
		assert(manage.nextElementSibling.getAttribute('aria-label')==='이 셀을 표에서 열기','Foreshadow management is not immediately before cell navigation');
		manage.click();assert(globalThis.lastTestModal?.modalEl.classList.contains('wm-plotbook-foreshadow-modal'),'Foreshadow card management did not open the shared modal');globalThis.lastTestModal.close();
		await session.resolveForeshadow(story.id,{sheetId:sheet.sheetId,rowId:sheet.rowOrder[2],columnId:plotColumn});await settle();
		assert(getCard(foreshadow).querySelector('.wm-plotbook-foreshadow-marker').getAttribute('aria-label')==='회수','Foreshadow card marker stayed stale after resolution');
		const cell=grid.canvas.querySelector(`.wm-plotbook-cell[data-row="0"][data-column="${sheet.columnOrder.indexOf(foreshadow)}"]`);
		cell.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
		const titles=globalThis.lastTestMenu.items.map(item=>item.title);
		assert(titles.filter(title=>title==='복선 관리').length===1 && !titles.includes('복선 등록 및 회수') && !titles.includes('복선 목록'),'Foreshadow cell menu retains duplicate management entries');
		await sidebar.setState({mode:'column',columnId:status,rowId:row},{});await settle();
		sidebarHost.querySelector('[aria-label="상태 선택"]').click();globalThis.lastTestMenu.items.find(item=>item.title==='초고').click();await settle();
		assert(session.getCell(sheet,row,status)==='draft' && sidebarHost.querySelector('.wm-plotbook-status-value').textContent==='초고','Column-mode status control did not edit the shared cell');
		await sidebar.setState({columnId:date,rowId:row},{});await settle();
		const dateInput=sidebarHost.querySelector('input[type="date"]');let pickerOpened=0;dateInput.showPicker=()=>pickerOpened++;
		sidebarHost.querySelector('[aria-label="달력 열기"]').click();assert(pickerOpened===1,'Date calendar icon did not invoke the picker');
		dateInput.value='2026-11-04';dateInput.dispatchEvent(new Event('change',{bubbles:true}));await settle();
		assert(session.getCell(sheet,row,date)==='2026-11-04' && grid.canvas.querySelector(`.wm-plotbook-cell[data-row="0"][data-column="${sheet.columnOrder.indexOf(date)}"]`).textContent.includes('2026-11-04'),'Column-mode date control did not update the table');
		for(const columnId of [status,date]) {
			await sidebar.setState({columnId,rowId:sheet.rowOrder[1]},{});await settle();
			const subcard=sidebarHost.querySelector(`.wm-plotbook-timeline-card[data-row-id="${sheet.rowOrder[1]}"]`);
			assert(!subcard.querySelector('[aria-label="상태 선택"], [aria-label="달력 열기"]'),'Sidebar exposed structured subrow editing that the table forbids');
		}
		const childRow = sheet.rowOrder[1];
		session.setCell(childRow, character, '세부 행에서 유지할 내용');
		const protectedSequence = sheet.lastSeq;
		session.removeAppearancePath(row, cast, file.path);
		assert(sheet.lastSeq === protectedSequence && session.getCell(sheet, childRow, character) === '세부 행에서 유지할 내용',
			'Removing a child-row appearance cleared protected character content');
		session.setCell(childRow, character, '');
		const characterBefore = session.getCell(sheet, row, character), castBefore = session.getCell(sheet, row, cast);
		const sequenceBeforeRemoval = sheet.lastSeq;
		session.removeAppearancePath(row, cast, file.path);
		assert(!session.getCell(sheet, row, character) && !session.getAppearancePaths(sheet, row, cast).includes(file.path)
			&& sheet.lastSeq === sequenceBeforeRemoval + 1, 'Appearance removal did not atomically clear its character cell');
		session.undo();
		assert(session.getCell(sheet, row, character) === characterBefore && session.getCell(sheet, row, cast) === castBefore,
			'One undo did not restore both appearance and character content');
		session.redo();
		assert(!session.getCell(sheet, row, character), 'Redo did not clear the character cell');
		session.undo();
	} finally {
		plugin.settings.plotCharacterLinkFormat=oldFormat;plugin.settings.plotCharacterLinkOpenMode=oldMode;
		plugin.app.vault=oldVault;plugin.app.workspace=oldWorkspace;plugin.openFileInWiki=oldWiki;
	}
	console.info('Bounded/expanded sidebar cards, compact selectors, picker hiding, semantic role cards, six character link modes, status/date edits and unique foreshadow menu passed');
}
