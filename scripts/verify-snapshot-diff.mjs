import { renderSnapshotDiff, renderSnapshotText } from '../src/snapshots/SnapshotDiffView';
import { PlotWorkbookSnapshotModal } from '../src/plot-workbook/PlotWorkbookSnapshotModal';

const head=Array.from({length:18},(_,index)=>`문맥 ${index}`), tail=Array.from({length:437},(_,index)=>`동일 ${index}`);
export const SNAPSHOT_DIFF_BEFORE=[...head,'퇴고_시간: 00:08:10','총_시간: 222:21:07',...tail].join('\n');
export const SNAPSHOT_DIFF_AFTER=[...head,'퇴고_시간: 00:08:43','총_시간: 222:21:40',...tail].join('\n');

export async function runSnapshotDiffChecks() {
	const assert=(value,message)=>{if(!value)throw new Error(message);};
	const host=document.body.createDiv();
	const expand=()=>{for(const control of host.querySelectorAll('.diff-collapsed[aria-expanded="false"]'))control.click();};
	const source=side=>[...host.querySelectorAll(`.diff-line:not(.mod-${side==='left'?'right':'left'})`)].map(line=>line.textContent==='\u00a0'?'':line.textContent).join('\n');
	try {
		renderSnapshotDiff(host,SNAPSHOT_DIFF_BEFORE,SNAPSHOT_DIFF_AFTER);
		assert(host.querySelectorAll('.diff-line').length<30,'Unchanged snapshot lines were eagerly rendered');
		const folds=[...host.querySelectorAll('.diff-collapsed')];
		assert(folds.map(control=>control.textContent).join(',')==='12 lines folded,431 lines folded','Snapshot fold counts do not exclude the six context lines');
		const first=folds[0], region=document.getElementById(first.getAttribute('aria-controls'));
		assert(first.tabIndex===0&&first.getAttribute('role')==='button'&&region.hidden&&!region.children.length,'Collapsed snapshot lines are not lazy or keyboard accessible');
		first.click();assert(!region.hidden&&region.querySelectorAll('.diff-line').length===12&&first.getAttribute('aria-expanded')==='true','Click did not reveal the exact unchanged lines');
		first.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
		assert(region.hidden&&first.getAttribute('aria-expanded')==='false','Enter did not refold the unchanged section');
		first.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
		assert(!region.hidden&&region.children.length===12,'Space did not reopen or duplicated the unchanged section');
		first.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
		assert(!region.hidden,'An IME composition toggled the diff fold');
		assert([...host.querySelectorAll('.mod-left .diff-changed')].map(span=>span.textContent).join(',')==='10,7','Removed digits did not receive precise secondary highlights');
		assert([...host.querySelectorAll('.mod-right .diff-changed')].map(span=>span.textContent).join(',')==='43,4','Added digits did not receive precise secondary highlights');
		expand();assert(source('left')===SNAPSHOT_DIFF_BEFORE&&source('right')===SNAPSHOT_DIFF_AFTER,'Expanding did not reconstruct both snapshots exactly');
		for(const [before,after] of [
			['첫 줄\n원래 문장\n끝','첫 줄\n새 문장 추가\n원래 문장 수정\n끝'],
			['첫 줄\n\n지울 줄\n끝\n','첫 줄\n\n끝\n'],['','추가\n한 줄'],['삭제\n한 줄',''],
			['A\r\nB\r\n','A\r\n수정\r\n'],['<img src=x onerror="alert(1)">','<script>alert(2)</script>'],
		]) {
			renderSnapshotDiff(host,before,after);expand();
			assert(source('left')===before&&source('right')===after,'Multiline insertion/deletion/blank/CRLF diff changed the source text');
			assert(!host.querySelector('img,script'),'Snapshot diff interpreted source text as HTML');
		}
		const unicodeBefore='표정 👩‍💻는 😀, 카페 a\u0301.', unicodeAfter='표정 👩‍🔬는 😃, 카페 a\u0300.';
		renderSnapshotDiff(host,unicodeBefore,unicodeAfter);
		assert(source('left')===unicodeBefore&&source('right')===unicodeAfter,'Unicode inline diff changed the source');
		const highlighted=[...host.querySelectorAll('.diff-changed')].map(span=>span.textContent);
		assert(['👩‍💻','👩‍🔬','😀','😃','a\u0301','a\u0300'].every(value=>highlighted.some(text=>text.includes(value))),'Inline highlights split an emoji/ZWJ/combining grapheme');
		const many=Array.from({length:10_000},(_,index)=>`유지 ${index}`).join('\n');renderSnapshotDiff(host,many,many);
		assert(host.querySelectorAll('.diff-line').length===6&&host.querySelector('.diff-collapsed').textContent==='9994 lines folded','Large unchanged snapshots are not bounded before expansion');
		renderSnapshotText(host,many);assert(!host.querySelector('.diff-collapsed')&&host.querySelectorAll('.diff-line').length===10_000,'Normal snapshot mode unexpectedly folds or truncates text');
		renderSnapshotDiff(host,'a'.repeat(100_001),'b'.repeat(100_001));
		assert(host.querySelectorAll('.diff-changed').length===2&&source('left').length===100_001&&source('right').length===100_001,'Oversized inline fallback lost content');
	} finally {host.remove();}
	const ref={id:'test-snapshot',title:'셀 스냅샷',createdAt:Date.now(),sheetId:'sheet',rowId:'row',columnId:'column'};
	const session={activeSheet:{sheetId:'sheet'},listCellSnapshots:()=>[ref],readCellSnapshot:async()=>({...ref,value:SNAPSHOT_DIFF_BEFORE}),getCell:()=>SNAPSHOT_DIFF_AFTER};
	const modal=new PlotWorkbookSnapshotModal({app:{}},session,[{rowId:'row',columnId:'column',label:'테스트 셀'}]).open();
	try {
		await new Promise(resolve=>setTimeout(resolve,0));
		const toggle=modal.contentEl.querySelector('.modal-setting-titlebar-toggle input');toggle.checked=true;toggle.dispatchEvent(new Event('change'));
		await new Promise(resolve=>setTimeout(resolve,0));
		assert(modal.contentEl.querySelector('.wm-snapshot-diff-view')&&modal.contentEl.querySelector('.diff-collapsed').textContent==='12 lines folded'&&modal.contentEl.querySelectorAll('.diff-changed').length===4,'Cell snapshot modal did not use the shared precise/folded renderer');
	} finally {modal.close();}
	console.info('Shared snapshot diff: exact inline highlights, lazy 12/431-line folds, mouse/Enter/Space refolding, multiline/CRLF/Unicode fidelity, HTML safety, large-block bounds and real cell modal integration passed');
}
