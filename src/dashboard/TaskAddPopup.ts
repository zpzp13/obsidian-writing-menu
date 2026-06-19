import { setIcon } from 'obsidian';

declare const moment: (date?: unknown, fmt?: string) => { format(f: string): string };
import type WritingMenuPlugin from '../../main';
import { TaskParser } from './data/TaskParser';
import { openPopupAutoClose } from './TaskItem';
import { formatDateKey } from '../utils/dateUtils';

const DOW_S = ['일','월','화','수','목','금','토'];

export function showTaskAddPopup(
	anchor: HTMLElement,
	plugin: WritingMenuPlugin,
	scheduleReload: () => void,
): void {
	activeDocument.querySelector('.wm-task-add-popup')?.remove();

	const popup = activeDocument.body.createDiv({ cls: 'wm-task-add-popup wm-ver-popup' });
	const rect  = anchor.getBoundingClientRect();
	popup.setCssStyles({ top: `${rect.bottom + 6}px` });
	popup.setCssStyles({ right: `${window.innerWidth - rect.right}px` });

	// ── 날짜 선택 ──
	const todayStr = moment().format('YYYY-MM-DD');
	let selectedDate = todayStr;

	const dateRow = popup.createDiv({ cls: 'wm-task-add-field wm-task-add-date-row' });
	const dateInput = dateRow.createEl('input', {
		type: 'text', cls: 'wm-task-add-input wm-task-add-date-input',
		attr: { placeholder: 'YYYY-MM-DD (오늘)', value: todayStr },
	});
	const calBtn = dateRow.createDiv({ cls: 'wm-task-add-cal-btn' });
	setIcon(calBtn, 'calendar');

	dateInput.addEventListener('input', () => {
		const v = dateInput.value.trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(v)) selectedDate = v;
	});

	calBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		activeDocument.querySelector('.wm-mini-date-picker')?.remove();

		let py = parseInt(selectedDate.slice(0, 4));
		let pm = parseInt(selectedDate.slice(5, 7)) - 1;
		const today2 = new Date();

		const dpop = activeDocument.body.createDiv({ cls: 'wm-mini-date-picker wm-ver-popup' });
		const dhdr = dpop.createDiv({ cls: 'wm-mini-picker-hdr' });
		const dprev = dhdr.createDiv({ cls: 'wm-cal-icon-btn' });
		setIcon(dprev, 'chevron-left');
		const dtitle = dhdr.createSpan({ cls: 'wm-mini-picker-title' });
		const dnext = dhdr.createDiv({ cls: 'wm-cal-icon-btn' });
		setIcon(dnext, 'chevron-right');
		const dgrid = dpop.createDiv({ cls: 'wm-mini-picker-grid' });

		const buildPicker = () => {
			dtitle.textContent = `${py}년 ${pm + 1}월`;
			dgrid.empty();
			for (const d of DOW_S) dgrid.createDiv({ cls: 'wm-mini-picker-dow', text: d });
			const dow = new Date(py, pm, 1).getDay();
			for (let i = 0; i < 42; i++) {
				const d = new Date(py, pm, 1 - dow + i);
				const dk = formatDateKey(d);
				const cls = ['wm-mini-picker-cell',
					d.getMonth() !== pm ? 'is-other' : '',
					dk === selectedDate ? 'is-sel' : '',
					d.toDateString() === today2.toDateString() ? 'is-today' : '',
				].filter(Boolean).join(' ');
				const cell = dgrid.createDiv({ cls });
				cell.textContent = String(d.getDate());
				cell.addEventListener('click', (ce) => {
					ce.stopPropagation();
					dpop.remove();
					selectedDate = dk;
					dateInput.value = dk;
				});
			}
		};
		dprev.addEventListener('click', (ce) => { ce.stopPropagation(); pm--; if (pm < 0) { pm = 11; py--; } buildPicker(); });
		dnext.addEventListener('click', (ce) => { ce.stopPropagation(); pm++; if (pm > 11) { pm = 0; py++; } buildPicker(); });
		buildPicker();

		const cr = calBtn.getBoundingClientRect();
		dpop.setCssStyles({ top: `${cr.bottom + 4}px` });
		dpop.setCssStyles({ left: `${cr.left}px` });
		window.requestAnimationFrame(() => {
			const pr = dpop.getBoundingClientRect();
			if (pr.right > window.innerWidth - 10) dpop.setCssStyles({ left: `${window.innerWidth - pr.width - 10}px` });
			if (pr.bottom > window.innerHeight - 10) dpop.setCssStyles({ top: `${cr.top - pr.height - 4}px` });
		});
		window.setTimeout(() => {
			const closePicker = (ev: MouseEvent) => {
				if (!dpop.contains(ev.target as Node)) { dpop.remove(); activeDocument.removeEventListener('click', closePicker); }
			};
			activeDocument.addEventListener('click', closePicker);
		}, 10);
	});

	// ── 내용·태그·하위항목 ──
	const contentRow = popup.createDiv({ cls: 'wm-task-add-field' });
	const contentInput = contentRow.createEl('input', {
		type: 'text', cls: 'wm-task-add-input',
		attr: { placeholder: '할 일 제목' },
	});

	const tagRow = popup.createDiv({ cls: 'wm-task-add-field' });
	const tagInput = tagRow.createEl('input', {
		type: 'text', cls: 'wm-task-add-input',
		attr: { placeholder: '#태그1 #태그2' },
	});

	const subRow = popup.createDiv({ cls: 'wm-task-add-field' });
	const subArea = subRow.createEl('textarea', {
		cls: 'wm-task-add-textarea',
		attr: { placeholder: '하위항목 (줄바꿈으로 구분)', rows: '3' },
	});

	const close  = () => popup.remove();
	const submit = async () => {
		const title = contentInput.value.trim();
		if (!title) { close(); return; }
		const tags = tagInput.value.trim()
			.split(/[\s,]+/).filter(Boolean)
			.map((t: string) => t.startsWith('#') ? t : `#${t}`)
			.join(' ');
		const dateEmoji = selectedDate !== todayStr ? ` 📅 ${selectedDate}` : '';
		const text = (tags ? `${title} ${tags}` : title) + dateEmoji;
		const subItems = subArea.value.split('\n').map((l: string) => l.trim()).filter(Boolean);
		try { await TaskParser.addTaskToDailyNote(text, plugin, subItems); } catch (_e) {}
		close();
		scheduleReload();
	};

	contentInput.addEventListener('keydown', (ev) => {
		if (ev.altKey && ev.key === 'Enter') { ev.preventDefault(); submit(); return; }
		if (ev.key === 'Enter')  { ev.preventDefault(); tagInput.focus(); }
		if (ev.key === 'Escape') close();
	});
	tagInput.addEventListener('keydown', (ev) => {
		if (ev.altKey && ev.key === 'Enter') { ev.preventDefault(); submit(); return; }
		if (ev.key === 'Enter')  { ev.preventDefault(); subArea.focus(); }
		if (ev.key === 'Escape') close();
	});
	subArea.addEventListener('keydown', (ev) => {
		if (ev.altKey && ev.key === 'Enter') { ev.preventDefault(); submit(); return; }
		if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); submit(); }
		if (ev.key === 'Escape') close();
	});

	const footer = popup.createDiv({ cls: 'wm-task-add-footer' });
	const cancelBtn = footer.createEl('button', { cls: 'wm-task-add-cancel-btn', text: '취소' });
	const submitBtn = footer.createEl('button', { cls: 'wm-task-add-submit-btn', text: '추가' });
	cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
	submitBtn.addEventListener('click', (e) => { e.stopPropagation(); submit(); });

	openPopupAutoClose(popup);
	contentInput.focus();
}
