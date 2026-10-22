/** Obsidian helpers create in the main document; adopt detached nodes for popouts. */
export function detachedEl<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K): HTMLElementTagNameMap[K] {
	return document.adoptNode(createEl(tag));
}

export function detachedFragment(document: Document): DocumentFragment {
	return document.adoptNode(createFragment());
}
