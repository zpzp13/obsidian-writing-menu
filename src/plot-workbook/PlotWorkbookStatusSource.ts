import type WritingMenuPlugin from '../../main';
import type { WritingProject } from '../types';
import { PlotWorkbookRepository } from './PlotWorkbookRepository';
import { plotWorkbookSessions } from './PlotWorkbookSessionStore';
import { plotWorkbookStatuses } from './PlotWorkbookStatus';
import type { PlotWorkbookStatus } from './PlotWorkbookTypes';

/** Read the same project statuses as the sheet without creating or saving a workbook. */
export async function readProjectStatuses(plugin: WritingMenuPlugin, project: WritingProject | null): Promise<PlotWorkbookStatus[]> {
	if (!project) return plotWorkbookStatuses();
	const live = () => plotWorkbookSessions(plugin).peek(project);
	const session = live();
	if (session) return plotWorkbookStatuses(session.manifest.statuses, true);
	const repository = new PlotWorkbookRepository(plugin, project.rootFolder);
	try {
		const manifest = await repository.loadExistingManifest();
		return plotWorkbookStatuses(live()?.manifest.statuses ?? manifest?.statuses, true);
	} finally { repository.dispose(); }
}
