import type { TimeModeConfig } from '../types';
import { fmtTimeFull } from '../utils/timeUtils';

export type DailyModeTime = {
	date: string;
	values: Record<string, number>;
};

type ChartSeries = {
	labels: string[];
	values: number[][];
	totals: number[];
	average: Array<number | null>;
	max: number;
};

const SERIES_COUNT = 7;

export class WritingTimeChart {
	private readonly card: HTMLElement;
	private readonly canvas: HTMLCanvasElement;
	private readonly tooltip: HTMLElement;
	private readonly resizeObserver: ResizeObserver;
	private history: DailyModeTime[] = [];
	private live: Record<string, number> = {};
	private frame = 0;
	private animationStarted = 0;
	private readonly animationDuration = 950;
	private hoverIndex: number | null = null;

	constructor(container: HTMLElement, private readonly modes: TimeModeConfig[]) {
		this.card = container.createEl('section', { cls: 'wm-wt-chart-card wm-wt-rv' });
		this.card.createEl('h2', { text: '일별 작업시간' });
		const legend = this.card.createDiv({ cls: 'wm-wt-chart-legend' });
		modes.forEach((mode, index) => {
			const item = legend.createSpan();
			item.createSpan({ cls: 'wm-wt-chart-swatch' })
				.style.setProperty('--wm-wt-series', `var(--wm-wt-series-${index % SERIES_COUNT + 1})`);
			item.appendText(mode.label);
		});
		const averageLegend = legend.createSpan();
		averageLegend.createSpan({ cls: 'wm-wt-chart-average-key' });
		averageLegend.appendText('7일 평균');

		const box = this.card.createDiv({ cls: 'wm-wt-chart-box' });
		this.canvas = box.createEl('canvas', { attr: { role: 'img', 'aria-label': '최근 30일 일별 작업시간 그래프' } });
		this.tooltip = box.createDiv({ cls: 'wm-wt-chart-tooltip' });
		this.canvas.addEventListener('pointermove', this.onPointerMove);
		this.canvas.addEventListener('pointerleave', this.onPointerLeave);
		this.resizeObserver = new ResizeObserver(() => this.scheduleDraw(false));
		this.resizeObserver.observe(box);
		window.requestAnimationFrame(() => this.card.addClass('is-in'));
	}

	setHistory(history: DailyModeTime[], live: Record<string, number>): void {
		this.history = history;
		this.live = live;
		this.animationStarted = performance.now();
		this.scheduleDraw(true);
	}

	setLive(live: Record<string, number>): void {
		this.live = live;
		this.scheduleDraw(false);
	}

	destroy(): void {
		window.cancelAnimationFrame(this.frame);
		this.resizeObserver.disconnect();
		this.canvas.removeEventListener('pointermove', this.onPointerMove);
		this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
	}

	private colors(): string[] {
		const css = getComputedStyle(this.card);
		return Array.from({ length: SERIES_COUNT }, (_, index) =>
			css.getPropertyValue(`--wm-wt-series-${index + 1}`).trim() || '#fe647d');
	}

	private scheduleDraw(animate: boolean): void {
		window.cancelAnimationFrame(this.frame);
		if (!animate) this.animationStarted = 0;
		this.frame = window.requestAnimationFrame(now => this.draw(now));
	}

	private series(): ChartSeries {
		const labels = this.history.map(row => row.date);
		const values = this.modes.map(mode => this.history.map((row, dayIndex) => {
			const pending = dayIndex === this.history.length - 1 ? Math.max(0, this.live[mode.id] ?? 0) : 0;
			return Math.max(0, row.values[mode.id] ?? 0) + pending;
		}));
		const totals = labels.map((_, dayIndex) => values.reduce((sum, mode) => sum + (mode[dayIndex] ?? 0), 0));
		const average = totals.map((_, index) => {
			if (index < 2) return null;
			const windowValues = totals.slice(Math.max(0, index - 6), index + 1);
			return windowValues.reduce((sum, value) => sum + value, 0) / windowValues.length;
		});
		return {
			labels,
			values,
			totals,
			average,
			max: Math.max(1, ...totals, ...average.filter((value): value is number => value !== null)),
		};
	}

