/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { EditorSuggest, Editor, EditorPosition, TFile, EditorSuggestContext, EditorSuggestTriggerInfo, MarkdownView } from 'obsidian';
// import WritingMenuPlugin from './main'; // Avoid circular dependency

export class SymbolSuggester extends EditorSuggest<any> {
    plugin: any;

    constructor(plugin: any) {
        super(plugin.app);
        this.plugin = plugin;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        // Master switch check
        if (!this.plugin.settings.enableSmartInput) {
            return null;
        }

        const line = editor.getLine(cursor.line);
        const sub = line.substring(0, cursor.ch);

        // Find all matching triggers (only enabled ones)
        const matches = this.plugin.settings.symbolTriggers.filter((t: any) => t.enabled !== false && sub.endsWith(t.trigger));

        if (matches.length === 0) return null;

        // Sort by length descending (Longest match wins)
        matches.sort((a: any, b: any) => b.trigger.length - a.trigger.length);
        const bestMatch = matches[0];

        return {
            start: { line: cursor.line, ch: cursor.ch - bestMatch.trigger.length },
            end: cursor,
            query: bestMatch.trigger
        };
    }

    getSuggestions(context: EditorSuggestContext): any[] {
        const triggerStr = context.query;
        const triggerObj = this.plugin.settings.symbolTriggers.find((t: any) => t.trigger === triggerStr);

        if (!triggerObj) return [];

        // Return all options for this trigger, mapping them to the format expected by render/select
        return triggerObj.options.map((opt: any) => ({
            open: opt.open,
            close: opt.close,
            trigger: triggerObj.trigger,
            label: `${opt.open} ${opt.close}` // Helper for unique keys if needed
        }));
    }

    renderSuggestion(suggestion: any, el: HTMLElement): void {
        el.setText(`${suggestion.open} ... ${suggestion.close}`);
    }

    selectSuggestion(suggestion: any, evt: MouseEvent | KeyboardEvent): void {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        const editor = activeView.editor;
        const cursor = editor.getCursor();
        const triggerLength = suggestion.trigger.length;

        // Calculate replacement range (remove trigger char)
        const from = { line: cursor.line, ch: cursor.ch - triggerLength };

        const doReplace = () => {
            // Insert pair
            editor.replaceRange(suggestion.open + suggestion.close, from, cursor);

            // Move cursor to center
            editor.setCursor({
                line: cursor.line,
                ch: from.ch + suggestion.open.length
            });
        };

        // Touch/mouse selection: blur then focus to reset IME composition state
        if (evt instanceof MouseEvent) {
            evt.preventDefault();
            evt.stopPropagation();
            // Blur to end any active IME composition
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
