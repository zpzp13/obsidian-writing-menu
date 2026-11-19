import { Modal, Notice } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { WritingDocument } from '../writing/WritingDocument';
import type { SourceHighlight } from './HighlightAnchors';
import { highlightBackground } from '../utils/ObsidianHighlights';
import { commentButton, commentComposer, renderComments } from './HighlightCommentUi';
import { wmT } from '../i18n';

export class HighlightCommentModal extends Modal {
	private unsubscribe?: () => void;
	private pending = false;
	private draft = '';
	constructor(private plugin: WritingMenuPlugin, private document: WritingDocument, private highlight: SourceHighlight, private threadId?: string) { super(plugin.app); }
	onOpen(): void {
		this.modalEl.addClass('wm-hlc-modal'); this.setTitle(wmT('하이라이트 코멘트')); this.render();
		this.unsubscribe = this.plugin.highlightComments.onChange(() => {
			if (this.contentEl.contains(this.contentEl.ownerDocument.activeElement) && this.contentEl.ownerDocument.activeElement?.tagName === 'TEXTAREA') this.pending = true; else this.render();
		});
		this.contentEl.addEventListener('focusout', () => { window.setTimeout(() => { if (this.pending && this.contentEl.ownerDocument.activeElement?.tagName !== 'TEXTAREA') { this.pending = false; this.render(); } }, 0); });
	}
	onClose(): void { this.unsubscribe?.(); this.contentEl.empty(); }
	private render(): void {
		this.contentEl.empty();
		const quote = this.contentEl.createDiv({ cls: 'wm-hlc-modal-quote', text: this.highlight.text });
		quote.style.setProperty('--wm-hlc-color', highlightBackground(this.highlight.color));
		const thread = this.threadId ? this.plugin.highlightComments.getThread(this.threadId) : undefined;
		if (thread?.comments.length) renderComments(this.plugin, this.contentEl.createDiv({ cls: 'wm-hlc-thread' }), thread, () => this.render());
		commentComposer(this.contentEl, {
			value: this.draft,
			placeholder: thread?.comments.length ? wmT('답글') + '…' : wmT('댓글 입력…'),
			onInput: value => { this.draft = value; },
			onSubmit: value => {
				if (this.threadId && this.plugin.highlightComments.getThread(this.threadId)) this.plugin.highlightComments.appendComment(this.threadId, value);
				else {
					if (!this.document.isCurrent(this.document.read())) { new Notice(wmT('원고가 변경되었습니다. 다시 시도해 주세요.')); return; }
					const resolved = this.plugin.highlightComments.resolve(this.document);
					const current = resolved.highlights.find(h => h.from === this.highlight.from && h.text === this.highlight.text);
					if (!current) { new Notice(wmT('원고가 변경되었습니다. 다시 시도해 주세요.')); return; }
					this.threadId = this.plugin.highlightComments.addComment(this.document.path, current, value).id;
				}
				this.draft = ''; this.render();
			},
		}).focus();
		const footer = this.contentEl.createDiv({ cls: 'wm-hlc-modal-footer' });
		commentButton(footer, wmT('REVISION에서 보기'), () => { this.close(); void this.plugin.openHighlightComments(this.threadId); }).addClass('is-ghost');
	}
}
