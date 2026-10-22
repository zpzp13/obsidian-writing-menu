import { ItemView, Menu, Notice, Scope, WorkspaceLeaf, setIcon, type ViewStateResult } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { WritingProject } from '../types';
import { InfinitePlotSheet, type PlotSheetSelection } from './InfinitePlotSheet';
import { PlotWorkbookSession } from './PlotWorkbookSession';
import { plotWorkbookSessions, type PlotWorkbookSessionLease } from './PlotWorkbookSessionStore';
import { PlotWorkbookToolbar } from './PlotWorkbookToolbar';
import { PlotWorkbookSheetTrashModal } from './PlotWorkbookSheetTrashModal';
import { PLOT_WORKBOOK_VIEW_TYPE, type PlotWorkbookForeshadowLocation } from './PlotWorkbookTypes';

interface PlotWorkbookViewState {
	projectId?: string;
}

export class PlotWorkbookView extends ItemView {
	private session: PlotWorkbookSession | null = null;
	private sheetView: InfinitePlotSheet | null = null;
	private toolbarView: PlotWorkbookToolbar | null = null;
	private sessionUnsubscribe: (() => void) | null = null;
	private projectId: string | null = null;
	private lastSelection: PlotSheetSelection = { rowIndex: 0, columnIndex: 0 };
	private sheetThumbPosition: { x: number; y: number; w: number; h: number } | null = null;
	private opened = false;
	private loadToken = 0;
	private sessionLease: PlotWorkbookSessionLease | null = null;
	private sheetTabsSignature = '';

	constructor(leaf: WorkspaceLeaf, private readonly plugin: WritingMenuPlugin) {
		super(leaf);
		this.scope = new Scope(this.app.scope);
		this.scope.register(['Mod'], 'f', event => {
			if (event.shiftKey) return;
			this.toolbarView?.openSearch(false);
			return false;
		});
		this.scope.register(['Mod'], 'h', event => {
			if (event.shiftKey) return;
			this.toolbarView?.openSearch(true);
			return false;
		});
	}

	getViewType(): string { return PLOT_WORKBOOK_VIEW_TYPE; }
	getDisplayText(): string { return '플롯 매니저'; }
	getIcon(): string { return 'table-2'; }
	getStatusSettingsSession(projectId: string): PlotWorkbookSession | null {
		return this.projectId === projectId ? this.session : null;
	}
	getDeusSceneSelection(): { projectRoot: string; sheetId: string; rowIds: string[] } | null {
		const project = this.plugin.settings.projects.find(project => project.id === this.projectId);
		if (!project || !this.session || !this.sheetView || !this.containerEl.isConnected) return null;
		return { projectRoot: project.rootFolder, sheetId: this.session.activeSheet.sheetId, rowIds: this.sheetView.getSelectedSceneRows() };
	}

	async revealCell(sheetId: string, rowId: string, columnId: string): Promise<boolean> {
		return this.revealForeshadowLocation({ sheetId, rowId, columnId });
	}

	getState(): Record<string, unknown> {
		return { projectId: this.projectId };
	}

	async setState(state: unknown, _result: ViewStateResult): Promise<void> {
		const next = this.parseState(state);
		const projectChanged = next.projectId !== undefined && next.projectId !== this.projectId;
		if (next.projectId !== undefined) this.projectId = next.projectId;
		if (!this.opened) return;
		if (projectChanged) await this.loadProject();
		else this.render();
	}

	async onOpen(): Promise<void> {
		this.opened = true;
		await this.loadProject();
	}

	async onClose(): Promise<void> {
		this.opened = false;
		this.destroyViews();
		const lease = this.sessionLease;
		this.sessionLease = null;
		this.session = null;
		if (lease) {
			try {
				await lease.release();
			} catch (error) {
				new Notice(`플롯 시트를 저장하지 못했습니다: ${this.errorMessage(error)}`);
			}
		}
	}

