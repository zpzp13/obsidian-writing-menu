import { TFile } from 'obsidian';
import { PlotWorkbookRepository } from '../src/plot-workbook/PlotWorkbookRepository';

export async function verifySidebarFormatting({plugin,sidebar,sidebarHost,session,grid,row,plotColumn,taskColumn,cast,foreshadow,status,date,character,file}) {
	const assert=(value,message)=>{if(!value)throw new Error(message);};
	const settle=()=>new Promise(resolve=>setTimeout(resolve,65));
	const cardFor=id=>sidebarHost.querySelector(`.wm-plotbook-timeline-card[data-column-id="${id}"][data-row-id="${row}"]`);
	const heading=card=>card.querySelector('.wm-plotbook-sidebar-card-title');
	const body=card=>card.querySelector('.wm-plotbook-timeline-card-body');
	const centered=(label,icon,message)=>{
		const a=label.getBoundingClientRect(),b=icon.getBoundingClientRect();
		assert(Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<=1,message);
	};
	const dateField=cardFor(date).querySelector('.wm-plotbook-sidebar-date');
	// Exact date positioning rule from Obsidian's installed app.css (more specific than a lone class).
	const nativeDateStyle=document.head.createEl('style',{text:"input[type='date'], input[type='datetime-local'] { font-variant-numeric: tabular-nums; position: relative; }"});
	const metadata=plugin.app.metadataCache;
	const vault=plugin.app.vault;
	const previousTheme=document.body.className;
	let wikiName='위키 인물 이름', wikiColor='#9b5a87';
	const otherFile=new TFile();Object.assign(otherFile,{path:'ChecklistProject/Characters/철수.md',basename:'철수',extension:'md'});
	let otherColor='#4b7e5d';
	plugin.app.vault={...vault,getAbstractFileByPath:path=>path===otherFile.path?otherFile:vault.getAbstractFileByPath(path)};
	plugin.app.metadataCache={...metadata,getFileCache:value=>value===file?{frontmatter:{[plugin.settings.wikiNameFieldName]:wikiName,wikiColor}}:value===otherFile?{frontmatter:{wikiColor:otherColor}}:metadata.getFileCache(value)};
	const sheet=session.activeSheet;
	const columnIds=[plotColumn,taskColumn,cast,foreshadow,status,date,character];
	const saved=columnIds.map(id=>({id,header:structuredClone(sheet.columns[id].style),axis:structuredClone(sheet.columns[id].cellStyle),cell:structuredClone(sheet.cells[row]?.[id]?.style)}));
	const rowHeader=structuredClone(sheet.rows[row].style);
	const rowAxis=structuredClone(sheet.rows[row].cellStyle);
	const explicitAppearances=session.getExplicitAppearancePaths(sheet,row,cast).slice();
	const clear={fontFamily:undefined,fontSize:undefined,color:undefined,backgroundColor:undefined,alignment:undefined};
	const cellStyle={fontFamily:'Georgia',fontSize:19,color:{light:'#345678',dark:'#b4c5d6'},backgroundColor:{light:'#e0c0a0',dark:'#604020'}};
	try {
		console.info('Sidebar date layout with native Obsidian CSS',JSON.stringify({field:dateField.getBoundingClientRect().height,button:dateField.firstElementChild.getBoundingClientRect().height}));
		assert(Math.abs(dateField.getBoundingClientRect().height-dateField.firstElementChild.getBoundingClientRect().height)<=1 && getComputedStyle(dateField.querySelector('input')).position==='absolute','Date wrapper retains an extra inline baseline/blank bottom row');
		// Reproduce the user's inherited large/red cast text, then format that cell through the real toolbar path.
		const appearances=session.getAppearancePaths(sheet,row,cast).slice();
		const appearanceValue=session.getCell(sheet,row,cast);
		session.setCellAndAxisStyles([],[row],[],{fontSize:22,color:'#ff3333'});
		grid.select(0,sheet.columnOrder.indexOf(cast),false);
		grid.applySelectionStyle({fontFamily:'Georgia',fontSize:10,color:'#123456'});await settle();
		assert(session.getCellStyle(sheet,row,cast).fontSize===10 && grid.getSelectionStyle().fontSize===10,'Appearance cell formatting is blocked by the content-editing lock');
		assert(getComputedStyle(cardFor(cast).querySelector('.wm-plotbook-sidebar-character-link')).fontSize==='10px','Appearance link retained the large inherited row font instead of its cell override');
		assert(JSON.stringify(session.getAppearancePaths(sheet,row,cast))===JSON.stringify(appearances),'Formatting a cast cell changed its appearance registry');
		session.undo();await settle();assert(session.getCellStyle(sheet,row,cast).fontSize===22,'Cast format undo did not restore the inherited row style');
		session.redo();await settle();assert(session.getCellStyle(sheet,row,cast).fontSize===10,'Cast format redo lost the cell font');
		grid.select(0,grid.columnOrder(sheet).indexOf(plotColumn),false,false,true);
		grid.applySelectionStyle({fontSize:11});await settle();
		assert(session.getCellStyle(sheet,row,cast).fontSize===11 && session.getCellStyle(sheet,row,plotColumn).fontSize===11,'Multi-cell formatting dropped the appearance cell from selection');
		session.undo();await settle();
		grid.select(0,grid.columnOrder(sheet).indexOf(cast),false);
		session.setCellAndAxisStyles([{rowId:row,columnId:cast}],[],[],{fontSize:12});await settle();
		assert(session.getCellStyle(sheet,row,cast).fontSize===12,'Combined cell/axis formatting still skips appearance cells');
		session.undo();await settle();
		grid.clearSelectedRange();session.setCell(row,cast,'허용되지 않은 직접 입력');
		assert(session.getCell(sheet,row,cast)===appearanceValue && JSON.stringify(session.getAppearancePaths(sheet,row,cast))===JSON.stringify(appearances),'Enabling appearance formatting also unlocked protected content');
		await session.flush();
		const project=plugin.projectContext.getProjects().find(value=>value.id===sidebar.state.projectId);
		const verifier=new PlotWorkbookRepository(plugin,project.rootFolder);
		try {
			const loaded=await verifier.loadOrCreate(project.id,project.name),cell=loaded.sheets.get(sheet.sheetId).cells[row][cast];
			assert(cell.style?.fontSize===10 && cell.style?.color==='#123456' && cell.value===appearanceValue,'Appearance cell typography/value did not survive journal/snapshot reload');
		} finally {verifier.dispose();}
		grid.select(0,grid.columnOrder(sheet).indexOf(plotColumn),false);
		session.setCellAndAxisStyles([],[row],[],{...clear,...rowAxis});
		// Row/column defaults must merge exactly as in the table; a cell override wins.
		session.setCellAndAxisStyles([{rowId:row,columnId:plotColumn}],[],[plotColumn],{fontFamily:'Courier New',fontSize:17,color:'#765432'});
		session.setCellAndAxisStyles([],[],[cast],cellStyle);
		session.setCellStyles(columnIds.map(columnId=>({rowId:row,columnId})),cellStyle);
		session.setHeaderStyles([row],[plotColumn,cast,foreshadow,status,date,character],{fontFamily:'Georgia',fontSize:32,color:{light:'#654321',dark:'#d4b392'},backgroundColor:'#d0e0f0',alignment:'right'});
		await settle();
		assert(heading(cardFor(character)).textContent==='위키 인물 이름','Character sidebar title ignores the linked wiki display name');
		for(const dark of [false,true]) {
			document.body.toggleClass('theme-dark',dark);await settle();
			for(const id of columnIds) {
				const card=cardFor(id),content=body(card),cell=grid.canvas.querySelector(`.wm-plotbook-cell[data-row="0"][data-column="${session.activeSheet.columnOrder.indexOf(id)}"]`);
				const source=getComputedStyle(cell),actual=getComputedStyle(content);
				assert(actual.fontFamily===source.fontFamily && actual.fontSize===source.fontSize && actual.color===source.color,`Sidebar content style differs from table cell (${id}, dark=${dark}): ${actual.fontFamily}/${actual.fontSize}/${actual.color}`);
				for(const element of [card,content,heading(card)])assert(getComputedStyle(element).backgroundColor==='rgba(0, 0, 0, 0)','A table cell/header background leaked into the sidebar');
				const text=content.querySelector('.wm-plotbook-sidebar-cell-text, .wm-plotbook-checklist-title, .wm-plotbook-sidebar-date-open, .wm-plotbook-sidebar-foreshadow > button, .wm-plotbook-sidebar-character-link, .wm-plotbook-status-value');
				const textColor=id===status?getComputedStyle(cell.querySelector('.wm-plotbook-status-value')).color:id===cast?'rgb(155, 90, 135)':source.color;
				assert(getComputedStyle(text).fontSize===source.fontSize && getComputedStyle(text).color===textColor,'Role-specific content overrides the inherited cell font size/color');
				if(id===cast) {
					assert(getComputedStyle(text).textDecorationLine==='none','Appearance links still have an underline');
					text.focus();assert(getComputedStyle(text).textDecorationLine==='none','Focused appearance links still have an underline');
				}
			}
			for(const card of sidebarHost.querySelectorAll('.wm-plotbook-timeline-card')) {
				const title=heading(card),icon=card.querySelector('.wm-plotbook-sidebar-card-icon'),style=getComputedStyle(title);
				assert(style.fontSize==='13px' && style.textAlign==='left' && style.justifyContent==='flex-start','A sidebar title is not left-aligned at a fixed 13px');
				centered(title,icon,'Sidebar card title and role icon are vertically misaligned');
				for(const action of card.querySelectorAll('.wm-plotbook-timeline-card-heading > .clickable-icon'))centered(title,action,'Sidebar card title and trailing action are vertically misaligned');
				assert(Math.abs(title.getBoundingClientRect().left-icon.getBoundingClientRect().right-6)<=1,'Column title is not directly next to its icon');
			}
			assert(getComputedStyle(heading(cardFor(character))).color==='rgb(155, 90, 135)','Character title did not prioritize its wiki color');
			assert(getComputedStyle(heading(cardFor(plotColumn))).color===(dark?'rgb(212, 179, 146)':'rgb(101, 67, 33)'),'Column header text color did not follow the current theme');
		}
		wikiName='바뀐 인물 이름';wikiColor='#447788';
		sidebar.onCharacterMetadataChanged({path:'ChecklistProject/unrelated.md'});
		assert(sidebar.frame===null,'Unrelated note metadata scheduled a sidebar render');
		sidebar.onCharacterMetadataChanged(file);await settle();
		assert(heading(cardFor(character)).textContent===wikiName && getComputedStyle(heading(cardFor(character))).color==='rgb(68, 119, 136)','A linked wiki rename/color update did not refresh an existing character title');
		assert(getComputedStyle(cardFor(cast).querySelector('.wm-plotbook-sidebar-character-link')).color==='rgb(68, 119, 136)','Wiki color metadata changed without refreshing the appearance link color');
		session.setAppearancePaths(row,cast,[...explicitAppearances,otherFile.path]);await settle();
		let links=cardFor(cast).querySelectorAll('.wm-plotbook-sidebar-character-link');
		assert(links.length===2 && getComputedStyle(links[0]).color==='rgb(68, 119, 136)' && getComputedStyle(links[1]).color==='rgb(75, 126, 93)','Appearance links do not use each individual character wiki color');
		otherColor='#825799';sidebar.onCharacterMetadataChanged(otherFile);await settle();
		links=cardFor(cast).querySelectorAll('.wm-plotbook-sidebar-character-link');
		assert(getComputedStyle(links[0]).color==='rgb(68, 119, 136)' && getComputedStyle(links[1]).color==='rgb(130, 87, 153)','A color-only wiki change stayed stale for an appearance without its own character column');
		for(const id of [status,date]) {
			const control=cardFor(id).querySelector('.wm-plotbook-sidebar-status, .wm-plotbook-sidebar-date-open');
			assert(getComputedStyle(control).borderTopWidth==='0px','Status/date card still has an inner border');
			centered(control.firstElementChild,control.lastElementChild,'Status/date label and trailing icon are vertically misaligned');
		}
		const task=cardFor(taskColumn).querySelector('.wm-plotbook-checklist-item');
		centered(task.querySelector('.wm-plotbook-checklist-title'),task.querySelector('.wm-plotbook-checklist-toggle'),'Checklist title and checkbox are vertically misaligned');
		const story=cardFor(foreshadow).querySelector('.wm-plotbook-sidebar-foreshadow');
		centered(story.firstElementChild,story.lastElementChild,'Foreshadow marker and title are vertically misaligned');
		await sidebar.setState({mode:'column',columnId:plotColumn,rowId:row},{});await settle();
		assert(getComputedStyle(heading(cardFor(plotColumn))).fontFamily.includes('Georgia') && getComputedStyle(heading(cardFor(plotColumn))).fontSize==='13px','Row title did not inherit its header font while keeping 13px');
		for(const dark of [false,true]) {
			document.body.toggleClass('theme-dark',dark);await settle();
			assert(getComputedStyle(heading(cardFor(plotColumn))).color===(dark?'rgb(212, 179, 146)':'rgb(101, 67, 33)'),'Row header color did not follow its table header theme');
		}
		for(const target of sidebarHost.querySelectorAll('.wm-plotbook-sidebar-context > .wm-plotbook-sidebar-select'))centered(target.querySelector('button'),target.firstElementChild,'Project/sheet title and leading icon are vertically misaligned');
		const axis=sidebarHost.querySelector('.wm-plotbook-sidebar-select.is-column');
		centered(axis.querySelector('button'),axis.firstElementChild,'Axis picker title and icon are vertically misaligned');
		// An axis-only format and later removal both update an existing card without rebuilding its DOM.
		const originalCard=cardFor(plotColumn), originalBody=body(originalCard);
		session.setCellStyles([{rowId:row,columnId:plotColumn}],{fontFamily:undefined,fontSize:undefined,color:undefined,backgroundColor:undefined});await settle();
		assert(body(cardFor(plotColumn))===originalBody && getComputedStyle(originalBody).fontFamily.includes('Courier New') && getComputedStyle(originalBody).fontSize==='17px','Axis format did not reappear after clearing a cell override');
		session.setCellAndAxisStyles([{rowId:row,columnId:plotColumn}],[],[plotColumn],{fontFamily:undefined,fontSize:undefined,color:undefined});await settle();
		assert(getComputedStyle(originalBody).fontSize==='10px' && !getComputedStyle(originalBody).fontFamily.includes('Courier New'),'Removing table formatting left stale sidebar typography');
	} finally {
		document.body.className=previousTheme;plugin.app.metadataCache=metadata;plugin.app.vault=vault;nativeDateStyle.remove();
		session.setAppearancePaths(row,cast,explicitAppearances);
		for(const value of saved) {
			session.setCellStyles([{rowId:row,columnId:value.id}],{...clear,...value.cell});
			session.setCellAndAxisStyles([],[],[value.id],{...clear,...value.axis});
			session.setHeaderStyles([],[value.id],{...clear,...value.header});
		}
		session.setHeaderStyles([row],[],{...clear,...rowHeader});
		session.setCellAndAxisStyles([],[row],[],{...clear,...rowAxis});
		await sidebar.setState({mode:'row',columnId:cast,rowId:row},{});await settle();
	}
	console.info('Sidebar cell/axis/header typography, theme-aware colors, wiki character title, transparent backgrounds, date height and all card/control icon centers passed');
}
