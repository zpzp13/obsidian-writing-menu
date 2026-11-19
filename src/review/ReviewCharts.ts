import { sanitizeHTMLToDom } from 'obsidian';
import { wmT } from '../i18n/index';
import { chartHints, chartShape, chartSvg } from '../repetition/RevisionCharts';
import type { MunpiaChapter } from './munpia';
import type { Theme } from './commentDigest';

const W = 320, PER_CHAPTER = 9, SCROLL_FROM = 48;
const percent = (value: number) => `${Math.round(value * 100)}%`;
let gradients = 0;

/** A bar whose data end is rounded and whose baseline end is square. */
function bar(x: number, width: number, base: number, top: number): string {
	const r = Math.min(2, width / 2, base - top);
	return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${base}Z`;
}

/** Legend glyphs that look like the marks: a line through a point, and rising bars. */
const LINE_GLYPH = '<svg viewBox="0 0 18 12" aria-hidden="true"><path d="M1 9 6 5l4 2 7-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BAR_GLYPH = '<svg viewBox="0 0 16 12" aria-hidden="true"><rect x="1" y="6" width="3.5" height="6" rx="1" fill="currentColor"/><rect x="6.25" y="3" width="3.5" height="9" rx="1" fill="currentColor"/><rect x="11.5" y="0" width="3.5" height="12" rx="1" fill="currentColor"/></svg>';

/**
 * Retention against the base chapter as the line, views as faint bars behind
 * it. No axis labels: the hover card has every value of the chapter (views,
 * likes, comments, preference).
 */
export function renderChapterChart(parent: HTMLElement, chapters: MunpiaChapter[], current: number, base: number, preferenceAt?: (chapter: MunpiaChapter) => number | null): void {
	const origin = chapters.find(chapter => chapter.num === base);
	const points = chapters.filter(chapter => chapter.num >= base);
	if (!origin || origin.views <= 0 || points.length < 2) return;
	const ratio = (chapter: MunpiaChapter) => chapter.views / origin.views;
	// Long runs get a fixed width per chapter and scroll sideways (the hover card follows the scroll).
	const scroll = points.length > SCROLL_FROM, width = scroll ? points.length * PER_CHAPTER + 8 : W;
	const host = parent.createDiv({ cls: `wm-rv-chart-host${scroll ? ' is-scroll' : ''}` }), hint = chartHints(host);
	const H = 196, left = 4, right = width - 4, top = 10, bottom = H - 22;
	const step = (right - left) / points.length, cx = (index: number) => left + step * (index + 0.5);
	const tick = Math.max(10, Math.ceil(Math.max(...points.map(ratio)) * 100 / 4 / 10) * 10), ceiling = tick * 4 / 100;
	const y = (value: number) => bottom - Math.min(value, ceiling) / ceiling * (bottom - top);
	const svg = chartSvg(host, `0 0 ${width} ${H}`, wmT('{0}화 대비 연독률과 회차 지표', base));
	const id = `wm-rv-area-${++gradients}`;
	const gradient = chartShape(chartShape(svg, 'defs', {}), 'linearGradient', { id, x1: '0', x2: '0', y1: '0', y2: '1' });
	chartShape(gradient, 'stop', { offset: '0%', class: 'wm-rv-area-top' });
	chartShape(gradient, 'stop', { offset: '100%', class: 'wm-rv-area-bottom' });
	const paidFrom = points.findIndex(chapter => !chapter.free);
	if (paidFrom > 0) {
		chartShape(svg, 'rect', { x: String(left + step * paidFrom), y: String(top), width: String(right - left - step * paidFrom), height: String(bottom - top), class: 'wm-rv-paid-zone' });
		const label = chartShape(svg, 'text', { x: String(right - 2), y: String(top + 10), 'text-anchor': 'end', class: 'wm-rv-axis-label' }); label.textContent = wmT('유료');
	}
	for (let level = 0; level <= 4; level++) {
		const value = ceiling * level / 4;
		chartShape(svg, 'line', { x1: String(left), x2: String(right), y1: String(y(value)), y2: String(y(value)), class: level ? 'wm-rv-grid-dash' : 'wm-rv-grid-base' });
	}
	// Views as bars behind the line, scaled to the busiest chapter (lower half of the plot).
	const maxViews = Math.max(1, ...points.map(chapter => chapter.views));
	const barArea = (bottom - top) * 0.55, barWidth = Math.max(1.5, step * 0.62);
	points.forEach((chapter, index) => {
		if (!chapter.views) return;
		const height = Math.max(1, chapter.views / maxViews * barArea);
		chartShape(svg, 'path', { d: bar(cx(index) - barWidth / 2, barWidth, bottom, bottom - height), class: `wm-rv-bar${chapter.num === current ? ' is-current' : ''}` });
	});
	const line = points.map((chapter, index) => `${index ? 'L' : 'M'}${cx(index).toFixed(1)},${y(ratio(chapter)).toFixed(1)}`).join('');
	chartShape(svg, 'path', { d: `${line}L${cx(points.length - 1)},${bottom}L${cx(0)},${bottom}Z`, fill: `url(#${id})`, class: 'wm-rv-area' });
	// A halo in the background colour keeps the line legible over the bars.
	chartShape(svg, 'path', { d: line, class: 'wm-rv-line-halo' });
	chartShape(svg, 'path', { d: line, class: 'wm-rv-line' });
	const at = points.findIndex(chapter => chapter.num === current);
	if (at >= 0) chartShape(svg, 'circle', { cx: String(cx(at)), cy: String(y(ratio(points[at]))), r: '4.5', class: 'wm-rv-marker' });
	const every = scroll ? (points.length > 300 ? 20 : points.length > 150 ? 10 : 5) : Math.max(1, Math.ceil((points.length - 1) / 4));
	points.forEach((chapter, index) => {
		if (scroll ? chapter.num % every && index !== 0 : index % every && index !== points.length - 1) return;
		// The base chapter is always labelled; a round-number label right next to it would overlap, so skip it.
		if (scroll && index > 0 && index < Math.ceil(every * 0.6)) return;
		// Likewise the last chapter is always labelled in the fixed-width chart; skip a regular label crowding it.
		if (!scroll && index !== points.length - 1 && points.length - 1 - index < Math.ceil(every * 0.6)) return;
		const label = chartShape(svg, 'text', { x: String(cx(index)), y: String(H - 6), 'text-anchor': 'middle', class: 'wm-rv-axis-label' }); label.textContent = wmT('{0}화', chapter.num);
	});
	points.forEach((chapter, index) => {
		const hit = chartShape(svg, 'rect', { x: String(left + step * index), y: '0', width: String(step), height: String(H), class: 'wm-rv-hit', tabindex: '0' });
		const preference = preferenceAt?.(chapter) ?? null;
		hint(hit, { title: wmT('{0}화 · {1}', chapter.num, chapter.title), rows: [
			{ label: wmT('연독률'), value: percent(ratio(chapter)), color: 'var(--wm-rv-line)' },
			...(preference !== null ? [{ label: wmT('선호작 (24시간)'), value: `${preference >= 0 ? '+' : ''}${preference.toLocaleString()}` }] : []),
			{ label: wmT('조회수'), value: chapter.views.toLocaleString(), color: 'var(--wm-rv-views)' },
			{ label: wmT('추천'), value: chapter.likes.toLocaleString(), color: 'var(--wm-rv-likes)' },
			{ label: wmT('댓글'), value: chapter.comments.toLocaleString(), color: 'var(--wm-rv-comments)' },
		] }, { svg, x: cx(index), top, bottom });
	});
	if (scroll) {
		host.setCssProps({ '--wm-rv-chart-width': `${width}px` });
		// Open on the current chapter.
		const focus = at >= 0 ? cx(at) : right;
		window.requestAnimationFrame(() => { host.scrollLeft = Math.max(0, focus - host.clientWidth / 2); });
	}
	const legend = parent.createDiv({ cls: 'wm-rv-legend wm-rv-chart-legend' });
	for (const [label, glyph, tone] of [[wmT('연독률'), LINE_GLYPH, 'is-line'], [wmT('조회수'), BAR_GLYPH, 'is-views']] as const) {
		const item = legend.createSpan({ cls: 'wm-rv-legend-item' });
		item.createSpan({ cls: `wm-rv-legend-glyph ${tone}` }).appendChild(sanitizeHTMLToDom(glyph));
		item.appendText(label);
	}
}

/** Comment themes as ranked horizontal bars (count); the tone colour matches the 긍정/혼합/부정 cards above. */
export function renderThemes(parent: HTMLElement, themes: Theme[]): void {
	const max = Math.max(1, ...themes.map(theme => theme.count));
	const list = parent.createDiv({ cls: 'wm-rv-themes' });
	for (const theme of themes) {
		const row = list.createDiv({ cls: `wm-rv-theme is-${theme.tone}` });
		const name = row.createDiv({ cls: 'wm-rv-theme-name' });
		name.createSpan({ cls: `wm-rv-tone is-${theme.tone}` }); name.createSpan({ text: theme.label });
		row.createDiv({ cls: 'wm-rv-theme-track' }).createDiv({ cls: 'wm-rv-theme-fill' }).setCssProps({ '--wm-rv-share': `${theme.count / max * 100}%` });
		row.createSpan({ cls: 'wm-rv-theme-count', text: String(theme.count) });
	}
}
