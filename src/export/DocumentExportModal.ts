import { App, Modal, Notice, Platform, TFile, TFolder, normalizePath } from 'obsidian';
import { renderAsync } from 'docx-preview';
import type WritingMenuPlugin from '../../main';
import { wmT } from '../i18n/index';
import { exportContentPolicy, exportDefaults } from './ExportDefaults';
import type { DocumentFormat, ExportDefaults, ExportPreset, GeneratedDocument, HwpxTemplate } from './DocumentModel';
import { ExportService } from './ExportService';
import type { ExportArtifact } from './ExportService';
import { commonExportFolder, ExportSelection, isInExportFolder } from './ExportSelection';
import { ExportSources, type ExportSourceViewState } from './ExportSources';
import { ExportBasesPortal } from './ExportBasesPortal';
import { ExportControls, exportButton, exportSection, exportSelect, exportRow, exportValueLabel } from './ExportControls';
import { ToolbarSelect } from '../toolbar/ToolbarSelect';
import { createToolbarIconButton } from '../toolbar/toolbarUi';
import { pickExternalPath } from './DesktopExport';

export type ExportTarget = TFile | TFolder | TFile[];
let nextExportModalId = 0;
export class DocumentExportModal extends Modal {
	private readonly labelId = `wm-export-dialog-${++nextExportModalId}`;
	private service: ExportService;
	private draft: ExportDefaults;
	// Modal.open() stores the native text selection in its own `selection` property.
	private sourceSelection: ExportSelection;
	private files: TFile[];
	private root: string;
	private activePath: string;
	private resultName: string;
	private resultPath: string;
	private templatePath: string;
	private template?: HwpxTemplate;
	private templateStyleId = '';
	private templateError = '';
	private useTemplate = false;

	private merge = false;
	private hierarchy: boolean;
	private overwrite: boolean;
    private basesPortal?: ExportBasesPortal;
    private sources?: ExportSources;
    private sourcesHost?: HTMLElement;
    private sourceViewState: ExportSourceViewState = { mode: 'files', collapsed: new Set(), scroll: 0, reveal: true };
	private closed = false;
	private busy = false;
	private revision = 0;
	private timer = 0;
	private urls: string[] = [];
	private observer?: ResizeObserver;
	private zoom = 'fit';
	private leftWidth = 360;
	private view: 'home' | 'format' = 'home';
    private sidebarEl!: HTMLElement;
    private preset = 'default';
    private baseDefaults: ExportDefaults;
    private pickers: ToolbarSelect[] = [];
    private zoomValueEl!: HTMLElement;
    private currentScale = 1;
	private templateEl!: HTMLElement;
	private controlsHost!: HTMLElement;
	private controls!: ExportControls;
	private previewEl!: HTMLElement;
	private previewBody!: HTMLElement;
	private messageEl!: HTMLElement;
	private saveButton!: HTMLButtonElement;
	private nameInput!: HTMLInputElement;
	private bodyEl!: HTMLElement;
	private previewRender = 0;
	private previewAbort?: AbortController;
	private pendingPreviewKey = '';
	private completedPreviewKey = '';
	private renderedPreview?: GeneratedDocument;
	private renderedSource = '';
	private stagedPreviews = new Map<HTMLElement, string[]>();
	private templateRevision = 0;
	private latest: ExportArtifact[] = [];

