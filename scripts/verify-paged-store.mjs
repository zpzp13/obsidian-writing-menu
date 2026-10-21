import { PagedFileStore, mergePagedMetadata } from '../src/paged/PagedFileStore';
import { mergePagedLines } from '../src/paged/PagedThreeWayMerge';

export async function runPagedStoreChecks() {
	const assert=(value,message)=>{if(!value)throw new Error(message);};
	const baseline='첫줄\n둘째\n셋째\n넷째\n다섯째\n';
	assert(mergePagedLines(baseline,baseline.replace('첫줄','로컬'),baseline.replace('다섯째','외부'))===baseline.replace('첫줄','로컬').replace('다섯째','외부'),'Disjoint changes failed exact merge');
	assert(mergePagedLines(baseline,baseline.replace('둘째','로컬'),baseline.replace('셋째','외부'))===null,'Adjacent changes were silently merged');
	assert(mergePagedLines('반복\n반복\n끝','반복\n끝','반복\n반복\n새끝')===null,'Repeated-line deletion was silently merged');
	const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
	let disk='원문\n',local='',holdWrite=null,holdRead=null,failBackup=false,active=0,maxActive=0;
	const files=new Map(),dirs=new Set(),conflicts=[];
	const file={path:'Project/note.md',basename:'note'};
	const vault={adapter:{async exists(path){return files.has(path)||dirs.has(path);},async mkdir(path){dirs.add(path);},
		async write(path,data){if(failBackup)throw new Error('backup IO failure');files.set(path,data);},async read(path){return files.get(path);}},
		async read(){const captured=disk;if(holdRead)await holdRead;return captured;},
		async process(file,change){active++;maxActive=Math.max(maxActive,active);try{if(holdWrite)await holdWrite;disk=change(disk);return disk;}finally{active--;}}};
	const store=new PagedFileStore(vault,file,'Project/.writing-menu/paged-conflicts',()=>local,data=>{local=data;},conflict=>conflicts.push(conflict));
	await store.load();assert(local===disk,'Initial file load failed');
	local='삭제 후 B';store.changed();let finishWrite;holdWrite=new Promise(resolve=>{finishWrite=resolve;});
	const saving=store.save();await tick();local='삭제 후 C';store.changed();const again=store.save();finishWrite();holdWrite=null;
	await Promise.all([saving,again]);assert(disk==='삭제 후 C'&&maxActive===1,'Overlapping saves wrote an old snapshot over a newer deletion');
	assert(!store.hasLocalEdits,'A successful save left the reader dirty');
	disk='수동 편집 없이 받은 변경';await store.refresh();
	assert(local===disk&&!store.hasLocalEdits&&!store.hasConflict,'A clean device raised a false Sync conflict');
	local='삭제 후 C';store.changed();
	disk='다른 기기의 원문과 새 내용';await store.refresh();
	assert(local==='삭제 후 C'&&conflicts.length===1&&store.hasConflict,'A Sync update resurrected text even after a recent successful save');
	assert(files.get(conflicts[0].localPath)==='삭제 후 C'&&files.get(conflicts[0].remotePath)===disk,'Both sides were not preserved byte-for-byte');
	local='충돌 중 더 편집';store.changed();await store.save();assert(disk==='다른 기기의 원문과 새 내용'&&[...files.values()].includes(local),'Paused autosave overwrote the remote file or discarded new local edits');
	assert(conflicts.length===1,'Continued paused typing repeatedly opened conflict notices');
	disk='두 번째 외부 변경';await store.resolve('local');
	assert(disk==='두 번째 외부 변경'&&local==='충돌 중 더 편집'&&conflicts.length===2,'Resolving against an outdated remote snapshot overwrote a newer Sync update');
	await store.resolve('local');assert(disk===local&&!store.hasConflict&&[...files.values()].includes('두 번째 외부 변경'),'Explicit local choice did not preserve and replace the selected remote version');
	local='다시 삭제';store.changed();disk='다시 외부 변경';await store.save();
	assert(local==='다시 삭제'&&disk==='다시 외부 변경'&&conflicts.length===3,'Compare-before-write failed to stop an unseen external overwrite');
	await store.resolve('remote');assert(local===disk&&!store.hasConflict,'Explicit remote choice failed');
	disk='편집하지 않을 때 받은 동기화';await store.refresh();assert(local===disk,'An untouched reader no longer follows Sync');
	let finishRead;holdRead=new Promise(resolve=>{finishRead=resolve;});disk='읽는 중 외부 변경';const refresh=store.refresh();
	local='읽는 중 새 입력';store.changed();finishRead();holdRead=null;await refresh;
	assert(local==='읽는 중 새 입력','A delayed disk read replaced newer input');
	failBackup=true;let rejected=false;try{await store.save();}catch{rejected=true;}
	assert(rejected&&disk==='읽는 중 외부 변경'&&local==='읽는 중 새 입력','Backup failure permitted a destructive write');
	failBackup=false;await store.save();assert([...files.values()].includes(local),'Backup retry discarded the dirty writer');
	store.dispose();
	let draft='';let finishLoad;holdRead=new Promise(resolve=>{finishLoad=resolve;});
	const loading=new PagedFileStore(vault,file,'Project/.writing-menu/paged-conflicts',()=>draft,data=>{draft=data;},()=>{});
	const loaded=loading.load();draft='파일을 읽는 동안 입력';loading.changed();finishLoad();holdRead=null;await loaded;
	assert(draft==='파일을 읽는 동안 입력'&&loading.hasConflict,'Initial async loading discarded an early keystroke');loading.dispose();
	disk='---\ntime: 1\n---\n지울 본문';local='';
	const metadata=new PagedFileStore(vault,file,'Project/.writing-menu/paged-conflicts',()=>local,data=>{local=data;},()=>{throw new Error('Metadata-only change raised a body conflict');},mergePagedMetadata);
	await metadata.load();local='---\ntime: 1\n---\n삭제 후';metadata.changed();disk='---\ntime: 2\n---\n지울 본문';
	await metadata.save();assert(disk==='---\ntime: 2\n---\n삭제 후'&&local===disk,'Metadata update restored old body text or lost frontmatter');
	disk='---\ntime: 3\n---\n삭제 후';await metadata.refresh();assert(local===disk,'Passive metadata refresh did not reach the editor');metadata.dispose();
	disk=baseline;local='';const mergedStore=new PagedFileStore(vault,file,'Project/.writing-menu/paged-conflicts',()=>local,data=>{local=data;},()=>{});
	await mergedStore.load();local=baseline.replace('첫줄','로컬');mergedStore.changed();disk=baseline.replace('다섯째','외부');
	const beforeBackup=files.size;await mergedStore.save();
	assert(disk===baseline.replace('첫줄','로컬').replace('다섯째','외부')&&local===disk&&!mergedStore.hasLocalEdits&&!mergedStore.hasConflict,'Disjoint edits did not save an exact merged result');
	assert(files.size===beforeBackup+2,'Automatic merge failed to preserve both inputs');mergedStore.dispose();
	console.info('Paged disk safety: serialized saves, real Sync conflicts, verified two-sided recovery, explicit choices, newer-remote guards, stale reads and backup IO failure passed');
}
