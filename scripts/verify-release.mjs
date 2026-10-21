// Reproducible offline checks; production builds and deployment are separate steps.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.codex-tmp', 'release-checks');
const core = [
	['types', 'node_modules/typescript/bin/tsc', '-noEmit', '-skipLibCheck'],
	...['release-artifacts', 'morph-worker', 'paged-zoom', 'chat-stream', 'chat-legacy', 'chat-knowledge', 'deus-skills', 'rag-api', 'local-rag', 'rag-install', 'rag-navigation', 'rag-scopes', 'relationship-retrieval', 'episode-retrieval', 'character-research'].map(name => [name, `scripts/verify-${name}.mjs`]),
];
const browser = [
	['deus-ui', 'scripts/verify-deus-ui.mjs'],
	['paged-editor', 'scripts/verify-paged-performance.mjs'],
	['plot-mobile', 'scripts/verify-paged-performance.mjs', '--plot'],
	['snapshots-revision', 'scripts/verify-paged-performance.mjs', '--dashboard', '--native-snapshot-preview'],
	['search-settings', 'scripts/verify-paged-performance.mjs', '--rag-settings'],
];
const selected = process.argv.find(value => value.startsWith('--only='))?.slice(7).split(',');
const suites = selected ? [...core, ...browser].filter(([name]) => selected.includes(name)) : process.argv.includes('--browser') ? browser : process.argv.includes('--core') ? core : [...core, ...browser];
if (!suites.length || selected?.some(name => !suites.some(([known]) => known === name))) throw new Error('Unknown release check name');
await mkdir(directory, { recursive: true });
const results = [];
for (const [name, ...args] of suites) {
	const started = Date.now();
	const result = await new Promise(resolve => {
		const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
		let output = '';
		child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
		child.once('error', error => resolve({ code: -1, output: output + error.message }));
		child.once('close', code => resolve({ code, output }));
	});
	await writeFile(path.join(directory, `${name}.log`), result.output);
	const entry = { name, passed: result.code === 0, milliseconds: Date.now() - started };
	results.push(entry); await writeFile(path.join(directory, `${name}.json`), JSON.stringify(entry, null, 2) + '\n'); console.log(`${entry.passed ? 'PASS' : 'FAIL'} ${name} (${(entry.milliseconds / 1000).toFixed(1)}s)`);
	if (!entry.passed) console.error(result.output.slice(-4500));
}
await writeFile(path.join(directory, selected ? 'selected-results.json' : process.argv.includes('--browser') ? 'browser-results.json' : process.argv.includes('--core') ? 'core-results.json' : 'results.json'), JSON.stringify(results, null, 2) + '\n');
if (results.some(result => !result.passed)) process.exitCode = 1;
else console.log(`All ${results.length} release checks passed. Logs: ${directory}`);
