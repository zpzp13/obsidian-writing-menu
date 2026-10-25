import { wmT } from '../i18n/index';
import { legacyText } from '../utils/typeGuards';
import { normalizePath, parseYaml } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { WritingProject } from '../types';
import {
	createPlotWorkbookSheet,
	type PlotWorkbookCellStyle,
	type PlotWorkbookColumn,
	type PlotWorkbookSheet,
} from './PlotWorkbookTypes';
import { PlotWorkbookRepository } from './PlotWorkbookRepository';

interface LegacyPlotLine {
	id: string;
	name: string;
	color?: string;
	colorDark?: string;
	fontSize?: number;
	fontColor?: string;
	fontColorDark?: string;
}

interface LegacyCharacter {
	id: string;
	name: string;
	filePath?: string;
	color?: string;
	fontSize?: number;
	fontColor?: string;
	fontColorDark?: string;
	bgColor?: string;
	bgColorDark?: string;
}

interface LegacyScene {
	id: string;
	name: string;
	characters: string[];
}

interface LegacyChapter {
	id: string;
	name: string;
	scenes: LegacyScene[];
}

interface LegacyEpisode {
	id: string;
	name: string;
	subtitle?: string;
	filePath?: string;
	chapters: LegacyChapter[];
}

interface LegacyPlotProject {
	plotLines: LegacyPlotLine[];
	episodes: LegacyEpisode[];
	characters: LegacyCharacter[];
	plotCells: Record<string, { content?: string }>;
	charCells: Record<string, { content?: string }>;
}

export interface LegacyPlotImportResult {
	imported: boolean;
	sheetId: string;
	rowCount: number;
	columnCount: number;
	sourcePath: string;
}

export class LegacyPlotImporter {
	constructor(private readonly plugin: WritingMenuPlugin) {}

	getSourcePath(): string {
		const root = normalizePath(this.plugin.settings.plotManagerFolder?.trim() ?? '').replace(/^\/+|\/+$/g, '');
		if (!root) return '';
		const child = (this.plugin.settings.plotDataFolder?.trim() ?? '').replace(/^\/+|\/+$/g, '');
		return normalizePath(child ? `${root}/${child}` : root);
	}

	async hasSourceData(): Promise<boolean> {
		const sourcePath = this.getSourcePath();
		if (!sourcePath || !(await this.plugin.app.vault.adapter.exists(sourcePath))) return false;
		for (const name of ['plot-config.md', '.writing-menu-plot.json', 'plot-data.md']) {
			if (await this.plugin.app.vault.adapter.exists(normalizePath(`${sourcePath}/${name}`))) return true;
		}
		return false;
	}

	findTargetProject(projects: WritingProject[]): WritingProject | null {
		const source = this.getSourcePath();
		if (!source) return projects[0] ?? null;
		return projects.find(project => this.matchesProject(project)) ?? projects[0] ?? null;
	}

	matchesProject(project: WritingProject): boolean {
		const source = this.getSourcePath();
		const root = normalizePath(project.rootFolder).replace(/^\/+|\/+$/g, '');
		return Boolean(source && root && (source === root || source.startsWith(`${root}/`)));
	}

	async importInto(project: WritingProject): Promise<LegacyPlotImportResult> {
		const sourcePath = this.getSourcePath();
		if (!sourcePath) throw new Error(wmT("기존 플롯 폴더 설정을 찾을 수 없습니다."));
		const legacy = await this.readProject(sourcePath);
		const sheet = this.toWorkbookSheet(legacy);
		const repository = new PlotWorkbookRepository(this.plugin, project.rootFolder);
		try {
			await repository.loadOrCreate(project.id, project.name);
			const result = await repository.importLegacySheet(sheet, sourcePath);
			return {
				...result,
				rowCount: legacy.episodes.reduce(
					(total, episode) => total + episode.chapters.reduce((sum, chapter) => sum + chapter.scenes.length, 0),
					0,
				),
				columnCount: 3 + legacy.plotLines.length + legacy.characters.length + 1,
				sourcePath,
			};
		} finally {
			repository.dispose();
		}
	}

