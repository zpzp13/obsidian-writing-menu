import { Notice, Setting, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { WritingProject } from '../types';
import type { PlotWorkbookView } from './PlotWorkbookView';
import { PLOT_WORKBOOK_VIEW_TYPE } from './PlotWorkbookTypes';
import { PlotWorkbookRepository } from './PlotWorkbookRepository';
import { PlotWorkbookSession } from './PlotWorkbookSession';
import { PlotWorkbookStatusDeleteModal, PlotWorkbookStatusModal } from './PlotWorkbookStatusModal';
import { plotWorkbookStatusColor, plotWorkbookStatusDefaultColor, plotWorkbookStatusIcon } from './PlotWorkbookStatus';
import { plotWorkbookSessions } from './PlotWorkbookSessionStore';

function liveStatusSession(plugin: WritingMenuPlugin, project: WritingProject): PlotWorkbookSession | null {
	const shared = plotWorkbookSessions(plugin).peek(project);
	if (shared) return shared;
	for (const leaf of plugin.app.workspace.getLeavesOfType(PLOT_WORKBOOK_VIEW_TYPE)) {
		const session = (leaf.view as PlotWorkbookView).getStatusSettingsSession?.(project.id);
		if (session) return session;
	}
	return null;
}

async function withStatusSession<T>(plugin: WritingMenuPlugin, project: WritingProject, action: (session: PlotWorkbookSession) => T | Promise<T>): Promise<T> {
	const live = liveStatusSession(plugin, project);
	if (live) return action(live);
	const repository = new PlotWorkbookRepository(plugin, project.rootFolder);
	try {
		const manifest = await repository.loadExistingManifest();
		if (!manifest) throw new Error('이 프로젝트를 플롯 매니저에서 먼저 열어주세요.');
		// Recheck after the read so a newly opened view remains the sole writer.
		return await action(liveStatusSession(plugin, project) ?? new PlotWorkbookSession(repository, manifest, new Map(), [], []));
	} finally { repository.dispose(); }
}

export function renderPlotWorkbookStatusSettings(box: HTMLElement, plugin: WritingMenuPlugin): void {
	const projects = plugin.projectContext.getProjects();
	if (!projects.length) { new Setting(box).setDesc('프로젝트를 등록한 뒤 상태 항목을 관리할 수 있습니다.'); return; }
	let project = projects[0];
	let token = 0;
	let addStatus: ((name: string) => Promise<void>) | null = null;
	const headingControls = box.closest('.setting-group')?.querySelector<HTMLElement>(':scope > .setting-item-heading > .setting-item-control');
	const add = headingControls?.createDiv({ cls: 'clickable-icon wm-muted-icon', attr: { role: 'button', tabindex: '0', 'aria-label': '상태 추가' } });
	if (add) {
		setIcon(add, 'plus');
		add.addEventListener('click', () => {
			if (addStatus) new PlotWorkbookStatusModal(plugin, name => addStatus?.(name)).open();
		});
		add.addEventListener('keydown', event => {
			if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); add.click(); }
		});
	}
	const picker = new Setting(box).setName('프로젝트').setDesc('프로젝트별 상태 이름을 수정하거나 선택 목록에서 삭제합니다.');
	const list = box.createDiv({ cls: 'wm-plotbook-status-settings-list' });
	const render = async () => {
		const request = ++token;
		const target = project;
		addStatus = null;
		add?.setAttribute('aria-disabled', 'true');
		list.empty();
		try {
			const statuses = await withStatusSession(plugin, target, session => session.getStatuses());
			if (request !== token || !list.isConnected) return;
			let mutations = Promise.resolve();
			const mutate = (action: (session: PlotWorkbookSession) => Promise<boolean>, redraw = true): Promise<void> => {
				mutations = mutations.then(async () => {
					if (redraw) for (const button of list.querySelectorAll('button')) button.disabled = true;
					try {
						const saved = await withStatusSession(plugin, target, async session => ({
							ok: await action(session), source: session, statuses: session.manifest.statuses,
						}));
						if (!saved.ok) new Notice('중복되지 않는 상태 이름을 입력해주세요.');
						else for (const leaf of plugin.app.workspace.getLeavesOfType(PLOT_WORKBOOK_VIEW_TYPE)) {
							const other = (leaf.view as PlotWorkbookView).getStatusSettingsSession?.(target.id);
							if (other && other !== saved.source) other.refreshStatusSettings(saved.statuses);
						}
					} catch (error) { new Notice(`상태를 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`); }
					finally { if (redraw && project.id === target.id) void render(); }
				});
				return mutations;
			};
			addStatus = name => mutate(async session => Boolean(await session.addStatus(name)));
			add?.setAttribute('aria-disabled', 'false');
			for (const status of statuses) {
				const setting = new Setting(list).setName(status.name).setClass('wm-plotbook-status-setting');
				setting.settingEl.style.setProperty('--wm-plotbook-status-color', plotWorkbookStatusColor(status.id, status.color));
				const icon = setting.nameEl.createSpan({ cls: 'wm-plotbook-status-setting-icon', attr: { 'aria-hidden': 'true' } });
				setting.nameEl.prepend(icon);
				setIcon(icon, plotWorkbookStatusIcon(status.id));
				setting.addExtraButton(button => button.setIcon('pencil').setTooltip('상태 수정').onClick(() => {
					new PlotWorkbookStatusModal(plugin, name => mutate(session => session.renameStatus(status.id, name)), status.name).open();
				}));
				setting.addExtraButton(button => button.setIcon('trash-2').setTooltip('상태 삭제').onClick(() => {
					new PlotWorkbookStatusDeleteModal(plugin, status.name, () => mutate(session => session.deleteStatus(status.id))).open();
				}));
				setting.addExtraButton(button => button.setIcon('reset').setTooltip('상태 색상 초기화')
					.onClick(() => { void mutate(session => session.setStatusColor(status.id)); }));
				setting.addColorPicker(picker => {
					picker.setValue(status.color ?? plotWorkbookStatusDefaultColor(status.id, box.ownerDocument.body.classList.contains('theme-dark')));
					setting.controlEl.querySelector('input[type="color"]')?.setAttribute('aria-label', `${status.name} 색상`);
					picker.onChange(color => {
						setting.settingEl.style.setProperty('--wm-plotbook-status-color', color);
						// Keep the native picker mounted during a drag; serialize writes so
						// the last selected color wins even if storage is slower than input.
						void mutate(session => session.setStatusColor(status.id, color), false);
					});
				});
			}
			if (!statuses.length) new Setting(list).setDesc('등록된 상태가 없습니다. 시트의 상태 메뉴에서 추가할 수 있습니다.');
		} catch (error) {
			if (request === token && list.isConnected) new Setting(list).setDesc(error instanceof Error ? error.message : String(error));
		}
	};
	picker.addDropdown(dropdown => {
		for (const item of projects) dropdown.addOption(item.id, item.name);
		dropdown.setValue(project.id).onChange(id => { project = projects.find(item => item.id === id) ?? projects[0]; void render(); });
	});
	void render();
}
