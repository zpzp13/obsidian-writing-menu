import { Component, MarkdownView, Platform, TFile } from 'obsidian';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import { DEFAULT_SETTINGS } from '../src/types';
import { compareSnapshot, restoreSnapshotHunks } from '../src/snapshots/PartialRestore';
import { ManuscriptSnapshotRepository } from '../src/snapshots/ManuscriptSnapshotRepository';
import { ManuscriptSnapshotModal } from '../src/snapshots/ManuscriptSnapshotModal';
import { getWritingDocument, initializeWritingDocuments } from '../src/writing/WritingDocument';
import { analyzeParagraphs, classifyParagraph } from '../src/repetition/ParagraphAnalysis';
import { RevisionPanel } from '../src/repetition/RevisionPanel';
import { RevisionDashboard } from '../src/repetition/RevisionDashboard';
import { migrateDashboardSettings } from '../src/settings/migrateDashboardSettings';
import { AiChatStorage } from '../src/aichat/AiChatStorage';
import { AiChatRequest } from '../src/aichat/AiChatRequest';
import { AiChatPanel } from '../src/aichat/AiChatPanel';
import { ragIndex } from '../src/aichat/rag/RagIndexService';
import { renderRagSettings } from '../src/aichat/rag/RagSettings';
import { readGeminiStream } from '../src/aichat/ChatStream';
import { isChatSessionId } from '../src/aichat/AiChatStorage';
import { lengthBuckets, rhythmBins } from '../src/repetition/RevisionCharts';
import { snapshotTarget } from '../src/snapshots/SnapshotManager';
import { PlotWorkbookView } from '../src/plot-workbook/PlotWorkbookView';
import { runPagedDocumentChecks } from './verify-paged-document.mjs';
import { runWorktimePaletteChecks } from './verify-worktime-palette.mjs';
import { verifySnapshotStatus } from './verify-snapshot-status.mjs';
import { verifyChatAvatars } from './verify-chat-avatar.mjs';