	private async readProject(sourcePath: string): Promise<LegacyPlotProject> {
		const configPath = normalizePath(`${sourcePath}/plot-config.md`);
		if (await this.plugin.app.vault.adapter.exists(configPath)) {
			return this.readMarkdownProject(sourcePath, configPath);
		}

		for (const name of ['.writing-menu-plot.json', 'plot-data.md']) {
			const path = normalizePath(`${sourcePath}/${name}`);
			if (!(await this.plugin.app.vault.adapter.exists(path))) continue;
			const raw = (await this.plugin.app.vault.adapter.read(path)).trim();
			if (!raw.startsWith('{')) continue;
			return this.normalizeProject(JSON.parse(raw) as unknown);
		}
		throw new Error(wmT("{0}에서 기존 플롯 데이터를 찾을 수 없습니다.", sourcePath));
	}

	private async readMarkdownProject(sourcePath: string, configPath: string): Promise<LegacyPlotProject> {
		const config = this.parseFrontmatter(await this.plugin.app.vault.adapter.read(configPath)).data;
		const project: LegacyPlotProject = {
			plotLines: this.readPlotLines(config.plotLines),
			episodes: [],
			characters: this.readCharacters(config.characters),
			plotCells: {},
			charCells: this.readLegacyCharacterCells(config.charCells),
		};
		const manifest = Array.isArray(config.episodes) ? config.episodes : null;
		let files: string[];
		if (manifest) {
			files = manifest.map((item, index) => {
				if (!item || typeof item !== 'object' || Array.isArray(item)) {
					throw new Error(wmT("기존 에피소드 목록 {0}번 항목이 올바르지 않습니다.", index + 1));
				}
				const rawPath = legacyText((item as Record<string, unknown>).filePath ?? '').trim();
				const path = normalizePath(rawPath);
				if (!path || !this.isInside(sourcePath, path)) {
					throw new Error(wmT("기존 플롯 폴더 밖의 에피소드 경로는 가져오지 않습니다: {0}", path || wmT("(빈 경로)")));
				}
				return path;
			});
		} else {
			const listed = await this.plugin.app.vault.adapter.list(sourcePath);
			files = listed.files.filter(path => path.toLowerCase().endsWith('.md')
				&& path !== configPath
				&& path !== normalizePath(`${sourcePath}/plot-data.md`));
		}

		for (const path of files) {
			if (!(await this.plugin.app.vault.adapter.exists(path))) {
				throw new Error(wmT("기존 에피소드 파일을 찾을 수 없습니다: {0}", path));
			}
			const parsed = this.parseFrontmatter(await this.plugin.app.vault.adapter.read(path));
			if (!this.isEpisodeDocument(parsed.data)) {
				if (manifest) throw new Error(wmT("기존 에피소드 파일 형식이 아닙니다: {0}", path));
				continue;
			}
			const episode = this.readEpisode(parsed.data, path);
			const cells = parsed.body.includes('<!-- writing-menu-cell:')
				? this.readMarkedCells(parsed.body)
				: this.readHeadingCells(parsed.body, episode, project.plotLines, project.characters);
			Object.assign(project.plotCells, cells.plotCells);
			Object.assign(project.charCells, cells.charCells);
			project.episodes.push(episode);
		}
		return project;
	}

