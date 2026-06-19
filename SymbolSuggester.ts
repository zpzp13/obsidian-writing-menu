import { EditorSuggest, Editor, EditorPosition, TFile, EditorSuggestContext, EditorSuggestTriggerInfo, MarkdownView, Plugin } from 'obsidian';
import type { SymbolTrigger } from './src/types';

interface SymbolSuggestion {
	open: string;
	close: string;
	trigger: string;
	label: string;
}

interface ISymbolPlugin extends Plugin {
	settings: {
		enableSmartInput: boolean;
		symbolTriggers: SymbolTrigger[];
	};
}

export class SymbolSuggester extends EditorSuggest<SymbolSuggestion> {
	plugin: ISymbolPlugin;

	constructor(plugin: ISymbolPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile): EditorSuggestTriggerInfo | null {
		if (!this.plugin.settings.enableSmartInput) {
			return null;
		}

		const triggers = this.plugin.settings.symbolTriggers.filter(t => t.enabled !== false);
		if (triggers.length === 0) return null;

		const maxLen = Math.max(...triggers.map(t => t.trigger.length));
		const sub = editor.getRange({ line: cursor.line, ch: Math.max(0, cursor.ch - maxLen) }, cursor);

		const matches = triggers.filter(t => sub.endsWith(t.trigger));

		if (matches.length === 0) return null;

		matches.sort((a, b) => b.trigger.length - a.trigger.length);
		const bestMatch = matches[0];

		return {
			start: { line: cursor.line, ch: cursor.ch - bestMatch.trigger.length },
			end: cursor,
			query: bestMatch.trigger
		};
	}

	getSuggestions(context: EditorSuggestContext): SymbolSuggestion[] {
		const triggerStr = context.query;
		const triggerObj = this.plugin.settings.symbolTriggers.find(t => t.trigger === triggerStr);

		if (!triggerObj) return [];

		return triggerObj.options.map(opt => ({
			open: opt.open,
			close: opt.close,
			trigger: triggerObj.trigger,
			label: `${opt.open} ${opt.close}`
		}));
	}

	renderSuggestion(suggestion: SymbolSuggestion, el: HTMLElement): void {
		el.setText(`${suggestion.open} ... ${suggestion.close}`);
	}

	selectSuggestion(suggestion: SymbolSuggestion, evt: MouseEvent | KeyboardEvent): void {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;

		const editor = activeView.editor;
		const cursor = editor.getCursor();
		const triggerLength = suggestion.trigger.length;

		const from = { line: cursor.line, ch: cursor.ch - triggerLength };

		const doReplace = () => {
			editor.replaceRange(suggestion.open + suggestion.close, from, cursor);
			editor.setCursor({
				line: cursor.line,
				ch: from.ch + suggestion.open.length
			});
		};

		if (evt instanceof MouseEvent) {
			evt.preventDefault();
			evt.stopPropagation();
			editor.blur();
			window.setTimeout(() => {
				editor.focus();
				doReplace();
			}, 50);
		} else {
			doReplace();
		}
	}
}
