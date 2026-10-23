import type { CliChatOptions } from './CliChatApi';
import { isRecord } from '../utils/typeGuards';
import { checkChatAbort } from './ChatStream';
import { cliEffortLabel, isCliEffort, type CliEffort, type CliModelOption } from './CliReasoning';

export type { CliModelOption } from './CliReasoning';
const cache = new Map<string, { time: number; models: CliModelOption[] }>();

/** Read the installed CLI's catalog through initialization, without an inference request. */
export async function listCliModels(options: CliChatOptions, signal?: AbortSignal, refresh = false): Promise<CliModelOption[]> {
	checkChatAbort(signal);
	const key = JSON.stringify([options.provider, options.path, options.cwd]), previous = cache.get(key);
	if (!refresh && previous && Date.now() - previous.time < 60_000) return previous.models;
	const { withCliProcess, cliArguments } = await import('./CliChatProcess');
	const controller = new AbortController(), abort = () => controller.abort();
	signal?.addEventListener('abort', abort, { once: true });
	if (signal?.aborted) controller.abort();
	const timer = window.setTimeout(abort, 20_000);
	try {
		const args = options.provider === 'codex' ? ['app-server', '--listen', 'stdio://'] : [...cliArguments({ ...options, model: '' }, ''), '--input-format', 'stream-json'];
		const models = await withCliProcess(options, args, controller.signal, (child, terminate) => new Promise<CliModelOption[]>((resolve, reject) => {
			let buffer = '', diagnostics = '', done = false;
			const models: CliModelOption[] = [], cursors = new Set<string>();
			const finish = (error?: Error) => {
				if (done) return;
				done = true; controller.signal.removeEventListener('abort', cancel); terminate();
				if (error) reject(error);
				else if (!models.length) reject(new Error('CLI가 선택 가능한 모델 목록을 반환하지 않았습니다.'));
				else { cache.set(key, { time: Date.now(), models }); resolve(models); }
			};
			const cancel = () => finish(new Error(signal?.aborted ? '모델 목록 조회를 중단했습니다.' : '모델 목록 조회 시간이 초과되었습니다. CLI 설치와 로그인 상태를 확인해 주세요.'));
			const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
			const add = (values: unknown) => {
				if (!Array.isArray(values)) throw new Error('CLI 모델 목록 형식이 올바르지 않습니다.');
				for (const value of values as unknown[]) {
					if (!isRecord(value) || value.hidden === true) continue;
					const id = value.model ?? value.value ?? value.id;
					if (typeof id !== 'string' || !id.trim() || models.some(model => model.id === id)) continue;
					const reported = options.provider === 'codex' ? value.supportedReasoningEfforts : value.supportedEffortLevels;
					const levels = Array.isArray(reported) && value.supportsEffort !== false ? (reported as unknown[]).map(effort => isRecord(effort) ? effort.reasoningEffort : effort).filter(isCliEffort) : [];
					const efforts = [...new Set<CliEffort>(levels)].map(effort => ({ id: effort, label: cliEffortLabel(effort) }));
					const defaultEffort = isCliEffort(value.defaultReasoningEffort) && efforts.some(effort => effort.id === value.defaultReasoningEffort) ? value.defaultReasoningEffort : undefined;
					models.push({ id, label: typeof value.displayName === 'string' ? value.displayName : id, isDefault: value.isDefault === true || options.provider === 'claude' && id === 'default', efforts, defaultEffort });
				}
			};
			const consume = (line: string) => {
				const text = line.replace(/^\uFEFF/, '').trim(); if (!text || done) return;
				if (!text.startsWith('{')) { diagnostics = (diagnostics + text).slice(-1000); return; }
				const value: unknown = JSON.parse(text); if (!isRecord(value)) return;
				if (isRecord(value.error)) { finish(new Error(typeof value.error.message === 'string' ? value.error.message : 'CLI 모델 조회 실패')); return; }
				if (options.provider === 'codex') {
					if (value.id === 1 && isRecord(value.result)) { send({ method: 'initialized' }); send({ id: 2, method: 'model/list', params: { limit: 100, includeHidden: false } }); }
					if (value.id === 2 && isRecord(value.result)) {
						add(value.result.data);
						const cursor = value.result.nextCursor;
						if (typeof cursor === 'string' && cursor) {
							if (cursors.has(cursor) || cursors.size >= 10) throw new Error('CLI 모델 목록 페이지가 반복되었습니다.');
							cursors.add(cursor); send({ id: 2, method: 'model/list', params: { limit: 100, includeHidden: false, cursor } });
						} else finish();
					}
				} else if (value.type === 'control_response' && isRecord(value.response) && value.response.request_id === 'deus-models') {
					if (value.response.subtype !== 'success' || !isRecord(value.response.response)) throw new Error('Claude Code 모델 목록을 조회하지 못했습니다.');
					add(value.response.response.models); finish();
				} else if (value.type === 'result' && value.is_error) finish(new Error(typeof value.result === 'string' ? value.result : 'CLI 로그인 상태를 확인해 주세요.'));
			};
			child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
			child.stdout.on('data', (data: string) => {
				try {
					buffer += data; if (buffer.length > 4_000_000) throw new Error('CLI 모델 목록 응답이 너무 큽니다.');
					let newline: number;
					while ((newline = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); consume(line); }
				} catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
			});
			child.stderr.on('data', (data: string) => { diagnostics = (diagnostics + data).slice(-1000); });
			child.on('error', error => finish(error)); child.stdin.on('error', error => finish(error));
			child.on('close', () => { try { consume(buffer); if (!done) finish(new Error(`CLI 모델 목록을 받지 못했습니다. ${diagnostics}`)); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); } });
			controller.signal.addEventListener('abort', cancel, { once: true });
			if (controller.signal.aborted) cancel();
			else if (options.provider === 'codex') send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'writing_menu_deus', title: 'Deus', version: '1.0.0' } } });
			else send({ type: 'control_request', request_id: 'deus-models', request: { subtype: 'initialize' } });
		}));
		return models;
	} finally { window.clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
