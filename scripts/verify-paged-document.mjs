import { PagedWritingView } from '../src/paged/PagedWritingView';
import { DEFAULT_SETTINGS } from '../src/types';
import { runPagedStoreChecks } from './verify-paged-store.mjs';
import { runPagedBoundaryChecks } from './verify-paged-boundaries.mjs';
import { runEditorScrollingChecks } from './verify-editor-scrolling.mjs';
import { installNativePagedInputChecks } from './verify-paged-native-input.mjs';
import { getWritingDocumentForView } from '../src/writing/WritingDocument';
import { PaginationEngine } from '../src/paged/PaginationEngine';

// Real contenteditable DOM and virtual workspace events; no vault writes.
export async function runPagedDocumentChecks() {
	await runPagedStoreChecks();
	await runEditorScrollingChecks();
	installNativePagedInputChecks();
	const assert=(value,message)=>{if(!value)throw new Error(message);};
	const callbacks=new Map();
	const workspace={on(name,action){const ref={name,action};callbacks.set(ref,action);return ref;},offref(ref){callbacks.delete(ref);},
		trigger(name,...args){for(const [ref,action] of callbacks)if(ref.name===name)action(...args);}};
	const host=document.body.createDiv({cls:'test-leaf'});host.createDiv();host.createDiv();
	const plugin={settings:{...structuredClone(DEFAULT_SETTINGS),fontFamily:'Arial',enableTypewriterScrolling:false,enableSmartInput:false},
		projectContext:{getProjectForFile:()=>({id:'test'})},toolbarManager:{mountPagedToolbar(){},removeToolbarFromLeaf(){},refreshToolbar(){},refreshToolbarSelection(){}},
		notifyPagedEditorChanged(){},updateCharCountDebounced(){},async saveData(){}};
	const deviceSettings=new Map();
	const view=new PagedWritingView({containerEl:host,app:{scope:{},workspace,
		loadLocalStorage:key=>deviceSettings.get(key),saveLocalStorage:(key,value)=>deviceSettings.set(key,value)}},plugin);
	const prefix='---\n제목: 보존\n---\n',source=prefix+('첫 문장\n\n').repeat(200),file=view.file;
	let markdown=source,broadcasts=0;
	const native=workspace.on('quick-preview',(changed,text)=>{if(changed===file){markdown=text;broadcasts++;}});
	await view.onOpen();view.setViewData(source,true);
	try {
		let expected=view.getEditableData();
		for(let index=0;index<70;index++) {
			const end=expected.length;view.placeCaretInPage(view.findPageIndex(end),end,false);
			view.editRootEl.dispatchEvent(new InputEvent('beforeinput',{inputType:'deleteContentBackward',bubbles:true,cancelable:true}));expected=expected.slice(0,-1);
			assert(view.getEditableData()===expected,'A real Backspace input did not delete one source character');
			assert(markdown===prefix+expected,'Paged backspace left the peer Markdown buffer stale');
		}
		assert(broadcasts===70,'Live updates were dropped or recursively rebroadcast');
		view.data=source;
		assert(view.getViewData()===prefix+expected,'An in-flight old save snapshot resurrected deleted text');
		const next=prefix+'마크다운에서 수정\n'+expected;workspace.trigger('quick-preview',file,next);
		assert(view.getViewData()===next&&markdown===next,'Native Markdown changes did not reach the paged live buffer');
		workspace.trigger('quick-preview',{path:'other.md'},'다른 노트');assert(view.getViewData()===next,'Another file replaced this document');
		view.setViewData(source,true);view.gridColumns=1;
		let tested=false;
		for(let index=0;index<view.pages.length-1;index++) {
			view.renderPageIfNeeded(index);
			const runs=view.pageTextEls[index].querySelectorAll('.wm-paged-text-run'),run=runs[runs.length-1];
			if(!run?.classList.contains('is-empty'))continue;
			const position=Number(run.dataset.from);if(position!==view.pages[index].to-1)continue;
			view.placeCaretInPage(index,position,false);
			const right=new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true});view.editRootEl.dispatchEvent(right);
			assert(right.defaultPrevented&&view.readSelection().head===position+1,'Empty page boundary still consumes an extra Right press');
			view.placeCaretInPage(index,position,false);
			const down=new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true});view.editRootEl.dispatchEvent(down);
			assert(down.defaultPrevented&&view.cachedSelectionPageIndex===index+1,'Empty last line still needs two Down presses');tested=true;break;
		}
		assert(tested,'The page-boundary fixture lacks a trailing blank line');
		await runPagedBoundaryChecks(view, plugin);
		const repeated='평범한 시작 문장입니다. '.repeat(4)+('Wide WWW iii 한글 문장입니다. ').repeat(180);
		const cachedEngine=new PaginationEngine(view.measurerEl,view.getPaginationGeometry());
		for (const from of [60,180,300,120]) {
			const formats=[{from,to:from+90,kind:'bold'}];cachedEngine.updateInlineFormats(formats);
			const freshEngine=new PaginationEngine(view.measurerEl,view.getPaginationGeometry());freshEngine.updateInlineFormats(formats);
			assert(JSON.stringify(cachedEngine.paginate(repeated))===JSON.stringify(freshEngine.paginate(repeated)),'Repeated text reused page measurements with different later inline formatting');
		}
		const formattedSource=prefix+'__굵게__ <span style="color: #ff0000">빨강</span> ==강조== <u>밑줄</u>';
		view.setViewData(formattedSource,true);
		assert(view.getEditableData()==='굵게 빨강 강조 밑줄','Paged canvas exposed inline Markdown markers');
		assert(view.getViewData()===formattedSource,'Opening a formatted document rewrote its original syntax');
		assert(view.pageTextEls[0].querySelector('[style*="font-weight: 700"]'),'Parsed bold did not reach the DOM');
		assert(view.pageTextEls[0].querySelector('[style*="color: rgb(255, 0, 0)"]'),'Parsed text color did not reach the DOM');
		assert(view.pageTextEls[0].querySelector('[style*="var(--highlight-background, var(--text-highlight-bg))"]'),'Highlight did not use the Obsidian theme variable');
		const projectedAdapter=view.getEditorAdapter();
		assert(projectedAdapter.getValue()===view.getEditableData()&&projectedAdapter.posToOffset({line:0,ch:3})===3,'Editor adapter mixed source and visible coordinates');
		const documentAdapter=getWritingDocumentForView(view),sourceColorFrom=formattedSource.indexOf('빨강');
		documentAdapter.select(formattedSource,sourceColorFrom,sourceColorFrom+2);
		assert(view.getSelectedText()==='빨강','Source-based snapshot/diff navigation selected raw markup offsets on the visible canvas');
		const legacyBackground=prefix+'<span style="background-color: #abcdef">강조</span>';
		view.setViewData(legacyBackground,true);view.restoreSelection({anchor:0,head:2},true);view.toggleFormatFromToolbar('bold');view.undo();
		assert(view.getViewData()===legacyBackground,'Undo rewrote the original legacy highlight spelling');
		view.setViewData(prefix+'하나 둘 셋',true);view.restoreSelection({anchor:0,head:2},true);
		view.toggleFormatFromToolbar('bold');
		assert(markdown===prefix+'**하나** 둘 셋','Toolbar formatting did not broadcast Markdown to the peer view');
		view.undo();assert(view.getViewData()===prefix+'하나 둘 셋','Format-only undo failed');
		view.redo();assert(view.getViewData()===prefix+'**하나** 둘 셋','Format-only redo failed');
		view.restoreSelection({anchor:3,head:4},true);view.applyTextColorFromToolbar('#ff0000','text');
		assert(markdown.includes('<span style="color: #ff0000">둘</span>'),'Paged text color stayed in settings');
		view.restoreSelection({anchor:5,head:6},true);view.applyTextColorFromToolbar('#123456','background');
		assert(markdown.endsWith('==셋=='),'Background toolbar action did not write native highlight markup');
		view.applyTextColorFromToolbar('#654321','background');assert(!view.getViewData().includes('=='),'Highlight did not toggle off');
		for (const [color, marker] of [['red','🔴'],['orange','🟠'],['yellow','🟡'],['green','🟢'],['blue','🔵'],['purple','🟣']]) {
			view.restoreSelection({anchor:5,head:6},true);view.applyTextColorFromToolbar(color,'background');
			assert(view.getViewData().endsWith(`==${marker}셋==`),'Colored highlight did not use native source markup');
			assert(view.pageTextEls[0].querySelector(`[style*="var(--highlight-background-${color})"]`),'Colored highlight did not use the native theme color');
			view.undo();assert(!view.getViewData().includes('=='),'Highlight undo lost the previous color');
			view.redo();assert(view.getViewData().endsWith(`==${marker}셋==`),'Highlight redo lost its color');
			view.setViewData(view.getViewData(),true);assert(view.getEditableData()==='하나 둘 셋','Reload exposed the highlight color marker');
			view.restoreSelection({anchor:5,head:6},true);view.applyTextColorFromToolbar(color==='red'?'blue':'red','background');
			assert(view.getViewData().endsWith(`==${color==='red'?'🔵':'🔴'}셋==`),'Choosing another color removed the highlight');
			view.applyTextColorFromToolbar('','background');assert(view.getViewData().endsWith('==셋=='),'Default highlight did not replace the selected color');
			view.applyTextColorFromToolbar('','background');assert(!view.getViewData().includes('=='),'Default highlight did not toggle off');
		}
		const beforeSnapshot=view.getViewData(), styledSnapshot=prefix+'__새 원문__\n==강조==';
		view.replaceSourceSnapshot(beforeSnapshot,styledSnapshot);
		assert(view.getEditableData()==='새 원문\n강조'&&view.getViewData()===styledSnapshot,'Snapshot replacement failed to parse text and formatting together');
		view.undo();assert(view.getViewData()===beforeSnapshot,'Snapshot undo lost source spelling or formatting');
		view.redo();assert(view.getViewData()===styledSnapshot,'Snapshot redo lost source spelling or formatting');
		assert(!plugin.settings.pagedInlineFormats?.[file.path]&&!plugin.settings.pagedTextColors?.[file.path],'New inline formatting was written to settings');
		console.info('Inline Markdown DOM styles, live exchange, visible adapter offsets, highlight toggle and format/snapshot undo-redo passed');
		const batchSource = prefix+'첫 문장\n보존할 문장\n마지막 문장';
		view.setViewData(batchSource,true);
		const adapter=view.getEditorAdapter();
		adapter.transaction({changes:[{from:{line:0,ch:0},to:{line:0,ch:1},text:'수정한 첫'},{from:{line:2,ch:0},to:{line:2,ch:3},text:'새 마지막'}]});
		const batchResult=view.getViewData();
		assert(view.undoStack.length===1&&batchResult.includes('보존할 문장'),'Paged batch edits did not form one history entry');
		view.undo();assert(view.getViewData()===batchSource,'One paged undo did not restore both edits');
		view.redo();assert(view.getViewData()===batchResult,'Paged batch redo was not exact');
		const changedProperties='---\n제목: 새 속성\n---\n새 시작\n보존할 문장\n새 끝';
		view.replaceSourceSnapshot(batchResult,changedProperties);
		assert(view.getViewData()===changedProperties,'Full-source snapshot replacement lost properties or body');
		view.undo();assert(view.getViewData()===batchResult,'Snapshot undo did not restore the old properties with the body');
		view.redo();assert(view.getViewData()===changedProperties,'Snapshot redo did not restore the new properties with the body');
		// Markdown view round trip: properties (e.g. writing time) grow while the
		// paged view is unloaded, then the file is reopened with clear=true.
		const alignedBody='가\n나\n다';
		view.setViewData('---\n시간: 0:00:05\n---\n'+alignedBody,true);
		view.restoreSelection({anchor:2,head:2},true);view.applyParagraphAlignment('center');
		assert(view.getParagraphAlignments().some(item=>item.from===2&&item.align==='center'),'Fixture alignment was not applied');
		view.clear();
		view.setViewData('---\n시간: 0:00:05\n작업 시간: 1:23:45\n---\n'+alignedBody,true);
		const reopened=view.getParagraphAlignments();
		assert(reopened.length===1&&reopened[0].from===2&&reopened[0].align==='center',`Paragraph alignment drifted after properties changed outside the paged view: ${JSON.stringify(reopened)}`);
		view.clear();view.setViewData(alignedBody,true);
		assert(view.getParagraphAlignments()[0]?.from===2,'Removing properties outside the paged view lost paragraph alignment');
		console.info('Paged paragraph alignment survives Markdown-view property changes and reopening');
		const savedSmartQuotes = plugin.settings.enableSmartQuotes;
		plugin.settings.enableSmartQuotes = true;
		for (const [straight, open, close] of [['"','“','”'], ["'",'‘','’']]) {
			view.setViewData('',true);view.placeCaretInPage(0,0,false);
			const input = text => view.editRootEl.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:text,bubbles:true,cancelable:true}));
			input(straight);assert(view.getEditableData()===open+close,'Paged quote conversion lost native automatic closing');
			input('한글');input(straight);
			assert(view.getEditableData()===open+'한글'+close&&view.readSelection().head===4,'Paged closing quote duplicated its closer or lost the Korean text');
			view.setViewData('선택',true);view.restoreSelection({anchor:0,head:2},true);input(straight);
			assert(view.getEditableData()===open+'선택'+close,'Paged quote conversion lost native selection wrapping');
		}
		plugin.settings.enableSmartQuotes = false;
		view.setViewData('',true);view.placeCaretInPage(0,0,false);
		view.editRootEl.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:'"',bubbles:true,cancelable:true}));
		assert(view.getEditableData()==='""','Disabling smart quotes disabled native automatic closing');
		view.app.vault={getConfig:()=>false};plugin.settings.enableSmartQuotes=true;
		view.setViewData('',true);view.placeCaretInPage(0,0,false);
		view.editRootEl.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:'"',bubbles:true,cancelable:true}));
		assert(view.getEditableData()==='“','Paged quotes ignored the disabled native automatic closing setting');
		plugin.settings.enableSmartQuotes = savedSmartQuotes;
		console.info('Paged smart quote glyphs, native automatic-closing setting, Korean text, wrapping and disabling passed');
		view.setViewData(source,true);
		let disk=source;const backups=new Map(),folders=new Set();
		view.app.vault={async read(){return disk;},async process(file,action){disk=action(disk);return disk;},adapter:{
			async exists(path){return folders.has(path)||backups.has(path);},async mkdir(path){folders.add(path);},
			async write(path,text){backups.set(path,text);},async read(path){return backups.get(path);}}};
		deviceSettings.set(`writing-menu:paged-zoom:${file.path}`,1.6);
		await view.onLoadFile(file);assert(view.zoom===1.6,'Reopening a document reset its device-local zoom');
		const legacyPrefix='---\n옛 속성: 값\n---\n', legacyBody='**가나** 다라';
		plugin.settings.pagedTextColors[file.path]=[{from:legacyPrefix.length+2,to:legacyPrefix.length+4,color:'#123456'}];
		plugin.settings.pagedInlineFormats[file.path]=[{from:legacyPrefix.length+7,to:legacyPrefix.length+9,kind:'underline'}];
		plugin.settings.pagedTextBackgrounds[file.path]=[{from:legacyPrefix.length+7,to:legacyPrefix.length+9,color:'#abcdef'}];
		plugin.settings.pagedStyleFrontmatterLengths[file.path]=legacyPrefix.length;
		view.fileStore.dispose();view.fileStore=null;view.clear();disk=prefix+legacyBody;await view.onLoadFile(file);
		assert(view.getEditableData()==='가나 다라'&&view.getTextColorRanges()[0]?.from===0,'Legacy source offsets were not projected through Markdown and old properties');
		const process=view.app.vault.process;view.app.vault.process=async()=>{throw new Error('simulated write failure');};
		let failed=false;try{await view.save();}catch{failed=true;}
		assert(failed&&plugin.settings.pagedTextColors[file.path]?.length,'Failed migration save discarded the legacy settings');
		view.app.vault.process=process;await view.save();
		// The legacy highlight overlaps the underline (HTML), so it is written as <mark>, not ==.
		assert(disk.includes('<span style="color: #123456">')&&disk.includes('<mark ')&&disk.includes('<u>'),'Migration did not write all legacy inline styles to Markdown');
		assert(!plugin.settings.pagedTextColors[file.path]&&!plugin.settings.pagedTextBackgrounds[file.path]&&!plugin.settings.pagedInlineFormats[file.path],'Successful migration retained duplicate settings');
		disk=source;await view.fileStore.refresh();
		console.info('Legacy formatting migration maps old frontmatter/source offsets and preserves settings until the file save succeeds');
		view.setZoom(0.7);assert(deviceSettings.get(`writing-menu:paged-zoom:${file.path}`)===0.7,'Zoom changes were not persisted per document');
		view.placeCaretInPage(0,0,false);view.editRootEl.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
		const composingRun=view.pageTextEls[0].querySelector('.wm-paged-text-run');composingRun.firstChild.nodeValue+='입력중';
		const caret=composingRun.firstChild;document.getSelection().setBaseAndExtent(caret,caret.length,caret,caret.length);
		view.editRootEl.dispatchEvent(new InputEvent('input',{inputType:'insertCompositionText',isComposing:true,bubbles:true,data:'입력중'}));
		await view.save();assert(disk.includes('입력중'),'An explicit save dropped the unfinished IME DOM buffer');
		view.editRootEl.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'입력중'}));
		view.applyEdit(0,3,'','delete');const edited=view.getViewData();await view.save();
		assert(disk===edited,'View lifecycle did not save the actual editing buffer');
		disk=source+'휴대폰 변경';workspace.trigger('quick-preview',file,disk);
		assert(view.getViewData()===edited,'An inactive Markdown Sync echo bypassed disk conflict protection');
		await view.fileStore.refresh();
		assert(view.getViewData()===disk&&!view.fileStore.hasConflict,'A clean reader did not follow a confirmed disk change');
		view.applyEdit(0,3,'새 편집','other');disk='동시에 바뀐 외부 문서';await view.fileStore.refresh();
		assert(view.fileStore.hasConflict&&backups.size===2&&view.conflictBanner,'A dirty reader failed to preserve both conflicting versions');
		await view.onUnloadFile(file);assert(!view.fileStore&&backups.size===2,'Unloading a conflicted file discarded its recovery copies');
		console.info('Paged live Markdown exchange, 70 Backspaces, stale-save isolation, file scope and blank-boundary Right/Down passed');
	} finally {await view.onClose();workspace.offref(native);host.remove();assert(callbacks.size===0,'Live-document subscription leaked');}
}
