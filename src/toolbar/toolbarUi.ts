import { setIcon } from 'obsidian';

export function createToolbarIconButton(container: HTMLElement, icon: string | null, label: string, action: () => void): HTMLButtonElement {
	const button = container.createEl('button', { cls: 'wm-paged-toolbar-button clickable-icon', attr: { type: 'button', 'aria-label': label } });
	if (icon) setIcon(button, icon);
	button.addEventListener('click', action);
	return button;
}

export function createToolbarSelect(container: HTMLElement, label: string, text: string, extraClass: string,
	icon?: { name: string; className: string }): HTMLButtonElement {
	const button = container.createEl('button', { cls: `wm-paged-toolbar-select ${extraClass}`,
		attr: { type: 'button', 'aria-label': label, 'aria-haspopup': 'menu' } });
	if (icon) setIcon(button.createSpan({ cls: icon.className, attr: { 'aria-hidden': 'true' } }), icon.name);
	button.createSpan({ cls: 'wm-paged-select-label', text });
	appendToolbarChevron(button, 'wm-paged-select-chevron');
	return button;
}

export function appendToolbarChevron(container: HTMLElement, className = 'wm-paged-button-chevron'): void {
	setIcon(container.createSpan({ cls: className, attr: { 'aria-hidden': 'true' } }), 'chevron-down');
}

export function createToolbarActionOption(container: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
	const button = container.createEl('button', { cls: 'wm-paged-popover-item', attr: { type: 'button', role: 'menuitem' } });
	setIcon(button.createSpan({ cls: 'wm-paged-popover-item-icon', attr: { 'aria-hidden': 'true' } }), icon);
	button.createSpan({ text: label });
	button.addEventListener('click', action);
	return button;
}

export function createToolbarOption(container: HTMLElement, label: string, active: boolean, action: () => void): HTMLButtonElement {
	const button = container.createEl('button', { cls: `wm-paged-popover-item${active ? ' is-active' : ''}`,
		attr: { type: 'button', role: 'menuitemradio', 'aria-checked': String(active) } });
	button.createSpan({ text: label });
	if (active) setIcon(button.createSpan({ cls: 'wm-paged-popover-check', attr: { 'aria-hidden': 'true' } }), 'check');
	button.addEventListener('click', action);
	return button;
}
