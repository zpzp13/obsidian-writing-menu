import { setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';

export class StopwatchManager {
	private countupSeconds = 0;
	private countupInterval: number | null = null;
	private timerDurationSeconds: number;
	private widgetListeners = new Set<() => void>();

	constructor(private plugin: WritingMenuPlugin) {
		this.timerDurationSeconds = Math.max(0, plugin.settings.stopwatchMinutes * 60);
	}

	subscribeWidget(listener: () => void): () => void {
		this.widgetListeners.add(listener);
		return () => this.widgetListeners.delete(listener);
	}

	private notifyWidgets(): void {
		for (const listener of this.widgetListeners) listener();
	}

	initStopwatch() {
		this.timerDurationSeconds = Math.max(0, this.plugin.settings.stopwatchMinutes * 60);
		this.plugin.stopwatchSeconds = this.timerDurationSeconds;
	}

	startStopwatch() {
		if (this.plugin.stopwatchInterval) return;
		if (this.plugin.stopwatchSeconds <= 0) this.initStopwatch();
		this.plugin.stopwatchInterval = window.setInterval(() => {
			this.plugin.stopwatchSeconds--;
			this.updateStopwatchDisplay();
			if (this.plugin.stopwatchSeconds <= 0) {
				this.stopStopwatch();
				if (this.plugin.settings.enableStopwatchAlarm) this.playAlarm();
				this.timerDurationSeconds = Math.max(0, this.plugin.settings.stopwatchMinutes * 60);
				this.plugin.stopwatchSeconds = this.timerDurationSeconds;
				this.updateStopwatchDisplay();
			}
		}, 1000);
		this.notifyWidgets();
	}

	stopStopwatch() {
		if (this.plugin.stopwatchInterval) {
			window.clearInterval(this.plugin.stopwatchInterval);
			this.plugin.stopwatchInterval = null;
			this.notifyWidgets();
		}
	}

	resetStopwatch() {
		this.stopStopwatch();
		this.timerDurationSeconds = Math.max(0, this.plugin.settings.stopwatchMinutes * 60);
		this.plugin.stopwatchSeconds = this.timerDurationSeconds;
		this.updateStopwatchDisplay();
	}

	updateStopwatchDisplay() {
		this.plugin.updateStatusBarDisplay();
		this.notifyWidgets();
	}

	setTimerSeconds(seconds: number): void {
		this.plugin.stopwatchSeconds = Math.max(0, Math.floor(seconds));
		if (this.plugin.stopwatchSeconds === 0) this.stopStopwatch();
		this.updateStopwatchDisplay();
	}

	adjustTimerSeconds(deltaSeconds: number): void {
		const delta = Math.floor(deltaSeconds);
		this.plugin.stopwatchSeconds = Math.max(0, this.plugin.stopwatchSeconds + delta);
		if (this.plugin.stopwatchSeconds === 0) this.stopStopwatch();
		this.updateStopwatchDisplay();
	}

	getTimerDurationSeconds(): number {
		return this.timerDurationSeconds;
	}

	getCountupSeconds(): number {
		return this.countupSeconds;
	}

	isCountupRunning(): boolean {
		return this.countupInterval !== null;
	}

	startCountup(): void {
		if (this.countupInterval !== null) return;
		this.countupInterval = window.setInterval(() => {
			this.countupSeconds += 1;
			this.notifyWidgets();
		}, 1000);
		this.notifyWidgets();
	}

	stopCountup(): void {
		if (this.countupInterval === null) return;
		window.clearInterval(this.countupInterval);
		this.countupInterval = null;
		this.notifyWidgets();
	}

	resetCountup(): void {
		this.stopCountup();
		this.countupSeconds = 0;
		this.notifyWidgets();
	}

	setCountupSeconds(seconds: number): void {
		this.countupSeconds = Math.max(0, Math.floor(seconds));
		this.notifyWidgets();
	}

	adjustCountupSeconds(deltaSeconds: number): void {
		this.setCountupSeconds(this.countupSeconds + Math.floor(deltaSeconds));
	}

	destroy(): void {
		if (this.plugin.stopwatchInterval) {
			window.clearInterval(this.plugin.stopwatchInterval);
			this.plugin.stopwatchInterval = null;
		}
		if (this.countupInterval !== null) {
			window.clearInterval(this.countupInterval);
			this.countupInterval = null;
		}
		this.widgetListeners.clear();
	}

	playAlarm() {
		const audioContext = new AudioContext();
		const oscillator = audioContext.createOscillator();
		const gainNode = audioContext.createGain();
		oscillator.connect(gainNode);
		gainNode.connect(audioContext.destination);
		switch (this.plugin.settings.stopwatchAlarmSound) {
			case 'bell':
				oscillator.frequency.value = 830;
				oscillator.type = 'sine';
				gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
				gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);
				oscillator.start(audioContext.currentTime);
				oscillator.stop(audioContext.currentTime + 1);
				break;
			case 'chime':
				oscillator.frequency.value = 523;
				oscillator.type = 'sine';
				gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
				gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
				oscillator.start(audioContext.currentTime);
				oscillator.stop(audioContext.currentTime + 0.5);
				window.setTimeout(() => {
					const osc2 = audioContext.createOscillator();
					const gain2 = audioContext.createGain();
					osc2.connect(gain2);
					gain2.connect(audioContext.destination);
					osc2.frequency.value = 659;
					osc2.type = 'sine';
					gain2.gain.setValueAtTime(0.2, audioContext.currentTime);
					gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
					osc2.start(audioContext.currentTime);
					osc2.stop(audioContext.currentTime + 0.5);
				}, 300);
				break;
			case 'beep':
				oscillator.frequency.value = 1000;
				oscillator.type = 'square';
				gainNode.gain.value = 0.1;
				oscillator.start(audioContext.currentTime);
				oscillator.stop(audioContext.currentTime + 0.2);
				window.setTimeout(() => {
					const osc2 = audioContext.createOscillator();
					const gain2 = audioContext.createGain();
					osc2.connect(gain2);
					gain2.connect(audioContext.destination);
					osc2.frequency.value = 1000;
					osc2.type = 'square';
					gain2.gain.value = 0.1;
					osc2.start(audioContext.currentTime);
					osc2.stop(audioContext.currentTime + 0.2);
				}, 300);
				break;
			case 'ding':
				oscillator.frequency.value = 1200;
				oscillator.type = 'sine';
				gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
				gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
				oscillator.start(audioContext.currentTime);
				oscillator.stop(audioContext.currentTime + 0.8);
				break;
			case 'gong':
				oscillator.frequency.value = 150;
				oscillator.type = 'sine';
				gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
				gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 2);
				oscillator.start(audioContext.currentTime);
				oscillator.stop(audioContext.currentTime + 2);
				break;
		}
	}

	buildStatusPopup(container: HTMLElement) {
		const RADIUS = 63;
		const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
		const timerWrap = container.createDiv('wm-popup-timer-wrap');
		const svg = timerWrap.createSvg('svg', {
			cls: 'wm-popup-circle',
			attr: { viewBox: '0 0 156 156' },
		});
		svg.createSvg('circle', {
			cls: 'wm-popup-circle-track',
			attr: { cx: 78, cy: 78, r: RADIUS },
		});
		const circleFill = svg.createSvg('circle', {
			cls: 'wm-popup-circle-fill',
			attr: { cx: 78, cy: 78, r: RADIUS },
		});
		circleFill.setCssStyles({ strokeDasharray: String(CIRCUMFERENCE), strokeDashoffset: String(CIRCUMFERENCE) });

		const swTimeEl = timerWrap.createEl('span', { text: this.plugin.formatTime(this.plugin.stopwatchSeconds), cls: 'wm-popup-timer-big' });
		if (this.plugin.stopwatchInterval) swTimeEl.addClass('is-running');

		const updateProgress = () => {
			const totalSecs = this.timerDurationSeconds;
			if (totalSecs > 0) {
				const elapsed = totalSecs - this.plugin.stopwatchSeconds;
				const pct = Math.min(1, Math.max(0, elapsed / totalSecs));
				circleFill.setCssStyles({ strokeDashoffset: String(CIRCUMFERENCE * (1 - pct)) });
			} else {
				circleFill.setAttribute('stroke-dashoffset', String(CIRCUMFERENCE));
			}
		};
		updateProgress();

		const playResetRow = container.createDiv('wm-popup-row');
		playResetRow.setCssStyles({ justifyContent: 'center', gap: '20px', padding: '2px 0 4px' });

		const playBtn = playResetRow.createDiv('wm-popup-icon-action');
		setIcon(playBtn, this.plugin.stopwatchInterval ? 'pause' : 'play');
		playBtn.onclick = () => {
			if (this.plugin.stopwatchInterval) this.stopStopwatch();
			else this.startStopwatch();
			setIcon(playBtn, this.plugin.stopwatchInterval ? 'pause' : 'play');
			swTimeEl.textContent = this.plugin.formatTime(this.plugin.stopwatchSeconds);
			swTimeEl.toggleClass('is-running', !!this.plugin.stopwatchInterval);
			updateProgress();
		};

		const resetBtn = playResetRow.createDiv('wm-popup-icon-action');
		setIcon(resetBtn, 'rotate-ccw');
		resetBtn.onclick = () => {
			this.resetStopwatch();
			setIcon(playBtn, 'play');
			swTimeEl.removeClass('is-running');
			swTimeEl.textContent = this.plugin.formatTime(this.plugin.stopwatchSeconds);
			updateProgress();
		};

		const addRow = container.createDiv('wm-popup-row');
		addRow.setCssStyles({ justifyContent: 'space-between', paddingBottom: '2px' });
		[1, 5, 10, 25].forEach(mins => {
			const btn = addRow.createEl('button', { text: `+${mins}`, cls: 'wm-popup-action-btn' });
			btn.onclick = () => {
				this.plugin.stopwatchSeconds += mins * 60;
				this.plugin.updateStatusBarDisplay();
				swTimeEl.textContent = this.plugin.formatTime(this.plugin.stopwatchSeconds);
				updateProgress();
			};
		});

		const popupInterval = window.setInterval(() => {
			if (!activeDocument.querySelector('.wm-status-popup')) {
				window.clearInterval(popupInterval);
				return;
			}
			swTimeEl.textContent = this.plugin.formatTime(this.plugin.stopwatchSeconds);
			swTimeEl.toggleClass('is-running', !!this.plugin.stopwatchInterval);
			updateProgress();
			setIcon(playBtn, this.plugin.stopwatchInterval ? 'pause' : 'play');
		}, 1000);
	}
}