	private async loadProject(): Promise<void> {
		const token = ++this.loadToken;
		this.destroyViews();
		const previous = this.sessionLease;
		this.sessionLease = null;
		this.session = null;
		if (previous) {
			try {
				await previous.release();
			} catch (error) {
				new Notice(`이전 프로젝트를 저장하지 못했습니다: ${this.errorMessage(error)}`);
			}
		}

		const project = this.resolveProject();
		if (!project) {
			this.projectId = null;
			this.render();
			return;
		}
		this.projectId = project.id;
		this.renderLoading(project.name);
		try {
			const lease = await plotWorkbookSessions(this.plugin).acquire(project);
			if (token !== this.loadToken || !this.opened) {
				await lease.release();
				return;
			}
			this.sessionLease = lease;
			this.session = lease.session;
			let generation = this.session.manifest.storageGeneration;
			this.sessionUnsubscribe = this.session.subscribe(() => {
				if (generation !== this.session?.manifest.storageGeneration) {
					generation = this.session?.manifest.storageGeneration;
					this.lastSelection = { rowIndex: 0, columnIndex: 0 };
					this.render();
					return;
				}
				this.toolbarView?.refresh();
				const signature = this.currentSheetTabsSignature();
				if (signature !== this.sheetTabsSignature) this.refreshSheetTabs();
			});
			this.render();
		} catch (error) {
			if (token !== this.loadToken) return;
			this.renderError(project, error);
		}
	}

	private render(): void {
		this.destroyViews(false);
		const content = this.contentEl;
		content.empty();
		content.addClass('wm-plotbook-view');
		const projects = this.plugin.projectContext.getProjects();
		if (projects.length === 0 || !this.session) {
			this.renderNoProject(content, projects.length === 0);
			return;
		}

		const toolbarHost = content.createDiv({ cls: 'wm-plotbook-toolbar-host' });
		const workspace = content.createDiv({ cls: 'wm-plotbook-workspace' });
		const activeProject = projects.find(project => project.id === this.projectId) ?? projects[0];
		this.sheetView = new InfinitePlotSheet(
			workspace,
			this.plugin,
			activeProject?.rootFolder ?? '',
			activeProject?.manuscriptFolder ?? '',
			activeProject?.characterFolder ?? '',
			this.session,
			selection => {
			this.lastSelection = selection;
			this.toolbarView?.refresh();
			},
			focusReplace => this.toolbarView?.openSearch(focusReplace),
			location => this.revealForeshadowLocation(location),
		);
		this.sheetView.select(this.lastSelection.rowIndex, this.lastSelection.columnIndex, false);
		this.toolbarView = new PlotWorkbookToolbar(
			this.plugin,
			toolbarHost,
			this.session,
			this.sheetView,
			projects,
			this.projectId,
			projectId => {
				this.projectId = projectId;
				void this.loadProject();
			},
		);
		this.renderSheetTabs(workspace);
	}

	private async revealForeshadowLocation(location: PlotWorkbookForeshadowLocation): Promise<boolean> {
		const session = this.session;
		if (!session || !session.sheets.has(location.sheetId)) {
			new Notice('복선이 연결된 시트를 찾을 수 없습니다.');
			return false;
		}
		if (session.manifest.activeSheetId !== location.sheetId) await session.selectSheet(location.sheetId);
		const sheet = session.activeSheet;
		const rowIndex = sheet.rowOrder.indexOf(location.rowId);
		const columnIndex = sheet.columnOrder.indexOf(location.columnId);
		if (rowIndex < 0 || columnIndex < 0) {
			new Notice('복선이 연결된 셀을 찾을 수 없습니다.');
			return false;
		}
		if (sheet.rows[location.rowId]?.collapsed) session.setRowCollapsed(location.rowId, false);
		if (sheet.columns[location.columnId]?.collapsed) session.setColumnCollapsed(location.columnId, false);
		this.lastSelection = { rowIndex, columnIndex };
		this.render();
		this.sheetView?.select(rowIndex, columnIndex, false);
		this.sheetView?.revealSelected(true);
		this.sheetView?.focus();
		return true;
	}

