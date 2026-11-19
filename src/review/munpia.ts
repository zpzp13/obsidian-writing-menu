import { requestUrl } from 'obsidian';
import { wmT } from '../i18n/index';

/*
 * Munpia's mobile web serves chapter metadata as JSON at the endpoint below.
 * The same endpoint and response shape are used by the unofficial munpia-sdk
 * (github.com/re0nyaa/munpia-sdk). We call it directly with Obsidian's
 * requestUrl instead of bundling the SDK: it depends on Node's undici and
 * would not run on mobile. Requests go only to m.munpia.com, only when the
 * author presses the button, and send Obsidian's own user agent.
 */
const BASE = 'https://m.munpia.com';

export interface MunpiaChapter { id: number; num: number; title: string; views: number; likes: number; comments: number; free: boolean; createdAt: string }

/** A numeric work id, or a Munpia work/viewer URL that contains one. */
export function parseMunpiaNovelId(input: string): string | null {
	const value = input.trim();
	if (/^\d{3,}$/.test(value)) return value;
	const match = /munpia\.com\/(?:novel\/detail\/|novel\/)?(\d{3,})/.exec(value);
	return match ? match[1] : null;
}

const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0;

export async function fetchMunpiaChapters(novelId: string): Promise<MunpiaChapter[]> {
	const response = await requestUrl({ url: `${BASE}/api/v1/mobile/novel-detail/${encodeURIComponent(novelId)}/chapters`, headers: { Accept: 'application/json' }, throw: false });
	if (response.status === 404) throw new Error(wmT('문피아에서 작품을 찾지 못했습니다. 작품 번호를 확인해 주세요.'));
	if (response.status === 429) throw new Error(wmT('문피아 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'));
	if (response.status >= 400) throw new Error(wmT('문피아 응답 오류 (HTTP {0})', response.status));
	const json: unknown = response.json;
	const record = json && typeof json === 'object' ? json as Record<string, unknown> : {};
	if ('code' in record && record.code !== 'M000_00000' && record.code !== 'SUCCESS' && record.code !== 200) throw new Error(typeof record.message === 'string' ? record.message : wmT('문피아 응답 오류'));
	const result = ('result' in record ? record.result : record) as Record<string, unknown> | undefined;
	const list = Array.isArray(result?.list) ? result.list as Array<Record<string, unknown>> : [];
	if (!list.length) throw new Error(wmT('문피아 회차 목록이 비어 있습니다. 응답 형식이 바뀌었을 수 있습니다.'));
	return list.map(item => ({
		id: number(item.id), num: number(item.num), title: typeof item.title === 'string' ? item.title : '',
		views: number(item.viewCount), likes: number(item.likeCount), comments: number(item.commentCount),
		free: Boolean(item.free), createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
	})).filter(chapter => chapter.num > 0).sort((a, b) => a.num - b.num);
}

export interface MunpiaNovel { id: string; title: string; preference: number | null; views: number | null; likes: number | null }

/** Work-level data (includes the total 선호작 count as preferenceCount). */
export async function fetchMunpiaNovel(novelId: string): Promise<MunpiaNovel> {
	const response = await requestUrl({ url: `${BASE}/api/v1/mobile/novel-detail/${encodeURIComponent(novelId)}`, headers: { Accept: 'application/json' }, throw: false });
	if (response.status >= 400) throw new Error(wmT('문피아 응답 오류 (HTTP {0})', response.status));
	const json: unknown = response.json;
	const record = json && typeof json === 'object' ? json as Record<string, unknown> : {};
	const result = ('result' in record ? record.result : record) as Record<string, unknown> | undefined;
	const info = (result && typeof result.novelInfo === 'object' && result.novelInfo ? result.novelInfo : result ?? {}) as Record<string, unknown>;
	const optional = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
	return { id: novelId, title: typeof info.title === 'string' ? info.title : '', preference: optional(info.preferenceCount), views: optional(info.viewCount), likes: optional(info.likeCount) };
}

/** Munpia dates come as ISO or "YYYY.MM.DD HH:mm"; returns epoch ms or NaN. */
export function parseMunpiaDate(value: string): number {
	const direct = Date.parse(value);
	if (!Number.isNaN(direct)) return direct;
	const match = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?/.exec(value);
	return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0)).getTime() : NaN;
}

export type PreferenceSnapshot = [time: number, preference: number];

/** 선호작 change in the 24 hours after a chapter went up, from recorded snapshots. */
export function preferenceAfterRelease(snapshots: PreferenceSnapshot[], releasedAt: number, now = Date.now()): { state: 'done' | 'tracking' | 'unknown'; delta: number; hours: number } {
	const sorted = [...snapshots].sort((a, b) => a[0] - b[0]);
	const before = [...sorted].reverse().find(([time]) => time <= releasedAt + 15 * 60_000);
	if (!before || Number.isNaN(releasedAt)) return { state: 'unknown', delta: 0, hours: 0 };
	const target = releasedAt + 24 * 3_600_000;
	if (now < target) {
		const latest = sorted[sorted.length - 1];
		return { state: 'tracking', delta: latest[1] - before[1], hours: Math.max(0, Math.floor((now - releasedAt) / 3_600_000)) };
	}
	const near = sorted.filter(([time]) => Math.abs(time - target) <= 3 * 3_600_000).sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target))[0];
	return near ? { state: 'done', delta: near[1] - before[1], hours: 24 } : { state: 'unknown', delta: 0, hours: 0 };
}

export type ChapterSnapshot = [time: number, views: number, likes: number, comments: number];
export interface DayMetrics { state: 'done' | 'tracking' | 'unknown'; views: number; likes: number; comments: number; hours: number }

/**
 * A chapter's views/likes/comments at 24 hours after release. Within the
 * first day the current totals are the answer; afterwards it needs a
 * recorded snapshot near the 24-hour mark (nearest within 3 hours, or a
 * straight line between the snapshots on either side).
 */
export function chapterAfterRelease(snapshots: ChapterSnapshot[], releasedAt: number, current: MunpiaChapter, now = Date.now()): DayMetrics {
	if (Number.isNaN(releasedAt)) return { state: 'unknown', views: 0, likes: 0, comments: 0, hours: 0 };
	const target = releasedAt + 24 * 3_600_000;
	if (now < target) return { state: 'tracking', views: current.views, likes: current.likes, comments: current.comments, hours: Math.max(0, Math.floor((now - releasedAt) / 3_600_000)) };
	const sorted = [...snapshots].sort((a, b) => a[0] - b[0]);
	const near = sorted.filter(([time]) => Math.abs(time - target) <= 3 * 3_600_000).sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target))[0];
	if (near) return { state: 'done', views: near[1], likes: near[2], comments: near[3], hours: 24 };
	const before = [...sorted].reverse().find(([time]) => time <= target), after = sorted.find(([time]) => time >= target);
	if (before && after && after[0] > before[0]) {
		const k = (target - before[0]) / (after[0] - before[0]), mix = (i: 1 | 2 | 3) => Math.round(before[i] + (after[i] - before[i]) * k);
		return { state: 'done', views: mix(1), likes: mix(2), comments: mix(3), hours: 24 };
	}
	return { state: 'unknown', views: 0, likes: 0, comments: 0, hours: 0 };
}
