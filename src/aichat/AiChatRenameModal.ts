import { wmT } from '../i18n/index';
import { App, ButtonComponent, Modal, TextComponent } from 'obsidian';

export class AiChatRenameModal extends Modal {
	constructor(app: App, defaultTitle: string, onSubmit: (newTitle: string) => void) {
		super(app);
		this.setTitle(wmT("대화 제목 수정"));
		this.modalEl.addClass('wm-chat-rename-modal');
		let value = defaultTitle;
		const text = new TextComponent(this.contentEl);
		text.setValue(defaultTitle).onChange(v => { value = v; });
		text.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); onSubmit(value.trim() || defaultTitle); this.close(); }
		});
		window.setTimeout(() => text.inputEl.focus(), 20);
		new ButtonComponent(this.contentEl.createDiv({ cls: 'modal-button-container' }))
			.setButtonText(wmT("확인"))
			.setCta()
			.onClick(() => { onSubmit(value.trim() || defaultTitle); this.close(); });
	}
}
