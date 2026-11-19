import { Modal, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { HighlightThread } from './HighlightCommentTypes';
import { highlightBackground } from '../utils/ObsidianHighlights';
import { wmT, getLocale } from '../i18n';

export function commentButton(parent: HTMLElement, label: string, action: () => void, icon?: string): HTMLButtonElement {
	const button = parent.createEl('button', { text: icon ? undefined : label, cls: icon ? 'clickable-icon wm-cal-icon-btn' : 'wm-hlc-button', attr: { type: 'button', 'aria-label': label } });
	// No native title: Obsidian already shows aria-label as its own tooltip.
	if (icon) setIcon(button, icon);
	button.onclick = event => { event.stopPropagation(); action(); }; return button;
}

export function matchText(parent: HTMLElement, text: string, query = ''): void {
	const needle = query.trim().toLocaleLowerCase(), lower = text.toLocaleLowerCase();
	let cursor = 0, at = needle ? lower.indexOf(needle) : -1;
	while (at >= 0) {
		parent.appendText(text.slice(cursor, at)); parent.createEl('mark', { cls: 'wm-hlc-match', text: text.slice(at, at + needle.length) });
		cursor = at + needle.length; at = lower.indexOf(needle, cursor);
	}
	parent.appendText(text.slice(cursor));
}

export function commentTime(time: number): string {
	return new Date(time).toLocaleString(getLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Grows with its content so short comments stay one line tall. */
function autoGrow(input: HTMLTextAreaElement): void {
	const fit = () => { input.setCssStyles({ height: 'auto' }); input.setCssStyles({ height: `${input.scrollHeight + 2}px` }); };
	input.addEventListener('input', fit); window.requestAnimationFrame(fit);
}

export interface ComposerOptions {
	key?: string;
	value: string;
	placeholder?: string;
	submitLabel?: string;
	onInput?: (value: string) => void;
	onSubmit: (value: string) => void;
	onCancel?: () => void;
}

/** Comment box: Enter posts, Shift+Enter adds a line, Esc cancels. */
export function commentComposer(parent: HTMLElement, options: ComposerOptions): HTMLTextAreaElement {
	const box = parent.createDiv({ cls: 'wm-hlc-composer' });
	if (options.key) box.dataset.key = options.key;
	const input = box.createEl('textarea', { cls: 'wm-hlc-input', value: options.value, attr: { rows: '1', placeholder: options.placeholder ?? wmT('댓글 입력…'), 'aria-label': options.placeholder ?? wmT('댓글 입력…') } });
	// createEl's value option does not reach a textarea; set it directly so edits start from the saved text.
	input.value = options.value;
	autoGrow(input);
	const foot = box.createDiv({ cls: 'wm-hlc-composer-foot' });
	const submit = () => { if (input.value.trim()) options.onSubmit(input.value); };
	if (options.onCancel) commentButton(foot, wmT('취소'), options.onCancel).addClass('is-ghost');
	const send = commentButton(foot, options.submitLabel ?? wmT('댓글\u0004등록'), submit);
	send.addClass('mod-cta'); send.disabled = !options.value.trim();
	input.addEventListener('input', () => { send.disabled = !input.value.trim(); options.onInput?.(input.value); });
	input.onkeydown = event => {
		if (event.isComposing) return;
		if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
		else if (event.key === 'Escape' && options.onCancel) { event.preventDefault(); event.stopPropagation(); options.onCancel(); }
	};
	box.onclick = event => event.stopPropagation();
	return input;
}

export function confirmThreadDeletion(plugin: WritingMenuPlugin, thread: HighlightThread, action: () => void): void {
	class Confirm extends Modal {
		onOpen(): void {
			this.setTitle(wmT('코멘트 삭제'));
			this.contentEl.createEl('p', { text: wmT('댓글 {0}개가 영구 삭제됩니다.', thread.comments.length) });
			const row = this.contentEl.createDiv({ cls: 'modal-button-container' });
			commentButton(row, wmT('취소'), () => this.close());
			commentButton(row, wmT('삭제'), () => { action(); this.close(); }).addClass('mod-warning');
		}
	}
	new Confirm(plugin.app).open();
}

export function renderComments(plugin: WritingMenuPlugin, parent: HTMLElement, thread: HighlightThread, rerender: () => void, query = ''): void {
	for (const c of thread.comments) {
		// Tools sit outside the card, above its top-right corner.
		const item = parent.createDiv({ cls: 'wm-hlc-comment-item' });
		const tools = item.createDiv({ cls: 'wm-hlc-comment-tools' });
		const row = item.createDiv({ cls: 'wm-hlc-comment' });
		matchText(row.createDiv({ cls: 'wm-hlc-comment-body' }), c.body, query);
		row.createEl('time', { cls: 'wm-hlc-comment-time', text: commentTime(c.updatedAt) + (c.updatedAt > c.createdAt + 1000 ? wmT(' (편집됨)') : ''), attr: { datetime: new Date(c.updatedAt).toISOString() } });
		commentButton(tools, wmT('댓글 편집'), () => {
			item.addClass('is-editing'); row.empty();
			commentComposer(row, { value: c.body, submitLabel: wmT('저장'), onCancel: rerender, onSubmit: value => { plugin.highlightComments.editComment(thread.id, c.id, value); rerender(); } }).focus();
		}, 'pencil');
		commentButton(tools, wmT('삭제'), () => {
			const remove = () => { plugin.highlightComments.deleteComment(thread.id, c.id); rerender(); };
			if (thread.comments.length === 1) confirmThreadDeletion(plugin, thread, remove); else remove();
		}, 'trash-2');
	}
}

/** Hover card for a commented highlight: the latest two comments, newest last. */
export function renderCommentTooltip(parent: HTMLElement, thread: HighlightThread): void {
	parent.addClass('wm-hlc-tooltip');
	parent.style.setProperty('--wm-hlc-color', highlightBackground(thread.color));
	const head = parent.createDiv({ cls: 'wm-hlc-tooltip-head' });
	head.createSpan({ cls: 'wm-hlc-tooltip-swatch' });
	head.createSpan({ text: wmT('댓글 {0}', thread.comments.length) });
	if (thread.status === 'done') head.createSpan({ cls: 'wm-hlc-status', text: wmT('완료') });
	const shown = thread.comments.slice(-2), hidden = thread.comments.length - shown.length;
	if (hidden > 0) parent.createDiv({ cls: 'wm-hlc-tooltip-more', text: wmT('이전 댓글 {0}개', hidden) });
	for (const comment of shown) {
		const row = parent.createDiv({ cls: 'wm-hlc-tooltip-comment' });
		row.createDiv({ cls: 'wm-hlc-tooltip-body', text: comment.body });
		row.createDiv({ cls: 'wm-hlc-tooltip-time', text: commentTime(comment.updatedAt) });
	}
}
