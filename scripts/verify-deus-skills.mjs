import { loadTsFixture } from './ts-fixture-loader.mjs';
// Synthetic project and responses only. No keys, network, or real vault writes.
import assert from 'node:assert/strict';
const load = loadTsFixture;
const skills = await load('src/aichat/DeusSkills.ts'), prompt = await load('src/aichat/AiChatPrompt.ts'), stream = await load('src/aichat/ChatStream.ts');
// Flash Lite has emitted each of these instead of the requested [C1] syntax.
const plotSource = { id: `plot:Test:sheet-main:row-one:1:0#${'a'.repeat(64)}`, title: 'Test / 메인 플롯 / 2행', kind: 'plot', path: 'Test/원고.md', text: '복선 (미회수): 수수께끼의 전화와 소문' };
for (const content of [
	`수수께끼 [C1]`, `수수께끼 C1`, `수수께끼 C1.`, `[${plotSource.title}]`, `[[${plotSource.title}]]`,
	`[${plotSource.title}](${plotSource.id})`, `[복선](<${plotSource.id}>)`, `[${plotSource.id}](source)`,
	`[[${plotSource.id}|복선]]`, `[${plotSource.id}]`, plotSource.id, `<${plotSource.id}>`,
	`[복선](${encodeURIComponent(plotSource.id)})`, `[1:0#${'a'.repeat(64)}]`,
]) {
	const normalized = prompt.normalizeDeusAnswer(content, [plotSource]);
	assert.equal(normalized.citations.length, 1, 'Plot reference was not bound: ' + content);
	assert.equal(normalized.citations[0].sourceId, plotSource.id);
	assert(!normalized.content.includes('plot:') && !normalized.content.includes('a'.repeat(32)), 'Internal ID leaked: ' + content);
	assert(!normalized.content.includes('](') && !normalized.content.includes('[['), 'Plot reference retained provider link syntax');
	assert.equal(prompt.prepareDeusMarkdown({ role: 'assistant', content, timestamp: 0 }, [plotSource]).references.length, 1, 'Saved response was not repaired for display');
}
const plotQuestion = { role: 'user', content: '미회수 복선은?', context: { version: 1, sources: [plotSource], warnings: [] } };
assert(!prompt.formatChatMessage(plotQuestion).includes(plotSource.id), 'Raw plot IDs were sent to the model');
const ambiguousPlots = [plotSource, { ...plotSource, id: plotSource.id.replace('row-one', 'row-two') }];
assert.equal(prompt.normalizeDeusAnswer(`[${plotSource.title}]`, ambiguousPlots).citations.length, 0, 'Duplicate plot titles bound an arbitrary row');
assert.equal(prompt.normalizeDeusAnswer('[복선](plot:Test:sheet-main:row-missing)', [plotSource]).citations.length, 0, 'Unknown plot row became actionable');
assert.equal(prompt.normalizeDeusAnswer('`C1` and `'+plotSource.id+'`', [plotSource]).citations.length, 0, 'Code examples became citations');
for (const text of ['[외부 링크](https://example.com/C1)', '[링크 C1](https://example.com)', 'https://example.com/?q=C1', '![그림](https://example.com/image.png)']) {
	const result = prompt.normalizeDeusAnswer(text, [plotSource]);
	assert.equal(result.citations.length, 0, 'An external URL became a source reference');
	assert.equal(result.content, text.startsWith('!') ? '그림' : text);
}
const { deusPlotLocation } = await load('src/aichat/DeusPlotNavigation.ts');
const { deusCitationLeaf } = await load('src/aichat/DeusCitationLeaf.ts');
const rootPlotLeaf = { view: { navigation: false } }, leafModes = [];
const citationWorkspace = { getMostRecentLeaf: () => rootPlotLeaf, getLeaf: mode => { leafModes.push(mode); return { newLeaf: true }; } };
assert.equal(deusCitationLeaf(citationWorkspace, 'current'), rootPlotLeaf, 'Current-tab citation opened a new tab for a custom plot view');
assert.equal(deusCitationLeaf(citationWorkspace), rootPlotLeaf);
assert.equal(leafModes.length, 0, 'Existing root tab was passed through the navigable-only leaf API');
assert(deusCitationLeaf(citationWorkspace, 'tab').newLeaf); assert.deepEqual(leafModes, ['tab']);
citationWorkspace.getMostRecentLeaf = () => null; assert(deusCitationLeaf(citationWorkspace, 'current').newLeaf); assert.deepEqual(leafModes, ['tab', false]);
assert.deepEqual(deusPlotLocation(plotSource, 'Test'), { sheetId: 'sheet-main', rowId: 'row-one', columnRole: 'foreshadow' });
assert.deepEqual(deusPlotLocation({ ...plotSource, id: plotSource.id + ':read:20:history:H1_1' }, 'Test'), { sheetId: 'sheet-main', rowId: 'row-one', columnRole: 'foreshadow' });
assert.deepEqual(deusPlotLocation({ ...plotSource, text: '플롯: 수수께끼의 전화가 걸려온다.' }, 'Test'), { sheetId: 'sheet-main', rowId: 'row-one' });
assert.deepEqual(deusPlotLocation({ ...plotSource, text: '플롯: 복선에 관한 대화다.\n\n복선 (회수): 전화의 정체' }, 'Test', '복선 (회수): 전화의 정체'), { sheetId: 'sheet-main', rowId: 'row-one', columnRole: 'foreshadow' });
assert.equal(deusPlotLocation(plotSource, 'Test', '수수께끼의 전화와 소문').columnRole, 'foreshadow', 'A foreshadow title quote lost its column without the field header');
assert.equal(deusPlotLocation({ ...plotSource, text: '플롯: 전화의 정체\n\n복선 (미회수): 전화의 정체' }, 'Test', '전화의 정체').columnRole, undefined, 'An ambiguous quote was assigned to a column');
assert.equal(deusPlotLocation({ ...plotSource, text: '플롯: 복선에 관한 대화다.\n\n복선 (미회수): 전화의 정체' }, 'Test', '플롯: 복선에 관한 대화다.').columnRole, undefined, 'A non-foreshadow quote selected the foreshadow column');
assert.equal(deusPlotLocation(plotSource, 'Other'), undefined);
assert.equal(deusPlotLocation({ ...plotSource, kind: 'reference' }, 'Test'), undefined);
assert.equal(deusPlotLocation({ ...plotSource, id: 'plot:Test:sheet-only' }, 'Test'), undefined);
const { PlotWorkbookView } = await load('src/plot-workbook/PlotWorkbookView.ts', {
	obsidian: { ItemView: class {} }, './InfinitePlotSheet': {}, './PlotWorkbookSession': {}, './PlotWorkbookSessionStore': {}, './PlotWorkbookToolbar': {}, './PlotWorkbookSheetTrashModal': {},
});
const plotSheet = { sheetId: 'sheet-main', rowOrder: ['row-other', 'row-one'], columnOrder: ['text', 'plot'], rows: { 'row-one': { collapsed: true } }, columns: { text: { role: 'text' }, plot: { role: 'plot', collapsed: true } } };
const plotSelections = [], plotSession = { sheets: new Map([[plotSheet.sheetId, plotSheet]]), manifest: { activeSheetId: 'sheet-other' }, activeSheet: plotSheet,
	selectSheet: async id => { plotSession.manifest.activeSheetId = id; }, setRowCollapsed: (id, value) => { plotSheet.rows[id].collapsed = value; }, setColumnCollapsed: (id, value) => { plotSheet.columns[id].collapsed = value; } };
