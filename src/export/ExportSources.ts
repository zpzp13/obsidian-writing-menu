import { BasesView, Component, MarkdownRenderer, TFile, parseYaml, requireApiVersion, stringifyYaml } from 'obsidian';
import type { BasesPropertyId, QueryController } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { wmT } from '../i18n';
import { createToolbarIconButton } from '../toolbar/toolbarUi';
import { exportButton } from './ExportControls';
import { ExportSelection, isInExportFolder } from './ExportSelection';

const FILES_VIEW = 'writing-menu-export-documents';
const MERGE_VIEW = 'writing-menu-export-merge';
const INCLUDED = 'wmExportIncluded';
const sessions = new Map<string, ExportSources>();
const registrations = new WeakSet<WritingMenuPlugin>();
let nextSession = 0;

export interface ExportSourceViewState {
    mode: 'files' | 'merge';
    collapsed: Set<string>;
    scroll: number;
    reveal: boolean;
}
interface SourceSnapshot { files: TFile[]; root: string; projectName: string; active: string; selection: ExportSelection; busy: boolean }
interface SourceActions {
    snapshot: () => SourceSnapshot;
    indexed: (files: TFile[]) => void;
    changed: () => void;
    preview: (path: string) => void;
    merge: (value: boolean) => void;
}
interface SourceColumn { id: BasesPropertyId; label: string }
interface SourceItem { file: TFile; values: string[] }
interface SourceGroup { key: string; label: string; items: SourceItem[] }
interface SourceBranch { key: string; label: string; items: SourceItem[]; children: SourceBranch[] }

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Bases owns the entire controller, toolbar, menus, search, filters and sorting. */
function registerSourceViews(plugin: WritingMenuPlugin): boolean {
    if (!requireApiVersion('1.10.0') || typeof BasesView !== 'function') return false;
    if (registrations.has(plugin)) return true;
    class ExportDocumentsView extends BasesView {
        readonly type: string;
        private session?: ExportSources;
        constructor(controller: QueryController, private host: HTMLElement, private mergeView: boolean) {
            super(controller); this.type = mergeView ? MERGE_VIEW : FILES_VIEW;
            this.register(() => this.session?.detach(this));
        }
        onDataUpdated(): void {
            if (!this.data || !this.config) return;
            const id = this.config.get('wmExportSession') ?? this.host.closest<HTMLElement>('[data-export-session]')?.dataset.exportSession;
            const session = typeof id === 'string' ? sessions.get(id) : undefined;
            if (!session) { this.host.empty(); return; }
            if (this.session !== session) { this.session?.detach(this); this.session = session; }
            const columns = this.config.getOrder().map(id => ({ id, label: this.config.getDisplayName(id) }));
            const groups = this.data.groupedData.map(group => ({
                key: JSON.stringify([group.hasKey(), group.key?.toString()]),
                label: group.hasKey() ? group.key?.toString() ?? '' : '',
                items: group.entries.map(entry => ({
                    file: entry.file,
                    values: columns.map(column => column.id === 'file.name' ? entry.file.basename : entry.getValue(column.id)?.toString() ?? ''),
                })),
            }));
            session.attach(this, this.host, groups, columns, this.mergeView);
        }
    }
    const files = plugin.registerBasesView(FILES_VIEW, { name: wmT('파일 트리'), icon: 'list-checks', factory: (controller, host) => new ExportDocumentsView(controller, host, false) });
    const merge = plugin.registerBasesView(MERGE_VIEW, { name: wmT('병합'), icon: 'combine', factory: (controller, host) => new ExportDocumentsView(controller, host, true) });
    if (files && merge) registrations.add(plugin);
    return files && merge;
}

/** Selection-only result view inside a normal file-backed Bases embed, like the music library. */
export class ExportSources extends Component {
    private readonly id = `${Date.now().toString(36)}-${++nextSession}`;
    private nativeOwner?: BasesView;
    private nativeHost?: HTMLElement;
    private groups: SourceGroup[] = [];
    private columns: SourceColumn[] = [];
    private nativeEl!: HTMLElement;
    private loadStatusEl!: HTMLElement;
    private listEl?: HTMLElement;
    private sessionFile?: TFile;
    private sessionPath = '';
    private opening?: Promise<void>;
    private syncQueue: Promise<void> = Promise.resolve();
    private includedFormula = '';
    private pendingManualOrder = false;
    private lastGroups = '';
    private dragging = '';
    private disposed = false;
    private layoutObserver?: ResizeObserver;
    private layoutFrame = 0;
    private restorePending = true;
    private scrollLeft = 0;
    private appliedScroll = { top: 0, left: 0 };
    private checkboxSize = 16;
    private guidePaths = new Map<string, SVGPathElement[]>();
    private highlightedGuide = '';
    private foldedGuide = '';

