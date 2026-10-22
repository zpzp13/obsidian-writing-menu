// Current search must work with no model, Worker, IndexedDB assets or network.
import assert from 'node:assert/strict';
import { loadTsFixture } from './ts-fixture-loader.mjs';
import { prepareSimpleSearch } from './obsidian-search-stub.mjs';
globalThis.window = globalThis;
const project = { id: 'project', rootFolder: 'Novel', characterFolder: 'Novel/인물', manuscriptFolder: 'Novel/본문' };
const notes = new Map([
	['Novel/인물/민서.md', '민서는 태이와 같은 학교를 다녔다.'],
	['Novel/본문/001화.md', '민서는 태이에게 붉은 열쇠를 건넸다.'],
	['Other/비밀.md', '민서의 다른 프로젝트 정보.'],
]);
const files = [...notes].map(([path]) => ({ path, basename: path.split('/').at(-1).slice(0, -3), stat: { mtime: 1, size: 100 } }));
const plugin = { settings: {}, register() {}, projectContext: { getProjectForFile: file => file.path.startsWith('Novel/') ? project : null }, app: {
	metadataCache: { getFileCache: () => ({}), getFirstLinkpathDest: () => null },
	vault: { configDir: '.obsidian', adapter: { getResourcePath: () => 'synthetic-vault' }, getMarkdownFiles: () => files, read: async file => {
		assert(file.path.startsWith('Novel/'), 'Search read another project'); return notes.get(file.path);
	} },
} };
const { RagIndexService } = loadTsFixture('src/aichat/rag/RagIndexService.ts', {
	obsidian: { prepareSimpleSearch, TFile: class {} },
	'../../writing/WritingDocument': { getOpenWritingDocuments: () => [] },
	'../AiChatPlotKnowledge': { readChatPlotPassages: async () => [] },
});
const original = { fetch: globalThis.fetch, Worker: globalThis.Worker, indexedDB: globalThis.indexedDB };
try {
	globalThis.fetch = () => { throw Error('Search attempted network access'); };
	globalThis.Worker = class { constructor() { throw Error('Search started a model Worker'); } };
	globalThis.indexedDB = undefined;
	const service = new RagIndexService(plugin);
	assert(!('install' in service)); assert(!('worker' in service));
	const first = await service.search(project, '민서 붉은 열쇠', undefined, 10, '민서 붉은 열쇠', true);
	assert(first.sources.some(source => source.text.includes('붉은 열쇠')));
	const tools = service.tools(project, true), evidence = first.sources.find(source => source.path.endsWith('001화.md'));
	tools.useSources(first.sources);
	assert((await tools.execute({ name: 'read_source', args: { source_id: evidence.id } })).sources[0].text.includes('붉은 열쇠'));
	// No timestamp change: lookup must read the current text rather than a model index.
	notes.set(evidence.path, '민서는 태이에게 푸른 열쇠를 건넸다.');
	await assert.rejects(tools.execute({ name: 'read_source', args: { source_id: evidence.id } }), /원문이 변경/);
	const updated = await service.search(project, '민서 푸른 열쇠', undefined, 10, '민서 푸른 열쇠', true);
	assert(updated.sources.some(source => source.text.includes('푸른 열쇠')));
	const stop = new AbortController(); stop.abort();
	await assert.rejects(service.search(project, '민서', stop.signal), error => error.name === 'AbortError');
} finally { Object.assign(globalThis, original); }
console.log('PASS model-free project search, source freshness, project boundaries, evidence lookup and cancellation; no network or model assets.');
