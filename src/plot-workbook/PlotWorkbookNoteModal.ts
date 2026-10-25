import { wmT } from '../i18n/index';
import { FuzzySuggestModal, Modal, Notice, Setting, TFile, normalizePath } from 'obsidian';
import type WritingMenuPlugin from '../../main';

export class PlotWorkbookProjectNoteModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: WritingMenuPlugin['app'],
		private readonly projectRoot: string,
		private readonly onChoose: (file: TFile) => void,
		placeholder: string,
		private readonly onlyPaths?: readonly string[],
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): TFile[] {
		const root = normalizePath(this.projectRoot.trim()).replace(/^\/+|\/+$/g, '');
		const allowed = this.onlyPaths ? new Set(this.onlyPaths) : null;
		return this.app.vault.getMarkdownFiles()
			.filter(file => (!root || file.path === `${root}.md` || file.path.startsWith(`${root}/`))
				&& (!allowed || allowed.has(file.path)));
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		this.onChoose(item);
	}
}

export class PlotWorkbookCreateNoteModal extends Modal {
	private noteName: string;

	constructor(
		app: WritingMenuPlugin['app'],
		private readonly folder: string,
		defaultName: string,
		private readonly onCreate: (file: TFile) => void,
	) {
		super(app);
		this.noteName = defaultName;
	}

	onOpen(): void {
		this.setTitle(wmT("본문 노트 생성"));
		new Setting(this.contentEl)
			.setName(wmT("이름"))
			.setDesc(wmT("저장 위치: {0}", this.folder || wmT("볼트 루트")))
			.addText(text => {
				text.setValue(this.noteName)
					.setPlaceholder(wmT("본문 노트 이름"))
					.onChange(value => { this.noteName = value; });
				window.setTimeout(() => {
					text.inputEl.focus();
					text.inputEl.select();
				}, 0);
				text.inputEl.addEventListener('keydown', event => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					void this.create();
				});
			});
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: wmT("취소") }).addEventListener('click', () => this.close());
		actions.createEl('button', { cls: 'mod-cta', text: wmT("생성") }).addEventListener('click', () => void this.create());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async create(): Promise<void> {
		const clean = this.noteName.trim().replace(/\.md$/i, '');
		if (!clean || clean.split(/[\\/]/).some(part => part === '..')) {
			new Notice(wmT("올바른 노트 이름을 입력해주세요."));
			return;
		}
		const folder = normalizePath(this.folder.trim()).replace(/^\/+|\/+$/g, '');
		const path = normalizePath(`${folder ? `${folder}/` : ''}${clean}.md`);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			this.onCreate(existing);
			this.close();
			return;
		}
		if (existing) {
			new Notice(wmT("같은 경로에 폴더가 있습니다."));
			return;
		}
		try {
			if (folder) await this.ensureFolder(folder);
			const file = await this.app.vault.create(path, '');
			this.onCreate(file);
			this.close();
		} catch (error) {
			new Notice(wmT("본문 노트를 만들지 못했습니다: {0}", error instanceof Error ? error.message : String(error)));
		}
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

export class PlotWorkbookNumberingModal extends Modal {
	private value: number;

	constructor(
		app: WritingMenuPlugin['app'],
		current: number,
		private readonly onSubmit: (value: number) => void,
	) {
		super(app);
		this.value = current;
	}

	onOpen(): void {
		this.setTitle(wmT("행 번호 시작값"));
		this.contentEl.createEl('p', {
			text: wmT("이 시트의 첫 정식 행에 표시할 번호를 지정합니다. 세부 행은 자동으로 하위 번호를 사용합니다."),
		});
		new Setting(this.contentEl)
			.setName(wmT("시작 번호"))
			.addText(text => {
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
				text.setValue(String(this.value)).onChange(value => {
					const parsed = Number(value);
					if (Number.isInteger(parsed) && parsed >= 0) this.value = parsed;
				});
			});
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: wmT("취소") }).addEventListener('click', () => this.close());
		actions.createEl('button', { cls: 'mod-cta', text: wmT("적용") }).addEventListener('click', () => {
			if (!Number.isInteger(this.value) || this.value < 0) {
				new Notice(wmT("0 이상의 정수를 입력해주세요."));
				return;
			}
			this.onSubmit(this.value);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