    constructor(private plugin: WritingMenuPlugin, private host: HTMLElement, private state: ExportSourceViewState, private actions: SourceActions) { super(); }

    onload(): void {
        this.host.addClass('wm-export-collection'); this.host.dataset.exportSession = this.id;
        this.host.createSpan({ cls: 'wm-export-sr-label', text: wmT('내보낼 문서'), attr: { id: `wm-export-sources-${this.id}` } });
        this.nativeEl = this.host.createDiv({ cls: 'wm-export-bases-native' });
        this.loadStatusEl = this.host.createDiv({ cls: 'wm-export-bases-status', attr: { role: 'status' } });
        this.layoutObserver = new ResizeObserver(() => this.restoreScroll());
        sessions.set(this.id, this);
        this.registerEvent(this.plugin.app.vault.on('modify', file => { if (file === this.sessionFile) this.syncBase(false, true); }));
        this.register(() => {
            this.disposed = true; sessions.delete(this.id);
            this.layoutObserver?.disconnect(); this.host.ownerDocument.defaultView?.cancelAnimationFrame(this.layoutFrame);
            void this.opening?.then(() => this.cleanup()).catch(error => console.error('Export Bases cleanup failed', error));
        });
        this.opening = this.mountBase();
    }

    private membership(): string {
        return `${JSON.stringify([...this.actions.snapshot().selection.order].sort())}.contains(file.path)`;
    }
    private async mountBase(): Promise<void> {
        try {
            if (!registerSourceViews(this.plugin)) { this.loadStatusEl.setText(wmT('필터를 사용하려면 베이스 코어 플러그인을 켜 주세요.')); return; }
            const { root } = this.actions.snapshot();
            this.includedFormula = this.membership();
            const base = {
                filters: { and: ['file.ext == "md"', ...(root ? [`file.inFolder(${JSON.stringify(root)})`] : [])] },
                formulas: { [INCLUDED]: this.includedFormula },
                properties: { 'file.name': { displayName: wmT('문서') }, 'file.folder': { displayName: wmT('폴더') } },
                views: [
                    { type: FILES_VIEW, name: wmT('파일 트리'), wmExportSession: this.id, order: ['file.name'], sort: [{ property: 'file.name', direction: 'ASC' }], groupBy: { property: 'file.folder', direction: 'ASC' } },
                    { type: MERGE_VIEW, name: wmT('병합'), wmExportSession: this.id, order: ['file.name'], sort: [], filters: { and: [`formula.${INCLUDED}`] } },
                ],
            };
            if (this.state.mode === 'merge') base.views.reverse();
            // A real .base gives the native toolbar its normal save/query lifecycle.
            // This unique plugin-created session file is deleted after the embed unloads.
            this.sessionPath = `Writing Menu Export ${this.id}.base`;
            this.sessionFile = await this.plugin.app.vault.create(this.sessionPath, stringifyYaml(base));
            if (this.disposed) return;
            await MarkdownRenderer.render(this.plugin.app, `![[${this.sessionFile.path}]]`, this.nativeEl, '', this);
        } catch (error) { this.showLoadError(error); }
    }

