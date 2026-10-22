import type WritingMenuPlugin from '../../../main';
import { RagDatabase } from './RagDatabase';
import { RAG_MODEL_KEY } from './RagTypes';
import type { TextWindow } from './RagChunking';
import { abortableChat, checkChatAbort } from '../ChatStream';
import { bundledRagWorker, runtimeAsset } from './RagRuntimeAssets';
import { isRecord, toError } from '../../utils/typeGuards';
import { readEmbedding, readWorkerProgress, readWorkerWindows } from './RagWorkerProtocol';

export const RAG_PREPARATION_IDLE_MS = 120_000;
export function ragProgressMessage(info: { file?: string; status?: string; message?: string; loaded?: number; total?: number; progress?: number }): string {
	if (info.message) return info.message;
	const file = info.file ?? '모델';
	if (info.status === 'progress') {
		const bytes = typeof info.loaded === 'number' ? ` · ${(info.loaded / 1048576).toFixed(1)}${info.total ? ` / ${(info.total / 1048576).toFixed(1)}` : ''} MB` : '';
		return `${file}${bytes}${typeof info.progress === 'number' ? ` · ${Math.min(100, Math.round(info.progress))}% (이 파일)` : ''}`;
	}
	return `${file} · ${info.status === 'initiate' ? '저장된 파일 확인 중' : info.status === 'download' ? '파일 읽는 중' : info.status === 'done' ? '파일 준비 완료' : '모델 초기화 중'}`;
}

