import { ManuscriptSnapshotModal } from '../src/snapshots/ManuscriptSnapshotModal';
import { ManuscriptSnapshotRepository } from '../src/snapshots/ManuscriptSnapshotRepository';
import { PlotWorkbookRepository } from '../src/plot-workbook/PlotWorkbookRepository';
import { readProjectStatuses } from '../src/plot-workbook/PlotWorkbookStatusSource';

export async function verifySnapshotStatus(plugin, writing, assert, settle) {
	const project = { id: 'status-project', name: '상태 연동', rootFolder: 'StatusProject' };
	const target = { ...plugin, projectContext: { getProjectForFile: () => project } };
	const book = new PlotWorkbookRepository(target, project.rootFolder);
	const loaded = await book.loadOrCreate(project.id, project.name);
	loaded.manifest.statuses = [{ id: 'draft', name: '초고 검토', color: '#c85873' }, { id: 'custom-status', name: '출간 준비', color: '#538d75' }];
	await book.saveManifest(loaded.manifest);
	const repo = new ManuscriptSnapshotRepository(target, writing.path);
	const entry = await repo.save('상태 확인', writing.read());
	await repo.update(entry.id, { stage: '초고' });
	const before = JSON.stringify([...plugin.app.vault.files]);
	const modal = new ManuscriptSnapshotModal(target, writing).open(); await settle();
	assert(modal.selected.id === entry.id, 'Snapshot status fixture did not select its saved record');
	let badge = modal.listEl.querySelector('.wm-snapshot-entry-status');
	assert(badge.textContent === '초고 검토' && badge.parentElement.lastChild === badge, 'Snapshot uses stale label text or status is not on the metadata right');
	assert(JSON.stringify([...plugin.app.vault.files]) === before, 'Reading snapshot statuses wrote to the plot or snapshot files');
	await modal.rename();
	let editor = globalThis.lastTestModal;
	assert(editor.modalEl.classList.contains('wm-snapshot-metadata-modal') && !editor.titleEl.textContent, 'Snapshot metadata still has its retired heading');
	assert([...editor.contentEl.querySelectorAll('.setting-item-name')].map(el => el.textContent).filter(Boolean).join('/') === '제목/메모/상태', 'Metadata fields do not use status');
	const select = editor.contentEl.querySelector('select');
	assert(select.value === 'draft' && [...select.options].some(item => item.value === 'custom-status'), 'Metadata does not use project plot status IDs');
	const verifyCenters = () => {
		for (const row of editor.contentEl.querySelectorAll('.setting-item')) {
			const label = row.querySelector('.setting-item-name'), control = row.querySelector('input,textarea,select');
			if (!control) continue;
			const a = label.getBoundingClientRect(), b = control.getBoundingClientRect();
			assert(Math.abs(a.top + a.height / 2 - b.top - b.height / 2) < 2, 'Metadata label and control are not vertically centered');
			assert(a.right < b.left && b.right <= editor.modalEl.getBoundingClientRect().right, 'Metadata label overlaps its control');
		}
	};
	verifyCenters(); document.body.classList.add('is-mobile'); verifyCenters(); document.body.classList.remove('is-mobile');
	select.value = 'custom-status'; select.dispatchEvent(new Event('change'));
	editor.contentEl.querySelector('button').click(); await settle();
	assert((await repo.list()).find(item => item.id === entry.id).statusId === 'custom-status', 'Snapshot did not save stable project status ID');
	loaded.manifest.statuses[1].name = '출간 완료'; await book.saveManifest(loaded.manifest); await modal.reload();
	badge = modal.listEl.querySelector('.wm-snapshot-entry-status');
	assert(badge.textContent === '출간 완료', 'Project status rename did not propagate to snapshot display');
	await repo.update(entry.id, { stage: '이전 라벨', statusId: '' }); await modal.reload(); await modal.rename();
	editor = globalThis.lastTestModal;
	assert(editor.contentEl.querySelector('select').selectedOptions[0].textContent === '이전 라벨', 'Legacy snapshot label was discarded');
	editor.close(); modal.close(); book.dispose();
	const count = plugin.app.vault.files.size;
	await readProjectStatuses(target, { ...project, rootFolder: 'NoPlotProject' });
	assert(plugin.app.vault.files.size === count, 'Reading fallback statuses created a new plot workbook');
	const hrHost = document.body.createDiv({ cls: 'wm-hr-custom' });
	hrHost.style.cssText = 'font-size:22px;line-height:2.6;';
	const hr = hrHost.createDiv({ cls: 'markdown-rendered' }).createEl('hr');
	document.body.classList.add('is-mobile');
	const line = getComputedStyle(hr, '::before'), box = hr.getBoundingClientRect();
	assert(box.height >= parseFloat(line.lineHeight) && getComputedStyle(hr).overflowY === 'visible', 'Mobile custom divider clips its inherited line height');
	document.body.classList.remove('is-mobile'); hrHost.remove();
	console.info('Snapshot project status IDs, renamed statuses, legacy label retention, centered metadata and read-only status lookup passed');
}
