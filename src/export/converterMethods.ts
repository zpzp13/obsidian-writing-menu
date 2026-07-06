import * as fsRaw from 'fs';
import * as pathRaw from 'path';
import { spawn as spawnRaw } from 'child_process';
import { TFile, Notice, WorkspaceLeaf, MarkdownView, FileSystemAdapter } from 'obsidian';
import { CONVERTER_PY_CONTENT } from './converterScript';
import type WritingMenuPlugin from '../../main';
import type { FsLike, PathLike, SpawnLike } from '../utils/nodeShims';

const fs = fsRaw as unknown as FsLike;
const path = pathRaw as unknown as PathLike;
const spawn = spawnRaw as unknown as SpawnLike;
declare const process: { env: Record<string, string | undefined> };

function getVaultBasePath(plugin: WritingMenuPlugin): string {
	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter))
		throw new Error('Not a filesystem vault');
	return adapter.getBasePath();
}

export async function ensureConverterScript(plugin: WritingMenuPlugin){
	const pluginDir = path.join(getVaultBasePath(plugin), plugin.manifest.dir || '');
	const scriptDir = path.join(pluginDir, 'scripts');
	const scriptPath = path.join(scriptDir, 'converter.py');

	if (!fs.existsSync(scriptDir)) {
		fs.mkdirSync(scriptDir, { recursive: true });
	}
	// Always overwrite to ensure latest version
	fs.writeFileSync(scriptPath, CONVERTER_PY_CONTENT, 'utf-8');

}

export async function openFolderPicker(plugin: WritingMenuPlugin): Promise<string | null>{
	return plugin.runPicker('folder');
}

export async function openTemplatePicker(plugin: WritingMenuPlugin): Promise<string | null>{
	return plugin.runPicker('file');
}

