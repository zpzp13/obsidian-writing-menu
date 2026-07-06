import { normalizePath, Notice, parseYaml, stringifyYaml } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { PlotProject, PlotLine, PlotEpisode, PlotChapter, PlotScene, PlotCell, CharCell, PlotCharacter } from './PlotTypes';
import { newId } from './PlotTypes';

export class PlotManager {
	constructor(private plugin: WritingMenuPlugin) {}

	private getRootFolder(): string {
		return this.plugin.settings.plotManagerFolder?.trim() ?? '';
	}

	private getFolder(): string {
		const root = this.getRootFolder();
		if (!root) return '';
		const sub = this.plugin.settings.plotDataFolder?.trim() ?? '';
		return sub ? normalizePath(root + '/' + sub) : root;
	}

	private getConfigPath(): string {
		const folder = this.getFolder();
		if (!folder) return '';
		return normalizePath(folder + '/plot-config.md');
	}

	private getEpisodePath(name: string): string {
		const folder = this.getFolder();
		if (!folder) return '';
		return normalizePath(folder + '/' + name + '.md');
	}

	private getLegacyJsonPath(): string {
		const folder = this.getFolder();
		if (!folder) return '';
		return normalizePath(folder + '/.writing-menu-plot.json');
	}

	private getLegacyMdPath(): string {
		const folder = this.getFolder();
		if (!folder) return '';
		return normalizePath(folder + '/plot-data.md');
	}

	// ── Frontmatter parsing ──────────────────────────────────────────────────

