import MarkdownIt from 'markdown-it';
import { projectObsidianComments } from '../comments/ObsidianComments';
import { markdownHighlightRule } from '../utils/markdownHighlightRule';

export interface CopyTextOptions {
	includeComments: boolean;
	includeHeadings: boolean;
	includeFootnotes: boolean;
	includeMarkdown: boolean;
	includeHtml: boolean;
}

const markdown = new MarkdownIt({ html: true, linkify: false, typographer: false }).use(markdownHighlightRule);

export function withoutFrontmatter(content: string): string {
	return content.replace(/\r\n?/g, '\n').replace(/^---[ \t]*\n(?:.*?\n)?---[ \t]*(?:\n|$)/s, '');
}

export function stripMarkdownHeadings(content: string): string {
	const lines = content.split('\n'), result: string[] = [];
	for (let index = 0; index < lines.length; index++) {
		if (/^ {0,3}#{1,6}(?:\s+|$)/.test(lines[index])) continue;
		if (lines[index].trim() && /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1] ?? '')) { index++; continue; }
		result.push(lines[index]);
	}
	return result.join('\n');
}

/** Apply a transform outside fenced and inline code, retaining their exact bytes. */
function outsideCode(text: string, transform: (text: string) => string): string {
	const protectedRanges: Array<{ from: number; to: number }> = [];
	let offset = 0, fence: { marker: string; length: number; from: number } | null = null;
	for (const line of text.split('\n')) {
		const match = /^ {0,3}(?:>\s*)*(`{3,}|~{3,})(.*)$/.exec(line);
		if (fence) {
			if (match && match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim()) {
				protectedRanges.push({ from: fence.from, to: offset + line.length }); fence = null;
			}
		} else if (match) fence = { marker: match[1][0], length: match[1].length, from: offset };
		offset += line.length + 1;
	}
	if (fence) protectedRanges.push({ from: fence.from, to: text.length });
	const transformInline = (part: string) => {
		let output = '', cursor = 0, pos = 0;
		while (pos < part.length) {
			if (part.startsWith('<!--', pos)) { const end = part.indexOf('-->', pos + 4); pos = end < 0 ? part.length : end + 3; continue; }
			if (part[pos] !== '`') { pos++; continue; }
			let slashes = 0; for (let i = pos - 1; i >= 0 && part[i] === '\\'; i--) slashes++;
			const marker = /^`+/.exec(part.slice(pos))![0];
			if (slashes % 2) { pos += marker.length; continue; }
			let end = pos + marker.length;
			while ((end = part.indexOf(marker, end)) >= 0) {
				if (part[end - 1] !== '`' && part[end + marker.length] !== '`') break;
				end += marker.length;
			}
			if (end < 0) { pos += marker.length; continue; }
			end += marker.length;
			output += transform(part.slice(cursor, pos)) + part.slice(pos, end); cursor = pos = end;
		}
		return output + transform(part.slice(cursor));
	};
	let output = '', cursor = 0;
	for (const range of protectedRanges) {
		output += transformInline(text.slice(cursor, range.from)) + text.slice(range.from, range.to); cursor = range.to;
	}
	return output + transformInline(text.slice(cursor));
}

export function stripHtmlTags(text: string): string {
	return outsideCode(text, part => part.replace(/<!--[\s\S]*?-->|<\/?[A-Za-z][\w:-]*(?:\s[^<>]*?)?\s*\/?>/g, tag => /^<br\s*\/?>$/i.test(tag) ? '\n' : '')
		.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
			const name = entity.slice(1, -1).toLowerCase();
			const known: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
			if (known[name] !== undefined) return known[name];
			const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : Number(name.slice(1));
			return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
		}));
}

export function stripWrappingMarkdown(text: string, keepHtml: boolean): string {
	// Wiki syntax is resolved before CommonMark, but never inside code.
	text = outsideCode(text, part => part.replace(/!\[\[[^\]\n]+\]\]|\[\[([^\]\n]+)\]\]/g, (_match, target: string | undefined) => {
		if (!target) return '';
		const [note, alias] = target.split('|'); return alias ?? note.split('#')[0];
	}));
	let fence: { marker: string; length: number } | null = null;
	return text.split('\n').map(line => {
		const match = /^ {0,3}(?:>\s*)*(`{3,}|~{3,})(.*)$/.exec(line);
		if (fence) { if (match && match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim()) fence = null; return line; }
		if (match) { fence = { marker: match[1][0], length: match[1].length }; return line; }
		if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) return line;
		const prefix = /^(?:[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d+[.)])[ \t]+)?(?:\[[ xX]\][ \t]+)?(?:#{1,6}(?:[ \t]+|$))?)/.exec(line)![0];
		const tokens = markdown.parseInline(line.slice(prefix.length), {})[0]?.children ?? [];
		return prefix + tokens.map(token => {
			if (token.type === 'text' || token.type === 'code_inline') return token.content;
			if (token.type === 'html_inline') return keepHtml ? token.content : '';
			if (token.type === 'softbreak' || token.type === 'hardbreak') return '\n';
			return '';
		}).join('');
	}).join('\n');
}

export function buildCopyText(source: string, options: CopyTextOptions): string {
	let text = source.replace(/\r\n?/g, '\n');
	const hasFrontmatter = withoutFrontmatter(text) !== text;
	if (!options.includeComments) text = projectObsidianComments(text).text;
	if (hasFrontmatter) text = withoutFrontmatter(text);
	if (!options.includeHeadings) text = stripMarkdownHeadings(text);
	if (!options.includeFootnotes) {
		const lines = text.split('\n'), kept: string[] = [];
		for (let index = 0; index < lines.length; index++) {
			if (!/^ {0,3}\[\^[^\]\n]+\]:/.test(lines[index])) { kept.push(lines[index]); continue; }
			while (index + 1 < lines.length) {
				let next = index + 1;
				while (next < lines.length && !lines[next].trim()) next++;
				if (!/^(?: {4}|\t)/.test(lines[next] ?? '')) break;
				index = next;
			}
		}
		text = kept.join('\n').replace(/\[\^[^\]\n]+\]/g, '');
	}
	if (!options.includeHtml) text = stripHtmlTags(text);
	if (!options.includeMarkdown) text = stripWrappingMarkdown(text, options.includeHtml);
	return text.trim();
}
