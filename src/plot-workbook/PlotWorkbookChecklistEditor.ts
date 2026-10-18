import { Menu, Notice, setIcon } from 'obsidian';
import { parseChecklist, type ChecklistTask } from './PlotWorkbookChecklist';
import { PlotWorkbookSession } from './PlotWorkbookSession';
import type { PlotWorkbookForeshadowLocation } from './PlotWorkbookTypes';
import { createChecklistControl, renderChecklistCompletionDate } from './PlotWorkbookChecklistControl';

/** The same inline editor is used by the cell popup and by the sidebar. */
export class PlotWorkbookChecklistEditor {
	readonly element: HTMLElement;
	private readonly list: HTMLElement;
	private readonly empty: HTMLElement;
	private readonly input: HTMLInputElement;
	private readonly form: HTMLFormElement;
	private readonly unsubscribe: () => void;
	private editing = false;
	private hideCompleted = false;
	private menu: Menu | null = null;
	private previewLimit: number;

	constructor(parent: HTMLElement, private readonly session: PlotWorkbookSession, private readonly location: PlotWorkbookForeshadowLocation, composerParent?: HTMLElement, previewLimit = Infinity) {
		this.previewLimit = previewLimit;
		this.element = parent.createDiv({ cls: 'wm-plotbook-checklist-editor' });
		this.empty = this.element.createDiv({ cls: 'wm-plotbook-checklist-empty' });
		this.list = this.element.createDiv({ cls: 'wm-plotbook-checklist-items' });
		const form = this.form = (composerParent ?? this.element).createEl('form', { cls: 'wm-plotbook-checklist-add' });
		this.input = form.createEl('input', { type: 'text', placeholder: '체크리스트 추가', attr: { 'aria-label': '체크리스트 항목 추가' } });
		const add = form.createEl('button', { cls: 'clickable-icon', attr: { type: 'submit', 'aria-label': '항목 추가' } });
		setIcon(add, 'plus');
		form.addEventListener('submit', event => {
			event.preventDefault();
			if (this.session.addChecklistTask(location.sheetId, location.rowId, location.columnId, this.input.value)) this.input.value = '';
			this.input.focus();
		});
		this.element.addEventListener('keydown', event => {
			if ((event.target as Element).matches('input')) event.stopPropagation();
		});
		this.unsubscribe = session.subscribe(() => this.render());
		this.render();
	}

	setHideCompleted(value: boolean): void {
		if (this.hideCompleted === value) return;
		this.hideCompleted = value; this.render();
	}
	setPreviewLimit(value: number): void {
		if(this.previewLimit === value)return;
		this.previewLimit = value; this.render();
	}
	focus(): void { this.input.focus(); }
	get hasOpenMenu(): boolean { return this.menu !== null; }
	destroy(): void { this.unsubscribe(); this.menu?.hide(); this.form.remove(); this.element.remove(); }

	private render(): void {
		const sheet = this.session.activeSheet;
		const valid = sheet.sheetId === this.location.sheetId && sheet.columns[this.location.columnId]?.role === 'checklist'
			&& !!sheet.rows[this.location.rowId];
		this.input.disabled = !valid;
		this.form.hidden = Number.isFinite(this.previewLimit);
		if (this.editing) return;
		this.list.empty();
		this.empty.hidden = false;
		if (!valid) { this.empty.setText('이 셀을 편집할 수 없습니다.'); return; }
		const tasks = parseChecklist(this.session.getCell(sheet, this.location.rowId, this.location.columnId));
		this.empty.hidden = tasks.some(task => !this.hideCompleted || !task.completed);
		this.empty.setText(tasks.length ? '표시할 항목이 없습니다.' : '아직 항목이 없습니다.');
		let rendered = 0;
		for (const [index, task] of tasks.entries()) {
			if (this.hideCompleted && task.completed) continue;
			if(rendered++ >= this.previewLimit)break;
			const row = this.list.createDiv({ cls: `wm-plotbook-checklist-item${task.completed ? ' is-complete' : ''}` });
			createChecklistControl(row,task.completed,`${task.text} 완료`,completed=>this.change(task,{completed}));
			const title = row.createEl('button', { cls: 'wm-plotbook-checklist-title', text: task.text || '제목 없음', attr: { type: 'button', 'aria-label': `항목 수정: ${task.text}` } });
			title.addEventListener('click', () => this.beginTitleEdit(title, task));
			renderChecklistCompletionDate(row, task.completionDate);
			const actions = row.createDiv({ cls: 'wm-plotbook-checklist-actions' });
			const more = actions.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': `항목 메뉴: ${task.text}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
			setIcon(more, 'ellipsis');
			more.addEventListener('click', () => this.openMenu(more, title, task, index, tasks.length));
		}
	}

