import type { TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';

export function getCharacterCandidateFiles(plugin: WritingMenuPlugin, activeFile: TFile | null): TFile[] {
	const all = plugin.app.vault.getMarkdownFiles();
	const project = plugin.projectContext.getProjectForFile(activeFile);
	const folder = project?.characterFolder?.replace(/\/$/, '');
	return folder ? all.filter(file => file.path.startsWith(folder + '/')) : all;
}
