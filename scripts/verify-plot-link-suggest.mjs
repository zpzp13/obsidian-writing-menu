import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
class NativeInputSuggest {
  constructor(app, input) { this.app = app; this.input = input; input.addEventListener('input', () => { this.items = this.getSuggestions(this.getValue()); }); }
  close() { this.closed = true; }
}
const stub = {
  AbstractInputSuggest: NativeInputSuggest,
  parseFrontMatterAliases: fm => fm?.aliases ?? [],
  prepareFuzzySearch: query => text => { const at = text.toLowerCase().indexOf(query.toLowerCase()); return at < 0 ? null : { score: -at, matches: [[at, at + query.length]] }; },
  renderResults: () => {},
};
const source = readFileSync(new URL('../src/plot-workbook/PlotWorkbookLinkSuggest.ts', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(() => stub, module, module.exports);
const { plotLinkContext, PlotWorkbookLinkSuggest } = module.exports;
assert.equal(plotLinkContext('plain', 5), null);
assert.equal(plotLinkContext('[[closed]]', 10), null);
assert.equal(plotLinkContext('[[a|alias]]', 8), null);
assert.equal(plotLinkContext('[[ab]]', 3, 4), null);
assert.equal(plotLinkContext('[[a\nb', 5), null);
assert.equal(plotLinkContext('[[', 0), null);
assert.equal(plotLinkContext('[[', 1), null);
assert.deepEqual(plotLinkContext('앞 [[ab|별칭]] 뒤', 5), { from: 2, to: 11, query: 'a', suffix: '|별칭' });
class Input extends EventTarget {
  value = ''; selectionStart = 0; selectionEnd = 0;
  set(value, cursor = value.length) { this.value = value; this.selectionStart = this.selectionEnd = cursor; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  setRangeText(value, start, end, mode) { this.value = this.value.slice(0, start) + value + this.value.slice(end); this.selectionStart = this.selectionEnd = mode === 'start' ? start : start + value.length; }
}
const files = [
 { path: 'Project/Alpha.md', basename: 'Alpha', parent: { path: 'Project' } },
 { path: 'Other/Alpha.md', basename: 'Alpha', parent: { path: 'Other' } },
 { path: 'Project/Beta.md', basename: 'Beta', parent: { path: 'Project' } },
];
const cache = { frontmatter: { aliases: ['주인공'] }, headings: [{ heading: '첫 만남' }, { heading: '결말' }], blocks: { scene1: {}, scene2: {} } };
const app = {
 vault: { getMarkdownFiles: () => files },
 workspace: { getLastOpenFiles: () => ['Project/Beta.md'] },
 metadataCache: { getFileCache: () => cache, getFirstLinkpathDest: () => files[0], fileToLinktext: file => file.path.replace(/\.md$/, '') },
};
const input = new Input();
const suggest = new PlotWorkbookLinkSuggest(app, input, 'Project/Scene.md');
input.set('[[', 2);
assert.equal(suggest.getSuggestions()[0].file, files[2]);
input.set('[[주인');
let items = suggest.getSuggestions(); assert.equal(items.length, 3); assert.equal(items[0].alias, '주인공');
suggest.selectSuggestion(items[0]); assert.equal(input.value, '[[Project/Alpha|주인공]]');
input.set('앞 [[Al|표시]] 뒤', 6); items = suggest.getSuggestions(); suggest.selectSuggestion(items[0]);
assert.equal(input.value, '앞 [[Project/Alpha|표시]] 뒤');
input.set('[[Alpha#만남'); items = suggest.getSuggestions(); assert.equal(items[0].subpath, '#첫 만남');
suggest.selectSuggestion(items[0]); assert.equal(input.value, '[[Project/Alpha#첫 만남]]');
for (const marker of ['^', '#^']) {
 input.set('[[Alpha' + marker + 'scene2'); items = suggest.getSuggestions(); assert.equal(items.length, 1);
 suggest.selectSuggestion(items[0]); assert.equal(input.value, '[[Project/Alpha#^scene2]]');
}
input.dispatchEvent(new Event('compositionstart')); input.set('[[주'); assert.equal(suggest.getSuggestions().length, 0);
input.dispatchEvent(new Event('compositionend')); assert.equal(suggest.getSuggestions().length, 3);
input.set('[['); const typed = new Event('input'); Object.assign(typed, { inputType: 'insertText', data: '[' });
input.dispatchEvent(typed); assert.equal(input.value, '[[]]'); assert.equal(input.selectionStart, 2);
const close = new Event('beforeinput', { cancelable: true }); Object.assign(close, { inputType: 'insertText', data: ']' });
input.dispatchEvent(close); assert.equal(close.defaultPrevented, true); assert.equal(input.value, '[[]]'); assert.equal(input.selectionStart, 4);
suggest.destroy(); assert.equal(suggest.getSuggestions().length, 0);
console.log('Plot link completion: trigger ranges, recency, aliases, duplicate paths, mid-text replacement, headings, blocks, bracket pairing, IME and disposal passed (SDK contract double)');
