import { Menu, Notice, TFile, normalizePath, setIcon, type EventRef } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { getWikiColor, getWikiDisplayName, getWikiImgSrc } from '../wiki/wikiProfileUtils';
import {
	DEFAULT_PLOTBOOK_FONT_SIZE,
	columnLabel,
	type PlotWorkbookCellStyle,
	type PlotWorkbookColumnRole,
	type PlotWorkbookForeshadowLocation,
	type PlotWorkbookSheet,
} from './PlotWorkbookTypes';
import { PlotWorkbookSession, plotColumnWidth, plotRowHeight, type PlotWorkbookStylePatch } from './PlotWorkbookSession';
import { PlotWorkbookCastConfirmModal, PlotWorkbookCharacterModal, PlotWorkbookRoleConfirmModal } from './PlotWorkbookCharacterModal';
import { PlotWorkbookLabelModal } from './PlotWorkbookLabelModal';
import { PlotWorkbookMoveColumnsModal } from './PlotWorkbookMoveColumnsModal';
import { PlotWorkbookSnapshotModal } from './PlotWorkbookSnapshotModal';
import { PlotWorkbookForeshadowModal } from './PlotWorkbookForeshadowModal';
import { renderForeshadowBadge } from './PlotWorkbookForeshadowCard';
import { parseChecklist } from './PlotWorkbookChecklist';
import { PlotWorkbookChecklistPopover } from './PlotWorkbookChecklistPopover';
import { createChecklistControl, renderChecklistCompletionDate } from './PlotWorkbookChecklistControl';
import { PlotWorkbookCellEditorSize } from './PlotWorkbookCellEditorSize';
import { openPlotWorkbookCharacter, openPlotWorkbookStatusMenu } from './PlotWorkbookCellActions';
import { PLOT_COLUMN_ICONS as COLUMN_ROLE_ICONS } from './PlotWorkbookColumnPresentation';
import { parsePlotWorkbookSearch } from './PlotWorkbookSearch';
import { PlotWorkbookCreateNoteModal, PlotWorkbookNumberingModal, PlotWorkbookProjectNoteModal } from './PlotWorkbookNoteModal';
import type { ThemeAwareColor } from '../types';
import {
	DEFAULT_BACKGROUND_COLORS,
	DEFAULT_TEXT_COLORS,
	resolveThemeColor,
	themeModeFromDocument,
} from '../utils/themeColor';

const DEFAULT_ROW_HEADER_WIDTH = 100;
const DEFAULT_COLUMN_HEADER_HEIGHT = 50;
const MIN_OVERSCAN = 240;
const MIN_SCROLL_LOOKAHEAD_MS = 80;
const MAX_SCROLL_LOOKAHEAD_MS = 320;
const MAX_OVERSCAN_VIEWPORTS = 3.25;
const MAX_OVERSCAN_AREA_VIEWPORTS = 12;
const MIN_OVERSCAN_AREA_VIEWPORTS = 6;
const RENDER_EDGE_TOLERANCE = 64;
const SCROLL_IDLE_RENDER_MS = 180;
const INITIAL_CELL_TEXT_PREVIEW = 128;
const COLUMN_ROLES: Array<{ value: PlotWorkbookColumnRole; label: string }> = [
	{ value: 'text', label: '일반' },
	{ value: 'plot', label: '플롯' },
	{ value: 'character', label: '인물' },
	{ value: 'cast', label: '등장' },
	{ value: 'status', label: '상태' },
	{ value: 'date', label: '날짜' },
	{ value: 'foreshadow', label: '복선' },
	{ value: 'checklist', label: '체크리스트' },
];

interface AxisLayout {
	offsets: number[];
	sizes: number[];
	total: number;
}

interface ViewportArea { top: number; right: number; bottom: number; left: number }

interface SelectionBounds {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

type PlotSheetSelectionMode = 'cell' | 'row' | 'column' | 'headers';
export type PlotSheetStyleTarget = 'headers' | 'cells';
type PlotCellCopiedStyle = Pick<PlotWorkbookCellStyle, 'fontFamily' | 'fontSize' | 'color' | 'backgroundColor'>;

let copiedPlotCellStyle: PlotCellCopiedStyle | null = null;

interface StructureDragState {
	axis: 'row' | 'column';
	ids: string[];
}

export interface PlotSheetSelection {
	rowIndex: number;
	columnIndex: number;
}

interface PlotWorkbookFindMatch {
	rowId: string;
	columnId: string;
	from: number;
	to: number;
	replaceable: boolean;
}

interface SearchablePlotCell {
	rowId: string;
	columnId: string;
	haystack: string;
	metadata: string;
	replaceable: boolean;
}

export class InfinitePlotSheet {
	readonly element: HTMLElement;
	private viewport: HTMLElement;
	private canvas: HTMLElement;
	private cellsLayer: HTMLElement;
	private frozenColumnsCellsLayer: HTMLElement;
	private frozenRowsCellsLayer: HTMLElement;
	private frozenCornerCellsLayer: HTMLElement;
	private rowHeadersLayer: HTMLElement;
	private columnHeadersLayer: HTMLElement;
	private frozenRowHeadersLayer: HTMLElement;
	private frozenColumnHeadersLayer: HTMLElement;
	private corner: HTMLElement;
	private cornerStyleTarget: HTMLElement;
	private cornerStyleTargetThumb: HTMLElement;
	private readonly cornerStyleTargetButtons = new Map<PlotSheetStyleTarget, HTMLButtonElement>();
	private findBar: HTMLElement;
	private findInput: HTMLInputElement;
	private findCount: HTMLElement;
	private findReplaceInput: HTMLInputElement;
	private findMatches: PlotWorkbookFindMatch[] = [];
	private findMatchCellKeys = new Set<string>();
	private findMatchesByCell = new Map<string, PlotWorkbookFindMatch[]>();
	private searchContentNeedle = '';
	private activeFindMatch = -1;
	private selectionBox: HTMLElement;
	private fillHandle: HTMLElement;
	private fillPreviews: HTMLElement[];
	private resizeGuide: HTMLElement;
	private selected: PlotSheetSelection = { rowIndex: 0, columnIndex: 0 };
	private selectionAnchor: PlotSheetSelection = { rowIndex: 0, columnIndex: 0 };
	private selectionMode: PlotSheetSelectionMode = 'cell';
	private selectedRowIdsSet = new Set<string>();
	private selectedColumnIdsSet = new Set<string>();
	private selectedCellKeys = new Set<string>();
	private zoom = 1;
	private editingCell: HTMLTextAreaElement | HTMLInputElement | null = null;
	private editorSize: PlotWorkbookCellEditorSize | null = null;
	private selectedCellPreview: HTMLElement;
	private selectedCellPreviewContent: HTMLElement;
	private selectedCellPreviewSource: HTMLElement | null = null;
	private previewFillHandle: HTMLElement;
	private headerStyleTarget: PlotSheetStyleTarget = 'headers';
	private filterQuery = '';
	private filterMatchingRows: Set<string> | null = null;
	private searchIndexSheetId = '';
	private searchIndexLastSeq = -1;
	private searchIndex: SearchablePlotCell[] = [];
	private renderedArea: { top: number; right: number; bottom: number; left: number } | null = null;
	private lastScrollLeft = 0;
	private lastScrollTop = 0;
	private lastScrollSampleAt = 0;
	private scrollVelocityX = 0;
	private scrollVelocityY = 0;
	private scrollRenderRequestedAt = 0;
	private scrollRenderLatency = 16;
	private scrollIdleRenderTimer: number | null = null;
	private wheelScrollFrame: number | null = null;
	private pendingWheelX = 0;
	private pendingWheelY = 0;
	private autoScrollFrame: number | null = null;
	private autoScroll: { originX: number; originY: number; x: number; y: number; time: number } | null = null;
	private dragSource: PlotSheetSelection | null = null;
	private dragSourceCell: HTMLElement | null = null;
	private dragTargetCell: HTMLElement | null = null;
	private fillTarget: PlotSheetSelection | null = null;
	private fillPreviewBounds: SelectionBounds | null = null;
	private structureDrag: StructureDragState | null = null;
	private structureDragTarget: HTMLElement | null = null;
	private unsubscribe: (() => void) | null = null;
	private renderFrame: number | null = null;
	private renderRequiresFullRefresh = false;
	private expandingRows = false;
	private expandingColumns = false;
	private extendingForScroll = false;
	private layoutCache: {
		sheet: PlotWorkbookSheet;
		seq: number;
		focus: InfinitePlotSheet['temporaryColumnFocus'];
		rows: AxisLayout;
		columns: AxisLayout;
		columnOrder: string[];
		rowLabels: Map<string, string>;
	} | null = null;
	private headerSizePreview: { width: number; height: number } | null = null;
	private temporaryColumnFocus: {
		anchorColumnId: string;
		columnIds: string[];
		source: 'tracking' | 'cast';
	} | null = null;
	private readonly vaultRenameRef: EventRef;
	private readonly metadataChangedRef: EventRef;
	private readonly viewportResizeObserver: ResizeObserver;
	private viewportWidth = 0;
	private viewportHeight = 0;
	private frontmatterSyncTimer: number | null = null;
	private frontmatterSyncRunning = false;
	private frontmatterSyncPending = false;
	private syncedNotePaths = new Set<string>();
	private readonly syncedFrontmatterKeys = new Map<string, Set<string>>();
	private readonly profileImageCache = new Map<string, HTMLImageElement>();
	private readonly profileRasterCache = new Map<string, HTMLCanvasElement>();
	private readonly pendingCellText = new Map<HTMLElement, {
		content: HTMLElement; value: string; length: number; rowId: string; columnId: string;
	}>();
	private checklistPopover: PlotWorkbookChecklistPopover | null = null;

	constructor(
		parent: HTMLElement,
		private readonly plugin: WritingMenuPlugin,
		private readonly projectRoot: string,
		private readonly manuscriptFolder: string,
		private readonly characterFolder: string,
		private readonly session: PlotWorkbookSession,
		private readonly onSelectionChange?: (selection: PlotSheetSelection) => void,
		private readonly onRequestSearch?: (focusReplace: boolean) => void,
		private readonly onRequestRevealLocation?: (location: PlotWorkbookForeshadowLocation) => boolean | Promise<boolean>,
	) {
		this.element = parent.createDiv({ cls: 'wm-plotbook-sheet' });
		this.element.style.setProperty('--wm-plotbook-default-font-size', `${DEFAULT_PLOTBOOK_FONT_SIZE}px`);
		const findUi = this.renderFindBar();
		this.findBar = findUi.bar;
		this.findInput = findUi.input;
		this.findCount = findUi.count;
		this.findReplaceInput = findUi.replaceInput;
		this.viewport = this.element.createDiv({
			cls: 'wm-plotbook-grid-viewport',
			attr: { tabindex: '0', role: 'grid' },
		});
		this.canvas = this.viewport.createDiv({ cls: 'wm-plotbook-grid-canvas' });
		for (const event of ['pointerdown', 'dblclick', 'contextmenu', 'dragstart', 'dragover', 'drop', 'dragend']) {
			this.canvas.addEventListener(event, this.handleCellEvent);
		}
		this.cellsLayer = this.canvas.createDiv({ cls: 'wm-plotbook-cells-layer' });
		this.frozenColumnsCellsLayer = this.canvas.createDiv({ cls: 'wm-plotbook-frozen-columns-cells' });
		this.frozenRowsCellsLayer = this.canvas.createDiv({ cls: 'wm-plotbook-frozen-rows-cells' });
		this.frozenCornerCellsLayer = this.canvas.createDiv({ cls: 'wm-plotbook-frozen-corner-cells' });
		this.rowHeadersLayer = this.canvas.createDiv({ cls: 'wm-plotbook-row-headers' });
		this.columnHeadersLayer = this.canvas.createDiv({ cls: 'wm-plotbook-column-headers' });
		this.frozenRowHeadersLayer = this.canvas.createDiv({ cls: 'wm-plotbook-frozen-row-headers' });
		this.frozenColumnHeadersLayer = this.canvas.createDiv({ cls: 'wm-plotbook-frozen-column-headers' });
		this.corner = this.canvas.createDiv({ cls: 'wm-plotbook-grid-corner' });
		this.cornerStyleTarget = this.corner.createDiv({
			cls: 'wm-plotbook-corner-style-target is-hidden',
			attr: { role: 'group', 'aria-label': '행열 서식 적용 대상' },
		});
		this.cornerStyleTargetThumb = this.cornerStyleTarget.createDiv({ cls: 'wm-plotbook-corner-style-thumb' });
		for (const [target, label] of [['headers', '제목'], ['cells', '셀']] as const) {
			const button = this.cornerStyleTarget.createEl('button', {
				text: label,
				attr: { type: 'button', 'aria-pressed': 'false' },
			});
			this.cornerStyleTargetButtons.set(target, button);
			button.addEventListener('pointerdown', event => event.stopPropagation());
			button.addEventListener('click', event => {
				event.stopPropagation();
				this.setHeaderStyleTarget(target);
			});
		}
		const widthHandle = this.corner.createDiv({ cls: 'wm-plotbook-corner-resizer is-width' });
		const heightHandle = this.corner.createDiv({ cls: 'wm-plotbook-corner-resizer is-height' });
		widthHandle.addEventListener('pointerdown', event => this.beginHeaderResize(event, 'width'));
		heightHandle.addEventListener('pointerdown', event => this.beginHeaderResize(event, 'height'));
		widthHandle.addEventListener('dblclick', event => {
			event.stopPropagation();
			this.session.resizeHeaders(DEFAULT_ROW_HEADER_WIDTH, this.columnHeaderHeight(this.session.activeSheet));
		});
		heightHandle.addEventListener('dblclick', event => {
			event.stopPropagation();
			this.session.resizeHeaders(this.rowHeaderWidth(this.session.activeSheet), DEFAULT_COLUMN_HEADER_HEIGHT);
		});
		this.fillPreviews = Array.from({ length: 4 }, () =>
			this.canvas.createDiv({ cls: 'wm-plotbook-fill-preview is-hidden' }));
		this.resizeGuide = this.canvas.createDiv({ cls: 'wm-plotbook-resize-guide is-hidden' });
		this.selectedCellPreview = this.canvas.createDiv({
			cls: 'wm-plotbook-selected-cell-preview is-hidden',
			attr: { role: 'textbox', 'aria-readonly': 'true' },
		});
		this.selectedCellPreviewContent = this.selectedCellPreview.createDiv({
			cls: 'wm-plotbook-selected-cell-preview-content',
		});
		this.previewFillHandle = this.selectedCellPreview.createDiv({ cls: 'wm-plotbook-fill-handle' });
		this.previewFillHandle.addEventListener('pointerdown', event => this.beginFill(event));
		this.selectedCellPreview.addEventListener('click', event => {
			if ((event.target as Element | null)?.closest('.wm-plotbook-fill-handle')) return;
			const sheet = this.session.activeSheet;
			const rowId = sheet.rowOrder[this.selected.rowIndex];
			const columnId = this.columnOrder(sheet)[this.selected.columnIndex];
			const role = sheet.columns[columnId]?.role ?? 'text';
			const source = this.selectedCellPreviewSource;
			if (!rowId || !columnId || !source) return;
			if (role === 'status') this.openStatusMenu(event, rowId, columnId);
			else if (role === 'date') this.beginDateEditingCell(
				source, this.selected.rowIndex, this.selected.columnIndex,
				Boolean((event.target as Element | null)?.closest('.wm-plotbook-structured-chevron')),
			);
			else if (role === 'cast') {
				const avatar = (event.target as Element | null)?.closest('.wm-plotbook-profile-avatar');
				if (!avatar) return;
				const index = Array.from(this.selectedCellPreviewContent.querySelectorAll('.wm-plotbook-profile-avatar')).indexOf(avatar);
				source.querySelectorAll<HTMLButtonElement>('.wm-plotbook-profile-avatar')[index]?.click();
			}
		});
		this.selectedCellPreview.addEventListener('dblclick', event => {
			event.preventDefault();
			event.stopPropagation();
			if ((event.target as Element | null)?.closest('input, button, a, select, textarea')) return;
			const sheet = this.session.activeSheet;
			const rowId = sheet.rowOrder[this.selected.rowIndex];
			const columnId = this.columnOrder(sheet)[this.selected.columnIndex];
			const role = sheet.columns[columnId]?.role ?? 'text';
			const cell = this.selectedCellPreviewSource;
			if (!cell || !rowId || !columnId) return;
			if (role === 'checklist') this.openChecklistCell(cell, sheet, rowId, columnId);
			else if (role === 'foreshadow') this.openForeshadowModal(
				{ sheetId: sheet.sheetId, rowId, columnId },
				(event.target as Element | null)?.closest<HTMLElement>('[data-foreshadow-id]')?.dataset.foreshadowId,
			);
			else if (role !== 'status' && role !== 'date' && role !== 'cast') this.beginEditingCell(cell, this.selected.rowIndex, this.selected.columnIndex);
		});
		this.selectionBox = this.canvas.createDiv({ cls: 'wm-plotbook-selection-box' });
		this.fillHandle = this.selectionBox.createDiv({ cls: 'wm-plotbook-fill-handle' });
		this.fillHandle.addEventListener('pointerdown', event => this.beginFill(event));
		this.corner.addEventListener('pointerdown', event => {
			if (event.button !== 0 || (event.target as HTMLElement).closest('.wm-plotbook-corner-resizer')) return;
			event.preventDefault();
			this.selectHeaders();
			this.viewport.focus();
		});

		this.viewport.addEventListener('scroll', this.handleScroll);
		this.viewport.addEventListener('wheel', this.handleWheel, { passive: false });
		this.viewport.addEventListener('pointerdown', this.handleScrollPointerDown, true);
		this.viewport.addEventListener('keydown', this.handleKeyDown);
		this.viewport.addEventListener('copy', this.handleCopy);
		this.viewport.addEventListener('cut', this.handleCut);
		this.viewport.addEventListener('paste', this.handlePaste);
		this.vaultRenameRef = this.plugin.app.vault.on('rename', (file, oldPath) => {
			if (file instanceof TFile) this.session.relinkCharacterNote(oldPath, file.path);
		});
		this.metadataChangedRef = this.plugin.app.metadataCache.on('changed', file => {
			if (this.session.activeSheet.columnOrder.some(id =>
				this.session.activeSheet.columns[id]?.characterNotePath === file.path)) {
				this.searchIndexLastSeq = -1;
				if (this.findInput.value) this.refreshFindMatches(false);
				this.scheduleRender();
			}
		});
		this.syncedNotePaths = this.linkedNotePaths();
		this.unsubscribe = this.session.subscribe(() => {
			// Registry/profile changes need not increment the sheet operation sequence.
			this.searchIndexLastSeq = -1;
			if (this.findInput.value) this.refreshFindMatches(false);
			this.scheduleRender(this.extendingForScroll);
			this.scheduleFrontmatterSync();
		});
		this.viewportResizeObserver = new ResizeObserver(() => {
			const width = this.viewport.clientWidth;
			const height = this.viewport.clientHeight;
			if (width === this.viewportWidth && height === this.viewportHeight) return;
			this.viewportWidth = width;
			this.viewportHeight = height;
			if (width > 0 && height > 0) this.scheduleRender(true);
		});
		this.viewportResizeObserver.observe(this.viewport);
		this.render();
		this.lastScrollLeft = this.logicalScrollLeft();
		this.lastScrollTop = this.logicalScrollTop();
		this.lastScrollSampleAt = this.scrollClock();
		this.scheduleFrontmatterSync();
	}

	commitEditing(): void { this.editingCell?.blur(); }

