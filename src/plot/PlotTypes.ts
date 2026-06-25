export const PLOT_VIEW_TYPE = 'writing-menu-plot-manager';
export const PLOT_TIMELINE_VIEW_TYPE = 'writing-menu-plot-timeline';

export type PlotSelection =
	| { kind: 'episode'; episodeId: string }
	| { kind: 'chapter'; chapterId: string }
	| { kind: 'scene';   sceneId: string }
	| null;

export type CellSelection = {
	kind: 'plotLine';
	lineId: string;
	sceneId: string;
} | {
	kind: 'char';
	charId: string;
	sceneId: string;
} | null;

export interface PlotProject {
	plotLines: PlotLine[];
	episodes: PlotEpisode[];
	characters: PlotCharacter[];
	plotCells: Record<string, PlotCell>;
	charCells: Record<string, CharCell>;
}

export interface PlotLine {
	id: string;
	name: string;
	collapsed: boolean;
	color?: string;
}

export interface PlotEpisode {
	id: string;
	name: string;
	subtitle?: string;
	filePath?: string;
	chapters: PlotChapter[];
}

export interface PlotChapter {
	id: string;
	name: string;
	filePath?: string;
	scenes: PlotScene[];
}

export interface PlotScene {
	id: string;
	name: string;
	filePath?: string;
	characters?: string[];
}

export interface PlotCell {
	plotLineId: string;
	sceneId: string;
	content?: string;
	filePath?: string;
}

export interface PlotCharacter {
	id: string;
	name: string;
	filePath?: string;
	color?: string;
}

export interface CharCell {
	charId: string;
	sceneId: string;
	content?: string;
}

export function getAllScenes(project: PlotProject): PlotScene[] {
	const scenes: PlotScene[] = [];
	for (const ep of project.episodes) {
		for (const ch of ep.chapters) {
			for (const sc of ch.scenes) {
				scenes.push(sc);
			}
		}
	}
	return scenes;
}

export function newId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}
