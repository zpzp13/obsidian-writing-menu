import { createToolbarOption, createToolbarSelect } from './toolbarUi';

/** Compact toolbar picker; the native select remains the source of value/change events. */
export class ToolbarSelect {
	private readonly button: HTMLButtonElement;
	private popover: HTMLElement | null = null;
	private cleanup: (() => void) | null = null;
	private readonly originalHidden: HTMLSelectElement['hidden'];
	private readonly originalTabIndex: number;
	private readonly originalAriaHidden: string | null;
	constructor(private readonly select: HTMLSelectElement, modifier: string) {
		this.originalHidden = select.hidden;
		this.originalTabIndex = select.tabIndex;
		this.originalAriaHidden = select.getAttribute('aria-hidden');
		select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
		this.button = createToolbarSelect(select.parentElement!, `${select.getAttribute('aria-label')} 선택`, '', modifier);
		this.button.addEventListener('click', this.toggle);
		select.addEventListener('change', this.refresh);
		this.refresh();
	}
	destroy(): void {
		this.close(false);
		this.select.removeEventListener('change', this.refresh);
		this.button.removeEventListener('click', this.toggle);
		this.button.remove();
		this.select.hidden = this.originalHidden;
		this.select.tabIndex = this.originalTabIndex;
		if (this.originalAriaHidden === null) this.select.removeAttribute('aria-hidden');
		else this.select.setAttribute('aria-hidden', this.originalAriaHidden);
	}
	close(restoreFocus = true): void {
		this.cleanup?.(); this.cleanup = null;
		this.popover?.remove(); this.popover = null;
		this.button.setAttribute('aria-expanded', 'false');
		this.button.removeClass('is-open');
		if (restoreFocus && this.button.isConnected) this.button.focus({ preventScroll: true });
	}
	private readonly refresh = (): void => {
		this.button.querySelector('.wm-paged-select-label')!.textContent = this.select.selectedOptions[0]?.textContent ?? '';
		this.button.disabled = this.select.disabled;
	};
	private readonly toggle = (): void => { if (this.popover) this.close(); else this.open(); };
	private open(): void {
		if (this.select.disabled) return;
		const doc = this.button.ownerDocument;
		const mount = this.button.closest<HTMLElement>('.modal-container') ?? doc.body;
		const popover = this.popover = mount.createDiv({ cls: 'wm-paged-toolbar-popover wm-paged-compact-popover wm-toolbar-select-popover',
			attr: { role: 'menu', 'aria-label': `${this.select.getAttribute('aria-label')} 목록` } });
		this.button.setAttribute('aria-expanded', 'true'); this.button.addClass('is-open');
		const buttons: HTMLButtonElement[] = [];
		for (const option of this.select.options) {
			const button = createToolbarOption(popover, option.textContent ?? '', option.selected, () => {
				this.close();
				if (this.select.value === option.value) return;
				this.select.value = option.value;
				this.select.dispatchEvent(new Event('change', { bubbles: true }));
			});
			button.disabled = option.disabled; button.dataset.value = option.value;
			if (!button.disabled) buttons.push(button);
		}
		const outside = (event: Event) => {
			if (!popover.contains(event.target as Node) && !this.button.contains(event.target as Node)) this.close(false);
		};
		const keydown = (event: KeyboardEvent) => {
			if (event.isComposing) return;
			if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
			if (!popover.contains(event.target as Node)) return;
			const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
			const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
				: event.key === 'ArrowDown' ? (index + 1) % buttons.length
				: event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : -1;
			if (target >= 0) { event.preventDefault(); event.stopPropagation(); buttons[target]?.focus(); }
		};
		doc.addEventListener('pointerdown', outside, true); doc.addEventListener('focusin', outside); doc.addEventListener('keydown', keydown, true);
		this.cleanup = () => {
			doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('focusin', outside); doc.removeEventListener('keydown', keydown, true);
		};
		const bounds = this.button.getBoundingClientRect();
		const viewport = doc.defaultView?.visualViewport;
		const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
		const viewportWidth = viewport?.width ?? doc.documentElement.clientWidth;
		const viewportHeight = viewport?.height ?? doc.documentElement.clientHeight;
		const width = Math.min(204, Math.max(0, viewportWidth - 16));
		popover.style.position = 'fixed'; popover.style.width = `${width}px`;
		popover.style.minWidth = `${Math.min(188, width)}px`;
		popover.style.left = `${Math.max(left + 8, Math.min(bounds.left, left + viewportWidth - width - 8))}px`;
		popover.style.maxHeight = `${Math.max(0, Math.min(280, viewportHeight - 16))}px`;
		popover.style.top = `${Math.max(top + 8, Math.min(bounds.bottom + 6, top + viewportHeight - popover.offsetHeight - 8))}px`;
		(buttons.find(button => button.dataset.value === this.select.value) ?? buttons[0])?.focus();
	}
}
