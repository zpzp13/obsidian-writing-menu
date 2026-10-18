import { Notice, normalizePath } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { WritingProject } from '../types';
import { LegacyPlotImporter } from './LegacyPlotImporter';
import { PlotWorkbookRepository } from './PlotWorkbookRepository';
import { PlotWorkbookSession } from './PlotWorkbookSession';

export interface PlotWorkbookSessionLease {
	session: PlotWorkbookSession;
	release(): Promise<void>;
}

interface Entry { ready: Promise<PlotWorkbookSession>; session?: PlotWorkbookSession; users: number }

/** A project has one writer and undo history, regardless of how many views show it. */
export class PlotWorkbookSessionStore {
	private readonly entries = new Map<string, Entry>();
	private disposed = false;

	constructor(private readonly load: (project: WritingProject) => Promise<PlotWorkbookSession>) {}

	peek(project: WritingProject): PlotWorkbookSession | null {
		return this.entries.get(this.key(project))?.session ?? null;
	}

	async acquire(project: WritingProject): Promise<PlotWorkbookSessionLease> {
		if (this.disposed) throw new Error('플롯 매니저가 종료되었습니다.');
		const key = this.key(project);
		let entry = this.entries.get(key);
		if (!entry) {
			entry = { ready: Promise.resolve().then(() => this.load(project)), users: 0 };
			this.entries.set(key, entry);
		}
		const current = entry;
		current.users++;
		let session: PlotWorkbookSession;
		try { session = await current.ready; current.session = session; }
		catch (error) {
			current.users--;
			if (this.entries.get(key) === current) this.entries.delete(key);
			throw error;
		}
		if (this.disposed) {
			current.users--;
			throw new Error('플롯 매니저가 종료되었습니다.');
		}
		let released = false;
		return { session, release: async () => {
			if (released) return;
			released = true;
			current.users--;
			if (current.users > 0 || this.disposed) return;
			// On failure retain the dirty writer for a later retry instead of dropping edits.
			await session.flush();
			// A new view may acquire the same model while the final save is running.
			if (current.users === 0 && this.entries.get(key) === current) {
				this.entries.delete(key);
				session.dispose();
			}
		} };
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		const entries = [...this.entries.values()];
		this.entries.clear();
		await Promise.all(entries.map(async entry => {
			try {
				const session = await entry.ready;
				try { await session.flush(); } finally { session.dispose(); }
			}
			catch (error) { new Notice(`플롯 저장을 완료하지 못했습니다: ${String(error)}`); }
		}));
	}

	private key(project: WritingProject): string { return normalizePath(project.rootFolder).replace(/^\/+|\/+$/g, ''); }
}

const stores = new WeakMap<WritingMenuPlugin, PlotWorkbookSessionStore>();

export function plotWorkbookSessions(plugin: WritingMenuPlugin): PlotWorkbookSessionStore {
	let store = stores.get(plugin);
	if (!store) {
		store = new PlotWorkbookSessionStore(async project => {
			const importer = new LegacyPlotImporter(plugin);
			if (importer.matchesProject(project) && await importer.hasSourceData()) {
				try {
					const result = await importer.importInto(project);
					if (result.imported) new Notice('기존 플롯을 “기존 플롯” 시트로 가져왔습니다. 원본 파일은 그대로 보존됩니다.');
				} catch (error) { new Notice(`기존 플롯 가져오기를 건너뛰었습니다: ${String(error)}`); }
			}
			const repository = new PlotWorkbookRepository(plugin, project.rootFolder);
			try {
				const loaded = await repository.loadOrCreate(project.id, project.name);
				if (loaded.warnings.length) new Notice(`플롯 시트를 복구해 열었습니다.\n${loaded.warnings[0]}`);
				return new PlotWorkbookSession(repository, loaded.manifest, loaded.sheets, loaded.foreshadows, loaded.warnings);
			} catch (error) { repository.dispose(); throw error; }
		});
		stores.set(plugin, store);
	}
	return store;
}

export function disposePlotWorkbookSessions(plugin: WritingMenuPlugin): void {
	const store = stores.get(plugin);
	stores.delete(plugin);
	if (store) void store.dispose();
}