	private toWorkbookSheet(project: LegacyPlotProject): PlotWorkbookSheet {
		const sceneRows = project.episodes.flatMap(episode => episode.chapters.flatMap(chapter =>
			chapter.scenes.map(scene => ({ episode, chapter, scene }))));
		const requiredColumns = 3 + project.plotLines.length + project.characters.length + 1;
		const sheet = createPlotWorkbookSheet(
			'기존 플롯',
			Math.max(200, sceneRows.length + 20),
			Math.max(32, requiredColumns + 8),
		);
		const columns = sheet.columnOrder;
		this.configureColumn(sheet.columns[columns[0]], '에피소드', 'text', 130);
		this.configureColumn(sheet.columns[columns[1]], '회차', 'text', 110);
		this.configureColumn(sheet.columns[columns[2]], '장면', 'plot', 180);

		const plotColumnIds = new Map<string, string>();
		const plotStyles = new Map<string, PlotWorkbookCellStyle>();
		project.plotLines.forEach((line, index) => {
			const id = columns[3 + index];
			const style = this.plotLineStyle(line);
			plotColumnIds.set(line.id, id);
			plotStyles.set(line.id, style);
			this.configureColumn(sheet.columns[id], line.name || `플롯 ${index + 1}`, 'plot', 220, style);
		});
		const characterStart = 3 + project.plotLines.length;
		const characterColumnIds = new Map<string, string>();
		const characterStyles = new Map<string, PlotWorkbookCellStyle>();
		project.characters.forEach((character, index) => {
			const id = columns[characterStart + index];
			const style = this.characterStyle(character);
			characterColumnIds.set(character.id, id);
			characterStyles.set(character.id, style);
			this.configureColumn(
				sheet.columns[id],
				character.name || `인물 ${index + 1}`,
				'character',
				180,
				style,
			);
			if (character.filePath) sheet.columns[id].characterNotePath = character.filePath;
		});
		const castColumnId = columns[characterStart + project.characters.length];
		this.configureColumn(sheet.columns[castColumnId], '등장', 'cast', 150);

		sceneRows.forEach(({ episode, chapter, scene }, index) => {
			const rowId = sheet.rowOrder[index];
			this.putCell(sheet, rowId, columns[0], episode.name);
			this.putCell(sheet, rowId, columns[1], chapter.name);
			this.putCell(sheet, rowId, columns[2], scene.name);
			for (const line of project.plotLines) {
				this.putCell(
					sheet,
					rowId,
					plotColumnIds.get(line.id),
					project.plotCells[`${line.id}__${scene.id}`]?.content ?? '',
					plotStyles.get(line.id),
				);
			}
			for (const character of project.characters) {
				const content = project.charCells[`${character.id}__${scene.id}`]?.content
					?? (scene.characters.includes(character.id) ? '등장' : '');
				this.putCell(sheet, rowId, characterColumnIds.get(character.id), content, characterStyles.get(character.id));
			}
		});
		return sheet;
	}

	private configureColumn(
		column: PlotWorkbookColumn,
		title: string,
		role: PlotWorkbookColumn['role'],
		width: number,
		style?: PlotWorkbookCellStyle,
	): void {
		column.title = title;
		column.role = role;
		column.width = width;
		if (style && Object.keys(style).length > 0) column.style = style;
	}

	private putCell(
		sheet: PlotWorkbookSheet,
		rowId: string,
		columnId: string | undefined,
		value: string,
		style?: PlotWorkbookCellStyle,
	): void {
		if (!columnId || !value) return;
		(sheet.cells[rowId] ??= {})[columnId] = {
			type: 'text',
			value,
			...(style && Object.keys(style).length > 0 ? { style: { ...style } } : {}),
		};
	}

	private plotLineStyle(line: LegacyPlotLine): PlotWorkbookCellStyle {
		return this.makeStyle(line.fontSize, line.fontColor, line.fontColorDark, line.color, line.colorDark);
	}

	private characterStyle(character: LegacyCharacter): PlotWorkbookCellStyle {
		return this.makeStyle(
			character.fontSize,
			character.fontColor,
			character.fontColorDark,
			character.bgColor ?? character.color,
			character.bgColorDark ?? character.bgColor ?? character.color,
		);
	}

	private makeStyle(
		fontSize?: number,
		lightText?: string,
		darkText?: string,
		lightBackground?: string,
		darkBackground?: string,
	): PlotWorkbookCellStyle {
		const style: PlotWorkbookCellStyle = {};
		if (Number.isFinite(fontSize) && Number(fontSize) > 0) style.fontSize = Number(fontSize);
		if (this.isHex(lightText)) style.color = {
			light: lightText,
			dark: this.isHex(darkText) ? darkText : lightText,
		};
		if (this.isHex(lightBackground)) style.backgroundColor = {
			light: lightBackground,
			dark: this.isHex(darkBackground) ? darkBackground : lightBackground,
		};
		return style;
	}

