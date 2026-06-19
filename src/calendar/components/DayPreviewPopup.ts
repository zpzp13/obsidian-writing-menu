import { TFile, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../../main';
import { formatDateKey } from '../../utils/dateUtils';
import { findDailyNote } from '../../utils/dailyNoteUtils';
import { parseTimeHMS, fmtColons } from '../../utils/timeUtils';
import { TaskParser } from '../../dashboard/data/TaskParser';
import type { ParsedTask } from '../../dashboard/data/TaskParser';

const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];

let activePopup: HTMLElement | null = null;
let removeTimer: number | null = null;

export function removeDayPreview() {
	if (removeTimer !== null) { window.window.clearTimeout(removeTimer); removeTimer = null; }
	removeTimer = window.window.setTimeout(() => {
		activePopup?.remove();
		activePopup = null;
		removeTimer = null;
	}, 150);
}

export function showDayPreview(anchor: HTMLElement, date: Date, plugin: WritingMenuPlugin) {
	// 대기 중인 제거 취소 후 기존 팝업 즉시 제거
	if (removeTimer !== null) { window.clearTimeout(removeTimer); removeTimer = null; }
	activePopup?.remove();

	const doc   = anchor.ownerDocument;
	const popup = doc.body.createDiv({ cls: 'wm-day-preview wm-ver-popup' });
	activePopup = popup;

	// 팝업 위에 마우스가 있는 동안 제거 방지
	popup.addEventListener('mouseenter', () => {
		if (removeTimer !== null) { window.window.clearTimeout(removeTimer); removeTimer = null; }
	});
	popup.addEventListener('mouseleave', () => { removeDayPreview(); });

	const header = popup.createDiv({ cls: 'wm-day-preview-header' });
	header.textContent = `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${DOW_KO[date.getDay()]})`;

	popup.createDiv({ cls: 'wm-ver-popup-separator' });

	const body = popup.createDiv({ cls: 'wm-day-preview-body' });
	body.createDiv({ cls: 'wm-day-preview-loading', text: '불러오는 중…' });

	positionPopup(popup, anchor);

	loadDayData(date, plugin).then(data => {
		if (!popup.isConnected) return;
		body.empty();
		renderDayData(body, data, plugin);
		positionPopup(popup, anchor);
	}).catch(() => {
		if (popup.isConnected) {
			body.empty();
			body.createDiv({ cls: 'wm-day-preview-loading', text: '데이터 없음' });
		}
	});
}

function positionPopup(popup: HTMLElement, anchor: HTMLElement) {
	const rect = anchor.getBoundingClientRect();
	const pw   = popup.offsetWidth  || 230;
	const ph   = popup.offsetHeight || 80;
	const vw   = (anchor.ownerDocument.defaultView ?? window).innerWidth;
	const vh   = (anchor.ownerDocument.defaultView ?? window).innerHeight;

	let left = rect.left + rect.width / 2 - pw / 2;
	let top  = rect.top - ph - 8;

	if (left < 8) left = 8;
	if (left + pw > vw - 8) left = vw - pw - 8;
	if (top < 8) top = rect.bottom + 8;
	if (top + ph > vh - 8) top = vh - ph - 8;

	popup.setCssStyles({ left: `${left}px` });
	popup.setCssStyles({ top: `${top}px` });
}

// ── Types ────────────────────────────────────────────────────────────────────

interface PreviewTask {
	text:       string;
	rawText:    string;
	sourcePath: string;
	done:       boolean;
	category:   'today' | 'upcoming' | 'overdue';
}

interface DayData {
	charCount:    number;
	avgCharCount: number;
	tasks:        PreviewTask[];
	timeModes:    { label: string; seconds: number }[];
	totalSeconds: number;
}

// ── Task cache (5초 TTL, 호버 반복 호출 방지) ──────────────────────────────

let _cache: { tasks: ParsedTask[]; ts: number } | null = null;

async function getCachedTasks(plugin: WritingMenuPlugin): Promise<ParsedTask[]> {
	if (_cache && Date.now() - _cache.ts < 5000) return _cache.tasks;
	const tasks = await TaskParser.loadTasks(plugin);
	_cache = { tasks, ts: Date.now() };
	return tasks;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}



async function loadDayData(date: Date, plugin: WritingMenuPlugin): Promise<DayData> {
	const store   = plugin.charStore;
	const today   = new Date(); today.setHours(0, 0, 0, 0);
	const isToday = date.toDateString() === today.toDateString();

	const folder    = plugin.settings.trackingFolder ?? '';
	const dailyNote = findDailyNote(plugin, date);

	let charCount: number;
	if (isToday) {
		charCount = folder ? store.getTodayTotalForFolder(folder) : store.getTodayTotal();
	} else {
		const charKey = plugin.settings.dailyCharCountKey || '글자수';
		const fm = dailyNote ? plugin.app.metadataCache.getFileCache(dailyNote)?.frontmatter ?? {} : {};
		const raw = fm[charKey];
		charCount = typeof raw === 'number' ? raw : 0;
	}
	const avgCharCount = store.getDailyAverage();

	// sourceDate 기준으로 할 일 로드 (due date 또는 note date)
	let tasks: PreviewTask[] = [];
	try {
		const all = await getCachedTasks(plugin);
		tasks = all
			.filter(t => t.sourceDate.toDateString() === date.toDateString())
			.map(t => ({
				text:       t.text,
				rawText:    t.rawText,
				sourcePath: t.sourcePath,
				done:       t.completed === true,
				category:   t.category,
			}));
	} catch { /* intentional */ }

	const timeModes: { label: string; seconds: number }[] = [];
	let totalSeconds = 0;
	if (dailyNote) {
		const fm = plugin.app.metadataCache.getFileCache(dailyNote)?.frontmatter ?? {};
		const totalKey = plugin.settings.timeTotalKey ?? '총_시간';
		for (const mode of plugin.settings.timeModes ?? []) {
			let secs = 0;
			for (const [k, v] of Object.entries(fm)) {
				if (k.endsWith(`_${mode.frontmatterKey}`)) secs += parseTimeHMS(v);
			}
			timeModes.push({ label: mode.label, seconds: secs });
		}
		for (const [k, v] of Object.entries(fm)) {
			if (k.endsWith(`_${totalKey}`)) totalSeconds += parseTimeHMS(v);
		}
	}

	return { charCount, avgCharCount, tasks, timeModes, totalSeconds };
}


