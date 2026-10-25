import { wmT } from '../i18n/index';
/** Obsidian's native task checkbox is shared by the grid, popup and sidebar. */
export function createChecklistControl(parent: HTMLElement, completed: boolean, label: string, change?: (completed: boolean) => void): HTMLInputElement {
	const input = parent.createEl('input', {
		cls: 'task-list-item-checkbox wm-plotbook-checklist-toggle',
		type: 'checkbox',
		attr: { 'aria-label': label },
	});
	input.checked = completed;
	input.addEventListener('pointerdown', event => event.stopPropagation());
	input.addEventListener('click', event => event.stopPropagation());
	input.addEventListener('dblclick', event => event.stopPropagation());
	if (change) input.addEventListener('change', () => change(input.checked));
	else input.tabIndex = -1;
	return input;
}

export function renderChecklistCompletionDate(parent: HTMLElement, completionDate?: string): HTMLElement | null {
	return completionDate
		? parent.createSpan({ cls: 'wm-plotbook-checklist-completion-date', text: completionDate, attr: { title: wmT("완료: {0}", completionDate) } })
		: null;
}
