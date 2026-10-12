import { MarkdownView, sanitizeHTMLToDom, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { WritingTimeSection } from './WritingTimeSection';
import { ArchiveMusicPlayerSection } from './ArchiveMusicPlayerSection';
import { TimerStopwatchWidget } from './TimerStopwatchWidget';
import type { DailyCharStore } from './data/DailyCharStore';
import type { DashSectionConfig } from '../types';
import { MUNPIA_SVG, NOVELPIA_SVG } from '../assets/platformLogos';
import { watchDisconnect } from '../utils/domUtils';

export class DashboardSection {
	private static charRangeThumbPosition: { x: number; y: number; w: number; h: number } | null = null;
	private static lastTrackedNote: {
		title: string;
		counts: { munpia: number; novelpia: number };
	} | null = null;
	private static lastSummaryValue: number | null = null;

	static render(container: HTMLElement, plugin: WritingMenuPlugin, sections?: DashSectionConfig[]) {
		const wrap = container.createDiv({ cls: 'wm-dash' });

		const cfg = sections ?? plugin.settings.dashboardSections ?? [
			{ id: 'chars',  label: '글자수',   visible: true },
			{ id: 'time',   label: '작업시간', visible: true },
			{ id: 'tasks',  label: '할 일',    visible: true },
		];

		for (const sec of cfg) {
			if (!sec.visible) continue;
			if (sec.id === 'calendar' || sec.id === 'tasks') continue;
			const section = wrap.createDiv({ cls: `wm-dash-section wm-dash-section-${sec.id}` });
			this.renderDashboardSection(section, plugin, sec.id);
		}
	}

	static renderDashboardSection(container: HTMLElement, plugin: WritingMenuPlugin, id: DashSectionConfig['id']): void {
		if (id === 'chars') {
			container.addClass('no-item-dividers');
			this.renderCharsContent(container, plugin);
		} else if (id === 'timer') {
			const slot = container.createDiv({ cls: 'wm-dash-clock-slot' });
			TimerStopwatchWidget.render(slot, plugin);
		} else if (id === 'time') {
			const slot = container.createDiv({ cls: 'wm-dash-group-item' });
			WritingTimeSection.render(slot, plugin).catch(() => {});
		} else if (id === 'music') {
			const slot = container.createDiv({ cls: 'wm-dash-group-item' });
			ArchiveMusicPlayerSection.render(slot, plugin);
		}
	}

	private static renderCharsContent(root: HTMLElement, plugin: WritingMenuPlugin) {
		const store = plugin.charStore;
		type CharRange = '7' | '30' | '90' | '365';
		let selectedRange: CharRange = plugin.settings.dashboardCharRange ?? '30';

		const rangeRow = root.createDiv({ cls: 'wm-dash-char-range-row' });
		const rangeSeg = rangeRow.createDiv({ cls: 'wm-dash-char-range-seg', attr: { role: 'group', 'aria-label': '글자수 평균 기간' } });
		const rangeThumb = rangeSeg.createSpan({ cls: 'wm-dash-char-range-thumb' });
		const rangeItems: Array<{ key: CharRange; label: string }> = [
			{ key: '7', label: '7일' },
			{ key: '30', label: '30일' },
			{ key: '90', label: '90일' },
			{ key: '365', label: '1년' },
		];
		const rangeButtons = new Map<CharRange, HTMLButtonElement>();
		for (const item of rangeItems) {
			const button = rangeSeg.createEl('button', {
				text: item.label,
				attr: { type: 'button', 'aria-pressed': String(item.key === selectedRange) },
			});
			rangeButtons.set(item.key, button);
		}

		const statsItem = root.createDiv({ cls: 'wm-dash-group-item' });

		const { updateChars, updateSummary } = this.buildStatsCardLive(statsItem, store, plugin);

		const putRangeThumb = (position: { x: number; y: number; w: number; h: number }) => {
			rangeThumb.setCssStyles({
				width: `${position.w}px`,
				height: `${position.h}px`,
				transform: `translate(${position.x}px, ${position.y}px)`,
			});
		};
		const placeRangeThumb = () => {
			const active = rangeButtons.get(selectedRange);
			if (!active) return;
			const position = { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight };
			putRangeThumb(position);
			this.charRangeThumbPosition = position;
		};
		if (this.charRangeThumbPosition) {
			rangeThumb.addClass('is-still');
			putRangeThumb(this.charRangeThumbPosition);
		}
		window.requestAnimationFrame(() => {
			rangeThumb.removeClass('is-still');
			window.requestAnimationFrame(placeRangeThumb);
		});
		const rangeResizeObserver = new ResizeObserver(placeRangeThumb);
		rangeResizeObserver.observe(rangeSeg);
		for (const [range, button] of rangeButtons) {
			button.addEventListener('click', () => {
				if (selectedRange === range) return;
				selectedRange = range;
				plugin.settings.dashboardCharRange = range;
				for (const [key, other] of rangeButtons) other.setAttribute('aria-pressed', String(key === range));
				placeRangeThumb();
				updateSummary(Number(range));
				void plugin.saveSettings();
			});
		}

		let charRefreshTimer = 0;
		let summaryRefreshTimer = 0;
		const scheduleSummaryRefresh = (delay = 800) => {
			window.clearTimeout(summaryRefreshTimer);
			summaryRefreshTimer = window.setTimeout(() => updateSummary(Number(selectedRange)), delay);
		};
		const refreshChars = () => {
			const recentView = plugin.app.workspace.getMostRecentLeaf()?.view;
			const view = recentView instanceof MarkdownView
				? recentView
				: plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view?.file) {
				const previous = this.lastTrackedNote;
				updateChars(previous?.counts ?? null, previous?.title ?? null);
				return;
			}
			const counts = plugin.calculateAllCharCounts(view.editor.getValue(), view.file.path);
			this.lastTrackedNote = { title: view.file.basename, counts };
			const mode = plugin.settings.charCountMode ?? 'munpia';
			store.updateLiveCount(view.file, counts[mode]);
			updateChars(counts, view.file.basename);
		};
		const scheduleCharRefresh = () => {
			window.clearTimeout(charRefreshTimer);
			charRefreshTimer = window.setTimeout(() => {
				refreshChars();
				scheduleSummaryRefresh();
			}, 300);
		};
		const refreshForLeafChange = () => {
			window.clearTimeout(charRefreshTimer);
			refreshChars();
			updateSummary(Number(selectedRange));
		};

		refreshChars();
		updateSummary(Number(selectedRange));

		const editorHandler = plugin.app.workspace.on('editor-change', scheduleCharRefresh);
		const leafHandler   = plugin.app.workspace.on('active-leaf-change', refreshForLeafChange);
		// computeAvg 완료 직후에도 갱신
		store.onAvgUpdated = () => scheduleSummaryRefresh(100);

		watchDisconnect(root, () => {
			window.clearTimeout(charRefreshTimer);
			window.clearTimeout(summaryRefreshTimer);
			rangeResizeObserver.disconnect();
			store.onAvgUpdated = undefined;
			plugin.app.workspace.offref(editorHandler);
			plugin.app.workspace.offref(leafHandler);
		});
	}

	private static renderSection(
		container: HTMLElement,
		title: string | null,
		fn: (body: HTMLElement) => void,
	) {
		const group = container.createDiv({ cls: 'wm-dash-group' });
		if (title) this.renderSectionTitle(group, title);
		const body = group.createDiv({ cls: 'wm-dash-group-body' });
		fn(body);
	}

	private static renderSectionTitle(container: HTMLElement, title: string): HTMLElement {
		const hdr = container.createDiv({ cls: 'wm-dash-group-hdr' });
		hdr.createSpan({ cls: 'wm-dash-group-marker' });
		hdr.createSpan({ cls: 'wm-dash-group-label', text: title });
		return hdr;
	}

	private static buildStatsCardLive(
		container: HTMLElement,
		store: DailyCharStore,
		plugin: WritingMenuPlugin,
	): {
		updateChars: (counts: { munpia: number; novelpia: number } | null, noteTitle: string | null) => void;
		updateSummary: (days: number) => void;
	} {
		const hero = container.createDiv({ cls: 'wm-dash-char-hero' });
		const heroMain = hero.createDiv({ cls: 'wm-dash-char-main' });
		this.renderSectionTitle(heroMain, '누적 글자수').addClass('wm-dash-char-kicker');
		const heroNum = heroMain.createDiv({ cls: 'wm-dash-char-hero-num', text: '0' }) as HTMLElement & { _wmRaf?: number; _wmValue?: number };
		const recentLine = heroMain.createEl('p', { cls: 'wm-dash-char-hero-line' });
		recentLine.appendText('최근 하루 ');
		const recentNumEl = recentLine.createEl('b', { text: '0자' });
		const averageLine = heroMain.createEl('p', { cls: 'wm-dash-char-hero-line wm-dash-char-average-line' });
		averageLine.appendText('일평균 대비 ');
		const avgDiffEl = averageLine.createEl('b', { text: '—' });
		const deltaEl = averageLine.createSpan({ cls: 'wm-dash-char-delta' });
		const heroViz = hero.createDiv({ cls: 'wm-dash-char-viz wm-dash-char-rv' });
		const vizKicker = heroViz.createDiv({ cls: 'wm-dash-char-viz-kicker' });
		vizKicker.createSpan({ cls: 'wm-dash-char-viz-marker' });
		const vizLabel = vizKicker.createSpan({ text: '최근 30일 증가' });
		const vizNum = heroViz.createDiv({ cls: 'wm-dash-char-viz-num', text: '0' });
		const vizDelta = heroViz.createDiv({ cls: 'wm-dash-char-viz-delta', text: '—' });
		const sparkHost = heroViz.createDiv({ cls: 'wm-dash-char-spark-host' });
		window.requestAnimationFrame(() => heroViz.addClass('is-in'));

		const noteCard = hero.createDiv({ cls: 'wm-dash-note-card' });
		const noteLine = noteCard.createDiv({ cls: 'wm-dash-note-card-title' });
		const noteIcon = noteLine.createSpan({ cls: 'wm-dash-note-card-icon', attr: { 'aria-label': '현재 노트' } });
		setIcon(noteIcon, 'file-text');
		const noteTitleEl = noteLine.createEl('b', { text: '노트를 선택하십시오' });
		const platformList = noteCard.createDiv({ cls: 'wm-dash-note-platform-list' });
		const numEls    = new Map<string, HTMLElement>();
		for (const plat of ['munpia', 'novelpia'] as const) {
			const row = platformList.createDiv({ cls: 'wm-dash-note-platform-row' });
			const identity = row.createDiv({ cls: 'wm-dash-note-platform-name' });
			const logoEl = identity.createDiv({ cls: 'wm-dash-platform-logo' });
			logoEl.appendChild(sanitizeHTMLToDom(plat === 'munpia' ? MUNPIA_SVG : NOVELPIA_SVG));
			identity.createSpan({ text: plat.toUpperCase() });
			numEls.set(plat, row.createDiv({ cls: 'wm-dash-note-platform-count', text: '—' }));
		}

		const goal = hero.createDiv({ cls: 'wm-dash-char-goal' });
		const goalHead = goal.createDiv({ cls: 'wm-dash-char-goal-head' });
		const goalLabel = goalHead.createSpan();
		const goalRemain = goalHead.createSpan();
		const goalTrack = goal.createDiv({
			cls: 'wm-dash-char-goal-track',
			attr: { role: 'progressbar', 'aria-valuemin': '0' },
		});
		const goalFill = goalTrack.createDiv({ cls: 'wm-dash-char-goal-fill' });
		let currentCounts: { munpia: number; novelpia: number } | null = null;
		let summaryHasRendered = false;

		const updateGoal = () => {
			const configuredTarget = Number(plugin.settings.writingGoalChars);
			const target = Number.isFinite(configuredTarget) && configuredTarget > 0 ? configuredTarget : 10_000;
			const mode = plugin.settings.charCountMode ?? 'munpia';
			const current = currentCounts?.[mode] ?? 0;
			const remaining = Math.max(0, target - current);
			goalLabel.empty();
			goalLabel.createEl('b', { text: `${target.toLocaleString()}자` });
			goalLabel.appendText('까지');
			goalRemain.empty();
			goalRemain.createEl('b', {
				text: currentCounts === null ? '—' : `${remaining.toLocaleString()}자`,
			});
			goalRemain.appendText(' 남음');
			goalTrack.setAttribute('aria-valuemax', String(target));
			goalTrack.setAttribute('aria-valuenow', String(Math.min(current, target)));
			const progress = Math.max(2, Math.min(100, (current / target) * 100));
			window.requestAnimationFrame(() => {
				window.requestAnimationFrame(() => goalFill.setCssStyles({ width: `${progress}%` }));
			});
		};

		const updateChars = (counts: { munpia: number; novelpia: number } | null, noteTitle: string | null) => {
			currentCounts = counts;
			noteTitleEl.textContent = noteTitle ?? '노트를 선택하십시오';
			for (const plat of ['munpia', 'novelpia'] as const) {
				const el = numEls.get(plat);
				if (el) el.textContent = counts ? `${counts[plat].toLocaleString()}자` : '—';
			}
			updateGoal();
		};

		const updateSummary = (days: number) => {
			const trackingFolder = plugin.settings.trackingFolder ?? '';
			const today = trackingFolder ? store.getTodayTotalForFolder(trackingFolder) : store.getTodayTotal();
			if (!summaryHasRendered) {
				if (this.lastSummaryValue === null) this.setCountValue(heroNum, today);
				else {
					heroNum._wmValue = this.lastSummaryValue;
					this.animateCount(heroNum, today, 360);
				}
				summaryHasRendered = true;
			} else {
				this.animateCount(heroNum, today, 260);
			}
			this.lastSummaryValue = today;
			recentNumEl.textContent = `${today.toLocaleString()}자`;
			const avg = store.getDailyAverage(days);
			const series = store.getDailySeries(days);
			const comparison = store.getDailySeries(days * 2);
			const previousSeries = comparison.slice(0, days);
			const periodTotal = series.reduce((sum, value) => sum + value, 0);
			const previousTotal = previousSeries.reduce((sum, value) => sum + value, 0);
			vizLabel.textContent = `최근 ${days === 365 ? '1년' : `${days}일`} 증가`;
			vizNum.textContent = `${periodTotal > 0 ? '+' : ''}${periodTotal.toLocaleString()}`;
			vizDelta.removeClass('is-up', 'is-down');
			if (previousTotal <= 0) {
				vizDelta.textContent = '—';
			} else {
				const periodDelta = Math.round(((periodTotal - previousTotal) / previousTotal) * 100);
				if (periodDelta > 0) vizDelta.addClass('is-up');
				else if (periodDelta < 0) vizDelta.addClass('is-down');
				vizDelta.textContent = periodDelta === 0
					? '± 0%'
					: `${periodDelta > 0 ? '▲' : '▼'} ${Math.abs(periodDelta)}%`;
			}
			this.renderCharSpark(sparkHost, series);
			deltaEl.removeClass('is-up', 'is-down');
			if (avg <= 0) {
				avgDiffEl.textContent = '—';
				deltaEl.textContent = '';
			} else {
				const difference = today - avg;
				const delta = Math.round((difference / avg) * 100);
				avgDiffEl.textContent = difference === 0
					? '± 0자'
					: `${difference > 0 ? '+' : '-'}${Math.abs(difference).toLocaleString()}자`;
				if (delta > 0) deltaEl.addClass('is-up');
				else if (delta < 0) deltaEl.addClass('is-down');
				deltaEl.textContent = delta === 0 ? '± 0%' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}%`;
			}
		};

		return { updateChars, updateSummary };
	}

	/** Pulse의 pp-tile에서 사용하는 선형 sparkline. */
	private static renderCharSpark(parent: HTMLElement, values: number[]): void {
		parent.empty();
		if (values.length < 2) return;
		const max = Math.max(...values);
		const min = Math.min(...values);
		const span = max - min || 1;
		const path = values.map((value, index) => {
			const x = index / (values.length - 1) * 100;
			const y = 27 - (value - min) / span * 24;
			return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
		}).join('');
		const svg = parent.createSvg('svg', {
			cls: 'wm-dash-char-spark',
			attr: {
				viewBox: '0 0 100 30',
				preserveAspectRatio: 'none',
				role: 'img',
				'aria-label': `최근 ${values.length}일 글자수 그래프`,
			},
		});
		svg.createSvg('path', {
			cls: 'wm-dash-char-spark-line',
			attr: {
				d: path,
				'vector-effect': 'non-scaling-stroke',
			},
		});
	}

	private static animateCount(
		el: HTMLElement & { _wmRaf?: number; _wmValue?: number },
		to: number,
		duration = 1600,
	): void {
		if (el._wmRaf) window.cancelAnimationFrame(el._wmRaf);
		const from = el._wmValue ?? 0;
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reducedMotion || from === to) {
			el.textContent = Math.round(to).toLocaleString();
			el._wmValue = to;
			return;
		}
		const startedAt = performance.now();
		const step = (now: number) => {
			const progress = Math.min(1, (now - startedAt) / duration);
			const eased = 1 - Math.pow(1 - progress, 4);
			el._wmValue = from + (to - from) * eased;
			el.textContent = Math.round(el._wmValue).toLocaleString();
			if (progress < 1) el._wmRaf = window.requestAnimationFrame(step);
			else {
				el._wmValue = to;
				el._wmRaf = undefined;
			}
		};
		el._wmRaf = window.requestAnimationFrame(step);
	}

	private static setCountValue(
		el: HTMLElement & { _wmRaf?: number; _wmValue?: number },
		value: number,
	): void {
		if (el._wmRaf !== undefined) window.cancelAnimationFrame(el._wmRaf);
		el._wmRaf = undefined;
		el._wmValue = value;
		el.textContent = Math.round(value).toLocaleString();
	}
}
