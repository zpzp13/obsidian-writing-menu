import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyArtifacts } from './ReleaseArtifacts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.env.WRITING_MENU_DEPLOY_DIR;
if (destination) {
	const result = await copyArtifacts(root, destination, { hotReload: true });
	console.log('Deployed Writing Menu ' + result.manifest.version + ': ' + result.files.length + ' verified files → ' + destination);
} else {
	console.log('Build complete. Set WRITING_MENU_DEPLOY_DIR to deploy to a development vault.');
}