	constructor(app: App, private plugin: WritingMenuPlugin, target: ExportTarget, format?: DocumentFormat) {
		super(app);
		this.service = new ExportService(plugin);
		this.draft = exportDefaults(plugin.settings, undefined, this.contentEl.ownerDocument.body.hasClass('theme-dark'), this.contentEl.ownerDocument);
		if (format) this.draft.format = format;
		this.baseDefaults = structuredClone(this.draft);
		const preferred = plugin.settings.documentExportDefaultPreset || 'default';
		if (preferred === 'template' && this.draft.format === 'hwpx') { this.preset = 'template'; this.useTemplate = true; }
		else {
			const preset = plugin.settings.documentExportPresets?.find(item => item.id === preferred);
			if (preset) { this.preset = preset.id; this.draft.style = structuredClone(preset.style); this.draft.content = exportContentPolicy(preset.content); this.draft.appearance = undefined; }
		}
		this.files = app.vault.getMarkdownFiles().filter(file => !file.path.split('/').some(part => part.startsWith('.')));
		const initial = Array.isArray(target) ? target : 'extension' in target ? [target] : this.files.filter(file => isInExportFolder(file.path, target.path)).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
		this.sourceSelection = new ExportSelection(initial.map(file => file.path));
		this.activePath = initial[0]?.path ?? '';
		for (const file of initial) if (!this.files.some(item => item.path === file.path)) this.files.push(file);
		const project = plugin.projectContext?.getProjectForFile(initial[0] ?? null);
        const projectRoot = normalizePath(project?.rootFolder || '').replace(/^\/+|\/+$/g, '');
		this.root = 'children' in target ? normalizePath(target.path).replace(/^\/+|\/+$/g, '') : project && initial.every(file => isInExportFolder(file.path, projectRoot)) ? projectRoot : commonExportFolder(initial.map(file => file.path));
		this.resultName = 'extension' in target ? target.basename : 'children' in target ? target.name : wmT('병합된_문서');
		this.hierarchy = plugin.settings.exportPreserveFolderStructure ?? false;
		this.overwrite = plugin.settings.exportOverwriteExisting ?? true;
		this.resultPath = plugin.settings.hwpExportPath || '';
		this.templatePath = plugin.settings.hwpTemplatePath || '';
	}

