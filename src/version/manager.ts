import { App, TFile, normalizePath } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { VersionEntry, VersionManifest } from './types';
import { calcVersionCharCount } from './charCount';

export class VersionManager {
	constructor(private app: App, private plugin: WritingMenuPlugin) {}

	private getStorageRoot(): string {
		return normalizePath(this.plugin.settings.versionStoragePath || '.writing-menu-versions');
	}

	private encodeFilePath(filePath: string): string {
		const encoded = encodeURIComponent(filePath);
		if (encoded.length > 200) {
			let hash = 0;
			for (let i = 0; i < filePath.length; i++) {
				hash = ((hash << 5) - hash) + filePath.charCodeAt(i);
				hash |= 0;
			}
			return Math.abs(hash).toString(16).padStart(8, '0');
		}
		return encoded;
	}

	private getFileDir(file: TFile): string {
		return normalizePath(`${this.getStorageRoot()}/${this.encodeFilePath(file.path)}`);
	}

	async getManifest(file: TFile): Promise<VersionManifest> {
		const manifestPath = normalizePath(`${this.getFileDir(file)}/manifest.json`);
		const exists = await this.app.vault.adapter.exists(manifestPath);
		if (!exists) return { filePath: file.path, versions: [] };
		try {
			const raw = await this.app.vault.adapter.read(manifestPath);
			return JSON.parse(raw);
		} catch {
			return { filePath: file.path, versions: [] };
		}
	}

	private async saveManifest(file: TFile, manifest: VersionManifest): Promise<void> {
		const dir = this.getFileDir(file);
		const manifestPath = normalizePath(`${dir}/manifest.json`);
		await this.ensureDir(dir);
		await this.app.vault.adapter.write(manifestPath, JSON.stringify(manifest, null, 2));
	}

	private async ensureDir(dir: string): Promise<void> {
		if (!(await this.app.vault.adapter.exists(dir))) {
			await this.app.vault.adapter.mkdir(dir);
		}
	}

	async saveVersion(file: TFile, name: string, content?: string, description?: string, stage?: import('./types').VersionStage): Promise<VersionEntry> {
		const text = content ?? await this.app.vault.read(file);
		const timestamp = Date.now();
		const slug = name.replace(/[^\w가-힣가-힣]/g, '').slice(0, 20) || String(timestamp);
		const id = `${timestamp}_${slug}`;
		const fileName = `${id}.md`;
		const charCount = calcVersionCharCount(text, 'novelpia');
		const charCountTotal = calcVersionCharCount(text, 'munpia');

		const dir = this.getFileDir(file);
		await this.ensureDir(dir);
		await this.app.vault.adapter.write(normalizePath(`${dir}/${fileName}`), text);

		const manifest = await this.getManifest(file);
		const entry: VersionEntry = { id, name, timestamp, charCount, charCountTotal, fileName, description, stage };
		manifest.versions.unshift(entry);
		manifest.versions = await this.pruneVersions(file, manifest.versions);
		await this.saveManifest(file, manifest);

		return entry;
	}

	private async pruneVersions(file: TFile, versions: VersionEntry[]): Promise<VersionEntry[]> {
		const max = this.plugin.settings.versionMaxCount ?? 50;
		if (versions.length <= max) return versions;
		const toDelete = versions.slice(max);
		const dir = this.getFileDir(file);
		for (const v of toDelete) {
			const p = normalizePath(`${dir}/${v.fileName}`);
			if (await this.app.vault.adapter.exists(p)) {
				await this.app.vault.adapter.remove(p);
			}
		}
		return versions.slice(0, max);
	}

	async readVersion(file: TFile, entry: VersionEntry): Promise<string> {
		const p = normalizePath(`${this.getFileDir(file)}/${entry.fileName}`);
		return await this.app.vault.adapter.read(p);
	}

	async deleteVersion(file: TFile, entry: VersionEntry): Promise<void> {
		const p = normalizePath(`${this.getFileDir(file)}/${entry.fileName}`);
		if (await this.app.vault.adapter.exists(p)) {
			await this.app.vault.adapter.remove(p);
		}
		const manifest = await this.getManifest(file);
		manifest.versions = manifest.versions.filter(v => v.id !== entry.id);
		await this.saveManifest(file, manifest);
	}

	async restoreVersion(file: TFile, entry: VersionEntry, editor: import('obsidian').Editor): Promise<void> {
		const currentContent = editor.getValue();
		await this.saveVersion(file, '복원 전 자동 저장', currentContent);
		const versionContent = await this.readVersion(file, entry);
		editor.setValue(versionContent);
	}

	async migrateCharCounts(file: TFile): Promise<void> {
		const manifest = await this.getManifest(file);
		let changed = false;
		for (const entry of manifest.versions) {
			if (entry.charCountTotal === undefined) {
				try {
					const content = await this.readVersion(file, entry);
					entry.charCount = calcVersionCharCount(content, 'novelpia');
				entry.charCountTotal = calcVersionCharCount(content, 'munpia');
					changed = true;
				} catch {}
			}
		}
		if (changed) await this.saveManifest(file, manifest);
	}

	async updateVersionContent(file: TFile, entryId: string, newContent: string): Promise<void> {
		const manifest = await this.getManifest(file);
		const entry = manifest.versions.find(v => v.id === entryId);
		if (!entry) return;
		const p = normalizePath(`${this.getFileDir(file)}/${entry.fileName}`);
		await this.app.vault.adapter.write(p, newContent);
		entry.charCount = calcVersionCharCount(newContent, 'novelpia');
		entry.charCountTotal = calcVersionCharCount(newContent, 'munpia');
		await this.saveManifest(file, manifest);
	}

	async updateVersion(file: TFile, entryId: string, updates: { name?: string; description?: string; stage?: import('./types').VersionStage | undefined; pinned?: boolean }): Promise<void> {
		const manifest = await this.getManifest(file);
		const entry = manifest.versions.find(v => v.id === entryId);
		if (!entry) return;
		if (updates.name !== undefined) entry.name = updates.name;
		if ('description' in updates) entry.description = updates.description;
		if ('stage' in updates) entry.stage = updates.stage;
		if ('pinned' in updates) entry.pinned = updates.pinned;
		await this.saveManifest(file, manifest);
	}
}
