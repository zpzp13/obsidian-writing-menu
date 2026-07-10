import { FuzzySuggestModal, FuzzyMatch, TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { getWikiImgSrc, getWikiDisplayName } from '../wiki/wikiProfileUtils';

export class AiChatSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(private plugin: WritingMenuPlugin, placeholder: string, private files: TFile[], private onChoose: (file: TFile) => void) {
		super(plugin.app);
		this.setPlaceholder(placeholder);
	}

	getItems(): TFile[] {
		return [...this.files]
			.sort((a, b) => a.basename.localeCompare(b.basename, 'ko', { sensitivity: 'base', numeric: true }));
	}

	getItemText(item: TFile): string {
		return getWikiDisplayName(this.app, this.plugin, item);
	}

	renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
		const file = match.item;
		const name = getWikiDisplayName(this.app, this.plugin, file);
		const imgSrc = getWikiImgSrc(this.app, this.plugin, file);

		el.addClass('wm-aichat-suggest-item');
		const avatar = el.createDiv({ cls: 'wm-aichat-suggest-avatar' });
		if (imgSrc) {
			avatar.createEl('img', { attr: { src: imgSrc } });
		} else {
			avatar.createSpan({ text: name.charAt(0).toUpperCase() });
		}
		el.createSpan({ cls: 'wm-aichat-suggest-name', text: name });
	}

	onChooseItem(item: TFile): void {
		this.onChoose(item);
	}
}
