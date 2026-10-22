import { replaceControlCharacters } from '../utils/typeGuards';
import { normalizePath, type TFile, type Vault } from 'obsidian';
import { mergePagedLines } from './PagedThreeWayMerge';

export interface PagedFileConflict { localPath: string; remotePath: string }
export interface PagedConflictReview extends PagedFileConflict { base: string; local: string; remote: string }
export type PagedConflictChoice = 'local' | 'remote' | { content: string; local: string; remote: string };
class ChangedOnDisk extends Error { constructor(readonly content: string) { super('파일이 다른 곳에서 변경되었습니다.'); } }

export function splitPagedFrontmatter(source: string): { prefix: string; body: string } {
	const firstLineEnd = source.indexOf('\n');
	if (firstLineEnd < 0 || source.slice(0, firstLineEnd).replace(/\r$/, '').trim() !== '---') return { prefix: '', body: source };
	let start = firstLineEnd + 1;
	while (start <= source.length) {
		const end = source.indexOf('\n', start), line = source.slice(start, end < 0 ? source.length : end).replace(/\r$/, '').trim();
		if (line === '---' || line === '...') {
			const offset = end < 0 ? source.length : end + 1; return { prefix: source.slice(0, offset), body: source.slice(offset) };
		}
		if (end < 0) break; start = end + 1;
	}
	return { prefix: '', body: source };
}

/** Time/version metadata may change independently; never merge competing body edits. */
export function mergePagedMetadata(base: string, local: string, disk: string): string | null {
	const before = splitPagedFrontmatter(base), current = splitPagedFrontmatter(local), incoming = splitPagedFrontmatter(disk);
	return current.prefix === before.prefix && (incoming.body === before.body || incoming.body === current.body)
		? incoming.prefix + current.body : null;
}

/** One serialized writer, compare-before-write, and no implicit three-way merge. */
export class PagedFileStore {
	private base = '';
	private paused = false;
	private disposed = false;
	private writing = false;
	private revision = 0;
	private readEpoch = 0;
	private queue: Promise<void> = Promise.resolve();
	private remote = '';
	private backedLocal: string | null = null;
	private backedRemote: string | null = null;
	private conflict: PagedFileConflict | null = null;

	constructor(private readonly vault: Vault, private readonly file: TFile, private readonly recoveryFolder: string,
		private readonly current: () => string, private readonly apply: (data: string, clear: boolean) => void,
		private readonly conflicted: (conflict: PagedFileConflict) => void,
		private readonly mergeMetadata: (base: string, local: string, disk: string) => string | null = () => null) {}

