import { wmT } from '../i18n/index';
import { createToolbarOption, createToolbarSelect } from './toolbarUi';

/** Compact toolbar picker; the native select remains the source of value/change events. */
export class ToolbarSelect {
	private readonly button: HTMLButtonElement;
	private popover: HTMLElement | null = null;
	private cleanup: (() => void) | null = null;
	private anchor: HTMLElement | null = null;
	private readonly originalHidden: HTMLSelectElement['hidden'];
	private readonly originalTabIndex: number;
	private readonly originalAriaHidden: string | null;
	constructor(private readonly select: HTMLSelectElement, modifier: string, private readonly options: { searchable?: boolean; custom?: 'text' | 'number'; fontPreview?: boolean; loadOptions?: () => Promise<string[]>; iconTrigger?: boolean; valueTooltip?: boolean } = {}) {
		this.originalHidden = select.hidden;
		this.originalTabIndex = select.tabIndex;
		this.originalAriaHidden = select.getAttribute('aria-hidden');
		select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
		this.button = createToolbarSelect(select.parentElement!, wmT("{0} 선택", this.label()), '', modifier);
		if (options.valueTooltip === false) {
			this.button.removeAttribute('aria-label');
			const labelledBy = select.getAttribute('aria-labelledby');
			if (labelledBy) this.button.setAttribute('aria-labelledby', labelledBy);
		}
		if (options.iconTrigger) { this.button.hidden = true; this.button.style.display = 'none'; this.button.tabIndex = -1; }
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
	sync(): void { this.refresh(); }
	private label(): string {
		return this.select.getAttribute('aria-label') ?? (this.select.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => this.select.ownerDocument.getElementById(id)?.textContent ?? '').join(' ');
	}
	/** Open from a separate icon while keeping the same native select/change contract. */
	openAt(anchor: HTMLElement): void {
		if (this.popover && this.anchor === anchor) { this.close(); return; }
		this.close(false); this.open(anchor);
	}
	close(restoreFocus = true): void {
		const anchor = this.anchor ?? this.button;
		this.cleanup?.(); this.cleanup = null;
		this.popover?.remove(); this.popover = null;
		anchor.setAttribute('aria-expanded', 'false'); this.anchor = null;
		this.button.setAttribute('aria-expanded', 'false');
		this.button.removeClass('is-open');
		if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
	}
	private readonly refresh = (): void => {
		this.button.querySelector('.wm-paged-select-label')!.textContent = this.select.selectedOptions[0]?.textContent ?? '';
		this.button.disabled = this.select.disabled;
		if (this.options.valueTooltip === false) this.button.removeAttribute('title');
		else this.button.title = this.select.selectedOptions[0]?.textContent || '';
	};
	private readonly toggle = (): void => { if (this.popover) this.close(); else this.open(); };
	private open(anchor: HTMLElement = this.button): void {
		if (this.select.disabled) return;
		this.anchor = anchor;
		const doc = this.button.ownerDocument;
		const mount = this.button.closest<HTMLElement>('.modal-container') ?? doc.body;
		const popover = this.popover = mount.createDiv({ cls: 'wm-paged-toolbar-popover wm-paged-compact-popover wm-toolbar-select-popover',
			attr: { role: 'menu', 'aria-label': wmT("{0} 목록", this.label()) } });
		this.button.setAttribute('aria-expanded', 'true'); this.button.addClass('is-open');
		anchor.setAttribute('aria-expanded', 'true');

        const buttons: HTMLButtonElement[] = [];
        let search: HTMLInputElement | undefined;
        if (this.options.searchable || this.options.custom) {
            const row = popover.createDiv({ cls: 'wm-paged-popover-search' });
            search = row.createEl('input', { type: this.options.custom === 'number' ? 'number' : 'text', placeholder: this.label(), attr: { 'aria-label': this.label(), autocomplete: 'off' } });
        }
        const list = search ? popover.createDiv({ cls: 'wm-paged-popover-list' }) : popover;
        const render = (): void => {
            list.empty(); buttons.length = 0;
            const query = search?.value.trim() || '';
            const choices = Array.from(this.select.options).filter(option => !query || option.textContent?.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
            if (query && this.options.custom && !Array.from(this.select.options).some(option => option.value === query)
                && (this.options.custom !== 'number' || Number(query) >= 1 && Number(query) <= 200)) {
                const custom = doc.createElement('option'); custom.value = query; custom.textContent = query; choices.unshift(custom);
            }
            for (const option of choices.slice(0, 100)) {
                const button = createToolbarOption(list, option.textContent ?? '', option.selected, () => {
                    this.close();
                    if (this.select.value === option.value) return;
                    if (!option.parentElement) this.select.append(option);
                    this.select.value = option.value; this.select.dispatchEvent(new Event('change', { bubbles: true }));
                });
                button.disabled = option.disabled; button.dataset.value = option.value;
                if (this.options.fontPreview) button.style.fontFamily = option.value;
                if (!button.disabled) buttons.push(button);
            }
        };
        search?.addEventListener('input', render);
        search?.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); buttons[0]?.click(); } });
        render();
        if (this.options.loadOptions) void this.options.loadOptions().then(values => {
            if (this.popover !== popover) return;
            for (const value of values) if (!Array.from(this.select.options).some(option => option.value === value)) this.select.createEl('option', { value, text: value });
            render();
        });
		const outside = (event: Event) => {
			if (!popover.contains(event.target as Node) && !this.button.contains(event.target as Node) && !anchor.contains(event.target as Node)) this.close(false);
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
		const bounds = anchor.getBoundingClientRect();
		const viewport = doc.defaultView?.visualViewport;
		const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
		const viewportWidth = viewport?.width ?? doc.documentElement.clientWidth;
		const viewportHeight = viewport?.height ?? doc.documentElement.clientHeight;
		const width = Math.min(204, Math.max(0, viewportWidth - 16));
		popover.setCssStyles({ position: 'fixed', width: `${width}px` });
		popover.style.minWidth = `${Math.min(188, width)}px`;
		popover.style.left = `${Math.max(left + 8, Math.min(bounds.left, left + viewportWidth - width - 8))}px`;
		popover.style.maxHeight = `${Math.max(0, Math.min(280, viewportHeight - 16))}px`;
		popover.style.top = `${Math.max(top + 8, Math.min(bounds.bottom + 6, top + viewportHeight - popover.offsetHeight - 8))}px`;
		if (search) search.focus(); else (buttons.find(button => button.dataset.value === this.select.value) ?? buttons[0])?.focus();
	}
}
