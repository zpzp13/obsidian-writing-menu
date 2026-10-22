import { hasControlCharacters } from '../utils/typeGuards';
import { normalizePath } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { isThemeAwareColor } from '../utils/themeColor';
import {
	PLOT_WORKBOOK_FORMAT_VERSION,
	PLOT_WORKBOOK_MANIFEST_VERSION,
	applyPlotWorkbookOperation,
	clonePlotWorkbookSheet,
	createPlotWorkbookSheet,
	type PlotWorkbookLoadResult,
	type PlotWorkbookManifest,
	type PlotWorkbookOperation,
	type PlotWorkbookCellSnapshot,
	type PlotWorkbookForeshadow,
	type PlotWorkbookForeshadowRegistry,
	type PlotWorkbookSheet,
	type PlotWorkbookSheetRef,
	type PlotWorkbookSnapshotData,
	newPlotWorkbookId,
} from './PlotWorkbookTypes';

const COMPACT_DELAY_MS = 15000;
const MAX_INTERNAL_SNAPSHOTS = 20;

function normalizedProjectRoot(projectRoot: string): string {
	return normalizePath(projectRoot.trim()).replace(/^\/+|\/+$/g, '');
}

export class PlotWorkbookRepository {
	readonly projectRoot: string;
	private readonly rootPath: string;
	private get dataPath(): string { return this.manifest?.storageGeneration ? `${this.rootPath}/generations/${this.manifest.storageGeneration}` : this.rootPath; }
	private get sheetsPath(): string { return `${this.dataPath}/sheets`; }
	private get userSnapshotsPath(): string { return `${this.dataPath}/snapshots`; }
	private manifest: PlotWorkbookManifest | null = null;
	private writeChains = new Map<string, Promise<void>>();
	private compactTimers = new Map<string, number>();
	private compactionQueued = new Set<string>();
	private snapshotSeqs = new Map<string, number>();
	private manifestChain: Promise<void> = Promise.resolve();
	private foreshadowChain: Promise<void> = Promise.resolve();
	private metadataTasks = new Set<Promise<unknown>>();
	private recoveryRequired = false;
	get isRecoveryRequired(): boolean { return this.recoveryRequired; }

	constructor(
		private readonly plugin: WritingMenuPlugin,
		projectRoot: string,
	) {
		this.projectRoot = normalizedProjectRoot(projectRoot);
		this.rootPath = normalizePath(this.projectRoot ? `${this.projectRoot}/.writing-menu/plot` : '.writing-menu/plot');
	}

	/** Registration IDs can differ across devices; the bound storage folder cannot. */
	isForProjectRoot(projectRoot: string): boolean {
		return this.projectRoot === normalizedProjectRoot(projectRoot);
	}

	async loadOrCreate(projectId: string, projectName: string): Promise<PlotWorkbookLoadResult> {
		const warnings: string[] = [];
		let manifest = await this.readManifest(warnings);
		this.manifest = manifest;
		await this.ensureDirectory(this.sheetsPath);
		const foreshadows = await this.readForeshadows(warnings);

		if (!manifest) {
			const first = createPlotWorkbookSheet('시트 1');
			manifest = {
				formatVersion: PLOT_WORKBOOK_FORMAT_VERSION,
				projectId,
				projectName,
				activeSheetId: first.sheetId,
				sheets: [{ id: first.sheetId, name: first.name }],
			};
			this.manifest = manifest;
			await this.ensureDirectory(this.sheetPath(first.sheetId));
			await this.writeSnapshot(first);
			await this.saveManifest(manifest);
			return { manifest, sheets: new Map([[first.sheetId, first]]), foreshadows, warnings };
		}

		if (manifest.formatVersion > PLOT_WORKBOOK_MANIFEST_VERSION) {
			throw new Error(`이 플롯 워크북은 더 새로운 형식(${manifest.formatVersion})으로 저장되어 있습니다.`);
		}

		this.manifest = manifest;
		const sheets = new Map<string, PlotWorkbookSheet>();
		const allRefs = [...manifest.sheets, ...(manifest.deletedSheets ?? [])];
		for (const ref of allRefs) {
			const loaded = await this.loadSheet(ref, warnings);
			sheets.set(ref.id, loaded);
		}

		if (manifest.sheets.length === 0) {
			const first = createPlotWorkbookSheet('시트 1');
			manifest.sheets = [{ id: first.sheetId, name: first.name }];
			manifest.activeSheetId = first.sheetId;
			sheets.set(first.sheetId, first);
			await this.ensureDirectory(this.sheetPath(first.sheetId));
			await this.writeSnapshot(first);
			await this.saveManifest(manifest);
		}

		if (!sheets.has(manifest.activeSheetId)) {
			manifest.activeSheetId = manifest.sheets[0].id;
			await this.saveManifest(manifest);
		}

		return { manifest, sheets, foreshadows, warnings };
	}

	async createSheet(name: string): Promise<PlotWorkbookSheet> {
		return this.trackMetadata(() => this.createSheetData(name));
	}

	private async createSheetData(name: string): Promise<PlotWorkbookSheet> {
		if (!this.manifest) throw new Error('플롯 워크북이 아직 열리지 않았습니다.');
		const sheet = createPlotWorkbookSheet(name);
		this.manifest.sheets.push({ id: sheet.sheetId, name: sheet.name });
		this.manifest.activeSheetId = sheet.sheetId;
		await this.ensureDirectory(this.sheetPath(sheet.sheetId));
		await this.writeSnapshot(sheet);
		await this.saveManifest(this.manifest);
		return sheet;
	}

	async importLegacySheet(
		sheet: PlotWorkbookSheet,
		sourcePath: string,
	): Promise<{ imported: boolean; sheetId: string }> {
		if (!this.manifest) throw new Error('플롯 워크북이 아직 열리지 않았습니다.');
		const normalizedSource = normalizePath(sourcePath).replace(/\/$/, '');
		const previous = this.manifest.legacyImports?.find(item => item.sourcePath === normalizedSource);
		if (previous && this.manifest.sheets.some(item => item.id === previous.sheetId)) {
			return { imported: false, sheetId: previous.sheetId };
		}

		const usedNames = new Set(this.manifest.sheets.map(item => item.name));
		const baseName = sheet.name.trim() || '기존 플롯';
		let name = baseName;
		let suffix = 2;
		while (usedNames.has(name)) name = `${baseName} ${suffix++}`;
		sheet.name = name;

		await this.ensureDirectory(this.sheetPath(sheet.sheetId));
		await this.writeSnapshot(sheet);
		this.snapshotSeqs.set(sheet.sheetId, sheet.lastSeq);
		this.manifest.sheets.push({ id: sheet.sheetId, name });
		this.manifest.activeSheetId = sheet.sheetId;
		this.manifest.legacyImports = [
			...(this.manifest.legacyImports ?? []).filter(item => item.sourcePath !== normalizedSource),
			{ sourcePath: normalizedSource, importedAt: Date.now(), sheetId: sheet.sheetId },
		];
		await this.saveManifest(this.manifest);
		return { imported: true, sheetId: sheet.sheetId };
	}

	setActiveSheet(sheetId: string): Promise<void> {
		if (!this.manifest || !this.manifest.sheets.some(sheet => sheet.id === sheetId)) return Promise.resolve();
		this.manifest.activeSheetId = sheetId;
		return this.saveManifest(this.manifest);
	}

