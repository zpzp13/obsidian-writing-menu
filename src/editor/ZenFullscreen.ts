interface NativeFullscreenWindow {
	isFullScreen(): boolean;
	setFullScreen(fullscreen: boolean): void;
}

function nativeWindow(document: Document): NativeFullscreenWindow | null {
	const native = (document.defaultView as (Window & { electronWindow?: NativeFullscreenWindow }) | null)?.electronWindow;
	return native && typeof native.isFullScreen === 'function' && typeof native.setFullScreen === 'function' ? native : null;
}

/** Native window fullscreen leaves Escape available to Obsidian's modal scope. */
export class ZenFullscreen {
	private native: NativeFullscreenWindow | null = null;
	private ownsNative = false;
	private htmlDocument: Document | null = null;

	isActive(document: Document): boolean {
		return Boolean(document.fullscreenElement || nativeWindow(document)?.isFullScreen());
	}

	enter(document: Document): void {
		const native = nativeWindow(document);
		if (native) {
			if (this.native === native) return;
			this.native = native;
			this.ownsNative = !native.isFullScreen();
			if (this.ownsNative) native.setFullScreen(true);
			return;
		}
		if (!document.fullscreenElement) {
			this.htmlDocument = document;
			void document.documentElement.requestFullscreen().catch(() => {});
		}
	}

	exit(): void {
		const native = this.native, ownsNative = this.ownsNative, html = this.htmlDocument;
		this.native = null;
		this.ownsNative = false;
		this.htmlDocument = null;
		if (native && ownsNative && native.isFullScreen()) native.setFullScreen(false);
		if (html?.fullscreenElement) void html.exitFullscreen().catch(() => {});
	}
}

export function shouldExitZenOnEscape(event: KeyboardEvent, document: Document): boolean {
	if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.repeat) return false;
	const overlays = '.modal-container, .menu, .suggestion-container';
	// Closing a modal can remove it before this event reaches the window. Its
	// original event path still owns this Escape even after the DOM removal.
	if (event.composedPath().some(target => (target as Node).nodeType === 1 && (target as Element).matches(overlays))) return false;
	return !Array.from(document.querySelectorAll<HTMLElement>(overlays)).some(element => element.getClientRects().length > 0);
}
