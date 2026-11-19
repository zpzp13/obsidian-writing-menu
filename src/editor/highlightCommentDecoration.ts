import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, hoverTooltip } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { renderCommentTooltip } from '../comments/HighlightCommentUi';

export function highlightCommentExtension(plugin: WritingMenuPlugin) {
	const refresh = StateEffect.define<void>();
	const ranges = (view: { state: EditorView['state'] }) => {
		const file = view.state.field(editorInfoField, false)?.file;
		if (!file || !plugin.highlightComments || !plugin.shouldApplyToFile(file) || !plugin.highlightComments.threads.some(t => t.path === file.path)) return [];
		return plugin.highlightComments.resolveSource(file.path, view.state.doc.toString()).anchors.filter(a => a.highlight).map(a => ({ from: a.highlight!.from, to: a.highlight!.to, id: a.threadId }));
	};
	const field = StateField.define<ReturnType<typeof ranges>>({
		create: state => ranges({ state }),
		update: (value, tr) => {
			if (tr.effects.some(e => e.is(refresh))) return ranges({ state: tr.state });
			return tr.docChanged ? value.map(r => ({ ...r, from: tr.changes.mapPos(r.from, 1), to: tr.changes.mapPos(r.to, -1) })).filter(r => r.from < r.to) : value;
		},
		provide: field => EditorView.decorations.from(field, value => Decoration.set(value.map(r => Decoration.mark({ class: 'wm-hl-commented', attributes: { 'data-wm-thread': r.id } }).range(r.from, r.to)), true)),
	});
	const updates = ViewPlugin.fromClass(class {
		private unsubscribe: () => void;
		private frame = 0;
		constructor(view: EditorView) {
			this.unsubscribe = plugin.highlightComments.onChange(() => {
				cancelAnimationFrame(this.frame); this.frame = window.requestAnimationFrame(() => { this.frame = 0; view.dispatch({ effects: refresh.of() }); });
			});
		}
		destroy(): void { this.unsubscribe(); cancelAnimationFrame(this.frame); }
	});
	return [field, updates, hoverTooltip((view, pos) => {
		const range = view.state.field(field).find(r => pos >= r.from && pos < r.to), thread = range ? plugin.highlightComments.getThread(range.id) : undefined;
		if (!range || !thread?.comments.length) return null;
		return { pos: range.from, end: range.to, above: true, create: () => {
			const dom = createDiv(); renderCommentTooltip(dom, thread);
			// The card draws its own frame; strip CM's tooltip chrome around it.
			return { dom, mount: () => dom.parentElement?.addClass('wm-hlc-cm-tooltip') };
		} };
	})];
}