export class RagWorkerClient {
	private worker?: Worker;
	private url?: string;
	private sequence = 0;
	private generation = 0;
	private pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void; progress?: (text: string) => void }>();
	private initialization?: Promise<void>;
	private preparation?: AbortController;
	private prepared = false;
	private progressListeners = new Set<(text: string) => void>();
	private latestProgress = '';
	private watchdog?: number;
	constructor(private plugin: WritingMenuPlugin, private database: RagDatabase) {}
	get ready(): boolean { return this.prepared; }
	get preparing(): boolean { return Boolean(this.preparation); }
	private report = (text: string): void => {
		if (this.watchdog !== undefined) window.clearTimeout(this.watchdog);
		this.watchdog = window.setTimeout(() => this.dispose(new Error(`모델 준비에서 2분 동안 새 진행 신호가 없어 중단했습니다. 마지막 단계: ${this.latestProgress}. 연결을 확인하고 모델 설치를 다시 실행해 주세요. 완료된 다운로드 파일은 재사용합니다.`)), RAG_PREPARATION_IDLE_MS);
		if (this.latestProgress === text) return;
		this.latestProgress = text; for (const listener of this.progressListeners) listener(text);
	};
	async installed(): Promise<boolean> { return Boolean(await this.database.get('assets', `ready:${RAG_MODEL_KEY}`)); }
	async prepare(install = false, progress?: (text: string) => void): Promise<void> {
		if (progress) this.progressListeners.add(progress);
		try {
		if (this.initialization) { if (progress && this.latestProgress) progress(this.latestProgress); return await this.initialization; }
		const generation = this.generation;
		this.preparation = new AbortController(); const signal = this.preparation.signal;
		this.report('로컬 실행 파일과 저장된 모델 확인 중…');
		this.initialization = (async () => {
			if (!install && !await abortableChat(this.installed(), signal)) throw new Error('로컬 검색 모델이 설치되지 않았습니다. AI 챗 설정에서 설치해 주세요.');
			const adapter = this.plugin.app.vault.adapter, directory = this.plugin.manifest.dir || `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
			const [code, wasm, module] = await abortableChat(Promise.all([
				adapter.read(`${directory}/rag-worker.js`).catch(error => { if (bundledRagWorker) return bundledRagWorker; throw error; }),
				adapter.readBinary(`${directory}/rag-runtime/ort-wasm-simd-threaded.asyncify.wasm`).catch(() => runtimeAsset(this.database, 'wasm', install, signal, this.report)),
				adapter.read(`${directory}/rag-runtime/ort-wasm-simd-threaded.asyncify.mjs`).catch(async () => new TextDecoder().decode(await runtimeAsset(this.database, 'module', install, signal, this.report))),
			]), signal);
			if (generation !== this.generation) throw new DOMException('모델 준비를 중단했습니다.', 'AbortError');
			this.report('백그라운드 검색 Worker 시작 중…');
			this.url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); this.worker = new Worker(this.url, { type: 'module' });
			this.worker.onmessage = (event: MessageEvent<unknown>) => {
				const data = event.data;
				if (!isRecord(data) || typeof data.id !== 'number') { this.dispose(new Error('로컬 검색 Worker 응답 형식이 올바르지 않습니다.')); return; }
				const item = this.pending.get(data.id); if (!item) return;
				try {
					if (data.progress) { item.progress?.(ragProgressMessage(readWorkerProgress(data.progress))); return; }
					this.pending.delete(data.id);
					if (data.error !== undefined) item.reject(new Error(typeof data.error === 'string' ? data.error : '로컬 검색 Worker 작업에 실패했습니다.'));
					else item.resolve(data.result);
				} catch (error) { this.pending.delete(data.id); item.reject(toError(error)); }
			};
			this.worker.onerror = event => this.dispose(new Error(event.message || '로컬 검색 Worker 실행에 실패했습니다.'));
			await this.call('init', { install, wasm, module }, signal, this.report, [wasm]);
			this.prepared = true; this.report('모델 다운로드·초기화·동작 확인 완료');
		})().catch((error: unknown) => { const reason = signal.aborted && signal.reason instanceof Error ? signal.reason : toError(error); if (generation === this.generation) this.dispose(reason); throw reason; }).finally(() => {
			if (generation === this.generation) { if (this.watchdog !== undefined) window.clearTimeout(this.watchdog); this.watchdog = undefined; this.preparation = undefined; }
		});
		await this.initialization;
		} finally { if (progress) this.progressListeners.delete(progress); }
	}
	private call(op: string, data: unknown, signal?: AbortSignal, progress?: (text: string) => void, transfer: Transferable[] = []): Promise<unknown> {
		checkChatAbort(signal);
		return new Promise((resolve, reject) => {
			const id = ++this.sequence;
			const abort = () => { this.pending.delete(id); signal?.removeEventListener('abort', abort); reject(new DOMException('작업을 중단했습니다.', 'AbortError')); };
			signal?.addEventListener('abort', abort, { once: true });
			this.pending.set(id, { resolve: value => { signal?.removeEventListener('abort', abort); resolve(value); }, reject: error => { signal?.removeEventListener('abort', abort); reject(toError(error)); }, progress });
			if (!this.worker) { this.pending.delete(id); signal?.removeEventListener('abort', abort); reject(new Error('로컬 검색 Worker가 없습니다.')); return; }
			try { this.worker.postMessage({ id, op, data }, transfer); }
			catch (error) { this.pending.delete(id); signal?.removeEventListener('abort', abort); reject(toError(error)); }
		});
	}
	async chunks(text: string, title: string, signal?: AbortSignal): Promise<TextWindow[]> { await this.prepare(); return readWorkerWindows(await this.call('chunks', { text, title }, signal)); }
	async embed(text: string, query = false, signal?: AbortSignal): Promise<Float32Array> { await this.prepare(); return readEmbedding({ data: await this.call('embed', { text, query }, signal) }); }
	dispose(error: unknown = new Error('로컬 검색을 종료했습니다.')): void {
		this.generation++;
		this.prepared = false;
		if (this.watchdog !== undefined) window.clearTimeout(this.watchdog); this.watchdog = undefined;
		this.preparation?.abort(error); this.preparation = undefined;
		this.worker?.terminate(); this.worker = undefined; if (this.url) URL.revokeObjectURL(this.url); this.url = undefined;
		for (const item of this.pending.values()) item.reject(error); this.pending.clear(); this.initialization = undefined; this.latestProgress = '';
	}
}
