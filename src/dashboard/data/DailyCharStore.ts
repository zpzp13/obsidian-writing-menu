import { TFile, normalizePath } from 'obsidian';

declare const moment: (date?: unknown, fmt?: string) => { format(f: string): string };
import type WritingMenuPlugin from '../../../main';
import { calcVersionCharCount } from '../../version/charCount';
import { formatDateKey } from '../../utils/dateUtils';
import { getDnConfig } from '../../utils/dailyNoteUtils';

const STORE_PATH = '.writing-menu-today.json';

interface TodayData {
	date: string;
	start: Record<string, number>;   // filepath → charCount at start of day
	current: Record<string, number>; // filepath → latest charCount
}

interface TodayStorage {
	today: TodayData | null;
	trackingFolder?: string;
	charMode?: string;
}

export class DailyCharStore {
	private storage: TodayStorage = { today: null };
	private saveTimer = 0;
	private avgTimer  = 0;
	private _avgCharCount = 0;
	private ready = false;

	constructor(private plugin: WritingMenuPlugin) {}

	async init() {
		await this.load();
		const todayStr     = this.todayStr();
		const currentMode  = this.plugin.settings.charCountMode ?? 'munpia';
		this.storage.trackingFolder = this.plugin.settings.trackingFolder ?? '';

		const modeChanged = (this.storage.charMode ?? 'munpia') !== currentMode;
		this.storage.charMode = currentMode;

		if (!this.storage.today || this.storage.today.date !== todayStr) {
			if (this.storage.today) await this.compactDay(this.storage.today);
			this.storage.today = { date: todayStr, start: await this.snapshotAll(), current: {} };
			this.scheduleSave();
		} else if (modeChanged) {
			this.storage.today.start = await this.snapshotAll();
			this.storage.today.current = {};
			this.scheduleSave();
		}

		await this.computeAvg();
		this.ready = true;
	}

	async reinitSnapshot() {
		const currentMode = this.plugin.settings.charCountMode ?? 'munpia';
		this.storage.trackingFolder = this.plugin.settings.trackingFolder ?? '';

		const modeChanged = (this.storage.charMode ?? 'munpia') !== currentMode;
		this.storage.charMode = currentMode;

		if (!this.storage.today || modeChanged) {
			this.storage.today = { date: this.todayStr(), start: await this.snapshotAll(), current: {} };
		} else {
			const newSnapshot = await this.snapshotAll();
			for (const [path, count] of Object.entries(newSnapshot)) {
				if (!(path in this.storage.today.start)) {
					this.storage.today.start[path] = count;
				}
			}
		}
		this.scheduleSave();
		this.scheduleAvgRecompute();
	}

	async onFileModify(file: TFile) {
		if (!this.ready || !this.storage.today) return;
		if (file.extension !== 'md' || this.inVersionFolder(file.path)) return;

		if (this.inTrackingFolder(file.path)) {
			if (this.storage.today.date !== this.todayStr()) {
				await this.init();
				return;
			}
			try {
				const content = await this.plugin.app.vault.read(file);
				const count   = calcVersionCharCount(content, this.plugin.settings.charCountMode);
				this.storage.today.current[file.path] = count;
				if (!(file.path in this.storage.today.start))
					this.storage.today.start[file.path] = count;
				this.scheduleSave();
			} catch (_e) {}
		}

		const { folder } = getDnConfig(this.plugin);
		if (!folder || file.path.startsWith(normalizePath(folder) + '/')) {
			this.scheduleAvgRecompute();
		}
	}

	/** 오늘 하루 순 글자수 (전체). */
	getTodayTotal(): number {
		if (!this.storage.today || this.storage.today.date !== this.todayStr()) return 0;
		return this.netForDay(this.storage.today.start, this.storage.today.current);
	}

	/** 오늘 하루 순 글자수 (특정 폴더 내 파일만). */
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

	/** 캐싱된 일평균 글자수 (데일리노트 스캔 기반). */
	getDailyAverage(): number {
		return this._avgCharCount;
	}

	/** 오늘 파일별 작성량 (내림차순). */
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

	// ── private ─────────────────────────────────────────────────────────────

