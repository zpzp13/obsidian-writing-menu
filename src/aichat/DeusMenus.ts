import type { Menu, MenuItem } from 'obsidian';

export function submenuPosition(parent: DOMRect, row: DOMRect, width: number, height: number, viewportWidth: number, viewportHeight: number) {
	const gap = 6, edge = 8;
	const right = parent.right + gap, left = parent.left - width - gap;
	return { x: Math.max(edge, Math.min(viewportWidth - width - edge, right + width <= viewportWidth - edge ? right : left)), y: Math.max(edge, Math.min(row.top, viewportHeight - height - edge)) };
}

/** Keep Obsidian's native submenu fully outside the parent surface, including leftward flips. */
export function alignDeusSubmenu(parent: Menu, item: MenuItem, submenu: Menu): void {
	const main = (parent as Menu & { dom?: HTMLElement }).dom, row = (item as MenuItem & { dom?: HTMLElement }).dom, child = (submenu as Menu & { dom?: HTMLElement }).dom;
	if (!main || !row || !child) return;
	const view = child.ownerDocument.defaultView; if (!view) return;
	let frame = 0;
	const update = () => {
		frame = 0; if (!child.isConnected || !main.isConnected) return;
		const rect = child.getBoundingClientRect(); if (!rect.width || !rect.height) return;
		const position = submenuPosition(main.getBoundingClientRect(), row.getBoundingClientRect(), rect.width, rect.height, view.innerWidth, view.innerHeight);
		for (const [property, value] of Object.entries({ position: 'fixed', left: `${position.x}px`, top: `${position.y}px`, transform: 'none' })) if (child.style.getPropertyValue(property) !== value) child.style.setProperty(property, value);
	};
	const schedule = () => { if (!frame) frame = view.requestAnimationFrame(update); };
	const observer = new MutationObserver(schedule); observer.observe(child, { attributes: true, attributeFilter: ['style','class'] });
	row.addEventListener('mouseenter', schedule); row.addEventListener('focusin', schedule);
	parent.onHide(() => { observer.disconnect(); view.cancelAnimationFrame(frame); row.removeEventListener('mouseenter', schedule); row.removeEventListener('focusin', schedule); });
}

export function compactDeusMenu(menu: Menu): void {
	menu.setUseNativeMenu?.(false);
	(menu as Menu & { dom?: HTMLElement }).dom?.addClass('deus-compact-menu');
}
