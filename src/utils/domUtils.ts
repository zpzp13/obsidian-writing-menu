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
