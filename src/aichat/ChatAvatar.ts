import type { TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { getWikiDisplayName, getWikiImgSrc } from '../wiki/wikiProfileUtils';

const rasterCaches = new WeakMap<Document, Map<string, Promise<HTMLCanvasElement>>>();

function portraitRaster(document: Document, src: string, pixels: number): Promise<HTMLCanvasElement> {
	let cache = rasterCaches.get(document);
	if (!cache) { cache = new Map(); rasterCaches.set(document, cache); }
	const key = `${src}\u0000${pixels}`;
	const existing = cache.get(key);
	if (existing) { cache.delete(key); cache.set(key, existing); return existing; }
	const pending = new Promise<HTMLCanvasElement>((resolve, reject) => {
		const image = document.createElement('img');
		image.decoding = 'async';
		image.onerror = () => reject(new Error('프로필 이미지를 불러오지 못했습니다.'));
		image.onload = () => {
			try {
				if (!image.naturalWidth || !image.naturalHeight) throw new Error('비어 있는 프로필 이미지입니다.');
				const raster = document.createElement('canvas'); raster.width = pixels; raster.height = pixels;
				const context = raster.getContext('2d');
				if (!context) throw new Error('프로필 이미지를 그리지 못했습니다.');
				context.imageSmoothingEnabled = true;
				context.imageSmoothingQuality = 'high';
				const side = Math.min(image.naturalWidth, image.naturalHeight);
				context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, pixels, pixels);
				resolve(raster);
			} catch (error) { reject(error); }
		};
		image.src = src;
	});
	cache.set(key, pending);
	while (cache.size > 64) cache.delete(cache.keys().next().value!);
	void pending.catch(() => { if (cache?.get(key) === pending) cache.delete(key); });
	return pending;
}

/** Both chat surfaces use the same image load/fallback lifecycle. */
export function renderChatAvatar(parent: HTMLElement, plugin: WritingMenuPlugin, file: TFile | null, className = 'wm-chat-avatar'): HTMLElement {
	const avatar = parent.createSpan({ cls: className, attr: { 'aria-hidden': 'true' } });
	const name = file ? getWikiDisplayName(plugin.app, plugin, file) : '작가';
	const initial = avatar.createSpan({ cls: 'wm-chat-avatar-initial', text: Array.from(name.trim())[0] ?? '' });
	const src = file ? getWikiImgSrc(plugin.app, plugin, file) : '';
	if (!src) return avatar;
	const canvas = avatar.createEl('canvas', { cls: 'wm-chat-avatar-image', attr: { 'aria-hidden': 'true' } });
	canvas.hidden = true;
	const ratio = Math.min(4, Math.max(2, avatar.ownerDocument.defaultView?.devicePixelRatio ?? 1));
	const pixels = Math.ceil((className === 'wm-chat-avatar' ? 44 : 30) * ratio);
	canvas.width = pixels; canvas.height = pixels;
	void portraitRaster(avatar.ownerDocument, src, pixels).then(raster => {
		const context = canvas.getContext('2d');
		if (!context) throw new Error('프로필 이미지를 그리지 못했습니다.');
		context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
		context.drawImage(raster, 0, 0);
		initial.hidden = true; canvas.hidden = false;
	}).catch(() => { canvas.remove(); initial.hidden = false; });
	return avatar;
}
