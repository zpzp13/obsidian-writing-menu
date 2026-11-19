import { Notice, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { getWritingDocument, type WritingDocument } from '../writing/WritingDocument';
import type { SourceHighlight } from './HighlightAnchors';
import { cardStatus, filterCards, type CommentFilter, type CommentStatusFilter, type HighlightCard } from './HighlightCommentFilter';
import { HIGHLIGHT_COLORS, highlightBackground, type HighlightColor } from '../utils/ObsidianHighlights';
import { commentButton, commentComposer, confirmThreadDeletion, matchText, renderComments } from './HighlightCommentUi';
import { wmT } from '../i18n';

const emptyFilter = (): CommentFilter => ({ status: 'all', colors: [], query: '' });

export class HighlightCommentPanel {
	private filter: CommentFilter = emptyFilter();
	private unsubscribe: () => void;
	private title: HTMLElement;
	private search: HTMLButtonElement;
	private searchRow: HTMLElement;
	private searchInput: HTMLInputElement;
	private chips: HTMLElement;
	private list: HTMLElement;
	private path = '';
	private timer = 0;
	private pending = false;
	private disposed = false;
	private colorsOpen = false;
	private colorPop: HTMLElement | null = null;
	private wideColorLabel = false;
	private colorsAnimate = false;
	private cards: HighlightCard[] = [];
	private closeColors: (event: Event) => void;
	/** Last rendered state; background refreshes with no change keep the DOM as is. */
	private signature = '';
	private drafts = new Map<string, string>();
	/** Item whose reply box is open (kept open while it holds a draft). */
	private replying = '';
	constructor(private root: HTMLElement, private plugin: WritingMenuPlugin, toggle: () => void) {
		root.addClass('wm-hlc-root');
		const toolbar = root.createDiv({ cls: 'wm-dashboard-toolbar wm-revision-toolbar' });
		setIcon(toolbar.createSpan({ cls: 'wm-hlc-toolbar-icon', attr: { 'aria-hidden': 'true' } }), 'message-square-text');
		this.title = toolbar.createSpan({ cls: 'wm-revision-title' });
		const actions = toolbar.createDiv({ cls: 'wm-revision-toolbar-actions' });
		this.search = commentButton(actions, wmT('검색'), () => this.toggleSearch(), 'search');
		// The switch shows where it leads: the analysis view.
		commentButton(actions, wmT('분석으로 전환'), toggle, 'chart-column');
		commentButton(actions, wmT('분석 설정'), () => this.plugin.openSettings('repetition'), 'settings');
		// Shared plugin search field; the toolbar search icon opens and folds it.
		this.searchRow = root.createDiv({ cls: 'wm-search-field wm-hlc-search' }); this.searchRow.hidden = true;
		setIcon(this.searchRow.createSpan({ attr: { 'aria-hidden': 'true' } }), 'search');
		this.searchInput = this.searchRow.createEl('input', { type: 'search', attr: { placeholder: wmT('인용문과 댓글 검색…'), 'aria-label': wmT('인용문과 댓글 검색…') } });
		this.searchInput.oninput = () => { window.clearTimeout(this.timer); this.timer = window.setTimeout(() => { this.filter.query = this.searchInput.value; this.update(); }, 150); };
		this.searchInput.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); this.toggleSearch(false); } };
		this.chips = root.createDiv({ cls: 'wm-hlc-chips', attr: { role: 'toolbar', 'aria-label': wmT('필터') } });
		this.list = root.createDiv({ cls: 'wm-hlc-list' });
		this.unsubscribe = plugin.highlightComments.onChange(() => this.update());
		this.closeColors = event => {
			if (!this.colorsOpen || (event instanceof KeyboardEvent ? event.key !== 'Escape' : this.colorPop?.contains(event.target as Node) || this.chips.querySelector('.is-colors')?.contains(event.target as Node))) return;
			this.colorsOpen = false; this.renderChips(this.cards);
		};
		root.ownerDocument.addEventListener('pointerdown', this.closeColors, true);
		this.chips.addEventListener('scroll', () => { if (this.colorsOpen) { this.colorsOpen = false; this.renderChips(this.cards); } }, { passive: true });
		root.ownerDocument.addEventListener('keydown', this.closeColors, true);
		root.addEventListener('focusout', () => { window.setTimeout(() => { if (!this.disposed && this.pending) this.update(); }, 0); });
		this.update();
	}
	destroy(): void {
		this.disposed = true; this.unsubscribe(); window.clearTimeout(this.timer);
		this.root.ownerDocument.removeEventListener('pointerdown', this.closeColors, true);
		this.root.ownerDocument.removeEventListener('keydown', this.closeColors, true);
	}
	focusThread(id: string): void {
		const item = Array.from(this.list.querySelectorAll<HTMLElement>('[data-thread-id]')).find(el => el.dataset.threadId === id);
		item?.scrollIntoView({ block: 'center' }); item?.focus({ preventScroll: true });
	}
	private toggleSearch(open: boolean = this.searchRow.hidden === true): void {
		this.searchRow.hidden = !open;
		this.search.toggleClass('is-active', open);
		if (open) this.searchInput.focus();
		else { window.clearTimeout(this.timer); this.searchInput.value = this.filter.query = ''; this.update(); }
	}
	private colorLabel(color: HighlightColor | ''): string {
		const labels: Record<HighlightColor | '', string> = { '': wmT('기본'), red: wmT('빨강'), orange: wmT('주황'), yellow: wmT('노랑'), green: wmT('초록'), blue: wmT('파랑'), purple: wmT('보라') };
		return labels[color];
	}
	private renderChips(cards: HighlightCard[]): void {
		this.chips.empty();
		const count = (status: CommentStatusFilter) => status === 'all' ? cards.length : cards.filter(card => cardStatus(card) === status).length;
		for (const [status, label] of [['all', wmT('전체')], ['done', wmT('완료')], ['open', wmT('미완료')], ['missing', wmT('사라짐')]] as const) {
			const chip = this.chips.createEl('button', { cls: 'wm-hlc-chip', attr: { type: 'button', 'aria-pressed': String(this.filter.status === status) } });
			chip.createSpan({ text: label }); chip.createSpan({ cls: 'wm-hlc-chip-count', text: String(count(status)) });
			chip.onclick = () => { this.filter.status = status; if (status === 'all') { this.filter.colors = []; this.colorsOpen = false; } this.update(true); };
		}
		// The colour chip opens in place: a menu of the chip's own width grows down
		// from it. The menu lives in the panel, not the scrolling chip row, so the
		// row's horizontal scroll cannot clip it.
		this.colorPop?.remove(); this.colorPop = null;
		const label = this.wideColorLabel ? wmT('하이라이트 색상') : wmT('색상');
		// "색상 N": N is how many colours are picked; 0 means all colours.
		const chipContent = (parent: HTMLElement) => {
			parent.createSpan({ text: label });
			parent.createSpan({ cls: 'wm-hlc-chip-count', text: String(this.filter.colors.length) });
		};
		const toggle = () => { this.colorsOpen = !this.colorsOpen; this.colorsAnimate = this.colorsOpen; this.renderChips(cards); };
		const chip = this.chips.createEl('button', { cls: `wm-hlc-chip is-colors${this.colorsOpen ? ' is-open' : ''}`, attr: { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': String(this.colorsOpen), 'aria-pressed': String(this.filter.colors.length > 0) } });
		chipContent(chip); chip.onclick = toggle;
		if (!this.colorsOpen) return;
		// Only the opening click animates; picking colours re-renders the menu in place.
		const pop = this.colorPop = this.root.createDiv({ cls: `wm-hlc-color-pop${this.colorsAnimate ? ' is-opening' : ''}` });
		this.colorsAnimate = false;
		const head = pop.createEl('button', { cls: 'wm-hlc-color-pop-head', attr: { type: 'button', 'aria-label': label } });
		chipContent(head); head.onclick = toggle;
		const options = pop.createDiv({ cls: 'wm-hlc-color-options', attr: { role: 'menu' } });
		const option = (text: string, checked: boolean, pick: () => void) => {
			const button = options.createEl('button', { cls: 'wm-hlc-color-option', text, attr: { type: 'button', role: 'menuitemcheckbox', 'aria-checked': String(checked) } });
			button.onclick = () => { pick(); this.update(true); };
		};
		option(wmT('모두'), !this.filter.colors.length, () => { this.filter.colors = []; });
		for (const color of ['', ...HIGHLIGHT_COLORS] as const) {
			const selected = this.filter.colors.includes(color);
			option(this.colorLabel(color), selected, () => { this.filter.colors = selected ? this.filter.colors.filter(c => c !== color) : [...this.filter.colors, color]; });
		}
		const chipBox = chip.getBoundingClientRect(), rootBox = this.root.getBoundingClientRect();
		const left = Math.max(0, Math.min(rootBox.width - chipBox.width, chipBox.left - rootBox.left));
		pop.setCssStyles({ left: `${left}px`, top: `${chipBox.top - rootBox.top}px`, width: `${chipBox.width}px` });
		// Labels that do not fit the chip's width get a wider chip instead of a wider menu.
		if (!this.wideColorLabel && Array.from(options.children).some(option => option.scrollWidth > option.clientWidth)) { this.wideColorLabel = true; this.renderChips(cards); }
	}
	update(force = false): void {
		if (this.disposed) return;
		const active = this.root.ownerDocument.activeElement;
		if (!force && active?.tagName === 'TEXTAREA' && this.root.contains(active)) { this.pending = true; return; }
		this.pending = false;
		const document = getWritingDocument(this.plugin);
		if (document?.path !== this.path) { this.path = document?.path ?? ''; this.filter.query = this.searchInput.value = ''; this.replying = ''; }
		const exists = !!document && !!this.plugin.app.vault.getAbstractFileByPath(document.path);
		const resolved = exists ? this.plugin.highlightComments.resolve(document) : { highlights: [], anchors: [] };
		const assigned = new Map(resolved.anchors.filter(a => a.highlight).map(a => [a.highlight!, this.plugin.highlightComments.getThread(a.threadId)]));
		const cards: HighlightCard[] = resolved.highlights.map(highlight => ({ highlight, thread: assigned.get(highlight) }));
		cards.push(...resolved.anchors.filter(a => a.state === 'detached').map(a => ({ thread: this.plugin.highlightComments.getThread(a.threadId) })).sort((a, b) => (a.thread?.offset ?? 0) - (b.thread?.offset ?? 0)));
		const signature = JSON.stringify([this.path, exists, this.filter, this.replying, cards.map(({ highlight: h, thread: t }) => [
			h?.from, h?.to, h?.line, h?.color, h?.text, t?.id, t?.status, t?.quote, t?.comments.map(c => [c.id, c.updatedAt]),
		])]);
		if (!force && signature === this.signature) return;
		this.signature = signature;
		this.title.setText(document?.file.basename ?? wmT('원고를 열어 주세요.'));
		this.search.toggleClass('is-active', !this.searchRow.hidden || !!this.filter.query);
		this.cards = cards; this.renderChips(cards);
		const scroll = this.list.scrollTop, fragment = createDiv();
		const shown = exists ? filterCards(cards, this.filter) : [];
		for (const card of shown) this.renderItem(fragment, card, document!);
		if (exists && !shown.length) {
			const empty = fragment.createDiv({ cls: 'wm-hlc-empty' });
			if (!cards.length) setIcon(empty.createDiv({ cls: 'wm-hlc-empty-icon' }), 'highlighter');
			empty.createDiv({ text: cards.length ? wmT('조건에 맞는 항목이 없습니다.') : wmT('이 노트에 하이라이트가 없습니다. 본문을 선택하고 우클릭 → 하이라이트하고 코멘트 달기.') });
		}
		// One swap, no empty frame in between.
		this.list.replaceChildren(...Array.from(fragment.childNodes));
		this.list.scrollTop = scroll;
	}
	private renderItem(parent: HTMLElement, card: HighlightCard, document: WritingDocument): void {
		const { highlight: h, thread: t } = card;
		if (!h && !t) return;
		const key = t?.id ?? `${document.path}:${h?.from}:${h?.text}`, status = cardStatus(card);
		const item = parent.createDiv({ cls: `wm-hlc-item is-${status ?? 'bare'}`, attr: { tabindex: '0', 'data-thread-id': t?.id ?? '' } });
		item.style.setProperty('--wm-hlc-color', highlightBackground(h?.color ?? t?.color));
		const refresh = () => this.update(true);
		// The list is not rebuilt for edits that leave the highlights unchanged, so
		// actions re-read the manuscript and find this highlight again by its thread
		// (or, without one, the same text nearest the old spot).
		const current = (): { source: string; highlight: SourceHighlight } => {
			const source = document.read(), result = this.plugin.highlightComments.resolve(document);
			const found = t ? result.anchors.find(a => a.threadId === t.id)?.highlight
				: h && result.highlights.filter(x => x.text === h.text).sort((a, b) => Math.abs(a.from - h.from) - Math.abs(b.from - h.from))[0];
			if (!found) throw new Error(wmT('원고가 변경되었습니다. 다시 시도해 주세요.'));
			return { source, highlight: found };
		};

		// Left: line number, and on hover the item's tools in the space below it.
		const gutter = item.createDiv({ cls: 'wm-hlc-gutter' });
		gutter.createDiv({ cls: 'wm-hlc-line', text: h ? wmT('{0}행', h.line) : wmT('사라짐') });
		const tools = gutter.createDiv({ cls: 'wm-hlc-tools' });
		const openReply = () => {
			this.replying = key; refresh();
			Array.from(this.list.querySelectorAll<HTMLElement>('.wm-hlc-composer')).find(el => el.dataset.key === key)?.querySelector('textarea')?.focus();
		};
		commentButton(tools, wmT('답글 추가'), openReply, 'message-square-plus');
		if (t) commentButton(tools, wmT('답글 전체 삭제'), () => confirmThreadDeletion(this.plugin, t, () => { this.plugin.highlightComments.deleteThread(t.id); refresh(); }), 'trash-2');
		if (h) commentButton(tools, wmT('하이라이트 취소'), () => this.act(() => { this.plugin.highlightComments.removeHighlight(document, current().highlight); refresh(); }), 'eraser');

		// Middle: the timeline node. With comments it is the done checkbox.
		const rail = item.createDiv({ cls: 'wm-hlc-rail' });
		const dot = rail.createEl('button', { cls: 'wm-hlc-dot', attr: { type: 'button' } });
		if (t && h) {
			dot.setAttribute('aria-label', t.status === 'done' ? wmT('미완료로') : wmT('완료'));
			dot.setAttribute('aria-pressed', String(t.status === 'done'));
			if (t.status === 'done') setIcon(dot, 'check');
			dot.onclick = event => { event.stopPropagation(); this.plugin.highlightComments.setStatus(t.id, t.status === 'done' ? 'open' : 'done'); refresh(); };
		} else {
			dot.disabled = true; dot.setAttribute('aria-hidden', 'true');
			// Removed from the manuscript: a question-mark circle (older Lucide names as fallback).
			if (!h) for (const name of ['circle-question-mark', 'circle-help', 'help-circle']) { setIcon(dot, name); if (dot.querySelector('svg')) break; }
		}

		// Right: the quote, its reply cards and the reply box.
		const body = item.createDiv({ cls: 'wm-hlc-body' });
		// The highlight colour is shown on the quote itself, as in the manuscript.
		matchText(body.createDiv({ cls: 'wm-hlc-quote' }).createSpan({ cls: 'wm-hlc-quote-mark' }), h?.text ?? t?.quote ?? '', this.filter.query);
		if (t?.comments.length) renderComments(this.plugin, body.createDiv({ cls: 'wm-hlc-thread' }), t, refresh, this.filter.query);
		if (this.replying === key || this.drafts.get(key)) {
			commentComposer(body, {
				key,
				value: this.drafts.get(key) ?? '',
				onInput: value => this.drafts.set(key, value),
				onCancel: () => { this.drafts.delete(key); this.replying = ''; refresh(); },
				onSubmit: value => this.act(() => {
					if (t) this.plugin.highlightComments.appendComment(t.id, value);
					else if (h) this.plugin.highlightComments.addComment(document.path, current().highlight, value);
					this.drafts.delete(key); this.replying = ''; refresh();
				}),
			});
		}
		if (h) {
			const navigate = () => this.act(() => { const { source, highlight } = current(); document.select(source, highlight.from, highlight.to); });
			item.onclick = event => { if (!(event.target as HTMLElement).closest('button, input, textarea, .wm-hlc-composer')) navigate(); };
			item.onkeydown = event => { if (event.target === item && event.key === 'Enter') navigate(); };
		}
	}
	private act(action: () => void): void { try { action(); } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); } }
}