	private normalizeProject(raw: unknown): LegacyPlotProject {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(wmT("기존 플롯 JSON 형식이 올바르지 않습니다."));
		const data = raw as Record<string, unknown>;
		return {
			plotLines: this.readPlotLines(data.plotLines),
			episodes: Array.isArray(data.episodes) ? data.episodes.map((item, index) => this.readEpisodeObject(item, `에피소드 ${index + 1}`)) : [],
			characters: this.readCharacters(data.characters),
			plotCells: this.readCellMap(data.plotCells),
			charCells: this.readCellMap(data.charCells),
		};
	}

	private readPlotLines(raw: unknown): LegacyPlotLine[] {
		if (!Array.isArray(raw)) return [];
		return raw.map((item, index) => {
			const entry = this.record(item, `플롯 열 ${index + 1}`);
			return {
				id: legacyText(entry.id ?? `plot-${index + 1}`),
				name: legacyText(entry.name ?? `플롯 ${index + 1}`),
				color: this.optionalString(entry.color),
				colorDark: this.optionalString(entry.colorDark),
				fontSize: this.optionalNumber(entry.fontSize),
				fontColor: this.optionalString(entry.fontColor),
				fontColorDark: this.optionalString(entry.fontColorDark),
			};
		});
	}

	private readCharacters(raw: unknown): LegacyCharacter[] {
		if (!Array.isArray(raw)) return [];
		return raw.map((item, index) => {
			const entry = this.record(item, `인물 ${index + 1}`);
			return {
				id: legacyText(entry.id ?? `character-${index + 1}`),
				name: legacyText(entry.name ?? `인물 ${index + 1}`),
				filePath: this.optionalString(entry.filePath),
				color: this.optionalString(entry.color),
				fontSize: this.optionalNumber(entry.fontSize),
				fontColor: this.optionalString(entry.fontColor),
				fontColorDark: this.optionalString(entry.fontColorDark),
				bgColor: this.optionalString(entry.bgColor),
				bgColorDark: this.optionalString(entry.bgColorDark),
			};
		});
	}

	private readEpisode(data: Record<string, unknown>, filePath: string): LegacyEpisode {
		return this.readEpisodeObject({
			...data,
			name: filePath.split('/').pop()?.replace(/\.md$/i, '') ?? filePath,
			filePath,
		}, filePath);
	}

	private readEpisodeObject(raw: unknown, label: string): LegacyEpisode {
		const entry = this.record(raw, label);
		return {
			id: legacyText(entry.episodeId ?? entry.id ?? label),
			name: legacyText(entry.name ?? label),
			subtitle: this.optionalString(entry.subtitle),
			filePath: this.optionalString(entry.filePath),
			chapters: Array.isArray(entry.chapters) ? entry.chapters.map((chapter, chapterIndex) => {
				const chapterEntry = this.record(chapter, `${label} 회차 ${chapterIndex + 1}`);
				return {
					id: legacyText(chapterEntry.id ?? `${label}-chapter-${chapterIndex + 1}`),
					name: legacyText(chapterEntry.name ?? `${chapterIndex + 1}`),
					scenes: Array.isArray(chapterEntry.scenes) ? chapterEntry.scenes.map((scene, sceneIndex) => {
						const sceneEntry = this.record(scene, `${label} 장면 ${sceneIndex + 1}`);
						return {
							id: legacyText(sceneEntry.id ?? `${label}-scene-${chapterIndex + 1}-${sceneIndex + 1}`),
							name: legacyText(sceneEntry.name ?? `${chapterIndex + 1}-${sceneIndex + 1}`),
							characters: Array.isArray(sceneEntry.characters) ? sceneEntry.characters.map(value => legacyText(value)) : [],
						};
					}) : [],
				};
			}) : [],
		};
	}

	private readMarkedCells(body: string): Pick<LegacyPlotProject, 'plotCells' | 'charCells'> {
		const plotCells: LegacyPlotProject['plotCells'] = {};
		const charCells: LegacyPlotProject['charCells'] = {};
		const pattern = /<!-- writing-menu-cell:(plot|character):([^:]+):([^\s]+) -->\r?\n([\s\S]*?)\r?\n<!-- \/writing-menu-cell -->/g;
		for (const match of body.matchAll(pattern)) {
			const key = `${match[2]}__${match[3]}`;
			const cell = { content: match[4].trim() };
			if (match[1] === 'plot') plotCells[key] = cell;
			else charCells[key] = cell;
		}
		return { plotCells, charCells };
	}

