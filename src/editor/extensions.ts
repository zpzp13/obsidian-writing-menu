import { EditorView, ViewPlugin, Decoration, DecorationSet, ViewUpdate, keymap } from '@codemirror/view';
import { Extension, EditorState, RangeSetBuilder, Prec, Transaction } from '@codemirror/state';
import { MarkdownView } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { HeadingRawWidget } from './HeadingRawWidget';

function appliesToEditor(plugin: WritingMenuPlugin, editor: EditorView): boolean {
	const leaf = plugin.app.workspace.getLeavesOfType('markdown')
		.find(candidate => candidate.view.containerEl.contains(editor.dom));
	return leaf?.view instanceof MarkdownView && plugin.shouldApplyToFile(leaf.view.file);
}

export function getSmartEnterExtension(plugin: WritingMenuPlugin): Extension {
	if (!plugin.settings.enableSmartInput || !plugin.settings.enableSmartEnter) return [];
	return Prec.highest(keymap.of([{
		key: 'Enter',
		run: (view: EditorView) => {
			if (!appliesToEditor(plugin, view)) return false;
			const state = view.state;
			const cursor = state.selection.main.head;
			if (cursor === 0 || cursor >= state.doc.length) return false;

			const defaultPairs = [
				'()', '[]', '{}', '<>', '""', "''",
				'“”', '‘’',
				'「」', '『』',
				'【】', '《》'
			];

			const settingsPairs = plugin.settings.smartEnterPairs || [];

			const dynamicPairs: string[] = [];
			if (plugin.settings.symbolTriggers) {
				plugin.settings.symbolTriggers.forEach(trigger => {
					if (trigger.enabled !== false && trigger.options) {
						trigger.options.forEach(opt => {
							if (opt.open && opt.close) {
								dynamicPairs.push(opt.open + opt.close);
							}
						});
					}
				});
			}

			const allPairs = Array.from(new Set([...defaultPairs, ...settingsPairs, ...dynamicPairs]));

			for (const pair of allPairs) {
				const mid = Math.floor(pair.length / 2);
				const openBracket = pair.slice(0, mid);
				const closeBracket = pair.slice(mid);

				if (openBracket && closeBracket) {
					const afterCursor = state.doc.sliceString(cursor, cursor + closeBracket.length);

					if (afterCursor === closeBracket) {
						const lineText = state.doc.lineAt(cursor).text;
						const currentIndent = lineText.match(/^\s*/)?.[0] || '';

						const insertPos = cursor + closeBracket.length;
						const tx = state.update({
							changes: { from: insertPos, insert: `\n${currentIndent}` },
							selection: { anchor: insertPos + 1 + currentIndent.length },
							userEvent: "input.enter"
						});
						view.dispatch(tx);
						return true;
					}
				}
			}
			return false;
		}
	}]));
}

export function getSmartQuoteExtension(plugin: WritingMenuPlugin): Extension {
	if (!plugin.settings.enableSmartQuotes) return [];
	return EditorView.inputHandler.of((view, from, to, text) => {
		if (!appliesToEditor(plugin, view)) return false;
		const pair = text === '"' || text === '“'
			? { open: '“', close: '”' }
			: text === "'" || text === '‘'
				? { open: '‘', close: '’' }
				: null;
		if (!pair) return false;

		// Typing the closing key while immediately before an auto-inserted closer
		// moves over it instead of producing another quote pair.
		if (from === to && view.state.doc.sliceString(from, from + pair.close.length) === pair.close) {
			view.dispatch({ selection: { anchor: from + pair.close.length }, scrollIntoView: true });
			return true;
		}

		const selected = view.state.doc.sliceString(from, to);
		const insert = pair.open + selected + pair.close;
		view.dispatch({
			changes: { from, to, insert },
			selection: selected
				? { anchor: from + pair.open.length, head: from + pair.open.length + selected.length }
				: { anchor: from + pair.open.length },
			scrollIntoView: true,
			userEvent: 'input.type',
		});
		return true;
	});
}

