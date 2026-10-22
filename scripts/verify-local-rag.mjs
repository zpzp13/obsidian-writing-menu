// Actual browser Worker, ONNX/WASM, tokenizer, IndexedDB and production retrieval. Synthetic corpus only.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { obsidianSearchStub } from './obsidian-search-stub.mjs';
const root = path.resolve(import.meta.dirname, '..'), output = path.join(root, '.codex-tmp', 'local-rag');
await mkdir(output, { recursive: true });
const bundle = await build({ entryPoints: [path.join(root, 'scripts/rag-browser-fixture.ts')], bundle: true, write: false, platform: 'browser', format: 'iife', plugins: [{ name: 'fixture', setup(build) {
	build.onResolve({ filter: /WritingDocument$|AiChatPlotKnowledge$/ }, args => ({ path: args.path, namespace: 'fixture' }));
	build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'search' }));
	build.onLoad({ filter: /.*/, namespace: 'search' }, () => ({ contents: obsidianSearchStub + '\nexport class TFile {}' }));
	build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('WritingDocument') ? 'export const getOpenWritingDocuments = () => globalThis.ragFixtureOpen;' : 'export const readChatPlotPassages = async () => globalThis.ragFixturePlots;' }));
} }] });
const server = createServer(async (req, res) => { try {
	if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<meta charset="utf-8"><script src="/fixture.js"></script>'); return; }
	if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(bundle.outputFiles[0].contents); return; }
	if (!/^\/(rag-worker\.js|rag-runtime\/ort-wasm-simd-threaded\.asyncify\.(mjs|wasm))$/.test(req.url)) { res.statusCode = 404; res.end(); return; }
	res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'); res.end(await readFile(path.join(root, req.url.slice(1))));
} catch (error) { res.statusCode = 500; res.end(String(error)); } });
// Stable localhost origin retains only the synthetic fixture's model cache for offline/restart tests.
await new Promise(resolve => server.listen(18379, '127.0.0.1', resolve));
const binary = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!binary) throw new Error('Chromium not found');
const browser = spawn(binary, ['--headless=new', '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${path.join(output, process.argv.includes('--fresh') ? 'profile-install-fix' : 'profile')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
	const endpoint = await new Promise((resolve, reject) => { let text = ''; browser.once('error', reject); browser.stderr.on('data', chunk => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); }); });
	const pages = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
	socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await new Promise(resolve => socket.onopen = resolve);
	let next = 0; const pending = new Map();
	socket.onmessage = event => { const data = JSON.parse(event.data); if (data.method === 'Runtime.exceptionThrown') console.error('Browser exception', data.params.exceptionDetails.exception?.description); if (data.method === 'Runtime.consoleAPICalled') console.log(...data.params.args.map(arg => arg.value ?? arg.description)); if (data.id && pending.has(data.id)) { const { resolve, reject } = pending.get(data.id); pending.delete(data.id); data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result); } };
	const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
	const evaluate = async expression => { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails)); return result.result.value; };
	await command('Runtime.enable'); await command('Page.navigate', { url: 'http://127.0.0.1:18379' });
	for (let tries = 0; tries < 200 && !await evaluate('typeof ragRun === "function"'); tries++) await new Promise(resolve => setTimeout(resolve, 50));
	const timer = setInterval(async () => { try { console.log('Progress', await evaluate('globalThis.ragProgress')); } catch {} }, 30000);
	let result; try { result = await evaluate('ragRun()'); } finally { clearInterval(timer); }
	await writeFile(path.join(output, 'evaluation.json'), JSON.stringify(result, null, 2));
	if (result.recall < .9) throw new Error('Recall@10 target not met: ' + result.recall);
	console.log('PASS actual local model Korean Recall@10, scope, incremental edits, deletion, tools, responsiveness and network audit');
} finally { socket?.close(); browser.kill(); await new Promise(resolve => server.close(resolve)); }
