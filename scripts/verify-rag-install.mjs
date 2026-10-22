import { loadTsFixture } from './ts-fixture-loader.mjs';
// Installer lifecycle checks without network, model files or wall-clock waits.
import assert from 'node:assert/strict';
const load = loadTsFixture;
const stream = await load('src/aichat/ChatStream.ts');
const { RagWorkerClient, RAG_PREPARATION_IDLE_MS, ragProgressMessage } = await load('src/aichat/rag/RagWorkerClient.ts', {
	'./RagTypes': { RAG_MODEL_KEY: 'synthetic' }, '../ChatStream': stream,
	'./RagRuntimeAssets': { bundledRagWorker: '', runtimeAsset: () => { throw new Error('Unexpected network fallback'); } },
});
const native = { Worker: globalThis.Worker, window: globalThis.window, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
globalThis.window = globalThis;
const timers = new Map(), instances = []; let nextTimer = 0;
globalThis.setTimeout = (callback, milliseconds) => { assert.equal(milliseconds, RAG_PREPARATION_IDLE_MS); timers.set(++nextTimer, callback); return nextTimer; };
globalThis.clearTimeout = id => timers.delete(id);
globalThis.Worker = class {
	constructor() { instances.push(this); }
	postMessage(message, transfer) { this.message = message; this.transfer = transfer; }
	terminate() { this.terminated = true; }
	progress(info) { this.onmessage({ data: { id: this.message.id, progress: info } }); }
	finish(error) { this.onmessage({ data: { id: this.message.id, result: undefined, error } }); }
};
const adapter = { read: async path => path.endsWith('rag-worker.js') ? '// worker' : '// module', readBinary: async () => new ArrayBuffer(32) };
const plugin = { manifest: { id: 'writing-menu', dir: 'plugin' }, app: { vault: { adapter } } };
const database = { get: async () => ({ ready: true }) };
const until = async test => { for (let i = 0; i < 100 && !test(); i++) await Promise.resolve(); assert(test(), 'Expected async installer stage was not reached'); };
let client;
try {
	assert.match(ragProgressMessage({ file: 'weights', status: 'progress', loaded: 1048576, total: 2097152, progress: 50 }), /1\.0 \/ 2\.0 MB.*50% \(이 파일\)/);
	client = new RagWorkerClient(plugin, database);
	const progress = [], joined = [];
	const first = client.prepare(true, value => progress.push(value)); assert(progress[0].includes('확인'), 'No immediate feedback');
	await until(() => instances.at(-1)?.message);
	const worker = instances.at(-1), second = client.prepare(true, value => joined.push(value));
	assert.equal(instances.length, 1, 'Concurrent installation spawned another worker');
	assert.equal(worker.transfer[0], worker.message.data.wasm, 'Large WASM buffer was cloned');
	worker.progress({ file: 'model.onnx', status: 'progress', loaded: 1048576, total: 2097152, progress: 50 });
	assert(progress.at(-1).includes('1.0 / 2.0 MB')); assert.equal(joined.at(-1), progress.at(-1));
	worker.finish(); await Promise.all([first, second]); assert(client.ready); assert(!client.preparing); assert.equal(timers.size, 0);
	client.dispose(); assert(worker.terminated);
	// A stuck model initialization must report its last stage, stop the worker and allow retry.
	const stalled = client.prepare(true); const stalledAssertion = assert.rejects(stalled, /2분.*model\.onnx/);
	await until(() => instances.at(-1) !== worker && instances.at(-1)?.message);
	const stuckWorker = instances.at(-1); stuckWorker.progress({ file: 'model.onnx', status: 'download' });
	[...timers.values()][0](); await stalledAssertion; assert(stuckWorker.terminated); assert(!client.ready); assert.equal(timers.size, 0);
	const retry = client.prepare(true); await until(() => instances.at(-1) !== stuckWorker && instances.at(-1)?.message);
	instances.at(-1).finish(); await retry; assert(client.ready); client.dispose();
	// Cancelling while the adapter is still reading must settle promptly, with no worker creation.
	const read = adapter.read; adapter.read = () => new Promise(() => {}); const count = instances.length;
	const reading = client.prepare(true), readingAssertion = assert.rejects(reading, error => error.name === 'AbortError');
	client.dispose(new DOMException('중단', 'AbortError')); await readingAssertion; assert.equal(instances.length, count); assert.equal(timers.size, 0); adapter.read = read;
	const failed = client.prepare(true), failedAssertion = assert.rejects(failed, /실제 초기화 오류/);
	await until(() => instances.length > count && instances.at(-1)?.message); instances.at(-1).finish('실제 초기화 오류'); await failedAssertion;
	assert(!client.preparing && !client.ready); assert.equal(timers.size, 0);
	console.log('PASS installer immediate/byte progress, one shared Worker, WASM transfer, 2-minute stall timeout, cancellation during I/O, failed initialization cleanup and retry');
} finally { client?.dispose(); Object.assign(globalThis, native); }
