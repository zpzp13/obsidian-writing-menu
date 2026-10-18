export interface ChecklistTask { line: number; raw: string; text: string; completed: boolean; completionDate?: string; source: string }
export type ChecklistChange = { completed: boolean } | { text: string } | { remove: true } | { move: -1 | 1 };

const COMPLETION_DATE_PATTERN = /(?:^|\s)✅\s*(\d{4}-\d{2}-\d{2})\s*$/u;

export function checklistCompletionDate(date = new Date()): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function normalizeChecklistValue(value: string): string {
	return value.replace(/\r\n?/g, '\n').split('\n').map(line =>
		!line.trim() || /^\s*[-*+]\s+\[([ xX])\]\s*/.test(line) ? line : `- [ ] ${line.trim()}`,
	).join('\n');
}

export function parseChecklist(value: string): ChecklistTask[] {
	return value.split('\n').flatMap((raw, line) => {
		const match = raw.match(/^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/);
		if (!match) return [];
		const completed = match[1].toLowerCase() === 'x';
		const completion = completed ? match[2].match(COMPLETION_DATE_PATTERN) : null;
		return [{
			line,
			raw,
			text: completion ? match[2].slice(0, completion.index).trimEnd() : match[2],
			completed,
			completionDate: completion?.[1],
			source: value,
		}];
	});
}

export function appendChecklistTask(value: string, text: string): string {
	const title = text.replace(/[\r\n]+/g, ' ').trim();
	return title ? `${value}${value && !value.endsWith('\n') ? '\n' : ''}- [ ] ${title}` : value;
}

/** Match the original line so an old popup cannot edit a different, shifted task. */
export function changeChecklistTask(value: string, task: ChecklistTask, change: ChecklistChange): string | null {
	const lines = value.split('\n');
	if (value !== task.source || lines[task.line] !== task.raw) return null;
	if ('remove' in change) lines.splice(task.line, 1);
	else if ('move' in change) {
		const tasks = parseChecklist(value);
		const index = tasks.findIndex(item => item.line === task.line);
		const other = tasks[index + change.move];
		if (!other) return value;
		[lines[task.line], lines[other.line]] = [lines[other.line], lines[task.line]];
	} else {
		const text = 'text' in change ? change.text.replace(/[\r\n]+/g, ' ').trim() : task.text;
		if (!text) return value;
		const completed = 'completed' in change ? change.completed : task.completed;
		const completionDate = !completed ? undefined
			: 'completed' in change && !task.completed ? checklistCompletionDate()
				: task.completionDate;
		lines[task.line] = `- [${completed ? 'x' : ' '}] ${text}${completionDate ? ` ✅ ${completionDate}` : ''}`;
	}
	return lines.join('\n');
}
