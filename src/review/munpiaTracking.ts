import type { TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { getWritingDocument } from '../writing/WritingDocument';
import { chapterAfterRelease, fetchMunpiaChapters, fetchMunpiaNovel, parseMunpiaDate, preferenceAfterRelease, type ChapterSnapshot, type MunpiaChapter, type PreferenceSnapshot } from './munpia';
import { chapterNotes, type DayValues } from './chapterNotes';
import { DAY_FIELDS, recordDayMetrics } from './workMetadata';

const MAX_SNAPSHOTS = 500;
const MIN_GAP = 25 * 60_000;
const HOUR = 60 * 60_000;

/**
 * Stores a 선호작 snapshot. Munpia only reports the current total, so the
 * change after a chapter release is computed from these points. Returns true
 * when a point was added.
 */
export function recordPreference(plugin: WritingMenuPlugin, novelId: string, preference: number | null, now = Date.now()): boolean {
	if (preference === null) return false;
	const all = { ...plugin.settings.reviewMunpiaSnapshots };
	const list: PreferenceSnapshot[] = [...(all[novelId] ?? [])];
	const last = list[list.length - 1];
	if (last && last[1] === preference && now - last[0] < MIN_GAP) return false;
	list.push([now, preference]);
	all[novelId] = list.slice(-MAX_SNAPSHOTS);
	plugin.settings.reviewMunpiaSnapshots = all;
	void plugin.saveSettings();
	return true;
}

/**
 * Stores views/likes/comments for chapters released in the last 72 hours,
 * so the 24-hour mark can be read later. Older snapshot lists are pruned.
 */
export function recordChapters(plugin: WritingMenuPlugin, novelId: string, chapters: MunpiaChapter[], now = Date.now()): void {
	const all: Record<string, ChapterSnapshot[]> = { ...plugin.settings.reviewMunpiaChapterSnapshots };
	let changed = false;
	for (const chapter of chapters) {
		const released = parseMunpiaDate(chapter.createdAt);
		if (Number.isNaN(released) || now - released > 72 * HOUR) continue;
		const key = `${novelId}:${chapter.id}`, list = [...(all[key] ?? [])], last = list[list.length - 1];
		if (last && now - last[0] < MIN_GAP && last[1] === chapter.views && last[2] === chapter.likes && last[3] === chapter.comments) continue;
		list.push([now, chapter.views, chapter.likes, chapter.comments]); all[key] = list.slice(-120); changed = true;
	}
	for (const [key, list] of Object.entries(all)) if (!list.length || now - list[list.length - 1][0] > 30 * 24 * HOUR) { delete all[key]; changed = true; }
	if (!changed) return;
	plugin.settings.reviewMunpiaChapterSnapshots = all;
	void plugin.saveSettings();
}

/**
 * Opt-in: while Obsidian is open, record each linked work's 선호작 once an
 * hour (two requests per work: totals and chapters), so the 24 hours after a
 * release can be read.
 */
export function startMunpiaTracking(plugin: WritingMenuPlugin): void {
	const tick = async () => {
		if (!plugin.settings.reviewMunpiaAutoTrack) return;
		for (const novelId of new Set(Object.values(plugin.settings.reviewMunpiaNovels ?? {}))) {
			try {
				recordPreference(plugin, novelId, (await fetchMunpiaNovel(novelId)).preference);
				const chapters = await fetchMunpiaChapters(novelId);
				recordChapters(plugin, novelId, chapters);
				await finalizeDayMetrics(plugin, novelId, chapters);
			}
			catch (error) { console.warn('Writing Menu: Munpia 선호작 tracking failed', error); }
		}
	};
	plugin.registerInterval(window.setInterval(() => void tick(), HOUR));
	plugin.app.workspace.onLayoutReady(() => void tick());
}

/** Writes the 24-hour figures into a chapter note: through the editor when it is the open note (undoable), otherwise straight to its frontmatter. */
export async function writeDayMetrics(plugin: WritingMenuPlugin, file: TFile, values: DayValues): Promise<void> {
	const document = getWritingDocument(plugin);
	if (document?.file.path === file.path) { recordDayMetrics(plugin, document, values); return; }
	await plugin.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
		for (const [key, field] of Object.entries(DAY_FIELDS) as Array<[keyof typeof DAY_FIELDS, string]>) {
			const value = values[key];
			if (typeof value === 'number' && frontmatter[field] !== value) frontmatter[field] = value;
		}
	});
}

/** Drops one chapter's snapshots once its 24-hour figures live in the note. */
export function clearChapterSnapshots(plugin: WritingMenuPlugin, novelId: string, chapterId: number): void {
	const key = `${novelId}:${chapterId}`;
	if (!plugin.settings.reviewMunpiaChapterSnapshots?.[key]) return;
	const all = { ...plugin.settings.reviewMunpiaChapterSnapshots }; delete all[key];
	plugin.settings.reviewMunpiaChapterSnapshots = all; void plugin.saveSettings();
}

/**
 * After a chapter's first 24 hours: write the figures into its note's
 * frontmatter and delete that chapter's snapshots, so the note becomes the
 * record. A chapter whose 24-hour mark was never captured is dropped after
 * 27 hours; one whose note is not found yet keeps its snapshots (30-day limit).
 * 선호작 snapshots are kept for 48 hours, long enough for every pending chapter.
 */
export async function finalizeDayMetrics(plugin: WritingMenuPlugin, novelId: string, chapters: MunpiaChapter[], now = Date.now()): Promise<void> {
	const snapshots = { ...plugin.settings.reviewMunpiaChapterSnapshots };
	const preference = plugin.settings.reviewMunpiaSnapshots?.[novelId] ?? [];
	const projects = Object.entries(plugin.settings.reviewMunpiaNovels ?? {}).filter(([, id]) => id === novelId).map(([key]) => key);
	let notes: Map<number, TFile> | null = null, changed = false;
	for (const chapter of chapters) {
		const key = `${novelId}:${chapter.id}`, list = snapshots[key];
		const released = parseMunpiaDate(chapter.createdAt);
		if (!list?.length || Number.isNaN(released) || now < released + 24 * HOUR) continue;
		const day = chapterAfterRelease(list, released, chapter, now);
		if (day.state !== 'done') { if (now > released + 27 * HOUR) { delete snapshots[key]; changed = true; } continue; }
		notes ??= new Map(projects.flatMap(project => [...chapterNotes(plugin, project)]));
		const file = notes.get(chapter.num);
		if (!file) continue;
		const gained = preferenceAfterRelease(preference, released, now);
		try {
			await writeDayMetrics(plugin, file, { views: day.views, likes: day.likes, comments: day.comments, ...(gained.state === 'done' ? { preference: gained.delta } : {}) });
			delete snapshots[key]; changed = true;
		} catch (error) { console.warn('Writing Menu: 24-hour metrics were not written', error); }
	}
	const kept = preference.filter(([time]) => now - time <= 48 * HOUR);
	if (kept.length !== preference.length) plugin.settings.reviewMunpiaSnapshots = { ...plugin.settings.reviewMunpiaSnapshots, [novelId]: kept };
	if (!changed && kept.length === preference.length) return;
	plugin.settings.reviewMunpiaChapterSnapshots = snapshots;
	void plugin.saveSettings();
}
