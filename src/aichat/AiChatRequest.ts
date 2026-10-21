import type { AiChatMessage, AiChatSession } from './AiChatTypes';
import { callAiChat, type AiChatApiKeys } from './AiChatApi';
import { AiChatStorage } from './AiChatStorage';
import { checkChatAbort } from './ChatStream';
import { visibleDeusAnswer, normalizeDeusAnswer, plainDeusReply, prepareChatHistory, historicalChatCitations } from './AiChatPrompt';
import { callGeminiRag } from './GeminiRagApi';
import type { RagTools } from './rag/RagTypes';
import { ChatQuotaError } from './ChatQuotaError';
import { GeminiServiceError } from './GeminiApiError';

export interface ChatRequestOptions {
	keys: AiChatApiKeys; model: string; temperature: number; maxTokens: number; historyTurns: number; stream: boolean;
	ragTools?: RagTools;
	freeOnly?: boolean;
}
export interface ChatRequestState { status: 'sending' | 'streaming' | 'complete' | 'stopped' | 'error'; text: string; error?: string; phase?: 'searching' | 'reading' | 'answering'; retryAt?: number; quota?: boolean }

export class AiChatRequest {
	private active = new Map<string, AbortController>();
	constructor(private storage: AiChatStorage) {}
	isSending(id: string): boolean { return this.active.has(id); }
	stop(id: string): void { this.active.get(id)?.abort(); }
	stopAll(): void { for (const controller of this.active.values()) controller.abort(); }
	async send(session: AiChatSession, message: AiChatMessage, context: (signal: AbortSignal) => Promise<string>, options: ChatRequestOptions, update: (state: ChatRequestState) => void, retry = false): Promise<void> {
		if (this.active.has(session.id)) return;
		const controller = new AbortController(); this.active.set(session.id, controller);
		let text = '', timedOut = false;
		let reply: AiChatMessage | undefined;
		let timeout = 0;
		try {
			if (!retry) session.messages.push(message);
			else if (session.messages[session.messages.length - 1]?.id !== message.id || message.role !== 'user') throw new Error('재시도할 대화 위치가 달라졌습니다. 새 분기에서 시도해 주세요.');
			update({ status: 'sending', text, phase: 'searching' });
			await this.storage.save(session); checkChatAbort(controller.signal);
			if (session.mode === 'deus' && !options.model.startsWith('gemini-')) throw new Error('데우스의 전체 자료 재검색은 Gemini 모델에서 지원합니다. 모델을 직접 선택해 주세요. 검색 기능을 생략한 답변은 만들지 않았습니다.');
			const system = await context(controller.signal); checkChatAbort(controller.signal);
			// Context collection may have attached immutable evidence. Persist it before the paid request.
			await this.storage.save(session); checkChatAbort(controller.signal);
			// Never truncate in the middle of a user/assistant pair or mutate stored history.
			// Local source collection is cancellable; only provider generation has the 90s timeout.
			timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
			const overview = ['episode', 'episode-range'].includes(message.context?.retrieval?.strategy ?? '');
			const history = overview ? [message] : options.historyTurns > 0 ? session.messages.slice(-Math.max(2, options.historyTurns * 2)) : [...session.messages];
			while (history[0]?.role === 'assistant') history.shift();
			const requestHistory = prepareChatHistory(history, message);
			if (options.freeOnly && !['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'].includes(options.model)) throw new Error('무료 전용 모드에서는 지원되는 Gemini 모델을 직접 선택해 주세요.');
			const onText = (value: string) => { if (!controller.signal.aborted) { text = value; update({ status: 'streaming', text: session.mode === 'deus' ? visibleDeusAnswer(plainDeusReply(value, message.skill)) : value }); } };
			text = options.freeOnly || session.mode === 'deus' ? await callGeminiRag({ key: options.keys.gemini, model: options.model, system, history, message, maxTokens: options.maxTokens, stream: options.stream, tools: options.ragTools, signal: controller.signal, onText,
				onPhase: phase => update({ status: 'sending', phase, text: '' }), onCheckpoint: () => this.storage.save(session),
			}) : await callAiChat(options.keys, system, requestHistory, options.temperature, options.model, options.maxTokens, {
				signal: controller.signal, stream: options.stream,
				onText,
			});
			checkChatAbort(controller.signal);
			const answer = session.mode === 'deus' ? normalizeDeusAnswer(text, message.context?.sources ?? [], historicalChatCitations(history, message), message.skill) : { content: text, citations: undefined };
			reply = { id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-assistant`, role: 'assistant', skill: message.skill, participants: message.participants, content: answer.content, citations: answer.citations, timestamp: Date.now(), status: 'complete' };
			session.messages.push(reply);
			await this.storage.save(session);
			update({ status: 'complete', text: '' });
		} catch (error) {
			if (session.mode === 'deus') text = visibleDeusAnswer(plainDeusReply(text, message.skill));
			if (text && !reply) {
				reply = { id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-partial`, role: 'assistant', skill: message.skill, participants: message.participants, content: text, timestamp: Date.now(), status: 'interrupted' };
				session.messages.push(reply);
				try { await this.storage.save(session); } catch (saveError) { update({ status: 'error', text: '', error: `받은 응답을 저장하지 못했습니다: ${saveError instanceof Error ? saveError.message : String(saveError)}` }); return; }
			}
			if (controller.signal.aborted) {
				update({ status: 'stopped', text: '', error: timedOut ? '응답 시간이 초과되었습니다. 원격 서버의 처리는 계속될 수 있습니다.' : '응답 수신을 중단했습니다. 원격 서버의 처리는 계속될 수 있습니다.' });
			} else update({ status: 'error', text: reply ? '' : text, error: error instanceof Error ? error.message : String(error), ...(error instanceof ChatQuotaError ? { quota: true, retryAt: error.retryAt } : error instanceof GeminiServiceError ? { retryAt: error.retryAt } : {}) });
		} finally { window.clearTimeout(timeout); if (this.active.get(session.id) === controller) this.active.delete(session.id); }
	}
}
