import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
export const fixtureSources = [ 'DocumentModel', 'MarkdownDocument', 'HwpxTemplate', 'StyledHwpxDocument', 'DocxDocument', 'DocumentCodecs', 'ExportDefaults', 'ExportSelection', 'ExportService' ];
export async function exportFixture(browser = false, extra = '') {
    const code = fixtureSources.map(name => `export * from './src/export/${name}';`).join('\n') + (browser ? "\nexport * from './src/export/DocumentExportModal';" : '') + extra;
    const result = await build({ stdin: { contents: code, resolveDir: process.cwd(), sourcefile: 'export-fixture.ts', loader: 'ts' }, bundle: true, write: false, format: browser ? 'iife' : 'cjs', globalName: 'ExportFixture', platform: browser ? 'browser' : 'node', target: 'chrome124', plugins: [{ name: 'obsidian-export-contract', setup(b) {
        b.onResolve({filter: /^obsidian$/}, () => ({path:'obsidian',namespace:'test'}));
        b.onResolve({filter: /\/paged\/PagedWritingView$/}, () => ({path:'paged',namespace:'test'}));
        b.onResolve({filter: /\/utils\/nodeShims$/}, () => ({path:'node',namespace:'test'}));
        b.onResolve({filter: /\.\/DesktopExport$/}, () => ({path:'picker',namespace:'test'}));
        b.onLoad({filter: /.*/,namespace:'test'}, ({path:p}) => ({contents: p === 'obsidian' ? `
            export const { App, Modal, Notice, Platform, TFile, TFolder, MarkdownView, normalizePath, setIcon, addIcon } = globalThis.__exportHost;
        ` : p==='paged' ? `export const {PagedWritingView}=globalThis.__exportHost; export const PAGED_WRITING_VIEW_TYPE='paged';`
        : p==='node' ? `export const getFs = async()=>globalThis.__exportHost.fs; export const joinPath=(...parts)=>parts.filter(Boolean).join(globalThis.__exportHost.Platform.isWin?'\\\\':'/');`
        : `export const pickExternalPath=async(kind)=>globalThis.__exportHost.pick(kind);` }));
    } }], define: { __WM_DOCUMENT_WORKER_SOURCE__: browser ? JSON.stringify(fs.readFileSync('.codex-tmp/export-worker-smoke.js','utf8')) : '""' } });
    if(browser) return result.outputFiles[0].text;
    const filename=path.resolve('.codex-tmp/export-fixture.cjs');fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,result.outputFiles[0].text);return createRequire(import.meta.url)(filename);
}
export function nodeExportHost() {
    const host={ Platform: {isDesktop:true,isWin:false,isMacOS:true}, TFile:class{}, TFolder:class{}, MarkdownView:class{}, PagedWritingView:class{}, normalizePath:p=>p.replace(/\\/g,'/'), Notice:class{}, fs:{}, pick:async()=>null };
    globalThis.__exportHost=host;return host;
}