    onOpen(): void {
        this.closed = false;
        this.modalEl.addClass('wm-document-export-modal'); this.modalEl.removeAttribute('aria-label'); this.modalEl.setAttribute('aria-labelledby', this.labelId);
        this.containerEl.addClass('wm-export-modal-container');
        this.contentEl.empty(); this.contentEl.addClass('wm-document-export');
        this.contentEl.createSpan({ cls: 'wm-export-sr-label', text: wmT('내보내기'), attr: { id: this.labelId } });
        if (!Platform.isDesktop) { this.contentEl.createEl('p', { text: wmT('데스크톱 전용 기능입니다.') }); return; }
        if (this.plugin.settings.documentExportDefaults?.version !== 2) {
            this.plugin.settings.documentExportDefaults = structuredClone(this.baseDefaults);
            this.plugin.settings.exportDefaultSpaceIndent = false; this.plugin.settings.exportDefaultExcludeHeadings = this.baseDefaults.content.headings === 'exclude';
            void this.plugin.saveSettings();
        }
        this.bodyEl = this.contentEl.createDiv({ cls: 'wm-export-body' });
        this.sidebarEl = this.bodyEl.createDiv({ cls: 'wm-export-sidebar' });
        this.contentEl.createSpan({ cls: 'wm-export-sr-label', text: wmT('문서 선택 영역 너비 조절'), attr: { id: `${this.labelId}-resize` } });
        this.contentEl.createSpan({ cls: 'wm-export-sr-label', text: wmT('내보낼 문서 미리보기'), attr: { id: `${this.labelId}-preview` } });
        const splitter = this.bodyEl.createDiv({ cls: 'wm-export-splitter is-vertical', attr: { role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-labelledby': `${this.labelId}-resize`, 'aria-valuenow': String(this.leftWidth) } }); this.bindSplitter(splitter);
        const right = this.bodyEl.createDiv({ cls: 'wm-export-preview' });
        const toolbar = right.createDiv({ cls: 'wm-export-window-actions' });
        const compact = exportButton(toolbar, wmT('설정'), () => this.contentEl.toggleClass('is-preview-mode', !this.contentEl.hasClass('is-preview-mode')), 'wm-export-compact-switch'); compact.setAttribute('aria-label', wmT('설정과 미리보기 전환'));
        const zoom = toolbar.createDiv({ cls: 'wm-paged-toolbar-group is-zoom wm-export-zoom' });
        createToolbarIconButton(zoom, 'zoom-out', wmT('축소 (Ctrl/Cmd+마우스 휠 아래)'), () => this.changeZoom(-0.1));
        const reset = exportButton(zoom, '', () => { this.zoom = '1'; this.updateZoom(); }, 'wm-paged-zoom-reset'); reset.setAttribute('aria-label', wmT('배율을 100%로 초기화'));
        this.zoomValueEl = reset.createSpan({ cls: 'wm-paged-zoom-value', text: '100%' });
        createToolbarIconButton(zoom, 'zoom-in', wmT('확대 (Ctrl/Cmd+마우스 휠 위)'), () => this.changeZoom(0.1));
        const close = this.modalEl.querySelector<HTMLElement>(':scope > .modal-close-button, :scope > .modal-header-button');
        if (close) {
            close.addClass('wm-export-close', 'wm-paged-toolbar-button'); close.setAttribute('role','button'); close.tabIndex = 0;
            close.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); close.click(); } });
            zoom.append(close);
        }
        const previewFrame = right.createDiv({ cls: 'wm-export-preview-frame' });
        this.previewEl = previewFrame.createDiv({ cls: 'wm-export-preview-viewport', attr: { 'aria-labelledby': `${this.labelId}-preview` } }); this.previewBody = this.previewEl.createDiv({ cls: 'wm-export-preview-content' });
        this.previewEl.addEventListener('wheel', event => {
            if ((!event.ctrlKey && !event.metaKey) || !event.deltaY) return;
            event.preventDefault(); const rect = this.previewEl.getBoundingClientRect(), old = this.currentScale;
            const x = event.clientX - rect.left, y = event.clientY - rect.top, left = this.previewEl.scrollLeft + x, top = this.previewEl.scrollTop + y;
            this.changeZoom(event.deltaY < 0 ? 0.1 : -0.1);
            this.previewEl.scrollLeft = left * this.currentScale / old - x; this.previewEl.scrollTop = top * this.currentScale / old - y;
        }, { passive: false });
        this.basesPortal = new ExportBasesPortal(this.containerEl, () => this.sourcesHost); this.basesPortal.load();
        this.renderFooter(right); this.renderSidebar();
        this.observer = new ResizeObserver(() => this.updateZoom()); this.observer.observe(this.previewEl);
        void this.initialize();
    }
    private async initialize(): Promise<void> {
        if (this.preset === 'template') { await this.reloadTemplate(); return; }
        this.queuePreview();
    }
    private picker(select: HTMLSelectElement): void { this.pickers.push(new ToolbarSelect(select, 'is-export-context', { valueTooltip: false })); }
    private presetLabel(): string {
        return this.preset === 'template' ? this.templatePath.split(/[\\/]/).pop() || wmT('템플릿') : this.preset === 'default' ? wmT('기본값') : (this.plugin.settings.documentExportPresets || []).find(item => item.id === this.preset)?.name || wmT('사용자 지정');
    }
    private renderSidebar(): void {
        if (!this.sidebarEl) return;
        this.basesPortal?.closeMenus();
        const scroll = this.sidebarEl.querySelector<HTMLElement>('.wm-export-form-scroll')?.scrollTop || 0;
        this.controls?.dispose(); for (const picker of this.pickers) picker.destroy(); this.pickers = []; this.sidebarEl.empty();
        if (this.view === 'format') {
            const header = this.sidebarEl.createDiv({ cls: 'wm-export-sidebar-header wm-export-back-header' });
            const back = exportRow(header, wmT('돌아가기'), 'arrow-left', 'back');
            this.rowAction(back, 'arrow-left', wmT('내보내기로 돌아가기'), () => { this.view = 'home'; this.renderSidebar(); });
            const body = this.sidebarEl.createDiv({ cls: 'wm-export-form-scroll' });
            const basic = exportSection(body, wmT('기본'));
            const presets: Array<[string,string]> = [['default',wmT('기본값')], ['custom',wmT('사용자 지정')], ['template',wmT('템플릿')], ...(this.plugin.settings.documentExportPresets || []).map(item => [item.id,item.name] as [string,string])];
            const select = exportSelect(basic, wmT('프리셋'), this.preset, presets, value => this.applyPreset(value), 'bookmark-plus');
            select.querySelector<HTMLOptionElement>('option[value="template"]')!.disabled = this.draft.format !== 'hwpx'; this.picker(select);
            this.rowAction(select.parentElement!.parentElement!, 'bookmark-plus', wmT('프리셋 저장'), () => this.openPresetSave());
            this.templateEl = basic.createDiv({ cls: 'wm-export-template' }); this.renderTemplate();
            this.controlsHost = body.createDiv(); this.controls = new ExportControls(this.controlsHost, this.draft, () => this.styleChanged(), this.plugin.settings.customFonts ?? []);
            body.scrollTop = scroll;
        } else {
            this.renderOverview();
        }
    }
    private styleChanged(): void {
        if (this.preset !== 'template') {
            this.preset = 'custom'; const select = this.sidebarEl.querySelector<HTMLSelectElement>('.wm-export-form-scroll select');
            if (select) { select.value = 'custom'; this.pickers[0]?.sync(); }
        }
        this.queuePreview();
    }
    private applyPreset(value: string): void {
        if (value === 'template') { this.preset = value;  this.useTemplate = true; this.renderSidebar(); void this.reloadTemplate(); return; }
        this.preset = value; this.useTemplate = false; this.templateError = '';
        const chosen = value === 'default' ? this.baseDefaults : this.plugin.settings.documentExportPresets?.find(item => item.id === value);
        if (chosen) {
            this.draft.style = structuredClone(chosen.style); this.draft.content = exportContentPolicy(chosen.content);
            this.draft.appearance = value === 'default' ? structuredClone(this.baseDefaults.appearance) : undefined;
        }
         this.renderSidebar(); this.queuePreview();
    }
    private rowAction(value: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
        const title = value.parentElement!.querySelector<HTMLElement>('.wm-export-row-title')!;
        title.querySelector('.wm-export-row-icon')?.remove();
        const button = createToolbarIconButton(title, icon, label, action);
        button.addClass('wm-export-row-action'); title.prepend(button); return button;
    }
    private renderOverview(): void {
        const home = this.sidebarEl.createDiv({ cls: 'wm-export-home' });
        const fields = home.createDiv({ cls: 'wm-export-main-fields' });
        const formatRow = fields.createDiv({ cls: 'wm-export-format-strip' });
        const formats = formatRow.createDiv({ cls: 'wm-segmented-control wm-export-formats', attr: { role: 'group', 'aria-label': wmT('파일 형식') } });
        for (const format of ['txt','docx','hwpx'] as const) {
            const button = exportButton(formats, format.toUpperCase(), () => {
                if (this.busy) return; this.draft.format = format;
                if (format !== 'hwpx' && this.preset === 'template') { this.preset = 'custom'; this.useTemplate = false; this.templateError = ''; }
                this.renderSidebar(); this.queuePreview();
            }); button.dataset.format = format; button.setAttribute('aria-pressed', String(this.draft.format === format));
        }
        exportButton(formatRow, wmT('미리보기'), () => this.contentEl.addClass('is-preview-mode'), 'wm-export-compact-switch');
        const choices: Array<[string,string]> = [['',wmT('전체 볼트')]];
        for (const project of this.plugin.projectContext?.getProjects() || []) {
            const path = normalizePath(project.rootFolder).replace(/^\/+|\/+$/g, ''); if (!choices.some(([root]) => root === path)) choices.push([path,project.name]);
        }
        if (!choices.some(([path]) => path === this.root)) choices.push([this.root,this.root]);
        const projectSelect = exportSelect(fields, wmT('프로젝트'), this.root, choices, value => {
            if (this.busy || value === this.root) return;
            this.basesPortal?.closeMenus();
            this.root = value; this.sourceSelection = new ExportSelection([]); this.activePath = '';
            this.sources?.unload(); this.sources = undefined; this.sourcesHost = undefined;
            this.sourceViewState = { mode: 'files', collapsed: new Set(), scroll: 0, reveal: true };
            this.renderSidebar(); this.queuePreview();
        }, 'folder-open');
        const projectPicker = new ToolbarSelect(projectSelect, 'is-export-context', { iconTrigger: true, valueTooltip: false }); this.pickers.push(projectPicker);
        projectSelect.parentElement!.hidden = true; projectSelect.parentElement!.style.display = 'none';
        const projectValue = projectSelect.parentElement!.parentElement!;
        projectValue.createSpan({ cls: 'wm-export-context-value', text: choices.find(([path]) => path === this.root)?.[1] || this.root });
        const projectIcon = this.rowAction(projectValue, 'folder-open', wmT('프로젝트 선택'), () => projectPicker.openAt(projectIcon));
        projectIcon.setAttribute('aria-haspopup','menu'); projectIcon.setAttribute('aria-expanded','false');
        const name = exportRow(fields, wmT('파일 이름'), 'file-pen-line', 'filename');
        this.nameInput = name.createEl('input', { type: 'text', value: this.resultName, cls: 'wm-export-inline-input', attr: exportValueLabel(name) });
        this.nameInput.addEventListener('input', () => { this.resultName = this.nameInput.value; this.queuePreview(); });
        const directory = exportRow(fields, wmT('저장 경로'), 'folder-input', 'directory');
        const path = directory.createEl('input', { type: 'text', value: this.resultPath, cls: 'wm-export-inline-input', attr: { ...exportValueLabel(directory), placeholder: wmT('저장할 때 선택') } });
        path.addEventListener('input', () => { this.resultPath = path.value; });
        this.rowAction(directory, 'folder-input', wmT('폴더 선택'), () => { void (async () => {
            if (this.busy) return;
            const chosen = await pickExternalPath('folder');
            if (chosen && !this.closed) { this.resultPath = chosen; path.value = chosen; }
        })(); });
        const style = exportRow(fields, wmT('양식'), 'text-initial', 'style');
        style.createSpan({ cls: 'wm-export-context-value', text: this.presetLabel() });
        this.rowAction(style, 'text-initial', wmT('양식 설정'), () => { if (!this.busy) { this.view = 'format'; this.renderSidebar(); } });
        if (!this.sourcesHost) {
            this.sourcesHost = home.createDiv({ cls: 'wm-export-sources' });
            this.sources = new ExportSources(this.plugin, this.sourcesHost, this.sourceViewState, {
                snapshot: () => ({ files: this.files, root: this.root, projectName: choices.find(([path]) => path === this.root)?.[1] || this.root, active: this.activePath, selection: this.sourceSelection, busy: this.busy }),
                indexed: files => {
                    const known = new Set(this.files.map(file => file.path));
                    for (const file of files) if (!known.has(file.path) && file.extension === 'md' && isInExportFolder(file.path, this.root) && !file.path.split('/').some(part => part.startsWith('.'))) { this.files.push(file); known.add(file.path); }
                },
                changed: () => this.selectionChanged(),
                preview: path => { this.activePath = path; this.sources?.refresh(); this.queuePreview(); },
                merge: value => { if (this.merge !== value) { this.merge = value; this.updateSourceFields(); this.queuePreview(); } },
            });
            this.sources.load();
        } else { home.append(this.sourcesHost); this.sources?.refresh(); }
        this.updateSourceFields();
    }
    private selectedFiles(): TFile[] {
        const byPath = new Map(this.files.map(file => [file.path, file]));
        return this.sourceSelection.order.map(path => byPath.get(path)).filter((file): file is TFile => !!file);
    }
    private updateSourceFields(): void {
        if (!this.nameInput?.isConnected) return;
        this.nameInput.disabled = !this.merge && this.sourceSelection.order.length !== 1;
        this.nameInput.value = this.nameInput.disabled ? wmT('각 문서 이름') : this.resultName;
    }
    private selectionChanged(): void {
        if (!this.activePath) this.activePath = this.sourceSelection.order[0] ?? '';
        if (this.sourceSelection.order.length === 1) this.resultName = this.selectedFiles()[0]?.basename ?? this.resultName;
        this.updateSourceFields(); this.sources?.refresh(); this.queuePreview();
    }

    private renderTemplate(): void {
        if (this.view !== 'format' || !this.templateEl) return;
        this.templateEl.empty(); this.templateEl.hidden = this.draft.format !== 'hwpx' || this.preset !== 'template';
        if (this.templateEl.hidden) return;
        const row = exportRow(this.templateEl, wmT('템플릿'), 'file-input');
        row.createSpan({ cls: 'wm-export-template-name', text: this.templatePath.split(/[\\/]/).pop() || wmT('선택 안 함') });
        this.rowAction(row, 'file-input', wmT('템플릿 불러오기'), () => { void (async () => {
            const path = await pickExternalPath('file'); if (!path || this.closed) return;
            this.templatePath = path; this.useTemplate = true; this.preset = 'template'; await this.reloadTemplate();
        })(); });
        if (this.templateError) this.templateEl.createEl('p', { cls: 'wm-export-inline-error', text: this.templateError });
        else if (/\.hwp$/i.test(this.templatePath)) this.templateEl.createEl('p', { cls: 'wm-export-help', text: wmT('HWP 템플릿은 한글에서 HWPX로 저장한 뒤 선택해 주세요.') });
    }


    private async reloadTemplate(): Promise<void> {
        this.cancelPreview(); this.template = undefined; this.templateError = ''; this.saveButton.disabled = true; this.setMessage(wmT('템플릿을 읽는 중…'));
        const path = this.templatePath, revision = ++this.templateRevision;
        try {
            if (!path) throw new Error(wmT('템플릿을 선택해 주세요.'));
            const template = await this.service.loadTemplate(path);
            if (this.closed || revision !== this.templateRevision || path !== this.templatePath || !this.useTemplate) return;
            this.template = template; this.templateStyleId = template.defaultStyleId;
            this.draft.style = { ...template.styles.find(item => item.id === this.templateStyleId)!.style };
            this.draft.appearance = undefined;
        } catch (error) { if (!this.closed && revision === this.templateRevision && path === this.templatePath && this.useTemplate) this.templateError = this.errorText(error); }
        if (!this.closed && revision === this.templateRevision) { this.renderSidebar(); this.queuePreview(); }
    }

    private renderFooter(host: HTMLElement): void {
        const footer = host.createDiv({ cls: 'wm-export-footer' });
        this.messageEl = footer.createDiv({ cls: 'wm-export-status', attr: { role: 'status', 'aria-live': 'polite' } });
        this.saveButton = exportButton(footer, wmT('내보내기'), () => { void this.save(); }, 'mod-cta'); this.saveButton.disabled = true;
    }
    private openPresetSave(): void {
        new ExportPresetNameModal(this.app, this.presetLabel(), async name => {
            const presets = this.plugin.settings.documentExportPresets ||= [];
            const existing = presets.find(item => item.name === name);
            const preset: ExportPreset = { id: existing?.id || 'preset-' + Date.now().toString(36), name, content: structuredClone(this.draft.content), style: structuredClone(this.draft.style) };
            if (existing) presets.splice(presets.indexOf(existing),1,preset); else presets.push(preset);
            await this.plugin.saveSettings(); this.preset = preset.id; this.useTemplate = false; this.templateError = ''; this.renderSidebar(); this.queuePreview();
            new Notice(wmT('프리셋을 저장했습니다.'));
        }).open();
    }

	private queuePreview(): void {
		if (this.closed || this.busy) return;
		const selected = this.selectedFiles(), active = this.files.find(file => file.path === this.activePath) ?? selected[0];
		const files = this.merge ? selected : active ? [active] : [];
		const name = !this.merge && selected.length > 1 ? active?.basename : this.resultName;
		const key = JSON.stringify([this.merge, files.map(file => [file.path, file.stat.mtime, file.stat.size]), name, this.draft, this.useTemplate, this.templatePath, this.templateStyleId, this.templateRevision]);
		if (key === this.pendingPreviewKey) return;
		if (key === this.completedPreviewKey) {
			this.cancelPreview(); this.saveButton.disabled = !this.sourceSelection.order.length || !this.latest.length; this.setMessage(this.latest[0]?.notices?.join('\n') ?? ''); return;
		}
		this.cancelPreview(); this.pendingPreviewKey = key; this.saveButton.disabled = true;
		this.timer = window.setTimeout(() => { this.timer = 0; void this.generatePreview(); }, 250);
	}
	private cancelPreview(): void {
		this.revision++; this.previewRender++; window.clearTimeout(this.timer); this.timer = 0;
		this.previewAbort?.abort(); this.previewAbort = undefined; this.pendingPreviewKey = '';
		this.service.cancelPreview(); this.previewEl?.setAttribute('aria-busy', 'false');
		for (const [stage, urls] of this.stagedPreviews) { stage.remove(); for (const url of urls) URL.revokeObjectURL(url); }
		this.stagedPreviews.clear();
	}
	private encodeOptions() { return { style: { ...this.draft.style }, title: this.resultName, template: this.useTemplate && this.draft.format === 'hwpx' ? this.template : undefined, templateStyleId: this.templateStyleId }; }
	private async generatePreview(): Promise<void> {
		const revision = this.revision, key = this.pendingPreviewKey, controller = new AbortController(); this.previewAbort = controller;
		const selected = this.selectedFiles(), active = this.files.find(file => file.path === this.activePath) ?? selected[0];
		try {
			if (this.useTemplate && this.draft.format === 'hwpx' && (!this.template || this.templateError)) {
				if (this.templateError) this.showError(this.templateError); else this.setMessage(wmT('템플릿을 읽는 중…'));
				return;
			}
			if (!active || (this.merge && !selected.length)) { this.showError(wmT('내보낼 문서를 선택해 주세요.')); return; }
			this.setMessage(wmT('미리보기를 만드는 중…')); this.previewEl.setAttribute('aria-busy', 'true');
			const name = !this.merge && selected.length > 1 ? active.basename : this.resultName;
			const artifacts = await this.service.generate(this.merge ? selected : [active], this.draft.format, { ...this.draft.content }, this.encodeOptions(), this.merge, name, controller.signal);
			if (this.closed || revision !== this.revision) return;
			await this.renderPreview(artifacts[0]);
			if (this.closed || revision !== this.revision) return;
			this.latest = artifacts; this.completedPreviewKey = key; this.saveButton.disabled = !this.sourceSelection.order.length; this.setMessage(artifacts[0]?.notices?.join('\n') ?? '');
		} catch (error) { if (!this.closed && revision === this.revision && !controller.signal.aborted) this.showError(this.errorText(error)); }
		finally {
			if (!this.closed && revision === this.revision) { this.previewAbort = undefined; this.pendingPreviewKey = ''; this.previewEl.setAttribute('aria-busy', 'false'); }
		}
	}
	private async renderPreview(artifact: ExportArtifact): Promise<void> {
		if (this.renderedPreview === artifact.generated) return;
		const generation = ++this.previewRender, format = this.draft.format, urls: string[] = [];
		const stage = this.containerEl.createDiv({ cls: 'wm-export-preview-content wm-export-preview-staging', attr: { 'aria-hidden': 'true' } });
		stage.style.setProperty('--wm-export-zoom', String(this.currentScale)); this.stagedPreviews.set(stage, urls);
		try {
			if (format === 'txt') stage.createEl('pre', { cls: 'wm-export-text-preview', text: artifact.generated.text });
			else if (format === 'hwpx') {
				const ready: Promise<void>[] = [];
				for (const [index, svg] of (artifact.generated.pages ?? []).entries()) {
					const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); urls.push(url);
					const image = stage.createEl('img', { cls: 'wm-export-page', attr: { src: url, alt: wmT('{0}쪽', index + 1), loading: index < 3 ? 'eager' : 'lazy' } });
					image.style.width = `${this.draft.style.pageWidth * 96 / 25.4}px`; image.style.height = `${this.draft.style.pageHeight * 96 / 25.4}px`;
					if (index < 3) ready.push(image.decode());
				}
				await Promise.all(ready);
			} else {
				const host = stage.createDiv({ cls: 'wm-export-docx-preview' }), shadow = host.attachShadow({ mode: 'open' });
				const styles = host.createDiv(), body = host.createDiv(); shadow.append(styles, body);
				await renderAsync(artifact.generated.bytes.slice().buffer, body, styles, { inWrapper: false, renderAltChunks: false, ignoreWidth: false, ignoreHeight: false, ignoreFonts: false, renderFootnotes: true, useBase64URL: true });
			}
			if (this.closed || generation !== this.previewRender) return;
			const source = `${format}:${artifact.file?.path ?? '*merged*'}`, sameSource = source === this.renderedSource;
			const top = sameSource ? this.previewEl.scrollTop : 0, left = sameSource ? this.previewEl.scrollLeft : 0;
			const previous = this.previewBody;
			stage.removeClass('wm-export-preview-staging'); stage.removeAttribute('aria-hidden');
			previous.replaceWith(stage); this.previewBody = stage;
			this.clearUrls(); this.urls = urls; this.stagedPreviews.delete(stage);
			this.renderedPreview = artifact.generated; this.renderedSource = source; this.updateZoom();
			this.previewEl.scrollTop = top; this.previewEl.scrollLeft = left;
		} finally {
			if (this.stagedPreviews.delete(stage)) { stage.remove(); for (const url of urls) URL.revokeObjectURL(url); }
		}
	}

    private changeZoom(delta: number): void { this.zoom = String(Math.max(0.15, Math.min(3,this.currentScale + delta))); this.updateZoom(); }
    private updateZoom(): void {
        if (!this.previewEl || !this.previewBody) return;
        this.currentScale = this.zoom === 'fit' ? this.draft.format === 'txt' ? 1 : Math.max(0.15, Math.min(1,this.previewEl.clientWidth/(this.draft.style.pageWidth * 96 / 25.4))) : Number(this.zoom);
        this.previewBody.style.setProperty('--wm-export-zoom',String(this.currentScale)); this.zoomValueEl?.setText(Math.round(this.currentScale * 100) + '%');
    }

	private setMessage(text: string, error = false): void { this.messageEl.setText(text); this.messageEl.toggleClass('is-error', error); }
	private errorText(error: unknown): string { return wmT(error instanceof Error ? error.message : String(error)); }
	private showError(text: string): void { this.latest = []; this.completedPreviewKey = ''; this.renderedPreview = undefined; this.renderedSource = ''; this.saveButton.disabled = true; this.clearUrls(); this.previewBody.empty(); this.setMessage(text, true); }
	private async save(): Promise<void> {
		if (this.busy || !this.latest.length) return;
		this.cancelPreview(); this.busy = true; this.contentEl.addClass('is-saving'); this.saveButton.disabled = true;
		const sidebarInert = this.sidebarEl.inert; this.sidebarEl.inert = true;
		const locked = Array.from(this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')).map(element => ({ element, disabled: element.disabled }));
		for (const { element } of locked) element.disabled = true;
		try {
			const directory = this.resultPath.trim() || await pickExternalPath('folder'); if (!directory || this.closed) { if (!this.closed) this.setMessage(wmT('저장을 취소했습니다.')); return; }
			this.setMessage(wmT('문서를 생성하는 중…'));
			const files = this.selectedFiles(), artifacts = await this.service.generate(files, this.draft.format, { ...this.draft.content }, this.encodeOptions(), this.merge, this.resultName);
			if (this.closed) return;
			await this.renderPreview(artifacts.find(item => item.file?.path === this.activePath) ?? artifacts[0]);
			if (this.closed) return;
			const result = await this.service.write(artifacts, directory, this.draft.format, this.root, this.hierarchy && !this.merge, this.templatePath, this.overwrite);
			if (result.error) throw new Error(wmT('{0}개 저장 후 실패: {1}', result.saved.length, result.error));
			this.resultPath = directory; this.setMessage(wmT('저장 완료: {0}개 파일', result.saved.length));
			new Notice(wmT('저장 완료: {0}개 파일', result.saved.length) + '\n' + (result.saved[0] || directory), 6000);
		} catch (error) { if (!this.closed) this.setMessage(this.errorText(error), true); }
		finally { this.busy = false; if (!this.closed) { this.sidebarEl.inert = sidebarInert; for (const { element, disabled } of locked) element.disabled = disabled; this.contentEl.removeClass('is-saving'); this.sources?.refresh(); this.saveButton.disabled = !this.sourceSelection.order.length || !this.latest.length; } }
	}

    private bindSplitter(handle: HTMLElement): void {
        handle.setAttribute('aria-valuemin','300'); handle.setAttribute('aria-valuemax',String(Math.max(300,this.bodyEl.clientWidth-280)));
        const apply = (value: number): void => { this.leftWidth = Math.max(300,Math.min(this.bodyEl.clientWidth-280,value)); this.bodyEl.style.setProperty('--wm-export-left-width',this.leftWidth+'px'); handle.setAttribute('aria-valuenow',String(Math.round(this.leftWidth))); };
        handle.addEventListener('pointerdown',event => { event.preventDefault(); handle.setPointerCapture(event.pointerId); });
        handle.addEventListener('pointermove',event => { if (handle.hasPointerCapture(event.pointerId)) apply(event.clientX-this.bodyEl.getBoundingClientRect().left); });
        handle.addEventListener('pointerup',event => { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); });
        handle.addEventListener('keydown',event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); apply(this.leftWidth+(event.key === 'ArrowLeft' ? -16 : 16)); });
    }

	private clearUrls(): void { for (const url of this.urls) URL.revokeObjectURL(url); this.urls = []; }
	onClose(): void { this.closed = true; this.cancelPreview(); this.templateRevision++; this.observer?.disconnect(); this.clearUrls(); this.service.dispose(); this.basesPortal?.unload(); this.basesPortal = undefined; this.sources?.unload(); this.sources = undefined; this.sourcesHost = undefined; this.controls?.dispose(); for (const picker of this.pickers) picker.destroy(); this.pickers = []; this.contentEl.empty(); }
}

class ExportPresetNameModal extends Modal {
    constructor(app: App, private initial: string, private savePreset: (name: string) => Promise<void>) { super(app); }
    onOpen(): void {
        this.modalEl.addClass('wm-export-preset-modal'); this.contentEl.createEl('h2',{text:wmT('프리셋 저장')});
        const input = this.contentEl.createEl('input',{type:'text',value:this.initial,attr:{'aria-label':wmT('프리셋 이름'),placeholder:wmT('프리셋 이름')}});
        const actions = this.contentEl.createDiv({cls:'wm-export-preset-actions'});
        exportButton(actions,wmT('취소'),() => this.close());
        const save = exportButton(actions,wmT('저장'),() => { const name = input.value.trim(); if (name) void this.savePreset(name).then(() => this.close()); },'mod-cta');
        input.addEventListener('input',() => { save.disabled = !input.value.trim(); }); input.addEventListener('keydown',event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); save.click(); } }); input.select();
    }
    onClose(): void { this.contentEl.empty(); }
}
