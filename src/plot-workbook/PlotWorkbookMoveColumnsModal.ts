import { wmT } from '../i18n/index';
import { Modal, Notice, Setting } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { PlotWorkbookSession } from './PlotWorkbookSession';

export class PlotWorkbookMoveColumnsModal extends Modal {
	constructor(
		plugin: WritingMenuPlugin,
		private readonly session: PlotWorkbookSession,
		private readonly columnIds: string[],
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.setTitle(wmT("다른 시트로 이동"));
		this.contentEl.addClass('wm-plotbook-move-columns-modal');
		this.contentEl.createEl('p', {
			text: wmT("열의 서식과 셀 내용을 행 순서에 맞춰 대상 시트의 오른쪽 끝으로 이동합니다."),
		});
		for (const sheet of this.session.manifest.sheets) {
			if (sheet.id === this.session.manifest.activeSheetId) continue;
			new Setting(this.contentEl)
				.setName(sheet.name)
				.addButton(button => button.setButtonText(wmT("이동")).onClick(() => void (async () => {
					button.setDisabled(true);
					try {
						if (!(await this.session.moveColumnsToSheet(this.columnIds, sheet.id))) {
							new Notice(wmT("열을 이동하지 못했습니다. 마지막 열은 이동할 수 없습니다."));
							button.setDisabled(false);
							return;
						}
						new Notice(wmT("“{0}” 시트로 이동했습니다. 실행 취소로 되돌릴 수 있습니다.", sheet.name));
						this.close();
					} catch (error) {
						new Notice(wmT("열을 이동하지 못했습니다: {0}", error instanceof Error ? error.message : String(error)));
						button.setDisabled(false);
					}
				})()));
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
