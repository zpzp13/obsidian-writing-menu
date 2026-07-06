import * as fsRaw from 'fs';
import * as pathRaw from 'path';
import { FileSystemAdapter, requestUrl } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { FsLike, PathLike } from '../utils/nodeShims';

const fs = fsRaw as unknown as FsLike;
const path = pathRaw as unknown as PathLike;

// garu-ko의 WASM 엔진(~390KB)/모델(~1MB)은 main.js에 내장하면 설치 용량이 3배 가까이
// 뛰기 때문에, 대신 npm 패키지를 그대로 미러링하는 jsDelivr CDN에서 처음 사용할 때만
// 내려받아 플러그인 폴더 안에 저장해둔다(노트북 내비게이터의 아이콘 팩 다운로드와 동일한 방식).
const GARU_VERSION = '0.9.8';
const WASM_URL = `https://cdn.jsdelivr.net/npm/garu-ko@${GARU_VERSION}/pkg/garu_wasm_bg.wasm`;
const MODEL_URL = `https://cdn.jsdelivr.net/npm/garu-ko@${GARU_VERSION}/models/base.gmdl`;

function getVaultBasePath(plugin: WritingMenuPlugin): string {
	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		throw new Error('데스크톱 vault에서만 사용할 수 있습니다.');
	}
	return adapter.getBasePath();
}

function getAssetDir(plugin: WritingMenuPlugin): string {
	const pluginDir = path.join(getVaultBasePath(plugin), plugin.manifest.dir || '');
	return path.join(pluginDir, 'garu-assets');
}

export function getAssetPaths(plugin: WritingMenuPlugin): { wasmPath: string; modelPath: string } {
	const dir = getAssetDir(plugin);
	return { wasmPath: path.join(dir, 'garu_wasm_bg.wasm'), modelPath: path.join(dir, 'base.gmdl') };
}

export function isGaruAssetsDownloaded(plugin: WritingMenuPlugin): boolean {
	const { wasmPath, modelPath } = getAssetPaths(plugin);
	return fs.existsSync(wasmPath) && fs.existsSync(modelPath);
}

async function downloadFile(url: string, destPath: string): Promise<void> {
	const res = await requestUrl({ url, throw: false });
	if (res.status !== 200) throw new Error(`다운로드 실패 (HTTP ${res.status}): ${url}`);
	fs.writeFileSync(destPath, new Uint8Array(res.arrayBuffer));
}

export async function downloadGaruAssets(plugin: WritingMenuPlugin, onProgress?: (step: string) => void): Promise<void> {
	const dir = getAssetDir(plugin);
	fs.mkdirSync(dir, { recursive: true });
	const { wasmPath, modelPath } = getAssetPaths(plugin);

	onProgress?.('WASM 엔진 다운로드 중… (약 400KB)');
	await downloadFile(WASM_URL, wasmPath);

	onProgress?.('모델 다운로드 중… (약 1MB)');
	await downloadFile(MODEL_URL, modelPath);
}
