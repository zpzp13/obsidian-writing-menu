/** Sticky streaming scroll; user navigation pauses it until the bottom is reached again. */
export function bindDeusScrollFollow(viewport: HTMLElement) {
	const win = viewport.ownerDocument.defaultView ?? window;
	const requestFrame = win.requestAnimationFrame.bind(win), cancelFrame = win.cancelAnimationFrame.bind(win);
	let following = true, frame = 0, settlingFrame = 0, rendering = 0, navigatingUntil = 0, touchY = 0, disposed = false;
	const nearBottom = () => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 40;
	const schedule = () => {
		if (frame || disposed) return;
		frame = requestFrame(() => { frame = 0; if (following) viewport.scrollTop = viewport.scrollHeight; });
	};
	const navigate = () => { navigatingUntil = performance.now() + 1200; };
	const wheel = (event: WheelEvent) => { navigate(); if (event.deltaY < 0) following = false; };
	const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? 0; navigate(); };
	const touchMove = (event: TouchEvent) => { const y = event.touches[0]?.clientY ?? touchY; if (y > touchY) following = false; touchY = y; navigate(); };
	const keyboard = (event: KeyboardEvent) => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) { following = false; navigate(); } else if (['ArrowDown','PageDown','End',' '].includes(event.key)) navigate(); };
	const scroll = () => { if (rendering) return; if (nearBottom()) following = true; else if (performance.now() < navigatingUntil) following = false; };
	const resize = new ResizeObserver(schedule);
	const observe = () => { resize.disconnect(); resize.observe(viewport); for (const child of viewport.children) resize.observe(child); schedule(); };
	const mutation = new MutationObserver(observe); mutation.observe(viewport, { childList: true, subtree: true, characterData: true }); observe();
	viewport.addEventListener('wheel', wheel, { passive: true }); viewport.addEventListener('scroll', scroll, { passive: true });
	viewport.addEventListener('touchstart', touchStart, { passive: true }); viewport.addEventListener('touchmove', touchMove, { passive: true });
	viewport.addEventListener('pointerdown', navigate); viewport.addEventListener('keydown', keyboard);
	return {
		follow() { following = true; navigatingUntil = 0; schedule(); },
		beginRender() { cancelFrame(settlingFrame); rendering++; return rendering; },
		endRender(ticket: number, top: number) {
			if (ticket !== rendering || disposed) return;
			// Rebuilding Markdown briefly shrinks scrollHeight. Those synthetic
			// scroll events must not resume following while a reader is above it.
			settlingFrame = requestFrame(() => {
				if (ticket !== rendering || disposed) return;
				viewport.scrollTop = following ? viewport.scrollHeight : top;
				settlingFrame = requestFrame(() => { if (ticket === rendering) { rendering = 0; schedule(); } });
			});
		},
		changed: schedule,
		get following() { return following; },
		dispose() { disposed = true; cancelFrame(frame); cancelFrame(settlingFrame); mutation.disconnect(); resize.disconnect(); viewport.removeEventListener('wheel', wheel); viewport.removeEventListener('scroll', scroll); viewport.removeEventListener('touchstart', touchStart); viewport.removeEventListener('touchmove', touchMove); viewport.removeEventListener('pointerdown', navigate); viewport.removeEventListener('keydown', keyboard); },
	};
}
