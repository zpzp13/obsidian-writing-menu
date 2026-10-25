// Community-install compatibility: execute the real analyzer with synthetic model bytes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { loadTsFixture } from './ts-fixture-loader.mjs';

const js = ts.transpileModule(await readFile('src/repetition/MorphAnalyzer.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [embedded, disk, expected] of [['embedded-current', '', 'embedded-current'], ['embedded-current', 'disk-old', 'embedded-current'], ['', 'disk-current', 'disk-current'], ['', '', null]]) {
	let executed = '', terminated = 0, revoked = 0;
	const adapter = { exists: async () => Boolean(disk), read: async () => disk, readBinary: async () => Uint8Array.of(1, 2, 3).buffer };
	const plugin = { app: { vault: { adapter } } };
	const imports = {
		'../i18n/index': loadTsFixture('src/i18n/index.ts'),
		obsidian: { Platform: { isDesktop: true, isDesktopApp: true } },
		'./GaruAssets': { isGaruAssetsDownloaded: async () => true, getAssetPaths: () => ({ workerPath: 'worker.js', wasmPath: 'model.wasm', modelPath: 'model.bin' }) },
	};
	const url = { createObjectURL: blob => { executed = blob; return 'blob:test'; }, revokeObjectURL: () => revoked++ };
	class Worker {
		postMessage(data) { assert.deepEqual([...data.wasmBytes], [1, 2, 3]); queueMicrotask(() => this.onmessage({ data: { tokens: [{ start: 1, end: 2, text: '나', pos: 'NNG' }] } })); }
		terminate() { terminated++; }
	}
	const module = { exports: {} };
	new Function('require', 'exports', '__WM_GARU_WORKER_SOURCE__', 'window', 'URL', js)(name => { assert(name in imports); return imports[name]; }, module.exports, embedded, { Worker, setTimeout, clearTimeout }, url);
	if (!expected) { await assert.rejects(module.exports.analyzeText('😀나', plugin), /워커 파일/); assert.equal(executed, ''); continue; }
	const tokens = await module.exports.analyzeText('😀나', plugin);
	assert.equal(await executed.text(), expected);
	assert.equal(tokens[0].start, 2); assert.equal(tokens[0].end, 3);
	assert.equal(terminated, 1); assert.equal(revoked, 1);
}
console.log('PASS embedded Worker without sidecars, stale-sidecar isolation, disk fallback, missing-worker error, Unicode offsets and cleanup.');
