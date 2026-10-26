import type { DocumentFormat, EncodeOptions, GeneratedDocument, HwpxTemplate, TransferDocument } from './DocumentModel';

declare const __WM_DOCUMENT_WORKER_SOURCE__: string;
export type WorkerRequest = { id: number; kind: 'template'; bytes: Uint8Array } | { id: number; kind: 'generate'; document: TransferDocument; format: DocumentFormat; options: EncodeOptions };
export type WorkerReply = { id: number; kind: 'error'; message: string } | { id: number; kind: 'generated'; value: GeneratedDocument } | { id: number; kind: 'template'; value: HwpxTemplate };
export interface DocumentEngine {
	generate(document: TransferDocument, format: DocumentFormat, options: EncodeOptions): Promise<GeneratedDocument>;
	template(bytes: Uint8Array): Promise<HwpxTemplate>;
	cancelGeneration?(): void;
	dispose(): void;
}
export class DocumentWorker implements DocumentEngine {
	private worker: Worker | null = null;
	private nextId = 0;
	private pending = new Map<number, { kind: WorkerRequest['kind']; timer: number; resolve: (value: WorkerReply) => void; reject: (error: Error) => void }>();
	private closed = false;
	private ensureWorker(): Worker {
		if (this.closed) throw new Error('문서 미리보기를 닫았습니다.');
		if (!this.worker) {
			const url = URL.createObjectURL(new Blob([__WM_DOCUMENT_WORKER_SOURCE__], { type: 'text/javascript' }));
			try { this.worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
			this.worker.onmessage = (event: MessageEvent<unknown>) => {
				const reply = event.data as WorkerReply;
				if (!reply || typeof reply.id !== 'number') { this.reset(new Error('문서 생성 결과가 올바르지 않습니다.')); return; }
				const pending = this.pending.get(reply.id); if (!pending) return;
				this.pending.delete(reply.id); window.clearTimeout(pending.timer);
				if (reply.kind === 'error') pending.reject(new Error(reply.message)); else pending.resolve(reply);
			};
			this.worker.onerror = event => { this.reset(new Error(event.message || '문서 생성 Worker를 실행하지 못했습니다.')); };
			this.worker.onmessageerror = () => { this.reset(new Error('문서 생성 결과가 올바르지 않습니다.')); };
		}
		return this.worker;
	}
	private request(request: WorkerRequest): Promise<WorkerReply> {
		// Superseded layouts must not keep the newest merged preview queued behind them.
		if (this.pending.size) this.reset(this.cancelled());
		return new Promise((resolve, reject) => {
			const worker = this.ensureWorker();
			const timer = window.setTimeout(() => { this.reset(new Error('문서 생성 시간이 초과되었습니다. 다시 시도해 주세요.')); }, 120000);
			this.pending.set(request.id, { kind: request.kind, timer, resolve, reject });
			try { worker.postMessage(request); } catch (error) { this.pending.delete(request.id); window.clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); }
		});
	}
	async generate(document: TransferDocument, format: DocumentFormat, options: EncodeOptions): Promise<GeneratedDocument> {
		const result = await this.request({ id: ++this.nextId, kind: 'generate', document, format, options });
		if (result.kind !== 'generated') throw new Error('문서 생성 결과가 올바르지 않습니다.'); return result.value;
	}
	async template(bytes: Uint8Array): Promise<HwpxTemplate> {
		const result = await this.request({ id: ++this.nextId, kind: 'template', bytes });
		if (result.kind !== 'template') throw new Error('템플릿 분석 결과가 올바르지 않습니다.'); return result.value;
	}
	private cancelled(): Error { const error = new Error('문서 미리보기를 닫았습니다.'); error.name = 'AbortError'; return error; }
	private reset(error: Error): void { this.worker?.terminate(); this.worker = null; this.fail(error); }
	cancelGeneration(): void { if ([...this.pending.values()].some(request => request.kind === 'generate')) this.reset(this.cancelled()); }
	private fail(error: Error): void { for (const pending of this.pending.values()) { window.clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
	dispose(): void { this.closed = true; this.worker?.terminate(); this.worker = null; this.fail(new Error('문서 미리보기를 닫았습니다.')); }
}
