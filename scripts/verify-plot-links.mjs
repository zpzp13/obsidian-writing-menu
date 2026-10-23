import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
const source = readFileSync(new URL('../src/plot-workbook/PlotWorkbookLinks.ts', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)((id) => id === 'obsidian' ? ({ Notice: class {} }) : ({ hasControlCharacters: value => [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) }), module, module.exports);
class Element {
  children = []; events = {};
  appendText(text) { this.children.push(text); }
  createEl(tag, options) { const el = new Element(); Object.assign(el, { tag, ...options }); this.children.push(el); return el; }
  addEventListener(type, fn) { this.events[type] = fn; }
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
}
const opened = [];
const app = { workspace: { openLinkText: async (...args) => { opened.push(args); } } };
const root = new Element();
module.exports.renderPlotWorkbookLinks(root, '앞 [[노트]] [[폴더/노트.md#제목|별칭]] [[노트#^블록]] 뒤', app, 'Project/Scene.md');
assert.equal(root.textContent, '앞 노트 별칭 노트#^블록 뒤');
const links = root.children.filter(child => child instanceof Element);
assert.equal(links.length, 3);
const event = { button: 0, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} };
links[0].events.click(event);
links[1].events.click({ ...event, ctrlKey: true });
links[2].events.auxclick({ ...event, button: 1 });
assert.deepEqual(opened, [['노트', 'Project/Scene.md', false], ['폴더/노트.md#제목', 'Project/Scene.md', true], ['노트#^블록', 'Project/Scene.md', true]]);
for (const type of ['pointerdown', 'dblclick', 'dragstart']) assert.equal(typeof links[0].events[type], 'function');
const literal = new Element();
module.exports.renderPlotWorkbookLinks(literal, '<img> ![[임베드]] [[https://example.com]] [[ ]] [[미완성', app, '');
assert.equal(literal.children.filter(child => child instanceof Element).length, 0);
assert.equal(literal.textContent, '<img> ![[임베드]] [[https://example.com]] [[ ]] [[미완성');
console.log('Plot internal links: labels, aliases, headings, blocks, source paths, click modifiers, editing isolation and literal safety passed');
