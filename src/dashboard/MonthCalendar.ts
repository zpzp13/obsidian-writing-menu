import { wmT } from '../i18n/index';
import { setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { ParsedTask } from './data/TaskParser';

const DOW_KO = [wmT("일"), wmT("월"), wmT("화"), wmT("수"), wmT("목"), wmT("금"), wmT("토")];

function openPopupAutoClose(popup: HTMLElement) {
	window.setTimeout(() => {
		const close = (ev: MouseEvent) => {
			if (!popup.contains(ev.target as Node)) {
				popup.remove();
				activeDocument.removeEventListener('click', close);
			}
		};
		activeDocument.addEventListener('click', close);
	}, 10);
}

export class MonthCalendar {
	static render(
		container: HTMLElement,
		tasksByDate: Map<string, ParsedTask[]>,
		_plugin: WritingMenuPlugin,
	) {
		const now = new Date();
		let viewYear  = now.getFullYear();
		let viewMonth = now.getMonth();

		const wrap = container.createDiv({ cls: 'wm-month-cal-wrap' });

		const renderMonth = () => {
			wrap.empty();
			const today = new Date();

			// 헤더
			const hdr = wrap.createDiv({ cls: 'wm-month-cal-hdr' });
			const prevBtn = hdr.createDiv({ cls: 'wm-month-cal-nav' });
			setIcon(prevBtn, 'chevron-left');
			hdr.createDiv({ cls: 'wm-month-cal-title', text: wmT("{0}년 {1}월", viewYear, viewMonth + 1) });
			const nextBtn = hdr.createDiv({ cls: 'wm-month-cal-nav' });
			setIcon(nextBtn, 'chevron-right');

			prevBtn.addEventListener('click', () => {
				viewMonth--;
				if (viewMonth < 0) { viewMonth = 11; viewYear--; }
				renderMonth();
			});
			nextBtn.addEventListener('click', () => {
				viewMonth++;
				if (viewMonth > 11) { viewMonth = 0; viewYear++; }
				renderMonth();
			});

			// 그리드
			const grid = wrap.createDiv({ cls: 'wm-month-cal' });

			// 요일 헤더
			for (const d of DOW_KO) {
				grid.createDiv({ cls: 'wm-month-cal-dow', text: d });
			}

			const firstDay = new Date(viewYear, viewMonth, 1);
			const lastDay  = new Date(viewYear, viewMonth + 1, 0);
			const startDow = firstDay.getDay();

			// 이전 달 패딩
			for (let i = 0; i < startDow; i++) {
				const d = new Date(viewYear, viewMonth, -startDow + i + 1);
				const dayEl = grid.createDiv({ cls: 'wm-month-cal-day is-other-month' });
				dayEl.createSpan({ text: String(d.getDate()) });
			}

			// 현재 달
			for (let day = 1; day <= lastDay.getDate(); day++) {
				const ds = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
				const isToday = viewYear === today.getFullYear()
					&& viewMonth === today.getMonth()
					&& day === today.getDate();

				const dayEl = grid.createDiv({ cls: 'wm-month-cal-day' + (isToday ? ' is-today' : '') });
				dayEl.createSpan({ text: String(day) });

				const tasks = tasksByDate.get(ds);
				if (tasks && tasks.length > 0) {
					const badge = dayEl.createDiv({ cls: 'wm-month-cal-badge' });
					badge.textContent = String(tasks.length);

					dayEl.addEventListener('click', (e) => {
						e.stopPropagation();
						activeDocument.querySelector('.wm-month-task-preview')?.remove();

						const ppop = activeDocument.body.createDiv({ cls: 'wm-month-task-preview wm-popup' });
						ppop.createDiv({ cls: 'wm-popup-section-label', text: wmT("{0}월 {1}일 할 일", viewMonth + 1, day) });

						for (const t of tasks) {
							const item = ppop.createDiv({ cls: 'wm-popup-item' });
							const dotEl = item.createDiv({ cls: 'wm-popup-icon' });
							setIcon(dotEl, 'circle');
							item.createSpan({ text: t.text || t.rawText });
						}

						const rect = dayEl.getBoundingClientRect();
						ppop.setCssStyles({ top: `${rect.bottom + 4}px` });
						ppop.setCssStyles({ left: `${rect.left}px` });

						window.requestAnimationFrame(() => {
							const pr = ppop.getBoundingClientRect();
							if (pr.right  > window.innerWidth  - 10) ppop.setCssStyles({ left: `${window.innerWidth  - pr.width  - 10}px` });
							if (pr.bottom > window.innerHeight - 10) ppop.setCssStyles({ top: `${rect.top - pr.height - 4}px` });
						});
						openPopupAutoClose(ppop);
					});
				}
			}

			// 다음 달 패딩
			const endDow = lastDay.getDay();
			for (let i = endDow + 1; i < 7; i++) {
				const dayEl = grid.createDiv({ cls: 'wm-month-cal-day is-other-month' });
				dayEl.createSpan({ text: String(i - endDow) });
			}
		};

		renderMonth();
	}
}
