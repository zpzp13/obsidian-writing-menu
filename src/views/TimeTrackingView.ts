import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';


// Time Tracking Sidebar View
export const TIME_TRACKING_VIEW_TYPE = 'writing-menu-time-tracking';

export class TimeTrackingView extends ItemView {
	plugin: WritingMenuPlugin;
	private updateInterval: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: WritingMenuPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return TIME_TRACKING_VIEW_TYPE;
	}

	getDisplayText(): string {
		return '작업 시간';
	}

	getIcon(): string {
		return 'clock';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('writing-menu-sidebar-view');

		this.renderUI(container as HTMLElement);

		this.updateInterval = window.setInterval(() => {
			const stopwatchEl = this.containerEl.querySelector('.writing-menu-stopwatch-display');
			if (stopwatchEl) stopwatchEl.textContent = this.plugin.formatTime(this.plugin.stopwatchSeconds);
		}, 1000);
	}

	async onClose() {
		if (this.updateInterval) {
			window.clearInterval(this.updateInterval);
			this.updateInterval = null;
		}
	}

	refresh() {
		const container = this.containerEl.children[1];
		container.empty();
		this.renderUI(container as HTMLElement);
	}

	private renderUI(container: HTMLElement) {
		const wrapper = container.createDiv('writing-menu-sidebar-wrapper');

		if (this.plugin.stopwatchSeconds <= 0) {
			this.plugin.initStopwatch();
		}

		// === Main row: 작업 시간 [토글] ===
		const mainDiv = wrapper.createDiv('writing-menu-control wm-tt-row');

		const mainLabelGroup = mainDiv.createDiv('wm-tt-label-group');
		const mainIcon = mainLabelGroup.createSpan('wm-tt-icon');
		setIcon(mainIcon, 'clock');
		mainLabelGroup.createEl('span', { text: '작업 시간', cls: 'writing-menu-label wm-tt-label' });

		const mainToggle = mainDiv.createDiv(`writing-menu-toggle ${this.plugin.settings.enableTimeTracking ? 'is-enabled' : ''}`);
		mainToggle.createDiv('writing-menu-toggle-thumb');
		mainToggle.onclick = async () => {
			const newVal = !mainToggle.classList.contains('is-enabled');
			mainToggle.classList.toggle('is-enabled', newVal);
			this.plugin.settings.enableTimeTracking = newVal;
			await this.plugin.saveSettings();
			stopwatchDiv.setCssStyles({ display: newVal ? 'flex' : 'none' });
		};

		// === Sub row: └ 스톱워치 [countdown] [play/pause] [reset] ===
		const stopwatchDiv = wrapper.createDiv('writing-menu-control wm-tt-sub-row');
		if (!this.plugin.settings.enableTimeTracking) stopwatchDiv.setCssStyles({ display: 'none' });

		const stopwatchLabelGroup = stopwatchDiv.createDiv('wm-tt-sub-label-group');
		const cornerIcon1 = stopwatchLabelGroup.createSpan('wm-tt-corner-icon');
		setIcon(cornerIcon1, 'corner-down-right');
		const stopwatchLabel = stopwatchLabelGroup.createEl('span', { text: '스톱워치', cls: 'wm-tt-sub-text' });

		const stopwatchRightGroup = stopwatchDiv.createDiv('wm-tt-right-group');

		const stopwatchSpan = stopwatchRightGroup.createEl('span', { cls: 'writing-menu-stopwatch-display' });
		stopwatchSpan.textContent = this.plugin.formatTime(this.plugin.stopwatchSeconds);

		const btnGroup = stopwatchRightGroup.createDiv('wm-tt-btn-group');

		const playPauseBtn = btnGroup.createDiv('clickable-icon');
		setIcon(playPauseBtn, this.plugin.stopwatchInterval ? 'pause' : 'play');
		this.plugin.styleIconButton(playPauseBtn);

		const resetBtn = btnGroup.createDiv('clickable-icon');
		setIcon(resetBtn, 'rotate-ccw');
		this.plugin.styleIconButton(resetBtn, 0.6);

		resetBtn.onclick = (e) => {
			e.stopPropagation();
			this.plugin.resetStopwatch();
			stopwatchSpan.textContent = this.plugin.formatTime(this.plugin.stopwatchSeconds);
		};

		playPauseBtn.onclick = () => {
			if (this.plugin.stopwatchInterval) {
				this.plugin.stopStopwatch();
			} else {
				this.plugin.startStopwatch();
			}
			playPauseBtn.empty();
			setIcon(playPauseBtn, this.plugin.stopwatchInterval ? 'pause' : 'play');
			this.plugin.styleIconButton(playPauseBtn);
		};
	}
}
