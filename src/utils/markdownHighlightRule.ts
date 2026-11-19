import type MarkdownIt from 'markdown-it';
import { readHighlightPrefix } from './ObsidianHighlights';

export function markdownHighlightRule(markdown: MarkdownIt): void {
	markdown.inline.ruler.before('emphasis', 'wm-highlight', (state, silent) => {
		if (silent || !state.src.startsWith('==', state.pos)) return false;
		const scanned = state.scanDelims(state.pos, true);
		// Same rule as Obsidian (and the paged editor): `==` opens before non-space
		// and closes after non-space, even inside a word or before a color emoji.
		const before = state.pos > 0 ? state.src[state.pos - 1] : '', after = state.src[state.pos + scanned.length] ?? '';
		const canOpen = after !== '' && !/\s/u.test(after), canClose = before !== '' && !/\s/u.test(before);
		let offset = 0;
		if (scanned.length % 2) { state.push('text', '', 0).content = '='; offset++; }
		for (; offset < scanned.length; offset += 2) {
			state.push('text', '', 0).content = '==';
			state.delimiters.push({ marker: 61, length: 0, token: state.tokens.length - 1, end: -1, open: canOpen, close: canClose });
		}
		state.pos += scanned.length;
		return true;
	});
	markdown.inline.ruler2.before('fragments_join', 'wm-highlight', state => {
		for (const delimiters of [state.delimiters, ...state.tokens_meta.flatMap(meta => meta?.delimiters ? [meta.delimiters] : [])]) {
			for (const delimiter of delimiters) if (delimiter.marker === 61 && delimiter.end >= 0) {
				const open = state.tokens[delimiter.token], close = state.tokens[delimiters[delimiter.end].token];
				open.type = 'wm_highlight_open'; close.type = 'wm_highlight_close'; open.content = ''; close.content = '';
				const content = state.tokens[delimiter.token + 1];
				const prefix = readHighlightPrefix(content?.type === 'text' ? content.content : '');
				open.meta = { color: prefix.color };
				if (prefix.length) content.content = content.content.slice(prefix.length);
			}
		}
		return true;
	});
}
