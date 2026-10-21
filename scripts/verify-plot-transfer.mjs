import { PlotWorkbookRepository } from '../src/plot-workbook/PlotWorkbookRepository';
import { PlotWorkbookSession } from '../src/plot-workbook/PlotWorkbookSession';
import { createPlotSnapshot, plotSnapshotMarkdown, readPlotSnapshot, renamePlotSnapshotMarkdown, savePlotSnapshot } from '../src/plot-workbook/PlotWorkbookSnapshot';
import { restorePlotSnapshot } from '../src/plot-workbook/PlotWorkbookSnapshotService';
import { ProjectContextService } from '../src/projects/ProjectContextService';
import { DEFAULT_SETTINGS } from '../src/types';
import { MobileFontManager } from '../src/fonts/MobileFontManager';
import { PlotWorkbookTransferModal } from '../src/plot-workbook/PlotWorkbookTransferModal';
import { createPlotWorkbookSheet } from '../src/plot-workbook/PlotWorkbookTypes';
import { packPlotSnapshotData, unpackPlotSnapshotData } from '../src/plot-workbook/PlotWorkbookSnapshotPacking';
import { plotSnapshotPreview, SNAPSHOT_PREVIEW_CHARACTERS } from '../src/plot-workbook/PlotWorkbookSnapshotPreview';
import { runSnapshotDiffChecks, SNAPSHOT_DIFF_BEFORE, SNAPSHOT_DIFF_AFTER } from './verify-snapshot-diff.mjs';

