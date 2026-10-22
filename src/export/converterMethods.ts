import { Platform, TFile, Notice, WorkspaceLeaf, MarkdownView, FileSystemAdapter, normalizePath } from 'obsidian';
import { CONVERTER_PY_CONTENT } from './converterScript';
import type WritingMenuPlugin from '../../main';
import { joinPath, getFs } from '../utils/nodeShims';
import type { SpawnLike } from '../utils/nodeShims';
import { PagedWritingView } from '../paged/PagedWritingView';

declare const process: { env: Record<string, string | undefined> };
declare const require: (id: string) => unknown;

// child_process는 데스크톱(파이썬 실행)에서만 필요하므로, 모바일에서 로드 자체가
// 되지 않도록 최상단 정적 import 대신 지연 로드한다.
// (동적 import()는 Obsidian 플러그인 샌드박스에서 Node 내장 모듈 지정자를
// 해석하지 못해 "Failed to resolve module specifier" 오류가 나므로 require 사용)
let spawnFn: SpawnLike | null = null;
async function getSpawn(): Promise<SpawnLike> {
	if (Platform.isDesktop) {
		if (!spawnFn) spawnFn = (require('child_process') as { spawn: SpawnLike }).spawn;
		return spawnFn;
	}
	throw new Error('데스크톱 전용 기능입니다.');
}

function getVaultBasePath(plugin: WritingMenuPlugin): string {
	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter))
		throw new Error('Not a filesystem vault');
	return adapter.getBasePath();
}

function pluginDirectory(plugin: WritingMenuPlugin): string {
	return normalizePath(plugin.manifest.dir || `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`);
}

async function converterScriptExists(plugin: WritingMenuPlugin): Promise<boolean> {
	return plugin.app.vault.adapter.exists(`${pluginDirectory(plugin)}/scripts/converter.py`);
}

async function removeConverterList(plugin: WritingMenuPlugin, name: string): Promise<void> {
	const path = `${pluginDirectory(plugin)}/scripts/${name}`;
	try { if (await plugin.app.vault.adapter.exists(path)) await plugin.app.vault.adapter.remove(path); }
	catch (error) { console.error('Failed to delete temp list', error); }
}

/** Source paths stay inside the vault; only the chosen export destination uses fs. */
async function vaultMarkdownPaths(plugin: WritingMenuPlugin, folderPath: string): Promise<string[]> {
	const folder = normalizePath(folderPath).replace(/^\/+|\/+$/g, '');
	if (folder.includes(':') || folder.split('/').includes('..')) throw new Error('볼트 내부 폴더를 선택해 주세요.');
	const paths: string[] = [];
	const visit = async (path: string): Promise<void> => {
		const { files, folders } = await plugin.app.vault.adapter.list(path);
		const directories = new Set(folders);
		for (const child of [...files, ...folders].sort((a, b) => a.localeCompare(b))) {
			if (directories.has(child)) await visit(child);
			else if (/\.md$/i.test(child)) paths.push(child);
		}
	};
	await visit(folder);
	return paths;
}

export async function ensureConverterScript(plugin: WritingMenuPlugin){
	const adapter = plugin.app.vault.adapter;
	const pluginDir = pluginDirectory(plugin);
	const scriptDir = `${pluginDir}/scripts`;
	const scriptPath = `${scriptDir}/converter.py`;
	if (!await adapter.exists(scriptDir)) await adapter.mkdir(scriptDir);
	// Always overwrite to ensure latest version
	await adapter.write(scriptPath, CONVERTER_PY_CONTENT);

}

export async function openFolderPicker(plugin: WritingMenuPlugin): Promise<string | null>{
	return plugin.runPicker('folder');
}

export async function openTemplatePicker(plugin: WritingMenuPlugin): Promise<string | null>{
	return plugin.runPicker('file');
}

