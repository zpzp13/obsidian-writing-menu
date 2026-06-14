import { setIcon, TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { ParsedTask } from './data/TaskParser';
import { TaskParser } from './data/TaskParser';

const collapsedCats = new Set<string>();

type TaskSortField = 'title' | 'date' | 'priority';
type TaskSortDir   = 'asc' | 'desc';
interface SectionSort { field: TaskSortField; dir: TaskSortDir; }

const SECTIONS: Array<{ cat: ParsedTask['category']; label: string; icon: string }> = [
	{ cat: 'today',    label: '오늘', icon: 'calendar' },
	{ cat: 'upcoming', label: '예정', icon: 'clock' },
	{ cat: 'overdue',  label: '지연', icon: 'alert-circle' },
];

const PRIORITY_MAP = [
	{ label: '없음', emoji: '',   color: 'var(--text-faint)' },
	{ label: '낮음', emoji: '🔽', color: 'var(--color-blue)' },
	{ label: '보통', emoji: '🔼', color: 'var(--color-yellow)' },
	{ label: '높음', emoji: '🔺', color: 'var(--color-orange)' },
	{ label: '최고', emoji: '⏫', color: 'var(--color-red)' },
] as const;

const EMOJI_TO_PRIORITY: Record<string, string> = {
	'🔽': '낮음', '🔼': '보통', '🔺': '높음', '⏫': '최고', '⏬': '최저',
};

const PRIORITY_RANK: Record<string, number> = {
	'최고': 5, '높음': 4, '보통': 3, '낮음': 2, '최저': 1,
};

function applySort(items: ParsedTask[], s: SectionSort): ParsedTask[] {
	const d = s.dir === 'asc' ? 1 : -1;
	return [...items].sort((a, b) => {
		if (s.field === 'title')
			return d * a.text.localeCompare(b.text, 'ko');
		if (s.field === 'date')
			return d * (a.sourceDate.getTime() - b.sourceDate.getTime());
		if (s.field === 'priority')
			return d * ((PRIORITY_RANK[a.tasksMeta?.priority ?? ''] ?? 0)
			          - (PRIORITY_RANK[b.tasksMeta?.priority ?? ''] ?? 0));
		return 0;
	});
}

function openPopupAutoClose(popup: HTMLElement) {
	setTimeout(() => {
		const close = (ev: MouseEvent) => {
			if (!popup.contains(ev.target as Node)) {
				popup.remove();
				document.removeEventListener('click', close);
			}
		};
		document.addEventListener('click', close);
	}, 10);
}

export class TasksRenderer {
	static render(container: HTMLElement, tasks: ParsedTask[], plugin: WritingMenuPlugin) {
		let liveTasks = [...tasks];
		const wrap = container.createDiv({ cls: 'wm-tasks-wrap' });

		// ── reload helpers ────────────────────────────────────────────────
		let reloadTimer: ReturnType<typeof setTimeout> | null = null;

		const reloadAndRender = async () => {
			if (!wrap.isConnected) return;
			const newTasks = await TaskParser.loadTasks(plugin);
			if (!wrap.isConnected) return;
			liveTasks = [...newTasks];
			sectionRenders.forEach(fn => fn());
		};

		const scheduleReload = () => {
			if (reloadTimer) clearTimeout(reloadTimer);
			reloadTimer = setTimeout(reloadAndRender, 300);
		};

		const modifyRef = plugin.app.vault.on('modify', () => {
			if (!wrap.isConnected) { plugin.app.vault.offref(modifyRef); return; }
			scheduleReload();
		});
		plugin.registerEvent(modifyRef);

		// ── 헤더 ──────────────────────────────────────────────────────────
		const header = wrap.createDiv({ cls: 'wm-tasks-header' });
		const titleGroup = header.createDiv({ cls: 'wm-tasks-title-group' });
		titleGroup.createDiv({ cls: 'wm-tasks-title', text: "Today's Task" });
		const now = new Date();
		titleGroup.createDiv({
			cls: 'wm-tasks-date',
			text: `${now.getMonth() + 1}월 ${now.getDate()}일, ${now.getFullYear()}`,
		});

		const addBtn = header.createDiv({ cls: 'wm-tasks-add-btn' });
		const addIcon = addBtn.createSpan({ cls: 'wm-tasks-add-icon' });
		setIcon(addIcon, 'plus');
		addBtn.createSpan({ cls: 'wm-tasks-add-label', text: '할 일 추가하기' });
		addBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			document.querySelector('.wm-task-add-popup')?.remove();

			const popup = document.body.createDiv({ cls: 'wm-task-add-popup wm-ver-popup' });
			const rect  = addBtn.getBoundingClientRect();
			popup.style.top   = `${rect.bottom + 6}px`;
			popup.style.right = `${window.innerWidth - rect.right}px`;

			// 날짜 선택 (최상단)
			const todayStr = (window as any).moment().format('YYYY-MM-DD');
			let selectedDate = todayStr;

			const dateRow = popup.createDiv({ cls: 'wm-task-add-field wm-task-add-date-row' });
			const dateInput = dateRow.createEl('input', {
				type: 'text', cls: 'wm-task-add-input wm-task-add-date-input',
				attr: { placeholder: 'YYYY-MM-DD (오늘)', value: todayStr },
			});
			const calBtn = dateRow.createDiv({ cls: 'wm-task-add-cal-btn' });
			setIcon(calBtn, 'calendar');

			dateInput.addEventListener('input', () => {
				const v = dateInput.value.trim();
				if (/^\d{4}-\d{2}-\d{2}$/.test(v)) selectedDate = v;
			});

			calBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				document.querySelector('.wm-mini-date-picker')?.remove();

				let py = parseInt(selectedDate.slice(0, 4));
				let pm = parseInt(selectedDate.slice(5, 7)) - 1;
				const today2 = new Date();

				const dpop = document.body.createDiv({ cls: 'wm-mini-date-picker wm-ver-popup' });
				const dhdr = dpop.createDiv({ cls: 'wm-mini-picker-hdr' });
				const dprev = dhdr.createDiv({ cls: 'wm-cal-icon-btn' });
				setIcon(dprev, 'chevron-left');
				const dtitle = dhdr.createSpan({ cls: 'wm-mini-picker-title' });
				const dnext = dhdr.createDiv({ cls: 'wm-cal-icon-btn' });
				setIcon(dnext, 'chevron-right');
				const dgrid = dpop.createDiv({ cls: 'wm-mini-picker-grid' });

				const DOW_S = ['일','월','화','수','목','금','토'];
				const buildPicker = () => {
					dtitle.textContent = `${py}년 ${pm + 1}월`;
					dgrid.empty();
					for (const d of DOW_S) dgrid.createDiv({ cls: 'wm-mini-picker-dow', text: d });
					const dow = new Date(py, pm, 1).getDay();
					for (let i = 0; i < 42; i++) {
						const d = new Date(py, pm, 1 - dow + i);
						const dk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
						const cls = ['wm-mini-picker-cell',
							d.getMonth() !== pm ? 'is-other' : '',
							dk === selectedDate ? 'is-sel' : '',
							d.toDateString() === today2.toDateString() ? 'is-today' : '',
						].filter(Boolean).join(' ');
						const cell = dgrid.createDiv({ cls });
						cell.textContent = String(d.getDate());
						cell.addEventListener('click', (ce) => {
							ce.stopPropagation();
							dpop.remove();
							selectedDate = dk;
							dateInput.value = dk;
						});
					}
				};
				dprev.addEventListener('click', (ce) => { ce.stopPropagation(); pm--; if (pm < 0) { pm = 11; py--; } buildPicker(); });
				dnext.addEventListener('click', (ce) => { ce.stopPropagation(); pm++; if (pm > 11) { pm = 0; py++; } buildPicker(); });
				buildPicker();

				const cr = calBtn.getBoundingClientRect();
				dpop.style.top  = `${cr.bottom + 4}px`;
				dpop.style.left = `${cr.left}px`;
				requestAnimationFrame(() => {
					const pr = dpop.getBoundingClientRect();
					if (pr.right > window.innerWidth - 10) dpop.style.left = `${window.innerWidth - pr.width - 10}px`;
					if (pr.bottom > window.innerHeight - 10) dpop.style.top = `${cr.top - pr.height - 4}px`;
				});
				setTimeout(() => {
					const closePicker = (ev: MouseEvent) => {
						if (!dpop.contains(ev.target as Node)) { dpop.remove(); document.removeEventListener('click', closePicker); }
					};
					document.addEventListener('click', closePicker);
				}, 10);
			});

			// 내용
			const contentRow = popup.createDiv({ cls: 'wm-task-add-field' });
			const contentInput = contentRow.createEl('input', {
				type: 'text', cls: 'wm-task-add-input',
				attr: { placeholder: '할 일 제목' },
			});

			// 태그
			const tagRow = popup.createDiv({ cls: 'wm-task-add-field' });
			const tagInput = tagRow.createEl('input', {
				type: 'text', cls: 'wm-task-add-input',
				attr: { placeholder: '#태그1 #태그2' },
			});

			// 하위항목
			const subRow = popup.createDiv({ cls: 'wm-task-add-field' });
			const subArea = subRow.createEl('textarea', {
				cls: 'wm-task-add-textarea',
				attr: { placeholder: '하위항목 (줄바꿈으로 구분)', rows: '3' },
			});

			const close  = () => popup.remove();
			const submit = async () => {
				const title = contentInput.value.trim();
				if (!title) { close(); return; }
				const tags = tagInput.value.trim()
					.split(/[\s,]+/).filter(Boolean)
					.map((t: string) => t.startsWith('#') ? t : `#${t}`)
					.join(' ');
				const dateEmoji = selectedDate !== todayStr ? ` 📅 ${selectedDate}` : '';
				const text = (tags ? `${title} ${tags}` : title) + dateEmoji;
				const subItems = subArea.value.split('\n').map((l: string) => l.trim()).filter(Boolean);
				try { await TaskParser.addTaskToDailyNote(text, plugin, subItems); } catch {}
				close();
				scheduleReload();
			};

			contentInput.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter')  { ev.preventDefault(); tagInput.focus(); }
				if (ev.key === 'Escape') close();
			});
			tagInput.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter')  { ev.preventDefault(); subArea.focus(); }
				if (ev.key === 'Escape') close();
			});
			subArea.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); submit(); }
				if (ev.key === 'Escape') close();
			});
			openPopupAutoClose(popup);
			contentInput.focus();
		});

		// ── 섹션 정렬 상태 ────────────────────────────────────────────────
		const sectionSorts = new Map<ParsedTask['category'], SectionSort>();
		for (const { cat } of SECTIONS) sectionSorts.set(cat, { field: 'date', dir: 'asc' });

		// ── 섹션 렌더링 ───────────────────────────────────────────────────
		const sectionRenders = new Map<ParsedTask['category'], () => void>();

		const renderTaskItem = (container: HTMLElement, task: ParsedTask) => {
			const item = container.createDiv({ cls: 'wm-task-item' });

			const check = item.createDiv({ cls: 'wm-task-item-check' });
			setIcon(check, 'check');
			if (task.completed) check.classList.add('is-done');

			const content = item.createDiv({ cls: 'wm-task-item-content' });

			const titleEl = content.createDiv({ cls: 'wm-task-item-title', text: task.text });
			if (task.completed) titleEl.classList.add('is-done');

			titleEl.addEventListener('click', async () => {
				const file = plugin.app.vault.getAbstractFileByPath(task.sourcePath);
				if (!(file instanceof TFile)) return;
				const raw   = await plugin.app.vault.cachedRead(file);
				const lines = raw.split('\n');
				const taskRe = /^[\s\t]*-\s+\[[ x]\]\s+/;
				const target = task.rawText || task.text;
				const lineIdx = lines.findIndex(l => {
					if (!taskRe.test(l)) return false;
					const rest = l.replace(taskRe, '');
					return rest === target || rest.startsWith(target + ' ') || rest.startsWith(target + '\t');
				});
				const leaf = plugin.app.workspace.getLeaf(false);
				await leaf.openFile(file, lineIdx >= 0 ? { eState: { line: lineIdx, col: 0 } } : undefined);
				if (lineIdx >= 0) {
					setTimeout(() => {
						const editor = (leaf.view as any)?.editor;
						if (!editor) return;
						editor.setSelection(
							{ line: lineIdx, ch: 0 },
							{ line: lineIdx, ch: lines[lineIdx].length },
						);
						editor.scrollIntoView(
							{ from: { line: lineIdx, ch: 0 }, to: { line: lineIdx, ch: lines[lineIdx].length } },
							true,
						);
						// 배경색 대비 하이라이트
						const editorDom: HTMLElement | undefined = editor?.cm?.dom;
						if (editorDom) {
							const bg = window.getComputedStyle(editorDom).backgroundColor;
							const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
							if (m) {
								const lum = (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
								editorDom.style.setProperty('--text-selection',
									lum > 0.45 ? 'rgba(37, 99, 235, 0.28)' : 'rgba(250, 204, 21, 0.38)');
								setTimeout(() => editorDom.style.removeProperty('--text-selection'), 2500);
							}
						}
					}, 150);
				}
			});

			// ── 메타 행 (날짜 + 태그 + flag 버튼) ──
			const metaRow  = content.createDiv({ cls: 'wm-task-item-meta' });
			const metaLeft = metaRow.createDiv({ cls: 'wm-task-item-meta-left' });

			const d = task.sourceDate;
			const catCls = task.category === 'overdue'  ? ' is-overdue'
			             : task.category === 'today'    ? ' is-today'
			             : task.category === 'upcoming' ? ' is-upcoming' : '';
			const dateEl = metaLeft.createDiv({ cls: 'wm-task-item-date' + catCls });
			const dateIconEl = dateEl.createSpan({ cls: 'wm-task-item-date-icon' });
			setIcon(dateIconEl, 'calendar');
			dateEl.createSpan({ text: `${d.getMonth() + 1}월 ${d.getDate()}일` });

			for (const tag of task.tags ?? []) {
				metaLeft.createSpan({ cls: 'wm-task-item-tag', text: tag });
			}

			// ── 우선순위 flag 버튼 ──
			const currentPriority = task.tasksMeta?.priority ?? '';
			const currentColor = PRIORITY_MAP.find(p => EMOJI_TO_PRIORITY[p.emoji] === currentPriority)?.color
			                  ?? 'var(--text-faint)';

			const flagBtn = metaRow.createDiv({ cls: 'wm-task-item-flag-btn' });
			const flagIconEl = flagBtn.createSpan({ cls: 'wm-task-item-flag-icon' });
			setIcon(flagIconEl, 'flag');
			flagIconEl.style.color = currentColor;

			flagBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				document.querySelector('.wm-task-priority-popup')?.remove();

				const ppop = document.body.createDiv({ cls: 'wm-task-priority-popup wm-ver-popup' });
				const r    = flagBtn.getBoundingClientRect();
				ppop.style.top  = `${r.bottom + 4}px`;
				ppop.style.left = `${r.left}px`;

				for (const p of PRIORITY_MAP) {
					const pitem = ppop.createDiv({ cls: 'wm-ver-popup-item' + (p.color === currentColor ? ' is-active' : '') });
					const dot   = pitem.createDiv({ cls: 'wm-task-priority-dot' });
					dot.style.background = p.color;
					pitem.createSpan({ text: p.label });
					pitem.addEventListener('click', async (e2) => {
						e2.stopPropagation();
						ppop.remove();
						try { await TaskParser.setTaskPriority(task, p.emoji, plugin); } catch {}
					});
				}

				// 화면 밖 보정
				requestAnimationFrame(() => {
					const pr = ppop.getBoundingClientRect();
					if (pr.right  > window.innerWidth  - 10) ppop.style.left = `${window.innerWidth  - pr.width  - 10}px`;
					if (pr.bottom > window.innerHeight - 10) ppop.style.top  = `${r.top - pr.height - 4}px`;
				});
				openPopupAutoClose(ppop);
			});

			// ── 체크 클릭 ──
			check.addEventListener('click', async () => {
				if (check.classList.contains('is-done') || task.completed) return;
				check.classList.add('is-done');
				titleEl.classList.add('is-done');
				try { await TaskParser.completeTask(task, plugin); } catch {}
				// vault modify → scheduleReload(300ms) → 자동 재렌더링
			});
		};

		// ── 섹션 루프 ────────────────────────────────────────────────────
		for (const { cat, label, icon } of SECTIONS) {
			const sectionEl = wrap.createDiv({ cls: 'wm-tasks-section' });
			sectionEl.dataset.cat = cat;
			if (collapsedCats.has(cat)) sectionEl.classList.add('is-collapsed');

			const sectionHeader = sectionEl.createDiv({ cls: 'wm-tasks-section-header' });
			const headerLeft = sectionHeader.createDiv({ cls: 'wm-tasks-section-header-left' });
			const toggleEl = headerLeft.createDiv({ cls: 'wm-tasks-section-toggle' });
			setIcon(toggleEl, 'chevron-down');
			const iconEl = headerLeft.createDiv({ cls: 'wm-tasks-section-icon' });
			setIcon(iconEl, icon);
			headerLeft.createSpan({ cls: 'wm-tasks-section-label', text: label });
			const countEl = headerLeft.createSpan({ cls: 'wm-tasks-section-count' });

			// ── filter 버튼 ──
			const filterBtn = sectionHeader.createDiv({ cls: 'wm-tasks-section-filter-btn' });
			setIcon(filterBtn, 'list-filter');

			const bodyEl = sectionEl.createDiv({ cls: 'wm-tasks-section-body' });

			headerLeft.addEventListener('click', () => {
				sectionEl.classList.toggle('is-collapsed');
				collapsedCats[sectionEl.classList.contains('is-collapsed') ? 'add' : 'delete'](cat);
			});

			// ── filter 드롭다운 ──
			filterBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const existingPop = document.querySelector('.wm-tasks-sort-popup');
				if (existingPop) { existingPop.remove(); return; }

				const sort = sectionSorts.get(cat)!;
				const fpop = document.body.createDiv({ cls: 'wm-tasks-sort-popup wm-ver-popup' });
				const r    = filterBtn.getBoundingClientRect();
				fpop.style.top  = `${r.bottom + 4}px`;
				fpop.style.left = `${r.left}px`;

				// 섹션1: 정렬 기준
				fpop.createDiv({ cls: 'wm-ver-popup-section-label', text: '정렬 기준' });
				const FIELDS: { label: string; value: TaskSortField; icon: string }[] = [
					{ label: '제목',   value: 'title',    icon: 'type' },
					{ label: '날짜',   value: 'date',     icon: 'calendar' },
					{ label: '중요도', value: 'priority', icon: 'flag' },
				];
				for (const f of FIELDS) {
					const fi = fpop.createDiv({ cls: 'wm-ver-popup-item' + (sort.field === f.value ? ' is-active' : '') });
					const fiIcon = fi.createDiv({ cls: 'wm-ver-popup-icon' });
					setIcon(fiIcon, f.icon);
					fi.createSpan({ text: f.label });
					if (sort.field === f.value) {
						const chk = fi.createDiv({ cls: 'wm-ver-popup-check' });
						setIcon(chk, 'check');
					}
					fi.addEventListener('click', (e2) => {
						e2.stopPropagation();
						sectionSorts.set(cat, { ...sort, field: f.value });
						fpop.remove();
						sectionRenders.get(cat)?.();
					});
				}

				fpop.createDiv({ cls: 'wm-ver-popup-separator' });

				// 섹션2: 순서
				fpop.createDiv({ cls: 'wm-ver-popup-section-label', text: '순서' });
				const DIRS: { label: string; value: TaskSortDir; icon: string }[] = [
					{ label: '오름차순', value: 'asc',  icon: 'arrow-up-narrow-wide' },
					{ label: '내림차순', value: 'desc', icon: 'arrow-down-wide-narrow' },
				];
				for (const dir of DIRS) {
					const di = fpop.createDiv({ cls: 'wm-ver-popup-item' + (sort.dir === dir.value ? ' is-active' : '') });
					const diIcon = di.createDiv({ cls: 'wm-ver-popup-icon' });
					setIcon(diIcon, dir.icon);
					di.createSpan({ text: dir.label });
					if (sort.dir === dir.value) {
						const chk = di.createDiv({ cls: 'wm-ver-popup-check' });
						setIcon(chk, 'check');
					}
					di.addEventListener('click', (e2) => {
						e2.stopPropagation();
						sectionSorts.set(cat, { ...sectionSorts.get(cat)!, dir: dir.value });
						fpop.remove();
						sectionRenders.get(cat)?.();
					});
				}

				// 화면 밖 보정
				requestAnimationFrame(() => {
					const pr = fpop.getBoundingClientRect();
					if (pr.right  > window.innerWidth  - 10) fpop.style.left = `${window.innerWidth  - pr.width  - 10}px`;
					if (pr.bottom > window.innerHeight - 10) fpop.style.top  = `${r.top - pr.height - 4}px`;
				});
				openPopupAutoClose(fpop);
			});

			const renderSection = () => {
				bodyEl.empty();
				const sort       = sectionSorts.get(cat)!;
				const all        = liveTasks.filter(t => t.category === cat);
				const incomplete = applySort(all.filter(t => !t.completed), sort);
				const complete   = all.filter(t => t.completed);

				countEl.textContent = String(incomplete.length);
				const filterActive = sort.field !== 'date' || sort.dir !== 'asc';
				filterBtn.classList.toggle('is-active', filterActive);

				if (incomplete.length === 0 && complete.length === 0) {
					return;
				}
				for (const task of [...incomplete, ...complete]) {
					renderTaskItem(bodyEl, task);
				}
			};

			renderSection();
			sectionRenders.set(cat, renderSection);
		}
	}
}
