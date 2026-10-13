import { Platform } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { MorphToken } from './types';
import { getFs } from '../utils/nodeShims';
import { getAssetPaths, isGaruAssetsDownloaded } from './GaruAssets';

export class ModelNotDownloadedError extends Error {
	constructor() { super('형태소 분석 모델이 아직 다운로드되지 않았습니다.'); }
}

interface WorkerResponse {
	tokens?: MorphToken[];
	error?: string;
}

/** Garu의 code-point 오프셋을 CodeMirror/JavaScript의 UTF-16 오프셋으로 변환한다. */
function convertTokenOffsets(tokens: MorphToken[], text: string): MorphToken[] {
	const codePointToCodeUnit: number[] = [0];
	let codeUnitOffset = 0;
	for (const character of text) {
		codeUnitOffset += character.length;
		codePointToCodeUnit.push(codeUnitOffset);
	}
	return tokens.map(token => ({
		...token,
		start: codePointToCodeUnit[token.start] ?? text.length,
		end: codePointToCodeUnit[token.end] ?? text.length,
	}));
}

const ANALYSIS_TIMEOUT_MS = 60_000;

export function isMorphAnalysisSupported(): boolean {
	return Platform.isDesktop && Platform.isDesktopApp;
}

function analyzeInWorker(
	text: string,
	workerSource: string,
	wasmBytes: Uint8Array,
	modelBytes: Uint8Array,
): Promise<MorphToken[]> {
	return new Promise((resolve, reject) => {
		const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
		let worker: Worker | null = null;
		let settled = false;

		const finish = (error?: Error, tokens?: MorphToken[]) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timeoutId);
			worker?.terminate();
			URL.revokeObjectURL(workerUrl);
			if (error) reject(error);
			else resolve(tokens ?? []);
		};

		const timeoutId = window.setTimeout(() => {
			finish(new Error('분석 시간이 60초를 초과해 중단했습니다. 문서를 나누어 다시 시도해 주세요.'));
		}, ANALYSIS_TIMEOUT_MS);

		try {
			// Electron의 Node 전역과 혼동하지 않고 Chromium DOM Worker를 명시적으로 사용한다.
			worker = new window.Worker(workerUrl);
			worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
				if (event.data.error) finish(new Error(event.data.error));
				else finish(undefined, event.data.tokens ?? []);
			};
			worker.onerror = event => {
				finish(new Error(event.message || '분석 워커를 실행하지 못했습니다.'));
			};

			// Buffer가 공유하는 더 큰 ArrayBuffer까지 보내지 않도록 독립된 배열로 복사한다.
			const transferableWasm = new Uint8Array(wasmBytes);
			const transferableModel = new Uint8Array(modelBytes);
			worker.postMessage(
				{ text, wasmBytes: transferableWasm, modelBytes: transferableModel },
				[transferableWasm.buffer, transferableModel.buffer],
			);
		} catch (error) {
			finish(error instanceof Error ? error : new Error(String(error)));
		}
	});
}

export async function analyzeText(text: string, plugin: WritingMenuPlugin): Promise<MorphToken[]> {
	if (!isMorphAnalysisSupported()) {
		throw new Error('퇴고 매니저는 데스크톱 앱에서만 사용할 수 있습니다.');
	}
	if (!(await isGaruAssetsDownloaded(plugin))) throw new ModelNotDownloadedError();

	const fs = await getFs();
	const { workerPath, wasmPath, modelPath } = getAssetPaths(plugin);
	if (!fs.existsSync(workerPath)) {
		throw new Error('분석 워커 파일이 없습니다. 플러그인을 다시 설치하거나 업데이트해 주세요.');
	}

	const workerSource = fs.readFileSync(workerPath, 'utf8');
	const wasmBytes = fs.readFileSync(wasmPath);
	const modelBytes = fs.readFileSync(modelPath);
	const tokens = await analyzeInWorker(text, workerSource, wasmBytes, modelBytes);
	return convertTokenOffsets(tokens, text);
}
