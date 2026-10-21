import { Modal, Notice, Setting } from 'obsidian';
import type WritingMenuPlugin from '../../main';

export type { ChatContextItem } from './AiChatTypes';

export class ChatTextModal extends Modal {
	constructor(plugin: WritingMenuPlugin, private title: string, private value: string, private submit?: (value: string) => void | Promise<void>) { super(plugin.app); }
	onOpen(): void {
		this.setTitle(this.title); this.modalEl.addClass('wm-chat-text-modal');
		const input = this.contentEl.createEl('textarea'); input.value = this.value; input.readOnly = !this.submit;
		input.setAttribute('aria-label', this.title);
		if (this.submit) new Setting(this.contentEl).addButton(button => button.setButtonText('저장').setCta().onClick(async () => {
			button.setDisabled(true);
			try { await this.submit!(input.value); this.close(); } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); button.setDisabled(false); }
		}));
	}
}
