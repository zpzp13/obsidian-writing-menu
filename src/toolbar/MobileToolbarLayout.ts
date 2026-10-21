/** Share the native header's compositor timeline without resizing the editor every frame. */
export function bindMobileToolbarLayout(container: HTMLElement, host: HTMLElement): () => void {
	const win = container.ownerDocument.defaultView;
	if (!win) return () => {};
	let frame = 0, disposed = false;
	let header: HTMLElement | null = null, toolbar: HTMLElement | null = null;
	const mirrors = new Map<Animation, Animation>();
	const schedule = () => { if (!disposed && !frame) frame = win.requestAnimationFrame(update); };
	const sizes = new ResizeObserver(schedule);
	const headerChanges = new MutationObserver(schedule);
	const set = (element: HTMLElement, key: string, value: string) => {
		if (element.style.getPropertyValue(key) !== value) element.style.setProperty(key, value);
	};
	const stopMirrors = () => { for (const mirror of mirrors.values()) mirror.cancel(); mirrors.clear(); };
	const update = () => {
		frame = 0;
		if (disposed || !host.isConnected) return;
		const nextHeader = container.querySelector<HTMLElement>(':scope > .view-header');
		if (nextHeader !== header) {
			if (header) sizes.unobserve(header);
			headerChanges.disconnect(); stopMirrors(); header = nextHeader;
			if (header) {
				sizes.observe(header);
				headerChanges.observe(header, { attributes: true, attributeFilter: ['class', 'style'] });
			}
		}
		if (header && header.nextElementSibling !== host) header.after(host);
		const nextToolbar = host.querySelector<HTMLElement>(':scope > .wm-writing-toolbar');
		if (toolbar !== nextToolbar) {
			if (toolbar) sizes.unobserve(toolbar);
			toolbar = nextToolbar;
			if (toolbar) sizes.observe(toolbar);
		}
		const bounds = header?.getBoundingClientRect();
		const style = header ? win.getComputedStyle(header) : null;
		const matrix = style?.transform && style.transform !== 'none' ? new DOMMatrixReadOnly(style.transform) : null;
		const fixed = style?.position === 'fixed';
		const restBottom = bounds ? bounds.bottom - (matrix?.m42 ?? 0) : 0;
		const restLeft = bounds ? bounds.left - (matrix?.m41 ?? 0) : 0;
		const toolbarHeight = toolbar?.getBoundingClientRect().height ?? 0;
		const containerTop = container.getBoundingClientRect().top;
		host.toggleClass('is-floating-header', fixed);
		set(host, '--wm-mobile-toolbar-top', `${restBottom}px`);
		set(host, '--wm-mobile-toolbar-left', `${restLeft}px`);
		set(host, '--wm-mobile-toolbar-width', `${bounds?.width ?? container.clientWidth}px`);
		// Native floating navigation overlays the document. Reserve its initial
		// reading inset once; scroll transitions never change the editor viewport.
		set(container, '--wm-mobile-editor-top-space', `${fixed ? Math.max(0, restBottom - containerTop) + toolbarHeight + 8 : 8}px`);
		const sources = header?.getAnimations?.() ?? [];
		const activeProperties = new Set<string>();
		for (const source of sources) {
			const effect = source.effect as KeyframeEffect | null;
			if (!effect || effect.target !== header || source.playState === 'finished') continue;
			const frames = effect.getKeyframes();
			const property = ['transform', 'opacity'].find(key => frames.some(frame => frame[key] !== undefined));
			if (!property) continue;
			activeProperties.add(property);
			const end = frames[frames.length - 1]?.[property];
			if (end !== undefined) set(host, property, String(end));
			if (mirrors.has(source)) continue;
			const mirror = host.animate(frames.map(frame => ({ [property]: frame[property], offset: frame.offset,
				easing: frame.easing, composite: frame.composite })), { ...effect.getTiming(), fill: 'both' });
			mirrors.set(source, mirror);
			const synchronize = () => {
				if (!mirrors.has(source)) return;
				if (source.startTime !== null) mirror.startTime = source.startTime;
				else mirror.currentTime = source.currentTime;
			};
			synchronize();
			void mirror.ready.then(synchronize).catch(() => {});
			void mirror.finished.then(() => {
				if (mirrors.get(source) === mirror) { mirrors.delete(source); mirror.cancel(); }
			}).catch(() => {});
		}
		for (const [source, mirror] of mirrors) if (!sources.includes(source) || source.playState === 'idle') {
			mirror.cancel(); mirrors.delete(source);
		}
		if (!activeProperties.has('transform')) set(host, 'transform', style?.transform ?? 'none');
		if (!activeProperties.has('opacity')) set(host, 'opacity', style?.opacity ?? '1');
		const hidden = !bounds?.height || style?.display === 'none' || style?.visibility === 'hidden'
			|| host.style.opacity === '0';
		set(host, 'pointer-events', hidden ? 'none' : '');
	};
	const onTransition = (event: TransitionEvent) => { if (event.target === header) update(); };
	sizes.observe(container);
	const tree = new MutationObserver(schedule);
	tree.observe(container, { childList: true }); tree.observe(host, { childList: true });
	const body = new MutationObserver(schedule);
	body.observe(container.ownerDocument.body, { attributes: true, attributeFilter: ['class', 'style'] });
	win.addEventListener('resize', schedule);
	win.visualViewport?.addEventListener('resize', schedule);
	for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) container.addEventListener(type, onTransition as EventListener);
	update();
	return () => {
		disposed = true; win.cancelAnimationFrame(frame); stopMirrors();
		sizes.disconnect(); headerChanges.disconnect(); tree.disconnect(); body.disconnect();
		win.removeEventListener('resize', schedule); win.visualViewport?.removeEventListener('resize', schedule);
		for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) container.removeEventListener(type, onTransition as EventListener);
		host.removeClass('is-floating-header');
		for (const key of ['transform', 'opacity', 'pointer-events', '--wm-mobile-toolbar-top', '--wm-mobile-toolbar-left', '--wm-mobile-toolbar-width']) host.style.removeProperty(key);
		container.style.removeProperty('--wm-mobile-editor-top-space');
	};
}
