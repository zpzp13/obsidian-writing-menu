import type { Component } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { PagedWritingView } from '../paged/PagedWritingView';
import { parseInlineMarkdown, visibleOffsetToSource, type InlineFormatState } from '../paged/MarkdownInlineFormat';
import { splitPagedFrontmatter } from '../paged/PagedFrontmatter';
import type { HighlightThread } from './HighlightCommentTypes';
import { renderCommentTooltip } from './HighlightCommentUi';

const SHOW_DELAY = 300;

/** Hover cards for commented highlights in the paged view (CM6 has its own). */
export function installPagedCommentHover(plugin: WritingMenuPlugin, owner: Component): void {
	let tip: HTMLElement | null = null, tipThread = '', timer = 0;
	let parsed: { source: string; prefix: number; state: InlineFormatState } | null = null;
	const hide = () => { window.clearTimeout(timer); tip?.remove(); tip = null; tipThread = ''; };
	const threadAt = (span: HTMLElement): HighlightThread | undefined => {
		const view = plugin.app.workspace.getLeavesOfType('writing-menu-paged-writing').map(leaf => leaf.view)
			.find((v): v is PagedWritingView => v instanceof PagedWritingView && v.containerEl.contains(span));
		const file = view?.file;
		if (!view || !file || !span.firstChild || !plugin.shouldApplyToFile(file) || !plugin.highlightComments.threads.some(t => t.path === file.path)) return;
		const visible = view.visibleOffsetAt(span.firstChild, 0);
		if (visible === null) return;
		const source = view.getViewData();
		if (parsed?.source !== source) { const { prefix, body } = splitPagedFrontmatter(source); parsed = { source, prefix: prefix.length, state: parseInlineMarkdown(body) }; }
		const at = parsed.prefix + visibleOffsetToSource(parsed.state, visible, 'right');
		const anchor = plugin.highlightComments.resolveSource(file.path, source).anchors.find(a => a.highlight && at >= a.highlight.from && at < a.highlight.to);
		const thread = anchor ? plugin.highlightComments.getThread(anchor.threadId) : undefined;
		return thread?.comments.length ? thread : undefined;
	};
	const show = (span: HTMLElement, thread: HighlightThread) => {
		const doc = span.ownerDocument;
		tip = doc.body.createDiv({ cls: 'wm-hlc-floating' }); tipThread = thread.id;
		renderCommentTooltip(tip, thread);
		const rect = span.getBoundingClientRect(), box = tip.getBoundingClientRect(), width = doc.documentElement.clientWidth;
		const above = rect.top - box.height - 6;
		tip.setCssStyles({
			left: `${Math.max(8, Math.min(width - box.width - 8, rect.left))}px`,
			top: `${above >= 8 ? above : rect.bottom + 6}px`,
		});
	};
	owner.registerDomEvent(document, 'mouseover', event => {
		const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.wm-paged-formatted-text') : null;
		if (!target?.style.backgroundColor) { hide(); return; }
		const thread = threadAt(target);
		if (thread?.id === tipThread) return; // still inside the same highlight
		hide();
		if (thread) timer = window.setTimeout(() => { if (target.isConnected) show(target, thread); }, SHOW_DELAY);
	});
	for (const type of ['pointerdown', 'keydown', 'wheel'] as const) owner.registerDomEvent(document, type, hide, { capture: true, passive: true });
	owner.register(hide);
}
