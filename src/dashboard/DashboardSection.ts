import { MarkdownView, TFile, sanitizeHTMLToDom, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { WritingTimeSection } from './WritingTimeSection';
import { ArchiveMusicPlayerSection } from './ArchiveMusicPlayerSection';
import { TimerStopwatchWidget } from './TimerStopwatchWidget';
import { DeadlineTimerWidget } from './DeadlineTimerWidget';
import type { DailyCharStore } from './data/DailyCharStore';
import type { DashSectionConfig } from '../types';
import { MUNPIA_SVG, NOVELPIA_SVG } from '../assets/platformLogos';
import { watchDisconnect } from '../utils/domUtils';
import { PagedWritingView } from '../paged/PagedWritingView';

const LARGE_PAGED_DOCUMENT_THRESHOLD = 50_000;
const LARGE_PAGED_COUNT_IDLE_DELAY = 500;

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
			{ id: 'timer', label: '타이머',   visible: true },
			{ id: 'chars', label: '글자수',   visible: true },
			{ id: 'time',  label: '작업시간', visible: true },
			{ id: 'music', label: '음악',     visible: true },
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
			DeadlineTimerWidget.render(slot, plugin);
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
		let disposed = false;
		const scheduleSummaryRefresh = (delay = 800) => {
			window.clearTimeout(summaryRefreshTimer);
			summaryRefreshTimer = window.setTimeout(() => updateSummary(Number(selectedRange)), delay);
		};
		const applyLiveCharCount = (file: TFile, text: string) => {
			const counts = plugin.calculateAllCharCounts(text, file.path);
			this.lastTrackedNote = { title: file.basename, counts };
			const mode = plugin.settings.charCountMode ?? 'munpia';
			store.updateLiveCount(file, counts[mode]);
			updateChars(counts, file.basename);
			updateSummary(Number(selectedRange), true);
		};
		const refreshChars = (preferredView?: MarkdownView | PagedWritingView) => {
			const recentView = plugin.app.workspace.getMostRecentLeaf()?.view;
			const activeView = plugin.app.workspace.activeLeaf?.view;
			const view = preferredView
				?? (recentView instanceof MarkdownView || recentView instanceof PagedWritingView
				? recentView
				: activeView instanceof MarkdownView || activeView instanceof PagedWritingView
					? activeView
					: plugin.app.workspace.getActiveViewOfType(MarkdownView));
			if (!view?.file) {
				const previous = this.lastTrackedNote;
				updateChars(previous?.counts ?? null, previous?.title ?? null);
				return;
			}
			const text = view instanceof MarkdownView ? view.editor.getValue() : view.getEditableData();
			applyLiveCharCount(view.file, text);
		};
		const refreshForLeafChange = () => {
			window.clearTimeout(charRefreshTimer);
			refreshChars();
		};
		const scheduleCharRefresh = (preferredView?: MarkdownView | PagedWritingView) => {
			window.clearTimeout(charRefreshTimer);
			const delay = preferredView instanceof PagedWritingView
				&& preferredView.getEditableData().length >= LARGE_PAGED_DOCUMENT_THRESHOLD
				? LARGE_PAGED_COUNT_IDLE_DELAY
				: 80;
			charRefreshTimer = window.setTimeout(() => refreshChars(preferredView), delay);
		};

		refreshChars();
		void store.whenReady().then(() => {
			if (!disposed) updateSummary(Number(selectedRange));
		});

		const editorHandler = plugin.app.workspace.on('editor-change', (editor, info) => {
			window.clearTimeout(charRefreshTimer);
			if (info.file) applyLiveCharCount(info.file, editor.getValue());
			else refreshChars();
		});
		const removePagedEditorHandler = plugin.onPagedEditorChange(view => {
			scheduleCharRefresh(view);
		});
		const leafHandler   = plugin.app.workspace.on('active-leaf-change', refreshForLeafChange);
		// 완료된 날짜의 기록이 실제로 바뀐 경우에만 기간 통계를 갱신한다.
		store.onAvgUpdated = () => scheduleSummaryRefresh(100);

		watchDisconnect(root, () => {
			disposed = true;
			window.clearTimeout(charRefreshTimer);
			window.clearTimeout(summaryRefreshTimer);
			rangeResizeObserver.disconnect();
			store.onAvgUpdated = undefined;
			plugin.app.workspace.offref(editorHandler);
			plugin.app.workspace.offref(leafHandler);
			removePagedEditorHandler();
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
		updateSummary: (days: number, immediate?: boolean) => void;
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
		const vizLabel = vizKicker.createSpan({ text: '글자수 추이' });
		const vizNum = heroViz.createDiv({ cls: 'wm-dash-char-viz-num', text: '0' });
		const vizDelta = heroViz.createEl('p', { cls: 'wm-dash-char-hero-line wm-dash-char-average-line wm-dash-char-viz-delta' });
		vizDelta.appendText('직전 동일 기간 대비 ');
		const vizDeltaValue = vizDelta.createEl('b', { text: '—' });
		const sparkHost = heroViz.createDiv({ cls: 'wm-dash-char-spark-host' });
		window.requestAnimationFrame(() => heroViz.addClass('is-in'));

		const detailStats = hero.createDiv({ cls: 'wm-dash-char-details wm-dash-char-rv' });
		const yearCard = detailStats.createDiv({ cls: 'wm-dash-char-year-card' });
		const yearCalendar = yearCard.createDiv({ cls: 'wm-dash-char-year-calendar' });
		const yearSummary = yearCard.createDiv({ cls: 'wm-dash-char-year-summary' });
		const frequencyGauge = yearSummary.createDiv({
			cls: 'wm-dash-char-frequency-gauge',
			attr: { role: 'img', 'aria-label': '집필 빈도 0%' },
		});
		const frequencyGaugeValue = frequencyGauge.createSpan({ text: '0' });
		const recordSummary = yearSummary.createDiv({ cls: 'wm-dash-char-year-record' });
		const recordValue = recordSummary.createDiv({ cls: 'wm-dash-char-year-value', text: '0자 · —' });
		recordSummary.createDiv({ cls: 'wm-dash-char-year-label', text: '최고 기록' });
		window.requestAnimationFrame(() => detailStats.addClass('is-in'));

		const leftDetails = hero.createDiv({ cls: 'wm-dash-char-left-details' });
		const noteCard = leftDetails.createDiv({ cls: 'wm-dash-note-card wm-dash-char-platform-card' });
		const noteLine = noteCard.createDiv({ cls: 'wm-dash-note-card-title' });
		const noteIcon = noteLine.createSpan({ cls: 'wm-dash-note-card-icon', attr: { 'aria-label': '현재 노트' } });
		setIcon(noteIcon, 'file-text');
		const noteTitleEl = noteLine.createEl('b', { text: '노트를 선택하십시오' });
		const platformList = noteCard.createDiv({ cls: 'wm-dash-note-platform-list' });
		const numEls    = new Map<string, HTMLElement>();
		const platformDisplay = plugin.settings.statCardDisplay ?? 'both';
		const visiblePlatforms = (['munpia', 'novelpia'] as const).filter(platform =>
			platformDisplay === 'both' || platformDisplay === platform);
		for (const plat of visiblePlatforms) {
			const row = platformList.createDiv({ cls: 'wm-dash-note-platform-row' });
			const identity = row.createDiv({ cls: 'wm-dash-note-platform-name' });
			const logoEl = identity.createDiv({ cls: 'wm-dash-platform-logo' });
			logoEl.appendChild(sanitizeHTMLToDom(plat === 'munpia' ? MUNPIA_SVG : NOVELPIA_SVG));
			identity.createSpan({ text: plat.toUpperCase() });
			numEls.set(plat, row.createDiv({ cls: 'wm-dash-note-platform-count', text: '—' }));
		}

		const goal = leftDetails.createDiv({ cls: 'wm-dash-char-goal' });
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

		const updateSummary = (days: number, immediate = false) => {
			const history = store.getDailySeries(Math.max(1, days * 2 - 1));
			const previousSeries = history.slice(0, days);
			const todayTotal = store.getTodayTotal();
			const series = [...history.slice(days), todayTotal];
			const periodTotal = series.reduce((sum, value) => sum + value, 0);
			const previousTotal = previousSeries.reduce((sum, value) => sum + value, 0);
			const recentDay = series[series.length - 1] ?? 0;
			const avg = series.length > 0 ? Math.round(periodTotal / series.length) : 0;
			const today = new Date();
			const elapsedYearDays = Math.round((
				Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
				- Date.UTC(today.getFullYear(), 0, 1)
			) / 86_400_000);
			const yearSeries = [
				...(elapsedYearDays > 0 ? store.getDailySeries(elapsedYearDays) : []),
				todayTotal,
			];
			const best = yearSeries.length > 0 ? Math.max(...yearSeries) : 0;
			const writingDays = yearSeries.filter((value) => value > 0).length;
			const frequencyRate = yearSeries.length > 0 ? Math.round((writingDays / yearSeries.length) * 100) : 0;
			const bestIndex = best > 0 ? yearSeries.lastIndexOf(best) : -1;
			if (bestIndex >= 0) {
				const bestDate = new Date();
				bestDate.setHours(0, 0, 0, 0);
				bestDate.setDate(bestDate.getDate() - yearSeries.length + bestIndex);
				recordValue.textContent = `${best.toLocaleString()}자 · ${bestDate.getMonth() + 1}월 ${bestDate.getDate()}일`;
			} else {
				recordValue.textContent = '0자 · —';
			}
			frequencyGaugeValue.textContent = String(writingDays);
			frequencyGauge.setAttribute('aria-label', `올해 ${yearSeries.length}일 중 ${writingDays}일 집필, ${frequencyRate}%`);
			frequencyGauge.style.setProperty('--wm-frequency-angle', `${frequencyRate * 3.6}deg`);
			if (!immediate) this.renderWritingYearCalendar(yearCalendar, yearSeries);
			if (immediate) {
				this.setCountValue(heroNum, periodTotal);
				summaryHasRendered = true;
			} else if (!summaryHasRendered) {
				if (this.lastSummaryValue === null) this.setCountValue(heroNum, periodTotal);
				else {
					heroNum._wmValue = this.lastSummaryValue;
					this.animateCount(heroNum, periodTotal, 360);
				}
				summaryHasRendered = true;
			} else {
				this.animateCount(heroNum, periodTotal, 260);
			}
			this.lastSummaryValue = periodTotal;
			recentNumEl.textContent = `${recentDay.toLocaleString()}자`;
			vizLabel.textContent = '글자수 추이';
			vizNum.textContent = `일평균 ${avg.toLocaleString()}자`;
			vizDeltaValue.removeClass('is-up', 'is-down');
			if (previousTotal <= 0) {
				vizDeltaValue.textContent = '—';
			} else {
				const periodDelta = Math.round(((periodTotal - previousTotal) / previousTotal) * 100);
				if (periodDelta > 0) vizDeltaValue.addClass('is-up');
				else if (periodDelta < 0) vizDeltaValue.addClass('is-down');
				vizDeltaValue.textContent = periodDelta === 0
					? '± 0%'
					: `${periodDelta > 0 ? '▲' : '▼'} ${Math.abs(periodDelta)}%`;
			}
			if (!immediate) this.renderCharSpark(sparkHost, series);
			deltaEl.removeClass('is-up', 'is-down');
			if (avg <= 0) {
				avgDiffEl.textContent = '—';
				deltaEl.textContent = '';
			} else {
				const difference = recentDay - avg;
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
		parent.removeAttribute('role');
		parent.removeAttribute('aria-label');
		if (values.length < 2) return;
		parent.setAttrs({
			role: 'img',
			'aria-label': `최근 ${values.length}일 글자수 그래프`,
		});
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
				'aria-hidden': 'true',
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

	private static renderWritingYearCalendar(parent: HTMLElement, values: number[]): void {
		parent.empty();
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const year = today.getFullYear();
		const yearStart = new Date(year, 0, 1);
		const valuesByDate = new Map<string, number>();
		const formatKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
		for (let index = 0; index < values.length; index += 1) {
			const date = new Date(yearStart);
			date.setDate(date.getDate() + index);
			valuesByDate.set(formatKey(date), values[index] ?? 0);
		}

		const max = values.length > 0 ? Math.max(...values) : 0;
		parent.setAttrs({ role: 'img', 'aria-label': `${year}년 일별 집필 기록` });
		const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		for (let month = 0; month < 12; month += 1) {
			const monthBlock = parent.createDiv({ cls: 'wm-dash-char-year-month' });
			monthBlock.dataset.month = String(month);
			monthBlock.createDiv({ cls: 'wm-dash-char-year-month-label', text: monthLabels[month] });
			const daysGrid = monthBlock.createDiv({ cls: 'wm-dash-char-year-days', attr: { 'aria-hidden': 'true' } });
			const firstDay = new Date(year, month, 1).getDay();
			const daysInMonth = new Date(year, month + 1, 0).getDate();
			for (let blank = 0; blank < firstDay; blank += 1) {
				daysGrid.createSpan({ cls: 'wm-dash-char-year-day is-blank' });
			}
			for (let day = 1; day <= daysInMonth; day += 1) {
				const date = new Date(year, month, day);
				const value = valuesByDate.get(formatKey(date)) ?? 0;
				const dot = daysGrid.createSpan({ cls: 'wm-dash-char-year-day' });
				if (date >= today) {
					dot.addClass(date.getTime() === today.getTime() ? 'is-today' : 'is-future');
					continue;
				}
				if (value <= 0 || max <= 0) {
					dot.addClass('is-empty');
					dot.setAttribute('title', `${month + 1}월 ${day}일 · 기록 없음`);
					continue;
				}
				const level = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(value / max) * 4)));
				dot.addClass('is-written');
				dot.addClass(`is-level-${level}`);
				dot.setAttribute('title', `${month + 1}월 ${day}일 · ${value.toLocaleString()}자`);
			}
			const occupied = firstDay + daysInMonth;
			for (let blank = occupied; blank < 42; blank += 1) {
				daysGrid.createSpan({ cls: 'wm-dash-char-year-day is-blank' });
			}
		}
		window.requestAnimationFrame(() => {
			const currentMonth = parent.querySelector<HTMLElement>(`[data-month="${today.getMonth()}"]`);
			if (!currentMonth || parent.clientWidth <= 0) return;
			const centeredLeft = currentMonth.offsetLeft - (parent.clientWidth - currentMonth.offsetWidth) / 2;
			parent.scrollLeft = Math.max(0, centeredLeft);
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
