import { Notice, TFile, TFolder } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { ManuscriptSnapshotRepository, snapshotStorageRoot } from './ManuscriptSnapshotRepository';

export function initializeManuscriptSnapshots(plugin: WritingMenuPlugin): void {
	plugin.registerEvent(plugin.app.vault.on('rename', (file, oldPath) => {
		void (async () => {
			if (file instanceof TFile && file.extension === 'md') {
				await new ManuscriptSnapshotRepository(plugin, oldPath).rebind(file.path); return;
			}
			if (!(file instanceof TFolder)) return;
			let root = snapshotStorageRoot(plugin.settings.snapshotStoragePath);
			if (root === oldPath || root.startsWith(oldPath + '/')) {
				root = snapshotStorageRoot(file.path + root.slice(oldPath.length));
				plugin.settings.snapshotStoragePath = root; await plugin.saveSettings();
			}
			const adapter = plugin.app.vault.adapter;
			if (!await adapter.exists(root)) return;
			const failures: string[] = [];
			for (const directory of (await adapter.list(root)).folders) {
				const path = directory + '/manifest.json';
				if (!await adapter.exists(path)) continue;
				try {
					const manifest = JSON.parse(await adapter.read(path)) as { filePath?: string };
					if (typeof manifest.filePath !== 'string' || !manifest.filePath.startsWith(oldPath + '/')) continue;
					await new ManuscriptSnapshotRepository(plugin, manifest.filePath).rebind(file.path + manifest.filePath.slice(oldPath.length));
				} catch { failures.push(directory); }
			}
			if (failures.length) throw new Error(`${failures.length}개 기록은 기존 위치에 남겨 두었습니다.`);
		})().catch(error => new Notice(`스냅샷 기록 이동을 완료하지 못했습니다. 기록은 보존됩니다: ${error instanceof Error ? error.message : String(error)}`));
	}));
}
