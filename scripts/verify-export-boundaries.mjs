import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as fflate from 'fflate';
import { loadTsFixture } from './ts-fixture-loader.mjs';
import { hwpxText } from './hwpx-fixture.mjs';

const output = new Map(), reads = [], notices = [], templates = [], commands = [];
const source = new Map([
    ['Project/a.md', '---\nsecret: hidden\n---\n# 제목\n본문 $& 😀\n\n다음\t문단'],
    ['Project/nested/b.MD', '두번째\n=====\n본문 B'],
    ['Project/ignored.png', 'image'],
]);
const platform = { isDesktop: true, isWin: false, isMacOS: true };
let pendingView;
class PagedWritingView {}
let picked = '/external/chosen folder', denied = false, templateError = '';
const plugin = { settings: { hwpTemplatePath: '/external/template with spaces.hwp', hwpExportPath: '' }, app: { workspace: { getLeavesOfType: type => pendingView && type === 'paged' ? [{ view: pendingView }] : [] }, vault: {
    async read(file) { reads.push(file.path); assert(source.has(file.path)); return source.get(file.path); },
    adapter: {
        async read(path) { reads.push(path); assert(source.has(path)); return source.get(path); },
        async list(path) {
            const children = [...source.keys()].filter(key => key.startsWith(path + '/'));
            return { files: children.filter(key => !key.slice(path.length + 1).includes('/')), folders: [...new Set(children.filter(key => key.slice(path.length + 1).includes('/')).map(key => path + '/' + key.slice(path.length + 1).split('/')[0]))] };
        },
    },
} } };
const external = path => assert(path.startsWith('/external') || path.startsWith('C:\\external'), path);
const converter = loadTsFixture('src/export/converterMethods.ts', {
    fflate,
    obsidian: { Platform: platform, normalizePath: value => value, Notice: class { constructor(message) { notices.push(message); } }, TFile: class {}, MarkdownView: class {}, WorkspaceLeaf: class {} },
    '../paged/PagedWritingView': { PagedWritingView, PAGED_WRITING_VIEW_TYPE: 'paged' },
    '../utils/nodeShims': {
        joinPath: (...parts) => parts.filter(Boolean).join(platform.isWin ? '\\' : '/'),
        getFs: async () => ({
            existsSync: path => path === plugin.settings.hwpTemplatePath || output.has(path), realpathSync: path => path,
            mkdirSync: path => external(path),
            writeFileSync: (path, bytes) => { external(path); if (denied) throw Error('Permission denied'); output.set(path, bytes); },
        }),
    },
    './DesktopExport': { pickExternalPath: async () => picked, fillHancomTemplate: async (path, documents) => { templates.push({ path, documents }); if (templateError) throw Error(templateError); } },
});
assert.equal(converter.defaultUseTemplate(plugin), false, 'macOS must ignore stored Windows templates by default');
assert.equal(await converter.convertToHwpx(plugin, { path: 'Project/a.md' }, 'a.hwpx', '/external', true, true), true);
assert.equal(hwpxText(output.get('/external/a.hwpx')), ' 본문 $& 😀\n\n 다음\t문단');
assert.equal(templates.length, 0);
await converter.convertFolderToHwpx(plugin, 'Project', '/external/folder', false, true);
assert.equal(hwpxText(output.get('/external/folder/nested/b.hwpx')), '본문 B');
assert(![...output.keys()].some(path => path.includes('ignored')));
const selected = [{ path: 'Project/nested/b.MD', basename: 'b' }, { path: 'Project/a.md', basename: 'a' }];
await converter.convertFilesToHwpxMerged(plugin, selected, '/external', 'merged.hwpx', false, true);
assert.equal(hwpxText(output.get('/external/merged.hwpx')), '본문 B\n\n본문 $& 😀\n\n다음\t문단');
await converter.convertFilesToTxt(plugin, selected, '/external/txt', true, true);
assert.equal(output.get('/external/txt/b.txt'), ' 본문 B');
await converter.convertFolderToTxtMerged(plugin, 'Project', '/external', 'merged.txt', false, true);
assert.equal(output.get('/external/merged.txt'), '본문 $& 😀\n\n다음\t문단\n\n본문 B');
const lineBreaks = '\n\n첫 줄\r\n\r\n다음 줄\n\n\n';
source.set('Project/line-breaks.md', '---\nkey: value\n---\n' + lineBreaks);
const lineFile = { path: 'Project/line-breaks.md' };
assert.equal(await converter.convertToHwpx(plugin, lineFile, 'line-breaks', '/external', false, false), true);
assert.equal(hwpxText(output.get('/external/line-breaks.hwpx')), lineBreaks.replace(/\r\n/g, '\n'));
assert.equal(await converter.convertToTxt(plugin, lineFile, 'line-breaks', '/external', false, true), true);
assert.equal(output.get('/external/line-breaks.txt'), lineBreaks.replace(/\r\n/g, '\n'));
source.set('Project/keep.txt.md', '파일 이름 유지');
const dottedFile = { path: 'Project/keep.txt.md' };
await converter.convertFilesToHwpx(plugin, [dottedFile], '/external/names', false);
await converter.convertFilesToTxt(plugin, [dottedFile], '/external/names', false);
assert.equal(hwpxText(output.get('/external/names/keep.txt.hwpx')), '파일 이름 유지');
assert.equal(output.get('/external/names/keep.txt.txt'), '파일 이름 유지');
source.set('Project/unsaved.md', 'older text');
pendingView = Object.assign(new PagedWritingView(), { file: { path: 'Project/unsaved.md' }, save: async () => source.set('Project/unsaved.md', '방금 입력한 원고') });
assert.equal(await converter.convertToHwpx(plugin, pendingView.file, 'fresh', '/external', false), true);
assert.equal(hwpxText(output.get('/external/fresh.hwpx')), '방금 입력한 원고');
pendingView = undefined;
picked = null;
const beforeCancel = output.size;
assert.equal(await converter.convertToHwpx(plugin, selected[0], 'cancel', '', false), false);
await converter.convertFilesToTxt(plugin, selected, '', false);
assert.equal(output.size, beforeCancel, 'cancel must not create any files');
const previousError = console.error;
try {
    console.error = () => {};
    assert.equal(await converter.convertToHwpx(plugin, selected[0], '../escape', '/external', false), false);
    assert.equal(await converter.convertToHwpx(plugin, selected[0], 'relative', 'relative/folder', false), false);
    assert.equal(await converter.convertToHwpx(plugin, selected[0], 'template', '/external', false, false, true), false, 'forced template export must reject macOS');
    denied = true;
    assert.equal(await converter.convertToTxt(plugin, selected[0], 'denied', '/external', false), false);
    assert(notices.some(message => message.includes('Permission denied')));
    denied = false;
    platform.isWin = true;
    plugin.settings.hwpTemplatePath = 'C:\\external\\template with spaces.hwp';
    assert.equal(converter.defaultUseTemplate(plugin), true);
    assert.equal(await converter.convertToHwpx(plugin, selected[0], 'templated', 'C:\\external', false, true), true);
    assert.equal(templates.length, 1);
    assert.equal(templates[0].documents[0].text, '본문 B');
    assert.equal(await converter.convertToHwpx(plugin, lineFile, 'line-breaks', 'C:\\external', false, true), true);
    assert.equal(templates.at(-1).documents[0].text, lineBreaks.replace(/\r\n/g, '\n'));
    await converter.convertFilesToHwpxMerged(plugin, selected, 'C:\\external', 'merge', false, true);
    assert.equal(templates.at(-1).documents[0].text, '본문 B\n\n본문 $& 😀\n\n다음\t문단');
    const calls = templates.length;
    assert.equal(await converter.convertToHwpx(plugin, selected[0], 'plain', 'C:\\external', false, false, false), true);
    assert.equal(templates.length, calls, 'explicit plain mode must bypass the configured template');
    templateError = 'Native template failed';
    assert.equal(await converter.convertToHwpx(plugin, selected[0], 'failed', 'C:\\external', false), false);
    assert(!output.has('C:\\external\\failed.hwpx'), 'a failed template must not fall back to a plain document');
    plugin.settings.hwpTemplatePath = 'C:\\external\\original.hwpx';
    assert.equal(await converter.convertToHwpx(plugin, selected[0], 'original.hwpx', 'C:\\external', false), false);
} finally { console.error = previousError; }
assert(reads.every(path => path.startsWith('Project/')));

