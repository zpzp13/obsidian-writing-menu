import { detachedEl } from '../utils/dom';
import { computeInlineDiff, computeLineDiff, DIFF_DELETE, DIFF_INSERT, type InlineSeg } from './diff';

const CONTEXT_LINES = 3;
const FOLD_AFTER_LINES = 10;
const MAX_INLINE_CHARACTERS = 100_000;
let foldId = 0;

interface Part { text: string; changed: boolean }
interface GraphemeSegmenter { segment(text: string): Iterable<{ segment: string }> }
const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => GraphemeSegmenter }).Segmenter;
const graphemes = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;

function line(view: HTMLElement, text: string, side?: 'left' | 'right'): HTMLElement {
	const element = detachedEl(view.ownerDocument, 'div');
	element.className = `diff-line${side ? ` mod-${side}` : ''}`;
	element.textContent = text || '\u00a0';
	view.appendChild(element);
	return element;
}

function viewIn(container: HTMLElement): HTMLElement {
	container.replaceChildren();
	const view = detachedEl(container.ownerDocument, 'div');
	view.className = 'diff-view wm-snapshot-diff-view';
	container.appendChild(view);
	return view;
}

export function renderSnapshotText(container: HTMLElement, text: string): void {
	const view = viewIn(container);
	if (text) for (const value of text.split('\n')) line(view, value);
}

/** Keep context around changes; materialize the unchanged middle only when requested. */
function equalLines(view: HTMLElement, lines: string[]): void {
	if (lines.length <= FOLD_AFTER_LINES) {
		for (const value of lines) line(view, value);
		return;
	}
	for (const value of lines.slice(0, CONTEXT_LINES)) line(view, value);
	const folded = lines.slice(CONTEXT_LINES, -CONTEXT_LINES);
	const group = detachedEl(view.ownerDocument, 'div');
	group.className = 'wm-snapshot-diff-fold';
	const control = group.appendChild(detachedEl(view.ownerDocument, 'div'));
	control.className = 'diff-collapsed';
	control.setAttribute('role', 'button'); control.tabIndex = 0;
	const region = group.appendChild(detachedEl(view.ownerDocument, 'div'));
	region.className = 'wm-snapshot-diff-equal'; region.id = `wm-snapshot-diff-fold-${++foldId}`; region.hidden = true;
	control.setAttribute('aria-controls', region.id);
	let expanded = false, populated = false;
	const refresh = () => {
		control.textContent = `${folded.length} lines ${expanded ? 'expanded' : 'folded'}`;
		control.setAttribute('aria-expanded', String(expanded));
		control.setAttribute('aria-label', `${folded.length}줄의 동일 구간 ${expanded ? '접기' : '펼치기'}`);
		region.hidden = !expanded;
	};
	const toggle = () => {
		if (!populated) { for (const value of folded) line(region, value); populated = true; }
		expanded = !expanded; refresh();
	};
	control.addEventListener('click', toggle);
	control.addEventListener('keydown', event => {
		if (event.isComposing || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
		event.preventDefault(); event.stopPropagation(); toggle();
	});
	refresh(); view.appendChild(group);
	for (const value of lines.slice(-CONTEXT_LINES)) line(view, value);
}

function sideLines(segments: InlineSeg[], side: 'left' | 'right'): Part[][] {
	const lines: Part[][] = [[]];
	for (const segment of segments) {
		if (segment.op === (side === 'left' ? DIFF_INSERT : DIFF_DELETE)) continue;
		const pieces = segment.text.split('\n');
		for (let index = 0; index < pieces.length; index++) {
			if (index) lines.push([]);
			if (pieces[index]) lines[lines.length - 1].push({ text: pieces[index], changed: segment.op !== 0 });
		}
	}
	return lines;
}

/** Highlight whole graphemes: a UTF-16 diff must never split an emoji or combining mark across spans. */
function appendParts(element: HTMLElement, parts: Part[]): void {
	const text = parts.map(part => part.text).join('');
	if (!text) return;
	if (!parts.some(part => part.changed)) { element.textContent = text; return; }
	if (parts.every(part => part.changed)) {
		const span = detachedEl(element.ownerDocument, 'span'); span.className = 'diff-changed'; span.textContent = text; element.replaceChildren(span); return;
	}
	const changed: Array<{ from: number; to: number }> = [];
	let offset = 0;
	for (const part of parts) {
		if (part.changed) changed.push({ from: offset, to: offset + part.text.length });
		offset += part.text.length;
	}
	element.replaceChildren(); offset = 0;
	let range = 0, pending = '', pendingChanged = false;
	const flush = () => {
		if (!pending) return;
		if (pendingChanged) {
			const span = detachedEl(element.ownerDocument, 'span'); span.className = 'diff-changed'; span.textContent = pending; element.appendChild(span);
		} else element.appendChild(element.ownerDocument.createTextNode(pending));
		pending = '';
	};
	const segments = graphemes?.segment(text) ?? Array.from(text, segment => ({ segment }));
	for (const { segment } of segments) {
		const end = offset + segment.length;
		while (range < changed.length && changed[range].to <= offset) range++;
		const highlight = range < changed.length && changed[range].from < end;
		if (highlight !== pendingChanged) { flush(); pendingChanged = highlight; }
		pending += segment; offset = end;
	}
	flush();
}

/** Native diff classes preserve theme colors; only the exact edited spans receive the stronger shade. */
export function renderSnapshotDiff(container: HTMLElement, before: string, after: string, options?: { hunkActions(parent: HTMLElement, index: number): void }): void {
	const view = viewIn(container);
	for (const [index, hunk] of computeLineDiff(before, after).entries()) {
		if (hunk.type === 'equal') { equalLines(view, hunk.aLines); continue; }
		const target = options ? view.appendChild(detachedEl(view.ownerDocument, 'div')) : view;
		if (options) { target.className = 'wm-snapshot-change'; options.hunkActions(target, index); }
		if (hunk.type === 'delete') { for (const value of hunk.aLines) line(target, value, 'left'); continue; }
		if (hunk.type === 'insert') { for (const value of hunk.bLines) line(target, value, 'right'); continue; }
		const left = hunk.aLines.join('\n'), right = hunk.bLines.join('\n');
		const segments = left.length + right.length <= MAX_INLINE_CHARACTERS ? computeInlineDiff(left, right)
			: [{ op: DIFF_DELETE, text: left }, { op: DIFF_INSERT, text: right }];
		for (const side of ['left', 'right'] as const) for (const parts of sideLines(segments, side)) appendParts(line(target, '', side), parts);
	}
}
