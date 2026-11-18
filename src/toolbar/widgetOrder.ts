import type { WritingWidgetId } from '../types';

export const WIDGET_IDS = ['munpia', 'novelpia', 'mode', 'timer'] as const satisfies readonly WritingWidgetId[];

/**
 * Keep the user's saved order exactly; drop unknown/duplicate ids and add
 * widgets that did not exist when the order was saved (work mode goes just
 * before the timer, anything else at the end).
 */
export function normalizeWidgetOrder(saved: readonly unknown[] | null | undefined): WritingWidgetId[] {
	const order: WritingWidgetId[] = [];
	for (const id of Array.isArray(saved) ? saved : []) {
		if ((WIDGET_IDS as readonly unknown[]).includes(id) && !order.includes(id as WritingWidgetId)) order.push(id as WritingWidgetId);
	}
	for (const id of WIDGET_IDS) {
		if (order.includes(id)) continue;
		const timerIndex = order.indexOf('timer');
		if (id === 'mode' && timerIndex >= 0) order.splice(timerIndex, 0, id);
		else order.push(id);
	}
	return order;
}
