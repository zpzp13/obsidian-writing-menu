import { MarkdownView, Platform, TFile, normalizePath } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { PagedWritingView, PAGED_WRITING_VIEW_TYPE } from '../paged/PagedWritingView';
import { getFs, joinPath } from '../utils/nodeShims';
import { wmT } from '../i18n/index';
import { parseMarkdownDocument, applyContentPolicy, mergeDocuments } from './MarkdownDocument';
import type { SourceFormatting } from './MarkdownDocument';
import type { ContentPolicy, DocumentFormat, DocumentResource, EncodeOptions, GeneratedDocument, HwpxTemplate, TextRun, TransferDocument } from './DocumentModel';
import { KordocDocumentEngine } from './KordocEngine';
import type { DocumentEngine } from './DocumentEngine';
import { EXPORT_IMAGE_EXTENSIONS, prepareExportImage } from './ExportImages';
import { projectExportStyles } from './ProjectExportStyles';
import { InstalledFontCache } from '../toolbar/InstalledFontCache';
import { exportFontWeights } from './ExportFontWeights';

export interface ExportArtifact { file: TFile | null; name: string; generated: GeneratedDocument; notices?: string[] }
export function isAbsoluteExportPath(path: string): boolean { return Platform.isWin ? /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(path) : path.startsWith('/'); }
export function defaultTemplateEnabled(path: string): boolean { return Platform.isDesktop && /\.hwpx$/i.test(path.trim()) && isAbsoluteExportPath(path.trim()); }
export function exportFileName(name: string, format: DocumentFormat): string {
	const basename = name.toLowerCase().endsWith(`.${format}`) ? name.slice(0, -format.length - 1) : name;
	if ([...basename].some(char => char.charCodeAt(0) < 32) || !basename.trim() || /[\\/<>:"|?*]/.test(basename) || /[. ]$/.test(basename) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(basename) || basename === '.' || basename === '..') throw new Error(wmT('올바른 파일 이름을 입력해 주세요.'));
	return `${basename}.${format}`;
}
export async function flushExportSources(plugin: WritingMenuPlugin, files: TFile[]): Promise<void> {
	const paths = new Set(files.map(file => file.path));
	for (const type of ['markdown', PAGED_WRITING_VIEW_TYPE]) for (const leaf of plugin.app.workspace.getLeavesOfType(type)) {
		const view = leaf.view;
		if ((view instanceof MarkdownView || view instanceof PagedWritingView) && view.file && paths.has(view.file.path)) await view.save();
	}
}
export class ExportService {
	private cache = new Map<string, { signature: string; generated: GeneratedDocument }>();
	private fontCache = new InstalledFontCache();
	constructor(private plugin: WritingMenuPlugin, readonly engine: DocumentEngine = new KordocDocumentEngine(plugin)) {}
	dispose(): void { this.cache.clear(); this.engine.dispose(); }
	cancelPreview(): void { this.engine.cancelGeneration?.(); }
	async loadTemplate(path: string): Promise<HwpxTemplate> {
		if (!/\.hwpx$/i.test(path)) throw new Error(wmT('HWP 템플릿은 한글에서 HWPX로 저장한 뒤 선택해 주세요.'));
		if (!isAbsoluteExportPath(path)) throw new Error(wmT('템플릿 파일의 전체 경로를 입력해 주세요.'));
		const fs = await getFs(); if (!fs.existsSync(path)) throw new Error(wmT('템플릿 파일을 찾을 수 없습니다.'));
		return this.engine.template(new Uint8Array(fs.readFileSync(path)));
	}
	private async source(file: TFile, imagePolicy?: ContentPolicy): Promise<{ document: TransferDocument; signature: string }> {
		const vault = this.plugin.app.vault, settings = this.plugin.settings, text = await vault.read(file);
		const formatting: SourceFormatting = { inline: settings.pagedInlineFormats?.[file.path], colors: settings.pagedTextColors?.[file.path], backgrounds: settings.pagedTextBackgrounds?.[file.path], alignments: settings.pagedParagraphAlignments?.[file.path] };
		const document = parseMarkdownDocument(text, file.path, formatting), images = new Map<string, DocumentResource>(), imageStamps: string[] = [];
		if (imagePolicy) {
			const visible = applyContentPolicy(document, imagePolicy, 'hwpx');
			const visibleImages = new Set(visible.blocks.flatMap(block => block.kind === 'table' ? block.rows.flat(2) : block.runs).concat(Object.values(visible.footnotes).flat()).map(run => run.image).filter(Boolean));
			const allRuns: TextRun[] = document.blocks.flatMap(block => block.kind === 'table' ? block.rows.flat(2) : block.runs).concat(Object.values(document.footnotes).flat());
			for (const run of allRuns) {
				if (!run.image || !visibleImages.has(run.image)) continue;
				if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(run.image)) throw new Error(wmT('이미지는 볼트 안의 PNG·JPEG·GIF·BMP·WebP·SVG 파일을 지원합니다.'));
				const originalLink = run.image.split('#')[0];
				let link = originalLink;
				try { link = decodeURIComponent(originalLink); } catch { /* Literal % is valid in a vault filename. */ }
				const target = this.plugin.app.metadataCache.getFirstLinkpathDest(link, file.path)
					?? vault.getAbstractFileByPath(normalizePath(`${file.parent?.path ? file.parent.path + '/' : ''}${link}`));
				if (!(target instanceof TFile)) throw new Error(wmT('이미지 파일을 찾을 수 없습니다: {0}', link));
				const extension = target.extension.toLowerCase();
				if (!EXPORT_IMAGE_EXTENSIONS.has(extension)) throw new Error(wmT('이미지는 볼트 안의 PNG·JPEG·GIF·BMP·WebP·SVG 파일을 지원합니다.'));
				if (!images.has(target.path)) {
					const bytes = new Uint8Array(await vault.readBinary(target));
					if (bytes.length > 20 * 1024 * 1024) throw new Error(wmT('이미지가 너무 큽니다: {0}', target.name));
					try {
						const image = await prepareExportImage(bytes, extension, window.document);
						images.set(target.path, { id: target.path, ...image });
					} catch (error) { throw new Error(wmT('이미지를 불러오지 못했습니다: {0} ({1})', target.path, error instanceof Error ? error.message : String(error))); }
					imageStamps.push(`${target.path}:${target.stat.mtime}:${target.stat.size}`);
				}
				run.image = target.path;
			}
		}
		document.resources = [...images.values()];
		return { document, signature: JSON.stringify([text, formatting, imageStamps]) };
	}
	async generate(files: TFile[], format: DocumentFormat, policy: ContentPolicy, options: EncodeOptions, merged: boolean, mergedName: string, signal?: AbortSignal): Promise<ExportArtifact[]> {
		signal?.throwIfAborted();
		if (!files.length) throw new Error(wmT('내보낼 문서를 선택해 주세요.'));
		await flushExportSources(this.plugin, files);
		signal?.throwIfAborted();
		const effectiveOptions: EncodeOptions = { ...options, elementStyles: policy.formatting && format !== 'txt' ? projectExportStyles(window.document, options.style) : undefined };
		const styles = [effectiveOptions.style, ...(effectiveOptions.elementStyles?.headings ?? []), ...(effectiveOptions.elementStyles ? [effectiveOptions.elementStyles.footnote] : [])];
		let notices: string[] = [];
		if (format !== 'txt' && styles.some(style => style.fontWeight !== 400 && style.fontWeight !== 700)) {
			const faces = typeof window === 'undefined' ? [] : await this.fontCache.loadFaces(window.document);
			const resolved = exportFontWeights(effectiveOptions, faces);
			signal?.throwIfAborted(); effectiveOptions.fontFaces = resolved.fontFaces; notices = resolved.notices;
		}
		const snapshots = [];
		for (const file of files) { signal?.throwIfAborted(); snapshots.push(await this.source(file, policy.images === 'keep' && format !== 'txt' ? policy : undefined)); }
		const jobs = merged ? [{ file: null, name: mergedName, document: mergeDocuments(snapshots.map(item => item.document)), signature: snapshots.map(item => item.signature).join('\u0000') }]
			: snapshots.map((snapshot, index) => ({ file: files[index], name: files.length === 1 && mergedName ? mergedName : files[index].basename, ...snapshot }));
		const artifacts: ExportArtifact[] = [];
		for (const job of jobs) {
			signal?.throwIfAborted();
			const name = exportFileName(job.file && job.name === job.file.basename ? `${job.name}.${format}` : job.name, format), key = job.file?.path ?? '*merged*';
			const signature = JSON.stringify([job.signature, policy, format, name, effectiveOptions]);
			const cached = this.cache.get(key);
			const generated = cached?.signature === signature ? cached.generated : await this.engine.generate(applyContentPolicy(job.document, policy, format), format, { ...effectiveOptions, title: job.name });
			signal?.throwIfAborted();
			this.cache.set(key, { signature, generated }); artifacts.push({ file: job.file, name, generated, notices });
		}
		return artifacts;
	}
	async write(artifacts: ExportArtifact[], directory: string, format: DocumentFormat, root: string, hierarchy: boolean, templatePath: string, overwrite = false): Promise<{ saved: string[]; error?: string }> {
		if (!Platform.isDesktop || !isAbsoluteExportPath(directory)) throw new Error(wmT('저장 폴더의 전체 경로를 입력해 주세요.'));
		const fs = await getFs(), paths = new Set<string>();
		const canonical = (path: string): string => { const resolved = fs.existsSync(path) ? fs.realpathSync(path) : path.replace(/[\\/]+/g, '/'); return Platform.isWin ? resolved.toLowerCase() : resolved; };
		const original = templatePath && fs.existsSync(templatePath) ? canonical(templatePath) : '';
		const outputs = artifacts.map(artifact => {
			const relative = artifact.file && hierarchy ? artifact.file.path.slice(root ? root.length + 1 : 0).split('/').slice(0, -1) : [];
			if (relative.some(part => part === '..' || part === '.' || part.includes(':'))) throw new Error(wmT('볼트 내부 폴더를 선택해 주세요.'));
			const folder = joinPath(directory, ...relative), path = joinPath(folder, exportFileName(artifact.name, format)), identity = canonical(path);
			if (identity === original) throw new Error(wmT('템플릿 원본과 다른 저장 경로를 선택해 주세요.'));
			if (paths.has(identity)) throw new Error(wmT('같은 이름의 출력 파일이 있습니다. 폴더 구조를 유지하거나 파일 이름을 바꿔 주세요.'));
			if (!overwrite && fs.existsSync(path)) throw new Error(wmT('출력 파일이 이미 있습니다: {0}', path));
			paths.add(identity); return { ...artifact, folder, path };
		});
		const saved: string[] = [];
		try { for (const output of outputs) { if (!fs.existsSync(output.folder)) fs.mkdirSync(output.folder, { recursive: true }); fs.writeFileSync(output.path, output.generated.bytes, { flag: overwrite ? 'w' : 'wx' }); saved.push(output.path); } }
		catch (error) { return { saved, error: error instanceof Error ? error.message : String(error) }; }
		return { saved };
	}
}
