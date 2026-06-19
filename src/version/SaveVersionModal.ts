import { App, Modal, TFile, Editor } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { VersionManager } from './manager';
import type { VersionStage } from './types';

export class SaveVersionModal extends Modal {
	private file: TFile;
	private editor: Editor;
	private manager: VersionManager;
	private onSaved?: () => void;

	constructor(app: App, plugin: WritingMenuPlugin, file: TFile, editor: Editor, onSaved?: () => void) {
		super(app);
		this.file = file;
		this.editor = editor;
		this.manager = new VersionManager(app, plugin);
		this.onSaved = onSaved;
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('wm-save-ver-modal');
		modalEl.addClass('wm-save-ver-modal-container');

		contentEl.createEl('h3', { text: '버전 저장', cls: 'wm-save-ver-title' });

		const now = new Date();
		const defaultName = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

		// 버전 이름
		contentEl.createEl('label', { text: '버전 이름', cls: 'wm-save-ver-label' });
		const nameInput = contentEl.createEl('input', { cls: 'wm-save-ver-input' });
		nameInput.type = 'text';
		nameInput.placeholder = '예: 초고 완성, 1장 수정';
		nameInput.value = defaultName;

		// 집필 단계
		contentEl.createEl('label', { text: '집필 단계 (선택)', cls: 'wm-save-ver-label' });
		const stageRow = contentEl.createDiv({ cls: 'wm-save-ver-stage-row' });
		let selectedStage: VersionStage | undefined;
		const stages: VersionStage[] = ['초고', '집필', '퇴고'];
		const stageBtns: HTMLButtonElement[] = [];
		for (const s of stages) {
			const btn = stageRow.createEl('button', { text: s, cls: 'wm-save-ver-stage-btn' });
			stageBtns.push(btn);
			btn.addEventListener('click', () => {
				if (selectedStage === s) {
					selectedStage = undefined;
					stageBtns.forEach(b => b.removeClass('wm-save-ver-stage-btn-active'));
				} else {
					selectedStage = s;
					stageBtns.forEach(b => b.removeClass('wm-save-ver-stage-btn-active'));
					btn.addClass('wm-save-ver-stage-btn-active');
				}
			});
		}

		// 설명
		contentEl.createEl('label', { text: '설명 (선택)', cls: 'wm-save-ver-label' });
		const descInput = contentEl.createEl('textarea', { cls: 'wm-save-ver-desc' });
		descInput.placeholder = '이 버전에 대한 메모를 남겨보세요';
		descInput.rows = 3;

		const btnRow = contentEl.createDiv({ cls: 'wm-save-ver-btns' });
		const cancelBtn = btnRow.createEl('button', { text: '취소', cls: 'wm-save-ver-btn-cancel' });
		const saveBtn = btnRow.createEl('button', { text: '저장', cls: 'wm-save-ver-btn-save' });

		const doSave = async () => {
			const name = nameInput.value.trim() || defaultName;
			const description = descInput.value.trim() || undefined;
			saveBtn.textContent = '저장 중…';
			saveBtn.disabled = true;
			await this.manager.saveVersion(this.file, name, this.editor.getValue(), description, selectedStage);
			this.close();
			this.onSaved?.();
		};

		saveBtn.addEventListener('click', () => { void doSave(); });
		cancelBtn.addEventListener('click', () => this.close());
		nameInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') void doSave();
			else if (e.key === 'Escape') this.close();
		});

		window.setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
	}

	onClose() {
		this.contentEl.empty();
	}
}
