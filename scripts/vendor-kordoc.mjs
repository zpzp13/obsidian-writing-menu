// Refresh only the browser HWPX renderer at this reviewed revision. Never runs upstream code.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';

const revision = '71666c52fe6321e2ad1df8dfbc21b58693bd6ae3';
const root = 'vendor/kordoc';
const base = `https://raw.githubusercontent.com/chrisryugj/kordoc/${revision}/`;
const visited = new Set(), manifest = [];
async function read(name) {
	const response = await fetch(base + name);
	if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
	return response.text();
}
async function visit(name) {
	if (visited.has(name)) return;
	visited.add(name);
	const original = await read(name);
	let code = (await transform(original, { loader: 'ts', target: 'es2020', format: 'esm', legalComments: 'inline' })).code;
	if (name === 'src/utils.ts') {
		// CLI-only logging and environment configuration must never enter a browser worker.
		code = code.replace(/import \{ format \} from ["']util["'];?/, 'const format = (...values) => values.map(String).join(" ");')
			.replace(/Number\(process\.env\.KORDOC_MAX_UNZIP_MB\)/g, 'NaN');
	}
    if (name === 'src/hwpx/parser-shared.ts') code = code.replace(/function readZipEntry[\s\S]*?(?=function clampSpan)/, "function readZipEntry(file, type, used = 0) {\n  return new Promise((resolve, reject) => {\n    const chunks = [];\n    let size = 0;\n    const declared = file._data?.uncompressedSize;\n    const limit = typeof declared === 'number' && declared >= 0 ? declared : Number.POSITIVE_INFINITY;\n    const stream = file.internalStream('uint8array');\n    stream.on('data', chunk => {\n      size += chunk.length;\n      if (used + size > MAX_DECOMPRESS_SIZE || size > limit) {\n        stream.pause(); reject(new ZipBombError('ZIP decompression size limit exceeded')); return;\n      }\n      chunks.push(chunk);\n    }).on('error', reject).on('end', () => {\n      const bytes = new Uint8Array(size);\n      let at = 0;\n      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }\n      resolve(type === 'text' ? new TextDecoder().decode(bytes) : bytes);\n    }).resume();\n  });\n}\n");
    if (name === 'src/render/svg-render.ts') code = "function browserBase64(bytes) {\n  let binary = '';\n  for (let index = 0; index < bytes.length; index += 4096) binary += String.fromCharCode(...bytes.subarray(index, index + 4096));\n  return btoa(binary);\n}\n" + code.replace('Buffer.from(bytes).toString("base64")', 'browserBase64(bytes)');
    if (name === 'src/utils.ts') code = code.replace(/function routeConsoleToStderr\(\) \{[\s\S]*?\n\}/, 'function routeConsoleToStderr() {}');
	const imports = [...code.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g)].map(match => match[1]);
	for (const dependency of imports) {
		if (!dependency.startsWith('.')) {
			if (!['jszip', '@xmldom/xmldom'].includes(dependency)) throw Error(`Unexpected renderer dependency: ${name}: ${dependency}`);
			continue;
		}
		const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.js$/, '.ts');
		if (!resolved.startsWith('src/')) throw Error('Upstream import escaped src');
		await visit(resolved);
	}
	const target = path.join(root, name.replace(/^src\//, '').replace(/\.ts$/, '.js'));
	await mkdir(path.dirname(target), { recursive: true });
	const output = `// Derived from kordoc 4.24.6, ${revision}, ${name}. MIT; see LICENSE.\n${code}`;
	await writeFile(target, output);
	manifest.push({ source: name, sha256: createHash('sha256').update(original).digest('hex'), output: target.replaceAll('\\', '/'), outputSha256: createHash('sha256').update(output).digest('hex') });
}
await visit('src/render/svg-render.ts');
await writeFile(path.join(root, 'LICENSE'), await read('LICENSE'));
await writeFile(path.join(root, 'provenance.json'), JSON.stringify({ repository: 'https://github.com/chrisryugj/kordoc', version: '4.24.6', revision, adaptations: ['TypeScript transpilation', 'Browser-only utils: no CLI logging or process.env override', 'JSZip browser byte streams with decompression limits', 'Browser base64 image encoding'], files: manifest.sort((a, b) => a.source.localeCompare(b.source)) }, null, 2) + '\n');
console.log(`Vendored ${manifest.length} browser renderer modules at ${revision}`);
