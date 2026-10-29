import assert from 'node:assert/strict';
import moment from 'moment';
import { unzipSync, strFromU8 } from 'fflate';
import { loadTsFixture } from './ts-fixture-loader.mjs';
import { exportFixture, nodeExportHost } from './export-test-kit.mjs';

const { parseObsidianComments: parse, projectObsidianComments: project } = loadTsFixture('src/comments/ObsidianComments.ts');
const { calcAllCharCounts: count } = loadTsFixture('src/utils/charCount.ts');
const { analyzeParagraphs } = loadTsFixture('src/repetition/ParagraphAnalysis.ts');
const { analyzeSentences } = loadTsFixture('src/repetition/SentenceAnalysis.ts');
const { DEFAULT_SETTINGS } = loadTsFixture('src/types.ts');

for (const [source, expected, bodies] of [
	['앞%%메모%%뒤', '앞뒤', ['메모']],
	['%% one %% %% two %%', ' ', [' one ', ' two ']],
	['%%%%', '', ['']],
	['\n\n%%\n# hidden\n\n- item\n%%\n\n본문\n\n', '\n\n\n본문\n\n', ['\n# hidden\n\n- item\n']],
	['앞\r\n  %%\r\n메모 😀\r\n%%\r\n뒤\r\n', '앞\r\n뒤\r\n', ['\r\n메모 😀\r\n']],
	['%% unclosed\nrest', '', [' unclosed\nrest']],
	['inline %% unclosed\nnext', 'inline %% unclosed\nnext', []],
	['\\%%literal\\%%', '\\%%literal\\%%', []],
	['`%%code%%`\n`` %%code%% ``', '`%%code%%`\n`` %%code%% ``', []],
	['```md\n%%code%%\n````\n%%memo%%', '```md\n%%code%%\n````\n', ['memo']],
	['~~~\n%%code%%\n~~~\n본문', '~~~\n%%code%%\n~~~\n본문', []],
	['> ```\n> %%code%%\n> ```\n본문', '> ```\n> %%code%%\n> ```\n본문', []],
	['    %%code%%\n\t%%code%%', '    %%code%%\n\t%%code%%', []],
	['---\nx: %%literal%%\n---\n%%memo%%\n본문', '---\nx: %%literal%%\n---\n본문', ['memo']],
	['%%\n```\n# comment, not a fence\n%%\n본문', '본문', ['\n```\n# comment, not a fence\n']],
]) {
	const ranges = parse(source), projection = project(source);
	assert.deepEqual(ranges.map(range => source.slice(range.bodyFrom, range.bodyTo)), bodies, source);
	assert.equal(projection.text, expected, source);
	assert.equal(projection.restoreMask(projection.text).length, source.length, 'Source mask length');
	for (let at = 0; at < expected.length; at++) {
		const original = projection.originalOffset(at);
		assert.equal(source[original], expected[at], 'Projected character addresses the wrong source position');
		assert.equal(projection.projectedOffset(original), at, 'Source map did not round trip');
	}
}
assert.equal(parse('%% unclosed')[0].closed, false);
assert.equal(parse('😀\r\n%%one\r\ntwo%%')[0].startLine, 1);
assert.equal(parse('😀\r\n%%one\r\ntwo%%')[0].endLine, 2);

const plain = '“첫 번째 문장이다.”\n\n두 번째 문장이다. 마지막 문장이다!';
const annotated = '%%\n통계에 넣지 않을 단어 단어 단어!\n%%\n“첫 번째%%인라인%% 문장이다.”\n\n두 번째 문장이다.%%다시 메모%% 마지막 문장이다!';
assert.deepEqual(count(annotated), count(plain));
const options = { ...DEFAULT_SETTINGS.paragraphAnalysis, countSpaces: true };
const a = analyzeParagraphs(annotated, options), b = analyzeParagraphs(plain, options);
assert.deepEqual(a.units.map(({ text, chars, kind }) => ({ text, chars, kind })), b.units.map(({ text, chars, kind }) => ({ text, chars, kind })));
assert.equal(a.analysisText.length, annotated.length); assert(!a.analysisText.includes('메모'));
assert.equal(project(annotated).projectMask(a.analysisText).length, project(annotated).text.length);
assert(analyzeParagraphs('%%메모%%\n---\n본문\n---\n끝', options).units.some(unit => unit.text === '본문'), 'Removed leading comment exposed false YAML');
const sa = analyzeSentences(annotated, a, true), sb = analyzeSentences(plain, b, true);
assert.deepEqual(sa.map(({ text, chars }) => ({ text, chars })), sb.map(({ text, chars }) => ({ text, chars })));
for (const unit of sa) assert.equal(project(annotated.slice(unit.from, unit.to)).text, unit.text);
const long = '본문'.repeat(50000) + '%%메모%%';
assert.equal(project(long).text.length, 100000);

