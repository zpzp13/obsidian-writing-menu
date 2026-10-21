import { ItemView, Notice, Scope, WorkspaceLeaf, setIcon, type EventRef, type TFile, type ViewStateResult } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { DEFAULT_PLOTBOOK_FONT_SIZE, PLOT_WORKBOOK_SIDEBAR_TYPE, type PlotWorkbookSheet, type PlotWorkbookColumnRole, type PlotWorkbookForeshadowLocation } from './PlotWorkbookTypes';
import { PlotWorkbookChecklistEditor } from './PlotWorkbookChecklistEditor';
import { plotWorkbookSessions, type PlotWorkbookSessionLease } from './PlotWorkbookSessionStore';
import { PlotWorkbookRowPicker } from './PlotWorkbookRowPicker';
import { ToolbarSelect } from '../toolbar/ToolbarSelect';
import { PLOT_COLUMN_ICONS, plotColumnTitle } from './PlotWorkbookColumnPresentation';
import { renderSidebarCell, sidebarCharacterColor, sidebarCharacterColumn, sidebarCharacterName } from './PlotWorkbookSidebarCell';
import { applySidebarTextStyle } from './PlotWorkbookSidebarStyle';
import { PlotWorkbookForeshadowModal } from './PlotWorkbookForeshadowModal';

interface SidebarState { projectId?: string; sheetId?: string; columnId?: string; rowId?: string; mode?: 'column' | 'row' }
interface RowCard { element: HTMLElement; heading: HTMLElement; title: HTMLButtonElement; icon: HTMLElement; body: HTMLElement; signature: string; role?: PlotWorkbookColumnRole; editor?: PlotWorkbookChecklistEditor }
const PAGE_SIZE = 80;

