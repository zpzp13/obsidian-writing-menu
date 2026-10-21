// Emits an apply_patch patch; never writes source files itself.
import { readFileSync } from 'node:fs';
const file = process.argv[2];
if (!['styles.css', 'src/ui/globalStyles.ts'].includes(file)) throw new Error('Unexpected cleanup target');
const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const changes = [];
const obsolete = value => /\.version-control-view|\.wm-(?:vhv-|ver-(?!popup)|diff-|episodechat(?:-|\s|$)|stage-(?:del-btn|name-input))|\.wiki-(?:genimg|profile-genimg)|\.wm-aichat-(?!(?:suggest|panel|mode))|\.wm-rep-(?!editor-hl)|wm-episodechat-(?:spin|pulse)|wm-aichat-typing-bounce/.test(value);
const rename = value => value.replaceAll('wm-plotbook-snapshot-modal', 'wm-snapshot-manager').replaceAll('wm-ver-popup', 'wm-popup').replaceAll('wm-aichat-suggest', 'wm-chat-suggest').replaceAll('wm-aichat-panel', 'wm-chat-panel').replaceAll('wm-aichat-mode', 'wm-chat-mode');
function braceEnd(open, limit) {
	let depth = 1, quote = '', comment = false;
	for (let i = open + 1; i < limit; i++) {
		if (comment) { if (source[i] === '*' && source[i + 1] === '/') { comment = false; i++; } continue; }
		if (quote) { if (source[i] === '\\') i++; else if (source[i] === quote) quote = ''; continue; }
		if (source[i] === '/' && source[i + 1] === '*') { comment = true; i++; }
		else if (source[i] === '"' || source[i] === "'") quote = source[i];
		else if (source[i] === '{') depth++;
		else if (source[i] === '}' && !--depth) return i;
	}
	throw new Error('Unbalanced CSS block');
}
function walk(start, end) {
	let cursor = start;
	while (cursor < end) {
		let open = cursor, comment = false, quote = '';
		for (; open < end; open++) {
			if (comment) { if (source[open] === '*' && source[open + 1] === '/') { comment = false; open++; } continue; }
			if (quote) { if (source[open] === '\\') open++; else if (source[open] === quote) quote = ''; continue; }
			if (source[open] === '/' && source[open + 1] === '*') { comment = true; open++; }
			else if (source[open] === '"' || source[open] === "'") quote = source[open];
			else if (source[open] === '{') break;
		}
		if (open === end) break;
		const close = braceEnd(open, end), header = source.slice(cursor, open);
		const selector = header.replace(/\/\*[\s\S]*?\*\//g, '').trim();
		if (/^@(?:media|supports|container|layer)\b/.test(selector)) walk(open + 1, close);
		else {
			const old = source.slice(cursor, close + 1);
			const next = obsolete(selector) ? '' : rename(old);
			if (next !== old) changes.push({ old: old.startsWith('\n') ? old.slice(1) : old, next: next.startsWith('\n') ? next.slice(1) : next });
		}
		cursor = close + 1;
	}
}
walk(file.endsWith('.ts') ? source.indexOf('`') + 1 : 0, file.endsWith('.ts') ? source.lastIndexOf('`') : source.length);
let length = 0;
const batch = changes.filter(item => { if (length + item.old.length > 20000) return false; length += item.old.length; return true; });
const patch = batch.length ? `*** Begin Patch\n*** Update File: ${file}\n${batch.map(({old,next}) => '@@\n' + old.split('\n').map(line => '-' + line).join('\n') + (next ? '\n' + next.split('\n').map(line => '+' + line).join('\n') : '')).join('\n')}\n*** End Patch` : '';
process.stdout.write(JSON.stringify({ count: changes.length, applied: batch.length, patch }));
