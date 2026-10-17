import { Modal } from 'obsidian';
import type WritingMenuPlugin from '../../main';

export class PlotWorkbookStatusModal extends Modal {
	constructor(
		plugin: WritingMenuPlugin,
		private readonly onSubmit: (name: string) => void | Promise<void>,
		private readonly initialName?: string,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.setTitle(this.initialName === undefined ? '새 상태' : '상태 수정');
		this.contentEl.addClass('wm-plotbook-status-modal');
		const input = this.contentEl.createEl('input', {
			type: 'text',
			placeholder: '상태 이름',
			attr: { 'aria-label': this.initialName === undefined ? '새 상태 이름' : '상태 이름 수정' },
		});
		input.value = this.initialName ?? '';
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: '취소' });
		cancel.addEventListener('click', () => this.close());
		const add = actions.createEl('button', { cls: 'mod-cta', text: this.initialName === undefined ? '추가' : '수정' });
		const submit = () => {
			const name = input.value.trim();
			if (!name) return;
			void this.onSubmit(name);
			this.close();
		};
		add.addEventListener('click', submit);
		input.addEventListener('keydown', event => {
			if (event.key !== 'Enter' || event.isComposing) return;
			event.preventDefault();
			submit();
		});
		window.setTimeout(() => input.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class PlotWorkbookStatusDeleteModal extends Modal {
	constructor(plugin: WritingMenuPlugin, private readonly name: string, private readonly onConfirm: () => Promise<void>) { super(plugin.app); }
	onOpen(): void {
		this.setTitle('상태 삭제');
		this.contentEl.createEl('p', { text: `“${this.name}” 상태를 선택 목록에서 삭제합니다. 이미 사용 중인 셀의 상태 기록은 유지됩니다.` });
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: '취소' }).addEventListener('click', () => this.close());
		actions.createEl('button', { cls: 'mod-warning', text: '삭제' }).addEventListener('click', () => { this.close(); void this.onConfirm(); });
	}
	onClose(): void { this.contentEl.empty(); }
}
