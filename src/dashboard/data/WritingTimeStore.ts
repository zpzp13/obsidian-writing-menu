import { normalizePath, TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { WritingMenuSettings } from '../../types';
import type WritingMenuPlugin from '../../../main';

export interface ModeTime {
	draft:   number;
	writing: number;
	editing: number;
	total:   number;
}

export interface ModeStat {
	avg:   { draft: number; writing: number; editing: number };
	count: { draft: number; writing: number; editing: number };
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
		if (sec <= 0) return '0초';
		const h = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		const s = sec % 60;
		if (h > 0) return `${h}시간${m > 0 ? ` ${m}분` : ''}`;
		if (m > 0) return `${m}분${s > 0 ? ` ${s}초` : ''}`;
		return `${s}초`;
	}

	/** seconds → full 표시 ("X시간 Y분 Z초", 툴팁용) */
	static formatTimeFull(sec: number): string {
		if (sec <= 0) return '0초';
		const h = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		const s = sec % 60;
		const parts: string[] = [];
		if (h > 0) parts.push(`${h}시간`);
		if (m > 0) parts.push(`${m}분`);
		if (s > 0 || parts.length === 0) parts.push(`${s}초`);
		return parts.join(' ');
	}

	/**
	 * folder 내 모든 .md 파일의 프론트매터를 읽어 모드별 시간을 합산.
	 * folder가 빈 문자열이면 vault 전체.
	 */
	static async aggregateFolder(
		app: App,
		folder: string,
		keys: WritingMenuSettings['timeKeys'],
	): Promise<ModeTime> {
		const result: ModeTime = { draft: 0, writing: 0, editing: 0, total: 0 };
		const prefix = folder ? normalizePath(folder) + '/' : '';

		for (const file of app.vault.getMarkdownFiles()) {
			if (prefix && !file.path.startsWith(prefix)) continue;
			const fm = app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;
			result.draft   += this.parseTime(fm[keys.draft]);
			result.writing += this.parseTime(fm[keys.writing]);
			result.editing += this.parseTime(fm[keys.editing]);
			result.total   += this.parseTime(fm[keys.total]);
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
		keys: WritingMenuSettings['timeKeys'],
	): Promise<ModeStat> {
		const totals = { draft: 0, writing: 0, editing: 0 };
		const counts = { draft: 0, writing: 0, editing: 0 };
		const prefix = folder ? normalizePath(folder) + '/' : '';

		for (const file of app.vault.getMarkdownFiles()) {
			if (prefix && !file.path.startsWith(prefix)) continue;
			const fm = app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;
			const d = this.parseTime(fm[keys.draft]);
			const w = this.parseTime(fm[keys.writing]);
			const e = this.parseTime(fm[keys.editing]);
			if (d > 0) { totals.draft   += d; counts.draft++;   }
			if (w > 0) { totals.writing += w; counts.writing++; }
			if (e > 0) { totals.editing += e; counts.editing++; }
		}

		return {
			avg: {
				draft:   counts.draft   > 0 ? Math.round(totals.draft   / counts.draft)   : 0,
				writing: counts.writing > 0 ? Math.round(totals.writing / counts.writing) : 0,
				editing: counts.editing > 0 ? Math.round(totals.editing / counts.editing) : 0,
			},
			count: counts,
		};
	}

	/** 최근 N일의 데일리노트에서 모드별 작업시간 추출 */
	static async getDailyHistory(
		app: App,
		folder: string,
		format: string,
		keys: WritingMenuSettings['timeKeys'],
		days = 30,
	): Promise<Array<{ date: string; draft: number; writing: number; editing: number }>> {
		const result: Array<{ date: string; draft: number; writing: number; editing: number }> = [];
		const today = new Date();
		for (let i = days - 1; i >= 0; i--) {
			const d = new Date(today);
			d.setDate(d.getDate() - i);
			const name = (window as any).moment(d).format(format);
			const path = folder ? `${folder}/${name}.md` : `${name}.md`;
			const file = app.vault.getAbstractFileByPath(path);
			const fm = (file instanceof TFile)
				? app.metadataCache.getFileCache(file)?.frontmatter ?? {}
				: {};
			result.push({
				date:    name,
				draft:   this.parseTime(fm[keys.draft]),
				writing: this.parseTime(fm[keys.writing]),
				editing: this.parseTime(fm[keys.editing]),
			});
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
		keys: WritingMenuSettings['timeKeys'],
		pending: WritingMenuPlugin['pendingTimeUpdates'],
	): ModeTime {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const result: ModeTime = {
			draft:   this.parseTime(fm[keys.draft]),
			writing: this.parseTime(fm[keys.writing]),
			editing: this.parseTime(fm[keys.editing]),
			total:   this.parseTime(fm[keys.total]),
		};

		// 아직 저장되지 않은 현재 세션 누적분 추가
		for (const [, entry] of pending) {
			if (entry.file.path !== file.path) continue;
			if (entry.mode === 'draft')   result.draft   += entry.seconds;
			if (entry.mode === 'writing') result.writing += entry.seconds;
			if (entry.mode === 'editing') result.editing += entry.seconds;
			if (entry.mode === 'total')   result.total   += entry.seconds;
		}
		return result;
	}
}
