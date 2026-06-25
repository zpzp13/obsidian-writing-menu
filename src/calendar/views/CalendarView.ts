import { ItemView, WorkspaceLeaf, setIcon, TFile, Notice } from 'obsidian';

declare const moment: (date?: unknown, fmt?: string) => { format(f: string): string };
import { showDayPreview, removeDayPreview } from '../components/DayPreviewPopup';
import type WritingMenuPlugin from '../../../main';
import { DashboardSection } from '../../dashboard/DashboardSection';
import { TaskParser } from '../../dashboard/data/TaskParser';
import { TasksRenderer } from '../../dashboard/TasksRenderer';
import { WritingTimeSection } from '../../dashboard/WritingTimeSection';
import { VersionPanel } from '../../version/VersionPanel';
import { MonthScroller } from '../components/MonthScroller';
import { DateStrip } from '../components/DateStrip';
import { showDatePickerPopup } from '../components/DatePickerPopup';
import type { DashSectionConfig } from '../../types';
import { WikiPanel } from '../../wiki/WikiPanel';
import { formatDateKey } from '../../utils/dateUtils';
import { getDnConfig, ensureDailyNote } from '../../utils/dailyNoteUtils';

export const VIEW_TYPE_CALENDAR = 'writing-menu-calendar';

const DOW_KO_FULL = ['일','월','화','수','목','금','토'];

type DashTab = 'main' | 'tasks' | 'chars' | 'time' | 'wiki' | 'version';

const TABS: Array<{ id: DashTab; icon: string; label: string }> = [
	{ id: 'main',    icon: 'layout-dashboard',  label: '메인 대시보드' },
	{ id: 'tasks',   icon: 'list-todo',         label: '할 일' },
	{ id: 'chars',   icon: 'square-chart-gantt', label: '글자수' },
	{ id: 'time',    icon: 'clock-fading',      label: '작업시간' },
	{ id: 'wiki',    icon: 'git-graph',         label: '위키' },
	{ id: 'version', icon: 'history',           label: '버전관리' },
];

export class CalendarView extends ItemView {
	plugin: WritingMenuPlugin;

	private selectedDate: Date;
	private viewMode: 'strip' | 'full' = 'strip';
	private collapsed = false;

	private dashTab: DashTab = 'main';
	private dashSubView: 'content' | 'sort' = 'content';
	private wikiPanel: WikiPanel | null = null;

	private popup:         HTMLElement   | null = null;
	private monthScroller: MonthScroller | null = null;
	private dateStrip:     DateStrip     | null = null;
	private dateDisplayEl: HTMLElement   | null = null;

