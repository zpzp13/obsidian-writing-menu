// Real storage adapter on both supported API paths; no vault or note writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const js = ts.transpileModule(await readFile('src/paged/PagedZoomStorage.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
let modern = false;
class FileSystemAdapter { constructor(base) { this.base = base; } getBasePath() { return this.base; } }
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
const module = { exports: {} };
new Function('require', 'exports', 'window', js)(name => {
	assert.equal(name, 'obsidian'); return { FileSystemAdapter, requireApiVersion: () => modern };
}, module.exports, { localStorage: storage });
const { loadPagedZoom, savePagedZoom } = module.exports;
const oldApp = base => Object.defineProperties({ vault: { adapter: new FileSystemAdapter(base), getName: () => 'Same name' } }, {
	loadLocalStorage: { get() { throw new Error('API unavailable on 1.7.2'); } },
	saveLocalStorage: { get() { throw new Error('API unavailable on 1.7.2'); } },
});
const first = oldApp('/first/Same name'), second = oldApp('/second/Same name');
savePagedZoom(first, 'chapter.md', 1.6);
assert.equal(loadPagedZoom(first, 'chapter.md'), 1.6);
assert.equal(loadPagedZoom(first, 'other.md'), null);
assert.equal(loadPagedZoom(second, 'chapter.md'), null);
savePagedZoom(second, 'chapter.md', 0.8);
assert.equal(loadPagedZoom(first, 'chapter.md'), 1.6);
savePagedZoom(first, 'renamed.md', 1.6); savePagedZoom(first, 'chapter.md', null);
assert.equal(loadPagedZoom(first, 'chapter.md'), null);
assert.equal(loadPagedZoom(first, 'renamed.md'), 1.6);
modern = true;
const current = new Map(), app = { vault: first.vault, loadLocalStorage: key => current.get(key), saveLocalStorage: (key, value) => value === null ? current.delete(key) : current.set(key, value) };
assert.equal(loadPagedZoom(app, 'renamed.md'), 1.6, 'Upgrading discarded the compatible store');
current.set('writing-menu:paged-zoom:renamed.md', 2);
assert.equal(loadPagedZoom(app, 'renamed.md'), 2, 'Existing modern zoom was replaced');
savePagedZoom(app, 'renamed.md', 1.2);
modern = false; assert.equal(loadPagedZoom(first, 'renamed.md'), 1.2, 'Downgrading discarded the mirrored zoom');
modern = true; savePagedZoom(app, 'renamed.md', null);
assert.equal(loadPagedZoom(app, 'renamed.md'), null, 'Deleting zoom resurrected a legacy value');
modern = false;
for (const key of values.keys()) values.set(key, '{broken');
assert.equal(loadPagedZoom(second, 'chapter.md'), null);
storage.getItem = () => { throw new Error('blocked'); }; storage.setItem = () => { throw new Error('quota'); };
assert.equal(loadPagedZoom(first, 'chapter.md'), null);
assert.doesNotThrow(() => savePagedZoom(first, 'chapter.md', 1));
console.log('PASS 1.7.2 fallback, same-name vault and document isolation, rename, upgrade/downgrade, existing zoom, malformed/blocked storage.');
