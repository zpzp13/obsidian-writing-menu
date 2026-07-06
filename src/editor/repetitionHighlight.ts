import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';

export interface HighlightRange {
	from: number;
	to: number;
}

export const setRepetitionHighlights = StateEffect.define<HighlightRange[]>();

const mark = Decoration.mark({ class: 'wm-rep-editor-hl' });

const repetitionHighlightField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},
	update(deco, tr) {
		for (const e of tr.effects) {
			if (e.is(setRepetitionHighlights)) {
				const ranges = [...e.value]
					.filter(r => r.from < r.to && r.to <= tr.state.doc.length)
					.sort((a, b) => a.from - b.from);
				return Decoration.set(ranges.map(r => mark.range(r.from, r.to)));
			}
		}
		return tr.docChanged ? deco.map(tr.changes) : deco;
	},
	provide: f => EditorView.decorations.from(f),
});

/** main.ts에서 registerEditorExtension으로 등록해 모든 에디터에 반복 하이라이트 필드를 부여한다. */
export function repetitionHighlightExtension() {
	return repetitionHighlightField;
}

export function setEditorRepetitionHighlights(view: EditorView, ranges: HighlightRange[]) {
	view.dispatch({ effects: setRepetitionHighlights.of(ranges) });
}

export function clearEditorRepetitionHighlights(view: EditorView) {
	view.dispatch({ effects: setRepetitionHighlights.of([]) });
}
