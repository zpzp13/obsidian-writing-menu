import type { DataAdapter } from 'obsidian';

const queues = new WeakMap<DataAdapter, Map<string, Promise<unknown>>>();
export async function withChatWrite<T>(adapter: DataAdapter, path: string, action: () => Promise<T>): Promise<T> {
	let map = queues.get(adapter); if (!map) { map = new Map(); queues.set(adapter, map); }
	const task = (map.get(path) ?? Promise.resolve()).catch(() => {}).then(action); map.set(path, task);
	try { return await task; } finally { if (map.get(path) === task) map.delete(path); }
}
export async function readChatJson(adapter: DataAdapter, path: string): Promise<string | null> { return await adapter.exists(path) ? adapter.read(path) : null; }
export async function writeChatJson(adapter: DataAdapter, path: string, value: unknown, expected: string | null): Promise<string> {
	const current = await readChatJson(adapter, path);
	if (current !== expected) throw new Error('다른 곳에서 대화 기록을 변경했습니다. 다시 불러와 주세요.');
	if (current !== null) {
		await adapter.write(`${path}.bak`, current);
		if (await adapter.read(`${path}.bak`) !== current) throw new Error('이전 대화 백업을 검증하지 못했습니다.');
	}
	if (await readChatJson(adapter, path) !== expected) throw new Error('백업 중 다른 곳에서 대화를 변경했습니다. 다시 불러와 주세요.');
	const text = JSON.stringify(value, null, 2); await adapter.write(path, text);
	if (await adapter.read(path) !== text) throw new Error('대화 저장을 검증하지 못했습니다.');
	return text;
}
