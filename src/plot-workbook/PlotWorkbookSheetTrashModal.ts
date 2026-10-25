import { wmT, getLocale } from '../i18n/index';
import { Modal, Notice, Setting, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { PlotWorkbookSession } from './PlotWorkbookSession';

export class PlotWorkbookSheetTrashModal extends Modal {
	private selectedSheetId: string | null = null;
	private busy = false;

	constructor(
		plugin: WritingMenuPlugin,
		private readonly session: PlotWorkbookSession,
		private readonly onRestore: () => void,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.setTitle(wmT("삭제된 시트 관리"));
		this.modalEl.addClass('wm-plotbook-sheet-trash-modal');
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const oldList = this.contentEl.querySelector<HTMLElement>('.wm-plotbook-sheet-trash-native-list');
		const listScrollTop = oldList?.scrollTop ?? 0;
		const contentScrollTop = this.contentEl.scrollTop;
		const restoreFocus = oldList?.contains(this.contentEl.ownerDocument.activeElement);
		this.contentEl.empty();
		const deleted = [...(this.session.manifest.deletedSheets ?? [])]
			.sort((left, right) => right.deletedAt - left.deletedAt);
		if (!deleted.some(item => item.id === this.selectedSheetId)) {
			this.selectedSheetId = deleted[0]?.id ?? null;
		}
		this.contentEl.createDiv({
			cls: 'wm-plotbook-sheet-trash-description',
			text: wmT("현재 {0}개 시트가 삭제되어 있습니다.", deleted.length),
		});

		const list = this.contentEl.createDiv({ cls: 'wm-plotbook-sheet-trash-native-list' });
		if (deleted.length === 0) {
			list.createDiv({ cls: 'wm-plotbook-sheet-trash-native-empty', text: wmT("삭제된 시트가 없습니다.") });
		} else {
			for (const ref of deleted) {
				const selected = ref.id === this.selectedSheetId;
				const row = list.createEl('button', {
					cls: `wm-plotbook-sheet-trash-native-item${selected ? ' is-selected' : ''}`,
					attr: { type: 'button', 'aria-pressed': String(selected) },
				});
				const icon = row.createSpan({ cls: 'wm-plotbook-sheet-trash-native-icon', attr: { 'aria-hidden': 'true' } });
				setIcon(icon, 'table-2');
				row.createSpan({ cls: 'wm-plotbook-sheet-trash-native-name', text: ref.name });
				row.addEventListener('click', () => {
					this.selectedSheetId = ref.id;
					this.render();
				});
			}
		}

		const selected = deleted.find(item => item.id === this.selectedSheetId) ?? null;
		new Setting(this.contentEl)
			.setClass('wm-plotbook-sheet-trash-native-setting')
			.setName(wmT("선택한 시트"))
			.setDesc(selected
				? `${selected.name} · ${new Date(selected.deletedAt).toLocaleString(getLocale())}`
				: wmT("관리할 시트를 선택하세요."))
			.addButton(button => button
				.setButtonText(wmT("영구 삭제"))
				.setClass('mod-warning')
				.setDisabled(!selected || this.busy)
				.onClick(() => selected && new PlotWorkbookSheetDeleteConfirmModal(
					this.app,
					selected.name,
					() => void this.remove(selected.id),
				).open()))
			.addButton(button => button
				.setButtonText(wmT("복원"))
				.setDisabled(!selected || this.busy)
				.onClick(() => selected && this.restore(selected.id)));

		const footer = this.contentEl.createDiv({ cls: 'wm-plotbook-sheet-trash-native-footer' });
		footer.createEl('button', { text: wmT("완료"), attr: { type: 'button' } })
			.addEventListener('click', () => this.close());
		if (restoreFocus) list.querySelector<HTMLElement>('.is-selected')?.focus({ preventScroll: true });
		list.scrollTop = listScrollTop;
		this.contentEl.scrollTop = contentScrollTop;
	}

	private async restore(sheetId: string): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.render();
		const restored = await this.session.restoreSheet(sheetId);
		if (!restored) {
			this.busy = false;
			new Notice(wmT("시트를 복원하지 못했습니다."));
			this.render();
			return;
		}
		this.busy = false;
		this.selectedSheetId = null;
		this.onRestore();
		this.render();
	}

	private async remove(sheetId: string): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.render();
		try {
			const removed = await this.session.permanentlyDeleteSheet(sheetId);
			if (!removed) {
				new Notice(wmT("삭제된 시트를 찾지 못했습니다."));
				return;
			}
			this.selectedSheetId = null;
			this.onRestore();
			new Notice(wmT("시트를 영구 삭제했습니다."));
		} catch (error) {
			new Notice(wmT("시트를 영구 삭제하지 못했습니다: {0}", error instanceof Error ? error.message : String(error)));
		} finally {
			this.busy = false;
			this.render();
		}
	}
}

class PlotWorkbookSheetDeleteConfirmModal extends Modal {
	constructor(
		app: WritingMenuPlugin['app'],
		private readonly sheetName: string,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(wmT("시트 영구 삭제"));
		this.contentEl.createEl('p', {
			text: wmT("“{0}” 시트와 저장된 기록을 완전히 삭제합니다. 이 작업은 되돌릴 수 없습니다.", this.sheetName),
		});
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: wmT("취소"), attr: { type: 'button' } })
			.addEventListener('click', () => this.close());
		const remove = actions.createEl('button', {
			cls: 'mod-warning',
			text: wmT("영구 삭제"),
			attr: { type: 'button' },
		});
		remove.addEventListener('click', () => {
			this.close();
			this.onConfirm();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
