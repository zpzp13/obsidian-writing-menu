import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// One inventory for local deployment and release archives. Never copy vault settings/data.
export const PLUGIN_ARTIFACTS = [
	'styles.css', 'manifest.json', 'garu-worker.js',
	'main.js', // Trigger Hot Reload only after the other artifacts are ready.
];
export async function inspectArtifacts(root) {
	const files = [];
	for (const name of PLUGIN_ARTIFACTS) {
		const bytes = await readFile(path.join(root, name));
		if (!bytes.length) throw new Error(`Empty build artifact: ${name}`);
		files.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
	}
	const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
	if (manifest.id !== 'writing-menu' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version)) throw new Error('Invalid plugin release manifest');
	return { manifest, files };
}
export async function copyArtifacts(source, destination, { hotReload = false } = {}) {
	if (path.resolve(source) === path.resolve(destination)) throw new Error('Deployment source and destination must differ');
	const before = await inspectArtifacts(source);
	for (const name of PLUGIN_ARTIFACTS) {
		if (name === 'main.js' && hotReload) await new Promise(resolve => setTimeout(resolve, 750));
		const target = path.join(destination, name);
		await mkdir(path.dirname(target), { recursive: true });
		await copyFile(path.join(source, name), target);
	}
	const after = await inspectArtifacts(destination);
	if (JSON.stringify(before.files) !== JSON.stringify(after.files)) throw new Error(`Deployment verification failed: ${destination}`);
	return after;
}
