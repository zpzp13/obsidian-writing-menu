import { wmT } from '../../i18n/index';
import { setIcon } from 'obsidian';

const MONTH_KO = [wmT("1월"),wmT("2월"),wmT("3월"),wmT("4월"),wmT("5월"),wmT("6월"),wmT("7월"),wmT("8월"),wmT("9월"),wmT("10월"),wmT("11월"),wmT("12월")];

export function showDatePickerPopup(
	anchor: HTMLElement,
	selectedDate: Date,
	onPick: (date: Date) => void,
): HTMLElement {
	const anchorDoc = anchor.ownerDocument;
	const anchorWin = anchorDoc.defaultView ?? window;

	let py = selectedDate.getFullYear();
	let pm = selectedDate.getMonth();

	const popup = anchorDoc.body.createDiv({ cls: 'wm-cal-picker' });
	const header = popup.createDiv({ cls: 'wm-cal-picker-hdr' });
	const previous = header.createDiv({ cls: 'wm-cal-icon-btn' });
	setIcon(previous, 'chevron-left');
	const title = header.createSpan({ cls: 'wm-cal-picker-title' });
	const next = header.createDiv({ cls: 'wm-cal-icon-btn' });
	setIcon(next, 'chevron-right');
	const grid = popup.createDiv({ cls: 'wm-cal-picker-grid' });

	const renderMonth = () => {
		title.textContent = wmT("{0}년 {1}", py, MONTH_KO[pm]);
		grid.empty();
		for (const weekday of [wmT("월"),wmT("화"),wmT("수"),wmT("목"),wmT("금"),wmT("토"),wmT("일")]) {
			grid.createDiv({ cls: 'wm-cal-picker-wd', text: weekday });
		}
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const offset = (new Date(py, pm, 1).getDay() + 6) % 7;
		for (let i = 0; i < 42; i++) {
			const date = new Date(py, pm, 1 - offset + i);
			const cell = grid.createDiv({ cls: 'wm-cal-picker-day', text: String(date.getDate()) });
			if (date.getMonth() !== pm) cell.addClass('wm-cal-picker-other');
			if (date.toDateString() === today.toDateString()) cell.addClass('wm-cal-picker-today');
			if (date.toDateString() === selectedDate.toDateString()) cell.addClass('wm-cal-picker-sel');
			cell.addEventListener('click', event => {
				event.stopPropagation();
				popup.remove();
				onPick(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
			});
		}
	};

	previous.addEventListener('click', event => {
		event.stopPropagation();
		pm--;
		if (pm < 0) { pm = 11; py--; }
		renderMonth();
	});
	next.addEventListener('click', event => {
		event.stopPropagation();
		pm++;
		if (pm > 11) { pm = 0; py++; }
		renderMonth();
	});
	renderMonth();

	const rect = anchor.getBoundingClientRect();
	const width = 224;
	let left = rect.left;
	if (left + width > anchorWin.innerWidth - 8) left = anchorWin.innerWidth - width - 8;
	popup.setCssStyles({ left: `${left}px`, top: `${rect.bottom + 6}px`, width: `${width}px` });

	const close = (event: MouseEvent) => {
		if (anchor.contains(event.target as Node) || popup.contains(event.target as Node)) return;
		popup.remove();
		anchorDoc.removeEventListener('click', close, true);
	};
	window.setTimeout(() => anchorDoc.addEventListener('click', close, true), 0);

	return popup;
}
