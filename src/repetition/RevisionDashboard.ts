import { Menu, setIcon } from 'obsidian';
import { PARAGRAPH_KINDS, PARAGRAPH_LABELS, type ParagraphKind, type ParagraphResult } from './ParagraphAnalysis';
import type { SentenceUnit } from './SentenceAnalysis';
import type { RepetitionKind, RepetitionResult } from './types';
import { repetitionExcerpt } from './RevisionExcerpt';
import { DONUT_RADII, donutSegmentPath } from './RevisionDonut';
import { chartAction, chartHints, chartShape, chartSvg, dismissChartHints, flowBins, lengthBins, niceMaximum } from './RevisionCharts';

export interface RevisionFile { path: string; source: string; paragraphs: ParagraphResult; sentences: SentenceUnit[]; repetition?: RepetitionResult }
interface State { files: RevisionFile[]; morph: boolean; busy: boolean; scope: 'document' | 'project'; title: string }
interface Actions { scope(value: State['scope']): void; refresh(): void; settings(): void; navigate(file: RevisionFile, from: number, to: number): void | Promise<void> }
interface Unit { file: RevisionFile; from: number; to: number; text: string; chars: number; kind: ParagraphKind }
interface Hit { file: RevisionFile; from: number; to: number }
interface Repeated { text: string; count: number; hits: Hit[] }
const KIND_LABELS: Record<RepetitionKind, string> = { word: '단어', eojeol: '어절', eomi: '어미' };

