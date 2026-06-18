import type { HeatmapStore } from './data/HeatmapStore';
import type WritingMenuPlugin from '../../main';
import { formatDateKey } from '../utils/dateUtils';

const WEEKS = 52;
const CELL  = 13; // cell size px
const GAP   = 2;  // gap px

const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const MON_KO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

export class HeatmapRenderer {
	static render(container: HTMLElement, store: HeatmapStore, plugin: WritingMenuPlugin) {
		const color = plugin.settings.heatmapColor || '#4f9cf9';

		const pad = container.createDiv({ cls: 'wm-dash-hm-pad' });
		pad.style.setProperty('--hm-color', color);

		// ── Date grid computation ──
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const startDate = new Date(today);
		startDate.setDate(startDate.getDate() - startDate.getDay() - (WEEKS - 1) * 7);

		type CellData = {
			date: Date; dateStr: string; count: number;
			isToday: boolean; isFuture: boolean;
		};
		const weeks: CellData[][] = [];
		for (let w = 0; w < WEEKS; w++) {
			const col: CellData[] = [];
			for (let d = 0; d < 7; d++) {
				const cellDate = new Date(startDate);
				cellDate.setDate(startDate.getDate() + w * 7 + d);
				const dateStr  = formatDateKey(cellDate);
				const isToday  = cellDate.getTime() === today.getTime();
				const isFuture = cellDate > today;
				const folder   = plugin.settings.heatmapFolder ?? '';
				const count    = isToday  ? (folder ? store.getTodayTotalForFolder(folder) : store.getTodayTotal())
				               : isFuture ? 0
				               : store.getHistoricalTotal(dateStr);
				col.push({ date: cellDate, dateStr, count, isToday, isFuture });
			}
			weeks.push(col);
		}

		// ── DOM: wrapper → dow-labels (fixed) + content (scrollable) ──
		const wrapper = pad.createDiv({ cls: 'wm-hm-wrapper' });

		// DOW labels: absolute-positioned, stays fixed while content scrolls
		const dowLabels = wrapper.createDiv({ cls: 'wm-hm-dow-labels' });
		for (let d = 0; d < 7; d++) {
			dowLabels.createSpan({
				cls: 'wm-hm-dow-label',
				text: d % 2 === 1 ? DOW_KO[d] : '',
			});
		}

		// Content: horizontal drag-scrollable area
		const content = wrapper.createDiv({ cls: 'wm-hm-content' });

		// Month label row (scrolls with grid) — 역순: 최신(좌) → 과거(우)
		const monthRow = content.createDiv({ cls: 'wm-hm-month-row' });
		let prevMonth = -1;
		for (let w = WEEKS - 1; w >= 0; w--) {
			const sunDate = weeks[w][0].date;
			const mon     = sunDate.getMonth();
			const colEl   = monthRow.createDiv({ cls: 'wm-hm-month-col' });
			if (mon !== prevMonth) {
				colEl.createSpan({ cls: 'wm-hm-month-label', text: MON_KO[mon] });
				prevMonth = mon;
			}
		}

		// Cell grid
		const grid = content.createDiv({ cls: 'wm-hm-grid' });

		// Popup (body-level to escape overflow:hidden)
		let popup: HTMLElement | null = null;
		const removePopup = () => { popup?.remove(); popup = null; };

		const levels = plugin.settings.heatmapLevels ?? [2000, 4000, 6000, 8000];

		for (let w = WEEKS - 1; w >= 0; w--) {
			const col = grid.createDiv({ cls: 'wm-hm-col' });
			for (const cell of weeks[w]) {
				const lvl = cell.isFuture ? 0 : this.level(cell.count, levels);
				const cls = [
					'wm-hm-cell',
					`level-${lvl}`,
					cell.isToday  ? 'wm-hm-cell-today'  : '',
					cell.isFuture ? 'wm-hm-cell-future' : '',
				].filter(Boolean).join(' ');

				const cellEl = col.createDiv({ cls });

				if (!cell.isFuture) {
					cellEl.addEventListener('mouseenter', (e: MouseEvent) => {
						removePopup();
						// e.view = 이벤트가 발생한 Window (floating 창이면 floating window)
						const doc = ((e.view as Window | null) ?? window).document;
						popup = doc.createElement('div');
						popup.className = 'wm-hm-popup';
						doc.body.appendChild(popup);

						const dateSpan = doc.createElement('span');
						dateSpan.className = 'wm-hm-popup-date';
						dateSpan.textContent = this.formatDate(cell.date);
						popup.appendChild(dateSpan);

						const charText = cell.count > 0 ? `${cell.count.toLocaleString()}자` : '기록 없음';
						const countSpan = doc.createElement('span');
						countSpan.className = cell.count > 0 ? 'wm-hm-popup-count' : 'wm-hm-popup-empty';
						countSpan.textContent = charText;
						popup.appendChild(countSpan);

						const rect = cellEl.getBoundingClientRect();
						popup.style.left = `${rect.left + rect.width / 2}px`;
						popup.style.top  = `${rect.top - 6}px`;
					});
					cellEl.addEventListener('mouseleave', removePopup);
				}
			}
		}

		pad.addEventListener('mouseleave', removePopup);

		// ── Horizontal drag-to-scroll ──
		const dragDoc = container.ownerDocument;
		let drag: { x: number; sl: number } | null = null;
		content.addEventListener('mousedown', (e) => {
			drag = { x: e.clientX, sl: content.scrollLeft };
			content.classList.add('is-dragging');
			e.preventDefault();
		});
		dragDoc.addEventListener('mousemove', (e) => {
			if (!drag) return;
			content.scrollLeft = drag.sl - (e.clientX - drag.x);
		});
		dragDoc.addEventListener('mouseup', () => {
			if (drag) { drag = null; content.classList.remove('is-dragging'); }
		});

		// 최신 데이터가 이미 좌측에 배치되므로 자동 스크롤 불필요
	}

	private static level(count: number, levels: [number, number, number, number]): number {
		if (count <= 0)         return 0;
		if (count >= levels[3]) return 4;
		if (count >= levels[2]) return 3;
		if (count >= levels[1]) return 2;
		return 1;
	}

	private static formatDate(date: Date): string {
		return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${DOW_KO[date.getDay()]})`;
	}
}
