/** Standard composition state first; older Chromium reports only code 229 on final Enter. */
export function isComposingKey(event: KeyboardEvent): boolean {
	return event.isComposing || event.key === 'Process' || event.keyCode === 229;
}

/** Preserve vertical caret navigation on the Chromium shipped with Obsidian 1.7.2. */
export function caretRangeAtPoint(document: Document, x: number, y: number): Range | null {
	if (typeof document.caretPositionFromPoint === 'function') {
		const position = document.caretPositionFromPoint(x, y);
		if (!position) return null;
		const range = document.createRange();
		range.setStart(position.offsetNode, position.offset);
		range.collapse(true);
		return range;
	}
	return document.caretRangeFromPoint?.(x, y) ?? null;
}
