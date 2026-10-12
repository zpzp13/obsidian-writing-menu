import { App, FuzzyMatch, FuzzySuggestModal, Modal, Notice, Setting, TFile, TFolder, setIcon } from 'obsidian';
import { AI_IMAGE_MODELS, IMAGE_ASPECT_RATIOS, EXAMPLE_PROMPT_WITH_REFERENCE, EXAMPLE_PROMPT_WITHOUT_REFERENCE, callImageGenerate, getImageProvider, type AiImageApiKeys } from '../aichat/AiImageApi';
import { readImageAsInput } from './wikiProfileUtils';

export class NoteSuggestModal extends FuzzySuggestModal<TFile> {
	onChoose: (result: TFile) => void;
	constructor(app: App, onChoose: (result: TFile) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder('불러올 노트를 검색하세요...');
	}
	getItems(): TFile[] { return this.app.vault.getMarkdownFiles(); }
	getItemText(item: TFile): string { return item.path; }
	onChooseItem(item: TFile): void { this.onChoose(item); }
}

/** 폴더 또는 마크다운 노트를 함께 검색·선택하는 통합 모달 */
export class FolderOrNoteSuggestModal extends FuzzySuggestModal<TFolder | TFile> {
	onChoose: (result: TFolder | TFile) => void;
	constructor(app: App, onChoose: (result: TFolder | TFile) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder('폴더 또는 노트를 선택하세요...');
	}
	getItems(): (TFolder | TFile)[] {
		const folders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder);
		const notes = this.app.vault.getMarkdownFiles();
		return [...folders, ...notes];
	}
	getItemText(item: TFolder | TFile): string { return item.path; }
	renderSuggestion(item: FuzzyMatch<TFolder | TFile>, el: HTMLElement): void {
		el.addClass('wiki-suggest-item');
		const iconEl = el.createSpan({ cls: 'wiki-suggest-icon' });
		setIcon(iconEl, item.item instanceof TFolder ? 'folder' : 'file-text');
		el.createSpan({ cls: 'wiki-suggest-path', text: item.item.path });
	}
	onChooseItem(item: TFolder | TFile): void { this.onChoose(item); }
}

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	onChoose: (result: TFolder) => void;
	constructor(app: App, onChoose: (result: TFolder) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder('폴더를 선택하세요...');
	}
	getItems(): TFolder[] { return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder); }
	getItemText(item: TFolder): string { return item.path; }
	onChooseItem(item: TFolder): void { this.onChoose(item); }
}

export class ImageSuggestModal extends FuzzySuggestModal<TFile> {
	onChoose: (result: TFile) => void;
	constructor(app: App, onChoose: (result: TFile) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder('이미지를 검색하세요...');
	}
	getItems(): TFile[] {
		const ext = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
		return this.app.vault.getFiles().filter(f => ext.includes(f.extension.toLowerCase()));
	}
	getItemText(item: TFile): string { return item.path; }
	onChooseItem(item: TFile): void { this.onChoose(item); }
}

export class GenerateImageModal extends Modal {
	private promptArea!: HTMLTextAreaElement;
	private modelSelect!: HTMLSelectElement;
	private aspectTiles!: HTMLElement;
	private aspectValue: string;
	private refBox!: HTMLElement;
	private generateBtn!: HTMLButtonElement;
	private referenceFile: TFile | null;