export async function runPicker(plugin: WritingMenuPlugin, mode: 'folder' | 'file'): Promise<string | null>{
	const pluginDir = path.join(getVaultBasePath(plugin), plugin.manifest.dir || '');
	const scriptDir = path.join(pluginDir, 'scripts');
	const scriptFile = 'converter.py';
	const fullScriptPath = path.join(scriptDir, scriptFile);

	if (!fs.existsSync(scriptDir) || !fs.existsSync(fullScriptPath)) {
		new Notice('오류: 스크립트 파일을 찾을 수 없습니다.', 5000);
		return null;
	}

	const args = mode === 'file' ? ['--pick-file'] : ['--pick-folder'];

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
	const absolutePath = path.join(basePath, file.path);
	const safeExportPath = exportPath.replace(/[\\/]$/, '');
	const fullOutputPath = path.join(safeExportPath, fileName);

	const pluginDir = path.join(basePath, plugin.manifest.dir || '');
	const scriptDir = path.join(pluginDir, 'scripts');
	const scriptFile = 'converter.py';
	const fullScriptPath = path.join(scriptDir, scriptFile);

	if (!fs.existsSync(scriptDir) || !fs.existsSync(fullScriptPath)) {
		new Notice('오류: 스크립트 폴더 또는 파일이 없습니다.', 5000);
		return false;
	}

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
			console.log(`[Python]: ${data.toString('utf-8')}`);
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
	return withoutFrontmatter
		.split('\n')
		.filter(line => !line.trim().match(/^#{1,6}\s/))
		.join('\n')
		.trim();
}

export async function copyWithOptions(plugin: WritingMenuPlugin, leaf: WorkspaceLeaf){
	const view = leaf.view;
	if (!(view instanceof MarkdownView) || !view.editor) return;
	const withoutFrontmatter = plugin.cleanMarkdownFrontmatter(view.editor.getValue());
	let lines = withoutFrontmatter.split('\n');
	if (plugin.settings.copyExcludeHeadings) {
		lines = lines.filter(line => !line.trim().match(/^#{1,6}\s/));
	}
	if (plugin.settings.copyExcludeFootnotes) {
		lines = lines.filter(line => !line.trim().match(/^\[\^[^\]]+\]:/)); // 각주 정의 제외
		lines = lines.map(line => line.replace(/\[\^[^\]]+\]/g, ''));       // 인라인 각주 참조 제외
	}
	const result = lines.join('\n').trim();
	await navigator.clipboard.writeText(result);
	const parts: string[] = [];
	if (plugin.settings.copyExcludeHeadings) parts.push('헤딩');
	if (plugin.settings.copyExcludeFootnotes) parts.push('각주');
	const msg = parts.length > 0 ? `${parts.join('·')}을 제외한 텍스트가 복사되었습니다.` : '텍스트가 복사되었습니다.';
	new Notice(msg);
}

export function applySpaceIndent(_plugin: WritingMenuPlugin, text: string): string{
	return text.split('\n').map(line => line.trim() ? ' ' + line : line).join('\n');
}

export async function convertToTxt(plugin: WritingMenuPlugin, file: TFile, fileName: string, exportPath: string, useSpaceIndent: boolean, excludeHeadings: boolean = false): Promise<boolean>{
	new Notice('TXT로 변환 중...', 3000);

	try {
		const content = await plugin.app.vault.read(file);
		let bodyText = plugin.cleanMarkdownFrontmatter(content);

		if (excludeHeadings) {
			bodyText = bodyText
				.split('\n')
				.filter(line => !line.trim().match(/^#{1,6}\s/))
				.join('\n')
				.trim();
		}

		if (useSpaceIndent) {
			bodyText = plugin.applySpaceIndent(bodyText);
		}

		const safeExportPath = exportPath.replace(/[\\/]$/, '');
		const fullOutputPath = path.join(safeExportPath, fileName);

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

	const absoluteFolderPath = path.join(getVaultBasePath(plugin), folderPath);

	let count = 0;
	let successCount = 0;

	const processFolder = async (currentPath: string, relativePath: string) => {
		const entries = fs.readdirSync(currentPath, { withFileTypes: true });

		for (const entry of entries) {
			const entryPath = path.join(currentPath, entry.name);

			if (entry.isDirectory()) {
				await processFolder(entryPath, path.join(relativePath, entry.name));
			} else if (entry.name.toLowerCase().endsWith('.md')) {
				const content = fs.readFileSync(entryPath, 'utf-8');
				let bodyText = plugin.cleanMarkdownFrontmatter(content);

				if (excludeHeadings) {
					bodyText = bodyText
						.split('\n')
						.filter(line => !line.trim().match(/^#{1,6}\s/))
						.join('\n')
						.trim();
				}

				if (useSpaceIndent) {
					bodyText = plugin.applySpaceIndent(bodyText);
				}

				const outputDir = path.join(exportPath, relativePath);
				if (!fs.existsSync(outputDir)) {
					fs.mkdirSync(outputDir, { recursive: true });
				}

				const baseName = entry.name.replace(/\.md$/i, '');
				const outputPath = path.join(outputDir, baseName + '.txt');
				fs.writeFileSync(outputPath, bodyText, 'utf-8');

				count++;
				successCount++;
			}
		}
	};

	try {
		await processFolder(absoluteFolderPath, '');
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
	const pluginDir = path.join(basePath, plugin.manifest.dir || '');
	const scriptDir = path.join(pluginDir, 'scripts');
	const scriptFile = 'converter.py';
	const absoluteFolderPath = path.join(basePath, folderPath);

	new Notice(`폴더 변환 시작 (HWP)`, 3000);

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

		pythonProcess.stdout.on('data', (data) => {
			console.log(`[Python]: ${data.toString()}`);
		});

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
	const pluginDir = path.join(basePath, plugin.manifest.dir || '');
	const scriptDir = path.join(pluginDir, 'scripts');
	const scriptFile = 'converter.py';

	// Create temp list file
	const listFileName = `batch_list_${Date.now()}.txt`;
	const listFilePath = path.join(scriptDir, listFileName);

	try {
		const pathsToConvert = files.map(f => path.join(basePath, f.path)).join('\n');
		fs.writeFileSync(listFilePath, pathsToConvert, 'utf-8');
	} catch (e) {
		new Notice('임시 리스트 파일 생성 실패', 5000);
		console.error(e);
		return;
	}

	new Notice(`${files.length}개 파일 변환 시작 (HWP)`, 3000);

	return new Promise((resolve) => {
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

		pythonProcess.on('close', (code: number) => {
			// Clean up list file
			try {
				if (fs.existsSync(listFilePath)) fs.unlinkSync(listFilePath);
			} catch (e) { console.error('Failed to delete temp list', e); }

			if (code === 0) {
				new Notice('HWP 선택 변환 완료!', 5000);
			} else {
				new Notice('HWP 선택 변환 중 오류가 발생했습니다.', 5000);
			}
			resolve();
		});
	});
}

export async function convertFolderToTxtMerged(plugin: WritingMenuPlugin, folderPath: string, exportPath: string, fileName: string, useSpaceIndent: boolean): Promise<void>{
	new Notice('병합 변환 시작 (TXT)', 3000);

	const absoluteFolderPath = path.join(getVaultBasePath(plugin), folderPath);

	const allContents: string[] = [];

	const processFolder = (currentPath: string) => {
		const entries = fs.readdirSync(currentPath, { withFileTypes: true });

		for (const entry of entries) {
			const entryPath = path.join(currentPath, entry.name);

			if (entry.isDirectory()) {
				processFolder(entryPath);
			} else if (entry.name.toLowerCase().endsWith('.md')) {
				const content = fs.readFileSync(entryPath, 'utf-8');
				let bodyText = plugin.cleanMarkdownFrontmatter(content);

				if (useSpaceIndent) {
					bodyText = plugin.applySpaceIndent(bodyText);
				}

				allContents.push(bodyText);
			}
		}
	};

	try {
		processFolder(absoluteFolderPath);

		const mergedContent = allContents.join('\n\n');
		const safeExportPath = exportPath.replace(/[\\/]$/, '');
		const fullOutputPath = path.join(safeExportPath, fileName);

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
		for (const file of files) {
			const content = await plugin.app.vault.read(file);
			let bodyText = plugin.cleanMarkdownFrontmatter(content);

			if (excludeHeadings) {
				bodyText = bodyText
					.split('\n')
					.filter(line => !line.trim().match(/^#{1,6}\s/))
					.join('\n')
					.trim();
			}

			if (useSpaceIndent) {
				bodyText = plugin.applySpaceIndent(bodyText);
			}

			allContents.push(bodyText);
		}

		const mergedContent = allContents.join('\n\n');
		const safeExportPath = exportPath.replace(/[\\/]$/, '');
		const fullOutputPath = path.join(safeExportPath, fileName);

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
	const pluginDir = path.join(basePath, plugin.manifest.dir || '');
	const scriptDir = path.join(pluginDir, 'scripts');
	const scriptFile = 'converter.py';
	const absoluteFolderPath = path.join(basePath, folderPath);
	const fullOutputPath = path.join(exportPath, fileName);

	new Notice('병합 변환 시작 (HWP)', 3000);

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
	const pluginDir = path.join(basePath, plugin.manifest.dir || '');
	const scriptDir = path.join(pluginDir, 'scripts');
	const scriptFile = 'converter.py';
	const fullOutputPath = path.join(exportPath, fileName);

	// Create temp list file
	const listFileName = `merge_list_${Date.now()}.txt`;
	const listFilePath = path.join(scriptDir, listFileName);

	try {
		const pathsToConvert = files.map(f => path.join(basePath, f.path)).join('\n');
		fs.writeFileSync(listFilePath, pathsToConvert, 'utf-8');
	} catch (e) {
		new Notice('임시 리스트 파일 생성 실패', 5000);
		console.error(e);
		return;
	}

	new Notice(`${files.length}개 파일 병합 시작 (HWP)`, 3000);

	return new Promise((resolve) => {
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

		pythonProcess.on('close', (code: number) => {
			// Clean up list file
			try {
				if (fs.existsSync(listFilePath)) fs.unlinkSync(listFilePath);
			} catch (e) { console.error('Failed to delete temp list', e); }

			if (code === 0) {
				new Notice(`병합 저장 완료: ${fileName}`, 5000);
			} else {
				new Notice('병합 변환 중 오류가 발생했습니다.', 5000);
			}
			resolve();
		});
	});
}