	private draw(now: number): void {
		const rect = this.canvas.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) return;
		const ratio = Math.max(1, window.devicePixelRatio || 1);
		const width = Math.round(rect.width * ratio);
		const height = Math.round(rect.height * ratio);
		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}
		const ctx = this.canvas.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.clearRect(0, 0, rect.width, rect.height);

		const series = this.series();
		if (series.labels.length < 2) return;
		const css = getComputedStyle(this.card);
		const ink2 = css.getPropertyValue('--wm-dash-ink-2').trim() || '#aaa';
		const ink3 = css.getPropertyValue('--wm-dash-ink-3').trim() || '#888';
		const grid = css.getPropertyValue('--wm-dash-grid').trim() || '#333';
		const page = css.getPropertyValue('--wm-dash-page').trim() || '#111';
		const colors = this.colors();
		const pad = { left: 45, right: 10, top: 12, bottom: 25 };
		const plotW = Math.max(1, rect.width - pad.left - pad.right);
		const plotH = Math.max(1, rect.height - pad.top - pad.bottom);
		const slot = plotW / series.labels.length;
		const barW = Math.max(2, Math.min(22, slot * .72));
		const xAt = (index: number) => pad.left + slot * (index + .5);
		const yAt = (value: number) => pad.top + plotH - value / series.max * plotH;

		ctx.font = `10px ${css.fontFamily}`;
		ctx.textBaseline = 'middle';
		for (let tick = 0; tick <= 3; tick++) {
			const value = series.max * tick / 3;
			const y = yAt(value);
			ctx.strokeStyle = grid;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(pad.left, y);
			ctx.lineTo(pad.left + plotW, y);
			ctx.stroke();
			ctx.fillStyle = ink3;
			ctx.textAlign = 'right';
			ctx.fillText(this.axisTime(value), pad.left - 7, y);
		}

		const elapsed = this.animationStarted ? now - this.animationStarted : this.animationDuration + 420;
		series.labels.forEach((_, dayIndex) => {
			const delayed = Math.max(0, elapsed - Math.min(dayIndex * 16, 420));
			const rawProgress = Math.min(1, delayed / Math.max(1, this.animationDuration - 300));
			const progress = 1 - Math.pow(1 - rawProgress, 4);
			let bottom = 0;
			series.values.forEach((modeValues, modeIndex) => {
				const value = modeValues[dayIndex] ?? 0;
				if (value <= 0) return;
				const top = bottom + value * progress;
				const y = yAt(top);
				const h = Math.max(0, yAt(bottom) - y);
				ctx.fillStyle = colors[modeIndex % colors.length];
				ctx.fillRect(xAt(dayIndex) - barW / 2, y, barW, h);
				if (modeIndex > 0) {
					ctx.strokeStyle = page;
					ctx.lineWidth = 1.5;
					ctx.beginPath();
					ctx.moveTo(xAt(dayIndex) - barW / 2, yAt(bottom));
					ctx.lineTo(xAt(dayIndex) + barW / 2, yAt(bottom));
					ctx.stroke();
				}
				bottom = top;
			});
		});

		const lineProgress = Math.min(1, elapsed / this.animationDuration);
		ctx.save();
		ctx.beginPath();
		ctx.rect(pad.left, pad.top - 4, plotW * (1 - Math.pow(1 - lineProgress, 3)), plotH + 8);
		ctx.clip();
		ctx.beginPath();
		let lineStarted = false;
		series.average.forEach((value, index) => {
			if (value === null) return;
			const x = xAt(index);
			const y = yAt(value);
			if (!lineStarted) { ctx.moveTo(x, y); lineStarted = true; }
			else ctx.lineTo(x, y);
		});
		ctx.strokeStyle = ink2;
		ctx.lineWidth = 1.5;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.stroke();
		ctx.restore();

		const xLabelIndexes = [0, Math.floor((series.labels.length - 1) / 2), series.labels.length - 1];
		ctx.fillStyle = ink3;
		ctx.textBaseline = 'bottom';
		xLabelIndexes.forEach((index, position) => {
			ctx.textAlign = position === 0 ? 'left' : position === 2 ? 'right' : 'center';
			ctx.fillText(this.shortDate(series.labels[index]), xAt(index), rect.height);
		});

		if (this.hoverIndex !== null) {
			const index = Math.max(0, Math.min(series.labels.length - 1, this.hoverIndex));
			const x = xAt(index);
			ctx.strokeStyle = ink3;
			ctx.globalAlpha = .7;
			ctx.beginPath();
			ctx.moveTo(x, pad.top);
			ctx.lineTo(x, pad.top + plotH);
			ctx.stroke();
			ctx.globalAlpha = 1;
			this.updateTooltip(index, x, pad.left, plotW, series);
		} else {
			this.tooltip.removeClass('is-visible');
		}

		if (elapsed < this.animationDuration + 420) {
			this.frame = window.requestAnimationFrame(next => this.draw(next));
		}
	}

	private updateTooltip(index: number, x: number, plotLeft: number, plotW: number, series: ChartSeries): void {
		this.tooltip.empty();
		this.tooltip.createDiv({ cls: 'wm-wt-chart-tooltip-date', text: series.labels[index] });
		this.modes.forEach((mode, modeIndex) => {
			const value = series.values[modeIndex]?.[index] ?? 0;
			const row = this.tooltip.createDiv({ cls: 'wm-wt-chart-tooltip-row' });
			row.createSpan({ cls: 'wm-wt-chart-swatch' })
				.style.setProperty('--wm-wt-series', `var(--wm-wt-series-${modeIndex % SERIES_COUNT + 1})`);
			row.createSpan({ text: mode.label });
			row.createEl('b', { text: fmtTimeFull(Math.round(value)) });
		});
		const totalRow = this.tooltip.createDiv({ cls: 'wm-wt-chart-tooltip-total' });
		totalRow.createSpan({ text: '합계' });
		totalRow.createEl('b', { text: fmtTimeFull(Math.round(series.totals[index] ?? 0)) });
		const average = series.average[index];
		if (average !== null) {
			const averageRow = this.tooltip.createDiv({ cls: 'wm-wt-chart-tooltip-total' });
			averageRow.createSpan({ text: '7일 평균' });
			averageRow.createEl('b', { text: fmtTimeFull(Math.round(average)) });
		}
		const flip = x > plotLeft + plotW * .62;
		this.tooltip.setCssStyles({ left: `${x}px`, transform: flip ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' });
		this.tooltip.addClass('is-visible');
	}

	private readonly onPointerMove = (event: PointerEvent) => {
		if (this.history.length < 2) return;
		const rect = this.canvas.getBoundingClientRect();
		const left = 45;
		const right = 10;
		const width = Math.max(1, rect.width - left - right);
		const relative = Math.max(0, Math.min(1, (event.clientX - rect.left - left) / width));
		this.hoverIndex = Math.max(0, Math.min(this.history.length - 1, Math.floor(relative * this.history.length)));
		this.scheduleDraw(false);
	};

	private readonly onPointerLeave = () => {
		this.hoverIndex = null;
		this.tooltip.removeClass('is-visible');
		this.scheduleDraw(false);
	};

	private axisTime(seconds: number): string {
		if (seconds >= 3600) return `${Math.round(seconds / 360) / 10}h`;
		if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
		return `${Math.round(seconds)}s`;
	}

	private shortDate(date: string): string {
		const parts = date.split('-');
		return parts.length >= 3 ? `${Number(parts[1])}/${Number(parts[2])}` : date;
	}
}
