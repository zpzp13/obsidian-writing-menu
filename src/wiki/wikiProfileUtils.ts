import { wmT } from '../i18n/index';
import { App, Notice, TFile } from 'obsidian';
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

/** 이미지 프론트매터 반영 + DOM 즉시 갱신. */
export async function applyProfileImage(app: App, plugin: WritingMenuPlugin, noteFile: TFile, imgFile: TFile, container: HTMLElement | null): Promise<void> {
	const key = plugin.settings.wikiImageFieldName;
	if (!key) {
		new Notice(wmT("플러그인 설정에서 이미지 필드를 먼저 지정하세요."));
		return;
	}
	const linktext = app.metadataCache.fileToLinktext(imgFile, noteFile.path, false);
	await app.fileManager.processFrontMatter(noteFile, (fm: Record<string, unknown>) => { fm[key.trim()] = `[[${linktext}]]`; });
	new Notice(wmT("이미지 업데이트: {0} = [[{1}]]", key, imgFile.name));
	// DOM 즉시 업데이트 (metadataCache 갱신 전에도 반영)
	const imgSrc = app.vault.getResourcePath(imgFile);
	if (container) {
		container.querySelectorAll<HTMLImageElement>('.wiki-profile-image').forEach(img => { img.src = imgSrc; });
		container.querySelectorAll<HTMLImageElement>('.wiki-card.is-selected .wiki-card-img').forEach(img => { img.src = imgSrc; });
	}
}
