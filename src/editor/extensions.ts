import { EditorView, ViewPlugin, Decoration, DecorationSet, ViewUpdate, keymap } from '@codemirror/view';
import { EditorState, Extension, RangeSetBuilder, Prec, Transaction } from '@codemirror/state';
import { MarkdownView } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { HeadingRawWidget } from './HeadingRawWidget';
import { curvedQuoteAt } from './curvedQuotes';

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
	const editors = new WeakMap<EditorState, EditorView>();
	const applies = (state: EditorState): boolean => {
		const view = editors.get(state);
		return Boolean(view && plugin.settings.enableSmartQuotes && appliesToEditor(plugin, view));
	};
	// Extend the host's own bracket configuration. Its handler still decides
	// whether to pair, wrap a selection, skip a closer or delete an empty pair.
	const languageData: Parameters<typeof EditorState.languageData.of>[0] = (state, pos, side) => {
		if (!applies(state)) return [];
		for (const provider of state.facet(EditorState.languageData)) {
			if (provider === languageData) continue;
			for (const data of provider(state, pos, side)) {
				const config = data.closeBrackets as { brackets?: string[] } | undefined;
				if (!config?.brackets) continue;
				const brackets = [...config.brackets];
				if (brackets.includes('"')) brackets.push('“');
				if (brackets.includes("'")) brackets.push('‘');
				return [{ closeBrackets: { ...config, brackets } }];
			}
		}
		return [];
	};
	const input: Parameters<typeof EditorView.inputHandler.of>[0] = (view, from, to, text, insert) => {
		editors.set(view.state, view);
		if (!applies(view.state) || from !== to || (text !== '"' && text !== "'")) return false;
		const close = text === '"' ? '”' : '’';
		if (view.state.sliceDoc(from, from + 1) !== close) return false;
		// Give the existing host handler the curved closing character so its own
		// tracked pair can be traversed. Untracked quotes are ordinary input.
		for (const handler of view.state.facet(EditorView.inputHandler)) {
			if (handler !== input && handler(view, from, to, close, insert)) return true;
		}
		return false;
	};
	return [
		Prec.highest(EditorView.inputHandler.of(input)),
		Prec.highest(EditorState.languageData.of(languageData)),
		EditorView.updateListener.of(update => { editors.set(update.state, update.view); }),
		EditorState.transactionFilter.of(tr => {
			if (!applies(tr.startState) || !tr.docChanged || !tr.isUserEvent('input.type')) return tr;
			let changed = false;
			const source = tr.newDoc.toString();
			const changes: { from: number; to: number; insert: string }[] = [];
			tr.changes.iterChanges((from, to, fromB, _toB, inserted) => {
				const value = inserted.toString();
				const converted = value.replace(/["']/g, (quote, index: number) => {
					changed = true;
					const open = quote === '"' ? '“' : '‘', close = quote === '"' ? '”' : '’';
					if (value === quote + quote && tr.newSelection.ranges.some(range => range.from === fromB + 1)) return index === 0 ? open : close;
					const selected = tr.startState.selection.ranges.find(range => !range.empty && (from === range.from || from === range.to));
					if (selected && value === quote) return from === selected.from ? open : close;
					return curvedQuoteAt(source, fromB + index, quote) ?? quote;
				});
				changes.push({ from, to, insert: converted });
			});
			// Rewrite only the inserted glyphs in the original spec. Keeping the
			// original effects/annotations preserves the native pair positions and
			// makes conversion part of the same undo record as the host's insertion.
			return changed ? Object.assign({}, tr, { changes, selection: tr.newSelection, scrollIntoView: tr.scrollIntoView }) : tr;
		}),
	];
}

export function getTypewriterExtension(plugin: WritingMenuPlugin): Extension {
	if (!plugin.settings.enableTypewriterScrolling) return [];
	return ViewPlugin.fromClass(class {
		private pendingState: ViewUpdate['state'] | null = null;
		private scheduled = false;
		private destroyed = false;

		update(update: ViewUpdate) {
			const isUserInput = update.transactions.some((tr: Transaction) => tr.isUserEvent("input") || tr.isUserEvent("delete"));
			if (!appliesToEditor(plugin, update.view) || !update.state.selection.main.empty) {
				this.pendingState = null;
				return;
			}
			if (update.selectionSet && !isUserInput) this.pendingState = null;
			if (!update.docChanged || !isUserInput) return;
			this.pendingState = update.state;
			if (this.scheduled) return;
			this.scheduled = true;
			// Merge centering into CodeMirror's pending scroll target before its layout
			// pass. Writing scrollTop in requestMeasure fights its native scrolling
			// and scroll anchoring, and can use an already outdated cursor position.
			queueMicrotask(() => {
				this.scheduled = false;
				const view = update.view;
				const state = this.pendingState;
				this.pendingState = null;
				if (this.destroyed || !state || view.state !== state || !appliesToEditor(plugin, view)) return;
				view.dispatch({ effects: EditorView.scrollIntoView(state.selection.main.head, { y: 'center' }) });
			});
		}

		destroy() { this.destroyed = true; this.pendingState = null; }
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
