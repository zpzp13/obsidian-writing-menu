import type { TAbstractFile, TFile, TFolder, Vault } from 'obsidian';

/** Walk an already loaded folder tree without enumerating unrelated vault paths. */
export function markdownFilesInFolder(vault: Vault, path: string): TFile[] {
	const root = vault.getAbstractFileByPath(path.replace(/\/$/, ''));
	if (!root) return [];
	const isFolder = (entry: TAbstractFile): entry is TFolder => 'children' in entry;
	const isFile = (entry: TAbstractFile): entry is TFile => 'extension' in entry;
	const pending = [root], files: TFile[] = [];
	while (pending.length) {
		const entry = pending.pop();
		if (!entry) continue;
		if (isFolder(entry)) pending.push(...[...entry.children].reverse());
		else if (isFile(entry) && entry.extension === 'md') files.push(entry);
	}
	return files;
}
