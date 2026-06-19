import { setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { ParsedTask } from './data/TaskParser';
import { TaskParser } from './data/TaskParser';
import { renderTaskItem, openPopupAutoClose } from './TaskItem';
import { showTaskAddPopup } from './TaskAddPopup';

const collapsedCats = new Set<string>();

type TaskSortField = 'title' | 'date' | 'priority';
type TaskSortDir   = 'asc' | 'desc';
interface SectionSort { field: TaskSortField; dir: TaskSortDir; }

const SECTIONS: Array<{ cat: ParsedTask['category']; label: string; icon: string }> = [
	{ cat: 'today',    label: '오늘', icon: 'calendar' },
	{ cat: 'upcoming', label: '예정', icon: 'clock' },
	{ cat: 'overdue',  label: '지연', icon: 'alert-circle' },
];

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

export class TasksRenderer {
	static render(container: HTMLElement, tasks: ParsedTask[], plugin: WritingMenuPlugin) {
		let liveTasks = [...tasks];
		const wrap = container.createDiv({ cls: 'wm-tasks-wrap' });

		// ── reload helpers ──
		let reloadTimer: number | null = null;

		const reloadAndRender = async () => {
			if (!wrap.isConnected) return;
			const newTasks = await TaskParser.loadTasks(plugin);
			if (!wrap.isConnected) return;
			liveTasks = [...newTasks];
			sectionRenders.forEach(fn => fn());
		};

		const scheduleReload = () => {
			if (reloadTimer) window.clearTimeout(reloadTimer);
			reloadTimer = window.setTimeout(reloadAndRender, 300);
		};

		const modifyRef = plugin.app.vault.on('modify', () => {
			if (!wrap.isConnected) { plugin.app.vault.offref(modifyRef); return; }
			scheduleReload();
		});
		plugin.registerEvent(modifyRef);

		// ── 헤더 ──
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
		addBtn.createSpan({ cls: 'wm-tasks-add-label', text: '할 일' });
		addBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			showTaskAddPopup(addBtn, plugin, scheduleReload);
		});

		// ── 섹션 정렬 상태 ──
		const sectionSorts = new Map<ParsedTask['category'], SectionSort>();
		for (const { cat } of SECTIONS) sectionSorts.set(cat, { field: 'date', dir: 'asc' });

		const sectionRenders = new Map<ParsedTask['category'], () => void>();

		// ── 섹션 루프 ──
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

			const filterBtn = sectionHeader.createDiv({ cls: 'wm-tasks-section-filter-btn' });
			setIcon(filterBtn, 'list-filter');

			const bodyEl = sectionEl.createDiv({ cls: 'wm-tasks-section-body' });

			sectionHeader.addEventListener('click', () => {
				sectionEl.classList.toggle('is-collapsed');
				collapsedCats[sectionEl.classList.contains('is-collapsed') ? 'add' : 'delete'](cat);
			});

			// ── filter 드롭다운 ──
			filterBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const btnDoc = filterBtn.ownerDocument;
				const btnWin = btnDoc.defaultView ?? window;
				const existingPop = btnDoc.querySelector('.wm-tasks-sort-popup');
				if (existingPop) { existingPop.remove(); return; }

				const sort = sectionSorts.get(cat)!;
				const fpop = btnDoc.body.createDiv({ cls: 'wm-tasks-sort-popup wm-ver-popup' });
				const r    = filterBtn.getBoundingClientRect();
				fpop.setCssStyles({ top: `${r.bottom + 4}px` });
				fpop.setCssStyles({ left: `${r.left}px` });

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
					if (sort.field === f.value) { const chk = fi.createDiv({ cls: 'wm-ver-popup-check' }); setIcon(chk, 'check'); }
					fi.addEventListener('click', (e2) => {
						e2.stopPropagation();
						sectionSorts.set(cat, { ...sort, field: f.value });
						fpop.remove();
						sectionRenders.get(cat)?.();
					});
				}

				fpop.createDiv({ cls: 'wm-ver-popup-separator' });

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
					if (sort.dir === dir.value) { const chk = di.createDiv({ cls: 'wm-ver-popup-check' }); setIcon(chk, 'check'); }
					di.addEventListener('click', (e2) => {
						e2.stopPropagation();
						sectionSorts.set(cat, { ...sectionSorts.get(cat)!, dir: dir.value });
						fpop.remove();
						sectionRenders.get(cat)?.();
					});
				}

				window.requestAnimationFrame(() => {
					const pr = fpop.getBoundingClientRect();
					if (pr.right  > btnWin.innerWidth  - 10) fpop.setCssStyles({ left: `${btnWin.innerWidth  - pr.width  - 10}px` });
					if (pr.bottom > btnWin.innerHeight - 10) fpop.setCssStyles({ top: `${r.top - pr.height - 4}px` });
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
				filterBtn.classList.toggle('is-active', sort.field !== 'date' || sort.dir !== 'asc');

				if (incomplete.length === 0 && complete.length === 0) {
					bodyEl.createDiv({ cls: 'wm-tasks-section-empty', text: '할 일이 없습니다.' });
					return;
				}
				for (const task of [...incomplete, ...complete]) {
					renderTaskItem(bodyEl, task, plugin, scheduleReload);
				}
			};

			renderSection();
			sectionRenders.set(cat, renderSection);
		}
	}
}
