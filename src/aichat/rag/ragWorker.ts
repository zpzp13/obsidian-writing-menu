import { env, AutoModel, AutoTokenizer, FeatureExtractionPipeline } from '@huggingface/transformers';
import { RagDatabase, ragAssetCache } from './RagDatabase';
import { RAG_MODEL, RAG_REVISION, RAG_MODEL_KEY } from './RagTypes';
import { ragTextWindows } from './RagChunking';
import { readWorkerRequest, readWorkerProgress, readEmbedding, type RagWorkerRequest, type RagWorkerProgress } from './RagWorkerProtocol';
import { isRecord } from '../../utils/typeGuards';

const scope = self as unknown as { onmessage: ((event: MessageEvent<unknown>) => void) | null; postMessage(data: unknown): void };
let extractor: FeatureExtractionPipeline | undefined, networkAllowed = false;
let chain: Promise<unknown> = Promise.resolve();
async function init(data: Extract<RagWorkerRequest, { op: 'init' }>['data'], id: number) {
	scope.postMessage({ id, progress: { message: '모델 캐시와 실행 환경 준비 중…' } });
	networkAllowed = data.install;
	const db = new RagDatabase();
	env.allowLocalModels = false; env.allowRemoteModels = true; env.useFS = false; env.useFSCache = false; env.useBrowserCache = false; env.useCustomCache = true; env.customCache = ragAssetCache(db); env.useWasmCache = false;
	// Some v4 metadata/tokenizer probes omit revision; pin the URL template as well as load options.
	env.remotePathTemplate = `{model}/resolve/${RAG_REVISION}/`;
	const originalFetch = self.fetch.bind(self);
	env.fetch = (input: string | URL, options?: RequestInit) => {
		const url = String(input);
		if (!networkAllowed) throw new Error('로컬 모델 파일이 없습니다. 설정에서 모델 설치를 실행해 주세요. 외부 임베딩은 사용하지 않습니다.');
		if ((options?.method && options.method !== 'GET') || !url.startsWith(`https://huggingface.co/${RAG_MODEL}/resolve/${RAG_REVISION}/`)) throw new Error(`허용되지 않은 모델 다운로드 경로: ${url}`);
		return originalFetch(input, options);
	};
	const onnx = env.backends.onnx;
	if (!onnx?.wasm) throw new Error('로컬 검색의 브라우저 WASM 실행 환경을 준비하지 못했습니다. 플러그인 실행 파일을 갱신해 주세요.');
	onnx.wasm.numThreads = 1; onnx.wasm.proxy = false;
	onnx.wasm.wasmBinary = new Uint8Array(data.wasm);
	// Apply the same Node-detection guard used by Transformers' web WASM
	// loader. Electron also exposes globalThis.process inside Workers.
	const webModule = data.module.split('globalThis.process?.versions?.node').join('false');
	onnx.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([webModule], { type: 'text/javascript' })) };
	// Explicit components avoid v4 pipeline discovery probing an unpinned `main` revision.
	// Fast downloads/cache reads can emit thousands of chunks. Bound IPC and UI
	// updates so model installation cannot monopolize the Obsidian renderer.
	let latest: RagWorkerProgress | undefined, timer: number | undefined, last = 0;
	const flush = () => { if (latest) { scope.postMessage({ id, progress: latest }); latest = undefined; last = Date.now(); } timer = undefined; };
	const progress_callback = (value: unknown) => {
		const event = readWorkerProgress(value);
		latest = event;
		if (event.status !== 'progress' || Date.now() - last >= 200) { if (timer !== undefined) self.clearTimeout(timer); flush(); }
		else if (timer === undefined) timer = self.setTimeout(flush, 200 - (Date.now() - last));
	};
	try {
	const [tokenizer, model] = await Promise.all([
		AutoTokenizer.from_pretrained(RAG_MODEL, { revision: RAG_REVISION, progress_callback }),
		AutoModel.from_pretrained(RAG_MODEL, { revision: RAG_REVISION, dtype: 'q8', device: 'wasm', progress_callback }),
	]);
	extractor = new FeatureExtractionPipeline({ task: 'feature-extraction', tokenizer, model });
	networkAllowed = false;
	progress_callback({ message: '다운로드 완료 · 모델 초기화와 검색 동작 확인 중…' });
	const sample = await extractor('query: 검색 준비 확인', { pooling: 'mean', normalize: true });
	readEmbedding(sample);
	await db.put('assets', { key: `ready:${RAG_MODEL_KEY}`, ready: true });
	} finally { networkAllowed = false; if (timer !== undefined) self.clearTimeout(timer); }
}
scope.onmessage = event => {
	let request: RagWorkerRequest;
	try { request = readWorkerRequest(event.data); }
	catch (error) {
		const id = isRecord(event.data) && typeof event.data.id === 'number' ? event.data.id : 0;
		scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); return;
	}
	const { id } = request;
	chain = chain.catch(() => {}).then(async () => {
		try {
			let result: unknown;
			if (request.op === 'init') await init(request.data, id);
			else {
				if (!extractor) throw new Error('로컬 검색 모델이 준비되지 않았습니다.');
				if (request.op === 'chunks') result = ragTextWindows(request.data.text, request.data.title, value => extractor!.tokenizer.encode(value).length);
				else if (request.op === 'embed') {
					const data = request.data;
					const prefix = data.query ? 'query' : 'passage';
					let text: string = data.text;
					if (extractor.tokenizer.encode(`${prefix}: ${text}`).length > 512) {
						if (!data.query) throw new Error('검색 구간이 모델 입력 길이를 넘었습니다. 색인을 다시 생성해 주세요.');
						let low = 0, high = text.length;
						while (low < high) { const middle = Math.ceil((low + high) / 2); if (extractor.tokenizer.encode(`${prefix}: ${text.slice(0, middle)}`).length <= 500) low = middle; else high = middle - 1; }
						text = text.slice(0, low);
					}
					const output = await extractor(`${prefix}: ${text}`, { pooling: 'mean', normalize: true });
					result = readEmbedding(output);
				} else throw new Error('알 수 없는 로컬 검색 작업입니다.');
			}
			scope.postMessage({ id, result });
		} catch (error) { scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
	});
};
