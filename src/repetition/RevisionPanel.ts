import { wmT } from '../i18n/index';
import { markdownFilesInFolder } from '../utils/vaultFiles';
import { Component, Notice } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { getWritingDocument, getOpenWritingDocuments, type WritingDocument } from '../writing/WritingDocument';
import { analyzeParagraphs } from './ParagraphAnalysis';
import { analyzeSentences } from './SentenceAnalysis';
import { analyzeText, isMorphAnalysisSupported } from './MorphAnalyzer';
import { getGaruAssetStatus, downloadGaruAssets } from './GaruAssets';
import { classifyTokens } from './analyzer';
import { projectObsidianComments } from '../comments/ObsidianComments';
import { RevisionDashboard, type RevisionFile } from './RevisionDashboard';

interface Result { files: RevisionFile[]; signature: string; morph: boolean; scope: 'document' | 'project'; context: string }
const cache = new WeakMap<WritingMenuPlugin, Result>();

/** Source acquisition and analysis lifecycle are independent of dashboard rendering. */
export class RevisionPanel extends Component {
	private scope: 'document' | 'project';
	private result: Result | null;
	private request = 0;
	private disposed = false;
	private busy = false;
	private timer = 0;
	private dirty = false;
	private dashboard: RevisionDashboard;
	constructor(container: HTMLElement, private plugin: WritingMenuPlugin) {
		super(); this.result = cache.get(plugin) ?? null; this.scope = this.result?.scope ?? 'document';
		this.dashboard = new RevisionDashboard(container.createDiv({ cls: 'wm-revision-root' }), {
			scope: value => { if (!this.busy) { this.scope = value; this.result = null; void this.analyze(false); } },
			refresh: () => void this.analyze(isMorphAnalysisSupported()),
			settings: () => plugin.openSettings('repetition'),
			navigate: (file, from, to) => this.navigate(file, from, to),
		});
	}
	onload(): void {
		this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => this.schedule()));
		this.registerEvent(this.plugin.app.workspace.on('editor-change', () => this.schedule()));
		this.registerEvent(this.plugin.app.workspace.on('quick-preview', () => this.schedule()));
		this.render(); void this.analyze(false);
	}
	onunload(): void { this.disposed = true; this.request++; window.clearTimeout(this.timer); this.dashboard.destroy(); }
	private context(document = getWritingDocument(this.plugin)): string {
		if (!document) return '';
		return this.scope === 'document' ? document.path : this.plugin.projectContext.getProjectForFile(document.file)?.rootFolder ?? '';
	}
	private schedule(): void {
		window.clearTimeout(this.timer);
		if (this.busy) this.dirty = true;
		this.timer = window.setTimeout(() => {
			if (!this.disposed && !this.busy && (this.scope === 'document' || this.context() !== this.result?.context)) void this.analyze(false);
		}, 700);
	}
	private render(): void {
		const document = getWritingDocument(this.plugin), project = document ? this.plugin.projectContext.getProjectForFile(document.file) : null;
		const result = this.result?.context === this.context(document) ? this.result : null;
		this.dashboard.update({ files: result?.files ?? [], morph: result?.morph ?? false, busy: this.busy, scope: this.scope,
			title: this.scope === 'project' ? project?.name || project?.rootFolder?.split('/').pop() || wmT("프로젝트를 선택해 주세요.") : document?.file.basename ?? wmT("원고를 열어 주세요.") });
	}
	private async sources(document: WritingDocument): Promise<Array<{ path: string; source: string }>> {
		if (this.scope === 'document') return [{ path: document.path, source: document.read() }];
		const project = this.plugin.projectContext.getProjectForFile(document.file);
		if (!project?.manuscriptFolder) throw new Error(wmT("프로젝트 설정에서 본문 폴더를 지정해 주세요."));
		const files = markdownFilesInFolder(this.plugin.app.vault, project.manuscriptFolder).filter(file => this.plugin.projectContext.getProjectForFile(file)?.rootFolder === project.rootFolder
			&& !file.path.startsWith(`${this.plugin.settings.snapshotStoragePath}/`));
		const order = (file: typeof files[number]) => { const value: unknown = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter?.sort_index; return typeof value === 'number' && Number.isFinite(value) ? value : Infinity; };
		files.sort((a, b) => order(a) - order(b) || a.path.localeCompare(b.path, 'ko', { numeric: true }));
		const out: Array<{ path: string; source: string }> = [], open = new Map(getOpenWritingDocuments(this.plugin).map(document => [document.path, document]));
		for (const file of files) {
			if (this.disposed) break;
			out.push({ path: file.path, source: open.get(file.path)?.read() ?? await this.plugin.app.vault.cachedRead(file) });
		}
		return out;
	}
	private async analyze(morph: boolean): Promise<void> {
		if (this.busy || this.disposed) return;
		const document = getWritingDocument(this.plugin);
		if (!document) { this.result = null; this.render(); return; }
		const request = ++this.request, scope = this.scope, context = this.context(document), options = { ...this.plugin.settings.paragraphAnalysis }, signature = JSON.stringify(options);
		this.busy = true; this.dirty = false; this.render();
		try {
			if (morph && await getGaruAssetStatus(this.plugin) !== 'current') await downloadGaruAssets(this.plugin, step => { if (!this.disposed) this.dashboard.progress(step); });
			const sources = await this.sources(document), files: RevisionFile[] = [];
			const previousFiles = new Map(this.result?.signature === signature ? this.result.files.map(file => [file.path, file]) : []);
			for (const source of sources) {
				if (this.disposed || request !== this.request) return;
				const cached = previousFiles.get(source.path), previous = cached?.source === source.source ? cached : undefined;
				const paragraphs = previous?.paragraphs ?? analyzeParagraphs(source.source, options);
				const sentences = previous?.sentences ?? analyzeSentences(source.source, paragraphs, options.countSpaces);
				const projection = projectObsidianComments(source.source);
				const repetition = morph ? classifyTokens(await analyzeText(projection.projectMask(paragraphs.analysisText), this.plugin), projection.text, scope === 'project' ? { minCount: 1, limit: 50000 } : {}) : previous?.repetition;
				if (morph && repetition && projection.ranges.length) for (const kind of ['word', 'eojeol', 'eomi'] as const) for (const entry of repetition[kind]) for (const occurrence of entry.occurrences) {
					occurrence.start = projection.originalOffset(occurrence.start); occurrence.end = projection.originalOffset(occurrence.end, 'left');
				}
				files.push({ ...source, paragraphs, sentences, repetition });
				if (morph) this.dashboard.progress(wmT("분석 중 {0} / {1}", files.length, sources.length));
			}
			if (this.disposed || request !== this.request || this.scope !== scope) return;
			if (this.context() !== context) { this.dirty = true; return; }
			if (scope === 'document' && (getWritingDocument(this.plugin)?.path !== document.path || !document.isCurrent(sources[0]?.source ?? ''))) { this.dirty = true; return; }
			this.result = { files, signature, scope, context, morph: files.some(file => file.repetition !== undefined) }; cache.set(this.plugin, this.result);
		} catch (error) { if (!this.disposed) new Notice(error instanceof Error ? error.message : String(error)); }
		finally { this.busy = false; if (!this.disposed) { this.render(); if (this.dirty) this.schedule(); } }
	}
	private async navigate(file: RevisionFile, from: number, to: number): Promise<void> {
		try {
			let document = getWritingDocument(this.plugin);
			if (document?.path !== file.path) { await this.plugin.app.workspace.openLinkText(file.path, '', false); document = getWritingDocument(this.plugin); }
			if (!document || document.path !== file.path) throw new Error(wmT("대상 원고를 열지 못했습니다."));
			document.select(file.source, from, to);
		} catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
	}
}
