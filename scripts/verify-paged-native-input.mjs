import { PagedWritingView } from '../src/paged/PagedWritingView';
import { DEFAULT_SETTINGS } from '../src/types';
import { serializePagedText } from '../src/paged/textLayout';
import { PaginationEngine } from '../src/paged/PaginationEngine';

export function installNativePagedInputChecks() {
	let view, host, before, position, scrollTrace, observer, foreignMutations, activePage, staleFlow, events, stability, stabilityFrame;
	globalThis.nativePagedProbe = {
		async begin(zoom, blank = false, lastPage = false, centeredRow = false, column = 2) {
			if (view) await this.dispose();
			host = document.body.createDiv({cls:'test-leaf'}); host.createDiv(); host.createDiv();
			const plugin = {settings:{...structuredClone(DEFAULT_SETTINGS), fontFamily:'리디바탕',fontSize:18.666666666666664,lineHeight:2,indentation:9.333333333333332,paragraphSpacing:0,
				enableSmartQuotes:true,enableSmartEnter:true,enableSmartInput:true,enableTextSubstitution:true,hrEnabled:true,showMunpiaWidget:true,enableTypewriterScrolling:lastPage||centeredRow},
				projectContext:{getProjectForFile:()=>({id:'test'})},toolbarManager:{mountPagedToolbar(){},removeToolbarFromLeaf(){},refreshToolbar(){},refreshToolbarSelection(){}},
				notifyPagedEditorChanged(){},updateCharCountDebounced(){},async saveData(){}};
			view = new PagedWritingView({containerEl:host,app:{scope:{},workspace:{on(){return{};},offref(){},trigger(){}}}},plugin);
			await view.onOpen();
			before = blank ? ('한글 문장의 다음 줄입니다.\n\n').repeat(150) : ('한글 문장과 English words를 페이지 경계에서 이어서 입력합니다. ').repeat(150);
			view.setViewData(before,true); view.setZoom(zoom);
			if(centeredRow){host.style.width=`${3*view.displayedPageWidth+2*8+32+18}px`;view.updateGridColumns(view.viewportEl.clientWidth);}
			if(lastPage){before=before.slice(0,view.pages[view.pages.length-2].to-1);view.setViewData(before,true);}
			view.restoreSelection({anchor:0,head:before.length},true); view.applyParagraphAlignment('justify');
			let page = view.pages[0]; position = page.to - 1;
			if(centeredRow){const columns=view.gridColumns;page=view.pages[Math.min(view.pages.length-2,Math.floor(view.pages.length/2/columns)*columns+column)];position=page.to-1;}
			if (blank) {
				page = view.pages.slice(0,-1).find(p => {view.renderPageIfNeeded(p.index); return view.pageTextEls[p.index].lastElementChild.querySelector('.wm-paged-text-run')?.classList.contains('is-empty');});
				if (!page) throw new Error('No blank boundary for native IME');
				position = page.to - 1;
			}
			view.placeCaretInPage(page.index,position,false);
			if(lastPage){position=before.length;view.placeCaretInPage(view.pages.length-1,position,false);}
			view.pageEls[page.index].scrollIntoView({block:'center'});
			scrollTrace=[];
			view.viewportEl.addEventListener('scroll',()=>scrollTrace.push(view.viewportEl.scrollTop));
			if(lastPage||centeredRow){view.centerActivePage();await new Promise(resolve=>setTimeout(resolve,60));scrollTrace.length=0;}
			foreignMutations=[];activePage=null;staleFlow=[];events=[];
			const trace=event=>{
				const session=view.compositionSession;
				events.push({type:event.type,inputType:event.inputType,data:event.data,composing:view.composing,selection:view.readSelection(),length:view.getEditableData().length,
					session:session&&{from:session.from,to:session.to,pageFrom:session.pageFrom,pageTo:session.pageTo,text:session.text}});
				if(events.length>20)events.shift();
			};
			for(const name of ['compositionstart','compositionend','beforeinput','input'])view.editRootEl.addEventListener(name,trace);
			view.editRootEl.addEventListener('compositionstart',()=>{activePage=document.getSelection().focusNode.parentElement.closest('.wm-paged-page-shell');});
			if(centeredRow && column===0){
				// Audit before the next native composition can freeze the editing tree.
				// Waiting for an idle frame hides pages left stale during held keys.
				const audit=event=>{if((event.type!=='beforeinput'||!view.composing)&&staleFlow.length<10){const stale=this.visibleFlow().stale;if(stale.length)staleFlow.push({event:event.type,stale});}};
				for(const name of ['compositionstart','compositionend','beforeinput'])view.editRootEl.addEventListener(name,audit);
			}
			observer=new MutationObserver(records=>{
				for(const record of records)if(view.composing && activePage && record.type==='childList' && record.target!==activePage && !activePage.contains(record.target))foreignMutations.push(record.target.className||record.target.nodeName);
			});
			observer.observe(view.editRootEl,{childList:true,subtree:true});
			return {position};
		},
		snapshot() {
			return {text:view.getEditableData(), expected:before.slice(0,position)+'ㅇ'+before.slice(position),
				domText:[...view.pageTextEls].filter(Boolean).map(el=>el.textContent).join(''), composing:view.composing,
				previews:view.compositionPreviewEls.length, selection:view.readSelection(), scrollTop:view.viewportEl.scrollTop, scrollTrace, foreignMutations, staleFlow,
				compositionPaint:!!view.compositionClippedTextEl||!!view.compositionCaretEl,
				previewInEditor:!!view.editRootEl.querySelector('.wm-paged-composition-preview'), columns:view.gridColumns, position,
				previewOffsetError:Math.max(0,...view.compositionPreviewEls.map(preview=>{
					const page=view.pageEls[Number(preview.dataset.pageIndex)];if(!page)return 0;
					const a=preview.getBoundingClientRect(),b=page.getBoundingClientRect();return Math.max(Math.abs(a.top-b.top),Math.abs(a.left-b.left));
				})),
				expectedScrollTop:view.typewriterScrollTarget, rootPages:view.editRootEl.children.length, pages:view.pageEls.length,
				validPageTree:view.pageEls.every((el,index)=>el.parentElement===view.editRootEl&&view.editRootEl.children[index]===el),
				activeCenterError:(()=>{const p=activePage?.getBoundingClientRect(),v=view.viewportEl.getBoundingClientRect();return p? p.top+p.height/2-v.top-view.viewportEl.clientHeight/2:null;})()};
		},
		visibleFlow(fresh = false) {
			const source=view.getEditableData(),selection=view.cachedSelection;
			const stale=view.getVisibleRenderPageIndices(selection).filter(index=>{
				const page=view.pages[index],el=view.pageTextEls[index];
				return !el || serializePagedText(el)!==source.slice(page.from,page.to);
			});
			let boundariesMatch=true;
			if(fresh){const engine=new PaginationEngine(view.measurerEl,view.getPaginationGeometry());engine.updateInlineFormats(view.getInlineFormatRanges());boundariesMatch=JSON.stringify(view.pages)===JSON.stringify(engine.paginate(source));}
			return {stale,boundariesMatch};
		},
		cachedDomMismatches() {
			return view.pageTextEls.flatMap((el,index)=>{
				const cached=el&&view.pageRenderStates.get(el);if(!cached)return [];
				const dom=serializePagedText(el);
				return dom===cached.text?[]:[{index,rendered:cached.text.length,dom:dom.length,dirty:view.nativeEditedPageEls.has(el)}];
			});
		},
		previewFlow() {
			const source=view.getEditableData(),engine=new PaginationEngine(view.measurerEl,view.getPaginationGeometry());
			engine.updateInlineFormats(view.getInlineFormatRanges());
			const pages=engine.paginate(source),activeIndex=Number(activePage?.dataset.pageIndex??-1);
			const stale=view.getVisibleRenderPageIndices(view.cachedSelection).filter(index=>index!==activeIndex&&pages[index]).filter(index=>{
				const preview=view.compositionPreviewEls.find(el=>Number(el.dataset.pageIndex)===index);
				const text=preview?.querySelector('.wm-paged-page-text')??view.pageTextEls[index],page=pages[index];
				return !text||serializePagedText(text)!==source.slice(page.from,page.to);
			});
			return {stale};
		},
		visualCaret() {
			const session=view.compositionSession;
			const source=session?.text!==null&&session?.text!==undefined
				? session.source.slice(0,session.from)+session.text+session.source.slice(session.to):view.getEditableData();
			const position=session?.text?.length?session.from+session.text.length-1:view.cachedSelection.head;
			const engine=new PaginationEngine(view.measurerEl,view.getPaginationGeometry());engine.updateInlineFormats(view.getInlineFormatRanges());
			const pages=engine.paginate(source),page=pages.find(p=>position>=p.from&&position<p.to)??pages[pages.length-1];
			const shell=view.compositionPreviewEls.find(el=>Number(el.dataset.pageIndex)===page.index)??view.pageEls[page.index];
			const p=shell?.getBoundingClientRect(),v=view.viewportEl.getBoundingClientRect();
			return {pageIndex:page.index,nativePageIndex:view.getNativeFocusPageIndex(),centerError:p?p.top+p.height/2-v.top-view.viewportEl.clientTop-view.viewportEl.clientHeight/2:null};
		},
		setTypewriter(enabled) {view.plugin.settings.enableTypewriterScrolling=enabled;view.applyGeometryVariables();if(enabled)view.centerActivePage();},
		prepareDeletionBoundary(fontSize=12,column=2,lastPage=false) {
			view.plugin.settings.fontSize=fontSize;view.plugin.settings.indentation=fontSize/2;view.refreshFromSettings();
			before=('마지막 행에서 입력한 내용을 지웠다가 다시 쓰는 문장입니다.\n\n').repeat(18);view.setViewData(before,true);
			let index=Math.min(column,view.pages.length-2),page=view.pages[index];position=page.to-1;
			if(lastPage){before=before.slice(0,position);view.setViewData(before,true);index=view.pages.length-1;page=view.pages[index];position=before.length;}
			view.placeCaretInPage(index,position,false);view.pageEls[index].scrollIntoView({block:'center'});
			if(view.plugin.settings.enableTypewriterScrolling)view.centerActivePage();
			return {position};
		},
		resizeColumns(columns) {host.style.width=`${columns*view.displayedPageWidth+(columns-1)*8+32+18}px`;view.updateGridColumns(view.viewportEl.clientWidth);},
		viewportCrop() {const r=view.viewportEl.getBoundingClientRect();return {x:Math.max(0,r.x),y:Math.max(0,r.y),width:Math.min(innerWidth-r.x,r.width),height:Math.min(innerHeight-r.y,r.height),scale:1};},
		releasedCommitDom() {
			// The final platform insertion may arrive in the same task as the edit
			// that released the IME. Its old snapshot must not undo that deletion.
			const text=view.compositionSession.text;
			view.editRootEl.dispatchEvent(new InputEvent('beforeinput',{inputType:'deleteContentBackward',isComposing:true,bubbles:true,cancelable:true}));
			const selection=document.getSelection();selection.focusNode.insertData(selection.focusOffset,text);
			view.editRootEl.dispatchEvent(new InputEvent('input',{inputType:'insertText',data:text,bubbles:true}));
		},
		startStability() {
			const index=view.getNativeFocusPageIndex(),page=view.pages[index];position=page.from+3;
			view.placeCaretInPage(index,position,false);if(view.plugin.settings.enableTypewriterScrolling)view.centerActivePage();
			stability=[];
			const sample=()=>{const shell=view.pageEls[index],text=view.pageTextEls[index],content=text.parentElement;
				stability.push({top:shell.getBoundingClientRect().top,textTop:text.getBoundingClientRect().top,scroll:view.viewportEl.scrollTop,target:view.typewriterScrollTarget,composing:view.composing,
					inner:[shell.scrollTop,shell.firstElementChild.scrollTop,content.scrollTop,text.scrollTop],native:view.getNativeFocusPageIndex(),head:view.readSelection()?.head});};
			const tick=()=>{sample();stabilityFrame=requestAnimationFrame(tick);};stabilityFrame=requestAnimationFrame(tick);
			for(const name of ['input','compositionstart','compositionend'])view.editRootEl.addEventListener(name,sample);
			sample();return {position};
		},
		stability() {return stability;},
		longBoundary() {
			before=('한글 문장과 English words를 페이지 경계에서 이어서 입력합니다. ').repeat(600);view.setViewData(before,true);
			const index=Math.floor(view.pages.length/2/3)*3+2,page=view.pages[index];position=page.to-1;
			view.placeCaretInPage(index,position,false);view.centerActivePage();return {position,index};
		},
		prepareOverflowVisibility(paragraphSpacing) {
			view.plugin.settings.pagedPageHeight=1173;view.plugin.settings.paragraphSpacing=paragraphSpacing;view.refreshFromSettings();
			before=('페이지 마지막 줄에서 입력하는 문장입니다.\n다음 문단을 이어 씁니다.\n').repeat(100);view.setViewData(before,true);
			const index=Math.floor(view.pages.length/2/3)*3,page=view.pages[index];position=page.to-1;
			view.placeCaretInPage(index,position,false);view.pageEls[index].scrollIntoView({block:'center'});
			if(view.plugin.settings.enableTypewriterScrolling)view.centerActivePage();
		},
		overflowVisibility() {
			const session=view.compositionSession,index=view.getNativeFocusPageIndex(),native=view.pageTextEls[index];
			const preview=view.compositionPreviewEls.find(shell=>Number(shell.dataset.pageIndex)>index&&Number(shell.querySelector('.wm-paged-page-text').dataset.from)<session.from+session.text.length);
			if(!preview)return {missingPreview:true};
			const previewText=preview.querySelector('.wm-paged-page-text'),offset=Math.max(session.from,Number(previewText.dataset.from));
			const glyphRect=(text,local)=>{const point=view.pageLocalDomPoint(text,local),range=document.createRange();range.setStart(point.node,point.offset);range.setEnd(point.node,point.offset+1);return range.getBoundingClientRect();};
			const a=glyphRect(native,offset-session.pageFrom),b=glyphRect(previewText,offset-Number(previewText.dataset.from));
			const content=native.parentElement.getBoundingClientRect(),previewContent=previewText.parentElement.getBoundingClientRect();
			const visibleHeight=Math.min(a.bottom,content.bottom)-Math.max(a.top,content.top);
			const hit=visibleHeight>0?document.elementFromPoint(a.left+a.width/2,Math.max(a.top,content.top)+Math.min(2,visibleHeight/2)):null;
			return {missingPreview:false,nativeVisible:!!hit&&native.contains(hit),previewVisible:b.bottom>previewContent.top&&b.top<previewContent.bottom,
				visibleHeight,nativeTop:a.top,contentBottom:content.bottom,clip:getComputedStyle(native).clipPath,
				caret:!!preview.querySelector('.wm-paged-composition-caret'),
				crop:(()=>{const l=view.pageEls[index].getBoundingClientRect(),r=preview.getBoundingClientRect();const x=Math.max(0,Math.min(l.left,r.left)-4),y=Math.max(0,Math.min(l.top,r.top)-4);return {x,y,width:Math.max(l.right,r.right)-x+4,height:Math.min(1000-y,Math.max(l.bottom,r.bottom)-y+4),scale:1};})()};
		},
		previewGlyphs() {
			return view.compositionPreviewEls.map(shell=>{
				const text=shell.querySelector('.wm-paged-page-text'),point=view.pageLocalDomPoint(text,0);
				const range=document.createRange();range.setStart(point.node,point.offset);range.setEnd(point.node,point.offset+1);
				return {from:Number(text.dataset.from),page:Number(shell.dataset.pageIndex),top:range.getBoundingClientRect().top,paperTop:shell.getBoundingClientRect().top};
			});
		},
		committedGlyphs(refs) {
			return refs.map(ref=>{
				const index=view.findPageIndex(ref.from),page=view.pages[index],point=view.pageLocalDomPoint(view.pageTextEls[index],ref.from-page.from);
				const range=document.createRange();range.setStart(point.node,point.offset);range.setEnd(point.node,point.offset+1);
				return {top:range.getBoundingClientRect().top,paperTop:view.pageEls[index].getBoundingClientRect().top,page:index};
			});
		},
		diagnostics() {const session=view.compositionSession;return {events,session:session&&{from:session.from,to:session.to,pageFrom:session.pageFrom,pageTo:session.pageTo,text:session.text}};},
		caretPoint(offset) {
			view.releaseTypewriterScroll();
			const index=view.findPageIndex(offset),page=view.pages[index];
			view.renderPageIfNeeded(index);
			view.pageEls[index].scrollIntoView({block:'center'});
			const point=view.pageLocalDomPoint(view.pageTextEls[index],offset-page.from);
			const range=document.createRange();range.setStart(point.node,point.offset);range.collapse(true);
			const rect=range.getBoundingClientRect();return {x:rect.left,y:rect.top+rect.height/2};
		},
		lastLineStart() {
			const index=view.getNativeFocusPageIndex(),page=view.pages[index],text=view.pageTextEls[index];
			const topAt=offset=>{const point=view.pageLocalDomPoint(text,offset-page.from);const range=document.createRange();range.setStart(point.node,point.offset);range.collapse(true);return range.getBoundingClientRect().top;};
			let offset=page.to-1;const top=topAt(offset);
			while(offset>page.from&&Math.abs(topAt(offset-1)-top)<1)offset--;
			position=offset;view.placeCaretInPage(index,position,false);
			return {position,index};
		},
		uniformLastLine() {
			before='ㄴ'.repeat(3000);view.setViewData(before,true);
			const index=Math.floor(view.pages.length/2),page=view.pages[index];position=page.to-3;
			view.placeCaretInPage(index,position,false);view.pageEls[index].scrollIntoView({block:'center'});
			return {position};
		},
		retiredCompositionDom() {
			// A late native edit can arrive after its page was marked clean. Its
			// extra text must not survive just because the cached source still matches.
			const index=view.getNativeFocusPageIndex(),el=view.pageTextEls[index];
			el.querySelector('.wm-paged-text-run').appendChild(document.createTextNode('ㄴ'.repeat(6)));
			const cleanBefore=!view.nativeEditedPageEls.has(el);
			view.renderVisiblePages();
			return {cleanBefore,text:view.getEditableData(),mismatches:this.cachedDomMismatches()};
		},
		prepareKoreanBoundary(fontSize, lineHeight, paragraphSpacing, mode, formatted = false) {
			Object.assign(view.plugin.settings,{fontSize,lineHeight,paragraphSpacing,indentation:fontSize/2,pagedPageHeight:1123});view.refreshFromSettings();
			before=mode==='paragraphs'?('경계에서 지우고 다시 입력하는 한글 문장입니다.\n').repeat(120):('경계에서 지우고 다시 입력하는 한글 문장입니다. ').repeat(120);
			view.setViewData(formatted ? before.replaceAll('한글', '**한글**') : before,true);
			before=view.getEditableData();
			const index=Math.min(view.pages.length-2,Math.floor(view.pages.length/2/3)*3+1),page=view.pages[index];
			// 'end': caret after the last glyph of a page; 'start': before the first glyph of the following page.
			position=page.to;
			if(mode==='start')view.placeCaretInPage(index+1,position,false);else view.placeCaretInPage(index,position,false);
			view.pageEls[index].scrollIntoView({block:'center'});
			if(view.plugin.settings.enableTypewriterScrolling)view.centerActivePage();
			return {position,index,pages:view.pages.length,length:view.getEditableData().length};
		},
		boundaryState() {
			const source=view.getEditableData(),session=view.compositionSession;
			const visible=view.getVisibleRenderPageIndices(view.cachedSelection);
			const stale=visible.filter(index=>{const el=view.pageTextEls[index],page=view.pages[index];return !view.composing&&(!el||serializePagedText(el)!==source.slice(page.from,page.to));});
			const engine=new PaginationEngine(view.measurerEl,view.getPaginationGeometry());engine.updateInlineFormats(view.getInlineFormatRanges());
			const fresh=view.composing?null:engine.paginate(source);
			// Composing glyphs painted by the native page below the paginator's last
			// line are visible as a stray syllable on the next line of that page.
			let strayGlyph=null;
			if(view.composing&&session?.text){
				const index=view.getNativeFocusPageIndex(),text=view.pageTextEls[index],content=text?.parentElement;
				if(text&&content){
					const capacity=Math.floor((view.getPaginationGeometry().pageHeight-view.getPaginationGeometry().marginTop-view.getPaginationGeometry().marginBottom+0.001)/(view.pageGeometry.fontSize*view.pageGeometry.lineHeight));
					const lh=view.pageGeometry.fontSize*view.pageGeometry.lineHeight*view.zoom,box=content.getBoundingClientRect();
					const clip=getComputedStyle(text).clipPath;
					for(let local=Math.max(0,session.from-view.pages[index].from);local<session.from-view.pages[index].from+session.text.length;local++){
						const point=view.pageLocalDomPoint(text,local);if(!point||point.node.nodeType!==3||point.offset>=point.node.length)continue;
						const range=document.createRange();range.setStart(point.node,point.offset);range.setEnd(point.node,point.offset+1);
						const r=range.getBoundingClientRect();if(!r.height)continue;
						const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
						if(r.top>=box.top+capacity*lh-1&&r.top<box.bottom&&hit&&text.contains(hit))strayGlyph={local,top:r.top-box.top,capacityPx:capacity*lh,box:box.height,clip};
					}
				}
			}
			const domLines=index=>{
				const el=view.pageTextEls[index],page=view.pages[index];if(!el)return null;
				view.renderPageIfNeeded(index);
				const starts=[];let lastTop=null;const content=el.parentElement.getBoundingClientRect();
				for(let local=0;local<page.to-page.from;local++){
					const point=view.pageLocalDomPoint(el,local);if(!point||point.node.nodeType!==3||point.offset>=point.node.length)continue;
					const range=document.createRange();range.setStart(point.node,point.offset);range.setEnd(point.node,point.offset+1);
					const top=(range.getClientRects()[0]??range.getBoundingClientRect()).top;
					if(lastTop===null||top>lastTop+0.5){starts.push([page.from+local,Math.round((top-content.top)*10)/10]);lastTop=top;}
				}
				return {starts,contentHeight:Math.round(content.height*10)/10};
			};
			const pageDiff=fresh?(()=>{const index=fresh.findIndex((p,i)=>!view.pages[i]||p.from!==view.pages[i].from||p.to!==view.pages[i].to);
				if(index<0&&fresh.length===view.pages.length)return null;
				const at=index<0?fresh.length:index,page=view.pages[at]??null,ref=fresh[at]??null;
				const edge=ref&&page?Math.min(ref.to,page.to):0;
				return {index:at,pages:view.pages.length,freshPages:fresh.length,view:page&&[page.from,page.to],fresh:ref&&[ref.from,ref.to],
					around:JSON.stringify(source.slice(Math.max(0,edge-12),edge+12)),
					domView:JSON.stringify(domLines(at)),
					engineLines:(()=>{const e=new PaginationEngine(view.measurerEl,view.getPaginationGeometry());const pFrom=source.lastIndexOf('\n',ref.from-1)+1,pTo=source.indexOf('\n',ref.from);const text=source.slice(pFrom,pTo<0?source.length:pTo);
						const full=e.measureAllLines(text,true,pFrom).map(o=>o+pFrom).filter(o=>o>=ref.from-40&&o<=Math.max(ref.to,page.to)+20);
						const cached=view.pagination.positionCache.get(view.pagination.positionKey(true,pFrom,''));
						return {full,cached:cached?cached.lineStarts.map(o=>o+pFrom).filter(o=>o>=ref.from-40&&o<=Math.max(ref.to,page.to)+20):null};})(),
					freshFull:JSON.stringify(new PaginationEngine(view.measurerEl,view.getPaginationGeometry()).paginate(source).slice(Math.max(0,at-1),at+2).map(p=>[p.from,p.to]))};})():null;
			return {pageDiff,text:source,composing:view.composing,stale,boundariesMatch:!fresh||JSON.stringify(fresh.map(p=>[p.from,p.to]))===JSON.stringify(view.pages.map(p=>[p.from,p.to])),
				head:view.readSelection()?.head??null,strayGlyph,mismatches:view.composing?[]:this.cachedDomMismatches()};
		},
		forceNativeCaretScroll() {view.viewportEl.scrollTop+=120;view.handleViewportScroll();},
		manualScroll() {view.rootEl.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:100}));view.viewportEl.scrollTop-=100;view.handleViewportScroll();},
		duplicatePreeditDom() {
			// Windows may leave retired preedit text in the native block tree while
			// delivering its final insertion. The composition payload remains one ㅇ.
			const selection=document.getSelection();selection.focusNode.insertData(selection.focusOffset,'ㅇ'.repeat(35));
		},
		async dispose() {if(stabilityFrame)cancelAnimationFrame(stabilityFrame);stabilityFrame=0;observer?.disconnect();if(view){await view.onClose();host.remove();view=null;}}
	};
}