	private renderFindBar(): {
		bar: HTMLElement;
		input: HTMLInputElement;
		count: HTMLElement;
		replaceInput: HTMLInputElement;
	} {
		const bar = this.element.createDiv({
			cls: 'wm-paged-findbar wm-plotbook-findbar',
			attr: { role: 'search', 'aria-label': '플롯에서 찾기 및 바꾸기' },
		});
		bar.hidden = true;
		const findRow = bar.createDiv({ cls: 'wm-paged-find-row is-find' });
		const icon = findRow.createSpan({ cls: 'wm-paged-find-icon', attr: { 'aria-hidden': 'true' } });
		setIcon(icon, 'search');
		const input = findRow.createEl('input', {
			type: 'search',
			placeholder: '플롯에서 찾기',
			attr: { autocomplete: 'off', spellcheck: 'false' },
		});
		const count = findRow.createSpan({ cls: 'wm-paged-find-count', text: '0/0', attr: { 'aria-live': 'polite' } });
		const previous = findRow.createEl('button', {
			cls: 'wm-paged-find-action clickable-icon',
			attr: { type: 'button', 'aria-label': '이전 검색 결과' },
		});
		setIcon(previous, 'chevron-up');
		const next = findRow.createEl('button', {
			cls: 'wm-paged-find-action clickable-icon',
			attr: { type: 'button', 'aria-label': '다음 검색 결과' },
		});
		setIcon(next, 'chevron-down');
		const close = findRow.createEl('button', {
			cls: 'wm-paged-find-action clickable-icon',
			attr: { type: 'button', 'aria-label': '검색 닫기' },
		});
		setIcon(close, 'x');

		const replaceRow = bar.createDiv({ cls: 'wm-paged-find-row is-replace' });
		const replaceIcon = replaceRow.createSpan({ cls: 'wm-paged-find-icon', attr: { 'aria-hidden': 'true' } });
		setIcon(replaceIcon, 'replace');
		const replaceInput = replaceRow.createEl('input', {
			type: 'text',
			placeholder: '바꿀 내용',
			attr: { autocomplete: 'off', spellcheck: 'false' },
		});
		const replaceOne = replaceRow.createEl('button', {
			cls: 'wm-paged-find-replace-button',
			text: '바꾸기',
			attr: { type: 'button' },
		});
		const replaceAll = replaceRow.createEl('button', {
			cls: 'wm-paged-find-replace-button',
			text: '모두',
			attr: { type: 'button', 'aria-label': '모두 바꾸기' },
		});
		for (const field of [input, replaceInput]) {
			field.addEventListener('keydown', event => event.stopPropagation());
		}
		input.addEventListener('input', () => this.refreshFindMatches(true));
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.navigateFindMatch(event.shiftKey ? -1 : 1);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				this.closeFindBar();
			}
		});
		replaceInput.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.replaceCurrentFindMatch();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				this.closeFindBar();
			}
		});
		previous.addEventListener('click', () => this.navigateFindMatch(-1));
		next.addEventListener('click', () => this.navigateFindMatch(1));
		close.addEventListener('click', () => this.closeFindBar());
		replaceOne.addEventListener('click', () => this.replaceCurrentFindMatch());
		replaceAll.addEventListener('click', () => this.replaceAllFindMatches());
		return { bar, input, count, replaceInput };
	}

	private openFindBar(focusReplace = false): void {
		const sheet = this.session.activeSheet;
		const rowId = sheet.rowOrder[this.selected.rowIndex];
		const columnId = this.columnOrder(sheet)[this.selected.columnIndex];
		const selectedValue = rowId && columnId ? this.session.getCell(sheet, rowId, columnId) : '';
		if (selectedValue && selectedValue.length <= 200 && !selectedValue.includes('\n')) this.findInput.value = selectedValue;
		this.findBar.hidden = false;
		this.refreshFindMatches(true);
		window.setTimeout(() => {
			const input = focusReplace ? this.findReplaceInput : this.findInput;
			input.focus();
			input.select();
		}, 0);
	}

	private closeFindBar(): void {
		this.findBar.hidden = true;
		this.findInput.value = '';
		this.filterQuery = '';
		this.filterMatchingRows = null;
		this.findMatches = [];
		this.findMatchCellKeys.clear();
		this.findMatchesByCell.clear();
		this.searchContentNeedle = '';
		this.activeFindMatch = -1;
		this.element.removeClass('is-searching');
		this.updateFindCount();
		this.syncRenderedSearchState();
		this.viewport.focus();
	}

	private refreshFindMatches(reveal: boolean): void {
		const sheet = this.session.activeSheet;
		this.filterQuery = this.findInput.value;
		const query = parsePlotWorkbookSearch(this.findInput.value);
		const needle = query.text.toLocaleLowerCase('ko-KR');
		const rowLabels = this.buildRowLabels(sheet);
		const columns = sheet.columns;
		const matches: PlotWorkbookFindMatch[] = [];
		const matchingRows = new Set<string>();
		const matchingCells = new Set<string>();
		const matchesByCell = new Map<string, PlotWorkbookFindMatch[]>();
		const hasQuery = Boolean(this.findInput.value.trim());
		const columnSelector = query.column.toLocaleLowerCase('ko-KR');
		const columnIsLetter = /^[a-z]+$/i.test(columnSelector)
			&& sheet.columnOrder.some((_id, index) => columnLabel(index).toLocaleLowerCase('ko-KR') === columnSelector);
		if (hasQuery) {
			for (const entry of this.searchableCellIndex(sheet)) {
				const rowLabel = (rowLabels.get(entry.rowId) ?? '').toLocaleLowerCase('ko-KR');
				const column = columns[entry.columnId];
				const columnTitle = (column?.title || columnLabel(sheet.columnOrder.indexOf(entry.columnId)))
					.toLocaleLowerCase('ko-KR');
				if (query.row && rowLabel !== query.row.toLocaleLowerCase('ko-KR')) continue;
				const role = column?.role ?? 'text';
				const roleName = COLUMN_ROLES.find(item => item.value === role)?.label ?? '';
				const letter = columnLabel(sheet.columnOrder.indexOf(entry.columnId)).toLocaleLowerCase('ko-KR');
				if (columnIsLetter && columnSelector !== letter) continue;
				if (!columnIsLetter && columnSelector && !(columnSelector === role || columnSelector === roleName
					|| columnTitle.includes(columnSelector)
					|| (role === 'character' && this.characterProfile(sheet, entry.columnId).name.toLocaleLowerCase('ko-KR').includes(columnSelector)))) continue;
				const cellKey = this.cellKey(entry.rowId, entry.columnId);
				if (!needle || (!entry.haystack.includes(needle) && entry.metadata.includes(needle))) {
					const match = { rowId: entry.rowId, columnId: entry.columnId, from: 0, to: 0, replaceable: false };
					matches.push(match);
					matchesByCell.set(cellKey, [match]);
					matchingRows.add(entry.rowId);
					matchingCells.add(cellKey);
					continue;
				}
				let offset = 0;
				while (offset <= entry.haystack.length - needle.length) {
					const found = entry.haystack.indexOf(needle, offset);
					if (found < 0) break;
					const match = {
						rowId: entry.rowId,
						columnId: entry.columnId,
						from: found,
						to: found + needle.length,
						replaceable: entry.replaceable,
					};
					matches.push(match);
					const cellMatches = matchesByCell.get(cellKey) ?? [];
					cellMatches.push(match);
					matchesByCell.set(cellKey, cellMatches);
					matchingRows.add(entry.rowId);
					matchingCells.add(cellKey);
					offset = found + needle.length;
				}
			}
		}
		const previous = this.findMatches[this.activeFindMatch];
		this.findMatches = matches;
		this.activeFindMatch = matches.length === 0 ? -1 : Math.max(0, previous
			? matches.findIndex(match => match.rowId === previous.rowId && match.columnId === previous.columnId
				&& match.from >= previous.from)
			: 0);
		this.findMatchCellKeys = matchingCells;
		this.findMatchesByCell = matchesByCell;
		this.searchContentNeedle = needle;
		this.filterMatchingRows = hasQuery ? matchingRows : null;
		this.element.toggleClass('is-searching', hasQuery);
		this.updateFindCount();
		this.syncRenderedSearchState();
		if (hasQuery) this.clearSelectionPreview();
		else this.refreshSelectionPreview();
		if (reveal && this.activeFindMatch >= 0) this.revealActiveFindMatch();
	}

	private updateFindCount(): void {
		this.findCount.setText(`${this.activeFindMatch >= 0 ? this.activeFindMatch + 1 : 0}/${this.findMatches.length}`);
	}

	private navigateFindMatch(delta: number): void {
		if (this.findMatches.length === 0) return;
		this.activeFindMatch = this.activeFindMatch < 0
			? (delta < 0 ? this.findMatches.length - 1 : 0)
			: (this.activeFindMatch + delta + this.findMatches.length) % this.findMatches.length;
		this.updateFindCount();
		this.syncRenderedSearchState();
		this.revealActiveFindMatch();
		if (!this.findBar.hidden) this.findInput.focus();
	}

	private revealActiveFindMatch(): void {
		const match = this.findMatches[this.activeFindMatch];
		if (!match) return;
		const sheet = this.session.activeSheet;
		const rowIndex = sheet.rowOrder.indexOf(match.rowId);
		const columnIndex = this.columnOrder(sheet).indexOf(match.columnId);
		if (rowIndex < 0 || columnIndex < 0) return;
		this.select(rowIndex, columnIndex, false);
		this.revealSelection(true);
		this.scheduleRender(true);
		// Search navigation follows the same selection path as pointer/keyboard
		// selection. Refresh explicitly as the result may already be selected and
		// therefore would not trigger select()'s changed branch.
		this.refreshSelectionPreview();
	}

	private replaceCurrentFindMatch(): void {
		if (!this.searchContentNeedle) return;
		const match = this.findMatches[this.activeFindMatch];
		if (!match?.replaceable) return;
		const sheet = this.session.activeSheet;
		const value = this.session.getCell(sheet, match.rowId, match.columnId);
		this.session.setCell(match.rowId, match.columnId,
			`${value.slice(0, match.from)}${this.findReplaceInput.value}${value.slice(match.to)}`);
		this.refreshFindMatches(true);
		if (!this.findBar.hidden) this.findReplaceInput.focus();
	}

	private replaceAllFindMatches(): void {
		if (!this.searchContentNeedle || this.findMatches.length === 0) return;
		const sheet = this.session.activeSheet;
		const grouped = new Map<string, PlotWorkbookFindMatch[]>();
		for (const match of this.findMatches) {
			if (!match.replaceable) continue;
			const key = `${match.rowId}\u0000${match.columnId}`;
			const group = grouped.get(key) ?? [];
			group.push(match);
			grouped.set(key, group);
		}
		const updates: Array<{ rowId: string; columnId: string; value: string }> = [];
		for (const matches of grouped.values()) {
			const first = matches[0];
			let value = this.session.getCell(sheet, first.rowId, first.columnId);
			for (const match of [...matches].sort((left, right) => right.from - left.from)) {
				value = `${value.slice(0, match.from)}${this.findReplaceInput.value}${value.slice(match.to)}`;
			}
			updates.push({ rowId: first.rowId, columnId: first.columnId, value });
		}
		this.session.setCells(updates);
		this.refreshFindMatches(true);
		if (!this.findBar.hidden) this.findReplaceInput.focus();
	}

	destroy(): void {
		this.editorSize?.destroy();
		this.editorSize = null;
		this.checklistPopover?.close();
		this.viewportResizeObserver.disconnect();
		this.cancelWheelScroll();
		this.stopAutoScroll();
		if (this.renderFrame !== null) window.cancelAnimationFrame(this.renderFrame);
		if (this.scrollIdleRenderTimer !== null) window.clearTimeout(this.scrollIdleRenderTimer);
		this.clearSelectionPreview();
		if (this.frontmatterSyncTimer !== null) {
			window.clearTimeout(this.frontmatterSyncTimer);
			this.frontmatterSyncTimer = null;
			void this.syncLinkedNotes();
		}
		this.viewport.removeEventListener('scroll', this.handleScroll);
		this.viewport.removeEventListener('wheel', this.handleWheel);
		this.viewport.removeEventListener('pointerdown', this.handleScrollPointerDown, true);
		this.viewport.removeEventListener('keydown', this.handleKeyDown);
		this.viewport.removeEventListener('copy', this.handleCopy);
		this.viewport.removeEventListener('cut', this.handleCut);
		this.viewport.removeEventListener('paste', this.handlePaste);
		for (const event of ['pointerdown', 'dblclick', 'contextmenu', 'dragstart', 'dragover', 'drop', 'dragend']) {
			this.canvas.removeEventListener(event, this.handleCellEvent);
		}
		this.plugin.app.vault.offref(this.vaultRenameRef);
		this.plugin.app.metadataCache.offref(this.metadataChangedRef);
		this.profileImageCache.clear();
		this.profileRasterCache.clear();
		this.pendingCellText.clear();
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	private scheduleFrontmatterSync(): void {
		if (this.frontmatterSyncTimer !== null) window.clearTimeout(this.frontmatterSyncTimer);
		this.frontmatterSyncTimer = window.setTimeout(() => {
			this.frontmatterSyncTimer = null;
			void this.syncLinkedNotes();
		}, 250);
	}

	private linkedNotePaths(): Set<string> {
		const paths = new Set<string>();
		for (const sheet of this.session.sheets.values()) {
			for (const rowId of sheet.rowOrder) {
				const row = sheet.rows[rowId];
				if (!row?.parentRowId && row?.linkedNotePath) paths.add(row.linkedNotePath);
			}
		}
		return paths;
	}

	private async syncLinkedNotes(): Promise<void> {
		if (this.frontmatterSyncRunning) {
			this.frontmatterSyncPending = true;
			return;
		}
		this.frontmatterSyncRunning = true;
		try {
			const currentPaths = this.linkedNotePaths();
			for (const oldPath of this.syncedNotePaths) {
				if (currentPaths.has(oldPath)) continue;
				const oldFile = this.plugin.app.vault.getAbstractFileByPath(oldPath);
				if (!(oldFile instanceof TFile)) continue;
				const propertyKeys = new Set(['등장', '상태', '날짜', ...(this.syncedFrontmatterKeys.get(oldPath) ?? [])]);
				const cached = this.plugin.app.metadataCache.getFileCache(oldFile)?.frontmatter;
				if (!cached || (!Object.prototype.hasOwnProperty.call(cached, 'writing_menu_plot')
					&& ![...propertyKeys].some(key => Object.prototype.hasOwnProperty.call(cached, key)))) continue;
				await this.plugin.app.fileManager.processFrontMatter(oldFile, frontmatter => {
					delete frontmatter.writing_menu_plot;
					for (const key of propertyKeys) delete frontmatter[key];
				});
				this.syncedFrontmatterKeys.delete(oldPath);
			}

			for (const sheet of this.session.sheets.values()) {
				const rowLabels = this.buildRowLabels(sheet);
				for (const rowId of sheet.rowOrder) {
					const row = sheet.rows[rowId];
					if (!row || row.parentRowId || !row.linkedNotePath) continue;
					const file = this.plugin.app.vault.getAbstractFileByPath(row.linkedNotePath);
					if (!(file instanceof TFile)) continue;
					const payload = this.buildRowFrontmatter(sheet, rowId, rowLabels);
					const properties = this.rowFrontmatterProperties(payload);
					const propertyKeys = new Set([
						'등장',
						'상태',
						'날짜',
						...(this.syncedFrontmatterKeys.get(file.path) ?? []),
						...Object.keys(properties),
					]);
					const cachedFrontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
					const cachedProperties = Object.fromEntries([...propertyKeys]
						.filter(key => Object.prototype.hasOwnProperty.call(cachedFrontmatter, key))
						.map(key => [key, cachedFrontmatter[key]]));
					const unchanged = !Object.prototype.hasOwnProperty.call(cachedFrontmatter, 'writing_menu_plot')
						&& JSON.stringify(cachedProperties) === JSON.stringify(properties);
					this.syncedFrontmatterKeys.set(file.path, new Set(Object.keys(properties)));
					if (unchanged) continue;
					await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
						delete frontmatter.writing_menu_plot;
						for (const key of propertyKeys) delete frontmatter[key];
						Object.assign(frontmatter, properties);
					});
				}
			}
			this.syncedNotePaths = currentPaths;
		} catch (error) {
			new Notice(`플롯 정보를 본문 노트에 기록하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.frontmatterSyncRunning = false;
			if (this.frontmatterSyncPending) {
				this.frontmatterSyncPending = false;
				this.scheduleFrontmatterSync();
			}
		}
	}

	private rowFrontmatterProperties(payload: Record<string, unknown>): Record<string, unknown> {
		const appearances = Array.isArray(payload.appearances)
			? [...new Set(payload.appearances.filter((value): value is string => typeof value === 'string' && value.length > 0))]
			: [];
		const statuses = Array.isArray(payload.statuses)
			? [...new Set(payload.statuses.flatMap(item => {
				if (!item || typeof item !== 'object') return [];
				const value = (item as { value?: unknown }).value;
				return typeof value === 'string' && value ? [value] : [];
			}))]
			: [];
		const properties: Record<string, unknown> = {};
		if (appearances.length > 0) properties['등장'] = appearances;
		if (statuses.length === 1) properties['상태'] = statuses[0];
		else if (statuses.length > 1) properties['상태'] = statuses;
		const datesByField = new Map<string, string[]>();
		if (Array.isArray(payload.dates)) {
			for (const item of payload.dates) {
				if (!item || typeof item !== 'object') continue;
				const field = (item as { field?: unknown }).field;
				const value = (item as { value?: unknown }).value;
				if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
				const requestedKey = typeof field === 'string' ? field.trim() : '';
				const key = requestedKey && requestedKey !== '등장' && requestedKey !== '상태'
					? requestedKey
					: '날짜';
				const values = datesByField.get(key) ?? [];
				if (!values.includes(value)) values.push(value);
				datesByField.set(key, values);
			}
		}
		for (const [key, values] of datesByField) {
			properties[key] = values.length === 1 ? values[0] : values;
		}
		return properties;
	}

	private buildRowFrontmatter(
		sheet: PlotWorkbookSheet,
		rowId: string,
		rowLabels: Map<string, string>,
	): Record<string, unknown> {
		const relatedRows = [rowId, ...sheet.rowOrder.filter(id => sheet.rows[id]?.parentRowId === rowId)];
		const appearancePaths: string[] = [];
		for (const columnId of sheet.columnOrder) {
			if (sheet.columns[columnId]?.role !== 'cast') continue;
			for (const path of this.session.getAppearancePaths(sheet, rowId, columnId)) {
				if (!appearancePaths.includes(path)) appearancePaths.push(path);
			}
		}
		const characters = sheet.columnOrder.flatMap(columnId => {
			const column = sheet.columns[columnId];
			if (column?.role !== 'character' || !column.characterNotePath) return [];
			const entries = relatedRows.flatMap(targetRowId => {
				const value = this.session.getCell(sheet, targetRowId, columnId).trim();
				return value ? [{ segment: rowLabels.get(targetRowId) ?? '', value }] : [];
			});
			if (entries.length === 0 && !appearancePaths.includes(column.characterNotePath)) return [];
			return [{
				note: this.noteLink(column.characterNotePath),
				name: this.characterProfile(sheet, columnId).name,
				entries,
			}];
		});
		const statuses = sheet.columnOrder.flatMap((columnId, index) => {
			const column = sheet.columns[columnId];
			if (column?.role !== 'status') return [];
			const value = this.session.getCell(sheet, rowId, columnId);
			return value ? [{ field: column.title || columnLabel(index), value: this.session.statusName(value) }] : [];
		});
		const dates = sheet.columnOrder.flatMap((columnId, index) => {
			const column = sheet.columns[columnId];
			if (column?.role !== 'date') return [];
			const value = this.session.getCell(sheet, rowId, columnId);
			return value ? [{ field: column.title || columnLabel(index), value }] : [];
		});
		return {
			sheet: sheet.name,
			sheet_id: sheet.sheetId,
			row: rowLabels.get(rowId) ?? '',
			row_id: rowId,
			characters,
			appearances: appearancePaths.map(path => this.noteLink(path)),
			statuses,
			dates,
		};
	}

	private noteLink(path: string): string {
		const cleanPath = path.replace(/\.md$/i, '');
		if (this.plugin.settings.plotCharacterLinkFormat === 'markdown') {
			const name = cleanPath.split('/').pop() || cleanPath;
			return `[${name.replace(/\]/g, '\\]')}](<${path.replace(/>/g, '%3E')}>)`;
		}
		return `[[${cleanPath}]]`;
	}

	private columnOrder(sheet: PlotWorkbookSheet): string[] {
		const base = sheet.columnOrder;
		const focus = this.temporaryColumnFocus;
		if (!focus || !base.includes(focus.anchorColumnId)) return base;
		if (focus.source === 'tracking'
			&& sheet.columns[focus.anchorColumnId]?.trackingEnabled !== true) return base;
		const focused = base.filter(id => focus.columnIds.includes(id) && id !== focus.anchorColumnId);
		if (focused.length === 0) return base;
		const remaining = base.filter(id => !focused.includes(id));
		const anchorIndex = remaining.indexOf(focus.anchorColumnId);
		return [...remaining.slice(0, anchorIndex + 1), ...focused, ...remaining.slice(anchorIndex + 1)];
	}

	select(rowIndex: number, columnIndex: number, reveal = true, extend = false, toggle = false): void {
		const sheet = this.session.activeSheet;
		const beforeOrder = this.columnOrder(sheet);
		const previousMode = this.selectionMode;
		const hadCellKeys = this.selectedCellKeys.size > 0;
		const seedTargets = toggle && previousMode === 'cell' ? this.selectedCellTargets(true) : [];
		this.selectionMode = 'cell';
		this.selectedRowIdsSet.clear();
		this.selectedColumnIdsSet.clear();
		if (!toggle) this.selectedCellKeys.clear();
		const previousAnchor = this.selectionAnchor;
		const requested = {
			rowIndex: Math.max(0, Math.min(sheet.rowOrder.length - 1, rowIndex)),
			columnIndex: Math.max(0, Math.min(beforeOrder.length - 1, columnIndex)),
		};
		const selectedColumnId = beforeOrder[requested.columnIndex];
		const focusChanged = !extend && !toggle
			&& this.updateTemporaryFocusForSelection(sheet.rowOrder[requested.rowIndex], selectedColumnId);
		const afterOrder = this.columnOrder(sheet);
		const next = {
			rowIndex: requested.rowIndex,
			columnIndex: Math.max(0, afterOrder.indexOf(selectedColumnId)),
		};
		if (toggle) {
			if (this.selectedCellKeys.size === 0) {
				for (const target of seedTargets) this.selectedCellKeys.add(this.cellKey(target.rowId, target.columnId));
			}
			const rowId = sheet.rowOrder[next.rowIndex];
			const columnId = afterOrder[next.columnIndex];
			const key = this.cellKey(rowId, columnId);
			if (this.selectedCellKeys.has(key)) this.selectedCellKeys.delete(key);
			else this.selectedCellKeys.add(key);
			if (this.selectedCellKeys.size === 0) this.selectedCellKeys.add(key);
			this.selectionAnchor = next;
		} else if (!extend) this.selectionAnchor = next;
		const changed = previousMode !== this.selectionMode
			|| toggle
			|| next.rowIndex !== this.selected.rowIndex
			|| next.columnIndex !== this.selected.columnIndex
			|| previousAnchor.rowIndex !== this.selectionAnchor.rowIndex
			|| previousAnchor.columnIndex !== this.selectionAnchor.columnIndex;
		this.selected = next;
		if (reveal) this.revealSelection();
		if (changed) {
			this.refreshSelectionBox();
			if (focusChanged) this.clearSelectionPreview();
			else this.refreshSelectionPreview();
			if (previousMode !== this.selectionMode || toggle || hadCellKeys) this.scheduleRender();
			this.onSelectionChange?.(this.selected);
		}
		if (focusChanged) this.scheduleRender();
	}

	private updateTemporaryFocusForSelection(rowId: string, columnId: string): boolean {
		const sheet = this.session.activeSheet;
		const currentFocus = this.temporaryColumnFocus;
		// A cast-card focus is a small temporary workspace. Keep it while the user
		// edits or rearranges the cast column and its tracked character columns.
		if (currentFocus?.source === 'cast'
			&& (columnId === currentFocus.anchorColumnId || currentFocus.columnIds.includes(columnId))) {
			return false;
		}
		const anchorIndex = sheet.columnOrder.indexOf(columnId);
		if (anchorIndex < 0 || sheet.columns[columnId]?.trackingEnabled !== true) {
			return this.setTemporaryColumnFocus(null);
		}
		const related = sheet.columnOrder.slice(anchorIndex + 1).filter(candidate => {
			if (sheet.columns[candidate]?.role === 'cast') return false;
			return this.cellHasTrackableContent(sheet, rowId, candidate);
		});
		return this.setTemporaryColumnFocus({
			anchorColumnId: columnId,
			columnIds: related,
			source: 'tracking',
		});
	}

	private cellHasTrackableContent(sheet: PlotWorkbookSheet, rowId: string, columnId: string): boolean {
		if (sheet.columns[columnId]?.role === 'foreshadow') {
			return this.session.foreshadowsInRow(sheet.sheetId, rowId).length > 0;
		}
		return this.session.getCell(sheet, rowId, columnId).trim().length > 0;
	}

	private setTemporaryColumnFocus(focus: {
		anchorColumnId: string;
		columnIds: string[];
		source: 'tracking' | 'cast';
	} | null): boolean {
		const previous = this.temporaryColumnFocus;
		const unchanged = previous?.anchorColumnId === focus?.anchorColumnId
			&& previous?.source === focus?.source
			&& (previous?.columnIds.join('\u0000') ?? '') === (focus?.columnIds.join('\u0000') ?? '');
		if (unchanged) return false;
		this.temporaryColumnFocus = focus;
		return true;
	}

	private selectWholeRow(rowIndex: number, extend = false, toggle = false): void {
		const sheet = this.session.activeSheet;
		const nextRow = Math.max(0, Math.min(sheet.rowOrder.length - 1, rowIndex));
		const rowId = sheet.rowOrder[nextRow];
		if (!rowId) return;
		if (toggle) {
			if (this.selectionMode !== 'row') this.selectedRowIdsSet.clear();
			if (this.selectedRowIdsSet.has(rowId)) this.selectedRowIdsSet.delete(rowId);
			else this.selectedRowIdsSet.add(rowId);
			if (this.selectedRowIdsSet.size === 0) this.selectedRowIdsSet.add(rowId);
			this.selectionAnchor = { rowIndex: nextRow, columnIndex: this.selected.columnIndex };
		} else if (extend) {
			const anchor = this.selectionMode === 'row' ? this.selectionAnchor.rowIndex : this.selected.rowIndex;
			const from = Math.min(anchor, nextRow);
			const to = Math.max(anchor, nextRow);
			this.selectedRowIdsSet = new Set(sheet.rowOrder.slice(from, to + 1));
			if (this.selectionMode !== 'row') {
				this.selectionAnchor = { rowIndex: anchor, columnIndex: this.selected.columnIndex };
			}
		} else {
			this.selectedRowIdsSet = new Set([rowId]);
			this.selectionAnchor = { rowIndex: nextRow, columnIndex: this.selected.columnIndex };
		}
		this.selectedColumnIdsSet.clear();
		this.selectedCellKeys.clear();
		this.selected = { rowIndex: nextRow, columnIndex: this.selected.columnIndex };
		this.selectionMode = 'row';
		this.revealSelection();
		this.refreshSelectionBox();
		this.scheduleRender();
		this.onSelectionChange?.(this.selected);
	}

	private selectWholeColumn(columnIndex: number, extend = false, toggle = false): void {
		const sheet = this.session.activeSheet;
		const order = this.columnOrder(sheet);
		const nextColumn = Math.max(0, Math.min(order.length - 1, columnIndex));
		const columnId = order[nextColumn];
		if (!columnId) return;
		if (toggle) {
			if (this.selectionMode !== 'column') this.selectedColumnIdsSet.clear();
			if (this.selectedColumnIdsSet.has(columnId)) this.selectedColumnIdsSet.delete(columnId);
			else this.selectedColumnIdsSet.add(columnId);
			if (this.selectedColumnIdsSet.size === 0) this.selectedColumnIdsSet.add(columnId);
			this.selectionAnchor = { rowIndex: this.selected.rowIndex, columnIndex: nextColumn };
		} else if (extend) {
			const anchor = this.selectionMode === 'column' ? this.selectionAnchor.columnIndex : this.selected.columnIndex;
			const from = Math.min(anchor, nextColumn);
			const to = Math.max(anchor, nextColumn);
			this.selectedColumnIdsSet = new Set(order.slice(from, to + 1));
			if (this.selectionMode !== 'column') {
				this.selectionAnchor = { rowIndex: this.selected.rowIndex, columnIndex: anchor };
			}
		} else {
			this.selectedColumnIdsSet = new Set([columnId]);
			this.selectionAnchor = { rowIndex: this.selected.rowIndex, columnIndex: nextColumn };
		}
		this.selectedRowIdsSet.clear();
		this.selectedCellKeys.clear();
		this.selected = { rowIndex: this.selected.rowIndex, columnIndex: nextColumn };
		this.selectionMode = 'column';
		this.revealSelection();
		this.refreshSelectionBox();
		this.scheduleRender();
		this.onSelectionChange?.(this.selected);
	}

	private selectHeaders(): void {
		this.selectionMode = 'headers';
		this.selectedRowIdsSet.clear();
		this.selectedColumnIdsSet.clear();
		this.selectedCellKeys.clear();
		this.selectionAnchor = { rowIndex: 0, columnIndex: 0 };
		this.selected = { rowIndex: 0, columnIndex: 0 };
		this.refreshSelectionBox();
		this.scheduleRender();
		this.onSelectionChange?.(this.selected);
	}

	focus(): void {
		this.viewport.focus();
	}

	revealSelected(center = true): void {
		this.revealSelection(center);
		this.scheduleRender(true);
	}

	getZoom(): number {
		return this.zoom;
	}

	setZoom(value: number): void {
		const next = Math.max(0.5, Math.min(2, Math.round(value * 10) / 10));
		if (next === this.zoom) return;
		const logicalLeft = this.logicalScrollLeft();
		const logicalTop = this.logicalScrollTop();
		this.zoom = next;
		this.canvas.style.setProperty('zoom', String(next));
		this.viewport.scrollLeft = logicalLeft * next;
		this.viewport.scrollTop = logicalTop * next;
		this.scheduleRender();
		this.onSelectionChange?.(this.selected);
	}

	openFindReplace(focusReplace = false): void {
		if (this.onRequestSearch) this.onRequestSearch(focusReplace);
		else this.openFindBar(focusReplace);
	}

	setSearchQuery(query: string, reveal = true): void {
		this.findInput.value = query;
		this.filterQuery = query;
		this.refreshFindMatches(reveal);
	}

	getSearchQuery(): string {
		return this.findInput.value;
	}

	getSearchSummary(): { current: number; matches: number; rows: number; totalRows: number } {
		const rows = this.getFilterMatchSummary();
		return {
			current: this.activeFindMatch >= 0 ? this.activeFindMatch + 1 : 0,
			matches: this.findMatches.length,
			rows: rows.matching,
			totalRows: rows.total,
		};
	}

	navigateSearch(delta: number): void {
		this.navigateFindMatch(delta);
	}

	replaceCurrentSearch(value: string): void {
		this.findReplaceInput.value = value;
		this.replaceCurrentFindMatch();
	}

	replaceAllSearch(value: string): void {
		this.findReplaceInput.value = value;
		this.replaceAllFindMatches();
	}

	hasHeaderSelection(): boolean {
		return this.selectionMode !== 'cell';
	}

	getHeaderStyleTarget(): PlotSheetStyleTarget {
		return this.headerStyleTarget;
	}

	setHeaderStyleTarget(target: PlotSheetStyleTarget): void {
		this.headerStyleTarget = target;
		this.refreshCornerStyleTarget();
		this.onSelectionChange?.(this.selected);
		this.focus();
	}

	getFilterQuery(): string {
		return this.filterQuery;
	}

	setFilterQuery(query: string): void {
		this.setSearchQuery(query, false);
	}

	getFilterMatchSummary(): { matching: number; total: number } {
		const sheet = this.session.activeSheet;
		return {
			matching: this.filterMatchingRows?.size ?? sheet.rowOrder.length,
			total: sheet.rowOrder.length,
		};
	}

	getSelectedLocation(): PlotWorkbookForeshadowLocation {
		const sheet = this.session.activeSheet;
		return {sheetId:sheet.sheetId,rowId:sheet.rowOrder[this.selected.rowIndex],columnId:this.columnOrder(sheet)[this.selected.columnIndex]};
	}

	/** Read the chosen scene rows without exposing mutable sheet internals. */
	getSelectedSceneRows(): string[] {
		const sheet = this.session.activeSheet;
		if (this.selectionMode === 'row') return sheet.rowOrder.filter(id => this.selectedRowIdsSet.has(id));
		if (this.selectionMode !== 'cell') return [sheet.rowOrder[this.selected.rowIndex]].filter(Boolean);
		if (this.selectedCellKeys.size) return [...new Set([...this.selectedCellKeys].map(key => this.cellIdsFromKey(key)[0]))].filter(id => Boolean(sheet.rows[id]));
		const bounds = this.selectionBounds(); return sheet.rowOrder.slice(bounds.top, bounds.bottom + 1);
	}

	getSelectionStyle(): PlotWorkbookCellStyle {
		if (this.selectionMode !== 'cell' && this.headerStyleTarget === 'headers') {
			const { rowIds, columnIds } = this.selectedHeaderIds();
			return this.commonStyle([
				...rowIds.map(rowId => this.headerDisplayStyle('row', this.session.getRowHeaderStyle(rowId))),
				...columnIds.map(columnId => this.headerDisplayStyle('column', this.session.getColumnHeaderStyle(columnId))),
			]);
		}
		const targets = this.selectedCellTargets(true);
		if (targets.length === 0) return {};
		const sheet = this.session.activeSheet;
		return this.commonStyle(targets.map(target =>
			this.session.getCellStyle(sheet, target.rowId, target.columnId)));
	}

	private commonStyle(styles: PlotWorkbookCellStyle[]): PlotWorkbookCellStyle {
		if (styles.length === 0) return {};
		const common: PlotWorkbookCellStyle = { ...styles[0] };
		for (const style of styles.slice(1)) {
			for (const key of Object.keys(common) as Array<keyof PlotWorkbookCellStyle>) {
				const left = common[key];
				const right = style[key];
				const equal = typeof left === 'object' && left !== null && typeof right === 'object' && right !== null
					? JSON.stringify(left) === JSON.stringify(right)
					: left === right;
				if (!equal) delete common[key];
			}
			if (Object.keys(common).length === 0) break;
		}
		return common;
	}

	private headerDisplayStyle(
		axis: 'row' | 'column',
		style: PlotWorkbookCellStyle,
	): PlotWorkbookCellStyle {
		return {
			fontSize: DEFAULT_PLOTBOOK_FONT_SIZE,
			alignment: 'center',
			...(axis === 'column' ? { bold: true } : {}),
			...style,
		};
	}

	applySelectionStyle(patch: PlotWorkbookStylePatch): void {
		if (this.selectionMode === 'cell') {
			this.session.setCellStyles(this.selectedCellTargets(true), patch);
		} else if (this.headerStyleTarget === 'cells') {
			const { rowIds, columnIds } = this.selectedHeaderIds();
			this.session.setCellAndAxisStyles(this.selectedCellTargets(true), rowIds, columnIds, patch);
		} else {
			const { rowIds, columnIds } = this.selectedHeaderIds();
			this.session.setHeaderStyles(rowIds, columnIds, patch);
		}
		this.focus();
	}

	toggleSelectionStyle(kind: 'bold' | 'italic' | 'underline' | 'strikethrough'): void {
		if (this.selectionMode !== 'cell' && this.headerStyleTarget === 'headers') {
			const { rowIds, columnIds } = this.selectedHeaderIds();
			const styles = [
				...rowIds.map(rowId => this.headerDisplayStyle('row', this.session.getRowHeaderStyle(rowId))),
				...columnIds.map(columnId => this.headerDisplayStyle('column', this.session.getColumnHeaderStyle(columnId))),
			];
			const allActive = styles.length > 0 && styles.every(style => style[kind] === true);
			this.session.setHeaderStyles(rowIds, columnIds, { [kind]: !allActive });
			this.focus();
			return;
		}
		const targets = this.selectedCellTargets(true);
		const sheet = this.session.activeSheet;
		const allActive = targets.length > 0 && targets.every(target =>
			this.session.getCellStyle(sheet, target.rowId, target.columnId)[kind] === true);
		if (this.selectionMode !== 'cell' && this.headerStyleTarget === 'cells') {
			const { rowIds, columnIds } = this.selectedHeaderIds();
			this.session.setCellAndAxisStyles(targets, rowIds, columnIds, { [kind]: allActive ? undefined : true });
		} else {
			this.session.setCellStyles(targets, { [kind]: allActive ? undefined : true });
		}
		this.focus();
	}

	private readonly handleScroll = (): void => {
		this.sampleScrollVelocity();
		this.syncScrollTransforms();
		this.scheduleScrollIdleRefresh();
		if (this.viewportOutsideRenderedArea()) {
			this.renderImmediatelyForScroll();
		}
		else if (this.scrollNeedsRender() || this.projectedViewportNeedsImmediateRender()) this.scheduleRender(true);
		const remainingBottom = this.viewport.scrollHeight - this.viewport.scrollTop - this.viewport.clientHeight;
		const remainingRight = this.viewport.scrollWidth - this.viewport.scrollLeft - this.viewport.clientWidth;
		if (remainingBottom < 700 && !this.expandingRows) {
			this.expandingRows = true;
			this.extendingForScroll = true;
			try { this.session.appendRows(100); } finally { this.extendingForScroll = false; }
			window.requestAnimationFrame(() => { this.expandingRows = false; });
		}
		if (remainingRight < 700 && !this.expandingColumns) {
			this.expandingColumns = true;
			this.extendingForScroll = true;
			try { this.session.appendColumns(16); } finally { this.extendingForScroll = false; }
			window.requestAnimationFrame(() => { this.expandingColumns = false; });
		}
	};

	private scrollNeedsRender(): boolean {
		const area = this.renderedArea;
		if (!area) return true;
		const viewport = this.currentViewportArea();
		return (area.top > 0 && viewport.top < area.top + RENDER_EDGE_TOLERANCE)
			|| (area.left > 0 && viewport.left < area.left + RENDER_EDGE_TOLERANCE)
			|| viewport.bottom > area.bottom - RENDER_EDGE_TOLERANCE
			|| viewport.right > area.right - RENDER_EDGE_TOLERANCE;
	}

	private viewportOutsideRenderedArea(): boolean {
		const area = this.renderedArea;
		if (!area) return true;
		const viewport = this.currentViewportArea();
		return viewport.top < area.top || viewport.bottom > area.bottom
			|| viewport.left < area.left || viewport.right > area.right;
	}

	private projectedViewportNeedsImmediateRender(): boolean {
		const area = this.renderedArea;
		if (!area) return true;
		const viewport = this.currentViewportArea();
		const lookahead = this.scrollLookaheadMs();
		const maxX = this.logicalViewportWidth() * MAX_OVERSCAN_VIEWPORTS;
		const maxY = this.logicalViewportHeight() * MAX_OVERSCAN_VIEWPORTS;
		const shiftX = Math.max(-maxX, Math.min(maxX, this.scrollVelocityX * lookahead));
		const shiftY = Math.max(-maxY, Math.min(maxY, this.scrollVelocityY * lookahead));
		const fastMove = Math.abs(shiftX) >= RENDER_EDGE_TOLERANCE || Math.abs(shiftY) >= RENDER_EDGE_TOLERANCE;
		if (!fastMove) return false;
		return (shiftY < 0 && area.top > 0 && viewport.top + shiftY < area.top + RENDER_EDGE_TOLERANCE)
			|| (shiftY > 0 && viewport.bottom + shiftY > area.bottom - RENDER_EDGE_TOLERANCE)
			|| (shiftX < 0 && area.left > 0 && viewport.left + shiftX < area.left + RENDER_EDGE_TOLERANCE)
			|| (shiftX > 0 && viewport.right + shiftX > area.right - RENDER_EDGE_TOLERANCE);
	}

	private currentViewportArea(): { top: number; right: number; bottom: number; left: number } {
		const sheet = this.session.activeSheet;
		const top = Math.max(0, this.logicalScrollTop() - this.columnHeaderHeight(sheet));
		const left = Math.max(0, this.logicalScrollLeft() - this.rowHeaderWidth(sheet));
		return {
			top,
			left,
			bottom: top + this.logicalViewportHeight(),
			right: left + this.logicalViewportWidth(),
		};
	}

	private sampleScrollVelocity(): void {
		const now = this.scrollClock();
		const left = this.logicalScrollLeft();
		const top = this.logicalScrollTop();
		const elapsed = Math.max(1, Math.min(80, now - this.lastScrollSampleAt));
		this.scrollVelocityX = (left - this.lastScrollLeft) / elapsed;
		this.scrollVelocityY = (top - this.lastScrollTop) / elapsed;
		this.lastScrollLeft = left;
		this.lastScrollTop = top;
		this.lastScrollSampleAt = now;
	}

	private scrollClock(): number {
		return this.viewport.ownerDocument.defaultView?.performance.now() ?? Date.now();
	}

	private dynamicOverscan(): { top: number; right: number; bottom: number; left: number } {
		const width = this.logicalViewportWidth();
		const height = this.logicalViewportHeight();
		const baseX = Math.max(MIN_OVERSCAN, width * 0.5);
		const baseY = Math.max(MIN_OVERSCAN, height * 0.65);
		const lookahead = this.scrollLookaheadMs();
		let leadX = Math.min(width * MAX_OVERSCAN_VIEWPORTS, Math.abs(this.scrollVelocityX) * lookahead);
		let leadY = Math.min(height * MAX_OVERSCAN_VIEWPORTS, Math.abs(this.scrollVelocityY) * lookahead);
		// Independent axis overscans multiply during diagonal flings. Budget the
		// area rather than creating dozens of viewport-sized grids in one frame.
		const a = 1 + 2 * baseX / Math.max(1, width);
		const b = leadX / Math.max(1, width);
		const c = 1 + 2 * baseY / Math.max(1, height);
		const d = leadY / Math.max(1, height);
		const areaBudget = Math.max(MIN_OVERSCAN_AREA_VIEWPORTS,
			MAX_OVERSCAN_AREA_VIEWPORTS * 16 / Math.max(16, this.scrollRenderLatency));
		if ((a + b) * (c + d) > areaBudget) {
			const linear = a * d + b * c;
			const quadratic = b * d;
			const available = Math.max(0, areaBudget - a * c);
			const scale = quadratic > 0
				? 2 * available / (Math.sqrt(linear * linear + 4 * quadratic * available) + linear)
				: linear > 0 ? available / linear : 0;
			leadX *= Math.min(1, scale);
			leadY *= Math.min(1, scale);
		}
		return {
			top: baseY + (this.scrollVelocityY < 0 ? leadY : 0),
			bottom: baseY + (this.scrollVelocityY > 0 ? leadY : 0),
			left: baseX + (this.scrollVelocityX < 0 ? leadX : 0),
			right: baseX + (this.scrollVelocityX > 0 ? leadX : 0),
		};
	}

	private scrollLookaheadMs(): number {
		return Math.max(
			MIN_SCROLL_LOOKAHEAD_MS,
			Math.min(MAX_SCROLL_LOOKAHEAD_MS, this.scrollRenderLatency * 4),
		);
	}

	private readonly handleWheel = (event: WheelEvent): void => {
		if (event.ctrlKey || event.metaKey) {
			this.cancelWheelScroll();
			this.stopAutoScroll();
			event.preventDefault();
			event.stopPropagation();
			this.setZoom(this.zoom + (event.deltaY < 0 ? 0.1 : -0.1));
			return;
		}
		if (event.deltaX === 0 && event.deltaY === 0) return;
		// Let a nested editor/cast strip consume its own wheel movement first.
		const nested = (event.target as Element | null)?.closest?.<HTMLElement>('textarea, .wm-plotbook-cast-strip');
		if (nested && this.viewport.contains(nested) && (
			(event.deltaY > 0 && nested.scrollTop + nested.clientHeight < nested.scrollHeight - 1)
			|| (event.deltaY < 0 && nested.scrollTop > 0)
			|| (event.deltaX > 0 && nested.scrollLeft + nested.clientWidth < nested.scrollWidth - 1)
			|| (event.deltaX < 0 && nested.scrollLeft > 0))) return;
		this.stopAutoScroll();
		event.preventDefault();
		// Own the wheel's scroll write: a compositor-led native scroll can outrun
		// even a synchronous scroll-event render. Coalesce a burst into one frame,
		// mount the destination, then expose it by setting the scroll position.
		const linePixels = 16;
		const xUnit = event.deltaMode === WheelEvent.DOM_DELTA_PAGE
			? this.viewport.clientWidth
			: event.deltaMode === WheelEvent.DOM_DELTA_LINE ? linePixels : 1;
		const yUnit = event.deltaMode === WheelEvent.DOM_DELTA_PAGE
			? this.viewport.clientHeight
			: event.deltaMode === WheelEvent.DOM_DELTA_LINE ? linePixels : 1;
		const shiftX = event.deltaX * xUnit;
		const shiftY = event.deltaY * yUnit;
		this.pendingWheelX += event.shiftKey && shiftX === 0 ? shiftY : shiftX;
		this.pendingWheelY += event.shiftKey && shiftX === 0 ? 0 : shiftY;
		if (this.wheelScrollFrame !== null) return;
		this.wheelScrollFrame = window.requestAnimationFrame(() => {
			this.wheelScrollFrame = null;
			const x = this.pendingWheelX;
			const y = this.pendingWheelY;
			this.pendingWheelX = this.pendingWheelY = 0;
			this.applyScrollDelta(x, y);
		});
	};

	private applyScrollDelta(x: number, y: number): void {
		const left = Math.max(0, Math.min(this.viewport.scrollWidth - this.viewport.clientWidth, this.viewport.scrollLeft + x));
		const top = Math.max(0, Math.min(this.viewport.scrollHeight - this.viewport.clientHeight, this.viewport.scrollTop + y));
		const shiftX = (left - this.viewport.scrollLeft) / this.zoom;
		const shiftY = (top - this.viewport.scrollTop) / this.zoom;
		if (shiftX === 0 && shiftY === 0) return;
		this.scrollVelocityX = shiftX / 16;
		this.scrollVelocityY = shiftY / 16;
		if (this.renderRequiresFullRefresh || this.wheelProjectionNeedsRender(shiftX, shiftY)) {
			const sheet = this.session.activeSheet;
			const targetTop = Math.max(0, top / this.zoom - this.columnHeaderHeight(sheet));
			const targetLeft = Math.max(0, left / this.zoom - this.rowHeaderWidth(sheet));
			this.renderImmediatelyForScroll({ top: targetTop, left: targetLeft,
				bottom: targetTop + this.logicalViewportHeight(), right: targetLeft + this.logicalViewportWidth() });
		}
		this.viewport.scrollLeft = left;
		this.viewport.scrollTop = top;
		this.syncScrollTransforms();
		this.scheduleScrollIdleRefresh();
	}

	private cancelWheelScroll(): void {
		if (this.wheelScrollFrame !== null) window.cancelAnimationFrame(this.wheelScrollFrame);
		this.wheelScrollFrame = null;
		this.pendingWheelX = this.pendingWheelY = 0;
	}

	private readonly handleScrollPointerDown = (event: PointerEvent): void => {
		if (event.button !== 1) { this.stopAutoScroll(); return; }
		if ((event.target as Element | null)?.closest?.('input, textarea, select, button, a')) return;
		event.preventDefault();
		event.stopPropagation();
		if (this.autoScroll) { this.stopAutoScroll(); return; }
		this.cancelWheelScroll();
		this.viewport.focus({ preventScroll: true });
		this.autoScroll = { originX: event.clientX, originY: event.clientY, x: event.clientX, y: event.clientY, time: this.scrollClock() };
		this.viewport.addClass('is-auto-scrolling');
		const owner = this.viewport.ownerDocument;
		owner.addEventListener('pointermove', this.handleAutoScrollMove);
		owner.addEventListener('pointerdown', this.handleAutoScrollOutside, true);
		owner.addEventListener('keydown', this.handleAutoScrollKey, true);
		owner.defaultView?.addEventListener('blur', this.stopAutoScroll);
		this.autoScrollFrame = window.requestAnimationFrame(this.stepAutoScroll);
	};

	private readonly handleAutoScrollMove = (event: PointerEvent): void => {
		if (this.autoScroll) { this.autoScroll.x = event.clientX; this.autoScroll.y = event.clientY; }
	};
	private readonly handleAutoScrollOutside = (event: PointerEvent): void => {
		if (!this.viewport.contains(event.target as Node)) this.stopAutoScroll();
	};
	private readonly handleAutoScrollKey = (event: KeyboardEvent): void => {
		if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.stopAutoScroll(); }
	};
	private readonly stepAutoScroll = (): void => {
		this.autoScrollFrame = null;
		const state = this.autoScroll;
		if (!state || !this.element.isConnected) { this.stopAutoScroll(); return; }
		const now = this.scrollClock();
		const elapsed = Math.min(32, Math.max(1, now - state.time));
		state.time = now;
		const speed = (distance: number) => Math.sign(distance) * Math.min(5, Math.pow(Math.max(0, Math.abs(distance) - 12) / 50, 1.5));
		this.applyScrollDelta(speed(state.x - state.originX) * elapsed, speed(state.y - state.originY) * elapsed);
		if (this.autoScroll) this.autoScrollFrame = window.requestAnimationFrame(this.stepAutoScroll);
	};
	private readonly stopAutoScroll = (): void => {
		if (!this.autoScroll && this.autoScrollFrame === null) return;
		if (this.autoScrollFrame !== null) window.cancelAnimationFrame(this.autoScrollFrame);
		this.autoScrollFrame = null;
		this.autoScroll = null;
		this.viewport.removeClass('is-auto-scrolling');
		const owner = this.viewport.ownerDocument;
		owner.removeEventListener('pointermove', this.handleAutoScrollMove);
		owner.removeEventListener('pointerdown', this.handleAutoScrollOutside, true);
		owner.removeEventListener('keydown', this.handleAutoScrollKey, true);
		owner.defaultView?.removeEventListener('blur', this.stopAutoScroll);
	};

	private wheelProjectionNeedsRender(shiftX: number, shiftY: number): boolean {
		const area = this.renderedArea;
		if (!area) return true;
		const viewport = this.currentViewportArea();
		const projectedTop = Math.max(0, viewport.top + shiftY);
		const projectedLeft = Math.max(0, viewport.left + shiftX);
		const projectedBottom = projectedTop + this.logicalViewportHeight();
		const projectedRight = projectedLeft + this.logicalViewportWidth();
		return (shiftY < 0 && area.top > 0 && projectedTop < area.top + RENDER_EDGE_TOLERANCE)
			|| (shiftY > 0 && projectedBottom > area.bottom - RENDER_EDGE_TOLERANCE)
			|| (shiftX < 0 && area.left > 0 && projectedLeft < area.left + RENDER_EDGE_TOLERANCE)
			|| (shiftX > 0 && projectedRight > area.right - RENDER_EDGE_TOLERANCE);
	}

	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		const command = event.ctrlKey || event.metaKey;
		if (command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
			event.preventDefault();
			this.openFindReplace(false);
			return;
		}
		if (command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'h') {
			event.preventDefault();
			this.openFindReplace(true);
			return;
		}
		if (!this.editingCell && command && !event.altKey && !event.shiftKey) {
			const key = event.key.toLowerCase();
			if (key === 'c' || key === 'x') {
				event.preventDefault();
				event.stopPropagation();
				void this.writeSelectionToClipboard(key === 'x');
				return;
			}
			if (key === 'v') {
				event.preventDefault();
				event.stopPropagation();
				void this.pasteSelectionFromClipboard();
				return;
			}
		}
		if (this.editingCell || event.target instanceof HTMLInputElement) return;
		if (command && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) this.session.redo();
			else this.session.undo();
			return;
		}
		if (command && event.key.toLowerCase() === 'y') {
			event.preventDefault();
			this.session.redo();
			return;
		}
		if (command && event.key.toLowerCase() === 'b') {
			event.preventDefault();
			this.toggleSelectionStyle('bold');
			return;
		}
		if (command && event.key.toLowerCase() === 'i') {
			event.preventDefault();
			this.toggleSelectionStyle('italic');
			return;
		}
		if (command && event.key.toLowerCase() === 'u') {
			event.preventDefault();
			this.toggleSelectionStyle('underline');
			return;
		}
		if (command && event.shiftKey && event.key.toLowerCase() === 's') {
			event.preventDefault();
			this.toggleSelectionStyle('strikethrough');
			return;
		}
		if (event.shiftKey && event.code === 'Space') {
			event.preventDefault();
			this.selectWholeRow(this.selected.rowIndex);
			return;
		}
		if (command && event.code === 'Space') {
			event.preventDefault();
			this.selectWholeColumn(this.selected.columnIndex);
			return;
		}
		if (event.shiftKey && this.selectionMode === 'row'
			&& (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
			event.preventDefault();
			this.selectWholeRow(this.selected.rowIndex + (event.key === 'ArrowUp' ? -1 : 1), true);
			return;
		}
		if (event.shiftKey && this.selectionMode === 'column'
			&& (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
			event.preventDefault();
			this.selectWholeColumn(this.selected.columnIndex + (event.key === 'ArrowLeft' ? -1 : 1), true);
			return;
		}

		let { rowIndex, columnIndex } = this.selected;
		switch (event.key) {
			case 'ArrowUp': rowIndex--; break;
			case 'ArrowDown': rowIndex++; break;
			case 'ArrowLeft': columnIndex--; break;
			case 'ArrowRight': columnIndex++; break;
			case 'Tab': columnIndex += event.shiftKey ? -1 : 1; break;
			case 'Enter':
			case 'F2':
				event.preventDefault();
				this.beginEditingSelected();
				return;
			case 'Delete':
			case 'Backspace':
				event.preventDefault();
				this.clearSelectedRange();
				return;
			default:
				if (!command && !event.altKey && event.key.length === 1) {
					event.preventDefault();
					this.beginEditingSelected(event.key, true);
				}
				return;
		}
		event.preventDefault();
		const extend = event.shiftKey && event.key.startsWith('Arrow');
		this.select(rowIndex, columnIndex, true, extend);
	};

	private readonly handlePaste = (event: ClipboardEvent): void => {
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
		if (this.selectionMode === 'headers') return;
		const text = event.clipboardData?.getData('text/plain');
		if (!text) return;
		event.preventDefault();
		this.pasteClipboardText(text);
	};

	private pasteClipboardText(text: string): void {
		if (!text || this.selectionMode === 'headers') return;
		this.selectionMode = 'cell';
		this.selectedCellKeys.clear();
		this.selectedRowIdsSet.clear();
		this.selectedColumnIdsSet.clear();
		const rows = text.replace(/\r/g, '').split('\n');
		if (rows[rows.length - 1] === '') rows.pop();
		const values = rows.map(row => row.split('\t'));
		const neededRows = this.selected.rowIndex + values.length - this.session.activeSheet.rowOrder.length;
		const maxColumns = Math.max(0, ...values.map(row => row.length));
		const neededColumns = this.selected.columnIndex + maxColumns - this.session.activeSheet.columnOrder.length;
		if (neededRows > 0) this.session.appendRows(Math.max(100, neededRows));
		if (neededColumns > 0) this.session.appendColumns(Math.max(16, neededColumns));
		const sheet = this.session.activeSheet;
		const updates: Array<{ rowId: string; columnId: string; value: string }> = [];
		for (let rowOffset = 0; rowOffset < values.length; rowOffset++) {
			for (let columnOffset = 0; columnOffset < values[rowOffset].length; columnOffset++) {
				const rowId = sheet.rowOrder[this.selected.rowIndex + rowOffset];
				const columnId = this.columnOrder(sheet)[this.selected.columnIndex + columnOffset];
				if (rowId && columnId) updates.push({ rowId, columnId, value: values[rowOffset][columnOffset] });
			}
		}
		this.session.setCells(updates);
		this.selectionAnchor = { ...this.selected };
		this.selected = {
			rowIndex: Math.min(sheet.rowOrder.length - 1, this.selectionAnchor.rowIndex + Math.max(0, values.length - 1)),
			columnIndex: Math.min(this.columnOrder(sheet).length - 1, this.selectionAnchor.columnIndex + Math.max(0, maxColumns - 1)),
		};
		this.refreshSelectionBox();
		this.scheduleRender();
	}

	private async writeSelectionToClipboard(cut: boolean): Promise<void> {
		const text = this.selectionClipboardText();
		if (!text) return;
		const clipboard = this.viewport.ownerDocument.defaultView?.navigator.clipboard;
		if (!clipboard) return;
		try {
			await clipboard.writeText(text);
			if (cut) this.clearSelectedRange();
		} catch (error) {
			new Notice(`클립보드에 복사하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async pasteSelectionFromClipboard(): Promise<void> {
		const clipboard = this.viewport.ownerDocument.defaultView?.navigator.clipboard;
		if (!clipboard) return;
		try {
			this.pasteClipboardText(await clipboard.readText());
		} catch (error) {
			new Notice(`클립보드에서 붙여넣지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private readonly handleCopy = (event: ClipboardEvent): void => {
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
		const text = this.selectionClipboardText();
		if (!text || !event.clipboardData) return;
		event.preventDefault();
		event.clipboardData.setData('text/plain', text);
	};

	private readonly handleCut = (event: ClipboardEvent): void => {
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
		const text = this.selectionClipboardText();
		if (!text || !event.clipboardData) return;
		event.preventDefault();
		event.clipboardData.setData('text/plain', text);
		this.clearSelectedRange();
	};

	private selectionClipboardText(): string {
		if (this.selectionMode === 'headers') return '';
		const sheet = this.session.activeSheet;
		const order = this.columnOrder(sheet);
		const bounds = this.selectionBounds();
		const keyed = this.selectionMode === 'cell' && this.selectedCellKeys.size > 0;
		const lines: string[] = [];
		for (let rowIndex = bounds.top; rowIndex <= bounds.bottom; rowIndex++) {
			const rowId = sheet.rowOrder[rowIndex];
			const values: string[] = [];
			for (let columnIndex = bounds.left; columnIndex <= bounds.right; columnIndex++) {
				const columnId = order[columnIndex];
				if (!rowId || !columnId || (keyed && !this.selectedCellKeys.has(this.cellKey(rowId, columnId)))) {
					values.push('');
					continue;
				}
				values.push(this.session.getCell(sheet, rowId, columnId));
			}
			lines.push(values.join('\t'));
		}
		return lines.join('\n');
	}

	private render(reuseExisting = false, preserveOutsideRange = false, projectedViewport?: ViewportArea): void {
		// Obsidian builds/updates inactive leaves while they are display:none.
		// Defer that range until ResizeObserver sees a real viewport; zero-sized
		// measurements must never become the active tab's final render range.
		if (this.viewport.clientWidth === 0 || this.viewport.clientHeight === 0) {
			this.renderRequiresFullRefresh ||= !reuseExisting;
			return;
		}
		const renderStarted = this.scrollClock();
		const sheet = this.session.activeSheet;
		const rowHeaderWidth = this.rowHeaderWidth(sheet);
		const columnHeaderHeight = this.columnHeaderHeight(sheet);
		this.element.style.setProperty('--wm-plotbook-row-header-width', `${rowHeaderWidth}px`);
		this.element.style.setProperty('--wm-plotbook-column-header-height', `${columnHeaderHeight}px`);
		this.element.parentElement?.style.setProperty('--wm-plotbook-row-header-width', `${rowHeaderWidth}px`);
		this.element.parentElement?.style.setProperty('--wm-plotbook-column-header-height', `${columnHeaderHeight}px`);
		this.clampSelection(sheet);
		this.syncScrollTransforms();
		const { rows, columns, columnOrder, rowLabels } = this.scrollLayout(sheet);
		this.canvas.style.width = `${rowHeaderWidth + columns.total}px`;
		this.canvas.style.height = `${columnHeaderHeight + rows.total}px`;
		if (this.selectionBox.parentElement !== this.canvas) this.canvas.appendChild(this.selectionBox);
		for (const preview of this.fillPreviews) {
			if (preview.parentElement !== this.canvas) this.canvas.appendChild(preview);
			preview.removeClass('is-on-frozen-pane');
			preview.addClass('is-hidden');
		}
		const viewportArea = projectedViewport ?? this.currentViewportArea();
		const overscan = this.dynamicOverscan();
		const top = Math.max(0, viewportArea.top - overscan.top);
		const left = Math.max(0, viewportArea.left - overscan.left);
		const bottom = viewportArea.bottom + overscan.bottom;
		const right = viewportArea.right + overscan.right;
		this.renderedArea = { top, left, bottom, right };
		const firstRow = this.indexAt(rows, top);
		const lastRow = Math.min(sheet.rowOrder.length - 1, this.indexAt(rows, bottom));
		const firstColumn = this.indexAt(columns, left);
		const lastColumn = Math.min(columnOrder.length - 1, this.indexAt(columns, right));
		const frozenRows = this.frozenRowCount(sheet);
		const frozenColumns = this.frozenColumnCount(sheet);
		const frozenRowsHeight = frozenRows > 0
			? rows.offsets[frozenRows - 1] + rows.sizes[frozenRows - 1]
			: 0;
		const frozenColumnsWidth = frozenColumns > 0
			? columns.offsets[frozenColumns - 1] + columns.sizes[frozenColumns - 1]
			: 0;
		this.frozenRowHeadersLayer.style.height = `${frozenRowsHeight}px`;
		this.frozenRowHeadersLayer.classList.toggle('is-hidden', frozenRows === 0);
		this.frozenColumnHeadersLayer.style.width = `${frozenColumnsWidth}px`;
		this.frozenColumnHeadersLayer.classList.toggle('is-hidden', frozenColumns === 0);
		this.frozenColumnsCellsLayer.style.width = `${frozenColumnsWidth}px`;
		this.frozenColumnsCellsLayer.style.height = `${rows.total}px`;
		this.frozenColumnsCellsLayer.classList.toggle('is-hidden', frozenColumns === 0);
		this.frozenRowsCellsLayer.style.width = `${columns.total}px`;
		this.frozenRowsCellsLayer.style.height = `${frozenRowsHeight}px`;
		this.frozenRowsCellsLayer.classList.toggle('is-hidden', frozenRows === 0);
		this.frozenCornerCellsLayer.style.width = `${frozenColumnsWidth}px`;
		this.frozenCornerCellsLayer.style.height = `${frozenRowsHeight}px`;
		this.frozenCornerCellsLayer.classList.toggle('is-hidden', frozenRows === 0 || frozenColumns === 0);
		const visibleRows = this.visibleIndices(firstRow, lastRow, frozenRows);
		const visibleColumns = this.visibleIndices(firstColumn, lastColumn, frozenColumns);
		const existingCells = this.reconcileCellLayers(
			visibleRows,
			visibleColumns,
			frozenRows,
			frozenColumns,
			reuseExisting,
			preserveOutsideRange,
		);
		const existingRowHeaders = this.reconcileRowHeaderLayers(visibleRows, frozenRows, reuseExisting, preserveOutsideRange);
		const existingColumnHeaders = this.reconcileColumnHeaderLayers(visibleColumns, frozenColumns, reuseExisting, preserveOutsideRange);

		for (const rowIndex of visibleRows) {
			const rowId = sheet.rowOrder[rowIndex];
			const rowHeaderLayer = rowIndex < frozenRows ? this.frozenRowHeadersLayer : this.rowHeadersLayer;
			if (!existingRowHeaders.get(rowHeaderLayer)?.has(String(rowIndex))) {
				this.renderRowHeader(sheet, rowId, rowIndex, rowLabels.get(rowId) ?? String(rowIndex + 1), rows);
			}
			for (const columnIndex of visibleColumns) {
				const cellLayer = this.cellLayerFor(rowIndex, columnIndex, frozenRows, frozenColumns);
				if (!existingCells.get(cellLayer)?.has(`${rowIndex}:${columnIndex}`)) {
					this.renderCell(sheet, rowId, rowIndex, columnOrder[columnIndex], columnIndex, rows, columns);
				}
			}
		}
		for (const columnIndex of visibleColumns) {
			const columnHeaderLayer = columnIndex < frozenColumns ? this.frozenColumnHeadersLayer : this.columnHeadersLayer;
			if (!existingColumnHeaders.get(columnHeaderLayer)?.has(String(columnIndex))) {
				this.renderColumnHeader(sheet, columnOrder[columnIndex], columnIndex, columns);
			}
		}
		this.flushPendingCellText();
		if (preserveOutsideRange) {
			this.trimPreservedScrollCells(visibleRows, visibleColumns, frozenRows, frozenColumns);
		}
		if (this.fillPreviewBounds) this.showFillPreviews(this.fillPreviewBounds, rows, columns);

		this.corner.classList.toggle('is-selected', this.selectionMode === 'headers');
		this.refreshCornerStyleTarget();
		this.positionSelection(sheet, rows, columns);
		// Preview measurement reads scrollHeight, computed style and two client
		// rects. Defer those forced-layout reads until the idle reconciliation;
		// the existing overlay already moves with the canvas during scrolling.
		if (!preserveOutsideRange) this.refreshSelectionPreview();
		if (reuseExisting) {
			const duration = this.scrollClock() - renderStarted;
			this.scrollRenderLatency = Math.max(8, this.scrollRenderLatency * 0.75 + duration * 0.25);
		}
	}

	private reconcileCellLayers(
		rowIndices: number[],
		columnIndices: number[],
		frozenRows: number,
		frozenColumns: number,
		reuseExisting: boolean,
		preserveOutsideRange = false,
	): Map<HTMLElement, Set<string>> {
		const layers = [
			this.cellsLayer,
			this.frozenColumnsCellsLayer,
			this.frozenRowsCellsLayer,
			this.frozenCornerCellsLayer,
		];
		const wanted = new Map(layers.map(layer => [layer, new Set<string>()]));
		for (const rowIndex of rowIndices) {
			for (const columnIndex of columnIndices) {
				wanted.get(this.cellLayerFor(rowIndex, columnIndex, frozenRows, frozenColumns))
					?.add(`${rowIndex}:${columnIndex}`);
			}
		}
		return this.reconcileLayers(wanted, reuseExisting, element => {
			const row = element.dataset.row;
			const column = element.dataset.column;
			return row !== undefined && column !== undefined ? `${row}:${column}` : null;
		}, preserveOutsideRange);
	}

	private trimPreservedScrollCells(
		rowIndices: number[],
		columnIndices: number[],
		frozenRows: number,
		frozenColumns: number,
	): void {
		const layers = [
			this.cellsLayer,
			this.frozenColumnsCellsLayer,
			this.frozenRowsCellsLayer,
			this.frozenCornerCellsLayer,
		];
		const mountedCount = layers.reduce((sum, layer) => sum + layer.childElementCount, 0);
		const currentCount = Math.max(1, rowIndices.length * columnIndices.length);
		if (mountedCount > Math.max(currentCount * 2.5, currentCount + 400)) {
			// Long scrollbar drags can otherwise retain every range visited during the
			// burst. Trim only after the incoming range is fully mounted, so the DOM
			// update remains atomic from the browser's next paint point of view.
			this.reconcileCellLayers(rowIndices, columnIndices, frozenRows, frozenColumns, true, false);
		}
		const mountedRowHeaders = this.rowHeadersLayer.childElementCount + this.frozenRowHeadersLayer.childElementCount;
		if (mountedRowHeaders > Math.max(rowIndices.length * 3, rowIndices.length + 150)) {
			this.reconcileRowHeaderLayers(rowIndices, frozenRows, true, false);
		}
		const mountedColumnHeaders = this.columnHeadersLayer.childElementCount + this.frozenColumnHeadersLayer.childElementCount;
		if (mountedColumnHeaders > Math.max(columnIndices.length * 3, columnIndices.length + 80)) {
			this.reconcileColumnHeaderLayers(columnIndices, frozenColumns, true, false);
		}
	}

	private reconcileRowHeaderLayers(
		indices: number[],
		frozenCount: number,
		reuseExisting: boolean,
		preserveOutsideRange = false,
	): Map<HTMLElement, Set<string>> {
		const layers = [this.rowHeadersLayer, this.frozenRowHeadersLayer];
		const wanted = new Map(layers.map(layer => [layer, new Set<string>()]));
		for (const index of indices) {
			wanted.get(index < frozenCount ? this.frozenRowHeadersLayer : this.rowHeadersLayer)?.add(String(index));
		}
		return this.reconcileLayers(wanted, reuseExisting, element => element.dataset.row ?? null, preserveOutsideRange);
	}

	private reconcileColumnHeaderLayers(
		indices: number[],
		frozenCount: number,
		reuseExisting: boolean,
		preserveOutsideRange = false,
	): Map<HTMLElement, Set<string>> {
		const layers = [this.columnHeadersLayer, this.frozenColumnHeadersLayer];
		const wanted = new Map(layers.map(layer => [layer, new Set<string>()]));
		for (const index of indices) {
			wanted.get(index < frozenCount ? this.frozenColumnHeadersLayer : this.columnHeadersLayer)?.add(String(index));
		}
		return this.reconcileLayers(wanted, reuseExisting, element => element.dataset.column ?? null, preserveOutsideRange);
	}

	private reconcileLayers(
		wanted: Map<HTMLElement, Set<string>>,
		reuseExisting: boolean,
		keyFor: (element: HTMLElement) => string | null,
		preserveOutsideRange = false,
	): Map<HTMLElement, Set<string>> {
		const existing = new Map<HTMLElement, Set<string>>();
		for (const [layer, wantedKeys] of wanted) {
			const retained = new Set<string>();
			existing.set(layer, retained);
			if (!reuseExisting) {
				layer.empty();
				continue;
			}
			for (const child of Array.from(layer.children)) {
				const element = child as HTMLElement;
				const key = keyFor(element);
				if (key !== null && wantedKeys.has(key)) retained.add(key);
				else if (!preserveOutsideRange) element.remove();
			}
		}
		return existing;
	}

	private cellLayerFor(
		rowIndex: number,
		columnIndex: number,
		frozenRows: number,
		frozenColumns: number,
	): HTMLElement {
		const frozenRow = rowIndex < frozenRows;
		const frozenColumn = columnIndex < frozenColumns;
		return frozenRow && frozenColumn
			? this.frozenCornerCellsLayer
			: frozenRow
				? this.frozenRowsCellsLayer
				: frozenColumn ? this.frozenColumnsCellsLayer : this.cellsLayer;
	}

	private refreshCornerStyleTarget(): void {
		const visible = this.hasHeaderSelection();
		this.cornerStyleTarget.toggleClass('is-hidden', !visible);
		if (!visible) return;
		for (const [target, button] of this.cornerStyleTargetButtons) {
			button.setAttribute('aria-pressed', String(target === this.headerStyleTarget));
		}
		window.requestAnimationFrame(() => {
			const active = this.cornerStyleTargetButtons.get(this.headerStyleTarget);
			if (!active?.isConnected || !this.cornerStyleTargetThumb.isConnected) return;
			this.cornerStyleTargetThumb.setCssStyles({
				width: `${active.offsetWidth}px`,
				height: `${active.offsetHeight}px`,
				transform: `translate(${active.offsetLeft}px, ${active.offsetTop}px)`,
			});
		});
	}

	private renderCell(
		sheet: PlotWorkbookSheet,
		rowId: string,
		rowIndex: number,
		columnId: string,
		columnIndex: number,
		rows: AxisLayout,
		columns: AxisLayout,
	): void {
		const frozenRowCount = this.frozenRowCount(sheet);
		const frozenColumnCount = this.frozenColumnCount(sheet);
		const frozenRow = rowIndex < frozenRowCount;
		const frozenColumn = columnIndex < frozenColumnCount;
		const collapsedRow = sheet.rows[rowId]?.collapsed === true;
		const collapsedColumn = sheet.columns[columnId]?.collapsed === true;
		const layer = frozenRow && frozenColumn
			? this.frozenCornerCellsLayer
			: frozenRow
				? this.frozenRowsCellsLayer
				: frozenColumn
					? this.frozenColumnsCellsLayer
					: this.cellsLayer;
		const cellKey = this.cellKey(rowId, columnId);
		const cell = layer.createDiv({
			cls: `wm-plotbook-cell${frozenRow ? ' is-frozen-row' : ''}${frozenColumn ? ' is-frozen-column' : ''}${collapsedRow ? ' is-collapsed-row' : ''}${collapsedColumn ? ' is-collapsed-column' : ''}${this.selectionMode === 'row' && this.selectedRowIdsSet.has(rowId) ? ' is-axis-selected' : ''}${this.selectionMode === 'column' && this.selectedColumnIdsSet.has(columnId) ? ' is-axis-selected' : ''}${this.selectionMode === 'cell' && this.selectedCellKeys.has(cellKey) ? ' is-cell-multi-selected' : ''}${this.filterQuery.trim() && !this.findMatchCellKeys.has(cellKey) ? ' is-filter-dimmed' : ''}${rowIndex === frozenRowCount - 1 ? ' is-freeze-row-edge' : ''}${columnIndex === frozenColumnCount - 1 ? ' is-freeze-column-edge' : ''}`,
		});
		const activeMatch = this.findMatches[this.activeFindMatch];
		cell.toggleClass('is-find-match', this.findMatchCellKeys.has(cellKey));
		cell.toggleClass('is-active-find-match', activeMatch?.rowId === rowId && activeMatch.columnId === columnId);
		cell.dataset.row = String(rowIndex);
		cell.dataset.column = String(columnIndex);
		cell.style.left = `${columns.offsets[columnIndex] + (frozenRow || frozenColumn ? 0 : this.rowHeaderWidth(sheet))}px`;
		cell.style.top = `${rows.offsets[rowIndex] + (frozenRow || frozenColumn ? 0 : this.columnHeaderHeight(sheet))}px`;
		cell.style.width = `${columns.sizes[columnIndex]}px`;
		cell.style.height = `${rows.sizes[rowIndex]}px`;
		const value = this.session.getCell(sheet, rowId, columnId);
		const role = sheet.columns[columnId]?.role ?? 'text';
		if (collapsedColumn) {
			const roleLabel = COLUMN_ROLES.find(candidate => candidate.value === role)?.label ?? '일반';
			cell.setAttribute('title', sheet.columns[columnId]?.title || (role === 'cast' ? '등장' : roleLabel) || columnLabel(columnIndex));
		}
		const locked = role === 'cast';
		const structured = role === 'status' || role === 'date';
		const foreshadow = role === 'foreshadow';
		const structuredSubrow = structured && Boolean(sheet.rows[rowId]?.parentRowId);
		cell.toggleClass('is-cast', locked);
		cell.toggleClass('is-status', role === 'status');
		cell.toggleClass('is-date', role === 'date');
		cell.toggleClass('is-foreshadow', foreshadow);
		cell.toggleClass('is-checklist', role === 'checklist');
		cell.toggleClass('is-structured-disabled', structuredSubrow);
		const style = this.session.getCellStyle(sheet, rowId, columnId);
		if (Object.keys(style).length > 0) this.applyCellStyle(cell, style);
		if (locked) this.renderCastCell(cell, sheet, rowId, columnId);
		else if (structuredSubrow) cell.textContent = '';
		else if (role === 'status') this.renderStatusCell(cell, value);
		else if (role === 'date') this.renderDateCell(cell, value);
		else if (foreshadow) this.renderForeshadowCell(cell, sheet, rowId, columnId, value);
		else if (role === 'checklist') this.renderChecklistCell(cell, sheet, rowId, columnId, value);
		else this.renderSearchableCellText(cell, value, rowId, columnId);
		cell.draggable = !collapsedRow && !collapsedColumn && !locked && !structured && !foreshadow && role !== 'checklist' && value.length > 0;
		if (!collapsedRow && !collapsedColumn && role === 'status' && !structuredSubrow) {
			cell.addEventListener('click', event => {
				if (event.ctrlKey || event.metaKey || event.shiftKey) return;
				this.openStatusMenu(event, rowId, columnId);
			});
		} else if (!collapsedRow && !collapsedColumn && role === 'date' && !structuredSubrow) {
			cell.addEventListener('click', event => {
				if (event.ctrlKey || event.metaKey || event.shiftKey) return;
				this.beginDateEditingCell(
					cell,
					rowIndex,
					columnIndex,
					Boolean((event.target as HTMLElement).closest('.wm-plotbook-structured-chevron')),
				);
			});
		} else if (!collapsedRow && !collapsedColumn && foreshadow) {
			cell.addEventListener('dblclick', event => this.openForeshadowModal(
				{ sheetId: sheet.sheetId, rowId, columnId },
				(event.target as Element | null)?.closest<HTMLElement>('[data-foreshadow-id]')?.dataset.foreshadowId,
			));
		} else if (!collapsedRow && !collapsedColumn && role === 'checklist') {
			cell.addEventListener('dblclick', () => this.openChecklistCell(cell, sheet, rowId, columnId));
		}
	}

	private readonly handleCellEvent = (event: Event): void => {
		// Native textarea selection, focus and text dragging belong to the editor,
		// not to the surrounding spreadsheet cell.
		if ((event.target as Element | null)?.closest('.wm-plotbook-cell-editor')) return;
		const surface = (event.target as Element | null)?.closest?.<HTMLElement>('.wm-plotbook-cell, .wm-plotbook-selected-cell-preview');
		const preview = surface === this.selectedCellPreview;
		let cell = preview ? this.selectedCellPreviewSource : surface;
		if (preview && event.type === 'pointerdown') {
			const pointer = event as PointerEvent;
			if (pointer.shiftKey || pointer.ctrlKey || pointer.metaKey) {
				cell = this.cellFromPoint(pointer.clientX, pointer.clientY) ?? cell;
			}
		}
		if (this.dragSource && (event.type === 'dragover' || event.type === 'drop')) {
			const drag = event as DragEvent;
			cell = this.cellFromPoint(drag.clientX, drag.clientY) ?? cell;
		}
		if (!cell || !this.canvas.contains(cell)) return;
		const rowIndex = Number(cell.dataset.row);
		const columnIndex = Number(cell.dataset.column);
		const sheet = this.session.activeSheet;
		const rowId = sheet.rowOrder[rowIndex];
		const columnId = this.columnOrder(sheet)[columnIndex];
		if (!rowId || !columnId) return;
		const role = sheet.columns[columnId]?.role ?? 'text';
		const collapsedRow = sheet.rows[rowId]?.collapsed === true;
		const collapsedColumn = sheet.columns[columnId]?.collapsed === true;
		if (event.type === 'pointerdown') {
			const pointer = event as PointerEvent;
			if (pointer.button !== 0) return;
			if (preview && !pointer.shiftKey && !pointer.ctrlKey && !pointer.metaKey) {
				this.viewport.focus();
				return;
			}
			if (collapsedRow || collapsedColumn) {
				pointer.preventDefault(); pointer.stopPropagation();
				if (collapsedRow) this.session.setRowCollapsed(rowId, false);
				if (collapsedColumn) this.session.setColumnCollapsed(columnId, false);
				return;
			}
			if (pointer.shiftKey || pointer.ctrlKey || pointer.metaKey) pointer.preventDefault();
			this.select(rowIndex, columnIndex, false, pointer.shiftKey, pointer.ctrlKey || pointer.metaKey);
			this.viewport.focus();
			return;
		}
		if (event.type === 'contextmenu') {
			this.openCellMenu(event as MouseEvent, cell, rowIndex, columnIndex);
			return;
		}
		if (role === 'cast' || role === 'status' || role === 'date' || role === 'foreshadow' || role === 'checklist') return;
		switch (event.type) {
			case 'dblclick': if (!collapsedRow && !collapsedColumn) this.beginEditingCell(cell, rowIndex, columnIndex); break;
			case 'dragstart': this.beginCellDrag(event as DragEvent, cell, rowIndex, columnIndex); break;
			case 'dragover': this.updateCellDragTarget(event as DragEvent, cell); break;
			case 'drop': this.finishCellDrag(event as DragEvent, rowIndex, columnIndex); break;
			case 'dragend': this.clearCellDrag(); break;
		}
	};

	private cellFromPoint(x: number, y: number): HTMLElement | null {
		// Ignore preview/selection overlays when targeting the sheet underneath.
		return this.canvas.ownerDocument.elementsFromPoint(x, y).find((element): element is HTMLElement =>
			element.matches('.wm-plotbook-cell') && this.canvas.contains(element)) ?? null;
	}

	private renderChecklistCell(cell: HTMLElement, sheet: PlotWorkbookSheet, rowId: string, columnId: string, value: string, limit = 2): void {
		cell.empty();
		const tasks = parseChecklist(value);
		if (!tasks.length) return;
		const list = cell.createDiv({ cls:'wm-plotbook-checklist-cell-items' });
		for (const task of tasks.slice(0, limit)) {
			const row = list.createDiv({ cls:`wm-plotbook-checklist-cell-item${task.completed ? ' is-complete' : ''}` });
			createChecklistControl(row,task.completed,`${task.text} 완료`,completed => this.session.changeChecklistTask(sheet.sheetId,rowId,columnId,task,{completed}));
			const text = row.createSpan({ cls: 'wm-plotbook-checklist-task-text' });
			this.renderMatchingLabel(text, task.text);
			renderChecklistCompletionDate(row, task.completionDate);
		}
	}

	private openChecklistCell(cell: HTMLElement, sheet: PlotWorkbookSheet, rowId: string, columnId: string): void {
		this.checklistPopover?.close();
		const rowIndex = sheet.rowOrder.indexOf(rowId);
		const columnIndex = this.columnOrder(sheet).indexOf(columnId);
		const currentCell = rowIndex >= 0 && columnIndex >= 0
			? this.canvas.querySelector<HTMLElement>(`.wm-plotbook-cell[data-row="${rowIndex}"][data-column="${columnIndex}"]`)
			: null;
		const anchor = currentCell?.isConnected ? currentCell : cell;
		this.clearSelectionPreview();
		const location = {sheetId:sheet.sheetId, rowId, columnId};
		this.checklistPopover = new PlotWorkbookChecklistPopover(anchor, this.session, location,
			() => void this.plugin.openPlotWorkbookSidebar({projectId:this.session.manifest.projectId, ...location}),
			() => { this.checklistPopover = null; },
			() => {
				const activeSheet = this.session.activeSheet;
				if (activeSheet.sheetId !== location.sheetId) return null;
				const row = activeSheet.rowOrder.indexOf(rowId);
				const column = this.columnOrder(activeSheet).indexOf(columnId);
				return this.canvas.querySelector<HTMLElement>(`.wm-plotbook-cell[data-row="${row}"][data-column="${column}"]`);
			});
	}

	private renderForeshadowCell(
		cell: HTMLElement,
		sheet: PlotWorkbookSheet,
		rowId: string,
		_columnId: string,
		legacyValue: string,
	): void {
		cell.empty();
		const items = this.session.foreshadowsInRow(sheet.sheetId, rowId);
		const list = cell.createDiv({ cls: 'wm-plotbook-foreshadow-cell-list' });
		if (items.length === 0) {
			list.createDiv({
				cls: `wm-plotbook-foreshadow-cell-item wm-plotbook-foreshadow-empty${legacyValue ? ' has-legacy-value' : ''}`,
				text: legacyValue,
			});
			return;
		}
		for (const item of items) {
			const plantedHere = item.plantedAt.some(candidate => candidate.sheetId === sheet.sheetId && candidate.rowId === rowId);
			const resolvedHere = item.resolvedAt.some(candidate => candidate.sheetId === sheet.sheetId && candidate.rowId === rowId);
			const task = list.createDiv({
				cls: `wm-plotbook-foreshadow-cell-item wm-plotbook-foreshadow-task is-${item.status}`,
				attr: {
					title: `${resolvedHere ? '회수' : plantedHere ? '등록' : '연결'} · ${item.status === 'resolved' ? '회수됨' : '미회수'}`,
				},
			});
			task.dataset.foreshadowId = item.id;
			renderForeshadowBadge(task, item.status);
			this.renderMatchingLabel(task.createSpan({ cls: 'wm-plotbook-foreshadow-task-title' }), item.title);
			if (resolvedHere) task.setAttribute('data-location-kind', 'resolve');
			else if (plantedHere) task.setAttribute('data-location-kind', 'plant');
		}
	}

	private renderStatusCell(cell: HTMLElement, value: string): void {
		const label = value ? this.session.statusName(value) : '상태 없음';
		const badge = cell.createSpan({ cls: `wm-plotbook-status-value${value ? '' : ' is-empty'}` });
		badge.style.setProperty('--wm-plotbook-status-color', this.session.statusColor(value));
		this.renderMatchingLabel(badge, label);
		const chevron = cell.createSpan({ cls: 'wm-plotbook-structured-chevron', attr: { 'aria-hidden': 'true' } });
		setIcon(chevron, 'chevron-down');
	}

	private renderSearchableCellText(cell: HTMLElement, value: string, rowId: string, columnId: string): void {
		cell.empty();
		this.pendingCellText.delete(cell);
		if (!value) return;
		const content = cell.createSpan({ cls: 'wm-plotbook-cell-text' });
		const length = Math.min(value.length, INITIAL_CELL_TEXT_PREVIEW);
		this.renderSearchableText(content, value.slice(0, length), rowId, columnId);
		if (length < value.length) this.pendingCellText.set(cell, { content, value, length, rowId, columnId });
	}

	private flushPendingCellText(): void {
		if (this.pendingCellText.size === 0) return;
		if (this.viewport.clientWidth === 0 || this.viewport.clientHeight === 0) return;
		// Read all sizes before writing any expansion. Native wrapping (including
		// custom fonts, zoom and narrow glyphs) determines the necessary prefix;
		// no guessed character count is allowed to leave a visible line missing.
		while (this.pendingCellText.size > 0) {
			const expand: Array<[HTMLElement, NonNullable<ReturnType<typeof this.pendingCellText.get>>]> = [];
			for (const [cell, entry] of this.pendingCellText) {
				if (!entry.content.isConnected || cell.hasClass('is-collapsed-row') || cell.hasClass('is-collapsed-column')
					|| entry.content.getBoundingClientRect().height > (cell.clientHeight + 16) * this.zoom) {
					this.pendingCellText.delete(cell);
					continue;
				}
				expand.push([cell, entry]);
			}
			for (const [cell, entry] of expand) {
				entry.length = Math.min(entry.value.length, entry.length * 2);
				entry.content.empty();
				this.renderSearchableText(entry.content, entry.value.slice(0, entry.length), entry.rowId, entry.columnId);
				if (entry.length === entry.value.length) this.pendingCellText.delete(cell);
			}
		}
	}

	private renderSearchableText(content: HTMLElement, value: string, rowId: string, columnId: string): void {
		const matches = this.findMatchesByCell.get(this.cellKey(rowId, columnId))?.filter(match => match.to > match.from && match.from < value.length);
		if (!matches?.length || !this.searchContentNeedle) {
			content.appendText(value);
			return;
		}
		const active = this.findMatches[this.activeFindMatch];
		let offset = 0;
		for (const match of matches) {
			if (match.from > offset) content.appendText(value.slice(offset, match.from));
			const mark = content.createSpan({ cls: 'wm-plotbook-search-hit', text: value.slice(match.from, match.to) });
			mark.toggleClass('is-active', active?.rowId === rowId
				&& active.columnId === columnId
				&& active.from === match.from
				&& active.to === match.to);
			offset = Math.max(offset, match.to);
		}
		if (offset < value.length) content.appendText(value.slice(offset));
	}

	private renderMatchingLabel(content: HTMLElement, value: string): void {
		const needle = this.searchContentNeedle;
		if (!needle) { content.appendText(value); return; }
		const haystack = value.toLocaleLowerCase('ko-KR');
		let offset = 0;
		for (let found = haystack.indexOf(needle); found >= 0; found = haystack.indexOf(needle, offset)) {
			content.appendText(value.slice(offset, found));
			content.createSpan({ cls: 'wm-plotbook-search-hit', text: value.slice(found, found + needle.length) });
			offset = found + needle.length;
		}
		content.appendText(value.slice(offset));
	}

	private renderDateCell(cell: HTMLElement, value: string): void {
		this.renderMatchingLabel(cell.createSpan({ cls: `wm-plotbook-date-value${value ? '' : ' is-empty'}` }), value || '날짜 선택');
		const icon = cell.createSpan({ cls: 'wm-plotbook-structured-chevron', attr: { 'aria-hidden': 'true' } });
		setIcon(icon, 'calendar-days');
	}

	private openStatusMenu(event: MouseEvent, rowId: string, columnId: string): void {
		openPlotWorkbookStatusMenu(this.plugin,this.session,event,rowId,columnId);
	}

	private openForeshadowModal(location?: PlotWorkbookForeshadowLocation, selectedId?: string): void {
		new PlotWorkbookForeshadowModal(
			this.plugin,
			this.session,
			location,
			candidate => this.revealForeshadowLocation(candidate),
			selectedId,
		).open();
	}

	private async revealForeshadowLocation(location: PlotWorkbookForeshadowLocation): Promise<boolean> {
		if (this.onRequestRevealLocation) {
			return this.onRequestRevealLocation(location);
		}
		if (this.session.manifest.activeSheetId !== location.sheetId) await this.session.selectSheet(location.sheetId);
		const sheet = this.session.activeSheet;
		const rowIndex = sheet.rowOrder.indexOf(location.rowId);
		const columnIndex = this.columnOrder(sheet).indexOf(location.columnId);
		if (rowIndex < 0 || columnIndex < 0) {
			new Notice('복선이 연결된 셀을 찾을 수 없습니다.');
			return false;
		}
		if (sheet.rows[location.rowId]?.collapsed) this.session.setRowCollapsed(location.rowId, false);
		if (sheet.columns[location.columnId]?.collapsed) this.session.setColumnCollapsed(location.columnId, false);
		this.select(rowIndex, columnIndex, false);
		this.revealSelected(true);
		return true;
	}

	private beginDateEditingCell(cell: HTMLElement, rowIndex: number, columnIndex: number, openPicker = false): void {
		if (this.editingCell) return;
		const sheet = this.session.activeSheet;
		const rowId = sheet.rowOrder[rowIndex];
		const columnId = this.columnOrder(sheet)[columnIndex];
		if (!rowId || !columnId || sheet.columns[columnId]?.role !== 'date') return;
		if (this.renderFrame !== null) {
			window.cancelAnimationFrame(this.renderFrame);
			this.renderFrame = null;
			this.renderRequiresFullRefresh = false;
			this.scrollRenderRequestedAt = 0;
		}
		cell.empty();
		cell.addClass('is-date-editing');
		const input = cell.createEl('input', {
			cls: 'wm-plotbook-cell-editor wm-plotbook-date-editor',
			type: 'text',
			attr: { 'aria-label': '날짜 입력', inputmode: 'numeric', placeholder: 'YYYY-MM-DD', autocomplete: 'off' },
		});
		const picker = cell.createSpan({
			cls: 'wm-plotbook-date-picker',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(picker, 'calendar-days');
		const nativePicker = cell.createEl('input', {
			cls: 'wm-plotbook-date-native-picker',
			type: 'date',
			attr: { 'aria-label': '달력 열기', tabindex: '-1' },
		});
		const before = this.session.getCell(sheet, rowId, columnId);
		input.value = before;
		nativePicker.value = /^\d{4}-\d{2}-\d{2}$/.test(before) ? before : '';
		this.editingCell = input;
		let finished = false;
		const finish = (commit: boolean) => {
			if (finished) return;
			finished = true;
			if (commit) this.session.setCell(rowId, columnId, input.value.trim());
			this.editingCell = null;
			this.scheduleRender();
		};
		nativePicker.addEventListener('change', () => {
			input.value = nativePicker.value;
			finish(true);
		});
		input.addEventListener('blur', () => window.setTimeout(() => {
			if (!finished && cell.ownerDocument.activeElement !== nativePicker) finish(true);
		}, 0));
		input.addEventListener('keydown', keyEvent => {
			if (keyEvent.key === 'Enter') {
				keyEvent.preventDefault();
				finish(true);
				this.viewport.focus();
			} else if (keyEvent.key === 'Escape') {
				keyEvent.preventDefault();
				finish(false);
				this.viewport.focus();
			}
		});
		input.focus();
		if (openPicker) {
			try { (nativePicker as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* click remains usable */ }
		}
	}

	private renderCastCell(cell: HTMLElement, sheet: PlotWorkbookSheet, rowId: string, castColumnId: string): void {
		const paths = this.session.getAppearancePaths(sheet, rowId, castColumnId);
		const strip = cell.createDiv({ cls: 'wm-plotbook-cast-strip' });
		strip.addEventListener('wheel', event => {
			if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
			event.preventDefault();
			event.stopPropagation();
			strip.scrollLeft += event.deltaY;
		}, { passive: false });
		for (const path of paths) {
			const characterColumnId = sheet.columnOrder.find(columnId =>
				sheet.columns[columnId]?.role === 'character'
				&& sheet.columns[columnId]?.characterNotePath === path);
			if (!characterColumnId) continue;
			const profile = this.characterProfile(sheet, characterColumnId);
			const avatar = strip.createEl('button', {
				cls: 'wm-plotbook-profile-avatar clickable-icon',
				attr: { type: 'button', 'aria-label': profile.name },
			});
			avatar.toggleClass('is-search-hit', Boolean(this.searchContentNeedle && profile.name.toLocaleLowerCase('ko-KR').includes(this.searchContentNeedle)));
			this.renderProfileAvatar(avatar, profile);
			avatar.addEventListener('pointerdown', event => event.stopPropagation());
			avatar.addEventListener('click', event => {
				event.stopPropagation();
				this.setTemporaryColumnFocus({
					anchorColumnId: castColumnId,
					columnIds: [characterColumnId],
					source: 'cast',
				});
				const castIndex = this.columnOrder(sheet).indexOf(castColumnId);
				this.selectionMode = 'cell';
				this.selected = { rowIndex: sheet.rowOrder.indexOf(rowId), columnIndex: Math.max(0, castIndex) };
				this.selectionAnchor = { ...this.selected };
				this.scheduleRender();
				this.onSelectionChange?.(this.selected);
				this.restoreGridKeyboardFocus();
			});
		}
	}

	private renderProfileAvatar(
		avatar: HTMLElement,
		profile: { name: string; imageSrc: string },
	): void {
		const fallback = () => {
			avatar.empty();
			avatar.createSpan({ text: profile.name.slice(0, 1) || '?' });
		};
		if (!profile.imageSrc) {
			fallback();
			return;
		}
		const canvas = avatar.createEl('canvas', {
			cls: 'wm-plotbook-profile-canvas',
			attr: { 'aria-hidden': 'true' },
		});
		const ratio = Math.max(2, avatar.ownerDocument.defaultView?.devicePixelRatio ?? 1);
		const pixels = Math.ceil(32 * ratio * Math.max(1, this.zoom));
		canvas.width = pixels;
		canvas.height = pixels;
		const rasterKey = `${profile.imageSrc}\u0000${pixels}`;
		const paintRaster = (raster: HTMLCanvasElement) => {
			const context = canvas.getContext('2d');
			if (!context) return;
			context.clearRect(0, 0, pixels, pixels);
			context.drawImage(raster, 0, 0, pixels, pixels);
		};
		const cachedRaster = this.profileRasterCache.get(rasterKey);
		if (cachedRaster) {
			paintRaster(cachedRaster);
			return;
		}
		let image = this.profileImageCache.get(profile.imageSrc);
		if (!image) {
			image = new Image();
			image.decoding = 'async';
			image.src = profile.imageSrc;
			this.profileImageCache.set(profile.imageSrc, image);
		}
		const draw = () => {
			if (image.naturalWidth < 1 || image.naturalHeight < 1) {
				fallback();
				return;
			}
			const raster = avatar.ownerDocument.createElement('canvas');
			raster.width = pixels;
			raster.height = pixels;
			const context = raster.getContext('2d');
			if (!context) return;
			context.imageSmoothingEnabled = true;
			context.imageSmoothingQuality = 'high';
			const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
			const sourceX = (image.naturalWidth - sourceSize) / 2;
			const sourceY = (image.naturalHeight - sourceSize) / 2;
			context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, pixels, pixels);
			this.profileRasterCache.set(rasterKey, raster);
			paintRaster(raster);
		};
		if (image.complete && image.naturalWidth > 0) draw();
		else {
			image.addEventListener('load', draw, { once: true });
			image.addEventListener('error', () => {
				this.profileImageCache.delete(profile.imageSrc);
				fallback();
			}, { once: true });
		}
	}

	private characterProfile(sheet: PlotWorkbookSheet, columnId: string): { name: string; imageSrc: string; color: string } {
		const column = sheet.columns[columnId];
		const path = column?.characterNotePath ?? '';
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			return {
				name: getWikiDisplayName(this.plugin.app, this.plugin, file),
				imageSrc: getWikiImgSrc(this.plugin.app, this.plugin, file),
				color: getWikiColor(this.plugin.app, this.plugin, file),
			};
		}
		return {
			name: column?.title || path.split('/').pop()?.replace(/\.md$/i, '') || '인물',
			imageSrc: '',
			color: this.plugin.settings.wikiColor || '#7025db',
		};
	}

	private openCellMenu(event: MouseEvent, _cell: HTMLElement, rowIndex: number, columnIndex: number): void {
		event.preventDefault();
		const bounds = this.selectionBounds();
		const sheetBeforeSelection = this.session.activeSheet;
		const rowIdBeforeSelection = sheetBeforeSelection.rowOrder[rowIndex];
		const columnIdBeforeSelection = this.columnOrder(sheetBeforeSelection)[columnIndex];
		const insideSelection = this.selectionMode === 'cell' && (this.selectedCellKeys.size > 0
			? this.selectedCellKeys.has(this.cellKey(rowIdBeforeSelection, columnIdBeforeSelection))
			: rowIndex >= bounds.top && rowIndex <= bounds.bottom
				&& columnIndex >= bounds.left && columnIndex <= bounds.right);
		if (!insideSelection) this.select(rowIndex, columnIndex, false);
		const sheet = this.session.activeSheet;
		const rowId = sheet.rowOrder[rowIndex];
		const columnId = this.columnOrder(sheet)[columnIndex];
		const role = sheet.columns[columnId]?.role ?? 'text';
		const locked = role === 'cast';
		const foreshadow = role === 'foreshadow';
		const subrow = sheet.rows[rowId]?.parentRowId !== undefined;
		const menu = new Menu();
		if (role === 'cast') {
			const appearances = this.session.getAppearancePaths(sheet, rowId, columnId);
			const protectedSubrowAppearances = this.subrowAppearancePaths(sheet, rowId, columnId);
			const removableAppearances = appearances.filter(path => !protectedSubrowAppearances.has(path));
			menu.addItem(item => item
				.setTitle('인물 추가')
				.setIcon('user-plus')
				.setDisabled(subrow)
				.onClick(() => new PlotWorkbookProjectNoteModal(
					this.plugin.app,
					this.configuredProjectFolder(this.characterFolder, 'characterFolder'),
					file => this.addAppearance(rowId, columnId, file),
					'추가할 인물을 검색하세요...',
				).open()));
			menu.addItem(item => item
				.setTitle('인물 제거')
				.setIcon('user-minus')
				.setDisabled(subrow || removableAppearances.length === 0)
				.onClick(() => new PlotWorkbookProjectNoteModal(
					this.plugin.app,
					this.configuredProjectFolder(this.characterFolder, 'characterFolder'),
					file => this.removeAppearance(rowId, columnId, file.path),
					'제거할 인물을 검색하세요...',
					removableAppearances,
				).open()));
			menu.addSeparator();
		}
		menu.addItem(item => item
			.setTitle(role === 'status' ? '상태 선택' : role === 'date' ? '날짜 선택' : foreshadow ? '복선 관리' : role === 'checklist' ? '체크리스트 편집' : '셀 편집')
			.setIcon(role === 'status' ? 'list-todo' : role === 'date' ? 'calendar-days' : foreshadow ? 'sprout' : 'pencil')
			.setDisabled(locked || (subrow && (role === 'status' || role === 'date')))
			.onClick(() => {
				this.select(rowIndex, columnIndex, false);
				if (role === 'status') this.openStatusMenu(event, rowId, columnId);
				else if (role === 'date') this.beginEditingSelected();
				else if (foreshadow) this.openForeshadowModal({ sheetId: sheet.sheetId, rowId, columnId });
				else if (role === 'checklist') this.openChecklistCell(_cell, sheet, rowId, columnId);
				else this.beginEditingSelected();
			}));
		menu.addItem(item => item
			.setTitle(insideSelection && (bounds.top !== bounds.bottom || bounds.left !== bounds.right) ? '선택 영역 모든 내용 삭제' : '모든 내용 삭제')
			.setIcon('eraser')
			.setDisabled(locked || foreshadow)
			.onClick(() => this.clearSelectedRange()));
		menu.addSeparator();
		menu.addItem(item => item
			.setTitle('사이드바에서 보기')
			.setIcon('panel-right')
			.onClick(() => void this.plugin.openPlotWorkbookSidebar({
				projectId:this.session.manifest.projectId, sheetId:sheet.sheetId, rowId, columnId,
			})));
		menu.addItem(item => item
			.setTitle('행 전체 선택')
			.setIcon('rows-3')
			.onClick(() => this.selectWholeRow(rowIndex)));
		menu.addItem(item => item
			.setTitle('열 전체 선택')
			.setIcon('columns-3')
			.onClick(() => this.selectWholeColumn(columnIndex)));
		menu.addSeparator();
		menu.addItem(item => item
			.setTitle('위에 행 추가')
			.setIcon('rows-3')
			.onClick(() => this.selectStructureIds('row', this.session.insertRows(rowIndex))));
		menu.addItem(item => item
			.setTitle('아래에 행 추가')
			.setIcon('rows-3')
			.onClick(() => this.selectStructureIds('row', this.session.insertRows(rowIndex + 1))));
		menu.addItem(item => item
			.setTitle('왼쪽에 열 추가')
			.setIcon('columns-3')
			.onClick(() => this.selectStructureIds('column', this.session.insertColumns(columnIndex))));
		menu.addItem(item => item
			.setTitle('오른쪽에 열 추가')
			.setIcon('columns-3')
			.onClick(() => this.selectStructureIds('column', this.session.insertColumns(columnIndex + 1))));
		menu.addSeparator();
		const rowCollapsed = sheet.rows[rowId]?.collapsed === true;
		const columnCollapsed = sheet.columns[columnId]?.collapsed === true;
		menu.addItem(item => item
			.setTitle(rowCollapsed ? '행 펼치기' : '행 접기')
			.setIcon('rows-3')
			.onClick(() => this.session.setRowCollapsed(rowId, !rowCollapsed)));
		menu.addItem(item => item
			.setTitle(columnCollapsed ? '열 펼치기' : '열 접기')
			.setIcon('columns-3')
			.onClick(() => this.session.setColumnCollapsed(columnId, !columnCollapsed)));
		menu.addSeparator();
		menu.addItem(item => item
			.setTitle('이 행까지 고정')
			.setIcon('pin')
			.setDisabled((sheet.view?.frozenRowCount ?? 0) === rowIndex + 1)
			.onClick(() => this.session.setFrozenRows(rowIndex + 1)));
		menu.addItem(item => item
			.setTitle('이 열까지 고정')
			.setIcon('pin')
			.setDisabled((sheet.view?.frozenColumnCount ?? 0) === columnIndex + 1)
			.onClick(() => this.session.setFrozenColumns(columnIndex + 1)));
		if ((sheet.view?.frozenRowCount ?? 0) > 0) {
			menu.addItem(item => item
				.setTitle('행 고정 해제')
				.setIcon('pin-off')
				.onClick(() => this.session.setFrozenRows(0)));
		}
		if ((sheet.view?.frozenColumnCount ?? 0) > 0) {
			menu.addItem(item => item
				.setTitle('열 고정 해제')
				.setIcon('pin-off')
				.onClick(() => this.session.setFrozenColumns(0)));
		}
		menu.addSeparator();
		menu.addItem(item => item
			.setTitle('스타일 복사')
			.setIcon('copy')
			.onClick(() => {
				if (!rowId || !columnId) return;
				const style = this.session.getCellStyle(sheet, rowId, columnId);
				copiedPlotCellStyle = {
					fontFamily: style.fontFamily,
					fontSize: style.fontSize,
					color: style.color,
					backgroundColor: style.backgroundColor,
				};
			}));
		menu.addItem(item => item
			.setTitle('스타일 붙여넣기')
			.setIcon('clipboard-paste')
			.setDisabled(copiedPlotCellStyle === null)
			.onClick(() => {
				if (!copiedPlotCellStyle) return;
				this.applySelectionStyle({ ...copiedPlotCellStyle });
			}));
		menu.addSeparator();
		menu.addItem(item => item
			.setTitle(insideSelection && (bounds.top !== bounds.bottom || bounds.left !== bounds.right) ? '선택 영역 스냅샷' : '스냅샷')
			.setIcon('camera')
			.setDisabled(locked || foreshadow)
			.onClick(() => {
				const rowLabels = this.buildRowLabels(sheet);
				const targets = this.selectedCellTargets().map(target => {
					const targetRowIndex = sheet.rowOrder.indexOf(target.rowId);
					const targetColumnIndex = sheet.columnOrder.indexOf(target.columnId);
					const targetColumn = sheet.columns[target.columnId];
					return {
						...target,
						label: `${targetColumn?.title || columnLabel(targetColumnIndex)} · ${rowLabels.get(target.rowId) ?? targetRowIndex + 1}`,
					};
				});
				new PlotWorkbookSnapshotModal(this.plugin, this.session, targets).open();
			}));
		menu.showAtMouseEvent(event);
	}

	private addAppearance(rowId: string, castColumnId: string, file: TFile): void {
		const sheet = this.session.activeSheet;
		if (sheet.rows[rowId]?.parentRowId) return;
		const explicit = this.session.getExplicitAppearancePaths(sheet, rowId, castColumnId);
		if (!explicit.includes(file.path)) this.session.setAppearancePaths(rowId, castColumnId, [...explicit, file.path]);
		const characterColumnId = this.session.ensureCharacterColumn(file.path, castColumnId);
		if (!characterColumnId) return;
		const currentSheet = this.session.activeSheet;
		const orderedColumnIds = this.session.getAppearancePaths(currentSheet, rowId, castColumnId)
			.map(path => currentSheet.columnOrder.find(id => currentSheet.columns[id]?.role === 'character'
				&& currentSheet.columns[id]?.characterNotePath === path))
			.filter((id): id is string => typeof id === 'string');
		this.setTemporaryColumnFocus({ anchorColumnId: castColumnId, columnIds: orderedColumnIds, source: 'cast' });
		this.scheduleRender();
		this.restoreGridKeyboardFocus();
	}

	private removeAppearance(rowId: string, castColumnId: string, notePath: string): void {
		const sheet = this.session.activeSheet;
		if (sheet.rows[rowId]?.parentRowId) return;
		if (this.subrowAppearancePaths(sheet, rowId, castColumnId).has(notePath)) return;
		this.session.removeAppearancePath(rowId, castColumnId, notePath);
		const remainingColumnIds = this.session.getAppearancePaths(this.session.activeSheet, rowId, castColumnId)
			.map(path => sheet.columnOrder.find(id => sheet.columns[id]?.role === 'character'
				&& sheet.columns[id]?.characterNotePath === path))
			.filter((id): id is string => typeof id === 'string');
		this.setTemporaryColumnFocus(remainingColumnIds.length > 0
			? { anchorColumnId: castColumnId, columnIds: remainingColumnIds, source: 'cast' }
			: null);
		this.scheduleRender();
		this.restoreGridKeyboardFocus();
	}

	private restoreGridKeyboardFocus(): void {
		window.requestAnimationFrame(() => {
			if (!this.viewport.isConnected) return;
			this.viewport.focus({ preventScroll: true });
			this.refreshSelectionBox();
		});
	}

	private subrowAppearancePaths(sheet: PlotWorkbookSheet, rowId: string, castColumnId: string): Set<string> {
		const paths = new Set<string>();
		if (sheet.rows[rowId]?.parentRowId) return paths;
		for (const candidateRowId of sheet.rowOrder) {
			if (sheet.rows[candidateRowId]?.parentRowId !== rowId) continue;
			for (const path of this.session.getAppearancePaths(sheet, candidateRowId, castColumnId)) paths.add(path);
		}
		return paths;
	}

	private configuredProjectFolder(
		configured: string,
		kind?: 'manuscriptFolder' | 'characterFolder',
	): string {
		const initialRoot = normalizePath(this.projectRoot.trim()).replace(/^\/+|\/+$/g, '');
		const liveProject = this.plugin.settings.projects.find(project =>
			normalizePath(project.rootFolder.trim()).replace(/^\/+|\/+$/g, '') === initialRoot);
		const root = normalizePath((liveProject?.rootFolder ?? this.projectRoot).trim()).replace(/^\/+|\/+$/g, '');
		const liveConfigured = kind && liveProject ? liveProject[kind] : configured;
		const candidate = normalizePath(liveConfigured.trim()).replace(/^\/+|\/+$/g, '');
		if (!candidate) return root;
		if (!root || candidate === root || candidate.startsWith(`${root}/`)) return candidate;
		// Settings may contain a project-relative path such as “본문”. Resolve it
		// under the selected project instead of silently falling back to its root.
		return normalizePath(`${root}/${candidate}`);
	}

	private async openCharacterNote(notePath: string): Promise<void> {
		await openPlotWorkbookCharacter(this.plugin,notePath);
	}

	private renderRowHeader(sheet: PlotWorkbookSheet, rowId: string, rowIndex: number, label: string, rows: AxisLayout): void {
		const row = sheet.rows[rowId];
		const selected = this.selectionMode === 'headers'
			|| (this.selectionMode === 'row' && this.selectedRowIdsSet.has(rowId));
		const frozenRowCount = this.frozenRowCount(sheet);
		const frozen = rowIndex < frozenRowCount;
		const header = (frozen ? this.frozenRowHeadersLayer : this.rowHeadersLayer).createDiv({
			cls: `wm-plotbook-row-header${row.parentRowId ? ' is-subrow' : ''}${row.collapsed ? ' is-collapsed' : ''}${selected ? ' is-selected' : ''}${frozen ? ' is-frozen' : ''}${rowIndex === frozenRowCount - 1 ? ' is-freeze-edge' : ''}`,
		});
		header.dataset.row = String(rowIndex);
		this.applyCellStyle(header, this.headerDisplayStyle('row', row.style ?? {}));
		header.draggable = true;
		if (row.linkedNotePath) {
			const link = header.createEl('button', {
				cls: 'wm-plotbook-row-label is-linked',
				text: label,
				attr: { type: 'button', 'aria-label': `본문 열기: ${row.linkedNotePath}` },
			});
			link.addEventListener('pointerdown', event => event.stopPropagation());
			link.addEventListener('click', event => {
				event.stopPropagation();
				void this.plugin.app.workspace.openLinkText(row.linkedNotePath!, '', false);
			});
		} else header.createSpan({ cls: 'wm-plotbook-row-label', text: label });
		header.style.top = `${rows.offsets[rowIndex] + (frozen ? 0 : this.columnHeaderHeight(sheet))}px`;
		header.style.width = `${this.rowHeaderWidth(sheet)}px`;
		header.style.height = `${rows.sizes[rowIndex]}px`;
		header.addEventListener('pointerdown', event => {
			if (event.button !== 0 || (event.target as HTMLElement).closest('.wm-plotbook-row-resizer, .wm-plotbook-header-band-resizer')) return;
			if (row.collapsed) {
				event.preventDefault();
				event.stopPropagation();
				this.session.setRowCollapsed(rowId, false);
				return;
			}
			const toggle = event.ctrlKey || event.metaKey;
			const alreadySelected = this.selectionMode === 'row' && this.selectedRowIdsSet.has(rowId);
			if (toggle || event.shiftKey || !alreadySelected) this.selectWholeRow(rowIndex, event.shiftKey, toggle);
			this.viewport.focus();
		});
		header.addEventListener('contextmenu', event => {
			event.preventDefault();
			if (!(this.selectionMode === 'row' && this.selectedRowIdsSet.has(rowId))) {
				this.selectWholeRow(rowIndex);
			}
			const actionIds = this.selectedRowIds(sheet, this.selectionBounds());
			const explicitlySelectedRowIds = this.selectionMode === 'row'
				? sheet.rowOrder.filter(id => this.selectedRowIdsSet.has(id))
				: [rowId];
			const singleMainRow = !row.parentRowId
				&& explicitlySelectedRowIds.length === 1
				&& explicitlySelectedRowIds[0] === rowId;
			const menu = new Menu();
			menu.addItem(item => item
				.setTitle(row.linkedNotePath ? '본문 연결 변경' : '본문 연결')
				.setIcon('file-text')
				.setDisabled(!singleMainRow)
				.onClick(() => new PlotWorkbookProjectNoteModal(
					this.plugin.app,
					this.configuredProjectFolder(this.manuscriptFolder, 'manuscriptFolder'),
					file => {
						if (!this.session.setRowLinkedNote(rowId, file.path)) {
							new Notice('이 본문 노트는 이미 다른 정식 행에 연결되어 있습니다.');
						}
					},
					'연결할 본문 노트를 검색하세요...',
				).open()));
			menu.addItem(item => item
				.setTitle('본문 생성')
				.setIcon('file-plus-2')
				.setDisabled(!singleMainRow)
				.onClick(() => new PlotWorkbookCreateNoteModal(
					this.plugin.app,
					this.configuredProjectFolder(this.manuscriptFolder, 'manuscriptFolder'),
					`${label}화`,
					file => {
						if (this.session.setRowLinkedNote(rowId, file.path)) {
							new Notice(`본문 노트를 만들고 ${label}번 행에 연결했습니다.`);
						}
					},
				).open()));
			if (row.linkedNotePath) {
				menu.addItem(item => item
					.setTitle('본문 연결 해제')
					.setIcon('unlink')
					.setDisabled(!singleMainRow)
					.onClick(() => this.session.setRowLinkedNote(rowId)));
			}
			menu.addItem(item => item
				.setTitle('번호 시작값 설정')
				.setIcon('list-ordered')
				.onClick(() => new PlotWorkbookNumberingModal(
					this.plugin.app,
					sheet.view?.rowNumberStart ?? 1,
					value => this.session.setRowNumberStart(value),
				).open()));
			const continuationStart = this.previousSheetContinuationStart(sheet);
			if (continuationStart !== null) {
				menu.addItem(item => item
					.setTitle(`이전 시트에 이어 번호 매기기 (${continuationStart}부터)`)
					.setIcon('list-plus')
					.onClick(() => this.session.setRowNumberStart(continuationStart)));
			}
			menu.addSeparator();
			menu.addItem(item => item
				.setTitle('세부 행 추가')
				.setIcon('plus')
				.onClick(() => this.addSubrow(rowId)));
			menu.addItem(item => item
				.setTitle(actionIds.length > 1 ? '선택한 행 복제' : '행 복제')
				.setIcon('copy')
				.onClick(() => {
					const duplicated = this.session.duplicateRows(actionIds);
					if (duplicated.length > 0) this.selectStructureIds('row', duplicated);
				}));
			menu.addItem(item => item
				.setTitle(row.collapsed ? '행 펼치기' : '행 접기')
				.setIcon('rows-3')
				.onClick(() => this.session.setRowCollapsed(rowId, !row.collapsed)));
			menu.addItem(item => item
				.setTitle(`이 행까지 고정`)
				.setIcon('pin')
				.setDisabled((sheet.view?.frozenRowCount ?? 0) === rowIndex + 1)
				.onClick(() => this.session.setFrozenRows(rowIndex + 1)));
			if ((sheet.view?.frozenRowCount ?? 0) > 0) {
				menu.addItem(item => item
					.setTitle('행 고정 해제')
					.setIcon('pin-off')
					.onClick(() => this.session.setFrozenRows(0)));
			}
			menu.addSeparator();
			menu.addItem(item => item
				.setTitle(actionIds.length > 1 ? '선택한 행 삭제' : (row.parentRowId ? '세부 행 삭제' : '회차와 세부 행 삭제'))
				.setIcon('trash-2')
				.setDisabled(actionIds.length >= sheet.rowOrder.length)
				.onClick(() => {
					if (!this.session.deleteRows(actionIds)) {
						new Notice('마지막 행은 삭제할 수 없습니다.');
						return;
					}
					this.selectionAnchor = { ...this.selected };
					this.clampSelection(this.session.activeSheet);
					this.refreshSelectionBox();
					new Notice('행을 삭제했습니다. 실행 취소로 복원할 수 있습니다.');
				}));
			menu.showAtMouseEvent(event);
		});
		header.addEventListener('dragstart', event => this.beginStructureDrag(event, 'row', rowId, rowIndex, header));
		header.addEventListener('dragover', event => this.updateStructureDragTarget(event, 'row', header));
		header.addEventListener('drop', event => this.finishStructureDrag(event, 'row', rowId));
		header.addEventListener('dragend', () => this.clearStructureDrag());
		const handle = header.createDiv({ cls: 'wm-plotbook-row-resizer' });
		handle.addEventListener('pointerdown', event => this.beginRowResize(event, sheet, rowId, rows.sizes[rowIndex], header));
		handle.addEventListener('dblclick', event => {
			event.stopPropagation();
			this.session.resizeRow(rowId, undefined);
		});
		const headerWidthHandle = header.createDiv({ cls: 'wm-plotbook-header-band-resizer is-width' });
		headerWidthHandle.addEventListener('pointerdown', event => this.beginHeaderResize(event, 'width'));
		headerWidthHandle.addEventListener('dblclick', event => {
			event.stopPropagation();
			this.session.resizeHeaders(DEFAULT_ROW_HEADER_WIDTH, this.columnHeaderHeight(this.session.activeSheet));
		});
	}

	private addSubrow(rowId: string): void {
		const addedId = this.session.addSubrow(rowId);
		if (!addedId) return;
		window.requestAnimationFrame(() => {
			const addedIndex = this.session.activeSheet.rowOrder.indexOf(addedId);
			if (addedIndex >= 0) this.select(addedIndex, 0);
			this.viewport.focus();
		});
	}

	private clampSelection(sheet: PlotWorkbookSheet): void {
		const maxRow = Math.max(0, sheet.rowOrder.length - 1);
		const maxColumn = Math.max(0, this.columnOrder(sheet).length - 1);
		this.selected = {
			rowIndex: Math.min(maxRow, Math.max(0, this.selected.rowIndex)),
			columnIndex: Math.min(maxColumn, Math.max(0, this.selected.columnIndex)),
		};
		this.selectionAnchor = {
			rowIndex: Math.min(maxRow, Math.max(0, this.selectionAnchor.rowIndex)),
			columnIndex: Math.min(maxColumn, Math.max(0, this.selectionAnchor.columnIndex)),
		};
		this.selectedRowIdsSet = new Set([...this.selectedRowIdsSet].filter(id => Boolean(sheet.rows[id])));
		this.selectedColumnIdsSet = new Set([...this.selectedColumnIdsSet].filter(id => Boolean(sheet.columns[id])));
	}

	private renderColumnHeader(sheet: PlotWorkbookSheet, columnId: string, columnIndex: number, columns: AxisLayout): void {
		const column = sheet.columns[columnId];
		const fallback = columnLabel(columnIndex);
		const role = column.role ?? 'text';
		const roleLabel = COLUMN_ROLES.find(candidate => candidate.value === role)?.label ?? '일반';
		const label = this.session.manifest.labels?.find(candidate => candidate.id === column.labelId);
		const selected = this.selectionMode === 'headers'
			|| (this.selectionMode === 'column' && this.selectedColumnIdsSet.has(columnId));
		const frozenColumnCount = this.frozenColumnCount(sheet);
		const frozen = columnIndex < frozenColumnCount;
		const fixedRoleTitle = role === 'cast' ? '등장' : role === 'foreshadow' ? '복선' : null;
		const titleParts = [fallback, fixedRoleTitle ?? (column.title || roleLabel)];
		if (column.title && !fixedRoleTitle) titleParts.push(roleLabel);
		if (column.trackingEnabled) titleParts.push('추적');
		if (label) titleParts.push(`라벨: ${label.name}`);
		if (!column.title && role === 'text') titleParts.push('더블클릭하여 제목 변경');
		const header = (frozen ? this.frozenColumnHeadersLayer : this.columnHeadersLayer).createDiv({
			cls: `wm-plotbook-column-header${column.title ? ' has-title' : ''}${column.collapsed ? ' is-collapsed' : ''}${selected ? ' is-selected' : ''}${frozen ? ' is-frozen' : ''}${columnIndex === frozenColumnCount - 1 ? ' is-freeze-edge' : ''}`,
			attr: { title: titleParts.join(' · ') },
		});
		if (column.collapsed) header.setAttribute('title', fixedRoleTitle ?? (column.title || roleLabel || fallback));
		this.applyCellStyle(header, this.headerDisplayStyle('column', column.style ?? {}));
		header.dataset.column = String(columnIndex);
		header.dataset.role = role;
		if (role === 'character') {
			header.removeAttribute('title');
			const profile = this.characterProfile(sheet, columnId);
			const profileEl = header.createDiv({ cls: 'wm-plotbook-character-header' });
			profileEl.style.setProperty('--wm-plotbook-character-color', profile.color);
			const characterName = profileEl.createSpan({
				cls: `wm-plotbook-character-name${column.characterNotePath ? ' is-link' : ''}`,
				text: profile.name,
				attr: column.characterNotePath ? {
					'aria-label': `인물 노트 열기: ${profile.name}`,
				} : undefined,
			});
			if (column.characterNotePath) {
				characterName.addEventListener('pointerdown', event => event.stopPropagation());
				characterName.addEventListener('click', event => {
					event.stopPropagation();
					void this.openCharacterNote(column.characterNotePath!);
				});
			}
		} else {
			header.createSpan({ cls: 'wm-plotbook-column-label', text: fixedRoleTitle ?? (column.title || fallback) });
		}
		const roleIconName = role === 'text' ? undefined : COLUMN_ROLE_ICONS[role];
		if (roleIconName || column.trackingEnabled || label) {
			header.addClass('has-meta');
			const meta = header.createDiv({ cls: 'wm-plotbook-column-meta' });
			if (column.trackingEnabled) {
				const trackingIcon = meta.createSpan({
					cls: 'wm-plotbook-tracking-icon',
					attr: { 'aria-label': '추적 활성화' },
				});
				setIcon(trackingIcon, 'locate-fixed');
			}
			if (roleIconName) {
				const roleIcon = meta.createSpan({
					cls: `wm-plotbook-role-icon is-${role}`,
					attr: { 'aria-label': `열 상태: ${roleLabel}` },
				});
				setIcon(roleIcon, roleIconName);
			}
			if (label) {
				const labelDot = meta.createSpan({
					cls: 'wm-plotbook-label-dot',
					attr: { title: label.name, 'aria-label': `라벨: ${label.name}` },
				});
				labelDot.style.backgroundColor = label.color;
			}
		}
		header.draggable = true;
		header.style.left = `${columns.offsets[columnIndex] + (frozen ? 0 : this.rowHeaderWidth(sheet))}px`;
		header.style.width = `${columns.sizes[columnIndex]}px`;
		header.style.height = `${this.columnHeaderHeight(sheet)}px`;
		header.addEventListener('pointerdown', event => {
			if (event.button !== 0 || (event.target as HTMLElement).closest('.wm-plotbook-column-resizer, .wm-plotbook-header-band-resizer')) return;
			if (column.collapsed) {
				event.preventDefault();
				event.stopPropagation();
				this.session.setColumnCollapsed(columnId, false);
				return;
			}
			const toggle = event.ctrlKey || event.metaKey;
			const alreadySelected = this.selectionMode === 'column' && this.selectedColumnIdsSet.has(columnId);
			if (toggle || event.shiftKey || !alreadySelected) this.selectWholeColumn(columnIndex, event.shiftKey, toggle);
			this.viewport.focus();
		});
		header.addEventListener('dblclick', event => {
			if ((event.target as HTMLElement).closest('.wm-plotbook-column-resizer')) return;
			if (role === 'cast' || role === 'status') return;
			this.beginColumnRename(header, columnId, column.title ?? '');
		});
		header.addEventListener('contextmenu', event => {
			event.preventDefault();
			if (!(this.selectionMode === 'column' && this.selectedColumnIdsSet.has(columnId))) {
				this.selectWholeColumn(columnIndex);
			}
			const actionBounds = this.selectionBounds();
			const actionIds = this.selectionMode === 'column'
				? this.columnOrder(sheet).filter(id => this.selectedColumnIdsSet.has(id))
				: this.columnOrder(sheet).slice(actionBounds.left, actionBounds.right + 1);
			const menu = new Menu();
			menu.addItem(item => item
				.setTitle('열 제목 변경')
				.setIcon('pencil')
				.setDisabled(actionIds.length !== 1 || role === 'cast' || role === 'status')
				.onClick(() => this.beginColumnRename(header, columnId, column.title ?? '')));
			menu.addItem(item => item
				.setTitle(actionIds.length > 1 ? '선택한 열 복제' : '열 복제')
				.setIcon('copy')
				.onClick(() => {
					const duplicated = this.session.duplicateColumns(actionIds);
					if (duplicated.length > 0) this.selectStructureIds('column', duplicated);
				}));
			menu.addItem(item => item
				.setTitle(column.collapsed ? '열 펼치기' : '열 접기')
				.setIcon('columns-3')
				.onClick(() => this.session.setColumnCollapsed(columnId, !column.collapsed)));
			menu.addSeparator();
			for (const option of COLUMN_ROLES) {
				const allSelected = actionIds.every(id => (sheet.columns[id]?.role ?? 'text') === option.value);
				menu.addItem(item => item
					.setTitle(option.label)
					.setIcon(COLUMN_ROLE_ICONS[option.value] ?? 'text')
					.setChecked(allSelected)
					.setDisabled(option.value === 'character' && actionIds.length !== 1)
					.onClick(() => {
						if (allSelected) return;
						if (option.value === 'character') {
							new PlotWorkbookCharacterModal(this.plugin, this.configuredProjectFolder(this.characterFolder, 'characterFolder'), file =>
								this.session.assignCharacterColumn(actionIds[0], file.path)).open();
							return;
						}
						if (option.value === 'cast') {
							new PlotWorkbookCastConfirmModal(this.plugin.app, () => this.session.setCastColumns(actionIds)).open();
							return;
						}
						if (option.value === 'status' || option.value === 'date' || option.value === 'foreshadow' || option.value === 'checklist') {
							const structuredRole = option.value;
							const roleLabel = structuredRole === 'status' ? '상태' : structuredRole === 'date' ? '날짜' : structuredRole === 'checklist' ? '체크리스트' : '복선';
							new PlotWorkbookRoleConfirmModal(this.plugin.app, roleLabel, () =>
								this.session.setStructuredColumns(actionIds, structuredRole)).open();
							return;
						}
						this.session.setColumnRole(actionIds, option.value);
					}));
			}
			if (actionIds.some(id => sheet.columns[id]?.role === 'foreshadow')) {
				menu.addItem(item => item
					.setTitle('복선 목록')
					.setIcon('list')
					.onClick(() => this.openForeshadowModal()));
			}
			menu.addSeparator();
			menu.addItem(item => item
				.setTitle('다른 시트로 이동')
				.setIcon('move-right')
				.setDisabled(this.session.manifest.sheets.length <= 1 || actionIds.length >= sheet.columnOrder.length)
				.onClick(() => new PlotWorkbookMoveColumnsModal(this.plugin, this.session, actionIds).open()));
			menu.addSeparator();
			const trackableIds = actionIds.filter(id => sheet.columns[id]?.role !== 'cast');
			const allTracking = trackableIds.length > 0
				&& trackableIds.every(id => sheet.columns[id]?.trackingEnabled === true);
			menu.addItem(item => item
				.setTitle(allTracking ? '추적 해제' : '추적')
				.setIcon(allTracking ? 'locate-off' : 'locate-fixed')
				.setChecked(allTracking)
				.setDisabled(trackableIds.length === 0)
				.onClick(() => {
					this.session.setColumnTracking(trackableIds, !allTracking);
					if (allTracking && this.temporaryColumnFocus
						&& trackableIds.includes(this.temporaryColumnFocus.anchorColumnId)) {
						this.setTemporaryColumnFocus(null);
						this.scheduleRender();
					}
				}));
			menu.addItem(item => item
				.setTitle('라벨')
				.setIcon('tag')
				.onClick(() => new PlotWorkbookLabelModal(this.plugin, this.session, actionIds).open()));
			menu.addSeparator();
			menu.addItem(item => item
				.setTitle('이 열까지 고정')
				.setIcon('pin')
				.setDisabled((sheet.view?.frozenColumnCount ?? 0) === columnIndex + 1)
				.onClick(() => this.session.setFrozenColumns(columnIndex + 1)));
			if ((sheet.view?.frozenColumnCount ?? 0) > 0) {
				menu.addItem(item => item
					.setTitle('열 고정 해제')
					.setIcon('pin-off')
					.onClick(() => this.session.setFrozenColumns(0)));
			}
			menu.addSeparator();
			menu.addItem(item => item
				.setTitle(actionIds.length > 1 ? '선택한 열 삭제' : '열 삭제')
				.setIcon('trash-2')
				.setDisabled(actionIds.length >= this.columnOrder(sheet).length)
				.onClick(() => {
					if (!this.session.deleteColumns(actionIds)) {
						new Notice('마지막 열은 삭제할 수 없습니다.');
						return;
					}
					this.clampSelection(this.session.activeSheet);
					this.refreshSelectionBox();
					new Notice('열을 삭제했습니다. 실행 취소로 복원할 수 있습니다.');
				}));
			menu.showAtMouseEvent(event);
		});
		header.addEventListener('dragstart', event => this.beginStructureDrag(event, 'column', columnId, columnIndex, header));
		header.addEventListener('dragover', event => this.updateStructureDragTarget(event, 'column', header));
		header.addEventListener('drop', event => this.finishStructureDrag(event, 'column', columnId));
		header.addEventListener('dragend', () => this.clearStructureDrag());
		const handle = header.createDiv({ cls: 'wm-plotbook-column-resizer' });
		handle.addEventListener('pointerdown', event => this.beginColumnResize(event, sheet, columnId, columns.sizes[columnIndex], header));
		handle.addEventListener('dblclick', event => {
			event.stopPropagation();
			this.session.resizeColumn(columnId, undefined);
		});
		const headerHeightHandle = header.createDiv({ cls: 'wm-plotbook-header-band-resizer is-height' });
		headerHeightHandle.addEventListener('pointerdown', event => this.beginHeaderResize(event, 'height'));
		headerHeightHandle.addEventListener('dblclick', event => {
			event.stopPropagation();
			this.session.resizeHeaders(this.rowHeaderWidth(this.session.activeSheet), DEFAULT_COLUMN_HEADER_HEIGHT);
		});
	}

	private beginHeaderResize(event: PointerEvent, axis: 'width' | 'height'): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const sheet = this.session.activeSheet;
		const startX = event.clientX;
		const startY = event.clientY;
		const initialWidth = this.rowHeaderWidth(sheet);
		const initialHeight = this.columnHeaderHeight(sheet);
		let width = initialWidth;
		let height = initialHeight;
		const move = (moveEvent: PointerEvent) => {
			if (axis === 'width') width = Math.max(36, Math.min(240, initialWidth + (moveEvent.clientX - startX) / this.zoom));
			else height = Math.max(48, Math.min(120, initialHeight + (moveEvent.clientY - startY) / this.zoom));
			this.headerSizePreview = { width, height };
			this.showResizeGuide(
				axis === 'width' ? 'column' : 'row',
				axis === 'width' ? this.logicalScrollLeft() + width : this.logicalScrollTop() + height,
			);
			this.scheduleRender();
		};
		const finish = (commit: boolean) => {
			activeWindow.removeEventListener('pointermove', move);
			activeWindow.removeEventListener('pointerup', up);
			activeWindow.removeEventListener('pointercancel', cancel);
			this.headerSizePreview = null;
			this.hideResizeGuide();
			if (commit) this.session.resizeHeaders(width, height);
			else this.scheduleRender();
		};
		const up = () => finish(true);
		const cancel = () => finish(false);
		activeWindow.addEventListener('pointermove', move);
		activeWindow.addEventListener('pointerup', up, { once: true });
		activeWindow.addEventListener('pointercancel', cancel, { once: true });
	}

	private beginRowResize(event: PointerEvent, _sheet: PlotWorkbookSheet, rowId: string, initial: number, header: HTMLElement): void {
		event.preventDefault();
		event.stopPropagation();
		const start = event.clientY;
		const headerTop = (Number.parseFloat(header.style.top) || 0)
			+ (header.hasClass('is-frozen') ? this.logicalScrollTop() + this.columnHeaderHeight(this.session.activeSheet) : 0);
		let next = initial;
		this.showResizeGuide('row', headerTop + next);
		const move = (moveEvent: PointerEvent) => {
			next = Math.max(22, Math.min(240, initial + (moveEvent.clientY - start) / this.zoom));
			header.style.height = `${next}px`;
			this.showResizeGuide('row', headerTop + next);
		};
		const finish = (commit: boolean) => {
			activeWindow.removeEventListener('pointermove', move);
			activeWindow.removeEventListener('pointerup', up);
			activeWindow.removeEventListener('pointercancel', cancel);
			this.hideResizeGuide();
			if (commit) this.session.resizeRow(rowId, next);
			else this.scheduleRender();
		};
		const up = () => finish(true);
		const cancel = () => finish(false);
		activeWindow.addEventListener('pointermove', move);
		activeWindow.addEventListener('pointerup', up, { once: true });
		activeWindow.addEventListener('pointercancel', cancel, { once: true });
	}

	private beginColumnResize(event: PointerEvent, _sheet: PlotWorkbookSheet, columnId: string, initial: number, header: HTMLElement): void {
		event.preventDefault();
		event.stopPropagation();
		const start = event.clientX;
		const headerLeft = (Number.parseFloat(header.style.left) || 0)
			+ (header.hasClass('is-frozen') ? this.logicalScrollLeft() + this.rowHeaderWidth(this.session.activeSheet) : 0);
		let next = initial;
		this.showResizeGuide('column', headerLeft + next);
		const move = (moveEvent: PointerEvent) => {
			next = Math.max(56, Math.min(640, initial + (moveEvent.clientX - start) / this.zoom));
			header.style.width = `${next}px`;
			this.showResizeGuide('column', headerLeft + next);
		};
		const finish = (commit: boolean) => {
			activeWindow.removeEventListener('pointermove', move);
			activeWindow.removeEventListener('pointerup', up);
			activeWindow.removeEventListener('pointercancel', cancel);
			this.hideResizeGuide();
			if (commit) this.session.resizeColumn(columnId, next);
			else this.scheduleRender();
		};
		const up = () => finish(true);
		const cancel = () => finish(false);
		activeWindow.addEventListener('pointermove', move);
		activeWindow.addEventListener('pointerup', up, { once: true });
		activeWindow.addEventListener('pointercancel', cancel, { once: true });
	}

	private showResizeGuide(axis: 'row' | 'column', position: number): void {
		this.resizeGuide.className = `wm-plotbook-resize-guide is-${axis}`;
		if (axis === 'row') {
			this.resizeGuide.style.top = `${Math.round(position)}px`;
			this.resizeGuide.style.left = '0';
		} else {
			this.resizeGuide.style.left = `${Math.round(position)}px`;
			this.resizeGuide.style.top = '0';
		}
	}

	private hideResizeGuide(): void {
		this.resizeGuide.addClass('is-hidden');
	}

	private beginColumnRename(header: HTMLElement, columnId: string, title: string): void {
		const role = this.session.activeSheet.columns[columnId]?.role;
		if (header.querySelector('input') || role === 'cast' || role === 'status' || role === 'foreshadow') return;
		header.textContent = '';
		const input = header.createEl('input', {
			cls: 'wm-plotbook-column-title-editor',
			attr: { 'aria-label': '열 제목' },
		});
		input.value = title;
		let finished = false;
		const finish = (save: boolean) => {
			if (finished) return;
			finished = true;
			if (save) this.session.renameColumn(columnId, input.value);
			this.scheduleRender();
		};
		input.addEventListener('pointerdown', event => event.stopPropagation());
		input.addEventListener('blur', () => finish(true));
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				finish(true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				finish(false);
			}
		});
		input.focus();
		input.select();
	}

	private beginStructureDrag(
		event: DragEvent,
		axis: 'row' | 'column',
		id: string,
		_index: number,
		header: HTMLElement,
	): void {
		if ((event.target as HTMLElement).closest('.wm-plotbook-row-resizer, .wm-plotbook-column-resizer, .wm-plotbook-header-band-resizer, input')) {
			event.preventDefault();
			return;
		}
		const sheet = this.session.activeSheet;
		const bounds = this.selectionBounds();
		let ids: string[];
		if (axis === 'row') {
			ids = this.selectionMode === 'row' && this.selectedRowIdsSet.has(id)
				? this.selectedRowIds(sheet, bounds)
				: this.rowBlockIds(sheet, id);
		} else {
			ids = this.selectionMode === 'column' && this.selectedColumnIdsSet.has(id)
				? this.columnOrder(sheet).filter(columnId => this.selectedColumnIdsSet.has(columnId))
				: [id];
		}
		this.structureDrag = { axis, ids };
		header.addClass('is-drag-source');
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(`text/x-writing-menu-${axis}`, ids.join(','));
		}
	}

	private updateStructureDragTarget(event: DragEvent, axis: 'row' | 'column', header: HTMLElement): void {
		if (!this.structureDrag || this.structureDrag.axis !== axis) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		if (this.structureDragTarget === header) return;
		this.structureDragTarget?.removeClass('is-drag-target');
		this.structureDragTarget = header;
		header.addClass('is-drag-target');
	}

	private finishStructureDrag(event: DragEvent, axis: 'row' | 'column', targetId: string): void {
		event.preventDefault();
		const drag = this.structureDrag;
		if (!drag || drag.axis !== axis) return;
		const sheet = this.session.activeSheet;
		const targetIds = axis === 'row' ? this.rowBlockIds(sheet, targetId) : [targetId];
		const moved = axis === 'row'
			? this.session.swapRowBlocks(drag.ids, targetIds)
			: this.session.swapColumnBlocks(drag.ids, targetIds);
		if (moved) this.selectStructureIds(axis, drag.ids);
		this.clearStructureDrag();
	}

	private clearStructureDrag(): void {
		this.structureDragTarget?.removeClass('is-drag-target');
		this.structureDragTarget = null;
		this.structureDrag = null;
		this.element.querySelectorAll('.wm-plotbook-row-header.is-drag-source, .wm-plotbook-column-header.is-drag-source')
			.forEach(element => element.removeClass('is-drag-source'));
	}

	private selectedRowIds(sheet: PlotWorkbookSheet, bounds: SelectionBounds): string[] {
		const selected = this.selectionMode === 'row' && this.selectedRowIdsSet.size > 0
			? new Set(this.selectedRowIdsSet)
			: new Set(sheet.rowOrder.slice(bounds.top, bounds.bottom + 1));
		for (const rowId of [...selected]) {
			if (sheet.rows[rowId]?.parentRowId) continue;
			for (const candidate of sheet.rowOrder) {
				if (sheet.rows[candidate]?.parentRowId === rowId) selected.add(candidate);
			}
		}
		return sheet.rowOrder.filter(rowId => selected.has(rowId));
	}

	private rowBlockIds(sheet: PlotWorkbookSheet, rowId: string): string[] {
		const row = sheet.rows[rowId];
		if (!row) return [];
		if (row.parentRowId) return [rowId];
		return [rowId, ...sheet.rowOrder.filter(id => sheet.rows[id]?.parentRowId === rowId)];
	}

	private selectStructureIds(axis: 'row' | 'column', ids: string[]): void {
		const sheet = this.session.activeSheet;
		const order = axis === 'row' ? sheet.rowOrder : this.columnOrder(sheet);
		const indices = ids.map(id => order.indexOf(id)).filter(index => index >= 0).sort((left, right) => left - right);
		if (indices.length === 0) return;
		if (axis === 'row') {
			this.selectedCellKeys.clear();
			this.selectionMode = 'row';
			this.selectedRowIdsSet = new Set(ids.filter(id => Boolean(sheet.rows[id])));
			this.selectedColumnIdsSet.clear();
			this.selectionAnchor = { rowIndex: indices[0], columnIndex: this.selected.columnIndex };
			this.selected = { rowIndex: indices[indices.length - 1], columnIndex: this.selected.columnIndex };
		} else {
			this.selectedCellKeys.clear();
			this.selectionMode = 'column';
			this.selectedColumnIdsSet = new Set(ids.filter(id => Boolean(sheet.columns[id])));
			this.selectedRowIdsSet.clear();
			this.selectionAnchor = { rowIndex: this.selected.rowIndex, columnIndex: indices[0] };
			this.selected = { rowIndex: this.selected.rowIndex, columnIndex: indices[indices.length - 1] };
		}
		this.refreshSelectionBox();
		this.onSelectionChange?.(this.selected);
	}

	private beginCellDrag(event: DragEvent, cell: HTMLElement, rowIndex: number, columnIndex: number): void {
		if (this.editingCell) {
			event.preventDefault();
			return;
		}
		this.clearCellDrag();
		this.dragSource = { rowIndex, columnIndex };
		this.dragSourceCell = cell;
		cell.addClass('is-drag-source');
		// Keep the native source mounted. Hit testing ignores the expanded
		// preview so destinations beneath it are available as well.
		this.selectedCellPreview.addClass('is-dragging-cell');
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/x-writing-menu-cell', `${rowIndex}:${columnIndex}`);
		}
	}

	private updateCellDragTarget(event: DragEvent, cell: HTMLElement): void {
		if (!this.dragSource) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		if (this.dragTargetCell === cell) return;
		this.dragTargetCell?.removeClass('is-drag-target');
		this.dragTargetCell = cell;
		cell.addClass('is-drag-target');
	}

	private finishCellDrag(event: DragEvent, rowIndex: number, columnIndex: number): void {
		event.preventDefault();
		const source = this.dragSource;
		if (!source) return;
		const sheet = this.session.activeSheet;
		const sourceRowId = sheet.rowOrder[source.rowIndex];
		const sourceColumnId = this.columnOrder(sheet)[source.columnIndex];
		const targetRowId = sheet.rowOrder[rowIndex];
		const targetColumnId = this.columnOrder(sheet)[columnIndex];
		if (sourceRowId && sourceColumnId && targetRowId && targetColumnId) {
			this.session.swapCells(sourceRowId, sourceColumnId, targetRowId, targetColumnId);
			this.select(rowIndex, columnIndex, false);
		}
		this.clearCellDrag();
	}

	private clearCellDrag(): void {
		this.selectedCellPreview.removeClass('is-dragging-cell');
		this.dragSourceCell?.removeClass('is-drag-source');
		this.dragSourceCell = null;
		this.dragTargetCell?.removeClass('is-drag-target');
		this.dragTargetCell = null;
		this.dragSource = null;
	}

	private beginFill(event: PointerEvent): void {
		if (event.button !== 0 || this.selectionMode !== 'cell') return;
		event.preventDefault();
		event.stopPropagation();
		const source = this.selectionBounds();
		this.fillTarget = null;
		const move = (moveEvent: PointerEvent) => this.updateFillTarget(moveEvent, source);
		const finish = (commit: boolean, finishEvent?: PointerEvent) => {
			activeWindow.removeEventListener('pointermove', move);
			activeWindow.removeEventListener('pointerup', up);
			activeWindow.removeEventListener('pointercancel', cancel);
			this.hideFillPreviews();
			if (commit && this.fillTarget) {
				this.applyFill(source, this.fillTarget, Boolean(finishEvent?.ctrlKey || finishEvent?.metaKey));
			}
			this.fillTarget = null;
		};
		const up = (upEvent: PointerEvent) => finish(true, upEvent);
		const cancel = () => finish(false);
		activeWindow.addEventListener('pointermove', move);
		activeWindow.addEventListener('pointerup', up, { once: true });
		activeWindow.addEventListener('pointercancel', cancel, { once: true });
	}

	private updateFillTarget(event: PointerEvent, source: SelectionBounds): void {
		this.autoScrollForPointer(event);
		const target = this.cellFromPoint(event.clientX, event.clientY);
		if (!target || !this.canvas.contains(target)) return;
		const rowIndex = Number.parseInt(target.dataset.row ?? '', 10);
		const columnIndex = Number.parseInt(target.dataset.column ?? '', 10);
		if (!Number.isFinite(rowIndex) || !Number.isFinite(columnIndex)) return;
		const candidate = { rowIndex, columnIndex };
		const axis = this.fillAxis(source, candidate);
		if (!axis) {
			this.fillTarget = null;
			this.hideFillPreviews();
			return;
		}
		this.fillTarget = candidate;
		const preview = axis === 'row'
			? { top: Math.min(source.top, rowIndex), bottom: Math.max(source.bottom, rowIndex), left: source.left, right: source.right }
			: { top: source.top, bottom: source.bottom, left: Math.min(source.left, columnIndex), right: Math.max(source.right, columnIndex) };
		const sheet = this.session.activeSheet;
		const rows = this.axisLayout(sheet.rowOrder.map(id => plotRowHeight(sheet, id)));
		const columns = this.axisLayout(this.columnOrder(sheet).map(id => plotColumnWidth(sheet, id)));
		this.showFillPreviews(preview, rows, columns);
	}

	private hideFillPreviews(resetBounds = true): void {
		if (resetBounds) this.fillPreviewBounds = null;
		for (const preview of this.fillPreviews) {
			preview.addClass('is-hidden');
			if (preview.parentElement !== this.canvas) this.canvas.appendChild(preview);
			preview.removeClass('is-on-frozen-pane');
		}
	}

	private showFillPreviews(bounds: SelectionBounds, rows: AxisLayout, columns: AxisLayout): void {
		this.fillPreviewBounds = { ...bounds };
		this.hideFillPreviews(false);
		const sheet = this.session.activeSheet;
		const frozenRows = this.frozenRowCount(sheet);
		const frozenColumns = this.frozenColumnCount(sheet);
		const rowBands = [
			{ top: bounds.top, bottom: Math.min(bounds.bottom, frozenRows - 1), frozen: true },
			{ top: Math.max(bounds.top, frozenRows), bottom: bounds.bottom, frozen: false },
		].filter(band => band.top <= band.bottom);
		const columnBands = [
			{ left: bounds.left, right: Math.min(bounds.right, frozenColumns - 1), frozen: true },
			{ left: Math.max(bounds.left, frozenColumns), right: bounds.right, frozen: false },
		].filter(band => band.left <= band.right);
		let previewIndex = 0;
		for (const rowBand of rowBands) {
			for (const columnBand of columnBands) {
				const preview = this.fillPreviews[previewIndex++];
				if (!preview) return;
				const parent = rowBand.frozen && columnBand.frozen
					? this.frozenCornerCellsLayer
					: rowBand.frozen
						? this.frozenRowsCellsLayer
						: columnBand.frozen ? this.frozenColumnsCellsLayer : this.canvas;
				parent.appendChild(preview);
				preview.toggleClass('is-on-frozen-pane', parent !== this.canvas);
				this.positionOverlay(preview, {
					top: rowBand.top,
					bottom: rowBand.bottom,
					left: columnBand.left,
					right: columnBand.right,
				}, rows, columns);
				preview.removeClass('is-hidden');
			}
		}
	}

	private autoScrollForPointer(event: PointerEvent): void {
		const rect = this.viewport.getBoundingClientRect();
		const edge = 32;
		let deltaX = 0;
		let deltaY = 0;
		if (event.clientY < rect.top + edge) deltaY = -24;
		else if (event.clientY > rect.bottom - edge) deltaY = 24;
		if (event.clientX < rect.left + edge) deltaX = -24;
		else if (event.clientX > rect.right - edge) deltaX = 24;
		if (deltaX || deltaY) {
			this.viewport.scrollBy(deltaX, deltaY);
			this.scheduleRender(true);
		}
	}

	private applyFill(source: SelectionBounds, target: PlotSheetSelection, forceSeries: boolean): void {
		const axis = this.fillAxis(source, target);
		if (!axis) return;
		const sheet = this.session.activeSheet;
		const updates: Array<{ rowId: string; columnId: string; value: string }> = [];
		if (axis === 'row') {
			const downward = target.rowIndex > source.bottom;
			const sourceRows = this.integerRange(source.top, source.bottom);
			if (!downward) sourceRows.reverse();
			const destinationRows = downward
				? this.integerRange(source.bottom + 1, target.rowIndex)
				: this.integerRange(target.rowIndex, source.top - 1).reverse();
			for (let columnIndex = source.left; columnIndex <= source.right; columnIndex++) {
				const columnId = this.columnOrder(sheet)[columnIndex];
				const values = sourceRows.map(rowIndex => this.session.getCell(sheet, sheet.rowOrder[rowIndex], columnId));
				for (let offset = 0; offset < destinationRows.length; offset++) {
					const rowId = sheet.rowOrder[destinationRows[offset]];
					updates.push({
						rowId,
						columnId,
						value: this.fillValue(values, offset, forceSeries, downward ? 1 : -1),
					});
				}
			}
		} else {
			const rightward = target.columnIndex > source.right;
			const sourceColumns = this.integerRange(source.left, source.right);
			if (!rightward) sourceColumns.reverse();
			const destinationColumns = rightward
				? this.integerRange(source.right + 1, target.columnIndex)
				: this.integerRange(target.columnIndex, source.left - 1).reverse();
			for (let rowIndex = source.top; rowIndex <= source.bottom; rowIndex++) {
				const rowId = sheet.rowOrder[rowIndex];
				const values = sourceColumns.map(columnIndex => this.session.getCell(sheet, rowId, this.columnOrder(sheet)[columnIndex]));
				for (let offset = 0; offset < destinationColumns.length; offset++) {
					const columnId = this.columnOrder(sheet)[destinationColumns[offset]];
					updates.push({
						rowId,
						columnId,
						value: this.fillValue(values, offset, forceSeries, rightward ? 1 : -1),
					});
				}
			}
		}
		this.session.setCells(updates);
		const union = axis === 'row'
			? { top: Math.min(source.top, target.rowIndex), bottom: Math.max(source.bottom, target.rowIndex), left: source.left, right: source.right }
			: { top: source.top, bottom: source.bottom, left: Math.min(source.left, target.columnIndex), right: Math.max(source.right, target.columnIndex) };
		this.selectionAnchor = { rowIndex: union.top, columnIndex: union.left };
		this.selected = { rowIndex: union.bottom, columnIndex: union.right };
		this.refreshSelectionBox();
		this.onSelectionChange?.(this.selected);
	}

	private fillValue(values: string[], offset: number, forceSeries: boolean, direction: number): string {
		if (values.length === 0) return '';
		if (values.length >= 2) {
			const before = this.parseSequenceToken(values[values.length - 2]);
			const edge = this.parseSequenceToken(values[values.length - 1]);
			if (before && edge && before.prefix === edge.prefix && before.suffix === edge.suffix) {
				const delta = edge.number - before.number;
				return this.formatSequenceToken(edge, edge.number + delta * (offset + 1));
			}
		}
		if (values.length === 1 && forceSeries) {
			const edge = this.parseSequenceToken(values[0]);
			if (edge) return this.formatSequenceToken(edge, edge.number + direction * (offset + 1));
		}
		return values[offset % values.length];
	}

	private parseSequenceToken(value: string): { prefix: string; suffix: string; number: number; width: number } | null {
		const match = value.match(/^(.*?)(-?\d+)([^\d]*)$/);
		if (!match) return null;
		const number = Number.parseInt(match[2], 10);
		if (!Number.isFinite(number)) return null;
		return {
			prefix: match[1],
			suffix: match[3],
			number,
			width: match[2].replace(/^-/, '').length,
		};
	}

	private formatSequenceToken(token: { prefix: string; suffix: string; width: number }, number: number): string {
		const sign = number < 0 ? '-' : '';
		const digits = String(Math.abs(number)).padStart(token.width, '0');
		return `${token.prefix}${sign}${digits}${token.suffix}`;
	}

	private fillAxis(source: SelectionBounds, target: PlotSheetSelection): 'row' | 'column' | null {
		const rowDistance = target.rowIndex < source.top
			? source.top - target.rowIndex
			: target.rowIndex > source.bottom ? target.rowIndex - source.bottom : 0;
		const columnDistance = target.columnIndex < source.left
			? source.left - target.columnIndex
			: target.columnIndex > source.right ? target.columnIndex - source.right : 0;
		if (rowDistance === 0 && columnDistance === 0) return null;
		return rowDistance >= columnDistance ? 'row' : 'column';
	}

	private beginEditingSelected(initialValue?: string, replace = false): void {
		if (this.selectionMode !== 'cell') return;
		const selector = `.wm-plotbook-cell[data-row="${this.selected.rowIndex}"][data-column="${this.selected.columnIndex}"]`;
		const cell = this.canvas.querySelector<HTMLElement>(selector);
		if (!cell) return;
		const sheet = this.session.activeSheet;
		const columnId = this.columnOrder(sheet)[this.selected.columnIndex];
		const role = sheet.columns[columnId]?.role;
		if (role === 'date') {
			this.beginDateEditingCell(cell, this.selected.rowIndex, this.selected.columnIndex);
			return;
		}
		if (role === 'foreshadow') {
			const rowId = sheet.rowOrder[this.selected.rowIndex];
			if (rowId && columnId) this.openForeshadowModal({ sheetId: sheet.sheetId, rowId, columnId });
			return;
		}
		if (role === 'checklist') {
			const rowId = sheet.rowOrder[this.selected.rowIndex];
			if (rowId && columnId) this.openChecklistCell(cell, sheet, rowId, columnId);
			return;
		}
		if (role === 'status' || role === 'cast') return;
		this.beginEditingCell(cell, this.selected.rowIndex, this.selected.columnIndex, initialValue, replace);
	}

	private beginEditingCell(cell: HTMLElement, rowIndex: number, columnIndex: number, initialValue?: string, replace = false): void {
		if (this.editingCell) return;
		const sheet = this.session.activeSheet;
		const rowId = sheet.rowOrder[rowIndex];
		const columnId = this.columnOrder(sheet)[columnIndex];
		const role = sheet.columns[columnId]?.role;
		if (!rowId || !columnId || role === 'cast' || role === 'status' || role === 'date' || role === 'foreshadow' || role === 'checklist') return;
		this.clearCellDrag();
		this.clearSelectionPreview();
		if (this.renderFrame !== null) {
			window.cancelAnimationFrame(this.renderFrame);
			this.renderFrame = null;
			this.renderRequiresFullRefresh = false;
			this.scrollRenderRequestedAt = 0;
		}
		this.selected = { rowIndex, columnIndex };
		this.selectionAnchor = { rowIndex, columnIndex };
		this.selectionMode = 'cell';
		this.refreshSelectionBox();
		this.onSelectionChange?.(this.selected);
		const before = this.session.getCell(sheet, rowId, columnId);
		const wasDraggable = cell.draggable;
		cell.draggable = false;
		cell.textContent = '';
		const input = cell.createEl('textarea', {
			cls: 'wm-plotbook-cell-editor',
			attr: { rows: '1', wrap: 'soft', spellcheck: 'false' },
		});
		const style = this.session.getCellStyle(sheet, rowId, columnId);
		const themeMode = themeModeFromDocument(input.ownerDocument);
		input.style.color = style.color
			? resolveThemeColor(style.color, themeMode, DEFAULT_TEXT_COLORS)
			: '';
		input.style.backgroundColor = style.backgroundColor
			? resolveThemeColor(style.backgroundColor, themeMode, DEFAULT_BACKGROUND_COLORS)
			: '';
		input.style.textAlign = style.alignment ?? 'left';
		input.value = initialValue !== undefined ? initialValue : before;
		cell.addClass('is-editing-expanded');
		this.selectionBox.addClass('is-editing-cell');
		this.editingCell = input;
		this.editorSize = new PlotWorkbookCellEditorSize(input, cell, this.viewport, this.zoom);
		let finished = false;
		const finish = (commit: boolean) => {
			if (finished) return;
			finished = true;
			this.editorSize?.destroy();
			this.editorSize = null;
			const value = input.value;
			// Remove the temporary expanded editor before moving the selection. Waiting
			// for the scheduled grid render leaves its large border visible for one
			// frame and makes it overlap the next selection after Enter.
			input.remove();
			cell.draggable = wasDraggable;
			cell.removeClass('is-editing-expanded');
			cell.setText(commit ? value : before);
			this.selectionBox.removeClass('is-editing-cell');
			if (commit) this.session.setCell(rowId, columnId, value);
			this.editingCell = null;
			this.scheduleRender();
		};
		input.addEventListener('blur', () => finish(true));
		input.addEventListener('keydown', event => {
			if (event.isComposing) return;
			if (event.key === 'Escape') {
				event.preventDefault();
				finish(false);
				this.viewport.focus();
			} else if (event.key === 'Enter' && (event.shiftKey || event.altKey)) {
				event.preventDefault();
				const start = input.selectionStart ?? input.value.length;
				const end = input.selectionEnd ?? start;
				input.setRangeText('\n', start, end, 'end');
				input.dispatchEvent(new Event('input', { bubbles: true }));
			} else if (event.key === 'Enter') {
				event.preventDefault();
				finish(true);
				if (rowIndex + 1 >= this.session.activeSheet.rowOrder.length) {
					this.session.appendRows(100);
				}
				const nextColumnIndex = this.columnOrder(this.session.activeSheet).indexOf(columnId);
				this.select(rowIndex + 1, Math.max(0, nextColumnIndex));
				this.scheduleRender();
				this.viewport.focus();
			}
		});
		input.focus();
		if (!replace) input.select();
		else input.setSelectionRange(input.value.length, input.value.length);
	}

	private clearSelectedRange(): void {
		if (this.selectionMode === 'headers') return;
		this.session.setCells(this.selectedCellTargets().map(target => ({ ...target, value: '' })));
	}

	private positionSelection(sheet: PlotWorkbookSheet, rows: AxisLayout, columns: AxisLayout): void {
		const rowHeaderWidth = this.rowHeaderWidth(sheet);
		const columnHeaderHeight = this.columnHeaderHeight(sheet);
		const bounds = this.selectionBounds();
		bounds.bottom = Math.min(bounds.bottom, sheet.rowOrder.length - 1);
		bounds.right = Math.min(bounds.right, this.columnOrder(sheet).length - 1);
		const visibleColumns = this.columnOrder(sheet);
		const lockedSelection = this.selectionMode === 'cell'
			&& visibleColumns.slice(bounds.left, bounds.right + 1)
				.some(columnId => sheet.columns[columnId]?.role === 'cast' || sheet.columns[columnId]?.role === 'foreshadow');
		this.selectionBox.classList.toggle('is-row-selection', this.selectionMode === 'row');
		this.selectionBox.classList.toggle('is-column-selection', this.selectionMode === 'column');
		this.selectionBox.classList.toggle('is-header-selection', this.selectionMode === 'headers');
		this.selectionBox.classList.toggle('is-locked-selection', lockedSelection);
		const discontiguous = this.axisSelectionIsDiscontiguous(sheet);
		this.selectionBox.classList.toggle('is-discontiguous', discontiguous);
		if (discontiguous) {
			this.selectionBox.style.width = '0';
			this.selectionBox.style.height = '0';
			return;
		}
		const whollyFrozenRows = this.frozenRowCount(sheet) > 0 && bounds.bottom < this.frozenRowCount(sheet);
		const whollyFrozenColumns = this.frozenColumnCount(sheet) > 0 && bounds.right < this.frozenColumnCount(sheet);
		let selectionParent = this.canvas;
		if (this.selectionMode === 'cell') {
			if (whollyFrozenRows && whollyFrozenColumns) selectionParent = this.frozenCornerCellsLayer;
			else if (whollyFrozenRows) selectionParent = this.frozenRowsCellsLayer;
			else if (whollyFrozenColumns) selectionParent = this.frozenColumnsCellsLayer;
		}
		if (this.selectionBox.parentElement !== selectionParent) selectionParent.appendChild(this.selectionBox);
		this.selectionBox.classList.toggle(
			'is-on-frozen-pane',
			this.selectionMode !== 'headers' && (whollyFrozenRows || whollyFrozenColumns),
		);
		if (this.selectionMode === 'row') {
			const top = columnHeaderHeight + rows.offsets[bounds.top];
			const bottom = columnHeaderHeight + rows.offsets[bounds.bottom] + rows.sizes[bounds.bottom];
			this.selectionBox.style.left = `${rowHeaderWidth}px`;
			this.selectionBox.style.top = `${top}px`;
			this.selectionBox.style.width = `${Math.max(0, this.logicalViewportWidth() - rowHeaderWidth)}px`;
			this.selectionBox.style.height = `${Math.max(0, bottom - top)}px`;
			this.setOverlayScrollTransform(this.selectionBox, true, whollyFrozenRows);
			return;
		}
		if (this.selectionMode === 'column') {
			const left = rowHeaderWidth + columns.offsets[bounds.left];
			const right = rowHeaderWidth + columns.offsets[bounds.right] + columns.sizes[bounds.right];
			this.selectionBox.style.left = `${left}px`;
			this.selectionBox.style.top = `${columnHeaderHeight}px`;
			this.selectionBox.style.width = `${Math.max(0, right - left)}px`;
			this.selectionBox.style.height = `${Math.max(0, this.logicalViewportHeight() - columnHeaderHeight)}px`;
			this.setOverlayScrollTransform(this.selectionBox, whollyFrozenColumns, true);
			return;
		}
		if (this.selectionMode === 'headers') {
			this.selectionBox.style.width = '0';
			this.selectionBox.style.height = '0';
			this.setOverlayScrollTransform(this.selectionBox, false, false);
			return;
		}
		this.positionOverlay(this.selectionBox, bounds, rows, columns);
	}

	private positionOverlay(element: HTMLElement, bounds: SelectionBounds, rows: AxisLayout, columns: AxisLayout): void {
		const sheet = this.session.activeSheet;
		const whollyFrozenColumns = this.frozenColumnCount(sheet) > 0 && bounds.right < this.frozenColumnCount(sheet);
		const whollyFrozenRows = this.frozenRowCount(sheet) > 0 && bounds.bottom < this.frozenRowCount(sheet);
		const inFrozenLayer = element.parentElement !== this.canvas;
		const originLeft = inFrozenLayer ? 0 : this.rowHeaderWidth(sheet);
		const originTop = inFrozenLayer ? 0 : this.columnHeaderHeight(sheet);
		const left = originLeft + columns.offsets[bounds.left];
		const right = originLeft + columns.offsets[bounds.right] + columns.sizes[bounds.right];
		const top = originTop + rows.offsets[bounds.top];
		const bottom = originTop + rows.offsets[bounds.bottom] + rows.sizes[bounds.bottom];
		element.style.left = `${left}px`;
		element.style.top = `${top}px`;
		element.style.width = `${Math.max(0, right - left)}px`;
		element.style.height = `${Math.max(0, bottom - top)}px`;
		this.setOverlayScrollTransform(element, !inFrozenLayer && whollyFrozenColumns, !inFrozenLayer && whollyFrozenRows);
	}

	private setOverlayScrollTransform(element: HTMLElement, x: boolean, y: boolean): void {
		element.classList.toggle('is-scroll-x', x);
		element.classList.toggle('is-scroll-y', y);
	}

	private selectionBounds(): SelectionBounds {
		const sheet = this.session.activeSheet;
		if (this.selectionMode === 'headers') {
			return { top: 0, bottom: sheet.rowOrder.length - 1, left: 0, right: this.columnOrder(sheet).length - 1 };
		}
		if (this.selectionMode === 'row') {
			const indices = [...this.selectedRowIdsSet]
				.map(id => sheet.rowOrder.indexOf(id))
				.filter(index => index >= 0);
			const top = indices.length > 0 ? Math.min(...indices) : this.selected.rowIndex;
			const bottom = indices.length > 0 ? Math.max(...indices) : this.selected.rowIndex;
			return {
				top,
				bottom,
				left: 0,
				right: this.columnOrder(sheet).length - 1,
			};
		}
		if (this.selectionMode === 'column') {
			const order = this.columnOrder(sheet);
			const indices = [...this.selectedColumnIdsSet]
				.map(id => order.indexOf(id))
				.filter(index => index >= 0);
			const left = indices.length > 0 ? Math.min(...indices) : this.selected.columnIndex;
			const right = indices.length > 0 ? Math.max(...indices) : this.selected.columnIndex;
			return {
				top: 0,
				bottom: sheet.rowOrder.length - 1,
				left,
				right,
			};
		}
		if (this.selectedCellKeys.size > 0) {
			const order = this.columnOrder(sheet);
			const positions = [...this.selectedCellKeys].flatMap(key => {
				const [rowId, columnId] = this.cellIdsFromKey(key);
				const rowIndex = sheet.rowOrder.indexOf(rowId);
				const columnIndex = order.indexOf(columnId);
				return rowIndex >= 0 && columnIndex >= 0 ? [{ rowIndex, columnIndex }] : [];
			});
			if (positions.length > 0) return {
				top: Math.min(...positions.map(position => position.rowIndex)),
				bottom: Math.max(...positions.map(position => position.rowIndex)),
				left: Math.min(...positions.map(position => position.columnIndex)),
				right: Math.max(...positions.map(position => position.columnIndex)),
			};
		}
		return {
			top: Math.min(this.selectionAnchor.rowIndex, this.selected.rowIndex),
			bottom: Math.max(this.selectionAnchor.rowIndex, this.selected.rowIndex),
			left: Math.min(this.selectionAnchor.columnIndex, this.selected.columnIndex),
			right: Math.max(this.selectionAnchor.columnIndex, this.selected.columnIndex),
		};
	}

	// Appearance values remain protected; only formatting may include those cells.
	private selectedCellTargets(forFormatting = false): Array<{ rowId: string; columnId: string }> {
		const sheet = this.session.activeSheet;
		if (this.selectionMode === 'cell' && this.selectedCellKeys.size > 0) {
			return [...this.selectedCellKeys].flatMap(key => {
				const [rowId, columnId] = this.cellIdsFromKey(key);
				return sheet.rows[rowId] && sheet.columns[columnId] && (forFormatting || sheet.columns[columnId]?.role !== 'cast')
					? [{ rowId, columnId }]
					: [];
			});
		}
		const bounds = this.selectionBounds();
		const rowIds = this.selectionMode === 'row'
			? sheet.rowOrder.filter(id => this.selectedRowIdsSet.has(id))
			: sheet.rowOrder.slice(bounds.top, bounds.bottom + 1);
		const visibleColumns = this.columnOrder(sheet);
		const columnIds = this.selectionMode === 'column'
			? visibleColumns.filter(id => this.selectedColumnIdsSet.has(id))
			: visibleColumns.slice(bounds.left, bounds.right + 1);
		const targets: Array<{ rowId: string; columnId: string }> = [];
		for (const rowId of rowIds) {
			for (const columnId of columnIds) {
				if (columnId && (forFormatting || sheet.columns[columnId]?.role !== 'cast')) targets.push({ rowId, columnId });
			}
		}
		return targets;
	}

	private selectedHeaderIds(): { rowIds: string[]; columnIds: string[] } {
		const sheet = this.session.activeSheet;
		if (this.selectionMode === 'headers') {
			return { rowIds: [...sheet.rowOrder], columnIds: [...sheet.columnOrder] };
		}
		if (this.selectionMode === 'row') {
			return { rowIds: sheet.rowOrder.filter(id => this.selectedRowIdsSet.has(id)), columnIds: [] };
		}
		if (this.selectionMode === 'column') {
			return { rowIds: [], columnIds: this.columnOrder(sheet).filter(id => this.selectedColumnIdsSet.has(id)) };
		}
		return { rowIds: [], columnIds: [] };
	}

	private axisSelectionIsDiscontiguous(sheet: PlotWorkbookSheet): boolean {
		if (this.selectionMode === 'cell' && this.selectedCellKeys.size > 1) return true;
		const indices = this.selectionMode === 'row'
			? sheet.rowOrder.map((id, index) => this.selectedRowIdsSet.has(id) ? index : -1).filter(index => index >= 0)
			: this.selectionMode === 'column'
				? this.columnOrder(sheet).map((id, index) => this.selectedColumnIdsSet.has(id) ? index : -1).filter(index => index >= 0)
				: [];
		return indices.some((index, position) => position > 0 && index !== indices[position - 1] + 1);
	}

	private cellKey(rowId: string, columnId: string): string {
		return `${rowId}\u0000${columnId}`;
	}

	private cellIdsFromKey(key: string): [string, string] {
		const separator = key.indexOf('\u0000');
		return separator < 0 ? [key, ''] : [key.slice(0, separator), key.slice(separator + 1)];
	}

	private applyCellStyle(cell: HTMLElement, style: PlotWorkbookCellStyle): void {
		cell.style.fontFamily = style.fontFamily ?? '';
		cell.style.fontSize = style.fontSize ? `${style.fontSize}px` : '';
		this.applyCellThemeColor(cell, style.color, 'text');
		this.applyCellThemeColor(cell, style.backgroundColor, 'background');
		cell.style.fontWeight = style.bold ? '700' : '';
		cell.style.fontStyle = style.italic ? 'italic' : '';
		cell.style.textDecoration = [
			style.underline ? 'underline' : '',
			style.strikethrough ? 'line-through' : '',
		].filter(Boolean).join(' ');
		cell.style.justifyContent = style.alignment === 'center'
			? 'center'
			: style.alignment === 'right' ? 'flex-end' : 'flex-start';
		cell.style.textAlign = style.alignment ?? 'left';
	}

	private applyCellThemeColor(
		cell: HTMLElement,
		color: ThemeAwareColor | undefined,
		target: 'text' | 'background',
	): void {
		const className = target === 'text' ? 'wm-themed-text-color' : 'wm-themed-background-color';
		const lightVariable = target === 'text' ? '--wm-themed-text-light' : '--wm-themed-background-light';
		const darkVariable = target === 'text' ? '--wm-themed-text-dark' : '--wm-themed-background-dark';
		cell.removeClass(className);
		cell.style.removeProperty(lightVariable);
		cell.style.removeProperty(darkVariable);
		if (target === 'text') cell.style.color = '';
		else cell.style.backgroundColor = '';
		if (!color) return;
		if (typeof color === 'string') {
			if (target === 'text') cell.style.color = color;
			else cell.style.backgroundColor = color;
			return;
		}
		cell.addClass(className);
		cell.style.setProperty(lightVariable, color.light);
		cell.style.setProperty(darkVariable, color.dark);
	}

	private refreshSelectionBox(): void {
		const sheet = this.session.activeSheet;
		const rows = this.axisLayout(sheet.rowOrder.map(id => plotRowHeight(sheet, id)));
		const columns = this.axisLayout(this.columnOrder(sheet).map(id => plotColumnWidth(sheet, id)));
		this.positionSelection(sheet, rows, columns);
	}

	private clearSelectionPreview(): void {
		this.selectedCellPreviewSource?.removeClass('has-selected-cell-preview');
		this.selectedCellPreviewSource = null;
		this.selectedCellPreview.addClass('is-hidden');
		this.selectedCellPreview.draggable = false;
		this.selectedCellPreviewContent.empty();
		this.selectedCellPreviewContent.removeAttribute('data-role');
		this.selectedCellPreview.style.removeProperty('height');
		this.selectedCellPreview.style.removeProperty('--wm-plotbook-preview-background');
		this.selectedCellPreview.removeClass('is-on-frozen-pane', 'is-scroll-x', 'is-scroll-y');
		this.selectionBox.removeClass('is-previewing-cell');
	}

	private refreshSelectionPreview(): void {
		if (this.selectionMode !== 'cell' || this.selectedCellKeys.size > 0 || this.editingCell
			|| this.selected.rowIndex !== this.selectionAnchor.rowIndex
			|| this.selected.columnIndex !== this.selectionAnchor.columnIndex) {
			this.clearSelectionPreview();
			return;
		}
		const sheet = this.session.activeSheet;
		const rowId = sheet.rowOrder[this.selected.rowIndex];
		const columnId = this.columnOrder(sheet)[this.selected.columnIndex];
		const row = sheet.rows[rowId];
		const column = sheet.columns[columnId];
		if (!rowId || !columnId || row?.collapsed || column?.collapsed) {
			this.clearSelectionPreview();
			return;
		}
		const value = this.session.getCell(sheet, rowId, columnId);
		const role = column.role ?? 'text';
		const selector = `.wm-plotbook-cell[data-row="${this.selected.rowIndex}"][data-column="${this.selected.columnIndex}"]`;
		const cell = this.canvas.querySelector<HTMLElement>(selector);
		if (!cell?.isConnected || !this.cellHasHiddenContent(cell, role, value)) {
			this.clearSelectionPreview();
			return;
		}
		const rows = this.axisLayout(sheet.rowOrder.map(id => plotRowHeight(sheet, id)));
		const columns = this.axisLayout(this.columnOrder(sheet).map(id => plotColumnWidth(sheet, id)));
		const frozen = this.selected.rowIndex < this.frozenRowCount(sheet)
			|| this.selected.columnIndex < this.frozenColumnCount(sheet);
		this.selectedCellPreviewSource?.removeClass('has-selected-cell-preview');
		this.selectedCellPreviewSource = cell;
		this.selectedCellPreview.draggable = cell.draggable;
		cell.addClass('has-selected-cell-preview');
		this.renderSelectionPreviewContent(cell, sheet, rowId, columnId, role, value);
		this.applyCellStyle(this.selectedCellPreview, this.session.getCellStyle(sheet, rowId, columnId));
		const computedBackground = cell.ownerDocument.defaultView?.getComputedStyle(cell).backgroundColor ?? '';
		const transparentBackground = !computedBackground
			|| computedBackground === 'transparent'
			|| /rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/u.test(computedBackground);
		if (cell.classList.contains('wm-themed-background-color')) {
			this.selectedCellPreview.style.removeProperty('--wm-plotbook-preview-background');
		} else {
			this.selectedCellPreview.style.setProperty(
				'--wm-plotbook-preview-background',
				transparentBackground ? 'var(--background-primary)' : computedBackground,
			);
		}
		this.selectedCellPreview.removeClass('is-hidden');
		this.selectedCellPreview.toggleClass('is-on-frozen-pane', frozen);
		this.positionOverlay(this.selectedCellPreview, {
			top: this.selected.rowIndex,
			bottom: this.selected.rowIndex,
			left: this.selected.columnIndex,
			right: this.selected.columnIndex,
		}, rows, columns);
		this.selectedCellPreview.style.height = `${cell.clientHeight}px`;
		const viewportRect = this.viewport.getBoundingClientRect();
		const cellRect = cell.getBoundingClientRect();
		const available = Math.max(cell.clientHeight, (viewportRect.bottom - cellRect.top) / this.zoom - 12);
		this.selectedCellPreview.style.height = `${Math.max(
			cell.clientHeight,
			Math.min(this.selectedCellPreviewContent.scrollHeight + 4, available, 360),
		)}px`;
		this.selectionBox.addClass('is-previewing-cell');
	}

	private cellHasHiddenContent(cell: HTMLElement, role: PlotWorkbookColumnRole, value: string): boolean {
		if (role === 'checklist' && parseChecklist(value).length > 2) return true;
		if (!value && role !== 'cast' && role !== 'status' && role !== 'date' && role !== 'foreshadow') return false;
		return [cell, ...cell.querySelectorAll<HTMLElement>('*')].some(element =>
			element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1);
	}

	private renderSelectionPreviewContent(
		cell: HTMLElement,
		sheet: PlotWorkbookSheet,
		rowId: string,
		columnId: string,
		role: PlotWorkbookColumnRole,
		value: string,
	): void {
		this.selectedCellPreviewContent.empty();
		this.selectedCellPreviewContent.style.removeProperty('--wm-plotbook-preview-avatar-width');
		this.selectedCellPreviewContent.style.removeProperty('--wm-plotbook-preview-avatar-height');
		this.selectedCellPreviewContent.dataset.role = role;
		if (role === 'checklist') {
			this.selectedCellPreview.setAttribute('role', 'group');
			this.selectedCellPreview.setAttribute('aria-label', '선택한 체크리스트 미리보기');
			this.selectedCellPreview.removeAttribute('aria-readonly');
			this.renderChecklistCell(this.selectedCellPreviewContent, sheet, rowId, columnId, value, Infinity);
			return;
		}
		this.selectedCellPreview.setAttribute('role', 'textbox');
		this.selectedCellPreview.setAttribute('aria-readonly', 'true');
		this.selectedCellPreview.removeAttribute('aria-label');
		if (role === 'cast') {
			const sourceAvatar = cell.querySelector<HTMLElement>('.wm-plotbook-profile-avatar');
			if (sourceAvatar && sourceAvatar.offsetWidth > 0 && sourceAvatar.offsetHeight > 0) {
				this.selectedCellPreviewContent.style.setProperty('--wm-plotbook-preview-avatar-width', `${sourceAvatar.offsetWidth}px`);
				this.selectedCellPreviewContent.style.setProperty('--wm-plotbook-preview-avatar-height', `${sourceAvatar.offsetHeight}px`);
			}
			this.renderCastCell(this.selectedCellPreviewContent, sheet, rowId, columnId);
			return;
		}
		if (role === 'status' || role === 'date' || role === 'foreshadow') {
			for (const child of Array.from(cell.childNodes)) this.selectedCellPreviewContent.appendChild(child.cloneNode(true));
			return;
		}
		this.renderSearchableText(this.selectedCellPreviewContent, value, rowId, columnId);
	}

	private revealSelection(center = false): void {
		const sheet = this.session.activeSheet;
		const rowHeaderWidth = this.rowHeaderWidth(sheet);
		const columnHeaderHeight = this.columnHeaderHeight(sheet);
		const rows = this.axisLayout(sheet.rowOrder.map(id => plotRowHeight(sheet, id)));
		const columns = this.axisLayout(this.columnOrder(sheet).map(id => plotColumnWidth(sheet, id)));
		const cellTop = columnHeaderHeight + rows.offsets[this.selected.rowIndex];
		const cellBottom = cellTop + rows.sizes[this.selected.rowIndex];
		const cellLeft = rowHeaderWidth + columns.offsets[this.selected.columnIndex];
		const cellRight = cellLeft + columns.sizes[this.selected.columnIndex];
		const scrollTop = this.logicalScrollTop();
		const scrollLeft = this.logicalScrollLeft();
		const viewportHeight = this.logicalViewportHeight();
		const viewportWidth = this.logicalViewportWidth();
		if (this.selected.rowIndex >= this.frozenRowCount(sheet)) {
			if (center) {
				const maxScrollTop = Math.max(0, this.viewport.scrollHeight / this.zoom - viewportHeight);
				const targetTop = (cellTop + cellBottom - columnHeaderHeight - viewportHeight) / 2;
				this.viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, targetTop)) * this.zoom;
			} else if (cellTop < scrollTop + columnHeaderHeight) {
				this.viewport.scrollTop = Math.max(0, cellTop - columnHeaderHeight) * this.zoom;
			} else if (cellBottom > scrollTop + viewportHeight) {
				this.viewport.scrollTop = (cellBottom - viewportHeight) * this.zoom;
			}
		}
		if (this.selected.columnIndex >= this.frozenColumnCount(sheet)) {
			if (center) {
				const maxScrollLeft = Math.max(0, this.viewport.scrollWidth / this.zoom - viewportWidth);
				const targetLeft = (cellLeft + cellRight - rowHeaderWidth - viewportWidth) / 2;
				this.viewport.scrollLeft = Math.max(0, Math.min(maxScrollLeft, targetLeft)) * this.zoom;
			} else if (cellLeft < scrollLeft + rowHeaderWidth) {
				this.viewport.scrollLeft = Math.max(0, cellLeft - rowHeaderWidth) * this.zoom;
			} else if (cellRight > scrollLeft + viewportWidth) {
				this.viewport.scrollLeft = (cellRight - viewportWidth) * this.zoom;
			}
		}
		if (center) this.syncScrollTransforms();
	}

	private scheduleRender(scrollOnly = false): void {
		if (!scrollOnly) this.renderRequiresFullRefresh = true;
		else if (this.scrollRenderRequestedAt === 0) this.scrollRenderRequestedAt = this.scrollClock();
		if (this.renderFrame !== null) return;
		this.renderFrame = window.requestAnimationFrame(() => {
			this.renderFrame = null;
			try {
				const preserveOutsideRange = !this.renderRequiresFullRefresh && this.scrollRenderRequestedAt !== 0;
				this.captureScrollRenderLatency();
				const reuseExisting = !this.renderRequiresFullRefresh;
				this.renderRequiresFullRefresh = false;
				this.render(reuseExisting, preserveOutsideRange);
			} catch (error) {
				new Notice(`플롯 시트를 표시하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
			}
		});
	}

	private renderImmediatelyForScroll(projectedViewport?: ViewportArea): void {
		if (this.renderFrame !== null) {
			window.cancelAnimationFrame(this.renderFrame);
			this.renderFrame = null;
		}
		const reuseExisting = !this.renderRequiresFullRefresh;
		this.renderRequiresFullRefresh = false;
		this.scrollRenderRequestedAt = 0;
		this.render(reuseExisting, reuseExisting, projectedViewport);
	}

	private scheduleScrollIdleRefresh(): void {
		if (this.scrollIdleRenderTimer !== null) window.clearTimeout(this.scrollIdleRenderTimer);
		this.scrollIdleRenderTimer = window.setTimeout(() => {
			this.scrollIdleRenderTimer = null;
			if (!this.element.isConnected) return;
			if (this.renderFrame !== null) {
				this.scheduleScrollIdleRefresh();
				return;
			}
			this.scrollVelocityX = 0;
			this.scrollVelocityY = 0;
			this.lastScrollLeft = this.logicalScrollLeft();
			this.lastScrollTop = this.logicalScrollTop();
			this.lastScrollSampleAt = this.scrollClock();
			// Do not prune the preserved range at the first idle timeout. Some
			// trackpads and scrollbar drags pause longer than this between native
			// scroll events; removing the preceding range here exposes a blank paint
			// before the next event mounts its destination. The bounded in-scroll
			// retention policy releases old ranges after the incoming range exists.
			this.refreshSelectionPreview();
		}, SCROLL_IDLE_RENDER_MS);
	}

	private captureScrollRenderLatency(): void {
		if (this.scrollRenderRequestedAt === 0) return;
		const observed = Math.max(0, Math.min(MAX_SCROLL_LOOKAHEAD_MS, this.scrollClock() - this.scrollRenderRequestedAt));
		this.scrollRenderLatency = this.scrollRenderLatency * 0.75 + observed * 0.25;
		this.scrollRenderRequestedAt = 0;
	}

	private syncScrollTransforms(): void {
		this.canvas.style.setProperty('--wm-plotbook-scroll-x', `${this.logicalScrollLeft()}px`);
		this.canvas.style.setProperty('--wm-plotbook-scroll-y', `${this.logicalScrollTop()}px`);
	}

	private logicalScrollLeft(): number {
		return this.viewport.scrollLeft / this.zoom;
	}

	private logicalScrollTop(): number {
		return this.viewport.scrollTop / this.zoom;
	}

	private logicalViewportWidth(): number {
		return this.viewport.clientWidth / this.zoom;
	}

	private logicalViewportHeight(): number {
		return this.viewport.clientHeight / this.zoom;
	}

	private axisLayout(sizes: number[]): AxisLayout {
		const offsets: number[] = [];
		let total = 0;
		for (const size of sizes) {
			offsets.push(total);
			total += size;
		}
		return { offsets, sizes, total };
	}

	private scrollLayout(sheet: PlotWorkbookSheet): NonNullable<InfinitePlotSheet['layoutCache']> {
		const cached = this.layoutCache;
		if (cached?.sheet === sheet && cached.seq === sheet.lastSeq && cached.focus === this.temporaryColumnFocus) return cached;
		const columnOrder = this.columnOrder(sheet);
		return this.layoutCache = {
			sheet, seq: sheet.lastSeq, focus: this.temporaryColumnFocus, columnOrder,
			rows: this.axisLayout(sheet.rowOrder.map(id => plotRowHeight(sheet, id))),
			columns: this.axisLayout(columnOrder.map(id => plotColumnWidth(sheet, id))),
			rowLabels: this.session.rowLabels(sheet),
		};
	}

	private indexAt(axis: AxisLayout, offset: number): number {
		let low = 0;
		let high = axis.offsets.length - 1;
		while (low < high) {
			const middle = Math.floor((low + high + 1) / 2);
			if (axis.offsets[middle] <= offset) low = middle;
			else high = middle - 1;
		}
		return low;
	}

	private integerRange(start: number, end: number): number[] {
		if (end < start) return [];
		return Array.from({ length: end - start + 1 }, (_value, index) => start + index);
	}

	private visibleIndices(start: number, end: number, frozenCount: number): number[] {
		const indices = new Set<number>();
		for (let index = 0; index < frozenCount; index++) indices.add(index);
		for (let index = start; index <= end; index++) indices.add(index);
		return [...indices].sort((left, right) => left - right);
	}

	private frozenRowCount(sheet: PlotWorkbookSheet): number {
		return Math.max(0, Math.min(sheet.rowOrder.length, sheet.view?.frozenRowCount ?? 0));
	}

	private rowHeaderWidth(sheet: PlotWorkbookSheet): number {
		return this.headerSizePreview?.width
			?? Math.max(36, Math.min(240, sheet.view?.rowHeaderWidth ?? DEFAULT_ROW_HEADER_WIDTH));
	}

	private columnHeaderHeight(sheet: PlotWorkbookSheet): number {
		return this.headerSizePreview?.height
			?? Math.max(48, Math.min(120, sheet.view?.columnHeaderHeight ?? DEFAULT_COLUMN_HEADER_HEIGHT));
	}

	private frozenColumnCount(sheet: PlotWorkbookSheet): number {
		return Math.max(0, Math.min(this.columnOrder(sheet).length, sheet.view?.frozenColumnCount ?? 0));
	}

	private buildRowLabels(sheet: PlotWorkbookSheet): Map<string, string> {
		return this.session.rowLabels(sheet);
	}

	private searchableCellIndex(sheet: PlotWorkbookSheet): SearchablePlotCell[] {
		if (this.searchIndexSheetId === sheet.sheetId && this.searchIndexLastSeq === sheet.lastSeq) {
			return this.searchIndex;
		}
		const entries: SearchablePlotCell[] = [];
		const castColumns = sheet.columnOrder.filter(id => sheet.columns[id]?.role === 'cast');
		const foreshadowColumns = sheet.columnOrder.filter(id => sheet.columns[id]?.role === 'foreshadow');
		const namesByPath = new Map(sheet.columnOrder.flatMap(id => {
			const column = sheet.columns[id];
			return column?.role === 'character' && column.characterNotePath
				? [[column.characterNotePath, this.characterProfile(sheet, id).name] as const] : [];
		}));
		const populatedRows = new Set(Object.keys(sheet.cells));
		for (const id of populatedRows) {
			const parent = sheet.rows[id]?.parentRowId;
			if (parent) populatedRows.add(parent);
		}
		for (const item of this.session.foreshadows) for (const point of [...item.plantedAt, ...item.resolvedAt]) {
			if (point.sheetId === sheet.sheetId) populatedRows.add(point.rowId);
		}
		for (const rowId of sheet.rowOrder) {
			if (!populatedRows.has(rowId)) continue;
			const candidates = new Set([...Object.keys(sheet.cells[rowId] ?? {}), ...castColumns, ...foreshadowColumns]);
			for (const columnId of candidates) {
				if (!sheet.columns[columnId]) continue;
				const role = sheet.columns[columnId]?.role ?? 'text';
				let value = this.session.getCell(sheet, rowId, columnId);
				let metadata = '';
				const replaceable = role === 'text' || role === 'plot' || role === 'character';
				if (role === 'cast') value = this.session.getAppearancePaths(sheet, rowId, columnId)
					.map(path => namesByPath.get(path) ?? path.split('/').pop()?.replace(/\.md$/i, '') ?? path).join('\n');
				else if (role === 'foreshadow') value = this.session.foreshadowsInRow(sheet.sheetId, rowId)
					.map(item => `${item.title}\n${item.note ?? ''}`).join('\n') || value;
				else if (role === 'status') value = value ? this.session.statusName(value) : '';
				else if (role === 'checklist') value = parseChecklist(value).map(task=>task.text).join('\n');
				if ((role === 'status' || role === 'date') && sheet.rows[rowId]?.parentRowId) continue;
				if (!value) continue;
				if (role === 'character') metadata = this.characterProfile(sheet, columnId).name;
				entries.push({ rowId, columnId, haystack: value.toLocaleLowerCase('ko-KR'), metadata: metadata.toLocaleLowerCase('ko-KR'), replaceable });
			}
		}
		const rowOrder = new Map(sheet.rowOrder.map((id, index) => [id, index]));
		const columnOrder = new Map(sheet.columnOrder.map((id, index) => [id, index]));
		entries.sort((a, b) => rowOrder.get(a.rowId)! - rowOrder.get(b.rowId)! || columnOrder.get(a.columnId)! - columnOrder.get(b.columnId)!);
		this.searchIndexSheetId = sheet.sheetId;
		this.searchIndexLastSeq = sheet.lastSeq;
		this.searchIndex = entries;
		return entries;
	}

	private syncRenderedSearchState(): void {
		const sheet = this.session.activeSheet;
		const columnOrder = this.columnOrder(sheet);
		const active = this.findMatches[this.activeFindMatch];
		for (const cell of Array.from(this.canvas.querySelectorAll<HTMLElement>('.wm-plotbook-cell'))) {
			const rowIndex = Number.parseInt(cell.dataset.row ?? '', 10);
			const columnIndex = Number.parseInt(cell.dataset.column ?? '', 10);
			const rowId = sheet.rowOrder[rowIndex];
			const columnId = columnOrder[columnIndex];
			if (!rowId || !columnId) continue;
			const key = this.cellKey(rowId, columnId);
			cell.toggleClass('is-filter-dimmed', Boolean(this.filterQuery.trim() && !this.findMatchCellKeys.has(key)));
			cell.toggleClass('is-find-match', this.findMatchCellKeys.has(key));
			cell.toggleClass('is-active-find-match', active?.rowId === rowId && active.columnId === columnId);
			const role = sheet.columns[columnId]?.role ?? 'text';
			if (role === 'checklist') {
				this.renderChecklistCell(cell, sheet, rowId, columnId, this.session.getCell(sheet, rowId, columnId));
			} else if (role !== 'cast' && role !== 'status' && role !== 'date' && role !== 'foreshadow' && !cell.hasClass('is-date-editing')) {
				this.renderSearchableCellText(cell, this.session.getCell(sheet, rowId, columnId), rowId, columnId);
			} else if (role === 'foreshadow') {
				this.renderForeshadowCell(cell, sheet, rowId, columnId, this.session.getCell(sheet, rowId, columnId));
			} else if (role === 'cast') {
				for (const avatar of cell.querySelectorAll<HTMLElement>('.wm-plotbook-profile-avatar')) {
					const name = avatar.getAttribute('aria-label')?.toLocaleLowerCase('ko-KR') ?? '';
					avatar.toggleClass('is-search-hit', Boolean(this.searchContentNeedle && name.includes(this.searchContentNeedle)));
				}
			} else if (!cell.hasClass('is-date-editing') && !sheet.rows[rowId]?.parentRowId) {
				const label = cell.querySelector<HTMLElement>('.wm-plotbook-status-value, .wm-plotbook-date-value');
				if (label) {
					const value = this.session.getCell(sheet, rowId, columnId);
					if (role === 'status') label.style.setProperty('--wm-plotbook-status-color', this.session.statusColor(value));
					label.empty();
					this.renderMatchingLabel(label, role === 'status' ? (value ? this.session.statusName(value) : '상태 없음') : value || '날짜 선택');
				}
			}
		}
		this.flushPendingCellText();
	}

	private previousSheetContinuationStart(sheet: PlotWorkbookSheet): number | null {
		const index = this.session.manifest.sheets.findIndex(ref => ref.id === sheet.sheetId);
		if (index <= 0) return null;
		const previous = this.session.sheets.get(this.session.manifest.sheets[index - 1].id);
		if (!previous) return null;
		const mainRowCount = previous.rowOrder.filter(rowId => !previous.rows[rowId]?.parentRowId).length;
		return (previous.view?.rowNumberStart ?? 1) + mainRowCount;
	}
}
