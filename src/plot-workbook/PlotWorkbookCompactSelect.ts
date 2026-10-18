import { setIcon } from 'obsidian';
import { createToolbarOption } from '../toolbar/toolbarUi';

/** The toolbar's compact option list, retaining the select/change contract. */
export class PlotWorkbookCompactSelect {
	private readonly button: HTMLButtonElement;
	private popover: HTMLElement | null = null;
	private cleanup: (()=>void) | null = null;
	constructor(private readonly select: HTMLSelectElement) {
		select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden','true');
		this.button = select.parentElement!.createEl('button',{cls:'wm-plotbook-scope-select',attr:{type:'button','aria-label':`${select.getAttribute('aria-label')} 선택`,'aria-haspopup':'menu','aria-expanded':'false'}});
		this.button.createSpan({cls:'wm-paged-select-label',text:select.selectedOptions[0]?.textContent ?? ''});
		setIcon(this.button.createSpan({cls:'wm-paged-select-chevron','attr':{'aria-hidden':'true'}}),'chevron-down');
		this.button.addEventListener('click',()=>this.popover ? this.close() : this.open());
	}
	destroy(): void { this.close(false); }
	close(restoreFocus = true): void {
		this.cleanup?.(); this.cleanup = null;
		this.popover?.remove(); this.popover = null;
		this.button.setAttribute('aria-expanded','false');
		if(restoreFocus && this.button.isConnected)this.button.focus({preventScroll:true});
	}
	private open(): void {
		const doc = this.button.ownerDocument;
		const popover = this.popover = doc.body.createDiv({cls:'wm-paged-toolbar-popover wm-paged-compact-popover wm-plotbook-scope-popover',attr:{role:'menu','aria-label':`${this.select.getAttribute('aria-label')} 목록`}});
		this.button.setAttribute('aria-expanded','true');
		const buttons: HTMLButtonElement[] = [];
		for(const option of this.select.options) {
			const button = createToolbarOption(popover,option.textContent ?? '',option.selected,()=>{
				this.close();
				if(this.select.value === option.value)return;
				this.select.value = option.value; this.select.dispatchEvent(new Event('change',{bubbles:true}));
			});
			button.disabled = option.disabled; button.dataset.value = option.value;
			if(!button.disabled)buttons.push(button);
		}
		const outside = (event: Event) => { if(!popover.contains(event.target as Node) && !this.button.contains(event.target as Node))this.close(false); };
		const keydown = (event: KeyboardEvent) => {
			if(event.isComposing)return;
			if(event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
			if(!popover.contains(event.target as Node))return;
			const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
			const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : event.key === 'ArrowDown' ? (index+1)%buttons.length : event.key === 'ArrowUp' ? (index+buttons.length-1)%buttons.length : -1;
			if(target>=0) { event.preventDefault(); event.stopPropagation(); buttons[target]?.focus(); }
		};
		doc.addEventListener('pointerdown',outside,true); doc.addEventListener('focusin',outside); doc.addEventListener('keydown',keydown,true);
		this.cleanup = ()=>{doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('focusin',outside);doc.removeEventListener('keydown',keydown,true);};
		const bounds = this.button.getBoundingClientRect();
		const width = Math.min(204,doc.documentElement.clientWidth-16);
		popover.style.position = 'fixed'; popover.style.width = `${width}px`;
		popover.style.minWidth = `${Math.min(188,width)}px`;
		popover.style.left = `${Math.max(8,Math.min(bounds.left,doc.documentElement.clientWidth-width-8))}px`;
		popover.style.maxHeight = `${Math.max(80,Math.min(280,doc.documentElement.clientHeight-16))}px`;
		popover.style.top = `${Math.max(8,Math.min(bounds.bottom+6,doc.documentElement.clientHeight-popover.offsetHeight-8))}px`;
		(buttons.find(button=>button.dataset.value === this.select.value) ?? buttons[0])?.focus();
	}
}