	private renderSheetTabs(content: HTMLElement): void {
		if (!this.session) return;
		this.sheetTabsSignature = this.currentSheetTabsSignature();
		const dock = content.createDiv({ cls: 'wm-plotbook-sheet-dock' });
		const bar = dock.createDiv({
			cls: 'wm-plotbook-sheet-tabs wm-dash-char-range-seg',
			attr: { role: 'tablist' },
		});
		const thumb = bar.createSpan({ cls: 'wm-dash-char-range-thumb' });
		let activeTab: HTMLButtonElement | null = null;
		const tabs = new Map<string, HTMLButtonElement>();
		const putThumb = (position: { x: number; y: number; w: number; h: number }) => {
			thumb.setCssStyles({
				width: `${position.w}px`,
				height: `${position.h}px`,
				transform: `translate(${position.x}px, ${position.y}px)`,
			});
		};
		const placeThumb = (tab: HTMLButtonElement | null) => {
			if (!tab?.isConnected || !thumb.isConnected) return;
			const position = { x: tab.offsetLeft, y: tab.offsetTop, w: tab.offsetWidth, h: tab.offsetHeight };
			putThumb(position);
			this.sheetThumbPosition = position;
			const left = tab.offsetLeft;
			const right = left + tab.offsetWidth;
			if (left < bar.scrollLeft) bar.scrollLeft = left;
			else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = right - bar.clientWidth;
		};
		for (const ref of this.session.manifest.sheets) {
			const active = ref.id === this.session.manifest.activeSheetId;
			const tab = bar.createEl('button', {
				cls: `wm-plotbook-sheet-tab${active ? ' is-active' : ''}`,
				text: ref.name,
				attr: { role: 'tab', 'aria-selected': String(active), 'aria-pressed': String(active) },
			});
			tabs.set(ref.id, tab);
			if (active) activeTab = tab;
			tab.addEventListener('click', () => void (async () => {
				const session = this.session;
				if (!session || session.manifest.activeSheetId === ref.id) return;
				await session.selectSheet(ref.id);
				this.lastSelection = { rowIndex: 0, columnIndex: 0 };
				this.sheetView?.select(0, 0, false);
				for (const [sheetId, other] of tabs) {
					const selected = sheetId === ref.id;
					other.toggleClass('is-active', selected);
					other.setAttribute('aria-selected', String(selected));
					other.setAttribute('aria-pressed', String(selected));
				}
				activeTab = tab;
				placeThumb(tab);
			})().catch(error => new Notice(`시트를 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)));
			tab.addEventListener('dblclick', () => this.beginSheetRename(tab, ref.id, ref.name));
			tab.addEventListener('contextmenu', event => {
				event.preventDefault();
				const menu = new Menu();
				menu.addItem(item => item
					.setTitle('이름 변경')
					.setIcon('pencil')
					.onClick(() => this.beginSheetRename(tab, ref.id, ref.name)));
				menu.addSeparator();
				menu.addItem(item => item
					.setTitle('시트 삭제')
					.setIcon('trash-2')
					.setDisabled((this.session?.manifest.sheets.length ?? 0) <= 1)
					.onClick(() => void this.deleteSheet(ref.id)));
				menu.showAtMouseEvent(event);
			});
		}
		const actions = dock.createDiv({ cls: 'wm-plotbook-sheet-actions' });
		const add = actions.createEl('button', { cls: 'clickable-icon wm-plotbook-add-sheet', attr: { type: 'button' } });
		setIcon(add, 'plus');
		add.addEventListener('click', () => void (async () => {
			await this.session?.addSheet();
			this.lastSelection = { rowIndex: 0, columnIndex: 0 };
			this.render();
		})().catch(error => new Notice(`시트를 추가하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)));
		const deleted = this.session.manifest.deletedSheets ?? [];
		const trash = actions.createEl('button', {
			cls: 'clickable-icon wm-plotbook-sheet-trash',
			attr: { type: 'button' },
		});
		trash.disabled = deleted.length === 0;
		setIcon(trash, 'trash-2');
		trash.addEventListener('click', () => this.openSheetTrash());
		thumb.addClass('is-still');
		if (this.sheetThumbPosition) putThumb(this.sheetThumbPosition);
		window.requestAnimationFrame(() => {
			if (!this.sheetThumbPosition) placeThumb(activeTab);
			thumb.removeClass('is-still');
			window.requestAnimationFrame(() => placeThumb(activeTab));
		});
	}

	private currentSheetTabsSignature(): string {
		return JSON.stringify([this.session?.manifest.activeSheetId, this.session?.manifest.sheets, this.session?.manifest.deletedSheets]);
	}

	private refreshSheetTabs(): void {
		const workspace = this.contentEl.querySelector<HTMLElement>('.wm-plotbook-workspace');
		if (!workspace) return;
		workspace.querySelector('.wm-plotbook-sheet-dock')?.remove();
		this.renderSheetTabs(workspace);
	}

	private beginSheetRename(tab: HTMLElement, sheetId: string, name: string): void {
		const bar = tab.parentElement;
		if (!bar || bar.querySelector('.wm-plotbook-sheet-name-editor')) return;
		const input = bar.createEl('input', { cls: 'wm-plotbook-sheet-name-editor' });
		input.setCssStyles({
			left: `${tab.offsetLeft}px`,
			top: `${tab.offsetTop}px`,
			width: `${tab.offsetWidth}px`,
			height: `${tab.offsetHeight}px`,
		});
		tab.addClass('is-renaming');
		input.value = name;
		let finished = false;
		const finish = (save: boolean) => {
			if (finished) return;
			finished = true;
			const session = this.session;
			if (save && input.value.trim() && session) void session.renameSheet(sheetId, input.value).then(() => this.render());
			else this.render();
		};
		input.addEventListener('pointerdown', event => event.stopPropagation());
		input.addEventListener('click', event => event.stopPropagation());
		input.addEventListener('blur', () => finish(true));
		input.addEventListener('keydown', event => {
			event.stopPropagation();
			if (event.isComposing) return;
			if (event.key === 'Enter') {
				event.preventDefault();
				finish(true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				finish(false);
			}
		});
		input.focus();
		input.select();
	}

	private async deleteSheet(sheetId: string): Promise<void> {
		if (!this.session) return;
		if (!(await this.session.deleteSheet(sheetId))) {
			new Notice('마지막 시트는 삭제할 수 없습니다.');
			return;
		}
		this.lastSelection = { rowIndex: 0, columnIndex: 0 };
		this.render();
	}

	private openSheetTrash(): void {
		const session = this.session;
		if (!session) return;
		new PlotWorkbookSheetTrashModal(this.plugin, session, () => {
			this.lastSelection = { rowIndex: 0, columnIndex: 0 };
			this.render();
		}).open();
	}

	private renderLoading(projectName: string): void {
		this.contentEl.empty();
		this.contentEl.addClass('wm-plotbook-view');
		const loading = this.contentEl.createDiv({ cls: 'wm-plotbook-state' });
		loading.createDiv({ cls: 'wm-plotbook-state-title', text: `${projectName} 플롯을 불러오는 중…` });
	}

	private renderNoProject(content: HTMLElement, noProjects: boolean): void {
		const state = content.createDiv({ cls: 'wm-plotbook-state' });
		state.createDiv({ cls: 'wm-plotbook-state-title', text: noProjects ? '등록된 프로젝트가 없습니다' : '플롯 시트를 열 수 없습니다' });
		state.createDiv({
			cls: 'wm-plotbook-state-description',
			text: noProjects
				? '플러그인 설정에서 플롯을 저장할 프로젝트 폴더를 먼저 등록해 주세요.'
				: '프로젝트를 다시 선택해 주세요.',
		});
		if (noProjects) {
			const button = state.createEl('button', { cls: 'mod-cta', text: '플러그인 설정 열기' });
			button.addEventListener('click', () => this.plugin.openSettings());
		}
	}

	private renderError(project: WritingProject, error: unknown): void {
		this.contentEl.empty();
		this.contentEl.addClass('wm-plotbook-view');
		const state = this.contentEl.createDiv({ cls: 'wm-plotbook-state is-error' });
		state.createDiv({ cls: 'wm-plotbook-state-title', text: '플롯 시트를 열 수 없습니다' });
		state.createDiv({ cls: 'wm-plotbook-state-description', text: this.errorMessage(error) });
		state.createDiv({ cls: 'wm-plotbook-state-path', text: `${project.rootFolder || '/'} /.writing-menu/plot` });
		const button = state.createEl('button', { cls: 'mod-cta', text: '다시 불러오기' });
		button.addEventListener('click', () => void this.loadProject());
	}

	private resolveProject(): WritingProject | null {
		const projects = this.plugin.projectContext.getProjects();
		if (projects.length === 0) return null;
		const requested = projects.find(project => project.id === this.projectId);
		if (requested) return requested;
		const active = this.plugin.projectContext.getProjectForFile(this.app.workspace.getActiveFile());
		return active ?? projects[0];
	}

	private parseState(state: unknown): PlotWorkbookViewState {
		if (!state || typeof state !== 'object') return {};
		const raw = state as Record<string, unknown>;
		return {
			projectId: typeof raw.projectId === 'string' ? raw.projectId : undefined,
		};
	}

	private destroyViews(clearSubscription = true): void {
		this.toolbarView?.destroy();
		this.sheetView?.destroy();
		this.toolbarView = null;
		this.sheetView = null;
		if (clearSubscription) {
			this.sessionUnsubscribe?.();
			this.sessionUnsubscribe = null;
		}
	}

	private errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
}
