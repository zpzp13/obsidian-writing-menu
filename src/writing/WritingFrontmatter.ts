import { MarkdownView, getFrontMatterInfo, parseYaml, stringifyYaml, type App, type Editor, type TFile } from 'obsidian';
import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { wmT } from '../i18n/index';

/** Background properties must share the Markdown editor's buffer and writer. */
export async function processWritingFrontmatter(app: App, file: TFile, update: (frontmatter: Record<string, unknown>) => void, applied: () => void = () => {}): Promise<void> {
	const recent = app.workspace.getMostRecentLeaf()?.view;
	const views = app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view)
		.filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === file && Boolean(view.editor) && view.containerEl.isConnected);
	const view = views.find(candidate => candidate === recent) ?? views[0];
	// The paged editor already reconciles disk-only property changes with its body.
	// Do not make an inactive Markdown peer the writer for the active paged canvas.
	if (!view || (recent?.getViewType() === 'writing-menu-paged-writing' && 'file' in recent && recent.file === file)) {
		await app.fileManager.processFrontMatter(file, update);
		applied();
		return;
	}
	const editor = view.editor, source = editor.getValue(), info = getFrontMatterInfo(source);
	const parsed: unknown = info.exists ? parseYaml(info.frontmatter) : null;
	if (parsed !== null && parsed !== undefined && (typeof parsed !== 'object' || Array.isArray(parsed))) {
		throw new Error(wmT("문서 속성이 올바른 객체 형식이 아닙니다."));
	}
	const properties = (parsed ?? {}) as Record<string, unknown>;
	update(properties);
	const yaml = stringifyYaml(properties).replace(/\n?$/, '\n');
	const from = info.exists ? info.from : 0, to = info.exists ? info.to : 0;
	const insert = info.exists ? yaml : `---\n${yaml}---\n`;
	if (source.slice(from, to) !== insert) {
		const cm = (editor as Editor & { cm?: EditorView }).cm;
		if (cm?.state.doc.toString() === source) cm.dispatch({
			changes: { from, to, insert },
			// Keep automatic time accounting out of the writer's undo history.
			annotations: Transaction.addToHistory.of(false),
		});
		else editor.transaction({ changes: [{ from: editor.offsetToPos(from), to: editor.offsetToPos(to), text: insert }] }, 'writing-menu-properties');
	}
	// The native editor retains this update (and reports/retries write failures).
	// A failed disk save must not cause the same accounting delta to be added again.
	applied();
	await view.save();
}
