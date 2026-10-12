export function watchDisconnect(el: HTMLElement, cleanup: () => void): void {
	// body+subtree 전체를 감시하는 대신 직계 부모만 감시
	// 타이핑 중 에디터 DOM 변경마다 발화하는 낭비 제거
	const parent = el.parentElement ?? activeDocument.body;
	const obs = new MutationObserver(() => {
		if (!el.isConnected) {
			cleanup();
			obs.disconnect();
		}
	});
	obs.observe(parent, { childList: true });
}

/** 텍스트가 실제 너비를 넘을 때만 이전 음악 플레이어 방식의 왕복 marquee를 적용한다. */
export function refreshOverflowMarquee(container: HTMLElement, text: string): void {
	if (container.dataset.wmMarqueeText === text && container.firstElementChild) return;
	container.dataset.wmMarqueeText = text;
	container.removeClass('wm-has-marquee');
	container.empty();
	const span = container.createSpan({ cls: 'wm-track-title-inner', text });
	const ownerWindow = container.ownerDocument.defaultView ?? window;
	ownerWindow.setTimeout(() => {
		if (!container.isConnected || container.dataset.wmMarqueeText !== text) return;
		const overflow = Math.ceil(span.scrollWidth - container.clientWidth);
		if (overflow <= 0) return;
		container.addClass('wm-has-marquee');
		span.style.setProperty('--wm-scroll-dist', `-${overflow}px`);
		const duration = Math.min(30, Math.max(10, overflow / 4));
		span.style.setProperty('--wm-scroll-dur', `${duration.toFixed(1)}s`);
		span.addClass('wm-is-scrolling');
	}, 80);
}
