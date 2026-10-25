import { wmT } from '../i18n/index';
import { Platform, TFile, Notice, WorkspaceLeaf, MarkdownView, normalizePath } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { joinPath, getFs } from '../utils/nodeShims';
import { PagedWritingView, PAGED_WRITING_VIEW_TYPE } from '../paged/PagedWritingView';
import { createPlainHwpx } from './HwpxDocument';
import { fillHancomTemplate, pickExternalPath } from './DesktopExport';
import type { TemplateDocument } from './DesktopExport';

type ExportFormat = 'hwpx' | 'txt';

export function defaultUseTemplate(plugin: WritingMenuPlugin): boolean {
    return Platform.isDesktop && Platform.isWin && !!plugin.settings.hwpTemplatePath.trim();
}

export function openFolderPicker(_plugin: WritingMenuPlugin): Promise<string | null> { return pickExternalPath('folder'); }
export function openTemplatePicker(_plugin: WritingMenuPlugin): Promise<string | null> { return pickExternalPath('file'); }
export function runPicker(_plugin: WritingMenuPlugin, mode: 'folder' | 'file'): Promise<string | null> { return pickExternalPath(mode); }
export function getDefaultExportPath(plugin: WritingMenuPlugin): string { return plugin.settings.hwpExportPath || ''; }

export function cleanMarkdownFrontmatter(_plugin: WritingMenuPlugin, content: string): string {
    return withoutFrontmatter(content).trim();
}

function withoutFrontmatter(content: string): string {
    // Consume the metadata delimiter's line ending, never the manuscript's blank lines.
    return content.replace(/\r\n?/g, '\n').replace(/^---[ \t]*\n(?:.*?\n)?---[ \t]*(?:\n|$)/s, '');
}

function stripMarkdownHeadings(content: string, trimResult = true): string {
    const lines = content.split('\n');
    const result: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^\s{0,3}#{1,6}(?:\s+|$)/.test(line)) continue;
        const nextLine = lines[index + 1];
        if (line.trim() && nextLine !== undefined && /^\s{0,3}(?:=+|-+)\s*$/.test(nextLine)) { index += 1; continue; }
        result.push(line);
    }
    const text = result.join('\n');
    return trimResult ? text.trim() : text;
}

export function removeHeadings(plugin: WritingMenuPlugin, content: string): string {
    return stripMarkdownHeadings(cleanMarkdownFrontmatter(plugin, content));
}

export function applySpaceIndent(_plugin: WritingMenuPlugin, text: string): string {
    return text.split('\n').map(line => line.trim() ? ' ' + line : line).join('\n');
}

function exportText(plugin: WritingMenuPlugin, content: string, indent: boolean, excludeHeadings: boolean): string {
    let text = withoutFrontmatter(content);
    if (excludeHeadings) text = stripMarkdownHeadings(text, false);
    return indent ? applySpaceIndent(plugin, text) : text;
}

export async function copyWithOptions(plugin: WritingMenuPlugin, leaf: WorkspaceLeaf) {
    const view = leaf.view;
    if (!(view instanceof MarkdownView) && !(view instanceof PagedWritingView)) return;
    if (!plugin.shouldApplyToFile(view.file)) return;
    const source = view instanceof MarkdownView ? view.editor.getValue() : view.getEditableData();
    let bodyText = plugin.cleanMarkdownFrontmatter(source);
    if (plugin.settings.copyExcludeHeadings) bodyText = stripMarkdownHeadings(bodyText);
    let lines = bodyText.split('\n');
    if (plugin.settings.copyExcludeFootnotes) {
        lines = lines.filter(line => !line.trim().match(/^\[\^[^\]]+\]:/));
        lines = lines.map(line => line.replace(/\[\^[^\]]+\]/g, ''));
    }
    await navigator.clipboard.writeText(lines.join('\n').trim());
    new Notice(wmT('클립보드에 복사했습니다.'));
}

function isAbsolute(path: string): boolean {
    return Platform.isWin ? /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(path) : path.startsWith('/');
}

async function destination(plugin: WritingMenuPlugin, path: string): Promise<string | null> {
    if (!Platform.isDesktop) throw new Error(wmT('데스크톱 전용 기능입니다.'));
    const selected = path.trim() || await openFolderPicker(plugin);
    if (!selected) return null;
    if (!isAbsolute(selected)) throw new Error(wmT('저장 폴더의 전체 경로를 입력해 주세요.'));
    return selected;
}

