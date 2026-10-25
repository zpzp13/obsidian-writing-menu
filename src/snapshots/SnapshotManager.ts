import { wmT } from '../i18n/index';
import { Notice, type WorkspaceLeaf } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { WritingProject } from '../types';
import { PlotWorkbookView } from '../plot-workbook/PlotWorkbookView';
import { openPlotSnapshots } from '../plot-workbook/PlotWorkbookTransferModal';
import { getWritingDocumentForView, type WritingDocument } from '../writing/WritingDocument';
import { ManuscriptSnapshotModal } from './ManuscriptSnapshotModal';

type SnapshotTarget = { kind: 'plot'; project: WritingProject } | { kind: 'manuscript'; document: WritingDocument };

export function snapshotTarget(plugin: WritingMenuPlugin, leaf?: WorkspaceLeaf | null): SnapshotTarget | null {
	const view = (leaf ?? plugin.app.workspace.getLeaf(false)).view;
	if (view instanceof PlotWorkbookView) {
		const project = plugin.projectContext.getProjects().find(item => item.id === view.getState().projectId);
		return project ? { kind: 'plot', project } : null;
	}
	const document = getWritingDocumentForView(view);
	return document && plugin.projectContext.getProjectForFile(document.file) ? { kind: 'manuscript', document } : null;
}

export function openSnapshotManager(plugin: WritingMenuPlugin, leaf?: WorkspaceLeaf | null): void {
	const target = snapshotTarget(plugin, leaf);
	if (!target) { new Notice(wmT("프로젝트 내부 문서나 플롯 매니저를 먼저 열어 주세요.")); return; }
	if (target.kind === 'plot') void openPlotSnapshots(plugin, target.project);
	else new ManuscriptSnapshotModal(plugin, target.document).open();
}
