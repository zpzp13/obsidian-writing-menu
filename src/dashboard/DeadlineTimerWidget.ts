import { wmT } from '../i18n/index';
import { Modal, Notice, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { DeadlineSchedule } from '../types';
import { watchDisconnect } from '../utils/domUtils';

const WEEKDAYS = [
	{ value: 1, short: wmT("월"), full: wmT("월요일") },
	{ value: 2, short: wmT("화"), full: wmT("화요일") },
	{ value: 3, short: wmT("수"), full: wmT("수요일") },
	{ value: 4, short: wmT("목"), full: wmT("목요일") },
	{ value: 5, short: wmT("금"), full: wmT("금요일") },
	{ value: 6, short: wmT("토"), full: wmT("토요일") },
	{ value: 0, short: wmT("일"), full: wmT("일요일") },
] as const;

const DAY_MS = 86_400_000;

function normalizedSchedule(schedule?: DeadlineSchedule): DeadlineSchedule {
	const weekdays = [...new Set(schedule?.weekdays ?? [])]
		.filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
	const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(schedule?.time ?? '')
		? schedule!.time
		: '10:00';
	return { weekdays, time };
}

function scheduleTime(schedule: DeadlineSchedule): [number, number] {
	const [hour, minute] = schedule.time.split(':').map(Number);
	return [hour, minute];
}

function occurrence(schedule: DeadlineSchedule, now: Date, direction: 'next' | 'previous'): Date | null {
	if (schedule.weekdays.length === 0) return null;
	const [hour, minute] = scheduleTime(schedule);
	for (let offset = 0; offset <= 7; offset++) {
		const candidate = new Date(now);
		candidate.setDate(now.getDate() + (direction === 'next' ? offset : -offset));
		candidate.setHours(hour, minute, 0, 0);
		if (!schedule.weekdays.includes(candidate.getDay())) continue;
		if (direction === 'next' ? candidate.getTime() > now.getTime() : candidate.getTime() <= now.getTime()) {
			return candidate;
		}
	}
	return null;
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

function formatRemaining(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
	return days > 0 ? wmT("{0}일 {1}", days, clock) : clock;
}

function formatDeadline(date: Date): string {
	const weekday = WEEKDAYS.find(item => item.value === date.getDay())?.full ?? '';
	const hour = date.getHours();
	const period = hour < 12 ? wmT("오전") : wmT("오후");
	const displayHour = hour % 12 || 12;
	return wmT("{0}월 {1}일 {2} {3} {4}:{5}", date.getMonth() + 1, date.getDate(), weekday, period, displayHour, pad(date.getMinutes()));
}

export class DeadlineTimerWidget {
	static render(container: HTMLElement, plugin: WritingMenuPlugin): void {
		const card = container.createDiv({ cls: 'wm-dash-deadline-card wm-dash-note-card' });
		let disposed = false;
		let updateClock: (() => void) | null = null;

		const renderContent = () => {
			card.empty();
			const schedule = normalizedSchedule(plugin.settings.deadlineSchedule);

			if (schedule.weekdays.length === 0) {
				const empty = card.createDiv({ cls: 'wm-dash-deadline-empty' });
				empty.createDiv({ text: wmT("연재 일정을 설정해 주세요."), cls: 'wm-dash-deadline-empty-title' });
				empty.createDiv({ text: wmT("요일과 시각을 정하면 다음 마감까지 자동으로 계산합니다."), cls: 'wm-dash-deadline-empty-copy' });
				const emptyButton = empty.createEl('button', {
					text: wmT("일정 설정"),
					cls: 'wm-dash-deadline-empty-button',
					attr: { type: 'button' },
				});
				emptyButton.addEventListener('click', () => new DeadlineScheduleModal(plugin, schedule, renderContent).open());
				updateClock = null;
				return;
			}

			const body = card.createDiv({ cls: 'wm-dash-deadline-body' });
			const ring = body.createDiv({ cls: 'wm-dash-deadline-ring' });
			const svg = ring.createSvg('svg', {
				attr: { viewBox: '0 0 100 100', 'aria-hidden': 'true' },
			});
			svg.createSvg('circle', { cls: 'wm-dash-deadline-ring-track', attr: { cx: '50', cy: '50', r: '43' } });
			const ringFill = svg.createSvg('circle', {
				cls: 'wm-dash-deadline-ring-fill',
				attr: { cx: '50', cy: '50', r: '43', pathLength: '100' },
			});
			const dayText = ring.createSpan({ cls: 'wm-dash-deadline-day' });

			const countdown = body.createDiv({ cls: 'wm-dash-deadline-countdown' });
			const countdownHead = countdown.createDiv({ cls: 'wm-dash-deadline-countdown-head' });
			countdownHead.createDiv({ text: wmT("다음 마감까지"), cls: 'wm-dash-deadline-kicker' });
			const editButton = countdownHead.createEl('button', {
				cls: 'wm-dash-deadline-edit',
				attr: { type: 'button', 'aria-label': wmT("연재 일정 수정") },
			});
			setIcon(editButton, 'calendar-clock');
			editButton.addEventListener('click', () => {
				new DeadlineScheduleModal(plugin, schedule, renderContent).open();
			});
			const remainingText = countdown.createDiv({ cls: 'wm-dash-deadline-time' });
			const nextText = countdown.createDiv({ cls: 'wm-dash-deadline-next' });

			updateClock = () => {
				const now = new Date();
				const next = occurrence(schedule, now, 'next');
				const previous = occurrence(schedule, now, 'previous');
				if (!next || !previous) return;
				const remaining = next.getTime() - now.getTime();
				const interval = Math.max(1, next.getTime() - previous.getTime());
				const remainingRatio = Math.max(0, Math.min(1, remaining / interval));
				ringFill.style.strokeDashoffset = String(100 - remainingRatio * 100);
				remainingText.setText(formatRemaining(remaining));
				nextText.setText(formatDeadline(next));
				const days = Math.ceil(remaining / DAY_MS);
				dayText.setText(days <= 1 ? 'D-DAY' : `D-${days}`);
			};

			updateClock();
		};

		renderContent();
		const intervalId = window.setInterval(() => {
			if (!disposed) updateClock?.();
		}, 1000);
		watchDisconnect(card, () => {
			disposed = true;
			window.clearInterval(intervalId);
		});
	}
}

class DeadlineScheduleModal extends Modal {
	private readonly plugin: WritingMenuPlugin;
	private readonly initial: DeadlineSchedule;
	private readonly onSaved: () => void;

	constructor(plugin: WritingMenuPlugin, schedule: DeadlineSchedule, onSaved: () => void) {
		super(plugin.app);
		this.plugin = plugin;
		this.initial = normalizedSchedule(schedule);
		this.onSaved = onSaved;
	}

	onOpen(): void {
		this.modalEl.addClass('wm-deadline-modal-container');
		this.modalEl
			.querySelectorAll<HTMLElement>('.modal-header-button.mod-raised.clickable-icon, .modal-header-button.mod-raise.clickable-icon, .modal-close-button')
			.forEach(button => button.remove());
		this.contentEl.empty();
		this.contentEl.addClass('wm-deadline-modal');

		this.contentEl.createEl('label', { text: wmT("연재 요일"), cls: 'wm-deadline-modal-label' });
		const dayRow = this.contentEl.createDiv({
			cls: 'wm-deadline-modal-days',
			attr: { role: 'group', 'aria-label': wmT("연재 요일") },
		});
		const selected = new Set(this.initial.weekdays);
		for (const item of WEEKDAYS) {
			const button = dayRow.createEl('button', {
				text: item.short,
				cls: 'wm-deadline-modal-day',
				attr: { type: 'button', 'aria-pressed': String(selected.has(item.value)), 'aria-label': item.full },
			});
			button.addEventListener('click', () => {
				if (selected.has(item.value)) selected.delete(item.value);
				else selected.add(item.value);
				button.setAttribute('aria-pressed', String(selected.has(item.value)));
			});
		}

		this.contentEl.createEl('label', { text: wmT("마감 시각"), cls: 'wm-deadline-modal-label', attr: { for: 'wm-deadline-time' } });
		const timeInput = this.contentEl.createEl('input', {
			cls: 'wm-deadline-modal-time',
			attr: { id: 'wm-deadline-time', type: 'time', 'aria-label': wmT("마감 시각") },
		});
		timeInput.value = this.initial.time;
		timeInput.addEventListener('click', () => {
			try {
				timeInput.showPicker();
			} catch {
				// showPicker를 지원하지 않는 환경에서는 기본 time input 동작을 유지한다.
			}
		});

		const actions = this.contentEl.createDiv({ cls: 'wm-deadline-modal-actions' });
		const cancelButton = actions.createEl('button', {
			text: wmT("취소"), cls: 'wm-deadline-modal-cancel', attr: { type: 'button' },
		});
		const saveButton = actions.createEl('button', {
			text: wmT("적용"), cls: 'wm-deadline-modal-save', attr: { type: 'button' },
		});
		cancelButton.addEventListener('click', () => this.close());
		saveButton.addEventListener('click', () => {
			if (selected.size === 0) {
				new Notice(wmT("연재 요일을 하나 이상 선택해 주세요."));
				return;
			}
			void this.save({ weekdays: WEEKDAYS.map(item => item.value).filter(day => selected.has(day)), time: timeInput.value || '10:00' });
		});
	}

	private async save(schedule: DeadlineSchedule): Promise<void> {
		this.plugin.settings.deadlineSchedule = schedule;
		await this.plugin.saveSettings();
		this.close();
		this.onSaved();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
