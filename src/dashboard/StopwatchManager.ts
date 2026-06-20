import { setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';

export class StopwatchManager {
	constructor(private plugin: WritingMenuPlugin) {}

	initStopwatch() {
		this.plugin.stopwatchSeconds = this.plugin.settings.stopwatchMinutes * 60;
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
				this.initStopwatch();
				this.updateStopwatchDisplay();
			}
		}, 1000);
	}

	stopStopwatch() {
		if (this.plugin.stopwatchInterval) {
			window.clearInterval(this.plugin.stopwatchInterval);
			this.plugin.stopwatchInterval = null;
		}
	}

	resetStopwatch() {
		this.stopStopwatch();
		this.initStopwatch();
		this.updateStopwatchDisplay();
	}

	updateStopwatchSegments() {
		if (!this.plugin.stopwatchDashboardSegs.length) return;
		const total = this.plugin.settings.stopwatchMinutes * 60;
		const elapsed = total - this.plugin.stopwatchSeconds;
		const pct = total > 0 ? elapsed / total : 0;
		const filled = Math.round(pct * this.plugin.stopwatchDashboardSegs.length);
		this.plugin.stopwatchDashboardSegs.forEach((seg, i) => {
			seg.toggleClass('is-filled', i < filled);
		});
	}

	updateStopwatchDisplay() {
		const formatted = this.plugin.formatTime(this.plugin.stopwatchSeconds);
		if (this.plugin.stopwatchDisplayEl) this.plugin.stopwatchDisplayEl.textContent = formatted;
		if (this.plugin.stopwatchDashboardEl) this.plugin.stopwatchDashboardEl.textContent = formatted;
		this.updateStopwatchSegments();
		this.plugin.updateStatusBarDisplay();
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

	toggleDashboardStopwatchPopup(anchor: HTMLElement) {
		const ownerDoc = anchor.ownerDocument;
		const ownerWin = ownerDoc.defaultView ?? window;
		const existing = ownerDoc.querySelector('.wm-status-popup');
		if (existing) { existing.remove(); return; }

		const popup = ownerDoc.createElement('div');
		popup.className = 'wm-status-popup';
		ownerDoc.body.appendChild(popup);

		this.buildStatusPopup(popup);

		window.requestAnimationFrame(() => {
			const r  = anchor.getBoundingClientRect();
			const pr = popup.getBoundingClientRect();
			let top  = r.bottom + 6;
			let left = r.left;
			if (top + pr.height > ownerWin.innerHeight - 8) top = r.top - pr.height - 6;
			if (left + pr.width  > ownerWin.innerWidth  - 8) left = r.right - pr.width;
			popup.setCssStyles({ top: `${top}px`, left: `${left}px` });
		});

		const closePopup = (e: MouseEvent) => {
			if (!ownerDoc.contains(e.target as Node)) return;
			if (!popup.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
				popup.remove();
				ownerDoc.removeEventListener('click', closePopup);
			}
		};
		window.setTimeout(() => ownerDoc.addEventListener('click', closePopup), 10);
	}

	buildStatusPopup(container: HTMLElement) {
		const RADIUS = 63;
		const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
		const timerWrap = container.createDiv('wm-popup-timer-wrap');
		const svgNS = 'http://www.w3.org/2000/svg';
		const svg = activeDocument.createElementNS(svgNS, 'svg');
		svg.setAttribute('viewBox', '0 0 156 156');
		svg.setAttribute('class', 'wm-popup-circle');
		const track = activeDocument.createElementNS(svgNS, 'circle');
		track.setAttribute('cx', '78'); track.setAttribute('cy', '78'); track.setAttribute('r', String(RADIUS));
		track.setAttribute('class', 'wm-popup-circle-track');
		const circleFill = activeDocument.createElementNS(svgNS, 'circle');
		circleFill.setAttribute('cx', '78'); circleFill.setAttribute('cy', '78'); circleFill.setAttribute('r', String(RADIUS));
		circleFill.setAttribute('class', 'wm-popup-circle-fill');
		circleFill.setCssStyles({ strokeDasharray: String(CIRCUMFERENCE), strokeDashoffset: String(CIRCUMFERENCE) });
		svg.appendChild(track);
		svg.appendChild(circleFill);
		timerWrap.appendChild(svg);

		const swTimeEl = timerWrap.createEl('span', { text: this.plugin.formatTime(this.plugin.stopwatchSeconds), cls: 'wm-popup-timer-big' });
		if (this.plugin.stopwatchInterval) swTimeEl.addClass('is-running');

		const updateProgress = () => {
			const totalSecs = this.plugin.settings.stopwatchMinutes * 60;
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
