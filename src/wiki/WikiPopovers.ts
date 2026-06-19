import { App, Menu, setIcon, ToggleComponent } from 'obsidian';
import type { WikiSavedView, WikiGroupRule } from './WikiTypes';
import { RenameModal } from './WikiModals';

// ── Suggestion Dropdown ──────────────────────────────────────────────────────

export function attachSuggestions(
	input: HTMLInputElement,
	getItems: () => string[],
	onSelect: (item: string) => void,
) {
	let list: HTMLElement | null = null;
	const close = () => { if (list) { list.remove(); list = null; } };

	const show = () => {
		close();
		const val = input.value.toLowerCase();
		const matches = !val ? getItems() : getItems().filter(i => i.toLowerCase().includes(val));
		if (matches.length === 0) return;

		list = activeDocument.body.createDiv({ cls: 'wiki-suggestion-container' });
		const rect = input.getBoundingClientRect();
		list.setCssProps({ '--suggest-top': `${rect.bottom + 2}px`, '--suggest-left': `${rect.left}px` });

		matches.forEach(m => {
			const item = list!.createDiv({ cls: 'wiki-suggestion-item', text: m });
			item.onclick = () => { input.value = m; onSelect(m); close(); };
		});
	};

	input.addEventListener('input', show);
	input.addEventListener('focus', show);
	activeDocument.addEventListener('click', (e) => {
		if (list && !list.contains(e.target as Node) && e.target !== input) close();
	});
}

// ── Popover Base ─────────────────────────────────────────────────────────────

export class WikiPopover {
	containerEl: HTMLElement;
	overlay: HTMLElement;
	onClose: (() => void) | null = null;

	constructor(_app: App, target: HTMLElement, cls: string = '') {
		this.overlay = activeDocument.body.createDiv({ cls: 'wiki-popover-overlay' });
		this.overlay.addClass('wm-wiki-popover-overlay');
		this.overlay.addEventListener('click', (e) => { e.stopPropagation(); this.close(); });
		this.overlay.addEventListener('contextmenu', (e) => { e.stopPropagation(); e.preventDefault(); this.close(); });

		this.containerEl = activeDocument.body.createDiv({ cls: `menu wiki-popover-base ${cls}` });

		const rect = target.getBoundingClientRect();
		const popupTop = `${rect.bottom + 6}px`;
		if (rect.right > activeDocument.body.clientWidth - 300) {
			this.containerEl.setCssProps({ '--popup-top': popupTop, '--popup-right': `${activeDocument.body.clientWidth - rect.right}px`, '--popup-left': 'auto' });
		} else {
			this.containerEl.setCssProps({ '--popup-top': popupTop, '--popup-left': `${rect.left}px`, '--popup-right': 'auto' });
		}

		this.containerEl.addEventListener('click', (e) => e.stopPropagation());
	}

	close() {
		if (this.onClose) this.onClose();
		this.containerEl?.remove();
		this.overlay?.remove();
	}
}

// ── Property Popover ─────────────────────────────────────────────────────────

export class PropertyPopover extends WikiPopover {
	constructor(
		app: App,
		target: HTMLElement,
		allProps: string[],
		selectedProps: string[],
		onToggle: (prop: string) => void,
	) {
		super(app, target);

		const searchContainer = this.containerEl.createDiv({ cls: 'search-input-container wm-wiki-prop-search' });
		const searchInput = searchContainer.createEl('input', { attr: { type: 'search', placeholder: '속성 검색...' } });

		const scrollContainer = this.containerEl.createDiv({ cls: 'menu-scroll wm-wiki-prop-scroll' });

		const renderList = (filterVal = '') => {
			scrollContainer.empty();
			const matches = filterVal
				? allProps.filter(p => p.toLowerCase().includes(filterVal.toLowerCase()))
				: allProps;

			matches.forEach(prop => {
				const item = scrollContainer.createDiv({ cls: 'menu-item' });
				const isChecked = selectedProps.includes(prop);
				const iconDiv = item.createDiv({ cls: 'menu-item-icon' });
				setIcon(iconDiv, isChecked ? 'check-square' : 'square');
				item.createDiv({ cls: 'menu-item-title', text: prop });
				item.onclick = () => { onToggle(prop); renderList(searchInput.value); };
			});
		};
		renderList();
		searchInput.addEventListener('input', () => renderList(searchInput.value));
		window.setTimeout(() => searchInput.focus(), 50);
	}
}

// ── Config Popover ────────────────────────────────────────────────────────────

