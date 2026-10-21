// Pointer/keyboard resizing follows Claudian's session-resizer interaction.
// Copyright (c) 2025 Yishen Tu. MIT; see docs/licenses/Claudian-LICENSE.txt.
export const DEUS_SIDEBAR_BREAKPOINT = 560;
export function bindDeusSidebarResize(root: HTMLElement, grip: HTMLElement, initial: number, save: (width: number) => void) {
	let width = Number.isFinite(initial) ? initial : 200, pointer: number | undefined;
	const sync = () => {
		const max = Math.max(144, Math.min(360, root.clientWidth - 280));
		const applied = Math.max(144, Math.min(max, width));
		root.style.setProperty('--deus-sidebar-width', `${applied}px`);
		grip.setAttribute('aria-valuenow', String(Math.round(applied)));
		grip.setAttribute('aria-valuemin', '144'); grip.setAttribute('aria-valuemax', String(max));
	};
	const change = (next: number) => { width = Math.max(144, Math.min(Math.max(144, Math.min(360, root.clientWidth - 280)), next)); sync(); };
	grip.onpointerdown = event => {
		if (event.button !== 0 || !root.classList.contains('is-wide')) return;
		event.preventDefault(); pointer = event.pointerId; grip.setPointerCapture(pointer); root.addClass('is-resizing-sidebar');
	};
	grip.onpointermove = event => { if (pointer === event.pointerId) change(event.clientX - root.getBoundingClientRect().left); };
	const finish = () => { if (pointer === undefined) return; pointer = undefined; root.classList.remove('is-resizing-sidebar'); save(width); };
	grip.onpointerup = finish; grip.onpointercancel = finish; grip.onlostpointercapture = finish;
	grip.onkeydown = event => { if (['ArrowLeft','ArrowRight','Home'].includes(event.key)) { event.preventDefault(); change(event.key === 'Home' ? 200 : width + (event.key === 'ArrowRight' ? 10 : -10)); save(width); } };
	grip.ondblclick = () => { change(200); save(width); };
	sync();
	return { sync, dispose: () => { pointer = undefined; grip.onpointerdown = grip.onpointermove = grip.onpointerup = grip.onpointercancel = grip.onlostpointercapture = grip.onkeydown = grip.ondblclick = null; } };
}