	private navDebounceTimer = 0;
	private badgeDebounceTimer = 0;
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
		this.registerEvent(this.app.vault.on('modify', () => {
			window.clearTimeout(this.badgeDebounceTimer);
			this.badgeDebounceTimer = window.window.setTimeout(() => { void this.loadAndApplyTasks().catch(() => {}); }, 300);
		}));
	}

	async onClose() { this.removePopup(); }

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
		this.removePopup();
		const content = this.containerEl.children[1] as HTMLElement;
		content.empty();
		content.className = this.dashTab === 'wiki' ? 'wm-cal-content wm-wiki-mode' : 'wm-cal-content';

		const wrap = content.createDiv({ cls: 'wm-cal-wrapper' });
		this.renderTopBar(wrap);

		if (!this.collapsed) {
			const year    = this.selectedDate.getFullYear();
			const currMon = this.selectedDate.getMonth();

			this.monthScroller = new MonthScroller(wrap, currMon, year,
				(mon) => this.navigateToMonth(mon, year),
				this.viewMode === 'full',
			);

			if (this.viewMode === 'strip') {
				this.dateStrip = new DateStrip(wrap, year, this.selectedDate, {
					onDateChange:  (d) => { this.selectedDate = d; this.updateDateDisplay(); },
					onMonthChange: (m) => this.monthScroller?.sync(m),
					openDailyNote: (d) => { void this.openOrCreateDailyNote(d); },
					onHover:    (d, el) => showDayPreview(el, d, this.plugin),
					onHoverEnd: ()     => removeDayPreview(),
				});
			} else {
				this.renderFullGrid(wrap);
			}
		}

		this.renderCollapseHandle(wrap);
		this.renderDashboardTabBar(wrap);
		this.renderDashboardPanel(wrap);

		this.loadAndApplyTasks().catch(() => {});
	}

	// ── Top bar ─────────────────────────────────────────────────────

	private renderTopBar(container: HTMLElement) {
		const bar  = container.createDiv({ cls: 'wm-cal-topbar' });
		const left = bar.createDiv({ cls: 'wm-cal-topbar-left' });

		const pickerBtn = left.createDiv({ cls: 'wm-cal-icon-btn' });
		setIcon(pickerBtn, 'calendar');
		pickerBtn.addEventListener('click', e => {
			e.stopPropagation();
			if (this.popup?.isConnected) {
				this.removePopup();
				return;
			}
			this.popup = null;
			this.popup = showDatePickerPopup(pickerBtn, this.selectedDate, (d) => {
				this.selectedDate = d;
				this.popup = null;
				this.render();
			});
		});

		this.dateDisplayEl = left.createSpan({ cls: 'wm-cal-date-display' });
		this.updateDateDisplay();
		this.dateDisplayEl.addEventListener('click', () => this.goToToday());

		const toggleBtn = left.createDiv({ cls: 'wm-cal-icon-btn wm-cal-toggle-btn' });
		setIcon(toggleBtn, this.viewMode === 'full' ? 'chevron-up' : 'chevron-down');
		toggleBtn.addEventListener('click', e => {
			e.stopPropagation();
			this.viewMode = this.viewMode === 'strip' ? 'full' : 'strip';
			this.render();
		});

		const right = bar.createDiv({ cls: 'wm-cal-topbar-right' });

		if (this.plugin.settings.showTimeInDashboard) {
			if (this.plugin.stopwatchSeconds <= 0) this.plugin.initStopwatch();
			const swBadge = right.createDiv({ cls: 'wm-cal-stopwatch-badge' });

			const battery = swBadge.createDiv({ cls: 'wm-cal-sw-battery' });
			const segs: HTMLElement[] = [];
			for (let i = 0; i < 4; i++) {
				segs.push(battery.createDiv({ cls: 'wm-cal-sw-seg' }));
			}
			this.plugin.stopwatchDashboardSegs = segs;

			const swText = swBadge.createSpan({ cls: 'wm-cal-sw-time' });
			swText.textContent = this.plugin.formatTime(this.plugin.stopwatchSeconds);
			this.plugin.stopwatchDashboardEl = swText;

			this.plugin.updateStopwatchSegments();

			swBadge.addEventListener('click', e => {
				e.stopPropagation();
				this.plugin.toggleDashboardStopwatchPopup(swBadge);
			});
		}
	}

	private updateDateDisplay() {
		if (!this.dateDisplayEl) return;
		const d  = this.selectedDate;
		const y  = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		const dw = DOW_KO_FULL[d.getDay()];
		this.dateDisplayEl.textContent = `${y}-${mm}-${dd}(${dw})`;
	}

	// ── Month navigation ─────────────────────────────────────────────

	private navigateToMonth(mon: number, year: number) {
		window.clearTimeout(this.navDebounceTimer);
		this.navDebounceTimer = 0;
		const maxDay = new Date(year, mon + 1, 0).getDate();
		const day    = Math.min(this.selectedDate.getDate(), maxDay);
		this.selectedDate = new Date(year, mon, day);
		this.updateDateDisplay();

		if (this.viewMode === 'full') { this.render(); return; }
		this.dateStrip?.goTo(this.selectedDate, false);
	}

	private goToToday() {
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		this.selectedDate = now;
		this.updateDateDisplay();

		if (this.viewMode === 'full') { this.render(); return; }
		this.dateStrip?.goTo(now, true);
	}

	// ── Full grid ────────────────────────────────────────────────────

	private renderFullGrid(container: HTMLElement) {
		const year  = this.selectedDate.getFullYear();
		const month = this.selectedDate.getMonth();

		const wdRow = container.createDiv({ cls: 'wm-cal-weekdays' });
		for (const d of ['일','월','화','수','목','금','토']) {
			wdRow.createDiv({ cls: 'wm-cal-weekday', text: d });
		}

		const grid  = container.createDiv({ cls: 'wm-cal-grid' });
		const dow   = new Date(year, month, 1).getDay();
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		for (let i = 0; i < 42; i++) {
			const d = new Date(year, month, 1 - dow + i);

			const col       = i % 7;
			const isWeekend = col === 0 || col === 6;
			const isCurr    = d.getMonth() === month;
			const isToday   = d.toDateString() === today.toDateString();
			const isSel     = d.toDateString() === this.selectedDate.toDateString();

			const cell = grid.createDiv({ cls: 'wm-cal-cell' });
			if (isWeekend) cell.addClass('wm-cal-weekend');
			if (!isCurr)   cell.addClass('wm-cal-other');
			if (isToday)   cell.addClass('wm-cal-today');
			if (isSel)     cell.addClass('wm-cal-selected');
			if (isCurr)    cell.dataset.datekey = formatDateKey(d);

			cell.createDiv({ cls: 'wm-cal-num', text: String(d.getDate()) });

			if (isCurr) {
				cell.addEventListener('mouseenter', () => showDayPreview(cell, new Date(d.getFullYear(), d.getMonth(), d.getDate()), this.plugin));
				cell.addEventListener('mouseleave', () => removeDayPreview());
			}

			cell.addEventListener('click', (e) => {
				if (e.ctrlKey || e.metaKey) {
					void this.openOrCreateDailyNote(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
					return;
				}
				this.selectedDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
				const dk = formatDateKey(this.selectedDate);
				const hasTask = (this.taskCounts.get(dk) ?? 0) > 0;
				this.render();
				if (hasTask) window.requestAnimationFrame(() => this.scrollToTasksSection(dk));
			});
		}
	}

	// ── Dashboard tab bar ────────────────────────────────────────────

	private renderDashboardTabBar(container: HTMLElement) {
		const bar = container.createDiv({ cls: 'wm-dash-tab-bar' });
		for (const tab of TABS) {
			const btn = bar.createDiv({ cls: 'wm-dash-tab-btn' + (this.dashTab === tab.id ? ' is-active' : '') });
			btn.setAttribute('aria-label', tab.label);
			setIcon(btn, tab.icon);
			btn.addEventListener('click', () => {
				if (this.dashTab === tab.id && tab.id === 'main' && this.dashSubView === 'content') {
					// 이미 main content → 정렬보드로 드릴다운
					this.dashSubView = 'sort';
				} else {
					this.dashTab = tab.id;
					this.dashSubView = 'content';
				}
				this.render();
			});
		}
	}

	// ── Dashboard panel ──────────────────────────────────────────────

	private renderDashboardPanel(container: HTMLElement) {
		const panel = container.createDiv({ cls: 'wm-dash-panel' });
		switch (this.dashTab) {
			case 'main':
				if (this.dashSubView === 'sort') this.renderSortBoard(panel);
				else this.renderMainDashboard(panel);
				break;
			case 'tasks':   this.renderTasksPanel(panel);   break;
			case 'chars':   this.renderCharsPanel(panel);   break;
			case 'time':    this.renderTimePanel(panel);    break;
			case 'wiki':    this.renderWikiPanel(panel);    break;
			case 'version': this.renderVersionPanel(panel); break;
		}
	}

	private renderMainDashboard(panel: HTMLElement) {
		const cfg = this.plugin.settings.dashboardSections;
		DashboardSection.render(panel, this.plugin, cfg);
	}

	private renderTasksPanel(panel: HTMLElement) {
		panel.addClass('wm-dash-panel-single');
		TaskParser.loadTasks(this.plugin)
			.then(tasks => {
				panel.empty();
				TasksRenderer.render(panel, tasks, this.plugin);
			})
			.catch(() => {});
	}

	private renderCharsPanel(panel: HTMLElement) {
		panel.addClass('wm-dash-panel-single');
		DashboardSection.renderCharsOnly(panel, this.plugin);
	}

	private renderTimePanel(panel: HTMLElement) {
		panel.addClass('wm-dash-panel-single');
		WritingTimeSection.render(panel, this.plugin).catch(() => {});
	}

	private renderWikiPanel(panel: HTMLElement) {
		panel.addClass('wm-dash-panel-single', 'wm-wiki-panel');
		if (!this.wikiPanel) {
			this.wikiPanel = new WikiPanel(this.plugin, this);
			this.plugin.wikiPanelRerender = () => this.wikiPanel?.rerender();
		}
		void this.wikiPanel.render(panel);
	}

	private renderVersionPanel(panel: HTMLElement) {
		panel.addClass('wm-dash-panel-single', 'version-control-view');
		VersionPanel.render(panel, this.plugin);
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

		const cfg: DashSectionConfig[] = this.plugin.settings.dashboardSections ?? [
			{ id: 'chars',  label: '글자수',   visible: true },
			{ id: 'time',   label: '작업시간', visible: true },
			{ id: 'tasks',  label: '할 일',    visible: true },
		];

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
		const tasks = await TaskParser.loadTasks(this.plugin);
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
	}

	private scrollToTasksSection(dateKey?: string) {
		const content = this.containerEl.children[1] as HTMLElement;
		const tasksWrap = content.querySelector('.wm-tasks-wrap');
		if (!tasksWrap) return;
		const groupBody = tasksWrap.closest('.wm-dash-group-body');
		let expandDelay = 0;
		if (groupBody?.classList.contains('is-collapsed')) {
			(groupBody.previousElementSibling as HTMLElement)?.click();
			expandDelay = 200;
		}
		window.setTimeout(() => {
			let section: HTMLElement | null = null;
			if (dateKey) {
				const targetItem = content.querySelector<HTMLElement>(`.wm-task-item[data-datekey="${dateKey}"]`);
				section = targetItem?.closest('.wm-tasks-section') as HTMLElement ?? null;
			}
			if (!section) section = content.querySelector('.wm-tasks-section');
			if (!section) return;
			if (section.classList.contains('is-collapsed')) {
				(section.querySelector('.wm-tasks-section-toggle') as HTMLElement)?.click();
			}
			section.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
		}, expandDelay);
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

	// ── Collapse handle ──────────────────────────────────────────────

	private renderCollapseHandle(container: HTMLElement) {
		const handle = container.createDiv({ cls: 'wm-cal-collapse-handle' });
		handle.createDiv({ cls: 'wm-cal-collapse-bar' });
		handle.addEventListener('click', () => {
			this.collapsed = !this.collapsed;
			this.render();
		});
	}

	// ── Utilities ────────────────────────────────────────────────────

	private removePopup() {
		this.popup?.remove();
		this.popup = null;
	}
}
