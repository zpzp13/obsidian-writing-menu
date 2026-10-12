import { WidgetType } from '@codemirror/view';

export class HeadingRawWidget extends WidgetType {
	constructor(readonly raw: string) { super(); }
	toDOM(): HTMLElement {
		return createSpan({ cls: 'wm-heading-raw', text: this.raw });
	}
	eq(other: HeadingRawWidget): boolean { return other.raw === this.raw; }
	ignoreEvent(): boolean { return false; }
}
