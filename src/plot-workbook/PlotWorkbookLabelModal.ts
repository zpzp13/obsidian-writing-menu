import { Modal, Notice, Setting } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { PlotWorkbookSession } from './PlotWorkbookSession';

export class PlotWorkbookLabelModal extends Modal {
	constructor(
		plugin: WritingMenuPlugin,
		private readonly session: PlotWorkbookSession,
		private readonly columnIds: string[],
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.setTitle('라벨');
		this.contentEl.addClass('wm-plotbook-label-modal');
		const selectedIds = new Set(this.columnIds
			.map(columnId => this.session.activeSheet.columns[columnId]?.labelId)
			.filter((labelId): labelId is string => Boolean(labelId)));
		const selectedLabelId = selectedIds.size === 1 ? [...selectedIds][0] : undefined;

		const listHeading = this.contentEl.createDiv({ cls: 'setting-item setting-item-heading' });
		listHeading.createDiv({ cls: 'setting-item-info' })
			.createDiv({ cls: 'setting-item-name', text: '목록' });

		new Setting(this.contentEl)
			.setName('없음')
			.setDesc('선택한 열에서 라벨을 제거합니다.')
			.addButton(button => button
				.setButtonText(selectedIds.size === 0 ? '선택됨' : '선택')
				.setDisabled(selectedIds.size === 0)
				.onClick(() => {
					this.session.setColumnLabel(this.columnIds);
					this.close();
				}));

		for (const label of this.session.manifest.labels ?? []) {
			const setting = new Setting(this.contentEl)
				.setName(label.name)
				.addButton(button => button
					.setButtonText(selectedLabelId === label.id ? '선택됨' : '선택')
					.setDisabled(selectedLabelId === label.id)
					.onClick(() => {
						this.session.setColumnLabel(this.columnIds, label.id);
						this.close();
					}));
			const swatch = document.createElement('span');
			swatch.className = 'wm-plotbook-label-swatch';
			swatch.style.backgroundColor = label.color;
			setting.nameEl.prepend(swatch);
		}

		const createHeading = this.contentEl.createDiv({ cls: 'setting-item setting-item-heading' });
		createHeading.createDiv({ cls: 'setting-item-info' })
			.createDiv({ cls: 'setting-item-name', text: '새 라벨' });
		let name = '';
		let color = '#7c8cf8';
		new Setting(this.contentEl)
			.setName('이름')
			.addText(text => text
				.setPlaceholder('예: 메인 플롯')
				.onChange(value => { name = value; }));
		new Setting(this.contentEl)
			.setName('색상')
			.addColorPicker(picker => picker
				.setValue(color)
				.onChange(value => { color = value; }));

		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const addButton = actions.createEl('button', { cls: 'mod-cta', text: '추가 및 지정' });
		addButton.addEventListener('click', () => void this.createAndAssign(name, color));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async createAndAssign(name: string, color: string): Promise<void> {
		if (!name.trim()) {
			new Notice('라벨 이름을 입력해주세요.');
			return;
		}
		const label = await this.session.addLabel(name, color);
		if (!label) return;
		this.session.setColumnLabel(this.columnIds, label.id);
		this.close();
	}
}
