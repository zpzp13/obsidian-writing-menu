import { AbstractInputSuggest, type App, type TFile, type SearchResult, parseFrontMatterAliases, prepareFuzzySearch, renderResults } from 'obsidian';

export interface PlotLinkContext { from: number; to: number; query: string; suffix: string }
export function plotLinkContext(value: string, cursor: number, end = cursor): PlotLinkContext | null {
	if (cursor < 2 || cursor !== end) return null;
	const from = value.lastIndexOf('[[', cursor - 2);
	if (from < 0) return null;
	const query = value.slice(from + 2, cursor);
	if (/[[\]\n|]/.test(query)) return null;
	const tail = value.slice(cursor);
	const closing = tail.indexOf(']]');
	const rest = closing >= 0 && !/[[\]\n]/.test(tail.slice(0, closing)) ? tail.slice(0, closing) : '';
	return { from, to: rest || tail.startsWith(']]') ? cursor + rest.length + 2 : cursor, query,
		suffix: rest.includes('|') ? rest.slice(rest.indexOf('|')) : '' };
}
interface LinkSuggestion { labelMatch?: SearchResult; file: TFile; label: string; path: string; alias?: string; subpath?: string; match?: SearchResult }

/** The native popover works with textarea events/geometry. Its default value access
 * only recognizes input, so both accessors are adapted here; no private API is used. */
