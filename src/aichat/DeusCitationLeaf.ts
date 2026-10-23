import type { Workspace, WorkspaceLeaf } from 'obsidian';

/** getLeaf(false) may create a tab when the active root view is a non-navigable ItemView. */
export function deusCitationLeaf(workspace: Workspace, mode: 'current' | 'tab' = 'current'): WorkspaceLeaf {
	return mode === 'tab' ? workspace.getLeaf('tab') : workspace.getMostRecentLeaf() ?? workspace.getLeaf(false);
}
