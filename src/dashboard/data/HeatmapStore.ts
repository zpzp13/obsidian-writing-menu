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
	days: Record<string, Record<string, number>>; // dateStr → { __all__: netChars }
	today: TodayData | null;
}

export class HeatmapStore {
	private storage: HeatmapStorage = { days: {}, today: null };
	private saveTimer = 0;
	private ready = false;

	constructor(private plugin: WritingMenuPlugin) {}

	async init() {
		await this.load();
		const todayStr = this.todayStr();
		if (!this.storage.today || this.storage.today.date !== todayStr) {
			if (this.storage.today) this.compactDay(this.storage.today);
			this.storage.today = { date: todayStr, start: await this.snapshotAll(), current: {} };
			this.scheduleSave();
		}
		this.ready = true;
	}

	async onFileModify(file: TFile) {
		if (!this.ready || !this.storage.today) return;
		if (file.extension !== 'md' || this.inVersionFolder(file.path)) return;
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
		if (!this.storage.today) return 0;
		return this.netForDay(this.storage.today.start, this.storage.today.current);
	}

	/** Net chars written today, filtered to files inside a specific folder. */
	getTodayTotalForFolder(folder: string): number {
		if (!folder) return this.getTodayTotal();
		if (!this.storage.today) return 0;
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
		return this.storage.days[dateStr]?.[ALL_KEY] ?? 0;
	}

	/** Mean chars/day across all days with data. */
	getDailyAverage(): number {
		const values = Object.values(this.storage.days)
			.map(d => d[ALL_KEY] ?? 0)
			.filter(n => n > 0);
		if (values.length === 0) return 0;
		return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
	}

	/** Per-file breakdown for today (sorted by written desc). */
	getTodayFileBreakdown(): { path: string; name: string; written: number; total: number }[] {
		if (!this.storage.today) return [];
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

	private compactDay(data: TodayData) {
		const net = this.netForDay(data.start, data.current);
		if (net > 0) this.storage.days[data.date] = { [ALL_KEY]: net };
	}

	private async snapshotAll(): Promise<Record<string, number>> {
		const snapshot: Record<string, number> = {};
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			if (this.inVersionFolder(file.path)) continue;
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
			if (!this.storage.days) this.storage.days = {};
		} catch {
			this.storage = { days: {}, today: null };
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
