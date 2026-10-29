import { wmT } from '../i18n/index';
import { projectObsidianComments } from '../comments/ObsidianComments';
import { Platform, TFile, Notice, WorkspaceLeaf, MarkdownView } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { PagedWritingView } from '../paged/PagedWritingView';
import { pickExternalPath } from './DesktopExport';

import { ExportService, defaultTemplateEnabled } from './ExportService';
import { exportDefaults } from './ExportDefaults';
import { isInExportFolder } from './ExportSelection';
import type { DocumentFormat } from './DocumentModel';

export function defaultUseTemplate(plugin: WritingMenuPlugin): boolean {
    return plugin.settings.documentExportDefaultPreset === 'template' && defaultTemplateEnabled(plugin.settings.hwpTemplatePath || '');
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

export async function copyWithOptions(plugin: WritingMenuPlugin, leaf: WorkspaceLeaf) {
    const view = leaf.view;
    if (!(view instanceof MarkdownView) && !(view instanceof PagedWritingView)) return;
    if (!plugin.shouldApplyToFile(view.file)) return;
    const source = view instanceof MarkdownView ? view.editor.getValue() : view.getEditableData();
    let bodyText = plugin.cleanMarkdownFrontmatter(plugin.settings.copyExcludeComments !== false ? projectObsidianComments(source).text : source);
    if (plugin.settings.copyExcludeHeadings) bodyText = stripMarkdownHeadings(bodyText);
    let lines = bodyText.split('\n');
    if (plugin.settings.copyExcludeFootnotes) {
        lines = lines.filter(line => !line.trim().match(/^\[\^[^\]]+\]:/));
        lines = lines.map(line => line.replace(/\[\^[^\]]+\]/g, ''));
    }
    await navigator.clipboard.writeText(lines.join('\n').trim());
    new Notice(wmT('클립보드에 복사했습니다.'));
}

/** Compatibility entrypoints use the same codecs as the unified popup. */
async function convert(plugin: WritingMenuPlugin, target: string | TFile[], directory: string, format: DocumentFormat, indent: boolean, headings: boolean, useTemplate: boolean, name?: string, merged = false): Promise<boolean> {
    const service = new ExportService(plugin);
    try {
        if (!Platform.isDesktop) throw new Error(wmT('데스크톱 전용 기능입니다.'));
        const path = directory.trim() || await openFolderPicker(plugin);
        if (!path) return false;
        const files = typeof target === 'string' ? plugin.app.vault.getMarkdownFiles().filter(file => isInExportFolder(file.path, target)).sort((a,b) => a.path.localeCompare(b.path,undefined,{numeric:true})) : target;
        const defaults = exportDefaults(plugin.settings);
        defaults.content.spaceIndent = indent; defaults.content.headings = headings ? 'exclude' : 'text';
        const template = format === 'hwpx' && useTemplate ? await service.loadTemplate(plugin.settings.hwpTemplatePath) : undefined;
        const style = template?.styles.find(item => item.id === template.defaultStyleId)?.style ?? defaults.style;
        const artifacts = await service.generate(files, format, defaults.content, {style, title:name || '', template}, merged, name || '');
        const result = await service.write(artifacts, path, format, typeof target === 'string' ? target : '', typeof target === 'string' && !merged && (plugin.settings.exportPreserveFolderStructure ?? false), plugin.settings.hwpTemplatePath || '', true);
        if (result.error) throw new Error(wmT('{0}개 저장 후 실패: {1}', result.saved.length, result.error));
        new Notice(wmT('저장 완료: {0}개 파일', result.saved.length)); return true;
    } catch(error) { console.error('Writing Menu export failed:',error); new Notice(wmT('내보내기 실패: {0}', error instanceof Error ? error.message : String(error)),8000); return false; }
    finally {service.dispose();}
}
export function convertToHwpx(plugin: WritingMenuPlugin, file: TFile, name: string, path: string, indent: boolean, headings = false, template = defaultUseTemplate(plugin)): Promise<boolean> {return convert(plugin,[file],path,'hwpx',indent,headings,template,name);}
export function convertToTxt(plugin: WritingMenuPlugin, file: TFile, name: string, path: string, indent: boolean, headings = false): Promise<boolean> {return convert(plugin,[file],path,'txt',indent,headings,false,name);}
export async function convertFolderToHwpx(plugin: WritingMenuPlugin, target: string, path: string, indent: boolean, headings = false, template = defaultUseTemplate(plugin)): Promise<void> {await convert(plugin,target,path,'hwpx',indent,headings,template);}
export async function convertFolderToHwpxMerged(plugin: WritingMenuPlugin, target: string, path: string, name: string, indent: boolean, headings = false, template = defaultUseTemplate(plugin)): Promise<void> {await convert(plugin,target,path,'hwpx',indent,headings,template,name,true);}
export async function convertFilesToHwpx(plugin: WritingMenuPlugin, target: TFile[], path: string, indent: boolean, headings = false, template = defaultUseTemplate(plugin)): Promise<void> {await convert(plugin,target,path,'hwpx',indent,headings,template);}
export async function convertFilesToHwpxMerged(plugin: WritingMenuPlugin, target: TFile[], path: string, name: string, indent: boolean, headings = false, template = defaultUseTemplate(plugin)): Promise<void> {await convert(plugin,target,path,'hwpx',indent,headings,template,name,true);}
export async function convertFolderToTxt(plugin: WritingMenuPlugin, target: string, path: string, indent: boolean, headings = false): Promise<void> {await convert(plugin,target,path,'txt',indent,headings,false);}
export async function convertFolderToTxtMerged(plugin: WritingMenuPlugin, target: string, path: string, name: string, indent: boolean, headings = false): Promise<void> {await convert(plugin,target,path,'txt',indent,headings,false,name,true);}
export async function convertFilesToTxt(plugin: WritingMenuPlugin, target: TFile[], path: string, indent: boolean, headings = false): Promise<void> {await convert(plugin,target,path,'txt',indent,headings,false);}
export async function convertFilesToTxtMerged(plugin: WritingMenuPlugin, target: TFile[], path: string, name: string, indent: boolean, headings = false): Promise<void> {await convert(plugin,target,path,'txt',indent,headings,false,name,true);}
