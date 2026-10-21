import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyArtifacts } from './ReleaseArtifacts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.env.WRITING_MENU_DEPLOY_DIR || 'C:/Users/82109/Desktop/Obsidian/Test/.obsidian/plugins/writing-menu';
const result = await copyArtifacts(root, destination, { hotReload: true });
console.log('Deployed Writing Menu ' + result.manifest.version + ': ' + result.files.length + ' verified files → ' + destination);
