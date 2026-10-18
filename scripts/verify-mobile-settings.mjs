import { DictionaryModal } from '../src/dictionary/DictionaryModal';
import { SpecialCharsModal } from '../src/special-chars/SpecialCharsModal';
import { configureApiKeyInput } from '../src/settings/ApiKeyInput';
import { DEFAULT_SETTINGS } from '../src/types';

export async function runMobileSettingsChecks() {
	const assert = (value,message) => { if (!value) throw new Error(message); };
	const settle = () => new Promise(resolve=>setTimeout(resolve,80));
	const apiHost = document.body.createDiv();
	const input = apiHost.createEl('input'); input.value = 'test-placeholder';
	let edits = 0; input.addEventListener('input',()=>edits++);
	configureApiKeyInput(input);
	const visibility = apiHost.querySelector('button');
	assert(input.type === 'password' && visibility.getAttribute('aria-pressed') === 'true','API key is not hidden by default');
	visibility.click();
	assert(input.type === 'text' && visibility.getAttribute('aria-pressed') === 'false','Inactive visibility icon does not show the key');
	visibility.click();
	assert(input.type === 'password' && visibility.getAttribute('aria-pressed') === 'true' && input.value === 'test-placeholder' && edits === 0,'Toggling key visibility changes the key or edit/save events');
	apiHost.remove();
	const viewportDescriptor = Object.getOwnPropertyDescriptor(window,'visualViewport');
	const viewport = new EventTarget(); viewport.height = window.innerHeight; viewport.offsetTop = 0;
	Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
	const oldSafe = document.body.style.getPropertyValue('--safe-area-inset-top');
	document.body.style.setProperty('--safe-area-inset-top','44px');
	document.body.classList.add('is-mobile');
	const plugin = {app:{},settings:structuredClone(DEFAULT_SETTINGS),saveSettings:async()=>{}};
	try {
		for (const kind of ['dictionary','special']) {
			const modal = kind === 'dictionary' ? new DictionaryModal(plugin.app,plugin,null,'',null,null) : new SpecialCharsModal(plugin.app,plugin,null);
			await modal.onOpen(); await settle();
			const initialHeightCap = Number.parseFloat(modal.containerEl.style.getPropertyValue('--wm-search-modal-height'));
			assert(initialHeightCap >= 300 && initialHeightCap <= 420,`${kind}: compact mobile height cap was not applied`);
			for (const [height,top] of [[844,0],[360,20],[300,0],[844,0]]) {
				viewport.height = height; viewport.offsetTop = top; viewport.dispatchEvent(new Event('resize')); await settle();
				const search = modal.contentEl.querySelector('.wm-search-field');
				const footer = modal.contentEl.querySelector(kind === 'dictionary' ? '.wm-dict-footer' : '.wm-sc-footer');
				const bounds = modal.modalEl.getBoundingClientRect();
				assert(search.getBoundingClientRect().top >= top+44,`${kind}: search overlaps the safe-area inset`);
				assert(bounds.bottom <= top+height-8 && footer.getBoundingClientRect().bottom <= top+height-8,`${kind}: modal/footer overlaps the keyboard at ${height}px`);
				assert(bounds.width <= window.innerWidth+1 && bounds.height > 150,`${kind}: mobile modal has invalid bounds`);
			}
			modal.close();
			viewport.height = 320; viewport.dispatchEvent(new Event('resize')); await settle();
			assert(!modal.containerEl.style.getPropertyValue('--wm-search-viewport-height'),`${kind}: visual viewport listeners were not released`);
			assert(!modal.containerEl.style.getPropertyValue('--wm-search-modal-height'),`${kind}: compact height cap was not released`);
			viewport.height = 844;
		}
	} finally {
		document.body.classList.remove('is-mobile');
		if(oldSafe)document.body.style.setProperty('--safe-area-inset-top',oldSafe);else document.body.style.removeProperty('--safe-area-inset-top');
		if(viewportDescriptor)Object.defineProperty(window,'visualViewport',viewportDescriptor);else delete window.visualViewport;
	}
	console.info('API visibility, mobile safe-area/keyboard geometry, viewport restoration and listener cleanup passed');
}