export async function runPlotTransferChecks() {
	await runSnapshotDiffChecks();
	const assert = (value, message) => { if (!value) throw new Error(message); };
	const rejects = async (action, message) => { let rejected = false; try { await action(); } catch { rejected = true; } assert(rejected, message); };
	const files = new Map(), folders = new Set();
	let failWrite = () => false;
	let failPointerAfterWrite = false;
	const adapter = {
		async exists(path) { return files.has(path) || folders.has(path); },
		async mkdir(path) { folders.add(path); },
		async read(path) { if (!files.has(path)) throw new Error(`Missing ${path}`); return files.get(path); },
		async write(path, value) { if (failWrite(path)) throw new Error('simulated disk failure'); files.set(path, value); },
		async append(path, value) { files.set(path, (files.get(path) ?? '') + value); },
		async process(path, action) { if (failWrite(path)) throw new Error('simulated pointer failure'); files.set(path, action(files.get(path))); if (failPointerAfterWrite && path.endsWith('/manifest.json')) { files.set(path,'{broken'); throw new Error('simulated partial pointer'); } },
		async remove(path) { files.delete(path); },
		async readBinary(path) { return files.get(path); },
		async writeBinary(path, value) { files.set(path, value); },
		async list(path) { return { files:[...files.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length+1).includes('/')),folders:[] }; },
	};
	const noteFile = path => ({path,basename:path.split('/').pop().replace(/\.md$/,''),stat:{size:new TextEncoder().encode(files.get(path)).length,mtime:2}});
	const plugin = { settings:structuredClone(DEFAULT_SETTINGS), manifest:{id:'writing-menu',dir:'.obsidian/plugins/writing-menu'},
		app:{metadataCache:{getFileCache:file=>({frontmatter:files.get(file.path)?.includes('writing_menu_snapshot: plot-workbook') ? {writing_menu_snapshot:'plot-workbook'} : {}})},
			vault:{adapter,configDir:'.obsidian',getFileByPath:path=>files.has(path)?noteFile(path):null,
			getMarkdownFiles:()=>[...files.keys()].filter(path=>path.endsWith('.md') && !path.includes('/.writing-menu/')).map(noteFile),
			read:async file=>adapter.read(file.path),process:async(file,action)=>adapter.process(file.path,action),create:async (path,value)=>{await adapter.write(path,value);return {path};},
			createFolder:async path=>adapter.mkdir(path)}},async saveSettings() {} };
	plugin.projectContext = new ProjectContextService(plugin);
	const sourceProject = plugin.projectContext.createProject('Project', '원본 프로젝트');
	plugin.settings.projects.push(sourceProject);
	const open = async project => {
		const repo = new PlotWorkbookRepository(plugin, project.rootFolder);
		const loaded = await repo.loadOrCreate(project.id,project.name);
		return new PlotWorkbookSession(repo,loaded.manifest,loaded.sheets,loaded.foreshadows,loaded.warnings);
	};
	const source = await open(sourceProject), first = source.activeSheet;
	const row = first.rowOrder[0], column = first.columnOrder[0];
	source.setCell(row,column,'한글\n```json wm-plot-snapshot\n```\n- [x] 완료 📅 2026-10-18');
	source.setCellStyles([{rowId:row,columnId:column}],{fontFamily:'리디바탕',fontSize:18,color:{light:'#123456',dark:'#abcdef'}});
	const child = source.addSubrow(row);
	source.setCell(child,column,'세부행');
	await source.createCellSnapshots([{rowId:row,columnId:column}],'이전 셀');
	await source.addStatus('사용자 상태');
	await source.addSheet();
	const second = source.activeSheet;
	source.foreshadows.push({id:'story',title:'복선',note:'메모',status:'resolved',createdAt:1,updatedAt:2,
		plantedAt:[{sheetId:first.sheetId,rowId:row,columnId:column}],resolvedAt:[{sheetId:second.sheetId,rowId:second.rowOrder[1],columnId:second.columnOrder[0]}]});
	await source.repository.saveForeshadowsState(source.foreshadows);
	await source.addSheet();
	await source.deleteSheet(source.activeSheet.sheetId);
	const data = await source.withSnapshot(async data=>data);
	const snapshot = createPlotSnapshot(data,sourceProject), markdown = await plotSnapshotMarkdown(snapshot);
	const decoded = await readPlotSnapshot(markdown.replace(/\n/g,'\r\n'));
	assert(JSON.stringify(decoded) === JSON.stringify(snapshot),'Snapshot round trip lost data');
	const renamed = renamePlotSnapshotMarkdown(markdown,'수정된 제목');
	assert(renamed.includes('snapshot_title: "수정된 제목"') && JSON.stringify(await readPlotSnapshot(renamed)) === JSON.stringify(snapshot),'Renaming display metadata changed checksummed restoration data');
	const legacyHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot)))),byte=>byte.toString(16).padStart(2,'0')).join('');
	const legacyMarkdown = '```json wm-plot-snapshot\n'+JSON.stringify({snapshot,checksum:legacyHash})+'\n```\n';
	assert(JSON.stringify(await readPlotSnapshot(legacyMarkdown)) === JSON.stringify(snapshot),'Existing unpacked Markdown snapshots stopped loading');
	assert([...markdown.matchAll(/^```json wm-plot-snapshot$/gm)].length === 1,'Cell backticks escaped the restoration block');
	await rejects(()=>readPlotSnapshot(markdown.replace('한글','변경')),'Changed payload was accepted');
	await rejects(()=>readPlotSnapshot('# 일반 Markdown'),'Readable-only Markdown was accepted as a backup');
	await rejects(()=>readPlotSnapshot(markdown+'\n'+markdown),'Duplicate payloads were accepted');
	const newer = structuredClone(snapshot); newer.formatVersion = 2;
	await rejects(async()=>readPlotSnapshot(await plotSnapshotMarkdown(newer)),'Future transfer format was accepted');
	const save1 = await savePlotSnapshot(plugin.app.vault,'플롯 스냅샷',snapshot);
	const save2 = await savePlotSnapshot(plugin.app.vault,'플롯 스냅샷',snapshot);
	assert(save1 !== save2 && await adapter.read(save1) === markdown,'Manual saves overwrote a previous snapshot');
	await rejects(()=>savePlotSnapshot(plugin.app.vault,'.writing-menu/스냅샷',snapshot),'Unsyncable hidden export folder was accepted');

	const before = new Map(files);
	const targetProject = plugin.projectContext.createProject('Target','대상 프로젝트'); plugin.settings.projects.push(targetProject);
	const projectsBefore = JSON.stringify(plugin.settings.projects);
	const target = await open(targetProject), oldSheet = target.activeSheet;
	target.setCell(oldSheet.rowOrder[0],oldSheet.columnOrder[0],'교체 전 최신 내용');
	await target.flush();
	const oldManifest = await adapter.read('Target/.writing-menu/plot/manifest.json');
	const invalid = structuredClone(snapshot); invalid.data.sheets[0].sheetId = '../escape';
	await rejects(()=>restorePlotSnapshot(targetProject,target,invalid),'Unsafe sheet path was accepted');
	await rejects(()=>restorePlotSnapshot(sourceProject,target,snapshot),'A mismatched target project was accepted');
	await rejects(()=>restorePlotSnapshot({...targetProject,rootFolder:sourceProject.rootFolder},target,snapshot),'Matching registration IDs bypassed the storage-folder guard');
	failWrite = path=>path.includes('/generations/') && path.endsWith('foreshadows.json');
	await rejects(()=>restorePlotSnapshot(targetProject,target,snapshot),'Partial staging succeeded');
	failWrite = ()=>false;
	assert(await adapter.read('Target/.writing-menu/plot/manifest.json') === oldManifest && target.activeSheet === oldSheet,'Failed staging changed the active workbook');
	const backupPaths = [...files.keys()].filter(path=>path.startsWith('Target/.writing-menu/plot/transfer-backups/'));
	assert(backupPaths.length && (await readPlotSnapshot(files.get(backupPaths[0]))).data.sheets[0].cells[oldSheet.rowOrder[0]][oldSheet.columnOrder[0]].value === '교체 전 최신 내용','Pre-replacement backup was absent or stale');
	failWrite = path=>path === 'Target/.writing-menu/plot/manifest.json';
	await rejects(()=>restorePlotSnapshot(targetProject,target,snapshot),'Failed pointer publication was accepted');
	failWrite = ()=>false;
	assert(await adapter.read('Target/.writing-menu/plot/manifest.json') === oldManifest,'A failed pointer publication modified the original');
	failPointerAfterWrite = true;
	await rejects(()=>restorePlotSnapshot(targetProject,target,snapshot),'Partial pointer publication was accepted');
	failPointerAfterWrite = false;
	assert(await adapter.read('Target/.writing-menu/plot/manifest.json') === oldManifest && !target.repository.isRecoveryRequired,'The old pointer was not restored after a partial write');
	const result = await restorePlotSnapshot(targetProject,target,snapshot);
	assert(result.backupPath && target.manifest.storageGeneration && target.activeSheet.sheetId === snapshot.data.manifest.activeSheetId,'Explicit replace did not publish the staged generation');
	assert(JSON.stringify(plugin.settings.projects) === projectsBefore,'Restoring changed project registrations or created a new project');
	for (const [path,value] of before) assert(files.get(path) === value,`Target restore changed an unrelated source file ${path}`);
	assert(target.manifest.formatVersion === 2,'Old plugin versions could silently open stale pre-restore files');
	const reloaded = await open(targetProject);
	assert(reloaded.foreshadows.length === 1 && reloaded.sheets.size === source.sheets.size,'Published generation failed to reload');
	assert(reloaded.foreshadows[0].resolvedAt[0].sheetId === second.sheetId,'Cross-sheet foreshadow links were lost');
	assert(reloaded.manifest.deletedSheets.length === 1 && reloaded.manifest.snapshots.length === 1,'Trash or cell snapshots were lost');
	assert((await reloaded.readCellSnapshot(reloaded.manifest.snapshots[0].id)).value === source.getCell(first,row,column),'Cell snapshot content was lost');
	const restoredSheet = reloaded.sheets.get(first.sheetId);
	assert(restoredSheet.rows[child].parentRowId === row && restoredSheet.cells[row][column].style.color.dark === '#abcdef','Subrows or per-theme formatting were lost');
	assert([...files.keys()].some(path=>path.startsWith(`Target/.writing-menu/plot/sheets/${oldSheet.sheetId}/`)),'Old local files were deleted');
	const active = target.activeSheet;
	target.setCell(active.rowOrder[0],active.columnOrder[0],'교체 후 새 편집'); await target.flush();
	const afterEdit = await open(targetProject);
	assert(afterEdit.getCell(afterEdit.activeSheet,active.rowOrder[0],active.columnOrder[0]) === '교체 후 새 편집','Post-restore journal writes used the old storage');
	assert(afterEdit.manifest.projectId === targetProject.id,'Replace changed target project identity');
	// A device can register the same folder again while its existing manifest keeps the old ID.
	const originalMobileProject=plugin.projectContext.createProject('MobileProject','모바일 프로젝트');
	plugin.settings.projects.push(originalMobileProject);
	const originalMobile=await open(originalMobileProject), mobileSheet=originalMobile.activeSheet;
	originalMobile.setCell(mobileSheet.rowOrder[0],mobileSheet.columnOrder[0],'모바일 복원 전 내용');await originalMobile.flush();originalMobile.dispose();
	const mobileProject=plugin.projectContext.createProject('MobileProject','모바일 프로젝트');
	plugin.settings.projects[plugin.settings.projects.indexOf(originalMobileProject)]=mobileProject;
	const mobile=await open(mobileProject), mobileManifestPath='MobileProject/.writing-menu/plot/manifest.json';
	const mobileManifestBefore=await adapter.read(mobileManifestPath), mobileRegistrations=JSON.stringify(plugin.settings.projects);
	assert(mobile.manifest.projectId!==mobileProject.id && mobile.repository.isForProjectRoot('MobileProject/'),'Cross-device fixture did not retain a different saved registration ID for the same folder');
	const snapshotBeforeMobileRestore=JSON.stringify(snapshot), mobileFilesBeforeReject=new Map(files);
	await rejects(()=>restorePlotSnapshot({...mobileProject,rootFolder:'UnrelatedProject'},mobile,snapshot),'An identical ID permitted restoring into the wrong folder');
	assert(files.size===mobileFilesBeforeReject.size&&[...mobileFilesBeforeReject].every(([path,value])=>files.get(path)===value),'Wrong-folder rejection changed stored data');
	failWrite=path=>path.startsWith('MobileProject/.writing-menu/plot/generations/')&&path.endsWith('foreshadows.json');
	await rejects(()=>restorePlotSnapshot(mobileProject,mobile,snapshot),'A failed cross-device restore was committed');failWrite=()=>false;
	assert(await adapter.read(mobileManifestPath)===mobileManifestBefore && mobile.manifest.projectId===originalMobileProject.id,'Failed cross-device restore rewrote the live identity or pointer');
	const mobileRestored=await restorePlotSnapshot({...mobileProject,rootFolder:'MobileProject/'},mobile,snapshot);
	assert(mobileRestored.backupPath.startsWith('MobileProject/.writing-menu/plot/transfer-backups/'),'Cross-device restore did not retain a local backup');
	const mobileBackup=await readPlotSnapshot(await adapter.read(mobileRestored.backupPath));
	assert(mobileBackup.project.rootFolder==='MobileProject','The recovery snapshot did not retain a canonical, readable project folder');
	assert(mobileBackup.data.manifest.projectId===originalMobileProject.id && mobileBackup.data.sheets[0].cells[mobileSheet.rowOrder[0]][mobileSheet.columnOrder[0]].value==='모바일 복원 전 내용','Cross-device restore lost its pre-restore content or saved identity');
	assert(mobile.manifest.projectId===mobileProject.id && mobile.manifest.projectName===mobileProject.name,'Cross-device restore did not adopt the current local registration');
	assert(JSON.stringify(plugin.settings.projects)===mobileRegistrations && JSON.stringify(snapshot)===snapshotBeforeMobileRestore,'Cross-device restore mutated registrations or its source snapshot');
	mobile.dispose();const reopenedMobile=await open(mobileProject);
	assert(reopenedMobile.manifest.projectId===mobileProject.id && reopenedMobile.sheets.size===source.sheets.size && reopenedMobile.foreshadows[0].resolvedAt[0].sheetId===second.sheetId,'Cross-device restore failed to reopen its complete workbook');
	await restorePlotSnapshot(mobileProject,reopenedMobile,snapshot);reopenedMobile.dispose();
	console.info('Cross-device snapshot restore: same folder/different IDs, normalized folder, wrong-folder no-write guard, verified backup, failed-staging identity preservation, reload and repeated restore passed');
	await target.withSnapshot(async () => {
		await rejects(async()=>target.setCell(active.rowOrder[0],active.columnOrder[0],'잠금 중 입력'),'Concurrent editing bypassed the snapshot lock');
		await rejects(()=>target.addSheet(),'Concurrent sheet creation bypassed the snapshot lock');
		await rejects(()=>target.createForeshadow('잠금 중 복선'),'Concurrent registry edit bypassed the snapshot lock');
	});
	let releases = 0;
	const lease = {session:target,release:async()=>{releases++;}};
	plugin.openPlotWorkbookCell = async () => {};
	const modal = new PlotWorkbookTransferModal(plugin,targetProject,lease,snapshot).open();
	[...modal.contentEl.querySelectorAll('button')].find(button=>button.textContent === '이 버전 복원').click();
	const confirmationModal = globalThis.lastTestModal;
	const setting = (modal,name) => [...modal.contentEl.querySelectorAll('.setting-item')].find(el=>el.querySelector('.setting-item-name').textContent === name);
	const confirmation = setting(confirmationModal,'교체 확인').querySelector('input');
	const submit = confirmationModal.contentEl.querySelector('button.mod-warning');
	assert(!setting(confirmationModal,'복원 방식') && !setting(confirmationModal,'새 프로젝트 폴더') && confirmationModal.titleEl.hidden,'Restore still includes a copy/folder choice or a redundant header');
	const center = element => {const bounds=element.getBoundingClientRect();return (bounds.top+bounds.bottom)/2;};
	const assertRestoreColumns = restore => {
		const row=setting(restore,'교체 확인'), input=row.querySelector('input'), info=row.querySelector('.setting-item-info');
		const title=info.querySelector('.setting-item-name'), description=info.querySelector('.setting-item-description');
		assert(Math.abs(center(input)-center(info))<1,'Restore input is not centered across the full two-row left column');
		assert(description.getBoundingClientRect().top>=title.getBoundingClientRect().bottom,'Restore description is not below the title');
		assert(description.getBoundingClientRect().right<=info.getBoundingClientRect().right+.5 && info.getBoundingClientRect().right+8<=input.getBoundingClientRect().left,'Restore description enters the input column');
	};
	const previewStyle = modal => {
		const content=modal.contentEl.querySelector('.wm-plotbook-snapshot-content');
		assert(content && !modal.contentEl.querySelector('textarea'),'Snapshot view still uses separate textarea/diff presentation');
		const style=getComputedStyle(content), line=getComputedStyle(content.querySelector('.diff-line'));
		for(const side of ['Top','Right','Bottom','Left'])assert(style[`border${side}Width`]==='0px','Snapshot content still has a border');
		const properties=['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','color','paddingTop','paddingRight','paddingBottom','paddingLeft'];
		return JSON.stringify([properties.map(key=>style[key]),properties.map(key=>line[key]),line.whiteSpace]);
	};
	assertRestoreColumns(confirmationModal);
	const settingStyle=getComputedStyle(setting(confirmationModal,'교체 확인'));
	assert(settingStyle.paddingTop===settingStyle.paddingBottom,'Restore confirmation has asymmetric vertical padding');
	submit.click();
	assert(confirmationModal.contentEl.querySelector('[role="alert"]').textContent.includes('정확히'),'Replacement did not require the target project name');
	confirmation.value = targetProject.name; confirmation.dispatchEvent(new Event('input'));
	submit.click(); modal.close();
	assert(modal.containerEl.isConnected && modal.busy,'Dismissal interrupted an active replacement');
	for(let tick=0;tick<100 && modal.containerEl.isConnected;tick++) await new Promise(resolve=>setTimeout(resolve,10));
	assert(!modal.containerEl.isConnected && releases === 1,'Successful import did not close and release its session');
	let reads = 0, managerReleases = 0;
	const originalRead = adapter.read;
	adapter.read = async path => {if(path.endsWith('.md'))reads++;return originalRead(path);};
	const manager = new PlotWorkbookTransferModal(plugin,targetProject,{session:target,release:async()=>{managerReleases++;}}).open();
	await new Promise(resolve=>setTimeout(resolve,30));
	assert(reads <= 1,'Opening the manager eagerly decoded all project snapshots');
	assert(manager.modalEl.hasClass('mod-sidebar-layout') && manager.contentEl.querySelector('[data-snapshot-path]'),'Snapshot manager did not share the cell history layout and indexed list');
	assert([...manager.contentEl.querySelectorAll('[data-snapshot-path]')].some(row=>row.textContent.includes('교체 전 백업')),'Hidden pre-replacement backups disappeared from the unified snapshot list');
	const readsBeforeSelection = reads;
	manager.contentEl.querySelector(`[data-snapshot-path="${save1}"]`).click();
	for(let tick=0;tick<100 && !manager.contentEl.querySelector('.wm-plotbook-snapshot-content');tick++)await new Promise(resolve=>setTimeout(resolve,10));
	const previewSelect = manager.contentEl.querySelector('[aria-label="미리보기 시트"]');
	const pickerButton=manager.contentEl.querySelector('button.wm-toolbar-select.is-snapshot-sheet');
	const pagination=manager.contentEl.querySelector('.wm-plotbook-snapshot-pagination');
	assert(previewSelect.hidden && pickerButton && pickerButton.nextElementSibling===pagination && pickerButton.getBoundingClientRect().width<=140,'Snapshot sheet picker is not a compact shared control before pagination');
	assert(Math.abs(pagination.getBoundingClientRect().right-pagination.parentElement.getBoundingClientRect().right)<1,'Snapshot page navigation is not right-aligned');
	for(const element of [...pagination.querySelectorAll('button svg'),pagination.querySelector('.wm-plotbook-snapshot-page')])
		assert(Math.abs(center(element)-center(pickerButton))<1,'Snapshot page icon/number is not vertically centered with the sheet picker');
	pickerButton.click();
	const pickerPopover=manager.containerEl.querySelector('.wm-toolbar-select-popover');
	assert(pickerPopover?.hasClass('wm-paged-compact-popover'),'Snapshot sheets did not open the shared compact menu');
	const firstOption=pickerPopover.querySelector(`[data-value="${first.sheetId}"]`);
	firstOption.focus();firstOption.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
	assert(!pickerPopover.isConnected && document.activeElement===pickerButton,'Snapshot picker Escape did not close and restore focus');
	pickerButton.click();manager.containerEl.querySelector(`.wm-toolbar-select-popover [data-value="${first.sheetId}"]`).click();
	assert(previewSelect.value===first.sheetId && pickerButton.textContent.includes(first.name),'Snapshot compact selection did not synchronize its native value and label');
	previewSelect.value=first.sheetId;previewSelect.dispatchEvent(new Event('change'));
	assert(reads === readsBeforeSelection + 1 && manager.contentEl.querySelector('.wm-plotbook-snapshot-content')?.textContent.includes('한글'),'Selecting a snapshot did not lazily read and preview its content');
	assert(!manager.contentEl.textContent.includes('모든 시트·서식') && !setting(manager,'저장 폴더') && !manager.contentEl.textContent.includes('(빈 행)'),'Snapshot history still includes transfer forms or empty rows');
	assert([...manager.contentEl.querySelectorAll('.modal-setting-titlebar-actions button')].map(button=>button.textContent).join(',') === '복사,이 버전 복원','Snapshot history did not share cell history actions');
	assert(manager.copySelected().includes('한글')&&!manager.copySelected().includes('(빈 행)'),'Snapshot Markdown copy still includes empty rows');
	manager.contentEl.querySelector('[aria-label="스냅샷 제목 수정"]').click();
	const titleModal=globalThis.lastTestModal, titleInput=titleModal.contentEl.querySelector('input');
	titleInput.value='수정한 스냅샷 제목';titleInput.dispatchEvent(new Event('input'));titleModal.contentEl.querySelector('button.mod-cta').click();
	for(let tick=0;tick<100&&manager.busy;tick++)await new Promise(resolve=>setTimeout(resolve,10));
	assert(manager.contentEl.querySelector('.modal-setting-title').textContent==='수정한 스냅샷 제목'&&files.get(save1).includes('snapshot_title: "수정한 스냅샷 제목"'),'Pencil did not rename the selected snapshot metadata');
	assert(JSON.stringify(await readPlotSnapshot(files.get(save1)))===JSON.stringify(snapshot),'UI rename changed the restoration payload');
	const originalActive=target.activeSheet.sheetId;
	await target.selectSheet(first.sheetId);target.setCell(row,column,'현재 편집 내용');await target.selectSheet(originalActive);
	const normalStyle=previewStyle(manager);
	const compare=manager.contentEl.querySelector('.modal-setting-titlebar-toggle input');compare.checked=true;compare.dispatchEvent(new Event('change'));
	assert(previewStyle(manager)===normalStyle,'Snapshot normal/diff modes do not share the same typography, line spacing and padding');
	assert(manager.contentEl.querySelector('[aria-label="미리보기 시트"]').value===first.sheetId&&manager.contentEl.querySelector('.file-recovery-diff .mod-right')?.textContent.includes('현재 편집 내용'),'Diff did not compare the selected sheet with live contents');
	const search = manager.contentEl.querySelector('input[type="search"]');
	search.value='없는 파일 이름';search.dispatchEvent(new Event('input'));
	assert(!manager.contentEl.querySelector('[data-snapshot-path]'),'Snapshot list search did not filter indexed metadata');
	search.value='';search.dispatchEvent(new Event('input'));
	manager.contentEl.querySelector('[aria-label="스냅샷 추가"]').click();manager.close();
	assert(manager.containerEl.isConnected,'Saving a snapshot could be dismissed during verification');
	for(let tick=0;tick<100 && manager.busy;tick++)await new Promise(resolve=>setTimeout(resolve,10));
	assert(manager.containerEl.isConnected && managerReleases === 0 && manager.contentEl.querySelector('[data-snapshot-path].is-active'),'Saving did not remain in the manager with the new snapshot selected');
	assert(manager.contentEl.querySelector('.wm-plotbook-snapshot-content') && [...files.keys()].some(path=>path.startsWith('Target/스냅샷/')),'Plus did not save directly to the default project snapshot folder');
	plugin.settings.plotSnapshotFolder='공유 스냅샷';manager.contentEl.querySelector('[aria-label="스냅샷 추가"]').click();
	for(let tick=0;tick<100&&manager.busy;tick++)await new Promise(resolve=>setTimeout(resolve,10));
	assert(manager.selectedPath.startsWith('공유 스냅샷/'),'Snapshot folder preference was ignored');
	plugin.settings.plotSnapshotFolder='';
	manager.close();assert(managerReleases === 1,'Closing the manager did not release the session');
	adapter.read = originalRead;
	globalThis.beginPlotSnapshotPreview = async () => {
		const session = await open(targetProject);
		const diffSnapshot=structuredClone(snapshot);diffSnapshot.data.sheets.find(sheet=>sheet.sheetId===first.sheetId).cells[row][column].value=SNAPSHOT_DIFF_BEFORE;
		await session.selectSheet(first.sheetId);session.setCell(row,column,SNAPSHOT_DIFF_AFTER);
		const modal = new PlotWorkbookTransferModal(plugin,targetProject,{session,release:async()=>{await session.flush();session.dispose();}},diffSnapshot).open();
		const select = modal.contentEl.querySelector('[aria-label="미리보기 시트"]');
		select.value=first.sheetId;select.dispatchEvent(new Event('change'));
		const compare=modal.contentEl.querySelector('.modal-setting-titlebar-toggle input');compare.checked=true;compare.dispatchEvent(new Event('change'));
		assert(modal.contentEl.querySelector('.diff-collapsed')&&modal.contentEl.querySelector('.diff-changed'),'Project snapshot modal did not use the shared precise/folded renderer');
		return modal;
	};
	globalThis.verifyPlotSnapshotNativeLayout = modal => {
		const picker=modal.contentEl.querySelector('button.wm-toolbar-select.is-snapshot-sheet');
		const pagination=modal.contentEl.querySelector('.wm-plotbook-snapshot-pagination');
		assert(Math.abs(pagination.getBoundingClientRect().right-pagination.parentElement.getBoundingClientRect().right)<1,'Native snapshot page navigation is not right-aligned');
		for(const element of [...pagination.querySelectorAll('button svg'),pagination.querySelector('.wm-plotbook-snapshot-page')])
			assert(Math.abs(center(element)-center(picker))<1,'Native snapshot CSS misaligned the page icon/number');
		assert(picker.getBoundingClientRect().width===132,'Native snapshot CSS stretched the sheet selector');
		const originalStyle=previewStyle(modal), originalCompare=modal.compare;
		const toggleCompare = () => {const input=modal.contentEl.querySelector('.modal-setting-titlebar-toggle input');input.checked=!input.checked;input.dispatchEvent(new Event('change'));};
		toggleCompare();assert(previewStyle(modal)===originalStyle,'Native snapshot normal/diff typography, line spacing or padding differs');
		toggleCompare();assert(modal.compare===originalCompare,'Snapshot style check changed the selected mode');
		[...modal.contentEl.querySelectorAll('button')].find(button=>button.textContent==='이 버전 복원').click();
		const restore=globalThis.lastTestModal, row=restore.contentEl.querySelector('.wm-plotbook-restore-confirmation');
		assertRestoreColumns(restore);
		const input=row.querySelector('input'), info=row.querySelector('.setting-item-info'), close=restore.modalEl.querySelector('.modal-close-button');
		assert(close && close.getBoundingClientRect().height>0,'Native restore fixture does not include its close button');
		assert(Math.min(input.getBoundingClientRect().top,info.getBoundingClientRect().top)>=close.getBoundingClientRect().bottom+8,
			`Native restore close button overlaps the confirmation/input area: ${JSON.stringify({inputTop:input.getBoundingClientRect().top,infoTop:info.getBoundingClientRect().top,closeBottom:close.getBoundingClientRect().bottom,paddingTop:getComputedStyle(restore.contentEl).paddingTop})}`);
		assert(restore.titleEl.getBoundingClientRect().height===0,'Native restore dialog still renders a redundant title');
		assert(!setting(restore,'복원 방식')&&!setting(restore,'새 프로젝트 폴더'),'Native restore dialog still offers an alternative destination');
		assert(row.getBoundingClientRect().right<=restore.modalEl.getBoundingClientRect().right,'Native restore confirmation overflows its dialog');
		const style=getComputedStyle(row);
		assert(style.paddingTop===style.paddingBottom,'Native restore confirmation has uneven vertical padding');
		console.info('Native snapshot layout: right-aligned pages, identical borderless normal/diff styles, two-row confirmation column and close-button clearance passed');
		return restore;
	};
	for (const session of [source,target,reloaded,afterEdit]) session.dispose();
	console.info('Manual Markdown snapshots: lossless round trip, current-project-only restore, compact picker/page alignment, centered confirmation, verified backups, failed staging, generation reload, journal continuation and exclusive edits passed');
	{
		const dense = createPlotWorkbookSheet('대형 서식 시트',1200,128);
		const style = {fontFamily:'리디바탕',fontSize:10,bold:false,color:{light:'#123456',dark:'#abcdef'},backgroundColor:{light:'#ffffff',dark:'#222222'}};
		for (const rowId of dense.rowOrder) {
			const row = dense.cells[rowId] = {};
			for (const columnId of dense.columnOrder) row[columnId] = {type:'text',value:'',style:structuredClone(style)};
		}
		dense.cells[dense.rowOrder[0]][dense.columnOrder[0]].value = '내용 보존\n```\n한글';
		const data = {manifest:{formatVersion:1,projectId:'dense-project',projectName:'대형',activeSheetId:dense.sheetId,sheets:[{id:dense.sheetId,name:dense.name}]},sheets:[dense],foreshadows:[],cellSnapshots:[]};
		const large = createPlotSnapshot(data,sourceProject);
		const oldSize = new TextEncoder().encode(JSON.stringify({snapshot:large},null,2)).length;
		assert(oldSize > 25*1024*1024,'Large-project regression did not exceed the old 25MB limit');
		const path = await savePlotSnapshot(plugin.app.vault,'대형 스냅샷',large);
		const markdown = await adapter.read(path);
		const size = new TextEncoder().encode(markdown).length;
		assert(size < 5*1024*1024,'Repeated empty-cell formatting still exceeded a basic Sync file size');
		const restored = await readPlotSnapshot(markdown);
		assert(JSON.stringify(restored) === JSON.stringify(large),'Packed large project lost values, empty-cell records or style data');
		const previewSheet = restored.data.sheets[0];
		previewSheet.cells[previewSheet.rowOrder[0]][previewSheet.columnOrder[0]].value='아'.repeat(200000);
		const preview = plotSnapshotPreview(restored.data,previewSheet,source.rowLabels(previewSheet),0);
		assert(preview.clipped && preview.text.length <= SNAPSHOT_PREVIEW_CHARACTERS && (preview.text.match(/^## /gm)?.length ?? 0) <= 50,'Large snapshot preview did not enforce bounded characters and rows');
		assert(previewSheet.cells[previewSheet.rowOrder[0]][previewSheet.columnOrder[0]].value.length === 200000,'Preview clipping modified restoration data');
		const first = restored.data.sheets[0].cells[dense.rowOrder[0]][dense.columnOrder[0]];
		const second = restored.data.sheets[0].cells[dense.rowOrder[1]][dense.columnOrder[0]];
		assert(first !== second && first.style !== second.style && first.style.color !== second.style.color,'Unpacked cells shared mutable style references');
		first.style.color.light = '#000000'; first.value = '편집';
		assert(second.style.color.light === '#123456' && second.value === '','An unpacked cell edit changed a neighbouring cell');
		const packed = packPlotSnapshotData(snapshot.data);
		const badIndex = structuredClone(packed); badIndex.sheets[0].cells.patterns[0][0][2] = 999999;
		await rejects(async()=>unpackPlotSnapshotData(badIndex),'Invalid template reference was accepted');
		const bomb = structuredClone(packed);
		bomb.sheets[0].cells.templates[0].value = 'x'.repeat(8*1024*1024);
		bomb.sheets[0].cells.patterns[0] = [[0,bomb.sheets[0].cells.columnKeys.length,0]];
		await rejects(async()=>unpackPlotSnapshotData(bomb),'Unbounded expansion was accepted');
		console.info('Large snapshot packing: '+JSON.stringify({cells:1200*128,oldBytes:oldSize,packedMarkdownBytes:size,lossless:true,legacyCompatible:true}));
	}

	const fontBytes = await (await fetch('/test-font.ttf')).arrayBuffer();
	let requests = 0, ready = 0;
	plugin.settings.mobileFontFamily = 'maruburi'; plugin.settings.fontFamily = 'PC 전용 글꼴';
	const fetchFont = async () => { requests++; return {status:200,arrayBuffer:fontBytes}; };
	let fonts = new MobileFontManager(plugin,()=>ready++,fetchFont);
	await Promise.all([fonts.ensureSelected(document),fonts.ensureSelected(document)]);
	assert(requests === 1 && ready === 1 && fonts.cssFamily(document).includes('maruburi'),'Font fetch/load requests were not deduplicated');
	assert(plugin.settings.fontFamily === 'PC 전용 글꼴','Mobile font load changed PC selection');
	fonts.dispose(); fonts = new MobileFontManager(plugin,()=>ready++,async()=>{throw new Error('offline');});
	await fonts.ensureSelected(document);
	assert(fonts.cssFamily(document).includes('maruburi'),'Downloaded font failed after restart while offline');
	fonts.dispose();
	plugin.settings.mobileFontFamily = 'ridibatang';
	const badFont = new MobileFontManager(plugin,()=>{},async()=>({status:200,arrayBuffer:new Uint8Array([1,2,3,4]).buffer}));
	await badFont.ensureSelected(document); await badFont.ensureSelected(document);
	assert(badFont.cssFamily(document) === 'inherit','Failed font did not retain a usable fallback');
	badFont.dispose();
	const ridiBytes = await (await fetch('/test-ridi.otf')).arrayBuffer();
	const validRidi = new MobileFontManager(plugin,()=>{},async()=>({status:200,arrayBuffer:ridiBytes}));
	await validRidi.ensureSelected(document,true);
	assert(validRidi.cssFamily(document).includes('ridibatang'),'Valid RIDI font did not load after a failed attempt');
	validRidi.dispose();
	for (const id of await (await fetch('/extra-fonts.json')).json()) {
		plugin.settings.mobileFontFamily=id;
		const bytes=await(await fetch('/extra-font/'+id)).arrayBuffer();
		const font=new MobileFontManager(plugin,()=>{},async()=>({status:200,arrayBuffer:bytes}));
		await font.ensureSelected(document,true);
		assert(font.cssFamily(document).includes(id),'Official mobile font failed browser decoding: '+id);
		font.dispose();console.info('Official mobile font decoded: '+id);
	}
	console.info('Mobile webfonts: byte-level FontFace validation, deduplicated downloads, persistent offline cache, PC isolation, fallback and cleanup passed');
}
