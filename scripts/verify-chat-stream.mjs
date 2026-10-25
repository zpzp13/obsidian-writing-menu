// Synthetic streams only: partial UTF-8, cancellation, and parser failure cleanup.
import assert from 'node:assert/strict';
import { loadTsFixture } from './ts-fixture-loader.mjs';
const { readChatSse, readGeminiStream, abortableChat } = loadTsFixture('src/aichat/ChatStream.ts');
const encoder = new TextEncoder();
const frames = [
	': keepalive\r\n\r\n',
	'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"PRIVATE"},{"text":"한글 "}]}}]}\r\n\r\n',
	'data: {"candidates":\n' + 'data: [{"content":{"parts":[{"text":"응답"}]}}]}\n\n',
	'data: [DONE]\n\n',
].join('');
const bytes = encoder.encode(frames), updates = [];
const split = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
assert.equal(await readGeminiStream(split, undefined, text => updates.push(text)), '한글 응답');
assert.deepEqual(updates, ['한글 ', '한글 응답']);
assert.equal(split.locked, false);

let cancelled = 0;
const stalled = new ReadableStream({ cancel() { cancelled++; } });
const abort = new AbortController(), pending = readChatSse(stalled, abort.signal, () => {});
abort.abort(); await assert.rejects(pending, error => error.name === 'AbortError');
assert.equal(cancelled, 1); assert.equal(stalled.locked, false);

for (const [data, consume] of [['data: not-json\n\n', () => {}], ['data: {}\n\n', () => { throw new Error('consume failed'); }]]) {
	let cleaned = false;
	const stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(data)); }, cancel() { cleaned = true; } });
	await assert.rejects(readChatSse(stream, undefined, consume));
	assert(cleaned); assert.equal(stream.locked, false);
}

let finish;
const late = new Promise(resolve => { finish = resolve; }), stop = new AbortController();
const ignored = abortableChat(late, stop.signal); stop.abort(); finish('late value');
await assert.rejects(ignored, error => error.name === 'AbortError');
const { requestGeminiStream } = loadTsFixture('src/aichat/GeminiTransport.ts');
const originalFetch = globalThis.fetch;
try {
	const controller = new AbortController();
	globalThis.fetch = async (url, init) => {
		assert.equal(url, 'https://example.invalid/synthetic-stream');
		assert.equal(init.method, 'POST'); assert.equal(init.body, '{"synthetic":true}');
		assert.equal(init.headers['x-goog-api-key'], 'synthetic-key'); assert.equal(init.signal, controller.signal);
		return new Response('data: [DONE]\n\n');
	};
	const response = await requestGeminiStream('https://example.invalid/synthetic-stream', 'synthetic-key', '{"synthetic":true}', controller.signal);
	assert(response.body); await readChatSse(response.body, controller.signal, () => {});
} finally { globalThis.fetch = originalFetch; }
console.log('PASS shared SSE decoder: split UTF-8/frames, private thought filtering, pending-read abort and failure cleanup. No API calls.');
