import { App, Modal, Notice } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { VersionEntry } from './types';
import { VersionManager } from './manager';

export class EditVersionModal extends Modal {
	constructor(
		app: App,
		private plugin: WritingMenuPlugin,
		private file: import('obsidian').TFile,
		private entry: VersionEntry,
		private manager: VersionManager,
		private onSaved?: () => void
	) { super(app); }

	async onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('wm-edit-ver-modal');

		// ── 표 ───────────────────────────────────────────────────────────
		const table = contentEl.createDiv({ cls: 'wm-evm-table' });

		// 1행: 표제
		const row1 = table.createDiv({ cls: 'wm-evm-row wm-evm-row-2col' });
		row1.createDiv({ cls: 'wm-evm-cell-label', text: '표제' });
		const nameCell = row1.createDiv({ cls: 'wm-evm-cell-field' });
		const nameInput = nameCell.createEl('input', { cls: 'wm-evm-field' }) as HTMLInputElement;
		nameInput.type = 'text';
		nameInput.value = this.entry.name;
		nameInput.spellcheck = false;

		// 2행: 설명
		const row2 = table.createDiv({ cls: 'wm-evm-row wm-evm-row-2col' });
		row2.createDiv({ cls: 'wm-evm-cell-label', text: '설명' });
		const descCell = row2.createDiv({ cls: 'wm-evm-cell-field' });
		const descInput = descCell.createEl('input', { cls: 'wm-evm-field' }) as HTMLInputElement;
		descInput.type = 'text';
		descInput.value = this.entry.description ?? '';
		descInput.placeholder = '메모';
		descInput.spellcheck = false;

		// 3행: 본문 (async 로드)
		const row3 = table.createDiv({ cls: 'wm-evm-row wm-evm-row-body' });
		const skeleton = row3.createDiv({ cls: 'wm-evm-skeleton' });
		for (let i = 0; i < 3; i++) skeleton.createDiv({ cls: 'wm-evm-skeleton-line' });

		let originalContent = '';
		try { originalContent = await this.manager.readVersion(this.file, this.entry); } catch (_e) {}
		skeleton.remove();

		const bodyInput = row3.createEl('textarea', { cls: 'wm-evm-field wm-evm-field-body' }) as HTMLTextAreaElement;
		bodyInput.value = originalContent;
		bodyInput.spellcheck = false;

		// ── 푸터 ─────────────────────────────────────────────────────────
		const footer = contentEl.createDiv({ cls: 'wm-evm-footer' });
		const charInfo = footer.createSpan({ cls: 'wm-evm-char-info' });
		const updateCharInfo = () => {
			const len = bodyInput.value.replace(/[\n ]/g, '').length;
			charInfo.textContent = `${len.toLocaleString()}자`;
		};
		updateCharInfo();
		bodyInput.addEventListener('input', updateCharInfo);

		const cancelBtn = footer.createEl('button', { text: '취소', cls: 'wm-evm-btn' });
		const saveBtn = footer.createEl('button', { text: '저장', cls: 'wm-evm-btn' });

		const doSave = async () => {
			if (saveBtn.disabled) return;
			saveBtn.disabled = true;
			saveBtn.textContent = '저장 중…';
			const newName = nameInput.value.trim() || this.entry.name;
			const newDesc = descInput.value.trim() || undefined;
			const newContent = bodyInput.value;
			await this.manager.updateVersion(this.file, this.entry.id, { name: newName, description: newDesc });
			if (newContent !== originalContent) {
				await this.manager.updateVersionContent(this.file, this.entry.id, newContent);
			}
			new Notice(`"${newName}" 저장됨`);
			this.close();
			this.onSaved?.();
		};

		cancelBtn.addEventListener('click', () => this.close());
		saveBtn.addEventListener('click', doSave);
		nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } });
		descInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } });
		bodyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); doSave(); } });

		window.setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
	}

	onClose() { this.contentEl.empty(); }
}
