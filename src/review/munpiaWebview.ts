import { Modal, Platform, type App } from 'obsidian';
import { wmT } from '../i18n/index';

/*
 * Obsidian's desktop app is Electron and allows <webview> (its own Web viewer
 * uses it). A webview with a persistent partition keeps the Munpia login in a
 * cookie jar of its own, separate from Obsidian and from the user's browser.
 * The author types the password into Munpia's page; this plugin never reads
 * or stores it.
 */
export const MUNPIA_PARTITION = 'persist:writing-menu-munpia';

interface WebviewElement extends HTMLElement {
	executeJavaScript(code: string): Promise<unknown>;
	loadURL(url: string): Promise<void>;
}

function createWebview(parent: HTMLElement, url: string, cls: string): WebviewElement {
	const view = parent.createEl('webview' as keyof HTMLElementTagNameMap, { cls }) as unknown as WebviewElement;
	view.setAttribute('partition', MUNPIA_PARTITION);
	view.setAttribute('src', url);
	return view;
}

export function webviewSupported(): boolean { return Platform.isDesktopApp; }

/** Visible window where the author signs in to Munpia themself. */
export class MunpiaLoginModal extends Modal {
	constructor(app: App, private onDone: () => void) { super(app); }
	onOpen(): void {
		this.modalEl.addClass('wm-rv-login-modal');
		this.setTitle(wmT('문피아 로그인'));
		this.contentEl.createEl('p', { cls: 'wm-rv-login-hint', text: wmT('문피아 페이지에서 직접 로그인한 뒤 완료를 누르세요. 비밀번호는 문피아에만 입력되고 플러그인은 저장하지 않습니다.') });
		createWebview(this.contentEl, 'https://www.munpia.com/', 'wm-rv-login-webview');
		const footer = this.contentEl.createDiv({ cls: 'modal-button-container' });
		footer.createEl('button', { cls: 'mod-cta', text: wmT('완료') }).onclick = () => this.close();
	}
	onClose(): void { this.contentEl.empty(); this.onDone(); }
}

export interface CommentScrape { comments: string[]; loginRequired: boolean; url: string }

/** Opens a page in an off-screen webview (never painted for the author) and runs `read` against it. */
async function withHiddenPage<T>(url: string, timeoutMs: number, read: (view: WebviewElement) => Promise<T>): Promise<T> {
	const host = document.body.createDiv({ cls: 'wm-rv-hidden-webview-host', attr: { 'aria-hidden': 'true' } });
	const view = createWebview(host, url, 'wm-rv-hidden-webview');
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(() => reject(new Error(wmT('댓글 페이지를 불러오지 못했습니다(시간 초과). 이 옵시디언 버전이 웹뷰를 지원하지 않을 수도 있습니다.'))), timeoutMs);
			view.addEventListener('did-finish-load', () => { window.clearTimeout(timer); resolve(); }, { once: true });
			view.addEventListener('did-fail-load', () => { window.clearTimeout(timer); reject(new Error(wmT('댓글 페이지를 불러오지 못했습니다.'))); }, { once: true });
		});
		// Comments are often loaded after the page; scroll to the end and give them a moment.
		await view.executeJavaScript('window.scrollTo(0, document.body.scrollHeight); true');
		await new Promise(resolve => window.setTimeout(resolve, 3000));
		return await read(view);
	} finally { host.remove(); }
}

/**
 * Returns comment texts found with the given CSS selectors. Raw comments only
 * leave this function as data for the digest; nothing is rendered.
 */
export async function scrapeComments(url: string, selectors: string, timeoutMs = 30000): Promise<CommentScrape> {
	return withHiddenPage(url, timeoutMs, async view => {
		const result = await view.executeJavaScript(`(() => {
			const selectors = ${JSON.stringify(selectors)}.split(',').map(s => s.trim()).filter(Boolean);
			const seen = new Set(), comments = [];
			for (const selector of selectors) {
				let nodes = []; try { nodes = Array.from(document.querySelectorAll(selector)); } catch (e) { continue; }
				for (const node of nodes) {
					const text = (node.innerText || '').replace(/\\s+/g, ' ').trim();
					if (text && text.length <= 1000 && !seen.has(text)) { seen.add(text); comments.push(text); }
				}
				if (comments.length) break;
			}
			const body = document.body ? document.body.innerText : '';
			const loginRequired = !comments.length && /로그인/.test(body) && /(댓글|코멘트)/.test(body);
			return { comments: comments.slice(0, 300), loginRequired, url: location.href };
		})()`) as CommentScrape;
		return { comments: Array.isArray(result?.comments) ? result.comments.filter(c => typeof c === 'string') : [], loginRequired: !!result?.loginRequired, url: typeof result?.url === 'string' ? result.url : url };
	});
}

/** One comment as delivered to the digest. The nickname is only ever shown for positive comments. */
export interface MunpiaComment { id: string; nick: string; text: string; time: string; likes?: number; dislikes?: number }

