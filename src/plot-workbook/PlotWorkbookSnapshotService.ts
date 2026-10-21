import type { WritingProject } from '../types';
import type { PlotWorkbookSession } from './PlotWorkbookSession';
import { createPlotSnapshot, plotSnapshotMarkdown, type PlotWorkbookSnapshot } from './PlotWorkbookSnapshot';

/** Replace only the current project's plot; notes and project registration are untouched. */
export async function restorePlotSnapshot(target: WritingProject, session: PlotWorkbookSession,
	snapshot: PlotWorkbookSnapshot): Promise<{ project: WritingProject; backupPath: string }> {
	const assertTarget = () => {
		if (!session.repository.isForProjectRoot(target.rootFolder)) {
			throw new Error('복원 대상 폴더와 현재 플롯 저장 위치가 다릅니다. 플롯을 다시 열어주세요.');
		}
	};
	// The session store also owns writers by folder, not by device-local registration ID.
	assertTarget();
	// Work exclusively with detached, validated data; never trust the Markdown summary.
	const data = JSON.parse(JSON.stringify(snapshot.data)) as PlotWorkbookSnapshot['data'];
	session.repository.validateSnapshotData(data);
	return session.withSnapshot(async previous => {
		assertTarget();
		const backup = createPlotSnapshot(previous, { ...target, rootFolder: session.repository.projectRoot });
		const backupPath = await session.repository.saveTransferBackup(backup.id, await plotSnapshotMarkdown(backup));
		data.manifest.projectId = target.id;
		data.manifest.projectName = target.name;
		await session.restoreSnapshot(data);
		return { project: target, backupPath };
	});
}
