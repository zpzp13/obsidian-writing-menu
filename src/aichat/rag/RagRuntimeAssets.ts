// The worker is also embedded in main.js so Obsidian's three-file community installer works.
declare const __WM_RAG_WORKER_SOURCE__: string;
export const bundledRagWorker = typeof __WM_RAG_WORKER_SOURCE__ === 'string' ? __WM_RAG_WORKER_SOURCE__ : '';
const VERSION = '1.31.0-dev.20260914-8d85527a0';
const FILES = {
	wasm: { name: 'ort-wasm-simd-threaded.asyncify.wasm', hash: '49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082' },
	module: { name: 'ort-wasm-simd-threaded.asyncify.mjs', hash: '0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611' },
};
import type { RagDatabase } from './RagDatabase';
/** Only public runtime bytes, installed explicitly, pinned and checked before execution. */
export async function runtimeAsset(database: RagDatabase, kind: keyof typeof FILES, install: boolean, signal?: AbortSignal, progress?: (text: string) => void): Promise<ArrayBuffer> {
	const file = FILES[kind], key = `runtime:${VERSION}:${file.hash}`;
	const cached = await database.get<{ blob: Blob }>('assets', key);
	if (cached) return cached.blob.arrayBuffer();
	if (!install) throw new Error('로컬 검색 실행 파일이 없습니다. 설정에서 모델 설치를 실행해 주세요.');
	// ReadableStream supplies byte progress/watchdog signals and immediate cancellation during installation.
	const response = await fetch(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${VERSION}/dist/${file.name}`, { method: 'GET', credentials: 'omit', signal });
	if (!response.ok) throw new Error(`로컬 실행 파일 다운로드 실패 (HTTP ${response.status})`);
	let bytes: ArrayBuffer;
	if (response.body && progress) {
		const reader = response.body.getReader(), parts: Uint8Array[] = []; let loaded = 0, last = 0;
		const total = Number(response.headers.get('content-length'));
		try { while (true) { const part = await reader.read(); if (part.done) break; parts.push(part.value); loaded += part.value.length;
			if (Date.now() - last > 200) { last = Date.now(); progress(`실행 파일 ${file.name} · ${(loaded / 1048576).toFixed(1)}${total ? ` / ${(total / 1048576).toFixed(1)}` : ''} MB`); }
		} } finally { reader.releaseLock(); }
		const result = new Uint8Array(loaded); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } bytes = result.buffer;
	} else bytes = await response.arrayBuffer();
	progress?.(`실행 파일 ${file.name} 무결성 확인 중…`);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
	if (hash !== file.hash) throw new Error('실행 파일 무결성 검사가 실패했습니다. 내려받은 파일은 실행하지 않았습니다.');
	await database.put('assets', { key, blob: new Blob([bytes]) }); return bytes;
}
