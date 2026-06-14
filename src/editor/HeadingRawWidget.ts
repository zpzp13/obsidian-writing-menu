import { WidgetType } from '@codemirror/view';

// Widget that renders a reference-style link as raw text
// Widget that renders a reference-style link as raw text, preventing Obsidian's link rendering
export class HeadingRawWidget extends WidgetType {
	constructor(readonly raw: string) { super(); }
	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.textContent = this.raw;
		span.style.cssText = 'color: inherit; pointer-events: none; cursor: text;';
		return span;
	}
	eq(other: HeadingRawWidget): boolean { return other.raw === this.raw; }
	ignoreEvent(): boolean { return false; }
}
