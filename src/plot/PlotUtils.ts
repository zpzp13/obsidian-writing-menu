// Shared popup utilities for the plot module

export function addOutsideClickListener(popup: HTMLElement, onDismiss: () => void): void {
	setTimeout(() => {
		const handler = (e: MouseEvent) => {
			if (!popup.contains(e.target as Node)) {
				onDismiss();
				document.removeEventListener('click', handler, true);
			}
		};
		document.addEventListener('click', handler, true);
	}, 0);
}

export function openChapterSearchPopup(
	popupClass: string,
	onSearch: (q: string) => void,
	onDismiss?: () => void,
): void {
	document.querySelector(`.${popupClass}`)?.remove();
	const popup = document.body.createDiv({ cls: popupClass });
	popup.createDiv({ cls: 'wm-plot-ch-search-popup-title', text: '회차 검색' });
	const inputWrap = popup.createDiv({ cls: 'wm-plot-ch-search-popup-wrap' });
	const input = inputWrap.createEl('input', {
		cls: 'wm-plot-ch-search-popup-input',
		attr: { type: 'text', placeholder: '화 번호 입력 (예: 5)', spellcheck: 'false' },
	});

	const dismiss = () => { popup.remove(); onDismiss?.(); };
	const doSearch = () => {
		const q = input.value.trim();
		if (q) onSearch(q);
		dismiss();
	};

	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') doSearch();
		else if (e.key === 'Escape') dismiss();
	});

	setTimeout(() => input.focus(), 0);
	addOutsideClickListener(popup, dismiss);
}