export async function runDashboardCoreChecks() {
	const assert = (value, message) => { if (!value) throw new Error(message); };
	const settle = () => new Promise(resolve => setTimeout(resolve, 25));
	await verifyChatAvatars(assert, settle);
	const expectReject = async (action, label) => { let rejected = false; try { await action(); } catch { rejected = true; } assert(rejected,label); };
	// Every subset must reconstruct exactly, including terminal blank lines and CRLF.
	for (const [before,current] of [['old\nkeep\nremoved\nlast','new\nkeep\nlast\nadded'],['','one\n'],['one\n',''],['A\r\nold\r\nB\r\n','A\r\nnew\r\nB\r\n'],['😀\n\n끝\n','😃\n끝\n']]) {
		const comparison = compareSnapshot(before,current), changed = comparison.hunks.flatMap((hunk,index) => hunk.type === 'equal' ? [] : [index]);
		assert(restoreSnapshotHunks(comparison,new Set(changed)) === before,'Restoring all change blocks is not byte-exact');
		assert(restoreSnapshotHunks(comparison,new Set()) === current,'Empty partial restore changed the document');
		for (const index of changed) { const hunk = comparison.hunks[index], lines = current ? current.split('\n') : []; lines.splice(hunk.bStart,hunk.bLines.length,...hunk.aLines); assert(restoreSnapshotHunks(comparison,new Set([index])) === lines.join('\n'),'Partial restore touched an unselected change'); }
	}
	const settings = {versionStoragePath:'Snapshots',versionMaxCount:35,versionStages:[{name:'검토',color:'#123456'}],versionToolbarAutoHide:true,repetitionVocabNotePath:'user.md',aiImageOpenaiApiKey:'test-only',aiEpisodeModel:'old',aiChatApiKey:'keep-test-key'};
	assert(migrateDashboardSettings(settings) && settings.snapshotStoragePath === 'Snapshots' && settings.snapshotMaxCount === 35 && settings.aiChatApiKey === 'keep-test-key' && !('aiImageOpenaiApiKey' in settings) && !('versionStages' in settings),'Dashboard settings migration lost supported values or kept retired settings');
	const makeVault = () => {
		const files = new Map(), folders = new Set(), events = new Map(); let fail = null;
		const adapter = {
			async exists(path) { return files.has(path)||folders.has(path); }, async mkdir(path) { folders.add(path); },
			async read(path) { if (!files.has(path)) throw new Error('missing '+path); return files.get(path); },
			async write(path,text) { if (fail?.(path)) throw new Error('simulated write failure'); files.set(path,text); }, async remove(path) { files.delete(path); },
			async process(path, action) { if (!files.has(path)) throw new Error('missing '+path); files.set(path, await action(files.get(path))); },
			async rename(before,after) { if (files.has(after)||folders.has(after)) throw new Error('rename target exists'); for (const [key,text] of [...files]) if (key===before||key.startsWith(before+'/')) { files.set(after+key.slice(before.length),text);files.delete(key); } for(const key of [...folders]) if(key===before||key.startsWith(before+'/')) { folders.add(after+key.slice(before.length));folders.delete(key); } },
			async list(directory) { return {files:[...files.keys()].filter(path=>path.startsWith(directory+'/')&&!path.slice(directory.length+1).includes('/')),folders:[...folders].filter(path=>path.startsWith(directory+'/')&&!path.slice(directory.length+1).includes('/'))}; },
		};
		return {adapter,files,folders,events,setFailure(action) {fail=action;},on(name,action) { const ref={name,action,off:()=>events.delete(ref)};events.set(ref,action);return ref;},offref(ref){events.delete(ref);},getMarkdownFiles(){return [];},getAbstractFileByPath(){return null;}};
	};
	const vault = makeVault(), plugin = {app:{vault},settings:structuredClone(DEFAULT_SETTINGS)};
	const repository = new ManuscriptSnapshotRepository(plugin,'Project/Manuscript.md');
	const oldSource = '첫 문장\n\n남길 문장\n\n원래 마지막', currentSource = '수정한 첫 문장\n\n남길 문장\n\n새 마지막';
	const first = await repository.save('첫 기록',oldSource);
	await Promise.all([repository.save('동시 1','one'),repository.save('동시 2','two')]);
	const longBefore=Array.from({length:10000},(_,index)=>'원고 '+index).join('\n'), longLines=longBefore.split('\n'); longLines[50]='수정 앞'; longLines[9500]='수정 뒤'; const longComparison=compareSnapshot(longBefore,longLines.join('\n'));
	assert(longComparison.hunks.filter(hunk=>hunk.type!=='equal').length===2,'Large manuscript diff collapsed distant edits into one block');
	assert((await repository.list()).length === 3 && await repository.read(first) === oldSource,'Serialized snapshot saves lost data');
	await repository.update(first.id,{pinned:true,description:'보존'});
	const manifestPath = repository.directory+'/manifest.json', validManifest = vault.files.get(manifestPath);
	vault.files.set(manifestPath,'{broken'); await expectReject(()=>repository.save('bad','bad'),'Corrupt snapshot manifest was overwritten'); assert(vault.files.get(manifestPath)==='{broken','Corrupt manifest was changed'); vault.files.set(manifestPath,validManifest);
	vault.setFailure(path=>path.endsWith('manifest.json')); await expectReject(()=>repository.save('실패','keep'),'Failed manifest write was not reported'); vault.setFailure(null); assert(await repository.read(first)===oldSource,'Failed save deleted the selected record');
	const renameRepo=new ManuscriptSnapshotRepository(plugin,'Project/Old.md'), renameEntry=await renameRepo.save('이전 제목','보존 원고'); await renameRepo.rebind('Project/New.md'); const rebound=new ManuscriptSnapshotRepository(plugin,'Project/New.md'); assert((await rebound.list())[0].id===renameEntry.id&&await rebound.read(renameEntry)==='보존 원고','Renaming a manuscript detached its snapshot history');
	await rebound.remove(renameEntry); assert(!(await rebound.list()).length&&[...vault.files].some(([path,text])=>path.includes('/removed/')&&text==='보존 원고'),'Explicit snapshot deletion did not keep a recoverable copy');
	// A real CM6 history must isolate multi-range restoration from preceding/following typing.
	const host = document.body.createDiv(), callbacks = new Map(); let recent;
	const workspace = {getMostRecentLeaf:()=>recent,getLeavesOfType:type=>type==='markdown'?[recent]:[],on(name,action){const ref={name,action,off:()=>callbacks.delete(ref)};callbacks.set(ref,action);return ref;},offref(ref){callbacks.delete(ref);},async openLinkText(){}};
	const app = {vault,workspace,metadataCache:{getFileCache:()=>({frontmatter:{}})}};
	const leaf = {containerEl:host,app}, view = new MarkdownView(leaf); view.file={path:'Project/Manuscript.md',basename:'Manuscript'}; recent={view};
	const cm = new EditorView({parent:host,state:EditorState.create({doc:currentSource,extensions:[history()]})});
	view.editor = {cm,getValue:()=>cm.state.doc.toString(),offsetToPos(offset){const line=cm.state.doc.lineAt(offset);return {line:line.number-1,ch:offset-line.from};},getSelection:()=>'',transaction(){throw new Error('CM-backed restore must use isolated native history');},focus(){cm.focus();},setSelection(){},scrollIntoView(){}};
	const documentPlugin = {...plugin,app,registerEvent(ref){this.refs??=[];this.refs.push(ref);},projectContext:{getProjectForFile:()=>({rootFolder:'Project',manuscriptFolder:'Project',characterFolder:'Project/Characters'})}};
	const commandPlugin = {...documentPlugin,projectContext:{getProjectForFile:file=>file.path.startsWith('Project/')?{id:'project'}:null,getProjects:()=>[{id:'project'}]}};
	assert(snapshotTarget(commandPlugin,{view})?.kind==='manuscript','Snapshot command did not resolve the explicit manuscript');
	assert(snapshotTarget(commandPlugin,{view:{}})===null,'Snapshot command fell back to a remembered manuscript from an unrelated view');
	const plotView=Object.create(PlotWorkbookView.prototype);plotView.getState=()=>({projectId:'project'});
	assert(snapshotTarget(commandPlugin,{view:plotView})?.kind==='plot','Snapshot command did not resolve the active plot project');
	const originalPath=view.file.path;view.file.path='Outside/note.md';assert(snapshotTarget(commandPlugin,{view})===null,'Snapshot command escaped the project scope');view.file.path=originalPath;
	initializeWritingDocuments(documentPlugin);
	const writing = getWritingDocument(documentPlugin); assert(writing && writing.read()===currentSource,'Shared adapter did not read the current editor');
	cm.dispatch({changes:{from:cm.state.doc.length,insert:'!'}}); const withTyping=writing.read();
	writing.replace(withTyping,oldSource); assert(writing.read()===oldSource,'Native snapshot replacement failed');
	assert(undo(cm)&&writing.read()===withTyping,'One native undo did not restore every selected block');
	assert(undo(cm)&&writing.read()===currentSource,'Snapshot undo merged preceding typing');
	assert(redo(cm)&&redo(cm)&&writing.read()===oldSource,'Native redo did not reproduce restoration');
	await expectReject(async()=>writing.replace(currentSource,'wrong'),'Stale writing snapshot was accepted');
	cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:currentSource}});
	const modalPlugin={...documentPlugin,settings:structuredClone(DEFAULT_SETTINGS)};
	const repoModal = new ManuscriptSnapshotRepository(modalPlugin,view.file.path); const saved=await repoModal.save('테스트 스냅샷',oldSource);
	const modal = new ManuscriptSnapshotModal(modalPlugin,getWritingDocument(modalPlugin)).open(); await settle();
	const toggle = modal.contentEl.querySelector('.wm-snapshot-compare-label input'); toggle.checked=true;toggle.dispatchEvent(new Event('change'));
	const blocks=modal.contentEl.querySelectorAll('.wm-snapshot-change'); assert(blocks.length===2,'Manuscript modal does not expose independent changed blocks');
	assert(!modal.contentEl.textContent.includes('다시 비교')&&!modal.contentEl.textContent.includes('이 부분 복원')&&!modal.contentEl.textContent.includes('선택한 스냅샷 →'),'Removed snapshot controls remain');
	assert(modal.contentEl.querySelector('.wm-manuscript-snapshot-actions [aria-label="스냅샷 고정 전환"]'),'Snapshot pin is not in the sidebar footer');
	assert(!modal.modalEl.classList.contains('wm-snapshot-manager')&&!modal.contentEl.querySelector('.setting-item'),'Manuscript modal still inherits plot or Setting row layout');
	const inputBounds=modal.contentEl.querySelector('.search-input-container input').getBoundingClientRect(),copyBounds=[...modal.contentEl.querySelectorAll('.modal-setting-titlebar-actions button')].find(button=>button.textContent==='복사').getBoundingClientRect();
	assert(Math.abs(inputBounds.top+inputBounds.height/2-copyBounds.top-copyBounds.height/2)<2,'Snapshot search and header controls are not vertically centered');
	const checkboxBounds=blocks[0].querySelector('input').getBoundingClientRect(),blockBounds=blocks[0].getBoundingClientRect();
	assert(checkboxBounds.left>blockBounds.left+blockBounds.width/2&&checkboxBounds.right<=blockBounds.right+1&&checkboxBounds.top>=blockBounds.top,'Diff selection checkbox is not inside the changed block on the right');
	modal.selected.name='아주 긴 스냅샷 제목 '.repeat(30);modal.renderDetail();
	const titleBounds=modal.contentEl.querySelector('.modal-setting-title').getBoundingClientRect(),actionsBounds=modal.contentEl.querySelector('.modal-setting-titlebar-actions').getBoundingClientRect(),closeBounds=modal.closeButtonEl.getBoundingClientRect();
	assert(titleBounds.right<=actionsBounds.left+1&&actionsBounds.right<=closeBounds.left+1,'Long snapshot title overlaps actions or close button');
	const activeBlocks=modal.contentEl.querySelectorAll('.wm-snapshot-change');
	const selectFirst=activeBlocks[0].querySelector('input');selectFirst.checked=true;selectFirst.dispatchEvent(new Event('change'));
	modal.contentEl.querySelector('.wm-snapshot-restore-selected').click(); await settle();
	assert(writing.read().startsWith('첫 문장')&&writing.read().endsWith('새 마지막'),'Partial restore rewrote an unselected block');
	assert((await repoModal.list()).some(entry=>entry.backup),'Partial restore did not save a recovery snapshot');
	const beforeStale=writing.read(); cm.dispatch({changes:{from:cm.state.doc.length,insert:'도중 입력'}});
	const selectNext=modal.contentEl.querySelector('.wm-snapshot-change input');selectNext.checked=true;selectNext.dispatchEvent(new Event('change'));
	modal.contentEl.querySelector('.wm-snapshot-restore-selected').click(); await settle();
	assert(writing.read()===beforeStale+'도중 입력'&&modal.contentEl.querySelector('.wm-snapshot-error').textContent.includes('변경'),'Modal applied stale change offsets'); modal.close();
	const emptyModal = new ManuscriptSnapshotModal(modalPlugin,{...writing,path:'Project/Empty.md'}).open();await settle();
	const emptySearch=emptyModal.contentEl.querySelector('.search-input-container input').getBoundingClientRect(),emptyCopy=[...emptyModal.contentEl.querySelectorAll('.modal-setting-titlebar-actions button')].find(button=>button.textContent==='복사').getBoundingClientRect();
	assert(Math.abs(emptySearch.top+emptySearch.height/2-emptyCopy.top-emptyCopy.height/2)<2,'Empty snapshot header is misaligned');emptyModal.close();
	await verifySnapshotStatus(modalPlugin, writing, assert, settle);
	// Paragraph extraction must not count Markdown URLs, properties or page wrapping.
	const options=structuredClone(DEFAULT_SETTINGS.paragraphAnalysis);
	const paragraphSource='---\ntitle: 제외\n---\n# 장 제목\n\n“안녕.” 그가 말했다.\n\n‘속마음’\n[시스템 알림]\n[[인물|민수]]가 [길](https://example.test/long-address)로 갔다.\n\n```ts\n제외 코드\n```\n😀';
	const paragraphs=analyzeParagraphs(paragraphSource,options);
	assert(paragraphs.units.length===5&&paragraphs.counts.dialogue===1&&paragraphs.counts.monologue===1&&paragraphs.counts.special===1&&paragraphs.counts.narration===2,'Paragraph quote/Markdown classification is wrong');
	assert(paragraphs.units[3].text==='민수가 길로 갔다.'&&paragraphs.units[4].chars===1,'Markdown URL masking or Unicode counts are wrong');
	assert(paragraphs.analysisText.length===paragraphSource.length&&paragraphs.analysisText.indexOf('민수')===paragraphSource.indexOf('민수'),'Morphology offsets no longer match original source');
	for(const text of ['“닫히지 않은 대사',"'Tis the season",'중간에 “인용”'])assert(classifyParagraph(text,options)==='narration','Ambiguous paragraph guessed dialogue');
	assert(analyzeParagraphs('한 줄\n두 줄\n\n세 줄',{...options,boundary:'block'}).units.length===2,'Markdown block boundary setting is ignored');
	// Real paged batch editing and frontmatter-aware undo share the existing lifecycle suite.
	await runPagedDocumentChecks();
	// New chat storage stays compatible, verified and serial; no real network is permitted.
	const chatVault=makeVault(), chatApp={vault:chatVault}, storage=new AiChatStorage(chatApp);
	const legacyKey=encodeURIComponent('Project/인물/이전.md'), legacyPath='.writing-menu-aichat/sessions/'+legacyKey+'.json';
	const legacyRaw=JSON.stringify({characterPath:'Project/인물/이전.md',messages:[{role:'user',content:'이전 대화',timestamp:1}],updatedAt:1});
	chatVault.folders.add('.writing-menu-aichat/sessions');chatVault.files.set(legacyPath,legacyRaw);
	chatVault.files.set('.writing-menu-aichat/sessions/undefined.json',legacyRaw);
	chatVault.files.set('.writing-menu-aichat/sessions/damaged.json','{broken');
	const legacyEntries=await storage.listSessions(), legacy=await storage.loadById(legacyKey);
	assert(legacyEntries.length===2&&legacy.id===legacyKey&&legacy.title==='이전'&&chatVault.files.get(legacyPath)===legacyRaw,'Legacy character-scoped chat was rejected or rewritten on read');
	assert(!isChatSessionId('../escape')&&!isChatSessionId('a\\b')&&!isChatSessionId(undefined)&&isChatSessionId(legacyKey),'Legacy ID support weakened path validation');
	await storage.save(legacy);assert(JSON.parse(chatVault.files.get(legacyPath)).id===legacyKey&&chatVault.files.get(legacyPath+'.bak')===legacyRaw,'Legacy save did not preserve a verified original backup');
	const session=await storage.createNewSession('Project/Characters/민수.md','민수');
	session.projectRoot='Project';
	const optionsChat={keys:{nvidia:'test-only',gemini:''},model:'google/diffusiongemma-26b-a4b-it',temperature:1,maxTokens:256,historyTurns:5,maxInputChars:5000,stream:false};
	let calls=0,failRequest=true,states=[];
	globalThis.mockChatRequest=async()=>{calls++;return failRequest?{status:503}:{status:200,json:{choices:[{message:{content:'[지문] 고개를 들었다. [대사] 안녕.'}}]}};};
	const requests=new AiChatRequest(storage), message={id:'user-1',role:'user',content:'안녕',timestamp:Date.now()};
	await requests.send(session,message,async()=>'고정한 문맥',optionsChat,state=>states.push(state));
	assert(calls===1&&session.messages.length===1&&!requests.isSending(session.id)&&states.at(-1).status==='error','Request failure left sending state or duplicated messages');
	failRequest=false; await requests.send(session,message,async()=>'고정한 문맥',optionsChat,state=>states.push(state),true);
	assert(calls===2&&session.messages.length===2&&session.messages.filter(item=>item.role==='user').length===1,'Retry appended the user turn twice');
	const original=JSON.stringify(session.messages), fork=await storage.fork(session,0);assert(fork.parentId===session.id&&fork.messages.length===1&&JSON.stringify(session.messages)===original,'Fork mutated original history');
	const failed=await storage.createNewSession('character.md','저장 실패'); chatVault.setFailure(path=>path.includes('/sessions/')); const countBefore=calls;
	await requests.send(failed,{id:'failed-user',role:'user',content:'입력 보존',timestamp:0},async()=>'context',optionsChat,()=>{});
	assert(calls===countBefore&&!requests.isSending(failed.id)&&failed.messages[0].content==='입력 보존','Storage failure sent an API request or lost the input');chatVault.setFailure(null);
	const late=await storage.createNewSession('character.md','중단'); let release;
	globalThis.mockChatRequest=()=>new Promise(resolve=>release=resolve);
	const pending=requests.send(late,{id:'stop-user',role:'user',content:'중단',timestamp:0},async()=>'context',optionsChat,state=>states.push(state));await settle();requests.stop(late.id);await pending;release({status:200,json:{choices:[{message:{content:'늦은 응답'}}]}});await settle();
	assert(late.messages.length===1&&!requests.isSending(late.id)&&states.at(-1).status==='stopped','Late response after stop was saved or kept the request busy');
	const chunks=['data: '+JSON.stringify({candidates:[{content:{parts:[{text:'안녕 😀'}]}}]})+'\r\n\r\n','data: '+JSON.stringify({candidates:[{content:{parts:[{text:' 이어짐'}]}}]})+'\n\n'];
	const bytes=new TextEncoder().encode(chunks.join('')), stream=new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}});
	let streamed='';assert(await readGeminiStream(stream,undefined,text=>streamed=text)==='안녕 😀 이어짐'&&streamed==='안녕 😀 이어짐','SSE split-frame/UTF-8 streaming corrupted the response');
	const corrupted=chatVault.files.get('.writing-menu-aichat/sessions/'+session.id+'.json');chatVault.files.set('.writing-menu-aichat/sessions/'+session.id+'.json','{broken');await expectReject(()=>storage.loadById(session.id),'Corrupt chat record was treated as an empty session');chatVault.files.set('.writing-menu-aichat/sessions/'+session.id+'.json',corrupted);
	delete globalThis.mockChatRequest;
	// Leave reproducible read-only UI previews for visual inspection.
	host.style.display='none';
	const demo=document.body.createDiv({cls:'dashboard-preview'}), revisionHost=demo.createEl('section'), chatHost=demo.createEl('section',{cls:'wm-chat-panel'});
	cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:'새벽의 문 앞이었다.\n\n“새벽부터 기다렸어.” 민수가 말했다.\n\n‘아직 끝난 게 아니야.’\n\n[남은 시간: 10분]\n\n민수는 대답 대신 문을 열었다.\n\n“새벽 공기가 차네.” 민수가 말했다.'}});
	const character=Object.assign(new TFile(),{path:'Project/Characters/민수.md',basename:'민수',extension:'md'});
	vault.getAbstractFileByPath=path=>path===character.path?character:null;vault.read=async()=> '말수가 적고 관찰력이 좋다.';
	const demoPlugin={...documentPlugin,settings:structuredClone(DEFAULT_SETTINGS),saveSettings:async()=>{},manifest:{id:'writing-menu'}};demoPlugin.settings.aiChatLastCharacterPath=character.path;
	demoPlugin.settings.aiChatLastSpeakerPath = character.path;
	// Legacy provider compatibility is a separate fixture; free Gemini consent/tools are verified by verify-rag-api.
	demoPlugin.settings.aiChatFreeOnly = false;
	demoPlugin.app.metadataCache.getFileCache = () => ({ frontmatter: { wikiColor: '#b45287' } });
	const revision=new RevisionPanel(revisionHost,demoPlugin);revision.load();await settle();
	const demoFile=revision.result.files[0]; demoFile.repetition={word:['민수','새벽'].map(text=>{const occurrences=[];let at=0;while((at=demoFile.source.indexOf(text,at))>=0){occurrences.push({start:at,end:at+text.length,pos:'NNP'});at+=text.length;}return {text,count:occurrences.length,occurrences};}),eojeol:[],eomi:[]}; revision.result.morph=true;revision.render();
	// Current Deus presentation is covered in depth by verify-deus-ui; retain an offline preview here.
	const project={id:'preview-project',name:'합성 프로젝트',rootFolder:'Project',manuscriptFolder:'Project/Manuscripts',characterFolder:'Project/Characters'};
	demoPlugin.settings.projects=[project];demoPlugin.registerHoverLinkSource=()=>{};
	demoPlugin.projectContext={getProjectForFile:file=>file?.path.startsWith('Project/')?project:null};
	const owner=new Component(),panel=new AiChatPanel(demoPlugin,owner);owner.load();
	const evidence={id:'preview-source',title:'민수 설정',path:character.path,kind:'character',text:'이 인물은 위기를 관찰한 뒤 신중하게 판단한다.',automatic:true};
	const deusSession={id:'offline-preview',mode:'deus',characterPath:'',projectRoot:'Project',title:'합성 대화',messages:[
		{id:'preview-question',role:'user',skill:'research',content:'판단 방식은?',timestamp:0,context:{version:1,projectRoot:'Project',sources:[evidence],warnings:[]}},
		{id:'preview-reply',role:'assistant',skill:'research',content:'위기를 먼저 관찰하고 신중하게 판단합니다.[1]',timestamp:1,citations:[{number:1,sourceId:evidence.id,quote:'',kind:'reference'}]},
	]};
	panel.session=deusSession;panel.deusProjectRoot='Project';await panel.render(chatHost);await settle();
	assert(chatHost.querySelector('.deus-container')&&chatHost.querySelector('.deus-citation-chip'),'Current Deus preview or citation is missing');
	await runRagSettingsControlsChecks();
	assert(revisionHost.querySelectorAll('.wm-revision-tiles > .wm-analysis-card').length===6,'Analysis dashboard tiles are missing');
	const palette=[
	 ['.is-sentence .wm-analysis-length-bar > rect','rgb(96, 188, 252)'],['.is-paragraph .wm-analysis-length-bar > rect','rgb(123, 117, 201)'],
	 ['.wm-analysis-donut-segment.is-narration','rgb(26, 209, 161)'],['.wm-analysis-donut-segment.is-monologue','rgb(217, 168, 230)'],
	 ['.wm-analysis-donut-segment.is-dialogue','rgb(254, 100, 125)'],['.wm-analysis-donut-segment.is-special','rgb(242, 197, 114)'],
	 ['.wm-analysis-repeat-bar > rect','rgb(255, 159, 107)']
	];
	const solidColor=element=>{
	 const fill=getComputedStyle(element).fill;
	 assert(!fill.includes('url(')&&!['none','rgb(0, 0, 0)','rgba(0, 0, 0, 0)'].includes(fill),'Chart has a gradient or unresolved fill');
	 return fill;
	};
	const verifyPalette=()=>{
	 const colors=palette.map(([selector,expected])=>{const actual=solidColor(revisionHost.querySelector(selector));assert(actual===expected,'Wrong reference color: '+selector);return actual;});
	 assert(new Set(colors).size===7,'Distinct Revision measures share a color');
	 for(const kind of ['narration','monologue','dialogue','special']){
	  const line=getComputedStyle(revisionHost.querySelector('.wm-analysis-flow-line.is-'+kind));
	  assert(line.stroke===solidColor(revisionHost.querySelector('.wm-analysis-donut-segment.is-'+kind))&&line.fill==='none'&&!line.stroke.includes('url('),'Flow is not solid or disagrees with composition: '+kind);
	 }
	 for(const kind of ['sentence','paragraph'])for(const label of revisionHost.querySelectorAll('.is-'+kind+' .wm-analysis-extreme-label'))assert(getComputedStyle(label).fill===getComputedStyle(revisionHost.querySelector('.is-'+kind+' .wm-dash-group-label')).color,'Extrema label color differs from its heading');
	};
	verifyPalette();document.body.classList.replace('theme-light','theme-dark');verifyPalette();document.body.classList.replace('theme-dark','theme-light');
	assert(revisionHost.querySelectorAll('.wm-analysis-length-chart').length===2&&revisionHost.querySelectorAll('.wm-analysis-flow-line').length===4,'Separate sentence/paragraph charts or four-series flow graph is missing');
	assert(revisionHost.querySelectorAll('.wm-analysis-donut-segment').length===4&&!revisionHost.querySelector('.is-composition select, .is-composition button, .is-composition .wm-analysis-value')&&revisionHost.querySelector('.is-composition .wm-dash-group-label').textContent==='구성 요소','Composition has retired controls or is missing its header');
	assert([...revisionHost.querySelectorAll('.wm-analysis-donut-legend > span')].map(item=>item.textContent).join('/')==='서술/독백/대사/특수 대사','Composition legend order or ratio removal is wrong');
	assert(!revisionHost.querySelector('.is-flow .wm-analysis-card-header, .wm-analysis-flow-legend, .is-flow .wm-analysis-footnote'),'Flow still has a redundant title, legend or description');
	assert([...revisionHost.querySelectorAll('.is-flow .wm-analysis-segment button')].map(button=>button.textContent).join('/')==='누적/구간'&&[...revisionHost.querySelectorAll('.is-repetition .wm-analysis-segment button')].map(button=>button.textContent).join('/')==='단어/어절/어미','Segmented choices are missing');
	assert([...revisionHost.querySelectorAll('.wm-revision-tiles > .wm-analysis-card')].map(card=>[...card.classList].find(name=>name.startsWith('is-'))).join('/')==='is-sentence/is-paragraph/is-composition/is-flow/is-repetition/is-details','Revision cards are not in the requested row pairs');
	assert(revisionHost.querySelector('.is-sentence .wm-dash-group-label').textContent==='평균 문장 길이'&&revisionHost.querySelector('.is-paragraph .wm-dash-group-label').textContent==='평균 문단 길이','Average chart titles are missing');
	assert(!revisionHost.querySelector('.wm-analysis-length-bar line, .is-sentence .wm-analysis-footnote, .wm-analysis-axis'),'Length whiskers or retired footnotes remain');
	assert(!revisionHost.querySelector('.wm-analysis-extrema')&&!revisionHost.textContent.includes('묘사')&&!revisionHost.textContent.includes('중앙값'),'Retired extrema labels, median or narration wording remains');
	for(const kind of ['sentence','paragraph']){
	 const labels=[...revisionHost.querySelectorAll('.is-'+kind+' .wm-analysis-extreme-label')];
	 assert(labels.length===2&&labels.map(label=>label.textContent).sort().join('/')==='최대/최소','Length extrema labels are missing or contain numbers');
	 for(const label of labels){const bars=revisionHost.querySelectorAll('.is-'+kind+' .wm-analysis-length-bar'),bin=Number(label.getAttribute('data-bin'));assert(bin>=0&&bin<bars.length,'Extrema label points outside its chart');}
	}
	assert(revisionHost.querySelector('.is-sentence .is-max').textContent==='최대 17자'&&revisionHost.querySelector('.is-sentence .is-min').textContent==='최소 8자','Length summary does not contain true min/max values');
	assert(getComputedStyle(revisionHost.querySelector('.is-sentence .is-max')).color==='rgb(0, 99, 0)'&&getComputedStyle(revisionHost.querySelector('.is-sentence .is-min')).color==='rgb(179, 38, 30)','Min/max summary is not using dashboard up/down colors');
	assert([...revisionHost.querySelectorAll('.wm-dash-group-marker')].every(marker=>getComputedStyle(marker).backgroundColor==='rgb(233, 104, 65)'),'Card header markers are not the default accent');
	assert(parseFloat(getComputedStyle(revisionHost.querySelector('.wm-analysis-value')).fontSize)<=52,'Metric numbers were not reduced');
	const scopeButton=revisionHost.querySelector('.wm-revision-scope'); assert(scopeButton.children.length===1&&getComputedStyle(scopeButton).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(scopeButton).borderTopWidth==='0px','Scope control is not an unframed icon');
	const sizes=[1,40,41,80,81,160,161,320,321].map(chars=>({chars}));assert(lengthBuckets(sizes).map(bucket=>bucket.items.length).join(',')==='2,2,2,2,1','Length bins overlap or drop paragraphs');
	const rhythm=rhythmBins(Array.from({length:10001},(_,index)=>({chars:index===5010?9999:10})));assert(rhythm.length<=100&&Math.max(...rhythm.map(bin=>bin.max))===9999,'Bounded rhythm aggregation hides long outliers');
	revisionHost.scrollTop=400; const detailScroll=revisionHost.scrollTop, sentenceNode=revisionHost.querySelector('.is-sentence');
	assert(detailScroll>0,'Scroll regression fixture has no scrolling');
	revisionHost.querySelector('.wm-analysis-repeat-bar').dispatchEvent(new MouseEvent('click',{bubbles:true}));assert(revisionHost.querySelectorAll('.wm-analysis-position-bars button').length===20,'Repetition position distribution is missing');
	assert(getComputedStyle(revisionHost.querySelector('.wm-analysis-position-bars button span')).backgroundImage==='none','Detail bars still have a gradient');
	assert(revisionHost.scrollTop===detailScroll&&revisionHost.querySelector('.is-sentence')===sentenceNode,'Detail selection rebuilt charts or reset the scroll position');
	assert(revisionHost.querySelector('.wm-revision-tiles > .is-details .wm-analysis-details'),'Repetition details are not the paired sixth card');
	assert(!revisionHost.querySelector('.is-details .wm-dash-group-marker')&&[...revisionHost.querySelectorAll('.wm-analysis-context-number')].map(item=>item.textContent).join('/')==='1/2/3'&&!revisionHost.querySelector('.wm-analysis-context .u-muted'),'Repetition details still show a marker or source/line metadata');
	for(const row of revisionHost.querySelectorAll('.wm-analysis-context')){
	 const preview=row.querySelector('div'),mark=preview.querySelector('mark');assert(mark&&mark.textContent==='민수','Excerpt changed the highlighted target');
	 assert(Array.from(preview.firstChild.textContent.replace(/^…/,'')).length<=10&&Array.from(preview.lastChild.textContent.replace(/…$/,'')).length<=10,'Excerpt exceeds ten characters on either side');
	}
	document.body.style.setProperty('--text-on-accent','#000');
	for(const selector of ['.is-sentence .wm-analysis-length-bar','.is-paragraph .wm-analysis-length-bar','.wm-analysis-flow-hit','.wm-analysis-repeat-bar','.wm-analysis-position-bars button']){
	 const target=revisionHost.querySelector(selector);target.dispatchEvent(new Event('pointerenter'));
	 const hint=target.closest('.wm-analysis-chart-host').querySelector('.wm-analysis-chart-tooltip');
	 assert(!hint.hidden&&hint.textContent&&hint.classList.contains('wm-wt-chart-tooltip')&&getComputedStyle(hint).color==='rgb(34, 34, 34)'&&getComputedStyle(hint).backgroundColor==='rgb(255, 255, 255)'&&!target.querySelector('title'),'Chart hover is not the working-time preview: '+selector);
	 assert(getComputedStyle(target).getPropertyValue('--no-tooltip').trim()==='true'&&target.getAttribute('aria-label'),'Native tooltip suppression removed accessibility or is missing: '+selector);
	 assert(target.closest('.wm-analysis-chart-host').querySelector('.wm-analysis-hover-line, .wm-analysis-hover-line-html'),'Chart hover is missing its vertical interval guide: '+selector);
	 target.dispatchEvent(new Event('pointerleave'));
	}
	document.body.style.removeProperty('--text-on-accent');
	const hoverOne=revisionHost.querySelector('.wm-analysis-length-bar'),hoverTwo=revisionHost.querySelector('.wm-analysis-position-bars button');
	hoverOne.dispatchEvent(new Event('focus'));hoverTwo.dispatchEvent(new Event('pointerenter'));
	assert(revisionHost.querySelectorAll('.wm-analysis-chart-tooltip:not([hidden])').length===1,'Keyboard focus and pointer hover show two custom previews');
	hoverTwo.dispatchEvent(new Event('pointerleave'));
	let nativeTooltipCount=0;const simulateNativeTooltip=event=>{const element=event.target.closest('[aria-label]');if(element&&getComputedStyle(element).getPropertyValue('--no-tooltip').trim()!=='true')nativeTooltipCount++;};
	document.addEventListener('pointerover',simulateNativeTooltip);
	for(const element of revisionHost.querySelectorAll('.wm-analysis-position-bars button,.wm-analysis-repeat-bar,.wm-analysis-flow-hit,.wm-analysis-donut-segment'))element.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
	document.removeEventListener('pointerover',simulateNativeTooltip);assert(nativeTooltipCount===0,'Obsidian aria-label tooltips are not suppressed for chart targets');
	const savedNavigate=revision.dashboard.actions.navigate; revision.dashboard.actions.navigate=async()=>{revisionHost.scrollTop=0;};
	revisionHost.querySelector('.wm-analysis-length-bar').dispatchEvent(new MouseEvent('click'));await settle();
	assert(revisionHost.scrollTop===detailScroll,'Source tracking reset Revision scroll');revision.dashboard.actions.navigate=savedNavigate;
	const donutNavigate=revision.dashboard.actions.navigate;let donutNavigation=0;revision.dashboard.actions.navigate=()=>{donutNavigation++;};
	const donutArc=revisionHost.querySelector('.wm-analysis-donut-segment.is-narration');donutArc.dispatchEvent(new Event('pointerenter'));donutArc.dispatchEvent(new MouseEvent('click'));await settle();
	assert(donutNavigation===0,'Composition still navigates to the manuscript');revision.dashboard.actions.navigate=donutNavigate;
	assert(revisionHost.querySelectorAll('.wm-analysis-donut-segment.is-selected').length===1&&donutArc.classList.contains('is-selected'),'Donut enlarges more than the selected segment');
	assert(revisionHost.querySelector('.wm-analysis-donut-chars').textContent==='28자'&&!revisionHost.querySelector('.wm-analysis-donut-host .wm-analysis-chart-tooltip'),'Donut has a tooltip or is missing selected character count');
	revisionHost.querySelector('.wm-analysis-donut-segment.is-monologue').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
	assert(revisionHost.querySelector('.wm-analysis-donut-kind').textContent==='독백'&&revisionHost.querySelector('.wm-analysis-donut-chars').textContent==='14자'&&revisionHost.querySelectorAll('.wm-analysis-donut-segment.is-selected').length===1,'Keyboard donut selection does not update central values');
	// Sample the actual SVG fill, not just CSS widths: a 71% arc must keep its hole at every angle.
	const donutFixtureHost=document.body.createDiv({cls:'wm-revision-root'});donutFixtureHost.style.width='600px';
	const donutFixture=new RevisionDashboard(donutFixtureHost,{scope(){},refresh(){},settings(){},navigate(){throw new Error('Donut navigated');}});
	const donutParts=[['narration',710],['monologue',40],['dialogue',225],['special',25]];
	const drawDonut=(parts)=>donutFixture.update({files:[{...demoFile,paragraphs:{...demoFile.paragraphs,units:parts.map(([kind,chars])=>({...demoFile.paragraphs.units[0],kind,chars}))}}],scope:'document',title:'도넛 회귀 검사',busy:false,morph:true});
	const inArc=(arc,turn,radius)=>{const angle=turn*Math.PI*2-Math.PI/2;return arc.isPointInFill(new DOMPoint(110+Math.cos(angle)*radius,110+Math.sin(angle)*radius));};
	const verifyDonutShape=(parts,selected)=>{
	 const total=parts.reduce((sum,[,chars])=>sum+chars,0);let offset=0;
	 for(const [kind,chars] of parts){
	  const arc=donutFixtureHost.querySelector('.wm-analysis-donut-segment.is-'+kind),fraction=chars/total,isSelected=kind===selected;
	  assert(getComputedStyle(arc).transform==='none'&&getComputedStyle(arc).stroke==='none','Donut still uses translated or thickened strokes');
	  for(let step=1;step<100;step++){
	   const turn=offset+fraction*step/100;
	   assert(!inArc(arc,turn,68.8)&&inArc(arc,turn,69.2),'Donut hole moves when selected: '+kind);
	   assert(inArc(arc,turn,86.8)&&inArc(arc,turn,98.8)===isSelected&&!inArc(arc,turn,99.2),'Donut does not expand outward only or is not enlarged: '+kind);
	  }
	  offset+=fraction;
	 }
	};
	drawDonut(donutParts);
	for(const kind of ['narration','dialogue']){donutFixtureHost.querySelector('.wm-analysis-donut-segment.is-'+kind).dispatchEvent(new Event('pointerenter'));verifyDonutShape(donutParts,kind);}
	drawDonut([['narration',100]]);verifyDonutShape([['narration',100]],'narration');
	drawDonut([]);assert(!donutFixtureHost.querySelector('.wm-analysis-donut-segment')&&donutFixtureHost.querySelector('.wm-analysis-donut-value').textContent==='—','Empty donut renders an invalid segment');
	donutFixture.destroy();donutFixtureHost.remove();
	revisionHost.querySelector('.is-flow button[data-value="interval"]').click();
	assert(revisionHost.querySelector('.wm-analysis-donut-chars').textContent==='14자','Donut selection was lost on redraw');
	assert(revision.dashboard.flowMode==='interval'&&revisionHost.querySelector('.is-flow button[data-value="interval"]').getAttribute('aria-pressed')==='true','Flow segmented control did not change to interval counts');
	revisionHost.querySelector('.is-flow button[data-value="cumulative"]').click();
	assert(revisionHost.scrollTop===detailScroll,'Flow mode redraw reset Revision scroll');
	const fixedShell=document.body.createDiv({cls:'wm-cal-content wm-revision-mode'});fixedShell.style.cssText='position:fixed;inset:0;width:900px;height:600px;z-index:50';
	const fixedWrapper=fixedShell.createDiv({cls:'wm-cal-wrapper'});fixedWrapper.createDiv({cls:'wm-dash-tab-row',text:'REVISION'});
	const fixedPanel=fixedWrapper.createDiv({cls:'wm-dash-panel wm-dash-panel-single wm-revision-panel'}),fixedWrap=fixedPanel.createDiv({cls:'wm-dash-revision'}),revisionRoot=revisionHost.querySelector('.wm-revision-root');
	fixedWrap.appendChild(revisionRoot);await settle();await settle();
	let fixedGrid=revisionRoot.querySelector('.wm-revision-tiles');const headerTop=revisionRoot.querySelector('.wm-revision-toolbar').getBoundingClientRect().top;
	fixedGrid.scrollTop=250;await settle();const fixedScroll=fixedGrid.scrollTop;
	assert(fixedScroll>0&&Math.abs(revisionRoot.querySelector('.wm-revision-toolbar').getBoundingClientRect().top-headerTop)<1,'Revision toolbar is not fixed above the card scroll area');
	revisionRoot.querySelector('.is-flow button[data-value="interval"]').click();await settle();fixedGrid=revisionRoot.querySelector('.wm-revision-tiles');
	assert(fixedGrid.scrollTop===fixedScroll,'Internal card scroll was lost during a mode switch');
	revisionHost.appendChild(revisionRoot);fixedShell.remove();await settle();await settle();
	revisionRoot.querySelector('.is-flow button[data-value="cumulative"]').click();
	const projectHost=document.body.createDiv(), projectFiles=['2','1','10'].map(name=>Object.assign(new TFile(),{path:'Project/Manuscripts/'+name+'.md',basename:name,extension:'md'}));
	const projectPlugin={...demoPlugin,app:{...app,vault:{...vault,getMarkdownFiles:()=>[...projectFiles,Object.assign(new TFile(),{path:'Project/Characters/제외.md'})],cachedRead:async file=>'본문 '+file.basename+'.'},metadataCache:{getFileCache:file=>({frontmatter:{sort_index:file.basename==='10'?1:2}})}},projectContext:{getProjectForFile:()=>({name:'프로젝트 제목',rootFolder:'Project',manuscriptFolder:'Project/Manuscripts'})}};
	const projectRevision=new RevisionPanel(projectHost,projectPlugin);projectRevision.load();await settle();
	projectHost.querySelector('.wm-revision-scope').click();
	assert(lastTestMenu.items.map(item=>item.title).join('/')==='현재 문서/프로젝트 전체','Scope icon did not open the document/project menu');
	lastTestMenu.items.find(item=>item.title==='프로젝트 전체').click();await settle();
	assert(projectRevision.result.files.map(file=>file.path.split('/').pop()).join('/')==='10.md/1.md/2.md','Project analysis includes non-manuscripts or ignores manuscript sort order');
	assert(projectHost.querySelector('.wm-revision-title').textContent==='프로젝트 제목','Project toolbar concatenates note names instead of the project name');
	assert(projectHost.querySelectorAll('.wm-analysis-file-boundary').length===2,'Project flow is missing manuscript boundaries');
	const nestedFile=Object.assign(new TFile(),{path:'Project/Manuscripts/Nested/foreign.md',basename:'foreign',extension:'md'});
	const ownerProject=projectPlugin.projectContext.getProjectForFile();
	projectPlugin.projectContext.getProjectForFile=file=>file===nestedFile?{rootFolder:'Project/Manuscripts/Nested'}:ownerProject;
	projectPlugin.app.vault.getMarkdownFiles=()=>[...projectFiles,nestedFile];
	const originalFile=view.file;
	view.file=projectFiles.find(file=>file.basename==='1');
	const projectSources=await projectRevision.sources(getWritingDocument(projectPlugin));
	assert(projectSources.length===3&&!projectSources.some(source=>source.path===nestedFile.path),'Project analysis included a nested project');
	assert(projectSources.find(source=>source.path===view.file.path).source===cm.state.doc.toString(),'Project analysis discarded unsaved editor changes');
	view.file=originalFile;
	let reads=0;
	const stopping=Object.assign(Object.create(RevisionPanel.prototype),{scope:'project',disposed:false,plugin:{...projectPlugin,app:{...projectPlugin.app,vault:{...projectPlugin.app.vault,cachedRead:async()=>{reads++;stopping.disposed=true;return 'read before disposal';}}}}});
	await stopping.sources(getWritingDocument(projectPlugin));
	assert(reads===1,'Disposed project analysis continued reading manuscripts');
	assert(!document.querySelector('.wm-revision-root linearGradient, .wm-revision-root radialGradient'),'Retired gradient definitions remain in Revision');
	verifyPalette();
	projectRevision.unload();projectHost.remove();
	const timePreview=await runWorktimePaletteChecks(assert,settle,revisionHost);
	globalThis.dashboardPreview={demo,revision,panel,owner,plugin:demoPlugin,revisionOnly(){host.hidden=true;chatHost.hidden=true;revisionHost.hidden=false;demo.style.width='900px';demo.style.maxWidth='100%';demo.style.boxSizing='border-box';demo.style.padding='16px';revisionHost.style.width='100%';revisionHost.style.height='auto';demo.style.display='block';revision.dashboard.selectedText=revision.result.files[0].repetition.word[0].text;revision.render();},timeOnly(){demo.style.display='none';timePreview.show();},hideTime(){timePreview.hide();demo.style.display='block';},mobile(height=700){host.hidden=true;revisionHost.hidden=true;chatHost.hidden=false;demo.style.padding='8px';demo.style.width='100%';demo.style.boxSizing='border-box';chatHost.style.width='100%';chatHost.style.height=height+'px';},showSnapshot(){new ManuscriptSnapshotModal(modalPlugin,getWritingDocument(modalPlugin)).open();},setTheme(dark){document.body.classList.toggle('theme-dark',dark);document.body.classList.toggle('theme-light',!dark);}};
	console.info('Dashboard overhaul: partial/native undo, verified snapshots, stale-edit rejection, Markdown paragraph offsets, paged lifecycle, chat retry/storage/stop/fork/SSE and card UI passed');
	globalThis.deusStylePreview=async()=>{
		globalThis.dashboardPreview.mobile(760);panel.mode='deus';panel.session=deusSession;
		deusSession.messages[1].content='기록된 자료를 바탕으로 판단을 정리했습니다.\n\n## 인물의 판단\n\n- **신중한 판단**: 상황을 먼저 관찰하고 행동을 정합니다.[1]\n- **협상 우선**: 직접 충돌하기 전에 다른 해결책을 찾습니다.\n\n## 원문 근거\n\n> 위기를 관찰한 뒤 신중하게 판단한다.\n\n이 문장은 확정된 설정입니다. 구체적인 반응은 현재 상황을 함께 고려해야 합니다.';
		await panel.render(chatHost);await settle();panel.messagesEl.scrollTop=0;
	};
}

