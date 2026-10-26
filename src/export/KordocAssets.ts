import { normalizePath, requestUrl } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { wmT } from '../i18n/index';
import { isRecord } from '../utils/typeGuards';
import { unpackKordocPackage } from './KordocArchive';
import { compileKordocWorker, checkKordocWorker } from './KordocCompiler';
import lock from './kordoc-engine-lock.json';

export const KORDOC_VERSION = lock.version;
export const KORDOC_PROTOCOL = lock.protocol;
export type KordocAssetStatus = 'current' | 'outdated' | 'missing';
export class KordocNotInstalledError extends Error {
	constructor() { super(wmT('엔진(kordoc)을 먼저 다운로드해 주세요.')); this.name = 'KordocNotInstalledError'; }
}
const installations = new WeakMap<WritingMenuPlugin, Promise<void>>();
function assetRoot(plugin: WritingMenuPlugin): string {
	return `${normalizePath(plugin.manifest.dir || `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`)}/kordoc-assets`;
}
async function installed(plugin: WritingMenuPlugin): Promise<{ directory: string; version: string; protocol: number } | null> {
	try {
		const value: unknown = JSON.parse(await plugin.app.vault.adapter.read(`${assetRoot(plugin)}/current.json`));
		if (!isRecord(value) || typeof value.directory !== 'string' || !/^engine-[a-z0-9.-]+$/.test(value.directory) || typeof value.version !== 'string' || typeof value.protocol !== 'number') return null;
		return { directory: value.directory, version: value.version, protocol: value.protocol };
	} catch { return null; }
}
export async function getKordocAssetStatus(plugin: WritingMenuPlugin): Promise<KordocAssetStatus> {
	const active = await installed(plugin);
	if (!active) return 'missing';
	const directory = `${assetRoot(plugin)}/${active.directory}`, adapter = plugin.app.vault.adapter;
	if (active.version !== KORDOC_VERSION || active.protocol !== lock.protocol) return 'outdated';
	if (!await adapter.exists(`${directory}/worker.js`) || !await adapter.exists(`${directory}/${lock.entry}`)) return 'missing';
	return active.version === KORDOC_VERSION && active.protocol === lock.protocol ? 'current' : 'outdated';
}
export async function getKordocAssetPaths(plugin: WritingMenuPlugin): Promise<{ worker: string; entry: string }> {
	if (await getKordocAssetStatus(plugin) !== 'current') throw new KordocNotInstalledError();
	const active = await installed(plugin);
	if (!active) throw new KordocNotInstalledError();
	const directory = `${assetRoot(plugin)}/${active.directory}`;
	return { worker: `${directory}/worker.js`, entry: `${directory}/${lock.entry}` };
}
async function ensureDirectory(plugin: WritingMenuPlugin, directory: string, known: Set<string>): Promise<void> {
	const adapter = plugin.app.vault.adapter, parts = directory.split('/');
	for (let index = 1; index <= parts.length; index++) {
		const path = parts.slice(0, index).join('/');
		if (known.has(path)) continue;
		if (!await adapter.exists(path)) await adapter.mkdir(path);
		known.add(path);
	}
}
async function activateInstallation(plugin: WritingMenuPlugin, marker: string, root: string): Promise<void> {
	const adapter = plugin.app.vault.adapter, current = `${root}/current.json`, previous = `${marker}.previous`;
	const hadPrevious = await adapter.exists(current);
	// Obsidian's rename rejects an existing destination, even for regular files.
	// Move the old pointer aside first and restore it if activation fails.
	if (hadPrevious) await adapter.rename(current, previous);
	try { await adapter.rename(marker, current); }
	catch (error) {
		if (hadPrevious) await adapter.rename(previous, current);
		throw error;
	}
	if (hadPrevious) {
		try { await adapter.remove(previous); } catch { /* The new installation is already active. */ }
	}
}
async function install(plugin: WritingMenuPlugin, onProgress?: (step: string) => void): Promise<void> {
	const adapter = plugin.app.vault.adapter, root = assetRoot(plugin), known = new Set<string>();
	await ensureDirectory(plugin, root, known);
	const directoryName = `engine-${KORDOC_VERSION}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	const directory = `${root}/${directoryName}`;
	const marker = `${root}/current-${directoryName}.json`;
	await ensureDirectory(plugin, directory, known);
	try {
		const modules = new Map<string, string>();
		let wasm: Uint8Array | undefined;
		const packages = [...lock.packages, lock.compiler];
		for (const [index, pkg] of packages.entries()) {
			onProgress?.(wmT('엔진 다운로드 중… ({0}/{1})', index + 1, packages.length));
			const response = await requestUrl({ url: pkg.url, throw: false });
			if (response.status !== 200) throw new Error(wmT('문서 엔진 다운로드에 실패했습니다 (HTTP {0}).', response.status));
			const bytes = new Uint8Array(response.arrayBuffer);
			if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error(wmT('문서 엔진 다운로드 파일이 올바르지 않습니다.'));
			const digest = new Uint8Array(await window.crypto.subtle.digest('SHA-512', bytes.slice().buffer));
			const integrity = 'sha512-' + window.btoa(String.fromCharCode(...digest));
			if (integrity !== pkg.integrity) throw new Error(wmT('문서 엔진 파일의 무결성을 확인하지 못했습니다. 다시 다운로드해 주세요.'));
			const files = unpackKordocPackage(bytes);
			const manifestBytes = files.get('package.json');
			const manifest: unknown = manifestBytes ? JSON.parse(new TextDecoder().decode(manifestBytes)) : null;
			if (!isRecord(manifest) || manifest.name !== pkg.name || manifest.version !== pkg.version) throw new Error(wmT('문서 엔진 다운로드 파일이 올바르지 않습니다.'));
			for (const [name, contents] of files) {
				if (pkg === lock.compiler) {
					if (name === 'esbuild.wasm') wasm = contents;
					if (name !== 'esbuild.wasm' && !/^(?:LICENSE|LICENCE|COPYING)(?:\..*)?$/i.test(name) && name !== 'package.json') continue;
				} else if (/\.(?:[cm]?js|json)$/.test(name)) modules.set(`${pkg.path}/${name}`, new TextDecoder().decode(contents));
				const filename = `${directory}/${pkg.path}/${name}`;
				await ensureDirectory(plugin, filename.slice(0, filename.lastIndexOf('/')), known);
				await adapter.writeBinary(filename, contents.slice().buffer);
			}
		}
		onProgress?.(wmT('엔진 설치 중…'));
		if (!wasm) throw new Error(wmT('문서 엔진 다운로드 파일이 올바르지 않습니다.'));
		const workerSource = await compileKordocWorker(modules, wasm);
		await checkKordocWorker(workerSource, KORDOC_VERSION, KORDOC_PROTOCOL);
		await adapter.write(`${directory}/worker.js`, workerSource);
		if (!await adapter.exists(`${directory}/${lock.entry}`)) throw new Error(wmT('문서 엔진 다운로드 파일이 올바르지 않습니다.'));
		// Existing installations stay usable until every new file has been written.
		await adapter.write(marker, JSON.stringify({ directory: directoryName, version: KORDOC_VERSION, protocol: lock.protocol }));
		await activateInstallation(plugin, marker, root);
	} catch (error) {
		try { if (await adapter.exists(marker)) await adapter.remove(marker); } catch { /* Keep the original failure. */ }
		try { await adapter.rmdir(directory, true); } catch { /* Preserve the download error if cleanup fails. */ }
		throw error;
	}
}
/** A click installs once; previews never download packages or start npm. */
export function downloadKordocAssets(plugin: WritingMenuPlugin, onProgress?: (step: string) => void): Promise<void> {
	const current = installations.get(plugin);
	if (current) return current;
	const pending = install(plugin, onProgress).finally(() => { installations.delete(plugin); });
	installations.set(plugin, pending);
	return pending;
}
