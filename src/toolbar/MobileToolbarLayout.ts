/** Keep an editor-owned toolbar below Obsidian's normal or floating header. */
export function bindMobileToolbarLayout(container: HTMLElement, host: HTMLElement): () => void {
	const ownerWindow = container.ownerDocument.defaultView;
	if (!ownerWindow) return () => {};
	let frame = 0;
	let disposed = false;
	let header: HTMLElement | null = null;
	let toolbar: HTMLElement | null = null;
	let offset = 0;
	const transitions = new Set<string>();

	const schedule = () => {
		if (!disposed && !frame) frame = ownerWindow.requestAnimationFrame(update);
	};
	const resizeObserver = new ResizeObserver(schedule);
	const headerObserver = new MutationObserver(schedule);
	const onTransition = (event: TransitionEvent) => {
		if (event.target !== header) return;
		if (event.type === 'transitionrun') transitions.add(event.propertyName);
		else transitions.delete(event.propertyName);
		schedule();
	};
	const update = () => {
		frame = 0;
		if (disposed || !host.isConnected) return;
		const currentHeader = container.querySelector<HTMLElement>(':scope > .view-header');
		if (header !== currentHeader) {
			transitions.clear();
			if (header) resizeObserver.unobserve(header);
			headerObserver.disconnect();
			header = currentHeader;
			if (header) {
				resizeObserver.observe(header);
				headerObserver.observe(header, { attributes: true, attributeFilter: ['class', 'style'] });
			}
		}
		if (header && header.nextElementSibling !== host) header.after(host);
		const currentToolbar = host.querySelector<HTMLElement>(':scope > .wm-writing-toolbar');
		if (toolbar !== currentToolbar) {
			if (toolbar) resizeObserver.unobserve(toolbar);
			toolbar = currentToolbar;
			if (toolbar) resizeObserver.observe(toolbar);
		}
		// Read the whole frame before writing any layout styles. Measuring the
		// host after clipping it feeds our own animation back into its next size.
		const bounds = header?.getBoundingClientRect();
		const headerStyle = header ? ownerWindow.getComputedStyle(header) : null;
		const opacity = headerStyle && (!bounds?.width || !bounds.height
			|| headerStyle.visibility === 'hidden' || headerStyle.display === 'none')
			? 0 : Math.max(0, Math.min(1, Number(headerStyle?.opacity ?? 1)));
		const naturalHeight = toolbar?.getBoundingClientRect().height ?? host.scrollHeight;
		// Subtract our previous offset to measure the host's natural flow position.
		// A fixed header has no flow height; a normal header already reserves it.
		const flowTop = host.getBoundingClientRect().top - offset;
		const nextOffset = bounds && bounds.width > 0 && bounds.height > 0
			? Math.max(0, bounds.bottom - flowTop) : 0;
		if (nextOffset !== offset) {
			offset = nextOffset;
			host.style.setProperty('--wm-mobile-toolbar-top-offset', `${offset}px`);
		}
		const setStyle = (property: string, value: string) => {
			if (host.style.getPropertyValue(property) !== value) host.style.setProperty(property, value);
		};
		setStyle('opacity', String(opacity));
		// Keep a single sizing rule at both endpoints, avoiding the max-height →
		// intrinsic-height switch when the native header finishes appearing.
		setStyle('height', `${Math.max(0, naturalHeight * opacity)}px`);
		setStyle('overflow', opacity < 1 ? 'hidden' : '');
		setStyle('pointer-events', opacity < 0.01 ? 'none' : '');
		if (transitions.size) schedule();
	};

	resizeObserver.observe(container);
	const treeObserver = new MutationObserver(schedule);
	treeObserver.observe(container, { childList: true });
	treeObserver.observe(host, { childList: true });
	const bodyObserver = new MutationObserver(schedule);
	bodyObserver.observe(container.ownerDocument.body, { attributes: true, attributeFilter: ['class', 'style'] });
	ownerWindow.addEventListener('resize', schedule);
	ownerWindow.visualViewport?.addEventListener('resize', schedule);
	for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) container.addEventListener(type, onTransition as EventListener);
	update();

	return () => {
		disposed = true;
		ownerWindow.cancelAnimationFrame(frame);
		resizeObserver.disconnect();
		headerObserver.disconnect();
		treeObserver.disconnect();
		bodyObserver.disconnect();
		ownerWindow.removeEventListener('resize', schedule);
		ownerWindow.visualViewport?.removeEventListener('resize', schedule);
		for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) container.removeEventListener(type, onTransition as EventListener);
		host.style.removeProperty('--wm-mobile-toolbar-top-offset');
		for (const property of ['opacity', 'height', 'overflow', 'pointer-events']) host.style.removeProperty(property);
	};
}