const host = nodeExportHost(), api = await exportFixture(false, "\nexport * from './src/export/converterMethods';");
assert.equal(api.exportContentPolicy({}).comments, 'exclude');
assert.equal(api.exportContentPolicy({ comments: 'keep' }).comments, 'keep');
assert(api.documentText(api.parseMarkdownDocument('%%메모%%\n---\n본문\n---\n끝', '', {}, 'exclude')).includes('본문'), 'Export stripped manuscript as newly exposed YAML');
const formatted = '앞%%가짜 **강조**%%뒤';
const styled = api.parseMarkdownDocument(formatted, 'note.md', { inline: [{ from: formatted.indexOf('뒤'), to: formatted.length, kind: 'bold' }], colors: [{ from: formatted.indexOf('뒤'), to: formatted.length, color: '#123456' }] }, 'exclude');
assert.equal(api.documentText(styled), '앞뒤');
assert.equal(styled.blocks[0].runs.at(-1).bold, true); assert.equal(styled.blocks[0].runs.at(-1).color, '#123456');
assert.equal(styled.blocks[0].source.to, formatted.length);
let source = '앞%%SECRET_MEMO%%뒤\n%%\n# HIDDEN_TITLE\n![missing](missing.png)\n[^hidden]: HIDDEN_FOOTNOTE\n%%\n다음';
const file = Object.assign(new host.TFile(), { path: 'note.md', basename: 'note', extension: 'md' });
const plugin = { settings: {}, app: { workspace: { getLeavesOfType: () => [] }, vault: { read: async () => source }, metadataCache: { getFirstLinkpathDest() { throw Error('Hidden image was resolved'); } } } };
const service = new api.ExportService(plugin, { generate: api.generateDocument, dispose() {} });
const policy = { ...api.DEFAULT_CONTENT, images: 'keep' }, encode = { title: 'memo', style: { ...api.DEFAULT_DOCUMENT_STYLE, fontWeight: 400 } };
for (const format of ['txt', 'docx', 'hwpx']) for (const merged of [false, true]) {
	const artifacts = await service.generate(merged ? [file, file] : [file], format, policy, encode, merged, 'memo');
	assert(!artifacts[0].generated.text.includes('SECRET')); assert(!artifacts[0].generated.text.includes('HIDDEN'));
	assert(artifacts[0].generated.text.includes('앞뒤'));
	if (format !== 'txt') for (const [name, bytes] of Object.entries(unzipSync(artifacts[0].generated.bytes))) if (name.endsWith('.xml')) assert(!/SECRET_MEMO|HIDDEN_TITLE|HIDDEN_FOOTNOTE|missing\.png/.test(strFromU8(bytes)), name);
}
source = '앞%%SECRET_MEMO%%뒤';
for (const format of ['txt', 'docx', 'hwpx']) assert((await service.generate([file], format, { ...policy, comments: 'keep' }, encode, false, 'memo'))[0].generated.text.includes('%%SECRET_MEMO%%'));
service.dispose();
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); let clipboard;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { clipboard = value; } } } });
try {
	const copyPlugin = { settings: {}, shouldApplyToFile: () => true, cleanMarkdownFrontmatter: value => api.cleanMarkdownFrontmatter(null, value) };
	for (const View of [host.MarkdownView, host.PagedWritingView]) {
		const view = Object.assign(new View(), { file, editor: { getValue: () => source }, getEditableData: () => source });
		await api.copyWithOptions(copyPlugin, { view }); assert.equal(clipboard, '앞뒤');
		copyPlugin.settings.copyExcludeComments = false; await api.copyWithOptions(copyPlugin, { view }); assert.equal(clipboard, source);
		delete copyPlugin.settings.copyExcludeComments;
	}
} finally { if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator; }

const previousWindow = globalThis.window, previousMoment = globalThis.moment;
globalThis.window = { setTimeout: () => 1, clearTimeout() {} }; globalThis.moment = moment;
try {
	const { DailyCharStore } = loadTsFixture('src/dashboard/data/DailyCharStore.ts', { obsidian: { TFile: host.TFile, normalizePath: value => value } });
	let stored = { charMode: 'munpia', today: { date: moment().format('YYYY-MM-DD'), start: { 'note.md': 2 }, current: { 'note.md': 8 }, carried: { 'note.md': 1 } } };
	let sourceReads = 0;
	const tracking = { settings: { charCountMode: 'munpia', dailyNotesFolder: 'Daily', dailyNotesFormat: 'YYYY-MM-DD' }, projectContext: { getStatisticsScopeSignature: () => '', isInStatisticsScope: () => true }, app: { vault: { adapter: { read: async () => JSON.stringify(stored), write: async (_path, text) => { stored = JSON.parse(text); } }, getMarkdownFiles: () => [file], cachedRead: async () => { sourceReads++; return source; } }, metadataCache: { getFileCache: () => null } } };
	const store = new DailyCharStore(tracking); await store.init();
	assert.equal(store.getTodayTotal(), 7, 'Upgrade changed accumulated writing');
	store.updateLiveCount(file, count(source).munpia); assert.equal(store.getTodayTotal(), 7, 'Memo text counted as new writing');
	store.updateLiveCount(file, count(source).munpia + 1); assert.equal(store.getTodayTotal(), 8);
	await store.save(); assert.equal(stored.countPolicyVersion, 1);
	const again = new DailyCharStore(tracking); await again.init(); assert.equal(again.getTodayTotal(), 8, 'Policy migration ran twice');
	assert.equal(sourceReads, 1, 'A modern count policy unnecessarily rebaselined the manuscripts');
} finally { globalThis.window = previousWindow; globalThis.moment = previousMoment; }
console.log('PASS native comments, source maps, statistics, copy, formatted TXT/DOCX/HWPX exports, hidden resources and daily-count migration');
