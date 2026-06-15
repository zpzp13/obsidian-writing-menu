import { setIcon } from 'obsidian';

const MONTH_KO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

export function showDatePickerPopup(
	anchor: HTMLElement,
	selectedDate: Date,
	onPick: (date: Date) => void,
): HTMLElement {
	let py = selectedDate.getFullYear();
	let pm = selectedDate.getMonth();

	const popup  = document.body.createDiv({ cls: 'wm-cal-picker' });
	const hdr    = popup.createDiv({ cls: 'wm-cal-picker-hdr' });
	const prevBtn = hdr.createDiv({ cls: 'wm-cal-icon-btn' });
	setIcon(prevBtn, 'chevron-left');
	const titleEl = hdr.createSpan({ cls: 'wm-cal-picker-title' });
	const nextBtn = hdr.createDiv({ cls: 'wm-cal-icon-btn' });
	setIcon(nextBtn, 'chevron-right');
	const gridEl = popup.createDiv({ cls: 'wm-cal-picker-grid' });

	const buildCells = () => {
		titleEl.textContent = `${py}년 ${MONTH_KO[pm]}`;
		gridEl.empty();
		for (const wd of ['월','화','수','목','금','토','일']) {
			gridEl.createDiv({ cls: 'wm-cal-picker-wd', text: wd });
		}
		const today = new Date(); today.setHours(0, 0, 0, 0);
		const dow   = new Date(py, pm, 1).getDay();
		const back  = (dow + 6) % 7;
		const sy = py, sm = pm;
		for (let i = 0; i < 42; i++) {
			const d    = new Date(sy, sm, 1 - back + i);
			const cell = gridEl.createDiv({ cls: 'wm-cal-picker-day', text: String(d.getDate()) });
			if (d.getMonth() !== sm)                                    cell.addClass('wm-cal-picker-other');
			if (d.toDateString() === today.toDateString())              cell.addClass('wm-cal-picker-today');
			if (d.toDateString() === selectedDate.toDateString())       cell.addClass('wm-cal-picker-sel');
			cell.addEventListener('click', e => {
				e.stopPropagation();
				popup.remove();
				onPick(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
			});
		}
	};

	prevBtn.addEventListener('click', e => { e.stopPropagation(); pm--; if (pm < 0) { pm = 11; py--; } buildCells(); });
	nextBtn.addEventListener('click', e => { e.stopPropagation(); pm++; if (pm > 11) { pm = 0; py++; } buildCells(); });
	buildCells();

	const rect = anchor.getBoundingClientRect();
	const pw   = 224;
	let left   = rect.left;
	if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
	popup.style.cssText = `left:${left}px;top:${rect.bottom + 6}px;width:${pw}px;`;

	const close = (e: MouseEvent) => {
		if (!popup.contains(e.target as Node)) { popup.remove(); document.removeEventListener('click', close, true); }
	};
	setTimeout(() => document.addEventListener('click', close, true), 0);

	return popup;
}
