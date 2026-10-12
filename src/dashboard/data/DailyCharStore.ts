import { TFile, normalizePath } from 'obsidian';

declare const moment: (date?: unknown, fmt?: string, strict?: boolean) => {
	format(f: string): string;
	isValid(): boolean;
};
import type WritingMenuPlugin from '../../../main';
import { calcVersionCharCount } from '../../version/charCount';
import { formatDateKey } from '../../utils/dateUtils';
import { getDnConfig } from '../../utils/dailyNoteUtils';

const STORE_PATH = '.writing-menu-today.json';

interface TodayData {
	date: string;
	start: Record<string, number>;   // filepath → charCount at start of day
	current: Record<string, number>; // filepath → latest charCount
	carried?: Record<string, number>; // 계산 모드 변경 전 이미 누적된 파일별 작성량
}

interface TodayStorage {
	today: TodayData | null;
	trackingFolder?: string;
	charMode?: string;
}

export class DailyCharStore {
	private storage: TodayStorage = { today: null };
	private saveTimer = 0;
	private dailyNoteTimer = 0;
	private avgTimer  = 0;
	private modifyTimers = new Map<string, number>();
	private _avgCharCount = 0;
	private dailyHistory = new Map<string, number>();
	private ready = false;
	onAvgUpdated?: () => void;

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
			this.storage.today = { date: todayStr, start: await this.snapshotAll(), current: {}, carried: {} };
			this.scheduleSave();
		} else if (modeChanged) {
			await this.rollCurrentDeltasIntoCarried();
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

		if (!this.storage.today) {
			this.storage.today = { date: this.todayStr(), start: await this.snapshotAll(), current: {}, carried: {} };
		} else if (modeChanged) {
			await this.rollCurrentDeltasIntoCarried();
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

	destroy(): void {
		window.clearTimeout(this.saveTimer);
		window.clearTimeout(this.dailyNoteTimer);
		window.clearTimeout(this.avgTimer);
		for (const timer of this.modifyTimers.values()) window.clearTimeout(timer);
		this.modifyTimers.clear();
		void this.save();
		void this.writeTodayCharCount();
	}

	async onFileModify(file: TFile) {
		if (!this.ready || !this.storage.today) return;
		if (file.extension !== 'md' || this.inVersionFolder(file.path)) return;

		if (this.inTrackingFolder(file.path)) {
			// 오토세이브마다 즉시 읽지 않고 3초 데바운스
			window.clearTimeout(this.modifyTimers.get(file.path));
			this.modifyTimers.set(file.path, window.setTimeout(() => {
				this.modifyTimers.delete(file.path);
				if (!this.storage.today) return;
				if (this.storage.today.date !== this.todayStr()) {
					void this.init(); return;
				}
				void (async () => {
					try {
						const content = await this.plugin.app.vault.cachedRead(file);
						const count   = calcVersionCharCount(content, this.plugin.settings.charCountMode);
						if (this.storage.today!.current[file.path] === count) return;
						this.storage.today!.current[file.path] = count;
						if (!(file.path in this.storage.today!.start))
							this.storage.today!.start[file.path] = count;
						this.scheduleSave();
						this.onAvgUpdated?.();
					} catch { /* intentional */ }
				})();
			}, 3000));
		}

		const { folder } = getDnConfig(this.plugin);
		if (!folder || file.path.startsWith(normalizePath(folder) + '/')) {
			this.scheduleAvgRecompute();
		}
	}

	/** 오늘 하루 순 글자수 (전체). */
	getTodayTotal(): number {
		if (!this.storage.today || this.storage.today.date !== this.todayStr()) return 0;
		return this.netForDay(this.storage.today.start, this.storage.today.current, this.storage.today.carried);
	}

	/** 오늘 하루 순 글자수 (특정 폴더 내 파일만). */
	getTodayTotalForFolder(folder: string): number {
		if (!folder) return this.getTodayTotal();
		if (!this.storage.today || this.storage.today.date !== this.todayStr()) return 0;
		const prefix = normalizePath(folder) + '/';
		const { start, current, carried = {} } = this.storage.today;
		let total = 0;
		const seen = new Set([...Object.keys(start), ...Object.keys(current), ...Object.keys(carried)]);
		for (const path of seen) {
			if (this.inVersionFolder(path)) continue;
			if (!path.startsWith(prefix)) continue;
			const s = start[path] ?? current[path] ?? 0;
			const c = current[path] ?? s;
			total += Math.max(0, carried[path] ?? 0) + Math.max(0, c - s);
		}
		return total;
	}

	/** 선택 기간의 달력 일평균. 오늘을 포함하고, 기록이 없는 날은 0자로 계산한다. */
	getDailyAverage(days?: number): number {
		if (days && days > 0) {
			const values = this.getDailySeries(days);
			return values.length > 0
				? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
				: 0;
		}
		return this._avgCharCount;
	}

	/** 선택 기간의 날짜별 작성량. 오래된 날짜부터 오늘 순서로 반환한다. */
	getDailySeries(days: number): number[] {
		const period = Math.max(1, Math.floor(days));
		const trackingFolder = this.plugin.settings.trackingFolder ?? '';
		const todayTotal = trackingFolder
			? this.getTodayTotalForFolder(trackingFolder)
			: this.getTodayTotal();
		const todayKey = this.todayStr();
		const cursor = new Date();
		cursor.setHours(0, 0, 0, 0);
		cursor.setDate(cursor.getDate() - (period - 1));

		const values: number[] = [];
		for (let index = 0; index < period; index += 1) {
			const dateKey = formatDateKey(cursor);
			values.push(dateKey === todayKey ? todayTotal : Math.max(0, this.dailyHistory.get(dateKey) ?? 0));
			cursor.setDate(cursor.getDate() + 1);
		}
		return values;
	}

	/** 에디터의 현재 값을 메모리에 즉시 반영한다. 디스크 저장은 기존 3초 디바운스를 그대로 사용한다. */
	updateLiveCount(file: TFile, count: number): void {
		if (!this.ready || !this.storage.today || file.extension !== 'md') return;
		if (this.storage.today.date !== this.todayStr()) {
			void this.init();
			return;
		}
		if (this.inVersionFolder(file.path) || !this.inTrackingFolder(file.path)) return;
		if (this.storage.today.current[file.path] === count) return;
		if (!(file.path in this.storage.today.start)) this.storage.today.start[file.path] = count;
		this.storage.today.current[file.path] = count;
		this.scheduleSave();
	}

	/** 오늘 파일별 작성량 (내림차순). */
	getTodayFileBreakdown(): { path: string; name: string; written: number; total: number }[] {
		if (!this.storage.today || this.storage.today.date !== this.todayStr()) return [];
		const { start, current, carried = {} } = this.storage.today;
		const seen = new Set([...Object.keys(start), ...Object.keys(current), ...Object.keys(carried)]);
		const result: { path: string; name: string; written: number; total: number }[] = [];
		for (const path of seen) {
			if (this.inVersionFolder(path)) continue;
			const s = start[path] ?? current[path] ?? 0;
			const c = current[path] ?? s;
			const written = Math.max(0, carried[path] ?? 0) + Math.max(0, c - s);
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
		const dailyFolder = normalizePath(folder || '/').replace(/^\/+|\/+$/g, '');
		const values: number[] = [];
		this.dailyHistory.clear();

		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			if (normalizePath(file.path) === todayPath) continue;
			const parentPath = normalizePath(file.parent?.path ?? '/').replace(/^\/+|\/+$/g, '');
			if (parentPath !== dailyFolder) continue;
			const parsedDate = moment(file.basename, format, true);
			if (!parsedDate.isValid()) continue;
			const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;
			const v: unknown = fm[key];
			if (typeof v === 'number' && v > 0) {
				values.push(v);
				this.dailyHistory.set(parsedDate.format('YYYY-MM-DD'), v);
			}
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
		this.onAvgUpdated?.();
	}

	private scheduleAvgRecompute() {
		window.clearTimeout(this.avgTimer);
		this.avgTimer = window.setTimeout(() => {
			if (Date.now() - this.plugin.lastTypedAt < 2000) {
				this.scheduleAvgRecompute();
				return;
			}
			void this.computeAvg();
		}, 3000);
	}

	private netForDay(start: Record<string, number>, current: Record<string, number>, carried: Record<string, number> = {}): number {
		let total = 0;
		const seen = new Set([...Object.keys(start), ...Object.keys(current), ...Object.keys(carried)]);
		for (const path of seen) {
			if (this.inVersionFolder(path)) continue;
			const s = start[path] ?? current[path] ?? 0;
			const c = current[path] ?? s;
			total += Math.max(0, carried[path] ?? 0) + Math.max(0, c - s);
		}
		return total;
	}

	private async compactDay(data: TodayData) {
		const folder = this.plugin.settings.trackingFolder ?? '';
		const prefix = folder ? normalizePath(folder) + '/' : null;
		let total = 0;
		const carried = data.carried ?? {};
		const seen = new Set([...Object.keys(data.start), ...Object.keys(data.current), ...Object.keys(carried)]);
		for (const path of seen) {
			if (this.inVersionFolder(path)) continue;
			if (prefix && !path.startsWith(prefix)) continue;
			const s = data.start[path] ?? data.current[path] ?? 0;
			const c = data.current[path] ?? s;
			total += Math.max(0, carried[path] ?? 0) + Math.max(0, c - s);
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
		// 현재 편집 중인 파일과 같으면 병합 충돌 유발 — 저장 건너뜀
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile?.path === dnFile.path) return;
		try {
			await this.plugin.app.fileManager.processFrontMatter(dnFile, (fm: Record<string, unknown>) => { fm[key] = charCount; });
		} catch { /* intentional */ }
	}

	private async snapshotAll(): Promise<Record<string, number>> {
		const snapshot: Record<string, number> = {};
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			if (this.inVersionFolder(file.path)) continue;
			if (!this.inTrackingFolder(file.path)) continue;
			try {
				const content = await this.plugin.app.vault.cachedRead(file);
				snapshot[file.path] = calcVersionCharCount(content, this.plugin.settings.charCountMode);
			} catch { /* intentional */ }
		}
		return snapshot;
	}

	private async rollCurrentDeltasIntoCarried(): Promise<void> {
		const today = this.storage.today;
		if (!today) return;
		const carried = { ...(today.carried ?? {}) };
		const seen = new Set([...Object.keys(today.start), ...Object.keys(today.current)]);
		for (const path of seen) {
			if (this.inVersionFolder(path)) continue;
			const start = today.start[path] ?? today.current[path] ?? 0;
			const current = today.current[path] ?? start;
			const delta = Math.max(0, current - start);
			if (delta > 0) carried[path] = Math.max(0, carried[path] ?? 0) + delta;
		}
		today.carried = carried;
		today.start = await this.snapshotAll();
		today.current = {};
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
		this.saveTimer = window.setTimeout(() => { void this.save(); }, 3000);
		// 데일리노트 frontmatter 갱신은 vault modify 연쇄 이벤트를 유발하므로
		// 메모리/JSON 저장과 분리해 충분한 유휴 시간 뒤 한 번만 동기화한다.
		window.clearTimeout(this.dailyNoteTimer);
		this.dailyNoteTimer = window.setTimeout(() => { void this.writeTodayCharCount(); }, 15000);
	}

	private async writeTodayCharCount() {
		const folder = this.plugin.settings.trackingFolder ?? '';
		const net    = folder ? this.getTodayTotalForFolder(folder) : this.getTodayTotal();
		if (net > 0) await this.writeCharCountToDailyNote(this.todayStr(), net);
	}

	private async load() {
		try {
			const raw    = await this.plugin.app.vault.adapter.read(normalizePath(STORE_PATH));
			const parsed = JSON.parse(raw) as Partial<TodayStorage>;
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
		} catch { /* intentional */ }
	}
}
