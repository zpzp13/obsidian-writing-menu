/** A plain-text editor with atomic note links. Paths are serialized for storage/API only. */
export type DeusComposerInput = HTMLDivElement & {
	value: string; placeholder: string; readonly selectionStart: number; readonly selectionEnd: number;
	setSelectionRange(from: number, to: number): void;
	setRangeText(value: string, from?: number, to?: number, mode?: string): void;
};

const mention = /@\[\[([^\]\n]+)\]\]/g;
const token = (node: Node): string | undefined => node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.deusMention ? `@[[${(node as HTMLElement).dataset.deusMention}]]` : undefined;
function read(node: Node): string {
	if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).hasAttribute('data-deus-caret-tail')) return '';
	const value = token(node); if (value !== undefined) return value;
	if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
	if (node.nodeName === 'BR') return '\n';
	return [...node.childNodes].map(read).join('');
}
function fragment(document: Document, value: string): DocumentFragment {
	const result = document.createDocumentFragment(); let from = 0;
	for (const match of value.matchAll(mention)) {
		result.append(document.createTextNode(value.slice(from, match.index)));
		const path = match[1], link = document.createElement('a');
		link.className = 'internal-link deus-input-mention'; link.contentEditable = 'false';
		link.dataset.deusMention = path; link.dataset.href = path; link.setAttribute('href', path);
		link.textContent = path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
		link.setAttribute('aria-label', link.textContent); result.append(link); from = match.index! + match[0].length;
	}
	result.append(document.createTextNode(value.slice(from))); return result;
}

export function createDeusComposerInput(parent: HTMLElement): DeusComposerInput {
	const element = parent.createDiv({ cls: 'deus-input', attr: { contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Deus AI에 메시지', spellcheck: 'true' } }) as DeusComposerInput;
	const caretLine = () => {
		for (const tail of element.querySelectorAll('[data-deus-caret-tail]')) tail.remove();
		// A final newline needs a visible empty line for Chromium's native caret.
		if (read(element).endsWith('\n')) element.createEl('br', { attr: { 'data-deus-caret-tail': '', 'aria-hidden': 'true' } });
	};
	const selectionOffset = (end: boolean): number => {
		const selection = element.ownerDocument.getSelection();
		if (!selection?.rangeCount || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return read(element).length;
		const range = selection.getRangeAt(0).cloneRange(); range.selectNodeContents(element);
		const point = selection.getRangeAt(0); range.setEnd(end ? point.endContainer : point.startContainer, end ? point.endOffset : point.startOffset);
		return read(range.cloneContents()).length;
	};
	const pointAt = (offset: number): [Node, number] => {
		let remaining = Math.max(0, offset);
		const visit = (parent: Node): [Node, number] | undefined => {
			for (const [index, child] of [...parent.childNodes].entries()) {
				const length = read(child).length;
				if (remaining <= length) {
					if (child.nodeType === Node.TEXT_NODE) return [child, remaining];
					if (token(child) !== undefined || child.nodeName === 'BR') return [parent, index + (remaining ? 1 : 0)];
					return visit(child) ?? [child, child.childNodes.length];
				}
				remaining -= length;
			}
		};
		return visit(element) ?? [element, element.childNodes.length];
	};
	const select = (from: number, to: number) => {
		const range = element.ownerDocument.createRange(); range.setStart(...pointAt(from)); range.setEnd(...pointAt(to));
		const selection = element.ownerDocument.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
	};
	Object.defineProperties(element, {
		value: { get: () => read(element), set: (value: string) => { element.replaceChildren(fragment(element.ownerDocument, value)); caretLine(); } },
		selectionStart: { get: () => selectionOffset(false) }, selectionEnd: { get: () => selectionOffset(true) },
		placeholder: { get: () => element.dataset.placeholder ?? '', set: (value: string) => { element.dataset.placeholder = value; } },
	});
	element.setSelectionRange = (from, to) => select(from, to);
	element.setRangeText = (value, from = element.selectionStart, to = element.selectionEnd) => {
		select(from, to); const range = element.ownerDocument.getSelection()!.getRangeAt(0);
		range.deleteContents(); const nodes = fragment(element.ownerDocument, value), last = nodes.lastChild;
		range.insertNode(nodes); caretLine(); if (last) { range.setStartAfter(last); range.collapse(true); }
		const selection = element.ownerDocument.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
	};
	element.addEventListener('input', caretLine);
	// Keep clipboard HTML and browser-generated block wrappers out of the draft model.
	element.addEventListener('paste', event => { event.preventDefault(); element.setRangeText(event.clipboardData?.getData('text/plain') ?? ''); element.dispatchEvent(new Event('input', { bubbles: true })); });
	element.addEventListener('beforeinput', event => { if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') { event.preventDefault(); element.setRangeText('\n'); element.dispatchEvent(new Event('input', { bubbles: true })); } });
	return element;
}

/** The same compact, exact-path links in stored user turns. Never interpret arbitrary HTML. */
export function renderDeusMentions(parent: HTMLElement, value: string): void {
	parent.replaceChildren(fragment(parent.ownerDocument, value));
}