export class PlotWorkbookSidebarView extends ItemView {
	private state: SidebarState = {};
	private lease: PlotWorkbookSessionLease | null = null;
	private unsubscribe: (() => void) | null = null;
	private metadataRef: EventRef | null = null;
	private opened = false;
	private loadToken = 0;
	private frame: number | null = null;
	private header: HTMLElement | null = null;
	private list: HTMLElement | null = null;
	private headerSignature = '';
	private cards = new Map<string, RowCard>();
	private axisPicker: PlotWorkbookRowPicker | null = null;
	private scopePickers: ToolbarSelect[] = [];
	private expandedCard: string | null = null;
	private pickersHidden = false;
	private query = '';
	private showEmpty = false;
	private limit = PAGE_SIZE;
	private storageGeneration: string | undefined;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: WritingMenuPlugin) {
		super(leaf);
		this.scope = new Scope(this.app.scope);
		this.scope.register(['Mod'], 'z', event => {
			if ((event.target as Element | null)?.matches('input, textarea')) return;
			if (event.shiftKey) this.lease?.session.redo(); else this.lease?.session.undo();
			return false;
		});
	}

	getViewType(): string { return PLOT_WORKBOOK_SIDEBAR_TYPE; }
	getDisplayText(): string { return '플롯 사이드바'; }
	getIcon(): string { return 'panel-right'; }
	getState(): Record<string, unknown> { return { ...this.state }; }
	getDeusSceneSelection(): { projectRoot: string; sheetId: string; rowIds: string[] } | null {
		const project = this.plugin.settings.projects.find(project => project.id === this.state.projectId);
		const sheet = this.lease?.session.activeSheet;
		const rowId = this.expandedCard ? this.cards.get(this.expandedCard)?.element.dataset.rowId : this.state.rowId;
		if (!project || !sheet || !rowId || !sheet.rows[rowId] || !this.containerEl.isConnected) return null;
		return { projectRoot: project.rootFolder, sheetId: sheet.sheetId, rowIds: [rowId] };
	}

	async setState(value: unknown, _result: ViewStateResult): Promise<void> {
		const previous = this.state.projectId;
		if (value && typeof value === 'object') {
			const raw = value as Record<string, unknown>;
			if (raw.mode === 'row' || raw.mode === 'column') this.state.mode = raw.mode;
			for (const key of ['projectId', 'sheetId', 'columnId', 'rowId'] as const) {
				if (typeof raw[key] === 'string') this.state[key] = raw[key];
			}
			if (typeof raw.rowId === 'string') {
				this.query = '';
				const search = this.contentEl.querySelector<HTMLInputElement>('.wm-plotbook-sidebar-search input');
				if (search) search.value = '';
			}
		}
		if (!this.opened) return;
		if (!this.lease || previous !== this.state.projectId) await this.loadProject();
		else {
			if (this.state.sheetId && this.lease.session.manifest.sheets.some(ref => ref.id === this.state.sheetId)) {
				await this.lease.session.selectSheet(this.state.sheetId);
			}
			this.limit = PAGE_SIZE; this.render(); this.revealRequestedRow();
		}
	}

	async onOpen(): Promise<void> {
		this.opened = true;
		this.metadataRef = this.app.metadataCache.on('changed', file => this.onCharacterMetadataChanged(file));
		await this.loadProject();
	}
	async onClose(): Promise<void> {
		this.opened = false; this.loadToken++;
		this.unsubscribe?.(); this.unsubscribe = null;
		if (this.metadataRef) this.app.metadataCache.offref(this.metadataRef);
		this.metadataRef = null;
		if (this.frame !== null) window.cancelAnimationFrame(this.frame);
		this.clearCards(); this.axisPicker?.destroy(); this.clearScopePickers();
		const lease = this.lease; this.lease = null;
		try { await lease?.release(); } catch (error) { new Notice(`플롯을 저장하지 못했습니다: ${String(error)}`); }
	}

	private async loadProject(): Promise<void> {
		const token = ++this.loadToken;
		this.unsubscribe?.(); this.unsubscribe = null;
		this.clearCards(); this.clearScopePickers(); this.axisPicker?.destroy(); this.axisPicker = null; this.expandedCard = null;
		const previous = this.lease; this.lease = null;
		try { await previous?.release(); } catch (error) { new Notice(`플롯을 저장하지 못했습니다: ${String(error)}`); }
		if (token !== this.loadToken || !this.opened) return;
		const projects = this.plugin.projectContext.getProjects();
		const project = projects.find(item => item.id === this.state.projectId)
			?? this.plugin.projectContext.getProjectForFile(this.app.workspace.getActiveFile()) ?? projects[0];
		this.contentEl.empty(); this.contentEl.addClass('wm-plotbook-sidebar');
		this.header = null; this.list = null;
		if (!project) {
			this.contentEl.createDiv({ cls: 'wm-plotbook-sidebar-empty', text: '프로젝트를 먼저 등록해 주세요.' });
			const settings = this.contentEl.createEl('button', { text: '플러그인 설정' });
			settings.addEventListener('click', () => this.plugin.openSettings());
			return;
		}
		this.state.projectId = project.id;
		this.contentEl.createDiv({ cls: 'wm-plotbook-sidebar-empty', text: '플롯을 불러오는 중…' });
		try {
			const lease = await plotWorkbookSessions(this.plugin).acquire(project);
			if (token !== this.loadToken || !this.opened) { await lease.release(); return; }
			this.lease = lease;
			if (this.state.sheetId && lease.session.manifest.sheets.some(ref => ref.id === this.state.sheetId)) await lease.session.selectSheet(this.state.sheetId);
			this.unsubscribe = lease.session.subscribe(() => this.scheduleRender());
			this.limit = PAGE_SIZE; this.buildLayout(); this.render(); this.revealRequestedRow();
		} catch (error) {
			if (token !== this.loadToken) return;
			this.contentEl.empty();
			this.contentEl.createDiv({ cls: 'wm-plotbook-sidebar-empty', text: `플롯을 열 수 없습니다. ${String(error)}` });
		}
	}

	private buildLayout(): void {
		this.contentEl.empty();
		const chrome = this.contentEl.createDiv({ cls: 'wm-plotbook-sidebar-chrome' });
		const heading = chrome.createDiv({ cls: 'wm-plotbook-sidebar-heading', attr: { role: 'toolbar', 'aria-label': '플롯 사이드바 도구' } });
		const navigation = heading.createDiv({ cls:'wm-plotbook-sidebar-axis-navigation' });
		for (const [step, icon] of [[-1,'chevron-left'],[1,'chevron-right']] as const) {
			if (step > 0) navigation.createSpan({cls:'wm-plotbook-sidebar-axis-label',attr:{'data-sidebar-axis-label':'true','aria-live':'polite'}});
			const button = navigation.createEl('button',{cls:'clickable-icon wm-plotbook-sidebar-step',attr:{type:'button','data-sidebar-step':String(step),'aria-label':step < 0 ? '이전 열' : '다음 열'}});
			setIcon(button,icon);
			button.addEventListener('click',()=>{
				const sheet = this.lease?.session.activeSheet;
				if (!sheet) return;
				const rowMode = this.state.mode === 'row';
				const order = rowMode ? sheet.rowOrder : sheet.columnOrder;
				const index = order.indexOf((rowMode ? this.state.rowId : this.state.columnId) ?? '');
				const next = index < 0 ? undefined : order[index + step];
				if (next) this.selectAxis(next);
			});
		}
		for (const [mode, icon, label] of [['column','columns-3','열 모드'],['row','rows-3','행 모드']] as const) {
			const button = heading.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': label, 'data-sidebar-mode': mode } });
			setIcon(button, icon);
			button.addEventListener('click', () => { this.state.mode = mode; this.limit = PAGE_SIZE; this.render(); });
		}
		const empty = heading.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': '빈 셀 표시', 'data-sidebar-empty': 'true' } });
		setIcon(empty, 'square-dashed');
		empty.addEventListener('click', () => { this.showEmpty = !this.showEmpty; this.render(); });
		const hidePickers = heading.createEl('button',{cls:'clickable-icon',attr:{type:'button','aria-label':'선택 영역 숨기기','data-sidebar-hide-pickers':'true'}});
		setIcon(hidePickers,'panel-top');
		hidePickers.addEventListener('click',()=>{
			this.pickersHidden = !this.pickersHidden;
			if(this.pickersHidden) { this.scopePickers.forEach(picker=>picker.close(false)); this.axisPicker?.destroy(); }
			this.render();
		});
		heading.createSpan({ cls: 'wm-plotbook-sidebar-toolbar-spacer' });
		const open = heading.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': '표로 열기' } });
		setIcon(open, 'table-2'); open.addEventListener('click', () => void this.openCell());
		const settings = heading.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': '플롯 매니저 설정' } });
		setIcon(settings, 'settings'); settings.addEventListener('click', () => this.plugin.openSettings('plot'));
		this.header = chrome.createDiv({ cls: 'wm-plotbook-sidebar-pickers' });
		this.headerSignature = '';
		const search = chrome.createDiv({ cls: 'wm-search-field wm-plotbook-sidebar-search' });
		setIcon(search.createSpan({ attr: { 'aria-hidden': 'true' } }), 'search');
		const input = search.createEl('input', { type: 'search', placeholder: '이 열에서 검색', attr: { 'aria-label': '플롯 사이드바 검색' } });
		input.value = this.query;
		input.addEventListener('input', () => { this.query = input.value; this.limit = PAGE_SIZE; this.scheduleRender(); });
		this.list = this.contentEl.createDiv({ cls: 'wm-plotbook-sidebar-list' });
	}

	private scheduleRender(): void {
		if (this.frame !== null || !this.opened) return;
		this.frame = window.requestAnimationFrame(() => { this.frame = null; if (this.opened) this.render(); });
	}

	private onCharacterMetadataChanged(file: TFile): void {
		const session = this.lease?.session;
		if (!session) return;
		const sheet = session.activeSheet;
		const referenced = sheet.columnOrder.some(id => sheet.columns[id].characterNotePath === file.path)
			|| [...this.cards.values()].some(card => card.role === 'cast'
				&& session.getAppearancePaths(sheet,card.element.dataset.rowId!,card.element.dataset.columnId!).includes(file.path));
		if (referenced) this.scheduleRender();
	}

	private render(): void {
		const session = this.lease?.session;
		if (!session || !this.header || !this.list) return;
		if (this.storageGeneration !== session.manifest.storageGeneration) {
			this.storageGeneration = session.manifest.storageGeneration;
			this.clearCards();
			this.headerSignature = '';
			this.expandedCard = null;
		}
		const sheet = session.activeSheet;
		this.state.sheetId = sheet.sheetId;
		const rowMode = this.state.mode === 'row';
		if (rowMode && (!this.state.rowId || !sheet.rows[this.state.rowId])) this.state.rowId = sheet.rowOrder[0];
		if (!this.state.columnId || !sheet.columns[this.state.columnId]) {
			this.state.columnId = sheet.columnOrder.find(id => sheet.columns[id].role === 'plot') ?? sheet.columnOrder[0];
		}
		const columnId = this.state.columnId;
		const order = rowMode ? sheet.rowOrder : sheet.columnOrder;
		const axisIndex = order.indexOf((rowMode ? this.state.rowId : columnId) ?? '');
		const axisText = rowMode
			? session.rowLabels(sheet).get(this.state.rowId!) ?? ''
			: columnId ? this.columnTitle(sheet,columnId) : '';
		const axisLabel = this.contentEl.querySelector<HTMLElement>('[data-sidebar-axis-label]');
		axisLabel?.setText(axisText);
		axisLabel?.setAttribute('title',axisText);
		axisLabel?.setAttribute('aria-label',`현재 ${rowMode ? '행' : '열'}: ${axisText}`);
		this.contentEl.querySelectorAll<HTMLButtonElement>('[data-sidebar-step]').forEach(button => {
			const step = Number(button.dataset.sidebarStep);
			const label = `${step < 0 ? '이전' : '다음'} ${rowMode ? '행' : '열'}`;
			button.disabled = axisIndex < 0 || !order[axisIndex + step];
			button.setAttribute('aria-label',label);
		});
		if (!columnId) return;
		const column = sheet.columns[columnId];
		const checklist = rowMode ? sheet.columnOrder.some(id => sheet.columns[id].role === 'checklist') : column.role === 'checklist';
		this.contentEl.toggleClass('is-checklist', checklist);
		this.contentEl.querySelectorAll<HTMLButtonElement>('[data-sidebar-mode]').forEach(button => button.setAttribute('aria-pressed', String((button.dataset.sidebarMode === 'row') === rowMode)));
		this.contentEl.querySelector('[data-sidebar-empty]')?.setAttribute('aria-pressed', String(this.showEmpty));
		this.contentEl.querySelector('[data-sidebar-hide-pickers]')?.setAttribute('aria-pressed',String(this.pickersHidden));
		this.contentEl.querySelector('[data-sidebar-hide-pickers]')?.setAttribute('aria-label',this.pickersHidden ? '선택 영역 표시' : '선택 영역 숨기기');
		this.header.hidden = this.pickersHidden;
		const search = this.contentEl.querySelector<HTMLInputElement>('.wm-plotbook-sidebar-search input');
		if (search) search.placeholder = rowMode ? '이 행에서 검색' : '이 열에서 검색';
		const signature = JSON.stringify([this.state.projectId, sheet.sheetId, session.manifest.sheets, sheet.columnOrder.map(id => [id, this.columnTitle(sheet,id), sheet.columns[id].role]), columnId, sheet.rowOrder, rowMode, rowMode ? this.state.rowId : '']);
		if (signature !== this.headerSignature) {
			this.headerSignature = signature;
			this.renderPickers(sheet, columnId);
		}
		const labels = session.rowLabels(sheet);
		const needle = this.query.trim().toLocaleLowerCase('ko-KR');
		const cells = (rowMode ? sheet.columnOrder.map(id => ({rowId:this.state.rowId!,columnId:id})) : sheet.rowOrder.map(id => ({rowId:id,columnId}))).filter(cell => {
			const text = this.displayValue(sheet, cell.rowId, cell.columnId);
			const current = cell.rowId === this.state.rowId && cell.columnId === this.state.columnId;
			if (!text.trim() && !this.showEmpty && !current) return false;
			const title = rowMode ? this.columnTitle(sheet, cell.columnId) : `${labels.get(cell.rowId)}행`;
			return !needle || `${title} ${text}`.toLocaleLowerCase('ko-KR').includes(needle);
		});
		const visible = cells.slice(0, this.limit);
		const current = cells.find(cell => cell.rowId === this.state.rowId && cell.columnId === this.state.columnId);
		if (current && !visible.includes(current)) visible.push(current);
		const keyFor = (cell: {rowId:string;columnId:string}) => `${sheet.sheetId}:${cell.columnId}:${cell.rowId}`;
		const wanted = new Set(visible.map(keyFor));
		if(this.expandedCard && !wanted.has(this.expandedCard))this.expandedCard = null;
		for (const [key, card] of this.cards) if (!wanted.has(key)) { card.editor?.destroy(); card.element.remove(); this.cards.delete(key); }
		this.list.querySelector('.wm-plotbook-sidebar-more')?.remove();
		this.list.querySelector('.wm-plotbook-sidebar-empty')?.remove();
		visible.forEach(({rowId,columnId:cellColumn}, index) => {
			const key = keyFor({rowId,columnId:cellColumn});
			const taskCell = sheet.columns[cellColumn].role === 'checklist';
			const role = sheet.columns[cellColumn].role;
			const expanded = this.expandedCard === key;
			let card = this.cards.get(key);
			if (card && card.role !== role) {
				card.editor?.destroy(); card.element.remove(); this.cards.delete(key); card = undefined;
			}
			if (!card) {
				const element = this.list!.createDiv({ cls: `wm-plotbook-timeline-card${sheet.rows[rowId].parentRowId ? ' is-subrow' : ''}` });
				element.dataset.rowId = rowId;
				element.dataset.columnId = cellColumn;
				const heading = element.createDiv({ cls: 'wm-plotbook-timeline-card-heading' });
				const icon = heading.createSpan({cls:'wm-plotbook-sidebar-card-icon',attr:{'aria-hidden':'true'}});
				setIcon(icon,PLOT_COLUMN_ICONS[role ?? 'text']);
				const title = heading.createEl('button',{cls:'wm-plotbook-sidebar-card-title',attr:{type:'button'}});
				title.addEventListener('click',()=>{this.expandedCard = this.expandedCard === key ? null : key;this.render();});
				if(role === 'foreshadow') {
					const manage = heading.createEl('button',{cls:'clickable-icon',attr:{type:'button','aria-label':'복선 관리하기'}});
					setIcon(manage,'sprout');
					manage.addEventListener('click',()=>this.openForeshadow({sheetId:sheet.sheetId,rowId,columnId:cellColumn}));
				}
				const reveal = heading.createEl('button', { cls:'clickable-icon', attr:{type:'button', 'aria-label':'이 셀을 표에서 열기'} });
				setIcon(reveal, 'arrow-up-right'); reveal.addEventListener('click', () => void this.openCell(rowId,cellColumn));
				const body = element.createDiv({ cls: 'wm-plotbook-timeline-card-body' });
				card = { element, heading, title, icon, body, signature:'', role };
				if (taskCell) card.editor = new PlotWorkbookChecklistEditor(body, session, { sheetId:sheet.sheetId, rowId, columnId:cellColumn },undefined,expanded ? Infinity : 3);
				element.addEventListener('click',event=>{
					if(!(event.target as Element).closest('button,input,select,textarea,a,label')) { this.expandedCard = key;this.render(); }
				});
				this.cards.set(key, card);
			}
			card.title.setText(rowMode ? this.columnTitle(sheet,cellColumn) : `${labels.get(rowId) ?? ''}행`);
			const cellStyle = session.getCellStyle(sheet,rowId,cellColumn);
			const headerStyle = rowMode ? session.getColumnHeaderStyle(cellColumn) : session.getRowHeaderStyle(rowId);
			const profile = rowMode && role === 'character' ? sidebarCharacterColumn(this.plugin,sheet.columns[cellColumn]) : null;
			applySidebarTextStyle(card.heading,profile ? {...headerStyle,color:profile.color} : headerStyle);
			applySidebarTextStyle(card.body,cellStyle,cellStyle.fontSize ?? DEFAULT_PLOTBOOK_FONT_SIZE);
			card.title.setAttribute('aria-expanded',String(expanded));
			card.icon.hidden = !rowMode;
			card.element.toggleClass('is-subrow', !rowMode && Boolean(sheet.rows[rowId].parentRowId));
			card.element.toggleClass('is-current', expanded);
			card.element.toggleClass('is-expanded',expanded);
			if (card.editor) card.editor.setPreviewLimit(expanded ? Infinity : 3);
			else {
				const value = this.displayValue(sheet, rowId, cellColumn);
				const state = role === 'foreshadow' ? session.foreshadowsInRow(sheet.sheetId,rowId).map(item=>[item.id,item.status]) : role === 'status' ? session.statusColor(session.getCell(sheet,rowId,cellColumn)) : role === 'cast' ? session.getAppearancePaths(sheet,rowId,cellColumn).map(path=>[path,sidebarCharacterColor(this.plugin,path)]) : '';
				const signature = JSON.stringify([value,expanded,state]);
				if (signature !== card.signature || !card.body.firstChild) {
					const location = {sheetId:sheet.sheetId,rowId,columnId:cellColumn};
					renderSidebarCell(card.body,this.plugin,session,sheet,location,expanded,id=>this.openForeshadow(location,id));
					card.signature = signature;
				}
			}
			if (this.list!.children[index] !== card.element) this.list!.insertBefore(card.element, this.list!.children[index] ?? null);
		});
		if (!cells.length) this.list.createDiv({ cls:'wm-plotbook-sidebar-empty', text:needle ? '검색 결과가 없습니다.' : checklist ? '아직 확인할 목록이 없습니다.' : '표시할 내용이 없습니다.' });
		if (cells.length > this.limit) {
			const more = this.list.createEl('button', { cls:'wm-plotbook-sidebar-more', text:`더 보기 · ${Math.min(this.limit, cells.length)}/${cells.length}`, attr:{type:'button'} });
			more.addEventListener('click', () => { this.limit += PAGE_SIZE; this.render(); });
		}
	}

	private renderPickers(sheet: PlotWorkbookSheet, columnId: string): void {
		const session = this.lease!.session;
		this.axisPicker?.destroy(); this.axisPicker = null;
		this.clearScopePickers(); this.header!.empty();
		const context = this.header!.createDiv({ cls:'wm-plotbook-sidebar-context' });
		const picker = (parent: HTMLElement, label: string, icon: string, options: Array<[string,string]>, value: string, change: (value:string)=>void) => {
			const axis = label === '열' || label === '행';
			const wrap = parent.createDiv({ cls:`wm-plotbook-sidebar-select ${axis ? 'wm-plotbook-axis-picker is-column' : 'wm-project-select-field is-context'}` });
			if (icon) setIcon(wrap.createSpan({ attr: { 'aria-hidden': 'true' } }), icon);
			const select = wrap.createEl('select', { attr:{'aria-label':label} });
			for (const [value, text] of options) select.createEl('option', {value, text});
			select.value = value; select.addEventListener('change', () => change(select.value));
			if (axis) this.axisPicker = new PlotWorkbookRowPicker(select, label === '열' ? 'column' : 'row');
			else this.scopePickers.push(new ToolbarSelect(select, 'is-sidebar-context'));
		};
		picker(context, '프로젝트', 'folder', this.plugin.projectContext.getProjects().map(item => [item.id,item.name]), this.state.projectId!, value => {
			this.state = {projectId:value,mode:this.state.mode}; void this.loadProject();
		});
		picker(context, '시트', 'table-2', session.manifest.sheets.map(item => [item.id,item.name]), sheet.sheetId, value => {
			this.state.rowId = undefined; this.limit = PAGE_SIZE; void session.selectSheet(value);
		});
		if (this.state.mode === 'row') {
			const labels = session.rowLabels(sheet);
			picker(this.header!, '행', 'rows-3', sheet.rowOrder.map(id=>[id,`${labels.get(id)}행`]), this.state.rowId!, value=>this.selectAxis(value));
		} else picker(this.header!, '열', 'columns-3', sheet.columnOrder.map(id=>[id,this.columnTitle(sheet,id)]), columnId, value=>this.selectAxis(value));
	}

	private selectAxis(value: string): void {
		if (this.state.mode === 'row') this.state.rowId = value;
		else { this.state.columnId = value; this.state.rowId = undefined; }
		this.limit = PAGE_SIZE;
		this.expandedCard = null;
		this.render();
		if (this.list) this.list.scrollTop = 0;
	}

	private displayValue(sheet: PlotWorkbookSheet, rowId: string, columnId: string): string {
		const session = this.lease!.session;
		const role = sheet.columns[columnId].role;
		const value = session.getCell(sheet,rowId,columnId);
		if (role === 'status') return value ? session.statusName(value) : '';
		if (role === 'cast') return session.getAppearancePaths(sheet,rowId,columnId).map(path => sidebarCharacterName(this.plugin,path)).join(' · ');
		if (role === 'foreshadow') return session.foreshadowsInRow(sheet.sheetId,rowId).map(item=>item.title).join('\n');
		return value;
	}

	private columnTitle(sheet: PlotWorkbookSheet, id: string): string {
		return sheet.columns[id].role === 'character'
			? sidebarCharacterColumn(this.plugin,sheet.columns[id]).name : plotColumnTitle(sheet,id);
	}

	private openForeshadow(location: PlotWorkbookForeshadowLocation, selectedId?: string): void {
		const session = this.lease?.session;
		const projectId = this.state.projectId;
		if (!session || !projectId) return;
		new PlotWorkbookForeshadowModal(this.plugin, session, location, async target => {
			await this.plugin.openPlotWorkbookCell(projectId, target.sheetId, target.rowId, target.columnId);
			return true;
		}, selectedId).open();
	}
	private clearScopePickers(): void { this.scopePickers.forEach(picker=>picker.destroy());this.scopePickers=[]; }

	private async openCell(rowId?: string, columnId = this.state.columnId): Promise<void> {
		if (!this.lease || !this.state.projectId) return;
		await this.plugin.openPlotWorkbookCell(this.state.projectId, this.lease.session.activeSheet.sheetId, rowId ?? this.state.rowId, columnId);
	}

	private revealRequestedRow(): void {
		if (!this.state.rowId || !this.list) return;
		const element = [...this.cards.values()].find(card => card.element.dataset.rowId === this.state.rowId)?.element;
		element?.scrollIntoView({block:'center'});
	}

	private clearCards(): void {
		for (const card of this.cards.values()) { card.editor?.destroy(); card.element.remove(); }
		this.cards.clear();
	}
}
