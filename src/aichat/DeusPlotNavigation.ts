import type { ChatContextItem } from './AiChatTypes';

/** Read only a frozen source ID scoped to this conversation, never a generated URL. */
export function deusPlotLocation(source: ChatContextItem, projectRoot?: string, quote = source.text): { sheetId: string; rowId: string; columnRole?: 'foreshadow' } | undefined {
	if (source.kind !== 'plot' || !projectRoot) return;
	const prefix = `plot:${projectRoot}:`;
	if (!source.id.startsWith(prefix)) return;
	const match = /^([^:#]+):([^:#]+)(?=[:#]|$)/.exec(source.id.slice(prefix.length));
	// Plot evidence serializes foreshadow fields after the ordinary row cells.
	// An exact quote inside those fields should follow their column as well.
	const foreshadow = /^복선 \((?:미회수|회수)\):/m, start = source.text.search(foreshadow);
	const citesForeshadow = foreshadow.test(quote) || start >= 0 && Boolean(quote.trim())
		&& source.text.slice(start).includes(quote) && !source.text.slice(0, start).includes(quote);
	if (match) return { sheetId: match[1], rowId: match[2],
		...(citesForeshadow ? { columnRole: 'foreshadow' as const } : {}) };
}
