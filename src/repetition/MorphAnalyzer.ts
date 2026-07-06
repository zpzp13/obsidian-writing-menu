import * as fs from 'fs';
import { Platform } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { MorphToken } from './types';
// @ts-ignore 타입 없는 vendored wasm-bindgen glue (garu_wasm.d.ts는 참고용, import는 값만 사용)
import initGaruWasm, { GaruWasm } from './vendor/garu_wasm.js';
import { getAssetPaths, isGaruAssetsDownloaded } from './GaruAssets';

// WASM 엔진 JS는 번들에 포함하되(가볍다, ~14KB), 무거운 .wasm/모델 바이너리는
// GaruAssets.ts가 첫 사용 시 CDN에서 내려받아 플러그인 폴더에 저장해둔 걸 읽어서 쓴다.

interface AnalyzeResult {
	tokens: { text: string; pos: string; start: number; end: number }[];
}

export class ModelNotDownloadedError extends Error {
	constructor() { super('형태소 분석 모델이 아직 다운로드되지 않았습니다.'); }
}

let garuInstance: InstanceType<typeof GaruWasm> | null = null;
let loadingPromise: Promise<InstanceType<typeof GaruWasm>> | null = null;

export function isMorphAnalysisSupported(): boolean {
	return Platform.isDesktopApp;
}

async function getGaru(plugin: WritingMenuPlugin): Promise<InstanceType<typeof GaruWasm>> {
	if (garuInstance) return garuInstance;
	if (!isGaruAssetsDownloaded(plugin)) throw new ModelNotDownloadedError();

	if (!loadingPromise) {
		loadingPromise = (async () => {
			const { wasmPath, modelPath } = getAssetPaths(plugin);
			const wasmBytes = fs.readFileSync(wasmPath);
			const modelBytes = fs.readFileSync(modelPath);
			await initGaruWasm({ module_or_path: wasmBytes });
			garuInstance = new GaruWasm(new Uint8Array(modelBytes), false);
			return garuInstance;
		})();
	}
	return loadingPromise;
}

export async function analyzeText(text: string, plugin: WritingMenuPlugin): Promise<MorphToken[]> {
	if (!isMorphAnalysisSupported()) {
		throw new Error('퇴고 매니저는 데스크톱 앱에서만 사용할 수 있습니다.');
	}
	const garu = await getGaru(plugin);
	const result = garu.analyze(text) as AnalyzeResult;
	return result.tokens.map(t => ({ text: t.text, pos: t.pos, start: t.start, end: t.end }));
}
