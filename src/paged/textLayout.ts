const PARAGRAPH_CLASS = 'wm-paged-paragraph';
const TEXT_RUN_CLASS = 'wm-paged-text-run';
const EMPTY_CARET_CHAR = '\u200b';

/**
 * Render source paragraphs without non-editable spacer nodes inside the
 * contenteditable tree. Chromium can place a native caret on those spacer
 * nodes, producing an oversized caret and a DOM position that disagrees with
 * the logical source offset. Paragraph CSS now owns indent and spacing.
 */
export function renderPagedText(
	container: HTMLElement,
	text: string,
	absoluteFrom: number,
	firstLineStartsParagraph: boolean,
	hasFollowingSource = false,
): void {
	container.empty();
	container.removeAttribute('data-virtual-trailing-newline');
	const fragment = container.ownerDocument.createDocumentFragment();
	let localFrom = 0;
	let paragraphIndex = 0;

	while (localFrom <= text.length) {
		const newlineAt = text.indexOf('\n', localFrom);
		const localTo = newlineAt < 0 ? text.length : newlineAt;
		const isVirtualTrailingParagraph = newlineAt < 0
			&& localFrom === text.length
			&& text.endsWith('\n')
			&& hasFollowingSource;
		if (isVirtualTrailingParagraph) {
			container.dataset.virtualTrailingNewline = 'true';
			break;
		}

		const paragraph = container.ownerDocument.createElement('div');
		paragraph.className = PARAGRAPH_CLASS;
		if (paragraphIndex > 0 || firstLineStartsParagraph) paragraph.classList.add('starts-paragraph');
		paragraph.dataset.from = String(absoluteFrom + localFrom);
		paragraph.dataset.to = String(absoluteFrom + localTo);

		const run = container.ownerDocument.createElement('span');
		run.className = TEXT_RUN_CLASS;
		const isEmpty = localTo === localFrom;
		if (isEmpty) run.classList.add('is-empty');
		run.dataset.from = String(absoluteFrom + localFrom);
		run.dataset.to = String(absoluteFrom + localTo);
		run.appendChild(container.ownerDocument.createTextNode(
			isEmpty ? EMPTY_CARET_CHAR : text.slice(localFrom, localTo),
		));
		paragraph.appendChild(run);
		fragment.appendChild(paragraph);

		if (newlineAt < 0) break;
		localFrom = newlineAt + 1;
		paragraphIndex++;
	}

	container.appendChild(fragment);
}

export function serializePagedText(container: HTMLElement): string {
	const paragraphs = Array.from(container.querySelectorAll<HTMLElement>(`:scope > .${PARAGRAPH_CLASS}`));
	let text = paragraphs.map(paragraph => {
		const run = paragraph.querySelector<HTMLElement>(`:scope > .${TEXT_RUN_CLASS}`);
		if (!run) return paragraph.textContent ?? '';
		const value = run.textContent ?? '';
		return run.classList.contains('is-empty')
			? value.split(EMPTY_CARET_CHAR).join('')
			: value;
	}).join('\n');
	if (container.dataset.virtualTrailingNewline === 'true') text += '\n';
	return text;
}

export function closestTextRun(node: Node): HTMLElement | null {
	const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
	return element?.closest<HTMLElement>(`.${TEXT_RUN_CLASS}`) ?? null;
}

export function closestParagraph(node: Node): HTMLElement | null {
	const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
	return element?.closest<HTMLElement>(`.${PARAGRAPH_CLASS}`) ?? null;
}

export function getTextRuns(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(`:scope > .${PARAGRAPH_CLASS} > .${TEXT_RUN_CLASS}`));
}

export function logicalTextLength(textRun: HTMLElement, value: string): number {
	return textRun.classList.contains('is-empty')
		? value.split(EMPTY_CARET_CHAR).join('').length
		: value.length;
}
