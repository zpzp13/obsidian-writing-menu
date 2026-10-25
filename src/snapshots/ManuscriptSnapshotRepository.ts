import { wmT } from '../i18n/index';
import { FileSystemAdapter, normalizePath } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { calcAllCharCounts } from '../utils/charCount';
import type { ManuscriptSnapshot, ManuscriptSnapshotManifest } from './ManuscriptSnapshotTypes';

const queues = new WeakMap<object, Map<string, Promise<unknown>>>();
export function snapshotStorageRoot(value: string): string {
	const root = normalizePath(value.trim() || '.writing-menu-versions');
	if (/^[\\/]|:/.test(root) || root.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(wmT("볼트 내부의 스냅샷 폴더를 지정해 주세요."));
	return root;
}
function encodePath(path: string): string {
	const encoded = encodeURIComponent(path);
	if (encoded.length <= 200) return encoded;
	let hash = 0;
	for (let i = 0; i < path.length; i++) hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0;
	return Math.abs(hash).toString(16).padStart(8, '0');
}

export class ManuscriptSnapshotRepository {
	readonly root: string;
	readonly directory: string;
	private readonly adapter;
	constructor(private readonly plugin: WritingMenuPlugin, readonly sourcePath: string) {
		this.adapter = plugin.app.vault.adapter;
		this.root = snapshotStorageRoot(plugin.settings.snapshotStoragePath);
		this.directory = `${this.root}/${encodePath(sourcePath)}`;
	}
	private async serial<T>(action: () => Promise<T>): Promise<T> {
		let map = queues.get(this.adapter);
		if (!map) { map = new Map(); queues.set(this.adapter, map); }
		const prior = map.get(this.directory) ?? Promise.resolve();
		const task = prior.catch(() => {}).then(action);
		map.set(this.directory, task);
		try { return await task; } finally { if (map.get(this.directory) === task) map.delete(this.directory); }
	}
	private path(entry: ManuscriptSnapshot): string {
		if (!entry.fileName || /[\\/]/.test(entry.fileName) || !/^[^:]+\.md$/.test(entry.fileName) || entry.fileName.startsWith('.')) throw new Error(wmT("스냅샷 파일 경로가 올바르지 않습니다."));
		return `${this.directory}/${entry.fileName}`;
	}
	private async readManifest(): Promise<{ data: ManuscriptSnapshotManifest; raw: string | null }> {
		const path = `${this.directory}/manifest.json`;
		if (!await this.adapter.exists(path)) return { data: { filePath: this.sourcePath, versions: [] }, raw: null };
		const raw = await this.adapter.read(path);
		let data: ManuscriptSnapshotManifest;
		try { data = JSON.parse(raw) as ManuscriptSnapshotManifest; } catch { throw new Error(wmT("스냅샷 목록이 손상되었습니다. 기존 기록은 덮어쓰지 않았습니다.")); }
		if (data?.filePath !== this.sourcePath || !Array.isArray(data.versions)) throw new Error(wmT("스냅샷 목록의 대상 문서가 일치하지 않습니다."));
		const ids = new Set<string>();
		for (const entry of data.versions) {
			if (!entry || typeof entry.id !== 'string' || ids.has(entry.id) || typeof entry.name !== 'string' || !Number.isFinite(entry.timestamp)) throw new Error(wmT("스냅샷 목록의 형식이 올바르지 않습니다."));
			this.path(entry); ids.add(entry.id);
		}
		return { data, raw };
	}
	private async mkdir(path: string): Promise<void> {
		const parts = path.split('/');
		for (let i = 1; i <= parts.length; i++) {
			const current = parts.slice(0, i).join('/');
			if (!await this.adapter.exists(current)) {
				try { await this.adapter.mkdir(current); } catch (error) { if (!await this.adapter.exists(current)) throw error; }
			}
		}
	}
	private async publish(data: ManuscriptSnapshotManifest, previous: string | null): Promise<void> {
		await this.mkdir(this.directory);
		const path = `${this.directory}/manifest.json`;
		const current = await this.adapter.exists(path) ? await this.adapter.read(path) : null;
		if (current !== previous) throw new Error(wmT("다른 곳에서 스냅샷 목록을 변경했습니다. 다시 열어 주세요."));
		if (previous !== null) {
			await this.adapter.write(`${this.directory}/manifest.previous.json`, previous);
			if (await this.adapter.read(`${this.directory}/manifest.previous.json`) !== previous) throw new Error(wmT("이전 목록 백업을 검증하지 못했습니다."));
		}
		const text = JSON.stringify(data, null, 2);
		if ((await this.adapter.exists(path) ? await this.adapter.read(path) : null) !== previous) throw new Error(wmT("목록 백업 중 외부 변경이 감지되었습니다. 다시 열어 주세요."));
		await this.adapter.write(path, text);
		if (await this.adapter.read(path) !== text) throw new Error(wmT("스냅샷 목록 저장을 검증하지 못했습니다."));
	}
	async list(): Promise<ManuscriptSnapshot[]> { return (await this.readManifest()).data.versions.slice().sort((a, b) => b.timestamp - a.timestamp); }
	/** Move only this verified history directory; user manuscripts are never moved. */
	async rebind(nextPath: string): Promise<void> {
		await this.serial(async () => {
			if (!await this.adapter.exists(`${this.directory}/manifest.json`)) return;
			const { data, raw } = await this.readManifest();
			const next = new ManuscriptSnapshotRepository(this.plugin, nextPath);
			const windowsAlias = this.adapter instanceof FileSystemAdapter && /^[a-z]:/i.test(this.adapter.getBasePath()) && next.directory.toLowerCase() === this.directory.toLowerCase();
			if (next.directory !== this.directory && await this.adapter.exists(next.directory) && !windowsAlias) throw new Error(wmT("이동 대상에 스냅샷 기록이 이미 있습니다. 두 기록을 보존했습니다."));
			const updated = { ...data, filePath: nextPath };
			await this.publish(updated, raw);
			try { if (next.directory !== this.directory && !windowsAlias) await this.adapter.rename(this.directory, next.directory); }
			catch (error) {
				// Roll back only if no other writer has changed the just-published manifest.
				if (await this.adapter.read(`${this.directory}/manifest.json`) === JSON.stringify(updated, null, 2)) await this.publish(data, JSON.stringify(updated, null, 2));
				throw error;
			}
		});
	}
	async read(entry: ManuscriptSnapshot): Promise<string> { return this.adapter.read(this.path(entry)); }
	async save(name: string, source: string, backup = false): Promise<ManuscriptSnapshot> {
		return this.serial(async () => {
			const { data, raw } = await this.readManifest();
			const id = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
			const counts = calcAllCharCounts(source);
			const entry: ManuscriptSnapshot = { id, name: name.trim() || wmT("스냅샷"), timestamp: Date.now(), fileName: `${id}.md`, charCount: counts.novelpia, charCountTotal: counts.munpia, ...(backup ? { backup: true } : {}) };
			await this.mkdir(this.directory);
			if (await this.adapter.exists(this.path(entry))) throw new Error(wmT("중복 스냅샷 파일이 있습니다. 다시 저장해 주세요."));
			await this.adapter.write(this.path(entry), source);
			if (await this.read(entry) !== source) throw new Error(wmT("스냅샷 본문 저장을 검증하지 못했습니다."));
			data.versions.unshift(entry);
			// Automatic retention archives records instead of destroying manuscript text.
			await this.publish(data, raw);
			return entry;
		});
	}
	async update(id: string, updates: Pick<Partial<ManuscriptSnapshot>, 'name' | 'description' | 'stage' | 'statusId' | 'pinned'>): Promise<void> {
		await this.serial(async () => {
			const { data, raw } = await this.readManifest();
			const entry = data.versions.find(item => item.id === id);
			if (!entry) throw new Error(wmT("스냅샷을 찾을 수 없습니다."));
			Object.assign(entry, updates); await this.publish(data, raw);
		});
	}
	async remove(entry: ManuscriptSnapshot): Promise<void> {
		await this.serial(async () => {
			const { data, raw } = await this.readManifest();
			if (!data.versions.some(item => item.id === entry.id)) throw new Error(wmT("스냅샷을 찾을 수 없습니다."));
			// Keep a recoverable, unindexed copy; a manifest failure cannot erase the source.
			const content = await this.read(entry);
			const trash = `${this.directory}/removed`; await this.mkdir(trash);
			const trashPath = `${trash}/${entry.id}-${Date.now()}.md`;
			await this.adapter.write(trashPath, content);
			if (await this.adapter.read(trashPath) !== content) throw new Error(wmT("삭제 전 보관 사본을 검증하지 못했습니다."));
			data.versions = data.versions.filter(item => item.id !== entry.id);
			await this.publish(data, raw);
			await this.adapter.remove(this.path(entry));
		});
	}
}