	private readHeadingCells(
		body: string,
		episode: LegacyEpisode,
		plotLines: LegacyPlotLine[],
		characters: LegacyCharacter[],
	): Pick<LegacyPlotProject, 'plotCells' | 'charCells'> {
		const plotCells: LegacyPlotProject['plotCells'] = {};
		const charCells: LegacyPlotProject['charCells'] = {};
		let chapter: LegacyChapter | undefined;
		let scene: LegacyScene | undefined;
		let plotLine: LegacyPlotLine | undefined;
		let character: LegacyCharacter | undefined;
		let characterSection = false;
		let buffer: string[] = [];
		const flush = () => {
			const content = buffer.join('\n').trim();
			buffer = [];
			if (!content || !scene) return;
			if (plotLine) plotCells[`${plotLine.id}__${scene.id}`] = { content };
			else if (character) charCells[`${character.id}__${scene.id}`] = { content };
		};
		for (const line of body.split(/\r?\n/)) {
			const heading = line.match(/^(#{2,5})\s+(.+)$/);
			if (!heading) {
				if ((plotLine || character) && scene) buffer.push(line);
				continue;
			}
			flush();
			const level = heading[1].length;
			const name = heading[2].trim();
			if (level === 2) {
				chapter = episode.chapters.find(item => item.name === name);
				scene = undefined;
				plotLine = undefined;
				character = undefined;
			} else if (level === 3) {
				scene = chapter?.scenes.find(item => item.name === name);
				plotLine = undefined;
				character = undefined;
			} else if (level === 4) {
				characterSection = name === '캐릭터';
				if (name.startsWith('인물: ')) {
					character = characters.find(item => item.name === name.slice(4).trim());
					plotLine = undefined;
				} else if (!characterSection) {
					plotLine = plotLines.find(item => item.name === name);
					character = undefined;
				}
			} else if (level === 5 && characterSection) {
				character = characters.find(item => item.name === name);
				plotLine = undefined;
			}
		}
		flush();
		return { plotCells, charCells };
	}

	private readLegacyCharacterCells(raw: unknown): LegacyPlotProject['charCells'] {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
		const result: LegacyPlotProject['charCells'] = {};
		for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
			result[key] = typeof value === 'object' && value !== null && !Array.isArray(value)
				? { content: legacyText((value as Record<string, unknown>).content ?? '') }
				: { content: legacyText(value ?? '') };
		}
		return result;
	}

	private readCellMap(raw: unknown): LegacyPlotProject['plotCells'] {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
		const result: LegacyPlotProject['plotCells'] = {};
		for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
			if (value && typeof value === 'object' && !Array.isArray(value)) {
				result[key] = { content: legacyText((value as Record<string, unknown>).content ?? '') };
			} else result[key] = { content: legacyText(value ?? '') };
		}
		return result;
	}

	private parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
		const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
		if (!match) return { data: {}, body: raw };
		const parsed: unknown = parseYaml(match[1]);
		return {
			data: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {},
			body: match[2],
		};
	}

	private isEpisodeDocument(data: Record<string, unknown>): boolean {
		const kind = data.writingMenuPlot;
		return kind === 'episode' || typeof data.episodeId === 'string' || Array.isArray(data.chapters);
	}

	private isInside(folder: string, path: string): boolean {
		const root = normalizePath(folder).replace(/\/$/, '');
		const candidate = normalizePath(path);
		return candidate.startsWith(`${root}/`);
	}

	private record(value: unknown, label: string): Record<string, unknown> {
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(wmT("{0} 형식이 올바르지 않습니다.", label));
		return value as Record<string, unknown>;
	}

	private optionalString(value: unknown): string | undefined {
		return typeof value === 'string' && value.trim() ? value : undefined;
	}

	private optionalNumber(value: unknown): number | undefined {
		const number = Number(value);
		return Number.isFinite(number) ? number : undefined;
	}

	private isHex(value: unknown): value is string {
		return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
	}
}
