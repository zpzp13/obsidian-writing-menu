import assert from 'node:assert/strict';
import { loadTsFixture } from './ts-fixture-loader.mjs';

const { scalarText, legacyText } = loadTsFixture('src/utils/typeGuards.ts');
assert.equal(legacyText([123, 'name', false]), '123,name,false');
assert.throws(() => legacyText({ text: 'bad field' }), /원본 자료/);
assert.equal(scalarText({}), ''); assert.equal(scalarText(42), '42');
const { takeLegacyTrackingFolder } = loadTsFixture('src/settings/migrateDashboardSettings.ts');
for (const [data, expected] of [[{ trackingFolder: 'A', timeTrackingFolder: 'B' }, 'A'], [{ trackingFolder: '', timeTrackingFolder: 'B', heatmapFolder: 'C' }, 'B'], [{ heatmapFolder: 'C' }, 'C'], [{ trackingFolder: {}, heatmapFolder: 'C' }, 'C']]) {
	const raw = { ...data, projectData: ['unchanged'] };
	assert.equal(takeLegacyTrackingFolder(raw), expected);
	assert.deepEqual(raw, { projectData: ['unchanged'] });
}
const { isComposingKey, caretRangeAtPoint } = loadTsFixture('src/utils/inputCompatibility.ts');
for (const event of [{ isComposing: true }, { key: 'Process' }, { key: 'Enter', keyCode: 229 }]) assert(isComposingKey(event));
assert(!isComposingKey({ key: 'Enter', isComposing: false, keyCode: 13 }));
let fallback = 0, start;
const document = { caretPositionFromPoint: () => ({ offsetNode: 'text node', offset: 7 }), createRange: () => ({ setStart: (...args) => start = args, collapse: value => assert(value) }), caretRangeFromPoint: () => { fallback++; return 'legacy range'; } };
caretRangeAtPoint(document, 1, 2); assert.deepEqual(start, ['text node', 7]); assert.equal(fallback, 0);
delete document.caretPositionFromPoint;
assert.equal(caretRangeAtPoint(document, 1, 2), 'legacy range'); assert.equal(fallback, 1);
const { markdownFilesInFolder } = loadTsFixture('src/utils/vaultFiles.ts');
const folderFile = { path: 'Project/Cast/a.md', extension: 'md' }, nestedFile = { path: 'Project/Cast/Nested/b.md', extension: 'md' };
const folder = { path: 'Project/Cast', children: [folderFile, { path: 'Project/Cast/Nested', children: [nestedFile, { path: 'Project/Cast/Nested/image.png', extension: 'png' }] }] };
const folderVault = { getAbstractFileByPath: path => path === folder.path ? folder : null, getMarkdownFiles: () => { throw Error('Unrelated vault files must not be enumerated'); } };
assert.deepEqual(markdownFilesInFolder(folderVault, 'Project/Cast/'), [folderFile, nestedFile]);
assert.deepEqual(markdownFilesInFolder(folderVault, 'Missing'), []);

const files = new Map(), directories = new Set(['custom-config/plugins/writing-menu']);
let downloads = 0, failNetwork = false, failWrite = false;
const adapter = {
	exists: async path => files.has(path) || directories.has(path), mkdir: async path => directories.add(path),
	read: async path => { assert(files.has(path)); return files.get(path); },
	remove: async path => files.delete(path), write: async (path, value) => files.set(path, value),
	writeBinary: async (path, value) => { if (failWrite) throw new Error('disk unavailable'); files.set(path, value); },
};
const plugin = { manifest: { id: 'writing-menu' }, app: { vault: { configDir: 'custom-config', adapter } } };
const assets = loadTsFixture('src/repetition/GaruAssets.ts', { obsidian: {
	normalizePath: path => path,
	requestUrl: async ({ url }) => { downloads++; assert(url.startsWith('https://cdn.jsdelivr.net/npm/garu-ko@0.9.18/')); if (failNetwork) throw new Error('offline'); return { status: 200, arrayBuffer: Uint8Array.of(1, 2, 3).buffer }; },
} });
assert.equal(await assets.getGaruAssetStatus(plugin), 'missing');
await assets.downloadGaruAssets(plugin); assert.equal(downloads, 2);
assert.equal(await assets.getGaruAssetStatus(plugin), 'current');
const paths = assets.getAssetPaths(plugin); assert(paths.wasmPath.startsWith('custom-config/'));
failNetwork = true;
await assert.rejects(assets.downloadGaruAssets(plugin), /offline/);
assert.equal(await assets.getGaruAssetStatus(plugin), 'current', 'A failed download invalidated working assets');
failNetwork = false; failWrite = true;
await assert.rejects(assets.downloadGaruAssets(plugin), /disk unavailable/);
assert.equal(await assets.getGaruAssetStatus(plugin), 'outdated', 'An interrupted write was marked ready');
console.log('PASS IME/caret compatibility, custom vault config, vault-only assets, offline preservation and interrupted installation');
