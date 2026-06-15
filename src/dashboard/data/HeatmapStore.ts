import { TFile, normalizePath } from 'obsidian';
import type WritingMenuPlugin from '../../../main';
import { calcVersionCharCount } from '../../version/charCount';

const STORE_PATH = '.writing-menu-heatmap.json';
const ALL_KEY = '__all__';

interface TodayData {
	date: string;
	start: Record<string, number>;   // filepath → charCount at start of day
	current: Record<string, number>; // filepath → latest charCount
}

interface HeatmapStorage {
	folderDays: Record<string, Record<string, Record<string, number>>>; // folderKey → dateStr → { __all__: netChars }
	days?: Record<string, Record<string, number>>; // legacy — migrated on load
	today: TodayData | null;
	trackingFolder?: string;
	charMode?: string; // tracks charCountMode to detect changes that need snapshot reset
}

export class HeatmapStore {
	private storage: HeatmapStorage = { folderDays: {}, today: null };
	private saveTimer = 0;
	private ready = false;

	constructor(private plugin: WritingMenuPlugin) {}

	private folderKey(): string {
		const f = this.plugin.settings.heatmapFolder ?? '';
		return f ? normalizePath(f) : '';
	}

	private getFolderDays(): Record<string, Record<string, number>> {
		const k = this.folderKey();
		if (!this.storage.folderDays[k]) this.storage.folderDays[k] = {};
		return this.storage.folderDays[k];
	}

	async init() {
		await this.load();
		const todayStr = this.todayStr();
		const currentMode = this.plugin.settings.charCountMode ?? 'munpia';
		this.storage.trackingFolder = this.plugin.settings.heatmapFolder ?? '';

		const modeChanged = (this.storage.charMode ?? 'munpia') !== currentMode;
		this.storage.charMode = currentMode;

		if (!this.storage.today || this.storage.today.date !== todayStr) {
			// Day rolled over — compact previous day, start fresh
			if (this.storage.today) this.compactDay(this.storage.today);
			this.storage.today = { date: todayStr, start: await this.snapshotAll(), current: {} };
			this.scheduleSave();
		} else if (modeChanged) {
			// charCountMode changed — retake baseline so delta is meaningful
			this.storage.today.start = await this.snapshotAll();
			this.storage.today.current = {};
			this.scheduleSave();
		}
		this.ready = true;
	}

	// Called on settings save.
	// Folder change: merges new folder's files into today.start (preserves existing delta).
	// charCountMode change: full snapshot reset.
	async reinitSnapshot() {
		const currentMode = this.plugin.settings.charCountMode ?? 'munpia';
		this.storage.trackingFolder = this.plugin.settings.heatmapFolder ?? '';

		const modeChanged = (this.storage.charMode ?? 'munpia') !== currentMode;
		this.storage.charMode = currentMode;

		if (!this.storage.today || modeChanged) {
			// First init or counting method changed — full reset
			this.storage.today = { date: this.todayStr(), start: await this.snapshotAll(), current: {} };
		} else {
			// Folder changed or other settings: keep today's delta, add new folder files to start baseline
			const newSnapshot = await this.snapshotAll();
			for (const [path, count] of Object.entries(newSnapshot)) {
				if (!(path in this.storage.today.start)) {
					this.storage.today.start[path] = count;
				}
			}
			// Do NOT reset current — preserves intraday progress
		}
		this.scheduleSave();
	}

	async onFileModify(file: TFile) {
		if (!this.ready || !this.storage.today) return;
		if (file.extension !== 'md' || this.inVersionFolder(file.path)) return;
		if (!this.inTrackingFolder(file.path)) return;
		if (this.storage.today.date !== this.todayStr()) {
			await this.init();
			return;
		}
		try {
			const content = await this.plugin.app.vault.read(file);
			const count = calcVersionCharCount(content, this.plugin.settings.charCountMode);
			this.storage.today.current[file.path] = count;
			if (!(file.path in this.storage.today.start)) {
				this.storage.today.start[file.path] = count;
			}
			this.scheduleSave();
		} catch {}
	}

	/** Net chars written today (all notes). */
	getTodayTotal(): number {
		if (!this.storage.today || this.storage.today.date !== this.todayStr()) return 0;
		return this.netForDay(this.storage.today.start, this.storage.today.current);
	}

	/** Net chars written today, filtered to files inside a specific folder. */
	getTodayTotalForFolder(folder: string): number {
		if (!folder) return this.getTodayTotal();
		if (!this.storage.today || this.storage.today.date !== this.todayStr()) return 0;
		const prefix = normalizePath(folder) + '/';
		const { start, current } = this.storage.today;
		let total = 0;
		const seen = new Set([...Object.keys(start), ...Object.keys(current)]);
		for (const path of seen) {
			if (this.inVersionFolder(path)) continue;
			if (!path.startsWith(prefix)) continue;
			const s = start[path] ?? current[path] ?? 0;
			const c = current[path] ?? s;
			total += Math.max(0, c - s);
		}
		return total;
	}

