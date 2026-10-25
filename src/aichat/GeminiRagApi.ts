import { wmT } from '../i18n/index';
import { requestUrl } from 'obsidian';
import type { AiChatMessage, ChatContextItem } from './AiChatTypes';
import type { RagToolCall, RagTools } from './rag/RagTypes';
import { formatChatMessage, prepareChatHistory, sourceEvidenceDelta, historicalChatCitations } from './AiChatPrompt';
import { checkChatAbort, abortableChat, readChatSse } from './ChatStream';
import { geminiApiError } from './GeminiApiError';
import { requestGeminiStream } from './GeminiTransport';
import { resolveGeminiThinking } from './GeminiThinking';

export interface GeminiUsage { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number }
export interface GeminiPart { text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: Record<string, unknown> }; [key: string]: unknown }
export interface GeminiContent { role: string; parts: GeminiPart[] }
export interface GeminiStep { parts: GeminiPart[]; text: string; calls: RagToolCall[]; usage?: GeminiUsage }
export interface DeusGenerationInput { system: string; contents: GeminiContent[]; tools: unknown[]; forceSearch: boolean; maxTokens: number }
export type DeusGenerator = (input: DeusGenerationInput, signal?: AbortSignal, onText?: (text: string) => void) => Promise<GeminiStep>;
const declarations = [
	{ name: 'list_sources', description: '프로젝트 전체의 자료 목록을 페이지별로 조회합니다. 전체 인물·설정 목록 질문에 사용하세요. next_offset이 있으면 다음 페이지를 조회하세요.', parameters: { type: 'OBJECT', properties: { offset: { type: 'INTEGER' }, kind: { type: 'STRING', enum: ['character', 'plot', 'reference'] } } } },
	{ name: 'search_sources', description: 'Obsidian API로 프로젝트 본문·인물·설정·플롯을 검색합니다. 인물 이름·별칭·관련 용어로 찾고, 부족하면 다른 표현으로 검색하세요. 검색된 원문의 앞뒤는 read_source로 확인하세요.', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, mode: { type: 'STRING', enum: ['keyword'] } }, required: ['query'] } },
	{ name: 'read_source', description: 'source_id의 원문을 최대 6000자 읽습니다. offset은 발췌 시작에서 뒤로 이동할 글자 수(기본 0), before는 그 위치 앞에서 함께 읽을 글자 수(0~2000, 기본 0)입니다. 대명사·원인·앞뒤 문맥 확인에 사용하세요.', parameters: { type: 'OBJECT', properties: { source_id: { type: 'STRING' }, offset: { type: 'INTEGER' }, before: { type: 'INTEGER' } }, required: ['source_id'] } },
	{ name: 'related_sources', description: 'source_id에서 명시된 위키 링크·등장 인물·연결 원고를 따라갑니다. hops는 1(기본) 또는 2, query는 관련 문서 안에서 찾을 내용입니다. 최대 96개 문서를 탐색해 8개 구간을 반환합니다. 연결 자체는 인물 관계·사건의 증거가 아니므로 원문으로 판단하세요.', parameters: { type: 'OBJECT', properties: { source_id: { type: 'STRING' }, query: { type: 'STRING' }, hops: { type: 'INTEGER' } }, required: ['source_id'] } },
];
export interface GeminiRagOptions {
	key: string; model: string; system: string; history: AiChatMessage[]; maxTokens: number; stream: boolean; signal?: AbortSignal;
	thinkingLevel?: string;
	tools?: RagTools; message: AiChatMessage; onText?: (text: string) => void; onPhase?: (phase: 'reading' | 'answering') => void;
	onCheckpoint?: () => Promise<void>;
	/** Alternative inference transport; evidence, tool limits and citations use the same loop. */
	generate?: DeusGenerator;
}

const sceneTool = 'render_character_scene';
function characterSceneDeclaration(options: GeminiRagOptions) {
	const names = [...new Set((options.message.participants ?? []).map(person => person.name))];
	return { name: sceneTool, description: '캐릭터 CHAT의 최종 장면을 표시합니다. 자료가 충분하면 즉시 호출하세요. 대사와 지문을 순서대로 나누고, 매 대사의 실제 화자 이름을 명시하세요. 목록 표식이나 Markdown 형식은 text에 넣지 마세요.', parameters: { type: 'OBJECT', properties: { turns: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
		type: { type: 'STRING', enum: ['narration', 'dialogue'] }, speaker: { type: 'STRING', description: '대사는 실제 화자 이름. 지문은 빈 문자열을 사용할 수 있습니다.', ...(names.length ? { enum: ['', ...names] } : {}) }, text: { type: 'STRING' },
	}, required: ['type', 'speaker', 'text'] } } }, required: ['turns'] } };
}

