import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyArtifacts } from './ReleaseArtifacts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const variant = 'standard';
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== manifest.version) throw new Error('Package and manifest versions differ');
const directory = path.resolve(process.argv[2] || path.join(root, 'dist', manifest.version));
await mkdir(directory, { recursive: true });
// Use an empty stage on every run so obsolete workers cannot leak into the ZIP.
const staging = await mkdtemp(path.join(directory, `${variant}-`)), plugin = path.join(staging, 'writing-menu');
const result = await copyArtifacts(root, plugin);
const notes = `RELEASE_v${manifest.version}.md`;
await copyFile(path.join(root, notes), path.join(directory, notes));
const archive = path.join(directory, `writing-menu-${manifest.version}.zip`);
const tar = process.platform === 'win32' ? 'tar.exe' : 'bsdtar';
execFileSync(tar, ['--format', 'zip', '-cf', archive, 'writing-menu'], { cwd: staging, windowsHide: true });
// Verify bytes read from the ZIP, not just its filenames.
for (const file of result.files) {
	const bytes = execFileSync(tar, ['-xOf', archive, `writing-menu/${file.name}`], { maxBuffer: Math.max(1024 * 1024, file.size + 1024), windowsHide: true });
	if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Archive content mismatch: ${file.name}`);
}
const receipt = {
	version: manifest.version, variant,
	commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
	archive: path.basename(archive), sha256: createHash('sha256').update(await readFile(archive)).digest('hex'), files: result.files,
};
await writeFile(path.join(directory, `${variant}-checksums.json`), JSON.stringify(receipt, null, 2) + '\n');
console.log(`Verified release: ${archive}`);
