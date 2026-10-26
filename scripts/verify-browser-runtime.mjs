import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { browserRuntime } from './browser-runtime.mjs';
import { inspectBundle } from './verify-bundle-policy.mjs';
import { unzipSync, strFromU8 } from 'fflate';

for (const source of [
	'document.createElement("script")', 'document["createElement"]("script")',
	'document.createElementNS("http://www.w3.org/1999/xhtml", "script")',
	'new Function("return 1")', 'Function("return this")()', 'eval("run()")',
	'const $Function = Function; $Function("return this")()',
	`new Blob([${JSON.stringify('/* embedded worker */'.repeat(15) + 'document.createElement("script")')}])`,
	`new Blob([${JSON.stringify('/* embedded worker */'.repeat(15) + 'const F = Function; F("return this")()')}])`,
]) assert(inspectBundle(source).length, `Bundle policy missed ${source}`);
assert.deepEqual(inspectBundle('document.createElement("div"); function evaluate() {} evaluate();'), []);
assert.deepEqual(inspectBundle('const F = Function; function ordinary(F) { F(); } ordinary(() => {});'), [], 'Constructor aliases must respect lexical scope');

const result = await build({
	stdin: { contents: 'export { default as JSZip } from "jszip"; export { Document, Packer, Paragraph, TextRun } from "docx";', resolveDir: process.cwd() },
	bundle: true, platform: 'browser', format: 'iife', globalName: 'RuntimeFixture',
	target: 'chrome124', write: false, plugins: [browserRuntime()],
});
const source = result.outputFiles[0].text;
assert.deepEqual(inspectBundle(source), []);
// Browser-like realm: no Node globals, DOM or dynamic code generation.
const realm = vm.createContext({ setTimeout, clearTimeout, Blob, TextEncoder, TextDecoder }, { codeGeneration: { strings: false, wasm: false } });
vm.runInContext(source, realm);
const bytes = await vm.runInContext(String.raw`(async () => {
	const { JSZip, Document, Packer, Paragraph, TextRun } = RuntimeFixture;
	const zip = new JSZip();
	zip.file('한글/원고.txt', '한글 😀 & < >\n본문');
	const packed = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
	const loaded = await JSZip.loadAsync(packed);
	if (await loaded.file('한글/원고.txt').async('string') !== '한글 😀 & < >\n본문') throw Error('ZIP text changed');
	const blob = await zip.generateAsync({ type: 'blob' });
	if (!(blob instanceof Blob) || !blob.size) throw Error('ZIP Blob output failed');
	const encoded = await zip.generateAsync({ type: 'base64' });
	if (!(await JSZip.loadAsync(encoded, { base64: true })).file('한글/원고.txt')) throw Error('Base64 ZIP failed');
	const document = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('한글 😀 & < >')] })] }] });
	return new Uint8Array(await Packer.toArrayBuffer(document));
})()`, realm);
const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
assert(xml.includes('한글 😀 &amp; &lt; &gt;'), 'DOCX text changed');
console.log('PASS native ZIP/DOCX generation without Node, DOM, eval or Function: Unicode, compression, Blob, base64 and bundle-policy regressions.');
