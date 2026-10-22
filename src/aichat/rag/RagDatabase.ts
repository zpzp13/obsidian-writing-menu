import type { RagDocument, RagRecord } from './RagTypes';

type Store = 'assets' | 'documents' | 'records' | 'research';
const opened = new Map<string, Promise<IDBDatabase>>();
/** Device-local storage only. No adapter writes, Sync folders or user note mutations. */
export class RagDatabase {
	constructor(private name = 'writing-menu-local-rag-v1') {}
	private open(): Promise<IDBDatabase> {
		let ready = opened.get(this.name);
		if (!ready) {
			ready = new Promise((resolve, reject) => {
				if (typeof indexedDB === 'undefined') { reject(new Error('이 환경에서는 로컬 색인 저장소를 사용할 수 없습니다.')); return; }
				const request = indexedDB.open(this.name, 3);
				request.onupgradeneeded = () => {
					const db = request.result;
					if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'key' });
					for (const name of ['documents', 'records', 'research']) {
						const store = db.objectStoreNames.contains(name) ? request.transaction!.objectStore(name) : db.createObjectStore(name, { keyPath: 'key' });
						if (!store.indexNames.contains('scope')) store.createIndex('scope', 'scope');
						if (!store.indexNames.contains('scopeKey')) store.createIndex('scopeKey', ['scope', 'key']);
						if (name !== 'documents' && !store.indexNames.contains('documentKey')) store.createIndex('documentKey', 'documentKey');
						if (name === 'records' && !store.indexNames.contains('terms')) store.createIndex('terms', 'termKeys', { multiEntry: true });
					}
				};
				request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opened.delete(this.name); }; resolve(request.result); };
				request.onerror = () => reject(request.error ?? new Error('로컬 저장소를 열지 못했습니다.'));
				request.onblocked = () => reject(new Error('다른 창이 로컬 색인 저장소를 사용 중입니다.'));
			});
			opened.set(this.name, ready); void ready.catch(() => opened.delete(this.name));
		}
		return ready;
	}
	async get<T>(store: Store, key: string): Promise<T | undefined> {
		const db = await this.open();
		return new Promise((resolve, reject) => { const request = db.transaction(store).objectStore(store).get(key); request.onsuccess = () => { const value: unknown = request.result; resolve(value as T | undefined); }; request.onerror = () => reject(request.error ?? new Error('로컬 색인을 읽지 못했습니다.')); });
	}
	async put(store: Store, value: unknown): Promise<void> {
		const db = await this.open();
		return new Promise((resolve, reject) => { const transaction = db.transaction(store, 'readwrite'); transaction.objectStore(store).put(value); transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error('색인을 저장하지 못했습니다. 저장 공간을 확인하세요.')); transaction.onerror = () => {}; });
	}
	/** Page cursor results so large projects never require loading the whole corpus/vectors in RAM. */
	async page<T>(store: 'records' | 'documents' | 'research', index: string, value: string, after?: string, limit = 64): Promise<T[]> {
		const db = await this.open();
		return new Promise((resolve, reject) => {
			const result: T[] = [], transaction = db.transaction(store), request = transaction.objectStore(store).index(index === 'scope' ? 'scopeKey' : index).openCursor(index === 'scope' ? IDBKeyRange.bound([value, after ?? ''], [value, '\uffff'], Boolean(after)) : IDBKeyRange.only(value));
			request.onsuccess = () => { const cursor = request.result; if (!cursor || result.length >= limit) { resolve(result); return; } if (typeof cursor.primaryKey !== 'string') { reject(new Error('로컬 색인의 문서 키가 문자열이 아닙니다.')); return; } const value: unknown = cursor.value; if (!after || cursor.primaryKey > after) result.push(value as T); cursor.continue(); };
			request.onerror = () => reject(request.error ?? new Error('로컬 색인 구간을 읽지 못했습니다.'));
		});
	}
	async *records(scope: string): AsyncGenerator<RagRecord[]> {
		let after: string | undefined;
		while (true) { const page = await this.page<RagRecord>('records', 'scope', scope, after); if (!page.length) return; yield page; after = page[page.length - 1].key; }
	}
	async *documents(scope: string): AsyncGenerator<RagDocument> {
		let after: string | undefined;
		while (true) { const page = await this.page<RagDocument>('documents', 'scope', scope, after); if (!page.length) return; for (const item of page) yield item; after = page[page.length - 1].key; }
	}
	async *matchingRecords(scope: string, terms: Iterable<string>): AsyncGenerator<RagRecord[]> {
		const seen = new Set<string>();
		for (const term of terms) {
			let after: string | undefined;
			while (true) {
				const page = await this.page<RagRecord>('records', 'terms', `${scope}\0${term}`, after); if (!page.length) break;
				after = page[page.length - 1].key;
				const unique = page.filter(record => { if (seen.has(record.key)) return false; seen.add(record.key); return true; });
				if (unique.length) yield unique;
			}
		}
	}
	async removeDocument(key: string): Promise<void> {
		const db = await this.open();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(['documents', 'records', 'research'], 'readwrite'); transaction.objectStore('documents').delete(key);
			const request = transaction.objectStore('records').index('documentKey').openCursor(IDBKeyRange.only(key));
			request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
			const research = transaction.objectStore('research').index('documentKey').openCursor(IDBKeyRange.only(key));
			research.onsuccess = () => { const cursor = research.result; if (cursor) { cursor.delete(); cursor.continue(); } };
			transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error('로컬 색인을 삭제하지 못했습니다.')); transaction.onerror = () => {};
		});
	}
	async pruneDocument(key: string, keep: Set<string>): Promise<void> {
		const db = await this.open();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction('records', 'readwrite'), request = transaction.objectStore('records').index('documentKey').openCursor(IDBKeyRange.only(key));
			request.onsuccess = () => { const cursor = request.result; if (cursor) { if (typeof cursor.primaryKey !== 'string') { reject(new Error('로컬 색인의 문서 키가 문자열이 아닙니다.')); return; } if (!keep.has(cursor.primaryKey)) cursor.delete(); cursor.continue(); } };
			transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error('로컬 색인을 정리하지 못했습니다.')); transaction.onerror = () => {};
		});
	}
	async clearScope(scope: string): Promise<void> {
		const db = await this.open();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(['records', 'documents', 'research'], 'readwrite');
			for (const store of ['records', 'documents', 'research']) { const request = transaction.objectStore(store).index('scope').openCursor(IDBKeyRange.only(scope)); request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } }; }
			transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error('프로젝트 색인을 비우지 못했습니다.')); transaction.onerror = () => {};
		});
	}
}

/** Transformers.js cache stores only public, pinned model assets, never corpus text. */
export function ragAssetCache(database: RagDatabase) {
	return {
		async match(key: string): Promise<Response | undefined> { const item = await database.get<{ blob: Blob; status: number; headers: [string, string][] }>('assets', key); return item ? new Response(item.blob, { status: item.status, headers: item.headers }) : undefined; },
		async put(key: string, response: Response): Promise<void> { if (!response.ok) return; const headers: [string, string][] = []; response.headers.forEach((value, name) => headers.push([name, value])); await database.put('assets', { key, blob: await response.blob(), status: response.status, headers }); },
	};
}
