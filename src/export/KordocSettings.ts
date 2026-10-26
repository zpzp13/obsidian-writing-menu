import { Notice, Setting } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { wmT } from '../i18n/index';
import { downloadKordocAssets, getKordocAssetStatus, KORDOC_VERSION } from './KordocAssets';

export function renderKordocEngineSetting(container: HTMLElement, plugin: WritingMenuPlugin): void {
	const setting = new Setting(container).setName(wmT('HWPX 엔진')).setDesc(wmT('확인 중…'));
	setting.addButton(button => {
		const refresh = async () => {
			const status = await getKordocAssetStatus(plugin);
			setting.setDesc(status === 'current'
				? wmT('kordoc v{0} 설치 완료 · 완전히 오프라인으로 동작합니다.', KORDOC_VERSION)
				: status === 'outdated' ? wmT('새 엔진 v{0} 업데이트가 있습니다.', KORDOC_VERSION)
					: wmT('HWPX 미리보기에 필요합니다. 최초 1회 다운로드 후 오프라인으로 사용합니다.'));
			button.setButtonText(status === 'current' ? wmT('다시 설치') : status === 'outdated' ? wmT('업데이트') : wmT('다운로드')).setDisabled(false);
		};
		button.setButtonText(wmT('확인 중…')).setDisabled(true).onClick(() => {
			button.setDisabled(true);
			void downloadKordocAssets(plugin, step => { button.setButtonText(step); })
				.catch(error => { new Notice(error instanceof Error ? error.message : String(error)); })
				.finally(refresh).catch(error => { new Notice(error instanceof Error ? error.message : String(error)); });
		});
		void refresh().catch(error => { setting.setDesc(error instanceof Error ? error.message : String(error)); button.setDisabled(false).setButtonText(wmT('다운로드')); });
	});
}