/**
 * Comments through Munpia's own comment API, called from inside the
 * logged-in webview (same origin, so its cookies apply). Only the main page
 * is opened, never the chapter. Found with the page inspection: the viewer
 * loads /api/v1/pc/novel-detail/{novel}/entries/{chapter}/comments?order=LATEST&page=N.
 * Paging stops early once a page holds only ids listed in `known`.
 */
export async function fetchMunpiaComments(novel: string, chapter: number, known: string[] = [], maxPages = 15, timeoutMs = 30000): Promise<{ items: MunpiaComment[]; loginRequired: boolean; status: number }> {
	const novelId = Number(novel), chapterId = Number(chapter);
	if (!Number.isInteger(novelId) || !Number.isInteger(chapterId)) throw new Error(wmT('작품 또는 회차 번호가 올바르지 않습니다.'));
	return withHiddenPage('https://www.munpia.com/', timeoutMs, async view => {
		const result = await view.executeJavaScript(`(async () => {
			const known = new Set(${JSON.stringify(known)}), items = [], seen = new Set();
			let loginRequired = false, status = 0;
			const first = (item, keys) => {
				for (const key of keys) {
					const value = item[key];
					if ((typeof value === 'string' && value.trim()) || typeof value === 'number') return String(value);
				}
				for (const nested of ['member', 'writer', 'user', 'author', 'profile']) {
					const inner = item[nested];
					if (inner && typeof inner === 'object') for (const key of keys) if (typeof inner[key] === 'string' && inner[key].trim()) return inner[key];
				}
				return '';
			};
			const findList = value => {
				if (Array.isArray(value)) return value;
				if (value && typeof value === 'object') for (const key of ['list', 'content', 'comments', 'items', 'data', 'result']) {
					const found = findList(value[key]); if (found) return found;
				}
				return null;
			};
			const hash = text => { let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0; return 't' + (h >>> 0).toString(36); };
			const add = item => {
				if (!item || typeof item !== 'object') return null;
				const text = first(item, ['content', 'comment', 'contents', 'body', 'text', 'message']).replace(/\\s+/g, ' ').trim();
				if (!text) return null;
				const id = first(item, ['id', 'commentId', 'commentNo', 'cmtNo', 'seq', 'no']) || hash(text);
				if (seen.has(id)) return id;
				seen.add(id);
				items.push({ id, text: text.slice(0, 1000),
					nick: first(item, ['nickname', 'nickName', 'nick', 'writerNickname', 'writerName', 'memberNick', 'memberNickname', 'userNickname', 'memberName', 'userName', 'name']).slice(0, 40),
					time: first(item, ['createdAt', 'regDate', 'createdDate', 'writeDate', 'registeredAt', 'date']).slice(0, 40),
					likes: Number(first(item, ['likeCount', 'likeCnt', 'goodCount', 'goodCnt', 'recommendCount', 'recomCount', 'recomCnt', 'upCount', 'agreeCount', 'sympathyCount', 'likes', 'like', 'good'])) || 0,
					dislikes: Number(first(item, ['dislikeCount', 'dislikeCnt', 'badCount', 'badCnt', 'hateCount', 'unlikeCount', 'downCount', 'disagreeCount', 'dislikes', 'dislike', 'bad'])) || 0 });
				return id;
			};
			for (let page = 1; page <= ${maxPages}; page++) {
				const response = await fetch('/api/v1/pc/novel-detail/${novelId}/entries/${chapterId}/comments?order=LATEST&page=' + page, { credentials: 'include', headers: { Accept: 'application/json' } });
				status = response.status;
				if (status === 401 || status === 403) { loginRequired = true; break; }
				if (!response.ok) break;
				const json = await response.json();
				if (json && typeof json === 'object' && 'code' in json && !['M000_00000', 'SUCCESS', 200].includes(json.code)) {
					if (/login|auth|로그인/i.test(String(json.message || json.code))) loginRequired = true;
					break;
				}
				const list = findList(json && typeof json === 'object' && 'result' in json ? json.result : json) || [];
				let fresh = 0, any = 0;
				for (const item of list) {
					const id = add(item); if (id) { any++; if (!known.has(id)) fresh++; }
					const replies = item && typeof item === 'object' ? findList(item.replies || item.children || item.replyList) : null;
					if (replies) for (const reply of replies) add(reply);
				}
				if (!any || !fresh) break;
			}
			return { items: items.slice(0, 600), loginRequired, status };
		})()`) as { items: MunpiaComment[]; loginRequired: boolean; status: number };
		const items = Array.isArray(result?.items) ? result.items.filter(item => item && typeof item.text === 'string' && typeof item.id === 'string') : [];
		return { items, loginRequired: !!result?.loginRequired, status: typeof result?.status === 'number' ? result.status : 0 };
	});
}