/** Presentation-only dashboard. The morphology engine and manuscript writes never run here. */
export class RevisionDashboard {
	private state: State = { files: [], morph: false, busy: false, scope: 'document', title: '' };
	private kind: RepetitionKind = 'word';
	private flowMode: 'cumulative' | 'interval' = 'cumulative';
	private selectedText: string | null = null;
	private selectedComposition: ParagraphKind | null = null;
	private detailsEl: HTMLElement | null = null;
	private expandedRanking = false;
	private observer: ResizeObserver | null = null;
	private frame = 0;
	private width = 0;
	private disposed = false;
	private progressEl: HTMLElement | null = null;
	constructor(private root: HTMLElement, private actions: Actions) {
		if (typeof ResizeObserver !== 'undefined') {
			this.observer = new ResizeObserver(entries => {
				const width = Math.round(entries[0]?.contentRect.width ?? 0);
				if (!width || width === this.width || this.disposed) return;
				this.width = width; cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => { if (!this.disposed) this.render(); });
			}); this.observer.observe(root);
		}
	}
	destroy(): void { this.disposed = true; this.observer?.disconnect(); cancelAnimationFrame(this.frame); dismissChartHints(this.root.ownerDocument); }
	update(state: State): void { this.state = state; if (!this.disposed) this.render(); }
	progress(text: string): void { this.progressEl?.setText(text); }
	private segment(parent: HTMLElement, values: Record<string, string>, value: string, label: string, change: (value: string) => void): void {
		const group = parent.createDiv({ cls: 'wm-dash-char-range-seg wm-analysis-segment', attr: { role: 'group', 'aria-label': label, 'data-analysis-segment': label } });
		const thumb = group.createSpan({ cls: 'wm-dash-char-range-thumb is-still', attr: { 'aria-hidden': 'true' } });
		for (const [key, text] of Object.entries(values)) {
			const button = group.createEl('button', { text, attr: { type: 'button', 'data-value': key, 'aria-pressed': String(key === value) } }); button.disabled = this.state.busy;
			button.onclick = () => {
				if (key === value) return; change(key);
				const updated = Array.from(this.root.querySelectorAll<HTMLElement>('.wm-analysis-segment')).find(group => group.dataset.analysisSegment === label);
				updated?.querySelector<HTMLButtonElement>(`button[data-value="${key}"]`)?.focus({ preventScroll: true });
			};
			if (key === value) thumb.setCssStyles({ width: `${button.offsetWidth}px`, height: `${button.offsetHeight}px`, transform: `translate(${button.offsetLeft}px, ${button.offsetTop}px)` });
		}
	}
	private icon(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
		const button = parent.createEl('button', { cls: 'wm-cal-icon-btn clickable-icon', attr: { type: 'button', 'aria-label': label } });
		setIcon(button, icon); button.onclick = action; return button;
	}
	private render(): void {
		this.stableLayout(() => {
			dismissChartHints(this.root.ownerDocument); this.root.empty(); this.renderToolbar();
			const tiles = this.root.createDiv({ cls: 'wm-revision-tiles wm-dash-char-hero' });
			this.renderLength(tiles, 'sentence'); this.renderLength(tiles, 'paragraph');
			this.renderComposition(tiles); this.renderFlow(tiles);
			const ranking = this.ranking(); this.renderRepetitions(tiles, ranking); this.renderDetails(tiles, ranking);
		});
	}
	private scrollPositions(): Array<{ element: HTMLElement; top: number; left: number; selector?: string }> {
		const positions: Array<{ element: HTMLElement; top: number; left: number; selector?: string }> = [];
		const grid = this.root.querySelector<HTMLElement>('.wm-revision-tiles');
		if (grid) positions.push({ element: grid, top: grid.scrollTop, left: grid.scrollLeft, selector: '.wm-revision-tiles' });
		for (let element: HTMLElement | null = this.root; element; element = element.parentElement) positions.push({ element, top: element.scrollTop, left: element.scrollLeft });
		return positions;
	}
	private restoreScroll(positions: ReturnType<RevisionDashboard['scrollPositions']>): void {
		for (const position of positions) {
			const element = position.selector ? this.root.querySelector<HTMLElement>(position.selector) : position.element;
			if (element?.isConnected) { element.scrollTop = position.top; element.scrollLeft = position.left; }
		}
	}
	private stableLayout(action: () => void): void {
		// Clearing the DOM used to collapse the scroll height and clamp the panel to zero.
		const positions = this.scrollPositions(), minHeight = this.root.style.minHeight;
		this.root.style.minHeight = `${Math.ceil(this.root.getBoundingClientRect().height)}px`;
		try { action(); } finally { this.root.style.minHeight = minHeight; this.restoreScroll(positions); }
	}
	private async navigate(file: RevisionFile, from: number, to: number): Promise<void> {
		const positions = this.scrollPositions();
		try { await this.actions.navigate(file, from, to); } finally { this.restoreScroll(positions); }
	}
	private renderToolbar(): void {
		const toolbar = this.root.createDiv({ cls: 'wm-dashboard-toolbar wm-revision-toolbar', attr: { 'aria-busy': String(this.state.busy) } });
		const scope = this.icon(toolbar, this.state.scope === 'document' ? 'file-text' : 'folder', '분석 범위: 현재 문서 또는 프로젝트 전체', () => {
			const menu = new Menu();
			for (const [key, label, icon] of [['document', '현재 문서', 'file-text'], ['project', '프로젝트 전체', 'folder']] as const) menu.addItem(item => item.setTitle(label).setIcon(icon).setChecked(this.state.scope === key).onClick(() => { this.selectedText = null; this.actions.scope(key); }));
			const bounds = scope.getBoundingClientRect(); menu.showAtPosition({ x: bounds.left, y: bounds.bottom + 4 });
		});
		scope.addClass('wm-revision-scope'); scope.setAttribute('aria-haspopup', 'menu'); scope.disabled = this.state.busy;
		toolbar.createSpan({ cls: 'wm-revision-title', text: this.state.title, attr: { title: this.state.title } });
		this.progressEl = toolbar.createSpan({ cls: 'wm-analysis-progress', text: this.state.busy ? '분석 중…' : '', attr: { role: 'status' } });
		const controls = toolbar.createDiv({ cls: 'wm-revision-toolbar-actions' });
		const refresh = this.icon(controls, 'refresh-cw', '재분석', this.actions.refresh); refresh.disabled = this.state.busy;
		this.icon(controls, 'settings', '분석 설정', this.actions.settings);
	}
	private card(parent: HTMLElement, title: string, modifier: string): { card: HTMLElement; header: HTMLElement } {
		const card = parent.createDiv({ cls: `wm-analysis-card wm-dash-char-main is-${modifier}` });
		return { card, header: this.heading(card, title) };
	}
	private heading(card: HTMLElement, title: string, marker = true): HTMLElement {
		const header = card.createDiv({ cls: 'wm-analysis-card-header wm-dash-group-hdr' });
		if (marker) header.createSpan({ cls: 'wm-dash-group-marker' }); header.createSpan({ cls: 'wm-dash-group-label', text: title }); return header;
	}
	private metric(card: HTMLElement, value: string, unit: string, description: string): HTMLElement {
		const metric = card.createDiv({ cls: 'wm-analysis-value wm-dash-char-hero-num' }); metric.createSpan({ text: value }); metric.createSpan({ cls: 'wm-analysis-value-unit', text: unit });
		return card.createDiv({ cls: 'wm-analysis-sub wm-dash-char-hero-line', text: description });
	}
	private units(type: 'sentence' | 'paragraph' = 'paragraph'): Unit[] {
		return this.state.files.flatMap(file => (type === 'sentence' ? file.sentences : file.paragraphs.units).map(unit => ({ file, ...unit })));
	}
	private renderLength(parent: HTMLElement, type: 'sentence' | 'paragraph'): void {
		const label = type === 'sentence' ? '문장' : '문단', units = this.units(type), { card } = this.card(parent, `평균 ${label} 길이`, type);
		const total = units.reduce((sum, unit) => sum + unit.chars, 0), min = units.length ? units.reduce((value, unit) => Math.min(value, unit.chars), Infinity) : 0;
		const max = units.reduce((value, unit) => Math.max(value, unit.chars), 0);
		const summary = this.metric(card, units.length ? (total / units.length).toFixed(1) : '0', '자', `${units.length.toLocaleString()}${label} · `);
		summary.createSpan({ cls: 'wm-analysis-stat is-max', text: `최대 ${max.toLocaleString()}자` }); summary.appendText(' · ');
		summary.createSpan({ cls: 'wm-analysis-stat is-min', text: `최소 ${min.toLocaleString()}자` });
		if (!units.length) { card.createDiv({ cls: 'wm-analysis-empty', text: '원고를 열면 길이 흐름을 표시합니다.' }); return; }
		const host = card.createDiv({ cls: 'wm-analysis-length-chart' }), hint = chartHints(host), width = Math.max(180, host.clientWidth), height = 110;
		const svg = chartSvg(host, `0 0 ${width} ${height}`, `${label} 순서별 글자 수`), bins = lengthBins(units), ceiling = Math.max(1, max);
		const step = width / bins.length, y = (value: number) => 96 - value / ceiling * 86, color = `var(--wm-analysis-${type})`;
		chartShape(svg, 'line', { x1: '0', x2: String(width), y1: '96', y2: '96', class: 'wm-analysis-grid-line' });
		bins.forEach((bin, index) => {
			const group = chartShape(svg, 'g', { class: 'wm-analysis-length-bar' });
			chartShape(group, 'rect', { x: String(index * step + step * 0.18), y: String(y(bin.mean)), width: String(step * 0.64), height: String(96 - y(bin.mean)), rx: '1' });
			chartShape(group, 'rect', { x: String(index * step), y: '0', width: String(step), height: '100', fill: 'transparent', class: 'wm-analysis-hit-area' });
			const range = `${bin.from + 1}${bin.to > bin.from + 1 ? `–${bin.to}` : ''}${label}`;
			chartAction(group, `${range} · 평균 ${bin.mean.toFixed(1)}자`, () => void this.navigate(bin.peak.file, bin.peak.from, bin.peak.to));
			hint(group, { title: range, rows: [{ label: '평균', value: `${bin.mean.toFixed(1)}자`, color }, { label: '최대', value: `${bin.max}자`, color }, { label: '최소', value: `${units.slice(bin.from, bin.to).reduce((value, unit) => Math.min(value, unit.chars), Infinity)}자`, color }] },
				{ svg, x: (index + .5) * step, top: 10, bottom: 96 });
		});
		let shortest = 0, longest = 0;
		units.forEach((unit, index) => { if (unit.chars < units[shortest].chars) shortest = index; if (unit.chars >= units[longest].chars) longest = index; });
		const minBin = bins.findIndex(bin => shortest >= bin.from && shortest < bin.to), maxBin = bins.findIndex(bin => longest >= bin.from && longest < bin.to);
		const together = minBin === maxBin, stagger = !together && Math.abs(maxBin - minBin) * step < 44;
		if (stagger) svg.setAttribute('viewBox', `0 0 ${width} 126`);
		for (const [name, index, row] of [['최소', minBin, 0], ['최대', maxBin, stagger ? 1 : 0]] as const) {
			if (together && name === '최대') continue;
			const center = (index + .5) * step, labelX = Math.max(16, Math.min(width - 16, center));
			const text = chartShape(svg, 'text', { x: String(labelX), y: String(109 + row * 16), 'text-anchor': 'middle', class: `wm-analysis-extreme-label is-${name === '최대' ? 'max' : 'min'}`, 'data-bin': String(index) });
			text.textContent = together ? '최소 · 최대' : name;
		}
	}
	private renderComposition(parent: HTMLElement): void {
		const { card } = this.card(parent, '구성 요소', 'composition'), units = this.units(); card.setAttribute('role', 'figure'); card.setAttribute('aria-label', '구성 요소 · 글자 수 비율');
		const order: ParagraphKind[] = ['narration', 'monologue', 'dialogue', 'special'];
		const counts = order.map(kind => { const matching = units.filter(unit => unit.kind === kind); return { kind, chars: matching.reduce((sum, unit) => sum + unit.chars, 0) }; });
		const total = counts.reduce((sum, row) => sum + row.chars, 0), dominant = [...counts].sort((a, b) => b.chars - a.chars)[0];
		const host = card.createDiv({ cls: 'wm-analysis-donut-host' }), svg = chartSvg(host, '0 0 220 220', '서술·독백·대사·특수 대사의 글자 수 비율');
		chartShape(svg, 'circle', { cx: '110', cy: '110', r: '78', fill: 'none', class: 'wm-analysis-donut-track' });
		const label = chartShape(svg, 'text', { x: '110', y: '87', 'text-anchor': 'middle', class: 'wm-analysis-donut-kind' });
		const value = chartShape(svg, 'text', { x: '110', y: '118', 'text-anchor': 'middle', class: 'wm-analysis-donut-value' });
		const chars = chartShape(svg, 'text', { x: '110', y: '143', 'text-anchor': 'middle', class: 'wm-analysis-donut-chars' });
		const arcs = new Map<ParagraphKind, { element: SVGPathElement; normal: string; selected: string }>();
		const select = (kind: ParagraphKind) => {
			const row = counts.find(row => row.kind === kind)!; this.selectedComposition = kind;
			dismissChartHints(this.root.ownerDocument);
			label.textContent = total ? PARAGRAPH_LABELS[kind] : ''; value.textContent = total ? `${(row.chars / total * 100).toFixed(1)}%` : '—'; chars.textContent = `${row.chars.toLocaleString()}자`;
			for (const [key, arc] of arcs) {
				const selected = key === kind;
				arc.element.classList.toggle('is-selected', selected); arc.element.setAttribute('aria-pressed', String(selected));
				arc.element.setAttribute('d', selected ? arc.selected : arc.normal);
			}
		};
		const legend = card.createDiv({ cls: 'wm-wt-chart-legend wm-analysis-donut-legend' }); let offset = 0;
		for (const row of counts) {
			const fraction = total ? row.chars / total : 0, description = `${PARAGRAPH_LABELS[row.kind]} · ${row.chars.toLocaleString()}자 · ${(fraction * 100).toFixed(1)}%`;
			if (row.chars) {
				const normal = donutSegmentPath(offset, offset + fraction, DONUT_RADII.outer), selected = donutSegmentPath(offset, offset + fraction, DONUT_RADII.selected);
				const arc = chartShape(svg, 'path', { d: normal, class: `wm-analysis-donut-segment is-${row.kind}`, role: 'button', tabindex: '0', 'aria-label': description });
				arcs.set(row.kind, { element: arc, normal, selected }); offset += fraction;
				arc.addEventListener('pointerenter', () => select(row.kind)); arc.addEventListener('focus', () => select(row.kind)); arc.addEventListener('click', () => select(row.kind));
				arc.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(row.kind); } });
			}
			const item = legend.createSpan({ cls: `is-${row.kind}` }); item.createSpan({ cls: 'wm-wt-chart-swatch' }).style.setProperty('--wm-wt-series', `var(--wm-analysis-${row.kind})`); item.appendText(PARAGRAPH_LABELS[row.kind]);
		}
		select(counts.find(row => row.kind === this.selectedComposition && row.chars > 0)?.kind ?? dominant.kind);
	}
	private ranking(): Repeated[] {
		const rows = new Map<string, Repeated>();
		for (const file of this.state.files) for (const entry of file.repetition?.[this.kind] ?? []) {
			const row = rows.get(entry.text) ?? { text: entry.text, count: 0, hits: [] };
			row.count += entry.count; row.hits.push(...entry.occurrences.map(hit => ({ file, from: hit.start, to: hit.end }))); rows.set(entry.text, row);
		}
		return [...rows.values()].filter(row => row.count >= 3).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'ko'));
	}
	private renderRepetitions(parent: HTMLElement, ranking: Repeated[]): void {
		const { card, header } = this.card(parent, '반복 표현', 'repetition');
		this.segment(header, KIND_LABELS, this.kind, '반복 표현 분류', value => { this.kind = value as RepetitionKind; this.selectedText = null; this.render(); });
		this.metric(card, ranking.length.toLocaleString(), '개', `${ranking.reduce((sum, row) => sum + row.count, 0).toLocaleString()}회 등장 · 3회 이상 반복된 ${KIND_LABELS[this.kind]}`);
		if (!ranking.length) { card.createDiv({ cls: 'wm-analysis-empty', text: this.state.morph ? '반복된 표현이 없습니다.' : '재분석을 눌러 반복 표현을 분석하세요. 데스크톱 엔진을 사용합니다.' }); return; }
		const ranked = ranking.slice(0, this.expandedRanking ? 30 : 10), host = card.createDiv({ cls: 'wm-analysis-views' }), hint = chartHints(host);
		const width = Math.max(220, host.clientWidth, ranked.length * 30), svg = chartSvg(host, `0 0 ${width} 140`, '반복 표현별 등장 횟수'); svg.style.minWidth = `${ranked.length * 30}px`;
		const step = width / ranked.length, max = ranked[0].count;
		ranked.forEach((row, index) => {
			const selected = this.selectedText === row.text;
			const group = chartShape(svg, 'g', { class: `wm-analysis-repeat-bar${selected ? ' is-selected' : ''}`, 'data-text': row.text, 'aria-pressed': String(selected) });
			const height = row.count / max * 96;
			chartShape(group, 'rect', { x: String(index * step + step * 0.2), y: String(110 - height), width: String(step * 0.6), height: String(height), rx: '1' });
			const count = chartShape(group, 'text', { x: String(index * step + step / 2), y: String(104 - height), 'text-anchor': 'middle', class: 'wm-analysis-chart-text' }); count.textContent = String(row.count);
			const label = chartShape(group, 'text', { x: String(index * step + step / 2), y: '132', 'text-anchor': 'middle', class: 'wm-analysis-chart-text' }); label.textContent = Array.from(row.text).length > 4 ? `${Array.from(row.text).slice(0, 3).join('')}…` : row.text;
			chartShape(group, 'rect', { x: String(index * step), y: '0', width: String(step), height: '140', fill: 'transparent', class: 'wm-analysis-hit-area' });
			const text = `${row.text}\n${row.count.toLocaleString()}회`;
			chartAction(group, text, () => this.selectRepetition(this.selectedText === row.text ? null : row.text, ranking));
			hint(group, { title: row.text, rows: [{ label: '등장', value: `${row.count.toLocaleString()}회` }] }, { svg, x: (index + .5) * step, top: 8, bottom: 110 });
		});
		const foot = card.createDiv({ cls: 'wm-analysis-footnote', text: '막대를 선택하면 반복 위치와 문맥을 표시합니다.' });
		if (ranking.length > 10) { const more = foot.createEl('button', { cls: 'wm-analysis-more', text: this.expandedRanking ? '간략히' : '상위 30개' }); more.onclick = () => { this.expandedRanking = !this.expandedRanking; this.render(); }; }
	}
	private renderDetails(parent: HTMLElement, ranking: Repeated[]): void {
		this.detailsEl = parent.createDiv({ cls: 'wm-analysis-card wm-dash-char-main is-details' });
		this.renderDetailContent(ranking);
	}
	private selectRepetition(text: string | null, ranking: Repeated[]): void {
		this.stableLayout(() => {
			this.selectedText = text;
			for (const bar of Array.from(this.root.querySelectorAll<SVGElement>('.wm-analysis-repeat-bar'))) {
				const selected = bar.dataset.text === text; bar.classList.toggle('is-selected', selected); bar.setAttribute('aria-pressed', String(selected));
			}
			this.renderDetailContent(ranking);
		});
	}
	private renderDetailContent(ranking: Repeated[]): void {
		const card = this.detailsEl; if (!card) return; card.empty();
		const repeated = ranking.find(row => row.text === this.selectedText);
		const header = this.heading(card, repeated ? `${repeated.text} · ${repeated.count.toLocaleString()}회` : '반복 표현 상세', false);
		if (!repeated) { this.selectedText = null; card.createDiv({ cls: 'wm-analysis-empty', text: '왼쪽 그래프에서 반복 표현을 선택하세요.' }); return; }
		this.icon(header, 'x', '상세 닫기', () => this.selectRepetition(null, ranking));
		const hits = repeated.hits, bins: Hit[][] = Array.from({ length: 20 }, () => []), offsets = new Map<string, number>(); let size = 0;
		for (const file of this.state.files) { offsets.set(file.path, size); size += file.source.length; }
		for (const hit of hits) bins[Math.min(19, Math.floor(((offsets.get(hit.file.path) ?? 0) + hit.from) / Math.max(1, size) * 20))].push(hit);
		const positions = card.createDiv({ cls: 'wm-analysis-position-bars' }), hint = chartHints(positions), max = Math.max(1, ...bins.map(bin => bin.length));
		bins.forEach((bin, index) => {
			const bar = positions.createEl('button', { attr: { 'aria-label': `${index * 5}–${(index + 1) * 5}% · ${bin.length}회` } });
			bar.disabled = !bin.length; bar.style.setProperty('--wm-chart-height', `${bin.length / max * 100}%`); bar.createSpan();
			bar.onclick = () => void this.navigate(bin[0].file, bin[0].from, bin[0].to);
			hint(bar, { title: `${index * 5}–${(index + 1) * 5}%`, rows: [{ label: repeated.text, value: `${bin.length}회` }] });
		});
		const list = card.createDiv({ cls: 'wm-analysis-details' }); let shown = 0;
		const more = () => {
			for (const [index, hit] of hits.slice(shown, shown + 40).entries()) {
				const row = list.createEl('button', { cls: 'wm-analysis-context' }); row.createSpan({ cls: 'wm-analysis-context-number', text: String(shown + index + 1) });
				const excerpt = repetitionExcerpt(hit.file.source, hit.from, hit.to), text = row.createDiv();
				text.appendText(`${excerpt.leading ? '…' : ''}${excerpt.before}`);
				text.createEl('mark', { text: excerpt.match }); text.appendText(`${excerpt.after}${excerpt.trailing ? '…' : ''}`);
				row.onclick = () => void this.navigate(hit.file, hit.from, hit.to);
			}
			shown += 40; if (shown < hits.length) { const next = list.createEl('button', { text: '더 보기' }); next.onclick = () => { next.remove(); more(); }; }
		}; more();
	}
	private renderFlow(parent: HTMLElement): void {
		const card = parent.createDiv({ cls: 'wm-analysis-card wm-dash-char-main is-flow wm-analysis-flow-card', attr: { role: 'figure', 'aria-label': '원고 흐름' } });
		const controls = card.createDiv({ cls: 'wm-analysis-flow-controls' });
		this.segment(controls, { cumulative: '누적', interval: '구간' }, this.flowMode, '원고 흐름 표시 방식', value => { this.flowMode = value as typeof this.flowMode; this.render(); });
		const units = this.units(), bins = flowBins(units);
		if (!bins.length) { card.createDiv({ cls: 'wm-analysis-empty', text: '원고를 분석하면 글자 수 흐름을 표시합니다.' }); return; }
		const host = card.createDiv({ cls: 'wm-analysis-flow-chart' }), hint = chartHints(host), width = Math.max(220, host.clientWidth), height = 240;
		const svg = chartSvg(host, `0 0 ${width} ${height}`, '원고 흐름에 따른 네 종류의 글자 수');
		const left = 48, right = width - 14, top = 16, bottom = height - 32;
		const max = niceMaximum(Math.max(0, ...bins.flatMap(bin => PARAGRAPH_KINDS.map(kind => bin[this.flowMode][kind]))));
		const x = (index: number) => left + index / Math.max(1, units.length) * (right - left), y = (value: number) => bottom - value / max * (bottom - top);
		for (let tick = 0; tick <= 4; tick++) {
			const value = max * tick / 4, at = y(value); chartShape(svg, 'line', { x1: String(left), x2: String(right), y1: String(at), y2: String(at), class: 'wm-analysis-grid-line' });
			const label = chartShape(svg, 'text', { x: String(left - 7), y: String(at + 4), 'text-anchor': 'end', class: 'wm-analysis-chart-text' }); label.textContent = value.toLocaleString('ko-KR', { maximumFractionDigits: max % 4 ? 2 : 0 });
		}
		for (let tick = 0; tick <= 4; tick++) { const label = chartShape(svg, 'text', { x: String(x(units.length * tick / 4)), y: String(height - 10), 'text-anchor': tick === 0 ? 'start' : tick === 4 ? 'end' : 'middle', class: 'wm-analysis-chart-text' }); label.textContent = `${tick * 25}%`; }
		const boundaries = units.flatMap((unit, index) => index > 0 && unit.file.path !== units[index - 1].file.path ? [index] : []), boundaryStep = Math.max(1, Math.ceil(boundaries.length / 32));
		for (const index of boundaries.filter((_, at) => at % boundaryStep === 0)) chartShape(svg, 'line', { x1: String(x(index)), x2: String(x(index)), y1: String(top), y2: String(bottom), class: 'wm-analysis-file-boundary' });
		for (const kind of PARAGRAPH_KINDS) {
			const points = bins.map(bin => `${x(bin.to)},${y(bin[this.flowMode][kind])}`); if (this.flowMode === 'cumulative') points.unshift(`${x(0)},${y(0)}`);
			chartShape(svg, 'polyline', { points: points.join(' '), fill: 'none', class: `wm-analysis-flow-line is-${kind}` });
			chartShape(svg, 'circle', { cx: String(x(units.length)), cy: String(y(bins[bins.length - 1][this.flowMode][kind])), r: '3', class: `wm-analysis-flow-end is-${kind}` });
		}
		for (const bin of bins) {
			const target = chartShape(svg, 'rect', { x: String(x(bin.from)), y: String(top), width: String(Math.max(2, x(bin.to) - x(bin.from))), height: String(bottom - top), fill: 'transparent', class: 'wm-analysis-flow-hit' });
			const first = units[bin.from], values = bin[this.flowMode], title = `${(bin.to / units.length * 100).toFixed(1)}% · ${bin.from + 1}${bin.to > bin.from + 1 ? `–${bin.to}` : ''}문단`;
			chartAction(target, title, () => void this.navigate(first.file, first.from, first.to));
			hint(target, { title, rows: PARAGRAPH_KINDS.map(kind => ({ label: PARAGRAPH_LABELS[kind], value: `${values[kind].toLocaleString()}자`, color: `var(--wm-analysis-${kind})` })), total: { label: '합계', value: `${PARAGRAPH_KINDS.reduce((sum, kind) => sum + values[kind], 0).toLocaleString()}자` } },
				{ svg, x: x(bin.to), top, bottom });
		}
	}
}
