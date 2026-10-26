import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { inspectArtifacts } from './ReleaseArtifacts.mjs';
import { verifyBundlePolicy } from './verify-bundle-policy.mjs';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(pkg.version, manifest.version, 'Package and manifest versions differ');
assert.equal(lock.version, manifest.version, 'Lockfile and manifest versions differ');
assert.equal(lock.packages[''].version, manifest.version, 'Root lockfile package version differs');
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
if (tag) assert.equal(tag, manifest.version, 'Obsidian release tags must match manifest.version exactly');
if (process.argv.includes('--tag-only')) {
	assert(tag, 'A release tag is required');
	await readFile(`RELEASE_v${manifest.version}.md`);
	console.log(`PASS release tag ${tag}`);
} else {
	const first = await inspectArtifacts('.');
	assert.deepEqual(first.files.map(file => file.name).sort(), ['main.js', 'manifest.json', 'styles.css']);
	await verifyBundlePolicy();
	execFileSync(process.execPath, ['esbuild.config.mjs', 'production'], { stdio: 'inherit', windowsHide: true });
	assert.deepEqual((await inspectArtifacts('.')).files, first.files, 'Production builds must have identical bytes');
	console.log('PASS exactly three release assets and byte-for-byte reproducible production build.');
}
