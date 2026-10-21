import { MarkdownView, type Editor, type TFile } from 'obsidian';
import { Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type WritingMenuPlugin from '../../main';
import { PagedWritingView } from '../paged/PagedWritingView';
import { splitPagedFrontmatter } from '../paged/PagedFileStore';
import { textEdits } from '../utils/TextEdits';

type WritingView = MarkdownView | PagedWritingView;
const recentViews = new WeakMap<WritingMenuPlugin, WritingView>();

function isWritingView(view: unknown): view is WritingView {
	return view instanceof MarkdownView || view instanceof PagedWritingView;
}

/** Explicit targets must not fall back to a different, previously focused manuscript. */
export function getWritingDocumentForView(view: unknown): WritingDocument | null {
	return isWritingView(view) && view.file && view.containerEl.isConnected ? documentForView(view) : null;
}

export function initializeWritingDocuments(plugin: WritingMenuPlugin): void {
	const remember = (view: unknown) => { if (isWritingView(view) && view.file) recentViews.set(plugin, view); };
	remember(plugin.app.workspace.getMostRecentLeaf()?.view);
	plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', leaf => remember(leaf?.view)));
}

export interface WritingDocument {
	readonly file: TFile;
	readonly path: string;
	readonly editor: Editor;
	read(): string;
	isCurrent(expected: string): boolean;
	replace(expected: string, next: string): void;
	select(expected: string, from: number, to: number): void;
}

export function getWritingDocument(plugin: WritingMenuPlugin): WritingDocument | null {
	const active = plugin.app.workspace.getMostRecentLeaf()?.view;
	const remembered = recentViews.get(plugin);
	const fallback = plugin.app.workspace.getActiveViewOfType?.(MarkdownView) ?? plugin.app.workspace.getActiveViewOfType?.(PagedWritingView);
	const view = isWritingView(active) && active.file ? active : remembered?.containerEl.isConnected ? remembered : fallback;
	if (!view?.file || !view.containerEl.isConnected) return null;
	recentViews.set(plugin, view);
	return documentForView(view);
}

export function getOpenWritingDocuments(plugin: WritingMenuPlugin): WritingDocument[] {
	return [...plugin.app.workspace.getLeavesOfType('markdown'), ...plugin.app.workspace.getLeavesOfType('writing-menu-paged-writing')]
		.map(leaf => leaf.view).filter((view): view is WritingView => isWritingView(view) && Boolean(view.file) && view.containerEl.isConnected).map(documentForView);
}

function documentForView(view: WritingView): WritingDocument {
	const file = view.file!, path = file.path;
	const editor = view instanceof PagedWritingView ? view.getEditorAdapter() : view.editor;
	const read = () => view instanceof PagedWritingView ? view.getViewData() : editor.getValue();
	const isCurrent = (expected: string) => view.file === file && file.path === path && view.containerEl.isConnected && read() === expected;
	const assert = (expected: string) => { if (!isCurrent(expected)) throw new Error('원고가 변경되었습니다. 다시 비교하거나 분석해 주세요.'); };
	return {
		file, path, editor, read, isCurrent,
		replace(expected, next) {
			assert(expected);
			if (view instanceof PagedWritingView) view.replaceSourceSnapshot(expected, next);
			else {
				const changes = textEdits(expected, next).map(edit => ({ from: editor.offsetToPos(edit.from), to: editor.offsetToPos(edit.to), text: edit.text }));
				if (changes.length) {
					const cm = (editor as Editor & { cm?: EditorView }).cm;
					if (cm?.state.doc.toString() === expected) cm.dispatch({
						changes: textEdits(expected, next).reverse().map(edit => ({ from: edit.from, to: edit.to, insert: edit.text })),
						annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.snapshot')],
					});
					else editor.transaction({ changes }, 'writing-menu-snapshot');
				}
			}
		},
		select(expected, from, to) {
			assert(expected);
			const prefix = view instanceof PagedWritingView ? splitPagedFrontmatter(expected).prefix.length : 0;
			if (from < prefix) throw new Error('속성 영역은 마크다운 편집기에서 확인해 주세요.');
			editor.focus();
			const start = editor.offsetToPos(Math.max(0, from - prefix));
			const end = editor.offsetToPos(Math.max(0, to - prefix));
			editor.setSelection(start, end);
			editor.scrollIntoView({ from: start, to: end }, true);
		},
	};
}
