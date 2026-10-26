import { isRecord } from '../utils/typeGuards';

declare const __WM_KORDOC_COMPILER_SOURCE__: string;
const compilerSource = typeof __WM_KORDOC_COMPILER_SOURCE__ === 'string' ? __WM_KORDOC_COMPILER_SOURCE__ : '';

/** Compile only on explicit download. Dispose the compiler and its WASM memory afterward. */
export async function compileKordocWorker(files: Map<string, string>, wasm: Uint8Array): Promise<string> {
	if (!compilerSource) throw new Error('Document engine compiler is missing.');
	const url = URL.createObjectURL(new Blob([compilerSource], { type: 'text/javascript' }));
	let worker: Worker | undefined;
	try {
		worker = new Worker(url);
		const active = worker;
		return await new Promise<string>((resolve, reject) => {
			const timer = window.setTimeout(() => reject(new Error('Document engine installation timed out.')), 120000);
			const fail = (error: Error) => { window.clearTimeout(timer); reject(error); };
			active.onerror = event => fail(new Error(event.message || 'Document engine compiler failed.'));
			active.onmessageerror = () => fail(new Error('Invalid engine compiler response.'));
			active.onmessage = ({ data }: MessageEvent<unknown>) => {
				window.clearTimeout(timer);
				if (!isRecord(data) || typeof data.source !== 'string' || !data.source.length) {
					reject(new Error(isRecord(data) && typeof data.error === 'string' ? data.error : 'Invalid engine compiler response.')); return;
				}
				resolve(data.source);
			};
			const buffer = wasm.slice().buffer;
			try { active.postMessage({ files, wasm: buffer }, [buffer]); }
			catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
		});
	} finally { worker?.terminate(); URL.revokeObjectURL(url); }
}

/** Do not activate a downloaded installation until its browser worker actually starts. */
export async function checkKordocWorker(source: string, version: string, protocol: number): Promise<void> {
	const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	let worker: Worker | undefined;
	try {
		worker = new Worker(url);
		const active = worker;
		await new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(() => reject(new Error('Document engine startup timed out.')), 30000);
			active.onerror = event => { window.clearTimeout(timer); reject(new Error(event.message || 'Document engine startup failed.')); };
			active.onmessageerror = () => { window.clearTimeout(timer); reject(new Error('Invalid document engine response.')); };
			active.onmessage = ({ data }: MessageEvent<unknown>) => {
				window.clearTimeout(timer);
				if (isRecord(data) && data.kind === 'ready' && data.version === version && data.protocol === protocol) resolve();
				else reject(new Error('Invalid document engine response.'));
			};
		});
	} finally { worker?.terminate(); URL.revokeObjectURL(url); }
}
