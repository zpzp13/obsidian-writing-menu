import { TFile, App } from 'obsidian';
import type WritingMenuPlugin from '../../main';

interface AppWithInternalPlugins extends App {
	internalPlugins?: { plugins?: Record<string, { enabled?: boolean; instance?: { options?: { folder?: string; format?: string } } }> };
}

declare const moment: (date?: unknown, fmt?: string) => { format(f: string): string };

export function getDnConfig(plugin: WritingMenuPlugin): { folder: string; format: string } {
	const dnPlugin = (plugin.app as AppWithInternalPlugins).internalPlugins?.plugins?.['daily-notes'];
	const dnOpts   = dnPlugin?.enabled ? dnPlugin?.instance?.options : null;
	return {
		folder: dnOpts?.folder ?? plugin.settings.dailyNotesFolder ?? '',
		format: dnOpts?.format ?? plugin.settings.dailyNotesFormat ?? 'YYYY-MM-DD',
	};
}

export function findDailyNote(plugin: WritingMenuPlugin, date: Date): TFile | null {
	const { folder, format } = getDnConfig(plugin);
	const name = moment(date).format(format);
	const path = folder ? `${folder}/${name}.md` : `${name}.md`;
	const file = plugin.app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? file : null;
}
