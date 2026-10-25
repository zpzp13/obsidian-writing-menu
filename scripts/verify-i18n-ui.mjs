// Serialized into the isolated Chromium host by verify-paged-performance.mjs --i18n.
export async function runI18nUiChecks() {
	const { WritingToolbar, DEFAULT_SETTINGS, Platform, SpecialCharsModal, MonthCalendar, PagedFileConflictModal,
		PlotWorkbookRowPicker, PlotWorkbookSidebarView, createPlotWorkbookSheet, PlotWorkbookSession, InfinitePlotSheet, TFile } = globalThis;
	const assert = (value, message) => { if (!value) throw new Error(message); };
	Object.assign(HTMLElement.prototype, {
		empty() { this.replaceChildren(); }, addClass(...names) { this.classList.add(...names); }, addClasses(names) { this.classList.add(...names); },
		removeClass(...names) { this.classList.remove(...names); }, hasClass(name) { return this.classList.contains(name); },
		toggleClass(name, value) { this.classList.toggle(name, value); }, setText(value) { this.textContent = value; },
		setCssStyles(values) { Object.assign(this.style, values); }, setCssProps(values) { for (const [key, value] of Object.entries(values)) this.style.setProperty(key, value); },
		appendText(value) { this.appendChild(document.createTextNode(value)); },
		createEl(tag, options = {}) {
			const element = this.ownerDocument.createElement(tag);
			if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
			if (options.text !== undefined) element.textContent = options.text;
			for (const key of ['type', 'value', 'placeholder']) if (options[key] !== undefined) element[key] = options[key];
			for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
			this.appendChild(element); return element;
		},
		createDiv(options = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); },
		createSpan(options = {}) { return this.createEl('span', options); },
	});
	globalThis.activeDocument = document; globalThis.activeWindow = window;
	window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16);
	window.cancelAnimationFrame = clearTimeout;
	document.body.classList.add('theme-light');
	const style = document.createElement('style');
	style.textContent = `body{margin:0;font:14px Arial;--font-interface:Arial;--font-text:Arial;--font-ui-small:13px;--font-ui-smaller:12px;--text-normal:#222;--text-muted:#666;--text-faint:#999;--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#ddd;--background-modifier-hover:#eee;--interactive-accent:#e96841;--radius-s:4px;--radius-m:10px;background:#fff;color:#222}button,input,textarea,select{font:inherit}.i18n-preview{padding:24px}.i18n-preview>section{margin:24px 0}.i18n-preview svg{width:16px;height:16px}.i18n-preview .wm-month-cal-wrap{max-width:360px}.i18n-preview .wm-month-cal-hdr{display:flex;align-items:center;gap:12px}.modal-container{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0003;z-index:100}.modal{background:white;border-radius:12px;max-width:96vw}.clickable-icon svg{width:16px;height:16px}.wm-plotbook-sidebar-context{display:flex;gap:8px}`;
	document.head.appendChild(style);
	const preview = document.body.createDiv({ cls: 'i18n-preview' });
	preview.createEl('h2', { text: 'Writing Menu · English' });
	const settings = structuredClone(DEFAULT_SETTINGS); settings.showMunpiaWidget = false;
	const originalSettings = JSON.stringify(settings);
	const plugin = { settings, app: { workspace: {} }, stopwatchManager: { subscribeWidget: () => () => {} },
		calculateAllCharCounts: text => ({ munpia: text.length, novelpia: text.length }), saveSettings: async () => {} };
	const surface = { kind: 'paged', leaf: {}, getFile: () => null, getText: () => 'English manuscript',
		focus() {}, undo() {}, redo() {}, toggleFormat() {}, isFormatActive: () => false, getAlignment: () => 'left', setAlignment() {},
		applyTextColor() {}, clearTextColors() {}, getRecentTextColor: () => '', switchView() {}, getZoom: () => 1, setZoom() {} };
	const toolbarHost = preview.createEl('section');
	const toolbar = new WritingToolbar(plugin, toolbarHost, surface);
	assert(toolbar.toolbarEl.querySelector('[aria-label="Font weight"]'), 'Toolbar label was not translated');
	toolbar.toolbarEl.querySelector('[aria-label="Font weight"]').click();
	assert(toolbar.activePopover.textContent.includes('Semibold'), 'Static weight labels were not translated');
	const weights = ['Thin', 'Extra light', 'Light', 'Normal', 'Medium', 'Semibold', 'Bold', 'Extra bold', 'Black'];
	const weightItems = [...toolbar.activePopover.querySelectorAll('.wm-paged-popover-item')];
	assert(JSON.stringify(weightItems.map(item => item.textContent)) === JSON.stringify(weights), 'Toolbar must offer all nine weight labels in order');
	const initialWeight = settings.fontWeight;
	for (let index = 0; index < weights.length; index++) {
		weightItems[index].click(); await Promise.resolve();
		assert(settings.fontWeight === (index + 1) * 100, 'Weight option saved the wrong CSS value');
		assert(toolbar.weightLabelEl.textContent === weights[index], 'Toolbar weight label did not refresh');
	}
	settings.fontWeight = initialWeight; toolbar.refresh();
	toolbar.closePopover();
	assert(!/[가-힣]/.test(toolbar.toolbarEl.textContent), 'Korean text leaked into the English toolbar');
	const calendar = preview.createEl('section'); MonthCalendar.render(calendar, new Map(), plugin);
	assert(calendar.querySelector('.wm-month-cal-dow').textContent === 'Sun', 'Calendar weekday table was initialized in Korean');
	assert(!/[가-힣]/.test(calendar.textContent), 'Calendar contains Korean date units');

	const conflict = new PagedFileConflictModal(plugin.app, () => ({ base: 'base', local: 'my edits', remote: 'external edits' }), async () => {});
	conflict.open();
	assert(conflict.titleEl.textContent === 'Review sync changes', 'Conflict dialog title is not English');
	assert(conflict.contentEl.querySelector('.wm-paged-merge-inputs > .is-active textarea').value === 'my edits', 'Translation changed the selected conflict pane');
	conflict.close();

	const sheet = createPlotWorkbookSheet(undefined, 3, 2);
	const session = new PlotWorkbookSession({}, { sheets: [{ id: sheet.sheetId, name: sheet.name }], activeSheetId: sheet.sheetId }, new Map([[sheet.sheetId, sheet]]), [], []);
	assert(sheet.name === 'Sheet 1' && session.statusName('idea') === '아이디어' && session.statusDisplayName('idea') === 'Idea', 'Status display changed stored data or failed to translate');
	const metadata = InfinitePlotSheet.prototype.rowFrontmatterProperties({ appearances: ['[[Mira]]'], statuses: [{ value: '초고' }], dates: [{ field: '', value: '2026-10-24' }] });
	assert(JSON.stringify(metadata) === JSON.stringify({ '등장': ['[[Mira]]'], '상태': '초고', '날짜': '2026-10-24' }), 'English UI translated plot metadata keys');
	const previousNote = Object.assign(new TFile(), { path: 'old.md' });
	const frontmatter = { ...metadata, Status: 'My own property', Date: 'My own date' };
	const sync = Object.create(InfinitePlotSheet.prototype);
	Object.assign(sync, { session: { sheets: new Map() }, syncedNotePaths: new Set([previousNote.path]), syncedFrontmatterKeys: new Map(),
		plugin: { app: { vault: { getAbstractFileByPath: () => previousNote }, metadataCache: { getFileCache: () => ({ frontmatter }) },
			fileManager: { processFrontMatter: async (_file, update) => update(frontmatter) } } } });
	await sync.syncLinkedNotes();
	assert(JSON.stringify(frontmatter) === JSON.stringify({ Status: 'My own property', Date: 'My own date' }), 'English cleanup changed user properties or missed legacy plot metadata');
	const sidebarHost = preview.createEl('section');
	const sidebar = Object.create(PlotWorkbookSidebarView.prototype);
	Object.assign(sidebar, { plugin: { ...plugin, projectContext: { getProjects: () => [{ id: 'project', name: 'My story' }] } },
		lease: { session }, state: { projectId: 'project', mode: 'row', rowId: sheet.rowOrder[0] }, header: sidebarHost, scopePickers: [], axisPicker: null });
	sidebar.renderPickers(sheet, sheet.columnOrder[0]);
	assert(sidebarHost.querySelector('.wm-plotbook-row-picker'), 'English row label lost the searchable axis picker');
	sidebar.axisPicker.destroy(); sidebar.clearScopePickers();
	sidebar.state.mode = 'column'; sidebar.renderPickers(sheet, sheet.columnOrder[0]);
	assert(sidebarHost.querySelector('.wm-plotbook-row-picker'), 'English column label lost the searchable axis picker');
	sidebar.axisPicker.destroy(); sidebar.clearScopePickers();
	const pickerHost = preview.createEl('section');
	const select = pickerHost.createEl('select', { attr: { 'aria-label': 'Row' } });
	select.createEl('option', { value: 'one', text: 'Row 1' }); select.createEl('option', { value: 'two', text: 'Row 2' });
	const picker = new PlotWorkbookRowPicker(select); picker.button.click();
	const search = picker.popover.querySelector('input'); search.value = 'row 2'; search.dispatchEvent(new Event('input'));
	assert(picker.popover.querySelectorAll('.wm-plotbook-row-option').length === 1, 'English row search failed');
	picker.popover.querySelector('.wm-plotbook-row-option').click(); assert(select.value === 'two', 'English row picker changed the wrong value'); picker.destroy(); pickerHost.remove();

	const symbols = new SpecialCharsModal(plugin.app, plugin, null); symbols.open();
	const symbolSearch = symbols.contentEl.querySelector('.wm-sc-search'); symbolSearch.value = 'arrow'; symbolSearch.dispatchEvent(new Event('input'));
	assert(symbols.renderedChars.includes('→'), 'English symbol search did not find arrows');
	assert(symbols.contentEl.querySelector('.wm-sc-cell-insert').getAttribute('aria-label').toLowerCase().includes('arrow'), 'Symbol description is not English');
	symbolSearch.value = '화살표'; symbolSearch.dispatchEvent(new Event('input')); assert(symbols.renderedChars.includes('→'), 'Korean symbol aliases were lost');
	symbols.close();
	assert(JSON.stringify(settings) === originalSettings, 'Displaying English UI rewrote settings');
	Platform.isMobile = true;
	const mobileHost = preview.createEl('section'); const mobileToolbar = new WritingToolbar(plugin, mobileHost, { ...surface, kind: 'markdown' });
	assert(mobileToolbar.toolbarEl.querySelector('[aria-label="Font"]'), 'Mobile toolbar is not English');
	mobileToolbar.destroy(); mobileHost.remove(); Platform.isMobile = false;
	return { ok: true, language: 'en', checked: ['toolbar', 'static labels', 'calendar', 'conflict selection', 'plot statuses', 'sidebar axis pickers', 'row search', 'bilingual symbol search', 'mobile toolbar', 'settings preservation'] };
}
