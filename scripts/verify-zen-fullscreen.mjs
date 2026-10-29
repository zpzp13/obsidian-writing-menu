import { ZenFullscreen, shouldExitZenOnEscape } from '../src/editor/ZenFullscreen';
import { DictionaryModal } from '../src/dictionary/DictionaryModal';
import { openSpecialChars } from '../src/special-chars/SpecialCharsModal';
import { DEFAULT_SETTINGS } from '../src/types';

export async function runZenFullscreenChecks() {
	const assert=(value,message)=>{if(!value)throw new Error(message);};
	const descriptor=Object.getOwnPropertyDescriptor(window,'electronWindow');
	const request=Object.getOwnPropertyDescriptor(document.documentElement,'requestFullscreen');
	let fullscreen=false,htmlRequests=0,exits=0;
	Object.defineProperty(window,'electronWindow',{configurable:true,value:{isFullScreen:()=>fullscreen,setFullScreen:value=>{fullscreen=value;}}});
	Object.defineProperty(document.documentElement,'requestFullscreen',{configurable:true,value:async()=>{htmlRequests++;}});
	const zen=new ZenFullscreen();
	const escape=event=>{if(shouldExitZenOnEscape(event,document)){event.preventDefault();exits++;zen.exit();}};
	window.addEventListener('keydown',escape);
	const plugin={app:{workspace:{activeEditor:null}},settings:structuredClone(DEFAULT_SETTINGS),async saveSettings(){}};
	try {
		zen.enter(document);zen.enter(document);
		assert(fullscreen&&zen.isActive(document)&&htmlRequests===0,'Desktop focus mode used browser fullscreen, which reserves Escape before modal handling');
		for(const kind of ['dictionary','special-characters']){
			let modal;
			if(kind==='dictionary'){modal=new DictionaryModal(plugin.app,plugin,null,'',null,null);await modal.onOpen();}
			else {openSpecialChars(plugin,null);modal=globalThis.lastTestModal;}
			await new Promise(resolve=>requestAnimationFrame(resolve));
			// The host Modal scope supplies this default Escape action. Let it close
			// synchronously without cancelling propagation to exercise the saved path.
			modal.containerEl.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented)modal.close();});
			const input=modal.containerEl.querySelector('input');input.focus();
			input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
			assert(!modal.containerEl.isConnected,`${kind}: Escape did not close the modal`);
			assert(fullscreen&&exits===0,`${kind}: modal Escape exited focus fullscreen`);
			window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',repeat:true,cancelable:true}));
			assert(fullscreen,'Holding modal Escape also exited fullscreen after the modal closed');
		}
		window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));
		assert(!fullscreen&&!zen.isActive(document)&&exits===1,'Escape without a modal did not exit focus fullscreen');
		fullscreen=true;zen.enter(document);zen.exit();
		assert(fullscreen,'Focus exit changed fullscreen that was already active before focus mode');
		console.info('Native focus fullscreen: dictionary/special-character Escape priority, held Escape, normal exit and pre-existing fullscreen passed');
	} finally {
		zen.exit();window.removeEventListener('keydown',escape);
		if(descriptor)Object.defineProperty(window,'electronWindow',descriptor);else delete window.electronWindow;
		if(request)Object.defineProperty(document.documentElement,'requestFullscreen',request);else delete document.documentElement.requestFullscreen;
	}
}
