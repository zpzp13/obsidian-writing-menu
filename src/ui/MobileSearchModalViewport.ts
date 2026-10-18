/** Keep search-first mobile modals inside the visual viewport, above the keyboard. */
export function bindMobileSearchModalViewport(host: HTMLElement): () => void {
	const win = host.ownerDocument.defaultView!;
	const viewport = win.visualViewport;
	let frame: number | null = null;
	const update = () => {
		frame = null;
		host.style.setProperty('--wm-search-viewport-height', `${viewport?.height ?? win.innerHeight}px`);
		host.style.setProperty('--wm-search-viewport-top', `${viewport?.offsetTop ?? 0}px`);
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
	};
}
