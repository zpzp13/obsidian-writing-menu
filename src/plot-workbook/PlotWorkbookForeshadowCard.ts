import { wmT } from '../i18n/index';
type ForeshadowStatus = 'open' | 'resolved';

export function renderForeshadowBadge(parent: HTMLElement, status: ForeshadowStatus): HTMLElement {
	return parent.createSpan({ cls: `wm-plotbook-foreshadow-marker is-${status}`,
		attr: { role: 'img', 'aria-label': status === 'resolved' ? wmT("회수") : wmT("미회수"), title: status === 'resolved' ? wmT("회수") : wmT("미회수") } });
}

/** One card layout for the registry list and both timeline endpoints. */
export function renderForeshadowCard(parent: HTMLElement, options: {
	title: string;
	status: ForeshadowStatus;
	plotTitle: string;
	rowLabel: string;
	selected?: boolean;
	onSelect?: () => void;
}): HTMLElement {
	const card = parent.createDiv({ cls: `wm-plotbook-foreshadow-card${options.selected ? ' is-active' : ''}` });
	const body = card.createDiv({ cls: 'wm-plotbook-foreshadow-card-body' });
	const meta = body.createDiv({ cls: 'wm-plotbook-foreshadow-item-meta' });
	renderForeshadowBadge(meta, options.status);
	meta.createSpan({ cls: 'wm-plotbook-foreshadow-item-plot', text: options.plotTitle });
	meta.createSpan({ cls: 'wm-plotbook-foreshadow-item-row', text: options.rowLabel });
	body.createDiv({ cls: 'wm-plotbook-foreshadow-item-title', text: options.title });
	const onSelect = options.onSelect;
	if (onSelect) {
		card.setAttribute('role', 'button');
		card.tabIndex = 0;
		if (options.selected !== undefined) card.setAttribute('aria-pressed', String(options.selected));
		card.addEventListener('click', () => {
			card.focus({ preventScroll: true });
			onSelect();
		});
		card.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			card.click();
		});
	}
	return card;
}
