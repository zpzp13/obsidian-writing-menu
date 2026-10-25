import { wmT } from '../i18n/index';
import { FuzzySuggestModal, FuzzyMatch, TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { getWikiDisplayName } from '../wiki/wikiProfileUtils';
import { renderChatAvatar } from './ChatAvatar';

export class AiChatSuggestModal extends FuzzySuggestModal<TFile | null> {
	constructor(private plugin: WritingMenuPlugin, placeholder: string, private files: TFile[], private onChoose: (file: TFile | null) => void, private allowAuthor = false) {
		super(plugin.app);
		this.setPlaceholder(placeholder);
	}

	getItems(): Array<TFile | null> {
		const files = [...this.files].sort((a, b) => a.basename.localeCompare(b.basename, 'ko', { sensitivity: 'base', numeric: true }));
		return this.allowAuthor ? [null, ...files] : files;
	}

	getItemText(item: TFile | null): string {
		return item ? getWikiDisplayName(this.app, this.plugin, item) : wmT("작가");
	}

	renderSuggestion(match: FuzzyMatch<TFile | null>, el: HTMLElement): void {
		const file = match.item;
		const name = this.getItemText(file);

		el.addClass('wm-chat-suggest-item');
		renderChatAvatar(el, this.plugin, file, 'wm-chat-suggest-avatar');
		el.createSpan({ cls: 'wm-chat-suggest-name', text: name });
	}

	onChooseItem(item: TFile | null): void {
		this.onChoose(item);
	}
}
