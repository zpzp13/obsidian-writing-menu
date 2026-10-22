import { normalizePath, requestUrl } from 'obsidian';
import type WritingMenuPlugin from '../../main';

// garu-ko의 WASM 엔진(~390KB)/모델(~1MB)은 main.js에 내장하면 설치 용량이 3배 가까이
// 뛰기 때문에, 대신 npm 패키지를 그대로 미러링하는 jsDelivr CDN에서 처음 사용할 때만
// 내려받아 플러그인 폴더 안에 저장해둔다(노트북 내비게이터의 아이콘 팩 다운로드와 동일한 방식).
export const GARU_VERSION = '0.9.18';
const WASM_URL = `https://cdn.jsdelivr.net/npm/garu-ko@${GARU_VERSION}/pkg/garu_wasm_bg.wasm`;
const MODEL_URL = `https://cdn.jsdelivr.net/npm/garu-ko@${GARU_VERSION}/models/base.gmdl`;

export type GaruAssetStatus = 'current' | 'outdated' | 'missing';

function getPluginDir(plugin: WritingMenuPlugin): string {
	return normalizePath(plugin.manifest.dir || `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`);
}

function getAssetDir(plugin: WritingMenuPlugin): string {
	return `${getPluginDir(plugin)}/garu-assets`;
}

export function getAssetPaths(plugin: WritingMenuPlugin): { wasmPath: string; modelPath: string; versionPath: string; workerPath: string } {
	const pluginDir = getPluginDir(plugin);
	const dir = getAssetDir(plugin);
	return {
		wasmPath: `${dir}/garu_wasm_bg.wasm`,
		modelPath: `${dir}/base.gmdl`,
		versionPath: `${dir}/version.txt`,
		workerPath: `${pluginDir}/garu-worker.js`,
	};
}

export async function getGaruAssetStatus(plugin: WritingMenuPlugin): Promise<GaruAssetStatus> {
	const adapter = plugin.app.vault.adapter;
	const { wasmPath, modelPath, versionPath } = getAssetPaths(plugin);
	if (!await adapter.exists(wasmPath) || !await adapter.exists(modelPath)) return 'missing';
	if (!await adapter.exists(versionPath)) return 'outdated';
	try {
		return (await adapter.read(versionPath)).trim() === GARU_VERSION ? 'current' : 'outdated';
	} catch {
		return 'outdated';
	}
}

export async function isGaruAssetsDownloaded(plugin: WritingMenuPlugin): Promise<boolean> {
	return (await getGaruAssetStatus(plugin)) === 'current';
}

async function downloadFile(url: string): Promise<ArrayBuffer> {
	const res = await requestUrl({ url, throw: false });
	if (res.status !== 200) throw new Error(`다운로드 실패 (HTTP ${res.status}): ${url}`);
	if (!res.arrayBuffer.byteLength) throw new Error(`빈 분석 파일을 받았습니다: ${url}`);
	return res.arrayBuffer;
}

export async function downloadGaruAssets(plugin: WritingMenuPlugin, onProgress?: (step: string) => void): Promise<void> {
	const adapter = plugin.app.vault.adapter;
	const dir = getAssetDir(plugin);
	if (!await adapter.exists(dir)) await adapter.mkdir(dir);
	const { wasmPath, modelPath, versionPath } = getAssetPaths(plugin);

	onProgress?.('WASM 엔진 다운로드 중… (약 400KB)');
	const wasmBytes = await downloadFile(WASM_URL);

	onProgress?.('최신 모델 다운로드 중… (약 1.2MB)');
	const modelBytes = await downloadFile(MODEL_URL);

	// The marker is written last. A network or disk failure can therefore never
	// make a partially updated engine look current on the next launch.
	onProgress?.('엔진 설치 중…');
	if (await adapter.exists(versionPath)) await adapter.remove(versionPath);
	await adapter.writeBinary(wasmPath, wasmBytes);
	await adapter.writeBinary(modelPath, modelBytes);
	await adapter.write(versionPath, GARU_VERSION);
}
