import type WritingMenuPlugin from '../../main';

export class StatusBarManager {
	constructor(private plugin: WritingMenuPlugin) {}

	updateStatusBarDisplay() {
		if (!this.plugin.statusBarTimeEl || !this.plugin.statusBarItemEl) return;
		if (!this.plugin.settings.showTimeInStatusBar) {
			this.plugin.statusBarItemEl.setCssStyles({ display: 'none' });
			return;
		}
		this.plugin.statusBarItemEl.setCssStyles({ display: 'inline-flex' });
		this.plugin.statusBarTimeEl.textContent = this.plugin.formatTime(this.plugin.stopwatchSeconds);
	}

	toggleStatusPopup(anchor: HTMLElement) {
		const existing = activeDocument.querySelector('.wm-status-popup');
		if (existing) { existing.remove(); return; }

		const popup = activeDocument.createElement('div');
		popup.className = 'wm-status-popup';
		activeDocument.body.appendChild(popup);

		const rect = anchor.getBoundingClientRect();
		popup.setCssStyles({ left: `${rect.left}px` });
		window.requestAnimationFrame(() => {
			const popupRect = popup.getBoundingClientRect();
			popup.setCssStyles({ bottom: `${window.innerHeight - rect.top + 6}px` });
			if (rect.left + popupRect.width > window.innerWidth - 8) {
				popup.setCssStyles({ left: `${window.innerWidth - popupRect.width - 8}px` });
			}
		});
		popup.setCssStyles({ bottom: `${window.innerHeight - rect.top + 6}px` });

		this.plugin.buildStatusPopup(popup);

		const closePopup = (e: MouseEvent) => {
			if (!activeDocument.contains(e.target as Node)) return;
			if (!popup.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
				popup.remove();
				activeDocument.removeEventListener('click', closePopup);
			}
		};
		window.setTimeout(() => activeDocument.addEventListener('click', closePopup), 10);
	}
}
