import { Modal, Notice, Setting, TFile, normalizePath } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { PlotWorkbookProjectNoteModal } from './PlotWorkbookNoteModal';

export class PlotWorkbookCharacterModal extends Modal {
	constructor(
		plugin: WritingMenuPlugin,
		private readonly characterFolder: string,
		private readonly onChoose: (file: TFile) => void,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.setTitle('인물 지정');
		this.contentEl.addClass('wm-plotbook-character-modal');
		new Setting(this.contentEl)
			.setName('기존 노트')
			.setDesc('위키 프로필로 사용할 노트를 선택합니다.')
			.addButton(button => button
				.setButtonText('선택')
				.setCta()
				.onClick(() => {
					this.close();
					new PlotWorkbookProjectNoteModal(
						this.app,
						this.characterFolder,
						file => this.onChoose(file),
						'인물 노트를 검색하세요...',
					).open();
				}));

		let relativePath = '';
		new Setting(this.contentEl)
			.setName('새 노트')
			.setDesc('설정한 인물 폴더를 기준으로 새 인물 노트를 만듭니다.')
			.addText(text => text
				.setPlaceholder('인물/이름')
				.onChange(value => { relativePath = value; }))
			.addButton(button => button
				.setButtonText('생성')
				.onClick(() => void this.createNote(relativePath)));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async createNote(rawPath: string): Promise<void> {
		const clean = rawPath.trim().replace(/\.md$/i, '');
		if (!clean || clean.split(/[\\/]/).some(part => part === '..')) {
			new Notice('새 인물 노트의 경로를 입력해주세요.');
			return;
		}
		const root = normalizePath(this.characterFolder).replace(/^\/+|\/+$/g, '');
		const path = normalizePath(`${root ? `${root}/` : ''}${clean}.md`);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing && !(existing instanceof TFile)) {
			new Notice('같은 경로에 폴더가 있습니다.');
			return;
		}
		let file: TFile;
		try {
			if (existing instanceof TFile) {
				file = existing;
			} else {
				const folderPath = path.split('/').slice(0, -1).join('/');
				if (folderPath) await this.ensureFolder(folderPath);
				file = await this.app.vault.create(path, '');
			}
		} catch (error) {
			new Notice(`인물 노트를 만들지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		this.onChoose(file);
		this.close();
	}

	private async ensureFolder(path: string): Promise<void> {
		let current = '';
		for (const part of normalizePath(path).split('/').filter(Boolean)) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				try { await this.app.vault.createFolder(current); } catch { /* already created */ }
			}
		}
	}
}

export class PlotWorkbookCastConfirmModal extends Modal {
	constructor(app: WritingMenuPlugin['app'], private readonly onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('등장 열로 변경');
		this.contentEl.createEl('p', {
			text: '이 열에 입력한 내용은 삭제되며, 등장 인물을 행별로 지정하는 전용 열로 변경됩니다.',
		});
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: '취소' });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', { cls: 'mod-warning', text: '변경' });
		confirm.addEventListener('click', () => {
			this.onConfirm();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class PlotWorkbookRoleConfirmModal extends Modal {
	constructor(
		app: WritingMenuPlugin['app'],
		private readonly roleLabel: '상태' | '날짜' | '복선' | '체크리스트',
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(`${this.roleLabel} 열로 변경`);
		this.contentEl.createEl('p', {
			text: `이 열에 입력한 내용은 삭제되며, ${this.roleLabel} 전용 입력 방식으로 변경됩니다.`,
		});
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: '취소' });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', { cls: 'mod-warning', text: '변경' });
		confirm.addEventListener('click', () => {
			this.onConfirm();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
