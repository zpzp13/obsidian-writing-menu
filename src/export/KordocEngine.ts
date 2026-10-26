import { Platform } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { wmT } from '../i18n/index';
import { isRecord } from '../utils/typeGuards';
import { DocumentWorker } from './DocumentEngine';
import type { DocumentEngine } from './DocumentEngine';
import type { DocumentFormat, EncodeOptions, GeneratedDocument, HwpxTemplate, TransferDocument } from './DocumentModel';
import { getKordocAssetPaths, KORDOC_PROTOCOL, KORDOC_VERSION } from './KordocAssets';
interface RenderedPages { pages: string[]; warnings: string[] }
export interface KordocRenderer {
	render(bytes: Uint8Array, signal: AbortSignal): Promise<RenderedPages>;
	cancelGeneration(): void;
	dispose(): void;
}
function cancelled(): Error { return new DOMException(wmT('문서 미리보기를 닫았습니다.'), 'AbortError'); }
/** Reuse the downloaded renderer in a browser worker, as with Garu. */
export class KordocRenderWorker implements KordocRenderer {
	private worker?: Worker;
	private starting?: Promise<Worker>;
	private rejectStart?: (error: Error) => void;
	private closed = false;
	private nextId = 0;
	private pending = new Map<number, { resolve(value: RenderedPages): void; reject(error: Error): void; cleanup(): void }>();
	constructor(private plugin: WritingMenuPlugin) {}
	private async start(): Promise<Worker> {
		if (!Platform.isDesktop) throw new Error(wmT('데스크톱 전용 기능입니다.'));
		const paths = await getKordocAssetPaths(this.plugin);
		const source = await this.plugin.app.vault.adapter.read(paths.worker);
		if (this.closed) throw cancelled();
		const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
		let worker: Worker;
		try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
		this.worker = worker;
		return new Promise<Worker>((resolve, reject) => {
			const timer = window.setTimeout(() => fail(new Error(wmT('문서 엔진을 시작하는 데 시간이 너무 오래 걸립니다.'))), 30000);
			this.rejectStart = error => { window.clearTimeout(timer); reject(error); };
			const fail = (error: Error) => this.reset(error, worker);
			worker.onmessage = ({ data: reply }: MessageEvent<unknown>) => {
				if (this.worker !== worker || !isRecord(reply)) return;
				if (reply.kind === 'ready') {
					if (reply.version !== KORDOC_VERSION || reply.protocol !== KORDOC_PROTOCOL) { fail(new Error(wmT('문서 엔진을 다시 다운로드해 주세요.'))); return; }
					this.rejectStart = undefined; window.clearTimeout(timer); resolve(worker); return;
				}
				if (typeof reply.id !== 'number') return;
				const pending = this.pending.get(reply.id);
				if (!pending) return;
				this.pending.delete(reply.id); pending.cleanup();
				if (reply.kind === 'error') { pending.reject(new Error(typeof reply.message === 'string' ? reply.message : wmT('문서 엔진 응답이 올바르지 않습니다.'))); return; }
				if (reply.kind !== 'rendered' || !Array.isArray(reply.pages) || !Array.isArray(reply.warnings)) { pending.reject(new Error(wmT('문서 엔진 응답이 올바르지 않습니다.'))); return; }
				const pages = reply.pages as unknown[], warnings = reply.warnings as unknown[];
				if (!pages.length || pages.length > 2000 || pages.some(page => typeof page !== 'string' || !/<svg\b/.test(page)) || pages.reduce<number>((size, page) => size + (typeof page === 'string' ? page.length : 0), 0) > 64 * 1024 * 1024 || warnings.some(warning => typeof warning !== 'string')) {
					pending.reject(new Error(wmT('문서 엔진 응답이 올바르지 않습니다.'))); return;
				}
				pending.resolve({ pages: pages as string[], warnings: warnings as string[] });
			};
			worker.onerror = event => fail(new Error(event.message || wmT('문서 엔진이 종료되었습니다. 다시 시도해 주세요.')));
			worker.onmessageerror = () => fail(new Error(wmT('문서 엔진 응답이 올바르지 않습니다.')));
		});
	}
	private ensureWorker(): Promise<Worker> {
		if (this.closed) return Promise.reject(cancelled());
		if (!this.starting) {
			const pending = this.start(); this.starting = pending;
			void pending.catch(() => { if (this.starting === pending) this.starting = undefined; });
		}
		return this.starting;
	}
	async render(bytes: Uint8Array, signal: AbortSignal): Promise<RenderedPages> {
		if (signal.aborted) throw cancelled();
		const worker = await this.ensureWorker();
		if (signal.aborted || this.closed || worker !== this.worker) throw cancelled();
		return new Promise<RenderedPages>((resolve, reject) => {
			const id = ++this.nextId;
			const abort = () => this.reset(cancelled(), worker);
			const timer = window.setTimeout(() => this.reset(new Error(wmT('문서 생성 시간이 초과되었습니다. 다시 시도해 주세요.')), worker), 120000);
			const cleanup = () => { window.clearTimeout(timer); signal.removeEventListener('abort', abort); };
			this.pending.set(id, { resolve, reject, cleanup });
			signal.addEventListener('abort', abort, { once: true });
			try { const buffer = bytes.slice().buffer; worker.postMessage({ id, bytes: buffer }, [buffer]); }
			catch (error) { this.reset(error instanceof Error ? error : new Error(String(error)), worker); }
			if (signal.aborted) abort();
		});
	}
	private reset(error: Error, worker = this.worker): void {
		if (!worker || this.worker !== worker) return;
		this.worker = undefined; this.starting = undefined;
		this.rejectStart?.(error); this.rejectStart = undefined;
		for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); }
		this.pending.clear(); worker.terminate();
	}
	cancelGeneration(): void { if (this.pending.size) this.reset(cancelled()); }
	dispose(): void { this.closed = true; this.reset(cancelled()); }
}
export class KordocDocumentEngine implements DocumentEngine {
	private controller?: AbortController;
	private closed = false;
	constructor(plugin: WritingMenuPlugin, private worker: DocumentEngine = new DocumentWorker(), private renderer: KordocRenderer = new KordocRenderWorker(plugin)) {}
	async generate(document: TransferDocument, format: DocumentFormat, options: EncodeOptions): Promise<GeneratedDocument> {
		if (this.closed) throw cancelled();
		this.cancelGeneration();
		const controller = new AbortController(); this.controller = controller;
		try {
			const generated = await this.worker.generate(document, format, options);
			if (controller.signal.aborted) throw cancelled();
			if (format === 'hwpx') {
				const rendered = await this.renderer.render(generated.bytes, controller.signal);
				generated.pages = rendered.pages; generated.warnings.push(...rendered.warnings);
			}
			if (controller.signal.aborted) throw cancelled();
			return generated;
		} finally { if (this.controller === controller) this.controller = undefined; }
	}
	template(bytes: Uint8Array): Promise<HwpxTemplate> { return this.worker.template(bytes); }
	cancelGeneration(): void { this.controller?.abort(); this.controller = undefined; this.worker.cancelGeneration?.(); this.renderer.cancelGeneration(); }
	dispose(): void { this.closed = true; this.cancelGeneration(); this.worker.dispose(); this.renderer.dispose(); }
}
