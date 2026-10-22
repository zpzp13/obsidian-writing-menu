import { markdownFilesInFolder } from '../utils/vaultFiles';
import { TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { WritingProject } from '../types';
import type { WritingDocument } from '../writing/WritingDocument';
import type { ChatContextItem, DeusParticipant } from './AiChatTypes';
import type { DeusIntent } from './DeusSkills';
import { readChatPlotPassages, type DeusPlotSelection } from './AiChatPlotKnowledge';
import { checkChatAbort } from './ChatStream';
import { getWikiDisplayName } from '../wiki/wikiProfileUtils';

export function deusSourceAllowed(source: ChatContextItem, excluded: Set<string>): boolean {
	if (excluded.has(source.id)) return false;
	if (source.path && ['deus-active:', 'deus-cast:', 'deus-mentioned:'].some(prefix => excluded.has(prefix + source.path))) return false;
	// Plot IDs change when their text is chunked for search. The stable group identifies the same row.
	for (const id of excluded) if (id.startsWith('plot:') && source.id.startsWith(id.replace(/:\d+:\d+$/, '') + ':')) return false;
	return true;
}

/** Only the active manuscript's linked rows and cast are selected; reading never acquires or writes a workbook. */
export async function collectDeusScene(plugin: WritingMenuPlugin, project: WritingProject, intent: DeusIntent, document: WritingDocument | null, openDocuments: WritingDocument[], excluded: Set<string>, signal?: AbortSignal, plotSelection?: DeusPlotSelection): Promise<{ sources: ChatContextItem[]; participants: DeusParticipant[] }> {
	const sources: ChatContextItem[] = [], participants = [...intent.participants];
	const inProject = (file: TFile) => plugin.projectContext.getProjectForFile(file)?.rootFolder === project.rootFolder;
	checkChatAbort(signal);
	const plot = intent.scene === 'active' && plotSelection?.projectRoot === project.rootFolder ? plotSelection : null;
	const active = !plot && intent.scene === 'active' && document && inProject(document.file) ? document : null;
	const addCast = (paths: string[]) => {
		for (const path of paths) {
			const file = plugin.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile && inProject(file) && !participants.some(person => person.path === path)) participants.push({ path, name: getWikiDisplayName(plugin.app, plugin, file) });
		}
	};
	if (plot) for (const row of await readChatPlotPassages(plugin, project, '', undefined, plot)) {
		checkChatAbort(signal); if (excluded.has(row.id)) continue;
		sources.push(row); addCast(row.characterPaths ?? []);
	}
	// Freeze unsaved editor text before awaiting workbook IO.
	const snapshot = active ? { text: active.read(), selection: active.editor.getSelection() } : null;
	if (active && snapshot) {
		const selection = snapshot.selection.trim() ? snapshot.selection : '';
		const source: ChatContextItem = { id: `deus-active:${active.path}`, kind: selection ? 'selection' : 'document', title: `${active.file.basename}${selection ? ' · 선택문' : ''}`, path: active.path, text: selection || snapshot.text, automatic: true };
		if (!excluded.has(source.id)) {
			sources.push(source);
			const rows = (await readChatPlotPassages(plugin, project, '', active.path)).filter(row => row.path === active.path);
			for (const row of rows) {
				checkChatAbort(signal);
				if (!excluded.has(row.id)) sources.push(row);
				addCast(excluded.has(row.id) ? [] : row.characterPaths ?? []);
			}
			const folder = project.characterFolder?.replace(/\/$/, '');
			for (const file of folder ? markdownFilesInFolder(plugin.app.vault, folder) : []) {
				const name = getWikiDisplayName(plugin.app, plugin, file);
				if (name.length >= 2 && source.text.includes(name) && !participants.some(person => person.path === file.path)) participants.push({ path: file.path, name });
			}
		}
	}
	for (const person of participants) {
		checkChatAbort(signal);
		const id = `deus-cast:${person.path}`, file = plugin.app.vault.getAbstractFileByPath(person.path);
		if (excluded.has(id) || !(file instanceof TFile) || !inProject(file)) continue;
		const text = openDocuments.find(document => document.path === file.path)?.read() ?? await plugin.app.vault.read(file);
		sources.push({ id, path: file.path, kind: 'character', title: person.name, text, automatic: true });
	}
	return { sources, participants: participants.filter(person => !excluded.has(`deus-cast:${person.path}`)) };
}