	constructor(
		app: App,
		private apiKeys: AiImageApiKeys,
		private defaultImageModel: string,
		private defaultAspectRatio: string,
		defaultReferencePath: string,
		private onGenerated: (base64: string) => void | Promise<void>,
	) {
		super(app);
		this.setTitle('AI 프로필 이미지 생성');
		this.aspectValue = defaultAspectRatio;
		const f = defaultReferencePath ? app.vault.getAbstractFileByPath(defaultReferencePath) : null;
		this.referenceFile = f instanceof TFile ? f : null;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wiki-genimg-modal');

		this.modalEl.addClass('wiki-genimg-modal-el');

		const columns = contentEl.createDiv({ cls: 'wiki-genimg-columns' });
		const leftCol = columns.createDiv({ cls: 'wiki-genimg-col-left' });
		const rightCol = columns.createDiv({ cls: 'wiki-genimg-col-right' });

		// ── 1열: 참고 이미지 ────────────────────────────────────────
		const refSection = leftCol.createDiv({ cls: 'wiki-genimg-section wiki-genimg-ref-section' });
		refSection.createDiv({ cls: 'wiki-genimg-section-title', text: '참고 이미지 (선택)' });
		this.refBox = refSection.createDiv({ cls: 'wiki-genimg-ref-box' });
		this.renderRefBox();

		// ── 2열: 모델 ────────────────────────────────────────────
		const modelSection = rightCol.createDiv({ cls: 'wiki-genimg-section' });
		modelSection.createDiv({ cls: 'wiki-genimg-section-title', text: '모델' });
		const modelSelectEl = modelSection.createEl('select', { cls: 'dropdown wiki-genimg-model-select' });
		for (const m of AI_IMAGE_MODELS) modelSelectEl.createEl('option', { value: m.id, text: m.label });
		modelSelectEl.value = this.defaultImageModel;
		this.modelSelect = modelSelectEl;

		// ── 2열: 종횡비 ──────────────────────────────────────────
		const aspectSection = rightCol.createDiv({ cls: 'wiki-genimg-section' });
		aspectSection.createDiv({ cls: 'wiki-genimg-section-title', text: '종횡비' });
		this.aspectTiles = aspectSection.createDiv({ cls: 'wiki-genimg-aspect-tiles' });
		for (const r of IMAGE_ASPECT_RATIOS) {
			const tile = this.aspectTiles.createEl('button', { cls: 'wiki-genimg-aspect-tile', text: r.id });
			tile.setAttr('type', 'button');
			tile.toggleClass('is-active', r.id === this.aspectValue);
			tile.title = r.label;
			tile.addEventListener('click', () => {
				this.aspectValue = r.id;
				this.aspectTiles.querySelectorAll('.wiki-genimg-aspect-tile').forEach(el => el.removeClass('is-active'));
				tile.addClass('is-active');
			});
		}

		// ── 2열: 프롬프트 ────────────────────────────────────────
		const promptSection = rightCol.createDiv({ cls: 'wiki-genimg-section wiki-genimg-prompt-section' });
		promptSection.createDiv({ cls: 'wiki-genimg-section-title', text: '프롬프트' });
		this.promptArea = promptSection.createEl('textarea', { cls: 'wiki-genimg-prompt' });
		this.promptArea.value = this.referenceFile ? EXAMPLE_PROMPT_WITH_REFERENCE : EXAMPLE_PROMPT_WITHOUT_REFERENCE;

		const actions = contentEl.createDiv({ cls: 'wiki-genimg-actions' });
		this.generateBtn = actions.createEl('button', { text: '이미지 생성', cls: 'mod-cta' });
		this.generateBtn.addEventListener('click', () => { void this.generateImage(); });
	}

	private renderRefBox(): void {
		this.refBox.empty();
		if (this.referenceFile) {
			this.refBox.addClass('has-image');
			const img = this.refBox.createEl('img', { cls: 'wiki-genimg-ref-preview' });
			img.src = this.app.vault.getResourcePath(this.referenceFile);
			const info = this.refBox.createDiv({ cls: 'wiki-genimg-ref-info' });
			info.createSpan({ cls: 'wiki-genimg-ref-name', text: this.referenceFile.path });
			const clearBtn = info.createEl('button', { cls: 'wiki-genimg-ref-clear', text: '해제' });
			clearBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.referenceFile = null;
				this.renderRefBox();
			});
		} else {
			this.refBox.removeClass('has-image');
			const ph = this.refBox.createDiv({ cls: 'wiki-genimg-ref-placeholder' });
			const iconEl = ph.createSpan();
			setIcon(iconEl, 'image-plus');
			ph.createSpan({ text: '클릭하여 참고 이미지 선택' });
		}
		this.refBox.onclick = () => {
			new ImageSuggestModal(this.app, (f) => {
				this.referenceFile = f;
				this.renderRefBox();
			}).open();
		};
	}

	private async generateImage(): Promise<void> {
		const prompt = this.promptArea.value.trim();
		if (!prompt) { new Notice('프롬프트를 입력하세요.'); return; }

		const provider = getImageProvider(this.modelSelect.value);
		if (provider === 'openai' && !this.apiKeys.openai) {
			new Notice('플러그인 설정 > AI 페이지에서 OpenAI 키를 먼저 등록하세요.');
			return;
		}
		if (provider === 'gemini-image' && !this.apiKeys.gemini) {
			new Notice('플러그인 설정 > AI 페이지에서 Google AI Studio 키를 먼저 등록하세요.');
			return;
		}

		const icon = this.generateBtn.createSpan({ cls: 'wm-episodechat-progress-icon wiki-genimg-spinner' });
		setIcon(icon, 'loader-2');
		this.generateBtn.disabled = true;
		try {
			const referenceImage = this.referenceFile ? await readImageAsInput(this.app, this.referenceFile) : undefined;
			const base64 = await callImageGenerate(this.apiKeys, prompt, this.modelSelect.value, this.aspectValue, referenceImage);
			await this.onGenerated(base64);
			this.close();
		} catch (e) {
			console.error('[wiki] 이미지 생성 실패:', e);
			new Notice(`이미지 생성 실패: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			icon.remove();
			this.generateBtn.disabled = false;
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class RenameModal extends Modal {
	constructor(app: App, defaultName: string, onSubmit: (newName: string) => void) {
		super(app);
		this.setTitle('뷰 이름 수정');
		new Setting(this.contentEl).addText(text => text.setValue(defaultName).onChange(v => { defaultName = v; }));
		new Setting(this.contentEl).addButton(btn => btn.setButtonText('확인').setCta().onClick(() => { onSubmit(defaultName); this.close(); }));
	}
}
