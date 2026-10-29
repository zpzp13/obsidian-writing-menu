import { Notice, Setting } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { wmT } from '../i18n/index';
import { downloadKordocAssets, getKordocAssetStatus, KORDOC_VERSION } from './KordocAssets';

export function renderKordocEngineSetting(container: HTMLElement, plugin: WritingMenuPlugin): void {
	const setting = new Setting(container).setName(wmT('HWPX 엔진'));
	const setDescription = (status: string) => {
		setting.descEl.empty();
		setting.descEl.createEl('a', {
			text: 'kordoc',
			href: 'https://github.com/chrisryugj/kordoc',
			attr: { target: '_blank', rel: 'noopener' },
		});
		setting.descEl.appendText(` · ${status}`);
	};
	const addDownloadButton = (outdated = false) => {
		setting.addButton(button => {
			button.setButtonText(outdated ? wmT('업데이트') : wmT('다운로드')).setCta().onClick(() => {
				button.setDisabled(true);
				void downloadKordocAssets(plugin, step => { button.setButtonText(step); })
					.catch(error => { new Notice(error instanceof Error ? error.message : String(error)); })
					.finally(refresh).catch(error => { new Notice(error instanceof Error ? error.message : String(error)); });
			});
		});
	};
	const refresh = async () => {
		const status = await getKordocAssetStatus(plugin);
		setDescription(status === 'current'
			? wmT('v{0} 설치 완료 · 완전히 오프라인으로 동작합니다.', KORDOC_VERSION)
			: status === 'outdated' ? wmT('새 엔진 v{0} 업데이트가 있습니다.', KORDOC_VERSION)
				: wmT('HWPX 미리보기에 필요합니다. 최초 1회 다운로드 후 오프라인으로 사용합니다.'));
		setting.controlEl.empty();
		if (status === 'current') {
			setting.addExtraButton(button => {
				button.setIcon('check').setTooltip(wmT('다운로드됨')).setDisabled(true);
				button.extraSettingsEl.addClass('wm-settings-status-success');
			});
		} else addDownloadButton(status === 'outdated');
	};
	setDescription(wmT('확인 중…'));
	setting.addButton(button => { button.setButtonText(wmT('확인 중…')).setDisabled(true); });
	void refresh().catch(error => {
		setDescription(error instanceof Error ? error.message : String(error));
		setting.controlEl.empty();
		addDownloadButton();
	});
}
