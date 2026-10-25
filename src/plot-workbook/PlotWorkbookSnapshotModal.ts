import { wmT, getLocale } from '../i18n/index';
import { ButtonComponent, Modal, Notice, SearchComponent, Setting, ToggleComponent, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { renderSnapshotDiff } from '../snapshots/SnapshotDiffView';
import type { PlotWorkbookSession } from './PlotWorkbookSession';
import type { PlotWorkbookCellSnapshotRef } from './PlotWorkbookTypes';

export interface PlotWorkbookSnapshotTarget {
	rowId: string;
	columnId: string;
	label: string;
}

interface PlotWorkbookSnapshotListItem {
	snapshot: PlotWorkbookCellSnapshotRef;
	target: PlotWorkbookSnapshotTarget;
}

export class PlotWorkbookSnapshotModal extends Modal {
	private selectedSnapshotId: string | null = null;
	private previewRequest = 0;
	private compareMode = false;
	private sidebarQuery = '';

	constructor(
		private readonly plugin: WritingMenuPlugin,
		private readonly session: PlotWorkbookSession,
		private readonly targets: PlotWorkbookSnapshotTarget[],
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.setTitle(wmT("스냅샷"));
		// Obsidian File Recovery와 같은 모달 레이아웃 및 순정 스타일을 사용한다.
		this.modalEl.addClass('mod-sync-history', 'mod-sidebar-layout', 'wm-plotbook-snapshot-modal', 'wm-snapshot-manager');
		this.render();
	}

	onClose(): void {
		this.previewRequest++;
		this.contentEl.empty();
	}

	private snapshotItems(): PlotWorkbookSnapshotListItem[] {
		return this.targets.flatMap(target => this.session
			.listCellSnapshots(this.session.activeSheet.sheetId, target.rowId, target.columnId)
			.map(snapshot => ({ snapshot, target })),
		).sort((left, right) => right.snapshot.createdAt - left.snapshot.createdAt);
	}

	private displayTitle(item: PlotWorkbookSnapshotListItem): string {
		const title = item.snapshot.title?.trim();
		const legacyTimestamp = new Date(item.snapshot.createdAt).toLocaleString('ko-KR');
		return !title || title === legacyTimestamp ? item.target.label : title;
	}

	private render(): void {
		this.previewRequest++;
		this.contentEl.empty();
		const items = this.snapshotItems();
		if (!items.some(item => item.snapshot.id === this.selectedSnapshotId)) {
			this.selectedSnapshotId = items[0]?.snapshot.id ?? null;
		}
		const selected = items.find(item => item.snapshot.id === this.selectedSnapshotId) ?? null;

		const sidebar = this.contentEl.createDiv({ cls: 'modal-sidebar mod-history' });
		const sidebarInner = sidebar.createDiv({ cls: 'modal-sidebar-inner' });
		const search = new SearchComponent(sidebarInner)
			.setPlaceholder(wmT("스냅샷 검색..."))
			.setValue(this.sidebarQuery);
		const list = sidebarInner.createDiv({ cls: 'modal-sidebar-list' });
		list.tabIndex = -1;
		const searchableRows: Array<{ row: HTMLElement; text: string }> = [];
		for (const item of items) {
			const row = list.createDiv({
				cls: `modal-sidebar-list-item file-recovery-list-item-header tappable${item.snapshot.id === this.selectedSnapshotId ? ' is-active' : ''}`,
			});
			row.tabIndex = -1;
			const details = row.createDiv({
				cls: 'modal-sidebar-list-item-details file-recovery-list-item-details',
				text: this.displayTitle(item),
			});
			details.createDiv({
				cls: 'u-small u-muted',
				text: new Date(item.snapshot.createdAt).toLocaleString(getLocale()),
			});
			searchableRows.push({
				row,
				text: `${this.displayTitle(item)}\n${item.target.label}\n${new Date(item.snapshot.createdAt).toLocaleString(getLocale())}`
					.toLocaleLowerCase('ko-KR'),
			});
			row.addEventListener('click', () => {
				this.selectedSnapshotId = item.snapshot.id;
				this.render();
			});
		}
		const applySidebarSearch = (query: string) => {
			this.sidebarQuery = query;
			const needle = query.trim().toLocaleLowerCase('ko-KR');
			for (const entry of searchableRows) entry.row.toggle(!needle || entry.text.includes(needle));
		};
		search.onChange(applySidebarSearch);
		applySidebarSearch(this.sidebarQuery);
		const listActions = sidebarInner.createDiv({ cls: 'wm-plotbook-snapshot-list-actions' });
		const add = listActions.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': wmT("스냅샷 추가") },
		});
		setIcon(add, 'plus');
		add.addEventListener('click', () => void this.create());
		const rename = listActions.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': wmT("스냅샷 제목 수정") },
		});
		setIcon(rename, 'pencil');
		rename.disabled = !selected;
		rename.addEventListener('click', () => {
			if (!selected) return;
			new PlotWorkbookSnapshotTitleModal(
				this.plugin,
				this.displayTitle(selected),
				title => void this.rename(selected.snapshot.id, title),
			).open();
		});
		const remove = listActions.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': wmT("스냅샷 삭제") },
		});
		setIcon(remove, 'trash-2');
		remove.disabled = !selected;
		remove.addEventListener('click', () => {
			if (selected) void this.remove(selected.snapshot.id);
		});

		const contentContainer = this.contentEl.createDiv({
			cls: `sync-history-content-container${selected ? '' : ' mod-empty'}`,
		});
		contentContainer.createEl('p', {
			cls: 'sync-history-content-empty',
			text: items.length === 0 ? wmT("저장된 스냅샷이 없습니다.") : wmT("스냅샷을 선택하세요."),
		});
		const historyContent = contentContainer.createDiv({ cls: 'sync-history-content' });
		const titlebar = historyContent.createDiv({ cls: 'modal-setting-titlebar' });
		titlebar.createDiv({
			cls: 'modal-setting-title',
			text: selected ? this.displayTitle(selected) : wmT("스냅샷"),
		});
		const actions = titlebar.createDiv({ cls: 'modal-setting-titlebar-actions' });
		const toggleLabel = actions.createSpan({
			cls: 'modal-setting-titlebar-toggle',
			text: wmT("변경 사항 표시"),
		});
		new ToggleComponent(toggleLabel)
			.setValue(this.compareMode)
			.setDisabled(!selected)
			.onChange(value => {
				this.compareMode = value;
				this.render();
			});
		new ButtonComponent(actions)
			.setButtonText(wmT("복사"))
			.setDisabled(!selected)
			.onClick(() => {
				if (selected) void this.copy(selected.snapshot.id);
			});
		new ButtonComponent(actions)
			.setButtonText(wmT("이 버전 복원"))
			.setDisabled(!selected)
			.onClick(() => {
				if (selected) void this.restore(selected.snapshot.id, selected.target);
			});

		const textarea = historyContent.createEl('textarea', {
			cls: 'file-recovery-text',
			attr: { spellcheck: 'false', 'aria-label': wmT("스냅샷 내용") },
		});
		textarea.readOnly = true;
		textarea.dataset.ext = 'md';
		const diff = historyContent.createDiv({ cls: 'file-recovery-diff' });
		textarea.toggle(!this.compareMode);
		diff.toggle(this.compareMode);
		if (selected) void this.renderPreview(textarea, diff, selected);
	}

	private async renderPreview(
		textarea: HTMLTextAreaElement,
		diff: HTMLElement,
		item: PlotWorkbookSnapshotListItem,
	): Promise<void> {
		const request = ++this.previewRequest;
		const snapshot = await this.session.readCellSnapshot(item.snapshot.id);
		if (request !== this.previewRequest || !textarea.isConnected || !diff.isConnected) return;
		if (!snapshot) {
			textarea.value = wmT("스냅샷 파일을 찾을 수 없습니다.");
			diff.setText(wmT("스냅샷 파일을 찾을 수 없습니다."));
			return;
		}
		textarea.value = snapshot.value;
		if (!this.compareMode) return;
		const current = this.session.getCell(this.session.activeSheet, item.target.rowId, item.target.columnId);
		renderSnapshotDiff(diff, snapshot.value, current);
	}

	private async create(): Promise<void> {
		const count = await this.session.createCellSnapshots(this.targets, '');
		if (count === 0) new Notice(wmT("내용이 있는 셀을 선택해 주세요."));
		else new Notice(wmT("{0}개의 셀 스냅샷을 만들었습니다.", count));
		this.selectedSnapshotId = null;
		this.render();
	}

	private async copy(snapshotId: string): Promise<void> {
		const snapshot = await this.session.readCellSnapshot(snapshotId);
		if (!snapshot) {
			new Notice(wmT("스냅샷 파일을 찾을 수 없습니다."));
			return;
		}
		try {
			await navigator.clipboard.writeText(snapshot.value);
			new Notice(wmT("스냅샷 내용을 클립보드에 복사했습니다."));
		} catch (error) {
			new Notice(wmT("스냅샷을 복사하지 못했습니다: {0}", error instanceof Error ? error.message : String(error)));
		}
	}

	private async restore(snapshotId: string, target: PlotWorkbookSnapshotTarget): Promise<void> {
		const snapshot = await this.session.readCellSnapshot(snapshotId);
		if (!snapshot) {
			new Notice(wmT("스냅샷 파일을 찾을 수 없습니다."));
			return;
		}
		this.session.setCell(target.rowId, target.columnId, snapshot.value);
		new Notice(wmT("스냅샷을 복원했습니다. 현재 내용은 실행 취소로 되돌릴 수 있습니다."));
		this.close();
	}

	private async remove(snapshotId: string): Promise<void> {
		await this.session.deleteCellSnapshot(snapshotId);
		this.selectedSnapshotId = null;
		this.render();
	}

	private async rename(snapshotId: string, title: string): Promise<void> {
		await this.session.renameCellSnapshot(snapshotId, title);
		this.render();
	}
}

export class PlotWorkbookSnapshotTitleModal extends Modal {
	constructor(
		plugin: WritingMenuPlugin,
		private readonly initialTitle: string,
		private readonly onSubmit: (title: string) => void,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.setTitle(wmT("스냅샷 제목 수정"));
		let value = this.initialTitle;
		const setting = new Setting(this.contentEl)
			.setName(wmT("제목"))
			.addText(text => {
				text.setValue(value).onChange(next => { value = next; });
				text.inputEl.addEventListener('keydown', event => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					this.submit(value);
				});
				window.setTimeout(() => {
					text.inputEl.focus();
					text.inputEl.select();
				}, 0);
			})
			.addButton(button => button
				.setButtonText(wmT("저장"))
				.setCta()
				.onClick(() => this.submit(value)));
		setting.settingEl.addClass('wm-plotbook-snapshot-title-setting');
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(value: string): void {
		const title = value.trim();
		if (!title) return;
		this.onSubmit(title);
		this.close();
	}
}
