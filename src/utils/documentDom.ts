/** Create a detached element in the document's own Obsidian window. */
export function createDocumentElement<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K): HTMLElementTagNameMap[K] {
	const owner = document.win as Window & { createEl: typeof createEl };
	return owner.createEl(tag);
}