function outputPath(directory: string, name: string, format: ExportFormat): string {
    if (!name.trim() || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error(wmT('올바른 파일 이름을 입력해 주세요.'));
    const extension = '.' + format;
    return joinPath(directory, (name.toLowerCase().endsWith(extension) ? name.slice(0, -extension.length) : name) + extension);
}

function exportError(error: unknown): void {
    console.error('Writing Menu export failed:', error);
    new Notice(wmT('내보내기 실패: {0}', error instanceof Error ? error.message : String(error)), 8000);
}

/** Flush only the documents being exported before reading their vault contents. */
async function saveOpenSources(plugin: WritingMenuPlugin, paths: string[]): Promise<void> {
    const selected = new Set(paths);
    for (const type of ['markdown', PAGED_WRITING_VIEW_TYPE]) {
        for (const leaf of plugin.app.workspace.getLeavesOfType(type)) {
            const view = leaf.view;
            if ((view instanceof MarkdownView || view instanceof PagedWritingView) && view.file && selected.has(view.file.path)) await view.save();
        }
    }
}

async function writeDocuments(plugin: WritingMenuPlugin, documents: TemplateDocument[], format: ExportFormat, useTemplate: boolean): Promise<void> {
    if (!documents.length) return;
    if (format === 'hwpx' && useTemplate) {
        if (!Platform.isWin) throw new Error(wmT('템플릿 적용은 Windows에서만 사용할 수 있습니다.'));
        const template = plugin.settings.hwpTemplatePath.trim();
        if (!template) throw new Error(wmT('먼저 내보내기 설정에서 템플릿 파일을 지정해 주세요.'));
        const fs = await getFs();
        if (!fs.existsSync(template)) throw new Error(wmT('템플릿 파일을 찾을 수 없습니다.'));
        const original = fs.realpathSync(template).toLowerCase();
        if (documents.some(document => fs.existsSync(document.path) && fs.realpathSync(document.path).toLowerCase() === original)) {
            throw new Error(wmT('템플릿 원본과 다른 저장 경로를 선택해 주세요.'));
        }
        await fillHancomTemplate(template, documents);
    } else {
        const fs = await getFs();
        for (const document of documents) {
            if (format === 'hwpx') fs.writeFileSync(document.path, createPlainHwpx(document.text));
            else fs.writeFileSync(document.path, document.text, 'utf-8');
        }
    }
}

async function makeDirectory(directory: string): Promise<void> {
    const fs = await getFs();
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
}

async function exportSingle(plugin: WritingMenuPlugin, file: TFile, fileName: string, exportPath: string, indent: boolean, excludeHeadings: boolean, format: ExportFormat, useTemplate = false): Promise<boolean> {
    try {
        const directory = await destination(plugin, exportPath);
        if (!directory) return false;
        const path = outputPath(directory, fileName, format);
        await saveOpenSources(plugin, [file.path]);
        const text = exportText(plugin, await plugin.app.vault.read(file), indent, excludeHeadings);
        await makeDirectory(directory);
        await writeDocuments(plugin, [{ path, text }], format, useTemplate);
        new Notice(wmT('저장 완료: {0}', path), 3000);
        return true;
    } catch (error) { exportError(error); return false; }
}

export function convertToHwpx(plugin: WritingMenuPlugin, file: TFile, fileName: string, exportPath: string, indent: boolean, excludeHeadings = false, useTemplate = defaultUseTemplate(plugin)): Promise<boolean> {
    return exportSingle(plugin, file, fileName, exportPath, indent, excludeHeadings, 'hwpx', useTemplate);
}
export function convertToTxt(plugin: WritingMenuPlugin, file: TFile, fileName: string, exportPath: string, indent: boolean, excludeHeadings = false): Promise<boolean> {
    return exportSingle(plugin, file, fileName, exportPath, indent, excludeHeadings, 'txt');
}

/** Sources stay inside the vault. Only chosen external destinations use Node fs. */
async function vaultMarkdownPaths(plugin: WritingMenuPlugin, folderPath: string): Promise<string[]> {
    const folder = normalizePath(folderPath).replace(/^\/+|\/+$/g, '');
    if (folder.includes(':') || folder.split('/').includes('..')) throw new Error(wmT('볼트 내부 폴더를 선택해 주세요.'));
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

async function exportMany(plugin: WritingMenuPlugin, target: string | TFile[], exportPath: string, indent: boolean, excludeHeadings: boolean, format: ExportFormat, useTemplate: boolean, mergedName?: string): Promise<void> {
    try {
        const directory = await destination(plugin, exportPath);
        if (!directory) return;
        const root = typeof target === 'string' ? normalizePath(target).replace(/^\/+|\/+$/g, '') : '';
        const sources = typeof target === 'string' ? await vaultMarkdownPaths(plugin, root) : target;
        if (!sources.length) { new Notice(wmT('내보낼 마크다운 파일이 없습니다.')); return; }
        await saveOpenSources(plugin, sources.map(source => typeof source === 'string' ? source : source.path));
        const documents: TemplateDocument[] = [];
        const contents: string[] = [];
        for (const source of sources) {
            const path = typeof source === 'string' ? source : source.path;
            const content = typeof source === 'string' ? await plugin.app.vault.adapter.read(source) : await plugin.app.vault.read(source);
            const text = exportText(plugin, content, indent, excludeHeadings);
            if (mergedName !== undefined) { contents.push(text); continue; }
            const relative = typeof target === 'string' && root ? path.slice(root.length + 1) : path;
            const slash = relative.lastIndexOf('/');
            const folder = typeof target === 'string' && slash >= 0 ? joinPath(directory, relative.slice(0, slash)) : directory;
            await makeDirectory(folder);
            documents.push({ path: outputPath(folder, relative.slice(slash + 1).replace(/\.md$/i, '') + '.' + format, format), text });
        }
        if (mergedName !== undefined) {
            await makeDirectory(directory);
            documents.push({ path: outputPath(directory, mergedName, format), text: contents.join('\n\n') });
        }
        await writeDocuments(plugin, documents, format, useTemplate);
        new Notice(wmT('내보내기 완료: {0}개 파일', documents.length), 5000);
    } catch (error) { exportError(error); }
}

export function convertFolderToHwpx(plugin: WritingMenuPlugin, folder: string, path: string, indent: boolean, headings = false, template = defaultUseTemplate(plugin)): Promise<void> { return exportMany(plugin, folder, path, indent, headings, 'hwpx', template); }
export function convertFilesToHwpx(plugin: WritingMenuPlugin, files: TFile[], path: string, indent: boolean, headings = false, template = defaultUseTemplate(plugin)): Promise<void> { return exportMany(plugin, files, path, indent, headings, 'hwpx', template); }
export function convertFolderToHwpxMerged(plugin: WritingMenuPlugin, folder: string, path: string, name: string, indent: boolean, headings = false, template = defaultUseTemplate(plugin)): Promise<void> { return exportMany(plugin, folder, path, indent, headings, 'hwpx', template, name); }
export function convertFilesToHwpxMerged(plugin: WritingMenuPlugin, files: TFile[], path: string, name: string, indent: boolean, headings = false, template = defaultUseTemplate(plugin)): Promise<void> { return exportMany(plugin, files, path, indent, headings, 'hwpx', template, name); }
export function convertFolderToTxt(plugin: WritingMenuPlugin, folder: string, path: string, indent: boolean, headings = false): Promise<void> { return exportMany(plugin, folder, path, indent, headings, 'txt', false); }
export function convertFilesToTxt(plugin: WritingMenuPlugin, files: TFile[], path: string, indent: boolean, headings = false): Promise<void> { return exportMany(plugin, files, path, indent, headings, 'txt', false); }
export function convertFolderToTxtMerged(plugin: WritingMenuPlugin, folder: string, path: string, name: string, indent: boolean, headings = false): Promise<void> { return exportMany(plugin, folder, path, indent, headings, 'txt', false, name); }
export function convertFilesToTxtMerged(plugin: WritingMenuPlugin, files: TFile[], path: string, name: string, indent: boolean, headings = false): Promise<void> { return exportMany(plugin, files, path, indent, headings, 'txt', false, name); }
