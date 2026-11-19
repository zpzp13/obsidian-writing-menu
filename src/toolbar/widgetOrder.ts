import type { WritingWidgetId } from '../types';

export const WIDGET_IDS = ['munpia', 'novelpia', 'goal', 'mode', 'timer'] as const satisfies readonly WritingWidgetId[];

/**
 * Keep the user's saved order exactly; drop unknown/duplicate ids and add
 * widgets that did not exist when the order was saved. The goal follows
 * Novelpia (or Munpia); work mode goes immediately before the timer.
 */
export function normalizeWidgetOrder(saved: readonly unknown[] | null | undefined): WritingWidgetId[] {
	const order: WritingWidgetId[] = [];
	for (const id of Array.isArray(saved) ? saved : []) {
		if ((WIDGET_IDS as readonly unknown[]).includes(id) && !order.includes(id as WritingWidgetId)) order.push(id as WritingWidgetId);
	}
	if (!order.length) return [...WIDGET_IDS];
	if (!order.includes('goal')) {
		const anchor = order.includes('novelpia') ? order.indexOf('novelpia') : order.indexOf('munpia');
		order.splice(anchor + 1, 0, 'goal');
	}
	for (const id of WIDGET_IDS) {
		if (order.includes(id)) continue;
		const timerIndex = order.indexOf('timer');
		if (id === 'mode' && timerIndex >= 0) order.splice(timerIndex, 0, id);
		else order.push(id);
	}
	return order;
}