	saveManifestState(): Promise<void> {
		if (!this.manifest) return Promise.resolve();
		return this.saveManifest(this.manifest);
	}

	adoptManifest(manifest: PlotWorkbookManifest): void { this.manifest = manifest; }

	async saveTransferBackup(id: string, markdown: string): Promise<string> {
		if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error('백업 ID가 올바르지 않습니다.');
		const directory = `${this.rootPath}/transfer-backups`;
		await this.ensureDirectory(directory);
		const path = `${directory}/${id}.md`;
		if (await this.plugin.app.vault.adapter.exists(path)) throw new Error('백업 파일이 이미 있습니다.');
		await this.plugin.app.vault.adapter.write(path, markdown);
		if (await this.plugin.app.vault.adapter.read(path) !== markdown) throw new Error('교체 전 백업 검증에 실패하여 가져오기를 중단했습니다.');
		return path;
	}

	validateSnapshotData(data: PlotWorkbookSnapshotData): void {
		if (!data || typeof data !== 'object') throw new Error('스냅샷 데이터가 없습니다.');
		this.validateManifest(data.manifest);
		if (typeof data.manifest.projectId !== 'string' || !data.manifest.projectId || typeof data.manifest.projectName !== 'string') throw new Error('프로젝트 정보가 올바르지 않습니다.');
		if (data.manifest.formatVersion > PLOT_WORKBOOK_MANIFEST_VERSION || !data.manifest.sheets.length) throw new Error('지원하지 않거나 비어 있는 워크북입니다.');
		const refs = [...data.manifest.sheets, ...(data.manifest.deletedSheets ?? [])];
		if (!Array.isArray(data.sheets) || data.sheets.length !== refs.length) throw new Error('스냅샷의 시트 수가 목록과 다릅니다.');
		const safeId = (id: string) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
		const safeNotePath = (path: string | undefined) => path === undefined || (typeof path === 'string'
			&& !/^[\\/]|^[a-z]:/i.test(path) && !hasControlCharacters(path) && !path.replace(/\\/g, '/').split('/').some(part => part === '..' || part === '.'));
		const seen = new Set<string>();
		for (const sheet of data.sheets) {
			if (!safeId(sheet?.sheetId) || seen.has(sheet.sheetId) || !refs.some(ref => ref.id === sheet.sheetId && ref.name === sheet.name)) throw new Error('시트 ID 또는 이름이 올바르지 않습니다.');
			seen.add(sheet.sheetId);
			this.validateSheet(sheet, sheet.sheetId);
			if (sheet.formatVersion !== PLOT_WORKBOOK_FORMAT_VERSION || !Number.isInteger(sheet.lastSeq) || sheet.lastSeq < 0
				|| !Number.isInteger(sheet.revision) || sheet.revision < 0 || typeof sheet.name !== 'string') throw new Error('시트 형식 정보가 올바르지 않습니다.');
			if (sheet.rowOrder.some(id => !safeId(id) || sheet.rows[id].id !== id)
				|| sheet.columnOrder.some(id => !safeId(id) || sheet.columns[id].id !== id)) throw new Error('행·열 ID가 올바르지 않습니다.');
			if (Array.isArray(sheet.rows) || Array.isArray(sheet.columns) || Array.isArray(sheet.cells)) throw new Error('행·열·셀 목록 형식이 올바르지 않습니다.');
			for (const row of Object.values(sheet.rows)) {
				if (!safeNotePath(row.linkedNotePath) || (row.height !== undefined && (!Number.isFinite(row.height) || row.height <= 0))
					|| (row.depth !== undefined && (!Number.isInteger(row.depth) || row.depth < 0))
					|| (row.collapsed !== undefined && typeof row.collapsed !== 'boolean')
					|| (row.parentRowId !== undefined && (!safeId(row.parentRowId) || !sheet.rows[row.parentRowId]))) throw new Error('행 정보 또는 본문 경로가 올바르지 않습니다.');
			}
			const visited = new Set<string>();
			for (const id of sheet.rowOrder) {
				const chain = new Set<string>();
				let current: string | undefined = id;
				while (current && !visited.has(current)) {
					if (chain.has(current)) throw new Error('세부행의 부모 관계가 순환합니다.');
					chain.add(current); current = sheet.rows[current]?.parentRowId;
				}
				for (const rowId of chain) visited.add(rowId);
			}
			for (const column of Object.values(sheet.columns)) {
				if (!safeNotePath(column.characterNotePath) || (column.title !== undefined && typeof column.title !== 'string')
					|| (column.width !== undefined && (!Number.isFinite(column.width) || column.width <= 0))
					|| (column.collapsed !== undefined && typeof column.collapsed !== 'boolean')) throw new Error('열 정보 또는 인물 경로가 올바르지 않습니다.');
			}
		}
		if (!data.manifest.sheets.some(ref => ref.id === data.manifest.activeSheetId)) throw new Error('활성 시트가 목록에 없습니다.');
		this.validateForeshadowRegistry({ formatVersion: 1, items: data.foreshadows });
		if (!Array.isArray(data.cellSnapshots)) throw new Error('셀 스냅샷 목록이 없습니다.');
		const snapshotIds = new Set<string>();
		for (const snapshot of data.cellSnapshots) {
			this.validateCellSnapshot(snapshot);
			if (!safeId(snapshot.id) || snapshotIds.has(snapshot.id)) throw new Error('셀 스냅샷 ID가 올바르지 않습니다.');
			snapshotIds.add(snapshot.id);
			const ref = data.manifest.snapshots?.find(item => item.id === snapshot.id);
			if (!ref || ref.sheetId !== snapshot.sheetId || ref.rowId !== snapshot.rowId || ref.columnId !== snapshot.columnId
				|| ref.createdAt !== snapshot.createdAt || ref.title !== snapshot.title) throw new Error('셀 스냅샷의 참조 정보가 다릅니다.');
		}
		if (snapshotIds.size !== (data.manifest.snapshots?.length ?? 0)) throw new Error('셀 스냅샷이 누락되었습니다.');
	}

