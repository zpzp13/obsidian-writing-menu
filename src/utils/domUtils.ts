export function watchDisconnect(el: HTMLElement, cleanup: () => void): void {
	const obs = new MutationObserver(() => {
		if (!el.isConnected) {
			cleanup();
			obs.disconnect();
		}
	});
	obs.observe(activeDocument.body, { childList: true, subtree: true });
}
