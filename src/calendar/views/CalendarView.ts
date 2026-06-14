import { ItemView, WorkspaceLeaf, setIcon, Menu, TFile, Notice } from 'obsidian';
import type WritingMenuPlugin from '../../../main';
import { DashboardSection } from '../../dashboard/DashboardSection';
import { TaskParser } from '../../dashboard/data/TaskParser';
import type { ParsedTask } from '../../dashboard/data/TaskParser';

export const VIEW_TYPE_CALENDAR = 'writing-menu-calendar';

const MONTH_KO    = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const DOW_KO      = ['일','월','화','수','목','금','토'];
const DOW_KO_FULL = ['일','월','화','수','목','금','토'];

export class CalendarView extends ItemView {
	plugin: WritingMenuPlugin;

	private selectedDate: Date;
	private viewMode: 'strip' | 'full' = 'strip';
	private collapsed  = false;

	private popup:           HTMLElement | null = null;
	private dateStripEl:     HTMLElement | null = null;
	private monthScrollerEl: HTMLElement | null = null;
	private dateDisplayEl:   HTMLElement | null = null;
	private navDebounceTimer = 0;

	private static dateKey(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
	}

	constructor(leaf: WorkspaceLeaf, plugin: WritingMenuPlugin) {
		super(leaf);
		this.plugin = plugin;
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		this.selectedDate = now;
	}

	getViewType()    { return VIEW_TYPE_CALENDAR; }
	getDisplayText() { return '캘린더'; }
	getIcon()        { return 'calendar'; }

	async onOpen()  { this.render(); }
	async onClose() { this.removePopup(); }

	// ── Root render ─────────────────────────────────────────────────

	render() {
		this.removePopup();
		const content = this.containerEl.children[1] as HTMLElement;
		content.empty();
		content.className = 'wm-cal-content';

		const wrap = content.createDiv({ cls: 'wm-cal-wrapper' });
		this.renderTopBar(wrap);

		if (!this.collapsed) {
			this.renderMonthScroller(wrap);
			if (this.viewMode === 'strip') {
				this.renderDateStrip(wrap);
			} else {
				this.renderFullGrid(wrap);
			}
		}

		this.renderCollapseHandle(wrap);

		// Dashboard — always visible regardless of collapsed state
		DashboardSection.render(wrap, this.plugin);

		// 태스크 데이터 비동기 로드 및 캘린더에 반영
		this.loadAndApplyTasks().catch(() => {});
	}

	// ── Top bar ─────────────────────────────────────────────────────

