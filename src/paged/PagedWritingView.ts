import { wmT } from '../i18n/index';
import { caretRangeAtPoint, isComposingKey } from '../utils/inputCompatibility';
import { detachedEl, detachedFragment } from '../utils/dom';
import {
	Notice,
	Scope,
	FileView,
	MarkdownView,
	WorkspaceLeaf,
	setIcon,
} from 'obsidian';
import type {
	Editor,
	EditorPosition,
	EditorRange,
	EditorSelectionOrCaret,
	EditorTransaction,
	Menu,
	TFile,
} from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type {
	PagedInlineFormatKind,
	PagedInlineFormatRange,
	PagedParagraphAlignment,
	PagedParagraphAlignmentValue,
	PagedTextColorRange,
} from '../types';
import { PaginationEngine } from './PaginationEngine';
import { closestParagraph, closestTextRun, getTextRuns, logicalTextLength, renderPagedText, serializePagedText } from './textLayout';
import { DEFAULT_PAGE_GEOMETRY, type PageGeometry, type PageRange } from './types';
import { CSS_PX_PER_MM as PX_PER_MM } from '../utils/typography';
import { createPagedEditorContextMenu } from './PagedEditorContextMenu';
import { PagedFileStore, mergePagedMetadata, splitPagedFrontmatter as splitFrontmatter, type PagedFileConflict } from './PagedFileStore';
import { PagedFileConflictModal } from './PagedFileConflictModal';
import { textEdits, validatedEdits, type TextEdit } from '../utils/TextEdits';
import { loadPagedZoom, savePagedZoom } from './PagedZoomStorage';
import { curvedQuoteAt } from '../editor/curvedQuotes';
import { obsidianConfig } from '../utils/obsidianConfig';

export const PAGED_WRITING_VIEW_TYPE = 'writing-menu-paged-writing';

// In the paged workspace, 100% is the comfortable overview size rather than
// a physical CSS-pixel A4 size. At this baseline five pages fit across a wide
// desktop window; the formatter and the visible pages still share the exact
// same effective geometry.
const PAGE_DISPLAY_SCALE_AT_100 = 0.35;
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const PAGE_GAP = 8;
const PAGE_BORDER_SIZE = 2;
const MAX_HISTORY = 100;
const COMPOSITION_PREVIEW_PAGE_COUNT = 1;
const MIN_COMPOSITION_PREVIEW_CHARACTER_WINDOW = 2048;
const MAX_COMPOSITION_PREVIEW_CHARACTER_WINDOW = 8192;

interface TextSelection {
	anchor: number;
	head: number;
}

interface HistorySnapshot extends TextSelection {
	data: string;
	frontmatterPrefix: string;
	textColors: PagedTextColorRange[];
	textBackgrounds: PagedTextColorRange[];
	inlineFormats: PagedInlineFormatRange[];
	paragraphAlignments: PagedParagraphAlignment[];
}

interface PageRenderState {
	text: string;
	absoluteFrom: number;
	firstLineStartsParagraph: boolean;
	hasFollowingPage: boolean;
	styleVersion: number;
	styleSignature: string;
}

interface PaginationReuseHint {
	pages: PageRange[];
	from: number;
	to: number;
	insertLength: number;
	startPageIndex: number;
}

interface FindMatch {
	from: number;
	to: number;
}

interface AutocompleteOption {
	open: string;
	close: string;
}

type EditKind = 'insert' | 'delete' | 'paste' | 'cut' | 'enter' | 'other';
/**
 * A paged editor with one editing host and one logical selection.
 * Pages are visual fragments of `data`, never separate editors or focus targets.
 */
