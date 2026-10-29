import { PagedWritingView } from '../src/paged/PagedWritingView';
import { DEFAULT_SETTINGS } from '../src/types';
import { runPagedStoreChecks } from './verify-paged-store.mjs';
import { runPagedBoundaryChecks } from './verify-paged-boundaries.mjs';
import { runEditorScrollingChecks } from './verify-editor-scrolling.mjs';
import { installNativePagedInputChecks } from './verify-paged-native-input.mjs';

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
