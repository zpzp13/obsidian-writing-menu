import type WritingMenuPlugin from '../../main';
import type { WritingProject } from '../types';
import { PlotWorkbookRepository } from '../plot-workbook/PlotWorkbookRepository';
import { plotWorkbookSessions } from '../plot-workbook/PlotWorkbookSessionStore';
import { plotColumnTitle } from '../plot-workbook/PlotWorkbookColumnPresentation';
import { PlotWorkbookSession } from '../plot-workbook/PlotWorkbookSession';
import { chatPassages, type ChatPassage } from './AiChatRetrieval';

export interface DeusPlotSelection { projectRoot: string; sheetId: string; rowIds: string[] }

/** Prefer unsaved live edits; the disk fallback replays JSONL without opening a writing session. */
export async function readChatPlotPassages(plugin: WritingMenuPlugin, project: WritingProject, characterPath: string, documentPath?: string, selection?: DeusPlotSelection): Promise<ChatPassage[]> {
	if (selection && selection.projectRoot !== project.rootFolder) return [];
	const live = () => plotWorkbookSessions(plugin).peek(project);
	let data = live();
	if (!data) {
		const repository = new PlotWorkbookRepository(plugin, project.rootFolder);
		try {
			const loaded = await repository.readExistingWorkbook(); data = live();
			// This detached model is never acquired, mutated, flushed or subscribed to.
			if (!data && loaded) return passages(new PlotWorkbookSession(repository, loaded.manifest, loaded.sheets, loaded.foreshadows, loaded.warnings));
		}
		finally { repository.dispose(); }
	}
	return data ? passages(data) : [];

	function passages(workbook: PlotWorkbookSession): ChatPassage[] {
		const result: ChatPassage[] = [];
		let sequence = 0;
		for (const ref of workbook.manifest.sheets) {
			if (selection && ref.id !== selection.sheetId) continue;
			const sheet = workbook.sheets.get(ref.id); if (!sheet) continue;
			const labels = workbook.rowLabels(sheet);
			for (const id of sheet.rowOrder) {
				if (selection && !selection.rowIds.includes(id)) continue;
				const row = sheet.rows[id]; if (!row) continue;
				const fields: string[] = [], characterPaths = new Set<string>(); sequence++;
				let involvesCharacter = false;
				for (const columnId of sheet.columnOrder) {
					const column = sheet.columns[columnId]; if (!column || column.role === 'foreshadow') continue;
					let value = sheet.cells[id]?.[columnId]?.value ?? '';
					if (column.role === 'cast') {
						const paths = workbook.getAppearancePaths(sheet, id, columnId);
						for (const path of paths) characterPaths.add(path);
						if (paths.includes(characterPath)) involvesCharacter = true;
						value = paths.map(path => `${path.split('/').pop()?.replace(/\.md$/i, '')} (${path})`).join(', ');
					}
					if (!value.trim()) continue;
					if (column.role === 'character' && column.characterNotePath) { characterPaths.add(column.characterNotePath); if (column.characterNotePath === characterPath) involvesCharacter = true; }
					if (column.role === 'status') value = workbook.statusName(value);
					const columnTitle = column.role === 'character' && column.characterNotePath ? column.title || column.characterNotePath.split('/').pop()?.replace(/\.md$/i, '') || '인물' : plotColumnTitle(sheet, columnId);
					fields.push(`${columnTitle}: ${value}`);
				}
				for (const item of workbook.foreshadows) if ([...item.plantedAt, ...item.resolvedAt].some(point => point.sheetId === sheet.sheetId && point.rowId === id)) fields.push(`복선 (${item.status === 'resolved' ? '회수' : '미회수'}): ${item.title}${item.note ? `\n${item.note}` : ''}`);
				if (!fields.length) continue;
				const title = `${project.name} / ${ref.name} / ${labels.get(id) ?? id}행`;
				const sourceId = `plot:${project.rootFolder}:${sheet.sheetId}:${id}`;
				result.push(...chatPassages(fields.join('\n\n'), {
					id: sourceId, title, kind: 'plot', automatic: true, group: sourceId,
					path: row.linkedNotePath,
					characterPaths: [...characterPaths], sequence,
					boost: documentPath && row.linkedNotePath === documentPath ? 16 : involvesCharacter ? 1.1 : 0,
				}));
			}
		}
		return result;
	}
}
