import { setIcon } from 'obsidian';

let rowPickerId = 0;

/** Searchable enhancement of the row select; keeps its value/change contract. */
export class PlotWorkbookRowPicker {
	private readonly button: HTMLButtonElement;
	private popover: HTMLElement | null = null;
	private cleanup: (() => void) | null = null;
	constructor(private readonly select: HTMLSelectElement) {
		select.hidden = true;
		select.tabIndex = -1;
		select.setAttribute('aria-hidden', 'true');
		this.button = select.parentElement!.createEl('button', { cls: 'wm-plotbook-row-picker', attr: {
			type: 'button', 'aria-label': `${select.getAttribute('aria-label')} 선택`, 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
		} });
		this.button.disabled = select.disabled;
		this.button.createSpan({ cls: 'wm-plotbook-row-picker-label', text: select.selectedOptions[0]?.textContent ?? '행 선택' });
		setIcon(this.button.createSpan({ cls: 'wm-plotbook-row-picker-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
		this.button.addEventListener('click', () => this.popover ? this.close() : this.open());
	}

	destroy(): void { this.close(false); }

	private close(restoreFocus = true): void {
		this.cleanup?.();
		this.cleanup = null;
		this.popover?.remove();
		this.popover = null;
		this.button.setAttribute('aria-expanded', 'false');
		if (restoreFocus && this.button.isConnected) this.button.focus({ preventScroll: true });
	}

	private open(): void {
		const doc = this.button.ownerDocument;
		const mount = this.button.closest<HTMLElement>('.modal-container') ?? doc.body;
		const popover = mount.createDiv({ cls: 'wm-plotbook-row-popover' });
		this.popover = popover;
		this.button.setAttribute('aria-expanded', 'true');
		const searchRow = popover.createDiv({ cls: 'wm-plotbook-row-search' });
		setIcon(searchRow.createSpan({ attr: { 'aria-hidden': 'true' } }), 'search');
		const search = searchRow.createEl('input', { type: 'search', placeholder: '행 번호 검색', attr: {
			'aria-label': `${this.select.getAttribute('aria-label')} 검색`, autocomplete: 'off',
		} });
		const list = popover.createDiv({ cls: 'wm-plotbook-row-options', attr: { role: 'listbox', 'aria-label': '행 목록' } });
		list.id = `wm-plotbook-row-options-${++rowPickerId}`;
		search.setAttribute('role', 'combobox');
		search.setAttribute('aria-controls', list.id);
		search.setAttribute('aria-expanded', 'true');
		search.setAttribute('aria-autocomplete', 'list');
		let buttons: HTMLButtonElement[] = [];
		let active = -1;
		const highlight = (index: number) => {
			buttons[active]?.removeClass('is-focused');
			active = index;
			buttons[active]?.addClass('is-focused');
			if (buttons[active]) search.setAttribute('aria-activedescendant', buttons[active].id);
			else search.removeAttribute('aria-activedescendant');
			buttons[active]?.scrollIntoView({ block: 'nearest' });
		};
		const choose = (value: string) => {
			this.close();
			this.select.value = value;
			this.select.dispatchEvent(new Event('change', { bubbles: true }));
		};
		const render = () => {
			list.empty(); buttons = []; active = -1;
			const query = search.value.trim().replace(/\s|행/g, '');
			for (const option of this.select.options) {
				if (query && !option.textContent?.replace(/\s|행/g, '').includes(query)) continue;
				const button = list.createEl('button', { cls: 'wm-plotbook-row-option', text: option.textContent ?? '',
					attr: { type: 'button', role: 'option', 'aria-selected': String(option.value === this.select.value) } });
				button.dataset.value = option.value;
				button.id = `${list.id}-${list.childElementCount}`;
				button.disabled = option.disabled;
				button.addEventListener('click', () => choose(option.value));
				if (!option.disabled) buttons.push(button);
			}
			if (!list.childElementCount) list.createDiv({ cls: 'wm-plotbook-row-no-results', text: '일치하는 행이 없습니다.' });
			highlight(Math.max(0, buttons.findIndex(button => button.dataset.value === this.select.value)));
		};
		search.addEventListener('input', render);
		search.addEventListener('keydown', event => {
			if (event.isComposing) return;
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				highlight(Math.max(0, Math.min(buttons.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))));
			} else if (event.key === 'Enter') { event.preventDefault(); buttons[active]?.click(); }
		});
		const outside = (event: PointerEvent) => {
			if (!popover.contains(event.target as Node) && !this.button.contains(event.target as Node)) this.close(false);
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault(); event.stopPropagation(); this.close();
		};
		const focusOutside = (event: FocusEvent) => {
			if (!popover.contains(event.target as Node) && !this.button.contains(event.target as Node)) this.close(false);
		};
		doc.addEventListener('pointerdown', outside, true);
		doc.addEventListener('keydown', escape, true);
		doc.addEventListener('focusin', focusOutside);
		this.cleanup = () => {
			doc.removeEventListener('pointerdown', outside, true);
			doc.removeEventListener('keydown', escape, true);
			doc.removeEventListener('focusin', focusOutside);
		};
		const bounds = this.button.getBoundingClientRect();
		popover.style.width = `${Math.max(180, bounds.width)}px`;
		popover.style.left = `${Math.max(8, Math.min(bounds.left, doc.documentElement.clientWidth - Math.max(180, bounds.width) - 8))}px`;
		const below = doc.documentElement.clientHeight - bounds.bottom - 12;
		const height = Math.min(300, Math.max(below, bounds.top - 12));
		popover.style.maxHeight = `${Math.max(100, height)}px`;
		popover.style.top = `${below >= height ? bounds.bottom + 5 : Math.max(8, bounds.top - height - 5)}px`;
		render();
		search.focus({ preventScroll: true });
	}
}
