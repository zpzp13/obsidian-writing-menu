import { wmT } from '../i18n/index';
import { ItemView, WorkspaceLeaf } from 'obsidian';

/** Keeps legacy workspace leaves restorable until the plugin redirects them. */
export class LegacyPlotViewRedirect extends ItemView {
	constructor(leaf: WorkspaceLeaf, private readonly legacyType: string) {
		super(leaf);
	}

	getViewType(): string { return this.legacyType; }
	getDisplayText(): string { return wmT("플롯 매니저 전환 중"); }
	getIcon(): string { return 'table-2'; }
}
