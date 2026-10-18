import { Menu, Notice, type Editor, type MenuItem } from 'obsidian';
import type { PagedInlineFormatKind } from '../types';

export interface PagedContextMenuActions {
	editor: Editor;
	canUndo: boolean;
	canRedo: boolean;
	undo(): void;
	redo(): void;
	copy(cut: boolean): Promise<void>;
	paste(): Promise<void>;
	toggleFormat(kind: PagedInlineFormatKind): void;
	selectAll(): void;
	find(): void;
	extend(menu: Menu): void;
}

/** Native Menu styling and the public editor-menu hook, with paged edit actions. */
export function createPagedEditorContextMenu(actions: PagedContextMenuActions): Menu {
	const menu = new Menu();
	const action = (target: Menu, title: string, icon: string, run: () => void, disabled = false) => {
		target.addItem(item => item.setTitle(title).setIcon(icon).setDisabled(disabled).onClick(run));
	};
	action(menu, '되돌리기', 'undo-2', actions.undo, !actions.canUndo);
	action(menu, '다시 실행', 'redo-2', actions.redo, !actions.canRedo);
	menu.addSeparator();
	const selected = actions.editor.somethingSelected();
	action(menu, '잘라내기', 'scissors', () => void actions.copy(true), !selected);
	action(menu, '복사', 'copy', () => void actions.copy(false), !selected);
	action(menu, '붙여넣기', 'clipboard-paste', () => void actions.paste());
	action(menu, '일반 텍스트로 붙여넣기', 'clipboard', () => void actions.paste());
	action(menu, '모두 선택', 'text-select', actions.selectAll);
	menu.addSeparator();
	const group = (label: string, icon: string, populate: (target: Menu) => void) => {
		// Submenus exist in Obsidian's runtime but not every supported API declaration.
		// Hosts without them still get the same usable commands as a flat menu.
		let submenu: Menu | undefined;
		menu.addItem(item => {
			const capable = item as MenuItem & { setSubmenu?: () => Menu };
			if (capable.setSubmenu) { item.setTitle(label).setIcon(icon); submenu = capable.setSubmenu(); }
			else item.setTitle(label).setIcon(icon).setDisabled(true);
		});
		populate(submenu ?? menu);
	};
	group('서식', 'type', target => {
		for (const [title, icon, kind] of [
			['굵게', 'bold', 'bold'], ['기울임꼴', 'italic', 'italic'],
			['밑줄', 'underline', 'underline'], ['취소선', 'strikethrough', 'strikethrough'],
		] as const) action(target, title, icon, () => actions.toggleFormat(kind));
	});
	group('문단', 'pilcrow', target => {
		const prefix = (marker: string) => {
			const editor = actions.editor;
			const from = { line: editor.getCursor('from').line, ch: 0 };
			const end = editor.getCursor('to');
			const endLine = end.ch === 0 && end.line > from.line ? end.line - 1 : end.line;
			const to = { line: endLine, ch: editor.getLine(endLine).length };
			const text = editor.getRange(from, to).split('\n').map(line => marker + line).join('\n');
			editor.replaceRange(text, from, to);
		};
		for (let level = 1; level <= 6; level++) action(target, `제목 ${level}`, 'heading', () => prefix(`${'#'.repeat(level)} `));
		action(target, '글머리 기호 목록', 'list', () => prefix('- '));
		action(target, '번호 매기기 목록', 'list-ordered', () => prefix('1. '));
		action(target, '작업 목록', 'list-checks', () => prefix('- [ ] '));
		action(target, '인용문', 'quote', () => prefix('> '));
	});
	group('삽입', 'plus', target => {
		action(target, '내부 링크', 'link', () => actions.editor.replaceSelection(`[[${actions.editor.getSelection()}]]`));
		action(target, '외부 링크', 'external-link', () => actions.editor.replaceSelection(`[${actions.editor.getSelection()}](https://)`));
	});
	action(menu, '찾기', 'search', actions.find);
	try { actions.extend(menu); }
	catch { new Notice('일부 플러그인의 편집 메뉴를 불러오지 못했습니다.'); }
	return menu;
}