export async function runPicker(plugin: WritingMenuPlugin, mode: 'folder' | 'file'): Promise<string | null>{
	const pluginDir = joinPath(getVaultBasePath(plugin), pluginDirectory(plugin));
	const scriptDir = joinPath(pluginDir, 'scripts');
	const scriptFile = 'converter.py';
	if (!await converterScriptExists(plugin)) {
		new Notice('오류: 스크립트 파일을 찾을 수 없습니다.', 5000);
		return null;
	}

	const args = mode === 'file' ? ['--pick-file'] : ['--pick-folder'];
	const spawn = await getSpawn();

	return new Promise((resolve) => {
		const proc = spawn('python', [scriptFile, ...args], { cwd: scriptDir });
		let output = '';

		proc.stdout.on('data', (data) => {
			output += data.toString();
		});

		proc.on('error', (err: Error) => {
			new Notice(`Python 실행 실패.\n${err.message}`, 5000);
			resolve(null);
		});

		proc.on('close', (code: number) => {
			const trimmed = output.trim();
			if (code === 0 && trimmed) {
				resolve(trimmed);
			} else {
				resolve(null);
			}
		});
	});
}

export async function convertToHwp(plugin: WritingMenuPlugin, file: TFile, fileName: string, exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<boolean>{
	new Notice('HWP로 변환 중...', 5000);

	const basePath = getVaultBasePath(plugin);
	const absolutePath = joinPath(basePath, file.path);
	const safeExportPath = exportPath.replace(/[\\/]$/, '');
	const fullOutputPath = joinPath(safeExportPath, fileName);

	const pluginDir = joinPath(basePath, pluginDirectory(plugin));
	const scriptDir = joinPath(pluginDir, 'scripts');
	const scriptFile = 'converter.py';
	if (!await converterScriptExists(plugin)) {
		new Notice('오류: 스크립트 폴더 또는 파일이 없습니다.', 5000);
		return false;
	}

	const spawn = await getSpawn();

	return new Promise((resolve) => {
		const args = [scriptFile, absolutePath, fullOutputPath];
		if (useSpaceIndent) {
			args.push('--space-indent');
		}
		if (excludeHeadings) {
			args.push('--exclude-headings');
		}
		if (plugin.settings.hwpTemplatePath) {
			args.push('--template');
			args.push(plugin.settings.hwpTemplatePath);
		}

		const spawnEnv: Record<string, string> = { PYTHONIOENCODING: 'utf-8' };
		for (const key of ['PATH', 'PATHEXT', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR', 'COMSPEC', 'SYSTEMDRIVE']) {
			const val = process.env[key];
			if (val !== undefined) spawnEnv[key] = val;
		}
		const pythonProcess = spawn('python', args, {
			cwd: scriptDir,
			env: spawnEnv
		});

		let stderrOutput = '';
		let stdoutOutput = '';

		pythonProcess.stdout.on('data', (data) => {
			stdoutOutput += data.toString('utf-8');
		});

		pythonProcess.stderr.on('data', (data) => {
			stderrOutput += data.toString('utf-8');
			console.error(`[Python Error]: ${data.toString('utf-8')}`);
		});

		pythonProcess.on('error', (err: Error) => {
			new Notice(`Python 실행 오류! Python 설치 및 PATH 설정을 확인하세요.\n${err.message}`, 5000);
			resolve(false);
		});

		pythonProcess.on('close', (code: number) => {
			if (code === 0) {
				new Notice(`저장 완료: ${fileName}`, 3000);
				resolve(true);
			} else {
				const errorMsg = stderrOutput || stdoutOutput || '알 수 없는 오류';
				new Notice(`실패: ${fileName}\n${errorMsg.substring(0, 200)}`, 8000);
				resolve(false);
			}
		});
	});
}

export function getDefaultExportPath(plugin: WritingMenuPlugin): string{
	if (plugin.settings.hwpExportPath) {
		return plugin.settings.hwpExportPath;
	}
	// Default to Desktop
	return '';
}

export function cleanMarkdownFrontmatter(_plugin: WritingMenuPlugin, content: string): string{
	const pattern = /^---\s*\n.*?\n---\s*\n?/s;
	return content.replace(pattern, '').trim();
}

export function removeHeadings(plugin: WritingMenuPlugin, content: string): string{
	const withoutFrontmatter = plugin.cleanMarkdownFrontmatter(content);
	return stripMarkdownHeadings(withoutFrontmatter);
}

function stripMarkdownHeadings(content: string): string {
	const lines = content.split('\n');
	const result: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (/^\s{0,3}#{1,6}(?:\s+|$)/.test(line)) continue;
		const nextLine = lines[index + 1];
		if (line.trim() && nextLine !== undefined && /^\s{0,3}(?:=+|-+)\s*$/.test(nextLine)) {
			index += 1;
			continue;
		}
		result.push(line);
	}
	return result.join('\n').trim();
}

export async function copyWithOptions(plugin: WritingMenuPlugin, leaf: WorkspaceLeaf){
	const view = leaf.view;
	if (!(view instanceof MarkdownView) && !(view instanceof PagedWritingView)) return;
	if (!plugin.shouldApplyToFile(view.file)) return;
	const source = view instanceof MarkdownView ? view.editor.getValue() : view.getEditableData();
	let bodyText = plugin.cleanMarkdownFrontmatter(source);
	if (plugin.settings.copyExcludeHeadings) bodyText = stripMarkdownHeadings(bodyText);
	let lines = bodyText.split('\n');
	if (plugin.settings.copyExcludeFootnotes) {
		lines = lines.filter(line => !line.trim().match(/^\[\^[^\]]+\]:/)); // 각주 정의 제외
		lines = lines.map(line => line.replace(/\[\^[^\]]+\]/g, ''));       // 인라인 각주 참조 제외
	}
	const result = lines.join('\n').trim();
	await navigator.clipboard.writeText(result);
	new Notice('클립보드에 복사했습니다.');
}

