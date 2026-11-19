import { Component, Notice, TFolder, type Menu } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { getWritingDocument, getWritingDocumentForView, getOpenWritingDocuments, type WritingDocument } from '../writing/WritingDocument';
import { findHighlights, addHighlightMarkup, removeHighlightMarkup, type SourceHighlight } from './HighlightAnchors';
import { anchorThreads, type AnchorResult } from './HighlightAnchoring';
import type { HighlightThread } from './HighlightCommentTypes';
import { parseInlineMarkdown, sourceOffsetToVisible } from '../paged/MarkdownInlineFormat';
import { splitPagedFrontmatter } from '../paged/PagedFrontmatter';
import { HighlightCommentModal } from './HighlightCommentModal';
import { installPagedCommentHover } from './pagedCommentHover';
import { wmT } from '../i18n';

interface Resolved { highlights: SourceHighlight[]; anchors: AnchorResult[] }

export class HighlightCommentService extends Component {
	private cache = new Map<string, { source: string; result: Resolved }>();
	private listeners = new Set<() => void>();
	private saveTimer = 0;
	private refreshTimer = 0;
	private pendingSave = false;
	constructor(private plugin: WritingMenuPlugin) { super(); }
	get threads(): HighlightThread[] { return Object.values(this.plugin.settings.highlightComments.threads); }
	getThread(id: string): HighlightThread | undefined { return this.plugin.settings.highlightComments.threads[id]; }
	onload(): void {
		this.registerEvent(this.plugin.app.workspace.on('editor-change', () => this.schedule()));
		this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => this.schedule()));
		this.registerEvent(this.plugin.app.vault.on('modify', () => this.schedule()));
		this.registerEvent(this.plugin.app.vault.on('rename', (file, oldPath) => {
			let changed = false;
			for (const thread of this.threads) if (thread.path === oldPath || (file instanceof TFolder && thread.path.startsWith(oldPath + '/'))) {
				thread.path = file.path + thread.path.slice(oldPath.length); changed = true;
			}
			if (changed) this.changed();
		}));
		this.registerEvent(this.plugin.app.vault.on('delete', () => this.schedule()));
		this.registerEvent(this.plugin.app.workspace.on('editor-menu', (menu, _editor, info) => {
			const document = getWritingDocumentForView(info) ?? getOpenWritingDocuments(this.plugin).find(d => d.editor === _editor); if (document && this.plugin.shouldApplyToFile(document.file)) this.menu(menu, document);
		}));
		this.register(this.plugin.onPagedEditorChange(() => this.schedule()));
		installPagedCommentHover(this.plugin, this);
	}
	onunload(): void {
		window.clearTimeout(this.saveTimer); window.clearTimeout(this.refreshTimer);
		if (this.pendingSave) void this.plugin.saveData(this.plugin.settings).catch(error => console.error('Writing Menu: final comment save failed', error));
		this.listeners.clear(); this.cache.clear();
	}
	onChange(callback: () => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
	private emit(): void { for (const listener of this.listeners) listener(); }
	private save(): void {
		this.pendingSave = true; window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => { this.pendingSave = false; void this.plugin.saveSettings().catch(error => { console.error('Writing Menu: comment save failed', error); new Notice(wmT('코멘트를 저장하지 못했습니다.')); }); }, 500);
	}
	private changed(): void { this.cache.clear(); this.save(); this.schedule(); }
	schedule(): void {
		window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => { const document = getWritingDocument(this.plugin); if (document) this.resolve(document); this.emit(); }, 300);
	}
	resolve(document: WritingDocument): Resolved { return this.resolveSource(document.path, document.read()); }
	resolveSource(path: string, source: string): Resolved {
		const cached = this.cache.get(path); if (cached?.source === source) return cached.result;
		const highlights = findHighlights(source), anchors = anchorThreads(this.threads.filter(t => t.path === path), highlights);
		for (const anchor of anchors) if (anchor.highlight) {
			const t = this.getThread(anchor.threadId)!;
			Object.assign(t, { quote: anchor.highlight.text, prefix: anchor.highlight.prefix, suffix: anchor.highlight.suffix, offset: anchor.highlight.from, color: anchor.highlight.color });
			if (anchor.quoteChanged) this.save();
		}
		const result = { highlights, anchors }; this.cache.set(path, { source, result });
		// Only a small number of open manuscripts need a live parse cache.
		if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value!);
		return result;
	}
	addComment(path: string, highlight: SourceHighlight, body: string): HighlightThread {
		body = body.trim(); if (!body) throw new Error(wmT('댓글을 입력해 주세요.'));
		const cached = this.cache.get(path)?.result;
		const anchor = cached?.anchors.find(a => a.highlight?.from === highlight.from && a.highlight?.to === highlight.to);
		let thread = anchor ? this.getThread(anchor.threadId) : this.threads.find(t => t.path === path && t.offset === highlight.from && t.quote === highlight.text);
		const now = Date.now();
		if (!thread) {
			thread = { id: crypto.randomUUID(), path, quote: highlight.text, prefix: highlight.prefix, suffix: highlight.suffix, offset: highlight.from, color: highlight.color, status: 'open', comments: [], createdAt: now, updatedAt: now };
			this.plugin.settings.highlightComments.threads[thread.id] = thread;
		}
		thread.comments.push({ id: crypto.randomUUID(), body, createdAt: now, updatedAt: now }); thread.updatedAt = now; this.changed(); return thread;
	}
	appendComment(threadId: string, body: string): void {
		const t = this.getThread(threadId); if (!t || !body.trim()) return;
		const now = Date.now(); t.comments.push({ id: crypto.randomUUID(), body: body.trim(), createdAt: now, updatedAt: now }); t.updatedAt = now; this.changed();
	}
	editComment(threadId: string, commentId: string, body: string): void {
		const t = this.getThread(threadId), c = t?.comments.find(c => c.id === commentId); if (!t || !c || !body.trim()) return;
		c.body = body.trim(); c.updatedAt = t.updatedAt = Date.now(); this.changed();
	}
	deleteComment(threadId: string, commentId: string): void {
		const t = this.getThread(threadId); if (!t) return;
		t.comments = t.comments.filter(c => c.id !== commentId); t.updatedAt = Date.now();
		if (!t.comments.length) delete this.plugin.settings.highlightComments.threads[threadId]; this.changed();
	}
	setStatus(threadId: string, status: 'open' | 'done'): void { const t = this.getThread(threadId); if (t) { t.status = status; t.updatedAt = Date.now(); this.changed(); } }
	deleteThread(threadId: string): void { delete this.plugin.settings.highlightComments.threads[threadId]; this.changed(); }
	removeHighlight(document: WritingDocument, highlight: SourceHighlight): void {
		const source = document.read();
		if (!document.isCurrent(source)) throw new Error(wmT('원고가 변경되었습니다. 다시 시도해 주세요.'));
		const result = this.resolve(document);
		if (!result.highlights.some(h => h.from === highlight.from && h.to === highlight.to && h.text === highlight.text)) throw new Error(wmT('원고가 변경되었습니다. 다시 시도해 주세요.'));
		const anchor = result.anchors.find(a => a.highlight?.from === highlight.from);
		document.replace(source, removeHighlightMarkup(source, highlight));
		if (anchor) this.setStatus(anchor.threadId, 'done');
		this.cache.delete(document.path); this.schedule(); new Notice(wmT('편집기에서 Ctrl/Cmd+Z로 되돌릴 수 있습니다.'));
	}
	private act(action: () => void): void { try { action(); } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); } }
	private menu(menu: Menu, document: WritingDocument): void {
		const range = document.selectionSourceRange(), source = document.read(), result = this.resolve(document);
		const h = result.highlights.find(h => range.from === range.to ? range.from >= h.from && range.from < h.to : range.from < h.to && range.to > h.from);
		if (h) {
			const threadId = result.anchors.find(a => a.highlight === h)?.threadId, thread = threadId ? this.getThread(threadId) : undefined;
			menu.addItem(item => item.setTitle(thread ? wmT('코멘트 보기 ({0})', thread.comments.length) : wmT('코멘트 달기')).setIcon(thread ? 'message-square-text' : 'message-square-plus').onClick(() => new HighlightCommentModal(this.plugin, document, h, thread?.id).open()));
			menu.addItem(item => item.setTitle(wmT('하이라이트 취소')).setIcon('highlighter').onClick(() => this.act(() => this.removeHighlight(document, h))));
		} else if (range.from !== range.to) menu.addItem(item => item.setTitle(wmT('하이라이트하고 코멘트 달기')).setIcon('message-square-plus').onClick(() => this.act(() => {
			const { prefix, body } = splitPagedFrontmatter(source); if (range.from < prefix.length) return;
			const state = parseInlineMarkdown(body), from = sourceOffsetToVisible(state, range.from - prefix.length), to = sourceOffsetToVisible(state, range.to - prefix.length);
			document.replace(source, addHighlightMarkup(source, from, to, ''));
			const highlight = this.resolve(document).highlights.find(h => h.text === state.visible.slice(from, to) && Math.abs(h.from - range.from) < 30);
			if (highlight) new HighlightCommentModal(this.plugin, document, highlight).open();
		})));
	}
}
