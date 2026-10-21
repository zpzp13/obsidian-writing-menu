import { Notice, Setting } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { LegacyPlotImporter } from './LegacyPlotImporter';
import { PLOT_WORKBOOK_VIEW_TYPE } from './PlotWorkbookTypes';
import { renderPlotWorkbookStatusSettings } from './PlotWorkbookStatusSettings';
import { openPlotSnapshots } from './PlotWorkbookTransferModal';

function groupBox(container: HTMLElement, title?: string): HTMLElement {
	const group = container.createDiv({ cls: 'setting-group' });
	if (title) {
		const heading = group.createDiv({ cls: 'setting-item setting-item-heading' });
		heading.createDiv({ cls: 'setting-item-name', text: title });
		heading.createDiv({ cls: 'setting-item-control' });
	}
	group.createDiv({ cls: 'setting-group-search', attr: { tabindex: '-1' } });
	return group.createDiv({ cls: 'setting-items' });
}

export function renderPlotWorkbookSettingsPage(containerEl: HTMLElement, plugin: WritingMenuPlugin): void {
	const storageBox = groupBox(containerEl);

	new Setting(storageBox)
		.setName('프로젝트별 저장')
		.setDesc('플롯 시트는 등록된 프로젝트 폴더 안의 .writing-menu/plot에 저장합니다.')
		.addButton(button => button
			.setButtonText('열기')
			.onClick(() => { void plugin.togglePlotWorkbookView(); }));

	const characterBox = groupBox(containerEl, '인물');
	new Setting(characterBox)
		.setName('링크 열기')
		.setDesc('인물 열 제목을 선택했을 때 노트를 열 위치입니다.')
		.addDropdown(dropdown => dropdown
			.addOption('tab', '새 탭')
			.addOption('current', '현재 탭')
			.addOption('sidebar', '사이드바')
			.setValue(plugin.settings.plotCharacterLinkOpenMode)
			.onChange(async (value: 'tab' | 'current' | 'sidebar') => {
				plugin.settings.plotCharacterLinkOpenMode = value;
				await plugin.saveSettings();
			}));

	new Setting(characterBox)
		.setName('링크 형식')
		.setDesc('인물 제목을 위키 프로필 또는 마크다운 노트로 열며, 본문에 저장하는 링크 형식에도 함께 적용합니다.')
		.addDropdown(dropdown => dropdown
			.addOption('markdown', '마크다운')
			.addOption('wiki', '위키')
			.setValue(plugin.settings.plotCharacterLinkFormat)
			.onChange(async (value: 'markdown' | 'wiki') => {
				plugin.settings.plotCharacterLinkFormat = value;
				await plugin.saveSettings();
			}));

	renderPlotWorkbookStatusSettings(groupBox(containerEl, '상태'), plugin);
	const projects = plugin.projectContext.getProjects();
	const importer = new LegacyPlotImporter(plugin);
	const sourcePath = importer.getSourcePath();
	const migrationBox = groupBox(containerEl, '가져오기');

	new Setting(migrationBox)
		.setName('원본 폴더')
		.setDesc(sourcePath || '이전 버전에서 지정한 플롯 폴더가 없습니다.');

	let targetProjectId = importer.findTargetProject(projects)?.id ?? '';
	const importSetting = new Setting(migrationBox)
		.setName('기존 플롯 가져오기')
		.setDesc('기존 마크다운과 JSON은 수정하거나 삭제하지 않고, 새 워크북의 별도 시트로 복사합니다. 같은 원본은 한 번만 가져옵니다.');
	if (projects.length > 0) {
		importSetting.addDropdown(dropdown => {
			for (const project of projects) dropdown.addOption(project.id, project.name);
			dropdown.setValue(targetProjectId || projects[0].id);
			dropdown.onChange(value => { targetProjectId = value; });
		});
	}
	importSetting.addButton(button => {
		button.setButtonText('가져오기');
		button.setDisabled(!sourcePath || projects.length === 0);
		button.onClick(() => { void (async () => {
			const openLeaves = plugin.app.workspace.getLeavesOfType(PLOT_WORKBOOK_VIEW_TYPE);
			if (openLeaves.length > 0) {
				openLeaves.forEach(leaf => leaf.detach());
				new Notice('안전한 가져오기를 위해 열려 있던 플롯 매니저를 닫았습니다. 가져오기를 한 번 더 눌러주세요.');
				return;
			}
			const project = projects.find(item => item.id === targetProjectId) ?? projects[0];
			if (!project) {
				new Notice('먼저 기본 설정에서 프로젝트를 등록해주세요.');
				return;
			}
			button.setDisabled(true);
			button.setButtonText('가져오는 중…');
			try {
				if (!(await importer.hasSourceData())) throw new Error('원본 폴더에서 기존 플롯 데이터를 찾지 못했습니다.');
				const result = await importer.importInto(project);
				new Notice(result.imported
					? `기존 플롯을 새 시트로 가져왔습니다. (${result.rowCount}행 · ${result.columnCount}열)`
					: '이 원본은 이미 가져온 상태입니다.');
				await plugin.togglePlotWorkbookView();
			} catch (error) {
				new Notice(`기존 플롯을 가져오지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				button.setDisabled(false);
				button.setButtonText('가져오기');
			}
		})(); });
	});

	migrationBox.createDiv({
		cls: 'wm-settings-item-desc',
		text: '가져오기가 끝난 뒤에도 원본 파일과 이전 설정값은 보존됩니다. 새 시트를 확인한 후에만 원본을 직접 정리하세요.',
	});
}

export function renderPlotSnapshotSettings(box: HTMLElement, plugin: WritingMenuPlugin): void {
	new Setting(box).setName('저장 폴더').setDesc('볼트 기준 경로입니다. 비워두면 각 프로젝트 폴더 아래의 스냅샷 폴더에 저장합니다.')
		.addText(text => text.setValue(plugin.settings.plotSnapshotFolder ?? '').setPlaceholder('프로젝트/스냅샷 (기본값)').onChange(async value => {
			plugin.settings.plotSnapshotFolder = value.trim();
			await plugin.saveSettings();
		}));
	const projects = plugin.projectContext.getProjects();
	let project = projects[0];
	const setting = new Setting(box).setName('수동 저장 · 불러오기')
		.setDesc('Markdown 파일만 동기화하며 자동 반영하지 않습니다. 시트 서식과 복선 연결도 보존합니다.');
	if (project) setting.addDropdown(dropdown => {
		for (const item of projects) dropdown.addOption(item.id, item.name);
		dropdown.setValue(project.id).onChange(id => { project = projects.find(item => item.id === id) ?? projects[0]; });
	});
	setting.addButton(button => button.setButtonText('관리').setDisabled(!project).onClick(() => {
		if (project) void openPlotSnapshots(plugin, project);
	}));
}

