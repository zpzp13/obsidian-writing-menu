import { wmT } from '../i18n/index';
import { Menu, Modal, Notice, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { columnLabel, type PlotWorkbookForeshadow, type PlotWorkbookForeshadowLocation, type PlotWorkbookSheet } from './PlotWorkbookTypes';
import type { PlotWorkbookSession } from './PlotWorkbookSession';
import { renderForeshadowCard } from './PlotWorkbookForeshadowCard';
import { PlotWorkbookRowPicker } from './PlotWorkbookRowPicker';

type ForeshadowFilter = 'all' | 'resolved' | 'open';
type RoutePoint = 'plant' | 'payoff';
interface ForeshadowDraft {
	title: string;
	note: string;
	plant?: PlotWorkbookForeshadowLocation;
	payoff?: PlotWorkbookForeshadowLocation;
	status: 'open' | 'resolved';
	payoffColumnId?: string;
}

const FILTERS = [['all', wmT("전체")], ['resolved', wmT("회수")], ['open', wmT("미회수")]] as const;

export class PlotWorkbookForeshadowModal extends Modal {
	private query = '';
	private filter: ForeshadowFilter = 'all';
	private selectedId: string | null = null;
	private draft: ForeshadowDraft | null = null;
	private applyContextDefaults = true;
	private creating = false;
	private saving = false;
	private listEl: HTMLElement;
	private detailEl: HTMLElement;
	private previewEl: HTMLElement;
	private filterButton: HTMLButtonElement;
	private rowPickers: PlotWorkbookRowPicker[] = [];

	constructor(
		plugin: WritingMenuPlugin,
		private readonly session: PlotWorkbookSession,
		private readonly location?: PlotWorkbookForeshadowLocation,
		private readonly onJump?: (location: PlotWorkbookForeshadowLocation) => boolean | Promise<boolean>,
		private readonly initialSelectedId?: string,
	) { super(plugin.app); }

	onOpen(): void {
		this.setTitle(wmT("복선"));
		this.modalEl.addClass('mod-sidebar-layout', 'wm-plotbook-foreshadow-modal');
		const items = this.orderedForeshadows(this.session.listForeshadows());
		const requested = this.initialSelectedId ? items.find(item => item.id === this.initialSelectedId) : undefined;
		const local = this.location ? items.find(item => [...item.plantedAt, ...item.resolvedAt]
			.some(point => point.sheetId === this.location!.sheetId && point.rowId === this.location!.rowId)) : undefined;
		this.selectedId = requested?.id ?? local?.id ?? items[0]?.id ?? null;
		this.creating = items.length === 0;
		this.contentEl.empty();
		const sidebar = this.contentEl.createDiv({ cls: 'wm-plotbook-foreshadow-sidebar' });
		const search = sidebar.createDiv({ cls: 'wm-search-field wm-plotbook-foreshadow-search-box' });
		setIcon(search.createSpan({ attr: { 'aria-hidden': 'true' } }), 'search');
		const input = search.createEl('input', {
			type: 'search', placeholder: wmT("복선 검색"),
			attr: { 'aria-label': wmT("복선 검색"), autocomplete: 'off', spellcheck: 'false' },
		});
		input.addEventListener('input', () => { this.query = input.value; this.renderList(); });
		const heading = sidebar.createDiv({ cls: 'wm-plotbook-foreshadow-list-heading' });
		this.filterButton = heading.createEl('button', { cls: 'wm-plotbook-foreshadow-filter', attr: { type: 'button', 'aria-haspopup': 'menu' } });
		this.filterButton.addEventListener('click', () => {
			const menu = new Menu();
			for (const [value, label] of FILTERS) menu.addItem(item => item.setTitle(label)
				.setChecked(this.filter === value).onClick(() => { this.filter = value; this.renderList(); }));
			const bounds = this.filterButton.getBoundingClientRect();
			menu.showAtPosition({ x: bounds.left, y: bounds.bottom + 4 });
		});
		const add = heading.createEl('button', { cls: 'wm-plotbook-foreshadow-add', attr: { type: 'button', 'aria-label': wmT("새 복선") } });
		setIcon(add, 'plus');
		add.addEventListener('click', () => {
			this.query = '';
			input.value = '';
			this.filter = 'all';
			this.creating = true;
			this.selectedId = null;
			this.draft = null;
			this.applyContextDefaults = true;
			this.renderList();
			this.renderDetail(true);
			this.detailEl.querySelector<HTMLInputElement>('.wm-plotbook-foreshadow-title-input')?.focus();
		});
		this.listEl = sidebar.createDiv({ cls: 'wm-plotbook-foreshadow-list', attr: { role: 'list', 'aria-label': wmT("복선 목록") } });
		this.detailEl = this.contentEl.createDiv({ cls: 'wm-plotbook-foreshadow-detail' });
		this.renderList();
		this.renderDetail();
	}

	onClose(): void { this.destroyRowPickers(); this.contentEl.empty(); }
	private destroyRowPickers(): void {
		for (const picker of this.rowPickers) picker.destroy();
		this.rowPickers = [];
	}

	private plotColumns(sheet: PlotWorkbookSheet): string[] {
		return sheet.columnOrder.filter(id => sheet.columns[id]?.role === 'plot');
	}

	private defaultPlant(): PlotWorkbookForeshadowLocation | undefined {
		const sheet = this.session.sheets.get(this.location?.sheetId ?? this.session.activeSheet.sheetId);
		if (!sheet) return undefined;
		const columnId = this.location && sheet.columns[this.location.columnId]?.role === 'plot'
			? this.location.columnId : this.plotColumns(sheet)[0];
		const rowId = this.location ? (sheet.rows[this.location.rowId] ? this.location.rowId : undefined) : sheet.rowOrder[0];
		return columnId && rowId ? { sheetId: sheet.sheetId, columnId, rowId } : undefined;
	}

	private plotLocation(point?: PlotWorkbookForeshadowLocation): PlotWorkbookForeshadowLocation | undefined {
		if (!point) return undefined;
		const sheet = this.session.sheets.get(point.sheetId);
		if (!sheet?.rows[point.rowId]) return undefined;
		const columnId = sheet.columns[point.columnId]?.role === 'plot' ? point.columnId : this.plotColumns(sheet)[0];
		return columnId ? { ...point, columnId } : undefined;
	}

	private orderedForeshadows(items: PlotWorkbookForeshadow[]): PlotWorkbookForeshadow[] {
		const sheetOrder = new Map(this.session.manifest.sheets.map((sheet, index) => [sheet.id, index]));
		const rowOrders = new Map<string, Map<string, number>>();
		const columnOrders = new Map<string, Map<string, number>>();
		const registryOrder = new Map(this.session.foreshadows.map((item, index) => [item.id, index]));
		const positions = new Map(items.map(item => {
			const location = this.plotLocation(item.plantedAt[item.plantedAt.length - 1]);
			const sheet = location ? this.session.sheets.get(location.sheetId) : undefined;
			if (!location || !sheet) return [item.id, [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]] as const;
			if (!rowOrders.has(sheet.sheetId)) {
				rowOrders.set(sheet.sheetId, new Map(sheet.rowOrder.map((id, index) => [id, index])));
				columnOrders.set(sheet.sheetId, new Map(sheet.columnOrder.map((id, index) => [id, index])));
			}
			return [item.id, [
				sheetOrder.get(sheet.sheetId) ?? Number.MAX_SAFE_INTEGER,
				rowOrders.get(sheet.sheetId)!.get(location.rowId) ?? Number.MAX_SAFE_INTEGER,
				columnOrders.get(sheet.sheetId)!.get(location.columnId) ?? Number.MAX_SAFE_INTEGER,
			]] as const;
		}));
		return [...items].sort((left, right) => {
			const leftPosition = positions.get(left.id)!;
			const rightPosition = positions.get(right.id)!;
			for (let index = 0; index < leftPosition.length; index++) {
				if (leftPosition[index] !== rightPosition[index]) return leftPosition[index] - rightPosition[index];
			}
			return left.createdAt - right.createdAt || registryOrder.get(left.id)! - registryOrder.get(right.id)!;
		});
	}

	private renderList(): void {
		const scrollTop = this.listEl.scrollTop;
		const restoreFocus = this.listEl.contains(this.listEl.ownerDocument.activeElement);
		this.filterButton.empty();
		this.filterButton.createSpan({ text: FILTERS.find(([value]) => value === this.filter)![1] });
		setIcon(this.filterButton.createSpan({ attr: { 'aria-hidden': 'true' } }), 'chevron-down');
		this.listEl.empty();
		const needle = this.query.trim().toLocaleLowerCase('ko-KR');
		const items = this.orderedForeshadows(this.session.listForeshadows()).filter(item => (this.filter === 'all' || item.status === this.filter)
			&& (!needle || `${item.title}\n${item.note ?? ''}`.toLocaleLowerCase('ko-KR').includes(needle)));
		if (!this.creating && !items.some(item => item.id === this.selectedId)) {
			this.selectedId = items[0]?.id ?? null;
			this.draft = null;
			this.applyContextDefaults = true;
			this.renderDetail();
		}
		if (!items.length) this.listEl.createDiv({ cls: 'wm-plotbook-foreshadow-empty', text: wmT("복선이 없습니다.") });
		const labelsBySheet = new Map<string, Map<string, string>>();
		for (const item of items) {
			const location = this.plotLocation(item.plantedAt[item.plantedAt.length - 1]);
			const sheet = location ? this.session.sheets.get(location.sheetId) : undefined;
			const row = this.listEl.createDiv({ cls: 'wm-plotbook-foreshadow-list-item', attr: { role: 'listitem' } });
			row.dataset.foreshadowId = item.id;
			if (sheet && !labelsBySheet.has(sheet.sheetId)) labelsBySheet.set(sheet.sheetId, this.session.rowLabels(sheet));
			renderForeshadowCard(row, {
				title: item.title, status: item.status,
				plotTitle: sheet && location ? this.columnTitle(sheet, location.columnId) : wmT("플롯 선택"),
				rowLabel: sheet && location ? labelsBySheet.get(sheet.sheetId)?.get(location.rowId) ?? '' : '—',
				selected: this.selectedId === item.id && !this.creating,
				onSelect: () => {
					this.selectedId = item.id;
					this.creating = false;
					this.draft = null;
					this.applyContextDefaults = true;
					this.renderList();
					this.renderDetail(true);
				},
			});
		}
		if (restoreFocus) this.listEl.querySelector<HTMLElement>('.is-active')?.focus({ preventScroll: true });
		this.listEl.scrollTop = scrollTop;
	}

	private renderDetail(resetScroll = false): void {
		const scrollTop = resetScroll ? 0 : this.detailEl.scrollTop;
		const active = this.detailEl.ownerDocument.activeElement;
		const focusLabel = !resetScroll && active && this.detailEl.contains(active) ? active.getAttribute('aria-label') : null;
		this.destroyRowPickers();
		this.detailEl.empty();
		const item = this.session.foreshadows.find(candidate => candidate.id === this.selectedId);
		if (!this.creating && !item) {
			this.detailEl.createDiv({ cls: 'wm-plotbook-foreshadow-empty', text: wmT("목록에서 복선을 선택하세요.") });
			return;
		}
		if (!this.draft) {
			const plant = item ? this.plotLocation(item.plantedAt[item.plantedAt.length - 1])
				?? (item.plantedAt.length === 0 ? this.defaultPlant() : undefined) : this.defaultPlant();
			const savedPayoff = item && this.plotLocation(item.resolvedAt[item.resolvedAt.length - 1]);
			const context = this.applyContextDefaults && this.location ? this.defaultPlant() : undefined;
			const suggestedPayoff = item && !item.resolvedAt.length && context && plant?.sheetId === context.sheetId
				&& this.session.isForeshadowRouteInOrder(plant, context) ? context : undefined;
			this.draft = {
				title: item?.title ?? '', note: item?.note ?? '', plant, payoff: savedPayoff ?? suggestedPayoff,
				status: suggestedPayoff ? 'resolved' : item?.status ?? 'open',
			};
			// Defaults are draft-only and applied once. Saving a deliberately cleared
			// payoff must not immediately fill it again when the detail is rebuilt.
			this.applyContextDefaults = false;
		}
		const draft = this.draft;
		this.previewEl = this.detailEl.createDiv({ cls: 'wm-plotbook-foreshadow-route-preview' });
		this.renderTimeline();
		const card = this.detailEl.createDiv({ cls: 'wm-plotbook-foreshadow-edit-card' });
		const heading = card.createDiv({ cls: 'wm-plotbook-foreshadow-edit-heading' });
		const titleField = heading.createDiv({ cls: 'wm-plotbook-foreshadow-title-field' });
		const titleLabel = titleField.createEl('label', { text: wmT("제목"), cls: 'wm-plotbook-foreshadow-field-label' });
		const title = titleField.createEl('input', { cls: 'wm-plotbook-foreshadow-title-input', type: 'text', placeholder: wmT("복선 제목"), attr: { 'aria-label': wmT("복선 제목") } });
		titleLabel.htmlFor = title.id = `wm-foreshadow-title-${item?.id ?? 'new'}`;
		title.value = draft.title;
		title.addEventListener('input', () => { draft.title = title.value; this.renderTimeline(); });
		const routeFields = card.createDiv({ cls: 'wm-plotbook-foreshadow-route-fields' });
		this.renderRoutePoint(routeFields, 'plant');
		this.renderRoutePoint(routeFields, 'payoff');
		const memoField = card.createDiv({ cls: 'wm-plotbook-foreshadow-memo-field' });
		const memoLabel = memoField.createEl('label', { text: wmT("메모"), cls: 'wm-plotbook-foreshadow-field-label' });
		const note = memoField.createEl('textarea', { placeholder: wmT("복선의 의도와 회수 계획을 적어두세요."), attr: { 'aria-label': wmT("복선 메모"), rows: '3' } });
		memoLabel.htmlFor = note.id = `wm-foreshadow-note-${item?.id ?? 'new'}`;
		note.value = draft.note;
		note.addEventListener('input', () => { draft.note = note.value; });
		const actions = card.createDiv({ cls: 'wm-plotbook-foreshadow-actions' });
		if (item) {
			const remove = actions.createEl('button', { cls: 'wm-plotbook-foreshadow-delete', text: wmT("삭제"), attr: { type: 'button' } });
			remove.addEventListener('click', () => new PlotWorkbookForeshadowDeleteConfirmModal(this.app, item.title, async () => {
				await this.session.deleteForeshadow(item.id);
				this.selectedId = this.session.listForeshadows()[0]?.id ?? null;
				this.draft = null;
				this.applyContextDefaults = true;
				this.renderList();
				this.renderDetail();
			}).open());
		}
		const save = actions.createEl('button', { cls: 'mod-cta', text: item ? wmT("수정") : wmT("만들기"), attr: { type: 'button' } });
		save.disabled = this.saving;
		save.addEventListener('click', () => void this.saveDetail(save));
		if (focusLabel) Array.from(this.detailEl.querySelectorAll<HTMLElement>('[aria-label]'))
			.find(element => element.getAttribute('aria-label') === focusLabel)?.focus({ preventScroll: true });
		this.detailEl.scrollTop = scrollTop;
	}

	private renderRoutePoint(parent: HTMLElement, point: RoutePoint): void {
		const draft = this.draft!;
		const location = draft[point];
		const label = point === 'plant' ? wmT("등록") : wmT("회수");
		const endpoint = parent.createDiv({ cls: `wm-plotbook-foreshadow-endpoint is-${point}` });
		endpoint.createDiv({ cls: 'wm-plotbook-foreshadow-field-label', text: label });
		// Existing cross-sheet endpoints stay on their original sheet. New endpoints
		// use the registration/context sheet; hiding a picker must not relocate data.
		const sheetId = location?.sheetId ?? draft.plant?.sheetId ?? this.location?.sheetId ?? this.session.activeSheet.sheetId;
		const sheet = this.session.sheets.get(sheetId);
		if (!sheet) return;
		const fields = endpoint.createDiv({ cls: 'wm-plotbook-foreshadow-point-fields' });
		const column = this.createSelect(fields, wmT("{0} 플롯 열", label), 'columns-3');
		const plots = this.plotColumns(sheet);
		for (const id of plots) column.createEl('option', { text: this.columnTitle(sheet, id), value: id });
		column.disabled = plots.length === 0;
		if (!plots.length) column.createEl('option', { text: wmT("플롯 열 없음"), value: '' });
		column.value = location?.columnId ?? (point === 'payoff' && plots.includes(draft.payoffColumnId ?? '') ? draft.payoffColumnId! : plots[0]) ?? '';
		column.addEventListener('change', () => {
			if (point === 'payoff') draft.payoffColumnId = column.value;
			if (location) draft[point] = { ...location, columnId: column.value };
			else if (point === 'plant') draft.plant = { sheetId, columnId: column.value,
				rowId: this.location && sheet.rows[this.location.rowId] ? this.location.rowId : sheet.rowOrder[0] };
			if (point === 'payoff' && draft.payoff) draft.status = 'resolved';
			this.clearEarlierPayoff();
			this.renderDetail();
		});
		const row = this.createSelect(fields, wmT("{0} 행", label), 'rows-3');
		if (point === 'payoff') row.createEl('option', { text: wmT("회수할 행 선택"), value: '' });
		else if (!location) row.createEl('option', { text: wmT("등록할 행 선택"), value: '' });
		// Compute this once, not by scanning rowOrder for every option in a long sheet.
		const earlierRows = new Set(point === 'payoff' && draft.plant?.sheetId === sheetId
			? sheet.rowOrder.slice(0, Math.max(0, sheet.rowOrder.indexOf(draft.plant.rowId))) : []);
		const rowLabels = this.session.rowLabels(sheet);
		for (const id of sheet.rowOrder) {
			const number = rowLabels.get(id);
			if (!number) continue;
			const option = row.createEl('option', { text: wmT("{0}행", number), value: id });
			option.disabled = earlierRows.has(id);
		}
		row.disabled = !plots.length;
		row.value = location?.rowId ?? '';
		row.addEventListener('change', () => {
			draft[point] = row.value && column.value ? { sheetId, columnId: column.value, rowId: row.value } : undefined;
			if (point === 'payoff') draft.status = draft.payoff ? 'resolved' : 'open';
			this.clearEarlierPayoff();
			this.renderDetail();
		});
		this.rowPickers.push(new PlotWorkbookRowPicker(row));
		if (!plots.length) endpoint.createDiv({ cls: 'wm-plotbook-foreshadow-point-hint', text: wmT("시트에 플롯 열을 추가하세요.") });
	}

	private clearEarlierPayoff(): void {
		const draft = this.draft!;
		if (this.session.isForeshadowRouteInOrder(draft.plant, draft.payoff)) return;
		draft.payoffColumnId = draft.payoff?.columnId;
		draft.payoff = undefined;
		draft.status = 'open';
	}

	private renderTimeline(): void {
		const draft = this.draft;
		if (!draft || !this.previewEl) return;
		const preview = this.previewEl;
		preview.empty();
		const sheetId = draft.plant?.sheetId ?? this.location?.sheetId ?? this.session.activeSheet.sheetId;
		const sheet = this.session.sheets.get(sheetId);
		if (!sheet) return;
		const timeline = preview.createDiv({ cls: 'wm-plotbook-foreshadow-timeline', attr: { role: 'group', 'aria-label': wmT("{0}의 복선 등록 및 회수 위치", sheet.name) } });
		const labels = this.session.rowLabels(sheet);
		for (const point of ['plant', 'payoff'] as const) {
			const location = draft[point];
			const targetSheet = location ? this.session.sheets.get(location.sheetId) : undefined;
			const available = location && targetSheet?.rows[location.rowId];
			const lane = timeline.createDiv({ cls: `wm-plotbook-foreshadow-timeline-lane is-${point}${available ? '' : ' is-empty'}`, attr: { 'aria-label': point === 'plant' ? wmT("등록 경로") : wmT("회수 경로") } });
			lane.createDiv({ cls: 'wm-plotbook-foreshadow-timeline-line', attr: { 'aria-hidden': 'true' } });
			if (!available || !targetSheet || !location) continue;
			const event = lane.createDiv({ cls: `wm-plotbook-foreshadow-timeline-event is-${point} is-${draft.status}` });
			event.dataset.rowId = location.rowId;
			event.dataset.sheetId = location.sheetId;
			const label = point === 'plant' ? wmT("등록") : wmT("회수");
			const dot = event.createEl('button', { cls: 'wm-plotbook-foreshadow-timeline-dot', attr: { type: 'button', 'aria-label': wmT("{0} 위치로 이동", label) } });
			dot.disabled = !this.onJump;
			const jump = () => {
				void Promise.resolve(this.onJump?.(location)).then(found => { if (found) this.close(); });
			};
			dot.addEventListener('click', jump);
			const rowLabel = (targetSheet !== sheet ? this.session.rowLabels(targetSheet) : labels).get(location.rowId) ?? '';
			renderForeshadowCard(event, {
				title: draft.title || wmT("새 복선"), status: point === 'plant' ? 'open' : 'resolved',
				plotTitle: this.columnTitle(targetSheet, location.columnId), rowLabel,
				onSelect: this.onJump ? jump : undefined,
			});
		}
	}

	private createSelect(parent: HTMLElement, label: string, icon: string): HTMLSelectElement {
		const control = parent.createDiv({ cls: 'wm-plotbook-foreshadow-point-control' });
		setIcon(control.createSpan({ cls: 'wm-plotbook-foreshadow-point-icon', attr: { 'aria-hidden': 'true' } }), icon);
		return control.createEl('select', { attr: { 'aria-label': label } });
	}

	private columnTitle(sheet: PlotWorkbookSheet, id: string): string {
		return sheet.columns[id]?.title || wmT("플롯 {0}", columnLabel(sheet.columnOrder.indexOf(id)));
	}

	private async saveDetail(button: HTMLButtonElement): Promise<void> {
		const draft = this.draft;
		if (!draft || this.saving) return;
		if (!draft.title.trim()) { new Notice(wmT("복선 제목을 입력해주세요.")); return; }
		if (!draft.plant) { new Notice(wmT("플롯 열에서 등록 위치를 선택해주세요.")); return; }
		if (!this.session.isForeshadowRouteInOrder(draft.plant, draft.payoff)) {
			new Notice(wmT("회수 위치는 등록 위치와 같거나 뒤에 있어야 합니다."));
			return;
		}
		this.saving = true;
		button.disabled = true;
		try {
			if (this.creating) {
				const created = await this.session.createForeshadow(draft.title, draft.note, draft.plant, draft.payoff, draft.status);
				if (!created) return;
				this.selectedId = created.id;
				this.creating = false;
			} else if (this.selectedId) {
				const saved = await this.session.saveForeshadowDetail(this.selectedId, { ...draft, plant: draft.plant });
				if (!saved) { new Notice(wmT("선택한 플롯 위치를 확인해주세요.")); return; }
			}
			this.draft = null;
			this.renderList();
		} catch (error) {
			console.error('[Writing Menu] Failed to save foreshadow', error);
			new Notice(wmT("복선을 저장하지 못했습니다."));
		} finally {
			this.saving = false;
			this.renderDetail();
		}
	}
}

class PlotWorkbookForeshadowDeleteConfirmModal extends Modal {
	constructor(app: WritingMenuPlugin['app'], private readonly foreshadowTitle: string, private readonly onConfirm: () => Promise<void>) { super(app); }
	onOpen(): void {
		this.setTitle(wmT("복선 삭제"));
		this.contentEl.createEl('p', { text: wmT("“{0}” 복선을 삭제합니다. 등록 및 회수 위치에서도 제거되며 되돌릴 수 없습니다.", this.foreshadowTitle) });
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: wmT("취소") }).addEventListener('click', () => this.close());
		actions.createEl('button', { cls: 'mod-warning', text: wmT("삭제") }).addEventListener('click', () => { this.close(); void this.onConfirm(); });
	}
	onClose(): void { this.contentEl.empty(); }
}