    private async cleanup(): Promise<void> {
        await this.syncQueue;
        await new Promise<void>(resolve => window.setTimeout(resolve, 500));
        const file = this.sessionFile;
        if (file && file.path === this.sessionPath && this.plugin.app.vault.getAbstractFileByPath(this.sessionPath) === file) await this.plugin.app.vault.delete(file);
    }
    private showLoadError(error: unknown): void {
        if (!this.disposed) this.loadStatusEl.setText(wmT('문서 목록을 불러오지 못했습니다: {0}', error instanceof Error ? error.message : String(error)));
    }
    private syncBase(clearMergeSort = false, repair = false): void {
        const file = this.sessionFile, formula = this.membership();
        if (!file || this.disposed || !clearMergeSort && !repair && formula === this.includedFormula) return;
        this.includedFormula = formula;
        this.syncQueue = this.syncQueue.then(async () => {
            if (this.disposed) return;
            const current = record(parseYaml(await this.plugin.app.vault.read(file)));
            const sortNeedsClearing = clearMergeSort && Array.isArray(current?.views) && current.views.some(value => {
                const view = record(value); return view?.type === MERGE_VIEW && Array.isArray(view.sort) && view.sort.length > 0;
            });
            if (record(current?.formulas)?.[INCLUDED] === formula && !sortNeedsClearing) return;
            await this.plugin.app.vault.process(file, source => {
                const base = record(parseYaml(source));
                if (!base) throw new Error(wmT('내보내기 문서 목록 설정이 올바르지 않습니다.'));
                base.formulas = { ...record(base.formulas), [INCLUDED]: formula };
                if (clearMergeSort && Array.isArray(base.views)) for (const value of base.views) {
                    const view = record(value); if (view?.type === MERGE_VIEW) view.sort = [];
                }
                const updated = stringifyYaml(base); return source === updated ? source : updated;
            });
        }).catch(error => { this.includedFormula = ''; this.pendingManualOrder = false; this.showLoadError(error); });
    }