export function applySpaceIndent(_plugin: WritingMenuPlugin, text: string): string{
	return text.split('\n').map(line => line.trim() ? ' ' + line : line).join('\n');
}

export async function convertToTxt(plugin: WritingMenuPlugin, file: TFile, fileName: string, exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<boolean>{
	new Notice('TXT로 변환 중...', 3000);

	try {
		const fs = await getFs();
		const content = await plugin.app.vault.read(file);
		let bodyText = plugin.cleanMarkdownFrontmatter(content);

		if (excludeHeadings) {
			bodyText = stripMarkdownHeadings(bodyText);
		}

		if (useSpaceIndent) {
			bodyText = plugin.applySpaceIndent(bodyText);
		}

		const safeExportPath = exportPath.replace(/[\\/]$/, '');
		const fullOutputPath = joinPath(safeExportPath, fileName);

		// Ensure directory exists
		if (!fs.existsSync(safeExportPath)) {
			fs.mkdirSync(safeExportPath, { recursive: true });
		}

		fs.writeFileSync(fullOutputPath, bodyText, 'utf-8');
		new Notice(`저장 완료: ${fileName}`, 3000);
		return true;
	} catch (e) {
		console.error('TXT conversion error:', e);
		new Notice(`실패: ${fileName}`, 3000);
		return false;
	}
}

export async function convertFolderToTxt(plugin: WritingMenuPlugin, folderPath: string, exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{
	new Notice(`폴더 변환 시작 (TXT)`, 3000);

	const fs = await getFs();

	let count = 0;
	let successCount = 0;

	const processFolder = async () => {
		const root = normalizePath(folderPath).replace(/^\/+|\/+$/g, '');
		for (const path of await vaultMarkdownPaths(plugin, root)) {
			const content = await plugin.app.vault.adapter.read(path);
			let bodyText = plugin.cleanMarkdownFrontmatter(content);
			if (excludeHeadings) bodyText = stripMarkdownHeadings(bodyText);
			if (useSpaceIndent) bodyText = plugin.applySpaceIndent(bodyText);
			const relativePath = root ? path.slice(root.length + 1) : path;
			const slash = relativePath.lastIndexOf('/');
			const outputDir = joinPath(exportPath, slash < 0 ? '' : relativePath.slice(0, slash));
			if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
			fs.writeFileSync(joinPath(outputDir, relativePath.slice(slash + 1).replace(/\.md$/i, '.txt')), bodyText, 'utf-8');
			count++; successCount++;
		}
	};

	try {
		await processFolder();
		new Notice(`TXT 변환 완료: ${successCount}/${count}`, 5000);
	} catch (e) {
		console.error('Folder TXT conversion error:', e);
		new Notice('폴더 변환 중 오류가 발생했습니다.', 5000);
	}
}

export async function convertFilesToTxt(plugin: WritingMenuPlugin, files: TFile[], exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{
	new Notice(`${files.length}개 파일 변환 시작 (TXT)`, 3000);

	let successCount = 0;

	for (const file of files) {
		const fileName = file.basename + '.txt';
		const success = await plugin.convertToTxt(file, fileName, exportPath, useSpaceIndent, excludeHeadings);
		if (success) successCount++;
	}

	new Notice(`TXT 변환 완료: ${successCount}/${files.length}`, 5000);
}

export async function convertFolderToHwp(plugin: WritingMenuPlugin, folderPath: string, exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{
	const basePath = getVaultBasePath(plugin);
	const pluginDir = joinPath(basePath, pluginDirectory(plugin));
	const scriptDir = joinPath(pluginDir, 'scripts');
	const scriptFile = 'converter.py';
	const absoluteFolderPath = joinPath(basePath, folderPath);

	new Notice(`폴더 변환 시작 (HWP)`, 3000);

	const spawn = await getSpawn();

	return new Promise((resolve) => {
		const args = [scriptFile, '--batch-folder', absoluteFolderPath, exportPath];
		if (useSpaceIndent) {
			args.push('--space-indent');
		}
		if (excludeHeadings) {
			args.push('--exclude-headings');
		}
		if (plugin.settings.hwpTemplatePath) {
			args.push('--template');
			args.push(plugin.settings.hwpTemplatePath);
		}

		const pythonProcess = spawn('python', args, { cwd: scriptDir });

		// Drain converter output without logging document paths or content.
		pythonProcess.stdout.on('data', () => {});

		pythonProcess.stderr.on('data', (data) => {
			console.error(`[Python Error]: ${data.toString()}`);
		});

		pythonProcess.on('error', (err: Error) => {
			new Notice(`Python 실행 오류!\n${err.message}`, 5000);
			resolve();
		});

		pythonProcess.on('close', (code: number) => {
			if (code === 0) {
				new Notice('HWP 폴더 변환 완료!', 5000);
			} else {
				new Notice('HWP 폴더 변환 중 오류가 발생했습니다.', 5000);
			}
			resolve();
		});
	});
}

export async function convertFilesToHwp(plugin: WritingMenuPlugin, files: TFile[], exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{
	const basePath = getVaultBasePath(plugin);
	const pluginDir = joinPath(basePath, pluginDirectory(plugin));
	const scriptDir = joinPath(pluginDir, 'scripts');
	const scriptFile = 'converter.py';

	const spawn = await getSpawn();

	// Create temp list file
	const listFileName = `batch_list_${Date.now()}_${crypto.randomUUID()}.txt`;
	const listFilePath = joinPath(scriptDir, listFileName);

	try {
		const pathsToConvert = files.map(f => joinPath(basePath, f.path)).join('\n');
		await plugin.app.vault.adapter.write(`${pluginDirectory(plugin)}/scripts/${listFileName}`, pathsToConvert);
	} catch (e) {
		new Notice('임시 리스트 파일 생성 실패', 5000);
		console.error(e);
		return;
	}

	new Notice(`${files.length}개 파일 변환 시작 (HWP)`, 3000);


	return new Promise<void>((resolve) => {
		const args = [scriptFile, '--batch-list', listFilePath, exportPath];
		if (useSpaceIndent) {
			args.push('--space-indent');
		}
		if (excludeHeadings) {
			args.push('--exclude-headings');
		}
		if (plugin.settings.hwpTemplatePath) {
			args.push('--template');
			args.push(plugin.settings.hwpTemplatePath);
		}

		const pythonProcess = spawn('python', args, { cwd: scriptDir });

		pythonProcess.stderr.on('data', (data) => {
			console.error(`[Python Error]: ${data.toString()}`);
		});

		pythonProcess.on('error', (error: Error) => { new Notice(`Python 실행 오류!\n${error.message}`, 5000); resolve(); });
		pythonProcess.on('close', (code: number) => {

			if (code === 0) {
				new Notice('HWP 선택 변환 완료!', 5000);
			} else {
				new Notice('HWP 선택 변환 중 오류가 발생했습니다.', 5000);
			}
			resolve();
		});
	}).finally(() => removeConverterList(plugin, listFileName));
}

export async function convertFolderToTxtMerged(plugin: WritingMenuPlugin, folderPath: string, exportPath: string, fileName: string, useSpaceIndent: boolean): Promise<void>{
	new Notice('병합 변환 시작 (TXT)', 3000);

	const fs = await getFs();

	const allContents: string[] = [];


	try {
		for (const path of await vaultMarkdownPaths(plugin, folderPath)) {
			let bodyText = plugin.cleanMarkdownFrontmatter(await plugin.app.vault.adapter.read(path));
			if (useSpaceIndent) bodyText = plugin.applySpaceIndent(bodyText);
			allContents.push(bodyText);
		}

		const mergedContent = allContents.join('\n\n');
		const safeExportPath = exportPath.replace(/[\\/]$/, '');
		const fullOutputPath = joinPath(safeExportPath, fileName);

		if (!fs.existsSync(safeExportPath)) {
			fs.mkdirSync(safeExportPath, { recursive: true });
		}

		fs.writeFileSync(fullOutputPath, mergedContent, 'utf-8');
		new Notice(`병합 저장 완료: ${fileName}`, 5000);
	} catch (e) {
		console.error('Merged TXT conversion error:', e);
		new Notice('병합 변환 중 오류가 발생했습니다.', 5000);
	}
}

export async function convertFilesToTxtMerged(plugin: WritingMenuPlugin, files: TFile[], exportPath: string, fileName: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{
	new Notice(`${files.length}개 파일 병합 시작 (TXT)`, 3000);

	const allContents: string[] = [];

	try {
		const fs = await getFs();
		for (const file of files) {
			const content = await plugin.app.vault.read(file);
			let bodyText = plugin.cleanMarkdownFrontmatter(content);

			if (excludeHeadings) {
				bodyText = stripMarkdownHeadings(bodyText);
			}

			if (useSpaceIndent) {
				bodyText = plugin.applySpaceIndent(bodyText);
			}

			allContents.push(bodyText);
		}

		const mergedContent = allContents.join('\n\n');
		const safeExportPath = exportPath.replace(/[\\/]$/, '');
		const fullOutputPath = joinPath(safeExportPath, fileName);

		if (!fs.existsSync(safeExportPath)) {
			fs.mkdirSync(safeExportPath, { recursive: true });
		}

		fs.writeFileSync(fullOutputPath, mergedContent, 'utf-8');
		new Notice(`병합 저장 완료: ${fileName}`, 5000);
	} catch (e) {
		console.error('Merged TXT conversion error:', e);
		new Notice('병합 변환 중 오류가 발생했습니다.', 5000);
	}
}

export async function convertFolderToHwpMerged(plugin: WritingMenuPlugin, folderPath: string, exportPath: string, fileName: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{
	const basePath = getVaultBasePath(plugin);
	const pluginDir = joinPath(basePath, pluginDirectory(plugin));
	const scriptDir = joinPath(pluginDir, 'scripts');
	const scriptFile = 'converter.py';
	const absoluteFolderPath = joinPath(basePath, folderPath);
	const fullOutputPath = joinPath(exportPath, fileName);

	new Notice('병합 변환 시작 (HWP)', 3000);

	const spawn = await getSpawn();

	return new Promise((resolve) => {
		const args = [scriptFile, '--merge-folder', absoluteFolderPath, fullOutputPath];
		if (useSpaceIndent) {
			args.push('--space-indent');
		}
		if (excludeHeadings) {
			args.push('--exclude-headings');
		}
		if (plugin.settings.hwpTemplatePath) {
			args.push('--template');
			args.push(plugin.settings.hwpTemplatePath);
		}

		const pythonProcess = spawn('python', args, { cwd: scriptDir });

		pythonProcess.stderr.on('data', (data) => {
			console.error(`[Python Error]: ${data.toString()}`);
		});

		pythonProcess.on('error', (err: Error) => {
			new Notice(`Python 실행 오류!\n${err.message}`, 5000);
			resolve();
		});

		pythonProcess.on('close', (code: number) => {
			if (code === 0) {
				new Notice(`병합 저장 완료: ${fileName}`, 5000);
			} else {
				new Notice('병합 변환 중 오류가 발생했습니다.', 5000);
			}
			resolve();
		});
	});
}

export async function convertFilesToHwpMerged(plugin: WritingMenuPlugin, files: TFile[], exportPath: string, fileName: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<void>{
	const basePath = getVaultBasePath(plugin);
	const pluginDir = joinPath(basePath, pluginDirectory(plugin));
	const scriptDir = joinPath(pluginDir, 'scripts');
	const scriptFile = 'converter.py';
	const fullOutputPath = joinPath(exportPath, fileName);

	const spawn = await getSpawn();

	// Create temp list file
	const listFileName = `merge_list_${Date.now()}_${crypto.randomUUID()}.txt`;
	const listFilePath = joinPath(scriptDir, listFileName);

	try {
		const pathsToConvert = files.map(f => joinPath(basePath, f.path)).join('\n');
		await plugin.app.vault.adapter.write(`${pluginDirectory(plugin)}/scripts/${listFileName}`, pathsToConvert);
	} catch (e) {
		new Notice('임시 리스트 파일 생성 실패', 5000);
		console.error(e);
		return;
	}

	new Notice(`${files.length}개 파일 병합 시작 (HWP)`, 3000);


	return new Promise<void>((resolve) => {
		const args = [scriptFile, '--merge-list', listFilePath, fullOutputPath];
		if (useSpaceIndent) {
			args.push('--space-indent');
		}
		if (excludeHeadings) {
			args.push('--exclude-headings');
		}
		if (plugin.settings.hwpTemplatePath) {
			args.push('--template');
			args.push(plugin.settings.hwpTemplatePath);
		}

		const pythonProcess = spawn('python', args, { cwd: scriptDir });

		pythonProcess.stderr.on('data', (data) => {
			console.error(`[Python Error]: ${data.toString()}`);
		});

		pythonProcess.on('error', (error: Error) => { new Notice(`Python 실행 오류!\n${error.message}`, 5000); resolve(); });
		pythonProcess.on('close', (code: number) => {

			if (code === 0) {
				new Notice(`병합 저장 완료: ${fileName}`, 5000);
			} else {
				new Notice('병합 변환 중 오류가 발생했습니다.', 5000);
			}
			resolve();
		});
	}).finally(() => removeConverterList(plugin, listFileName));
}
