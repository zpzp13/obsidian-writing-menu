import { App, Notice, TFile, normalizePath } from 'obsidian';
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

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

function mimeTypeForImageExtension(ext: string): string {
	const e = ext.toLowerCase();
	if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
	if (e === 'webp') return 'image/webp';
	if (e === 'gif') return 'image/gif';
	if (e === 'bmp') return 'image/bmp';
	if (e === 'svg') return 'image/svg+xml';
	return 'image/png';
}

/** 화풍 참고 이미지를 Nano Banana 등 멀티모달 이미지 생성 호출에 넣을 수 있는 형태로 읽어온다. */
export async function readImageAsInput(app: App, file: TFile): Promise<{ mimeType: string; base64: string }> {
	const buffer = await app.vault.readBinary(file);
	return { mimeType: mimeTypeForImageExtension(file.extension), base64: arrayBufferToBase64(buffer) };
}

/** 생성된 이미지를 노트와 같은 폴더의 '이미지' 하위 폴더에 저장한다 (노트를 옮기면 함께 따라다님). */
export async function saveGeneratedProfileImage(app: App, noteFile: TFile, base64: string): Promise<TFile> {
	const parentPath = noteFile.parent?.path ?? '';
	const folder = normalizePath(parentPath ? `${parentPath}/이미지` : '이미지');
	if (!app.vault.getAbstractFileByPath(folder)) {
		try { await app.vault.createFolder(folder); } catch { /* already exists */ }
	}
	const filePath = normalizePath(`${folder}/${noteFile.basename}-${Date.now()}.png`);
	return app.vault.createBinary(filePath, base64ToArrayBuffer(base64));
}

/** 이미지 프론트매터 반영 + DOM 즉시 갱신 (수동 선택/AI 생성 공통 사용). */
export async function applyProfileImage(app: App, plugin: WritingMenuPlugin, noteFile: TFile, imgFile: TFile, container: HTMLElement | null): Promise<void> {
	const key = plugin.settings.wikiImageFieldName;
	if (!key) {
		new Notice('플러그인 설정에서 이미지 필드를 먼저 지정하세요.');
		return;
	}
	const linktext = app.metadataCache.fileToLinktext(imgFile, noteFile.path, false);
	await app.fileManager.processFrontMatter(noteFile, (fm: Record<string, unknown>) => { fm[key.trim()] = `[[${linktext}]]`; });
	new Notice(`이미지 업데이트: ${key} = [[${imgFile.name}]]`);
	// DOM 즉시 업데이트 (metadataCache 갱신 전에도 반영)
	const imgSrc = app.vault.getResourcePath(imgFile);
	if (container) {
		container.querySelectorAll<HTMLImageElement>('.wiki-profile-image').forEach(img => { img.src = imgSrc; });
		container.querySelectorAll<HTMLImageElement>('.wiki-card.is-selected .wiki-card-img').forEach(img => { img.src = imgSrc; });
	}
}
