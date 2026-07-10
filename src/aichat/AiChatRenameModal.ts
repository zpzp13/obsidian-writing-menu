import { App, Modal, Setting } from 'obsidian';

export class AiChatRenameModal extends Modal {
	constructor(app: App, defaultTitle: string, onSubmit: (newTitle: string) => void) {
		super(app);
		this.setTitle('대화 제목 수정');
		let value = defaultTitle;
		new Setting(this.contentEl).addText(text => {
			text.setValue(defaultTitle).onChange(v => { value = v; });
			text.inputEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') { e.preventDefault(); onSubmit(value.trim() || defaultTitle); this.close(); }
			});
			window.setTimeout(() => text.inputEl.focus(), 20);
		});
		new Setting(this.contentEl).addButton(btn => btn
			.setButtonText('확인')
			.setCta()
			.onClick(() => { onSubmit(value.trim() || defaultTitle); this.close(); }));
	}
}
