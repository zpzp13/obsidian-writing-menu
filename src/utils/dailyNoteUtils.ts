import { TFile, App } from 'obsidian';
import type WritingMenuPlugin from '../../main';

interface AppWithInternalPlugins extends App {
	internalPlugins?: { plugins?: Record<string, { enabled?: boolean; instance?: { options?: { folder?: string; format?: string; template?: string } } }> };
	plugins?: { plugins?: Record<string, { settings?: { daily?: { enabled?: boolean; folder?: string; format?: string; template?: string } } }> };
}

declare const moment: (date?: unknown, fmt?: string) => { format(f: string): string };

export function getDnConfig(plugin: WritingMenuPlugin): { folder: string; format: string; template: string } {
	const app = plugin.app as AppWithInternalPlugins;

	// "Periodic Notes" 커뮤니티 플러그인이 데일리노트를 관리하는 경우, 그 설정(폴더/포맷/템플릿)이 우선
	const periodicDaily = app.plugins?.plugins?.['periodic-notes']?.settings?.daily;
	if (periodicDaily?.enabled) {
		return {
			folder:   periodicDaily.folder   ?? plugin.settings.dailyNotesFolder ?? '',
			format:   periodicDaily.format   ?? plugin.settings.dailyNotesFormat ?? 'YYYY-MM-DD',
			template: periodicDaily.template ?? '',
		};
	}

	const dnPlugin = app.internalPlugins?.plugins?.['daily-notes'];
	const dnOpts   = dnPlugin?.enabled ? dnPlugin?.instance?.options : null;
	return {
		folder:   dnOpts?.folder   ?? plugin.settings.dailyNotesFolder ?? '',
		format:   dnOpts?.format   ?? plugin.settings.dailyNotesFormat ?? 'YYYY-MM-DD',
		template: dnOpts?.template ?? '',
	};
}

export function findDailyNote(plugin: WritingMenuPlugin, date: Date): TFile | null {
	const { folder, format } = getDnConfig(plugin);
	const name = moment(date).format(format);
	const path = folder ? `${folder}/${name}.md` : `${name}.md`;
	const file = plugin.app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? file : null;
}

/**
 * 데일리노트 파일을 생성하거나 기존 파일을 반환.
 * 신규 생성 시 템플릿을 적용하고 {{date}}/{{title}}/{{time}} 변수를 치환.
 */
export async function ensureDailyNote(plugin: WritingMenuPlugin, date: Date): Promise<TFile | null> {
	const { folder, format, template } = getDnConfig(plugin);
	const filename = moment(date).format(format);
	const filePath = folder ? `${folder}/${filename}.md` : `${filename}.md`;

	const existing = plugin.app.vault.getAbstractFileByPath(filePath);
	if (existing instanceof TFile) return existing;

	if (folder && !plugin.app.vault.getAbstractFileByPath(folder)) {
		try { await plugin.app.vault.createFolder(folder); } catch { /* 이미 존재 */ }
	}

	let content = '';
	if (template) {
		const tp   = template.endsWith('.md') ? template : `${template}.md`;
		const tmpl = plugin.app.vault.getAbstractFileByPath(tp);
		if (tmpl instanceof TFile) {
			try {
				content = await plugin.app.vault.read(tmpl);
				content = content
					.replace(/\{\{date\}\}/gi, moment(date).format('YYYY-MM-DD'))
					.replace(/\{\{date:([^}]+)\}\}/gi, (_: string, fmt: string) => moment(date).format(fmt))
					.replace(/\{\{time\}\}/gi, moment().format('HH:mm'))
					.replace(/\{\{title\}\}/gi, filename);
			} catch { /* intentional */ }
		}
	}

	try {
		return await plugin.app.vault.create(filePath, content);
	} catch {
		return null;
	}
}
