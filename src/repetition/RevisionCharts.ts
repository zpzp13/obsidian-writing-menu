import type { ParagraphKind } from './ParagraphAnalysis';

/** Bounded, deterministic chart aggregation. No source paragraphs are discarded from details. */
export function lengthBuckets<T extends { chars: number }>(items: T[]): Array<{ label: string; items: T[] }> {
	const bounds = [40, 80, 160, 320, Infinity];
	const buckets = ['1–40자', '41–80자', '81–160자', '161–320자', '321자+'].map(label => ({ label, items: [] as T[] }));
	for (const item of items) buckets[bounds.findIndex(bound => item.chars <= bound)].items.push(item);
	return buckets;
}

export function rhythmBins<T extends { chars: number }>(items: T[], limit = 100): Array<{ from: number; to: number; mean: number; max: number; peak: T }> {
	if (!items.length) return [];
	const size = Math.ceil(items.length / Math.max(1, limit)), bins = [];
	for (let from = 0; from < items.length; from += size) {
		const chunk = items.slice(from, from + size), peak = chunk.reduce((longest, item) => item.chars > longest.chars ? item : longest);
		bins.push({ from, to: from + chunk.length, mean: chunk.reduce((sum, item) => sum + item.chars, 0) / chunk.length, max: peak.chars, peak });
	}
	return bins;
}

/** Keep the actual shortest/longest items as their own bars, never hidden by an average. */
export function lengthBins<T extends { chars: number }>(items: T[], limit = 28): ReturnType<typeof rhythmBins<T>> {
	if (!items.length) return [];
	let shortest = 0, longest = 0;
	items.forEach((item, index) => { if (item.chars < items[shortest].chars) shortest = index; if (item.chars >= items[longest].chars) longest = index; });
	const edges = new Set([0, items.length, shortest, shortest + 1, longest, longest + 1]);
	for (const bin of rhythmBins(items, limit)) edges.add(bin.from);
	const sorted = [...edges].sort((a, b) => a - b);
	return sorted.slice(0, -1).map((from, index) => {
		const to = sorted[index + 1], chunk = items.slice(from, to), peak = chunk.reduce((a, b) => a.chars > b.chars ? a : b);
		return { from, to, mean: chunk.reduce((sum, item) => sum + item.chars, 0) / chunk.length, max: peak.chars, peak };
	});
}

export type FlowValues = Record<ParagraphKind, number>;
export function flowBins<T extends { chars: number; kind: ParagraphKind }>(items: T[], limit = 120): Array<{ from: number; to: number; cumulative: FlowValues; interval: FlowValues }> {
	const total: FlowValues = { narration: 0, dialogue: 0, monologue: 0, special: 0 }, bins = [];
	const size = Math.max(1, Math.ceil(items.length / Math.max(1, limit)));
	for (let from = 0; from < items.length; from += size) {
		const interval: FlowValues = { narration: 0, dialogue: 0, monologue: 0, special: 0 }, to = Math.min(items.length, from + size);
		for (let index = from; index < to; index++) { const item = items[index]; interval[item.kind] += item.chars; total[item.kind] += item.chars; }
		bins.push({ from, to, interval, cumulative: { ...total } });
	}
	return bins;
}

export function niceMaximum(value: number): number {
	if (value <= 0) return 1;
	if (value <= 4) return Math.ceil(value);
	// Fine steps with a little breathing room, rather than jumping from e.g. 129 to 200.
	const step = Math.max(1, 10 ** (Math.floor(Math.log10(value)) - 1));
	return Math.ceil(value * 1.04 / step) * step;
}

export interface ChartHint {
	title: string;
	rows: Array<{ label: string; value: string; color?: string }>;
	total?: { label: string; value: string };
}
export interface ChartGuide { svg: SVGSVGElement; x: number; top: number; bottom: number }
const visibleHints = new WeakMap<Document, () => void>();
export function dismissChartHints(document: Document): void { visibleHints.get(document)?.(); }

