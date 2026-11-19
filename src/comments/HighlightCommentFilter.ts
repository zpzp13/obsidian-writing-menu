import type { SourceHighlight } from './HighlightAnchors';
import type { HighlightThread } from './HighlightCommentTypes';
import type { HighlightColor } from '../utils/ObsidianHighlights';

export interface HighlightCard { highlight?: SourceHighlight; thread?: HighlightThread }
export type CommentStatusFilter = 'all' | 'open' | 'done' | 'missing';
export interface CommentFilter { status: CommentStatusFilter; colors: Array<HighlightColor | ''>; query: string }

export function cardStatus({ highlight, thread }: HighlightCard): Exclude<CommentStatusFilter, 'all'> | null {
	if (!highlight) return 'missing';
	return thread ? thread.status : null; // a highlight without comments has no status yet
}

export function filterCards(cards: HighlightCard[], filter: CommentFilter): HighlightCard[] {
	const query = filter.query.trim().toLocaleLowerCase();
	return cards.filter(card => {
		const { highlight, thread } = card;
		if (filter.status !== 'all' && cardStatus(card) !== filter.status) return false;
		if (filter.colors.length && !filter.colors.includes(highlight?.color ?? thread?.color ?? '')) return false;
		return !query || [highlight?.text ?? thread?.quote ?? '', ...(thread?.comments.map(c => c.body) ?? [])].some(text => text.toLocaleLowerCase().includes(query));
	});
}