	async load(): Promise<void> {
		const data = await this.vault.read(this.file);
		if (this.disposed) return;
		this.base = data;
		if (this.revision) await this.preserveConflict(data);
		else this.apply(data, true);
	}
	changed(): void { this.revision++; }
	// Compare the live buffer, not a latched flag: a completed write must not
	// leave a passive device dirty, nor clear edits made while awaiting IO.
	get hasLocalEdits(): boolean { return this.current() !== this.base; }
	get hasConflict(): boolean { return this.paused; }
	get review(): PagedConflictReview | null { return this.conflict ? { ...this.conflict, base: this.base, local: this.current(), remote: this.remote } : null; }
	dispose(): void { this.disposed = true; this.readEpoch++; }
	async refresh(): Promise<void> {
		if (this.disposed || this.writing) return;
		const epoch = ++this.readEpoch, revision = this.revision;
		const disk = await this.vault.read(this.file);
		if (this.disposed || epoch !== this.readEpoch || revision !== this.revision) return;
		if (disk === this.current()) { this.base = disk; return; }
		if (disk === this.base) return;
		const merged = this.mergeMetadata(this.base, this.current(), disk);
		if (merged !== null) { this.base = disk; this.apply(merged, false); return; }
		if (this.hasLocalEdits || this.paused) {
			await this.enqueue(async () => {
				if (epoch === this.readEpoch && revision === this.revision && !await this.tryMerge(disk)) await this.preserveConflict(disk);
			}); return;
		}
		this.base = disk; this.apply(disk, false);
	}
	save(): Promise<void> {
		return this.enqueue(async () => {
			if (this.paused) { await this.preserveConflict(this.remote); return; }
			while (!this.disposed && this.current() !== this.base) {
				const local = this.current();
				let written = local;
				this.readEpoch++; this.writing = true;
				try {
					await this.vault.process(this.file, disk => {
						if (disk !== this.base && disk !== local) {
							const merged = this.mergeMetadata(this.base, local, disk);
							if (merged === null) throw new ChangedOnDisk(disk);
							written = merged;
						}
						return written;
					});
					this.base = written;
					if (written !== local) {
						const next = this.current() === local ? written : this.mergeMetadata(local, this.current(), written);
						if (next === null) { await this.preserveConflict(written); return; }
						this.apply(next, false);
					}
				} catch (error) {
					if (!(error instanceof ChangedOnDisk)) throw error;
					if (await this.tryMerge(error.content)) continue;
					await this.preserveConflict(error.content); return;
				} finally { this.writing = false; this.readEpoch++; }
			}
		});
	}
	resolve(choice: PagedConflictChoice): Promise<void> {
		return this.enqueue(async () => {
			if (!this.paused || this.disposed) return;
			const local = this.current();
			const revision = this.revision;
			const disk = await this.vault.read(this.file);
			if (typeof choice === 'object' && (choice.local !== local || choice.remote !== disk)) {
				await this.preserveConflict(disk); throw new Error('비교 중 문서가 변경되었습니다. 최신 내용으로 다시 검토해 주세요.');
			}
			// Another Sync update arrived while the choice dialog was open.
			if (disk !== this.remote) { await this.preserveConflict(disk); return; }
			await this.preserveConflict(disk, false);
			if (revision !== this.revision) { await this.preserveConflict(disk); return; }
			if (choice === 'remote') {
				this.base = disk; this.paused = false;
				this.clearConflict();
				this.revision++; this.readEpoch++; this.apply(disk, false); return;
			}
			this.writing = true; this.readEpoch++;
			try {
				await this.vault.process(this.file, latest => {
					if (latest !== disk) throw new ChangedOnDisk(latest);
					return typeof choice === 'object' ? choice.content : local;
				});
				this.base = typeof choice === 'object' ? choice.content : local;
				if (typeof choice === 'object' && revision !== this.revision) { await this.preserveConflict(this.base); return; }
				this.paused = false;
				if (typeof choice === 'object' && revision === this.revision) this.apply(choice.content, false);
				this.clearConflict();
			} catch (error) {
				if (!(error instanceof ChangedOnDisk)) throw error;
				await this.preserveConflict(error.content);
			} finally { this.writing = false; this.readEpoch++; }
		});
	}
	private enqueue(action: () => Promise<void>): Promise<void> {
		const next = this.queue.catch(() => {}).then(() => { if (!this.disposed) return action(); });
		this.queue = next; return next;
	}
	private async tryMerge(disk: string): Promise<boolean> {
		if (this.paused || this.disposed) return false;
		const local = this.current(), revision = this.revision;
		const merged = mergePagedLines(this.base, local, disk);
		if (merged === null) return false;
		// Never commit a merge unless both inputs have verified recovery copies.
		await this.backup('local', local); await this.backup('remote', disk);
		if (revision !== this.revision || this.current() !== local || this.disposed) return false;
		this.writing = true;
		try {
			await this.vault.process(this.file, latest => {
				if (latest !== disk || revision !== this.revision) throw new ChangedOnDisk(latest);
				return merged;
			});
			this.base = merged;
			// Preserve keystrokes that arrived after the atomic callback.
			if (revision === this.revision) this.apply(merged, false);
			else await this.preserveConflict(merged);
			return true;
		} catch (error) {
			if (!(error instanceof ChangedOnDisk)) throw error;
			await this.preserveConflict(error.content); return true;
		} finally { this.writing = false; this.readEpoch++; }
	}
	private async preserveConflict(disk: string, notify = true): Promise<void> {
		this.paused = true; this.remote = disk;
		const local = this.current();
		const localPath = this.backedLocal === local ? this.conflict?.localPath : await this.backup('local', local);
		const remotePath = this.backedRemote === disk ? this.conflict?.remotePath : await this.backup('remote', disk);
		if (!localPath || !remotePath) throw new Error('충돌 복구 파일을 보존하지 못했습니다. 원본에는 저장하지 않았습니다.');
		const announce = !this.conflict || this.backedRemote !== disk;
		this.backedLocal = local; this.backedRemote = disk; this.conflict = { localPath, remotePath };
		if (notify && announce && !this.disposed) this.conflicted(this.conflict);
	}
	private clearConflict(): void { this.conflict = null; this.backedLocal = null; this.backedRemote = null; this.remote = ''; }
	private async backup(kind: string, data: string): Promise<string> {
		const directory = normalizePath(this.recoveryFolder);
		const parts = directory.split('/');
		if (!directory || parts.some(part => !part || part === '..' || part === '.') || /^[a-z]:|^[/\\]/i.test(directory)) throw new Error('복구 폴더 경로가 올바르지 않습니다.');
		for (let index = 1; index <= parts.length; index++) {
			const path = parts.slice(0, index).join('/');
			if (!await this.vault.adapter.exists(path)) {
				try { await this.vault.adapter.mkdir(path); }
				catch (error) { if (!await this.vault.adapter.exists(path)) throw error; }
			}
		}
		const name = replaceControlCharacters(this.file.basename, '_').replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) || 'note';
		const path = `${directory}/${name}-${kind}-${Date.now()}-${crypto.randomUUID()}.md`;
		await this.vault.adapter.write(path, data);
		if (await this.vault.adapter.read(path) !== data) throw new Error('충돌 복구 파일 검증에 실패했습니다.');
		return path;
	}
}