// Real bridge code with an inert child_process: no external program or file access.
let childFailure = '', childOutput = 'OK';
const bridgePlatform = { isDesktop: true, isWin: true, isMacOS: false };
const pickerNotices = [];
const desktop = loadTsFixture('src/export/DesktopExport.ts', {
    obsidian: { Platform: bridgePlatform, Notice: class { constructor(message) { pickerNotices.push(message); } } },
    '../utils/nodeShims': { joinPath: (...parts) => parts.join('\\') },
    child_process: { spawn(command, args, options) {
        const events = {}, out = {}, err = {};
        const record = { command, args, options, input: '' }; commands.push(record);
        return { stdout: { setEncoding: encoding => assert.equal(encoding, 'utf8'), on: (name, fn) => out[name] = fn }, stderr: { setEncoding: encoding => assert.equal(encoding, 'utf8'), on: (name, fn) => err[name] = fn }, on: (name, fn) => events[name] = fn,
            stdin: { on() {}, end(input) { record.input = input; queueMicrotask(() => { if (childFailure) { err.data?.({ toString: () => childFailure }); events.close(1); } else { out.data?.({ toString: () => childOutput }); events.close(0); } }); } } };
    } },
});
const malicious = 'C:\\templates\\한글 $(&anything) & with spaces.hwpx';
const documents = [{ path: 'C:\\out\\한글 & file.hwpx', text: '본문 $(&literal) $& "quotes" 😀\n\nnext' }];
await desktop.fillHancomTemplate(malicious, documents);
const call = commands.at(-1);
assert.deepEqual(JSON.parse(call.input), { template: malicious, documents });
assert(!call.args.join(' ').includes(malicious));
assert.equal(call.options.shell, false); assert.equal(call.options.windowsHide, true);
const script = Buffer.from(call.args.at(-1), 'base64').toString('utf16le');
assert(script.includes('ConvertFrom-Json') && script.includes("SaveAs($output, 'HWPX'") && script.includes('finally'));
assert(!script.includes(documents[0].text));
childFailure = 'TEMPLATE_NOT_FOUND';
await assert.rejects(desktop.fillHancomTemplate(malicious, documents), /템플릿 파일/);
childFailure = 'HANCOM_NOT_INSTALLED';
await assert.rejects(desktop.fillHancomTemplate(malicious, documents), /한컴오피스/);
childFailure = ''; childOutput = '';
assert.equal(await desktop.pickExternalPath('folder'), null);
assert.equal(commands.at(-1).input, 'folder');
childOutput = 'C:\\selected\\한글';
assert.equal(await desktop.pickExternalPath('file'), childOutput);
assert.equal(commands.at(-1).input, 'file');
bridgePlatform.isWin = false; bridgePlatform.isMacOS = true;
childOutput = '/Users/한글/문서 폴더/';
assert.equal(await desktop.pickExternalPath('folder'), childOutput);
assert.equal(commands.at(-1).command, '/usr/bin/osascript');
assert.deepEqual(commands.at(-1).args, ['-e', 'POSIX path of (choose folder)']);
childFailure = 'execution error: User canceled. (-128)';
assert.equal(await desktop.pickExternalPath('folder'), null);
assert.equal(pickerNotices.length, 0, 'macOS cancellation must not be reported as failure');
childFailure = 'dialog unavailable';
assert.equal(await desktop.pickExternalPath('folder'), null);
assert.equal(pickerNotices.length, 1);
bridgePlatform.isDesktop = false;
await assert.rejects(desktop.runDesktopCommand('unused', []), /데스크톱/);
for (const file of ['src/export/converterMethods.ts', 'src/export/DesktopExport.ts']) assert(!/spawn\(['"]python|converter\.py/.test(fs.readFileSync(file, 'utf8')));
const shims = loadTsFixture('src/utils/nodeShims.ts', { obsidian: { Platform: { isWin: false } } });
assert.equal(shims.joinPath('/', 'a.hwpx'), '/a.hwpx');
console.log('PASS vault-only source reads, Windows/macOS plain exports, templates/options/order, TXT, cancellation/errors and literal PowerShell stdin');