	private parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
		const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
		if (!match) return { data: {}, body: raw };
		try {
			const data = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
			return { data, body: match[2] };
		} catch {
			return { data: {}, body: raw };
		}
	}

	private buildFrontmatter(data: Record<string, unknown>): string {
		return '---\n' + stringifyYaml(data) + '---\n\n';
	}

	// ── Episode body parsing ────────────────────────────────────────────────

	private parseEpisodeBody(
		body: string,
		episode: PlotEpisode,
		plotLines: PlotLine[],
		characters: PlotCharacter[],
	): { plotCells: Record<string, PlotCell>; charCells: Record<string, CharCell> } {
		const plotCells: Record<string, PlotCell> = {};
		const charCells: Record<string, CharCell> = {};
		const lines = body.split('\n');

		let currentChapter: PlotChapter | null = null;
		let currentScene: PlotScene | null = null;
		let currentPlotLine: PlotLine | null = null;
		let currentChar: PlotCharacter | null = null;
		let inCharSection = false;
		const contentBuffer: string[] = [];

		const flushBuffer = () => {
			const content = contentBuffer.join('\n').trim();
			contentBuffer.length = 0;
			if (!content) return;
			if (currentPlotLine && currentScene) {
				const key = `${currentPlotLine.id}__${currentScene.id}`;
				plotCells[key] = { plotLineId: currentPlotLine.id, sceneId: currentScene.id, content };
			} else if (currentChar && currentScene) {
				const key = `${currentChar.id}__${currentScene.id}`;
				charCells[key] = { charId: currentChar.id, sceneId: currentScene.id, content };
			}
		};

		for (const line of lines) {
			const h2 = line.match(/^## (.+)$/);
			const h3 = line.match(/^### (.+)$/);
			const h4 = line.match(/^#### (.+)$/);
			const h5 = line.match(/^##### (.+)$/);

			if (h2) {
				flushBuffer();
				currentPlotLine = null;
				currentChar = null;
				currentScene = null;
				inCharSection = false;
				const chName = h2[1].trim();
				currentChapter = episode.chapters.find(ch => ch.name === chName) ?? null;
			} else if (h3) {
				flushBuffer();
				currentPlotLine = null;
				currentChar = null;
				inCharSection = false;
				const scName = h3[1].trim();
				currentScene = currentChapter?.scenes.find(sc => sc.name === scName) ?? null;
			} else if (h4) {
				flushBuffer();
				const h4name = h4[1].trim();
				if (h4name === '캐릭터') {
					// New format: char section marker, names follow as #####
					inCharSection = true;
					currentPlotLine = null;
					currentChar = null;
				} else if (h4name.startsWith('인물: ')) {
					// Old format backward compat: "#### 인물: {name}"
					inCharSection = false;
					const charName = h4name.slice(4).trim();
					currentChar = characters.find(ch => ch.name === charName) ?? null;
					currentPlotLine = null;
				} else {
					inCharSection = false;
					currentPlotLine = plotLines.find(pl => pl.name === h4name) ?? null;
					currentChar = null;
				}
			} else if (h5 && inCharSection) {
				flushBuffer();
				const charName = h5[1].trim();
				currentChar = characters.find(ch => ch.name === charName) ?? null;
				if (!currentChar) {
					// 삭제된 인물이 에피소드 파일에 남아 있는 경우 자동 복원
					currentChar = { id: newId(), name: charName };
					characters.push(currentChar);
				}
				currentPlotLine = null;
			} else {
				if ((currentPlotLine || currentChar) && currentScene) {
					contentBuffer.push(line);
				}
			}
		}
		flushBuffer();
		return { plotCells, charCells };
	}

	// ── Episode file generation ─────────────────────────────────────────────

	private buildEpisodeContent(
		ep: PlotEpisode,
		plotLines: PlotLine[],
		plotCells: Record<string, PlotCell>,
		characters: PlotCharacter[],
		charCells: Record<string, CharCell>,
	): string {
		const fm: Record<string, unknown> = {
			episodeId: ep.id,
			...(ep.subtitle ? { subtitle: ep.subtitle } : {}),
			chapters: ep.chapters.map(ch => ({
				id: ch.id,
				name: ch.name,
				scenes: ch.scenes.map(sc => ({
					id: sc.id,
					name: sc.name,
					characters: sc.characters ?? [],
				})),
			})),
		};

		let content = this.buildFrontmatter(fm);

		for (const ch of ep.chapters) {
			content += `## ${ch.name}\n\n`;
			for (const sc of ch.scenes) {
				content += `### ${sc.name}\n\n`;
				for (const pl of plotLines) {
					const key = `${pl.id}__${sc.id}`;
					const cell = plotCells[key];
					if (cell?.content) {
						content += `#### ${pl.name}\n\n${cell.content}\n\n`;
					}
				}
				const sceneChars = characters.filter(ch => charCells[`${ch.id}__${sc.id}`]?.content);
				if (sceneChars.length > 0) {
					content += `#### 캐릭터\n\n`;
					for (const char of sceneChars) {
						const cell = charCells[`${char.id}__${sc.id}`];
						content += `##### ${char.name}\n\n${cell.content}\n\n`;
					}
				}
			}
		}

		return content;
	}

	// ── Config file generation ───────────────────────────────────────────────

	private buildConfigContent(project: PlotProject): string {
		const fm: Record<string, unknown> = {
			plotLines: project.plotLines.map(pl => ({
				id: pl.id,
				name: pl.name,
				collapsed: pl.collapsed,
				...(pl.color ? { color: pl.color } : {}),
				...(pl.colorDark ? { colorDark: pl.colorDark } : {}),
				...(pl.rowHeight !== undefined ? { rowHeight: pl.rowHeight } : {}),
				...(pl.fontSize !== undefined ? { fontSize: pl.fontSize } : {}),
				...(pl.fontColor ? { fontColor: pl.fontColor } : {}),
				...(pl.fontColorDark ? { fontColorDark: pl.fontColorDark } : {}),
			})),
			characters: project.characters.map(ch => ({
				id: ch.id,
				name: ch.name,
				...(ch.color ? { color: ch.color } : {}),
				...(ch.filePath ? { filePath: ch.filePath } : {}),
				...(ch.rowHeight !== undefined ? { rowHeight: ch.rowHeight } : {}),
				...(ch.fontSize !== undefined ? { fontSize: ch.fontSize } : {}),
				...(ch.fontColor ? { fontColor: ch.fontColor } : {}),
				...(ch.fontColorDark ? { fontColorDark: ch.fontColorDark } : {}),
				...(ch.bgColor ? { bgColor: ch.bgColor } : {}),
				...(ch.bgColorDark ? { bgColorDark: ch.bgColorDark } : {}),
			})),
		};

		return this.buildFrontmatter(fm);
	}

	// ── Load ─────────────────────────────────────────────────────────────────

	async load(): Promise<PlotProject> {
		const root = this.getRootFolder();
		const folder = this.getFolder();
		if (!folder) {
			new Notice('플롯 매니저: 설정에서 플롯 폴더를 지정해 주세요.');
			return this.createEmptyProject();
		}

		if (root) await this.ensureDir(normalizePath(root));
		await this.ensureDir(normalizePath(folder));

		await this.migrateLegacyJson();
		await this.migrateLegacyMd();

		const configPath = this.getConfigPath();
		const configExists = await this.plugin.app.vault.adapter.exists(configPath);
		if (!configExists) return this.createEmptyProject();

		try {
			const raw = await this.plugin.app.vault.adapter.read(configPath);
			const { data } = this.parseFrontmatter(raw);

			const plotLines = this.parseConfigPlotLines(data);
			const characters = this.parseConfigCharacters(data);
			const prevCharCount = characters.length;

			// Legacy: charCells may still exist in old config — use as fallback
			const legacyCharCells = this.parseConfigCharCells(data);

			const episodes: PlotEpisode[] = [];
			const plotCells: Record<string, PlotCell> = {};
			const charCells: Record<string, CharCell> = { ...legacyCharCells };

			const files = await this.listEpisodeFiles(folder);
			for (const filePath of files) {
				try {
					const fileRaw = await this.plugin.app.vault.adapter.read(filePath);
					const { data: epData, body } = this.parseFrontmatter(fileRaw);
					const ep = this.parseEpisodeFrontmatter(epData, filePath);
					if (!ep) continue;
					const { plotCells: epPlotCells, charCells: epCharCells } = this.parseEpisodeBody(body, ep, plotLines, characters);
					Object.assign(plotCells, epPlotCells);
					Object.assign(charCells, epCharCells);
					episodes.push(ep);
				} catch { /* skip */ }
			}

			// Sort episodes by their first chapter number so array order matches
			// display order regardless of alphabetical file-loading order.
			episodes.sort((a, b) => {
				const minNum = (ep: PlotEpisode) => ep.chapters.reduce((m, ch) => {
					const n = parseInt(ch.name);
					return isNaN(n) ? m : Math.min(m, n);
				}, Infinity);
				return minNum(a) - minNum(b);
			});
			const project = { plotLines, episodes, characters, plotCells, charCells };
			// 에피소드 파일에서 삭제된 인물이 복원된 경우 config 재저장
			if (characters.length > prevCharCount) {
				await this.save(project);
			}
			return project;
		} catch {
			return this.createEmptyProject();
		}
	}

	private parseConfigPlotLines(data: Record<string, unknown>): PlotLine[] {
		if (!Array.isArray(data.plotLines)) return [];
		return data.plotLines
			.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
			.map(item => ({
				id: String(item.id ?? newId()),
				name: String(item.name ?? ''),
				collapsed: Boolean(item.collapsed ?? false),
				...(item.color ? { color: String(item.color) } : {}),
				...(item.colorDark ? { colorDark: String(item.colorDark) } : {}),
				...(item.rowHeight !== undefined ? { rowHeight: Number(item.rowHeight) } : {}),
				...(item.fontSize !== undefined ? { fontSize: Number(item.fontSize) } : {}),
				...(item.fontColor ? { fontColor: String(item.fontColor) } : {}),
				...(item.fontColorDark ? { fontColorDark: String(item.fontColorDark) } : {}),
			}));
	}

	private parseConfigCharacters(data: Record<string, unknown>): PlotCharacter[] {
		if (!Array.isArray(data.characters)) return [];
		return data.characters
			.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
			.map(item => ({
				id: String(item.id ?? newId()),
				name: String(item.name ?? ''),
				...(item.color ? { color: String(item.color) } : {}),
				...(item.filePath ? { filePath: String(item.filePath) } : {}),
				...(item.rowHeight !== undefined ? { rowHeight: Number(item.rowHeight) } : {}),
				...(item.fontSize !== undefined ? { fontSize: Number(item.fontSize) } : {}),
				...(item.fontColor ? { fontColor: String(item.fontColor) } : {}),
				...(item.fontColorDark ? { fontColorDark: String(item.fontColorDark) } : {}),
				...(item.bgColor ? { bgColor: String(item.bgColor) } : {}),
				...(item.bgColorDark ? { bgColorDark: String(item.bgColorDark) } : {}),
			}));
	}

	private parseConfigCharCells(data: Record<string, unknown>): Record<string, CharCell> {
		const result: Record<string, CharCell> = {};
		const raw = data.charCells;
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
		for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
			const [charId, sceneId] = key.split('__');
			if (!charId || !sceneId) continue;
			result[key] = { charId, sceneId, content: String(value ?? '') };
		}
		return result;
	}

	private parseEpisodeFrontmatter(data: Record<string, unknown>, filePath: string): PlotEpisode | null {
		const episodeId = data.episodeId ? String(data.episodeId) : newId();
		const chapters: PlotChapter[] = [];

		if (Array.isArray(data.chapters)) {
			for (const chRaw of data.chapters) {
				if (typeof chRaw !== 'object' || !chRaw) continue;
				const chData = chRaw as Record<string, unknown>;
				const scenes: PlotScene[] = [];
				if (Array.isArray(chData.scenes)) {
					for (const scRaw of chData.scenes) {
						if (typeof scRaw !== 'object' || !scRaw) continue;
						const scData = scRaw as Record<string, unknown>;
						const characters = Array.isArray(scData.characters)
							? scData.characters.map(String)
							: [];
						scenes.push({
							id: String(scData.id ?? newId()),
							name: String(scData.name ?? ''),
							characters,
						});
					}
				}
				chapters.push({
					id: String(chData.id ?? newId()),
					name: String(chData.name ?? ''),
					scenes,
				});
			}
		}

		const fileName = filePath.split('/').pop() ?? filePath;
		const epName = fileName.replace(/\.md$/i, '');
		const subtitle = typeof data.subtitle === 'string' ? data.subtitle : undefined;

		return { id: episodeId, name: epName, subtitle, filePath, chapters };
	}

	private async listEpisodeFiles(folder: string): Promise<string[]> {
		const configName = normalizePath(folder + '/plot-config.md');
		try {
			const listed = await this.plugin.app.vault.adapter.list(normalizePath(folder));
			return listed.files.filter(f => f.endsWith('.md') && f !== configName);
		} catch {
			return [];
		}
	}

	// ── Save ─────────────────────────────────────────────────────────────────

	async save(project: PlotProject): Promise<void> {
		const root = this.getRootFolder();
		const folder = this.getFolder();
		if (!folder) return;
		if (root) await this.ensureDir(normalizePath(root));
		await this.ensureDir(normalizePath(folder));

		const configPath = this.getConfigPath();
		await this.plugin.app.vault.adapter.write(configPath, this.buildConfigContent(project));

		for (const ep of project.episodes) {
			const filePath = ep.filePath || this.getEpisodePath(ep.name);
			ep.filePath = filePath;
			const content = this.buildEpisodeContent(ep, project.plotLines, project.plotCells, project.characters, project.charCells);
			await this.plugin.app.vault.adapter.write(filePath, content);
		}
	}

	// ── Migration ────────────────────────────────────────────────────────────

	private async migrateLegacyJson(): Promise<void> {
		const legacyPath = this.getLegacyJsonPath();
		if (!legacyPath) return;
		if (!(await this.plugin.app.vault.adapter.exists(legacyPath))) return;
		try {
			const raw = await this.plugin.app.vault.adapter.read(legacyPath);
			const project = JSON.parse(raw) as PlotProject;
			await this.save(project);
			await this.plugin.app.vault.adapter.remove(legacyPath);
		} catch { /* ignore */ }
	}

	private async migrateLegacyMd(): Promise<void> {
		const legacyPath = this.getLegacyMdPath();
		if (!legacyPath) return;
		if (!(await this.plugin.app.vault.adapter.exists(legacyPath))) return;
		try {
			const raw = await this.plugin.app.vault.adapter.read(legacyPath);
			const trimmed = raw.trim();
			if (trimmed.startsWith('{')) {
				const project = JSON.parse(trimmed) as PlotProject;
				await this.save(project);
				await this.plugin.app.vault.adapter.remove(legacyPath);
			}
		} catch { /* ignore */ }
	}

	// ── Utils ─────────────────────────────────────────────────────────────────

	private async ensureDir(dir: string): Promise<void> {
		if (!(await this.plugin.app.vault.adapter.exists(dir))) {
			await this.plugin.app.vault.adapter.mkdir(dir);
		}
	}

	createEmptyProject(): PlotProject {
		const sc1 = { id: newId(), name: '1-1', characters: [] as string[] };
		const sc2 = { id: newId(), name: '1-2', characters: [] as string[] };
		const sc3 = { id: newId(), name: '1-3', characters: [] as string[] };
		const ch1 = { id: newId(), name: '1화', scenes: [sc1, sc2, sc3] };
		const ep1 = { id: newId(), name: 'EPISODE 1', chapters: [ch1] };
		return {
			plotLines: [{ id: newId(), name: '메인 플롯', collapsed: false }],
			episodes: [ep1],
			characters: [],
			plotCells: {},
			charCells: {},
		};
	}

}
