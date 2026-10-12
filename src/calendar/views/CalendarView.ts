import { ItemView, WorkspaceLeaf, setIcon, TFile, Notice } from 'obsidian';

declare const moment: (date?: unknown, fmt?: string) => { format(f: string): string };
import type WritingMenuPlugin from '../../../main';
import { DashboardSection } from '../../dashboard/DashboardSection';
import { TaskParser } from '../../dashboard/data/TaskParser';
import { TasksRenderer } from '../../dashboard/TasksRenderer';
import { showTaskAddPopup } from '../../dashboard/TaskAddPopup';
import { VersionPanel } from '../../version/VersionPanel';
import { RepetitionSection } from '../../repetition/RepetitionSection';
import type { DashSectionConfig } from '../../types';
import { WikiPanel } from '../../wiki/WikiPanel';
import { AiChatPanel } from '../../aichat/AiChatPanel';
import { formatDateKey } from '../../utils/dateUtils';
import { getDnConfig, ensureDailyNote } from '../../utils/dailyNoteUtils';
import { showDatePickerPopup } from '../components/DatePickerPopup';

export const VIEW_TYPE_CALENDAR = 'writing-menu-calendar';

type DashTab = 'main' | 'wiki' | 'version' | 'ai';

const TABS: Array<{ id: DashTab; icon: string; label: string }> = [
	{ id: 'main',    icon: 'house',              label: 'MAIN' },
	{ id: 'wiki',    icon: 'git-graph',          label: 'WIKI' },
	{ id: 'version', icon: 'shield',             label: 'REVISION' },
	{ id: 'ai',      icon: 'bot',               label: 'AI' },
];

export class CalendarView extends ItemView {
	plugin: WritingMenuPlugin;

	private selectedDate: Date;
	private dashTab: DashTab = 'main';
	private dashSubView: 'content' | 'sort' = 'content';
	private wikiPanel: WikiPanel | null = null;
	private aiChatPanel: AiChatPanel | null = null;

	private dateDisplayEl: HTMLElement   | null = null;
	private calendarTaskSlot: HTMLElement | null = null;
	private badgeDebounceTimer = 0;
	private calendarClickBlockUntil = 0;
	private calendarTaskDockCollapsed = false;
	private taskCounts = new Map<string, number>();

constructor(leaf: WorkspaceLeaf, plugin: WritingMenuPlugin) {
		super(leaf);
		this.plugin = plugin;
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		this.selectedDate = now;
	}

	getViewType()    { return VIEW_TYPE_CALENDAR; }
	getDisplayText() { return '대시보드'; }
	getIcon()        { return 'layout-dashboard'; }

