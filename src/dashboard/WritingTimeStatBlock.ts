import { setIcon } from 'obsidian';

const N_CELLS = 30;

export const toDiffHMLabel = (sec: number): string => {
	const h = Math.floor(Math.abs(sec) / 3600);
	const m = Math.floor((Math.abs(sec) % 3600) / 60);
	return `${String(h).padStart(2, '0')}H ${String(m).padStart(2, '0')}M`;
};

export interface ModeStatEls {
	workTileGoalEl: HTMLElement;
	workTileAvgEl:  HTMLElement;
	goalOpEl:       HTMLElement;
	avgOpEl:        HTMLElement;
	goalDiffEl:     HTMLElement;
	avgDiffEl:      HTMLElement;
}

export function renderModeStatBlock(container: HTMLElement): ModeStatEls {
	const statBlock = container.createDiv({ cls: 'wm-wt-stat-block' });

	const goalRow        = statBlock.createDiv({ cls: 'wm-wt-cmp-row' });
	const workTileGoalEl = goalRow.createDiv({ cls: 'wm-wt-tile wm-wt-tile-work' });
	const goalOpEl       = goalRow.createSpan({ cls: 'wm-wt-cmp-op' });
	goalRow.createDiv({ cls: 'wm-wt-tile wm-wt-tile-goal' });
	const goalDiffEl     = goalRow.createSpan({ cls: 'wm-wt-cmp-diff' });

	const avgRow        = statBlock.createDiv({ cls: 'wm-wt-cmp-row' });
	const workTileAvgEl = avgRow.createDiv({ cls: 'wm-wt-tile wm-wt-tile-work' });
	const avgOpEl       = avgRow.createSpan({ cls: 'wm-wt-cmp-op' });
	avgRow.createDiv({ cls: 'wm-wt-tile wm-wt-tile-avg' });
	const avgDiffEl     = avgRow.createSpan({ cls: 'wm-wt-cmp-diff' });

	return { workTileGoalEl, workTileAvgEl, goalOpEl, avgOpEl, goalDiffEl, avgDiffEl };
}

export function updateModeStatBlock(
	els: ModeStatEls,
	cur: number,
	goal: number,
	avg: number,
	workCells: number,
): void {
	const lvl = workCells === 0 ? 0 : Math.min(Math.ceil((workCells / N_CELLS) * 4), 4);
	els.workTileGoalEl.className = `wm-wt-tile wm-wt-tile-work level-${lvl}`;
	els.workTileAvgEl.className  = `wm-wt-tile wm-wt-tile-work level-${lvl}`;

	els.goalOpEl.empty();
	if (goal <= 0) {
		els.goalDiffEl.textContent = '—';
		els.goalDiffEl.className   = 'wm-wt-cmp-diff';
	} else {
		const d = cur - goal;
		setIcon(els.goalOpEl, d >= 0 ? 'chevron-right' : 'chevron-left');
		els.goalDiffEl.textContent = `${d >= 0 ? '↑' : '↓'}${toDiffHMLabel(d)}`;
		els.goalDiffEl.className   = `wm-wt-cmp-diff ${d >= 0 ? 'is-above' : 'is-below'}`;
	}

	els.avgOpEl.empty();
	if (avg <= 0) {
		els.avgDiffEl.textContent = '—';
		els.avgDiffEl.className   = 'wm-wt-cmp-diff';
	} else {
		const d = cur - avg;
		setIcon(els.avgOpEl, d >= 0 ? 'chevron-right' : 'chevron-left');
		els.avgDiffEl.textContent = `${d >= 0 ? '↑' : '↓'}${toDiffHMLabel(d)}`;
		els.avgDiffEl.className   = `wm-wt-cmp-diff ${d >= 0 ? 'is-above' : 'is-below'}`;
	}
}
