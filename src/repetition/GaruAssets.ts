import { FileSystemAdapter, requestUrl } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { joinPath, getFs } from '../utils/nodeShims';

// garu-ko의 WASM 엔진(~390KB)/모델(~1MB)은 main.js에 내장하면 설치 용량이 3배 가까이
// 뛰기 때문에, 대신 npm 패키지를 그대로 미러링하는 jsDelivr CDN에서 처음 사용할 때만
// 내려받아 플러그인 폴더 안에 저장해둔다(노트북 내비게이터의 아이콘 팩 다운로드와 동일한 방식).
export const GARU_VERSION = '0.9.18';
const WASM_URL = `https://cdn.jsdelivr.net/npm/garu-ko@${GARU_VERSION}/pkg/garu_wasm_bg.wasm`;
const MODEL_URL = `https://cdn.jsdelivr.net/npm/garu-ko@${GARU_VERSION}/models/base.gmdl`;

export type GaruAssetStatus = 'current' | 'outdated' | 'missing';

function getVaultBasePath(plugin: WritingMenuPlugin): string {
	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		throw new Error('데스크톱 vault에서만 사용할 수 있습니다.');
	}
	return adapter.getBasePath();
}

function getAssetDir(plugin: WritingMenuPlugin): string {
	const pluginDir = joinPath(getVaultBasePath(plugin), plugin.manifest.dir || '');
	return joinPath(pluginDir, 'garu-assets');
}

export function getAssetPaths(plugin: WritingMenuPlugin): { wasmPath: string; modelPath: string; versionPath: string } {
	const dir = getAssetDir(plugin);
	return {
		wasmPath: joinPath(dir, 'garu_wasm_bg.wasm'),
		modelPath: joinPath(dir, 'base.gmdl'),
		versionPath: joinPath(dir, 'version.txt'),
	};
}

export async function getGaruAssetStatus(plugin: WritingMenuPlugin): Promise<GaruAssetStatus> {
	const fs = await getFs();
	const { wasmPath, modelPath, versionPath } = getAssetPaths(plugin);
	if (!fs.existsSync(wasmPath) || !fs.existsSync(modelPath)) return 'missing';
	if (!fs.existsSync(versionPath)) return 'outdated';
	try {
		return fs.readFileSync(versionPath, 'utf8').trim() === GARU_VERSION ? 'current' : 'outdated';
	} catch {
		return 'outdated';
	}
}

export async function isGaruAssetsDownloaded(plugin: WritingMenuPlugin): Promise<boolean> {
	return (await getGaruAssetStatus(plugin)) === 'current';
}

async function downloadFile(url: string): Promise<Uint8Array> {
	const res = await requestUrl({ url, throw: false });
	if (res.status !== 200) throw new Error(`다운로드 실패 (HTTP ${res.status}): ${url}`);
	return new Uint8Array(res.arrayBuffer);
}

export async function downloadGaruAssets(plugin: WritingMenuPlugin, onProgress?: (step: string) => void): Promise<void> {
	const fs = await getFs();
	const dir = getAssetDir(plugin);
	fs.mkdirSync(dir, { recursive: true });
	const { wasmPath, modelPath, versionPath } = getAssetPaths(plugin);

	onProgress?.('WASM 엔진 다운로드 중… (약 400KB)');
	const wasmBytes = await downloadFile(WASM_URL);

	onProgress?.('최신 모델 다운로드 중… (약 1.2MB)');
	const modelBytes = await downloadFile(MODEL_URL);

	// The marker is written last. A network or disk failure can therefore never
	// make a partially updated engine look current on the next launch.
	onProgress?.('엔진 설치 중…');
	fs.writeFileSync(wasmPath, wasmBytes);
	fs.writeFileSync(modelPath, modelBytes);
	fs.writeFileSync(versionPath, GARU_VERSION, 'utf8');
}
