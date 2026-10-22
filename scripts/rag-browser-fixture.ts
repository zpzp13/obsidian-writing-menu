// Explicit legacy-model evaluation only. Normal chat uses model-free Obsidian search.
import { RagIndexService } from '../src/aichat/rag/RagIndexService';


const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const project = { id: 'synthetic-a', name: '합성 작품', rootFolder: '작품', characterFolder: '작품/인물', manuscriptFolder: '작품/본문' } as any;
// Fixed evaluation set. Expectations are source IDs, not phrases invented by a response model.
const cases = [
	['마루의 원칙', '마루는 무고한 사람을 다치게 하는 명령은 거절한다. 권력자보다 민간인의 생존을 먼저 생각한다.', '마루에게 죄 없는 주민을 해치라고 하면 따를까?'],
	['도윤의 빚', '도윤이 조직에 남은 이유는 여동생 수술비를 대신 내 준 은혜 때문이다. 빚을 갚기 전에는 떠나지 않는다.', '도윤이 마음에 안 드는 조직에서 못 나오는 까닭은?'],
	['각성 병역', '각성자는 군 복무를 면제받는 대신 특수 재난에 협조할 의무가 있다.', '능력이 발현되면 입대하지 않아도 되는가?'],
	['은폐 계약', '서린은 스승의 치료비를 대가로 자신의 각성 사실을 숨기기로 약속했다.', '서린이 힘을 드러내지 않는 거래의 대가는?'],
	['북문 암호', '북문 경비병은 손님이 푸른 새벽이라고 말하면 지하 통로를 연다.', '북쪽 출입구에서 무슨 말을 해야 비밀 길로 갈 수 있지?'],
	['독의 해독', '은빛 풀의 뿌리를 끓이면 검은 뱀의 독을 해독할 수 있다.', '검은 뱀에게 물렸을 때 쓸 치료 재료가 있나?'],
	['황실 비밀', '황태자는 진짜 황제의 아들이 아니라 실종된 장군의 아들이다. 이 비밀을 아는 사람은 섭정뿐이다.', '왕위 계승자의 친부와 출생의 진실을 아는 이는?'],
	['미래 반역', '삼 년 뒤에 우현이 반역을 일으킨다. 현재의 우현과 동료들은 아직 그 사실을 모른다.', '우현의 훗날 배신을 지금 동료가 알고 있나?'],
	['서린의 버릇', '서린은 거짓말할 때 왼손 검지로 컵의 테두리를 두 번 두드린다.', '서린의 말을 믿어도 될지 알아볼 행동 단서는?'],
	['하린의 공포', '하린은 어린 시절 화재로 집을 잃었고, 불 냄새가 나면 손이 굳는다.', '타는 냄새 앞에서 하린의 몸이 얼어붙는 이유는?'],
	['귀환 조건', '검은 성에서 탈출하려면 세 개의 종을 해가 뜨기 전에 동시에 울려야 한다.', '검은 성 밖으로 나올 수 있는 시간과 조건은?'],
	['도윤과 마루', '도윤과 마루는 함께 자란 의형제다. 도윤은 마루를 동생처럼 챙긴다. [[마루의 원칙]]', '도윤에게 마루는 어떤 사이야?'],
	['동맹 파기', '서부 연맹은 식량 운송대가 습격당한 뒤 왕국과의 동맹을 끊었다.', '서쪽 연합이 왕국과 결별한 직접적인 사건은?'],
	['무기 약점', '적월검은 달빛 아래 강해지지만 비가 오면 칼날이 부서지기 쉽다.', '적월검을 상대할 때 어떤 날씨가 유리하지?'],
	['지하 도서관', '폐허의 우물 아래에는 금서가 모인 도서관이 있다. 매월 보름에만 문이 열린다.', '금지된 책을 찾을 장소와 입장 시기는?'],
	['시간의 대가', '시간을 한 번 되돌릴 때마다 시전자는 가장 소중한 기억 하나를 잃는다.', '시간 역행 마법에 어떤 희생이 필요하지?'],
	['하린의 말투', '하린은 긴장할수록 정중한 존댓말을 쓰며, 화가 나면 상대를 직함으로만 부른다.', '하린이 격분했을 때 호칭과 말투는?'],
	['마루의 목표', '마루가 왕궁에 들어온 목적은 실종된 누나를 찾는 것이다. 출세에는 관심이 없다.', '마루는 승진하려고 궁에 들어갔어?'],
	['빛의 제한', '빛 마법은 상처를 치료하지만 이미 죽은 사람을 되살릴 수는 없다.', '빛 계열 능력으로 망자를 부활시킬 수 있나?'],
	['항구의 밀수', '남쪽 항구에서는 붉은 돛을 단 배가 밤마다 마석을 밀수한다.', '마법 광물을 불법 운반하는 배를 어디서 어떻게 알아봐?'],
	['은화의 약속', '서린과 도윤은 헤어질 때 은화 반쪽씩을 나눠 가졌다. 다시 만나면 합치기로 했다.', '두 사람이 재회를 약속한 물건이 뭐였지?'],
	['스승의 유언', '스승은 서린에게 복수보다 살아남는 일이 중요하다는 말을 남겼다.', '서린의 스승은 원수를 갚는 것과 생존 중 뭘 중시했어?'],
	['장벽의 균열', '동쪽 장벽은 세 번째 겨울에 무너진다. 수리 기록에는 기초가 물에 잠겼다고 적혀 있다.', '동부 방어벽이 붕괴하는 때와 구조적 원인은?'],
	['열쇠 보관', '철제 열쇠는 여관 주인의 목걸이 안쪽에 숨겨져 있다.', '여관의 숨겨진 열쇠를 찾으려면 어디를 봐야 하지?'],
	['두 기록 충돌', '왕실 연대기는 전쟁이 봄에 시작됐다고 쓰지만 생존자의 일기는 첫눈이 내린 날이라고 적는다.', '전쟁 개시 시점에 기록들이 서로 일치해?'],
	['도윤의 음식', '도윤은 매운 음식을 못 먹지만 상대가 직접 차려 주면 티를 내지 않고 먹는다.', '매운 요리를 선물 받으면 도윤은 어떤 반응일까?'],
	['추격자의 표식', '추격자는 문 앞에 하얀 돌 세 개를 놓아 다음 목표를 표시한다.', '문간의 흰 돌 세 알은 어떤 위험 신호지?'],
	['마루의 사과', '마루는 잘못했을 때 변명하지 않고 망가진 물건부터 고친다. 말보다 행동으로 사과한다.', '실수한 마루는 용서를 어떻게 구할까?'],
	['마지막 유물', '마지막 유물의 위치는 사막 오아시스 아래 봉인된 방이다.', '이 긴 원정 기록의 맨 끝에서 밝혀진 유적의 최종 목적지는?'],
	['서린의 가족', '서린의 어머니는 북부 출신 약초상이고 아버지는 남부 출신 대장장이다.', '서린 부모님의 고향과 생업을 알려줘.'],
] as const;