	async onOpen() {
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		this.selectedDate = now;
		this.render();
		// 태스크 파일 변경 시 배지 자동 갱신
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (!(file instanceof TFile) || !TaskParser.isDailyNoteFile(file, this.plugin)) return;
			window.clearTimeout(this.badgeDebounceTimer);
			this.badgeDebounceTimer = window.window.setTimeout(() => { void this.loadAndApplyTasks().catch(() => {}); }, 300);
		}));
	}

	async onClose() {
	}

	activateWikiPicker() {
		this.dashTab = 'wiki';
		this.dashSubView = 'content';
		this.render();
		window.setTimeout(() => this.wikiPanel?.openFolderPicker(), 50);
	}

	openFileInWiki(file: import('obsidian').TFile) {
		this.dashTab = 'wiki';
		this.dashSubView = 'content';
		if (this.wikiPanel) {
			// 이미 패널이 있으면 직접 파일 열기 (re-render 없이)
			this.wikiPanel.openFile(file);
		} else {
			// 패널 없으면 render 후 생성된 패널에 파일 설정
			this.render();
			window.setTimeout(() => this.wikiPanel?.openFile(file), 50);
		}
	}

	// ── Root render ─────────────────────────────────────────────────

	render() {
		const content = this.containerEl.children[1] as HTMLElement;
		content.empty();
		this.updateDashboardContentClass();

		const wrap = content.createDiv({ cls: 'wm-cal-wrapper' });
		this.renderDashboardTabBar(wrap);
		this.renderDashboardPanel(wrap);

		this.loadAndApplyTasks().catch(() => {});
	}

	// ── Top bar ─────────────────────────────────────────────────────

	private renderTopBar(container: HTMLElement) {
		const bar  = container.createDiv({ cls: 'wm-cal-topbar wm-cal-agenda-topbar' });
		const left = bar.createDiv({ cls: 'wm-cal-topbar-left' });

		const pickerBtn = left.createEl('button', {
			cls: 'wm-cal-icon-btn',
			attr: { type: 'button', 'aria-label': '날짜 선택' },
		});
		setIcon(pickerBtn, 'calendar');
		pickerBtn.addEventListener('click', e => {
			e.stopPropagation();
			pickerBtn.ownerDocument.querySelector('.wm-cal-picker')?.remove();
			showDatePickerPopup(pickerBtn, this.selectedDate, date => {
				this.selectedDate = date;
				this.calendarTaskDockCollapsed = false;
				this.render();
			});
		});

		this.dateDisplayEl = left.createSpan({ cls: 'wm-cal-date-display' });
		this.updateDateDisplay();

		const nav = bar.createDiv({ cls: 'wm-cal-agenda-nav' });
		const prev = nav.createEl('button', {
			cls: 'wm-cal-icon-btn',
			attr: { type: 'button', 'aria-label': '이전 달' },
		});
		setIcon(prev, 'chevron-left');
		const today = nav.createEl('button', {
			cls: 'wm-cal-today-btn', text: 'TODAY', attr: { type: 'button' },
		});
		const next = nav.createEl('button', {
			cls: 'wm-cal-icon-btn',
			attr: { type: 'button', 'aria-label': '다음 주' },
		});
		setIcon(next, 'chevron-right');
		prev.setAttribute('aria-label', '이전 주');
		prev.addEventListener('click', () => this.shiftWeek(-1));
		today.addEventListener('click', () => this.goToToday());
		next.addEventListener('click', () => this.shiftWeek(1));
	}

	private updateDateDisplay() {
		if (!this.dateDisplayEl) return;
		const d  = this.selectedDate;
		const y  = d.getFullYear();
		this.dateDisplayEl.textContent = `${y}년 ${d.getMonth() + 1}월`;
	}

	// ── Month navigation ─────────────────────────────────────────────

	private shiftWeek(offset: number) {
		const next = new Date(this.selectedDate);
		next.setDate(next.getDate() + offset * 7);
		this.selectedDate = next;
		this.calendarTaskDockCollapsed = false;
		this.render();
	}

	private goToToday() {
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		this.selectedDate = now;
		this.calendarTaskDockCollapsed = false;
		this.render();
	}

	// ── Selected week ────────────────────────────────────────────────

	private renderWeekGrid(container: HTMLElement) {
		const grid = container.createDiv({ cls: 'wm-cal-grid wm-cal-week-grid' });
		const weekStart = new Date(this.selectedDate);
		weekStart.setDate(weekStart.getDate() - weekStart.getDay());
		weekStart.setHours(0, 0, 0, 0);
		const dayLabels = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		for (let i = 0; i < 7; i++) {
			const d = new Date(weekStart);
			d.setDate(weekStart.getDate() + i);
			const isWeekend = i === 0 || i === 6;
			const isToday   = d.toDateString() === today.toDateString();
			const isSel     = d.toDateString() === this.selectedDate.toDateString();

			const cell = grid.createDiv({
				cls: 'wm-cal-cell wm-cal-week-cell',
				attr: { role: 'button', tabindex: '0', 'aria-label': `${d.getMonth() + 1}월 ${d.getDate()}일` },
			});
			if (isWeekend) cell.addClass('wm-cal-weekend');
			if (isToday)   cell.addClass('wm-cal-today');
			if (isSel)     cell.addClass('wm-cal-selected');
			cell.dataset.datekey = formatDateKey(d);

			cell.createDiv({ cls: 'wm-cal-weekday', text: dayLabels[i] });
			cell.createDiv({ cls: 'wm-cal-num', text: String(d.getDate()) });

			const selectDate = (e: MouseEvent | KeyboardEvent) => {
				if (Date.now() < this.calendarClickBlockUntil) return;
				if ('key' in e && e.key !== 'Enter' && e.key !== ' ') return;
				if ('key' in e) e.preventDefault();
				e.stopPropagation();
				const selected = new Date(d.getFullYear(), d.getMonth(), d.getDate());
				const isSameDate = formatDateKey(selected) === formatDateKey(this.selectedDate);
				const shouldOpenTaskPopup = e.ctrlKey || e.metaKey || ('detail' in e && e.detail >= 2);
				if (!shouldOpenTaskPopup) {
					this.calendarTaskDockCollapsed = isSameDate
						? !this.calendarTaskDockCollapsed
						: false;
				}
				this.selectedDate = selected;
				this.updateDateDisplay();
				grid.querySelectorAll<HTMLElement>('.wm-cal-week-cell').forEach(day => {
					day.toggleClass('wm-cal-selected', day === cell);
				});
				this.calendarTaskSlot?.toggleClass('is-collapsed', this.calendarTaskDockCollapsed);
				this.calendarTaskSlot?.setAttribute('aria-hidden', String(this.calendarTaskDockCollapsed));
				void this.loadAndApplyTasks().catch(() => {});
				if (shouldOpenTaskPopup) {
					showTaskAddPopup(cell, this.plugin, () => { void this.loadAndApplyTasks(); }, selected);
				}
			};
			cell.addEventListener('click', selectDate);
			cell.addEventListener('keydown', selectDate);
		}
	}

	// ── Dashboard tab bar ────────────────────────────────────────────

	private renderDashboardTabBar(container: HTMLElement) {
		const row = container.createDiv({ cls: 'wm-dash-tab-row' });
		const bar = row.createDiv({ cls: 'wm-dash-tab-bar', attr: { role: 'tablist', 'aria-label': '대시보드 메뉴' } });
		const buttons = new Map<DashTab, HTMLButtonElement>();
		for (const tab of TABS) {
			const btn = bar.createEl('button', {
				cls: 'wm-dash-tab-btn',
				attr: {
					type: 'button',
					role: 'tab',
					'aria-label': tab.label,
					'aria-selected': String(this.dashTab === tab.id),
					'aria-pressed': String(this.dashTab === tab.id),
				},
			});
			const icon = btn.createSpan({ cls: 'wm-dash-tab-icon' });
			setIcon(icon, tab.icon);
			btn.createSpan({ cls: 'wm-dash-tab-label', text: tab.label });
			buttons.set(tab.id, btn);
			btn.addEventListener('click', () => {
				if (this.dashTab === tab.id && tab.id === 'main' && this.dashSubView === 'content') {
					// 이미 main content → 정렬보드로 드릴다운
					this.dashSubView = 'sort';
				} else {
					this.dashTab = tab.id;
					this.dashSubView = 'content';
				}
				for (const [id, other] of buttons) {
					const active = id === this.dashTab;
					other.setAttribute('aria-selected', String(active));
					other.setAttribute('aria-pressed', String(active));
				}
				this.updateDashboardContentClass();
				const panel = container.querySelector<HTMLElement>(':scope > .wm-dash-panel');
				panel?.remove();
				this.renderDashboardPanel(container);
			});
		}
	}

	private updateDashboardContentClass() {
		const content = this.containerEl.children[1] as HTMLElement;
		content.className = this.dashTab === 'wiki' ? 'wm-cal-content wm-wiki-mode'
			: this.dashTab === 'ai' ? 'wm-cal-content wm-aichat-mode'
			: 'wm-cal-content';
	}

	// ── Dashboard panel ──────────────────────────────────────────────

	private renderDashboardPanel(container: HTMLElement) {
		const panel = container.createDiv({ cls: 'wm-dash-panel' });
		switch (this.dashTab) {
			case 'main':
				if (this.dashSubView === 'sort') this.renderSortBoard(panel);
				else this.renderMainDashboard(panel);
				break;
			case 'wiki':    this.renderWikiPanel(panel);    break;
			case 'version': this.renderVersionPanel(panel); break;
			case 'ai':      this.renderAiChatPanel(panel);  break;
		}
	}

	private renderMainDashboard(panel: HTMLElement) {
		const fallback: DashSectionConfig[] = [
			{ id: 'calendar', label: '일정', visible: true },
			{ id: 'chars', label: '글자수', visible: true },
			{ id: 'timer', label: '타이머', visible: true },
			{ id: 'time', label: '작업 시간', visible: true },
			{ id: 'music', label: '음악', visible: true },
		];
		const sections = panel.createDiv({ cls: 'wm-dash wm-dash-main-sections' });
		for (const configured of this.plugin.settings.dashboardSections ?? fallback) {
			if (!configured.visible) continue;
			const id = configured.id === 'tasks' ? 'calendar' : configured.id;
			if (!['calendar', 'chars', 'timer', 'time', 'music'].includes(id)) continue;
			const section = sections.createDiv({ cls: `wm-dash-section wm-dash-section-${id}` });
			if (id === 'calendar') this.renderCalendarPanel(section);
			else DashboardSection.renderDashboardSection(section, this.plugin, id);
		}
	}

	private renderCalendarPanel(panel: HTMLElement) {
		const calendar = panel.createDiv({ cls: 'wm-dash-calendar wm-calendar-agenda' });
		this.renderTopBar(calendar);
		const viewport = calendar.createDiv({ cls: 'wm-cal-month-viewport' });
		this.renderWeekGrid(viewport);
		this.bindWeekSwipe(viewport);
		this.calendarTaskSlot = calendar.createDiv({ cls: 'wm-cal-task-dock' });
		this.calendarTaskSlot.toggleClass('is-collapsed', this.calendarTaskDockCollapsed);
		this.calendarTaskSlot.setAttribute('aria-hidden', String(this.calendarTaskDockCollapsed));
	}

	private bindWeekSwipe(viewport: HTMLElement) {
		let pointerId: number | null = null;
		let startX = 0;
		let startY = 0;
		let deltaX = 0;
		let horizontal = false;
		const grid = viewport.querySelector<HTMLElement>('.wm-cal-grid');
		if (!grid) return;

		const finish = () => {
			if (pointerId === null) return;
			const shift = Math.abs(deltaX) > Math.min(72, viewport.clientWidth * 0.18)
				? (deltaX < 0 ? 1 : -1)
				: 0;
			if (shift !== 0) this.calendarClickBlockUntil = Date.now() + 350;
			pointerId = null;
			grid.style.transition = 'transform 240ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease';
			grid.style.transform = shift === 0 ? 'translateX(0)' : `translateX(${shift > 0 ? '-24%' : '24%'})`;
			grid.style.opacity = shift === 0 ? '1' : '0';
			if (shift !== 0) window.setTimeout(() => this.shiftWeek(shift), 170);
		};

		viewport.addEventListener('pointerdown', (event) => {
			pointerId = event.pointerId;
			startX = event.clientX;
			startY = event.clientY;
			deltaX = 0;
			horizontal = false;
			grid.style.transition = 'none';
		});
		viewport.addEventListener('pointermove', (event) => {
			if (pointerId !== event.pointerId) return;
			const dx = event.clientX - startX;
			const dy = event.clientY - startY;
			if (!horizontal && Math.abs(dx) < 7) return;
			if (!horizontal && Math.abs(dy) > Math.abs(dx)) return;
			if (!horizontal && !viewport.hasPointerCapture(event.pointerId)) {
				viewport.setPointerCapture(event.pointerId);
			}
			horizontal = true;
			deltaX = dx;
			grid.style.transform = `translateX(${dx * 0.72}px)`;
			grid.style.opacity = String(Math.max(0.72, 1 - Math.abs(dx) / Math.max(1, viewport.clientWidth) * 0.35));
		});
		viewport.addEventListener('pointerup', finish);
		viewport.addEventListener('pointercancel', finish);
	}

	private renderWikiPanel(panel: HTMLElement) {
		panel.addClass('wm-dash-panel-single', 'wm-wiki-panel');
		if (!this.wikiPanel) {
			this.wikiPanel = new WikiPanel(this.plugin, this);
			this.plugin.wikiPanelRerender = () => this.wikiPanel?.rerender();
		}
		void this.wikiPanel.render(panel);
	}

	private renderAiChatPanel(panel: HTMLElement) {
		panel.addClass('wm-dash-panel-single', 'wm-aichat-panel');
		if (!this.aiChatPanel) {
			this.aiChatPanel = new AiChatPanel(this.plugin, this);
		}
		void this.aiChatPanel.render(panel);
	}

	private renderVersionPanel(panel: HTMLElement) {
		panel.addClass('wm-dash-panel-single', 'wm-revision-panel');
		const wrap = panel.createDiv({ cls: 'wm-dash wm-dash-revision' });
		const addSection = (title: string, renderBody: (body: HTMLElement) => void) => {
			const group = wrap.createDiv({ cls: 'wm-dash-group' });
			const header = group.createDiv({ cls: 'wm-dash-group-hdr' });
			header.createSpan({ cls: 'wm-dash-group-marker' });
			header.createSpan({ cls: 'wm-dash-group-label', text: title });
			const body = group.createDiv({ cls: 'wm-dash-group-body' });
			renderBody(body);
		};
		addSection('버전 관리', body => {
			body.addClass('version-control-view');
			VersionPanel.render(body, this.plugin);
		});
		addSection('퇴고 매니저', body => RepetitionSection.render(body, this.plugin));
	}

	// ── Sort board (main tab drill-down) ─────────────────────────────

	private renderSortBoard(panel: HTMLElement) {
		panel.addClass('wm-dash-sort-board');

		// 헤더
		const header = panel.createDiv({ cls: 'wm-dash-sort-header' });
		const backBtn = header.createDiv({ cls: 'wm-dash-sort-back' });
		setIcon(backBtn, 'chevron-left');
		backBtn.addEventListener('click', () => { this.dashSubView = 'content'; this.render(); });
		header.createDiv({ cls: 'wm-dash-sort-title', text: '섹션 구성' });

		const cfg: DashSectionConfig[] = (this.plugin.settings.dashboardSections ?? [
			{ id: 'calendar', label: '일정', visible: true },
			{ id: 'chars', label: '글자수', visible: true },
			{ id: 'timer', label: '타이머', visible: true },
			{ id: 'time', label: '작업 시간', visible: true },
			{ id: 'music', label: '음악', visible: true },
		]).filter(sec => ['calendar', 'chars', 'timer', 'time', 'music'].includes(sec.id));

		const list = panel.createDiv({ cls: 'wm-dash-sort-list' });

		const save = async () => {
			this.plugin.settings.dashboardSections = [...cfg];
			await this.plugin.saveSettings();
			renderRows();
		};

		const renderRows = () => {
			list.empty();
			cfg.forEach((sec, idx) => {
				const row = list.createDiv({ cls: 'wm-dash-sort-row' });

				const handle = row.createDiv({ cls: 'wm-dash-sort-handle' });
				setIcon(handle, 'grip-vertical');

				// 드래그 앤 드롭
				handle.draggable = true;
				handle.addEventListener('dragstart', (e) => {
					e.dataTransfer!.setData('text/plain', String(idx));
					row.addClass('is-dragging');
				});
				handle.addEventListener('dragend', () => row.removeClass('is-dragging'));
				row.addEventListener('dragover', (e) => { e.preventDefault(); row.addClass('is-drag-over'); });
				row.addEventListener('dragleave', () => row.removeClass('is-drag-over'));
				row.addEventListener('drop', (e) => {
					e.preventDefault();
					row.removeClass('is-drag-over');
					const from = parseInt(e.dataTransfer!.getData('text/plain'));
					if (from === idx || isNaN(from)) return;
					const [moved] = cfg.splice(from, 1);
					cfg.splice(idx, 0, moved);
					save().catch(() => {});
				});

				row.createDiv({ cls: 'wm-dash-sort-label', text: sec.label });

				// 위/아래 버튼
				const upBtn = row.createDiv({ cls: 'wm-dash-sort-arrow' + (idx === 0 ? ' is-disabled' : '') });
				setIcon(upBtn, 'chevron-up');
				if (idx > 0) upBtn.addEventListener('click', () => {
					[cfg[idx - 1], cfg[idx]] = [cfg[idx], cfg[idx - 1]];
					save().catch(() => {});
				});

				const downBtn = row.createDiv({ cls: 'wm-dash-sort-arrow' + (idx === cfg.length - 1 ? ' is-disabled' : '') });
				setIcon(downBtn, 'chevron-down');
				if (idx < cfg.length - 1) downBtn.addEventListener('click', () => {
					[cfg[idx], cfg[idx + 1]] = [cfg[idx + 1], cfg[idx]];
					save().catch(() => {});
				});

				// 눈 아이콘 (숨기기/표시)
				const eyeBtn = row.createDiv({ cls: 'wm-dash-sort-eye' + (!sec.visible ? ' is-hidden' : '') });
				setIcon(eyeBtn, sec.visible ? 'eye' : 'eye-off');
				eyeBtn.addEventListener('click', () => {
					sec.visible = !sec.visible;
					save().catch(() => {});
				});
			});
		};

		renderRows();
	}

	// ── Task data: load & apply ──────────────────────────────────────

	private async loadAndApplyTasks(): Promise<void> {
		const tasks = await TaskParser.loadTasks(this.plugin, this.selectedDate);
		this.taskCounts.clear();
		for (const t of tasks) {
			if (t.completed) continue;
			const dk = formatDateKey(t.sourceDate);
			this.taskCounts.set(dk, (this.taskCounts.get(dk) ?? 0) + 1);
		}

		const content = this.containerEl.children[1] as HTMLElement;
		const todayKey = formatDateKey(new Date());

		content.querySelectorAll<HTMLElement>('.wm-cal-date-card[data-datekey]').forEach(card => {
			const dk = card.dataset.datekey;
			if (!dk) return;
			card.querySelector('.wm-cal-task-badge')?.remove();
			const count = this.taskCounts.get(dk) ?? 0;
			if (count <= 0) return;
			const cat = dk === todayKey ? 'today' : dk > todayKey ? 'upcoming' : 'overdue';
			card.createDiv({ cls: `wm-cal-task-badge is-${cat}`, text: String(count) });
			if (!card.dataset.taskHover) {
				card.dataset.taskHover = '1';
				card.addEventListener('click', () => this.scrollToTasksSection(dk));
			}
		});

		content.querySelectorAll<HTMLElement>('.wm-cal-cell[data-datekey]').forEach(cell => {
			const dk = cell.dataset.datekey;
			if (!dk) return;
			cell.classList.remove('wm-cal-task-level-1', 'wm-cal-task-level-2', 'wm-cal-task-level-3');
			const count = this.taskCounts.get(dk) ?? 0;
			if (count <= 0) return;
			const level = count >= 4 ? 3 : count >= 2 ? 2 : 1;
			cell.classList.add(`wm-cal-task-level-${level}`);
		});

		if (this.calendarTaskSlot?.isConnected) {
			this.calendarTaskSlot.empty();
			TasksRenderer.render(this.calendarTaskSlot, tasks, this.plugin, undefined, this.selectedDate, true);
		}
	}

	private scrollToTasksSection(dateKey?: string) {
		const content = this.containerEl.children[1] as HTMLElement;
		const tasksWrap = content.querySelector<HTMLElement>('.wm-cal-task-dock .wm-tasks-wrap');
		if (!tasksWrap) return;
		window.setTimeout(() => {
			tasksWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			if (dateKey) {
				window.setTimeout(() => {
					content.querySelectorAll<HTMLElement>(`.wm-task-item[data-datekey="${dateKey}"]`).forEach(el => {
						el.classList.remove('is-highlighted');
						void el.offsetWidth;
						el.classList.add('is-highlighted');
						window.setTimeout(() => el.classList.remove('is-highlighted'), 1600);
					});
				}, 350);
			}
		}, 0);
	}

	// ── Daily note ───────────────────────────────────────────────────

	private async openOrCreateDailyNote(date: Date) {
		const { folder, format } = getDnConfig(this.plugin);
		const filename = moment(date).format(format);
		const filePath = folder ? `${folder}/${filename}.md` : `${filename}.md`;

		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) {
			await this.app.workspace.getLeaf(false).openFile(existing);
			return;
		}
		try {
			const file = await ensureDailyNote(this.plugin, date);
			if (file) await this.app.workspace.getLeaf(false).openFile(file);
			else new Notice('데일리 노트를 생성할 수 없습니다.');
		} catch {
			new Notice('데일리 노트를 생성할 수 없습니다.');
		}
	}

}
