import { wmT } from '../i18n/index';
import type WritingMenuPlugin from '../../main';
import { watchDisconnect } from '../utils/domUtils';

export type ClockMode = 'timer' | 'stopwatch';

const TIME_STEPS = [
	{ label: '-1H', seconds: -3600 },
	{ label: '-30M', seconds: -1800 },
	{ label: '-15M', seconds: -900 },
	{ label: '-10M', seconds: -600 },
	{ label: '-5M', seconds: -300 },
	{ label: '-1M', seconds: -60 },
	{ label: '+1M', seconds: 60 },
	{ label: '+5M', seconds: 300 },
	{ label: '+15M', seconds: 900 },
	{ label: '+30M', seconds: 1800 },
	{ label: '+1H', seconds: 3600 },
] as const;

export class TimerStopwatchWidget {
	private static activeMode: ClockMode = 'stopwatch';
	private static readonly modeListeners = new Set<() => void>();

	static getActiveMode(): ClockMode {
		return this.activeMode;
	}

	static subscribeMode(listener: () => void): () => void {
		this.modeListeners.add(listener);
		return () => this.modeListeners.delete(listener);
	}

	static getDisplayTime(plugin: WritingMenuPlugin): string {
		return this.activeMode === 'timer'
			? this.formatTimerTime(plugin.stopwatchManager.getCountupSeconds())
			: plugin.formatTime(plugin.stopwatchSeconds, true);
	}

	static isRunning(plugin: WritingMenuPlugin): boolean {
		return this.activeMode === 'timer'
			? plugin.stopwatchManager.isCountupRunning()
			: plugin.stopwatchInterval !== null;
	}

	private static setActiveMode(mode: ClockMode): void {
		if (this.activeMode === mode) return;
		this.activeMode = mode;
		for (const listener of this.modeListeners) listener();
	}