export function getTypewriterExtension(plugin: WritingMenuPlugin): Extension {
	if (!plugin.settings.enableTypewriterScrolling) return [];
	return ViewPlugin.fromClass(class {
		update(update: ViewUpdate) {
			if (!appliesToEditor(plugin, update.view)) return;
			const isUserInput = update.transactions.some((tr: Transaction) => tr.isUserEvent("input") || tr.isUserEvent("delete"));
			if (!update.docChanged || !isUserInput) return;
			const head = update.view.state.selection.main.head;
			if (!update.view.state.selection.main.empty) return;
			update.view.requestMeasure({
				key: 'wm-typewriter-center',
				read: (view) => {
					if (!appliesToEditor(plugin, view) || head > view.state.doc.length) return null;
					const cursorCoords = view.coordsAtPos(head);
					if (!cursorCoords) return null;
					const scroller = view.scrollDOM;
					const scrollerRect = scroller.getBoundingClientRect();
					const diff = cursorCoords.top - (scrollerRect.top + scrollerRect.height / 2);
					return { diff, scroller };
				},
				write: (measure) => {
					if (!measure || !appliesToEditor(plugin, update.view)) return;
					const { diff, scroller } = measure;
					if (Math.abs(diff) > 10) {
						scroller.scrollTo({ top: scroller.scrollTop + diff, behavior: 'auto' });
					}
				}
			});
		}
	});
}

export function getTextSubstitutionExtension(plugin: WritingMenuPlugin): Extension {
	if (!plugin.settings.enableSmartInput || !plugin.settings.enableTextSubstitution) return [];

	const enabledSubs = plugin.settings.textSubstitutions.filter(s => s.enabled && s.from && s.to);
	if (enabledSubs.length === 0) return [];

	const sortedSubs = enabledSubs.sort((a, b) => b.from.length - a.from.length);
	const maxLength = sortedSubs[0].from.length;

	return EditorView.inputHandler.of((view, _from, to, text) => {
		if (!appliesToEditor(plugin, view)) return false;
		if (text.length !== 1) return false;

		const start = Math.max(0, to - maxLength + 1);
		const recentText = view.state.doc.sliceString(start, to) + text;

		const match = sortedSubs.find(s => recentText.endsWith(s.from));
		if (!match) return false;

		const replaceFrom = to - match.from.length + 1;
		view.dispatch({
			changes: { from: replaceFrom, to, insert: match.to },
			selection: { anchor: replaceFrom + match.to.length }
		});

		plugin.lastSubstitution = {
			from: match.from,
			to: match.to,
			endPos: replaceFrom + match.to.length
		};

		return true;
	});
}

export function getBackspaceUndoExtension(plugin: WritingMenuPlugin): Extension {
	if (!plugin.settings.enableSmartInput || !plugin.settings.enableTextSubstitution) return [];

	return EditorView.updateListener.of((update) => {
		if (!appliesToEditor(plugin, update.view)) return;
		const isBackspace = update.transactions.some(tr => tr.isUserEvent("delete.backward"));
		if (!isBackspace || !plugin.lastSubstitution) return;

		const cursor = update.state.selection.main.head;
		const sub = plugin.lastSubstitution;

		if (cursor !== sub.endPos - 1) {
			plugin.lastSubstitution = null;
			return;
		}

		const revertFrom = cursor - sub.to.length + 1;
		const revertTo = cursor;

		update.view.dispatch({
			changes: { from: revertFrom, to: revertTo, insert: sub.from },
			selection: { anchor: revertFrom + sub.from.length }
		});

		plugin.lastSubstitution = null;
	});
}