(globalThis as any).ragFixtureOpen = [];
(globalThis as any).ragFixturePlots = [];
const notes = new Map(cases.map(([title, text], index) => [`작품/설정/${title}.md`, `${index === 28 ? '# 원정 일지\n' + '모래 바람이 지나갔다. 일행은 야영하고 식량을 점검했다.\n\n'.repeat(90) : ''}# ${title}\n${text}`]));
for (let i = 0; i < 55; i++) notes.set(`작품/본문/기록${i}.md`, `# 여행 기록 ${i}\n${['도윤은 시장에서 빵과 사과를 샀다. 상인의 수레가 큰길을 지나갔다.', '마루는 아침에 훈련장으로 향했다. 검과 창을 손질하고 방패를 닦았다.', '서린은 여관에서 쉬었다. 창밖에는 비가 내렸고 등불이 흔들렸다.', '하린은 궁궐의 만찬에 참석했다. 귀족들은 전쟁과 왕실 소문을 이야기했다.', '북쪽 숲의 순찰대는 산길에서 흔적을 발견했다. 병사들은 성으로 돌아왔다.'][i % 5]}`);
notes.set('다른작품/비밀.md', '다른 프로젝트 비밀의 주문'); notes.set('작품/스냅샷/폐기.md', '폐기된 금서 비밀'); notes.set('작품/.관리/비밀.md', '숨김 비밀');
const files = [...notes].map(([path, text]) => ({ path, basename: path.split('/').pop()!.slice(0, -3), stat: { mtime: 1, size: text.length } }));
const reads: string[] = [], audit: any[] = [];
const plugin = {
	settings: { aiChatAutoContext: true }, manifest: { id: 'writing-menu', dir: 'plugin' },
	register() {}, registerEvent() {}, projectContext: { getProjectForFile: (file: any) => file?.path?.startsWith('작품/') ? project : null },
	app: { metadataCache: { getFileCache(file: any) { return { links: [...(notes.get(file.path) ?? '').matchAll(/\[\[([^\]]+)\]\]/g)].map(match => ({ link: match[1] })) }; }, getFirstLinkpathDest(link: string) { return files.find(file => file.basename === link); } },
		vault: { configDir: '.obsidian', getMarkdownFiles: () => files.filter(file => notes.has(file.path)),
			read: async (file: any) => { reads.push(file.path); return notes.get(file.path)!; },
			adapter: {
				getResourcePath: () => 'synthetic-vault-only',
				read: async (path: string) => { const code = await (await fetch('/' + path.replace('plugin/', ''))).text(); return path.endsWith('rag-worker.js') ? `globalThis.process = {release:{name:'node'},versions:{node:'synthetic-electron'},platform:'win32',type:'worker'}; const savedFetch = globalThis.fetch; globalThis.fetch = (input,options) => { globalThis.postMessage({audit:{url:String(input),method:options?.method||'GET',body:options?.body}}); return savedFetch(input,options); };\n` + code : code; },
				readBinary: async (path: string) => (await fetch('/' + path.replace('plugin/', ''))).arrayBuffer(),
			},
		},
	},
} as any;
const NativeWorker = Worker;
(globalThis as any).Worker = class extends NativeWorker { constructor(...args: any[]) { super(args[0], args[1]); this.addEventListener('message', event => { if (event.data.audit) { audit.push(event.data.audit); event.stopImmediatePropagation(); } }); } };
const service = new RagIndexService(plugin);
let embedded = 0, queryEmbedded = 0; const originalEmbed = service.worker.embed.bind(service.worker);
service.worker.embed = async (...args) => { if (!args[1]) embedded++; else queryEmbedded++; return originalEmbed(...args); };
let beats = 0, lastBeat = performance.now(), maxBeatGap = 0; setInterval(() => { const now = performance.now(); maxBeatGap = Math.max(maxBeatGap, now - lastBeat); lastBeat = now; beats++; }, 25);
service.onChange(() => { (globalThis as any).ragProgress = service.status(project); });
(globalThis as any).ragRun = async () => {
	console.log('Preparing actual q8 E5/WASM model (public assets only)…');
	const installStart = performance.now(), beatsBeforeInstall = beats;
	await service.install(project);
	const installation = { milliseconds: Math.round(performance.now() - installStart), heartbeats: beats - beatsBeforeInstall, maxBeatGap: Math.round(maxBeatGap) };
	assert(installation.heartbeats > 0 && installation.maxBeatGap < 2000, 'Model installation blocked the renderer: ' + JSON.stringify(installation));
	console.log('Actual installation responsiveness', JSON.stringify(installation));
	await service.refresh(project);
	assert(service.status(project).state === 'ready', JSON.stringify(service.status(project)));
	await service.ensureComplete(project);
	const scope = await service.scope(project);
	let damaged: any;
	for await (const page of service.database.records(scope)) { damaged = page.find(item => item.source.title === '북문 암호'); if (damaged) break; }
	assert(damaged, 'Missing audit fixture record');
	await service.database.put('records', { ...damaged, vector: new Float32Array(1) });
	const beforeRepair = embedded; await service.ensureComplete(project);
	assert(embedded > beforeRepair, 'Actual model did not repair a damaged vector');
	const repaired = await service.database.get<any>('records', damaged.key);
	assert(repaired?.vector?.length === 384, 'Vector audit left an unusable index record');
	const cancelled = new AbortController(); cancelled.abort();
	let cancelledCleanly = false; try { await service.ensureComplete(project, cancelled.signal); } catch (error) { cancelledCleanly = (error as Error).name === 'AbortError'; }
	assert(cancelledCleanly, 'Completeness audit ignored cancellation');
	const hits = [], misses = [];
	for (const [title, , question] of cases) { const result = await service.search(project, question, undefined, 10, question, false, 'hybrid'); const found = result.sources.some(source => source.path === `작품/설정/${title}.md`); hits.push({ question, expected: title, rank: result.sources.findIndex(source => source.path === `작품/설정/${title}.md`) + 1, retrieved: result.sources.map(source => source.title) }); if (!found) misses.push(title); if (title === '마지막 유물') assert(result.sources.some(source => source.path?.includes(title) && source.text.includes('오아시스')), 'Long-note tail source was not retrieved'); }
	const initial = embedded; await service.refresh(project); assert(embedded === initial, 'Unchanged documents were re-embedded');
	const beforeKeyword = queryEmbedded;
	const exact = await service.tools(project, true).execute({ name: 'search_sources', args: { query: '검은 뱀 해독', mode: 'keyword' } });
	assert(exact.sources.some(source => source.path?.endsWith('독의 해독.md')), 'Actual IDB keyword mode missed exact terms');
	assert(queryEmbedded === beforeKeyword, 'Keyword-only search embedded the query');
	const meaning = await service.search(project, cases[15][1], undefined, 8, cases[15][1], true, 'semantic');
	assert(meaning.sources.some(source => source.path?.endsWith('시간의 대가.md')) && queryEmbedded > beforeKeyword, 'Actual E5 semantic-only mode failed');
	const retrievalDiagnostics = [];
	for (const title of misses) {
		const question = cases.find(item => item[0] === title)![2], query = await service.worker.embed(question, true), candidates: Array<{ title: string; score: number }> = [];
		for await (const page of service.database.records(scope)) for (const record of page) if (record.vector) candidates.push({ title: record.source.title, score: record.vector.reduce((sum, value, index) => sum + value * query[index], 0) });
		candidates.sort((a, b) => b.score - a.score);
		retrievalDiagnostics.push({ expected: title, denseRank: candidates.findIndex(item => item.title === title) + 1, top: candidates.slice(0, 10) });
	}
	console.log('Retrieval diagnostics', JSON.stringify(retrievalDiagnostics));
	const requestsBeforeOffline = audit.length; service.worker.dispose(); await service.worker.prepare(false); await service.worker.embed('의형제의 관계', true); assert(audit.length === requestsBeforeOffline, 'Offline model initialization accessed network');
	const changed = files.find(file => file.basename === '마루의 원칙')!; notes.set(changed.path, '# 원칙\n마루는 민간인을 지킨다. 새로운 암호는 보랏빛 강이다.'); changed.stat.mtime++; await service.refresh(project); assert(embedded > initial, 'Changed document not re-embedded');
	const result = await service.search(project, '마루의 새로운 암호'); const source = result.sources.find(item => item.path === changed.path)!; assert(source?.text.includes('보랏빛'), 'Latest edit missing');
	const tools = service.tools(project);
	const firstRead = await tools.execute({ name: 'read_source', args: { source_id: source.id } });
	await tools.execute({ name: 'read_source', args: { source_id: firstRead.sources[0].id } });
	for (const call of [{ name: 'write_file', args: {} }, { name: 'read_source', args: { source_id: '../다른작품/비밀.md' } }]) { let blocked = false; try { await tools.execute(call); } catch { blocked = true; } assert(blocked, 'Unsafe tool access succeeded'); }
	const linked = (await service.search(project, '도윤과 마루의 의형제 관계')).sources.find(item => item.path?.endsWith('도윤과 마루.md'))!;
	const related = await tools.execute({ name: 'related_sources', args: { source_id: linked.id } }); assert(related.sources.some(item => item.path === changed.path), 'Wiki expansion missing');
	notes.delete(changed.path); await service.refresh(project); let deleted = false; try { await tools.execute({ name: 'read_source', args: { source_id: source.id } }); } catch { deleted = true; } assert(deleted, 'Deleted source readable');
	service.pause(project); await service.refresh(project); assert(service.status(project).state === 'ready', 'Resume failed');
	// Pause after a committed chunk but before the document checkpoint; resume must reuse it.
	notes.set('작품/설정/취소 점검.md', '# 취소 점검\n취소와 복구를 위한 새 구간이다.'); files.push({ path: '작품/설정/취소 점검.md', basename: '취소 점검', stat: { mtime: 1, size: 32 } });
	const originalPut = service.database.put.bind(service.database); let paused = false;
	service.database.put = async (store, value: any) => { await originalPut(store, value); if (!paused && store === 'records' && value.source.title === '취소 점검') { paused = true; service.pause(project); } };
	await service.refresh(project); assert(service.status(project).state === 'paused', 'Index pause was ignored'); const afterPause = embedded;
	await service.refresh(project); assert(service.status(project).state === 'ready' && embedded === afterPause, 'Partial checkpoint was lost or recomputed'); service.database.put = originalPut;
	notes.set('작품/설정/공간 점검.md', '# 공간 점검\n디스크 부족은 숨기지 않는다.'); files.push({ path: '작품/설정/공간 점검.md', basename: '공간 점검', stat: { mtime: 1, size: 30 } });
	service.database.put = async (store, value: any) => { if (store === 'records' && value.source.title === '공간 점검') throw new DOMException('기기 저장 공간 부족', 'QuotaExceededError'); return originalPut(store, value); };
	await service.refresh(project); assert(service.status(project).state === 'error' && service.status(project).message?.includes('저장 공간'), 'Storage exhaustion was hidden'); service.database.put = originalPut; await service.refresh(project); assert(service.status(project).state === 'ready', 'Storage failure recovery failed');
	const secondPlugin = { ...plugin, app: { ...plugin.app, vault: { ...plugin.app.vault, adapter: { ...plugin.app.vault.adapter, getResourcePath: () => 'another-vault' } } } };
	assert(await service.scope(project) !== await new RagIndexService(secondPlugin).scope(project), 'Vault indices were shared');
	assert(!reads.some(path => path.startsWith('다른작품/') || path.includes('/스냅샷/') || path.includes('/.관리/')), 'Excluded corpus was read');
	assert(audit.every(item => item.method === 'GET' && !item.body && item.url.startsWith('https://huggingface.co/Xenova/multilingual-e5-small/resolve/')), 'Non-public embedding request detected');
	assert(beats > 20, 'Main thread unresponsive');
	console.log('Actual model evaluation', JSON.stringify({ recall: (30 - misses.length) / 30, misses, chunks: service.status(project).chunks, embedded, heartbeats: beats, downloads: audit.length }));
	// Exercise the new v3 stores and inverted index in actual IndexedDB, with the real cached E5 model.
	const characterPath = '작품/인물/마루.md'; notes.set(characterPath, '# 인물\n마루는 흩어진 시민을 찾아 보호하는 인물이다.');
	files.push({ path: characterPath, basename: '마루', stat: { mtime: 1, size: notes.get(characterPath)!.length } });
	await service.refresh(project);
	const study = await service.research(project, '마루의 전체 행적을 정리해줘', 100000);
	assert(study.coverage.matchedDocuments > 5 && !study.coverage.partial, 'Actual IDB history investigation missed explicit appearances');
	let ledgerWrites = 0; service.database.put = async (store, value: any) => { if (store === 'research') ledgerWrites++; return originalPut(store, value); };
	await service.research(project, '마루의 행적 정리', 100000); service.database.put = originalPut;
	assert(ledgerWrites === 0, 'Actual IDB ledger cache was not reused');
	let lexicalMatches = 0; for await (const page of service.database.matchingRecords(scope, ['시민'])) lexicalMatches += page.length;
	assert(lexicalMatches > 0, 'Actual IDB inverted term index returned no matching source');
	console.log('Appearance memory cache reuse and legacy inverted BM25 term lookup passed');
	// Deliberately no model for this separate structural test: lexical fallback must not retain the old corpus caps.
	const largeFiles = Array.from({ length: 1502 }, (_, index) => ({ path: `대형/기록${index}.md`, basename: `기록${index}`, stat: { mtime: 1, size: 4000 } }));
	const hugeText = '일반 기록. '.repeat(1_000_000) + '\n끝부분유일암호 자수정비늘\n';
	const tail = { path: '대형/긴 원고.md', basename: '긴 원고', stat: { mtime: 1, size: hugeText.length } }; largeFiles.push(tail);
	const largeProject = { ...project, rootFolder: '대형' }, filler = '관련 없는 문장. '.repeat(500);
	const largePlugin = { ...plugin, projectContext: { getProjectForFile: () => largeProject }, app: { ...plugin.app, vault: { ...plugin.app.vault, getMarkdownFiles: () => largeFiles, read: async (file: any) => file === tail ? hugeText : filler } } };
	const large = new RagIndexService(largePlugin as any); large.worker.embed = async () => { throw new Error('Structural fallback test: intentionally uninstalled'); };
	const end = await large.search(largeProject, '끝부분유일암호 자수정비늘'); assert(end.sources.some(source => source.path === tail.path && source.text.includes('자수정비늘')), 'Old file/character caps still omit late sources');
	return { installation, evaluationMode: 'explicit hybrid', hits, misses, recall: (30 - misses.length) / 30, status: service.status(project), heartbeats: beats, audit, research: study.coverage, structuralLargeCorpus: { files: largeFiles.length, lastSourceCharacters: hugeText.length, passed: true } };
};
