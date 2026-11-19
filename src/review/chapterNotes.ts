import { TFile, TFolder } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { DAY_FIELDS } from './workMetadata';

/** Episode number written in a note's frontmatter (회차 / episode), or null. */
function frontmatterEpisode(frontmatter: Record<string, unknown>): number | null {
	for (const key of ['회차', 'episode']) {
		const value = frontmatter[key];
		const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/[^\d]/g, '')) : NaN;
		if (Number.isInteger(number) && number > 0) return number;
	}
	return null;
}

/**
 * Chapter notes of a project, by episode number, from the project's
 * manuscript folder (else its root folder) only. Frontmatter 회차 wins; a lone
 * number in the file name also counts (two files with the same number are
 * ambiguous and skipped). Notes outside any project are not searched: the
 * open note covers them.
 */
export function chapterNotes(plugin: WritingMenuPlugin, projectKey: string): Map<number, TFile> {
	const byFrontmatter = new Map<number, TFile>(), byName = new Map<number, TFile | null>();
	const project = plugin.projectContext.getProjects().find(item => item.id === projectKey);
	if (!project) return byFrontmatter;
	const vault = plugin.app.vault;
	const folder = [project.manuscriptFolder, project.rootFolder].map(path => path ? vault.getAbstractFileByPath(path) : vault.getRoot()).find((item): item is TFolder => item instanceof TFolder);
	const files: TFile[] = [], walk = (dir: TFolder) => { for (const child of dir.children) { if (child instanceof TFolder) walk(child); else if (child instanceof TFile && child.extension === 'md') files.push(child); } };
	if (folder) walk(folder);
	for (const file of files) {
		if (plugin.projectContext.getProjectForFile(file)?.id !== projectKey) continue;
		const episode = frontmatterEpisode(plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {});
		if (episode) { if (!byFrontmatter.has(episode)) byFrontmatter.set(episode, file); continue; }
		const match = /\d+/.exec(file.basename);
		if (match) { const number = Number(match[0]); byName.set(number, byName.has(number) ? null : file); }
	}
	for (const [number, file] of byName) if (file && !byFrontmatter.has(number)) byFrontmatter.set(number, file);
	return byFrontmatter;
}

export type DayValues = Partial<Record<keyof typeof DAY_FIELDS, number>>;

/**
 * The 24-hour figures already written in a chapter note's frontmatter. Values typed by hand often land
 * as text properties ("5,000", "+12", "−3"), so numeric text counts too.
 */
export function readDayMetrics(plugin: WritingMenuPlugin, file: TFile): DayValues {
	const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
	const values: DayValues = {};
	for (const [key, field] of Object.entries(DAY_FIELDS) as Array<[keyof typeof DAY_FIELDS, string]>) {
		const value = frontmatterNumber(frontmatter[field]);
		if (value !== null) values[key] = value;
	}
	return values;
}
function frontmatterNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value !== 'string') return null;
	const text = value.replace(/[\s,]/g, '').replace(/[−–]/g, '-');
	return /^[+-]?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}
