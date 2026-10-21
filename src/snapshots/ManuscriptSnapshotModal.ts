import { ButtonComponent, Modal, Notice, SearchComponent, Setting, ToggleComponent, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { getWritingDocument, type WritingDocument } from '../writing/WritingDocument';
import { ManuscriptSnapshotRepository } from './ManuscriptSnapshotRepository';
import type { ManuscriptSnapshot } from './ManuscriptSnapshotTypes';
import { compareSnapshot, restoreSnapshotHunks, type SnapshotComparison } from './PartialRestore';
import { renderSnapshotDiff, renderSnapshotText } from './SnapshotDiffView';
import { readProjectStatuses } from '../plot-workbook/PlotWorkbookStatusSource';
import { plotWorkbookStatusDefaultColor, plotWorkbookStatuses } from '../plot-workbook/PlotWorkbookStatus';
import type { PlotWorkbookStatus } from '../plot-workbook/PlotWorkbookTypes';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function linkedStatus(entry: ManuscriptSnapshot, statuses: PlotWorkbookStatus[]): PlotWorkbookStatus | undefined {
	if (entry.statusId) return statuses.find(item => item.id === entry.statusId);
	const original = plotWorkbookStatuses().find(item => item.name === entry.stage);
	return statuses.find(item => item.name === entry.stage) ?? statuses.find(item => item.id === original?.id);
}

class MetadataModal extends Modal {
	constructor(plugin: WritingMenuPlugin, private entry: ManuscriptSnapshot, private statuses: PlotWorkbookStatus[], private submit: (changes: Pick<ManuscriptSnapshot, 'name' | 'description' | 'stage' | 'statusId'>) => Promise<void>) { super(plugin.app); }
	onOpen(): void {
		this.modalEl.addClass('wm-snapshot-metadata-modal');
		this.contentEl.setAttribute('aria-label', '스냅샷 정보');
		let name = this.entry.name, description = this.entry.description ?? '', stage = this.entry.stage ?? '';
		let statusId = this.entry.statusId || linkedStatus(this.entry, this.statuses)?.id || '';
		new Setting(this.contentEl).setName('제목').addText(text => text.setValue(name).onChange(value => name = value));
		new Setting(this.contentEl).setName('메모').addTextArea(text => text.setValue(description).onChange(value => description = value));
		new Setting(this.contentEl).setName('상태').addDropdown(select => {
			select.addOption('', '없음');
			for (const item of this.statuses) if (!item.hidden || item.id === statusId) select.addOption(item.id, item.name);
			if (stage && !this.statuses.some(item => item.id === statusId)) {
				statusId ||= `legacy:${stage}`;
				select.addOption(statusId, stage);
			}
			select.setValue(statusId).onChange(value => {
				statusId = value;
				stage = this.statuses.find(item => item.id === value)?.name ?? (value ? stage : '');
			});
		});
		new Setting(this.contentEl).addButton(button => button.setButtonText('저장').setCta().onClick(async () => {
			button.setDisabled(true);
			try { await this.submit({ name: name.trim() || this.entry.name, description, stage, statusId: this.statuses.some(item => item.id === statusId) ? statusId : this.entry.statusId && statusId ? this.entry.statusId : '' }); this.close(); }
			catch (error) { new Notice(errorMessage(error)); button.setDisabled(false); }
		}));
	}
}

class SnapshotConfirm extends Modal {
	constructor(plugin: WritingMenuPlugin, private text: string, private action: () => Promise<void>) { super(plugin.app); }
	onOpen(): void {
		this.setTitle(this.text);
		new Setting(this.contentEl).addButton(button => button.setButtonText('취소').onClick(() => this.close()))
			.addButton(button => button.setButtonText('확인').setWarning().onClick(async () => {
				button.setDisabled(true);
				try { await this.action(); this.close(); } catch (error) { new Notice(errorMessage(error)); button.setDisabled(false); }
			}));
	}
}

export function openManuscriptSnapshots(plugin: WritingMenuPlugin): void {
	const document = getWritingDocument(plugin);
	if (!document) { new Notice('원고를 먼저 열어 주세요.'); return; }
	new ManuscriptSnapshotModal(plugin, document).open();
}

export class ManuscriptSnapshotModal extends Modal {
	private repository: ManuscriptSnapshotRepository;
	private entries: ManuscriptSnapshot[] = [];
	private selected: ManuscriptSnapshot | null = null;
	private comparison: SnapshotComparison | null = null;
	private selectedHunks = new Set<number>();
	private compare = false;
	private query = '';
	private all = false;
	private busy = false;
	private disposed = false;
	private request = 0;
	private listEl!: HTMLElement;
	private detailEl!: HTMLElement;
	private errorEl!: HTMLElement;
	private pinButton!: HTMLButtonElement;
	private statuses = plotWorkbookStatuses();
	constructor(private plugin: WritingMenuPlugin, private document: WritingDocument) { super(plugin.app); this.repository = new ManuscriptSnapshotRepository(plugin, document.path); }
	close(): void { if (!this.busy) super.close(); }
	onClose(): void { this.disposed = true; this.request++; this.contentEl.empty(); }
	onOpen(): void {
		this.setTitle('원고 스냅샷');
		this.modalEl.addClass('mod-sync-history', 'mod-sidebar-layout', 'wm-manuscript-snapshot-modal');
		const sidebar = this.contentEl.createDiv({ cls: 'modal-sidebar mod-history' }).createDiv({ cls: 'modal-sidebar-inner' });
		const search = new SearchComponent(sidebar).setPlaceholder('스냅샷 검색…').onChange(value => { this.query = value; this.renderList(); });
		search.inputEl.parentElement?.addClass('mod-raised');
		this.listEl = sidebar.createDiv({ cls: 'modal-sidebar-list' });
		const actions = sidebar.createDiv({ cls: 'wm-manuscript-snapshot-actions' });
		this.icon(actions, 'plus', '현재 원고 저장', () => void this.save());
		this.icon(actions, 'pencil', '제목·메모·상태 수정', () => void this.rename());
		this.pinButton = this.icon(actions, 'pin', '스냅샷 고정 전환', () => void this.run(async () => {
			if (!this.selected) return;
			await this.repository.update(this.selected.id, { pinned: !this.selected.pinned }); await this.reload();
		}));
		this.icon(actions, 'trash-2', '스냅샷 삭제', () => this.remove());
		const archive = this.icon(actions, 'archive', '이전 스냅샷 모두 표시', () => { this.all = !this.all; archive.setAttribute('aria-pressed', String(this.all)); this.renderList(); });
		archive.setAttribute('aria-pressed', 'false');
		this.detailEl = this.contentEl.createDiv({ cls: 'sync-history-content-container' }).createDiv({ cls: 'sync-history-content' });
		void this.reload();
	}
	private icon(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
		const button = parent.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': label } });
		setIcon(button, icon); button.addEventListener('click', () => { if (!this.busy) action(); }); return button;
	}
	private async reload(): Promise<void> {
		try {
			await this.loadStatuses();
			this.entries = await this.repository.list();
			if (this.disposed) return;
			this.renderList();
			const next = this.entries.find(entry => entry.id === this.selected?.id) ?? this.entries[0];
			if (next) await this.select(next); else this.renderDetail();
		} catch (error) { if (!this.disposed) { this.renderDetail(); this.errorEl.setText(errorMessage(error)); } }
	}
	private async loadStatuses(): Promise<void> {
		try { this.statuses = await readProjectStatuses(this.plugin, this.plugin.projectContext?.getProjectForFile(this.document.file) ?? null); }
		catch (error) { new Notice(`상태 목록을 읽지 못했습니다: ${errorMessage(error)}`); }
	}
	private status(entry: ManuscriptSnapshot): { name: string; color?: string } | undefined {
		const status = linkedStatus(entry, this.statuses);
		if (status) return { name: status.name, color: status.color ?? plotWorkbookStatusDefaultColor(status.id, this.modalEl.ownerDocument.body.classList.contains('theme-dark')) };
		return entry.stage ? { name: entry.stage } : undefined;
	}
	private renderList(): void {
		this.listEl.empty();
		this.pinButton.disabled = !this.selected;
		this.pinButton.setAttribute('aria-pressed', String(Boolean(this.selected?.pinned)));
		setIcon(this.pinButton, this.selected?.pinned ? 'pin-off' : 'pin');
		const limit = this.plugin.settings.snapshotMaxCount, needle = this.query.trim().toLocaleLowerCase();
		const visible = this.all || needle ? this.entries : this.entries.filter((entry, index) => index < limit || entry.pinned || entry.id === this.selected?.id);
		for (const entry of visible) {
			const status = this.status(entry);
			if (needle && !`${entry.name} ${entry.description ?? ''} ${status?.name ?? ''}`.toLocaleLowerCase().includes(needle)) continue;
			const row = this.listEl.createEl('button', { cls: `modal-sidebar-list-item file-recovery-list-item-header tappable${entry.id === this.selected?.id ? ' is-active' : ''}` });
			const info = row.createDiv({ cls: 'modal-sidebar-list-item-details file-recovery-list-item-details', text: `${entry.pinned ? '★ ' : ''}${entry.name}` });
			const meta = info.createDiv({ cls: 'wm-snapshot-entry-meta u-small u-muted' });
			meta.createSpan({ cls: 'wm-snapshot-entry-date', text: new Date(entry.timestamp).toLocaleString('ko-KR') });
			if (status) {
				const badge = meta.createSpan({ cls: 'wm-snapshot-entry-status', text: status.name });
				if (status.color) badge.style.setProperty('--wm-snapshot-status-color', status.color);
			}
			row.addEventListener('click', () => { if (!this.busy) void this.select(entry); });
		}
		if (!visible.length) this.listEl.createDiv({ cls: 'u-muted', text: '저장된 스냅샷이 없습니다.' });
	}
	private async select(entry: ManuscriptSnapshot): Promise<void> {
		const request = ++this.request;
		try {
			const source = await this.repository.read(entry);
			if (this.disposed || request !== this.request) return;
			this.selected = entry; this.selectedHunks.clear();
			this.comparison = compareSnapshot(source, this.document.read());
			this.renderList(); this.renderDetail();
		} catch (error) { if (!this.disposed && request === this.request) { this.renderDetail(); this.errorEl.setText(errorMessage(error)); } }
	}
	private renderDetail(): void {
		this.detailEl.empty();
		// Match Obsidian's File Recovery/Sync DOM. It is a titlebar, NOT a Setting row.
		const header = this.detailEl.createDiv({ cls: 'modal-setting-titlebar' });
		header.createDiv({ cls: 'modal-setting-title', text: this.selected?.name ?? this.document.file.basename });
		const actions = header.createDiv({ cls: 'modal-setting-titlebar-actions' });
		const label = actions.createSpan({ cls: 'modal-setting-titlebar-toggle wm-snapshot-compare-label', text: '변경사항 표시' });
		const toggle = new ToggleComponent(label).setValue(this.compare).onChange(value => { this.compare = value; this.selectedHunks.clear(); this.renderDetail(); });
		toggle.toggleEl.addClass('mod-small');
		new ButtonComponent(actions).setButtonText('복사').setDisabled(!this.comparison).onClick(() => {
			if (this.comparison) void navigator.clipboard.writeText(this.comparison.before).catch(error => new Notice(errorMessage(error)));
		});
		const restoreSelected = new ButtonComponent(actions).setButtonText('선택한 부분 복원').buttonEl;
		restoreSelected.addClass('wm-snapshot-restore-selected');
		restoreSelected.hidden = !this.compare;
		restoreSelected.disabled = this.selectedHunks.size === 0;
		restoreSelected.onclick = () => { const indexes = new Set(this.selectedHunks); void this.run(() => this.apply(indexes)); };
		new ButtonComponent(actions).setButtonText('이 버전 복원').setDisabled(!this.comparison).onClick(() => {
			if (!this.busy && this.comparison) new SnapshotConfirm(this.plugin, '현재 원고를 이 스냅샷으로 복원할까요?', () => this.run(() => this.apply(), true)).open();
		});
		this.errorEl = this.detailEl.createDiv({ cls: 'wm-snapshot-error', attr: { role: 'status' } });
		if (!this.comparison) { this.detailEl.createDiv({ cls: 'u-muted wm-snapshot-empty', text: '왼쪽의 +로 현재 원고를 저장하세요.' }); return; }
		if (this.compare) {
			const body = this.detailEl.createDiv({ cls: 'file-recovery-diff wm-manuscript-snapshot-text' });
			renderSnapshotDiff(body, this.comparison.before, this.comparison.current, { hunkActions: (parent, index) => {
				const controls = parent.createDiv({ cls: 'wm-snapshot-change-actions' });
				const checkbox = controls.createEl('input', { type: 'checkbox', cls: 'task-list-item-checkbox', attr: { 'aria-label': '이 변경 구간 선택' } });
				checkbox.checked = this.selectedHunks.has(index);
				checkbox.onchange = () => { if (checkbox.checked) this.selectedHunks.add(index); else this.selectedHunks.delete(index); restoreSelected.disabled = this.selectedHunks.size === 0; restoreSelected.setAttribute('aria-label', `선택한 ${this.selectedHunks.size}곳 복원`); };
			} });
		} else renderSnapshotText(this.detailEl.createDiv({ cls: 'file-recovery-diff wm-manuscript-snapshot-text' }), this.comparison.before);
	}
	private async run(action: () => Promise<void>, rethrow = false): Promise<void> {
		if (this.busy || this.disposed) return;
		this.busy = true;
		try { await action(); } catch (error) { if (!this.disposed) this.errorEl.setText(errorMessage(error)); if (rethrow) throw error; }
		finally { this.busy = false; }
	}
	private async save(): Promise<void> {
		try { await this.run(async () => {
			const source = this.document.read();
			if (!this.document.isCurrent(source)) throw new Error('대상 원고를 다시 열어 주세요.');
			const entry = await this.repository.save(this.document.file.basename, source);
			this.selected = entry; await this.reload();
		}); } catch { /* Error is displayed in the modal. */ }
	}
	private async rename(): Promise<void> {
		if (!this.selected) return;
		const entry = this.selected;
		await this.loadStatuses();
		if (this.disposed) return;
		new MetadataModal(this.plugin, entry, this.statuses, async changes => { await this.repository.update(entry.id, changes); await this.reload(); }).open();
	}
	private remove(): void {
		if (!this.selected) return;
		const entry = this.selected;
		new SnapshotConfirm(this.plugin, '이 스냅샷을 목록에서 삭제할까요? 보관 사본은 남습니다.', () => this.run(async () => {
			await this.repository.remove(entry); this.selected = null; this.comparison = null; await this.reload();
		})).open();
	}
	private async apply(indexes?: ReadonlySet<number>): Promise<void> {
		const comparison = this.comparison;
		if (!comparison || !this.document.isCurrent(comparison.current)) throw new Error('원고가 변경되었습니다. 목록에서 스냅샷을 다시 선택해 주세요.');
		const next = indexes ? restoreSnapshotHunks(comparison, indexes) : comparison.before;
		if (next === comparison.current) return;
		await this.repository.save('복원 전 백업', comparison.current, true);
		if (this.disposed || !this.document.isCurrent(comparison.current)) throw new Error('원고가 변경되었습니다. 적용하지 않았습니다. 목록에서 스냅샷을 다시 선택해 주세요.');
		this.document.replace(comparison.current, next);
		this.selectedHunks.clear(); this.comparison = compareSnapshot(comparison.before, this.document.read());
		this.entries = await this.repository.list(); this.renderList(); this.renderDetail();
		new Notice(indexes ? '선택한 부분을 복원했습니다.' : '원고를 복원했습니다.');
	}
}
