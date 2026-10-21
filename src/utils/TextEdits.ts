import dmp from 'diff-match-patch';
import { DIFF_DELETE, DIFF_INSERT } from '../snapshots/diff';

export interface TextEdit { from: number; to: number; text: string }

/** Original-buffer coordinates, sorted from end to start. Never infer edits from rendered DOM. */
export function textEdits(before: string, after: string): TextEdit[] {
	const edits: TextEdit[] = [];
	let offset = 0, pending: TextEdit | null = null;
	const flush = () => { if (pending) edits.push(pending); pending = null; };
	// Presentation cleanup may absorb unchanged styled text; do not use it for edits.
	const segments = new dmp().diff_main(before, after, false).map(([op, text]) => ({ op, text }));
	for (const segment of segments) {
		if (segment.op === 0) { flush(); offset += segment.text.length; continue; }
		pending ??= { from: offset, to: offset, text: '' };
		if (segment.op === DIFF_DELETE) { offset += segment.text.length; pending.to = offset; }
		else if (segment.op === DIFF_INSERT) pending.text += segment.text;
	}
	flush();
	return edits.reverse();
}

export function validatedEdits(source: string, edits: readonly TextEdit[]): TextEdit[] {
	const sorted = edits.map(edit => ({ ...edit })).sort((a, b) => b.from - a.from || b.to - a.to);
	let limit = source.length;
	for (const edit of sorted) {
		if (!Number.isInteger(edit.from) || !Number.isInteger(edit.to) || edit.from < 0 || edit.to < edit.from || edit.to > limit)
			throw new Error('편집 범위가 현재 문서와 일치하지 않습니다.');
		limit = edit.from;
	}
	return sorted;
}
