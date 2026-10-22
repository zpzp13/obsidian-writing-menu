// Deterministic retrieval/navigation checks; no models, keys, or network requests.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { obsidianSearchStub } from './obsidian-search-stub.mjs';

const output = await build({ stdin: { contents: `export * from './src/aichat/rag/RagIndexService'; export * from './src/aichat/rag/RagSourceGraph';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'navigation-fixture', setup(builder) {
	builder.onResolve({ filter: /ChatCorpusProvider$/ }, () => ({ path: 'corpus', namespace: 'fixture' }));
	builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'search' }));
	builder.onLoad({ filter: /.*/, namespace: 'search' }, () => ({ contents: obsidianSearchStub + '\nexport class TFile {}' }));
	builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export class ChatCorpusProvider { async documents() { return { documents: globalThis.navigationDocuments, warnings: [] }; } }' }));
} }] });
const module = { exports: {} }; new Function('module', 'exports', output.outputFiles[0].text)(module, module.exports);
const { RagIndexService, relatedDocumentDistances } = module.exports;
const notes = new Map();
const doc = (id, text, links = [], extra = {}) => {
	notes.set(id, text); return { id, path: `${id}.md`, title: id.split('/').pop(), kind: 'reference', stamp: 'fixed', links, ...extra, read: async () => notes.get(id) };
};
const origin = doc('Story/아린', '아린은 스승에게 배웠다.', ['Story/스승.md'], { kind: 'character' });
const mentor = doc('Story/스승', '스승은 오래 앓았다. 기록은 계약서에 있다.', ['Story/계약.md']);
const contract = doc('Story/계약', ['서문의 무관한 기록.'.repeat(200), '아무 관련 없는 마을 기록.'.repeat(200), '치료비를 받는 계약의 대가는 힘을 숨기는 것이었다.', '후속 기록.'.repeat(200)].join('\n\n'));
const episode = doc('Story/100화', '그녀는 성문으로 향했다.');
const plot = doc('plot:100', '계획된 장면.', [episode.path], { path: episode.path, kind: 'plot', characterPaths: [origin.path] });
const semantic = doc('Story/상실', '절친을 잃고 성문을 지켰다.');
const noise = doc('Story/표제', '소중한 벗의 죽음이라는 말만 나열한 무관한 표제.');
const documents = globalThis.navigationDocuments = [origin, mentor, contract, episode, plot, semantic, noise];
const project = { rootFolder: 'Story' };
const plugin = { settings: {}, register() {}, app: { vault: { adapter: { getResourcePath: () => 'navigation-fixture' } } } };
const service = new RagIndexService(plugin); let remoteRequests = 0;
Object.defineProperty(service, 'worker', { get() { throw new Error('Navigation requested a removed embedding model'); } });
const savedFetch = globalThis.fetch; globalThis.fetch = async () => { remoteRequests++; throw new Error('Unexpected network request'); };
try {
	const tools = service.tools(project, true);
	const exact = await tools.execute({ name: 'search_sources', args: { query: '치료비 대가', mode: 'keyword' } });
	assert(exact.sources.some(source => source.group === contract.id && source.text.includes('치료비')));
	assert.deepEqual(tools.searchModes,['keyword']);
	const nativeFallback=await tools.execute({name:'search_sources',args:{query:'소중한 벗의 죽음',mode:'semantic'}});
	assert(nativeFallback.warnings.some(w=>w.includes('Obsidian')));
	await assert.rejects(tools.execute({ name: 'search_sources', args: { query: '계약', mode: ['hybrid'] } }), /검색 방식/);
	const firstHop = await tools.execute({ name: 'related_sources', args: { source_id: origin.id, query: '치료비 대가', hops: 1 } });
	assert(!firstHop.sources.some(source => source.group === contract.id), 'One-hop query jumped two explicit links');
	const secondHop = await tools.execute({ name: 'related_sources', args: { source_id: origin.id, query: '치료비 대가', hops: 2 } });
	assert.equal(secondHop.sources[0].group, contract.id);
	assert(secondHop.sources[0].text.includes('치료비'), 'Related lookup returned the first irrelevant chunk');
	assert(secondHop.sources.some(source => source.group === episode.id), 'Plot-to-manuscript path was not traversed');
	assert(firstHop.sources.some(source => source.group === plot.id), 'Explicit cast link was not traversed in reverse');
	for (const source of secondHop.sources) assert.equal(notes.get(source.group).slice(source.from, source.to), source.text);
	await assert.rejects(tools.execute({ name: 'related_sources', args: { source_id: origin.id, hops: 3 } }), /탐색/);
	await assert.rejects(tools.execute({ name: 'read_source', args: { source_id: 'Other/금지' } }), /프로젝트/);
	const matched = secondHop.sources[0], prior = await tools.execute({ name: 'read_source', args: { source_id: matched.id, before: 100 } });
	assert.equal(prior.sources[0].from, matched.from - 100);
	assert.equal(prior.sources[0].text, notes.get(contract.id).slice(prior.sources[0].from, prior.sources[0].to));
	assert(prior.sources[0].text.length <= 6000);
	await assert.rejects(tools.execute({ name: 'read_source', args: { source_id: matched.id, before: 2001 } }), /위치/);
	const long = doc('Story/긴문맥', '가'.repeat(100) + '😀' + '나'.repeat(8000)); documents.push(long);
	const unicode = (await service.tools(project).execute({ name: 'read_source', args: { source_id: long.id, offset: 101 } })).sources[0];
	assert.equal(unicode.from, 100); assert(unicode.text.startsWith('😀')); assert(unicode.text.length <= 6000);
	assert.equal(unicode.text, notes.get(long.id).slice(unicode.from, unicode.to));
	notes.set(contract.id, '변경된 원문');
	await assert.rejects(service.tools(project).execute({ name: 'related_sources', args: { source_id: matched.id } }), /변경/);
	const outsideLink = doc('Story/격리', '범위 검사', ['Other/금지.md']);
	assert.equal(relatedDocumentDistances([outsideLink], outsideLink.id, 2).distances.size, 1);
	const cycle = [doc('cycle/a', 'a', ['cycle/b.md']), doc('cycle/b', 'b', ['cycle/a.md'])];
	assert.equal(relatedDocumentDistances(cycle, cycle[0].id, 2).distances.size, 2);
	const hub = doc('hub/root', 'root');
	const many = [hub, ...Array.from({ length: 150 }, (_, i) => doc(`hub/${i}`, '연결', [hub.path]))];
	const bounded = relatedDocumentDistances(many, hub.id, 2); assert(bounded.truncated); assert.equal(bounded.distances.size, 96);
	assert.equal(remoteRequests, 0);
	console.log(JSON.stringify({ result: 'PASS', checks: ['keyword with no model', 'legacy tool mode reports actual keyword search', '1/2-hop scope', 'cast and manuscript links', 'question-selected chunk', 'exact prior context', 'stale source rejection', 'cycle and hub bounds'], remoteRequests }));
} finally { globalThis.fetch = savedFetch; }
