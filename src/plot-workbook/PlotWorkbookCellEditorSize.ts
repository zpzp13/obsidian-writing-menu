/** Grow the active editor without forcing a full textarea layout on every keystroke. */
export class PlotWorkbookCellEditorSize {
	private readonly window: Window;
	private frame: number | null = null;
	private previousLength: number;
	private needsShrink = false;
	private height = 0;
	private readonly minimum: number;
	private readonly maximum: number;

	constructor(private readonly input: HTMLTextAreaElement, cell: HTMLElement, viewport: HTMLElement, zoom: number) {
		this.window = input.ownerDocument.defaultView!;
		this.previousLength = input.value.length;
		this.minimum = cell.clientHeight;
		const available = (viewport.getBoundingClientRect().bottom - cell.getBoundingClientRect().top) / zoom - 12;
		this.maximum = Math.max(this.minimum, Math.min(available, 360));
		input.style.height = `${this.minimum}px`;
		this.setHeight(input.scrollHeight + 4);
		input.addEventListener('input', this.onInput);
	}

	destroy(): void {
		this.input.removeEventListener('input', this.onInput);
		if (this.frame !== null) this.window.cancelAnimationFrame(this.frame);
		this.frame = null;
	}

	private readonly onInput = (): void => {
		this.needsShrink ||= this.input.value.length < this.previousLength;
		this.previousLength = this.input.value.length;
		// Native textarea scrolling already reveals the caret at the height limit.
		if (!this.needsShrink && this.height >= this.maximum) return;
		if (this.frame !== null) return;
		this.frame = this.window.requestAnimationFrame(() => {
			this.frame = null;
			if (!this.input.isConnected) return;
			if (this.needsShrink) this.input.style.height = `${this.minimum}px`;
			const required = this.input.scrollHeight;
			if (this.needsShrink || required > this.input.clientHeight + 1) this.setHeight(required + 4);
			this.needsShrink = false;
		});
	};

	private setHeight(required: number): void {
		this.height = Math.max(this.minimum, Math.min(required, this.maximum));
		this.input.style.height = `${this.height}px`;
	}
}