	/** The caller owns an exclusive session lock. Existing generations are never removed. */
	async restoreSnapshot(data: PlotWorkbookSnapshotData): Promise<void> {
		this.validateSnapshotData(data);
		const manifest = data.manifest;
		// Old plugins must refuse this manifest instead of reopening stale v1 files.
		manifest.formatVersion = PLOT_WORKBOOK_MANIFEST_VERSION;
		manifest.storageGeneration = newPlotWorkbookId('restore');
		const path = `${this.rootPath}/generations/${manifest.storageGeneration}`;
		if (await this.plugin.app.vault.adapter.exists(path)) throw new Error('이미 사용 중인 저장 세대입니다. 다시 시도해주세요.');
		const writeVerified = async (file: string, value: unknown) => {
			const serialized = `${JSON.stringify(value, null, 2)}\n`;
			await this.plugin.app.vault.adapter.write(file, serialized);
			if (await this.plugin.app.vault.adapter.read(file) !== serialized) throw new Error('스냅샷 저장 검증에 실패했습니다. 기존 플롯은 유지합니다.');
		};
		await this.ensureDirectory(`${path}/sheets`);
		await this.ensureDirectory(`${path}/snapshots`);
		for (const sheet of data.sheets) {
			await this.ensureDirectory(`${path}/sheets/${sheet.sheetId}`);
			sheet.revision = Math.max(1, sheet.revision);
			await writeVerified(`${path}/sheets/${sheet.sheetId}/snapshot-${String(sheet.revision).padStart(8, '0')}.json`, sheet);
		}
		for (const snapshot of data.cellSnapshots) await writeVerified(`${path}/snapshots/${snapshot.id}.json`, snapshot);
		await writeVerified(`${path}/foreshadows.json`, { formatVersion: 1, items: data.foreshadows });
		// All payload files exist and were read back before the only live pointer changes.
		const previous = this.manifest ? `${JSON.stringify(this.manifest, null, 2)}\n` : null;
		try { await this.saveManifest(manifest); }
		catch (error) {
			const adapter = this.plugin.app.vault.adapter;
			try {
				const current = await adapter.read(this.manifestPath());
				if (current !== `${JSON.stringify(manifest, null, 2)}\n`) {
					if (previous !== null && current !== previous) {
						await adapter.write(this.manifestPath(), previous);
						if (await adapter.read(this.manifestPath()) !== previous) throw new Error('이전 목록 복구 검증에 실패했습니다.');
					}
					throw error;
				}
				// A complete verified pointer is committed even if an adapter
				// reports a late error. Keep memory aligned with the disk.
			} catch (recoveryError) {
				const current = await adapter.read(this.manifestPath()).catch(() => '');
				this.recoveryRequired = previous !== null && current !== previous;
				if (!this.recoveryRequired) this.manifestChain = Promise.resolve();
				throw recoveryError;
			}
		}
		this.manifestChain = Promise.resolve();
		this.manifest = manifest;
		this.snapshotSeqs.clear();
		for (const sheet of data.sheets) this.snapshotSeqs.set(sheet.sheetId, sheet.lastSeq);
	}

	/** Settings read metadata only: no new workbook, sheet loading or compaction. */
	async loadExistingManifest(): Promise<PlotWorkbookManifest | null> {
		const warnings: string[] = [];
		const manifest = await this.readManifest(warnings);
		if (warnings.length) throw new Error(warnings.join('\n'));
		if (manifest && manifest.formatVersion > PLOT_WORKBOOK_MANIFEST_VERSION) throw new Error('더 새로운 워크북 형식입니다.');
		this.manifest = manifest;
		return manifest;
	}

	/** Chat/search must never create directories, repair, migrate or compact project data. */
	async readExistingWorkbook(): Promise<PlotWorkbookLoadResult | null> {
		const manifest = await this.loadExistingManifest();
		if (!manifest) return null;
		const warnings: string[] = [], sheets = new Map<string, PlotWorkbookSheet>();
		for (const ref of manifest.sheets) {
			if (!/^[a-zA-Z0-9_-]{1,160}$/.test(ref.id) || ['__proto__', 'constructor', 'prototype'].includes(ref.id)) throw new Error('조회할 플롯 시트 ID가 올바르지 않습니다.');
			sheets.set(ref.id, await this.loadSheet(ref, warnings, true));
		}
		const foreshadows = await this.readForeshadows(warnings);
		if (warnings.length) throw new Error(warnings.join('\n'));
		const latest = await this.loadExistingManifest();
		if (JSON.stringify(latest) !== JSON.stringify(manifest)) throw new Error('조회 중 플롯 목록이 바뀌었습니다. 다시 질문해 주세요.');
		return { manifest, sheets, foreshadows, warnings };
	}

	saveForeshadowsState(items: PlotWorkbookForeshadow[]): Promise<void> {
		const registry: PlotWorkbookForeshadowRegistry = {
			formatVersion: 1,
			items: JSON.parse(JSON.stringify(items)) as PlotWorkbookForeshadow[],
		};
		this.foreshadowChain = this.foreshadowChain.catch(() => undefined).then(async () => {
			this.validateForeshadowRegistry(registry);
			await this.ensureDirectory(this.rootPath);
			const path = this.foreshadowsPath();
			if (await this.plugin.app.vault.adapter.exists(path)) {
				const previous = await this.plugin.app.vault.adapter.read(path);
				await this.plugin.app.vault.adapter.write(this.foreshadowsBackupPath(), previous);
			}
			const serialized = `${JSON.stringify(registry, null, 2)}\n`;
			if (await this.plugin.app.vault.adapter.exists(path)) {
				await this.plugin.app.vault.adapter.process(path, () => serialized);
			} else {
				await this.plugin.app.vault.adapter.write(path, serialized);
			}
			this.validateForeshadowRegistry(
				JSON.parse(await this.plugin.app.vault.adapter.read(path)) as PlotWorkbookForeshadowRegistry,
			);
		});
		return this.foreshadowChain;
	}

	async createCellSnapshot(snapshot: PlotWorkbookCellSnapshot): Promise<void> {
		return this.trackMetadata(() => this.createCellSnapshotData(snapshot));
	}

	private async createCellSnapshotData(snapshot: PlotWorkbookCellSnapshot): Promise<void> {
		if (!this.manifest) throw new Error('플롯 워크북이 아직 열리지 않았습니다.');
		await this.ensureDirectory(this.userSnapshotsPath);
		const path = this.userSnapshotPath(snapshot.id);
		const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
		await this.plugin.app.vault.adapter.write(path, serialized);
		const verified = JSON.parse(await this.plugin.app.vault.adapter.read(path)) as PlotWorkbookCellSnapshot;
		this.validateCellSnapshot(verified);
		(this.manifest.snapshots ?? (this.manifest.snapshots = [])).push({
			id: snapshot.id,
			sheetId: snapshot.sheetId,
			rowId: snapshot.rowId,
			columnId: snapshot.columnId,
			title: snapshot.title,
			createdAt: snapshot.createdAt,
		});
		await this.saveManifest(this.manifest);
	}

	async readCellSnapshot(snapshotId: string): Promise<PlotWorkbookCellSnapshot | null> {
		const path = this.userSnapshotPath(snapshotId);
		if (!(await this.plugin.app.vault.adapter.exists(path))) return null;
		const snapshot = JSON.parse(await this.plugin.app.vault.adapter.read(path)) as PlotWorkbookCellSnapshot;
		this.validateCellSnapshot(snapshot);
		return snapshot;
	}

	async renameCellSnapshot(snapshotId: string, title: string): Promise<void> {
		return this.trackMetadata(() => this.renameCellSnapshotData(snapshotId, title));
	}

	private async renameCellSnapshotData(snapshotId: string, title: string): Promise<void> {
		if (!this.manifest) return;
		const cleanTitle = title.trim();
		if (!cleanTitle) return;
		const snapshot = await this.readCellSnapshot(snapshotId);
		if (!snapshot) return;
		snapshot.title = cleanTitle;
		const path = this.userSnapshotPath(snapshotId);
		await this.plugin.app.vault.adapter.write(path, `${JSON.stringify(snapshot, null, 2)}\n`);
		const ref = (this.manifest.snapshots ?? []).find(item => item.id === snapshotId);
		if (ref) ref.title = cleanTitle;
		await this.saveManifest(this.manifest);
	}

	async deleteCellSnapshot(snapshotId: string): Promise<void> {
		return this.trackMetadata(() => this.deleteCellSnapshotData(snapshotId));
	}

