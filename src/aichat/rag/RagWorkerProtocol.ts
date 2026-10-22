import { isRecord, isUnknownArray } from '../../utils/typeGuards';
import type { TextWindow } from './RagChunking';

export interface RagWorkerProgress { file?: string; status?: string; message?: string; loaded?: number; total?: number; progress?: number }
export type RagWorkerRequest = { id: number } & (
	{ op: 'init'; data: { install: boolean; wasm: ArrayBuffer; module: string } }
	| { op: 'chunks'; data: { text: string; title: string } }
	| { op: 'embed'; data: { text: string; query: boolean } }
);

export function readWorkerRequest(value: unknown): RagWorkerRequest {
	if (isRecord(value) && typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id > 0 && isRecord(value.data)) {
		const data = value.data;
		if (value.op === 'init' && typeof data.install === 'boolean' && data.wasm instanceof ArrayBuffer && typeof data.module === 'string')
			return { id: value.id, op: value.op, data: { install: data.install, wasm: data.wasm, module: data.module } };
		if (value.op === 'chunks' && typeof data.text === 'string' && typeof data.title === 'string')
			return { id: value.id, op: value.op, data: { text: data.text, title: data.title } };
		if (value.op === 'embed' && typeof data.text === 'string' && typeof data.query === 'boolean')
			return { id: value.id, op: value.op, data: { text: data.text, query: data.query } };
	}
	throw new Error('로컬 검색 Worker 요청 형식이 올바르지 않습니다.');
}

export function readWorkerProgress(value: unknown): RagWorkerProgress {
	if (!isRecord(value)) throw new Error('로컬 검색 진행 정보가 올바르지 않습니다.');
	const result: RagWorkerProgress = {};
	for (const key of ['file', 'status', 'message'] as const) if (typeof value[key] === 'string') result[key] = value[key];
	for (const key of ['loaded', 'total', 'progress'] as const) if (typeof value[key] === 'number' && Number.isFinite(value[key])) result[key] = value[key];
	return result;
}

export function readWorkerWindows(value: unknown): TextWindow[] {
	if (isUnknownArray(value) && value.every((entry): entry is TextWindow => isRecord(entry) && typeof entry.text === 'string' && typeof entry.location === 'string'
		&& typeof entry.from === 'number' && Number.isSafeInteger(entry.from) && entry.from >= 0
		&& typeof entry.to === 'number' && Number.isSafeInteger(entry.to) && entry.to >= entry.from)) return value;
	throw new Error('로컬 검색 구간 형식이 올바르지 않습니다.');
}

/** Transformers tensors may also contain bigint data; embeddings require finite numbers. */
export function readEmbedding(value: unknown): Float32Array {
	if (isRecord(value) && (isUnknownArray(value.data) || ArrayBuffer.isView(value.data)) && !(value.data instanceof DataView)) {
		const data = Array.from(value.data as ArrayLike<unknown>);
		if (data.length === 384 && data.every((item): item is number => typeof item === 'number' && Number.isFinite(item))) return Float32Array.from(data);
	}
	throw new Error('검색 모델 출력 형식이 올바르지 않습니다.');
}
