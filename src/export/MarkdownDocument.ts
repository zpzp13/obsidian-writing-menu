import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import type Token from 'markdown-it/lib/token.mjs';
import type { ContentPolicy, DocumentBlock, DocumentStyle, ParagraphBlock, SourceRange, TextRun, TransferDocument } from './DocumentModel';

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false }).use(footnote);
// CommonMark trims indentation and whitespace around soft breaks for HTML. A
// document transfer must keep those characters, including tabs, in its text.
markdown.inline.ruler.at('newline', (state, silent) => {
	if (state.src.charCodeAt(state.pos) !== 10) return false;
	if (!silent) state.push('softbreak', 'br', 0);
	state.pos++; return true;
});
export interface SourceFormatting {
	inline?: Array<{ from: number; to: number; kind: 'bold' | 'italic' | 'underline' | 'strikethrough' }>;
	colors?: Array<{ from: number; to: number; color: string }>;
	backgrounds?: Array<{ from: number; to: number; color: string }>;
	alignments?: Array<{ from: number; align: DocumentStyle['align'] }>;
}
function attribute(token: Token, key: string): string | undefined { return token.attrGet(key) ?? undefined; }
function footnoteId(token: Token): string {
	const meta = token.meta as { id?: number; label?: string } | null;
	return meta?.label ?? String((meta?.id ?? 0) + 1);
}
function inlineRuns(tokens: Token[], inherited: Partial<TextRun> = {}): TextRun[] {
	const runs: TextRun[] = [], flags: Partial<TextRun> = { ...inherited };
	const append = (text: string): void => {
		// Obsidian embeds have no CommonMark token. Resolve them without rewriting source offsets.
		const pattern = /!\[\[([^\]\n]+)\]\]|\[\[([^\]\n]+)\]\]/g;
		let cursor = 0;
		for (const match of text.matchAll(pattern)) {
			if (match.index > cursor) runs.push({ ...flags, text: text.slice(cursor, match.index) });
			const [target, alias] = (match[1] ?? match[2]).split('|');
			const isImage = /\.(?:png|jpe?g|gif|bmp|webp|svg)(?:#.*)?$/i.test(target);
			runs.push(match[1] ? { ...flags, text: alias && !/^\d+(?:x\d+)?$/.test(alias) ? alias : target.split('/').pop() ?? target, image: isImage ? target : undefined } : { ...flags, text: alias || target, href: target });
			cursor = match.index + match[0].length;
		}
		if (cursor < text.length) runs.push({ ...flags, text: text.slice(cursor) });
	};
	for (const token of tokens) {
		if (token.type === 'strong_open') flags.bold = true;
		else if (token.type === 'strong_close') delete flags.bold;
		else if (token.type === 'em_open') flags.italic = true;
		else if (token.type === 'em_close') delete flags.italic;
		else if (token.type === 's_open') flags.strike = true;
		else if (token.type === 's_close') delete flags.strike;
		else if (token.type === 'link_open') flags.href = attribute(token, 'href');
		else if (token.type === 'link_close') delete flags.href;
		else if (token.type === 'softbreak' || token.type === 'hardbreak') append('\n');
		else if (token.type === 'image') runs.push({ ...flags, text: token.content, image: attribute(token, 'src') });
		else if (token.type === 'footnote_ref') runs.push({ ...flags, text: '', footnote: footnoteId(token) });
		else if (token.type === 'footnote_inline') append(token.content);
		else if (token.type === 'text' || token.type === 'code_inline' || token.type === 'html_inline') append(token.content);
	}
	return runs;
}
export function stripFrontmatter(source: string): { text: string; offset: number } {
	const normalized = source.replace(/\r\n?/g, '\n');
	const frontmatter = /^(?:\uFEFF)?---[ \t]*\n(?:.*?\n)?---[ \t]*(?:\n|$)/s.exec(normalized);
	return { text: normalized.slice(frontmatter?.[0].length ?? 0), offset: frontmatter?.[0].length ?? 0 };
}
export function parseMarkdownDocument(source: string, path = '', formatting: SourceFormatting = {}): TransferDocument {
	const { text, offset } = stripFrontmatter(source), lines = text.split('\n');
	const starts = [offset];
	for (const line of lines) starts.push(starts.at(-1)! + line.length + 1);
	const range = (from: number, to: number): SourceRange => ({ path, from: starts[from], to: Math.min(starts[to] ?? starts.at(-1)!, offset + text.length) });
	const blocks: DocumentBlock[] = [], notes: Record<string, TextRun[]> = {};
	if (offset) {
		const raw = source.replace(/\r\n?/g, '\n').slice(0, offset);
		const properties = raw.replace(/^(?:\uFEFF)?---[ \t]*\n/, '').replace(/(?:^|\n)---[ \t]*(?:\n|$)$/, '');
		if (properties) blocks.push({ kind: 'paragraph', role: 'properties', runs: [{ text: properties }], source: { path, from: 0, to: offset } });
	}
	const noteLines = new Set<number>();
	for (let index = 0; index < lines.length; index++) {
		const match = /^ {0,3}\[\^([^\]]+)\]:[ \t]*(.*)$/.exec(lines[index]);
		if (!match) continue;
		noteLines.add(index);
		const content = [match[2]];
		while (index + 1 < lines.length && /^(?: {4}|\t)/.test(lines[index + 1])) { index++; noteLines.add(index); content.push(lines[index].replace(/^(?: {4}|\t)/, '')); }
		notes[match[1]] = inlineRuns(markdown.parseInline(content.join('\n'), {})[0]?.children ?? []);
	}
	const environment: Record<string, unknown> = {};
	const tokens = markdown.parse(text, environment);
	let cursor = 0;
	const fillGap = (until: number): void => {
		for (; cursor < until; cursor++) {
			if (noteLines.has(cursor)) continue;
			const line = lines[cursor];
			// Blank whitespace, including tabs, is document content rather than a parser delimiter.
			blocks.push({ kind: 'paragraph', runs: line ? [{ text: line }] : [], source: range(cursor, cursor + 1) });
		}
	};
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token.type === 'footnote_block_open') break;
		if (!token.map || token.level !== 0 || token.nesting === -1) continue;
		const [from, to] = token.map;
		if (from < cursor) continue;
		fillGap(from);
		if (token.type === 'table_open') {
			const rows: TextRun[][][] = [];
			let row: TextRun[][] = [];
			for (index++; index < tokens.length && tokens[index].type !== 'table_close'; index++) {
				const inner = tokens[index];
				if (inner.type === 'tr_open') { row = []; rows.push(row); }
				if (inner.type === 'inline') row.push(inlineRuns(inner.children ?? []));
			}
			blocks.push({ kind: 'table', rows, source: range(from, to) });
		} else if (token.type === 'heading_open' || token.type === 'paragraph_open') {
			const inline = tokens[index + 1];
			const children = token.type === 'paragraph_open' ? markdown.parseInline(lines.slice(from, to).join('\n'), environment)[0]?.children : inline?.children;
			blocks.push({ kind: token.type === 'heading_open' ? 'heading' : 'paragraph', level: token.type === 'heading_open' ? Number(token.tag.slice(1)) : undefined, runs: inlineRuns(children ?? []), source: range(from, to) });
		} else if (token.type === 'fence' || token.type === 'code_block') {
			blocks.push({ kind: 'paragraph', runs: [{ text: token.type === 'code_block' ? lines.slice(from, to).join('\n') : token.content.replace(/\n$/, '') }], source: range(from, to) });
		} else {
			// Lists/quotes retain literal line structure; inline markup is still interpreted.
			for (let line = from; line < to; line++) blocks.push({ kind: 'paragraph', runs: inlineRuns(markdown.parseInline(lines[line], {})[0]?.children ?? []), source: range(line, line + 1) });
		}
		cursor = to;
	}
	fillGap(lines.length);
	const document: TransferDocument = { version: 1, blocks, footnotes: notes, resources: [] };
	applySourceFormatting(document, source.replace(/\r\n?/g, '\n'), formatting);
	return document;
}
function applySourceFormatting(document: TransferDocument, source: string, formatting: SourceFormatting): void {
	for (const block of document.blocks) {
		if (!block.source) continue;
		const origin = block.source;
		if (block.kind !== 'table') block.align = formatting.alignments?.filter(item => item.from <= origin.from).at(-1)?.align;
		let cursor = origin.from;
		const overlay = (runs: TextRun[]): TextRun[] => runs.flatMap(run => {
			if (!run.text || run.image || run.footnote) return [run];
			const from = source.indexOf(run.text, cursor);
			if (from < cursor || from + run.text.length > origin.to) return [run];
			cursor = from + run.text.length;
			const cuts = new Set([0, run.text.length]);
			for (const span of [...(formatting.inline ?? []), ...(formatting.colors ?? []), ...(formatting.backgrounds ?? [])]) {
				if (span.to > from && span.from < cursor) { cuts.add(Math.max(0, span.from - from)); cuts.add(Math.min(run.text.length, span.to - from)); }
			}
			const points = [...cuts].sort((a, b) => a - b);
			return points.slice(0, -1).map((point, index) => {
				const result: TextRun = { ...run, text: run.text.slice(point, points[index + 1]) }, at = from + point;
				for (const span of formatting.inline ?? []) if (span.from <= at && span.to > at) {
					if (span.kind === 'strikethrough') result.strike = true; else result[span.kind] = true;
				}
				result.color = formatting.colors?.find(span => span.from <= at && span.to > at)?.color ?? run.color;
				result.background = formatting.backgrounds?.find(span => span.from <= at && span.to > at)?.color ?? run.background;
				return result;
			});
		});
		if (block.kind === 'table') block.rows = block.rows.map(row => row.map(overlay)); else block.runs = overlay(block.runs);
	}
}
export function applyContentPolicy(source: TransferDocument, policy: ContentPolicy, format: string): TransferDocument {
	const notes = new Map<string, number>(), blocks: DocumentBlock[] = [];
	const formatted = policy.formatting === true && format !== 'txt';
	const keepNotes = policy.footnotes !== 'exclude' && formatted;
	const filterRuns = (runs: TextRun[]): TextRun[] => runs.flatMap(run => {
		let result = { ...run };
		if (run.footnote) {
			if (policy.footnotes === 'exclude') return [];
			if (!Object.hasOwn(source.footnotes, run.footnote)) throw new Error(`Missing footnote: ${run.footnote}`);
			if (!notes.has(run.footnote)) notes.set(run.footnote, notes.size + 1);
			if (!keepNotes) { result.text = `[${notes.get(run.footnote)}]`; delete result.footnote; }
		}
		if (run.image) { if (policy.images === 'exclude') return []; if (policy.images !== 'keep' || format === 'txt') delete result.image; }
		if (!policy.emphasis || format === 'txt') result = { text: result.text, image: result.image, footnote: result.footnote, href: result.href };
		return [result];
	});
	const paragraph = (block: ParagraphBlock): void => {
		let runs = filterRuns(block.runs);
		if (policy.spaceIndent) {
			const lines: TextRun[][] = [[]];
			for (const run of runs) run.text.split('\n').forEach((part, index) => { if (index) lines.push([]); lines.at(-1)!.push({ ...run, text: part }); });
			runs = lines.flatMap((line, index) => [...(index ? [{ text: '\n' }] : []), ...(line.some(run => run.text.trim()) ? [{ text: ' ' }] : []), ...line]);
		}
		blocks.push({ ...block, runs });
	};
	for (const block of source.blocks) {
		if (block.kind !== 'table' && block.role === 'properties' && policy.properties !== 'text') continue;
		if (block.kind === 'table') {
			if (policy.tables === 'exclude') continue;
			for (const row of block.rows) paragraph({ kind: 'paragraph', runs: row.flatMap((cell, index) => [...(index ? [{ text: '\t' }] : []), ...cell]) });
		} else if (block.kind === 'heading') {
			if (policy.headings !== 'exclude') paragraph(formatted ? block : { ...block, kind: 'paragraph', level: undefined });
		} else paragraph(block);
	}
	if (!keepNotes && notes.size) {
		blocks.push({ kind: 'paragraph', runs: [] });
		for (const [id, number] of notes) paragraph({ kind: 'paragraph', runs: [{ text: `[${number}] ` }, ...source.footnotes[id].map(run => ({ ...run, footnote: undefined }))] });
	}
	return { ...source, blocks, footnotes: keepNotes ? Object.fromEntries([...notes.keys()].map(id => [id, filterRuns(source.footnotes[id].map(run => ({ ...run, footnote: undefined })))])) : {} };
}
export function mergeDocuments(documents: TransferDocument[]): TransferDocument {
	const blocks: DocumentBlock[] = [], footnotes: Record<string, TextRun[]> = {};
	const resources = [...new Map(documents.flatMap(document => document.resources).map(resource => [resource.id, resource])).values()];
	documents.forEach((document, index) => {
		const rename = (runs: TextRun[]): TextRun[] => runs.map(run => ({ ...run, footnote: run.footnote ? `${index + 1}:${run.footnote}` : undefined }));
		if (index) blocks.push({ kind: 'paragraph', runs: [] }); // join blocks adds the second newline
		for (const block of document.blocks) blocks.push(block.kind === 'table' ? { ...block, rows: block.rows.map(row => row.map(rename)) } : { ...block, runs: rename(block.runs) });
		for (const [id, runs] of Object.entries(document.footnotes)) footnotes[`${index + 1}:${id}`] = rename(runs);
	});
	return { version: 1, blocks, footnotes, resources };
}
