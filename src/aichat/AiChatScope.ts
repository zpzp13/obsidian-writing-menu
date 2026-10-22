import type { TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { markdownFilesInFolder } from '../utils/vaultFiles';

export function getCharacterCandidateFiles(plugin: WritingMenuPlugin, activeFile: TFile | null): TFile[] {
	const project = plugin.projectContext.getProjectForFile(activeFile);
	const folder = project?.characterFolder?.replace(/\/$/, '');
	return folder ? markdownFilesInFolder(plugin.app.vault, folder) : plugin.app.vault.getMarkdownFiles();
}
