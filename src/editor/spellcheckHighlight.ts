import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import type { CorrectionState } from '../spellcheck/CorrectionModal';

export interface SpellcheckHighlightRange {
	from: number;
	to: number;
	state: CorrectionState;
	focused: boolean;
	occurrenceIndex: number;
}

export const setSpellcheckHighlights = StateEffect.define<SpellcheckHighlightRange[]>();

const spellcheckHighlightField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},
	update(decorations, transaction) {
		for (const effect of transaction.effects) {
			if (!effect.is(setSpellcheckHighlights)) continue;
			const ranges = [...effect.value]
				.filter(range => range.from < range.to && range.to <= transaction.state.doc.length)
				.sort((a, b) => a.from - b.from);
			return Decoration.set(ranges.map(range => Decoration.mark({
				class: `wm-spell-editor-error is-${range.state}${range.focused ? ' is-focused' : ''}`,
				attributes: { 'data-wm-spell-occurrence': String(range.occurrenceIndex) },
			}).range(range.from, range.to)));
		}
		return transaction.docChanged ? decorations.map(transaction.changes) : decorations;
	},
	provide: field => EditorView.decorations.from(field),
});

export function spellcheckHighlightExtension() {
	return spellcheckHighlightField;
}

export function setEditorSpellcheckHighlights(view: EditorView, ranges: SpellcheckHighlightRange[]) {
	view.dispatch({ effects: setSpellcheckHighlights.of(ranges) });
}

export function clearEditorSpellcheckHighlights(view: EditorView) {
	view.dispatch({ effects: setSpellcheckHighlights.of([]) });
}