export class ConfigPopover extends WikiPopover {
	constructor(
		app: App,
		target: HTMLElement,
		currentFolder: string,
		currentGroup: string,
		allFields: string[],
		includeSub: boolean,
		onFolder: () => void,
		onGroupChange: (f: string) => void,
		onToggleSub: (val: boolean) => void,
	) {
		super(app, target, 'wiki-config-popover');

		const createRow = (label: string) => {
			const row = this.containerEl.createDiv({ cls: 'wiki-config-row' });
			row.createDiv({ cls: 'wiki-config-label', text: label });
			return row.createDiv({ cls: 'wiki-config-control' });
		};

		const folderCont = createRow('폴더');
		const fInput = folderCont.createEl('input', { attr: { value: currentFolder || '', placeholder: '폴더 선택...', readonly: true } });
		fInput.onclick = () => { this.close(); onFolder(); };

		const subCont = createRow('하위 폴더 포함');
		new ToggleComponent(subCont).setValue(includeSub).onChange((val) => onToggleSub(val));

		const groupCont = createRow('그룹 속성');
		const gInput = groupCont.createEl('input', { attr: { value: currentGroup === 'None' ? '' : currentGroup, placeholder: '속성 검색...' } });
		attachSuggestions(gInput, () => allFields, (item) => onGroupChange(item));
		gInput.onchange = () => onGroupChange(gInput.value || 'None');
	}
}

// ── Group Popover ─────────────────────────────────────────────────────────────

export class GroupPopover extends WikiPopover {
	constructor(
		app: App,
		target: HTMLElement,
		rules: WikiGroupRule[],
		allFields: string[],
		getValues: (field: string) => string[],
		onUpdate: (rules: WikiGroupRule[]) => void,
	) {
		super(app, target, 'wiki-group-popover');

		if (rules.length === 0) {
			rules.push({ id: Date.now().toString(), field: '', operator: 'contains', value: '', condition: 'or', isPinned: false, groupName: '' });
			onUpdate(rules);
		}


		const scrollContainer = this.containerEl.createDiv({ cls: 'wm-wiki-rule-scroll' });

		const renderRules = () => {
			scrollContainer.empty();

			rules.forEach((rule, idx) => {
				const item = scrollContainer.createDiv({ cls: 'menu-item wm-wiki-rule-item' });
				item.draggable = false;

				item.ondragstart = (e) => { e.dataTransfer?.setData('text/plain', idx.toString()); e.dataTransfer!.effectAllowed = 'move'; item.addClass('dragging'); };
				item.ondragover = (e) => { e.preventDefault(); item.addClass('drag-over'); };
				item.ondragleave = () => { item.removeClass('drag-over'); };
				item.ondrop = (e) => {
					e.preventDefault(); item.removeClass('drag-over');
					const srcIdx = parseInt(e.dataTransfer?.getData('text/plain') || '-1');
					if (srcIdx >= 0 && srcIdx !== idx) { const [moved] = rules.splice(srcIdx, 1); rules.splice(idx, 0, moved); onUpdate(rules); renderRules(); }
				};
				item.ondragend = () => { item.removeClass('dragging'); activeDocument.querySelectorAll('.menu-item').forEach(el => el.removeClass('drag-over')); };

				const handle = item.createDiv({ cls: 'menu-item-icon' });
				setIcon(handle, 'grip-vertical');
				handle.addClass('wm-grab-cursor');
				handle.onmousedown = () => { item.draggable = true; };
				handle.onmouseup = () => { item.draggable = false; };

				const nameIn = item.createEl('input', { cls: 'wm-group-name-input', attr: { placeholder: '그룹명', value: rule.groupName || '' } });
				nameIn.onchange = () => { rule.groupName = nameIn.value; onUpdate(rules); };

				const createInput = (val: string, placeholder: string, onChange: (v: string) => void) => {
					const i = item.createEl('input', { cls: 'wm-group-rule-input', attr: { value: val || '', placeholder } });
					i.onchange = () => onChange(i.value);
					return i;
				};

				const f1 = createInput(rule.field, '속성', (v) => { rule.field = v; onUpdate(rules); });
				attachSuggestions(f1, () => allFields, (v) => { rule.field = v; f1.value = v; onUpdate(rules); });

				const v1 = createInput(rule.value, '값', (v) => { rule.value = v; onUpdate(rules); });
				attachSuggestions(v1, () => getValues(rule.field), (v) => { rule.value = v; v1.value = v; onUpdate(rules); });

				const cond = item.createEl('select', { cls: 'wiki-logic-select wm-group-cond-select' });
				cond.createEl('option', { value: 'and', text: 'AND' }).selected = (rule.condition === 'and');
				cond.createEl('option', { value: 'or', text: 'OR' }).selected = (rule.condition === 'or');
				cond.onchange = () => { rule.condition = cond.value as 'and' | 'or'; onUpdate(rules); };

				const f2 = createInput(rule.field2 || '', '속성2', (v) => { rule.field2 = v; onUpdate(rules); });
				attachSuggestions(f2, () => allFields, (v) => { rule.field2 = v; f2.value = v; onUpdate(rules); });

				const v2 = createInput(rule.value2 || '', '값2', (v) => { rule.value2 = v; onUpdate(rules); });
				attachSuggestions(v2, () => getValues(rule.field2 || ''), (v) => { rule.value2 = v; v2.value = v; onUpdate(rules); });

				const pin = item.createDiv({ cls: 'menu-item-icon clickable-icon' });
				setIcon(pin, 'pin');
				pin.toggleClass('is-pinned', !!rule.isPinned);
				pin.onclick = () => { rule.isPinned = !rule.isPinned; onUpdate(rules); renderRules(); };

				const del = item.createDiv({ cls: 'menu-item-icon clickable-icon' });
				setIcon(del, 'trash-2');
				del.onclick = () => { rules.splice(idx, 1); onUpdate(rules); renderRules(); };
			});
		};
		renderRules();

		this.containerEl.createDiv({ cls: 'menu-separator' });
		const addBtn = this.containerEl.createDiv({ cls: 'menu-item' });
		const addIcon = addBtn.createDiv({ cls: 'menu-item-icon' });
		setIcon(addIcon, 'plus');
		addBtn.createDiv({ cls: 'menu-item-title', text: '새 그룹 규칙 추가' });
		addBtn.onclick = () => {
			rules.push({ id: Date.now().toString(), field: '', operator: 'contains', value: '', condition: 'or', isPinned: false });
			onUpdate(rules);
			renderRules();
			window.setTimeout(() => scrollContainer.scrollTo(0, scrollContainer.scrollHeight), 50);
		};
	}
}