/** Working-time preview styling, one active preview, and an optional vertical interval guide. */
export function chartHints(host: HTMLElement): (target: Element, content: ChartHint, guide?: ChartGuide) => void {
	host.classList.add('wm-analysis-chart-host');
	const tooltip = host.createDiv({ cls: 'wm-wt-chart-tooltip wm-analysis-chart-tooltip', attr: { role: 'tooltip' } }); tooltip.hidden = true;
	let active: Element | null = null, svgGuide: SVGLineElement | null = null, htmlGuide: HTMLElement | null = null;
	const hide = () => {
		tooltip.hidden = true; tooltip.classList.remove('is-visible'); active = null;
		if (svgGuide) svgGuide.style.display = 'none'; if (htmlGuide) htmlGuide.hidden = true;
		if (visibleHints.get(host.ownerDocument) === hide) visibleHints.delete(host.ownerDocument);
	};
	return (target, content, guide) => {
		for (const child of Array.from(target.children)) if (child.tagName.toLowerCase() === 'title') child.remove();
		target.removeAttribute('title');
		const show = () => {
			visibleHints.get(host.ownerDocument)?.(); active = target;
			tooltip.empty(); tooltip.createDiv({ cls: 'wm-wt-chart-tooltip-date', text: content.title });
			for (const item of content.rows) {
				const row = tooltip.createDiv({ cls: 'wm-wt-chart-tooltip-row' });
				row.createSpan({ cls: 'wm-wt-chart-swatch' }).style.setProperty('--wm-wt-series', item.color ?? 'var(--wm-analysis-repeat)');
				row.createSpan({ text: item.label }); row.createEl('b', { text: item.value });
			}
			if (content.total) { const row = tooltip.createDiv({ cls: 'wm-wt-chart-tooltip-total' }); row.createSpan({ text: content.total.label }); row.createEl('b', { text: content.total.value }); }
			tooltip.hidden = false; tooltip.classList.add('is-visible');
			const bounds = host.getBoundingClientRect(), point = target.getBoundingClientRect(), x = point.left + point.width / 2 - bounds.left;
			const left = x > bounds.width * .62 ? x - tooltip.offsetWidth - 10 : x + 10;
			tooltip.style.left = `${host.scrollLeft + Math.max(4, Math.min(bounds.width - tooltip.offsetWidth - 4, left))}px`;
			if (guide) {
				if (!svgGuide) svgGuide = chartShape(guide.svg, 'line', { class: 'wm-analysis-hover-line' });
				for (const [key, value] of Object.entries({ x1: guide.x, x2: guide.x, y1: guide.top, y2: guide.bottom })) svgGuide.setAttribute(key, String(value));
				guide.svg.appendChild(svgGuide); svgGuide.style.display = '';
			} else if (target.tagName.toLowerCase() === 'button') {
				if (!htmlGuide) htmlGuide = host.createDiv({ cls: 'wm-analysis-hover-line-html', attr: { 'aria-hidden': 'true' } });
				htmlGuide.style.left = `${host.scrollLeft + x}px`; htmlGuide.hidden = false;
			}
			visibleHints.set(host.ownerDocument, hide);
		};
		const leave = () => { if (active === target) hide(); };
		target.addEventListener('pointerenter', show); target.addEventListener('pointerleave', leave);
		target.addEventListener('focus', show); target.addEventListener('blur', leave);
	};
}

export function chartSvg(parent: HTMLElement, viewBox: string, label: string): SVGSVGElement {
	const svg = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', viewBox); svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', label); parent.appendChild(svg); return svg;
}

export function chartShape<K extends keyof SVGElementTagNameMap>(svg: SVGElement, tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
	const shape = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', tag);
	for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
	svg.appendChild(shape); return shape;
}

export function chartAction(element: SVGElement, label: string, action: () => void): void {
	element.setAttribute('role', 'button'); element.setAttribute('tabindex', '0'); element.setAttribute('aria-label', label);
	const title = chartShape(element, 'title', {}); title.textContent = label;
	element.addEventListener('click', action);
	element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); } });
}
