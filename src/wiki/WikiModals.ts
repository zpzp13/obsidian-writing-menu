import { App, FuzzyMatch, FuzzySuggestModal, Modal, Setting, TFile, TFolder, setIcon } from 'obsidian';

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

export class RenameModal extends Modal {
	constructor(app: App, defaultName: string, onSubmit: (newName: string) => void) {
		super(app);
		this.setTitle('뷰 이름 수정');
		new Setting(this.contentEl).addText(text => text.setValue(defaultName).onChange(v => { defaultName = v; }));
		new Setting(this.contentEl).addButton(btn => btn.setButtonText('확인').setCta().onClick(() => { onSubmit(defaultName); this.close(); }));
	}
}
