import { App, Modal, SuggestModal, TFile, normalizePath } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { fireAndForget } from '../utils/asyncUtils';

interface CharSuggestion {
	file: TFile | null;
	label: string;
	isCreate: boolean;
}

class ConfirmMoveModal extends Modal {
	constructor(
		app: App,
		private fileName: string,
		private targetFolder: string,
		private onMove: () => void,
		private onKeep: () => void,
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText('노트 이동');
		const { contentEl } = this;
		contentEl.createEl('p', {
			text: `"${this.fileName}"이(가) 지정된 폴더(${this.targetFolder})에 없습니다. 이동하시겠습니까?`,
			cls: 'wm-confirm-move-msg',
		});
		const row = contentEl.createDiv({ cls: 'wm-confirm-move-btns' });
		const moveBtn = row.createEl('button', { text: '이동', cls: 'wm-confirm-move-btn mod-cta' });
		const keepBtn = row.createEl('button', { text: '그냥 연결', cls: 'wm-confirm-move-btn' });
		moveBtn.addEventListener('click', () => { this.close(); this.onMove(); });
		keepBtn.addEventListener('click', () => { this.close(); this.onKeep(); });
	}

	onClose() { this.contentEl.empty(); }
}

export class CharacterNoteModal extends SuggestModal<CharSuggestion> {
	constructor(
		private plugin: WritingMenuPlugin,
		private onConfirm: (name: string, filePath: string | null) => void,
	) {
		super(plugin.app);
		this.setPlaceholder('인물 노트 검색 또는 이름 입력…');
	}

	getSuggestions(query: string): CharSuggestion[] {
		const q = query.toLowerCase().trim();
		const files = this.app.vault.getMarkdownFiles();
		const results: CharSuggestion[] = files
			.filter(f => !q || f.basename.toLowerCase().includes(q))
			.map(f => ({ file: f, label: f.basename, isCreate: false }));

		if (query.trim()) {
			results.push({
				file: null,
				label: `새 노트 만들기: "${query.trim()}"`,
				isCreate: true,
			});
		}
		return results;
	}

	renderSuggestion(item: CharSuggestion, el: HTMLElement) {
		el.createEl('div', { text: item.label, cls: item.isCreate ? 'wm-char-modal-create' : '' });
	}

	onChooseSuggestion(item: CharSuggestion): void {
		fireAndForget(() => this.doChooseSuggestion(item));
	}

	private async doChooseSuggestion(item: CharSuggestion) {
		const root = this.plugin.settings.plotManagerFolder?.trim() ?? '';
		const charSub = this.plugin.settings.plotCharFolder?.trim() ?? '';
		const targetFolder = charSub && root
			? normalizePath(root + '/' + charSub)
			: root;

		if (!item.isCreate && item.file) {
			const file = item.file;
			const fileFolder = file.parent?.path ?? '';
			const isInTarget = targetFolder && fileFolder === targetFolder;

			if (!isInTarget && targetFolder) {
				new ConfirmMoveModal(
					this.app,
					file.basename,
					targetFolder,
					() => {
						fireAndForget(async () => {
							const newPath = normalizePath(targetFolder + '/' + file.name);
							try {
								await this.ensureFolder(targetFolder);
								await this.app.fileManager.renameFile(file, newPath);
								this.onConfirm(file.basename, newPath);
							} catch {
								this.onConfirm(file.basename, file.path);
							}
						});
					},
					() => this.onConfirm(file.basename, file.path),
				).open();
			} else {
				this.onConfirm(file.basename, file.path);
			}
			return;
		}

		// Create new note
		const name = this.inputEl.value.trim();
		if (!name) return;

		const folder = targetFolder || '';
		const path = folder
			? normalizePath(folder + '/' + name + '.md')
			: normalizePath(name + '.md');

		try {
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) {
				this.onConfirm(name, existing.path);
				return;
			}

			// Apply template if configured
			let content = '';
			const templatePath = this.plugin.settings.plotCharNoteTemplate?.trim();
			if (templatePath) {
				const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
				if (templateFile instanceof TFile) {
					content = await this.app.vault.read(templateFile);
				}
			}

			if (folder) await this.ensureFolder(folder);
			const file = await this.app.vault.create(path, content);
			this.onConfirm(name, file.path);
		} catch {
			this.onConfirm(name, null);
		}
	}

	private async ensureFolder(folder: string): Promise<void> {
		if (!(await this.app.vault.adapter.exists(folder))) {
			await this.app.vault.adapter.mkdir(folder);
		}
	}
}
