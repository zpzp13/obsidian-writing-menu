import { colorClass } from './palette';

export interface DonutSegment {
	label: string;
	value: number;
	/** true면 "기타" 취급 — 별도 색 클래스(wm-rep-color-other) 사용, 막대에서는 채움 없이 표시 */
	isOther?: boolean;
}

export interface DonutChartOptions {
	centerValue: string;
}

/**
 * container(또는 조상)에 지정된 --wm-rep-donut-gap(도넛 세그먼트 사이 여백, path 단위)을 읽는다.
 * stroke-linecap:round는 각 세그먼트 끝을 strokeWidth/2만큼 더 늘려 그리므로, gap이 strokeWidth보다
 * 작으면 인접 세그먼트의 둥근 끝이 서로 겹쳐 이가 빠진 것처럼 보인다. 기본값은 그걸 피할 만큼 크게 잡는다.
 */
function readGapVar(container: HTMLElement): number {
	const raw = getComputedStyle(container).getPropertyValue('--wm-rep-donut-gap').trim();
	const n = parseFloat(raw);
	return Number.isFinite(n) ? n : 20;
}

/** 전체원 도넛 + 중앙 값 + 하단 범례(색 점 + 라벨 + 값). 색상은 전부 CSS 클래스로 지정해 개발자 도구에서 바로 보인다. */
export function renderDonutChart(container: HTMLElement, segments: DonutSegment[], options: DonutChartOptions): void {
	const total = segments.reduce((sum, s) => sum + s.value, 0);
	const wrap = container.createDiv({ cls: 'wm-rep-donut-wrap' });
	const gap = readGapVar(container);

	const size = 140;
	const radius = 56;
	const strokeWidth = 14;
	const circumference = 2 * Math.PI * radius;
	const cx = size / 2;
	const cy = size / 2;

	const svgNs = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(svgNs, 'svg');
	svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
	svg.addClass('wm-rep-donut-svg');

	const bg = document.createElementNS(svgNs, 'circle');
	bg.setAttribute('cx', String(cx));
	bg.setAttribute('cy', String(cy));
	bg.setAttribute('r', String(radius));
	bg.setAttribute('fill', 'none');
	bg.addClass('wm-rep-donut-track');
	bg.setAttribute('stroke-width', String(strokeWidth));
	svg.appendChild(bg);

	let offset = 0;
	segments.forEach((seg, i) => {
		if (total <= 0) return;
		const frac = seg.value / total;
		const dash = frac * circumference;
		const circle = document.createElementNS(svgNs, 'circle');
		circle.setAttribute('cx', String(cx));
		circle.setAttribute('cy', String(cy));
		circle.setAttribute('r', String(radius));
		circle.setAttribute('fill', 'none');
		circle.addClass('wm-rep-donut-seg', colorClass(i, seg.isOther));
		circle.setAttribute('stroke-width', String(strokeWidth));
		circle.setAttribute('stroke-linecap', 'round');
		circle.setAttribute('stroke-dasharray', `${Math.max(0, dash - gap)} ${circumference - dash + gap}`);
		circle.setAttribute('stroke-dashoffset', String(-offset));
		circle.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
		svg.appendChild(circle);
		offset += dash;
	});

	const svgWrap = wrap.createDiv({ cls: 'wm-rep-donut-svg-wrap' });
	svgWrap.appendChild(svg);
	const center = svgWrap.createDiv({ cls: 'wm-rep-donut-center' });
	center.style.top = `${(cy / size) * 100}%`;
	center.createDiv({ cls: 'wm-rep-donut-center-value', text: options.centerValue });

	const legend = container.createDiv({ cls: 'wm-rep-donut-legend' });
	segments.forEach((seg, i) => {
		const row = legend.createDiv({ cls: 'wm-rep-donut-legend-row' });
		row.createSpan({ cls: ['wm-rep-donut-dot', colorClass(i, seg.isOther)] });
		row.createSpan({ cls: 'wm-rep-donut-legend-label', text: seg.label });
		row.createSpan({ cls: 'wm-rep-donut-legend-value', text: String(seg.value) });
	});
}

/** 상위 N개 + 나머지는 "기타"로 묶어 세그먼트 생성 (도넛/막대그래프 공용) */
export function buildTopSegments(entries: { stem: string; localCount: number }[], topN = 4): DonutSegment[] {
	const sorted = [...entries].sort((a, b) => b.localCount - a.localCount);
	const top: DonutSegment[] = sorted.slice(0, topN).map(e => ({ label: e.stem, value: e.localCount }));
	const restTotal = sorted.slice(topN).reduce((sum, e) => sum + e.localCount, 0);
	if (restTotal > 0) top.push({ label: '기타', value: restTotal, isOther: true });
	return top;
}

/**
 * 두꺼운 가로 막대그래프 — 배지 없이 막대 + 라벨/값 텍스트만. 색상은 CSS 클래스로 지정.
 * "기타" 세그먼트는 값은 표시하되 채움 막대는 그리지 않고, 나머지 막대의 비율 계산(max)에도 포함하지 않는다.
 */
export function renderBarChart(container: HTMLElement, segments: DonutSegment[]): void {
	const normal = segments.filter(s => !s.isOther);
	const max = Math.max(1, ...normal.map(s => s.value));
	const wrap = container.createDiv({ cls: 'wm-rep-bar-list' });
	let normalIdx = 0;
	segments.forEach(s => {
		const row = wrap.createDiv({ cls: 'wm-rep-bar-row' });
		const track = row.createDiv({ cls: 'wm-rep-bar-track' + (s.isOther ? ' wm-rep-bar-track-other' : '') });
		if (!s.isOther) {
			// 개수가 많을수록 진한 레벨: 순위 1위(index 0)가 가장 진한 색을 받도록 뒤집는다
			const level = normal.length - 1 - normalIdx;
			const fill = track.createDiv({ cls: ['wm-rep-bar-fill', colorClass(level, false)] });
			fill.style.setProperty('--wm-rep-bar-width', `${s.value > 0 ? Math.max(6, (s.value / max) * 100) : 0}%`);
			normalIdx++;
			// 라벨을 fill 내부에 둬서 fill 폭을 벗어나면 말줄임(...)되게 한다
			const labelRow = fill.createDiv({ cls: 'wm-rep-bar-label-row' });
			labelRow.createSpan({ cls: 'wm-rep-bar-label', text: s.label });
		} else {
			const labelRow = track.createDiv({ cls: 'wm-rep-bar-label-row' });
			labelRow.createSpan({ cls: 'wm-rep-bar-label', text: s.label });
		}
		row.createSpan({ cls: 'wm-rep-bar-count', text: `${s.value}회` });
	});
}
