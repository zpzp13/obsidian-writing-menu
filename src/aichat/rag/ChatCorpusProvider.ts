import { wmT } from '../../i18n/index';
import type { TFile } from 'obsidian';
import type WritingMenuPlugin from '../../../main';
import type { WritingProject } from '../../types';
import { getOpenWritingDocuments } from '../../writing/WritingDocument';
import { readChatPlotPassages } from '../AiChatPlotKnowledge';
import type { ChatContextItem } from '../AiChatTypes';
import { checkChatAbort } from '../ChatStream';
import { isUnknownArray } from '../../utils/typeGuards';

export interface CorpusDocument {
	id: string; title: string; path?: string; stamp: string; links: string[]; names?: string[]; kind: ChatContextItem['kind'];
	characterPaths?: string[]; sequence?: number;
	read(): Promise<string>;
}
const inside = (path: string, folder: string) => folder && (path === folder || path.startsWith(folder.replace(/\/$/, '') + '/'));
export class ChatCorpusProvider {
	constructor(private plugin: WritingMenuPlugin, readonly project: WritingProject) {}
	eligible(file: TFile): boolean {
		if (this.plugin.projectContext.getProjectForFile(file)?.rootFolder !== this.project.rootFolder) return false;
		if (file.path.split('/').some(part => part.startsWith('.') || /^(스냅샷|백업|snapshots?|backups?)$/i.test(part))) return false;
		if (/^대화-\d+\.md$/.test(file.path.split('/').pop() ?? '')) return false;
		return ![this.plugin.settings.snapshotStoragePath, this.plugin.settings.plotSnapshotFolder].some(folder => folder && inside(file.path, folder));
	}
	async documents(signal?: AbortSignal): Promise<{ documents: CorpusDocument[]; warnings: string[] }> {
		const app = this.plugin.app, warnings: string[] = [], open = new Map(getOpenWritingDocuments(this.plugin).map(document => [document.path, document]));
		const documents: CorpusDocument[] = app.vault.getMarkdownFiles().filter(file => this.eligible(file)).map(file => {
			const cache = app.metadataCache.getFileCache(file);
			const metadata = cache?.frontmatter;
			const alias: unknown = metadata?.aliases ?? metadata?.alias;
			const names = [file.basename, metadata?.name, metadata?.title, metadata?.[this.plugin.settings.wikiNameFieldName], ...(isUnknownArray(alias) ? alias : [alias])]
				.filter((name): name is string => typeof name === 'string' && Boolean(name.trim())).map(name => name.trim());
			const links = (cache?.links ?? []).map(link => app.metadataCache.getFirstLinkpathDest(link.link, file.path)?.path).filter((path): path is string => Boolean(path));
			return {
				id: `note:${file.path}`, path: file.path, title: file.basename, links, names,
				kind: inside(file.path, this.project.characterFolder) ? 'character' as const : 'reference' as const,
				stamp: open.has(file.path) ? '' : `${file.stat?.mtime ?? ''}:${file.stat?.size ?? ''}`,
				read: async () => {
					checkChatAbort(signal);
					if (!this.eligible(file)) throw new Error(wmT("이 문서는 현재 프로젝트의 검색 대상이 아닙니다."));
					const text = open.get(file.path)?.read() ?? await app.vault.read(file);
					if (/^writing_menu_(?:snapshot|export):/m.test(text.slice(0, 1600))) return '';
					return text;
				},
			};
		});
		try {
			const rows = await readChatPlotPassages(this.plugin, this.project, '', undefined), grouped = new Map<string, typeof rows>();
			for (const row of rows) { const group = grouped.get(row.group) ?? []; group.push(row); grouped.set(row.group, group); }
			for (const [id, parts] of grouped) {
				const text = parts.map(part => part.text).join('\n\n'), first = parts[0];
				const paths = [...text.matchAll(/\(([^\n()]+\.md)\)/g)].map(match => match[1]);
				documents.push({ id, title: first.title, path: first.path, kind: 'plot', stamp: '', links: [...new Set([...(first.path ? [first.path] : []), ...paths])], characterPaths: first.characterPaths ?? paths, sequence: first.sequence, read: async () => text });
			}
			// Preserve explicit cast-to-manuscript links rather than requiring a name in every prose paragraph.
			const linked = new Map<string, { characters: Set<string>; sequence?: number }>();
			for (const document of documents) if (document.kind === 'plot' && document.path) {
				const entry = linked.get(document.path) ?? { characters: new Set<string>(), sequence: document.sequence };
				for (const path of document.characterPaths ?? []) entry.characters.add(path);
				entry.sequence = Math.min(entry.sequence ?? Infinity, document.sequence ?? Infinity); linked.set(document.path, entry);
			}
			for (const document of documents) if (document.kind !== 'plot' && document.path && linked.has(document.path)) {
				const entry = linked.get(document.path)!; document.characterPaths = [...entry.characters]; document.sequence = Number.isFinite(entry.sequence) ? entry.sequence : undefined;
			}
		} catch (error) { checkChatAbort(signal); warnings.push(wmT("플롯 조회 실패: {0}", (error instanceof Error ? error.message : String(error)).slice(0, 500))); }
		return { documents, warnings };
	}
}
