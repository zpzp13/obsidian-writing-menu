import { wmT } from '../i18n/index';

export interface GoalBar { update(current: number | null, target: number): void }

/** The goal's current value: the note's count on the chosen platform. */
export function goalCurrent(counts: { munpia: number; novelpia: number }, settings: { goalCharBasis?: 'munpia' | 'novelpia' }): number {
	return counts[settings.goalCharBasis === 'novelpia' ? 'novelpia' : 'munpia'];
}

export function dashboardGoalTarget(settings: { writingGoalChars?: number }): number {
	const target = Number(settings.writingGoalChars);
	return Number.isFinite(target) && target > 0 ? target : 10_000;
}

/** The dashboard goal row: "10,000자까지 … 8,445자 남음" over a thin track. */
export function createGoalBar(parent: HTMLElement): GoalBar {
	const goal = parent.createDiv({ cls: 'wm-dash-char-goal' });
	const head = goal.createDiv({ cls: 'wm-dash-char-goal-head' });
	const label = head.createSpan();
	const remain = head.createSpan();
	const track = goal.createDiv({ cls: 'wm-dash-char-goal-track', attr: { role: 'progressbar', 'aria-valuemin': '0' } });
	const fill = track.createDiv({ cls: 'wm-dash-char-goal-fill' });
	return {
		update(current, target) {
			label.empty();
			label.createEl('b', { text: wmT("{0}자", target.toLocaleString()) });
			label.appendText(wmT('까지'));
			remain.empty();
			remain.createEl('b', { text: current === null ? '—' : wmT("{0}자", Math.max(0, target - current).toLocaleString()) });
			remain.appendText(wmT(" 남음"));
			track.setAttribute('aria-valuemax', String(target));
			track.setAttribute('aria-valuenow', String(Math.min(current ?? 0, target)));
			const progress = Math.max(2, Math.min(100, ((current ?? 0) / target) * 100));
			window.requestAnimationFrame(() => {
				window.requestAnimationFrame(() => fill.setCssStyles({ width: `${progress}%` }));
			});
		},
	};
}