	private async deleteCellSnapshotData(snapshotId: string): Promise<void> {
		if (!this.manifest) return;
		this.manifest.snapshots = (this.manifest.snapshots ?? []).filter(item => item.id !== snapshotId);
		await this.saveManifest(this.manifest);
		const path = this.userSnapshotPath(snapshotId);
		if (await this.plugin.app.vault.adapter.exists(path)) await this.plugin.app.vault.adapter.remove(path);
	}

	async deleteSheetStorage(sheetId: string, userSnapshotIds: string[]): Promise<void> {
		const timer = this.compactTimers.get(sheetId);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			this.compactTimers.delete(sheetId);
		}
		await this.waitForSheet(sheetId);
		this.compactionQueued.delete(sheetId);
		this.snapshotSeqs.delete(sheetId);
		for (const snapshotId of userSnapshotIds) {
			const snapshotPath = this.userSnapshotPath(snapshotId);
			if (await this.plugin.app.vault.adapter.exists(snapshotPath)) {
				await this.plugin.app.vault.adapter.remove(snapshotPath);
			}
		}
		const path = this.sheetPath(sheetId);
		if (await this.plugin.app.vault.adapter.exists(path)) {
			await this.plugin.app.vault.adapter.rmdir(path, true);
		}
	}

	recordOperation(sheet: PlotWorkbookSheet, operation: PlotWorkbookOperation): void {
		const path = this.journalPath(sheet.sheetId);
		this.enqueue(sheet.sheetId, async () => {
			await this.ensureDirectory(this.sheetPath(sheet.sheetId));
			if (!(await this.plugin.app.vault.adapter.exists(path))) {
				await this.plugin.app.vault.adapter.write(path, '');
			}
			await this.plugin.app.vault.adapter.append(path, `${JSON.stringify(operation)}\n`);
		});
		this.scheduleCompaction(sheet);
	}

	async flushSheet(sheet: PlotWorkbookSheet): Promise<void> {
		const timer = this.compactTimers.get(sheet.sheetId);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			this.compactTimers.delete(sheet.sheetId);
		}
		if ((this.snapshotSeqs.get(sheet.sheetId) ?? -1) < sheet.lastSeq) this.queueCompaction(sheet);
		await this.waitForSheet(sheet.sheetId);
	}

	async flushAll(sheets: Iterable<PlotWorkbookSheet>): Promise<void> {
		while (this.metadataTasks.size) await Promise.all(this.metadataTasks);
		for (const sheet of sheets) await this.flushSheet(sheet);
		await this.manifestChain;
		await this.foreshadowChain;
	}

	private async trackMetadata<T>(action: () => Promise<T>): Promise<T> {
		const task = action();
		this.metadataTasks.add(task);
		try { return await task; } finally { this.metadataTasks.delete(task); }
	}

	dispose(): void {
		for (const timer of this.compactTimers.values()) window.clearTimeout(timer);
		this.compactTimers.clear();
	}

	private async readForeshadows(warnings: string[]): Promise<PlotWorkbookForeshadow[]> {
		for (const path of [this.foreshadowsPath(), this.foreshadowsBackupPath()]) {
			if (!(await this.plugin.app.vault.adapter.exists(path))) continue;
			try {
				const registry = JSON.parse(await this.plugin.app.vault.adapter.read(path)) as PlotWorkbookForeshadowRegistry;
				this.validateForeshadowRegistry(registry);
				if (path === this.foreshadowsBackupPath()) warnings.push('복선 목록의 이전 백업본을 복구해 열었습니다.');
				return registry.items;
			} catch (error) {
				warnings.push(`${path}을(를) 읽지 못했습니다: ${this.errorMessage(error)}`);
			}
		}
		return [];
	}

	private async readManifest(warnings: string[]): Promise<PlotWorkbookManifest | null> {
		for (const path of [this.manifestPath(), this.manifestBackupPath()]) {
			if (!(await this.plugin.app.vault.adapter.exists(path))) continue;
			try {
				const parsed = JSON.parse(await this.plugin.app.vault.adapter.read(path)) as PlotWorkbookManifest;
				this.validateManifest(parsed);
				if (path === this.manifestBackupPath()) warnings.push('워크북 목록의 이전 백업본을 복구해 열었습니다.');
				return parsed;
			} catch (error) {
				warnings.push(`${path}을(를) 읽지 못했습니다: ${this.errorMessage(error)}`);
			}
		}
		return null;
	}

	private async loadSheet(ref: PlotWorkbookSheetRef, warnings: string[], readOnly = false): Promise<PlotWorkbookSheet> {
		if (!readOnly) await this.ensureDirectory(this.sheetPath(ref.id));
		const listed = await this.plugin.app.vault.adapter.list(this.sheetPath(ref.id));
		const snapshots = listed.files
			.map(path => ({ path, revision: this.snapshotRevision(path) }))
			.filter((item): item is { path: string; revision: number } => item.revision !== null)
			.sort((left, right) => right.revision - left.revision);

		let sheet: PlotWorkbookSheet | null = null;
		for (const candidate of snapshots) {
			try {
				const parsed = JSON.parse(await this.plugin.app.vault.adapter.read(candidate.path)) as PlotWorkbookSheet;
				this.validateSheet(parsed, ref.id);
				sheet = parsed;
				break;
			} catch (error) {
				warnings.push(`${candidate.path}을(를) 건너뛰었습니다: ${this.errorMessage(error)}`);
			}
		}

		if (!sheet) {
			if (readOnly) throw new Error(`“${ref.name}”의 유효한 플롯 데이터를 읽지 못했습니다. 원본은 변경하지 않았습니다.`);
			sheet = createPlotWorkbookSheet(ref.name);
			sheet.sheetId = ref.id;
			warnings.push(`“${ref.name}”의 유효한 스냅샷이 없어 빈 시트로 복구했습니다.`);
		}
		sheet.name = ref.name;
		this.snapshotSeqs.set(ref.id, sheet.lastSeq);

		const journalPath = this.journalPath(ref.id);
		if (await this.plugin.app.vault.adapter.exists(journalPath)) {
			const lines = (await this.plugin.app.vault.adapter.read(journalPath)).split(/\r?\n/);
			for (let index = 0; index < lines.length; index++) {
				const line = lines[index].trim();
				if (!line) continue;
				try {
					const operation = JSON.parse(line) as PlotWorkbookOperation;
					this.validateOperation(operation, ref.id);
					if (operation.seq <= sheet.lastSeq) continue;
					if (operation.seq !== sheet.lastSeq + 1) {
						throw new Error(`변경 순번 ${sheet.lastSeq + 1}이(가) 누락되었습니다.`);
					}
					applyPlotWorkbookOperation(sheet, operation);
				} catch (error) {
					warnings.push(`${journalPath} ${index + 1}번째 변경부터 복구를 중단했습니다: ${this.errorMessage(error)}`);
					break;
				}
			}
		}

		return sheet;
	}

	private scheduleCompaction(sheet: PlotWorkbookSheet): void {
		const old = this.compactTimers.get(sheet.sheetId);
		if (old !== undefined) window.clearTimeout(old);
		const timer = window.setTimeout(() => {
			this.compactTimers.delete(sheet.sheetId);
			this.queueCompaction(sheet);
		}, COMPACT_DELAY_MS);
		this.compactTimers.set(sheet.sheetId, timer);
	}

	private queueCompaction(sheet: PlotWorkbookSheet): void {
		if (this.compactionQueued.has(sheet.sheetId)) return;
		if ((this.snapshotSeqs.get(sheet.sheetId) ?? -1) >= sheet.lastSeq) return;
		this.compactionQueued.add(sheet.sheetId);
		const snapshot = clonePlotWorkbookSheet(sheet);
		const targetSeq = snapshot.lastSeq;

		this.enqueue(sheet.sheetId, async () => {
			try {
				await this.writeSnapshot(snapshot);
				sheet.revision = Math.max(sheet.revision, snapshot.revision);
				await this.trimJournal(sheet.sheetId, targetSeq);
			} finally {
				this.compactionQueued.delete(sheet.sheetId);
				if (sheet.lastSeq > targetSeq) this.scheduleCompaction(sheet);
			}
		});
	}

	private async writeSnapshot(sheet: PlotWorkbookSheet): Promise<void> {
		await this.ensureDirectory(this.sheetPath(sheet.sheetId));
		let revision = Math.max(1, sheet.revision + 1);
		let path = this.snapshotPath(sheet.sheetId, revision);
		while (await this.plugin.app.vault.adapter.exists(path)) {
			revision++;
			path = this.snapshotPath(sheet.sheetId, revision);
		}

		const copy = clonePlotWorkbookSheet(sheet);
		copy.revision = revision;
		const serialized = `${JSON.stringify(copy, null, 2)}\n`;
		await this.plugin.app.vault.adapter.write(path, serialized);
		const verified = JSON.parse(await this.plugin.app.vault.adapter.read(path)) as PlotWorkbookSheet;
		this.validateSheet(verified, sheet.sheetId);
		if (verified.revision !== revision || verified.lastSeq !== copy.lastSeq) {
			throw new Error('작성한 스냅샷의 리비전 검증에 실패했습니다.');
		}
		sheet.revision = revision;
		this.snapshotSeqs.set(sheet.sheetId, copy.lastSeq);
		await this.pruneSnapshots(sheet.sheetId);
	}

	private async pruneSnapshots(sheetId: string): Promise<void> {
		const listed = await this.plugin.app.vault.adapter.list(this.sheetPath(sheetId));
		const snapshots = listed.files
			.map(path => ({ path, revision: this.snapshotRevision(path) }))
			.filter((item): item is { path: string; revision: number } => item.revision !== null)
			.sort((left, right) => right.revision - left.revision);
		for (const stale of snapshots.slice(MAX_INTERNAL_SNAPSHOTS)) {
			await this.plugin.app.vault.adapter.remove(stale.path);
		}
	}

	private async trimJournal(sheetId: string, throughSeq: number): Promise<void> {
		const path = this.journalPath(sheetId);
		if (!(await this.plugin.app.vault.adapter.exists(path))) return;
		const raw = await this.plugin.app.vault.adapter.read(path);
		const keep: string[] = [];
		for (const source of raw.split(/\r?\n/)) {
			const line = source.trim();
			if (!line) continue;
			try {
				const operation = JSON.parse(line) as PlotWorkbookOperation;
				if (operation.seq > throughSeq) keep.push(JSON.stringify(operation));
			} catch {
				keep.push(source);
			}
		}
		await this.plugin.app.vault.adapter.write(path, keep.length ? `${keep.join('\n')}\n` : '');
	}

	private saveManifest(manifest: PlotWorkbookManifest): Promise<void> {
		const copy = JSON.parse(JSON.stringify(manifest)) as PlotWorkbookManifest;
		this.manifestChain = this.manifestChain.catch(() => undefined).then(async () => {
			this.validateManifest(copy);
			await this.ensureDirectory(this.rootPath);
			const path = this.manifestPath();
			if (await this.plugin.app.vault.adapter.exists(path)) {
				const previous = await this.plugin.app.vault.adapter.read(path);
				await this.plugin.app.vault.adapter.write(this.manifestBackupPath(), previous);
			}
			const serialized = `${JSON.stringify(copy, null, 2)}\n`;
			if (await this.plugin.app.vault.adapter.exists(path)) {
				await this.plugin.app.vault.adapter.process(path, () => serialized);
			} else {
				await this.plugin.app.vault.adapter.write(path, serialized);
			}
			this.validateManifest(JSON.parse(await this.plugin.app.vault.adapter.read(path)) as PlotWorkbookManifest);
		});
		return this.manifestChain;
	}

	private enqueue(sheetId: string, task: () => Promise<void>): void {
		const previous = this.writeChains.get(sheetId) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(task);
		this.writeChains.set(sheetId, next);
		void next.then(
			() => {
				if (this.writeChains.get(sheetId) === next) this.writeChains.delete(sheetId);
			},
			() => {
				if (this.writeChains.get(sheetId) === next) this.writeChains.delete(sheetId);
			},
		);
	}

	private async waitForSheet(sheetId: string): Promise<void> {
		for (;;) {
			const pending = this.writeChains.get(sheetId);
			if (!pending) return;
			await pending;
		}
	}

	private validateManifest(manifest: PlotWorkbookManifest): void {
		if (!manifest || typeof manifest !== 'object') throw new Error('워크북 목록이 객체가 아닙니다.');
		if (manifest.storageGeneration !== undefined && !/^[a-zA-Z0-9_-]{1,160}$/.test(manifest.storageGeneration)) throw new Error('저장 세대 경로가 올바르지 않습니다.');
		if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion < 1) throw new Error('워크북 형식 버전이 없습니다.');
		if (!Array.isArray(manifest.sheets)) throw new Error('시트 목록이 없습니다.');
		const ids = new Set<string>();
		for (const sheet of [...manifest.sheets, ...(manifest.deletedSheets ?? [])]) {
			if (!sheet || typeof sheet.id !== 'string' || !sheet.id || typeof sheet.name !== 'string') throw new Error('잘못된 시트 항목이 있습니다.');
			if (ids.has(sheet.id)) throw new Error(`시트 ID가 중복되었습니다: ${sheet.id}`);
			ids.add(sheet.id);
		}
		if (manifest.labels !== undefined) {
			if (!Array.isArray(manifest.labels)) throw new Error('라벨 목록이 올바르지 않습니다.');
			const labelIds = new Set<string>();
			for (const label of manifest.labels) {
				if (!label || typeof label.id !== 'string' || !label.id
					|| typeof label.name !== 'string' || !label.name.trim()
					|| typeof label.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(label.color)) {
					throw new Error('라벨 정보가 올바르지 않습니다.');
				}
				if (labelIds.has(label.id)) throw new Error(`라벨 ID가 중복되었습니다: ${label.id}`);
				labelIds.add(label.id);
			}
		}
		if (manifest.statuses !== undefined) {
			if (!Array.isArray(manifest.statuses)) throw new Error('상태 목록이 올바르지 않습니다.');
			const statusIds = new Set<string>();
			for (const status of manifest.statuses) {
				if (!status || typeof status.id !== 'string' || !status.id
					|| typeof status.name !== 'string' || !status.name.trim()
					|| (status.color !== undefined && (typeof status.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(status.color)))
					|| (status.hidden !== undefined && typeof status.hidden !== 'boolean')) {
					throw new Error('상태 정보가 올바르지 않습니다.');
				}
				if (statusIds.has(status.id)) throw new Error(`상태 ID가 중복되었습니다: ${status.id}`);
				statusIds.add(status.id);
			}
		}
		if (manifest.snapshots !== undefined) {
			if (!Array.isArray(manifest.snapshots)) throw new Error('사용자 스냅샷 목록이 올바르지 않습니다.');
			const snapshotIds = new Set<string>();
			for (const snapshot of manifest.snapshots) {
				if (!snapshot || typeof snapshot.id !== 'string' || !snapshot.id
					|| typeof snapshot.sheetId !== 'string' || !snapshot.sheetId
					|| typeof snapshot.rowId !== 'string' || !snapshot.rowId
					|| typeof snapshot.columnId !== 'string' || !snapshot.columnId
					|| typeof snapshot.title !== 'string' || !Number.isFinite(snapshot.createdAt)) {
					throw new Error('사용자 스냅샷 정보가 올바르지 않습니다.');
				}
				if (snapshotIds.has(snapshot.id)) throw new Error(`스냅샷 ID가 중복되었습니다: ${snapshot.id}`);
				snapshotIds.add(snapshot.id);
			}
		}
		if (manifest.legacyImports !== undefined) {
			if (!Array.isArray(manifest.legacyImports)) throw new Error('기존 플롯 가져오기 기록이 올바르지 않습니다.');
			for (const item of manifest.legacyImports) {
				if (!item || typeof item.sourcePath !== 'string' || !item.sourcePath
					|| typeof item.sheetId !== 'string' || !item.sheetId
					|| !Number.isFinite(item.importedAt)) {
					throw new Error('기존 플롯 가져오기 기록이 올바르지 않습니다.');
				}
			}
		}
	}

	private validateForeshadowRegistry(registry: PlotWorkbookForeshadowRegistry): void {
		if (!registry || typeof registry !== 'object' || registry.formatVersion !== 1 || !Array.isArray(registry.items)) {
			throw new Error('복선 목록이 올바르지 않습니다.');
		}
		const foreshadowIds = new Set<string>();
		for (const foreshadow of registry.items) {
			if (!foreshadow || typeof foreshadow.id !== 'string' || !foreshadow.id
				|| typeof foreshadow.title !== 'string' || !foreshadow.title.trim()
				|| (foreshadow.note !== undefined && typeof foreshadow.note !== 'string')
				|| !['open', 'resolved'].includes(foreshadow.status)
				|| !Array.isArray(foreshadow.plantedAt) || !Array.isArray(foreshadow.resolvedAt)
				|| !Number.isFinite(foreshadow.createdAt) || !Number.isFinite(foreshadow.updatedAt)) {
				throw new Error('복선 정보가 올바르지 않습니다.');
			}
			for (const location of [...foreshadow.plantedAt, ...foreshadow.resolvedAt]) {
				if (!location || typeof location.sheetId !== 'string' || !location.sheetId
					|| typeof location.rowId !== 'string' || !location.rowId
					|| typeof location.columnId !== 'string' || !location.columnId) {
					throw new Error('복선 위치 정보가 올바르지 않습니다.');
				}
			}
			if (foreshadowIds.has(foreshadow.id)) throw new Error(`복선 ID가 중복되었습니다: ${foreshadow.id}`);
			foreshadowIds.add(foreshadow.id);
		}
	}

	private validateSheet(sheet: PlotWorkbookSheet, expectedId: string): void {
		if (!sheet || typeof sheet !== 'object') throw new Error('시트가 객체가 아닙니다.');
		if (sheet.formatVersion > PLOT_WORKBOOK_FORMAT_VERSION) throw new Error(`더 새로운 시트 형식입니다: ${sheet.formatVersion}`);
		if (sheet.sheetId !== expectedId) throw new Error('시트 ID가 목록과 일치하지 않습니다.');
		if (!Array.isArray(sheet.rowOrder) || !Array.isArray(sheet.columnOrder)) throw new Error('행 또는 열 목록이 없습니다.');
		if (!sheet.rows || !sheet.columns || !sheet.cells) throw new Error('시트 데이터가 완전하지 않습니다.');
		if (new Set(sheet.rowOrder).size !== sheet.rowOrder.length) throw new Error('행 ID가 중복되었습니다.');
		if (new Set(sheet.columnOrder).size !== sheet.columnOrder.length) throw new Error('열 ID가 중복되었습니다.');
		for (const id of sheet.rowOrder) {
			if (!sheet.rows[id]) throw new Error(`행 정보가 없습니다: ${id}`);
			if (sheet.rows[id].linkedNotePath !== undefined && typeof sheet.rows[id].linkedNotePath !== 'string') {
				throw new Error(`본문 노트 경로가 올바르지 않습니다: ${id}`);
			}
			this.validateCellStyle(sheet.rows[id].style);
			this.validateCellStyle(sheet.rows[id].cellStyle);
		}
		for (const id of sheet.columnOrder) {
			const column = sheet.columns[id];
			if (!column) throw new Error(`열 정보가 없습니다: ${id}`);
			if (column.role !== undefined && !['text', 'plot', 'character', 'cast', 'status', 'date', 'foreshadow', 'checklist'].includes(column.role)) {
				throw new Error(`열 역할이 올바르지 않습니다: ${id}`);
			}
			if (column.characterNotePath !== undefined && typeof column.characterNotePath !== 'string') {
				throw new Error(`인물 노트 경로가 올바르지 않습니다: ${id}`);
			}
			if (column.labelId !== undefined && typeof column.labelId !== 'string') {
				throw new Error(`열 라벨이 올바르지 않습니다: ${id}`);
			}
			if (column.trackingEnabled !== undefined && typeof column.trackingEnabled !== 'boolean') {
				throw new Error(`열 추적 정보가 올바르지 않습니다: ${id}`);
			}
			this.validateCellStyle(column.style);
			this.validateCellStyle(column.cellStyle);
		}
		if (sheet.view !== undefined) {
			if (!sheet.view || typeof sheet.view !== 'object') throw new Error('시트 보기 정보가 올바르지 않습니다.');
			for (const value of [sheet.view.frozenRowCount, sheet.view.frozenColumnCount]) {
				if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new Error('틀 고정 정보가 올바르지 않습니다.');
			}
			for (const value of [sheet.view.rowHeaderWidth, sheet.view.columnHeaderHeight]) {
				if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error('제목 행열 크기가 올바르지 않습니다.');
			}
			for (const value of [sheet.view.defaultRowHeight, sheet.view.defaultColumnWidth]) {
				if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error('기본 셀 크기가 올바르지 않습니다.');
			}
			if (sheet.view.rowNumberStart !== undefined
				&& (!Number.isInteger(sheet.view.rowNumberStart) || sheet.view.rowNumberStart < 0)) {
				throw new Error('행 번호 시작값이 올바르지 않습니다.');
			}
		}
		for (const [rowId, row] of Object.entries(sheet.cells)) {
			if (!sheet.rows[rowId] || !row || typeof row !== 'object') throw new Error(`잘못된 셀 행입니다: ${rowId}`);
			for (const [columnId, cell] of Object.entries(row)) {
				if (!sheet.columns[columnId] || !cell || cell.type !== 'text' || typeof cell.value !== 'string') {
					throw new Error(`잘못된 셀 정보입니다: ${rowId}/${columnId}`);
				}
				this.validateCellStyle(cell.style);
			}
		}
	}

	private validateOperation(operation: PlotWorkbookOperation, expectedSheetId: string): void {
		if (!operation || typeof operation !== 'object') throw new Error('변경 기록이 객체가 아닙니다.');
		if (operation.sheetId !== expectedSheetId) throw new Error('변경 기록의 시트 ID가 다릅니다.');
		if (!Number.isInteger(operation.seq) || operation.seq < 1) throw new Error('변경 순번이 잘못되었습니다.');
		if (![
			'setCell', 'setCells', 'setCellStyles', 'setHeaderStyles', 'setAxisCellStyles', 'resizeRow', 'resizeColumn', 'renameColumn', 'setColumnRoles', 'setColumnStates',
			'setRowDepth', 'setRowCollapsed', 'setRowLinkedNote', 'setColumnCollapsed', 'appendRows', 'insertRows', 'removeRows', 'swapRowBlocks',
			'appendColumns', 'insertColumns', 'removeColumns', 'swapColumnBlocks', 'setFrozenPanes', 'resizeHeaders', 'setDefaultDimensions',
			'setRowNumberStart',
		].includes(operation.op)) {
			throw new Error(`알 수 없는 변경 기록입니다: ${typeof operation.op === 'string' ? operation.op : '(형식 오류)'}`);
		}
		switch (operation.op) {
			case 'setCell':
				if (typeof operation.rowId !== 'string' || typeof operation.columnId !== 'string'
					|| typeof operation.before !== 'string' || typeof operation.after !== 'string') {
					throw new Error('셀 변경 기록이 올바르지 않습니다.');
				}
				break;
			case 'setCells':
				if (!Array.isArray(operation.changes) || operation.changes.some(change =>
					!change || typeof change.rowId !== 'string' || typeof change.columnId !== 'string'
					|| typeof change.before !== 'string' || typeof change.after !== 'string')) {
					throw new Error('다중 셀 변경 기록이 올바르지 않습니다.');
				}
				break;
			case 'setCellStyles':
				if (!Array.isArray(operation.changes) || operation.changes.some(change =>
					!change || typeof change.rowId !== 'string' || typeof change.columnId !== 'string')) {
					throw new Error('셀 서식 변경 기록이 올바르지 않습니다.');
				}
				for (const change of operation.changes) {
					this.validateCellStyle(change.before);
					this.validateCellStyle(change.after);
				}
				break;
			case 'setHeaderStyles':
			case 'setAxisCellStyles':
				if (!Array.isArray(operation.rowChanges) || !Array.isArray(operation.columnChanges)
					|| operation.rowChanges.some(change => !change || typeof change.rowId !== 'string')
					|| operation.columnChanges.some(change => !change || typeof change.columnId !== 'string')) {
					throw new Error('제목 서식 변경 기록이 올바르지 않습니다.');
				}
				for (const change of [...operation.rowChanges, ...operation.columnChanges]) {
					this.validateCellStyle(change.before);
					this.validateCellStyle(change.after);
				}
				break;
			case 'setDefaultDimensions':
				if (![operation.afterRowHeight, operation.afterColumnWidth].every(value => Number.isFinite(value) && value > 0)
					|| (operation.beforeRowHeight !== undefined && !Number.isFinite(operation.beforeRowHeight))
					|| (operation.beforeColumnWidth !== undefined && !Number.isFinite(operation.beforeColumnWidth))
					|| !Array.isArray(operation.rowChanges) || !Array.isArray(operation.columnChanges)
					|| operation.rowChanges.some(change => !change || typeof change.rowId !== 'string'
						|| (change.before !== undefined && !Number.isFinite(change.before))
						|| (change.after !== undefined && !Number.isFinite(change.after)))
					|| operation.columnChanges.some(change => !change || typeof change.columnId !== 'string'
						|| (change.before !== undefined && !Number.isFinite(change.before))
						|| (change.after !== undefined && !Number.isFinite(change.after)))) {
					throw new Error('기본 셀 크기 변경 기록이 올바르지 않습니다.');
				}
				break;
			case 'resizeRow':
				if (typeof operation.rowId !== 'string' || (operation.after !== undefined && !Number.isFinite(operation.after))) {
					throw new Error('행 크기 변경 기록이 올바르지 않습니다.');
				}
				break;
			case 'resizeColumn':
				if (typeof operation.columnId !== 'string' || (operation.after !== undefined && !Number.isFinite(operation.after))) {
					throw new Error('열 크기 변경 기록이 올바르지 않습니다.');
				}
				break;
			case 'renameColumn':
				if (typeof operation.columnId !== 'string' || typeof operation.before !== 'string' || typeof operation.after !== 'string') {
					throw new Error('열 제목 변경 기록이 올바르지 않습니다.');
				}
				break;
			case 'setColumnRoles':
				if (!Array.isArray(operation.changes) || operation.changes.some(change =>
					!change || typeof change.columnId !== 'string'
					|| (change.before !== undefined && !['text', 'plot', 'character', 'cast', 'status', 'date', 'foreshadow'].includes(change.before))
					|| (change.after !== undefined && !['text', 'plot', 'character', 'cast', 'status', 'date', 'foreshadow'].includes(change.after)))) {
					throw new Error('열 역할 변경 기록이 올바르지 않습니다.');
				}
				break;
			case 'setColumnStates':
				if (!Array.isArray(operation.changes) || operation.changes.some(change =>
					!change || typeof change.columnId !== 'string'
					|| (change.before !== undefined && !['text', 'plot', 'character', 'cast', 'status', 'date', 'foreshadow'].includes(change.before))
					|| (change.after !== undefined && !['text', 'plot', 'character', 'cast', 'status', 'date', 'foreshadow'].includes(change.after))
					|| (change.beforeTitle !== undefined && typeof change.beforeTitle !== 'string')
					|| (change.afterTitle !== undefined && typeof change.afterTitle !== 'string')
					|| (change.beforeCharacterNotePath !== undefined && typeof change.beforeCharacterNotePath !== 'string')
					|| (change.afterCharacterNotePath !== undefined && typeof change.afterCharacterNotePath !== 'string')
					|| (change.beforeLabelId !== undefined && typeof change.beforeLabelId !== 'string')
					|| (change.afterLabelId !== undefined && typeof change.afterLabelId !== 'string')
					|| (change.beforeTrackingEnabled !== undefined && typeof change.beforeTrackingEnabled !== 'boolean')
					|| (change.afterTrackingEnabled !== undefined && typeof change.afterTrackingEnabled !== 'boolean'))) {
					throw new Error('열 상태 변경 기록이 올바르지 않습니다.');
				}
				if (operation.cellChanges !== undefined && (!Array.isArray(operation.cellChanges)
					|| operation.cellChanges.some(change => !change || typeof change.rowId !== 'string'
						|| typeof change.columnId !== 'string' || typeof change.before !== 'string' || typeof change.after !== 'string'))) {
					throw new Error('열 상태의 셀 변경 기록이 올바르지 않습니다.');
				}
				break;
			case 'setRowDepth':
				if (typeof operation.rowId !== 'string' || !Number.isFinite(operation.after)) throw new Error('행 깊이 기록이 올바르지 않습니다.');
				break;
			case 'setRowCollapsed':
				if (typeof operation.rowId !== 'string' || typeof operation.after !== 'boolean') throw new Error('행 접기 기록이 올바르지 않습니다.');
				break;
			case 'setRowLinkedNote':
				if (typeof operation.rowId !== 'string'
					|| (operation.before !== undefined && typeof operation.before !== 'string')
					|| (operation.after !== undefined && typeof operation.after !== 'string')) {
					throw new Error('본문 노트 연결 기록이 올바르지 않습니다.');
				}
				break;
			case 'setColumnCollapsed':
				if (typeof operation.columnId !== 'string' || typeof operation.after !== 'boolean') throw new Error('열 접기 기록이 올바르지 않습니다.');
				break;
			case 'appendRows':
				if (!Array.isArray(operation.rows) || operation.rows.some(row => !row || typeof row.id !== 'string')) {
					throw new Error('추가 행 기록이 올바르지 않습니다.');
				}
				break;
			case 'insertRows':
			case 'removeRows':
				if (!Number.isInteger(operation.index) || !Array.isArray(operation.rows)
					|| operation.rows.some(row => !row || typeof row.id !== 'string')
					|| !operation.cells || typeof operation.cells !== 'object') {
					throw new Error('행 삽입·삭제 기록이 올바르지 않습니다.');
				}
				break;
			case 'swapRowBlocks':
				if (!Array.isArray(operation.firstIds) || !Array.isArray(operation.secondIds)
					|| operation.firstIds.some(id => typeof id !== 'string')
					|| operation.secondIds.some(id => typeof id !== 'string')) {
					throw new Error('행 이동 기록이 올바르지 않습니다.');
				}
				break;
			case 'appendColumns':
				if (!Array.isArray(operation.columns) || operation.columns.some(column => !column || typeof column.id !== 'string')) {
					throw new Error('추가 열 기록이 올바르지 않습니다.');
				}
				break;
			case 'insertColumns':
			case 'removeColumns':
				if (!Number.isInteger(operation.index) || !Array.isArray(operation.columns)
					|| operation.columns.some(column => !column || typeof column.id !== 'string')
					|| !operation.cells || typeof operation.cells !== 'object') {
					throw new Error('열 삽입·삭제 기록이 올바르지 않습니다.');
				}
				break;
			case 'swapColumnBlocks':
				if (!Array.isArray(operation.firstIds) || !Array.isArray(operation.secondIds)
					|| operation.firstIds.some(id => typeof id !== 'string')
					|| operation.secondIds.some(id => typeof id !== 'string')) {
					throw new Error('열 이동 기록이 올바르지 않습니다.');
				}
				break;
			case 'setFrozenPanes':
				if (![operation.beforeRows, operation.afterRows, operation.beforeColumns, operation.afterColumns]
					.every(value => Number.isInteger(value) && value >= 0)) {
					throw new Error('틀 고정 기록이 올바르지 않습니다.');
				}
				break;
			case 'resizeHeaders':
				if (![operation.beforeWidth, operation.afterWidth, operation.beforeHeight, operation.afterHeight]
					.every(value => Number.isFinite(value) && value > 0)) {
					throw new Error('제목 행열 크기 기록이 올바르지 않습니다.');
				}
				break;
			case 'setRowNumberStart':
				if (![operation.before, operation.after].every(value => Number.isInteger(value) && value >= 0)) {
					throw new Error('행 번호 시작값 변경 기록이 올바르지 않습니다.');
				}
				break;
		}
	}

	private validateCellStyle(style: unknown): void {
		if (style === undefined) return;
		if (!style || typeof style !== 'object' || Array.isArray(style)) throw new Error('셀 서식이 객체가 아닙니다.');
		const value = style as Record<string, unknown>;
		const allowed = new Set([
			'fontFamily', 'fontSize', 'color', 'backgroundColor',
			'bold', 'italic', 'underline', 'strikethrough', 'alignment',
		]);
		if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('알 수 없는 셀 서식이 있습니다.');
		if (value.fontFamily !== undefined && typeof value.fontFamily !== 'string') {
			throw new Error('셀 글꼴 서식이 올바르지 않습니다.');
		}
		for (const key of ['color', 'backgroundColor']) {
			if (value[key] !== undefined && !isThemeAwareColor(value[key])) throw new Error('셀 색상 서식이 올바르지 않습니다.');
		}
		if (value.alignment !== undefined && (typeof value.alignment !== 'string' || !['left', 'center', 'right'].includes(value.alignment))) {
			throw new Error('셀 정렬값이 올바르지 않습니다.');
		}
		if (value.fontSize !== undefined && (typeof value.fontSize !== 'number' || !Number.isFinite(value.fontSize))) {
			throw new Error('셀 글자 크기가 올바르지 않습니다.');
		}
		for (const key of ['bold', 'italic', 'underline', 'strikethrough']) {
			if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('셀 서식 상태가 올바르지 않습니다.');
		}
	}

	private async ensureDirectory(path: string): Promise<void> {
		const normalized = normalizePath(path).replace(/^\/+|\/+$/g, '');
		if (!normalized) return;
		let current = '';
		for (const part of normalized.split('/').filter(Boolean)) {
			current = current ? `${current}/${part}` : part;
			if (!(await this.plugin.app.vault.adapter.exists(current))) {
				await this.plugin.app.vault.adapter.mkdir(current);
			}
		}
	}

	private manifestPath(): string { return normalizePath(`${this.rootPath}/manifest.json`); }
	private manifestBackupPath(): string { return normalizePath(`${this.rootPath}/manifest.prev.json`); }
	private foreshadowsPath(): string { return normalizePath(`${this.dataPath}/foreshadows.json`); }
	private foreshadowsBackupPath(): string { return normalizePath(`${this.dataPath}/foreshadows.prev.json`); }
	private sheetPath(sheetId: string): string { return normalizePath(`${this.sheetsPath}/${sheetId}`); }
	private journalPath(sheetId: string): string { return normalizePath(`${this.sheetPath(sheetId)}/journal.jsonl`); }
	private userSnapshotPath(snapshotId: string): string {
		return normalizePath(`${this.userSnapshotsPath}/${snapshotId}.json`);
	}
	private snapshotPath(sheetId: string, revision: number): string {
		return normalizePath(`${this.sheetPath(sheetId)}/snapshot-${String(revision).padStart(8, '0')}.json`);
	}
	private snapshotRevision(path: string): number | null {
		const match = path.match(/\/snapshot-(\d+)\.json$/);
		return match ? Number.parseInt(match[1], 10) : null;
	}
	private errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

	private validateCellSnapshot(snapshot: PlotWorkbookCellSnapshot): void {
		if (!snapshot || typeof snapshot !== 'object'
			|| typeof snapshot.id !== 'string' || !snapshot.id
			|| typeof snapshot.sheetId !== 'string' || !snapshot.sheetId
			|| typeof snapshot.rowId !== 'string' || !snapshot.rowId
			|| typeof snapshot.columnId !== 'string' || !snapshot.columnId
			|| typeof snapshot.title !== 'string'
			|| !Number.isFinite(snapshot.createdAt)
			|| typeof snapshot.value !== 'string') {
			throw new Error('셀 스냅샷이 올바르지 않습니다.');
		}
	}
}

