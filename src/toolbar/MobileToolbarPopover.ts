/** Place mobile menus outside the editor's clipped/masked stacking context. */
export function bindMobileToolbarPopover(anchor: HTMLElement, popover: HTMLElement): () => void {
	const ownerWindow = popover.ownerDocument.defaultView;
	if (!ownerWindow) return () => {};
	const viewport = ownerWindow.visualViewport;
	const inset = 8;
	const gap = 7;
	let frame = 0;
	let disposed = false;
	const setPixels = (property: string, value: number) => {
		const pixels = `${Math.round(value)}px`;
		if (popover.style.getPropertyValue(property) !== pixels) popover.style.setProperty(property, pixels);
	};
	const update = () => {
		frame = 0;
		if (disposed || !popover.isConnected || !anchor.isConnected) return;
		const left = (viewport?.offsetLeft ?? 0) + inset;
		const top = (viewport?.offsetTop ?? 0) + inset;
		const right = left + (viewport?.width ?? ownerWindow.innerWidth) - inset * 2;
		const bottom = top + (viewport?.height ?? ownerWindow.innerHeight) - inset * 2;
		setPixels('max-width', Math.max(0, right - left));
		const anchorBounds = anchor.getBoundingClientRect();
		const below = Math.max(0, bottom - Math.max(top, anchorBounds.bottom + gap));
		const above = Math.max(0, Math.min(bottom, anchorBounds.top - gap) - top);
		const naturalHeight = popover.scrollHeight + 2;
		const useBelow = below >= naturalHeight || below >= above;
		setPixels('max-height', useBelow ? below : above);
		const bounds = popover.getBoundingClientRect();
		setPixels('left', Math.max(left, Math.min(right - bounds.width, anchorBounds.left)));
		setPixels('top', useBelow
			? Math.max(top, anchorBounds.bottom + gap)
			: Math.max(top, Math.min(bottom - bounds.height, anchorBounds.top - gap - bounds.height)));
	};
	const schedule = () => {
		if (!disposed && !frame) frame = ownerWindow.requestAnimationFrame(update);
	};
	const onScroll = (event: Event) => {
		if (!popover.contains(event.target as Node | null)) schedule();
	};
	const resizeObserver = new ResizeObserver(schedule);
	resizeObserver.observe(popover);
	resizeObserver.observe(anchor);
	ownerWindow.addEventListener('resize', schedule);
	popover.ownerDocument.addEventListener('scroll', onScroll, true);
	viewport?.addEventListener('resize', schedule);
	viewport?.addEventListener('scroll', schedule);
	update();
	return () => {
		disposed = true;
		ownerWindow.cancelAnimationFrame(frame);
		resizeObserver.disconnect();
		ownerWindow.removeEventListener('resize', schedule);
		popover.ownerDocument.removeEventListener('scroll', onScroll, true);
		viewport?.removeEventListener('resize', schedule);
		viewport?.removeEventListener('scroll', schedule);
	};
}
