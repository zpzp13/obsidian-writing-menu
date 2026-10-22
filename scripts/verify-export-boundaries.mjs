import assert from 'node:assert/strict';
import { loadTsFixture } from './ts-fixture-loader.mjs';

const files = new Map(), writes = [], processes = [];
let fsLoads = 0, failSpawn = false;
let allowExternal = false;
const output = new Map(), reads = [];
class FileSystemAdapter {
	getBasePath() { return '/vault'; }
	async exists(path) { return files.has(path); }
	async mkdir(path) { files.set(path, 'directory'); }
	async write(path, text) { files.set(path, text); writes.push(path); }
	async remove(path) { files.delete(path); }
	async read(path) { reads.push(path); assert(path.startsWith('Project/')); return files.get(path); }
	async list(path) {
		const children = [...files.keys()].filter(candidate => candidate.startsWith(path + '/') && !candidate.slice(path.length + 1).includes('/'));
		return { files: children.filter(child => files.get(child) !== 'directory'), folders: children.filter(child => files.get(child) === 'directory') };
	}
}
const plugin = { manifest: { id: 'writing-menu' }, settings: { hwpTemplatePath: '/external/template with spaces.hwp' }, app: { vault: { configDir: 'custom-config', adapter: new FileSystemAdapter() } } };
const converter = loadTsFixture('src/export/converterMethods.ts', {
	obsidian: { Platform: { isDesktop: true }, FileSystemAdapter, normalizePath: path => path, Notice: class {}, TFile: class {}, MarkdownView: class {}, WorkspaceLeaf: class {} },
	'../paged/PagedWritingView': { PagedWritingView: class {} },
	'../utils/nodeShims': { joinPath: (...parts) => parts.filter(Boolean).join('/'), getFs: async () => {
		fsLoads++; if (!allowExternal) throw Error('Vault-internal operations must not load fs');
		return { existsSync: () => false, mkdirSync: path => assert(path.startsWith('/external')), writeFileSync: (path, text) => { assert(path.startsWith('/external/')); output.set(path, text); } };
	} },
	child_process: { spawn(command, args, options) {
		processes.push({ command, args, options });
		const events = {}, stdout = {}, stderr = {};
		queueMicrotask(() => { if (failSpawn) events.error(new Error('Synthetic missing Python')); else { stdout.data?.({ toString: () => '/external/chosen folder' }); events.close(0); } });
		return { stdout: { on: (name, callback) => stdout[name] = callback }, stderr: { on: (name, callback) => stderr[name] = callback }, on: (name, callback) => events[name] = callback };
	} },
});
await converter.ensureConverterScript(plugin);
assert(writes.includes('custom-config/plugins/writing-menu/scripts/converter.py'));
assert.equal(await converter.runPicker(plugin, 'folder'), '/external/chosen folder');
assert.equal(await converter.convertToHwp(plugin, { path: 'Project/chapter.md' }, 'out.hwp', '/external/with spaces & symbols', true, true), true);
assert.deepEqual(processes.at(-1).args, ['converter.py', '/vault/Project/chapter.md', '/external/with spaces & symbols/out.hwp', '--space-indent', '--exclude-headings', '--template', '/external/template with spaces.hwp']);
for (const merged of [false, true]) for (const failure of [false, true]) {
	failSpawn = failure;
	const selected = [{ path: 'Project/chapter.md' }, { path: 'Project/chapter two.md' }];
	if (merged) await converter.convertFilesToHwpMerged(plugin, selected, '/external', 'merged.hwp', true, true);
	else await converter.convertFilesToHwp(plugin, selected, '/external', true, true);
	assert(![...files.keys()].some(path => /(?:batch|merge)_list_/.test(path)), 'Temporary lists must be removed on success and process error');
}
assert.equal(fsLoads, 0);
assert(processes.every(process => process.command === 'python' && Array.isArray(process.args) && process.options.cwd === '/vault/custom-config/plugins/writing-menu/scripts' && !process.options.shell));
assert(writes.every(path => path.startsWith('custom-config/plugins/writing-menu/scripts/')));
allowExternal = true;
plugin.cleanMarkdownFrontmatter = text => text;
plugin.applySpaceIndent = text => '  ' + text;
for (const [path, text] of [['Project', 'directory'], ['Project/a.md', 'first'], ['Project/nested', 'directory'], ['Project/nested/b.MD', 'second'], ['Project/ignored.png', 'image']]) files.set(path, text);
await converter.convertFolderToTxt(plugin, 'Project', '/external/single', false);
assert.equal(output.get('/external/single/a.txt'), 'first');
assert.equal(output.get('/external/single/nested/b.txt'), 'second');
assert.equal(output.size, 2);
await converter.convertFolderToTxtMerged(plugin, 'Project', '/external', 'merged.txt', false);
assert.equal(output.get('/external/merged.txt'), 'first\n\nsecond');
assert(reads.length === 4 && reads.every(path => path.startsWith('Project/')));
console.log('PASS vault-only assets/temp lists and TXT source reads, relative export folders, merged text, custom config, literal Python arguments, HWP options, success/error cleanup; no real process or external file access');
