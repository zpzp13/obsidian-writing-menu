import { setIcon, TFile, MarkdownView } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { ParsedTask } from './data/TaskParser';
import { TaskParser } from './data/TaskParser';
import { formatDateKey } from '../utils/dateUtils';

export const PRIORITY_MAP = [
	{ label: '없음', emoji: '',   color: 'var(--text-faint)' },
	{ label: '낮음', emoji: '🔽', color: 'var(--color-blue)' },
	{ label: '보통', emoji: '🔼', color: 'var(--color-yellow)' },
	{ label: '높음', emoji: '🔺', color: 'var(--color-orange)' },
	{ label: '최고', emoji: '⏫', color: 'var(--color-red)' },
] as const;

export const EMOJI_TO_PRIORITY: Record<string, string> = {
	'🔽': '낮음', '🔼': '보통', '🔺': '높음', '⏫': '최고', '⏬': '최저',
};

export function openPopupAutoClose(popup: HTMLElement) {
	const doc = popup.ownerDocument;
	window.setTimeout(() => {
		const close = (ev: MouseEvent) => {
			if (!popup.contains(ev.target as Node)) {
				popup.remove();
				doc.removeEventListener('click', close);
			}
		};
		doc.addEventListener('click', close);
	}, 10);
}

export function renderTaskItem(
	container: HTMLElement,
	task: ParsedTask,
	plugin: WritingMenuPlugin,
	scheduleReload: () => void,
): void {
	const item = container.createDiv({ cls: 'wm-task-item' });
	const dkDate = task.tasksMeta?.due
		? task.tasksMeta.due
		: formatDateKey(task.sourceDate);
	item.dataset.datekey = dkDate;

	const content  = item.createDiv({ cls: 'wm-task-item-content' });
	const titleRow = content.createDiv({ cls: 'wm-task-item-title-row' });
	const titleEl  = titleRow.createDiv({ cls: 'wm-task-item-title', text: task.text });
	if (task.completed) titleEl.classList.add('is-done');
	const check = titleRow.createDiv({ cls: 'wm-task-item-check' });
	setIcon(check, task.completed ? 'check-circle-2' : 'circle');
	if (task.completed) check.classList.add('is-done');

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
			window.setTimeout(() => {
				const editor = (leaf.view instanceof MarkdownView) ? leaf.view.editor : null;
				if (!editor) return;
				editor.setCursor({ line: lineIdx, ch: 0 });
				editor.scrollIntoView(
					{ from: { line: lineIdx, ch: 0 }, to: { line: lineIdx, ch: 0 } },
					true,
				);
			}, 150);
		}
	});

	// ── 하위 항목 ──
	if (task.subItems?.length) {
		const subList = content.createDiv({ cls: 'wm-task-sub-list' });
		task.subItems.forEach((sub, idx) => {
			const subItem  = subList.createDiv({ cls: 'wm-task-sub-item' });
			const subCheck = subItem.createDiv({ cls: 'wm-task-sub-check' });
			setIcon(subCheck, 'check');
			if (sub.completed) { subCheck.classList.add('is-done'); subItem.classList.add('is-done'); }
			subItem.createSpan({ cls: 'wm-task-sub-text', text: sub.text });
			subCheck.addEventListener('click', async (e) => {
				e.stopPropagation();
				const nowDone = !subCheck.classList.contains('is-done');
				subCheck.classList.toggle('is-done', nowDone);
				subItem.classList.toggle('is-done', nowDone);
				sub.completed = nowDone;
				try { await TaskParser.toggleSubTask(task, idx, nowDone, plugin); } catch { /* intentional */ }
			});
		});
	}

	// ── 메타 행 ──
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
	flagIconEl.setCssStyles({ color: currentColor });

	flagBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const btnDoc = flagBtn.ownerDocument;
		const btnWin = btnDoc.defaultView ?? window;
		btnDoc.querySelector('.wm-task-priority-popup')?.remove();

		const ppop = btnDoc.body.createDiv({ cls: 'wm-task-priority-popup wm-ver-popup' });
		const r    = flagBtn.getBoundingClientRect();
		ppop.setCssStyles({ top: `${r.bottom + 4}px` });
		ppop.setCssStyles({ left: `${r.left}px` });

		for (const p of PRIORITY_MAP) {
			const pitem = ppop.createDiv({ cls: 'wm-ver-popup-item' + (p.color === currentColor ? ' is-active' : '') });
			const dot   = pitem.createDiv({ cls: 'wm-task-priority-dot' });
			dot.setCssStyles({ background: p.color });
			pitem.createSpan({ text: p.label });
			pitem.addEventListener('click', async (e2) => {
				e2.stopPropagation();
				ppop.remove();
				try { await TaskParser.setTaskPriority(task, p.emoji, plugin); } catch { /* intentional */ }
			});
		}

		window.requestAnimationFrame(() => {
			const pr = ppop.getBoundingClientRect();
			if (pr.right  > btnWin.innerWidth  - 10) ppop.setCssStyles({ left: `${btnWin.innerWidth  - pr.width  - 10}px` });
			if (pr.bottom > btnWin.innerHeight - 10) ppop.setCssStyles({ top: `${r.top - pr.height - 4}px` });
		});
		openPopupAutoClose(ppop);
	});

	// ── 체크 클릭 ──
	check.addEventListener('click', async () => {
		const nowDone = !check.classList.contains('is-done');
		check.classList.toggle('is-done', nowDone);
		titleEl.classList.toggle('is-done', nowDone);
		setIcon(check, nowDone ? 'check-circle-2' : 'circle');
		task.completed = nowDone || undefined;
		try { await TaskParser.toggleTask(task, nowDone, plugin); } catch { /* intentional */ }
	});
}