	private renderTopBar(container: HTMLElement) {
		const bar = container.createDiv({ cls: 'wm-cal-topbar' });

		// Left: date label + picker chevron
		const left = bar.createDiv({ cls: 'wm-cal-topbar-left' });

		this.dateDisplayEl = left.createSpan({ cls: 'wm-cal-date-display' });
		this.updateDateDisplay();
		// Click date text → jump to today
		this.dateDisplayEl.addEventListener('click', () => this.goToToday());

		const pickerBtn = left.createDiv({ cls: 'wm-cal-icon-btn' });
		setIcon(pickerBtn, 'chevron-right');
		pickerBtn.addEventListener('click', e => {
			e.stopPropagation();
			this.showDatePicker(pickerBtn);
		});

		// Right: search · view-toggle · dashboard
		const right = bar.createDiv({ cls: 'wm-cal-topbar-right' });

		const searchBtn = right.createDiv({ cls: 'wm-cal-icon-btn' });
		setIcon(searchBtn, 'search');
		searchBtn.addEventListener('click', () => {
			try { (this.app as any).commands.executeCommandById('global-search:open'); } catch {}
		});

		const viewBtn = right.createDiv({ cls: 'wm-cal-icon-btn' });
		setIcon(viewBtn, this.viewMode === 'full' ? 'minimize-2' : 'maximize-2');
		viewBtn.addEventListener('click', e => {
			e.stopPropagation();
			this.viewMode = this.viewMode === 'strip' ? 'full' : 'strip';
			this.render();
		});

		const dashBtn = right.createDiv({ cls: 'wm-cal-icon-btn' });
		setIcon(dashBtn, 'layout-dashboard');
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

	// ── Month scroller (snap-to-card picker) ────────────────────────

	private renderMonthScroller(container: HTMLElement) {
		const scroller = container.createDiv({ cls: 'wm-cal-month-scroll' });
		this.monthScrollerEl = scroller;

		const year    = this.selectedDate.getFullYear();
		const currMon = this.selectedDate.getMonth();
		const pills: HTMLElement[] = [];

		for (let m = 0; m < 12; m++) {
			const pill = scroller.createSpan({
				cls: m === currMon ? 'wm-cal-ms-month wm-cal-ms-curr' : 'wm-cal-ms-month',
				text: MONTH_KO[m],
			});
			pill.dataset.mon = String(m);
			pills.push(pill);
		}

		// Pill nearest to scroller center (O(12))
		const centerPill = (): HTMLElement | null => {
			const cp = scroller.scrollLeft + scroller.clientWidth / 2;
			let nearest: HTMLElement | null = null;
			let minDist = Infinity;
			for (const p of pills) {
				const dist = Math.abs(p.offsetLeft + p.offsetWidth / 2 - cp);
				if (dist < minDist) { minDist = dist; nearest = p; }
			}
			return nearest;
		};

		const snapToPill = (pill: HTMLElement, smooth = true) => {
			const target = pill.offsetLeft - scroller.clientWidth / 2 + pill.offsetWidth / 2;
			scroller.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
		};

		const selectPill = (pill: HTMLElement) => {
			pills.forEach(p => p.classList.toggle('wm-cal-ms-curr', p === pill));
			const mon = parseInt(pill.dataset.mon ?? '0');
			this.navigateToMonth(mon, year);
		};

		// Initial center
		requestAnimationFrame(() => snapToPill(pills[currMon], false));

		// Scroll: live pill highlight + full-calendar sync (debounced)
		let syncEnabled = false;
		requestAnimationFrame(() => requestAnimationFrame(() => { syncEnabled = true; }));
		scroller.addEventListener('scroll', () => {
			if (!syncEnabled) return;
			const p = centerPill();
			if (!p) return;
			pills.forEach(pp => pp.classList.toggle('wm-cal-ms-curr', pp === p));
			if (this.viewMode === 'full') {
				clearTimeout(this.navDebounceTimer);
				const mon = parseInt(p.dataset.mon ?? '0');
				this.navDebounceTimer = window.setTimeout(() => {
					this.navigateToMonth(mon, year);
				}, 220);
			}
		}, { passive: true });

		// Drag
		scroller.addEventListener('mousedown', e => {
			e.preventDefault();
			const startX = e.pageX, startL = scroller.scrollLeft;
			let isDragging = false, hasMoved = false;

			const onMove = (me: MouseEvent) => {
				const dx = me.pageX - startX;
				if (!isDragging && Math.abs(dx) > 4) { isDragging = true; scroller.style.cursor = 'grabbing'; }
				if (isDragging) { scroller.scrollLeft = startL - dx; hasMoved = true; }
			};
			const onUp = (ue: MouseEvent) => {
				scroller.style.cursor = '';
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				if (!hasMoved) {
					const t    = document.elementFromPoint(ue.clientX, ue.clientY) as HTMLElement | null;
					const pill = t?.closest('.wm-cal-ms-month') as HTMLElement | null;
					if (pill && pills.includes(pill)) { selectPill(pill); snapToPill(pill); }
				} else {
					const p = centerPill();
					if (p) { selectPill(p); snapToPill(p); }
				}
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	}

	// Navigate to a given month — handles both strip and full modes
	private navigateToMonth(mon: number, year: number) {
		clearTimeout(this.navDebounceTimer);
		this.navDebounceTimer = 0;
		const maxDay = new Date(year, mon + 1, 0).getDate();
		const day    = Math.min(this.selectedDate.getDate(), maxDay);
		this.selectedDate = new Date(year, mon, day);
		this.updateDateDisplay();

		if (this.viewMode === 'full') {
			this.render();
			return;
		}

		if (!this.dateStripEl) return;
		const strip = this.dateStripEl;
		const target = Array.from(strip.querySelectorAll<HTMLElement>('.wm-cal-date-card'))
			.find(c => c.dataset.ds === this.selectedDate.toDateString());
		if (target) {
			const left = target.offsetLeft - strip.clientWidth / 2 + target.offsetWidth / 2;
			strip.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
		}
	}

	// Jump to today
	private goToToday() {
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		this.selectedDate = now;
		this.updateDateDisplay();

		if (this.viewMode === 'full') {
			this.render();
			return;
		}

		if (this.dateStripEl) {
			const strip  = this.dateStripEl;
			const target = Array.from(strip.querySelectorAll<HTMLElement>('.wm-cal-date-card'))
				.find(c => c.dataset.ds === now.toDateString());
			if (target) {
				const left = target.offsetLeft - strip.clientWidth / 2 + target.offsetWidth / 2;
				strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
			}
		}
	}

	// ── Date strip (snap-to-card picker) ────────────────────────────

	private renderDateStrip(container: HTMLElement) {
		const CARD_W = 36;
		const GAP    = 10;
		const SLOT   = CARD_W + GAP;  // px per card slot

		const wrap  = container.createDiv({ cls: 'wm-cal-date-strip-wrap' });
		const strip = wrap.createDiv({ cls: 'wm-cal-date-strip' });
		this.dateStripEl = strip;

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const todayStr = today.toDateString();
		const yr       = today.getFullYear();
		const total    = Math.round((new Date(yr, 11, 31).getTime() - new Date(yr, 0, 1).getTime()) / 86400000) + 1;

		// ── Build cards ────────────────────────────────────────────
		const allCards: HTMLElement[] = [];
		for (let i = 0; i < total; i++) {
			const d = new Date(yr, 0, 1 + i);
			const ds = d.toDateString();

			const isWeekend = d.getDay() === 0 || d.getDay() === 6;
			const card = strip.createDiv({ cls: 'wm-cal-date-card' });
			if (ds === todayStr)                                     card.addClass('wm-cal-dc-today');
			if (ds === this.selectedDate.toDateString() && ds !== todayStr) card.addClass('wm-cal-dc-selected');
			if (isWeekend)                                           card.addClass('wm-cal-dc-weekend');

			card.createDiv({ cls: 'wm-cal-dc-dow', text: DOW_KO[d.getDay()] });
			card.createDiv({ cls: 'wm-cal-dc-num', text: String(d.getDate()) });

			card.dataset.month   = String(d.getMonth());
			card.dataset.ds      = ds;
			card.dataset.datekey = CalendarView.dateKey(d);
			allCards.push(card);
		}

		// ── Helpers ────────────────────────────────────────────────

		let lastMon    = this.selectedDate.getMonth();
		let activeCard = allCards.find(c => c.dataset.ds === this.selectedDate.toDateString()) ?? null;

		// Dim cards outside active month, sync month pill
		const setActiveMon = (mon: number) => {
			if (mon === lastMon) return;
			lastMon = mon;
			allCards.forEach(c => c.classList.toggle('wm-cal-dc-dim', parseInt(c.dataset.month ?? '0') !== mon));
			this.syncMonthScroller(mon);
		};

		// O(1) selection update — only touches prev & next card
		const selectCard = (card: HTMLElement) => {
			if (card === activeCard) return;
			if (activeCard?.dataset.ds !== todayStr) activeCard?.classList.remove('wm-cal-dc-selected');
			if (card.dataset.ds !== todayStr)         card.classList.add('wm-cal-dc-selected');
			activeCard = card;
			const ds = card.dataset.ds!;
			const d  = new Date(ds);
			this.selectedDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
			this.updateDateDisplay();
		};

		// Smooth-scroll to center a card in the strip viewport
		const snapToCard = (card: HTMLElement, smooth = true) => {
			const target = card.offsetLeft - strip.clientWidth / 2 + CARD_W / 2;
			strip.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
		};

		// Card at strip center given current scrollLeft
		const centerCard = (): HTMLElement | null => {
			const centerPos = strip.scrollLeft + strip.clientWidth / 2;
			const idx = Math.max(0, Math.min(Math.round((centerPos - CARD_W / 2) / SLOT), allCards.length - 1));
			return allCards[idx] ?? null;
		};

		// ── Initial state ───────────────────────────────────────────
		// Apply initial month dim without triggering setActiveMon guard
		allCards.forEach(c => c.classList.toggle('wm-cal-dc-dim', parseInt(c.dataset.month ?? '0') !== lastMon));

		let syncEnabled = false;
		requestAnimationFrame(() => {
			if (activeCard) snapToCard(activeCard, false);
			requestAnimationFrame(() => { syncEnabled = true; });
		});

		// ── Scroll listener: live update during drag ────────────────
		strip.addEventListener('scroll', () => {
			if (!syncEnabled) return;
			const c = centerCard();
			if (!c) return;
			// Update selection in real-time as strip scrolls
			selectCard(c);
			// Update month dim + pill when month boundary crossed
			const mon = parseInt(c.dataset.month ?? '0');
			setActiveMon(mon);
		}, { passive: true });

		// ── Drag: snap-to-card on release ───────────────────────────
		strip.addEventListener('mousedown', e => {
			e.preventDefault();
			const startX          = e.pageX;
			const startScrollLeft = strip.scrollLeft;
			let   isDragging      = false;
			let   hasMoved        = false;

			const onMove = (me: MouseEvent) => {
				const dx = me.pageX - startX;
				if (!isDragging && Math.abs(dx) > 4) {
					isDragging = true;
					strip.style.cursor = 'grabbing';
				}
				if (isDragging) {
					strip.scrollLeft = startScrollLeft - dx;
					hasMoved = true;
				}
			};

			const onUp = (ue: MouseEvent) => {
				strip.style.cursor = '';
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup',  onUp);

				if (!hasMoved) {
					// Tap on a specific card → select & center it (Ctrl = open daily note)
					const target = document.elementFromPoint(ue.clientX, ue.clientY) as HTMLElement | null;
					const card   = target?.closest('.wm-cal-date-card') as HTMLElement | null;
					if (card && allCards.includes(card)) {
						if (ue.ctrlKey || ue.metaKey) {
							const ds = card.dataset.ds;
							if (ds) this.openOrCreateDailyNote(new Date(ds));
						} else {
							selectCard(card);
							snapToCard(card);
							setActiveMon(parseInt(card.dataset.month ?? '0'));
						}
					}
				} else {
					// Drag release → snap to whichever card is now at center
					const c = centerCard();
					if (c) snapToCard(c);
				}
			};

			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup',  onUp);
		});
	}

	private syncMonthScroller(month: number) {
		if (!this.monthScrollerEl) return;
		this.monthScrollerEl.querySelectorAll('.wm-cal-ms-month').forEach((el, i) => {
			el.classList.toggle('wm-cal-ms-curr', i === month);
		});
		const curr = this.monthScrollerEl.querySelector('.wm-cal-ms-curr') as HTMLElement;
		curr?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
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
		const dow   = new Date(year, month, 1).getDay();  // 0=일
		const back  = dow;  // Sunday-first: no adjustment needed
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		for (let i = 0; i < 42; i++) {
			const d = new Date(year, month, 1 - back + i);

			const col       = i % 7;
			const isWeekend = col === 0 || col === 6;  // 일(0)·토(6)
			const isCurr    = d.getMonth() === month;
			const isToday   = d.toDateString() === today.toDateString();
			const isSel     = d.toDateString() === this.selectedDate.toDateString();

			const cell = grid.createDiv({ cls: 'wm-cal-cell' });
			if (isWeekend) cell.addClass('wm-cal-weekend');
			if (!isCurr)   cell.addClass('wm-cal-other');
			if (isToday)   cell.addClass('wm-cal-today');
			if (isSel)     cell.addClass('wm-cal-selected');
			if (isCurr)    cell.dataset.datekey = CalendarView.dateKey(d);

			cell.createDiv({ cls: 'wm-cal-num', text: String(d.getDate()) });

			cell.addEventListener('click', (e) => {
				if (e.ctrlKey || e.metaKey) {
					this.openOrCreateDailyNote(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
					return;
				}
				this.selectedDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
				this.render();
			});
		}
	}

	// ── Task data: load & apply ──────────────────────────────────────

	private async loadAndApplyTasks(): Promise<void> {
		const tasks = await TaskParser.loadTasks(this.plugin);
		const counts  = new Map<string, number>();
		const byDate  = new Map<string, ParsedTask[]>();
		for (const t of tasks) {
			if (t.completed) continue;
			const dk = CalendarView.dateKey(t.sourceDate);
			counts.set(dk, (counts.get(dk) ?? 0) + 1);
			if (!byDate.has(dk)) byDate.set(dk, []);
			byDate.get(dk)!.push(t);
		}

		const content = this.containerEl.children[1] as HTMLElement;

		// ── date strip 배지 ──
		content.querySelectorAll<HTMLElement>('.wm-cal-date-card[data-datekey]').forEach(card => {
			const dk = card.dataset.datekey;
			if (!dk) return;
			card.querySelector('.wm-cal-task-badge')?.remove();
			const count = counts.get(dk) ?? 0;
			if (count <= 0) return;
			const badge = card.createDiv({ cls: 'wm-cal-task-badge' });
			badge.textContent = String(count);
			badge.addEventListener('click', (e) => {
				e.stopPropagation();
				this.showTaskPreview(badge, byDate.get(dk) ?? []);
			});
		});

		// ── 풀 그리드 히트맵 색상 ──
		content.querySelectorAll<HTMLElement>('.wm-cal-cell[data-datekey]').forEach(cell => {
			const dk = cell.dataset.datekey;
			if (!dk) return;
			cell.classList.remove('wm-cal-task-level-1', 'wm-cal-task-level-2', 'wm-cal-task-level-3');
			const count = counts.get(dk) ?? 0;
			if (count <= 0) return;
			const level = count >= 4 ? 3 : count >= 2 ? 2 : 1;
			cell.classList.add(`wm-cal-task-level-${level}`);
			if (!cell.dataset.taskHover) {
				cell.dataset.taskHover = '1';
				cell.addEventListener('mouseenter', () => {
					const c = counts.get(dk) ?? 0;
					if (c > 0) this.showTaskPreview(cell, byDate.get(dk) ?? []);
				});
				cell.addEventListener('mouseleave', () => this.removePopup());
			}
		});
	}

	private showTaskPreview(anchor: HTMLElement, tasks: ParsedTask[]) {
		this.removePopup();
		const ppop = document.body.createDiv({ cls: 'wm-cal-task-preview wm-ver-popup' });
		for (const t of tasks.slice(0, 8)) {
			const item = ppop.createDiv({ cls: 'wm-ver-popup-item' });
			const dot  = item.createDiv({ cls: 'wm-ver-popup-icon' });
			setIcon(dot, 'circle');
			item.createSpan({ text: t.text || t.rawText });
		}
		if (tasks.length > 8) {
			ppop.createDiv({ cls: 'wm-ver-popup-section-label', text: `+${tasks.length - 8}개 더` });
		}
		this.popup = ppop;
		const rect = anchor.getBoundingClientRect();
		ppop.style.top  = `${rect.bottom + 4}px`;
		ppop.style.left = `${rect.left}px`;
		requestAnimationFrame(() => {
			const pr = ppop.getBoundingClientRect();
			if (pr.right  > window.innerWidth  - 10) ppop.style.left = `${window.innerWidth  - pr.width  - 10}px`;
			if (pr.bottom > window.innerHeight - 10) ppop.style.top  = `${rect.top - pr.height - 4}px`;
		});
		setTimeout(() => {
			const close = (ev: MouseEvent) => {
				if (!ppop.contains(ev.target as Node)) {
					this.removePopup();
					document.removeEventListener('click', close);
				}
			};
			document.addEventListener('click', close);
		}, 10);
	}

	// ── Daily note creation ──────────────────────────────────────────

	private async openOrCreateDailyNote(date: Date) {
		const dnPlugin = (this.app as any).internalPlugins?.plugins?.['daily-notes'];
		const options  = dnPlugin?.enabled ? dnPlugin?.instance?.options : null;
		const format   = options?.format || this.plugin.settings.dailyNotesFormat || 'YYYY-MM-DD';
		const folder   = options?.folder  || this.plugin.settings.dailyNotesFolder || '';

		const filename = (window as any).moment(date).format(format);
		const filePath = folder ? `${folder}/${filename}.md` : `${filename}.md`;

		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) {
			await this.app.workspace.getLeaf(false).openFile(existing);
			return;
		}
		try {
			if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
				await this.app.vault.createFolder(folder);
			}
			let content = '';
			if (options?.template) {
				const tp = options.template.endsWith('.md') ? options.template : options.template + '.md';
				const tmpl = this.app.vault.getAbstractFileByPath(tp);
				if (tmpl instanceof TFile) content = await this.app.vault.read(tmpl);
			}
			const newFile = await this.app.vault.create(filePath, content);
			await this.app.workspace.getLeaf(false).openFile(newFile);
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

	// ── View mode menu ───────────────────────────────────────────────

	private showViewMenu(anchor: HTMLElement) {
		const menu = new Menu();
		menu.addItem(i => i
			.setTitle('한 줄')
			.setIcon('rows-3')
			.setChecked(this.viewMode === 'strip')
			.onClick(() => { this.viewMode = 'strip'; this.render(); }));
		menu.addItem(i => i
			.setTitle('FULL')
			.setIcon('layout-grid')
			.setChecked(this.viewMode === 'full')
			.onClick(() => { this.viewMode = 'full'; this.render(); }));
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.right, y: rect.bottom + 4 });
	}

	// ── Date picker ──────────────────────────────────────────────────

	private showDatePicker(anchor: HTMLElement) {
		this.removePopup();

		let py = this.selectedDate.getFullYear();
		let pm = this.selectedDate.getMonth();

		const popup = document.body.createDiv({ cls: 'wm-cal-picker' });
		this.popup  = popup;

		// Header — created once
		const hdr     = popup.createDiv({ cls: 'wm-cal-picker-hdr' });
		const prevBtn = hdr.createDiv({ cls: 'wm-cal-icon-btn' });
		setIcon(prevBtn, 'chevron-left');
		const titleEl = hdr.createSpan({ cls: 'wm-cal-picker-title' });
		const nextBtn = hdr.createDiv({ cls: 'wm-cal-icon-btn' });
		setIcon(nextBtn, 'chevron-right');

		// Grid container — only cells rebuilt on navigation
		const gridEl = popup.createDiv({ cls: 'wm-cal-picker-grid' });

		const buildCells = () => {
			titleEl.textContent = `${py}년 ${MONTH_KO[pm]}`;
			gridEl.empty();

			for (const wd of ['월','화','수','목','금','토','일']) {
				gridEl.createDiv({ cls: 'wm-cal-picker-wd', text: wd });
			}

			const today = new Date(); today.setHours(0, 0, 0, 0);
			const dow   = new Date(py, pm, 1).getDay();
			const back  = (dow + 6) % 7;
			const sy = py, sm = pm;

			for (let i = 0; i < 42; i++) {
				const d    = new Date(sy, sm, 1 - back + i);
				const cell = gridEl.createDiv({ cls: 'wm-cal-picker-day', text: String(d.getDate()) });
				if (d.getMonth() !== sm)                                    cell.addClass('wm-cal-picker-other');
				if (d.toDateString() === today.toDateString())              cell.addClass('wm-cal-picker-today');
				if (d.toDateString() === this.selectedDate.toDateString())  cell.addClass('wm-cal-picker-sel');
				cell.addEventListener('click', e => {
					e.stopPropagation();
					this.selectedDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
					this.removePopup();
					this.render();
				});
			}
		};

		prevBtn.addEventListener('click', e => {
			e.stopPropagation();
			pm--; if (pm < 0) { pm = 11; py--; }
			buildCells();
		});
		nextBtn.addEventListener('click', e => {
			e.stopPropagation();
			pm++; if (pm > 11) { pm = 0; py++; }
			buildCells();
		});

		buildCells();

		// Position
		const rect = anchor.getBoundingClientRect();
		const pw   = 224;
		let left   = rect.left;
		if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
		popup.style.cssText = `left:${left}px;top:${rect.bottom + 6}px;width:${pw}px;`;

		// Close on outside click
		const close = (e: MouseEvent) => {
			if (!popup.contains(e.target as Node)) {
				this.removePopup();
				document.removeEventListener('click', close, true);
			}
		};
		setTimeout(() => document.addEventListener('click', close, true), 0);
	}

	// ── Utilities ────────────────────────────────────────────────────

	private removePopup() {
		this.popup?.remove();
		this.popup = null;
	}
}
