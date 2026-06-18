export function watchDisconnect(el: HTMLElement, cleanup: () => void): void {
	const obs = new MutationObserver(() => {
		if (!el.isConnected) {
			cleanup();
			obs.disconnect();
		}
	});
	obs.observe(document.body, { childList: true, subtree: true });
}
