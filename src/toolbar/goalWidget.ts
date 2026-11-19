export interface GoalProgress { goal: number; current: number; remaining: number; ratio: number; reached: boolean }

export function goalProgress(current: number, goal: number): GoalProgress {
	current = Number.isFinite(current) ? Math.max(0, current) : 0;
	goal = Number.isFinite(goal) ? Math.max(0, goal) : 0;
	return { goal, current, remaining: goal > 0 ? Math.max(0, goal - current) : 0, ratio: goal > 0 ? Math.min(1, current / goal) : 0, reached: goal > 0 && current >= goal };
}

export function goalRingSvg(ratio: number, dots = 12): string {
	dots = Number.isFinite(dots) ? Math.max(1, Math.min(100, Math.floor(dots))) : 12;
	const filled = Math.round(Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * dots);
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true">' + Array.from({ length: dots }, (_, i) => {
		const angle = -Math.PI / 2 + i * 2 * Math.PI / dots;
		return `<circle cx="${(8 + 6 * Math.cos(angle)).toFixed(3)}" cy="${(8 + 6 * Math.sin(angle)).toFixed(3)}" r="1.15" class="${i < filled ? 'is-filled' : 'is-empty'}"/>`;
	}).join('') + '</svg>';
}