	private openMenu(trigger: HTMLButtonElement, title: HTMLButtonElement, task: ChecklistTask, index: number, length: number): void {
		this.menu?.hide();
		const menu = this.menu = new Menu();
		trigger.setAttribute('aria-expanded', 'true');
		menu.onHide(() => {
			if (this.menu === menu) this.menu = null;
			trigger.setAttribute('aria-expanded', 'false');
			if (trigger.isConnected) trigger.focus({ preventScroll: true });
		});
		menu.addItem(item => item.setTitle('항목 수정').setIcon('pencil').onClick(() => {
			menu.hide();
			if (title.isConnected) this.beginTitleEdit(title, task);
		}));
		for (const [icon, label, direction, disabled] of [
			['arrow-up', '위로 이동', -1 as const, index === 0],
			['arrow-down', '아래로 이동', 1 as const, index === length - 1],
		] as const) menu.addItem(item => item.setTitle(label).setIcon(icon).setDisabled(disabled).onClick(() => {
			menu.hide(); this.change(task, { move: direction });
			this.focusItem(index + direction);
		}));
		menu.addSeparator();
		menu.addItem(item => item.setTitle('항목 삭제').setIcon('trash-2').onClick(() => {
			menu.hide(); this.change(task, { remove: true }); this.focusItem(index);
		}));
		const rect = trigger.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom }, trigger.ownerDocument);
	}

	private focusItem(index: number): void {
		const titles = this.list.querySelectorAll<HTMLButtonElement>('.wm-plotbook-checklist-title');
		(titles[Math.max(0, Math.min(index, titles.length - 1))] ?? this.input).focus();
	}

	private change(task: ChecklistTask, change: Parameters<PlotWorkbookSession['changeChecklistTask']>[4]): void {
		const { sheetId, rowId, columnId } = this.location;
		if (!this.session.changeChecklistTask(sheetId, rowId, columnId, task, change)) {
			new Notice('다른 화면에서 목록이 변경되었습니다. 항목을 다시 선택해 주세요.');
			this.render();
		}
	}

	private beginTitleEdit(title: HTMLButtonElement, task: ChecklistTask): void {
		this.editing = true;
		const index = [...this.list.children].indexOf(title.parentElement!);
		const input = title.ownerDocument.createElement('input');
		input.type = 'text'; input.value = task.text;
		input.className = 'wm-plotbook-checklist-title-input';
		input.setAttribute('aria-label', '항목 제목');
		title.replaceWith(input);
		let finished = false;
		const finish = (save: boolean) => {
			if (finished) return;
			finished = true;
			const restoreFocus = input.ownerDocument.activeElement === input;
			this.editing = false;
			if (save) this.change(task, { text: input.value });
			this.render();
			if (restoreFocus) this.focusItem(index);
		};
		input.addEventListener('blur', () => finish(true));
		input.addEventListener('keydown', event => {
			if (event.isComposing) return;
			if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); finish(event.key === 'Enter'); }
		});
		input.focus(); input.select();
	}
}
