import { Modal, Notice, SearchComponent, Setting, ToggleComponent, normalizePath, setIcon, type App, type TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { WritingProject } from '../types';
import { renderSnapshotDiff, renderSnapshotText } from '../snapshots/SnapshotDiffView';
import { plotWorkbookSessions, type PlotWorkbookSessionLease } from './PlotWorkbookSessionStore';
import { createPlotSnapshot, MAX_PLOT_SNAPSHOT_BYTES, readPlotSnapshot, renamePlotSnapshotMarkdown, savePlotSnapshot, type PlotWorkbookSnapshot } from './PlotWorkbookSnapshot';
import { restorePlotSnapshot } from './PlotWorkbookSnapshotService';
import { ToolbarSelect } from '../toolbar/ToolbarSelect';
import { PlotWorkbookSnapshotTitleModal } from './PlotWorkbookSnapshotModal';
import { plotSnapshotPreview, plotSnapshotRows, SNAPSHOT_PREVIEW_ROWS } from './PlotWorkbookSnapshotPreview';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
interface SnapshotNote { path: string; title: string; createdAt: number; backup?: boolean }

export async function openPlotSnapshots(plugin: WritingMenuPlugin, project: WritingProject): Promise<void> {
	let lease: PlotWorkbookSessionLease | undefined;
	try {
		lease = await plotWorkbookSessions(plugin).acquire(project);
		new PlotWorkbookTransferModal(plugin, project, lease).open();
	} catch (error) {
		if (lease) await lease.release().catch(() => {});
		new Notice(`스냅샷을 준비하지 못했습니다: ${message(error)}`);
	}
}

/** The same list/titlebar as cell history; payloads and diffs are loaded only on selection. */
export class PlotWorkbookTransferModal extends Modal {
	private busy = false;
	private loading = false;
	private disposed = false;
	private previewRequest = 0;
	private notes: SnapshotNote[] = [];
	private selectedPath: string | null = null;
	private snapshot: PlotWorkbookSnapshot | null;
	private query = '';
	private compare = false;
	private previewSheetId: string | null = null;
	private listEl!: HTMLElement;
	private detailEl!: HTMLElement;
	private errorEl!: HTMLElement;
	private renameButton!: HTMLButtonElement;
	private removeButton!: HTMLButtonElement;
	private copySelected: (() => string) | null = null;
	private sheetPicker: ToolbarSelect | null = null;
	private readonly cleanups: Array<() => void> = [];

	constructor(private readonly plugin: WritingMenuPlugin, private readonly project: WritingProject,
		private readonly lease: PlotWorkbookSessionLease, initialSnapshot?: PlotWorkbookSnapshot) {
		super(plugin.app); this.snapshot = initialSnapshot ?? null;
	}
	close(): void { if (!this.busy) super.close(); }
	onClose(): void {
		this.disposed = true; this.previewRequest++;
		this.snapshot = null; this.copySelected = null;
		this.sheetPicker?.destroy(); this.sheetPicker = null;
		for (const cleanup of this.cleanups) cleanup();
		this.contentEl.empty();
		void this.lease.release().catch(error => new Notice(`플롯 저장을 완료하지 못했습니다: ${message(error)}`));
	}
	onOpen(): void {
		this.setTitle('플롯 스냅샷');
		this.modalEl.addClass('mod-sync-history', 'mod-sidebar-layout', 'wm-plotbook-snapshot-modal', 'wm-snapshot-manager', 'wm-plotbook-transfer-modal');
		const sidebar = this.contentEl.createDiv({ cls: 'modal-sidebar mod-history' }).createDiv({ cls: 'modal-sidebar-inner' });
		new SearchComponent(sidebar).setPlaceholder('스냅샷 검색…').onChange(value => { this.query = value; this.renderList(); });
		this.listEl = sidebar.createDiv({ cls: 'modal-sidebar-list' });
		const actions = sidebar.createDiv({ cls: 'wm-plotbook-snapshot-list-actions' });
		this.icon(actions, 'plus', '스냅샷 추가', () => { if (!this.loading) void this.save(); });
		this.renameButton = this.icon(actions, 'pencil', '스냅샷 제목 수정', () => this.rename());
		this.removeButton = this.icon(actions, 'trash-2', '스냅샷 삭제', () => this.remove());
		this.detailEl = this.contentEl.createDiv({ cls: 'sync-history-content-container' }).createDiv({ cls: 'sync-history-content' });
		this.renderList(); this.renderDetail();
		void this.refreshNotes();
		if (this.app.metadataCache.on) {
			let timer = 0;
			const ref = this.app.metadataCache.on('changed', () => {
				window.clearTimeout(timer);
				timer = window.setTimeout(() => { if (!this.disposed) void this.refreshNotes(); }, 80);
			});
			this.cleanups.push(() => { window.clearTimeout(timer); this.app.metadataCache.offref(ref); });
		}
	}
	private icon(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
		const button = parent.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': label } });
		setIcon(button, icon);
		button.addEventListener('click', () => { if (!this.busy && !this.loading) action(); });
		return button;
	}
	private noteForFile(file: TFile): SnapshotNote {
		const meta = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const created = typeof meta?.created === 'string' ? Date.parse(meta.created) : NaN;
		return { path: file.path, title: typeof meta?.snapshot_title === 'string' ? meta.snapshot_title
			: typeof meta?.project === 'string' ? meta.project : file.basename,
			createdAt: Number.isFinite(created) ? created : file.stat.mtime };
	}
	private async refreshNotes(): Promise<void> {
		try {
			const files = this.app.vault.getMarkdownFiles();
			const notes = files.filter(file => file.stat.size <= MAX_PLOT_SNAPSHOT_BYTES
				&& this.app.metadataCache.getFileCache(file)?.frontmatter?.writing_menu_snapshot === 'plot-workbook').map(file => this.noteForFile(file));
			const directory = normalizePath(`${this.project.rootFolder ? `${this.project.rootFolder}/` : ''}.writing-menu/plot/transfer-backups`);
			if (await this.app.vault.adapter.exists(directory)) for (const path of (await this.app.vault.adapter.list(directory)).files) {
				if (path.startsWith(`${directory}/`) && /^snapshot-[a-zA-Z0-9_-]+\.md$/.test(path.slice(directory.length + 1)))
					notes.push({ path, title: '교체 전 백업', createdAt: 0, backup: true });
			}
			if (this.disposed) return;
			const paths = new Set(notes.map(note => note.path)), available = new Set(files.map(file => file.path));
			this.notes = [...notes, ...this.notes.filter(note => !paths.has(note.path) && available.has(note.path))]
				.sort((a, b) => b.createdAt - a.createdAt || b.path.localeCompare(a.path));
			this.renderList();
			if (!this.snapshot && !this.selectedPath && !this.busy && this.notes[0]) void this.select(this.notes[0]);
		} catch (error) { if (!this.disposed) this.errorEl.setText(`목록을 읽지 못했습니다: ${message(error)}`); }
	}
	private selectedNote(): SnapshotNote | undefined { return this.notes.find(note => note.path === this.selectedPath); }
	private title(): string { return this.selectedNote()?.title ?? this.snapshot?.project.name ?? '스냅샷'; }
	private renderList(): void {
		this.listEl.empty();
		const needle = this.query.trim().toLocaleLowerCase();
		for (const note of this.notes) {
			if (needle && !`${note.title}\n${note.path}`.toLocaleLowerCase().includes(needle)) continue;
			const row = this.listEl.createDiv({ cls: `modal-sidebar-list-item file-recovery-list-item-header tappable${note.path === this.selectedPath ? ' is-active' : ''}`,
				attr: { role: 'button', tabindex: '0', 'data-snapshot-path': note.path } });
			const details = row.createDiv({ cls: 'modal-sidebar-list-item-details file-recovery-list-item-details', text: note.title });
			details.createDiv({ cls: 'u-small u-muted', text: note.createdAt ? new Date(note.createdAt).toLocaleString('ko-KR') : note.path.split('/').pop() });
			row.title = note.path;
			row.addEventListener('click', () => { if (!this.busy) void this.select(note); });
			row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); row.click(); } });
		}
		const editable = Boolean(this.snapshot && this.selectedPath && !this.selectedNote()?.backup);
		this.renameButton.disabled = !editable; this.removeButton.disabled = !editable;
	}
	private async select(note: SnapshotNote): Promise<void> {
		const request = ++this.previewRequest;
		this.loading = true; this.selectedPath = note.path; this.snapshot = null; this.copySelected = null; this.previewSheetId = null;
		this.sheetPicker?.destroy(); this.sheetPicker = null;
		this.renderList(); this.detailEl.empty();
		this.detailEl.createEl('p', { text: '스냅샷을 확인하고 있습니다…', attr: { role: 'status' } });
		try {
			const file = note.backup ? null : this.app.vault.getFileByPath(note.path);
			if (file && file.stat.size > MAX_PLOT_SNAPSHOT_BYTES) throw new Error('스냅샷이 25MB를 초과합니다.');
			const snapshot = await readPlotSnapshot(file ? await this.app.vault.read(file) : await this.app.vault.adapter.read(note.path));
			if (this.disposed || request !== this.previewRequest) return;
			this.lease.session.repository.validateSnapshotData(snapshot.data);
			this.snapshot = snapshot; this.renderList(); this.renderDetail();
		} catch (error) {
			if (this.disposed || request !== this.previewRequest) return;
			this.renderDetail(); this.errorEl.setText(`스냅샷을 열지 못했습니다: ${message(error)}`);
		} finally { if (request === this.previewRequest) this.loading = false; }
	}
	private renderDetail(): void {
		this.sheetPicker?.destroy(); this.sheetPicker = null;
		this.detailEl.empty(); this.copySelected = null;
		const snapshot = this.snapshot;
		const titlebar = this.detailEl.createDiv({ cls: 'modal-setting-titlebar' });
		titlebar.createDiv({ cls: 'modal-setting-title', text: this.title() });
		const actions = titlebar.createDiv({ cls: 'modal-setting-titlebar-actions' });
		const toggle = actions.createSpan({ cls: 'modal-setting-titlebar-toggle', text: '변경사항 표시' });
		new ToggleComponent(toggle).setValue(this.compare).setDisabled(!snapshot).onChange(value => { this.compare = value; this.renderDetail(); });
		const copy = actions.createEl('button', { text: '복사' }); copy.disabled = !snapshot;
		copy.addEventListener('click', () => { void (async () => {
			try { const text = this.copySelected?.(); if (text !== undefined) { await navigator.clipboard.writeText(text); new Notice('클립보드에 복사했습니다.'); } }
			catch (error) { this.errorEl.setText(message(error)); }
		})(); });
		const restore = actions.createEl('button', { text: '이 버전 복원' }); restore.disabled = !snapshot;
		restore.addEventListener('click', () => {
			if (!snapshot || this.busy) return;
			new PlotSnapshotRestoreModal(this.plugin.app, this.project, () => {
				void this.run(async () => {
					const result = await restorePlotSnapshot(this.project, this.lease.session, snapshot);
					new Notice(`플롯을 복원했습니다. 교체 전 백업: ${result.backupPath}`);
					try { await this.plugin.openPlotWorkbookCell(result.project.id, snapshot.data.manifest.activeSheetId); }
					catch (error) { new Notice(`데이터는 복원했지만 플롯 화면을 열지 못했습니다: ${message(error)}`); }
					return true;
				});
			}).open();
		});
		const body = this.detailEl.createDiv({ cls: 'wm-plotbook-transfer-body' });
		if (snapshot) this.renderPreview(body, snapshot);
		else body.createEl('p', { cls: 'u-muted', text: this.selectedPath ? '스냅샷을 열 수 없습니다.' : '저장된 스냅샷이 없습니다.' });
		this.errorEl = body.createDiv({ cls: 'wm-plotbook-export-error', attr: { role: 'alert' } });
	}
	private renderPreview(body: HTMLElement, snapshot: PlotWorkbookSnapshot): void {
		const session = this.lease.session;
		const liveData = { manifest: session.manifest, sheets: [], foreshadows: session.foreshadows, cellSnapshots: [] };
		const preview = body.createDiv({ cls: 'wm-plotbook-transfer-preview' });
		const tools = preview.createDiv({ cls: 'wm-plotbook-transfer-preview-toolbar' });
		const select = tools.createEl('select', { attr: { 'aria-label': '미리보기 시트' } });
		const deleted = new Set(snapshot.data.manifest.deletedSheets?.map(ref => ref.id));
		for (const sheet of snapshot.data.sheets) select.createEl('option', { value: sheet.sheetId, text: `${sheet.name}${deleted.has(sheet.sheetId) ? ' (휴지통)' : ''}` });
		select.value = snapshot.data.sheets.some(sheet => sheet.sheetId === this.previewSheetId) ? this.previewSheetId! : snapshot.data.manifest.activeSheetId;
		this.sheetPicker = new ToolbarSelect(select, 'is-snapshot-sheet');
		let page = 0;
		const pages = tools.createDiv({ cls: 'wm-plotbook-snapshot-pagination', attr: { 'aria-label': '미리보기 페이지' } });
		const previous = this.icon(pages, 'chevron-left', '이전 미리보기', () => { page--; update(); });
		const position = pages.createSpan({ cls: 'wm-plotbook-snapshot-page', attr: { 'aria-live': 'polite' } });
		const next = this.icon(pages, 'chevron-right', '다음 미리보기', () => { page++; update(); });
		// Both modes share the same read-only line view; only change highlighting differs.
		const content = preview.createDiv({ cls: 'file-recovery-diff wm-plotbook-snapshot-content',
			attr: { 'aria-label': '스냅샷 미리보기', role: 'region', tabindex: '0' } });
		const hint = preview.createDiv({ cls: 'setting-item-description' });
		const rowCache = new Map<string, string[]>();
		const update = () => {
			const sheet = snapshot.data.sheets.find(item => item.sheetId === select.value);
			if (!sheet) return;
			const current = session.sheets.get(sheet.sheetId);
			let rows = rowCache.get(sheet.sheetId);
			if (!rows) {
				rows = plotSnapshotRows(snapshot.data, sheet);
				if (this.compare && current) {
					const used = new Set([...rows, ...plotSnapshotRows(liveData, current)]);
					rows = [...new Set([...sheet.rowOrder, ...current.rowOrder])].filter(id => used.has(id));
				}
				rowCache.set(sheet.sheetId, rows);
			}
			const pages = Math.max(1, Math.ceil(rows.length / SNAPSHOT_PREVIEW_ROWS));
			page = Math.max(0, Math.min(pages - 1, page));
			const result = plotSnapshotPreview(snapshot.data, sheet, session.rowLabels(sheet), page, rows);
			content.scrollTop = 0;
			position.setText(`${page + 1} / ${pages}`); previous.disabled = page === 0; next.disabled = page === pages - 1;
			hint.setText(result.clipped ? '미리보기에서만 긴 내용을 줄여 표시합니다.' : '');
			this.copySelected = () => plotSnapshotPreview(snapshot.data, sheet, session.rowLabels(sheet), 0, plotSnapshotRows(snapshot.data, sheet), true).text;
			if (this.compare) {
				const after = current ? plotSnapshotPreview(liveData, current, session.rowLabels(current), page, rows).text : '';
				renderSnapshotDiff(content, result.text, after);
			} else renderSnapshotText(content, result.text);
		};
		select.addEventListener('change', () => { this.previewSheetId = select.value; page = 0; update(); }); update();
	}
	private async save(): Promise<void> {
		await this.run(async () => {
			const folder = this.plugin.settings.plotSnapshotFolder?.trim() || `${this.project.rootFolder ? `${this.project.rootFolder}/` : ''}스냅샷`;
			const saved = await this.lease.session.withSnapshot(async data => {
				const snapshot = createPlotSnapshot(data, this.project);
				return { snapshot, path: await savePlotSnapshot(this.app.vault, folder, snapshot) };
			});
			this.previewRequest++; this.selectedPath = saved.path; this.snapshot = saved.snapshot; this.previewSheetId = null;
			this.notes.unshift({ path: saved.path, title: saved.snapshot.project.name, createdAt: Date.parse(saved.snapshot.createdAt) });
			this.renderList(); this.renderDetail(); new Notice('스냅샷을 저장했습니다.'); return false;
		});
	}
	private rename(): void {
		const note = this.selectedNote(), snapshot = this.snapshot;
		if (!note || note.backup || !snapshot) return;
		new PlotWorkbookSnapshotTitleModal(this.plugin, note.title, title => { void this.run(async () => {
			const file = this.app.vault.getFileByPath(note.path);
			if (!file) throw new Error('스냅샷 파일을 찾을 수 없습니다.');
			// Verify before editing metadata; process preserves any concurrent file edits.
			await readPlotSnapshot(await this.app.vault.read(file));
			await this.app.vault.process(file, value => renamePlotSnapshotMarkdown(value, title));
			note.title = title.trim(); this.renderList(); this.renderDetail(); return false;
		}); }).open();
	}
	private remove(): void {
		const note = this.selectedNote();
		if (!note || note.backup) return;
		const confirm = new Modal(this.app); confirm.setTitle('스냅샷 삭제');
		confirm.contentEl.createEl('p', { text: `‘${note.title}’ 스냅샷 파일을 휴지통으로 옮길까요? 현재 플롯은 변경하지 않습니다.` });
		new Setting(confirm.contentEl).addButton(button => button.setButtonText('취소').onClick(() => confirm.close()))
			.addButton(button => button.setButtonText('삭제').setClass('mod-warning').onClick(() => {
				confirm.close(); void this.run(async () => {
					const file = this.app.vault.getFileByPath(note.path);
					if (file) await this.app.fileManager.trashFile(file);
					this.notes = this.notes.filter(item => item.path !== note.path); this.selectedPath = null; this.snapshot = null;
					this.renderList(); this.renderDetail(); if (this.notes[0]) void this.select(this.notes[0]); return false;
				});
			})); confirm.open();
	}
	private async run(action: () => Promise<boolean>): Promise<void> {
		if (this.busy || this.disposed) return;
		this.errorEl.setText(''); this.busy = true;
		const disabled = new Map(Array.from(this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select')).map(control => [control, control.disabled]));
		for (const control of disabled.keys()) control.disabled = true;
		try { const close = await action(); this.busy = false; if (close) this.close(); }
		catch (error) { this.errorEl.setText(message(error)); }
		finally { this.busy = false; for (const [control, wasDisabled] of disabled) control.disabled = wasDisabled; }
	}
}

/** Restore only the current project's plot, preserving a verified pre-restore backup. */
class PlotSnapshotRestoreModal extends Modal {
	constructor(app: App, private readonly project: WritingProject, private readonly apply: () => void) { super(app); }
	onOpen(): void {
		this.modalEl.addClass('wm-plotbook-restore-modal');
		this.modalEl.setAttribute('aria-label', `${this.project.name} 플롯 복원 확인`);
		this.titleEl.hidden = true;
		let name = '';
		new Setting(this.contentEl).setClass('wm-plotbook-restore-confirmation').setName('교체 확인')
			.setDesc(`‘${this.project.name}’의 플롯을 복원합니다. 프로젝트 이름을 입력하세요. 교체 전 백업은 보존됩니다.`)
			.addText(text => text.setPlaceholder(this.project.name).onChange(value => { name = value; }));
		const error = this.contentEl.createDiv({ cls: 'wm-plotbook-export-error', attr: { role: 'alert' } });
		new Setting(this.contentEl).setClass('wm-plotbook-restore-actions').addButton(button => button.setButtonText('취소').onClick(() => this.close()))
			.addButton(button => button.setButtonText('복원').setClass('mod-warning').onClick(() => {
				if (name !== this.project.name) { error.setText('프로젝트 이름을 정확히 입력해주세요.'); return; }
				this.close(); this.apply();
			}));
	}
}