	private async computeAvg() {
		const { folder, format } = getDnConfig(this.plugin);
		const key        = this.plugin.settings.dailyCharCountKey || '글자수';
		const todayStr   = this.todayStr();
		const todayName  = moment(todayStr, 'YYYY-MM-DD').format(format);
		const todayPath  = normalizePath(folder ? `${folder}/${todayName}.md` : `${todayName}.md`);
		const dnPrefix   = folder ? normalizePath(folder) + '/' : null;
		const values: number[] = [];

		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			if (normalizePath(file.path) === todayPath) continue;
			if (dnPrefix && !file.path.startsWith(dnPrefix)) continue;
			const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;
			const v = fm[key];
			if (typeof v === 'number' && v > 0) values.push(v);
		}

		// 오늘 라이브 집계 추가 (아직 데일리노트에 쓰이기 전)
		const trackingFolder = this.plugin.settings.trackingFolder ?? '';
		const todayNet = trackingFolder
			? this.getTodayTotalForFolder(trackingFolder)
			: this.getTodayTotal();
		if (todayNet > 0) values.push(todayNet);

		this._avgCharCount = values.length > 0
			? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
			: 0;
	}

	private scheduleAvgRecompute() {
		window.clearTimeout(this.avgTimer);
		this.avgTimer = window.setTimeout(() => this.computeAvg(), 2000);
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

	private async compactDay(data: TodayData) {
		const folder = this.plugin.settings.trackingFolder ?? '';
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
		if (total > 0) await this.writeCharCountToDailyNote(data.date, total);
	}

	private async writeCharCountToDailyNote(dateStr: string, charCount: number) {
		const key    = this.plugin.settings.dailyCharCountKey || '글자수';
		const { folder, format } = getDnConfig(this.plugin);
		const name   = moment(dateStr, 'YYYY-MM-DD').format(format);
		const dnPath = folder ? `${folder}/${name}.md` : `${name}.md`;
		let dnFile   = this.plugin.app.vault.getAbstractFileByPath(dnPath);
		if (!(dnFile instanceof TFile)) {
			try { dnFile = await this.plugin.app.vault.create(dnPath, '---\n---\n'); } catch { return; }
		}
		if (!(dnFile instanceof TFile)) return;
		try {
			await this.plugin.app.fileManager.processFrontMatter(dnFile, fm => { fm[key] = charCount; });
		} catch (_e) {}
	}

	private async snapshotAll(): Promise<Record<string, number>> {
		const snapshot: Record<string, number> = {};
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			if (this.inVersionFolder(file.path)) continue;
			if (!this.inTrackingFolder(file.path)) continue;
			try {
				const content = await this.plugin.app.vault.cachedRead(file);
				snapshot[file.path] = calcVersionCharCount(content, this.plugin.settings.charCountMode);
			} catch (_e) {}
		}
		return snapshot;
	}

	private inVersionFolder(path: string): boolean {
		const vp = normalizePath(this.plugin.settings.versionStoragePath || '.writing-menu-versions');
		return path.startsWith(vp + '/');
	}

	private inTrackingFolder(path: string): boolean {
		const folder = this.plugin.settings.trackingFolder ?? '';
		if (!folder) return true;
		return path.startsWith(normalizePath(folder) + '/');
	}

	private todayStr(): string {
		return formatDateKey(new Date());
	}

	private scheduleSave() {
		window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(async () => {
			await this.save();
			await this.writeTodayCharCount();
		}, 3000);
	}

	private async writeTodayCharCount() {
		const folder = this.plugin.settings.trackingFolder ?? '';
		const net    = folder ? this.getTodayTotalForFolder(folder) : this.getTodayTotal();
		if (net > 0) await this.writeCharCountToDailyNote(this.todayStr(), net);
	}

	private async load() {
		try {
			const raw    = await this.plugin.app.vault.adapter.read(normalizePath(STORE_PATH));
			const parsed = JSON.parse(raw);
			this.storage = {
				today:          parsed.today ?? null,
				trackingFolder: parsed.trackingFolder,
				charMode:       parsed.charMode,
			};
		} catch {
			this.storage = { today: null };
		}
	}

	private async save() {
		try {
			await this.plugin.app.vault.adapter.write(
				normalizePath(STORE_PATH),
				JSON.stringify(this.storage),
			);
		} catch (_e) {}
	}
}
