import { wmT } from '../i18n/index';
import { buildCopyText, withoutFrontmatter } from './CopyText';
import { getWritingDocumentForView } from '../writing/WritingDocument';
import { Notice, WorkspaceLeaf } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { pickExternalPath } from './DesktopExport';


export function openFolderPicker(_plugin: WritingMenuPlugin): Promise<string | null> { return pickExternalPath('folder'); }
export function openTemplatePicker(_plugin: WritingMenuPlugin): Promise<string | null> { return pickExternalPath('file'); }
export function runPicker(_plugin: WritingMenuPlugin, mode: 'folder' | 'file'): Promise<string | null> { return pickExternalPath(mode); }
export function getDefaultExportPath(plugin: WritingMenuPlugin): string { return plugin.settings.hwpExportPath || ''; }

export function cleanMarkdownFrontmatter(_plugin: WritingMenuPlugin, content: string): string {
    return withoutFrontmatter(content).trim();
}

export function applySpaceIndent(_plugin: WritingMenuPlugin, text: string): string {
    return text.split('\n').map(line => line.trim() ? ' ' + line : line).join('\n');
}

export async function copyWithOptions(plugin: WritingMenuPlugin, leaf: WorkspaceLeaf) {
    const document = getWritingDocumentForView(leaf.view);
    if (!document || !plugin.shouldApplyToFile(document.file)) return;
    const s = plugin.settings;
    await navigator.clipboard.writeText(buildCopyText(document.read(), {
        includeComments: s.copyIncludeComments, includeHeadings: s.copyIncludeHeadings,
        includeFootnotes: s.copyIncludeFootnotes, includeMarkdown: s.copyIncludeMarkdown, includeHtml: s.copyIncludeHtml,
    }));
    new Notice(wmT('클립보드에 복사했습니다.'));
}
