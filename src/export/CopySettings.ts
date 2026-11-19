import type { WritingMenuSettings } from '../types';

/** New include flags always win, and legacy flags never survive a save. */
export function migrateCopySettings(saved: object, settings: WritingMenuSettings): boolean {
	const source = saved as Record<string, unknown>, target = settings as unknown as Record<string, unknown>;
	for (const key of ['Comments', 'Headings', 'Footnotes'] as const) {
		const legacy = source[`copyExclude${key}`];
		if (source[`copyInclude${key}`] === undefined && typeof legacy === 'boolean') settings[`copyInclude${key}`] = !legacy;
		delete target[`copyExclude${key}`];
	}
	delete target.exportDefaultExcludeHeadings;
	return ['copyExcludeComments', 'copyExcludeHeadings', 'copyExcludeFootnotes', 'exportDefaultExcludeHeadings'].some(key => Object.prototype.hasOwnProperty.call(source, key));
}
