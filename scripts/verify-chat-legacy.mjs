import { loadTsFixture } from './ts-fixture-loader.mjs';
// In-memory source-level checks; no browser, network, real vault writes or paid requests.
import assert from 'node:assert/strict';

const loadSource = loadTsFixture;
const notices = [];
const store = await loadSource('src/aichat/ChatJsonStore.ts');
const { AiChatStorage, isChatSessionId } = await loadSource('src/aichat/AiChatStorage.ts', { obsidian: { Notice: class { constructor(text) { notices.push(text); } } }, './ChatJsonStore': store });
const files = new Map(), folders = new Set(['.writing-menu-aichat', '.writing-menu-aichat/sessions']);
const adapter = {
	async exists(path) { return files.has(path) || folders.has(path); }, async mkdir(path) { folders.add(path); },
	async read(path) { assert(files.has(path)); return files.get(path); }, async write(path, text) { files.set(path, text); }, async remove(path) { files.delete(path); },
	async list(directory) { return { files: [...files.keys()].filter(path => path.startsWith(directory + '/') && !path.slice(directory.length + 1).includes('/')), folders: [] }; },
};
const storage = new AiChatStorage({ vault: { adapter } });
const key = encodeURIComponent('작품/인물/이전 인물.md'), path = '.writing-menu-aichat/sessions/' + key + '.json';
const raw = JSON.stringify({ characterPath: '작품/인물/이전 인물.md', messages: [{ role: 'user', content: '기존 대화', timestamp: 10 }], updatedAt: 11 });
files.set(path, raw); files.set('.writing-menu-aichat/sessions/undefined.json', raw); files.set('.writing-menu-aichat/sessions/broken.json', '{broken');
assert.equal((await storage.listSessions()).length, 2);
assert.equal(files.get(path), raw, 'Opening/listing rewrote a legacy conversation');
const legacy = await storage.loadById(key);
assert.equal(legacy.id, key); assert.equal(legacy.title, '이전 인물');
assert.equal(legacy.messages[0].id, 'legacy-' + key + '-0');
assert.equal((await storage.loadById('undefined')).id, 'undefined');
assert(notices.length > 0, 'Damaged record warning was omitted');
for (const invalid of ['../escape', '..', '.', 'a/b', 'a\\b', 'x:y', 'x\u0000y', '', undefined]) assert(!isChatSessionId(invalid));
assert(isChatSessionId(key));
await storage.save(legacy); assert.equal(files.get(path + '.bak'), raw);
assert.equal(JSON.parse(files.get(path)).messages[0].content, '기존 대화');
await assert.rejects(storage.loadById('../escape'));
const created = await storage.createNewSession('character.md', '새 대화'); await storage.save(created);
created.messages.push({ id: 'frozen', role: 'user', content: '질문', timestamp: 0, context: { version: 1, engine: 'local-hybrid', sources: [{ id: 'one', title: '근거', text: '설정', from: 0, to: 2, contentHash: 'hash' }], warnings: [], searches: [{ name: 'search_sources', query: '질문', sourceIds: ['one'] }] }, usage: [{ totalTokenCount: 42 }] });
created.messages[0].context.retrieval = { version: 1, strategy: 'character-history' };
created.messages[0].context.research = { characters: [{ id: 'character', name: '인물' }], inspectedDocuments: 1, matchedDocuments: 1, matchedPassages: 1, includedDocuments: 1, includedPassages: 1, shortenedPassages: 0, partial: false };
await storage.save(created); const branched = await storage.fork(created, 0); branched.messages[0].context.searches[0].sourceIds.push('branch-only'); branched.messages[0].usage[0].totalTokenCount = 99;
assert.deepEqual(created.messages[0].context.searches[0].sourceIds, ['one']); assert.equal(created.messages[0].usage[0].totalTokenCount, 42); assert.equal((await storage.loadById(created.id)).messages[0].context.sources[0].contentHash, 'hash');
branched.messages[0].context.research.characters[0].name = '분기의 인물'; branched.messages[0].context.retrieval.strategy = 'focused';
assert.equal(created.messages[0].context.research.characters[0].name, '인물'); assert.equal(created.messages[0].context.retrieval.strategy, 'character-history');
const episodeSession = await storage.createNewSession('', '회차 읽기'); episodeSession.mode = 'deus';
episodeSession.messages.push({ role: 'user', content: '3화 요약', timestamp: 0, context: { version: 1, sources: [], warnings: [], retrieval: { version: 1, strategy: 'episode' } } });
await storage.save(episodeSession); assert.equal((await storage.loadById(episodeSession.id)).messages[0].context.retrieval.strategy, 'episode');
episodeSession.messages[0].responseDraft={content:'이전 버전에서 받은 응답',timestamp:1};
episodeSession.messages.push({role:'assistant',content:'요약입니다.[1]',timestamp:1,citations:[{number:1,sourceId:'chapter-three',quote:'',kind:'reference'}]});
await storage.save(episodeSession);const episodeReload=await storage.loadById(episodeSession.id);
assert.equal(episodeReload.messages[1].citations[0].kind,'reference');assert.equal(episodeReload.messages[0].responseDraft,undefined);
const episodeFork=await storage.fork(episodeReload,1);episodeFork.messages[1].citations[0].kind=undefined;
assert.equal(episodeReload.messages[1].citations[0].kind,'reference');
const recoverSession=await storage.createNewSession('','이전 응답 복원');recoverSession.messages.push({role:'user',content:'질문',timestamp:0,responseDraft:{content:'기존에 받은 답변',timestamp:1}});
await storage.save(recoverSession);const recoverRaw=files.get('.writing-menu-aichat/sessions/'+recoverSession.id+'.json');
const recovered=await storage.loadById(recoverSession.id);assert.equal(recovered.messages.length,2);assert.equal(recovered.messages[1].content,'기존에 받은 답변');assert.equal(recovered.messages[1].status,'complete');assert.equal(files.get('.writing-menu-aichat/sessions/'+recoverSession.id+'.json'),recoverRaw,'Opening rewrote a saved legacy response');
const rangeSession=await storage.createNewSession('','권 범위');rangeSession.mode='deus';
rangeSession.messages.push({role:'user',content:'1권(1~25화) 요약',timestamp:0,context:{version:1,sources:[],warnings:[],retrieval:{version:1,strategy:'episode-range'},episodeRange:{from:1,to:25,volume:1,inspectedEpisodes:25,includedEpisodes:25,sourceCharacters:150000,includedCharacters:14000,partial:true}}});
await storage.save(rangeSession);const rangeReload=await storage.loadById(rangeSession.id);assert.equal(rangeReload.messages[0].context.episodeRange.includedEpisodes,25);
const rangeFork=await storage.fork(rangeReload,0);rangeFork.messages[0].context.episodeRange.includedCharacters=1;assert.equal(rangeReload.messages[0].context.episodeRange.includedCharacters,14000);
const stale = await storage.loadById(created.id); created.title = '변경'; await storage.save(created); stale.title = '오래된 변경'; await assert.rejects(storage.save(stale));
const { lengthBuckets, rhythmBins, lengthBins, flowBins, niceMaximum } = await loadSource('src/repetition/RevisionCharts.ts');
assert.deepEqual(lengthBuckets([1,40,41,80,81,160,161,320,321].map(chars => ({ chars }))).map(bucket => bucket.items.length), [2,2,2,2,1]);
const inputs = Array.from({ length: 10001 }, (_, index) => ({ chars: index === 5010 ? 9999 : 10 }));
const bins = rhythmBins(inputs);
assert(bins.length <= 100); assert.equal(Math.max(...bins.map(bin => bin.max)), 9999); assert.equal(bins.reduce((sum, bin) => sum + bin.to - bin.from, 0), inputs.length);
inputs[100].chars=1; const lengthChart=lengthBins(inputs);
assert(lengthChart.length<=32);
assert(lengthChart.some(bin=>bin.from===100&&bin.to===101&&bin.mean===1));
assert(lengthChart.some(bin=>bin.from===5010&&bin.to===5011&&bin.mean===9999));
assert.equal(lengthChart.reduce((sum, bin)=>sum+bin.to-bin.from,0),inputs.length);
assert.equal(lengthChart.reduce((sum, bin)=>sum+bin.mean*(bin.to-bin.from),0),inputs.reduce((sum,item)=>sum+item.chars,0));
const paragraph = await loadSource('src/repetition/ParagraphAnalysis.ts');
const { analyzeSentences } = await loadSource('src/repetition/SentenceAnalysis.ts', { './ParagraphAnalysis': paragraph });
const paragraphOptions = { boundary: 'block', countSpaces: false, mobileLineChars: 22, singleQuote: 'monologue', roundBracket: 'monologue' };
const sentenceSource = '---\ntitle: 제외\n---\n# 제목\n\n3.14는 수다. **끝났다!** “정말?” 다음... 마지막😀\n\n[표시](https://example.com/a.b)로 갔다.\n\n```js\n코드.\n```';
const sentenceUnits = analyzeSentences(sentenceSource, paragraph.analyzeParagraphs(sentenceSource, paragraphOptions), false);
assert.deepEqual(sentenceUnits.map(unit => unit.text), ['3.14는 수다.', '끝났다!', '“정말?”', '다음...', '마지막😀', '표시로 갔다.']);
assert(sentenceUnits.every(unit => unit.to > unit.from && unit.text.length > 0 && !unit.text.includes('http')));
assert.equal(sentenceSource.slice(sentenceUnits[2].from, sentenceUnits[2].to), '“정말?”');
assert.equal(sentenceUnits[4].chars, 4, 'Unicode character count differs from codepoint count');
assert.equal(analyzeSentences('문장 두 개. 다음이다!', paragraph.analyzeParagraphs('문장 두 개. 다음이다!', paragraphOptions), true)[0].chars, 7);
const flowInput = Array.from({ length: 20001 }, (_, index) => ({ chars: index % 91 + 1, kind: paragraph.PARAGRAPH_KINDS[index % 4] }));
const flow = flowBins(flowInput);
assert(flow.length <= 120 && flow[0].from === 0 && flow.at(-1).to === flowInput.length);
for (const kind of paragraph.PARAGRAPH_KINDS) {
 const total = flowInput.filter(item => item.kind === kind).reduce((sum, item) => sum + item.chars, 0);
 assert.equal(flow.at(-1).cumulative[kind], total);
 assert.equal(flow.reduce((sum, bin) => sum + bin.interval[kind], 0), total);
 assert(flow.every((bin, index) => index === 0 || bin.cumulative[kind] >= flow[index - 1].cumulative[kind]));
}
assert.deepEqual(flowBins([]), []);
for (const value of [0, 1, 3, 999, 56789]) assert(niceMaximum(value) >= Math.max(1, value));
assert.equal(niceMaximum(129),140,'Flow ceiling still jumps to 200 for a 129-character peak');
for(const value of [10,42,99,129,149,999,1000,56789])assert(niceMaximum(value)<=value*1.15,'Flow ceiling leaves excessive space above real values');
const { repetitionExcerpt }=await loadSource('src/repetition/RevisionExcerpt.ts');
const excerptPrefix='앞😀'.repeat(25),excerptSuffix='뒤😃'.repeat(25),excerptSource=excerptPrefix+'표적'+excerptSuffix;
const excerpt=repetitionExcerpt(excerptSource,excerptPrefix.length,excerptPrefix.length+2);
assert.equal(excerpt.before,Array.from(excerptPrefix).slice(-10).join(''));assert.equal(excerpt.after,Array.from(excerptSuffix).slice(0,10).join(''));
assert.equal(excerpt.match,'표적');assert(excerpt.leading&&excerpt.trailing);
assert.equal(Array.from(excerpt.before).length,10);assert.equal(Array.from(excerpt.after).length,10);
assert.deepEqual(repetitionExcerpt('표적',0,2),{before:'',match:'표적',after:'',leading:false,trailing:false});
const { DONUT_RADII, donutSegmentPath }=await loadSource('src/repetition/RevisionDonut.ts');
assert.equal(DONUT_RADII.selected-DONUT_RADII.outer,12,'Donut outward expansion was not doubled');
for(const start of [0,.125,.875])for(const fraction of [.000001,.225,.5,.71,.999999,1]){
 const normal=donutSegmentPath(start,start+fraction,DONUT_RADII.outer),selected=donutSegmentPath(start,start+fraction,DONUT_RADII.selected);
 assert(normal&&selected&&!/NaN|Infinity/.test(normal+selected));
 const radii=path=>[...path.matchAll(/A ([\d.]+) ([\d.]+)/g)].map(match=>Number(match[1]));
 assert.deepEqual(radii(normal),fraction===1?[87,87,69,69]:[87,69]);
 assert.deepEqual(radii(selected),fraction===1?[99,99,69,69]:[99,69]);
 const hole=path=>path.slice(path.indexOf(fraction===1?' Z M ':' L '));
 assert.equal(hole(normal),hole(selected),'Selected donut changes the inner contour');
}
for(const args of [[0,0,87],[1,0,87],[0,1,69],[0,1,NaN],[Infinity,1,87]])assert.equal(donutSegmentPath(...args),'');
class PlotView { getState() { return { projectId: 'project' }; } }
const { snapshotTarget } = await loadSource('src/snapshots/SnapshotManager.ts', {
	obsidian: {}, '../plot-workbook/PlotWorkbookView': { PlotWorkbookView: PlotView }, '../plot-workbook/PlotWorkbookTransferModal': {},
	'../writing/WritingDocument': { getWritingDocumentForView: view => view?.document ?? null }, './ManuscriptSnapshotModal': {},
});
const previous = { document: { file: { path: 'Project/source.md' } } };
const plugin = { app: { workspace: { getLeaf: () => ({ view: {} }), getMostRecentLeaf: () => ({ view: previous }) } }, projectContext: { getProjects: () => [{ id: 'project' }], getProjectForFile: file => file.path.startsWith('Project/') ? {} : null } };
assert.equal(snapshotTarget(plugin), null, 'Snapshot command targeted a remembered document instead of the active unrelated view');
assert.equal(snapshotTarget(plugin, { view: previous }).kind, 'manuscript');
assert.equal(snapshotTarget(plugin, { view: new PlotView() }).kind, 'plot');
assert.equal(snapshotTarget(plugin, { view: { document: { file: { path: 'Outside/source.md' } } } }), null);
const commonApi = await loadSource('src/aichat/AiApiCommon.ts');
const streaming = await loadSource('src/aichat/ChatStream.ts');
const chatPrompt = await loadSource('src/aichat/AiChatPrompt.ts');
let requestBody;
const { AI_CHAT_MODELS, DEFAULT_AI_CHAT_MODEL, callAiChat } = await loadSource('src/aichat/AiChatApi.ts', {
	obsidian: { requestUrl: async options => { requestBody = JSON.parse(options.body); return { status: 200, json: { candidates: [{ content: { parts: [{ text: '가상 응답' }] } }] } }; } },
	'./AiApiCommon': commonApi, './ChatStream': streaming, './AiChatPrompt': chatPrompt,
});
assert(AI_CHAT_MODELS.some(model => model.id === 'gemini-3.5-flash-lite'));
assert.equal(DEFAULT_AI_CHAT_MODEL, 'gemini-3.5-flash-lite');
await callAiChat({ gemini: 'test-only', nvidia: '' }, '테스트', [{ role: 'user', content: '테스트', timestamp: 0 }], 1, 'gemini-3.5-flash-lite', 256);
assert.equal(requestBody.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
console.log('Legacy chat preservation, damaged-record isolation, safe keys, verified backup/stale-write guards, bounded charts, contextual snapshot routing and Flash-Lite request configuration passed. No real vault writes or API calls.');
