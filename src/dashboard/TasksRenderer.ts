import { setIcon, TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { ParsedTask } from './data/TaskParser';
import { TaskParser } from './data/TaskParser';
import { renderTaskItem } from './TaskItem';
import { showTaskAddPopup } from './TaskAddPopup';
import { formatDateKey } from '../utils/dateUtils';

type AgendaFilter = 'all' | 'open' | 'done';
type AgendaSort = 'default' | 'priority' | 'title';

const PRIORITY_RANK: Record<string, number> = {
	'최고': 5,
	'높음': 4,
	'보통': 3,
	'낮음': 2,
	'최저': 1,
};

function sortTasks(items: ParsedTask[], sort: AgendaSort): ParsedTask[] {
	return [...items].sort((a, b) => {
		// 정렬 방식과 무관하게 완료 항목은 항상 미완료 항목 아래에 둔다.
		const completionOrder = Number(Boolean(a.completed)) - Number(Boolean(b.completed));
		if (completionOrder !== 0) return completionOrder;
		if (sort === 'priority') {
			return (PRIORITY_RANK[b.tasksMeta?.priority ?? ''] ?? 0)
				- (PRIORITY_RANK[a.tasksMeta?.priority ?? ''] ?? 0);
		}
		if (sort === 'title') return a.text.localeCompare(b.text, 'ko');
		return 0;
	});
}

export class TasksRenderer {
	static render(
		container: HTMLElement,
		tasks: ParsedTask[],
		plugin: WritingMenuPlugin,
		compact?: HTMLElement,
		selectedDate = new Date(),
		docked = false,
	) {
		let liveTasks = [...tasks];
		let filter: AgendaFilter = 'all';
		let sort: AgendaSort = 'default';
		const selectedKey = formatDateKey(selectedDate);
		const wrap = container.createDiv({ cls: 'wm-tasks-wrap wm-tasks-agenda' });
		if (docked) wrap.addClass('is-calendar-docked');
		wrap.dataset.selectedDate = selectedKey;

		let reloadTimer: number | null = null;
		const scheduleReload = () => {
			if (reloadTimer) window.clearTimeout(reloadTimer);
			reloadTimer = window.setTimeout(() => {
				void TaskParser.loadTasks(plugin, selectedDate).then(next => {
					if (!wrap.isConnected) return;
					liveTasks = next;
					renderList();
				});
			}, 220);
		};

		const modifyRef = plugin.app.vault.on('modify', (file) => {
			if (!wrap.isConnected) {
				plugin.app.vault.offref(modifyRef);
				return;
			}
			if (!(file instanceof TFile) || !TaskParser.isDailyNoteFile(file, plugin)) return;
			scheduleReload();
		});
		plugin.registerEvent(modifyRef);

		const header = wrap.createDiv({ cls: 'wm-tasks-header wm-tasks-agenda-header' });
		const titleGroup = header.createDiv({ cls: 'wm-tasks-title-group' });
		titleGroup.createDiv({ cls: 'wm-tasks-agenda-kicker', text: 'SELECTED DAY' });
		titleGroup.createDiv({
			cls: 'wm-tasks-title',
			text: selectedDate.toLocaleDateString('ko-KR', {
				month: 'long', day: 'numeric', weekday: 'long',
			}),
		});
		const addBtn = header.createEl('button', {
			cls: 'wm-tasks-add-btn',
			attr: { type: 'button', 'aria-label': '선택한 날짜에 할 일 추가' },
		});
		const addIcon = addBtn.createSpan({ cls: 'wm-tasks-add-icon' });
		setIcon(addIcon, 'plus');
		addBtn.createSpan({ cls: 'wm-tasks-add-label', text: 'TASK' });
		addBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			showTaskAddPopup(addBtn, plugin, scheduleReload, selectedDate);
		});

		const toolbar = wrap.createDiv({ cls: 'wm-tasks-agenda-toolbar' });
		const filters = toolbar.createDiv({ cls: 'wm-tasks-agenda-filters', attr: { role: 'group', 'aria-label': '할 일 필터' } });
		const filterButtons = new Map<AgendaFilter, HTMLButtonElement>();
		for (const item of [
			{ id: 'all' as const, label: 'ALL' },
			{ id: 'open' as const, label: 'TODO' },
			{ id: 'done' as const, label: 'DONE' },
		]) {
			const button = filters.createEl('button', {
				text: item.label,
				attr: { type: 'button', 'aria-pressed': String(filter === item.id) },
			});
			filterButtons.set(item.id, button);
			button.addEventListener('click', () => {
				filter = item.id;
				for (const [id, other] of filterButtons) other.setAttribute('aria-pressed', String(id === filter));
				renderList();
			});
		}

		const sortBtn = toolbar.createEl('button', {
			cls: 'wm-tasks-agenda-sort',
			attr: { type: 'button', 'aria-label': '기본 순서' },
		});
		setIcon(sortBtn, 'arrow-up-down');
		sortBtn.addEventListener('click', () => {
			sort = sort === 'default' ? 'priority' : sort === 'priority' ? 'title' : 'default';
			sortBtn.setAttribute('aria-label', sort === 'priority' ? '우선순위 순' : sort === 'title' ? '제목 순' : '기본 순서');
			sortBtn.toggleClass('is-active', sort !== 'default');
			renderList();
		});

		const count = toolbar.createSpan({ cls: 'wm-tasks-agenda-count' });
		const body = wrap.createDiv({ cls: 'wm-tasks-agenda-list' });

		const renderCompact = (dayTasks: ParsedTask[]) => {
			if (!compact) return;
			compact.empty();
			compact.createSpan({
				cls: 'wm-tasks-section-count',
				text: String(dayTasks.filter(task => !task.completed).length),
			});
		};

		function renderList() {
			body.empty();
			const dayTasks = liveTasks.filter(task => formatDateKey(task.sourceDate) === selectedKey);
			const openCount = dayTasks.filter(task => !task.completed).length;
			count.textContent = `${openCount} LEFT`;
			renderCompact(dayTasks);

			const visible = sortTasks(dayTasks.filter(task => {
				if (filter === 'open') return !task.completed;
				if (filter === 'done') return Boolean(task.completed);
				return true;
			}), sort);
			wrap.toggleClass('is-empty', visible.length === 0);

			if (visible.length === 0) {
				if (docked) return;
				const empty = body.createDiv({ cls: 'wm-tasks-agenda-empty' });
				const icon = empty.createSpan({ cls: 'wm-tasks-agenda-empty-icon' });
				setIcon(icon, 'circle-check-big');
				empty.createSpan({
					text: filter === 'all' ? '이 날짜에는 할 일이 없습니다.' : '표시할 할 일이 없습니다.',
				});
				return;
			}

			for (const task of visible) renderTaskItem(body, task, plugin);
		}

		renderList();
	}
}