const plotView = { session: plotSession, render: () => {}, sheetView: { select: (...args) => plotSelections.push(args), revealSelected: () => {}, focus: () => {} }, revealForeshadowLocation: PlotWorkbookView.prototype.revealForeshadowLocation };
assert.equal(await PlotWorkbookView.prototype.revealCell.call(plotView, 'sheet-main', 'row-one'), true);
assert.equal(plotSession.manifest.activeSheetId, 'sheet-main'); assert.deepEqual(plotSelections[0], [1, 1, false]);
assert(!plotSheet.rows['row-one'].collapsed && !plotSheet.columns.plot.collapsed, 'Plot citation remained hidden in a folded row or column');
assert.equal(await PlotWorkbookView.prototype.revealCell.call(plotView, 'sheet-main', 'missing'), false);
assert.equal(await PlotWorkbookView.prototype.revealCell.call(plotView, 'missing', 'row-one'), false);
assert.equal(plotSelections.length, 1, 'Missing plot row selected an unrelated cell');
plotSheet.columnOrder.push('foreshadow'); plotSheet.columns.foreshadow = { role: 'foreshadow', collapsed: true };
assert.equal(await PlotWorkbookView.prototype.revealCell.call(plotView, 'sheet-main', 'row-one', undefined, 'foreshadow'), true);
assert.deepEqual(plotSelections.at(-1), [1, 2, false], 'Foreshadow citation selected the plot or first column');
assert(!plotSheet.columns.foreshadow.collapsed, 'Foreshadow citation did not expand the selected column');
plotSheet.columnOrder = ['foreshadow', 'text', 'plot'];
await PlotWorkbookView.prototype.revealCell.call(plotView, 'sheet-main', 'row-one', undefined, 'foreshadow');
assert.deepEqual(plotSelections.at(-1), [1, 0, false], 'Foreshadow tracking depended on a fixed column index');
await PlotWorkbookView.prototype.revealCell.call(plotView, 'sheet-main', 'row-one', 'text', 'foreshadow');
assert.deepEqual(plotSelections.at(-1), [1, 1, false], 'Preferred role overrode an exact cell location');
delete plotSheet.columns.foreshadow; plotSheet.columnOrder = ['text', 'plot'];
await PlotWorkbookView.prototype.revealCell.call(plotView, 'sheet-main', 'row-one', undefined, 'foreshadow');
assert.deepEqual(plotSelections.at(-1), [1, 1, false], 'Missing foreshadow column broke the existing plot fallback');
const cast = [{ path: 'Story/인물/아린.md', name: '아린' }, { path: 'Story/인물/도윤.md', name: '도윤' }];
assert.deepEqual(skills.parseDeusCommand('/character'), {skill:'character',question:''});
assert.deepEqual(skills.parseDeusCommand('/Character 지금 장면의 대화'), {skill:'character',question:'지금 장면의 대화'});
assert.equal(skills.parseDeusCommand('/characteristic'), undefined);
assert.deepEqual(skills.DEUS_SKILLS.map(skill=>skill.command),['character']);
for(const command of ['research','description','dialogue','rewrite','조사','대사'])assert.equal(skills.parseDeusCommand('/'+command),undefined,'Retired slash command remains active');
const active = skills.resolveDeusIntent('지금 상황에 맞는 대화가 뭘까?', 'auto', cast);
assert.equal(active.skill, 'character'); assert.equal(active.scene, 'active');
const explicit = skills.resolveDeusIntent('아린과 도윤이 우주선에서 말다툼하는 역할극을 보여줘', 'auto', cast);
assert.equal(explicit.skill, 'character'); assert.equal(explicit.scene, 'explicit'); assert.equal(explicit.participants.length, 2);
assert.equal(skills.resolveDeusIntent('아린과 도윤의 관계', 'auto', cast).skill, 'research');
assert.equal(skills.resolveDeusIntent('이 장면 묘사해줘', 'auto', cast).skill, 'description');
assert.equal(skills.resolveDeusIntent('선택문 문장을 다듬어줘', 'auto', cast).skill, 'rewrite');
assert.equal(skills.resolveDeusIntent('/대사 아린에게 어울리는 인사', 'auto', cast).skill, 'dialogue');
assert.equal(skills.resolveDeusIntent('현재 장면에 맞는 대화', 'research', cast).skill, 'research');
assert.equal(skills.resolveDeusIntent('지금 상황에 맞는 대화', 'auto', cast, [cast[0]]).scene, 'active');
const dialogue = skills.parseDeusDialogue('[지문]\n아린은 고개를 들었다.\n[인물: 아린]\n왔어?\n[인물: 도윤]\n기다렸어?\n[인물: 아린]\n조금.');
assert.deepEqual(dialogue.map(item => item.name), [undefined, '아린', '도윤', '아린']);
const legacyDialogue = skills.parseDeusDialogue('[지문]\n고개를 끄덕이며 자료를 넘기던 아린이 잠시 손을 멈췄다.\n\n[대사]\n"아, 저 역이라면 제가 해보고 싶긴 한데요."\n[지문]\n아린은 잠시 생각했다.\n[대사]\n"가능할까요?"', '아린');
assert.deepEqual(legacyDialogue.map(item => item.type), ['narration','dialogue','narration','dialogue']);
assert(legacyDialogue.every(item => item.name === '아린' && !item.text.includes('[대사]')), 'Legacy dialogue was swallowed by narration');
assert.deepEqual(skills.parseDeusDialogue('[인물: 아린]\n왔어?\n[지문]\n아린은 고개를 들었다.\n[대사]\n기다렸어.').map(item=>item.name), ['아린','아린','아린']);
const lite = skills.parseDeusDialogue('*문이 열렸다.*\n\n- **아린:** "기다렸어?"\n\n*도윤이 고개를 들었다.*\n\n**도윤**: 왔구나.', undefined, cast.map(person=>person.name));
assert.deepEqual(lite.filter(turn=>turn.type==='dialogue').map(turn=>turn.name),['아린','도윤']);
assert(lite.every(turn=>!/^[-*•]\s/.test(turn.text)), 'Character Markdown list syntax leaked into bubbles');
assert.deepEqual(skills.parseDeusDialogue('[지문] 문이 열렸다.\n[대사: 아린] - 왔어?').map(turn=>turn.type),['narration','dialogue']);
assert.equal(skills.resolveDeusIntent('조금 더 날카롭게', 'character', cast, cast).scene,'active', 'Remembered cast alone selected a hypothetical scene');
assert.deepEqual(skills.resolveDeusIntent('도윤의 역할극', 'character',cast,[cast[0]]).participants,[cast[1]], 'Old cast contaminated a new explicit scene');
assert(skills.deusSkillInstructions(explicit).includes('열려 있는 원고나 이전 장면을 현재 상황으로 끌어오지'));
class TFile { constructor(path) { this.path = path; this.basename = path.split('/').at(-1).replace(/\.md$/, ''); } }
const files = ['Story/10화.md', ...cast.map(person => person.path), 'Other/인물/다른인물.md'].map(path => new TFile(path));
const texts = new Map(files.map(file => [file.path, file.basename + '의 디스크 설정']));
const document = { path: files[0].path, file: files[0], read: () => '아린이 문을 열었다. 저장 전 장면.', editor: { getSelection: () => '' } };
const project = { rootFolder: 'Story', characterFolder: 'Story/인물' };
const rows = [{ id: 'linked', path: document.path, kind: 'plot', title: '10행', text: '등장인물: 아린, 도윤. 계획된 화해.', characterPaths: cast.map(person => person.path), automatic: true }, { id: 'unrelated', path: 'Story/11화.md', kind: 'plot', title: '11행', text: 'FUTURE_PLOT', characterPaths: [files[3].path] }];
const plugin = { settings: { aiChatPersonaHeading: '' }, projectContext: { getProjectForFile: file => file && ({ rootFolder: file.path.startsWith('Story/') ? 'Story' : 'Other' }) }, app: { vault: { getAbstractFileByPath: path => files.find(file => file.path === path), getMarkdownFiles: () => files, read: async file => texts.get(file.path) } } };
const { collectDeusScene } = await load('src/aichat/DeusSceneContext.ts', { obsidian: { TFile }, './AiChatPlotKnowledge': { readChatPlotPassages: async (_plugin,_project,_character,_document,selection) => selection ? rows.filter(row=>row.id==='linked') : rows }, './AiChatContext': { extractPersonaContent: text => text }, './ChatStream': stream, '../wiki/wikiProfileUtils': { getWikiDisplayName: (_app, _plugin, file) => file.basename } });
const result = await collectDeusScene(plugin, project, active, document, [{ path: cast[1].path, read: () => '저장 전 도윤 설정' }], new Set());
assert(result.sources.some(source => source.text === document.read()));
assert(result.sources.some(source => source.id === 'linked'));
assert(!result.sources.some(source => source.text.includes('FUTURE_PLOT')));
assert.deepEqual(result.participants, cast);
assert(result.sources.some(source => source.text === '저장 전 도윤 설정'));
const planning = await collectDeusScene(plugin,project,active,document,[],new Set(),undefined,{projectRoot:'Story',sheetId:'main',rowIds:['linked']});
assert(planning.sources.some(source=>source.id==='linked') && !planning.sources.some(source=>source.kind==='document'), 'Selected plot scene inherited a stale manuscript');
assert.deepEqual(planning.participants,cast);
const custom = await collectDeusScene(plugin, project, explicit, document, [], new Set());
assert.equal(custom.sources.length, 2); assert(custom.sources.every(source => source.kind === 'character'), 'Explicit scenario inherited current manuscript or plot');
const removed = await collectDeusScene(plugin, project, active, document, [], new Set(['deus-active:' + document.path]));
assert.equal(removed.sources.length, 0, 'Excluded active note still admitted linked automatic material');
const castRemoved = await collectDeusScene(plugin, project, active, document, [], new Set(['deus-cast:' + cast[0].path]));
assert(!castRemoved.sources.some(source => source.path === cast[0].path));
assert(!castRemoved.participants.some(person => person.path === cast[0].path));
const cross = await collectDeusScene(plugin, project, { ...explicit, participants: [{ path: files[3].path, name: '다른인물' }] }, document, [], new Set());
assert.equal(cross.sources.length, 0, 'Cross-project character settings leaked');

