// Exact episode retrieval and a synthetic one-call response. Optional manuscript directory is read-only.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { obsidianSearchStub } from './obsidian-search-stub.mjs';

const output = await build({ stdin: { contents: `export * from './src/aichat/rag/RagIndexService'; export * from './src/aichat/rag/RagEpisodes'; export * from './src/aichat/AiChatKnowledge'; export * from './src/aichat/GeminiRagApi'; export * from './src/aichat/AiChatPrompt';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'episode-fixture', setup(builder) {
	builder.onResolve({ filter: /WritingDocument$|AiChatPlotKnowledge$|^obsidian$/ }, args => ({ path: args.path, namespace: 'fixture' }));
	builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('WritingDocument') ? 'export const getOpenWritingDocuments = () => globalThis.episodeOpen;' : args.path.endsWith('AiChatPlotKnowledge') ? 'export const readChatPlotPassages = async () => [];' : 'export class TFile {} export const requestUrl = options => globalThis.episodeRequest(options);' + obsidianSearchStub }));
} }] });
const module = { exports: {} }; new Function('module', 'exports', output.outputFiles[0].text)(module, module.exports);
const { ragIndex, requestedEpisode, episodeFileNumber, episodeManuscripts, AiChatKnowledge, callGeminiRag, formatChatMessage, normalizeDeusAnswer } = module.exports;
const externalFolder = process.argv[2] ? path.resolve(process.argv[2]) : null;
const project = { id: 'episode-fixture', rootFolder: 'Novel', manuscriptFolder: 'Novel/4. 본문', characterFolder: 'Novel/인물' };
const notes = new Map(), files = [], diskPaths = new Map();
const add = (name, size = 100) => { const file = { path: name, basename: path.posix.basename(name).replace(/\.md$/i, ''), stat: { mtime: 1, size } }; files.push(file); return file; };
if (externalFolder) {
	async function scan(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const absolute = path.join(directory, entry.name); if (entry.isDirectory()) await scan(absolute);
			else if (entry.isFile() && /\.md$/i.test(entry.name)) { const relative = path.relative(externalFolder, absolute).replaceAll('\\', '/'); const file = add(project.manuscriptFolder + '/' + relative); diskPaths.set(file.path, absolute); }
		}
	}
	await scan(externalFolder);
} else {
	for (let number = 1; number <= 155; number++) {
		const filename = `${project.manuscriptFolder}/${Math.ceil(number / 25)}권/${String(number).padStart(3, '0')}화 I ${number === 3 ? '영화를 찍고 싶다는 욕망' : '장면 (3)'}.md`;
		const text = number === 3 ? '# 도입\n주인공은 낡은 카메라를 발견한다.\n' + '촬영 준비와 동료의 대화를 기록한다.\n'.repeat(290) + '\n결말에서 첫 영화 촬영을 약속한다.' : `${number}화의 다른 사건.`;
		notes.set(filename, text); add(filename, text.length);
	}
	notes.set(`${project.manuscriptFolder}/목차.md`, '[[003화 I 영화를 찍고 싶다는 욕망]]'); add(`${project.manuscriptFolder}/목차.md`);
	notes.set('Other/003화.md', '다른 작품의 비밀'); add('Other/003화.md');
}
globalThis.episodeOpen = [];
const reads = [];
const plugin = { settings: { aiChatAutoContext: true }, register() {}, projectContext: { getProjectForFile: file => file?.path.startsWith('Novel/') ? project : null }, app: {
	metadataCache: { getFileCache: () => ({}), getFirstLinkpathDest: () => null },
	vault: { getMarkdownFiles: () => files, adapter: { getResourcePath: () => 'isolated-episode-fixture' }, read: async file => { reads.push(file.path); return diskPaths.has(file.path) ? readFile(diskPaths.get(file.path), 'utf8') : notes.get(file.path); } },
} };
const service = ragIndex(plugin);
service.ensureComplete = async () => { throw new Error('Episode read incorrectly required a global embedding index'); };
Object.defineProperty(service, 'worker', { get() { throw new Error('Episode lookup requested a removed model'); } });
const oldFetch = globalThis.fetch; let apiCalls = 0, localToolCalls = 0, providerBody;
globalThis.fetch = async () => { throw new Error('No network permitted in episode fixture'); };
try {
	for (const question of ['3화 내용이 뭐였더라', '제 003 화 줄거리', '3회차 요약', '１５５화 분량에서 ３화 요약', 'episode 3 summary']) assert.equal(requestedEpisode(question), 3, question);
	assert.equal(requestedEpisode('3화와 13화를 비교해줘'), undefined); assert.equal(requestedEpisode('155화 분량의 작품'), undefined);
	for (const name of ['003화 I 제목', '3화│ 제목', '제 03 화 제목', '003. 제목', '003', 'EP.003 제목']) assert.equal(episodeFileNumber(name), 3, name);
	assert.equal(episodeFileNumber('153화│ 장면 (3)'), 153); assert.equal(episodeFileNumber('목차'), undefined);
	const message = { role: 'user', content: '3화 내용이 뭐였더라', timestamp: 0, speakerRole: 'author' };
	const input = { character: null, speaker: null, project, document: null, openDocuments: [], attachments: [], message, history: [{ role: 'user', content: '이전 장면', context: { sources: [{ id: 'old', title: '154화', text: '과거의 다른 장면', kind: 'document' }] } }], budget: 19000, requireComplete: true };
	const knowledge = new AiChatKnowledge(plugin), context = await knowledge.collect(input); message.context = context;
	assert.equal(context.retrieval.strategy, 'episode'); assert.equal(context.sources.length, 1); assert.equal(context.searches[0].name, 'episode_read');
	const source = context.sources[0], text = diskPaths.has(source.path) ? await readFile(diskPaths.get(source.path), 'utf8') : notes.get(source.path);
	assert.equal(episodeFileNumber(source.title), 3); assert.equal(source.text, text); assert.equal(source.from, 0); assert.equal(source.to, text.length);
	assert(text.length > 6000, 'Fixture must cross the old read_source page boundary');
	assert(context.warnings.some(warning => warning.includes('전체를 직접')));
	assert(reads.every(filename => filename === source.path), 'Unrelated chapter bodies were read');
	const quote = text.trim().slice(0, 50);
	globalThis.episodeRequest = async options => { apiCalls++; providerBody = JSON.parse(options.body); return { status: 200, json: { candidates: [{ content: { parts: [{ text: `제공된 3화 본문을 확인했습니다.[1]<citations>${JSON.stringify([{ number: 1, sourceId: 'C1', quote }])}</citations>` }] } }] } }; };
	const result = await callGeminiRag({ key: 'synthetic-only', model: 'gemini-3.5-flash-lite', system: '원문에 근거해 요약하고 출처를 표시하세요.', history: [message], message, maxTokens: 512, maxInputChars: 24000, stream: false, tools: { strict: true, execute: async () => { localToolCalls++; throw new Error('Overview tried another search'); } } });
	assert.equal(apiCalls, 1); assert.equal(localToolCalls, 0); assert.equal(providerBody.toolConfig.functionCallingConfig.mode, 'NONE'); assert(!providerBody.tools);
	assert(providerBody.contents[0].parts[0].text.includes(text)); assert(formatChatMessage(message).length < 19000);

	const legacySummary=`3화의 흐름을 정리했습니다 [${source.title.replace(/\s+/g,' ')}].<citations>${JSON.stringify([{number:1,sourceId:'C1',quote:'이 문장은 원문을 직접 인용하지 않고 내용을 요약한 설명이다.'}])}</citations>`;
	const normalized=normalizeDeusAnswer(legacySummary,context.sources);
	assert.equal(normalized.citations[0].kind,'reference');assert.equal(normalized.citations[0].quote,'');assert(normalized.content.includes('[1]'));
	await assert.rejects(service.episode(project, 3, 1000), /문맥/);
	await assert.rejects(service.episode(project, 9999, 20000), /찾지 못/);
	const duplicate = { id: 'dupe', path: `${project.manuscriptFolder}/다른권/003화.md`, kind: 'reference' };
	assert.equal(episodeManuscripts([{ id: 'original', path: source.path, kind: 'reference' }, duplicate], project, 3).length, 2);
	if (!externalFolder) {
		globalThis.episodeOpen = [{ path: source.path, read: () => '저장 전 수정한 회차 본문 전체를 직접 확인한다.' }];
		assert((await service.episode(project, 3, 19000)).sources[0].text.startsWith('저장 전'));
		globalThis.episodeOpen = [];
		files.push({ path: duplicate.path, basename: '003화', stat: { mtime: 1, size: 10 } });
		await assert.rejects(service.episode(project, 3, 19000), /여러 개/); files.pop();
		const controller = new AbortController(); controller.abort(); await assert.rejects(service.episode(project, 3, 19000, controller.signal), error => error.name === 'AbortError');
	}
	console.log(JSON.stringify({ result: 'PASS', corpusFiles: files.length, source: source.path, sourceCharacters: text.length, completeSource: true, modelInstalled: false, remoteRequests: 0, syntheticApiCalls: apiCalls, localToolCalls, externalManuscripts: Boolean(externalFolder) }));
} finally { globalThis.fetch = oldFetch; }
