import { TFile } from 'obsidian';
import type WritingMenuPlugin from '../../../main';
import { formatDateKey } from '../../utils/dateUtils';

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface TasksMeta {
	due?: string;
	scheduled?: string;
	start?: string;
	priority?: string;
	recurrence?: string;
}

export interface ParsedTask {
	text: string;
	rawText: string;
	sourcePath: string;
	sourceDate: Date;
	category: 'today' | 'upcoming' | 'overdue';
	tasksMeta?: TasksMeta;
	tags?: string[];
	completed?: boolean;
	completedDate?: string;
	subItems?: { text: string; completed: boolean }[];
}

export class TaskParser {
	static async loadTasks(plugin: WritingMenuPlugin): Promise<ParsedTask[]> {
		const dnPlugin = (plugin.app as any).internalPlugins?.plugins?.['daily-notes'];
		const dnOpts   = dnPlugin?.enabled ? dnPlugin?.instance?.options : null;
		const folder   = dnOpts?.folder  ?? plugin.settings.dailyNotesFolder ?? '';
		const format   = dnOpts?.format  ?? plugin.settings.dailyNotesFormat ?? 'YYYY-MM-DD';

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const todayStr = formatDateKey(today);

		const results: ParsedTask[] = [];

		for (let i = -30; i <= 7; i++) {
			const date = new Date(today);
			date.setDate(date.getDate() + i);

			const path     = this.datePath(date, folder, format);
			const abstract = plugin.app.vault.getAbstractFileByPath(path);
			if (!(abstract instanceof TFile)) continue;

			try {
				const content = await plugin.app.vault.cachedRead(abstract);
				const tasks   = this.parseTasks(content);
				const diff    = i;

				for (const { text, rawText, tasksMeta, tags, completed, completedDate, subItems } of tasks) {
					// 완료 항목은 오늘 완료한 것만 포함 (다음날 자동 소멸)
					if (completed && completedDate !== todayStr) continue;

					let category: ParsedTask['category'];
					let displayDate = date;

					if (tasksMeta?.due) {
						const dueDate = new Date(tasksMeta.due + 'T00:00:00');
						dueDate.setHours(0, 0, 0, 0);
						const dueDiff = Math.round(
							(dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
						);
						category    = dueDiff === 0 ? 'today' : dueDiff > 0 ? 'upcoming' : 'overdue';
						displayDate = dueDate;
					} else {
						category = diff === 0 ? 'today' : diff > 0 ? 'upcoming' : 'overdue';
					}

					results.push({
						text, rawText, sourcePath: path, sourceDate: displayDate,
						category, tasksMeta, tags, completed: completed || undefined,
						completedDate,
						subItems,
					});
				}
			} catch {}
		}

		return results;
	}

	private static parseTasks(content: string): { text: string; rawText: string; tasksMeta?: TasksMeta; tags?: string[]; completed?: boolean; completedDate?: string; subItems?: { text: string; completed: boolean }[] }[] {
		const results: { text: string; rawText: string; tasksMeta?: TasksMeta; tags?: string[]; completed?: boolean; completedDate?: string; subItems?: { text: string; completed: boolean }[] }[] = [];
		const lines = content.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const isIndented = /^[\t ]+/.test(line);
			const m = line.match(/^[\s\t]*-\s+\[([x ])\]\s+(.+)$/);
			if (!m) continue;
			if (isIndented && results.length > 0) {
				const raw = m[2].trim();
				const { cleanText } = this.parseTasksMeta(raw);
				const last = results[results.length - 1];
				if (!last.subItems) last.subItems = [];
				last.subItems.push({ text: cleanText, completed: m[1] === 'x' });
				continue;
			}
			const isComplete = m[1] === 'x';
			const raw = m[2].trim();
			const { cleanText, meta, tags, completedDate } = this.parseTasksMeta(raw);

			results.push({
				text:          cleanText,
				rawText:       raw,
				tasksMeta:     Object.keys(meta).length ? meta : undefined,
				tags:          tags.length ? tags : undefined,
				completed:     isComplete || undefined,
				completedDate: isComplete ? completedDate : undefined,
			});
		}
		return results;
	}

