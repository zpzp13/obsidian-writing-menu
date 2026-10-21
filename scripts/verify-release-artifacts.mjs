import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { copyArtifacts, inspectArtifacts, PLUGIN_ARTIFACTS } from './ReleaseArtifacts.mjs';

await mkdir('.codex-tmp', { recursive: true });
const root = await mkdtemp(path.resolve('.codex-tmp', 'artifact-check-'));
const source = path.join(root, 'build'), destination = path.join(root, 'vault', '.obsidian', 'plugins', 'writing-menu');
await mkdir(destination, { recursive: true });
await writeFile(path.join(destination, 'data.json'), 'USER_SETTINGS');
await writeFile(path.join(destination, 'main.js'), 'OLD_BUILD');
await assert.rejects(copyArtifacts(source, destination));
assert.equal(await readFile(path.join(destination, 'main.js'), 'utf8'), 'OLD_BUILD');
for (const name of PLUGIN_ARTIFACTS) {
	await mkdir(path.dirname(path.join(source, name)), { recursive: true });
	await writeFile(path.join(source, name), name === 'manifest.json' ? JSON.stringify({ id: 'writing-menu', version: '3.4.0' }) : name);
}
const copied = await copyArtifacts(source, destination);
assert.deepEqual(copied.files, (await inspectArtifacts(source)).files);
assert.equal(await readFile(path.join(destination, 'data.json'), 'utf8'), 'USER_SETTINGS');
await writeFile(path.join(source, 'main.js'), '');
await assert.rejects(copyArtifacts(source, destination), /Empty/);
assert.equal(await readFile(path.join(destination, 'main.js'), 'utf8'), 'main.js');
console.log('PASS artifact preflight, verified deployment, unchanged user settings and incomplete-build rejection. Synthetic vault only.');
