import { App, TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';

export function getWikiImgSrc(app: App, plugin: WritingMenuPlugin, file: TFile): string {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	const val = String(fm?.[plugin.settings.wikiImageFieldName] || '');
	if (!val) return '';
	if (val.startsWith('[[') && val.endsWith(']]')) {
		const linked = app.metadataCache.getFirstLinkpathDest(val.slice(2, -2), file.path);
		return linked ? app.vault.getResourcePath(linked) : '';
	}
	const plain = app.vault.getAbstractFileByPath(val);
	if (plain instanceof TFile) return app.vault.getResourcePath(plain);
	return val;
}

export function getWikiDisplayName(app: App, plugin: WritingMenuPlugin, file: TFile): string {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	return String(fm?.[plugin.settings.wikiNameFieldName] || file.basename);
}

export function getWikiColor(app: App, plugin: WritingMenuPlugin, file: TFile): string {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	return String(fm?.wikiColor || plugin.settings.wikiColor || '#7025db');
}