// Actual failure pattern: old [69] and current C1, with a second old [69] using another source.
const oldSources = Array.from({ length: 70 }, (_, i) => ({ id: 'old-' + i, title: '과거 자료 ' + i, text: '과거 원문 ' + i + ' HISTORICAL_BODY', path: 'Story/' + i + '.md', automatic: true }));
const first = { role: 'user', content: '회차별 행적', context: { version: 1, projectRoot: 'Story', sources: oldSources, warnings: [] } };
const firstAnswer = { role: 'assistant', content: '칸 진출을 이야기했다.[69]', citations: [{ number: 69, sourceId: 'old-68', quote: '', kind: 'reference' }] };
const second = { role: 'user', content: '별도 질문', context: { version: 1, projectRoot: 'Story', sources: [{ ...oldSources[0], id: 'different', text: '다른 원문' }], warnings: [] } };
const secondAnswer = { role: 'assistant', content: '다른 사건.[69]', citations: [{ number: 69, sourceId: 'different', quote: '', kind: 'reference' }] };
const current = { id: 'now', role: 'user', content: '다음 전개 추천', context: { version: 1, projectRoot: 'Story', sources: [{ id: 'current', title: '현재 자료', text: '지금 원문', automatic: true }], warnings: [] } };
const history = [first, firstAnswer, second, secondAnswer, current], original = JSON.stringify(history);
const projected = prompt.prepareChatHistory(history, current), historical = prompt.historicalChatCitations(history, current);
assert(projected[1].content.includes('[H1_69]')); assert(projected[3].content.includes('[H2_69]'));
assert(!projected.slice(0, -1).map(message => prompt.formatChatMessage(message)).join('\n').includes('HISTORICAL_BODY'));
assert.equal(JSON.stringify(history), original, 'Projected citations mutated saved conversation');
const oldActive = { ...first, context: { ...first.context, sources: [{ id: 'deus-active:Story/10화.md', kind: 'document', automatic: true, text: 'OLD_ACTIVE_BODY', title: '10화' }] } };
assert(!JSON.stringify(prompt.prepareChatHistory([oldActive, current], current)).includes('OLD_ACTIVE_BODY'), 'Previous automatic active-note body was replayed');
const sources = [...current.context.sources];
const normalized = prompt.normalizeDeusAnswer('과거 이야기 [H1_69]. 현재 [C1]. 다른 사건 [H2_69, H1_69].', sources, historical);