const CAT_LABELS: Record<PreviewTask['category'], string> = {
	today: '오늘', upcoming: '예정', overdue: '지연',
};

function addSectionLabel(container: HTMLElement, icon: string, text: string) {
	const row    = container.createDiv({ cls: 'wm-day-preview-section-label' });
	const iconEl = row.createSpan({ cls: 'wm-day-preview-section-icon' });
	setIcon(iconEl, icon);
	row.createSpan({ text });
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderDayData(container: HTMLElement, data: DayData, plugin: WritingMenuPlugin) {
	const pref = plugin.settings.calendarPreviewItems ?? {};

	// ── 할 일 ──
	if (pref.tasks !== false) {
		addSectionLabel(container, 'check-square', '할 일');
		if (data.tasks.length === 0) {
			container.createDiv({ cls: 'wm-day-preview-empty', text: '없음' });
		} else {
			for (const task of data.tasks) {
				const row = container.createDiv({ cls: 'wm-day-preview-task-row' });

				const badge = row.createDiv({ cls: `wm-day-preview-task-badge is-${task.category}` });
				badge.textContent = CAT_LABELS[task.category];

				const textEl = row.createSpan({
					cls:  'wm-day-preview-task-text' + (task.done ? ' is-done' : ''),
					text: task.text,
				});

				const checkEl = row.createDiv({ cls: 'wm-day-preview-task-check' + (task.done ? ' is-done' : '') });
				if (task.done) setIcon(checkEl, 'check');

				checkEl.addEventListener('click', (e) => { void (async () => {
					e.stopPropagation();
					e.preventDefault();
					const nowDone = !task.done;
					task.done = nowDone;
					checkEl.toggleClass('is-done', nowDone);
					textEl.toggleClass('is-done', nowDone);
					checkEl.empty();
					if (nowDone) setIcon(checkEl, 'check');

					const abstract = plugin.app.vault.getAbstractFileByPath(task.sourcePath);
					const file = abstract instanceof TFile ? abstract : null;
					if (!file) return;
					const content = await plugin.app.vault.read(file);
					const baseRaw = task.rawText.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}\s*$/, '').trimEnd();
					let updated: string;
					if (nowDone) {
						const ds = formatDateKey(new Date());
						updated = content.replace(
							new RegExp(`(^[\\s\\t]*-\\s+\\[) (\\]\\s+${escapeRe(baseRaw)})(\\s*✅\\s*\\d{4}-\\d{2}-\\d{2})?`, 'm'),
							`$1x$2 ✅ ${ds}`,
						);
					} else {
						updated = content.replace(
							new RegExp(`(^[\\s\\t]*-\\s+\\[)x(\\]\\s+${escapeRe(baseRaw)})(\\s*✅\\s*\\d{4}-\\d{2}-\\d{2})?`, 'm'),
							`$1 $2`,
						);
					}
					if (updated !== content) await plugin.app.vault.modify(file, updated);
				})(); });
			}
		}
		container.createDiv({ cls: 'wm-ver-popup-separator' });
	}

	// ── 글자수 ──
	if (pref.charCount !== false || pref.avgCharCount !== false) {
		addSectionLabel(container, 'file-text', '글자수');
		if (pref.charCount !== false) {
			const row = container.createDiv({ cls: 'wm-day-preview-row' });
			row.createSpan({ cls: 'wm-day-preview-lbl', text: '하루' });
			row.createSpan({ cls: 'wm-day-preview-val', text: data.charCount > 0 ? `${data.charCount.toLocaleString()}자` : '—' });
		}
		if (pref.avgCharCount !== false) {
			const row = container.createDiv({ cls: 'wm-day-preview-row' });
			row.createSpan({ cls: 'wm-day-preview-lbl', text: '일평균' });
			row.createSpan({ cls: 'wm-day-preview-val', text: data.avgCharCount > 0 ? `${data.avgCharCount.toLocaleString()}자` : '—' });
		}
		container.createDiv({ cls: 'wm-ver-popup-separator' });
	}

	// ── 작업 시간 ──
	if (pref.timeModes !== false) {
		addSectionLabel(container, 'clock', '작업 시간');
		const hasTimes = data.timeModes.some(m => m.seconds > 0);
		if (!hasTimes && data.totalSeconds <= 0) {
			container.createDiv({ cls: 'wm-day-preview-empty', text: '기록 없음' });
		} else {
			for (const mode of data.timeModes) {
				if (mode.seconds <= 0) continue;
				const row = container.createDiv({ cls: 'wm-day-preview-row' });
				row.createSpan({ cls: 'wm-day-preview-lbl', text: mode.label });
				row.createSpan({ cls: 'wm-day-preview-val', text: fmtColons(mode.seconds) });
			}
			if (pref.totalTime !== false && data.totalSeconds > 0) {
				const row = container.createDiv({ cls: 'wm-day-preview-row is-total' });
				row.createSpan({ cls: 'wm-day-preview-lbl', text: '합계' });
				row.createSpan({ cls: 'wm-day-preview-val', text: fmtColons(data.totalSeconds) });
			}
		}
	}
}
