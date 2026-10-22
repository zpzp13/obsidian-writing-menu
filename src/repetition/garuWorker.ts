import type { MorphToken } from './types';
// @ts-ignore vendored wasm-bindgen glue의 타입은 garu_wasm.d.ts에서 제공한다.
import initGaruWasm, { GaruWasm } from './vendor/garu_wasm.js';

interface AnalyzeMessage {
	text: string;
	wasmBytes: Uint8Array;
	modelBytes: Uint8Array;
}

interface WorkerScopeLike {
	onmessage: ((event: MessageEvent<AnalyzeMessage>) => void) | null;
	postMessage(message: unknown): void;
}

const workerScope = self as unknown as WorkerScopeLike;

async function analyze(data: AnalyzeMessage): Promise<MorphToken[]> {
	await initGaruWasm({ module_or_path: data.wasmBytes });
	const garu = new GaruWasm(data.modelBytes, false);
	try {
		const result = garu.analyze(data.text);
		return result.tokens.map(token => ({
			text: token.text,
			pos: token.pos,
			start: token.start,
			end: token.end,
		}));
	} finally {
		garu.free();
	}
}

workerScope.onmessage = event => {
	void analyze(event.data)
		.then(tokens => workerScope.postMessage({ tokens }))
		.catch(error => {
			workerScope.postMessage({
				error: error instanceof Error ? error.message : String(error),
			});
		});
};