/** Typed provider output becomes the same portable format used by saved/legacy turns. */
function characterSceneText(args: Record<string, unknown>, partial = false): string {
	if (!Array.isArray(args.turns)) { if (partial) return ''; throw new Error(wmT("캐릭터 장면의 발언 목록을 받지 못했습니다.")); }
	return (args.turns as unknown[]).map(value => {
		const turn = value && typeof value === 'object' ? value as Record<string, unknown> : {};
		if ((turn.type !== 'narration' && turn.type !== 'dialogue') || typeof turn.text !== 'string' || typeof turn.speaker !== 'string' || turn.type === 'dialogue' && !turn.speaker.trim()) {
			if (partial) return ''; throw new Error(wmT("캐릭터 응답의 화자 또는 대사 형식이 올바르지 않습니다."));
		}
		const speaker = turn.speaker.replace(/[[\]\r\n]/g, '').trim(), text = turn.text.trim();
		if (!text) return '';
		return `${speaker ? `[인물: ${speaker}]\n` : ''}${turn.type === 'narration' ? '[지문]\n' : ''}${text}`;
	}).filter(Boolean).join('\n\n');
}
async function step(options: GeminiRagOptions, contents: GeminiContent[], allowTools: boolean, forceSearch = false): Promise<GeminiStep> {
	checkChatAbort(options.signal);
	const finish = Boolean(options.tools) && !allowTools;
	const character = options.message.skill === 'character';
	const availableDeclarations = [...(allowTools ? declarations : []), ...(character ? [characterSceneDeclaration(options)] : [])];
	const system = options.system + (finish ? '\n이번 응답은 추가 자료 조회 없이 최종 답변을 작성하세요. 제공된 원문과 확인한 근거로 질문에 직접 답하고, 근거가 없는 부분은 확인하지 못했다고 밝히세요. 조회한 범위와 인용 규칙을 지키세요.' : '') + (character ? `\n최종 장면은 반드시 ${sceneTool} 도구의 turns 배열로 출력하세요. 지문과 대사는 각각 별도 항목이며 대사마다 speaker에 실제 화자 이름을 넣으세요. 대사 text에는 목록 기호나 화자 이름을 중복해서 넣지 마세요.` : '');
	if (options.generate) return options.generate({ system, contents, tools: forceSearch ? declarations.filter(tool => tool.name === 'search_sources') : availableDeclarations, forceSearch, maxTokens: options.maxTokens }, options.signal, options.onText);
	const body = JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents,
		generationConfig: { maxOutputTokens: options.maxTokens, thinkingConfig: { thinkingLevel: resolveGeminiThinking(options.model, options.thinkingLevel) } },
		...(availableDeclarations.length ? { tools: [{ functionDeclarations: availableDeclarations }] } : {}),
		...(forceSearch ? { toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['search_sources'] } } } : {}),
		...(!forceSearch && character ? { toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: availableDeclarations.map(tool => tool.name) } } } : {}),
		...(finish && !character ? { toolConfig: { functionCallingConfig: { mode: 'NONE' } } } : {}),
	});
	const base = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}`;
	let parts: GeminiPart[] = [], usage: GeminiUsage | undefined;
	const consume = (value: unknown) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(wmT("Gemini 응답 형식이 올바르지 않습니다."));
		const data = value as { error?: unknown; candidates?: Array<{ content?: { parts?: GeminiPart[] } }>; usageMetadata?: GeminiUsage };
		if (data.error) throw geminiApiError(200, data);
		if (data.candidates !== undefined && !Array.isArray(data.candidates)) throw new Error(wmT("Gemini 응답 후보 형식이 올바르지 않습니다."));
		const next = data.candidates?.[0]?.content?.parts ?? [];
		if (!Array.isArray(next) || next.some(part => !part || typeof part !== 'object'
			|| part.text !== undefined && typeof part.text !== 'string'
			|| part.functionCall && (typeof part.functionCall.name !== 'string' || part.functionCall.args !== undefined && (!part.functionCall.args || typeof part.functionCall.args !== 'object' || Array.isArray(part.functionCall.args))))) throw new Error(wmT("Gemini 응답 본문 형식이 올바르지 않습니다."));
		parts.push(...next); usage = data.usageMetadata ?? usage;
		const text = parts.filter(part => part.text && !part.thought).map(part => part.text).join('');
		const scene = character && parts.find(part => part.functionCall?.name === sceneTool)?.functionCall;
		const sceneText = scene ? characterSceneText(scene.args ?? {}, true) : '';
		if (sceneText || text) options.onText?.(sceneText || text);
	};
	if (options.stream) {
		// Streaming must remain abortable and readable incrementally; requestUrl buffers the body.
		const response = await requestGeminiStream(`${base}:streamGenerateContent?alt=sse`, options.key, body, options.signal);
		if (!response.ok) throw geminiApiError(response.status, await response.json().catch(() => ({})), response.headers.get('retry-after'));
		if (!response.body) throw new Error(wmT("Gemini 응답 본문을 받지 못했습니다. 잠시 후 재시도해 주세요."));
		await readChatSse(response.body, options.signal, consume);
	} else {
		const response = await abortableChat(requestUrl({ url: `${base}:generateContent`, method: 'POST', headers: { 'x-goog-api-key': options.key, 'Content-Type': 'application/json' }, body, throw: false }), options.signal);
		if (response.status < 200 || response.status >= 300) {
			let errorBody: unknown;
			try { errorBody = response.json; } catch { /* A proxy may return HTML rather than JSON. */ }
			throw geminiApiError(response.status, errorBody, Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === 'retry-after')?.[1]);
		}
		consume(response.json);
	}
	checkChatAbort(options.signal);
	return { parts, usage, text: parts.filter(part => part.text && !part.thought).map(part => part.text).join('').trim(), calls: parts.filter(part => part.functionCall).map(part => ({ id: part.functionCall!.id, name: part.functionCall!.name, args: part.functionCall!.args ?? {} })) };
}

/** At most 3 Gemini calls; tools are local read-only operations, never shell/file writes. */
export async function callGeminiRag(options: GeminiRagOptions): Promise<string> {
	const historical = historicalChatCitations(options.history, options.message);
	if (historical.length) options = { ...options, system: options.system + '\n이전 대화의 [H1_69] 같은 H번호는 당시 저장된 원문 출처이며 현재 [C1]과 다릅니다. 과거 근거를 다시 참조할 때는 해당 H식별자를 그대로 쓰고, 최신 원문 확인이 필요하면 read_source에 H식별자를 전달하세요. 이전 답변의 표시용 숫자 각주는 재사용하지 마세요. 이전 AI 답변 자체를 작품 사실의 근거로 삼지 마세요.' };
	const contents: GeminiContent[] = prepareChatHistory(options.history, options.message).map(message => ({ role: message.role === 'user' ? 'user' : 'model', parts: [{ text: formatChatMessage(message) }] }));
	let toolsUsed = 0, exhausted = false;
	const localPlan = options.message.context?.retrieval?.version === 1;
	const episodeOverview = ['episode', 'episode-range'].includes(options.message.context?.retrieval?.strategy ?? '');
	for (let round = 0; round < 3; round++) {
		options.onPhase?.('answering');
		const allowTools = Boolean(options.tools) && !episodeOverview && round < 2 && !exhausted;
		const response = await step(options, contents, allowTools, Boolean(options.tools?.strict) && !localPlan && round === 0);
		if (response.usage) (options.message.usage ??= []).push(response.usage);
		if (options.tools?.strict && !localPlan && round === 0 && (!response.calls.length || response.calls.some(call => call.name !== 'search_sources')))
			throw new Error(wmT("프로젝트 추가 검색을 수행하지 않은 응답은 완료 처리하지 않았습니다."));
		const scene = options.message.skill === 'character' && response.calls.find(call => call.name === sceneTool);
		if (scene) { const text = characterSceneText(scene.args); if (!text) throw new Error(wmT("빈 캐릭터 장면을 받았습니다.")); return text; }
		if (!response.calls.length) { if (!response.text) throw new Error(wmT("빈 응답")); return response.text; }
		if (!options.tools || !allowTools) throw new Error(wmT("원문 근거는 보존했지만 모델이 최종 답변 대신 추가 조회를 요청했습니다. 추가 API 호출은 하지 않았습니다. 다시 시도해 주세요."));
		// Opaque provider parts/signatures are retained exactly within this turn, not exposed as a reasoning transcript.
		contents.push({ role: 'model', parts: response.parts });
		if (response.calls.length > 12) throw new Error(wmT("한 번에 요청한 자료 조회가 너무 많습니다. 질문과 기존 근거는 보존했습니다."));
		const results: GeminiPart[] = [];
		for (const call of response.calls) {
			checkChatAbort(options.signal); options.onPhase?.('reading');
			let sources: ChatContextItem[] = [], warnings: string[] = [];
			if (toolsUsed >= 6) warnings.push(wmT("추가 자료 조회 한도를 사용했습니다. 앞서 확보한 근거로 최종 답변하고 확인되지 않은 부분은 밝히세요."));
			else try {
				toolsUsed++;
				const alias = typeof call.args.source_id === 'string' ? /^C([1-9]\d*)$/.exec(call.args.source_id) : null;
				const previous = historical.find(item => item.alias === call.args.source_id);
				const source = alias ? options.message.context?.sources[Number(alias[1]) - 1] : previous?.source;
				options.tools.useSources?.([...(options.message.context?.sources ?? []), ...(previous ? [previous.source] : [])]);
				if (alias && !source) throw new Error(wmT("현재 질문에 없는 인용 번호입니다."));
				const result = await options.tools.execute(source ? { ...call, args: { ...call.args, source_id: source.id } } : call, options.signal); sources = result.sources; warnings = result.warnings;
			}
			catch (error) { checkChatAbort(options.signal); if (options.tools.strict) throw error; warnings.push(error instanceof Error ? error.message : String(error)); }
			const kept = sources;
			const supplied = [...(options.message.context?.sources ?? [])];
			if (toolsUsed >= 6) exhausted = true;
			const context = options.message.context;
			if (context) {
				for (const source of kept) if (!context.sources.some(item => item.id === source.id && item.text === source.text)) context.sources.push({ ...source });
				for (const warning of warnings) if (!context.warnings.includes(warning)) context.warnings.push(warning);
				(context.searches ??= []).push({ name: call.name, query: typeof call.args.query === 'string' ? call.args.query : undefined, sourceIds: kept.map(source => source.id), warning: warnings.join('\n') || undefined });
			}
			const payloadSources = kept.map(source => {
				const delta = sourceEvidenceDelta(source, supplied);
				const references = delta.references.map(previous => `C${(context?.sources.findIndex(item => item.id === previous.id && item.text === previous.text) ?? -1) + 1}`).join(', ');
				if (!supplied.some(item => item.id === source.id && item.text === source.text)) supplied.push(source);
				const whole = delta.excerpts.length === 1 && delta.excerpts[0].text === source.text;
				const alias = `C${(context?.sources.findIndex(item => item.id === source.id && item.text === source.text) ?? -1) + 1}`;
				return { source_id: source.kind === 'plot' ? alias : source.id, citation_id: alias, title: source.title, path: source.kind === 'plot' ? undefined : source.path, location: source.location,
					text: whole ? source.text : delta.excerpts.length ? `새 원문 구간은 excerpts에 있습니다. 겹치는 구간은 앞서 제공한 ${references}를 함께 읽으세요.` : `이 원문은 앞서 ${references}로 제공되었습니다. 앞선 발췌를 그대로 참고하세요.`,
					...(!whole && delta.excerpts.length ? { excerpts: delta.excerpts } : {}) };
			});
			results.push({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: { sources: payloadSources, warnings,
				remaining_tool_calls: Math.max(0, 6 - toolsUsed), remaining_lookup_rounds: round === 0 && !exhausted ? 1 : 0,
				next_step: round === 1 || exhausted ? '추가 조회 없이 확보한 근거로 최종 답변하세요. 확인하지 못한 내용은 밝히세요.' : '제공된 자료로 충분하면 즉시 답하세요. 부족한 경우에만 마지막 추가 조회를 사용하세요.' } } });
		}
		await options.onCheckpoint?.(); checkChatAbort(options.signal);
		contents.push({ role: 'user', parts: results });
	}
	throw new Error(wmT("응답 횟수 제한에 도달했습니다."));
}
