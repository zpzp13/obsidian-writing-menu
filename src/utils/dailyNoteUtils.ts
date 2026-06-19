import { TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';

export function getDnConfig(plugin: WritingMenuPlugin): { folder: string; format: string } {
	const dnPlugin = (plugin.app as any).internalPlugins?.plugins?.['daily-notes'];
	const dnOpts   = dnPlugin?.enabled ? dnPlugin?.instance?.options : null;
	return {
		folder: dnOpts?.folder ?? plugin.settings.dailyNotesFolder ?? '',
		format: dnOpts?.format ?? plugin.settings.dailyNotesFormat ?? 'YYYY-MM-DD',
	};
}

export function findDailyNote(plugin: WritingMenuPlugin, date: Date): TFile | null {
	const { folder, format } = getDnConfig(plugin);
	const name = (window as any).moment(date).format(format);
	const path = folder ? `${folder}/${name}.md` : `${name}.md`;
	const file = plugin.app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? file : null;
}