	private static parseTasksMeta(raw: string): { cleanText: string; meta: TasksMeta; tags: string[]; completedDate?: string } {
		let text = raw;
		const meta: TasksMeta = {};
		let completedDate: string | undefined;

		text = text.replace(/📅\s*(\d{4}-\d{2}-\d{2})/, (_, d) => { meta.due = d; return ''; });
		text = text.replace(/⏳\s*(\d{4}-\d{2}-\d{2})/, (_, d) => { meta.scheduled = d; return ''; });
		text = text.replace(/🛫\s*(\d{4}-\d{2}-\d{2})/, (_, d) => { meta.start = d; return ''; });
		text = text.replace(/✅\s*(\d{4}-\d{2}-\d{2})/, (_, d) => { completedDate = d; return ''; });

		if (text.includes('⏫'))      { meta.priority = '최고'; text = text.replace('⏫', ''); }
		else if (text.includes('🔺')) { meta.priority = '높음'; text = text.replace('🔺', ''); }
		else if (text.includes('🔼')) { meta.priority = '보통'; text = text.replace('🔼', ''); }
		else if (text.includes('🔽')) { meta.priority = '낮음'; text = text.replace('🔽', ''); }
		else if (text.includes('⏬')) { meta.priority = '최저'; text = text.replace('⏬', ''); }

		text = text.replace(/🔁\s*([^\n]+?)(?=\s*(?:📅|⏳|🛫|✅|⏫|🔺|🔼|🔽|⏬|$))/, (_, r) => {
			meta.recurrence = r.trim(); return '';
		});

		// 태그 추출
		const tagRe = /#[a-zA-Z0-9가-힣一-龥_\-\/]+/g;
		const tags: string[] = [];
		let tm: RegExpExecArray | null;
		while ((tm = tagRe.exec(text)) !== null) tags.push(tm[0]);
		text = text.replace(/#[a-zA-Z0-9가-힣一-龥_\-\/]+/g, '').replace(/\s{2,}/g, ' ');

		return { cleanText: text.trim(), meta, tags, completedDate };
	}

	static async completeTask(task: ParsedTask, plugin: WritingMenuPlugin): Promise<void> {
		await this.toggleTask(task, true, plugin);
	}

	static async toggleTask(task: ParsedTask, nowCompleted: boolean, plugin: WritingMenuPlugin): Promise<void> {
		const file = plugin.app.vault.getAbstractFileByPath(task.sourcePath);
		if (!(file instanceof TFile)) return;
		const content = await plugin.app.vault.read(file);
		// Strip ✅ date from rawText to get base text for matching
		const baseRaw = (task.rawText || task.text).replace(/\s*✅\s*\d{4}-\d{2}-\d{2}\s*$/, '').trimEnd();
		let updated: string;
		if (nowCompleted) {
			const d = new Date();
			const dateStr = formatDateKey(d);
			updated = content.replace(
				new RegExp(`(^[\\s\\t]*-\\s+\\[) (\\]\\s+${escapeRegex(baseRaw)})(\\s*✅\\s*\\d{4}-\\d{2}-\\d{2})?`, 'm'),
				`$1x$2 ✅ ${dateStr}`,
			);
		} else {
			updated = content.replace(
				new RegExp(`(^[\\s\\t]*-\\s+\\[)x(\\]\\s+${escapeRegex(baseRaw)})(\\s*✅\\s*\\d{4}-\\d{2}-\\d{2})?`, 'm'),
				`$1 $2`,
			);
		}
		if (updated !== content) await plugin.app.vault.modify(file, updated);
	}

	static async toggleSubTask(
		task: ParsedTask, subIdx: number, nowCompleted: boolean, plugin: WritingMenuPlugin,
	): Promise<void> {
		const file = plugin.app.vault.getAbstractFileByPath(task.sourcePath);
		if (!(file instanceof TFile)) return;
		const content = await plugin.app.vault.read(file);
		const lines   = content.split('\n');
		const taskRe  = /^[\s\t]*-\s+\[[ x]\]\s+/;
		const target  = task.rawText || task.text;
		const parentIdx = lines.findIndex(l => {
			if (!taskRe.test(l)) return false;
			const rest = l.replace(taskRe, '');
			return rest === target || rest.startsWith(target + ' ') || rest.startsWith(target + '\t');
		});
		if (parentIdx < 0) return;
		let subCount = 0;
		for (let i = parentIdx + 1; i < lines.length; i++) {
			if (!/^[\t ]/.test(lines[i])) break;
			const sm = lines[i].match(/^([\t ]*-\s+\[)[ x](\].*)$/);
			if (!sm) continue;
			if (subCount === subIdx) {
				lines[i] = `${sm[1]}${nowCompleted ? 'x' : ' '}${sm[2]}`;
				break;
			}
			subCount++;
		}
		await plugin.app.vault.modify(file, lines.join('\n'));
	}

	static async setTaskPriority(task: ParsedTask, emoji: string, plugin: WritingMenuPlugin): Promise<void> {
		const file = plugin.app.vault.getAbstractFileByPath(task.sourcePath);
		if (!(file instanceof TFile)) return;
		const content = await plugin.app.vault.read(file);
		const lines   = content.split('\n');
		const taskLineRe = /^[\s\t]*-\s+\[[ x]\]\s+/;
		const target = task.rawText || task.text;
		const idx = lines.findIndex(l => {
			if (!taskLineRe.test(l)) return false;
			const rest = l.replace(taskLineRe, '');
			return rest === target || rest.startsWith(target + ' ') || rest.startsWith(target + '\t');
		});
		if (idx < 0) return;
		let line = lines[idx].replace(/[⏫🔺🔼🔽⏬]/gu, '').replace(/\s{2,}/g, ' ').trimEnd();
		if (emoji) line += ` ${emoji}`;
		lines[idx] = line;
		await plugin.app.vault.modify(file, lines.join('\n'));
	}

	static async addTaskToDailyNote(text: string, plugin: WritingMenuPlugin, subItems: string[] = []): Promise<void> {
		const dnPlugin = (plugin.app as any).internalPlugins?.plugins?.['daily-notes'];
		const dnOpts   = dnPlugin?.enabled ? dnPlugin?.instance?.options : null;
		const folder   = dnOpts?.folder  ?? plugin.settings.dailyNotesFolder ?? '';
		const format   = dnOpts?.format  ?? plugin.settings.dailyNotesFormat ?? 'YYYY-MM-DD';
		const name     = (window as any).moment().format(format);
		const path     = folder ? `${folder}/${name}.md` : `${name}.md`;

		let file = plugin.app.vault.getAbstractFileByPath(path) as TFile | null;
		if (!(file instanceof TFile)) {
			let initContent = '';
			const templatePath = dnOpts?.template as string | undefined;
			if (templatePath) {
				const tp = templatePath.endsWith('.md') ? templatePath : `${templatePath}.md`;
				const tf = plugin.app.vault.getAbstractFileByPath(tp);
				if (tf instanceof TFile) {
					try {
						initContent = await plugin.app.vault.read(tf);
						initContent = initContent
							.replace(/\{\{date\}\}/gi, (window as any).moment().format('YYYY-MM-DD'))
							.replace(/\{\{date:([^}]+)\}\}/gi, (_: string, fmt: string) => (window as any).moment().format(fmt))
							.replace(/\{\{time\}\}/gi, (window as any).moment().format('HH:mm'))
							.replace(/\{\{title\}\}/gi, name);
					} catch {}
				}
			}
			try { file = await plugin.app.vault.create(path, initContent); } catch {}
		}
		if (!(file instanceof TFile)) return;

		const content  = await plugin.app.vault.read(file);
		const header   = plugin.settings.taskAddHeader ?? '할 일';
		const taskLine = `- [ ] ${text}`;
		const taskBlock = subItems.length
			? [taskLine, ...subItems.map(s => `\t- [ ] ${s}`)].join('\n')
			: taskLine;
		const lines    = content.split('\n');
		const headerRe = new RegExp(`^#{1,6}\\s+${escapeRegex(header)}\\s*$`);

		let insertIdx = -1;
		for (let i = 0; i < lines.length; i++) {
			if (!headerRe.test(lines[i])) continue;
			const lvl = (lines[i].match(/^(#{1,6})/) ?? ['', ''])[1].length;
			insertIdx = i + 1;
			for (let j = i + 1; j < lines.length; j++) {
				const nxt = lines[j].match(/^(#{1,6})\s/);
				if (nxt && nxt[1].length <= lvl) { insertIdx = j; break; }
				insertIdx = j + 1;
			}
			break;
		}

		let newContent: string;
		if (insertIdx === -1) {
			const trimmed = content.trim();
			newContent = trimmed
				? `${trimmed}\n\n## ${header}\n${taskBlock}\n`
				: `## ${header}\n${taskBlock}\n`;
		} else {
			lines.splice(insertIdx, 0, ...taskBlock.split('\n'));
			newContent = lines.join('\n');
		}
		await plugin.app.vault.modify(file, newContent);
	}

	private static datePath(date: Date, folder: string, format: string): string {
		const name = (window as any).moment(date).format(format);
		return folder ? `${folder}/${name}.md` : `${name}.md`;
	}
}
