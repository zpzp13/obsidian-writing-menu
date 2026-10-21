// Offline 200-episode integration fixture. No real manuscripts, model downloads or Gemini requests.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { obsidianSearchStub } from './obsidian-search-stub.mjs';

const bundle = await build({ stdin: { contents: `export * from './src/aichat/rag/RagIndexService'; export * from './src/aichat/rag/RagResearch'; export * from './src/aichat/rag/RagLexical'; export * from './src/aichat/AiChatKnowledge'; export * from './src/aichat/AiChatPrompt';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'offline-fixture', setup(builder) {
	builder.onResolve({ filter: /WritingDocument$|AiChatPlotKnowledge$|^obsidian$/ }, args => ({ path: args.path, namespace: 'fixture' }));
	builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('WritingDocument') ? 'export const getOpenWritingDocuments = () => globalThis.researchFixture.open;' : args.path.endsWith('AiChatPlotKnowledge') ? 'export const readChatPlotPassages = async () => globalThis.researchFixture.plots;' : 'export class TFile {}' + obsidianSearchStub }));
} }] });
const module = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { ragIndex, AiChatKnowledge, namePattern, researchRanges, researchEntities, resolveResearchEntities, ragLexicalTerms, ragBm25, formatChatMessage, normalizeDeusAnswer } = module.exports;
const project = { id: 'novel', name: '합성 장편', rootFolder: 'Novel', characterFolder: 'Novel/인물', manuscriptFolder: 'Novel/본문' };
const notes = new Map([['Novel/인물/설아.md', '설아는 흑매라는 별칭을 사용하며 시민을 보호한다.'], ['Novel/인물/도윤.md', '도윤은 상단에서 일한다.'], ['Other/금지.md', '설아는 다른 작품에서 한 행동이다.']]);
for (let index = 1; index <= 200; index++) notes.set(`Novel/본문/${index}화.md`, index === 100 ? '그녀는 북문에서 붙잡힌 시민을 구출했다.' : `${index}화 기록. ${index % 2 ? '설아는' : '흑매는'} 사건${index}에서 시민을 구하고 다음 도시로 향했다.`);
const metadata = new Map([['Novel/인물/설아.md', { frontmatter: { aliases: ['흑매'] } }]]);
const fixture = globalThis.researchFixture = { open: [], plots: [{ id: 'plot:Novel:main:r100:1', group: 'plot:Novel:main:r100', title: '100화 플롯', path: 'Novel/본문/100화.md', kind: 'plot', text: '등장 인물이 북문에서 시민을 구하는 계획.', characterPaths: ['Novel/인물/설아.md'], sequence: 100 }] };
let reads = 0, researchWrites = 0, invertedReads = 0, embeddings = 0;
const files = () => [...notes].map(([path, text]) => ({ path, basename: path.split('/').pop().slice(0, -3), stat: { mtime: 1, size: text.length } }));
const plugin = { settings: { aiChatAutoContext: true }, register() {}, registerEvent() {}, projectContext: { getProjectForFile: file => file.path.startsWith('Novel/') ? project : null }, app: {
	metadataCache: { getFileCache: file => metadata.get(file.path) ?? {}, getFirstLinkpathDest: () => null },
	vault: { getMarkdownFiles: files, read: async file => { reads++; assert(!file.path.startsWith('Other/')); return notes.get(file.path); }, adapter: { getResourcePath: () => 'offline-200-episode-fixture' } },
} };
const service = ragIndex(plugin);
const stores = { assets: new Map(), records: new Map(), documents: new Map(), research: new Map() };
Object.assign(service.database, {
	get: async (store, key) => stores[store].get(key),
	put: async (store, value) => { if (store === 'research') researchWrites++; stores[store].set(value.key, value); },
	page: async (store, index, value, after, limit = 64) => [...stores[store].values()].filter(item => (index === 'documentKey' ? item.documentKey === value : item.scope === value) && (!after || item.key > after)).sort((a, b) => a.key < b.key ? -1 : 1).slice(0, limit),
	records: async function* (scope) { const records = [...stores.records.values()].filter(item => item.scope === scope); for (let from = 0; from < records.length; from += 64) yield records.slice(from, from + 64); },
	documents: async function* (scope) { for (const document of stores.documents.values()) if (document.scope === scope) yield document; },
	matchingRecords: async function* (scope, terms) { invertedReads++; const keys = [...terms].map(term => `${scope}\0${term}`); yield [...stores.records.values()].filter(item => item.scope === scope && item.termKeys?.some(key => keys.includes(key))); },
	pruneDocument: async (key, keep) => { for (const [id, item] of stores.records) if (item.documentKey === key && !keep.has(id)) stores.records.delete(id); },
	removeDocument: async key => { stores.documents.delete(key); for (const store of ['records', 'research']) for (const [id, item] of stores[store]) if (item.documentKey === key) stores[store].delete(id); },
	clearScope: async scope => { for (const store of ['records', 'research', 'documents']) for (const [id, item] of stores[store]) if (item.scope === scope) stores[store].delete(id); },
});
Object.defineProperty(service,'worker',{get(){throw new Error('Model-free search attempted to create a Worker client');}});
const savedFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Offline research attempted a network request'); };
try {
	assert(namePattern('설아').test('설아의 행적')); assert(!namePattern('설아').test('설아톤의 행적'));
	assert(namePattern('A').test('A는 누구')); assert(!namePattern('A').test('AB는 누구'));
	assert(researchRanges('설아는 출발했다.\n그녀는 시민을 구했다.', [{ aliases: ['설아'] }]).length);
	const entities = researchEntities([{ id: 'a', title: '설아', path: 'a', kind: 'character', names: ['흑매'] }, { id: 'b', title: '설아', path: 'b', kind: 'character' }]);
	assert.throws(() => resolveResearchEntities(entities, '설아의 행적'), /여러 노트/);
	assert.equal(resolveResearchEntities(entities, '흑매의 행적')[0].id, 'a');
	assert.equal(resolveResearchEntities([{ id: 'short', path: 'short', name: '수', aliases: ['수'] }, { id: 'long', path: 'long', name: '수영', aliases: ['수영'] }], '수와 수영의 행적을 비교해줘').length, 2, 'An independent shorter character name was dropped');
	const short = ragLexicalTerms('설아 설아 북문'), long = ragLexicalTerms('설아 ' + '다른 사건 '.repeat(100));
	assert(ragBm25(short, new Map([['설아', 1]]), new Map([['설아', 2]]), 10, 40) > ragBm25(long, new Map([['설아', 1]]), new Map([['설아', 2]]), 10, 40));
	const first = await service.research(project, '흑매의 전체 행적을 정리해줘', 100000);
	assert.equal(first.coverage.inspectedDocuments, 203); assert.equal(first.coverage.matchedDocuments, 202);
	assert.equal(first.coverage.includedDocuments, 202); assert.equal(first.coverage.partial, false);
	assert(first.sources.some(source => source.path === 'Novel/본문/100화.md' && source.text.includes('그녀는 북문')), 'Structured cast link missed pronoun-only manuscript');
	assert(first.sources.some(source => source.kind === 'plot'), 'Linked plot was missing');
	for (let episode = 1; episode <= 200; episode++) assert(first.sources.some(source => source.path === `Novel/본문/${episode}화.md` && source.kind !== 'plot'), `Episode ${episode} was cut off by top-K`);
	assert(first.sources.findIndex(source => source.path === 'Novel/본문/2화.md') < first.sources.findIndex(source => source.path === 'Novel/본문/100화.md'), 'Partially linked plot metadata broke episode ordering');
	for (const source of first.sources) if (source.kind !== 'plot') assert.equal(notes.get(source.path).slice(source.from, source.to), source.text);
	const beforeReuse = researchWrites, beforeEmbeddings = embeddings;
	await service.research(project, '설아의 행적 정리', 100000); assert.equal(researchWrites, beforeReuse, 'Unchanged appearance ledger was rebuilt'); assert.equal(embeddings, beforeEmbeddings, 'Research re-embedded unchanged sources');
	const limited = await service.research(project, '설아의 행적 정리', 5000);
	assert(limited.coverage.partial); assert(limited.warnings[0].includes('모든 행적을 정리했다고 말하지'));
	assert(limited.coverage.includedDocuments <= limited.coverage.matchedDocuments);
	const sampledEpisodes = limited.sources.filter(source => source.kind !== 'plot').map(source => Number(/\/(\d+)화\.md$/.exec(source.path ?? '')?.[1])).filter(Number.isFinite);
	assert(Math.min(...sampledEpisodes) <= 5 && Math.max(...sampledEpisodes) >= 195, 'Small budgets sampled only one end of the novel');
	assert(formatChatMessage({ role: 'user', content: '행적', timestamp: 0, context: { version: 1, sources: limited.sources, warnings: limited.warnings, retrieval: { version: 1, strategy: 'character-history' } } }).length < 6000, 'Evidence packing ignored its budget');
	notes.set('Novel/본문/200화.md', '흑매는 마지막 사건에서 실종된 시민과 재회했다.');
	const edited = await service.research(project, '설아의 행적', 100000); assert(edited.sources.some(source => source.text.includes('재회')), 'Same-timestamp edit reused stale cache');
	metadata.set('Novel/인물/설아.md', { frontmatter: { aliases: ['새매'] } });
	const changedAliases = await service.research(project, '설아의 행적', 100000); assert(!changedAliases.sources.some(source => source.path === 'Novel/본문/2화.md'), 'Alias changes retained old appearance matches');
	metadata.set('Novel/인물/설아.md', { frontmatter: { aliases: ['흑매'] } });
	fixture.open = [{ path: 'Novel/본문/1화.md', read: () => '설아는 저장 전의 새 사건을 조사했다.' }];
	assert((await service.research(project, '설아의 행적', 100000)).sources.some(source => source.text.includes('저장 전의'))); fixture.open = [];
	const missing = 'Novel/본문/199화.md'; notes.delete(missing);
	assert(!(await service.research(project, '설아의 행적', 100000)).sources.some(source => source.path === missing));
	assert(![...stores.research.values()].some(item => item.documentKey.endsWith(`note:${missing}`)), 'Deleted source ledger remained');
	const result = await service.search(project, '설아 시민 재회', undefined, 10, '설아 시민 재회', true); assert.equal(invertedReads, 0); assert.equal(embeddings, 0); assert.equal(researchWrites, 0); assert(result.sources.length);
	const expanded = await service.expand(project, result.sources, 20000);
	for (const source of expanded) if (source.kind !== 'plot') assert.equal(notes.get(source.path).slice(source.from, source.to), source.text);
	const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(service.research(project, '설아 행적', 100000, cancelled.signal), error => error.name === 'AbortError');
	const quoteSource = first.sources.find(source => source.text.length >= 15), quote = quoteSource.text.slice(0, 15);

	const knowledge = new AiChatKnowledge(plugin), input = { character: null, speaker: null, project, document: null, openDocuments: [], attachments: [], message: { role: 'user', content: '설아의 전체 행적을 정리해줘', timestamp: 0 }, history: [], budget: 20000, requireComplete: true };
	const context = await knowledge.collect(input); assert.equal(context.retrieval.strategy, 'character-history'); assert(context.research); assert(!formatChatMessage({ ...input.message, context }).includes('note:Novel/'));
	const boundTools = service.tools(project), boundSource = context.sources[0]; boundTools.useSources(context.sources); service.temporary.clear();
	const rebound = await boundTools.execute({ name: 'read_source', args: { source_id: boundSource.id } }); assert(rebound.sources[0].text.includes(boundSource.text), 'Per-request evidence became unreadable after transient cache eviction');
	boundTools.useSources([{ ...boundSource, id: 'note:Other/金지.md#research:fake', path: 'Other/金지.md' }]);
	await assert.rejects(boundTools.execute({ name: 'read_source', args: { source_id: 'note:Other/金지.md#research:fake' } }), /프로젝트/);
	const manySources = Array.from({ length: 150 }, (_, index) => ({ id: `source-${index}`, title: `자료${index}`, text: `인물은 사건${index}에서 시민을 구출했다.` }));
	const manyCitations = manySources.map((source, index) => ({ number: index + 1, sourceId: `C${index + 1}`, quote: source.text }));
	const manyAnswer = normalizeDeusAnswer(manySources.map((_, index) => `[${index + 1}]`).join(' ') + `<citations>${JSON.stringify(manyCitations)}</citations>`, manySources);
	assert.equal(manyAnswer.citations.length, 150, 'Long investigations retained the old 100-citation cutoff');
	const focused = await knowledge.collect({ ...input, message: { ...input.message, content: '설아는 어느 시민과 재회했어?' } }); assert.equal(focused.retrieval.strategy, 'focused'); assert(!focused.research);
	await service.clear(project); assert.equal(stores.research.size, 0); assert.equal(stores.records.size, 0);
	console.log(JSON.stringify({ passed: true, episodes: 200, fullCoverage: first.coverage, limitedCoverage: limited.coverage, cachedRanges: beforeReuse, invertedReads, reads, remoteRequests: 0 }, null, 2));
} finally { globalThis.fetch = savedFetch; delete globalThis.researchFixture; }
