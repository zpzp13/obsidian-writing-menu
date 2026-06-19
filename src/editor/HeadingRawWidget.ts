import { WidgetType } from '@codemirror/view';

export class HeadingRawWidget extends WidgetType {
	constructor(readonly raw: string) { super(); }
	toDOM(): HTMLElement {
		const span = activeDocument.createElement('span');
		span.textContent = this.raw;
		span.className = 'wm-heading-raw';
		return span;
	}
	eq(other: HeadingRawWidget): boolean { return other.raw === this.raw; }
	ignoreEvent(): boolean { return false; }
}