export class PagedWritingView extends FileView {
	private readonly plugin: WritingMenuPlugin;
	private frontmatterPrefix = '';
	private editableData = '';
	private hasLoadedDocument = false;
	private projectScopeRedirecting = false;
	private pageGeometry: PageGeometry;
	private rootEl: HTMLElement | null = null;
	private viewportEl: HTMLElement | null = null;
	private editRootEl: HTMLElement | null = null;
	private measurerEl: HTMLElement | null = null;
	private pagination: PaginationEngine | null = null;
	private pages: PageRange[] = [{ index: 0, from: 0, to: 0 }];
	private pageEls: HTMLElement[] = [];
	private pageTextEls: Array<HTMLElement | null> = [];
	private compositionPreviewEls: HTMLElement[] = [];
	private compositionPreviewFrame = 0;
	private compositionScrollPageIndex: number | null = null;
	private readonly pageRenderStates = new WeakMap<HTMLElement, PageRenderState>();
	private readonly nativeEditedPageEls = new WeakSet<HTMLElement>();
	private cachedSelection: TextSelection = { anchor: 0, head: 0 };
	private cachedSelectionPageIndex: number | null = 0;
	private zoom = DEFAULT_ZOOM;
	private gridColumns = 1;
	private gridDisplayWidth = -1;
	private viewportWidth = 0;
	private resizeObserver: ResizeObserver | null = null;
	private dirtyPageIndex: number | null = 0;
	private pendingPaginationReuse: PaginationReuseHint | null = null;
	private composing = false;
	private compositionSession: { source: string; from: number; to: number; pageFrom: number; pageTo: number; text: string | null; targetCaptured: boolean } | null = null;
	private compositionCommit: { text: string; source: string; selection: TextSelection } | null = null;
	private pointerSelecting = false;
	private rendering = false;
	private visibleRenderFrame = 0;
	private compositionDirty = false;
	private normalizingSelection = false;
	private selectionListener: (() => void) | null = null;
	private undoStack: HistorySnapshot[] = [];
	private redoStack: HistorySnapshot[] = [];
	private lastHistoryKind: EditKind | null = null;
	private lastHistoryAt = 0;
	private textStyleVersion = 0;
	private textStyleSaveTimer = 0;
	private layoutSignature: string;
	private editorAdapter: Editor | null = null;
	private findBarEl: HTMLElement | null = null;
	private findInputEl: HTMLInputElement | null = null;
	private findCountEl: HTMLElement | null = null;
	private findReplaceInputEl: HTMLInputElement | null = null;
	private findMatches: FindMatch[] = [];
	private activeFindMatch = -1;
	private findRenderFrame = 0;
	private externalSelectionRestoreFrame = 0;
	private typewriterScrollFrame = 0;
	private typewriterScrollTarget: number | null = null;
	private pagedFocusTyping = false;
	private activeFocusParagraphEl: HTMLElement | null = null;
	private autocompleteEl: HTMLElement | null = null;
	private autocompleteOptions: AutocompleteOption[] = [];
	private autocompleteIndex = 0;
	private autocompleteFrom = -1;
	private autocompleteTo = -1;
	private liveDocumentCleanup: (() => void) | null = null;
	private fileStore: PagedFileStore | null = null;
	private fileSaveTimer = 0;
	private conflictModal: PagedFileConflictModal | null = null;
	private conflictBanner: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: WritingMenuPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.scope = new Scope(this.app.scope);
		this.scope.register(['Mod'], 's', event => {
			if (event.shiftKey || event.altKey) return;
			void this.save().then(() => {
				if (this.fileStore?.hasConflict) this.conflictBanner?.querySelector('button')?.click();
			}).catch(error => this.reportSaveError(error));
			return false;
		});
		this.scope.register(['Mod'], 'f', event => {
			if (event.shiftKey) return;
			this.openFindBar();
			return false;
		});
		this.scope.register(['Mod'], 'h', () => {
			this.openFindBar(true);
			return false;
		});
		for (const [key, kind] of [
			['b', 'bold'],
			['i', 'italic'],
			['u', 'underline'],
		] as const) {
			this.scope.register(['Mod'], key, event => {
				if (event.altKey || event.shiftKey) return;
				return this.handleScopedFormatShortcut(event, kind);
			});
		}
		this.scope.register(['Mod', 'Shift'], 's', event => {
			if (event.altKey) return;
			return this.handleScopedFormatShortcut(event, 'strikethrough');
		});
		this.pageGeometry = this.getPageGeometryFromSettings();
		this.layoutSignature = this.getLayoutSignature(this.pageGeometry);
	}

	getViewType(): string {
		return PAGED_WRITING_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file?.basename ?? wmT("여러 쪽 보기");
	}

	getIcon(): string {
		return 'layout-grid';
	}

	onPaneMenu(menu: Menu, source: string): void {
		// Reuse Obsidian's complete Markdown menu, including file-menu extensions,
		// instead of duplicating its labels and platform-specific actions.
		const context = Object.assign(Object.create(this) as MarkdownView, {
			editor: this.getEditorAdapter(),
			getMode: () => 'source',
			getState: () => ({ ...this.getState(), mode: 'source', source: false }),
			canShowProperties: () => (obsidianConfig(this.app, 'propertiesInDocument') ?? 'visible') === 'visible',
			onSwitchView: () => { void this.openInSourceView('preview'); },
			showSearch: (replace = false) => this.openFindBar(replace),
			printToPdf: async () => {
				await this.openInSourceView();
				const view = this.leaf.view as MarkdownView & { printToPdf?: () => Promise<void> };
				if (view instanceof MarkdownView) await view.printToPdf?.();
			},
		});
		MarkdownView.prototype.onPaneMenu.call(context, menu, source);
	}

	canAcceptExtension(extension: string): boolean {
		return extension === 'md';
	}

	onload(): void {
		super.onload();
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (file !== this.file) return;
			savePagedZoom(this.app, file.path, this.zoom);
			savePagedZoom(this.app, oldPath, null);
		}));
		this.registerEvent(this.app.vault.on('modify', file => {
			if (file === this.file) void this.fileStore?.refresh().catch(error => this.reportSaveError(error));
		}));
	}
	async onLoadFile(file: TFile): Promise<void> {
		const savedZoom = loadPagedZoom(this.app, file.path);
		this.zoom = typeof savedZoom === 'number' && Number.isFinite(savedZoom)
			? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, savedZoom)) : DEFAULT_ZOOM;
		await super.onLoadFile(file);
		const project = this.plugin.projectContext.getProjectForFile(file);
		const folder = `${project?.rootFolder ? `${project.rootFolder}/` : ''}.writing-menu/paged-conflicts`;
		const store = new PagedFileStore(this.app.vault, file, folder, () => this.getViewData(),
			(data, clear) => { this.setViewData(data, clear); if (!clear) this.app.workspace.trigger('quick-preview', file, data); },
			conflict => this.showFileConflict(store, conflict), mergePagedMetadata);
		this.fileStore = store;
		await store.load();
	}
	async onUnloadFile(file: TFile): Promise<void> {
		window.clearTimeout(this.fileSaveTimer); this.fileSaveTimer = 0;
		await this.save(); this.fileStore?.dispose(); this.fileStore = null;
		this.conflictModal?.close(); this.conflictModal = null;
		this.conflictBanner?.remove(); this.conflictBanner = null;
		this.clear(); await super.onUnloadFile(file);
	}
	requestSave(): void {
		window.clearTimeout(this.fileSaveTimer);
		if (this.fileStore) this.fileSaveTimer = window.setTimeout(() => {
			this.fileSaveTimer = 0; void this.save().catch(error => this.reportSaveError(error));
		}, 2000);
	}
	async save(): Promise<void> {
		if ((this.composing || this.compositionDirty) && this.syncSourceFromDom(false)) this.fileStore?.changed();
		await this.fileStore?.save();
	}
	private reportSaveError(error: unknown): void {
		console.error('[Writing Menu] Paged document save failed', error);
		new Notice(wmT("문서를 저장하지 못했습니다. 편집창을 닫지 말고 다시 시도해주세요.\n{0}", error instanceof Error ? error.message : String(error)), 0);
	}
	private showFileConflict(store: PagedFileStore, conflict: PagedFileConflict): void {
		new Notice(wmT("자동 병합을 멈추고 양쪽 내용을 보존했습니다. 내 편집본: {0}", conflict.localPath), 0);
		const open = () => {
			if (this.conflictModal?.containerEl.isConnected) return;
			this.conflictModal = new PagedFileConflictModal(this.app, () => store.review, async choice => {
				await store.resolve(choice).then(() => {
					if (!store.hasConflict) { this.conflictBanner?.remove(); this.conflictBanner = null; }
					else throw new Error(wmT("외부 변경이 추가되었습니다. 최신 내용으로 다시 검토해 주세요."));
					this.requestSave();
				});
			}); this.conflictModal.open();
		};
		if (this.rootEl) {
			this.conflictBanner ??= this.rootEl.createDiv({ cls: 'wm-paged-conflict-banner', attr: { role: 'status' } });
			this.rootEl.insertBefore(this.conflictBanner, this.findBarEl ?? this.viewportEl);
			this.conflictBanner.empty();
			this.conflictBanner.createSpan({ text: wmT("외부 변경과 충돌했습니다. 원본 자동저장은 멈추고 편집본을 별도 보존합니다.") });
			this.conflictBanner.createEl('button', { text: wmT("변경본 선택") }).addEventListener('click', open);
		}
		open();
	}

	async onOpen(): Promise<void> {
		this.liveDocumentCleanup?.();
		const workspace = this.app.workspace;
		if (workspace?.on) {
			const ref = workspace.on('quick-preview', (file, data) => {
				if (file !== this.file || data === this.getViewData() || this.composing) return;
				const peer = workspace.getMostRecentLeaf?.()?.view;
				const peerIsEditing = peer instanceof MarkdownView && peer.file === file && peer.editor.hasFocus();
				// A Sync update echoed by an inactive Markdown tab is an external
				// write, not a new local keystroke. Let the guarded disk reader handle it.
				if (this.fileStore && !peerIsEditing) {
					void this.fileStore.refresh().catch(error => this.reportSaveError(error)); return;
				}
				if (this.fileStore?.hasConflict) return;
				// Native Markdown views exchange their live buffer before the delayed
				// disk save. Participate in that same channel, not a second editor copy.
				this.setViewData(data, false);
				this.fileStore?.changed(); this.requestSave();
			});
			this.liveDocumentCleanup = () => workspace.offref(ref);
		}
		this.buildLayout();
		this.installEventHandlers();
		this.installObservers();
		this.updateGridColumns();
		this.paginateNow(true);
	}

	async onClose(): Promise<void> {
		window.clearTimeout(this.fileSaveTimer); this.fileSaveTimer = 0;
		await this.save(); this.fileStore?.dispose(); this.fileStore = null;
		this.conflictModal?.close(); this.conflictModal = null;
		this.conflictBanner?.remove(); this.conflictBanner = null;
		this.liveDocumentCleanup?.();
		this.liveDocumentCleanup = null;
		this.clearCompositionOverflowPreview();
		this.plugin.toolbarManager.removeToolbarFromLeaf(this.leaf);
		if (this.visibleRenderFrame) window.cancelAnimationFrame(this.visibleRenderFrame);
		this.visibleRenderFrame = 0;
		if (this.findRenderFrame) window.cancelAnimationFrame(this.findRenderFrame);
		this.findRenderFrame = 0;
		if (this.externalSelectionRestoreFrame) window.cancelAnimationFrame(this.externalSelectionRestoreFrame);
		this.externalSelectionRestoreFrame = 0;
		if (this.typewriterScrollFrame) window.cancelAnimationFrame(this.typewriterScrollFrame);
		this.typewriterScrollFrame = 0;
		this.typewriterScrollTarget = null;
		this.activeFocusParagraphEl = null;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		if (this.selectionListener && this.editRootEl) {
			this.editRootEl.ownerDocument.removeEventListener('selectionchange', this.selectionListener);
		}
		this.selectionListener = null;
		this.rootEl = null;
		this.viewportEl = null;
		this.editRootEl = null;
		this.measurerEl = null;
		this.findBarEl = null;
		this.findInputEl = null;
		this.findCountEl = null;
		this.findReplaceInputEl = null;
		this.findMatches = [];
		this.dismissAutocomplete();
		this.pageEls = [];
		this.pageTextEls = [];
		if (this.textStyleSaveTimer) {
			window.clearTimeout(this.textStyleSaveTimer);
			this.textStyleSaveTimer = 0;
			await this.plugin.saveData(this.plugin.settings);
		}
	}

	getViewData(): string {
		// The editable buffer is independent from any pending disk write.
		return this.frontmatterPrefix + this.editableData;
	}

	/** Text exposed by the paged canvas. YAML properties stay outside its selection model. */
	getEditableData(): string {
		return this.editableData;
	}

	private setEditableData(body: string): void {
		this.editableData = body;
	}

	getSelectedText(): string {
		const selection = this.readSelection() ?? this.cachedSelection;
		const from = Math.min(selection.anchor, selection.head);
		const to = Math.max(selection.anchor, selection.head);
		return this.getEditableData().slice(from, to);
	}

	/** Commands exposed to the shared writing toolbar. */
	refreshToolbarMount(): void {
		if (this.rootEl) this.plugin.toolbarManager.mountPagedToolbar(this.rootEl, this);
	}

	enforceProjectScope(): void {
		if (!this.file || this.projectScopeRedirecting || this.plugin.projectContext.getProjectForFile(this.file)) return;
		this.projectScopeRedirecting = true;
		void this.openInSourceView().finally(() => { this.projectScopeRedirecting = false; });
	}

	focusEditorFromToolbar(): void {
		this.editRootEl?.focus({ preventScroll: true });
		this.restoreSelection(this.cachedSelection, true);
	}

	undoFromToolbar(): void {
		this.undo();
	}

	redoFromToolbar(): void {
		this.redo();
	}

	toggleFormatFromToolbar(kind: PagedInlineFormatKind): void {
		this.toggleSelectedTextFormat(kind);
	}

	isFormatActiveForToolbar(kind: PagedInlineFormatKind): boolean {
		const selection = this.readSelection() ?? this.cachedSelection;
		const from = Math.min(selection.anchor, selection.head);
		const to = Math.max(selection.anchor, selection.head);
		return from !== to && this.isInlineFormatRangeCovered(kind, from, to);
	}

	preserveSelectionFromToolbar(event: PointerEvent): void {
		this.preserveEditorSelection(event);
	}

	getAlignmentForToolbar(): PagedParagraphAlignmentValue | null {
		return this.getSelectionParagraphAlignment(this.readSelection() ?? this.cachedSelection);
	}

	setAlignmentFromToolbar(alignment: PagedParagraphAlignmentValue): void {
		this.applyParagraphAlignment(alignment);
	}

	applyTextColorFromToolbar(color: string, target: 'text' | 'background'): void {
		this.applySelectedTextColor(color, target);
	}

	clearTextColorsFromToolbar(): void {
		this.clearSelectedTextColors();
	}

	getRecentTextColorForToolbar(): string {
		return this.getLastTextColor();
	}

	openMarkdownFromToolbar(): Promise<void> {
		return this.openInSourceView();
	}

	getZoomForToolbar(): number {
		return this.zoom;
	}

	setZoomFromToolbar(value: number): void {
		this.setZoom(value);
	}

	/**
	 * Exposes the paged surface through the subset of Obsidian's Editor API used
	 * by Writing Menu tools. Edits still pass through this view's one history,
	 * formatting and pagination pipeline.
	 */
	getEditorAdapter(): Editor {
		if (this.editorAdapter) return this.editorAdapter;
		const clampOffset = (offset: number) => Math.max(0, Math.min(this.getEditableData().length, offset));
		const posToOffset = (position: EditorPosition): number => {
			const source = this.getEditableData();
			const lines = source.split('\n');
			const line = Math.max(0, Math.min(lines.length - 1, Math.floor(position.line)));
			let offset = 0;
			for (let index = 0; index < line; index++) offset += lines[index].length + 1;
			return clampOffset(offset + Math.max(0, Math.min(lines[line].length, Math.floor(position.ch))));
		};
		const offsetToPos = (rawOffset: number): EditorPosition => {
			const source = this.getEditableData();
			const offset = clampOffset(rawOffset);
			const before = source.slice(0, offset);
			const line = before.split('\n').length - 1;
			const lineStart = before.lastIndexOf('\n') + 1;
			return { line, ch: offset - lineStart };
		};
		const currentSelection = (): TextSelection => this.readSelection() ?? this.cachedSelection;
		const setSelection = (anchor: number, head = anchor) => {
			const selection = { anchor: clampOffset(anchor), head: clampOffset(head) };
			this.cachedSelection = selection;
			this.restoreSelection(selection, true);
			this.refreshToolbarSelection();
		};
		const scrollOffsetIntoView = (offset: number, center = false) => {
			const pageIndex = this.findPageIndex(clampOffset(offset));
			this.renderPageIfNeeded(pageIndex);
			this.pageEls[pageIndex]?.scrollIntoView({
				block: center ? 'center' : 'nearest',
				inline: 'nearest',
				behavior: 'auto',
			});
		};

		let adapter: Editor;
		adapter = {
			getDoc: () => adapter,
			refresh: () => this.refreshPageTexts(this.cachedSelection),
			getValue: () => this.getEditableData(),
			setValue: (content: string) => this.applyEdit(0, this.getEditableData().length, content, 'other'),
			getLine: (line: number) => this.getEditableData().split('\n')[Math.max(0, line)] ?? '',
			setLine: (line: number, text: string) => {
				const source = this.getEditableData();
				const lines = source.split('\n');
				const safeLine = Math.max(0, Math.min(lines.length - 1, line));
				const from = posToOffset({ line: safeLine, ch: 0 });
				const to = posToOffset({ line: safeLine, ch: lines[safeLine].length });
				this.applyEdit(from, to, text, 'other');
			},
			lineCount: () => this.getEditableData().split('\n').length,
			lastLine: () => Math.max(0, this.getEditableData().split('\n').length - 1),
			getSelection: () => {
				const selection = currentSelection();
				return this.getEditableData().slice(
					Math.min(selection.anchor, selection.head),
					Math.max(selection.anchor, selection.head),
				);
			},
			somethingSelected: () => {
				const selection = currentSelection();
				return selection.anchor !== selection.head;
			},
			getRange: (from: EditorPosition, to: EditorPosition) => this.getEditableData().slice(posToOffset(from), posToOffset(to)),
			replaceSelection: (replacement: string) => {
				const selection = currentSelection();
				this.applyEdit(
					Math.min(selection.anchor, selection.head),
					Math.max(selection.anchor, selection.head),
					replacement,
					'other',
				);
				this.scheduleExternalSelectionRestore();
			},
			replaceRange: (replacement: string, from: EditorPosition, to?: EditorPosition) => {
				const start = posToOffset(from);
				this.applyEdit(start, to ? posToOffset(to) : start, replacement, 'other');
				this.scheduleExternalSelectionRestore();
			},
			getCursor: (side?: 'from' | 'to' | 'head' | 'anchor') => {
				const selection = currentSelection();
				const offset = side === 'from'
					? Math.min(selection.anchor, selection.head)
					: side === 'to'
						? Math.max(selection.anchor, selection.head)
						: side === 'anchor' ? selection.anchor : selection.head;
				return offsetToPos(offset);
			},
			listSelections: () => {
				const selection = currentSelection();
				return [{ anchor: offsetToPos(selection.anchor), head: offsetToPos(selection.head) }];
			},
			setCursor: (position: EditorPosition | number, ch?: number) => {
				const offset = typeof position === 'number'
					? posToOffset({ line: position, ch: ch ?? 0 })
					: posToOffset(position);
				setSelection(offset);
			},
			setSelection: (anchor: EditorPosition, head?: EditorPosition) => setSelection(
				posToOffset(anchor),
				posToOffset(head ?? anchor),
			),
			setSelections: (ranges: EditorSelectionOrCaret[], main = 0) => {
				const range = ranges[Math.max(0, Math.min(ranges.length - 1, main))];
				if (range) setSelection(posToOffset(range.anchor), posToOffset(range.head ?? range.anchor));
			},
			focus: () => this.editRootEl?.focus({ preventScroll: true }),
			blur: () => this.editRootEl?.blur(),
			hasFocus: () => !!this.editRootEl?.contains(this.editRootEl.ownerDocument.activeElement),
			getScrollInfo: () => ({
				top: this.viewportEl?.scrollTop ?? 0,
				left: this.viewportEl?.scrollLeft ?? 0,
			}),
			scrollTo: (x?: number | null, y?: number | null) => this.viewportEl?.scrollTo({
				left: x ?? this.viewportEl.scrollLeft,
				top: y ?? this.viewportEl.scrollTop,
			}),
			scrollIntoView: (range: EditorRange, center?: boolean) => scrollOffsetIntoView(posToOffset(range.from), center),
			undo: () => this.undo(),
			redo: () => this.redo(),
			exec: (command: string) => {
				if (command === 'undo') this.undo();
				else if (command === 'redo') this.redo();
			},
			transaction: (transaction: EditorTransaction) => {
				if (transaction.replaceSelection !== undefined) adapter.replaceSelection(transaction.replaceSelection);
				if (transaction.changes?.length) {
					const changes = transaction.changes.slice().sort((left, right) => posToOffset(right.from) - posToOffset(left.from));
					this.applyTextEdits(changes.map(change => ({ from: posToOffset(change.from), to: posToOffset(change.to ?? change.from), text: change.text })));
				}
				const selection = transaction.selection;
				if (selection) adapter.setSelection(selection.from, selection.to);
				else if (transaction.selections?.length) {
					adapter.setSelections(transaction.selections.map(item => ({ anchor: item.from, head: item.to })));
				}
			},
			wordAt: (position: EditorPosition) => {
				const source = this.getEditableData();
				let from = posToOffset(position);
				let to = from;
				while (from > 0 && !/\s/.test(source[from - 1])) from--;
				while (to < source.length && !/\s/.test(source[to])) to++;
				return from === to ? null : { from: offsetToPos(from), to: offsetToPos(to) };
			},
			posToOffset,
			offsetToPos,
		} as unknown as Editor;
		this.editorAdapter = adapter;
		return adapter;
	}

	private scheduleExternalSelectionRestore(): void {
		if (this.externalSelectionRestoreFrame) window.cancelAnimationFrame(this.externalSelectionRestoreFrame);
		const selection = { ...this.cachedSelection };
		this.externalSelectionRestoreFrame = window.requestAnimationFrame(() => {
			this.externalSelectionRestoreFrame = 0;
			if (!this.editRootEl?.isConnected) return;
			const pageIndex = this.findPageIndex(selection.head);
			this.cachedSelection = selection;
			this.cachedSelectionPageIndex = pageIndex;
			this.renderPageIfNeeded(pageIndex);
			this.restoreSelection(selection, false);
		});
	}

	refreshFromSettings(): void {
		this.textStyleVersion++;
		const nextGeometry = this.getPageGeometryFromSettings();
		const nextSignature = this.getLayoutSignature(nextGeometry);
		const layoutChanged = nextSignature !== this.layoutSignature;
		this.pageGeometry = nextGeometry;
		this.layoutSignature = nextSignature;
		this.applyGeometryVariables();
		if (!this.plugin.settings.enableFocusMode) this.deactivatePagedFocusMode();
		else this.updatePagedFocusLine();
		this.updateGridColumns();
		if (layoutChanged && this.measurerEl) {
			this.pagination = new PaginationEngine(this.measurerEl, this.getPaginationGeometry());
			this.dirtyPageIndex = 0;
			this.paginateNow(true);
		} else {
			this.pagination?.updateGeometry(this.getPaginationGeometry());
			this.renderVisiblePages();
		}
		this.plugin.toolbarManager.refreshToolbar(this.leaf);
	}

	setViewData(data: string, clear: boolean): void {
		const { prefix, body } = splitFrontmatter(data);
		if (
			!clear
			&& body === this.getEditableData()
			&& prefix === this.frontmatterPrefix
			&& this.pageTextEls.length > 0
		) return;
		const previousData = this.getEditableData();
		if (!clear && this.hasLoadedDocument && prefix.length !== this.frontmatterPrefix.length) {
			this.shiftStoredStyleOffsets(prefix.length - this.frontmatterPrefix.length);
		}
		this.frontmatterPrefix = prefix;
		this.hasLoadedDocument = true;
		if (this.file && !this.plugin.projectContext.getProjectForFile(this.file)) {
			this.setEditableData(body);
			this.enforceProjectScope();
			return;
		}
		this.pendingPaginationReuse = null;
		this.setEditableData(body);
		if (!clear && body !== previousData) this.remapPagedStylesForSourceChange(previousData, body);
		if (clear) this.textStyleVersion++;
		this.cachedSelection = clear
			? { anchor: 0, head: 0 }
			: {
				anchor: Math.min(this.cachedSelection.anchor, body.length),
				head: Math.min(this.cachedSelection.head, body.length),
			};
		if (clear) {
			this.cachedSelectionPageIndex = 0;
			this.clearHistory();
			this.deactivatePagedFocusMode();
		}
		this.dirtyPageIndex = 0;
		if (this.findBarEl && !this.findBarEl.hidden) this.refreshFindMatches(false);
		if (this.editRootEl) this.paginateNow(false, this.cachedSelection);
		if (this.rootEl) this.plugin.toolbarManager.mountPagedToolbar(this.rootEl, this);
		this.refreshToolbarSelection();
	}

	clear(): void {
		this.clearCompositionOverflowPreview();
		this.releaseTypewriterScroll();
		this.compositionSession = null;
		this.compositionCommit = null;
		this.composing = false;
		this.frontmatterPrefix = '';
		this.setEditableData('');
		this.hasLoadedDocument = false;
		this.pages = [{ index: 0, from: 0, to: 0 }];
		this.cachedSelection = { anchor: 0, head: 0 };
		this.cachedSelectionPageIndex = 0;
		this.activeFocusParagraphEl = null;
		this.clearHistory();
		this.dirtyPageIndex = 0;
		this.pendingPaginationReuse = null;
		this.textStyleVersion++;
		this.rendering = true;
		this.editRootEl?.empty();
		this.pageEls = [];
		this.pageTextEls = [];
		this.compositionPreviewEls = [];
		this.rendering = false;
		this.refreshToolbarSelection();
	}

	private buildLayout(): void {
		const contentEl = this.containerEl.children[1] as HTMLElement;
		contentEl.empty();
		contentEl.addClass('wm-paged-view-content');

		this.rootEl = contentEl.createDiv({ cls: 'wm-paged-view' });
		this.applyGeometryVariables();
		this.plugin.toolbarManager.mountPagedToolbar(this.rootEl, this);
		this.renderFindBar(this.rootEl);

		this.viewportEl = this.rootEl.createDiv({ cls: 'wm-paged-viewport' });
		this.editRootEl = this.viewportEl.createDiv({
			cls: 'wm-paged-grid wm-paged-editor-root',
			attr: {
				contenteditable: 'plaintext-only',
				role: 'textbox',
				'aria-multiline': 'true',
				spellcheck: 'false',
				autocapitalize: 'off',
			},
		});

		this.measurerEl = this.rootEl.createDiv({ cls: 'wm-paged-measurer', attr: { 'aria-hidden': 'true' } });
		this.applyPaginationMeasurementVariables();
		this.pagination = new PaginationEngine(this.measurerEl, this.getPaginationGeometry());
	}

	private renderFindBar(container: HTMLElement): void {
		const bar = container.createDiv({
			cls: 'wm-paged-findbar',
			attr: { role: 'search', 'aria-label': wmT("문서에서 찾기 및 바꾸기") },
		});
		bar.hidden = true;
		const findRow = bar.createDiv({ cls: 'wm-paged-find-row is-find' });
		const searchIcon = findRow.createSpan({ cls: 'wm-paged-find-icon', attr: { 'aria-hidden': 'true' } });
		setIcon(searchIcon, 'search');
		const input = findRow.createEl('input', {
			type: 'search',
			placeholder: wmT("문서에서 찾기"),
			attr: { autocomplete: 'off', spellcheck: 'false' },
		});
		const count = findRow.createSpan({ cls: 'wm-paged-find-count', text: '0/0', attr: { 'aria-live': 'polite' } });
		const previous = findRow.createEl('button', {
			cls: 'wm-paged-find-action clickable-icon',
			attr: { type: 'button', 'aria-label': wmT("이전 검색 결과") },
		});
		setIcon(previous, 'chevron-up');
		const next = findRow.createEl('button', {
			cls: 'wm-paged-find-action clickable-icon',
			attr: { type: 'button', 'aria-label': wmT("다음 검색 결과") },
		});
		setIcon(next, 'chevron-down');
		const close = findRow.createEl('button', {
			cls: 'wm-paged-find-action clickable-icon',
			attr: { type: 'button', 'aria-label': wmT("검색 닫기") },
		});
		setIcon(close, 'x');

		const replaceRow = bar.createDiv({ cls: 'wm-paged-find-row is-replace' });
		const replaceIcon = replaceRow.createSpan({ cls: 'wm-paged-find-icon', attr: { 'aria-hidden': 'true' } });
		setIcon(replaceIcon, 'replace');
		const replaceInput = replaceRow.createEl('input', {
			type: 'text',
			placeholder: wmT("바꿀 내용"),
			attr: { autocomplete: 'off', spellcheck: 'false' },
		});
		const replaceOne = replaceRow.createEl('button', {
			cls: 'wm-paged-find-replace-button',
			text: wmT("바꾸기"),
			attr: { type: 'button' },
		});
		const replaceAll = replaceRow.createEl('button', {
			cls: 'wm-paged-find-replace-button',
			text: wmT("모두"),
			attr: { type: 'button', 'aria-label': wmT("모두 바꾸기") },
		});

		input.addEventListener('input', () => this.refreshFindMatches(true));
		input.addEventListener('keydown', event => {
			event.stopPropagation();
			if (event.key === 'Enter') {
				event.preventDefault();
				this.navigateFindMatch(event.shiftKey ? -1 : 1);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				this.closeFindBar(true);
			}
		});
		previous.addEventListener('click', () => this.navigateFindMatch(-1));
		next.addEventListener('click', () => this.navigateFindMatch(1));
		close.addEventListener('click', () => this.closeFindBar(true));
		replaceInput.addEventListener('keydown', event => {
			event.stopPropagation();
			if (event.key === 'Enter') {
				event.preventDefault();
				this.replaceCurrentFindMatch();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				this.closeFindBar(true);
			}
		});
		replaceOne.addEventListener('click', () => this.replaceCurrentFindMatch());
		replaceAll.addEventListener('click', () => this.replaceAllFindMatches());
		this.findBarEl = bar;
		this.findInputEl = input;
		this.findCountEl = count;
		this.findReplaceInputEl = replaceInput;
	}

	private openFindBar(focusReplace = false): void {
		if (!this.findBarEl || !this.findInputEl) return;
		const selection = this.readSelection() ?? this.cachedSelection;
		const from = Math.min(selection.anchor, selection.head);
		const to = Math.max(selection.anchor, selection.head);
		const selectedText = this.getEditableData().slice(from, to);
		if (selectedText && selectedText.length <= 200 && !selectedText.includes('\n')) {
			this.findInputEl.value = selectedText;
		}
		this.findBarEl.hidden = false;
		this.refreshFindMatches(true);
		window.setTimeout(() => {
			const input = focusReplace ? this.findReplaceInputEl : this.findInputEl;
			input?.focus({ preventScroll: true });
			input?.select();
		}, 0);
	}

	private replaceCurrentFindMatch(): void {
		const match = this.activeFindMatch >= 0 ? this.findMatches[this.activeFindMatch] : null;
		if (!match || !this.findReplaceInputEl) return;
		const replacement = this.findReplaceInputEl.value;
		this.applyEdit(match.from, match.to, replacement, 'other');
		this.refreshFindMatches(true);
		this.findReplaceInputEl.focus({ preventScroll: true });
	}

	private replaceAllFindMatches(): void {
		if (this.findMatches.length === 0 || !this.findReplaceInputEl) return;
		const matches = this.findMatches.slice();
		const replacement = this.findReplaceInputEl.value;
		const before = this.getEditableData();
		this.recordHistory('other');
		let next = before;
		for (let index = matches.length - 1; index >= 0; index--) {
			const match = matches[index];
			const previous = next;
			next = next.slice(0, match.from) + replacement + next.slice(match.to);
			this.remapTextColorRanges(match.from, match.to, replacement.length);
			this.remapTextBackgroundRanges(match.from, match.to, replacement.length);
			this.remapInlineFormatRanges(match.from, match.to, replacement.length);
			this.remapParagraphAlignments(previous, next, match.from, match.to, replacement.length);
		}
		this.setEditableData(next);
		const caret = matches[0].from + replacement.length;
		this.cachedSelection = { anchor: caret, head: caret };
		this.cachedSelectionPageIndex = null;
		this.pendingPaginationReuse = null;
		this.dirtyPageIndex = 0;
		this.markDocumentChanged();
		this.paginateNow(false, this.cachedSelection);
		this.refreshFindMatches(true);
		this.findReplaceInputEl.focus({ preventScroll: true });
	}

	private closeFindBar(focusMatch: boolean): void {
		if (!this.findBarEl || this.findBarEl.hidden) return;
		const match = this.activeFindMatch >= 0 ? this.findMatches[this.activeFindMatch] : null;
		this.findBarEl.hidden = true;
		this.findMatches = [];
		this.activeFindMatch = -1;
		this.updateFindCount();
		this.invalidateFindDecorations(true);
		if (!focusMatch || !match) {
			this.restoreSelection(this.cachedSelection, true);
			return;
		}
		const selection = { anchor: match.from, head: match.to };
		const pageIndex = this.findPageIndex(match.from);
		this.cachedSelection = selection;
		this.cachedSelectionPageIndex = pageIndex;
		this.renderPageIfNeeded(pageIndex);
		this.restoreSelection(selection, true);
		this.pageEls[pageIndex]?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
	}

	private refreshFindMatches(render: boolean): void {
		if (!this.findInputEl || !this.findBarEl || this.findBarEl.hidden) return;
		const query = this.findInputEl.value;
		const previousOffset = this.activeFindMatch >= 0
			? this.findMatches[this.activeFindMatch]?.from ?? this.cachedSelection.head
			: this.cachedSelection.head;
		const matches: FindMatch[] = [];
		if (query) {
			const source = this.getEditableData();
			const haystack = source.toLocaleLowerCase();
			const needle = query.toLocaleLowerCase();
			let offset = 0;
			while (offset <= haystack.length - needle.length) {
				const found = haystack.indexOf(needle, offset);
				if (found < 0) break;
				matches.push({ from: found, to: found + query.length });
				offset = found + Math.max(1, needle.length);
			}
		}
		this.findMatches = matches;
		this.activeFindMatch = matches.length === 0
			? -1
			: Math.max(0, matches.findIndex(match => match.from >= previousOffset));
		this.updateFindCount();
		this.invalidateFindDecorations(render);
		if (render && this.activeFindMatch >= 0) this.revealActiveFindMatch();
	}

	private navigateFindMatch(delta: number): void {
		if (this.findMatches.length === 0) return;
		this.activeFindMatch = this.activeFindMatch < 0
			? (delta < 0 ? this.findMatches.length - 1 : 0)
			: (this.activeFindMatch + delta + this.findMatches.length) % this.findMatches.length;
		this.updateFindCount();
		this.invalidateFindDecorations(true);
		this.revealActiveFindMatch();
		this.findInputEl?.focus({ preventScroll: true });
	}

	private revealActiveFindMatch(): void {
		const match = this.findMatches[this.activeFindMatch];
		if (!match) return;
		const pageIndex = this.findPageIndex(match.from);
		this.renderPageIfNeeded(pageIndex);
		this.pageEls[pageIndex]?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
	}

	private updateFindCount(): void {
		const current = this.activeFindMatch >= 0 ? this.activeFindMatch + 1 : 0;
		this.findCountEl?.setText(`${current}/${this.findMatches.length}`);
	}

	private invalidateFindDecorations(render: boolean): void {
		this.textStyleVersion++;
		if (!render || this.findRenderFrame) return;
		this.findRenderFrame = window.requestAnimationFrame(() => {
			this.findRenderFrame = 0;
			this.renderVisiblePages();
		});
	}

	private clearSelectedTextColors(): void {
		const selection = this.readSelection() ?? this.cachedSelection;
		const from = Math.min(selection.anchor, selection.head);
		const to = Math.max(selection.anchor, selection.head);
		if (from === to) {
			this.plugin.settings.pagedLastTextColor = '';
			this.scheduleTextStyleSave();
			this.editRootEl?.focus({ preventScroll: true });
			this.restoreSelection(selection, true);
			return;
		}
		const removeSelection = (ranges: PagedTextColorRange[]) => {
			const next: PagedTextColorRange[] = [];
			for (const range of ranges) {
				if (range.to <= from || range.from >= to) {
					next.push(range);
					continue;
				}
				if (range.from < from) next.push({ ...range, to: from });
				if (range.to > to) next.push({ ...range, from: to });
			}
			return next;
		};
		this.pushHistorySnapshot();
		this.redoStack = [];
		this.lastHistoryKind = null;
		this.setTextColorRanges(removeSelection(this.getTextColorRanges()));
		this.setTextBackgroundRanges(removeSelection(this.getTextBackgroundRanges()));
		this.plugin.settings.pagedLastTextColor = '';
		this.cachedSelection = selection;
		this.refreshPageTexts(selection);
		this.restoreSelection(selection, true);
	}

	private applySelectedTextColor(color: string, target: 'text' | 'background'): void {
		const normalizedColor = this.toColorInputValue(
			color,
			target === 'text' ? this.getLastTextColor() : this.getLastBackgroundColor(),
		);
		const selection = this.readSelection() ?? this.cachedSelection;
		const from = Math.min(selection.anchor, selection.head);
		const to = Math.max(selection.anchor, selection.head);
		if (from === to) {
			if (target === 'text') {
				// With only a caret, choosing a color updates the reusable recent
				// color. It must not recolor the document or create a zero-length range.
				this.plugin.settings.pagedLastTextColor = normalizedColor;
				this.scheduleTextStyleSave();
				this.cachedSelection = selection;
				this.editRootEl?.focus({ preventScroll: true });
				this.restoreSelection(selection, true);
			} else {
				new Notice(wmT("배경색을 적용할 텍스트를 선택해 주세요."));
			}
			return;
		}

		this.pushHistorySnapshot();
		this.redoStack = [];
		this.lastHistoryKind = null;
		const ranges = target === 'text' ? this.getTextColorRanges() : this.getTextBackgroundRanges();
		const next: PagedTextColorRange[] = [];
		for (const range of ranges) {
			if (range.to <= from || range.from >= to) {
				next.push(range);
				continue;
			}
			if (range.from < from) next.push({ ...range, to: from });
			if (range.to > to) next.push({ ...range, from: to });
		}
		next.push({ from, to, color: normalizedColor });
		if (target === 'text') {
			this.plugin.settings.pagedLastTextColor = normalizedColor;
			this.setTextColorRanges(next);
		} else {
			this.plugin.settings.pagedLastBackgroundColor = normalizedColor;
			this.setTextBackgroundRanges(next);
		}
		this.scheduleTextStyleSave();
		this.cachedSelection = selection;
		this.refreshPageTexts(selection);
		this.restoreSelection(selection, true);
	}

	private preserveEditorSelection(event: PointerEvent): void {
		const selection = this.readSelection();
		if (selection) this.cachedSelection = selection;
		event.preventDefault();
	}

	private toggleSelectedTextFormat(kind: PagedInlineFormatKind): void {
		const selection = this.readSelection() ?? this.cachedSelection;
		const from = Math.min(selection.anchor, selection.head);
		const to = Math.max(selection.anchor, selection.head);
		if (from === to) {
			this.cachedSelection = selection;
			this.refreshToolbarSelection();
			this.editRootEl?.focus({ preventScroll: true });
			this.restoreSelection(selection, true);
			return;
		}

		this.pushHistorySnapshot();
		this.redoStack = [];
		this.lastHistoryKind = null;
		const remove = this.isInlineFormatRangeCovered(kind, from, to);
		const next: PagedInlineFormatRange[] = [];
		for (const range of this.getInlineFormatRanges()) {
			if (range.kind !== kind || range.to <= from || range.from >= to) {
				next.push(range);
				continue;
			}
			if (range.from < from) next.push({ ...range, to: from });
			if (range.to > to) next.push({ ...range, from: to });
		}
		if (!remove) next.push({ from, to, kind });
		this.setInlineFormatRanges(next);
		this.cachedSelection = selection;
		this.dirtyPageIndex = Math.max(0, this.findPageIndex(from) - 1);
		this.paginateNow(false, selection);
		this.restoreSelection(selection, true);
		this.refreshToolbarSelection();
	}

	private isInlineFormatRangeCovered(kind: PagedInlineFormatKind, from: number, to: number): boolean {
		let cursor = from;
		for (const range of this.getInlineFormatRanges().filter(item => item.kind === kind)) {
			if (range.to <= cursor) continue;
			if (range.from > cursor) return false;
			cursor = Math.max(cursor, range.to);
			if (cursor >= to) return true;
		}
		return false;
	}

	private refreshToolbarSelection(): void {
		this.plugin.toolbarManager.refreshToolbarSelection(this.leaf);
	}

	private applyParagraphAlignment(align: PagedParagraphAlignmentValue): void {
		const selection = this.readSelection() ?? this.cachedSelection;
		const starts = this.getSelectedParagraphStarts(selection);
		if (starts.length === 0) return;
		this.pushHistorySnapshot();
		this.redoStack = [];
		this.lastHistoryKind = null;
		const byStart = new Map(this.getParagraphAlignments().map(item => [item.from, item.align]));
		const defaultAlignment = this.plugin.settings.pagedDefaultAlignment ?? 'left';
		for (const start of starts) {
			if (align === defaultAlignment) byStart.delete(start);
			else byStart.set(start, align);
		}
		this.setParagraphAlignments(Array.from(byStart, ([from, value]) => ({ from, align: value })));
		this.cachedSelection = selection;
		this.refreshPageTexts(selection);
		this.restoreSelection(selection, true);
	}

	private getSelectionParagraphAlignment(selection: TextSelection): PagedParagraphAlignmentValue | null {
		const starts = this.getSelectedParagraphStarts(selection);
		const defaultAlignment = this.plugin.settings.pagedDefaultAlignment ?? 'left';
		if (starts.length === 0) return defaultAlignment;
		const byStart = new Map(this.getParagraphAlignments().map(item => [item.from, item.align]));
		const values = starts.map(start => byStart.get(start) ?? defaultAlignment);
		return values.every(value => value === values[0]) ? values[0] : null;
	}

	private getSelectedParagraphStarts(selection: TextSelection): number[] {
		const source = this.getEditableData();
		const from = Math.min(selection.anchor, selection.head);
		const to = Math.max(selection.anchor, selection.head);
		const finalProbe = to > from && source[to - 1] === '\n' ? to - 1 : to;
		const first = this.lineStartInSource(source, from);
		const last = this.lineStartInSource(source, Math.max(from, finalProbe));
		const starts: number[] = [];
		let cursor = first;
		while (cursor <= last) {
			starts.push(cursor);
			const newlineAt = source.indexOf('\n', cursor);
			if (newlineAt < 0 || newlineAt + 1 > last) break;
			cursor = newlineAt + 1;
		}
		return starts;
	}

	private toColorInputValue(value: string, fallback: string): string {
		if (/^#[0-9a-f]{6}$/i.test(value)) return value;
		if (/^#[0-9a-f]{8}$/i.test(value)) return value.slice(0, 7);
		if (/^#[0-9a-f]{3}$/i.test(value)) {
			return `#${value.slice(1).split('').map(char => char + char).join('')}`;
		}
		return fallback;
	}

	private getLastTextColor(): string {
		const ownerDocument = this.rootEl?.ownerDocument ?? activeDocument;
		return this.toColorInputValue(
			this.plugin.settings.pagedLastTextColor,
			ownerDocument.body.classList.contains('theme-dark') ? '#e5e7eb' : '#111111',
		);
	}

	private getLastBackgroundColor(): string {
		return this.toColorInputValue(this.plugin.settings.pagedLastBackgroundColor, '#fef3c7');
	}

	private getTextColorKey(): string | null {
		return this.file?.path ?? null;
	}

	private shiftStoredStyleOffsets(delta: number): void {
		const key = this.getTextColorKey();
		if (!key || delta === 0) return;
		const shiftRanges = <T extends { from: number; to: number }>(store?: Record<string, T[]>) => {
			const ranges = store?.[key];
			if (!Array.isArray(ranges)) return;
			store![key] = ranges.map(range => ({
				...range,
				from: Math.max(0, range.from + delta),
				to: Math.max(0, range.to + delta),
			}));
		};
		shiftRanges(this.plugin.settings.pagedTextColors);
		shiftRanges(this.plugin.settings.pagedTextBackgrounds);
		shiftRanges(this.plugin.settings.pagedInlineFormats);
		const alignments = this.plugin.settings.pagedParagraphAlignments?.[key];
		if (Array.isArray(alignments)) {
			this.plugin.settings.pagedParagraphAlignments[key] = alignments.map(item => ({
				...item,
				from: Math.max(0, item.from + delta),
			}));
		}
		this.scheduleTextStyleSave();
	}

	private get stylePositionOffset(): number {
		return this.frontmatterPrefix.length;
	}

	private getTextColorRanges(): PagedTextColorRange[] {
		const key = this.getTextColorKey();
		if (!key) return [];
		const store = this.plugin.settings.pagedTextColors ?? {};
		const ranges = store[key];
		if (!Array.isArray(ranges)) return [];
		return ranges
			.filter(range => Number.isFinite(range.from)
				&& Number.isFinite(range.to)
				&& range.from >= 0
				&& range.to > range.from
				&& /^#[0-9a-f]{6}$/i.test(range.color))
			.map(range => ({
				...range,
				from: Math.max(0, range.from - this.stylePositionOffset),
				to: Math.max(0, range.to - this.stylePositionOffset),
			}))
			.filter(range => range.to > range.from);
	}

	private getTextBackgroundRanges(): PagedTextColorRange[] {
		const key = this.getTextColorKey();
		if (!key) return [];
		const store = this.plugin.settings.pagedTextBackgrounds ?? {};
		const ranges = store[key];
		if (!Array.isArray(ranges)) return [];
		return ranges
			.filter(range => Number.isFinite(range.from)
				&& Number.isFinite(range.to)
				&& range.from >= 0
				&& range.to > range.from
				&& /^#[0-9a-f]{6}$/i.test(range.color))
			.map(range => ({
				...range,
				from: Math.max(0, range.from - this.stylePositionOffset),
				to: Math.max(0, range.to - this.stylePositionOffset),
			}))
			.filter(range => range.to > range.from);
	}

	private getInlineFormatRanges(): PagedInlineFormatRange[] {
		const key = this.getTextColorKey();
		if (!key) return [];
		const ranges = (this.plugin.settings.pagedInlineFormats ?? {})[key];
		if (!Array.isArray(ranges)) return [];
		const kinds: PagedInlineFormatKind[] = ['bold', 'italic', 'underline', 'strikethrough'];
		return ranges
			.filter(range => Number.isFinite(range.from)
				&& Number.isFinite(range.to)
				&& range.from >= 0
				&& range.to > range.from
				&& kinds.includes(range.kind))
			.map(range => ({
				...range,
				from: Math.max(0, range.from - this.stylePositionOffset),
				to: Math.max(0, range.to - this.stylePositionOffset),
			}))
			.filter(range => range.to > range.from);
	}

	private getParagraphAlignments(): PagedParagraphAlignment[] {
		const key = this.getTextColorKey();
		if (!key) return [];
		const alignments = (this.plugin.settings.pagedParagraphAlignments ?? {})[key];
		if (!Array.isArray(alignments)) return [];
		const values: PagedParagraphAlignmentValue[] = ['left', 'center', 'right', 'justify'];
		return alignments
			.filter(item => Number.isFinite(item.from) && item.from >= 0 && values.includes(item.align))
			.map(item => ({ ...item, from: Math.max(0, item.from - this.stylePositionOffset) }));
	}

	private normalizeTextColorRanges(ranges: PagedTextColorRange[]): PagedTextColorRange[] {
		const sourceLength = this.getEditableData().length;
		const sorted = ranges
			.map(range => ({
				from: Math.max(0, Math.min(sourceLength, Math.round(range.from))),
				to: Math.max(0, Math.min(sourceLength, Math.round(range.to))),
				color: this.toColorInputValue(range.color, ''),
			}))
			.filter((range): range is PagedTextColorRange => range.to > range.from && /^#[0-9a-f]{6}$/i.test(range.color))
			.sort((left, right) => left.from - right.from || left.to - right.to);
		const normalized: PagedTextColorRange[] = [];
		for (const range of sorted) {
			const previous = normalized[normalized.length - 1];
			if (previous && previous.color === range.color && range.from <= previous.to) {
				previous.to = Math.max(previous.to, range.to);
				continue;
			}
			normalized.push({ ...range });
		}
		return normalized;
	}

	private normalizeInlineFormatRanges(ranges: PagedInlineFormatRange[]): PagedInlineFormatRange[] {
		const sourceLength = this.getEditableData().length;
		const kinds: PagedInlineFormatKind[] = ['bold', 'italic', 'underline', 'strikethrough'];
		const sorted = ranges
			.map(range => ({
				from: Math.max(0, Math.min(sourceLength, Math.round(range.from))),
				to: Math.max(0, Math.min(sourceLength, Math.round(range.to))),
				kind: range.kind,
			}))
			.filter(range => range.to > range.from && kinds.includes(range.kind))
			.sort((left, right) => left.kind.localeCompare(right.kind) || left.from - right.from || left.to - right.to);
		const normalized: PagedInlineFormatRange[] = [];
		for (const range of sorted) {
			const previous = normalized[normalized.length - 1];
			if (previous && previous.kind === range.kind && range.from <= previous.to) {
				previous.to = Math.max(previous.to, range.to);
				continue;
			}
			normalized.push({ ...range });
		}
		return normalized;
	}

	private normalizeParagraphAlignments(alignments: PagedParagraphAlignment[]): PagedParagraphAlignment[] {
		const source = this.getEditableData();
		const defaultAlignment = this.plugin.settings.pagedDefaultAlignment ?? 'left';
		const byStart = new Map<number, PagedParagraphAlignmentValue>();
		for (const item of alignments) {
			if (!Number.isFinite(item.from) || item.align === defaultAlignment) continue;
			const from = this.lineStartInSource(source, Math.max(0, Math.min(source.length, Math.round(item.from))));
			byStart.set(from, item.align);
		}
		return Array.from(byStart, ([from, align]) => ({ from, align }))
			.sort((left, right) => left.from - right.from);
	}

	private textColorRangesEqual(left: PagedTextColorRange[], right: PagedTextColorRange[]): boolean {
		return left.length === right.length && left.every((range, index) => {
			const other = right[index];
			return Boolean(other && range.from === other.from && range.to === other.to
				&& range.color === other.color);
		});
	}

	private inlineFormatRangesEqual(left: PagedInlineFormatRange[], right: PagedInlineFormatRange[]): boolean {
		return left.length === right.length && left.every((range, index) => {
			const other = right[index];
			return Boolean(other && range.from === other.from && range.to === other.to && range.kind === other.kind);
		});
	}

	private paragraphAlignmentsEqual(left: PagedParagraphAlignment[], right: PagedParagraphAlignment[]): boolean {
		return left.length === right.length && left.every((item, index) => {
			const other = right[index];
			return Boolean(other && item.from === other.from && item.align === other.align);
		});
	}

	private setTextColorRanges(ranges: PagedTextColorRange[], invalidateRenderedStyles = true): void {
		const key = this.getTextColorKey();
		if (!key) return;
		const normalized = this.normalizeTextColorRanges(ranges);
		const stored = normalized.map(range => ({
			...range,
			from: range.from + this.stylePositionOffset,
			to: range.to + this.stylePositionOffset,
		}));
		const store = this.plugin.settings.pagedTextColors ?? {};
		if (this.textColorRangesEqual(store[key] ?? [], stored)) return;
		if (stored.length > 0) store[key] = stored;
		else delete store[key];
		this.plugin.settings.pagedTextColors = store;
		if (invalidateRenderedStyles) this.textStyleVersion++;
		this.scheduleTextStyleSave();
	}

	private setTextBackgroundRanges(ranges: PagedTextColorRange[], invalidateRenderedStyles = true): void {
		const key = this.getTextColorKey();
		if (!key) return;
		const normalized = this.normalizeTextColorRanges(ranges);
		const stored = normalized.map(range => ({
			...range,
			from: range.from + this.stylePositionOffset,
			to: range.to + this.stylePositionOffset,
		}));
		const store = this.plugin.settings.pagedTextBackgrounds ?? {};
		if (this.textColorRangesEqual(store[key] ?? [], stored)) return;
		if (stored.length > 0) store[key] = stored;
		else delete store[key];
		this.plugin.settings.pagedTextBackgrounds = store;
		if (invalidateRenderedStyles) this.textStyleVersion++;
		this.scheduleTextStyleSave();
	}

	private setInlineFormatRanges(ranges: PagedInlineFormatRange[], invalidateRenderedStyles = true): void {
		const key = this.getTextColorKey();
		if (!key) return;
		const normalized = this.normalizeInlineFormatRanges(ranges);
		const stored = normalized.map(range => ({
			...range,
			from: range.from + this.stylePositionOffset,
			to: range.to + this.stylePositionOffset,
		}));
		const store = this.plugin.settings.pagedInlineFormats ?? {};
		if (this.inlineFormatRangesEqual(store[key] ?? [], stored)) return;
		if (stored.length > 0) store[key] = stored;
		else delete store[key];
		this.plugin.settings.pagedInlineFormats = store;
		if (invalidateRenderedStyles) this.textStyleVersion++;
		this.scheduleTextStyleSave();
	}

	private setParagraphAlignments(alignments: PagedParagraphAlignment[], invalidateRenderedStyles = true): void {
		const key = this.getTextColorKey();
		if (!key) return;
		const normalized = this.normalizeParagraphAlignments(alignments);
		const stored = normalized.map(item => ({
			...item,
			from: item.from + this.stylePositionOffset,
		}));
		const store = this.plugin.settings.pagedParagraphAlignments ?? {};
		if (this.paragraphAlignmentsEqual(store[key] ?? [], stored)) return;
		if (stored.length > 0) store[key] = stored;
		else delete store[key];
		this.plugin.settings.pagedParagraphAlignments = store;
		if (invalidateRenderedStyles) this.textStyleVersion++;
		this.scheduleTextStyleSave();
	}

	private scheduleTextStyleSave(): void {
		if (this.textStyleSaveTimer) window.clearTimeout(this.textStyleSaveTimer);
		this.textStyleSaveTimer = window.setTimeout(() => {
			this.textStyleSaveTimer = 0;
			void this.plugin.saveData(this.plugin.settings);
		}, 300);
	}

	private installEventHandlers(): void {
		if (!this.editRootEl) return;
		this.editRootEl.addEventListener('beforeinput', this.handleBeforeInput);
		this.editRootEl.addEventListener('input', this.handleNativeInput);
		this.editRootEl.addEventListener('keydown', this.handleKeyDown);
		this.editRootEl.addEventListener('copy', this.handleCopy);
		this.editRootEl.addEventListener('cut', this.handleCut);
		this.editRootEl.addEventListener('paste', this.handlePaste);
		this.editRootEl.addEventListener('contextmenu', this.handleContextMenu);
		this.editRootEl.addEventListener('compositionstart', this.handleCompositionStart);
		this.editRootEl.addEventListener('compositionend', this.handleCompositionEnd);
		this.editRootEl.addEventListener('pointerdown', this.handlePointerDown);
		const viewport = this.viewportEl;
		const root = this.rootEl;
		viewport?.addEventListener('scroll', this.handleViewportScroll, { passive: true });
		viewport?.addEventListener('pointerdown', this.releaseTypewriterScroll, { capture: true });
		viewport?.addEventListener('touchstart', this.releaseTypewriterScroll, { passive: true });
		root?.addEventListener('wheel', this.handleZoomWheel, { passive: false });

		const ownerWindow = this.editRootEl.ownerDocument.defaultView ?? window;
		ownerWindow.addEventListener('pointerup', this.handlePointerEnd, true);
		ownerWindow.addEventListener('pointercancel', this.handlePointerEnd, true);

		this.selectionListener = () => {
			if (this.rendering) return;
			const selection = this.readSelection();
			if (!selection) return;
			this.cachedSelection = selection;
			const nativeSelection = this.editRootEl?.ownerDocument.getSelection();
			const focusElement = nativeSelection?.focusNode
				? (nativeSelection.focusNode.nodeType === Node.ELEMENT_NODE
					? nativeSelection.focusNode as Element
					: nativeSelection.focusNode.parentElement)
				: null;
			const focusShell = focusElement?.closest<HTMLElement>('.wm-paged-page-shell');
			const focusPageIndex = Number(focusShell?.dataset.pageIndex ?? -1);
			if (focusPageIndex >= 0 && focusPageIndex < this.pages.length) {
				this.cachedSelectionPageIndex = focusPageIndex;
			}
			this.normalizeCollapsedSelection(selection);
			// Chromium exposes transient non-collapsed ranges while an IME is
			// composing. They are not stable user selections, so wait for the
			// composition to finish before refreshing selection-only formatting.
			if (!this.composing) this.refreshToolbarSelection();
			this.plugin.updateCharCountDebounced(this.leaf);
		};
		this.editRootEl.ownerDocument.addEventListener('selectionchange', this.selectionListener);
	}

	private readonly handleBeforeInput = (event: InputEvent): void => {
		if (this.rendering) return;
		if (this.composing || event.isComposing || event.inputType === 'insertCompositionText') {
			const session = this.compositionSession;
			if (session && !session.targetCaptured) {
				const range = event.getTargetRanges?.()[0];
				if (range) {
					const from = this.globalOffsetFromDom(range.startContainer, range.startOffset);
					const to = this.globalOffsetFromDom(range.endContainer, range.endOffset);
					if (from !== null && to !== null) { session.from = from; session.to = to; }
				}
				session.targetCaptured = true;
			}
			if (session && event.data !== null) session.text = event.data;
			return;
		}

		const selection = this.readInputSelection(event);
		if (!selection) return;
		let from = Math.min(selection.anchor, selection.head);
		let to = Math.max(selection.anchor, selection.head);
		let insert = '';
		let kind: EditKind = 'other';

		switch (event.inputType) {
			case 'insertText':
			case 'insertReplacementText': {
				insert = event.data ?? '';
				if (event.cancelable && this.insertSmartPair(from, to, insert)) {
					event.preventDefault();
					return;
				}
				kind = 'insert';
				const prepared = this.prepareInsertion(from, to, insert);
				from = prepared.from;
				to = prepared.to;
				insert = prepared.text;
				break;
			}
			case 'insertParagraph':
			case 'insertLineBreak':
				insert = '\n';
				kind = 'enter';
				break;
			case 'insertFromPaste':
			case 'insertFromDrop': {
				const transfer = (event as InputEvent & { dataTransfer?: DataTransfer | null }).dataTransfer;
				insert = transfer?.getData('text/plain') ?? event.data ?? '';
				insert = insert.replace(/\r\n?/g, '\n');
				kind = 'paste';
				break;
			}
			case 'deleteContentBackward': {
				if (from === to) {
					const substitution = this.plugin.lastSubstitution;
					if (substitution && to === substitution.endPos && this.getEditableData().slice(to - substitution.to.length, to) === substitution.to) {
						from = to - substitution.to.length;
						insert = substitution.from;
						this.plugin.lastSubstitution = null;
					} else {
						from = this.previousCodePoint(from);
					}
				}
				kind = 'delete';
				break;
			}
			case 'deleteContentForward':
				if (from === to) to = this.nextCodePoint(to);
				kind = 'delete';
				break;
			case 'deleteWordBackward':
				if (from === to) from = this.previousWordBoundary(from);
				kind = 'delete';
				break;
			case 'deleteWordForward':
				if (from === to) to = this.nextWordBoundary(to);
				kind = 'delete';
				break;
			case 'deleteSoftLineBackward':
			case 'deleteHardLineBackward':
				if (from === to) from = this.lineStart(from);
				kind = 'delete';
				break;
			case 'deleteSoftLineForward':
			case 'deleteHardLineForward':
				if (from === to) to = this.lineEnd(to);
				kind = 'delete';
				break;
			case 'deleteByCut':
			case 'deleteByDrag':
				kind = 'cut';
				break;
			case 'historyUndo':
				event.preventDefault();
				this.undo();
				return;
			case 'historyRedo':
				event.preventDefault();
				this.redo();
				return;
			default:
				if (event.inputType.startsWith('format')) event.preventDefault();
				return;
		}

		if (!event.cancelable) return;
		event.preventDefault();
		this.applyEdit(from, to, insert, kind);
	};

	private readonly handleNativeInput = (event: InputEvent): void => {
		if (this.rendering) return;
		this.invalidateActivePageRenderState();
		// Chromium must keep ownership of the composing DOM until the IME commits.
		// Replacing the active page at a visual/page boundary makes some Korean IMEs
		// submit the current syllable twice when composition resumes in the new DOM.
		if (this.composing || event.isComposing) {
			if (this.compositionSession && event.data !== null) this.compositionSession.text = event.data;
			// The composing page is already the source of truth until compositionend.
			// Serializing its full DOM on every intermediate Korean IME event made the
			// cost grow with the active page and duplicated work done at commit time.
			this.compositionDirty = true;
			this.scheduleCompositionOverflowPreview();
			if (this.plugin.settings.enableTypewriterScrolling) this.centerActivePage();
			return;
		}
		const commit = this.compositionCommit;
		if (commit && event.inputType === 'insertText' && event.data === commit.text && this.getEditableData() === commit.source) {
			// Some Windows IMEs deliver a final DOM insertion after compositionend.
			// The composition data is already committed; reconcile its DOM once rather
			// than importing a second copy from a retired page fragment.
			this.compositionCommit = null;
			for (const index of this.getSelectionPageIndices(commit.selection)) {
				const textEl = this.pageTextEls[index];
				if (textEl && serializePagedText(textEl) !== commit.source.slice(this.pages[index].from, this.pages[index].to)) this.pageRenderStates.delete(textEl);
			}
			this.refreshPageTexts(commit.selection, this.getSelectionPageIndices(commit.selection));
			return;
		}
		this.clearCompositionOverflowPreview();
		const changed = this.syncSourceFromDom(false);
		if (changed || this.compositionDirty) this.markDocumentChanged();
		this.compositionDirty = false;
		this.paginateNow(false);
		this.updatePagedFocusLine();
		this.refreshToolbarSelection();
		if (this.plugin.settings.enableTypewriterScrolling) this.centerActivePage();
	};

	private readonly handleCompositionStart = (): void => {
		this.dismissAutocomplete();
		this.compositionCommit = null;
		const selection = this.readSelection() ?? this.cachedSelection;
		// A click followed immediately by typing can precede selectionchange. The
		// cached page affinity then still points at the old caret, disabling the
		// composition snapshot and importing stale/overflowing native DOM instead.
		const page = this.pages[this.getNativeFocusPageIndex() ?? this.findPageIndex(selection.head)];
		this.cachedSelectionPageIndex = page?.index ?? null;
		this.compositionSession = page ? {
			source: this.getEditableData(), from: Math.min(selection.anchor, selection.head), to: Math.max(selection.anchor, selection.head),
			pageFrom: page.from, pageTo: page.to, text: null, targetCaptured: false,
		} : null;
		this.fileStore?.changed();
		this.clearCompositionOverflowPreview();
		this.composing = true;
		this.compositionDirty = false;
		this.activatePagedFocusMode();
		this.updatePagedFocusLine();
		this.editRootEl?.addClass('is-composing');
		// Korean IMEs can start a new composition for nearly every completed
		// syllable. Group adjacent compositions just like ordinary insertion so a
		// long document is not copied into the undo stack on every syllable.
		this.recordHistory('insert');
	};

	private readonly handleCompositionEnd = (event: CompositionEvent): void => {
		if (this.compositionSession) this.compositionSession.text = event.data;
		this.composing = false;
		this.editRootEl?.removeClass('is-composing');
		// Commit and repaginate as soon as Chromium releases the composing DOM.
		// Waiting for the next animation frame lets a fast following compositionstart
		// cancel the commit, leaving overflow text invisible until another interaction.
		const activePageFits = this.activeNativePageFits();
		const changed = this.syncSourceFromDom(false, activePageFits);
		const session = this.compositionSession;
		this.compositionSession = null;
		const reuse = this.pendingPaginationReuse;
		if (changed || this.compositionDirty) this.markDocumentChanged();
		this.compositionDirty = false;
		this.clearCompositionOverflowPreview();
		const removedLength = reuse ? Math.max(0, reuse.to - reuse.from) : 0;
		const stableGrowingEdit = changed
			&& activePageFits
			&& reuse !== null
			&& removedLength === 0;
		if (stableGrowingEdit) {
			// Native insertion that still fits in the same page cannot
			// change a downstream visual boundary. syncSourceFromDom has already
			// shifted every later source offset, so measuring the document again is
			// pure duplicate work—especially expensive for a single 150k paragraph.
			this.pendingPaginationReuse = null;
			this.dirtyPageIndex = null;
			const selection = this.cachedSelection;
			this.refreshPageTexts(selection, this.getVisibleRenderPageIndices(selection));
			this.scheduleVisiblePageRender();
		} else {
			this.paginateNow(false);
		}
		this.updatePagedFocusLine();
		this.refreshToolbarSelection();
		if (session?.text) {
			const commit = this.compositionCommit = { text: session.text, source: this.getEditableData(), selection: { ...this.cachedSelection } };
			window.setTimeout(() => { if (this.compositionCommit === commit) this.compositionCommit = null; }, 0);
		}
		if (this.plugin.settings.enableTypewriterScrolling) this.centerActivePage();
	};

	private renderCompositionOverflowPreview(): void {
		if (!this.pagination || !this.editRootEl || !this.measurerEl) return;
		const selection = this.readSelection() ?? this.cachedSelection;
		const domSelection = this.editRootEl.ownerDocument.getSelection();
		const focusElement = domSelection?.focusNode
			? (domSelection.focusNode.nodeType === Node.ELEMENT_NODE
				? domSelection.focusNode as Element
				: domSelection.focusNode.parentElement)
			: null;
		const focusShell = focusElement?.closest<HTMLElement>('.wm-paged-page-shell');
		const focusPageIndex = Number(focusShell?.dataset.pageIndex ?? -1);
		const pageIndex = focusPageIndex >= 0 && focusPageIndex < this.pages.length
			? focusPageIndex
			: this.findPageIndex(selection.head);
		const page = this.pages[pageIndex];
		if (!page) return;
		const activeTextEl = this.pageTextEls[pageIndex]
			?? focusShell?.querySelector<HTMLElement>('.wm-paged-page-text')
			?? null;
		// Page measurement is the expensive part. While the active page still fits,
		// none of the following page boundaries can have changed visually, so avoid
		// repaginating the document for every intermediate IME input event.
		const pageContentHeight = activeTextEl?.parentElement?.clientHeight ?? activeTextEl?.clientHeight ?? 0;
		if (activeTextEl && activeTextEl.scrollHeight <= pageContentHeight) {
			this.clearCompositionOverflowPreview();
			return;
		}

		// Only an actual page overflow needs a source snapshot during composition.
		// Keep the native composing subtree intact; syncSourceFromDom updates the
		// backing text and shifted offsets without replacing that subtree.
		this.syncSourceFromDom(false);
		const inlineFormats = this.getInlineFormatRanges();
		const source = this.getEditableData();
		const previewThroughPageIndex = Math.max(
			page.index + COMPOSITION_PREVIEW_PAGE_COUNT,
			...this.getVisibleRenderPageIndices(selection),
		);
		const previewWindow = Math.max(
			MIN_COMPOSITION_PREVIEW_CHARACTER_WINDOW,
			Math.min(MAX_COMPOSITION_PREVIEW_CHARACTER_WINDOW, Math.max(1, page.to - page.from) * 2),
		);
		const previewSourceTo = Math.min(
			source.length,
			Math.max(page.to + previewWindow, this.pages[previewThroughPageIndex + 1]?.to ?? source.length),
		);
		const previewSource = previewSourceTo < source.length ? source.slice(0, previewSourceTo) : source;
		// Preview pagination deliberately uses an isolated, bounded source. Reusing
		// the main long-paragraph cache here could append line starts beyond the
		// preview window and would make an IME overflow measure the entire document.
		const previewPagination = new PaginationEngine(this.measurerEl, this.getPaginationGeometry());
		previewPagination.updateInlineFormats(inlineFormats);
		const reusableByBoundary = new Map<string, number>();
		for (let index = pageIndex + 1; index < this.pages.length && index <= previewThroughPageIndex; index++) {
			const candidate = this.pages[index];
			reusableByBoundary.set(`${candidate.from}:${candidate.to}`, index);
		}
		const stopAfterReusablePage = (candidate: PageRange) => {
			const oldPageIndex = reusableByBoundary.get(`${candidate.from}:${candidate.to}`);
			if (oldPageIndex !== undefined) {
				return true;
			}
			// Every visible following page must flow with the overflow, including
			// later columns/rows. Bound previews to that viewport window rather than
			// creating every remaining page of a long document.
			return candidate.index >= previewThroughPageIndex;
		};
		const calculated = previewPagination.paginate(
			previewSource,
			page.from,
			page.index,
			stopAfterReusablePage,
			this.pendingPaginationReuse ?? undefined,
		);
		const overflowPages = calculated.slice(1);
		if (overflowPages.length === 0) { this.clearCompositionOverflowPreview(); return; }

		const viewport = this.viewportEl;
		const firstPage = this.pageEls[0];
		if (!viewport || !firstPage) return;
		const viewportRect = viewport.getBoundingClientRect();
		const firstRect = firstPage.getBoundingClientRect();
		const columns = Math.max(1, this.gridColumns);
		const nextRowRect = this.pageEls[columns]?.getBoundingClientRect();
		const nextColumnRect = columns > 1 ? this.pageEls[1]?.getBoundingClientRect() : null;
		const rowStride = nextRowRect ? nextRowRect.top - firstRect.top : this.displayedPageRowStride;
		const columnStride = nextColumnRect ? nextColumnRect.left - firstRect.left : this.displayedPageWidth + PAGE_GAP;
		const pageRects = overflowPages.map(candidate => this.pageEls[candidate.index]?.getBoundingClientRect());
		const previousPreviews = new Map(this.compositionPreviewEls.map(shell => [Number(shell.dataset.pageIndex), shell]));
		const nextPreviews: HTMLElement[] = [];
		// The native caret remains in the old subtree until commit, while its first
		// overflow glyph is already painted on the next page. Follow that glyph,
		// keeping the scroll pin on the same visual page between IME events.
		const compositionHead = this.compositionSession?.text
			? this.compositionSession.from + this.compositionSession.text.length : selection.head;
		const glyphPosition = Math.max(0, compositionHead - 1);
		this.compositionScrollPageIndex = calculated.find(candidate => glyphPosition >= candidate.from && glyphPosition < candidate.to)?.index ?? null;
		for (let previewIndex = 0; previewIndex < overflowPages.length; previewIndex++) {
			const previewPage = overflowPages[previewIndex];
			// Previews are siblings of the editing host. Adding/removing even a
			// non-editable child inside that host can disturb an active IME range.
			const shell = previousPreviews.get(previewPage.index) ?? viewport.createDiv({
				cls: 'wm-paged-page-shell wm-paged-composition-preview',
				attr: {
					contenteditable: 'false',
					'aria-hidden': 'true',
					'data-page-index': String(previewPage.index),
				},
			});
			previousPreviews.delete(previewPage.index);
			// Grid tracks are rounded by Chromium. Repeating the unrounded page
			// stride accumulates fractional pixels and makes text move when a preview
			// becomes the real page. Use the rendered grid coordinates for both.
			const rect = pageRects[previewIndex];
			const left = rect?.left ?? firstRect.left + (previewPage.index % columns) * columnStride;
			const top = rect?.top ?? firstRect.top + Math.floor(previewPage.index / columns) * rowStride;
			shell.style.left = `${viewport.scrollLeft + left - viewportRect.left - viewport.clientLeft}px`;
			shell.style.top = `${viewport.scrollTop + top - viewportRect.top - viewport.clientTop}px`;
			const surface = shell.querySelector<HTMLElement>('.wm-paged-page-surface') ?? shell.createDiv({ cls: 'wm-paged-page-surface' });
			const content = surface.querySelector<HTMLElement>('.wm-paged-page-content') ?? surface.createDiv({ cls: 'wm-paged-page-content' });
			const textEl = content.querySelector<HTMLElement>('.wm-paged-page-text') ?? content.createDiv({
				cls: 'wm-paged-page-text',
				attr: {
					'data-from': String(previewPage.from),
					'data-to': String(previewPage.to),
				},
			});
			textEl.dataset.from = String(previewPage.from);
			textEl.dataset.to = String(previewPage.to);
			this.setPageText(
				textEl,
				source.slice(previewPage.from, previewPage.to),
				previewPage.from,
				source,
				previewPage.to < source.length,
			);
			nextPreviews.push(shell);
		}
		for (const shell of previousPreviews.values()) shell.remove();
		this.compositionPreviewEls = nextPreviews;
		if (this.plugin.settings.enableTypewriterScrolling) {
			this.centerActivePage();
		}
	}

	private activeNativePageFits(): boolean {
		if (!this.editRootEl) return false;
		const selection = this.editRootEl.ownerDocument.getSelection();
		const focusElement = selection?.focusNode
			? (selection.focusNode.nodeType === Node.ELEMENT_NODE
				? selection.focusNode as Element
				: selection.focusNode.parentElement)
			: null;
		const textEl = focusElement?.closest<HTMLElement>('.wm-paged-page-text');
		const contentEl = textEl?.parentElement;
		return Boolean(textEl && contentEl && contentEl.clientHeight > 0
			&& textEl.scrollHeight <= contentEl.clientHeight + 1);
	}

	private scheduleCompositionOverflowPreview(): void {
		if (this.compositionPreviewFrame || !this.composing) return;
		this.compositionPreviewFrame = window.requestAnimationFrame(() => {
			this.compositionPreviewFrame = 0;
			if (this.composing) this.renderCompositionOverflowPreview();
		});
	}

	private clearCompositionOverflowPreview(): void {
		this.compositionScrollPageIndex = null;
		if (this.compositionPreviewFrame) {
			window.cancelAnimationFrame(this.compositionPreviewFrame);
			this.compositionPreviewFrame = 0;
		}
		for (const preview of this.compositionPreviewEls) preview.remove();
		this.compositionPreviewEls = [];
	}

	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		if (this.composing || isComposingKey(event)) return;
		if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) this.releaseTypewriterScroll();
		if (this.handleAutocompleteKeyDown(event)) return;
		const mod = event.ctrlKey || event.metaKey;
		const shortcutKey = event.code.startsWith('Key')
			? event.code.slice(3).toLowerCase()
			: event.key.toLowerCase();
		if (mod && !event.altKey && !event.shiftKey && shortcutKey === 'f') {
			event.preventDefault();
			this.openFindBar();
			return;
		}
		if (mod && !event.altKey && !event.shiftKey && shortcutKey === 'h') {
			event.preventDefault();
			this.openFindBar(true);
			return;
		}
		if (mod && !event.altKey && shortcutKey === 'a') {
			event.preventDefault();
			this.restoreSelection({ anchor: 0, head: this.getEditableData().length }, true);
			return;
		}
		if (mod && !event.altKey && shortcutKey === 'z') {
			event.preventDefault();
			if (event.shiftKey) this.redo();
			else this.undo();
			return;
		}
		if (mod && !event.altKey && shortcutKey === 'y') {
			event.preventDefault();
			this.redo();
			return;
		}
		if (mod && !event.altKey && !event.shiftKey && ['b', 'i', 'u'].includes(shortcutKey)) {
			event.preventDefault();
			const kind: PagedInlineFormatKind = shortcutKey === 'b'
				? 'bold'
				: shortcutKey === 'i' ? 'italic' : 'underline';
			this.toggleSelectedTextFormat(kind);
			return;
		}
		const isPrimaryStrikethrough = mod
			&& !event.altKey
			&& event.shiftKey
			&& shortcutKey === 's';
		const isGoogleDocsStrikethrough = !mod
			&& event.altKey
			&& event.shiftKey
			&& event.code === 'Digit5';
		const isMacGoogleDocsStrikethrough = event.metaKey
			&& !event.ctrlKey
			&& !event.altKey
			&& event.shiftKey
			&& shortcutKey === 'x';
		if (isPrimaryStrikethrough || isGoogleDocsStrikethrough || isMacGoogleDocsStrikethrough) {
			event.preventDefault();
			this.toggleSelectedTextFormat('strikethrough');
			return;
		}
		if (
			!mod
			&& !event.altKey
			&& !this.composing
			&& !event.isComposing
			&& ['"', "'", '“', '”', '‘', '’', '(', ')', '[', ']', '{', '}'].includes(event.key)
		) {
			const selection = this.readSelection() ?? this.cachedSelection;
			const from = Math.min(selection.anchor, selection.head);
			const to = Math.max(selection.anchor, selection.head);
			if (this.insertSmartPair(from, to, event.key)) {
				event.preventDefault();
				return;
			}
		}
		if (
			event.key === 'Enter'
			&& !mod
			&& !event.altKey
			&& !this.composing
			&& !isComposingKey(event)
		) {
			const selection = this.readSelection() ?? this.cachedSelection;
			event.preventDefault();
			if (selection.anchor === selection.head && this.applySmartEnter(selection.head)) return;
			this.applyEdit(
				Math.min(selection.anchor, selection.head),
				Math.max(selection.anchor, selection.head),
				'\n',
				'enter',
			);
			return;
		}
		if (!mod && !event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
			this.deactivatePagedFocusMode();
			if (this.moveCaretAcrossPageBoundary(event.key === 'ArrowRight', event.shiftKey)) {
				event.preventDefault();
				return;
			}
		}
		if (!mod && !event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
			this.deactivatePagedFocusMode();
			if (this.moveCaretVerticallyAcrossPageBoundary(event.key === 'ArrowDown', event.shiftKey)) {
				event.preventDefault();
				return;
			}
		}
		if (event.key === 'Tab' && !mod && !event.altKey) {
			const selection = this.readSelection();
			if (!selection) return;
			event.preventDefault();
			this.applyEdit(
				Math.min(selection.anchor, selection.head),
				Math.max(selection.anchor, selection.head),
				'\t',
				'insert',
			);
		}
	};

	private handleScopedFormatShortcut(
		event: KeyboardEvent,
		kind: PagedInlineFormatKind,
	): false | undefined {
		const target = event.target as Node | null;
		if (!target || !this.editRootEl?.contains(target)) return;
		if (this.composing || event.isComposing) return;
		event.preventDefault();
		event.stopPropagation();
		this.toggleSelectedTextFormat(kind);
		return false;
	}

	private applySmartEnter(position: number): boolean {
		if (!this.plugin.settings.enableSmartInput || !this.plugin.settings.enableSmartEnter) return false;
		const source = this.getEditableData();
		if (position <= 0 || position >= source.length) return false;
		const defaultPairs = [
			'()', '[]', '{}', '<>', '""', "''", '“”', '‘’',
			'「」', '『』', '【】', '《》',
		];
		const dynamicPairs = (this.plugin.settings.symbolTriggers ?? [])
			.filter(trigger => trigger.enabled !== false)
			.flatMap(trigger => (trigger.options ?? [])
				.filter(option => option.open && option.close)
				.map(option => option.open + option.close));
		const pairs = Array.from(new Set([
			...defaultPairs,
			...(this.plugin.settings.smartEnterPairs ?? []),
			...dynamicPairs,
		]));
		for (const pair of pairs) {
			const middle = Math.floor(pair.length / 2);
			const close = pair.slice(middle);
			if (!close || source.slice(position, position + close.length) !== close) continue;
			const lineStart = source.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
			const indent = source.slice(lineStart, position).match(/^\s*/)?.[0] ?? '';
			const insertAt = position + close.length;
			this.applyEdit(insertAt, insertAt, `\n${indent}`, 'enter');
			return true;
		}
		return false;
	}

	private readonly handleCopy = (event: ClipboardEvent): void => {
		const selection = this.readSelection();
		if (!selection || selection.anchor === selection.head || !event.clipboardData) return;
		event.preventDefault();
		const from = Math.min(selection.anchor, selection.head);
		const to = Math.max(selection.anchor, selection.head);
		event.clipboardData.setData('text/plain', this.getEditableData().slice(from, to));
	};

	private readonly handleCut = (event: ClipboardEvent): void => {
		const selection = this.readSelection();
		if (!selection || selection.anchor === selection.head || !event.clipboardData) return;
		event.preventDefault();
		const from = Math.min(selection.anchor, selection.head);
		const to = Math.max(selection.anchor, selection.head);
		event.clipboardData.setData('text/plain', this.getEditableData().slice(from, to));
		this.applyEdit(from, to, '', 'cut');
	};

	private readonly handlePaste = (event: ClipboardEvent): void => {
		const selection = this.readSelection();
		const text = event.clipboardData?.getData('text/plain');
		if (!selection || text === undefined) return;
		event.preventDefault();
		this.applyEdit(
			Math.min(selection.anchor, selection.head),
			Math.max(selection.anchor, selection.head),
			text.replace(/\r\n?/g, '\n'),
			'paste',
		);
	};

	private readonly handleContextMenu = (event: MouseEvent): void => {
		if (this.composing || !this.file || !this.editRootEl) return;
		event.preventDefault();
		const selection = { ...(this.readSelection() ?? this.cachedSelection) };
		this.cachedSelection = selection;
		const file = this.file;
		const source = this.getEditableData();
		const doc = this.editRootEl.ownerDocument;
		const editor = this.getEditorAdapter();
		const restore = (): boolean => {
			if (this.file !== file || this.getEditableData() !== source || !this.editRootEl?.isConnected) {
				new Notice(wmT("문서가 변경되었습니다. 편집할 위치를 다시 선택해 주세요."));
				return false;
			}
			this.cachedSelection = { ...selection };
			this.restoreSelection(selection, true);
			return true;
		};
		const clipboard = doc.defaultView?.navigator.clipboard;
		const menu = createPagedEditorContextMenu({
			editor, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0,
			undo: () => { if (restore()) this.undo(); },
			redo: () => { if (restore()) this.redo(); },
			copy: async cut => {
				try {
					if (!clipboard) throw new Error('Clipboard unavailable');
					const from = Math.min(selection.anchor, selection.head), to = Math.max(selection.anchor, selection.head);
					await clipboard.writeText(source.slice(from, to));
					if (cut && restore()) this.applyEdit(from, to, '', 'cut');
				} catch { new Notice(wmT("클립보드에 복사하지 못했습니다.")); }
			},
			paste: async () => {
				try {
					if (!clipboard) throw new Error('Clipboard unavailable');
					const text = await clipboard.readText();
					if (restore()) this.applyEdit(Math.min(selection.anchor, selection.head), Math.max(selection.anchor, selection.head), text.replace(/\r\n?/g, '\n'), 'paste');
				} catch { new Notice(wmT("클립보드를 읽지 못했습니다. Ctrl/Cmd+V로 붙여넣어 주세요.")); }
			},
			toggleFormat: kind => { if (restore()) this.toggleFormatFromToolbar(kind); },
			selectAll: () => { if (restore()) editor.setSelection({ line:0, ch:0 }, editor.offsetToPos(source.length)); },
			find: () => this.openFindBar(),
			extend: menu => this.app.workspace.trigger('editor-menu', menu, editor, { app:this.app, file, editor, hoverPopover:null }),
		});
		menu.showAtMouseEvent(event);
	};

	private readonly handlePointerDown = (event: PointerEvent): void => {
		if (event.button !== 0) {
			const selection = this.readSelection();
			if (selection && selection.anchor !== selection.head) {
				this.cachedSelection = selection;
				event.preventDefault();
			}
			return;
		}
		this.dismissAutocomplete();
		const target = event.target as Element | null;
		const shell = target?.closest<HTMLElement>('.wm-paged-page-shell');
		if (shell) this.renderPageIfNeeded(Number(shell.dataset.pageIndex ?? -1));
		this.deactivatePagedFocusMode();
		this.pointerSelecting = true;
		this.lastHistoryKind = null;
	};

	private readonly handleViewportScroll = (): void => {
		const viewport = this.viewportEl;
		if (viewport && this.plugin.settings.enableTypewriterScrolling && this.typewriterScrollTarget !== null && !this.pointerSelecting) {
			const target = Math.max(0, Math.min(this.typewriterScrollTarget, viewport.scrollHeight - viewport.clientHeight));
			if (Math.abs(viewport.scrollTop - target) >= 1) viewport.scrollTop = target;
		}
		this.scheduleVisiblePageRender();
	};

	private readonly releaseTypewriterScroll = (): void => {
		this.typewriterScrollTarget = null;
		if (this.typewriterScrollFrame) window.cancelAnimationFrame(this.typewriterScrollFrame);
		this.typewriterScrollFrame = 0;
	};

	private scheduleVisiblePageRender(): void {
		if (this.visibleRenderFrame) return;
		this.visibleRenderFrame = window.requestAnimationFrame(() => {
			this.visibleRenderFrame = 0;
			this.positionAutocomplete();
			this.renderVisiblePages();
		});
	}

	private invalidateActivePageRenderState(): void {
		if (!this.editRootEl) return;
		const selection = this.editRootEl.ownerDocument.getSelection();
		const focusElement = selection?.focusNode
			? (selection.focusNode.nodeType === Node.ELEMENT_NODE
				? selection.focusNode as Element
				: selection.focusNode.parentElement)
			: null;
		const textEl = focusElement?.closest<HTMLElement>('.wm-paged-page-text');
		if (textEl) this.nativeEditedPageEls.add(textEl);
	}

	private readonly handlePointerEnd = (): void => {
		if (!this.pointerSelecting) return;
		this.pointerSelecting = false;
		const selection = this.readSelection();
		if (selection) {
			this.cachedSelection = selection;
			this.normalizeCollapsedSelection(selection);
		}
		if (this.dirtyPageIndex !== null) this.paginateNow(false);
	};

	private updateAutocompleteAtCaret(position: number): void {
		this.dismissAutocomplete();
		if (!this.plugin.settings.enableSmartInput || this.composing) return;
		const source = this.getEditableData();
		const trigger = (this.plugin.settings.symbolTriggers ?? [])
			.filter(item => item.enabled !== false && item.trigger && item.options?.length > 0)
			.sort((left, right) => right.trigger.length - left.trigger.length)
			.find(item => position >= item.trigger.length
				&& source.slice(position - item.trigger.length, position) === item.trigger);
		if (!trigger) return;
		const options = trigger.options.filter(option => option.open || option.close);
		if (options.length === 0) return;
		const from = position - trigger.trigger.length;
		if (options.length === 1) {
			this.applyAutocompleteOption(from, position, options[0]);
			return;
		}
		this.autocompleteOptions = options.map(option => ({ open: option.open, close: option.close }));
		this.autocompleteIndex = 0;
		this.autocompleteFrom = from;
		this.autocompleteTo = position;
		this.renderAutocomplete();
	}

	private renderAutocomplete(): void {
		if (!this.rootEl || this.autocompleteOptions.length === 0) return;
		const popup = this.rootEl.createDiv({ cls: 'wm-paged-autocomplete suggestion-container', attr: { role: 'listbox' } });
		const suggestionList = popup.createDiv({ cls: 'suggestion' });
		this.autocompleteEl = popup;
		this.autocompleteOptions.forEach((option, index) => {
			const item = suggestionList.createDiv({
				cls: `wm-paged-autocomplete-option suggestion-item${index === this.autocompleteIndex ? ' is-selected' : ''}`,
				attr: { role: 'option', 'aria-selected': String(index === this.autocompleteIndex) },
			});
			item.setText(`${option.open} ... ${option.close}`);
			item.addEventListener('pointerdown', event => {
				event.preventDefault();
				event.stopPropagation();
				this.selectAutocompleteOption(index);
			});
		});
		this.positionAutocomplete();
	}

	private positionAutocomplete(): void {
		if (!this.autocompleteEl || !this.rootEl) return;
		const rect = this.getCaretClientRect();
		const rootRect = this.rootEl.getBoundingClientRect();
		if (!rect) {
			this.dismissAutocomplete();
			return;
		}
		const width = this.autocompleteEl.offsetWidth || 120;
		const left = Math.max(6, Math.min(rootRect.width - width - 6, rect.left - rootRect.left));
		const top = Math.max(48, Math.min(rootRect.height - 40, rect.bottom - rootRect.top + 5));
		this.autocompleteEl.style.left = `${left}px`;
		this.autocompleteEl.style.top = `${top}px`;
	}

	private getCaretClientRect(): DOMRect | null {
		if (!this.editRootEl) return null;
		const selection = this.editRootEl.ownerDocument.getSelection();
		if (!selection?.focusNode) return null;
		try {
			const range = this.editRootEl.ownerDocument.createRange();
			const maxOffset = selection.focusNode.nodeType === Node.TEXT_NODE
				? (selection.focusNode.nodeValue?.length ?? 0)
				: selection.focusNode.childNodes.length;
			range.setStart(selection.focusNode, Math.max(0, Math.min(selection.focusOffset, maxOffset)));
			range.collapse(true);
			const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
			if (rect && Number.isFinite(rect.left) && (rect.height > 0 || rect.width > 0)) return rect;
			const run = closestTextRun(selection.focusNode);
			return run?.getBoundingClientRect() ?? null;
		} catch {
			return null;
		}
	}

	private handleAutocompleteKeyDown(event: KeyboardEvent): boolean {
		if (!this.autocompleteEl) return false;
		if (event.key === 'Escape') {
			event.preventDefault();
			this.dismissAutocomplete();
			return true;
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault();
			this.selectAutocompleteOption(this.autocompleteIndex);
			return true;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const delta = event.key === 'ArrowDown' ? 1 : -1;
			this.autocompleteIndex = (
				this.autocompleteIndex + delta + this.autocompleteOptions.length
			) % this.autocompleteOptions.length;
			this.syncAutocompleteSelection();
			return true;
		}
		this.dismissAutocomplete();
		return false;
	}

	private syncAutocompleteSelection(): void {
		if (!this.autocompleteEl) return;
		const options = Array.from(this.autocompleteEl.querySelectorAll<HTMLElement>('.wm-paged-autocomplete-option'));
		options.forEach((option, index) => {
			option.toggleClass('is-selected', index === this.autocompleteIndex);
			option.setAttribute('aria-selected', String(index === this.autocompleteIndex));
		});
		options[this.autocompleteIndex]?.scrollIntoView({ block: 'nearest' });
	}

	private selectAutocompleteOption(index: number): void {
		const option = this.autocompleteOptions[index];
		const from = this.autocompleteFrom;
		const to = this.autocompleteTo;
		if (!option || from < 0 || to < from) return;
		this.applyAutocompleteOption(from, to, option);
	}

	private applyAutocompleteOption(from: number, to: number, option: AutocompleteOption): void {
		this.dismissAutocomplete();
		this.applyEdit(from, to, option.open + option.close, 'other', false);
		const position = from + option.open.length;
		const selection = { anchor: position, head: position };
		this.cachedSelection = selection;
		this.cachedSelectionPageIndex = this.findPageIndex(position);
		this.renderPageIfNeeded(this.cachedSelectionPageIndex);
		this.restoreSelection(selection, true);
		this.refreshToolbarSelection();
	}

	private dismissAutocomplete(): void {
		this.autocompleteEl?.remove();
		this.autocompleteEl = null;
		this.autocompleteOptions = [];
		this.autocompleteIndex = 0;
		this.autocompleteFrom = -1;
		this.autocompleteTo = -1;
	}

	private prepareInsertion(from: number, to: number, original: string): { from: number; to: number; text: string } {
		let text = original;
		const source = this.getEditableData();

		if (
			this.plugin.settings.enableSmartInput
			&& this.plugin.settings.enableTextSubstitution
			&& original.length === 1
			&& from === to
		) {
			const substitutions = this.plugin.settings.textSubstitutions
				.filter(item => item.enabled && item.from && item.to)
				.slice()
				.sort((a, b) => b.from.length - a.from.length);
			for (const substitution of substitutions) {
				const candidateFrom = Math.max(0, from - substitution.from.length + original.length);
				const candidate = source.slice(candidateFrom, from) + original;
				if (!candidate.endsWith(substitution.from)) continue;
				from = from - substitution.from.length + original.length;
				text = substitution.to;
				this.plugin.lastSubstitution = {
					from: substitution.from,
					to: substitution.to,
					endPos: from + text.length,
				};
				break;
			}
		}

		return { from, to, text };
	}

	private insertSmartPair(from: number, to: number, value: string): boolean {
		const source = this.getEditableData();
		const autoPair = obsidianConfig(this.app, 'autoPairBrackets') !== false;
		const quote = this.plugin.settings.enableSmartQuotes ? curvedQuoteAt(source, from, value) : null;
		const straight = value === '"' || value === "'";
		const quotePair = straight && autoPair ? (quote
			? { open: value === '"' ? '“' : '‘', close: value === '"' ? '”' : '’' }
			: { open: value, close: value }) : null;
		const next = source.slice(from, from + 1);
		const canWrapQuote = quotePair && (from !== to || ((!quote || quote === quotePair.open) && (!next || /[\s)\]}:;>,]/u.test(next))));
		if (quote && !canWrapQuote && !(autoPair && from === to && next === quotePair?.close)) {
			this.applyEdit(from, to, quote, 'insert');
			return true;
		}
		const bracketPairs: Record<string, { open: string; close: string }> = {
			'(': { open: '(', close: ')' },
			'[': { open: '[', close: ']' },
			'{': { open: '{', close: '}' },
		};
		const pair = canWrapQuote ? quotePair : autoPair ? bracketPairs[value] ?? null : null;
		const typedCloser = autoPair ? (straight ? quotePair?.close : [')', ']', '}'].includes(value) ? value : pair?.close) : null;

		// Auto-inserted closing characters are traversed instead of duplicated.
		if (from === to && typedCloser && source.slice(from, from + typedCloser.length) === typedCloser) {
			const caret = from + typedCloser.length;
			const selection = { anchor: caret, head: caret };
			this.cachedSelection = selection;
			this.cachedSelectionPageIndex = this.findPageIndex(caret);
			this.renderPageIfNeeded(this.cachedSelectionPageIndex);
			this.restoreSelection(selection, true);
			this.refreshToolbarSelection();
			return true;
		}
		if (!pair) return false;

		const selected = source.slice(from, to);
		this.applyEdit(from, to, pair.open + selected + pair.close, 'insert');
		const selection = selected
			? { anchor: from + pair.open.length, head: from + pair.open.length + selected.length }
			: { anchor: from + pair.open.length, head: from + pair.open.length };
		this.cachedSelection = selection;
		this.cachedSelectionPageIndex = this.findPageIndex(selection.head);
		this.renderPageIfNeeded(this.cachedSelectionPageIndex);
		this.restoreSelection(selection, true);
		this.refreshToolbarSelection();
		return true;
	}

	/** Snapshot/extension edits share one undo record and one pagination/save pass. */
	private applyTextEdits(edits: readonly TextEdit[], recordHistory = true): void {
		const ordered = validatedEdits(this.getEditableData(), edits);
		if (!ordered.length) return;
		if (recordHistory) this.recordHistory('other');
		for (const edit of ordered) this.applyEdit(edit.from, edit.to, edit.text, 'other', false, false);
		this.pendingPaginationReuse = null;
		this.dirtyPageIndex = this.findPageIndex(ordered[ordered.length - 1].from);
		this.markDocumentChanged();
		this.paginateNow(false, this.cachedSelection);
		this.refreshToolbarSelection();
		this.dismissAutocomplete();
	}

	/** Full source includes properties; body edits preserve unaffected formatting. */
	replaceSourceSnapshot(expected: string, next: string): void {
		if (this.getViewData() !== expected) throw new Error(wmT("원고가 변경되었습니다. 다시 비교해 주세요."));
		if (next === expected) return;
		const { prefix, body } = splitFrontmatter(next);
		const edits = textEdits(this.getEditableData(), body);
		this.recordHistory('other');
		if (prefix.length !== this.frontmatterPrefix.length) this.shiftStoredStyleOffsets(prefix.length - this.frontmatterPrefix.length);
		this.frontmatterPrefix = prefix;
		if (edits.length) this.applyTextEdits(edits, false);
		else { this.markDocumentChanged(); this.refreshToolbarSelection(); }
	}

	private applyEdit(from: number, to: number, insert: string, kind: EditKind, recordHistory = true, refresh = true): void {
		const source = this.getEditableData();
		const safeFrom = Math.max(0, Math.min(from, source.length));
		const safeTo = Math.max(safeFrom, Math.min(to, source.length));
		if (safeFrom === safeTo && insert.length === 0) return;

		if (recordHistory) this.recordHistory(kind);
		// Edits on the first line can pull text into the preceding page.
		const startPage = Math.max(0, this.findPageIndex(safeFrom) - 1);
		this.pendingPaginationReuse = {
			pages: this.pages.map(page => ({ ...page })),
			from: safeFrom,
			to: safeTo,
			insertLength: insert.length,
			startPageIndex: startPage,
		};
		this.setEditableData(source.slice(0, safeFrom) + insert + source.slice(safeTo));
		this.remapTextColorRanges(safeFrom, safeTo, insert.length);
		this.remapTextBackgroundRanges(safeFrom, safeTo, insert.length);
		const inlineRanges = this.getInlineFormatRanges();
		if (inlineRanges.length > 0) {
			const remapped = this.remapInlineRanges(inlineRanges, safeFrom, safeTo, insert.length);
			this.setInlineFormatRanges(remapped, false);
		}
		this.remapParagraphAlignments(source, this.getEditableData(), safeFrom, safeTo, insert.length);
		const nextSelection = { anchor: safeFrom + insert.length, head: safeFrom + insert.length };
		this.cachedSelection = nextSelection;
		// Text insertion may move the caret over a page boundary. Navigation sets
		// an explicit page affinity, while edits must resolve against the newly
		// calculated page ranges.
		this.cachedSelectionPageIndex = null;
		this.dirtyPageIndex = Math.max(0, startPage);
		if (!refresh) return;
		this.activatePagedFocusMode();
		this.markDocumentChanged();
		this.paginateNow(false, nextSelection);
		this.updatePagedFocusLine();
		this.refreshToolbarSelection();
		if (kind === 'insert' && insert.length > 0) this.updateAutocompleteAtCaret(nextSelection.head);
		else this.dismissAutocomplete();
		if (this.plugin.settings.enableTypewriterScrolling) this.centerActivePage();
	}

	private markDocumentChanged(): void {
		this.fileStore?.changed();
		if (this.findBarEl && !this.findBarEl.hidden && this.findInputEl?.value) {
			this.refreshFindMatches(false);
		}
		if (this.file) this.app.workspace?.trigger?.('quick-preview', this.file, this.getViewData());
		this.plugin.notifyPagedEditorChanged(this);
		this.requestSave();
	}

	private activatePagedFocusMode(): void {
		if (!this.plugin.settings.enableFocusMode) return;
		this.pagedFocusTyping = true;
		this.editRootEl?.addClass('wm-paged-focus-typing');
	}

	private deactivatePagedFocusMode(): void {
		this.pagedFocusTyping = false;
		this.editRootEl?.removeClass('wm-paged-focus-typing');
		this.activeFocusParagraphEl?.removeClass('wm-paged-focus-active-line');
		this.activeFocusParagraphEl = null;
	}

	private updatePagedFocusLine(): void {
		if (!this.editRootEl || !this.pagedFocusTyping || !this.plugin.settings.enableFocusMode) return;
		const nativeSelection = this.editRootEl.ownerDocument.getSelection();
		const nativeParagraph = nativeSelection?.focusNode && this.nodeBelongsToEditor(nativeSelection.focusNode)
			? closestParagraph(nativeSelection.focusNode)
			: null;
		let activeParagraph = nativeParagraph;
		if (!activeParagraph) {
			const position = this.cachedSelection.head;
			const pageIndex = this.cachedSelectionPageIndex ?? this.findPageIndex(position);
			const textEl = this.pageTextEls[pageIndex];
			const page = this.pages[pageIndex];
			const offsetDelta = page && textEl ? this.pageDomOffsetDelta(page, textEl) : 0;
			const paragraphs = Array.from(textEl?.querySelectorAll<HTMLElement>(':scope > .wm-paged-paragraph') ?? []);
			activeParagraph = paragraphs.find(paragraph => {
				const from = Number(paragraph.dataset.from ?? -1) + offsetDelta;
				const to = Number(paragraph.dataset.to ?? -1) + offsetDelta;
				return position >= from && position <= to;
			}) ?? null;
		}
		if (this.activeFocusParagraphEl === activeParagraph) return;
		this.activeFocusParagraphEl?.removeClass('wm-paged-focus-active-line');
		activeParagraph?.addClass('wm-paged-focus-active-line');
		this.activeFocusParagraphEl = activeParagraph;
	}

	private remapPagedStylesForSourceChange(
		before: string,
		after: string,
		absoluteFrom = 0,
		beforeDocument = before,
		afterDocument = after,
	): void {
		if (before === after) return;
		if (
			this.getTextColorRanges().length === 0
			&& this.getTextBackgroundRanges().length === 0
			&& this.getInlineFormatRanges().length === 0
			&& this.getParagraphAlignments().length === 0
		) return;
		let prefix = 0;
		const sharedLength = Math.min(before.length, after.length);
		while (prefix < sharedLength && before[prefix] === after[prefix]) prefix++;
		let suffix = 0;
		while (
			suffix < before.length - prefix
			&& suffix < after.length - prefix
			&& before[before.length - suffix - 1] === after[after.length - suffix - 1]
		) suffix++;
		const from = absoluteFrom + prefix;
		const to = absoluteFrom + before.length - suffix;
		const insertLength = after.length - prefix - suffix;
		this.remapTextColorRanges(from, to, insertLength);
		this.remapTextBackgroundRanges(from, to, insertLength);
		this.remapInlineFormatRanges(from, to, insertLength);
		this.remapParagraphAlignments(beforeDocument, afterDocument, from, to, insertLength);
	}

	private remapTextColorRanges(from: number, to: number, insertLength: number): void {
		const ranges = this.getTextColorRanges();
		if (ranges.length === 0) return;
		this.setTextColorRanges(this.remapInlineRanges(ranges, from, to, insertLength), false);
	}

	private remapTextBackgroundRanges(from: number, to: number, insertLength: number): void {
		const ranges = this.getTextBackgroundRanges();
		if (ranges.length === 0) return;
		this.setTextBackgroundRanges(this.remapInlineRanges(ranges, from, to, insertLength), false);
	}

	private remapInlineFormatRanges(from: number, to: number, insertLength: number): void {
		const ranges = this.getInlineFormatRanges();
		if (ranges.length === 0) return;
		this.setInlineFormatRanges(this.remapInlineRanges(ranges, from, to, insertLength), false);
	}

	private remapInlineRanges<T extends { from: number; to: number }>(
		ranges: T[],
		from: number,
		to: number,
		insertLength: number,
	): T[] {
		const removedLength = Math.max(0, to - from);
		const delta = insertLength - removedLength;
		const next: T[] = [];

		for (const range of ranges) {
			if (removedLength === 0) {
				if (range.from < from && from < range.to) {
					next.push({ ...range, to: range.to + insertLength });
				} else if (range.from >= from) {
					next.push({ ...range, from: range.from + insertLength, to: range.to + insertLength });
				} else {
					next.push(range);
				}
				continue;
			}

			if (range.to <= from) {
				next.push(range);
				continue;
			}
			if (range.from >= to) {
				next.push({ ...range, from: range.from + delta, to: range.to + delta });
				continue;
			}

			if (range.from < from) next.push({ ...range, to: from });
			if (insertLength > 0 && range.from <= from && range.to >= to) {
				next.push({ ...range, from, to: from + insertLength });
			}
			if (range.to > to) {
				next.push({ ...range, from: to + delta, to: range.to + delta });
			}
		}

		return next;
	}

	private remapParagraphAlignments(
		before: string,
		after: string,
		from: number,
		to: number,
		insertLength: number,
	): void {
		const alignments = this.getParagraphAlignments();
		if (alignments.length === 0) return;
		const delta = insertLength - Math.max(0, to - from);
		const beforeParagraph = this.lineStartInSource(before, from);
		const inherited = alignments.find(item => item.from === beforeParagraph)?.align;
		const next = alignments.map(item => {
			let mapped = item.from;
			if (item.from > to || (item.from === to && to > from)) mapped += delta;
			else if (item.from > from && item.from < to) mapped = from;
			return { from: this.lineStartInSource(after, mapped), align: item.align };
		});
		const affectedStarts: number[] = [];
		const firstAffected = this.lineStartInSource(after, from);
		const lastAffected = this.lineStartInSource(after, Math.min(after.length, from + insertLength));
		let cursor = firstAffected;
		while (cursor <= lastAffected) {
			affectedStarts.push(cursor);
			const newlineAt = after.indexOf('\n', cursor);
			if (newlineAt < 0 || newlineAt + 1 > lastAffected) break;
			cursor = newlineAt + 1;
		}
		const unaffected = next.filter(item => !affectedStarts.includes(item.from));
		if (inherited) {
			for (const start of affectedStarts) unaffected.push({ from: start, align: inherited });
		}
		this.setParagraphAlignments(unaffected, false);
	}

	private syncSourceFromDom(markChanged = true, omitStableGrowthSnapshot = false): boolean {
		if (this.pageTextEls.length === 0) return false;
		const session = this.compositionSession;
		const hasCompositionText = session && session.text !== null && session.from >= session.pageFrom && session.to <= session.pageTo;
		const selection = hasCompositionText
			? { anchor: session.from + session.text!.length, head: session.from + session.text!.length }
			: this.readSelection() ?? this.cachedSelection;
		const domSelection = this.editRootEl?.ownerDocument.getSelection();
		const focusElement = domSelection?.focusNode
			? (domSelection.focusNode.nodeType === Node.ELEMENT_NODE
				? domSelection.focusNode as Element
				: domSelection.focusNode.parentElement)
			: null;
		const focusShell = focusElement?.closest<HTMLElement>('.wm-paged-page-shell');
		const focusPageIndex = Number(focusShell?.dataset.pageIndex ?? -1);
		const pageIndex = focusPageIndex >= 0 && focusPageIndex < this.pages.length
			? focusPageIndex
			: this.findPageIndex(selection.head);
		const page = this.pages[pageIndex];
		const textEl = this.pageTextEls[pageIndex];
		if (!page || !textEl?.isConnected) return false;

		const current = this.getEditableData();
		const previousChunk = current.slice(page.from, page.to);
		// IME event data describes the replacement once. Serializing Chromium's
		// evolving block DOM can import duplicated preedit nodes at page boundaries.
		const chunk = hasCompositionText && page.from === session.pageFrom
			? session.source.slice(session.pageFrom, session.from) + session.text + session.source.slice(session.to, session.pageTo)
			: serializePagedText(textEl);
		if (chunk === previousChunk) return false;
		const change = this.changedTextRange(previousChunk, chunk, page.from);
		const reuseStartPageIndex = Math.max(0, pageIndex - 1);
		const removedLength = Math.max(0, change.to - change.from);
		// When the native page still fits and the edit only inserts text, the
		// caller will preserve the current boundary. Avoid cloning every PageRange in
		// a 150k+ document just to discard that snapshot a few lines later.
		const omitPages = omitStableGrowthSnapshot && removedLength === 0;
		this.pendingPaginationReuse = {
			pages: omitPages ? [] : this.pages.map(candidate => ({ ...candidate })),
			...change,
			startPageIndex: reuseStartPageIndex,
		};
		this.setEditableData(current.slice(0, page.from) + chunk + current.slice(page.to));
		this.remapPagedStylesForSourceChange(previousChunk, chunk, page.from, current, this.getEditableData());
		const delta = chunk.length - (page.to - page.from);
		page.to = page.from + chunk.length;
		for (let index = pageIndex + 1; index < this.pages.length; index++) {
			this.pages[index].from += delta;
			this.pages[index].to += delta;
		}
		const source = this.getEditableData();
		this.cachedSelection = {
			anchor: Math.min(selection.anchor, source.length),
			head: Math.min(selection.head, source.length),
		};
		// Native/IME edits can push the caret across a freshly calculated page
		// boundary. Do not retain the page affinity captured from the old DOM.
		this.cachedSelectionPageIndex = null;
		this.dirtyPageIndex = this.dirtyPageIndex === null
			? reuseStartPageIndex
			: Math.min(this.dirtyPageIndex, reuseStartPageIndex);
		if (markChanged) this.markDocumentChanged();
		return true;
	}

	private changedTextRange(before: string, after: string, absoluteFrom: number): Pick<
		PaginationReuseHint,
		'from' | 'to' | 'insertLength'
	> {
		let prefix = 0;
		const sharedLength = Math.min(before.length, after.length);
		while (prefix < sharedLength && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
		let suffix = 0;
		while (
			suffix < before.length - prefix
			&& suffix < after.length - prefix
			&& before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1)
		) suffix++;
		return {
			from: absoluteFrom + prefix,
			to: absoluteFrom + before.length - suffix,
			insertLength: after.length - prefix - suffix,
		};
	}

	private paginateNow(forceRender: boolean, selectionOverride?: TextSelection): void {
		if (!this.pagination || !this.editRootEl) return;
		if (this.composing || this.pointerSelecting) return;
		// Chromium may emit a final input after compositionend with identical text.
		// A clean document must not fall back to pagination from page zero merely
		// because no dirty page is recorded.
		if (!forceRender && this.dirtyPageIndex === null && !this.pendingPaginationReuse) return;
		this.pagination.updateInlineFormats(this.getInlineFormatRanges());

		const selection = selectionOverride ?? this.readSelection() ?? this.cachedSelection;
		const source = this.getEditableData();
		const startIndex = source.length === 0 ? 0 : Math.max(0, Math.min(
			this.dirtyPageIndex ?? 0,
			Math.max(0, this.pages.length - 1),
		));
		const startOffset = startIndex === 0 ? 0 : (this.pages[startIndex]?.from ?? 0);
		const prefix = startIndex === 0 ? [] : this.pages.slice(0, startIndex).map(page => ({ ...page }));
		const reuse = this.pendingPaginationReuse;
		this.pendingPaginationReuse = null;
		let matchedOldPageIndex = -1;
		let shiftedOldPages: PageRange[] = [];
		if (reuse && reuse.startPageIndex === startIndex) {
			const removedLength = Math.max(0, reuse.to - reuse.from);
			const delta = reuse.insertLength - removedLength;
			shiftedOldPages = reuse.pages.map(page => ({
				index: page.index,
				from: page.index === startIndex
					? page.from
					: page.from >= reuse.to ? page.from + delta : page.from,
				to: page.to >= reuse.to ? page.to + delta : page.to,
			}));
		}
		const reusableByBoundary = new Map<string, number>();
		for (const page of shiftedOldPages) {
			// A matching boundary on the edited page proves that no content crossed
			// into the following page. It is therefore already a stable boundary;
			// waiting for the next page needlessly measures another full page on every
			// keystroke in a long document.
			if (page.index < startIndex) continue;
			if (page.index === startIndex && reuse && reuse.to > (reuse.pages[startIndex]?.to ?? -1)) continue;
			if (source.length > 0 && page.from === 0 && page.to === 0) continue;
			reusableByBoundary.set(`${page.from}:${page.to}`, page.index);
		}
		const stopAfterReusablePage = reusableByBoundary.size > 0 ? (page: PageRange) => {
			// An unchanged page before the edit says nothing about the edited suffix.
			if (reuse && (page.to <= reuse.from || page.to < reuse.from + reuse.insertLength)) return false;
			const oldPageIndex = reusableByBoundary.get(`${page.from}:${page.to}`);
			if (oldPageIndex === undefined) return false;
			matchedOldPageIndex = oldPageIndex;
			return true;
		} : undefined;
		const calculated = this.pagination.paginate(source, startOffset, startIndex, stopAfterReusablePage, reuse ?? undefined);
		const suffix = [...calculated];
		if (matchedOldPageIndex >= 0) {
			suffix.push(...shiftedOldPages.slice(matchedOldPageIndex + 1));
		}
		let nextPages = [...prefix, ...suffix];
		if (source.length === 0 || nextPages.length === 0) nextPages = [{ index: 0, from: 0, to: 0 }];
		nextPages = nextPages.map((page, index) => ({ ...page, index }));

		this.pages = nextPages;
		this.dirtyPageIndex = null;
		const renderIndices = forceRender
			? this.getRenderPageIndices(selection)
			: this.getVisibleRenderPageIndices(selection);
		// Finish visible page flow before returning to the next input event. A held
		// key may start another composition before the scheduled frame, during which
		// the editing host must stay frozen. Deferring following pages until that
		// frame leaves them stale for the whole burst and flashes overflow previews.
		if (forceRender || this.pageEls.length !== this.pages.length) {
			this.renderPages(selection, renderIndices);
		} else {
			this.refreshPageTexts(selection, renderIndices);
		}
		if (!forceRender) this.scheduleVisiblePageRender();
	}

	private renderPages(selection: TextSelection, requestedIndices?: number[]): void {
		if (!this.editRootEl) return;
		const hadFocus = this.editRootEl.ownerDocument.activeElement === this.editRootEl;
		this.rendering = true;

		while (this.pageEls.length < this.pages.length) {
			const pageIndex = this.pageEls.length;
			const shell = this.editRootEl.createDiv({
				cls: 'wm-paged-page-shell',
				attr: {
					'data-page-index': String(pageIndex),
				},
			});
			this.pageEls.push(shell);
			this.pageTextEls.push(null);
		}

		while (this.pageEls.length > this.pages.length) {
			this.pageEls.pop()?.remove();
			this.pageTextEls.pop();
		}

		const source = this.getEditableData();
		const renderIndices = requestedIndices ?? this.getRenderPageIndices(selection);
		this.syncPageMetadata(renderIndices);
		for (const pageIndex of renderIndices) {
			const page = this.pages[pageIndex];
			if (!page) continue;
			const shell = this.pageEls[page.index];
			const textEl = this.ensurePageTextElement(page.index);
			if (!shell || !textEl) continue;
			this.updatePageMetadata(page, shell, textEl);
			const pageChanged = this.setPageText(textEl, source.slice(page.from, page.to), page.from, source, page.index < this.pages.length - 1);
			if (pageChanged) this.resetPageScroll(shell, textEl);
		}
		this.prunePageInteriors(renderIndices, selection);

		if (hadFocus) {
			this.editRootEl.focus({ preventScroll: true });
			this.restoreSelection(selection, true);
		} else {
			this.cachedSelection = selection;
		}
		this.rendering = false;
	}

	private refreshPageTexts(selection: TextSelection, requestedIndices?: number[]): void {
		const source = this.getEditableData();
		const hadFocus = this.editRootEl?.ownerDocument.activeElement === this.editRootEl;
		this.rendering = true;
		const renderIndices = requestedIndices ?? this.getRenderPageIndices(selection);
		this.syncPageMetadata(renderIndices);
		for (const pageIndex of renderIndices) {
			const page = this.pages[pageIndex];
			if (!page) continue;
			const shell = this.pageEls[page.index];
			const textEl = this.ensurePageTextElement(page.index);
			if (!shell || !textEl) continue;
			this.updatePageMetadata(page, shell, textEl);
			const nextText = source.slice(page.from, page.to);
			const pageChanged = this.setPageText(textEl, nextText, page.from, source, page.index < this.pages.length - 1);
			if (pageChanged) this.resetPageScroll(shell, textEl);
		}
		this.prunePageInteriors(renderIndices, selection);
		this.cachedSelection = selection;
		// The destination page may reuse its DOM even though an edit moved the
		// caret there. Compare logical positions and page affinity independently of
		// DOM changes, preserving Chromium's caret after a stable IME commit.
		if (hadFocus) {
			const actual = this.readSelection();
			const nativeFocus = this.editRootEl?.ownerDocument.getSelection()?.focusNode;
			const focusElement = nativeFocus?.nodeType === Node.ELEMENT_NODE ? nativeFocus as Element : nativeFocus?.parentElement;
			const focusPage = Number(focusElement?.closest<HTMLElement>('.wm-paged-page-shell')?.dataset.pageIndex ?? -1);
			const expectedPage = this.cachedSelectionPageIndex ?? this.findPageIndex(selection.head);
			if (!actual || actual.anchor !== selection.anchor || actual.head !== selection.head
				|| (selection.anchor === selection.head && focusPage !== expectedPage)) {
				this.restoreSelection(selection, true);
			}
		}
		this.rendering = false;
	}

	private syncPageMetadata(requestedIndices?: readonly number[]): void {
		const indices = requestedIndices ?? this.pages.map((_, index) => index);
		for (const pageIndex of indices) {
			const page = this.pages[pageIndex];
			const shell = this.pageEls[pageIndex];
			const textEl = this.pageTextEls[pageIndex];
			if (page && shell && textEl?.isConnected) this.updatePageMetadata(page, shell, textEl);
		}
	}

	private updatePageMetadata(page: PageRange, shell: HTMLElement, textEl: HTMLElement): void {
		const pageIndex = String(page.index);
		const pageFrom = String(page.from);
		const pageTo = String(page.to);
		if (shell.dataset.pageIndex !== pageIndex) shell.dataset.pageIndex = pageIndex;
		shell.removeAttribute('aria-label');
		shell.removeAttribute('data-tooltip-position');
		if (textEl.dataset.pageIndex !== pageIndex) textEl.dataset.pageIndex = pageIndex;
		if (textEl.dataset.from !== pageFrom) textEl.dataset.from = pageFrom;
		if (textEl.dataset.to !== pageTo) textEl.dataset.to = pageTo;
	}

	private getRenderPageIndices(_selection: TextSelection): number[] {
		// Full hydration is reserved for initial/layout renders. Incremental edits
		// update the visible range only, while offscreen pages retain their last DOM.
		return this.pages.map((_, index) => index);
	}

	private getSelectionPageIndices(selection: TextSelection): number[] {
		return [...new Set([
			this.findPageIndex(selection.anchor),
			this.findPageIndex(selection.head),
		])].filter(index => index >= 0 && index < this.pages.length).sort((left, right) => left - right);
	}

	private getVisibleRenderPageIndices(selection: TextSelection): number[] {
		const indices = new Set(this.getSelectionPageIndices(selection));
		const viewport = this.viewportEl;
		if (!viewport || this.pages.length === 0) return [...indices];
		const columns = Math.max(1, this.gridColumns);
		const rowStride = this.displayedPageRowStride;
		const firstRow = Math.max(0, Math.floor((viewport.scrollTop - 16) / rowStride) - 1);
		const lastRow = Math.max(firstRow, Math.floor((viewport.scrollTop + viewport.clientHeight - 16) / rowStride) + 1);
		for (let row = firstRow; row <= lastRow; row++) {
			const firstIndex = row * columns;
			if (firstIndex >= this.pages.length) break;
			for (let column = 0; column < columns; column++) {
				const index = firstIndex + column;
				if (index < this.pages.length) indices.add(index);
			}
		}
		return [...indices].sort((left, right) => left - right);
	}

	private ensurePageTextElement(pageIndex: number): HTMLElement | null {
		const existing = this.pageTextEls[pageIndex];
		if (existing?.isConnected) return existing;
		const shell = this.pageEls[pageIndex];
		if (!shell) return null;
		shell.empty();
		const surface = shell.createDiv({ cls: 'wm-paged-page-surface' });
		const content = surface.createDiv({ cls: 'wm-paged-page-content' });
		const textEl = content.createDiv({
			cls: 'wm-paged-page-text',
			attr: {
				'data-page-index': String(pageIndex),
				'data-from': '0',
				'data-to': '0',
			},
		});
		textEl.appendChild(textEl.ownerDocument.createTextNode(''));
		this.pageTextEls[pageIndex] = textEl;
		return textEl;
	}

	private prunePageInteriors(_renderIndices: number[], _selection: TextSelection): void {
		// Keep the last hydrated subtree for deferred/offscreen pages. Pointer and
		// scroll paths refresh it before interaction, avoiding both blank shells and
		// an all-page DOM rewrite in the typing frame.
	}

	private renderPageIfNeeded(pageIndex: number): void {
		if (this.composing) return;
		if (pageIndex < 0 || pageIndex >= this.pages.length) return;
		const page = this.pages[pageIndex];
		const shell = this.pageEls[pageIndex];
		const textEl = this.ensurePageTextElement(pageIndex);
		if (!page || !shell || !textEl) return;
		const source = this.getEditableData();
		this.rendering = true;
		this.updatePageMetadata(page, shell, textEl);
		const pageChanged = this.setPageText(textEl, source.slice(page.from, page.to), page.from, source, page.index < this.pages.length - 1);
		if (pageChanged) this.resetPageScroll(shell, textEl);
		this.rendering = false;
	}

	private renderVisiblePages(): void {
		if (!this.editRootEl || !this.viewportEl || this.composing) return;
		const selection = this.readSelection() ?? this.cachedSelection;
		const hadFocus = this.editRootEl.ownerDocument.activeElement === this.editRootEl;
		const source = this.getEditableData();
		let selectionPageChanged = false;
		this.rendering = true;
		const renderIndices = this.getVisibleRenderPageIndices(selection);
		const selectionPageIndices = new Set(this.getSelectionPageIndices(selection));
		for (const pageIndex of renderIndices) {
			const page = this.pages[pageIndex];
			if (!page) continue;
			const shell = this.pageEls[page.index];
			const textEl = this.ensurePageTextElement(page.index);
			if (!shell || !textEl) continue;
			this.updatePageMetadata(page, shell, textEl);
			const pageChanged = this.setPageText(textEl, source.slice(page.from, page.to), page.from, source, page.index < this.pages.length - 1);
			if (pageChanged) this.resetPageScroll(shell, textEl);
			selectionPageChanged = selectionPageChanged || (pageChanged && selectionPageIndices.has(pageIndex));
		}
		this.prunePageInteriors(renderIndices, selection);
		if (selectionPageChanged && hadFocus && !this.pointerSelecting && !this.composing) {
			this.restoreSelection(selection, true);
		}
		this.rendering = false;
	}

	private setPageText(
		textEl: HTMLElement,
		text: string,
		absoluteFrom: number,
		source: string,
		hasFollowingPage: boolean,
	): boolean {
		if (this.composing && this.editRootEl?.contains(textEl)) return false;
		const firstLineStartsParagraph = absoluteFrom === 0 || source[absoluteFrom - 1] === '\n';
		const styleSignature = this.getPageStyleSignature(absoluteFrom, absoluteFrom + text.length, source);
		const previous = this.pageRenderStates.get(textEl);
		const nativeEdited = this.nativeEditedPageEls.has(textEl);
		const reusableContent = !nativeEdited && previous?.text === text
			&& previous.firstLineStartsParagraph === firstLineStartsParagraph
			&& previous.hasFollowingPage === hasFollowingPage
			&& previous.styleVersion === this.textStyleVersion
			&& previous.styleSignature === styleSignature
			&& serializePagedText(textEl) === text;
		if (reusableContent && previous) {
			// Repeated glyphs can leave the canonical page slice unchanged while
			// native composition adds overflow to its DOM. A matching cached string
			// alone must not certify that DOM or clear its pending native edit.
			// Keep the existing page subtree byte-for-byte stable. Descendant offsets
			// are interpreted relative to data-layout-from, so pages after the edit do
			// not need descendant offset writes merely because their absolute
			// document positions shifted.
			this.pageRenderStates.set(textEl, {
				...previous,
				absoluteFrom,
			});
			return false;
		}
		const nativeEditMetadataMatches = Boolean(
			previous
			&& nativeEdited
			&& previous.firstLineStartsParagraph === firstLineStartsParagraph
			&& previous.hasFollowingPage === hasFollowingPage
			&& previous.styleVersion === this.textStyleVersion
			&& previous.styleSignature === styleSignature,
		);
		let canAdoptNativeEdit = nativeEditMetadataMatches && this.canAdoptNativePageDom(textEl, text);
		if (
			!canAdoptNativeEdit
			&& nativeEditMetadataMatches
			&& previous?.absoluteFrom === absoluteFrom
			&& this.cachedSelection.anchor <= absoluteFrom + text.length
			&& this.cachedSelection.head <= absoluteFrom + text.length
		) {
			canAdoptNativeEdit = this.trimNativePageDom(textEl, text, hasFollowingPage)
				&& this.canAdoptNativePageDom(textEl, text);
		}
		if (canAdoptNativeEdit) {
			this.reindexNativePageDom(textEl, absoluteFrom, source);
			textEl.dataset.layoutFrom = String(absoluteFrom);
			textEl.dataset.firstLineStartsParagraph = String(firstLineStartsParagraph);
			textEl.dataset.hasFollowingPage = String(hasFollowingPage);
			this.pageRenderStates.set(textEl, {
				text,
				absoluteFrom,
				firstLineStartsParagraph,
				hasFollowingPage,
				styleVersion: this.textStyleVersion,
				styleSignature,
			});
			this.nativeEditedPageEls.delete(textEl);
			return false;
		}
		renderPagedText(
			textEl,
			text,
			absoluteFrom,
			firstLineStartsParagraph,
			hasFollowingPage,
		);
		this.applyPagedStyleDecorations(textEl, source);
		textEl.dataset.layoutFrom = String(absoluteFrom);
		textEl.dataset.firstLineStartsParagraph = String(firstLineStartsParagraph);
		textEl.dataset.hasFollowingPage = String(hasFollowingPage);
		this.pageRenderStates.set(textEl, {
			text,
			absoluteFrom,
			firstLineStartsParagraph,
			hasFollowingPage,
			styleVersion: this.textStyleVersion,
			styleSignature,
		});
		this.nativeEditedPageEls.delete(textEl);
		return true;
	}

	private canAdoptNativePageDom(textEl: HTMLElement, text: string): boolean {
		if (serializePagedText(textEl) !== text) return false;
		for (const run of getTextRuns(textEl)) {
			const value = run.textContent ?? '';
			const logicallyEmpty = logicalTextLength(run, value) === 0;
			if (run.classList.contains('is-empty') !== logicallyEmpty) return false;
		}
		return true;
	}

	private trimNativePageDom(textEl: HTMLElement, text: string, hasFollowingPage: boolean): boolean {
		const current = serializePagedText(textEl);
		if (!text || current.length <= text.length || !current.startsWith(text)) return false;
		const point = this.pageLocalDomPoint(textEl, text.length);
		if (!point) return false;
		try {
			const range = textEl.ownerDocument.createRange();
			range.setStart(point.node, point.offset);
			range.setEnd(textEl, textEl.childNodes.length);
			range.deleteContents();
			if (text.endsWith('\n') && hasFollowingPage) textEl.dataset.virtualTrailingNewline = 'true';
			else textEl.removeAttribute('data-virtual-trailing-newline');
			return serializePagedText(textEl) === text;
		} catch {
			return false;
		}
	}

	private pageLocalDomPoint(textEl: HTMLElement, localOffset: number): { node: Node; offset: number } | null {
		const paragraphs = Array.from(textEl.querySelectorAll<HTMLElement>(':scope > .wm-paged-paragraph'));
		let cursor = 0;
		for (let index = 0; index < paragraphs.length; index++) {
			const run = paragraphs[index].querySelector<HTMLElement>(':scope > .wm-paged-text-run');
			if (!run) continue;
			const length = logicalTextLength(run, run.textContent ?? '');
			if (localOffset <= cursor + length) return this.textPointWithinRun(run, localOffset - cursor);
			cursor += length;
			if (localOffset === cursor + 1) return { node: textEl, offset: index + 1 };
			cursor++;
		}
		return localOffset === cursor ? { node: textEl, offset: textEl.childNodes.length } : null;
	}

	private reindexNativePageDom(textEl: HTMLElement, absoluteFrom: number, source: string): void {
		let cursor = absoluteFrom;
		const alignments = new Map(this.getParagraphAlignments().map(item => [item.from, item.align]));
		const needsParagraphStart = alignments.size > 0 || this.plugin.settings.hrEnabled;
		for (const paragraph of Array.from(textEl.querySelectorAll<HTMLElement>(':scope > .wm-paged-paragraph'))) {
			const run = paragraph.querySelector<HTMLElement>(':scope > .wm-paged-text-run');
			if (!run) continue;
			const value = run.textContent ?? '';
			const length = logicalTextLength(run, value);
			const paragraphFrom = needsParagraphStart ? this.lineStartInSource(source, cursor) : cursor;
			const isDivider = this.plugin.settings.hrEnabled
				&& cursor === paragraphFrom
				&& this.isMarkdownDivider(source.slice(paragraphFrom, this.lineEndInSource(source, paragraphFrom)));
			paragraph.dataset.from = String(cursor);
			paragraph.dataset.to = String(cursor + length);
			paragraph.style.textAlign = alignments.get(paragraphFrom)
				?? this.plugin.settings.pagedDefaultAlignment
				?? 'left';
			paragraph.style.textAlignLast = paragraph.style.textAlign === 'justify'
				&& cursor + length < source.length && source[cursor + length] !== '\n' ? 'justify' : 'auto';
			paragraph.toggleClass('wm-paged-custom-divider', isDivider);
			paragraph.toggleClass('is-svg', isDivider && this.plugin.settings.hrType === 'svg' && !!this.plugin.settings.hrSvg);
			run.dataset.from = String(cursor);
			run.dataset.to = String(cursor + length);
			cursor += length + 1;
		}
	}

	private getPageStyleSignature(from: number, to: number, source: string): string {
		const encodeRanges = <T extends { from: number; to: number }>(
			ranges: T[],
			value: (range: T) => string,
		): string => ranges
			.filter(range => range.from < to && range.to > from)
			.map(range => `${Math.max(from, range.from) - from}-${Math.min(to, range.to) - from}:${value(range)}`)
			.join(',');
		const colors = encodeRanges(this.getTextColorRanges(), range => range.color);
		const backgrounds = encodeRanges(this.getTextBackgroundRanges(), range => range.color);
		const formats = encodeRanges(this.getInlineFormatRanges(), range => range.kind);
		const storedAlignments = this.getParagraphAlignments();
		let alignments = '';
		if (storedAlignments.length > 0) {
			const paragraphFrom = this.lineStartInSource(source, from);
			alignments = storedAlignments
				.filter(item => item.from >= paragraphFrom && item.from <= to)
				.map(item => `${item.from - from}:${item.align}`)
				.join(',');
		}
		const continuesParagraph = to < source.length && source[to] !== '\n' && source[to - 1] !== '\n';
		return `${colors}|${backgrounds}|${formats}|${alignments}|${continuesParagraph}`;
	}

	private applyPagedStyleDecorations(textEl: HTMLElement, source: string): void {
		const colors = this.getTextColorRanges();
		const backgrounds = this.getTextBackgroundRanges();
		const formats = this.getInlineFormatRanges();
		const searches = this.findMatches;
		const alignments = new Map(this.getParagraphAlignments().map(item => [item.from, item.align]));
		const needsParagraphStart = alignments.size > 0 || this.plugin.settings.hrEnabled;
		for (const paragraph of Array.from(textEl.querySelectorAll<HTMLElement>(':scope > .wm-paged-paragraph'))) {
			const fragmentFrom = Number(paragraph.dataset.from ?? 0);
			const fragmentTo = Number(paragraph.dataset.to ?? fragmentFrom);
			const paragraphFrom = needsParagraphStart ? this.lineStartInSource(source, fragmentFrom) : fragmentFrom;
			const align = alignments.get(paragraphFrom) ?? this.plugin.settings.pagedDefaultAlignment ?? 'left';
			paragraph.style.textAlign = align;
			// A page fragment is still part of the same source paragraph. Its last
			// visual line keeps justification until the actual paragraph ends.
			paragraph.style.textAlignLast = align === 'justify'
				&& fragmentTo < source.length && source[fragmentTo] !== '\n' ? 'justify' : 'auto';
			const isDivider = this.plugin.settings.hrEnabled
				&& fragmentFrom === paragraphFrom
				&& this.isMarkdownDivider(source.slice(paragraphFrom, this.lineEndInSource(source, paragraphFrom)));
			paragraph.toggleClass('wm-paged-custom-divider', isDivider);
			paragraph.toggleClass('is-svg', isDivider && this.plugin.settings.hrType === 'svg' && !!this.plugin.settings.hrSvg);
			const isActiveFocusParagraph = this.pagedFocusTyping
				&& this.cachedSelection.head >= fragmentFrom
				&& this.cachedSelection.head <= fragmentTo;
			paragraph.toggleClass('wm-paged-focus-active-line', isActiveFocusParagraph);
			if (isActiveFocusParagraph) {
				this.activeFocusParagraphEl?.removeClass('wm-paged-focus-active-line');
				this.activeFocusParagraphEl = paragraph;
			}
		}
		if (colors.length === 0 && backgrounds.length === 0 && formats.length === 0 && searches.length === 0) return;
		for (const run of getTextRuns(textEl)) {
			if (run.classList.contains('is-empty')) continue;
			const runFrom = Number(run.dataset.from ?? 0);
			const runTo = Number(run.dataset.to ?? runFrom);
			const matchingColors = colors.filter(range => range.from < runTo && range.to > runFrom);
			const matchingBackgrounds = backgrounds.filter(range => range.from < runTo && range.to > runFrom);
			const matchingFormats = formats.filter(range => range.from < runTo && range.to > runFrom);
			const matchingSearches = searches.filter(range => range.from < runTo && range.to > runFrom);
			if (
				matchingColors.length === 0
				&& matchingBackgrounds.length === 0
				&& matchingFormats.length === 0
				&& matchingSearches.length === 0
			) continue;
			const value = run.textContent ?? '';
			const fragment = detachedFragment(run.ownerDocument);
			const boundaries = new Set<number>([runFrom, runTo]);
			for (const range of [...matchingColors, ...matchingBackgrounds, ...matchingFormats, ...matchingSearches]) {
				boundaries.add(Math.max(runFrom, range.from));
				boundaries.add(Math.min(runTo, range.to));
			}
			const points = Array.from(boundaries).sort((left, right) => left - right);
			for (let index = 0; index < points.length - 1; index++) {
				const from = points[index];
				const to = points[index + 1];
				if (to <= from) continue;
				const color = matchingColors.find(range => range.from <= from && range.to >= to)?.color;
				const backgroundColor = matchingBackgrounds.find(range => range.from <= from && range.to >= to)?.color;
				const activeFormats = new Set(matchingFormats
					.filter(range => range.from <= from && range.to >= to)
					.map(range => range.kind));
				const searchMatch = matchingSearches.find(range => range.from <= from && range.to >= to);
				const segment = value.slice(from - runFrom, to - runFrom);
				if (!color && !backgroundColor && activeFormats.size === 0 && !searchMatch) {
					fragment.appendChild(run.ownerDocument.createTextNode(segment));
					continue;
				}
				const formatted = detachedEl(run.ownerDocument, 'span');
				formatted.className = 'wm-paged-formatted-text';
				if (color) formatted.style.color = color;
				if (backgroundColor) formatted.style.backgroundColor = backgroundColor;
				if (activeFormats.has('bold')) formatted.setCssStyles({ fontWeight: '700' });
				if (activeFormats.has('italic')) formatted.setCssStyles({ fontStyle: 'italic' });
				const decorationLines: string[] = [];
				if (activeFormats.has('underline')) decorationLines.push('underline');
				if (activeFormats.has('strikethrough')) decorationLines.push('line-through');
				if (decorationLines.length > 0) formatted.style.textDecorationLine = decorationLines.join(' ');
				if (searchMatch) {
					formatted.addClass('wm-paged-search-match');
					const activeMatch = this.findMatches[this.activeFindMatch];
					if (activeMatch?.from === searchMatch.from && activeMatch.to === searchMatch.to) {
						formatted.addClass('is-active');
					}
				}
				formatted.textContent = segment;
				fragment.appendChild(formatted);
			}
			run.replaceChildren(fragment);
		}
	}

	private resetPageScroll(shell: HTMLElement, textEl: HTMLElement): void {
		shell.scrollTop = 0;
		shell.scrollLeft = 0;
		const surface = shell.firstElementChild as HTMLElement | null;
		const content = textEl.parentElement;
		if (surface) {
			surface.scrollTop = 0;
			surface.scrollLeft = 0;
		}
		if (content) {
			content.scrollTop = 0;
			content.scrollLeft = 0;
		}
		textEl.scrollTop = 0;
		textEl.scrollLeft = 0;
	}

	private getNativeFocusPageIndex(): number | null {
		const focus = this.editRootEl?.ownerDocument.getSelection()?.focusNode;
		const element = focus?.nodeType === Node.ELEMENT_NODE ? focus as Element : focus?.parentElement;
		const shell = element?.closest<HTMLElement>('.wm-paged-page-shell');
		if (!shell || !this.editRootEl?.contains(shell)) return null;
		const index = Number(shell.dataset.pageIndex ?? -1);
		return Number.isInteger(index) && index >= 0 && index < this.pages.length ? index : null;
	}

	private readSelection(): TextSelection | null {
		if (!this.editRootEl) return null;
		const selection = this.editRootEl.ownerDocument.getSelection();
		if (!selection || !selection.anchorNode || !selection.focusNode) return null;
		if (!this.nodeBelongsToEditor(selection.anchorNode) || !this.nodeBelongsToEditor(selection.focusNode)) return null;
		const anchor = this.globalOffsetFromDom(selection.anchorNode, selection.anchorOffset);
		const head = this.globalOffsetFromDom(selection.focusNode, selection.focusOffset);
		if (anchor === null || head === null) return null;
		return { anchor, head };
	}

	private readInputSelection(event: InputEvent): TextSelection | null {
		const selection = this.readSelection();
		// Chromium's deletion range describes its own block/placeholder DOM. At a
		// page break it can include the following newline even though the logical
		// caret is on a blank line. Resolve simple edits from that caret instead.
		if (selection && selection.anchor === selection.head && [
			'deleteContentBackward', 'deleteContentForward', 'insertParagraph', 'insertLineBreak',
		].includes(event.inputType)) return selection;
		const targetRange = event.getTargetRanges?.()[0];
		if (targetRange) {
			const anchor = this.globalOffsetFromDom(targetRange.startContainer, targetRange.startOffset);
			const head = this.globalOffsetFromDom(targetRange.endContainer, targetRange.endOffset);
			if (anchor !== null && head !== null) return { anchor, head };
		}
		return selection;
	}

	private nodeBelongsToEditor(node: Node): boolean {
		return !!this.editRootEl && (node === this.editRootEl || this.editRootEl.contains(node));
	}

	private globalOffsetFromDom(node: Node, offset: number): number | null {
		if (!this.editRootEl) return null;
		if (node === this.editRootEl) {
			const childIndex = Math.max(0, Math.min(offset, this.editRootEl.childNodes.length));
			if (childIndex >= this.pages.length) return this.getEditableData().length;
			return this.pages[childIndex]?.from ?? 0;
		}

		const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
		const shell = element?.closest<HTMLElement>('.wm-paged-page-shell');
		if (!shell || !this.editRootEl.contains(shell)) return null;
		const pageIndex = Number(shell.dataset.pageIndex ?? 0);
		const page = this.pages[pageIndex];
		const textEl = this.pageTextEls[pageIndex];
		if (!page || !textEl) return null;
		const offsetDelta = this.pageDomOffsetDelta(page, textEl);

		if (!textEl.contains(node) && node !== textEl) return offset <= 0 ? page.from : page.to;
		const textRun = closestTextRun(node);
		if (textRun && textEl.contains(textRun)) {
			const runFrom = Number(textRun.dataset.from ?? page.from - offsetDelta) + offsetDelta;
			try {
				const range = textEl.ownerDocument.createRange();
				range.selectNodeContents(textRun);
				const maxOffset = node.nodeType === Node.TEXT_NODE ? (node.nodeValue?.length ?? 0) : node.childNodes.length;
				range.setEnd(node, Math.max(0, Math.min(offset, maxOffset)));
				return runFrom + logicalTextLength(textRun, range.toString());
			} catch {
				return runFrom;
			}
		}
		const paragraph = closestParagraph(node);
		if (paragraph && textEl.contains(paragraph)) {
			const paragraphFrom = Number(paragraph.dataset.from ?? page.from - offsetDelta) + offsetDelta;
			const paragraphTo = Number(paragraph.dataset.to ?? paragraphFrom - offsetDelta) + offsetDelta;
			return offset <= 0 ? paragraphFrom : paragraphTo;
		}

		if (node === textEl) {
			const childIndex = Math.max(0, Math.min(offset, textEl.childNodes.length));
			if (childIndex >= textEl.childNodes.length) return page.to;
			const child = textEl.childNodes[childIndex];
			if (child.nodeType === Node.ELEMENT_NODE) {
				const childEl = child as HTMLElement;
				if (childEl.classList.contains('wm-paged-text-run')) return Number(childEl.dataset.from ?? page.from - offsetDelta) + offsetDelta;
				if (childEl.classList.contains('wm-paged-paragraph')) return Number(childEl.dataset.from ?? page.from - offsetDelta) + offsetDelta;
				return Number(childEl.dataset.offset ?? page.from - offsetDelta) + offsetDelta;
			}
		}
		try {
			return page.from + Math.min(serializePagedText(textEl).length, Math.max(0, offset));
		} catch {
			return page.from;
		}
	}

	private pageDomOffsetDelta(page: PageRange, textEl: HTMLElement): number {
		const renderedFrom = Number(textEl.dataset.layoutFrom ?? page.from);
		return Number.isFinite(renderedFrom) ? page.from - renderedFrom : 0;
	}

	private restoreSelection(selection: TextSelection, focus: boolean): void {
		if (!this.editRootEl || this.pageTextEls.length === 0) return;
		const length = this.getEditableData().length;
		const anchor = Math.max(0, Math.min(selection.anchor, length));
		const head = Math.max(0, Math.min(selection.head, length));
		const preferredPageIndex = anchor === head ? this.cachedSelectionPageIndex ?? undefined : undefined;
		const anchorPoint = this.domPointAtOffset(anchor, preferredPageIndex);
		const headPoint = this.domPointAtOffset(head, preferredPageIndex);
		if (!anchorPoint || !headPoint) return;
		if (focus && this.editRootEl.ownerDocument.activeElement !== this.editRootEl) {
			this.editRootEl.focus({ preventScroll: true });
		}
		const domSelection = this.editRootEl.ownerDocument.getSelection();
		if (!domSelection) return;
		try {
			domSelection.setBaseAndExtent(anchorPoint.node, anchorPoint.offset, headPoint.node, headPoint.offset);
			this.cachedSelection = { anchor, head };
		} catch {
			// The view may be closing while a deferred reflow is finishing.
		}
	}

	private normalizeCollapsedSelection(selection: TextSelection): void {
		if (!this.editRootEl || this.composing || this.pointerSelecting || this.normalizingSelection || selection.anchor !== selection.head) return;
		const nativeSelection = this.editRootEl.ownerDocument.getSelection();
		if (!nativeSelection?.focusNode || closestTextRun(nativeSelection.focusNode)) return;
		this.normalizingSelection = true;
		try {
			this.restoreSelection(selection, false);
		} finally {
			this.normalizingSelection = false;
		}
	}

	private domPointAtOffset(position: number, preferredPageIndex?: number): { node: Node; offset: number } | null {
		if (this.pages.length === 0) return null;
		const preferredPage = preferredPageIndex === undefined ? null : this.pages[preferredPageIndex];
		const pageIndex = preferredPage && position >= preferredPage.from && position <= preferredPage.to
			? preferredPageIndex as number
			: this.findPageIndex(position);
		const page = this.pages[pageIndex];
		const textEl = this.ensurePageTextElement(pageIndex);
		if (!page || !textEl) return null;
		const shell = this.pageEls[pageIndex];
		if (shell) {
			const source = this.getEditableData();
			this.updatePageMetadata(page, shell, textEl);
			this.setPageText(textEl, source.slice(page.from, page.to), page.from, source, pageIndex < this.pages.length - 1);
		}
		const runs = getTextRuns(textEl);
		const offsetDelta = this.pageDomOffsetDelta(page, textEl);
		for (const run of runs) {
			const from = Number(run.dataset.from ?? page.from - offsetDelta) + offsetDelta;
			const to = Number(run.dataset.to ?? from - offsetDelta) + offsetDelta;
			if (position < from || position > to) continue;
			const logicalOffset = Math.max(0, position - from);
			return this.textPointWithinRun(run, logicalOffset);
		}
		const fallbackRun = position >= page.to ? runs[runs.length - 1] : runs[0];
		if (!fallbackRun) return { node: textEl, offset: 0 };
		const fallbackFrom = Number(fallbackRun.dataset.from ?? page.from - offsetDelta) + offsetDelta;
		const fallbackTo = Number(fallbackRun.dataset.to ?? fallbackFrom - offsetDelta) + offsetDelta;
		return this.textPointWithinRun(
			fallbackRun,
			position >= page.to ? Math.max(0, fallbackTo - fallbackFrom) : 0,
		);
	}

	private textPointWithinRun(run: HTMLElement, logicalOffset: number): { node: Node; offset: number } {
		const fallback = run.firstChild ?? run.appendChild(run.ownerDocument.createTextNode(''));
		if (run.classList.contains('is-empty')) return { node: fallback, offset: 0 };
		const walker = run.ownerDocument.createTreeWalker(run, 4);
		let remaining = Math.max(0, logicalOffset);
		let lastText: Text | null = null;
		let current = walker.nextNode() as Text | null;
		while (current) {
			lastText = current;
			const length = current.nodeValue?.length ?? 0;
			if (remaining <= length) return { node: current, offset: remaining };
			remaining -= length;
			current = walker.nextNode() as Text | null;
		}
		if (lastText) return { node: lastText, offset: lastText.nodeValue?.length ?? 0 };
		return { node: fallback, offset: 0 };
	}

	private moveCaretAcrossPageBoundary(forward: boolean, extend: boolean): boolean {
		if (!this.editRootEl) return false;
		const selection = this.editRootEl.ownerDocument.getSelection();
		if (!selection?.focusNode || (!selection.isCollapsed && !extend)) return false;
		const element = selection.focusNode.nodeType === Node.ELEMENT_NODE
			? selection.focusNode as Element
			: selection.focusNode.parentElement;
		const shell = element?.closest<HTMLElement>('.wm-paged-page-shell');
		if (!shell) return false;
		const pageIndex = Number(shell.dataset.pageIndex ?? -1);
		const textEl = this.pageTextEls[pageIndex];
		const page = this.pages[pageIndex];
		if (!textEl || !page) return false;
		const position = this.globalOffsetFromDom(selection.focusNode, selection.focusOffset);
		if (position === null) return false;
		const emptyRun = closestTextRun(selection.focusNode)?.classList.contains('is-empty');
		if (emptyRun) {
			// The zero-width caret placeholder has two DOM offsets but no source
			// width. Consume the real newline instead of stopping inside it.
			const target = forward ? this.nextCodePoint(position) : this.previousCodePoint(position);
			if (target !== position) this.placeCaretInPage(this.findPageIndex(target), target, extend);
			return true;
		}

		const atPageEdge = forward ? position === page.to : position === page.from;
		if (!atPageEdge) return false;
		// Horizontal movement follows reading order, including row wraps. For
		// example, in a three-column grid Left at the start of page 4 lands at
		// the end of page 3; vertical movement remains spatial by grid column.
		const targetPageIndex = pageIndex + (forward ? 1 : -1);
		if (targetPageIndex >= 0 && targetPageIndex < this.pages.length) {
			const targetPage = this.pages[targetPageIndex];
			this.placeCaretInPage(targetPageIndex, forward ? targetPage.from : targetPage.to, extend);
		}
		return true;
	}

	private moveCaretVerticallyAcrossPageBoundary(forward: boolean, extend: boolean): boolean {
		if (!this.editRootEl) return false;
		const selection = this.editRootEl.ownerDocument.getSelection();
		if (!selection?.focusNode || (!selection.isCollapsed && !extend)) return false;
		const element = selection.focusNode.nodeType === Node.ELEMENT_NODE
			? selection.focusNode as Element
			: selection.focusNode.parentElement;
		const shell = element?.closest<HTMLElement>('.wm-paged-page-shell');
		if (!shell) return false;
		const pageIndex = Number(shell.dataset.pageIndex ?? -1);
		const page = this.pages[pageIndex];
		const textEl = this.pageTextEls[pageIndex];
		if (!page || !textEl || !this.isCaretOnVerticalPageEdge(selection, textEl, forward)) return false;
		const targetPageIndex = pageIndex + (forward ? 1 : -1) * Math.max(1, this.gridColumns);
		const targetPage = this.pages[targetPageIndex];
		if (!targetPage) return true;
		this.placeCaretAtPageEdge(
			targetPageIndex,
			forward,
			extend,
			this.getCaretClientX(selection),
		);
		return true;
	}

	private getCaretClientX(selection: Selection): number | null {
		if (!selection.focusNode) return null;
		try {
			const range = this.editRootEl?.ownerDocument.createRange();
			if (!range) return null;
			const maxOffset = selection.focusNode.nodeType === Node.TEXT_NODE
				? (selection.focusNode.nodeValue?.length ?? 0)
				: selection.focusNode.childNodes.length;
			range.setStart(selection.focusNode, Math.max(0, Math.min(selection.focusOffset, maxOffset)));
			range.collapse(true);
			const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
			return Number.isFinite(rect.left) ? rect.left : null;
		} catch {
			return null;
		}
	}

	private isCaretOnVerticalPageEdge(selection: Selection, textEl: HTMLElement, forward: boolean): boolean {
		if (!selection.focusNode) return false;
		const run = closestTextRun(selection.focusNode);
		if (run?.classList.contains('is-empty')) {
			const paragraph = closestParagraph(run);
			return paragraph === (forward ? textEl.lastElementChild : textEl.firstElementChild);
		}
		const document = textEl.ownerDocument;
		let caretRect: DOMRect | null = null;
		try {
			const caretRange = document.createRange();
			const maxOffset = selection.focusNode.nodeType === Node.TEXT_NODE
				? (selection.focusNode.nodeValue?.length ?? 0)
				: selection.focusNode.childNodes.length;
			caretRange.setStart(selection.focusNode, Math.max(0, Math.min(selection.focusOffset, maxOffset)));
			caretRange.collapse(true);
			caretRect = caretRange.getClientRects()[0] ?? caretRange.getBoundingClientRect();
			if (!caretRect || caretRect.height < 0.5) {
				const run = closestTextRun(selection.focusNode);
				const probeNode = selection.focusNode.nodeType === Node.TEXT_NODE
					? selection.focusNode as Text
					: run?.firstChild instanceof Text ? run.firstChild : null;
				if (probeNode && probeNode.length > 0) {
					const probeOffset = Math.max(0, Math.min(probeNode.length - 1, selection.focusOffset - (selection.focusOffset === probeNode.length ? 1 : 0)));
					caretRange.setStart(probeNode, probeOffset);
					caretRange.setEnd(probeNode, Math.min(probeNode.length, probeOffset + 1));
					caretRect = caretRange.getClientRects()[0] ?? caretRange.getBoundingClientRect();
				}
			}
			const contents = document.createRange();
			contents.selectNodeContents(textEl);
			const lineRects = Array.from(contents.getClientRects()).filter(rect => rect.height >= 0.5);
			if (!caretRect || caretRect.height < 0.5 || lineRects.length === 0) return false;
			const edgeTop = forward
				? Math.max(...lineRects.map(rect => rect.top))
				: Math.min(...lineRects.map(rect => rect.top));
			const computedLineHeight = Number.parseFloat(document.defaultView?.getComputedStyle(textEl).lineHeight ?? '');
			const tolerance = Math.max(2, (Number.isFinite(computedLineHeight) ? computedLineHeight : caretRect.height) * 0.45);
			return Math.abs(caretRect.top - edgeTop) <= tolerance;
		} catch {
			return false;
		}
	}

	private placeCaretInPage(pageIndex: number, globalOffset: number, extend: boolean): void {
		if (!this.editRootEl) return;
		const point = this.domPointAtOffset(globalOffset, pageIndex);
		if (!point) return;
		this.pageEls[pageIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		const selection = this.editRootEl.ownerDocument.getSelection();
		if (!selection) return;
		if (extend && selection.anchorNode) selection.extend(point.node, point.offset);
		else selection.setBaseAndExtent(point.node, point.offset, point.node, point.offset);
		this.cachedSelectionPageIndex = pageIndex;
		this.cachedSelection = this.readSelection() ?? { anchor: globalOffset, head: globalOffset };
	}

	private placeCaretAtPageEdge(
		pageIndex: number,
		fromTop: boolean,
		extend: boolean,
		preferredClientX: number | null,
	): void {
		if (!this.editRootEl) return;
		this.renderPageIfNeeded(pageIndex);
		const textEl = this.pageTextEls[pageIndex];
		const page = this.pages[pageIndex];
		if (!textEl || !page) return;
		const document = textEl.ownerDocument;
		if (preferredClientX !== null) {
			try {
				const contents = document.createRange();
				contents.selectNodeContents(textEl);
				const lineRects = Array.from(contents.getClientRects()).filter(rect => rect.height >= 0.5);
				if (lineRects.length > 0) {
					const edgeTop = fromTop
						? Math.min(...lineRects.map(rect => rect.top))
						: Math.max(...lineRects.map(rect => rect.top));
					const edgeRects = lineRects.filter(rect => Math.abs(rect.top - edgeTop) <= 1);
					const lineHeight = Math.max(...edgeRects.map(rect => rect.height));
					const bounds = textEl.getBoundingClientRect();
					const x = Math.max(bounds.left + 1, Math.min(bounds.right - 1, preferredClientX));
					const hit = caretRangeAtPoint(document, x, edgeTop + lineHeight / 2);
					if (hit && textEl.contains(hit.startContainer)) {
						const logicalOffset = this.globalOffsetFromDom(hit.startContainer, hit.startOffset);
						const point = logicalOffset === null
							? { node: hit.startContainer, offset: hit.startOffset }
							: this.domPointAtOffset(logicalOffset, pageIndex);
						if (!point) return;
						this.pageEls[pageIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
						const selection = document.getSelection();
						if (selection) {
							if (extend && selection.anchorNode) selection.extend(point.node, point.offset);
							else selection.setBaseAndExtent(
								point.node,
								point.offset,
								point.node,
								point.offset,
							);
							this.cachedSelectionPageIndex = pageIndex;
							this.cachedSelection = this.readSelection() ?? {
								anchor: logicalOffset ?? (fromTop ? page.from : page.to),
								head: logicalOffset ?? (fromTop ? page.from : page.to),
							};
							return;
						}
					}
				}
			} catch {
				// Fall back to the logical start/end when point hit-testing is unavailable.
			}
		}
		this.placeCaretInPage(pageIndex, fromTop ? page.from : page.to, extend);
	}

	private findPageIndex(position: number): number {
		if (this.pages.length === 0) return 0;
		let low = 0;
		let high = this.pages.length - 1;
		while (low <= high) {
			const middle = Math.floor((low + high) / 2);
			const page = this.pages[middle];
			if (position < page.from) high = middle - 1;
			else if (position >= page.to && middle < this.pages.length - 1) low = middle + 1;
			else return middle;
		}
		return Math.max(0, Math.min(low, this.pages.length - 1));
	}

	private recordHistory(kind: EditKind): void {
		const now = Date.now();
		const groupable = (kind === 'insert' || kind === 'delete')
			&& kind === this.lastHistoryKind
			&& now - this.lastHistoryAt < 800;
		if (!groupable) this.pushHistorySnapshot();
		this.redoStack = [];
		this.lastHistoryKind = kind;
		this.lastHistoryAt = now;
	}

	private pushHistorySnapshot(): void {
		const selection = this.readSelection() ?? this.cachedSelection;
		this.undoStack.push(this.createHistorySnapshot(this.getEditableData(), selection));
		if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
	}

	private createHistorySnapshot(data: string, selection: TextSelection): HistorySnapshot {
		return {
			data,
			frontmatterPrefix: this.frontmatterPrefix,
			...selection,
			textColors: this.getTextColorRanges(),
			textBackgrounds: this.getTextBackgroundRanges(),
			inlineFormats: this.getInlineFormatRanges(),
			paragraphAlignments: this.getParagraphAlignments(),
		};
	}

	private undo(): void {
		const snapshot = this.undoStack.pop();
		if (!snapshot) return;
		const current = this.readSelection() ?? this.cachedSelection;
		this.redoStack.push(this.createHistorySnapshot(this.getEditableData(), current));
		this.restoreSnapshot(snapshot);
	}

	private redo(): void {
		const snapshot = this.redoStack.pop();
		if (!snapshot) return;
		const current = this.readSelection() ?? this.cachedSelection;
		this.undoStack.push(this.createHistorySnapshot(this.getEditableData(), current));
		this.restoreSnapshot(snapshot);
	}

	private restoreSnapshot(snapshot: HistorySnapshot): void {
		const prefix = snapshot.frontmatterPrefix ?? this.frontmatterPrefix;
		const dataChanged = snapshot.data !== this.getEditableData() || prefix !== this.frontmatterPrefix;
		if (prefix.length !== this.frontmatterPrefix.length) this.shiftStoredStyleOffsets(prefix.length - this.frontmatterPrefix.length);
		this.frontmatterPrefix = prefix;
		this.setEditableData(snapshot.data);
		this.setTextColorRanges(snapshot.textColors);
		this.setTextBackgroundRanges(snapshot.textBackgrounds);
		this.setInlineFormatRanges(snapshot.inlineFormats);
		this.setParagraphAlignments(snapshot.paragraphAlignments);
		this.cachedSelection = { anchor: snapshot.anchor, head: snapshot.head };
		this.lastHistoryKind = null;
		this.dirtyPageIndex = 0;
		this.paginateNow(true, this.cachedSelection);
		if (dataChanged) this.markDocumentChanged();
		this.refreshToolbarSelection();
	}

	private clearHistory(): void {
		this.undoStack = [];
		this.redoStack = [];
		this.lastHistoryKind = null;
	}

	private previousCodePoint(position: number): number {
		if (position <= 0) return 0;
		const source = this.getEditableData();
		const first = source.charCodeAt(position - 1);
		if (first >= 0xdc00 && first <= 0xdfff && position > 1) {
			const second = source.charCodeAt(position - 2);
			if (second >= 0xd800 && second <= 0xdbff) return position - 2;
		}
		return position - 1;
	}

	private nextCodePoint(position: number): number {
		const source = this.getEditableData();
		if (position >= source.length) return source.length;
		const first = source.charCodeAt(position);
		if (first >= 0xd800 && first <= 0xdbff && position + 1 < source.length) {
			const second = source.charCodeAt(position + 1);
			if (second >= 0xdc00 && second <= 0xdfff) return position + 2;
		}
		return position + 1;
	}

	private previousWordBoundary(position: number): number {
		const before = this.getEditableData().slice(0, position);
		const match = before.match(/\s*\S+\s*$/u);
		return match ? position - match[0].length : 0;
	}

	private nextWordBoundary(position: number): number {
		const after = this.getEditableData().slice(position);
		const match = after.match(/^\s*\S+\s*/u);
		return match ? position + match[0].length : this.getEditableData().length;
	}

	private lineStart(position: number): number {
		return this.lineStartInSource(this.getEditableData(), position);
	}

	private lineStartInSource(source: string, position: number): number {
		const safePosition = Math.max(0, Math.min(source.length, position));
		if (safePosition === 0) return 0;
		const index = source.lastIndexOf('\n', safePosition - 1);
		return index < 0 ? 0 : index + 1;
	}

	private lineEnd(position: number): number {
		return this.lineEndInSource(this.getEditableData(), position);
	}

	private lineEndInSource(source: string, position: number): number {
		const index = source.indexOf('\n', Math.max(0, Math.min(source.length, position)));
		return index < 0 ? source.length : index;
	}

	private isMarkdownDivider(line: string): boolean {
		const value = line.trim();
		return /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/u.test(value);
	}

	private installObservers(): void {
		if (!this.viewportEl) return;
		this.resizeObserver = new ResizeObserver(entries => {
			const entry = entries.find(item => item.target === this.viewportEl);
			if (entry) this.viewportWidth = entry.contentRect.width;
			this.updateGridColumns(this.viewportWidth);
			this.handleViewportScroll();
		});
		this.resizeObserver.observe(this.viewportEl);
	}

	private updateGridColumns(measuredWidth?: number): void {
		if (!this.viewportEl || !this.editRootEl) return;
		// The shell uses content-box, so its one-pixel border on both sides is part
		// of the grid track. Omitting it lets the virtual row/column model drift
		// away from the real DOM over a large page count.
		const displayWidth = this.displayedPageWidth;
		const viewportWidth = measuredWidth ?? (this.viewportWidth || this.viewportEl.clientWidth);
		this.viewportWidth = viewportWidth;
		const available = Math.max(0, viewportWidth - 32);
		const columns = Math.max(1, Math.floor((available + PAGE_GAP) / (displayWidth + PAGE_GAP)));
		if (columns === this.gridColumns && Math.abs(displayWidth - this.gridDisplayWidth) < 0.01) return;
		this.gridColumns = columns;
		this.gridDisplayWidth = displayWidth;
		this.editRootEl.style.gridTemplateColumns = `repeat(${columns}, ${displayWidth}px)`;
		this.editRootEl.style.setProperty('--wm-paged-columns', String(columns));
	}

	private readonly handleZoomWheel = (event: WheelEvent): void => {
		if (!event.ctrlKey && !event.metaKey) { this.releaseTypewriterScroll(); return; }
		if (event.deltaY === 0) return;
		event.preventDefault();
		event.stopPropagation();
		this.setZoom(this.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
	};

	private setZoom(value: number): void {
		const viewport = this.viewportEl;
		const oldColumns = Math.max(1, this.gridColumns);
		const oldStride = this.displayedPageRowStride;
		const caretPageIndex = this.findPageIndex(this.cachedSelection.head);
		const viewportRow = viewport
			? Math.max(0, Math.floor((viewport.scrollTop + viewport.clientHeight / 2 - 16) / oldStride))
			: 0;
		const anchorPageIndex = this.plugin.settings.enableTypewriterScrolling
			? caretPageIndex
			: Math.min(this.pages.length - 1, viewportRow * oldColumns);
		const rounded = Math.round(value * 100) / 100;
		this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rounded));
		if (this.file) savePagedZoom(this.app, this.file.path, this.zoom);
		this.applyGeometryVariables();
		// Zoom is visual only: page and text scale by the same ratio, so the
		// logical line/page boundaries must stay unchanged. Reconfiguring the
		// paginator here invalidated its assumptions and caused the first edits
		// after zoom to remeasure a large suffix of long documents.
		this.updateGridColumns();
		if (viewport) {
			const row = Math.floor(Math.max(0, anchorPageIndex) / Math.max(1, this.gridColumns));
			const pageCenter = 16 + row * this.displayedPageRowStride + this.displayedPageHeight / 2;
			viewport.scrollTop = Math.max(0, pageCenter - viewport.clientHeight / 2);
		}
		// Never rebuild page DOM synchronously during zoom. Chromium keeps the
		// native caret and drag range inside those nodes, so replacing them here
		// makes the caret disappear and cancels selection dragging.
		this.handleViewportScroll();
		if (this.plugin.settings.enableTypewriterScrolling) this.centerActivePage();
		this.plugin.toolbarManager.refreshToolbar(this.leaf);
	}

	private get displayScale(): number {
		return this.zoom * PAGE_DISPLAY_SCALE_AT_100;
	}

	private get displayedPageWidth(): number {
		return this.pageGeometry.pageWidth * this.displayScale + PAGE_BORDER_SIZE;
	}

	private get displayedPageHeight(): number {
		return this.pageGeometry.pageHeight * this.displayScale + PAGE_BORDER_SIZE;
	}

	private get displayedPageRowStride(): number {
		return this.displayedPageHeight + PAGE_GAP;
	}

	private getPaginationGeometry(): PageGeometry {
		// Pagination is normalized to the 100% visual ratio. Uniform zoom changes
		// CSS pixels, not which glyph belongs to which line or page.
		const pageScale = PAGE_DISPLAY_SCALE_AT_100;
		return {
			...this.pageGeometry,
			pageWidth: this.pageGeometry.pageWidth * pageScale,
			pageHeight: this.pageGeometry.pageHeight * pageScale,
			marginTop: this.pageGeometry.marginTop * pageScale,
			marginRight: this.pageGeometry.marginRight * pageScale,
			marginBottom: this.pageGeometry.marginBottom * pageScale,
			marginLeft: this.pageGeometry.marginLeft * pageScale,
			fontSize: this.pageGeometry.fontSize,
			indentation: this.pageGeometry.indentation,
		};
	}

	private getPageGeometryFromSettings(): PageGeometry {
		return {
			...DEFAULT_PAGE_GEOMETRY,
			pageWidth: Math.max(80 * PX_PER_MM, this.plugin.settings.pagedPageWidth || DEFAULT_PAGE_GEOMETRY.pageWidth),
			pageHeight: Math.max(80 * PX_PER_MM, this.plugin.settings.pagedPageHeight || DEFAULT_PAGE_GEOMETRY.pageHeight),
			marginTop: Math.max(0, this.plugin.settings.pagedMarginTop ?? DEFAULT_PAGE_GEOMETRY.marginTop),
			marginRight: Math.max(0, this.plugin.settings.pagedMarginRight ?? DEFAULT_PAGE_GEOMETRY.marginRight),
			marginBottom: Math.max(0, this.plugin.settings.pagedMarginBottom ?? DEFAULT_PAGE_GEOMETRY.marginBottom),
			marginLeft: Math.max(0, this.plugin.settings.pagedMarginLeft ?? DEFAULT_PAGE_GEOMETRY.marginLeft),
			fontSize: Math.max(8, this.plugin.settings.fontSize || DEFAULT_PAGE_GEOMETRY.fontSize),
			lineHeight: Math.max(1, this.plugin.settings.lineHeight || DEFAULT_PAGE_GEOMETRY.lineHeight),
			paragraphSpacing: Math.max(0, this.plugin.settings.paragraphSpacing || 0),
			indentation: Math.max(0, this.plugin.settings.indentation || 0),
		};
	}

	private getLayoutSignature(geometry: PageGeometry): string {
		return JSON.stringify([
			geometry.pageWidth,
			geometry.pageHeight,
			geometry.marginTop,
			geometry.marginRight,
			geometry.marginBottom,
			geometry.marginLeft,
			geometry.fontSize,
			geometry.lineHeight,
			geometry.paragraphSpacing,
			geometry.indentation,
			this.plugin.settings.fontFamily.trim(),
			this.plugin.settings.fontWeight || 400,
		]);
	}

	private applyGeometryVariables(): void {
		if (!this.rootEl) return;
		if (!this.plugin.settings.enableTypewriterScrolling) this.releaseTypewriterScroll();
		const geometry = this.pageGeometry;
		this.rootEl.toggleClass('is-typewriter', this.plugin.settings.enableTypewriterScrolling);
		const pageScale = this.displayScale;
		const textScale = this.zoom;
		const configuredFont = this.plugin.settings.fontFamily.trim();
		const fontFamily = !configuredFont || configuredFont === 'inherit'
			? 'var(--font-text)'
			: `"${configuredFont.replace(/["\\]/g, '\\$&')}", var(--font-text), system-ui, sans-serif`;
		this.rootEl.style.setProperty('--wm-paged-font-family', fontFamily);
		this.rootEl.style.setProperty('--wm-paged-font-weight', String(this.plugin.settings.fontWeight || 400));
		// Page packing and both DOM surfaces must use the same geometry even
		// before the workspace leaf's shared editor styles have been refreshed.
		this.rootEl.style.setProperty('--wm-line-height', String(geometry.lineHeight));
		this.rootEl.style.setProperty('--wm-paragraph-spacing', `${geometry.paragraphSpacing}em`);
		this.rootEl.style.setProperty('--wm-paged-page-width', `${geometry.pageWidth}px`);
		this.rootEl.style.setProperty('--wm-paged-page-height', `${geometry.pageHeight}px`);
		this.rootEl.style.setProperty('--wm-paged-page-display-width', `${geometry.pageWidth * pageScale}px`);
		this.rootEl.style.setProperty('--wm-paged-page-display-height', `${geometry.pageHeight * pageScale}px`);
		this.rootEl.style.setProperty('--wm-paged-render-font-size', `${geometry.fontSize * textScale}px`);
		this.rootEl.style.setProperty('--wm-paged-render-indent', `${geometry.indentation * textScale}px`);
		this.rootEl.style.setProperty('--wm-paged-margin-top', `${geometry.marginTop}px`);
		this.rootEl.style.setProperty('--wm-paged-margin-right', `${geometry.marginRight}px`);
		this.rootEl.style.setProperty('--wm-paged-margin-bottom', `${geometry.marginBottom}px`);
		this.rootEl.style.setProperty('--wm-paged-margin-left', `${geometry.marginLeft}px`);
		this.rootEl.style.setProperty('--wm-paged-render-margin-top', `${geometry.marginTop * pageScale}px`);
		this.rootEl.style.setProperty('--wm-paged-render-margin-right', `${geometry.marginRight * pageScale}px`);
		this.rootEl.style.setProperty('--wm-paged-render-margin-bottom', `${geometry.marginBottom * pageScale}px`);
		this.rootEl.style.setProperty('--wm-paged-render-margin-left', `${geometry.marginLeft * pageScale}px`);
		this.rootEl.style.setProperty('--writing-menu-focus-opacity', String(this.plugin.settings.focusOpacity ?? 0.25));
		this.rootEl.style.setProperty(
			'--wm-paged-hr-content',
			`"${(this.plugin.settings.hrContent || '✦ ✦ ✦').replace(/"/g, '\\"')}"`,
		);
		this.rootEl.style.setProperty('--wm-paged-hr-color', this.plugin.settings.hrColor || 'var(--text-muted)');
		this.rootEl.style.setProperty('--wm-paged-hr-align', this.plugin.settings.hrAlign || 'center');
		if (this.plugin.settings.hrType === 'svg' && this.plugin.settings.hrSvg) {
			this.rootEl.style.setProperty(
				'--wm-paged-hr-svg-url',
				`url("data:image/svg+xml,${encodeURIComponent(this.plugin.settings.hrSvg)}")`,
			);
		} else {
			this.rootEl.style.removeProperty('--wm-paged-hr-svg-url');
		}
		this.applyPaginationMeasurementVariables();
		const configuredBackground = this.plugin.settings.backgroundColor;
		const theme = this.rootEl.ownerDocument.body.classList.contains('theme-dark') ? 'dark' : 'light';
		const background = typeof configuredBackground === 'string'
			? configuredBackground
			: configuredBackground[theme] || configuredBackground.light;
		this.rootEl.style.setProperty(
			'--wm-paged-paper-bg',
			!background || background === 'transparent' || background === 'inherit'
				? 'var(--background-primary)'
				: background,
		);
	}

	private applyPaginationMeasurementVariables(): void {
		if (!this.measurerEl) return;
		// The hidden measurer uses the normalized 100% layout even while the page
		// surface is visually zoomed. Its custom properties override the scaled
		// values inherited from the paged-view root.
		this.measurerEl.style.setProperty('--wm-paged-render-font-size', `${this.pageGeometry.fontSize}px`);
		this.measurerEl.style.setProperty('--wm-paged-render-indent', `${this.pageGeometry.indentation}px`);
	}

	private centerActivePage(): void {
		if (!this.viewportEl || !this.editRootEl) return;
		if (this.typewriterScrollFrame) window.cancelAnimationFrame(this.typewriterScrollFrame);
		const center = () => {
			if (!this.editRootEl || !this.viewportEl || !this.plugin.settings.enableTypewriterScrolling || this.pointerSelecting) return;
			const viewport = this.viewportEl;
			const composingIndex = this.composing ? this.compositionScrollPageIndex ?? this.getNativeFocusPageIndex() : null;
			const pageIndex = composingIndex ?? this.cachedSelectionPageIndex ?? this.findPageIndex(this.cachedSelection.head);
			const page = this.pageEls[pageIndex]
				?? (this.composing ? this.compositionPreviewEls.find(shell => Number(shell.dataset.pageIndex) === pageIndex) : null);
			if (!page) return;
			// Measure the current layout after pagination/IME previews settle rather
			// than retaining a page index and estimating a row from the previous grid.
			const pageRect = page.getBoundingClientRect();
			const viewportRect = viewport.getBoundingClientRect();
			const pageCenter = viewport.scrollTop + pageRect.top + pageRect.height / 2 - viewportRect.top - viewport.clientTop;
			const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
			const target = Math.max(0, Math.min(maxScrollTop, pageCenter - viewport.clientHeight / 2));
			this.typewriterScrollTarget = target;
			if (Math.abs(viewport.scrollTop - target) >= 1) viewport.scrollTop = target;
		};
		// Pin immediately for a burst of native input, then verify after layout.
		// A frame-only correction lets Chromium scroll the overflowing native caret
		// between keys and repeatedly undo the page's centered position.
		center();
		this.typewriterScrollFrame = window.requestAnimationFrame(() => {
			this.typewriterScrollFrame = 0;
			center();
		});
	}

	private async openInSourceView(mode: 'source' | 'preview' = 'source'): Promise<void> {
		if (!this.file) return;
		try {
			await this.save();
			if (this.fileStore?.hasConflict) { this.conflictBanner?.querySelector('button')?.click(); return; }
			await this.plugin.toolbarManager.switchWritingView(this.leaf, {
				type: 'markdown',
				state: { file: this.file.path, mode },
				active: true,
			});
		} catch (error) {
			console.error('[Writing Menu] Failed to return to source view', error);
			new Notice(wmT("기본 편집기로 전환하지 못했습니다."));
		}
	}
}