	/** Net chars written on a past date. */
	getHistoricalTotal(dateStr: string): number {
		return this.getFolderDays()[dateStr]?.[ALL_KEY] ?? 0;
	}

	/** Mean chars/day across all days with data (includes today if not yet compacted). */
	getDailyAverage(): number {
		const days = this.getFolderDays();
		const todayStr = this.todayStr();
		const values = Object.values(days)
			.map(d => d[ALL_KEY] ?? 0)
			.filter(n => n > 0);
		// include today's running total if it hasn't been compacted yet
		if (!days[todayStr]) {
			const folder = this.plugin.settings.heatmapFolder ?? '';
			const todayNet = folder ? this.getTodayTotalForFolder(folder) : this.getTodayTotal();
			if (todayNet > 0) values.push(todayNet);
		}
		if (values.length === 0) return 0;
		return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
	}

	/** Per-file breakdown for today (sorted by written desc). */
	getTodayFileBreakdown(): { path: string; name: string; written: number; total: number }[] {
		if (!this.storage.today || this.storage.today.date !== this.todayStr()) return [];
		const { start, current } = this.storage.today;
		const seen = new Set([...Object.keys(start), ...Object.keys(current)]);
		const result: { path: string; name: string; written: number; total: number }[] = [];
		for (const path of seen) {
			if (this.inVersionFolder(path)) continue;
			const s = start[path] ?? current[path] ?? 0;
			const c = current[path] ?? s;
			const written = Math.max(0, c - s);
			if (written === 0) continue;
			const name = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
			result.push({ path, name, written, total: c });
		}
		return result.sort((a, b) => b.written - a.written);
	}

	private netForDay(start: Record<string, number>, current: Record<string, number>): number {
		let total = 0;
		const seen = new Set([...Object.keys(start), ...Object.keys(current)]);
		for (const path of seen) {
			if (this.inVersionFolder(path)) continue;
			const s = start[path] ?? current[path] ?? 0;
			const c = current[path] ?? s;
			total += Math.max(0, c - s);
		}
		return total;
	}

	// Computes folder-specific net from today's data and saves to current folder bucket.
	private compactDay(data: TodayData) {
		const folder = this.plugin.settings.heatmapFolder ?? '';
		const prefix = folder ? normalizePath(folder) + '/' : null;
		let total = 0;
		const seen = new Set([...Object.keys(data.start), ...Object.keys(data.current)]);
		for (const path of seen) {
			if (this.inVersionFolder(path)) continue;
			if (prefix && !path.startsWith(prefix)) continue;
			const s = data.start[path] ?? data.current[path] ?? 0;
			const c = data.current[path] ?? s;
			total += Math.max(0, c - s);
		}
		if (total > 0) this.getFolderDays()[data.date] = { [ALL_KEY]: total };
	}

	private async snapshotAll(): Promise<Record<string, number>> {
		const snapshot: Record<string, number> = {};
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			if (this.inVersionFolder(file.path)) continue;
			if (!this.inTrackingFolder(file.path)) continue;
			try {
				const content = await this.plugin.app.vault.cachedRead(file);
				snapshot[file.path] = calcVersionCharCount(content, this.plugin.settings.charCountMode);
			} catch {}
		}
		return snapshot;
	}

	private inVersionFolder(path: string): boolean {
		const vp = normalizePath(this.plugin.settings.versionStoragePath || '.writing-menu-versions');
		return path.startsWith(vp + '/');
	}

	private inTrackingFolder(path: string): boolean {
		const folder = this.plugin.settings.heatmapFolder ?? '';
		if (!folder) return true;
		return path.startsWith(normalizePath(folder) + '/');
	}

	private todayStr(): string {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	private scheduleSave() {
		clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => this.save(), 3000);
	}

	private async load() {
		try {
			const raw = await this.plugin.app.vault.adapter.read(normalizePath(STORE_PATH));
			this.storage = JSON.parse(raw);
			if (!this.storage.folderDays) this.storage.folderDays = {};
			// migrate legacy flat `days` → folderDays[trackingFolder ?? '']
			if (this.storage.days && Object.keys(this.storage.days).length > 0) {
				const legacyKey = this.storage.trackingFolder
					? normalizePath(this.storage.trackingFolder)
					: '';
				if (!this.storage.folderDays[legacyKey]) {
					this.storage.folderDays[legacyKey] = this.storage.days;
				}
				delete this.storage.days;
				this.scheduleSave(); // persist migrated format to disk
			}
		} catch {
			this.storage = { folderDays: {}, today: null };
		}
	}

	private async save() {
		try {
			await this.plugin.app.vault.adapter.write(
				normalizePath(STORE_PATH),
				JSON.stringify(this.storage),
			);
		} catch {}
	}
}