    attach(owner: BasesView, host: HTMLElement, groups: SourceGroup[], columns: SourceColumn[], merge: boolean): void {
        if (this.disposed) return;
        const switched = owner !== this.nativeOwner;
        this.actions.indexed(groups.flatMap(group => group.items.map(item => item.file)));
        this.nativeOwner = owner; this.nativeHost = host; this.groups = groups; this.columns = columns;
        this.state.mode = merge ? 'merge' : 'files'; this.actions.merge(merge);
        const sort = owner.config.getSort(), groupSignature = JSON.stringify(groups.map(group => group.key));
        if (!sort.length) this.pendingManualOrder = false;
        if (merge && sort.length && !this.pendingManualOrder) {
            if (this.actions.snapshot().selection.reorderVisible(groups.flatMap(group => group.items.map(item => item.file.path)))) this.actions.changed();
        } else if (merge && groups.some(group => group.label) && (switched || groupSignature !== this.lastGroups)) {
            const rank = new Map(this.actions.snapshot().selection.order.map((path, index) => [path, index]));
            if (this.actions.snapshot().selection.reorderVisible(groups.flatMap(group => [...group.items].sort((a, b) => (rank.get(a.file.path) ?? 0) - (rank.get(b.file.path) ?? 0)).map(item => item.file.path)))) this.actions.changed();
        }
        this.lastGroups = groupSignature; this.loadStatusEl.setText(''); this.refresh();
    }
    detach(owner: BasesView): void {
        if (owner !== this.nativeOwner || this.disposed) return;
        this.nativeOwner = undefined; this.nativeHost = undefined; this.lastGroups = '';
    }
    refresh(): void {
        if (this.disposed) return;
        this.syncBase(); if (this.nativeHost) this.renderRows(this.nativeHost);
    }
    private visibleGroups(): SourceGroup[] {
        const { files, root, selection } = this.actions.snapshot(), known = new Set(files.map(file => file.path));
        const include = (item: SourceItem): boolean => known.has(item.file.path) && item.file.extension === 'md' && isInExportFolder(item.file.path, root);
        if (this.state.mode === 'merge') {
            if (this.groups.some(group => group.label)) {
                const rank = new Map(selection.order.map((path, index) => [path, index]));
                return this.groups.map(group => ({ ...group, items: group.items.filter(item => include(item) && rank.has(item.file.path)).sort((a, b) => rank.get(a.file.path)! - rank.get(b.file.path)!) })).filter(group => group.items.length);
            }
            const available = new Map(this.groups.flatMap(group => group.items).filter(include).map(item => [item.file.path, item]));
            return [{ key: '', label: '', items: selection.order.flatMap(path => { const item = available.get(path); return item ? [item] : []; }) }];
        }
        return this.groups.map(group => ({ ...group, items: group.items.filter(include) })).filter(group => group.items.length);
    }
    private renderRows(host: HTMLElement): void {
        // Keep the scroller and its logical position across Bases updates and sidebar remounts.
        this.restorePending = true;
        const focus = this.host.ownerDocument.activeElement as HTMLElement | null;
        const focusPath = focus?.closest<HTMLElement>('[data-source-path]')?.dataset.sourcePath;
        const focusGroup = focus?.closest<HTMLElement>('[data-source-group]')?.dataset.sourceGroup;
        const focusAction = focus?.dataset.sourceAction, hadFocus = !!focus && host.contains(focus);
        host.addClass('wm-export-bases-table');
        const snapshot = this.actions.snapshot(), groups = this.visibleGroups(), merge = this.state.mode === 'merge';
        const paths = groups.flatMap(group => group.items.map(item => item.file.path));
        this.checkboxSize = parseFloat(this.host.ownerDocument.defaultView?.getComputedStyle(host).getPropertyValue('--checkbox-size') || '') || 16;
        this.guidePaths.clear(); this.highlightedGuide = '';
        const rootKey = `root:${snapshot.root}`;
        if (this.state.reveal) this.state.collapsed.delete(rootKey);
        const rootCollapsed = this.state.collapsed.has(rootKey);
        if (!this.listEl) {
            const list = this.listEl = host.createDiv({ cls: 'wm-export-source-list' });
            this.layoutObserver?.observe(list);
            list.addEventListener('scroll', () => {
                if (this.disposed || this.restorePending || !list.isConnected || !list.clientHeight) return;
                if (list.scrollTop === this.appliedScroll.top && list.scrollLeft === this.appliedScroll.left) return;
                this.state.scroll = list.scrollTop; this.scrollLeft = list.scrollLeft;
                this.appliedScroll = { top: list.scrollTop, left: list.scrollLeft };
            }, { passive: true });
        }
        if (this.listEl.parentElement !== host) host.replaceChildren(this.listEl);
        // Build off-DOM so the existing list never shrinks to an empty table mid-render.
        const table = this.host.ownerDocument.createElement('table'); table.addClass('wm-export-table');
        table.setAttribute('aria-labelledby', `wm-export-sources-${this.id}`);
        const headings = table.createEl('thead').createEl('tr', { attr: { 'data-source-group': rootKey } });
        const primary = this.treeCell(headings.createEl('th', { attr: { scope: 'col' } }), 0, [], [], !rootCollapsed && paths.length ? rootKey : undefined);
        this.checkbox(primary, paths, wmT('전체 선택')).disabled = !paths.length || snapshot.busy;
        const rootLabel = exportButton(primary, snapshot.projectName || snapshot.root.split('/').pop() || wmT('전체 볼트'), () => {
            if (this.actions.snapshot().busy) return;
            rootCollapsed ? this.state.collapsed.delete(rootKey) : this.state.collapsed.add(rootKey); this.refresh();
        }, 'wm-export-root-label');
        rootLabel.setAttribute('aria-expanded', String(!rootCollapsed)); rootLabel.dataset.sourceAction = 'toggle'; rootLabel.disabled = snapshot.busy;
        for (const column of this.columns.slice(1)) headings.createEl('th', { text: column.label, attr: { scope: 'col' } });
        if (merge) headings.createEl('th', { text: wmT('순서'), cls: 'wm-export-order-cell', attr: { scope: 'col' } });
        const body = table.createEl('tbody'), span = Math.max(1, this.columns.length) + Number(merge);
        const descendants = (branch: SourceBranch): string[] => branch.items.map(item => item.file.path).concat(branch.children.flatMap(descendants));
        const renderBranch = (branch: SourceBranch, depth: number, ancestors: boolean[], owners: string[]): void => {
            const entries = [...branch.children.map(child => ({ child })), ...branch.items.map(item => ({ item }))];
            for (const [index, entry] of entries.entries()) {
                const continuation = [...ancestors, index < entries.length - 1];
                if ('item' in entry) { this.renderFile(body, entry.item, snapshot, merge, depth, continuation, owners); continue; }
                const child = entry.child, collapsed = this.state.collapsed.has(child.key), childPaths = descendants(child);
                const heading = body.createEl('tr', { cls: 'wm-export-bases-group', attr: { 'data-source-group': child.key } }).createEl('td', { attr: { colspan: String(span) } });
                const controls = this.treeCell(heading, depth, continuation, owners, !collapsed ? child.key : undefined); controls.addClass('wm-export-group-controls');
                this.checkbox(controls, childPaths, wmT('{0} 포함', child.label));
                const label = exportButton(controls, '', () => {
                    if (this.actions.snapshot().busy) return;
                    collapsed ? this.state.collapsed.delete(child.key) : this.state.collapsed.add(child.key); this.refresh();
                }, 'wm-export-group-label');
                label.setAttribute('aria-expanded', String(!collapsed)); label.toggleClass('is-collapsed', collapsed);
                label.dataset.sourceAction = 'toggle'; label.disabled = snapshot.busy;
                label.createSpan({ cls: 'wm-export-group-title', text: child.label });
                label.createSpan({ cls: 'wm-export-count', text: `(${childPaths.length})` });
                if (!collapsed) renderBranch(child, depth + 1, continuation, [...owners, child.key]);
            }
        };
        const branches = this.sourceBranches(groups);
        if (this.state.reveal && snapshot.active) {
            const expandActive = (branch: SourceBranch): boolean => {
                const contains = branch.items.some(item => item.file.path === snapshot.active) || branch.children.some(expandActive);
                if (contains) this.state.collapsed.delete(branch.key);
                return contains;
            };
            expandActive(branches);
        }
        if (!rootCollapsed) renderBranch(branches, 1, [], [rootKey]);
        if (!paths.length) body.createEl('tr').createEl('td', { cls: 'wm-export-empty', text: wmT('표시할 문서가 없습니다.'), attr: { colspan: String(span) } });
        this.listEl.replaceChildren(table);
        this.restoreScroll();
        if (hadFocus && focusPath) {
            const row = Array.from(this.listEl.querySelectorAll<HTMLElement>('[data-source-path]')).find(item => item.dataset.sourcePath === focusPath);
            Array.from(row?.querySelectorAll<HTMLElement>('[data-source-action]') ?? []).find(item => item.dataset.sourceAction === focusAction)?.focus({ preventScroll: true });
        } else if (hadFocus && focusGroup) {
            const row = Array.from(host.querySelectorAll<HTMLElement>('[data-source-group]')).find(item => item.dataset.sourceGroup === focusGroup);
            Array.from(row?.querySelectorAll<HTMLElement>('[data-source-action]') ?? []).find(item => item.dataset.sourceAction === focusAction)?.focus({ preventScroll: true });
        }
    }
    private restoreScroll(): void {
        const win = this.host.ownerDocument.defaultView;
        if (this.disposed || !win) return;
        this.restorePending = true;
        win.cancelAnimationFrame(this.layoutFrame);
        this.layoutFrame = win.requestAnimationFrame(() => {
            this.layoutFrame = 0;
            const list = this.listEl;
            if (this.disposed || !list?.isConnected || !list.clientHeight) return;
            if (this.state.reveal) {
                const path = this.actions.snapshot().active;
                const row = Array.from(list.querySelectorAll<HTMLElement>('[data-source-path]')).find(item => item.dataset.sourcePath === path);
                if (path && !row?.getBoundingClientRect().height) return;
                if (row) {
                    const bounds = list.getBoundingClientRect(), target = row.getBoundingClientRect();
                    const header = list.querySelector('thead')?.getBoundingClientRect().height || 0;
                    const top = list.scrollTop + target.top - bounds.top - header - (list.clientHeight - header - target.height) / 2;
                    this.state.scroll = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, top));
                }
                this.state.reveal = false;
            }
            list.scrollTop = this.state.scroll; list.scrollLeft = this.scrollLeft;
            if (this.foldedGuide) {
                const group = Array.from(list.querySelectorAll<HTMLElement>('[data-source-group]')).find(row => row.dataset.sourceGroup === this.foldedGuide);
                if (group && !group.closest('thead')) {
                    const bounds = list.getBoundingClientRect(), target = group.getBoundingClientRect();
                    const header = list.querySelector('thead')?.getBoundingClientRect().height || 0;
                    if (target.top < bounds.top + header) list.scrollTop += target.top - bounds.top - header;
                    else if (target.bottom > bounds.bottom) list.scrollTop += target.bottom - bounds.bottom;
                }
                this.foldedGuide = ''; this.state.scroll = list.scrollTop;
            }
            this.appliedScroll = { top: list.scrollTop, left: list.scrollLeft };
            this.restorePending = false;
        });
    }
    private sourceBranches(groups: SourceGroup[]): SourceBranch {
        const root: SourceBranch = { key: '', label: '', items: [], children: [] };
        const folders = groups.every(group => group.items.every(item => (item.file.parent?.path || '') === group.label));
        if (!folders) {
            for (const group of groups) {
                if (group.label) root.children.push({ ...group, children: [] });
                else root.items.push(...group.items);
            }
            return root;
        }
        const projectRoot = this.actions.snapshot().root;
        for (const group of groups) {
            const relative = group.label === projectRoot ? '' : projectRoot && group.label.startsWith(projectRoot + '/') ? group.label.slice(projectRoot.length + 1) : group.label;
            let branch = root, path = projectRoot;
            for (const name of relative.split('/').filter(Boolean)) {
                path = path ? `${path}/${name}` : name;
                const key = `folder:${path}`;
                let child = branch.children.find(item => item.key === key);
                if (!child) { child = { key, label: name, items: [], children: [] }; branch.children.push(child); }
                branch = child;
            }
            branch.items.push(...group.items);
        }
        return root;
    }
    private treeCell(cell: HTMLElement, depth: number, continuation: boolean[], owners: string[], children?: string): HTMLElement {
        cell.addClass('wm-export-tree-cell');
        const controls = cell.createDiv({ cls: 'wm-export-tree-controls' });
        controls.style.setProperty('--wm-export-depth', String(depth));
        // Each path belongs to the folder whose children it joins. One stroke per owner
        // keeps translucent guides even where the vertical and rounded elbow meet.
        const segments = new Map<string, string[]>(), center = Math.floor(this.checkboxSize / 2), y = 17.5, radius = 6;
        const segment = (owner: string, path: string): void => {
            const paths = segments.get(owner) ?? []; paths.push(path); segments.set(owner, paths);
        };
        for (let level = 0; level < depth; level++) {
            if (level < depth - 1 && !continuation[level]) continue;
            const x = level * 20 + center + 0.5, owner = owners[level];
            if (level < depth - 1) segment(owner, `M ${x} 0 V 34`);
            else {
                if (continuation[level]) segment(owner, `M ${x} 0 V 34`);
                segment(owner, `M ${x} ${continuation[level] ? y - radius : 0} V ${y - radius} Q ${x} ${y} ${x + radius} ${y} H ${depth * 20}`);
            }
        }
        if (children) segment(children, `M ${depth * 20 + center + 0.5} ${17 + Math.ceil(this.checkboxSize / 2)} V 34`);
        if (segments.size) {
            const doc = controls.ownerDocument, ns = 'http://www.w3.org/2000/svg';
            const outline = doc.createElementNS(ns, 'svg');
            outline.setAttribute('class', 'wm-export-tree-outline'); outline.setAttribute('aria-hidden', 'true');
            outline.setAttribute('width', String((depth + 1) * 20)); outline.setAttribute('height', '34');
            for (const [owner, paths] of segments) {
                const path = doc.createElementNS(ns, 'path'); path.setAttribute('class', 'wm-export-guide-path'); path.setAttribute('d', paths.join(' ')); outline.append(path);
                const tracked = this.guidePaths.get(owner) ?? []; tracked.push(path); this.guidePaths.set(owner, tracked);
                const hit = doc.createElementNS(ns, 'path'); hit.setAttribute('class', 'wm-export-guide-hit'); hit.setAttribute('d', paths.join(' ')); outline.append(hit);
                hit.addEventListener('pointerenter', () => this.highlightGuide(owner));
                hit.addEventListener('pointerleave', () => { if (this.highlightedGuide === owner) this.highlightGuide(''); });
                hit.addEventListener('click', event => {
                    event.preventDefault(); event.stopPropagation();
                    if (this.actions.snapshot().busy) return;
                    this.state.collapsed.add(owner); this.foldedGuide = owner; this.refresh();
                });
            }
            controls.prepend(outline);
        }
        return controls;
    }
    private highlightGuide(owner: string): void {
        if (owner === this.highlightedGuide) return;
        for (const path of this.guidePaths.get(this.highlightedGuide) ?? []) path.classList.remove('is-highlighted');
        this.highlightedGuide = owner;
        for (const path of this.guidePaths.get(owner) ?? []) path.classList.add('is-highlighted');
    }
    private checkbox(host: HTMLElement, paths: string[], label: string): HTMLInputElement {
        const snapshot = this.actions.snapshot(), state = snapshot.selection.state(paths);
        const input = host.createEl('input', { type: 'checkbox', attr: { 'aria-label': label } });
        input.checked = state === 'all'; input.indeterminate = state === 'some'; input.disabled = snapshot.busy; input.dataset.sourceAction = 'check';
        input.addEventListener('change', () => { if (this.actions.snapshot().busy) return; this.actions.snapshot().selection.toggle(paths, input.checked); this.actions.changed(); });
        return input;
    }
    private manualOrder(action: () => void): void {
        if (this.actions.snapshot().busy) return;
        action(); this.pendingManualOrder = !!this.nativeOwner?.config.getSort().length; this.syncBase(true); this.actions.changed();
    }
    private renderFile(host: HTMLElement, item: SourceItem, snapshot: SourceSnapshot, merge: boolean, depth: number, continuation: boolean[], owners: string[]): void {
        const { file } = item, index = snapshot.selection.order.indexOf(file.path);
        const row = host.createEl('tr', { cls: 'wm-export-document-row', attr: { 'data-source-path': file.path } });
        row.toggleClass('is-active', file.path === snapshot.active); row.toggleClass('is-included', index >= 0);
        const primary = this.treeCell(row.createEl('td', { cls: 'wm-export-value-cell' }), depth, continuation, owners);
        this.checkbox(primary, [file.path], wmT('{0} 포함', file.basename));
        const columns = this.columns.length ? this.columns : [{ id: 'file.name' as BasesPropertyId, label: wmT('문서') }];
        for (const [position, column] of columns.entries()) {
            const cell = position ? row.createEl('td', { cls: 'wm-export-value-cell' }) : primary;
            const button = exportButton(cell, item.values[position] ?? file.basename, () => { if (!this.actions.snapshot().busy) this.actions.preview(file.path); }, 'wm-export-document-name');
            button.dataset.sourceAction = `preview-${column.id}`;
            if (file.path === snapshot.active) button.setAttribute('aria-current', 'true');
        }
        row.addEventListener('keydown', event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            if (event.altKey && merge) { event.preventDefault(); this.manualOrder(() => snapshot.selection.step(file.path, event.key === 'ArrowDown' ? 1 : -1)); return; }
            if (event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            const rows = Array.from(host.querySelectorAll<HTMLElement>('[data-source-path]'));
            const target = rows[Math.max(0, Math.min(rows.length - 1, rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)))];
            target?.querySelector<HTMLElement>((event.target as HTMLElement).tagName === 'BUTTON' ? 'button' : 'input')?.focus();
        });
        if (!merge) return;
        const order = row.createEl('td', { cls: 'wm-export-order-cell' }), moves = order.createDiv({ cls: 'wm-export-order-actions' });
        row.draggable = true;
        for (const [icon, delta, label] of [['chevron-up', -1, wmT('위로 이동')], ['chevron-down', 1, wmT('아래로 이동')]] as const) {
            const button = createToolbarIconButton(moves, icon, label, () => this.manualOrder(() => snapshot.selection.step(file.path, delta)));
            button.dataset.sourceAction = delta < 0 ? 'up' : 'down'; button.disabled = snapshot.busy || index + delta < 0 || index + delta >= snapshot.selection.order.length;
        }
        row.addEventListener('dragstart', event => { if (this.actions.snapshot().busy) { event.preventDefault(); return; } this.dragging = file.path; event.dataTransfer?.setData('text/plain', file.path); });
        row.addEventListener('dragover', event => { if (this.dragging && !this.actions.snapshot().busy) { event.preventDefault(); row.addClass('is-drop-target'); } });
        row.addEventListener('dragleave', () => row.removeClass('is-drop-target'));
        row.addEventListener('drop', event => { event.preventDefault(); if (this.dragging) this.manualOrder(() => { snapshot.selection.move(this.dragging, file.path); this.dragging = ''; }); });
        row.addEventListener('dragend', () => { this.dragging = ''; row.removeClass('is-drop-target'); });
    }
}