assert.equal(sources.length, 3, 'Unreferenced historical bodies were copied');
assert.deepEqual(normalized.citations.map(item => item.sourceId), ['old-68', 'current', 'different']);
assert(!normalized.content.includes('[H')); assert(!normalized.unresolved);
const invalid = prompt.normalizeDeusAnswer('알 수 없는 출처 [H9_69]', [...current.context.sources], historical);
assert.equal(invalid.citations.length,0,'Unknown source was assigned to an arbitrary note');
assert.equal(prompt.historicalChatCitations(history, { ...current, context: { ...current.context, projectRoot: 'Other' } }).length, 0);




const quota = await load('src/aichat/ChatQuotaError.ts');
const apiErrors = await load('src/aichat/GeminiApiError.ts', { './ChatQuotaError': quota });
let calls = [], responses = [];
const rag = await load('src/aichat/GeminiRagApi.ts', { obsidian: { requestUrl: async options => { calls.push(JSON.parse(options.body)); const text = responses.shift(); assert(text, 'Unexpected extra API call'); return { status: 200, json: { candidates: [{ content: { parts: [{ text }] } }] } }; } }, './AiChatPrompt': prompt, './ChatStream': stream, './GeminiApiError': apiErrors });
const { AiChatRequest } = await load('src/aichat/AiChatRequest.ts', { './AiChatApi': { callAiChat: () => { throw Error('Unexpected provider'); } }, './AiChatPrompt': prompt, './AiChatContext': { parseAssistantSegments: text => [{ type: 'dialogue', text }] }, './ChatStream': stream, './GeminiRagApi': rag, './ChatQuotaError': quota, './GeminiApiError': apiErrors });
globalThis.window = globalThis;
let saved, state;
const request = new AiChatRequest({ save: async session => { saved = structuredClone(session); } });
const session = { id: 'deus-history', title: '합성 대화', mode: 'deus', characterPath: '', projectRoot: 'Story', messages: structuredClone(history.slice(0, -1)) };
const userNow = structuredClone(current); userNow.skill = 'research'; responses = ['과거의 제안 [H1_69]. 현재 설정 [C1]. 별도 사건 [H2_69].'];
const options = { keys: { gemini: 'fake-only' }, model: 'gemini-3.5-flash-lite', maxTokens: 1000, historyTurns: 0, stream: false };
await request.send(session, userNow, async () => '합성 테스트', options, value => state = value);
assert.equal(state.status, 'complete'); assert.equal(calls.length, 1, 'Citation repair triggered another API generation');
assert.equal(saved.messages.at(-1).citations.length, 3);
assert.equal(saved.messages.at(-2).context.sources.length, 3, 'Historical source binding was not persisted with this question');
assert(!JSON.stringify(calls[0]).includes('HISTORICAL_BODY'), 'Historical source bodies replayed into the API');
assert(JSON.stringify(calls[0]).includes('H1_69') && JSON.stringify(calls[0]).includes('H2_69'));
const creativeSession = { id: 'creative', title: '역할극', mode: 'deus', characterPath: '', projectRoot: 'Story', messages: [] };
responses = ['[인물: 아린]\n여기까지 왔구나.\n[인물: 도윤]\n기다리게 해서 미안.'];
await request.send(creativeSession, { ...structuredClone(current), id: 'creative-q', skill: 'character', participants: cast }, async () => skills.deusSkillInstructions(explicit), options, value => state = value);
assert.equal(state.status, 'complete', 'Original creative dialogue was blocked for missing factual citations');
assert.equal(creativeSession.messages.at(-1).skill, 'character'); assert.deepEqual(creativeSession.messages.at(-1).participants, cast);
const ordinarySession={id:'ordinary',title:'일반 질문',mode:'deus',characterPath:'',projectRoot:'Story',skill:'character',messages:[]};
const received='[지문]\n화면 너머로 행적 목록이 정렬된다.\n[대사]\n제공된 자료로 행적을 정리합니다. [C999]\n\n> 새로 작성한 설명입니다.';
responses=[received];const callsBefore=calls.length;
await request.send(ordinarySession,{...structuredClone(current),id:'ordinary-q',skill:'research'},async()=>skills.deusSkillInstructions({...active,skill:'research'}),options,value=>state=value);
assert.equal(state.status,'complete','Citation lookup blocked a received response');assert.equal(calls.length,callsBefore+1,'Formatting caused an extra generation');
const ordinaryReply=ordinarySession.messages.at(-1);
assert.equal(ordinaryReply.role,'assistant');assert.equal(ordinaryReply.status,'complete');assert.equal(ordinaryReply.segments,undefined);assert.equal(ordinaryReply.citations.length,0);
assert(!ordinaryReply.content.includes('[지문]')&&!ordinaryReply.content.includes('[대사]')&&!ordinaryReply.content.includes('화면 너머'),'Ordinary response retained roleplay filler');
assert(ordinaryReply.content.includes('행적을 정리합니다.')&&ordinaryReply.content.includes('새로 작성한 설명입니다.'));
assert(!('responseDraft' in ordinarySession.messages[0]),'Received answer stayed attached to its question');
console.info('PASS Deus automatic/explicit skills, linked row/cast context, unsaved notes, exclusions, project scope, character turns and end-to-end historical citation collision regression. Synthetic API only.');
