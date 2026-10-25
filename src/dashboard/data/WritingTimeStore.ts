import { wmT } from '../../i18n/index';
import { normalizePath, TFile } from 'obsidian';

declare const moment: (date?: unknown, fmt?: string) => { format(f: string): string };
import type { App } from 'obsidian';
import type { TimeModeConfig } from '../../types';
import type WritingMenuPlugin from '../../../main';

export type ModeTime = Record<string, number>;

export interface ModeStat {
	avg:   Record<string, number>;
	count: Record<string, number>;
}

export interface DailyModeTime {
	date: string;
	values: Record<string, number>;
}

export class WritingTimeStore {
	/** "HH:MM:SS" 또는 "MM:SS" 문자열 → seconds */
	static parseTime(val: unknown): number {
		if (typeof val !== 'string') return 0;
		const parts = val.trim().split(':').map(Number);
		if (parts.some(isNaN)) return 0;
		if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
		if (parts.length === 2) return parts[0] * 60 + parts[1];
		return 0;
	}

	/** seconds → compact 표시 ("X시간 Y분" / "Y분 Z초" / "Z초") */
	static formatTime(sec: number): string {
		if (sec <= 0) return wmT('0초');
		const h = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		const s = sec % 60;
		if (h > 0) return wmT('{0}시간{1}', h, m > 0 ? wmT(' {0}분', m) : '');
		if (m > 0) return wmT('{0}분{1}', m, s > 0 ? wmT(' {0}초', s) : '');
		return wmT('{0}초', s);
	}

	/** seconds → full 표시 ("X시간 Y분 Z초", 툴팁용) */
	static formatTimeFull(sec: number): string {
		if (sec <= 0) return wmT('0초');
		const h = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		const s = sec % 60;
		const parts: string[] = [];
		if (h > 0) parts.push(wmT('{0}시간', h));
		if (m > 0) parts.push(wmT('{0}분', m));
		if (s > 0 || parts.length === 0) parts.push(wmT('{0}초', s));
		return parts.join(' ');
	}

	/**
	 * folder 내 모든 .md 파일의 프론트매터를 읽어 모드별 시간을 합산.
	 * folder가 빈 문자열이면 vault 전체.
	 */
	static async aggregateFolder(
		app: App,
		folder: string,
		modes: TimeModeConfig[],
		totalKey: string,
	): Promise<ModeTime> {
		const result: ModeTime = { total: 0 };
		for (const m of modes) result[m.id] = 0;
		const prefix = folder ? normalizePath(folder) + '/' : '';

		for (const file of app.vault.getMarkdownFiles()) {
			if (prefix && !file.path.startsWith(prefix)) continue;
			const fm = app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;
			for (const m of modes) result[m.id] += this.parseTime(fm[m.frontmatterKey]);
			result.total += this.parseTime(fm[totalKey]);
		}
		return result;
	}

	/**
	 * folder 내 모든 .md 파일의 모드별 평균 시간 계산.
	 * 해당 모드에 기록이 있는 파일 수만 분모로 사용.
	 */
	static async averageFolder(
		app: App,
		folder: string,
		modes: TimeModeConfig[],
	): Promise<ModeStat> {
		const totals: Record<string, number> = {};
		const counts: Record<string, number> = {};
		for (const m of modes) { totals[m.id] = 0; counts[m.id] = 0; }
		const prefix = folder ? normalizePath(folder) + '/' : '';

		for (const file of app.vault.getMarkdownFiles()) {
			if (prefix && !file.path.startsWith(prefix)) continue;
			const fm = app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;
			for (const m of modes) {
				const v = this.parseTime(fm[m.frontmatterKey]);
				if (v > 0) { totals[m.id] += v; counts[m.id]++; }
			}
		}

		const avg: Record<string, number> = {};
		for (const m of modes) {
			avg[m.id] = counts[m.id] > 0 ? Math.round(totals[m.id] / counts[m.id]) : 0;
		}
		return { avg, count: counts };
	}

	/**
	 * 데일리노트 폴더에서 특정 프로젝트의 모드별 일평균 계산.
	 * 키 형식: {projectName}_{mode.frontmatterKey}
	 */
	static async averageDailyNotes(
		app: App,
		dailyFolder: string,
		projectName: string,
		modes: TimeModeConfig[],
	): Promise<ModeStat> {
		const totals: Record<string, number> = {};
		const counts: Record<string, number> = {};
		for (const m of modes) { totals[m.id] = 0; counts[m.id] = 0; }
		const prefix = dailyFolder ? normalizePath(dailyFolder) + '/' : '';

		for (const file of app.vault.getMarkdownFiles()) {
			if (prefix && !file.path.startsWith(prefix)) continue;
			const fm = app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;
			for (const m of modes) {
				const key = `${projectName}_${m.frontmatterKey}`;
				const v = this.parseTime(fm[key]);
				if (v > 0) { totals[m.id] += v; counts[m.id]++; }
			}
		}

		const avg: Record<string, number> = {};
		for (const m of modes) {
			avg[m.id] = counts[m.id] > 0 ? Math.round(totals[m.id] / counts[m.id]) : 0;
		}
		return { avg, count: counts };
	}

	/** 최근 N일의 데일리노트에서 모드별 작업시간 추출 */
	static async getDailyHistory(
		app: App,
		folder: string,
		format: string,
		modes: TimeModeConfig[],
		days = 30,
		projectName?: string | null,
	): Promise<DailyModeTime[]> {
		const result: DailyModeTime[] = [];
		const today = new Date();
		for (let i = days - 1; i >= 0; i--) {
			const d = new Date(today);
			d.setDate(d.getDate() - i);
			const name = moment(d).format(format);
			const path = folder ? `${folder}/${name}.md` : `${name}.md`;
			const file = app.vault.getAbstractFileByPath(path);
			const fm = (file instanceof TFile)
				? app.metadataCache.getFileCache(file)?.frontmatter ?? {}
				: {};
			const values: Record<string, number> = {};
			for (const mode of modes) {
				const key = projectName ? `${projectName}_${mode.frontmatterKey}` : mode.frontmatterKey;
				values[mode.id] = this.parseTime(fm[key]);
			}
			result.push({ date: moment(d).format('YYYY-MM-DD'), values });
		}
		return result;
	}

	/**
	 * 단일 파일 프론트매터 시간 + pendingTimeUpdates 미저장분 합산.
	 * 현재 문서 카드 전용.
	 */
	static getFileTime(
		app: App,
		file: TFile,
		modes: TimeModeConfig[],
		totalKey: string,
		pending: WritingMenuPlugin['pendingTimeUpdates'],
	): ModeTime {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const totalPending = pending.get(`${file.path}:total`)?.seconds ?? 0;
		const result: ModeTime = { total: this.parseTime(fm[totalKey]) + totalPending };
		for (const mode of modes) {
			const modePending = pending.get(`${file.path}:${mode.id}`)?.seconds ?? 0;
			result[mode.id] = this.parseTime(fm[mode.frontmatterKey]) + modePending;
		}
		return result;
	}
}