// ── SavedView Popover ─────────────────────────────────────────────────────────

export class SavedViewPopover extends WikiPopover {
	constructor(
		app: App,
		target: HTMLElement,
		views: WikiSavedView[],
		onUpdate: (views: WikiSavedView[]) => void,
		onLoad: (view: WikiSavedView) => void,
		onSave: () => void,
	) {
		super(app, target);

		const saveItem = this.containerEl.createDiv({ cls: 'menu-item' });
		const saveIcon = saveItem.createDiv({ cls: 'menu-item-icon' });
		setIcon(saveIcon, 'save');
		saveItem.createDiv({ cls: 'menu-item-title', text: '현재 뷰 저장하기' });
		saveItem.onclick = () => { this.close(); onSave(); };

		this.containerEl.createDiv({ cls: 'menu-separator' });

		if (views.length === 0) {
			const empty = this.containerEl.createDiv({ cls: 'menu-item is-disabled' });
			empty.createDiv({ cls: 'menu-item-title wm-text-muted', text: '저장된 뷰가 없습니다.' });
		} else {
			views.forEach((view, idx) => {
				const item = this.containerEl.createDiv({ cls: 'menu-item' });
				const icon = item.createDiv({ cls: 'menu-item-icon' });
				setIcon(icon, 'eye');
				item.createDiv({ cls: 'menu-item-title', text: view.name });

				const edit = item.createDiv({ cls: 'menu-item-icon' });
				setIcon(edit, 'pencil');
				edit.onclick = (e) => {
					e.stopPropagation();
					this.close();
					new RenameModal(app, view.name, (newName) => { view.name = newName; onUpdate(views); }).open();
				};

				const del = item.createDiv({ cls: 'menu-item-icon' });
				setIcon(del, 'trash-2');
				del.onclick = (e) => { e.stopPropagation(); views.splice(idx, 1); onUpdate(views); this.close(); };

				item.addEventListener('click', () => { this.close(); onLoad(view); });
			});
		}
	}
}

// ── Palette Menu helper ───────────────────────────────────────────────────────

export function showPaletteMenu(
	btn: HTMLElement,
	currentMode: string,
	plugin: import('../../main').default,
	getTargetSettingsFile: () => Promise<import('obsidian').TFile | null>,
	onRender: () => void,
): Menu {
	const menu = new Menu();

	menu.addItem(i => i.setTitle('모드: 없음').setChecked(currentMode === 'none').onClick(async () => { plugin.settings.wikiPaletteMode = 'none'; await plugin.saveSettings(); onRender(); }));
	menu.addItem(i => i.setTitle('모드: 배경').setChecked(currentMode === 'background' || currentMode === 'bg').onClick(async () => { plugin.settings.wikiPaletteMode = 'background'; await plugin.saveSettings(); onRender(); }));
	menu.addItem(i => i.setTitle('모드: 텍스트').setChecked(currentMode === 'text').onClick(async () => { plugin.settings.wikiPaletteMode = 'text'; await plugin.saveSettings(); onRender(); }));
	menu.addItem(i => i.setTitle('모드: 기둥').setChecked(currentMode === 'pillars').onClick(async () => { plugin.settings.wikiPaletteMode = 'pillars'; await plugin.saveSettings(); onRender(); }));

	menu.addSeparator();

	const paletteNames = ['None', 'TierList', 'Pastel Rainbow', 'Monochrome', 'Vivid'];
	paletteNames.forEach(pName => {
		menu.addItem(item => item.setTitle(`팔레트: ${pName}`).onClick(async () => {
			const target = await getTargetSettingsFile();
			if (target) {
				await plugin.app.fileManager.processFrontMatter(target, (fm: Record<string, unknown>) => { fm['wikiPalette'] = pName; });
				onRender();
			}
		}));
	});

	menu.showAtMouseEvent(btn as unknown as MouseEvent);
	return menu;
}