export class PlotWorkbookLinkSuggest extends AbstractInputSuggest<LinkSuggestion> {
	private composing = false;
	private disposed = false;
	private readonly skipClosingBracket = (event: Event) => {
		const typed = event as InputEvent;
		const cursor = this.input.selectionStart;
		if (!this.composing && typed.inputType === 'insertText' && typed.data === ']'
			&& this.input.selectionEnd === cursor && this.input.value[cursor] === ']'
			&& plotLinkContext(this.input.value, cursor)) {
			event.preventDefault();
			const closing = this.input.value.slice(cursor).startsWith(']]') ? 2 : 1;
			this.input.setSelectionRange(cursor + closing, cursor + closing);
			this.refresh();
		}
	};
	private readonly cursorMoved = (event: KeyboardEvent) => {
		if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) this.refresh();
	};
	private readonly pairBrackets = (event: Event) => {
		const typed = event as InputEvent;
		const cursor = this.input.selectionStart;
		if (!this.composing && typed.inputType === 'insertText' && typed.data === '['
			&& this.input.value.slice(Math.max(0, cursor - 2), cursor) === '[['
			&& !this.input.value.slice(cursor).startsWith(']]')) {
			this.input.setRangeText(']]', cursor, cursor, 'start');
		}
	};
	private readonly refresh = () => this.input.dispatchEvent(new Event('input', { bubbles: true }));
	private readonly compositionStart = () => { this.composing = true; this.close(); };
	private readonly compositionEnd = () => { this.composing = false; this.refresh(); };
	constructor(app: App, private readonly input: HTMLTextAreaElement, private readonly sourcePath: string) {
		// SDK's constructor type omits textarea. Shared DOM methods are compatible;
		// getValue/setValue below explicitly handle the textarea value property.
		super(app, input as unknown as HTMLInputElement);
		this.limit = 50;
		input.addEventListener('input', this.pairBrackets, true);
		input.addEventListener('beforeinput', this.skipClosingBracket);
		input.addEventListener('keyup', this.cursorMoved);
		input.addEventListener('click', this.refresh);
		input.addEventListener('compositionstart', this.compositionStart);
		input.addEventListener('compositionend', this.compositionEnd);
	}
	override getValue(): string { return this.input.value; }
	override setValue(value: string): void { this.input.value = value; }
	protected getSuggestions(): LinkSuggestion[] {
		if (this.disposed || this.composing) return [];
		const context = plotLinkContext(this.input.value, this.input.selectionStart, this.input.selectionEnd);
		if (!context) return [];
		const hash = context.query.search(/[#^]/);
		let candidates: LinkSuggestion[] = [];
		let query = context.query;
		if (hash >= 0) {
			const target = context.query.slice(0, hash);
			const file = this.app.metadataCache.getFirstLinkpathDest(target, this.sourcePath);
			if (!file) return [];
			const cache = this.app.metadataCache.getFileCache(file);
			const marker = context.query.slice(hash).startsWith('#^') ? '#^' : context.query[hash];
			const block = marker.includes('^');
			query = context.query.slice(hash + marker.length);
			candidates = block
				? Object.keys(cache?.blocks ?? {}).map(id => ({ file, label: id, path: file.path, subpath: `#^${id}` }))
				: (cache?.headings ?? []).map(heading => ({ file, label: heading.heading, path: file.path, subpath: `#${heading.heading}` }));
		} else {
			for (const file of this.app.vault.getMarkdownFiles()) {
				candidates.push({ file, label: file.basename, path: file.path });
				for (const alias of parseFrontMatterAliases(this.app.metadataCache.getFileCache(file)?.frontmatter) ?? [])
					candidates.push({ file, label: alias, path: file.path, alias });
			}
		}
		if (!query.trim()) {
			if (hash < 0) {
				const recent = this.app.workspace.getLastOpenFiles();
				const rank = (path: string) => { const index = recent.indexOf(path); return index < 0 ? recent.length : index; };
				candidates.sort((a, b) => rank(a.path) - rank(b.path));
			}
			return candidates.slice(0, this.limit);
		}
		const search = prepareFuzzySearch(query);
		return candidates.flatMap(candidate => {
			const labelMatch = search(candidate.label);
			const match = labelMatch ?? search(candidate.path);
			return match ? [{ ...candidate, match, labelMatch: labelMatch ?? undefined }] : [];
		}).sort((a, b) => b.match.score - a.match.score).slice(0, this.limit);
	}
	renderSuggestion(value: LinkSuggestion, el: HTMLElement): void {
		el.addClass('mod-complex');
		const content = el.createDiv({ cls: 'suggestion-content' });
		const title = content.createDiv({ cls: 'suggestion-title' });
		if (value.labelMatch) renderResults(title, value.label, value.labelMatch);
		else title.setText(value.label);
		content.createDiv({ cls: 'suggestion-note', text: value.alias || value.subpath ? value.file.path : value.file.parent?.path ? `${value.file.parent.path}/` : '/' });
		const container = el.closest('.suggestion-container');
		if (container && !container.querySelector('.prompt-instructions')) {
			const footer = container.createDiv({ cls: 'prompt-instructions' });
			for (const [key, text] of [['#', '제목에 연결'], ['^', '블록에 연결'], ['|', '표시되는 텍스트 변경']]) {
				const instruction = footer.createDiv({ cls: 'prompt-instruction' });
				instruction.createSpan({ cls: 'prompt-instruction-command', text: key });
				instruction.createSpan({ text });
			}
		}
	}
	selectSuggestion(value: LinkSuggestion): void {
		const context = plotLinkContext(this.input.value, this.input.selectionStart, this.input.selectionEnd);
		if (!context || this.disposed || this.composing) { this.close(); return; }
		const path = this.app.metadataCache.fileToLinktext(value.file, this.sourcePath, true);
		const alias = context.suffix || (value.alias ? `|${value.alias}` : '');
		this.input.setRangeText(`[[${path}${value.subpath ?? ''}${alias}]]`, context.from, context.to, 'end');
		this.close();
		this.refresh();
	}
	destroy(): void {
		this.disposed = true;
		this.close();
		this.input.removeEventListener('input', this.pairBrackets, true);
		this.input.removeEventListener('beforeinput', this.skipClosingBracket);
		this.input.removeEventListener('keyup', this.cursorMoved);
		this.input.removeEventListener('click', this.refresh);
		this.input.removeEventListener('compositionstart', this.compositionStart);
		this.input.removeEventListener('compositionend', this.compositionEnd);
	}
}
