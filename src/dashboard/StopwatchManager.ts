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
				this.playAlarm();
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

}
