import { generateDocument } from './DocumentCodecs';
import { inspectHwpxTemplate } from './HwpxTemplate';
import type { WorkerRequest, WorkerReply } from './DocumentEngine';

const workerScope = self as unknown as { onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null; postMessage(reply: WorkerReply, transfer?: Transferable[]): void };
workerScope.onmessage = event => {
	const request = event.data;
	void (async () => {
		try {
			if (request.kind === 'template') workerScope.postMessage({ id: request.id, kind: 'template', value: inspectHwpxTemplate(request.bytes) });
			else {
				const value = await generateDocument(request.document, request.format, request.options);
				workerScope.postMessage({ id: request.id, kind: 'generated', value }, [value.bytes.buffer as ArrayBuffer]);
			}
		} catch (error) { workerScope.postMessage({ id: request.id, kind: 'error', message: error instanceof Error ? error.message : String(error) }); }
	})();
};
