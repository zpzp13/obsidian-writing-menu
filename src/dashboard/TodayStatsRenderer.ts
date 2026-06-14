import type WritingMenuPlugin from '../../main';
import type { HeatmapStore } from './data/HeatmapStore';

export class TodayStatsRenderer {
	static render(container: HTMLElement, store: HeatmapStore, plugin: WritingMenuPlugin) {
		const todayTotal = store.getTodayTotal();
		const goal       = plugin.settings.writingGoalChars ?? 0;
		const average    = store.getDailyAverage();

		// 1×3 stats table
		const row = container.createDiv({ cls: 'wm-dash-stats-row' });

		const mkStat = (val: string, lbl: string, cls = '') => {
			const cell = row.createDiv({ cls: `wm-dash-stat${cls ? ' ' + cls : ''}` });
			cell.createDiv({ cls: 'wm-dash-stat-val', text: val });
			cell.createDiv({ cls: 'wm-dash-stat-lbl', text: lbl });
		};

		mkStat(`${todayTotal.toLocaleString()}자`, '오늘');
		mkStat(goal > 0 ? `${goal.toLocaleString()}자` : '—', '목표');
		mkStat(average > 0 ? `${average.toLocaleString()}자` : '—', '일평균');

		// Goal progress bar (shown only when goal is set)
		if (goal > 0 && todayTotal > 0) {
			const pct = Math.min(100, Math.round((todayTotal / goal) * 100));
			const wrap = container.createDiv({ cls: 'wm-dash-goal-wrap' });
			const track = wrap.createDiv({ cls: 'wm-dash-goal-track' });
			const bar = track.createDiv({ cls: `wm-dash-goal-bar${pct >= 100 ? ' is-done' : ''}` });
			bar.style.width = `${pct}%`;
			wrap.createSpan({ cls: 'wm-dash-goal-label', text: `목표 ${pct}%` });
		}
	}
}