	static render(container: HTMLElement, plugin: WritingMenuPlugin): void {
		const widget = container.createDiv({ cls: 'wm-dash-clock-widget wm-dash-note-card' });
		const stage = widget.createDiv({ cls: 'wm-dash-clock-stage' });

		const dial = stage.createDiv({ cls: 'wm-dash-clock-dial' });
		const gauge = dial.createSvg('svg', {
			cls: 'wm-dash-clock-gauge',
			attr: { viewBox: '0 0 100 100', 'aria-hidden': 'true' },
		});
		gauge.createSvg('circle', {
			cls: 'wm-dash-clock-gauge-track',
			attr: { cx: '50', cy: '50', r: '44' },
		});
		const gaugeFill = gauge.createSvg('circle', {
			cls: 'wm-dash-clock-gauge-fill',
			attr: { cx: '50', cy: '50', r: '44', pathLength: '100' },
		});
		const setRing = gauge.createSvg('g', { cls: 'wm-dash-clock-set-ring' });
		const ringSegments: SVGCircleElement[] = [];
		for (let index = 0; index < 8; index++) {
			const segment = setRing.createSvg('circle', {
				cls: 'wm-dash-clock-set-segment',
				attr: {
					cx: '50', cy: '50', r: '35', pathLength: '100',
					transform: `rotate(${-87 + index * 45} 50 50)`,
				},
			});
			ringSegments.push(segment);
		}

		const dialInput = dial.createEl('input', {
			cls: 'wm-dash-clock-time wm-dash-clock-dial-time',
			attr: { type: 'text', inputmode: 'numeric', 'aria-label': wmT("스톱워치 시간 입력"), spellcheck: 'false' },
		});

		const panel = stage.createDiv({ cls: 'wm-dash-clock-panel' });
		const panelTop = panel.createDiv({ cls: 'wm-dash-clock-panel-top' });
		const actions = panelTop.createDiv({ cls: 'wm-dash-clock-actions' });
		const startButton = actions.createEl('button', { text: 'START', cls: 'wm-dash-clock-text-action is-start', attr: { type: 'button' } });
		const resetButton = actions.createEl('button', { text: 'RESET', cls: 'wm-dash-clock-text-action is-reset', attr: { type: 'button' } });

		const switcher = panelTop.createDiv({
			cls: 'wm-dash-clock-switch wm-dash-char-range-seg',
			attr: { role: 'group', 'aria-label': wmT("타이머 모드") },
		});
		const switchThumb = switcher.createSpan({ cls: 'wm-dash-char-range-thumb' });
		const modeButtons = new Map<ClockMode, HTMLButtonElement>();
		for (const [mode, label] of [['timer', 'T'], ['stopwatch', 'S']] as const) {
			const fullLabel = mode === 'timer' ? 'Timer' : 'Stopwatch';
			const button = switcher.createEl('button', {
				text: label,
				attr: { type: 'button', 'aria-label': fullLabel },
			});
			modeButtons.set(mode, button);
		}

		const digitalInput = panel.createEl('input', {
			cls: 'wm-dash-clock-time wm-dash-clock-digital-time',
			attr: { type: 'text', inputmode: 'numeric', 'aria-label': wmT("타이머 시간 입력"), spellcheck: 'false' },
		});

		const adjustScroll = panel.createDiv({ cls: 'wm-dash-clock-adjust-scroll wm-cal-month-scroll' });
		let positiveStartButton: HTMLButtonElement | null = null;
		for (const step of TIME_STEPS) {
			const button = adjustScroll.createEl('button', {
				text: step.label,
				cls: 'wm-dash-clock-adjust wm-cal-ms-month',
				attr: { type: 'button', 'aria-label': wmT("{0} 조정", step.label) },
			});
			if (step.seconds === 60) positiveStartButton = button;
			button.addEventListener('click', () => {
				if (this.activeMode === 'stopwatch') plugin.stopwatchManager.adjustTimerSeconds(step.seconds);
				else plugin.stopwatchManager.adjustCountupSeconds(step.seconds);
			});
		}

		const editingInputs = new Set<HTMLInputElement>();
		const cancelledInputs = new WeakSet<HTMLInputElement>();
		const inputs = [dialInput, digitalInput];
		const positionAdjustScrollAtPositiveSteps = () => {
			if (!positiveStartButton) return;
			const scrollBounds = adjustScroll.getBoundingClientRect();
			const buttonBounds = positiveStartButton.getBoundingClientRect();
			adjustScroll.scrollLeft = Math.max(0, adjustScroll.scrollLeft + buttonBounds.left - scrollBounds.left - 32);
		};

		const placeSwitchThumb = () => {
			const active = modeButtons.get(this.activeMode);
			if (!active) return;
			switchThumb.setCssStyles({
				width: `${active.offsetWidth}px`,
				height: `${active.offsetHeight}px`,
				transform: `translate(${active.offsetLeft}px, ${active.offsetTop}px)`,
			});
		};

		const update = () => {
			const mode = this.activeMode;
			const isTimer = mode === 'timer';
			const totalSeconds = isTimer ? plugin.stopwatchManager.getCountupSeconds() : plugin.stopwatchSeconds;
			const running = isTimer ? plugin.stopwatchManager.isCountupRunning() : plugin.stopwatchInterval !== null;
			const targetSeconds = Math.max(1, plugin.stopwatchManager.getTimerDurationSeconds());
			const progress = isTimer
				? Math.min(1, Math.max(0, totalSeconds / targetSeconds))
				: 1 - Math.min(1, Math.max(0, totalSeconds / targetSeconds));

			widget.toggleClass('is-timer', isTimer);
			const formattedTime = isTimer
				? this.formatTimerTime(totalSeconds)
				: plugin.formatTime(totalSeconds, true);
			for (const input of inputs) {
				if (!editingInputs.has(input)) input.value = formattedTime;
			}
			const outerProgress = Math.min(1, progress * 2);
			const innerProgress = Math.max(0, Math.min(1, (progress - .5) * 2));
			gaugeFill.setCssStyles({ strokeDashoffset: String(100 - outerProgress * 100) });
			const filledSegments = Math.round(innerProgress * ringSegments.length);
			ringSegments.forEach((segment, index) => segment.toggleClass('is-filled', index < filledSegments));
			for (const [key, button] of modeButtons) button.setAttribute('aria-pressed', String(key === mode));
			startButton.textContent = running ? 'PAUSE' : 'START';
			startButton.toggleClass('is-start', !running);
			startButton.toggleClass('is-pause', running);
			startButton.setAttribute('aria-label', running ? wmT("일시정지") : wmT("시작"));
			window.requestAnimationFrame(placeSwitchThumb);
		};

		const commitTimeInput = (input: HTMLInputElement) => {
			const seconds = this.parseTimeInput(input.value);
			if (seconds === null) return;
			if (this.activeMode === 'stopwatch') plugin.stopwatchManager.setTimerSeconds(seconds);
			else plugin.stopwatchManager.setCountupSeconds(seconds);
		};

		for (const input of inputs) {
			input.addEventListener('focus', () => {
				editingInputs.add(input);
				input.select();
			});
			input.addEventListener('blur', () => {
				if (!cancelledInputs.has(input)) commitTimeInput(input);
				cancelledInputs.delete(input);
				editingInputs.delete(input);
				update();
			});
			input.addEventListener('keydown', event => {
				if (event.key === 'Enter') {
					event.preventDefault();
					input.blur();
				} else if (event.key === 'Escape') {
					event.preventDefault();
					cancelledInputs.add(input);
					input.blur();
				}
			});
		}

		for (const [mode, button] of modeButtons) {
			button.addEventListener('click', () => {
				if (this.activeMode === mode) return;
				for (const input of inputs) input.blur();
				this.setActiveMode(mode);
				update();
				if (mode === 'stopwatch') window.requestAnimationFrame(positionAdjustScrollAtPositiveSteps);
			});
		}
		startButton.addEventListener('click', () => {
			if (this.activeMode === 'stopwatch') {
				if (plugin.stopwatchInterval) plugin.stopwatchManager.stopStopwatch();
				else plugin.stopwatchManager.startStopwatch();
			} else if (plugin.stopwatchManager.isCountupRunning()) {
				plugin.stopwatchManager.stopCountup();
			} else {
				plugin.stopwatchManager.startCountup();
			}
		});
		resetButton.addEventListener('click', () => {
			if (this.activeMode === 'stopwatch') plugin.stopwatchManager.resetStopwatch();
			else plugin.stopwatchManager.resetCountup();
		});

		const switchResizeObserver = new ResizeObserver(placeSwitchThumb);
		switchResizeObserver.observe(switcher);
		const unsubscribe = plugin.stopwatchManager.subscribeWidget(update);
		watchDisconnect(widget, () => {
			switchResizeObserver.disconnect();
			unsubscribe();
		});
		switchThumb.addClass('is-still');
		update();
		window.requestAnimationFrame(() => {
			switchThumb.removeClass('is-still');
			placeSwitchThumb();
			if (this.activeMode === 'stopwatch') positionAdjustScrollAtPositiveSteps();
		});
	}

	private static parseTimeInput(value: string): number | null {
		const parts = value.trim().split(':').map(part => part.trim());
		if (parts.length < 1 || parts.length > 3 || parts.some(part => !/^\d+$/.test(part))) return null;
		const numbers = parts.map(Number);
		if (numbers.some(number => !Number.isSafeInteger(number))) return null;
		if (numbers.length === 1) return numbers[0] * 60;
		if (numbers.length === 2) return numbers[0] * 60 + Math.min(59, numbers[1]);
		return numbers[0] * 3600 + Math.min(59, numbers[1]) * 60 + Math.min(59, numbers[2]);
	}

	private static formatTimerTime(seconds: number): string {
		const safeSeconds = Math.max(0, Math.floor(seconds));
		const hours = Math.floor(safeSeconds / 3600);
		const minutes = Math.floor((safeSeconds % 3600) / 60);
		const remainder = safeSeconds % 60;
		return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
	}
}