export async function runRagSettingsControlsChecks() {
	const assert=(value,message)=>{if(!value)throw new Error(message);};
	const host=document.body.createDiv(),cleanups=[],project={id:'install-ui',name:'설치 UI',rootFolder:'Project'};
	const plugin={settings:structuredClone(DEFAULT_SETTINGS),register:cleanup=>cleanups.push(cleanup),saveSettings:async()=>{},projectContext:{getProjects:()=>[project],getProjectForFile:()=>project},app:{workspace:{getMostRecentLeaf:()=>null},vault:{adapter:{}}}};
	const installer=ragIndex(plugin);assert(!installer.legacyWorker,'Opening settings created a model client');
	renderRagSettings(host);
	assert(!host.querySelector('button')&&!host.textContent.includes('갱신 / 이어서')&&!host.textContent.includes('선택 의미 색인'),'Model installation/index controls remain visible');
	assert(host.textContent.includes('Obsidian API')&&host.textContent.includes('회차 조회')&&host.textContent.includes('인물 행적 조회'),'Model-free search instructions are missing');
	assert(!host.querySelector('input,a')&&!/무료 프로젝트 확인|발췌 전송 동의/.test(host.textContent),'Retired admission settings remain');
	assert(!installer.legacyWorker,'Settings initialized a model');
	for(const cleanup of cleanups)cleanup();host.remove();
	console.info('PASS model-free search settings, no installer or Worker initialization');
}