export function createHeadingLinkFixExtension(plugin: WritingMenuPlugin): Extension {
	return Prec.highest(ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		applies = false;
		constructor(view: EditorView) { this.decorations = this.build(view); }
		update(update: ViewUpdate) {
			if (this.applies !== appliesToEditor(plugin, update.view) || update.viewportChanged) {
				this.decorations = this.build(update.view);
			} else if (update.docChanged) {
				let hasHeadingChange = false;
				update.changes.iterChangedRanges((_fa, _ta, fromB, toB) => {
					if (hasHeadingChange) return;
					const doc = update.state.doc;
					const fl  = doc.lineAt(fromB);
					const peek = (line: typeof fl) =>
						/^#{1,6}\s/.test(doc.sliceString(line.from, Math.min(line.from + 8, line.to)));
					if (peek(fl)) { hasHeadingChange = true; return; }
					const tl = doc.lineAt(toB);
					if (fl.number !== tl.number && peek(tl)) hasHeadingChange = true;
				});
				if (hasHeadingChange) this.decorations = this.build(update.view);
			}
		}
		build(view: EditorView): DecorationSet {
			this.applies = appliesToEditor(plugin, view);
			if (!this.applies) return Decoration.none;
			const builder = new RangeSetBuilder<Decoration>();
			for (const { from, to } of view.visibleRanges) {
				const fl = view.state.doc.lineAt(from).number;
				const tl = view.state.doc.lineAt(Math.min(to, view.state.doc.length)).number;
				for (let i = fl; i <= tl; i++) {
					const line = view.state.doc.line(i);
					if (!/^#{1,6}\s/.test(line.text)) continue;
					const re = /\[([^\]]*)\]\s?\[([^\]]*)\]/g;
					let m;
					while ((m = re.exec(line.text)) !== null) {
						const mFrom = line.from + m.index;
						const mTo = mFrom + m[0].length;
						builder.add(mFrom, mTo, Decoration.replace({
							widget: new HeadingRawWidget(m[0])
						}));
					}
				}
			}
			return builder.finish();
		}
	}, { decorations: (v: { decorations: DecorationSet }) => v.decorations }));
}

export function createSelectionExtension(plugin: WritingMenuPlugin): Extension {
	let lastSelectionLength = 0;
	return EditorView.updateListener.of((update) => {
		if (!appliesToEditor(plugin, update.view)) return;
		if (!update.selectionSet) return;
		const selection = update.state.selection.main;
		const currentLength = selection.to - selection.from;
		if (currentLength === lastSelectionLength && currentLength === 0) return;
		lastSelectionLength = currentLength;
		if (currentLength > 0 || lastSelectionLength > 0) {
			const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView?.leaf) {
				plugin.updateCharCountDebounced(activeView.leaf);
			}
		}
	});
}

export function createFocusExtension(plugin: WritingMenuPlugin): Extension {
	const pluginSettings = plugin.settings;
	return ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(_view: EditorView) { this.decorations = Decoration.none; }
		update(update: ViewUpdate) {
			if (!pluginSettings.enableFocusMode || !appliesToEditor(plugin, update.view)) {
				if (this.decorations !== Decoration.none) this.decorations = Decoration.none;
				update.view.dom.classList.remove('wm-focus-typing');
				return;
			}
			const isUserInput = update.transactions.some((tr: Transaction) =>
				tr.isUserEvent("input") || tr.isUserEvent("delete")
			);
			const isExplicitMove = update.transactions.some((tr: Transaction) =>
				tr.isUserEvent("select") || tr.isUserEvent("select.pointer")
			);
			if (isUserInput && update.docChanged) {
				update.view.dom.classList.add('wm-focus-typing');
				this.decorations = this.buildDecorations(update.view);
			} else if (isExplicitMove) {
				update.view.dom.classList.remove('wm-focus-typing');
				this.decorations = Decoration.none;
			}
		}
		buildDecorations(view: EditorView): DecorationSet {
			if (!pluginSettings.enableFocusMode || !view.state.selection.main.empty) return Decoration.none;
			const activeLine = Decoration.line({ class: 'wm-focus-active-line' });
			const lineFrom = view.state.doc.lineAt(view.state.selection.main.head).from;
			const builder = new RangeSetBuilder<Decoration>();
			builder.add(lineFrom, lineFrom, activeLine);
			return builder.finish();
		}
	}, { decorations: (v: { decorations: DecorationSet }) => v.decorations });
}

export function updateEditorExtensions(plugin: WritingMenuPlugin) {
	plugin.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
		const view = leaf.view as MarkdownView;
		if (view && view.editor) {
			// @ts-ignore
			const editorView = view.editor.cm as EditorView;
			if (editorView) {
				editorView.dispatch({
					effects: [
						plugin.smartEnterCompartment.reconfigure(getSmartEnterExtension(plugin)),
						plugin.smartQuoteCompartment.reconfigure(getSmartQuoteExtension(plugin)),
						plugin.typewriterCompartment.reconfigure(getTypewriterExtension(plugin)),
						plugin.textSubstitutionCompartment.reconfigure([
							getTextSubstitutionExtension(plugin),
							getBackspaceUndoExtension(plugin)
						])
					]
				});
			}
		}
	});
}
