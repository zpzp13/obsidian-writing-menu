import type { Editor, EditorPosition } from 'obsidian';

export function normalizeQuery(word: string): string {
	return word.replace(/[-^]/g, '').trim();
}

export function getWordAtCursor(editor: Editor): { text: string; from: EditorPosition; to: EditorPosition } | null {
	if (editor.somethingSelected()) {
		const sel = editor.listSelections()[0];
		const isForward = sel.anchor.line < sel.head.line ||
			(sel.anchor.line === sel.head.line && sel.anchor.ch <= sel.head.ch);
		const from = isForward ? sel.anchor : sel.head;
		const to = isForward ? sel.head : sel.anchor;
		if (from.line !== to.line) return null;
		const text = editor.getRange(from, to);
		if (!/[가-힣]/.test(text)) return null;
		return { text, from, to };
	}
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	let start = cursor.ch, end = cursor.ch;
	while (start > 0 && !/\s/.test(line[start - 1])) start--;
	while (end < line.length && !/\s/.test(line[end])) end++;
	let kStart = start, kEnd = end;
	while (kStart < end && !/[가-힣]/.test(line[kStart])) kStart++;
	while (kEnd > kStart && !/[가-힣]/.test(line[kEnd - 1])) kEnd--;
	if (kStart >= kEnd) return null;
	return { text: line.substring(kStart, kEnd), from: { line: cursor.line, ch: kStart }, to: { line: cursor.line, ch: kEnd } };
}
