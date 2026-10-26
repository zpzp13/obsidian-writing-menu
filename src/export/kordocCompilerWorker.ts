import { build, initialize } from 'esbuild-wasm/lib/browser';
import { isRecord } from '../utils/typeGuards';

declare const __WM_KORDOC_WORKER_SOURCE__: string;
const scope = self as unknown as {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(reply: unknown): void;
};
const browserEntries: Record<string, string> = {
	jszip: 'node_modules/jszip/dist/jszip.min.js',
	'markdown-it': 'node_modules/markdown-it/dist/markdown-it.min.js',
	'@xmldom/xmldom': 'node_modules/@xmldom/xmldom/lib/index.js',
};
// These facilities are only used by kordoc's HWP5, PDF and CLI exports.
const unsupported = 'const unavailable = () => { throw new Error("This operation is unavailable in the HWPX preview engine."); };';
const shims: Record<string, string> = {
	util: 'export const format = (...args) => args.join(" ");',
	zlib: `${unsupported} export { unavailable as inflateRawSync, unavailable as inflateSync, unavailable as deflateSync };`,
	crypto: `${unsupported} export { unavailable as createCipheriv, unavailable as createHash };`,
	module: `${unsupported} export const createRequire = () => () => ({ parse: unavailable, find: unavailable });`,
	'fs/promises': `${unsupported} export { unavailable as readFile };`,
	fs: 'export const existsSync = () => false;',
	sharp: `${unsupported} export default unavailable;`,
	'puppeteer-core': `${unsupported} export default unavailable;`,
};
const browserZipReader = `function readZipEntry(file, type, used = 0) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, failed = false;
    const declared = file._data?.uncompressedSize;
    const limit = typeof declared === "number" && declared >= 0 ? declared : Number.POSITIVE_INFINITY;
    const stream = file.internalStream("uint8array");
    stream.on("data", chunk => {
      if (failed) return;
      size += chunk.length;
      if (used + size > MAX_DECOMPRESS_SIZE || size > limit) {
        failed = true; stream.pause(); chunks.length = 0;
        reject(new ZipBombError("ZIP decompression limit exceeded.")); return;
      }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (failed) return;
      const out = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
      resolve(type === "text" ? new TextDecoder().decode(out) : out);
    });
    stream.resume();
  });
}
`;
function relativePath(importer: string, specifier: string): string {
	const parts = importer.split('/').filter(Boolean); parts.pop();
	for (const part of specifier.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') { if (!parts.length) throw new Error('Invalid engine module path.'); parts.pop(); }
		else parts.push(part);
	}
	return parts.join('/');
}
async function compile(request: unknown): Promise<string> {
	if (!isRecord(request) || !(request.wasm instanceof ArrayBuffer) || !(request.files instanceof Map)) throw new Error('Invalid engine compiler input.');
	const files = request.files as Map<string, string>;
	await initialize({ wasmModule: await WebAssembly.compile(request.wasm), worker: false });
	const result = await build({
		stdin: { contents: __WM_KORDOC_WORKER_SOURCE__, sourcefile: 'worker.js', loader: 'js', resolveDir: '/' },
		bundle: true, platform: 'browser', format: 'iife', target: 'chrome100', minify: true, write: false,
		define: { 'process.env.KORDOC_MAX_UNZIP_MB': 'undefined' }, logLevel: 'silent',
		plugins: [{ name: 'downloaded-engine', setup(builder) {
			builder.onResolve({ filter: /.*/ }, args => {
				const name = args.path.replace(/^node:/, '');
				if (Object.prototype.hasOwnProperty.call(shims, name)) return { path: name, namespace: 'shim' };
				const path = browserEntries[name] || (args.path.startsWith('.') ? relativePath(args.importer || 'worker.js', args.path) : args.path);
				for (const candidate of [path, `${path}.js`, `${path}.json`, `${path}/index.js`]) {
					if (files.has(candidate)) return { path: candidate, namespace: 'engine' };
				}
				return { errors: [{ text: `Engine module is missing: ${args.path}` }] };
			});
			builder.onLoad({ filter: /.*/, namespace: 'shim' }, args => ({ contents: shims[args.path], loader: 'js' }));
			builder.onLoad({ filter: /.*/, namespace: 'engine' }, args => {
				let source = files.get(args.path);
				if (source === undefined) throw new Error('Engine module is missing.');
				if (args.path === 'node_modules/kordoc/dist/chunk-2A54AIAG.js') {
					const start = source.indexOf('function readZipEntry('), end = source.indexOf('function clampSpan(', start);
					if (start < 0 || end < 0) throw new Error('Incompatible engine ZIP reader.');
					source = source.slice(0, start) + browserZipReader + source.slice(end);
				}
				// A shared HWP5 module constructs this unused constant at module load.
				if (args.path.startsWith('node_modules/kordoc/')) source = source.replace('Buffer.from([208, 207, 17, 224, 161, 177, 26, 225])', 'new Uint8Array([208, 207, 17, 224, 161, 177, 26, 225])');
				if (args.path.startsWith('node_modules/kordoc/') && source.includes('Buffer.from(bytes).toString("base64")')) {
					// The pinned renderer uses Buffer to encode embedded image data.
					source = source.replaceAll('Buffer.from(bytes).toString("base64")', 'kordocBase64(bytes)');
					source += '\nfunction kordocBase64(bytes) { let text = ""; for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192)); return btoa(text); }';
				}
				return { contents: source, loader: args.path.endsWith('.json') ? 'json' : 'js' };
			});
		} }],
	});
	return result.outputFiles[0].text;
}
scope.onmessage = event => {
	void compile(event.data).then(source => scope.postMessage({ source }), error => scope.postMessage({ error: error instanceof Error ? error.message : String(error) }));
};
