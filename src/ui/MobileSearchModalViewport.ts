const MOBILE_MODAL_HEIGHT_RATIO = 0.48;
const MOBILE_MODAL_MIN_HEIGHT = 300;
const MOBILE_MODAL_MAX_HEIGHT = 420;

/** Keep search-first mobile modals compact and inside the visual viewport. */
export function bindMobileSearchModalViewport(host: HTMLElement): () => void {
	const win = host.ownerDocument.defaultView!;
	const viewport = win.visualViewport;
	let referenceWidth = viewport?.width ?? win.innerWidth;
	let referenceHeight = Math.max(win.innerHeight, viewport?.height ?? 0);
	let frame: number | null = null;
	const update = () => {
		frame = null;
		const viewportWidth = viewport?.width ?? win.innerWidth;
		const viewportHeight = viewport?.height ?? win.innerHeight;
		// A width change means the device rotated. Keyboard resize keeps the width,
		// so retain the pre-keyboard height while the user is typing.
		if (Math.abs(viewportWidth - referenceWidth) > 2) {
			referenceWidth = viewportWidth;
			referenceHeight = Math.max(win.innerHeight, viewportHeight);
		} else {
			referenceHeight = Math.max(referenceHeight, win.innerHeight, viewportHeight);
		}
		const compactHeight = Math.min(
			MOBILE_MODAL_MAX_HEIGHT,
			Math.max(MOBILE_MODAL_MIN_HEIGHT, Math.round(referenceHeight * MOBILE_MODAL_HEIGHT_RATIO)),
		);
		host.style.setProperty('--wm-search-viewport-height', `${viewportHeight}px`);
		host.style.setProperty('--wm-search-viewport-top', `${viewport?.offsetTop ?? 0}px`);
		host.style.setProperty('--wm-search-modal-height', `${compactHeight}px`);
	};
	const schedule = () => { if (frame === null) frame = win.requestAnimationFrame(update); };
	update();
	viewport?.addEventListener('resize', schedule);
	viewport?.addEventListener('scroll', schedule);
	win.addEventListener('resize', schedule);
	return () => {
		if (frame !== null) win.cancelAnimationFrame(frame);
		viewport?.removeEventListener('resize', schedule);
		viewport?.removeEventListener('scroll', schedule);
		win.removeEventListener('resize', schedule);
		host.style.removeProperty('--wm-search-viewport-height');
		host.style.removeProperty('--wm-search-viewport-top');
		host.style.removeProperty('--wm-search-modal-height');
	};
}
