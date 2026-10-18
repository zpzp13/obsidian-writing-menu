// Executed by verify-paged-performance.mjs --plot in a standalone Chromium host.
export async function runPlotChecks() {
	const { InfinitePlotSheet, PlotWorkbookForeshadowModal, PlotWorkbookSheetTrashModal, PlotWorkbookSession, createPlotWorkbookSheet,
		PlotWorkbookToolbar, WritingToolbar, InstalledFontCache, PlotWorkbookRepository, renderPlotWorkbookSettingsPage, parsePlotWorkbookSearch,
		LeafStyleManager, ToolbarManager, MarkdownView, PagedWritingView, DEFAULT_SETTINGS } = globalThis;
	const { PlotWorkbookSessionStore, plotWorkbookSessions, PlotWorkbookSidebarView, PlotWorkbookChecklistEditor, parseChecklist, createPagedEditorContextMenu } = globalThis;
	const assert = (value, message) => { if (!value) throw new Error(message); };
	window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16);
	window.cancelAnimationFrame = clearTimeout;
	const settle = () => new Promise(resolve => setTimeout(resolve, 40));
	Object.assign(HTMLElement.prototype, {
		empty() { this.replaceChildren(); }, addClass(...names) { this.classList.add(...names); },
		removeClass(...names) { this.classList.remove(...names); }, hasClass(name) { return this.classList.contains(name); },
		toggleClass(name, value) { this.classList.toggle(name, value); }, setText(value) { this.textContent = value; },
		setCssStyles(values) { Object.assign(this.style, values); },
		setCssProps(values) { for (const [key, value] of Object.entries(values)) this.style.setProperty(key, value); },
		appendText(value) { this.appendChild(document.createTextNode(value)); },
		createEl(tag, options = {}) {
			const element = document.createElement(tag);
			if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
			if (options.text) element.textContent = options.text;
			for (const key of ['type', 'value', 'placeholder']) if (options[key] !== undefined) element[key] = options[key];
			for (const [key, value] of Object.entries(options.attr || {})) element.setAttribute(key, value);
			this.appendChild(element);
			return element;
		},
		createDiv(options = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); },
		createSpan(options = {}) { return this.createEl('span', options); },
	});
	globalThis.activeDocument = document;
	globalThis.activeWindow = window;
	const style = document.createElement('style');
	style.textContent = `body { font: 16px Arial; --background-secondary:#f5f5f5; --background-modifier-hover:#eee; --background-modifier-border-hover:#ccc; --radius-m:10px; --font-ui-small:13px; --font-ui-smaller:12px;
		--tag-padding-x:.65em; --tag-padding-y:.25em; --tag-radius:2em; --tag-border-width:0px; --tag-border-color:transparent; --tag-weight:inherit; }
		body.theme-dark { --text-normal:#ddd; --text-muted:#aaa; --text-faint:#777; --background-primary:#1e1e1e; --background-secondary:#262626; --background-modifier-border:#393939; --background-modifier-border-hover:#555; }
		button,select,input,textarea { font-family:inherit; } button { cursor:pointer; padding:5px 12px; border:1px solid #ddd; border-radius:5px; background:white; } button:hover { background:#7025db; }
		.modal-container { position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; background:#0003; }
		.modal { background:var(--background-primary); box-shadow:0 14px 60px #0003; border-radius:12px; overflow:hidden; } .modal-header { font-size:16px; font-weight:600; }
		.scope-host { display:flex; gap:10px; } .scope-host > div { width:300px; } .plot-test-host { width:1100px; height:630px; } .plot-test-host > .wm-plotbook-sheet { height:630px; }
	`;
	document.head.appendChild(style);
	const leaves = [];
	const app = {
		vault: { on() { return {}; }, offref() {}, getAbstractFileByPath() { return null; } },
		metadataCache: { on() { return {}; }, offref() {}, getFileCache() { return {}; } },
		workspace: { getLeavesOfType(type) { return leaves.filter(leaf => type === 'markdown' ? leaf.view instanceof MarkdownView : leaf.view instanceof PagedWritingView); }, getMostRecentLeaf() { return null; } },
	};
	const plugin = {
		app, settings: { ...DEFAULT_SETTINGS, applyToFolder: '', fontFamily: 'Arial', fontSize: 24, fontColor: '#812323', backgroundColor: '#ddffff' },
		projectContext: { getProjectForPath(path) { return path.startsWith('Project/') ? { id: 'project' } : null; }, getProjectForFile(file) { return file ? this.getProjectForPath(file.path) : null; } },
		leafStyleVersions: new Map(), cssSettingsVersion: 1, leafIdCounter: 1,
		toolbarElements: new Map(), headerCharCountElements: new Map(), charCountElements: new Map(),
	};
	const styles = new LeafStyleManager(plugin);
	plugin.shouldApplyToFile = file => styles.shouldApplyToFile(file);
	// Mount the real shared toolbar, not the ToolbarManager isolation stub.
	for (const kind of ['paged', 'markdown']) {
		const host = document.body.createDiv();
		let opened = 0, zoom = 1;
		const writingPlugin = { ...plugin, settings: { ...DEFAULT_SETTINGS, writingWidgetOrder:[] },
			stopwatchManager: { subscribeWidget: () => () => {} }, openSettings() { opened++; },
			calculateAllCharCounts: text => ({ munpia:text.length, novelpia:text.length }) };
		const surface = { kind, leaf:{}, getFile:() => null, getText:() => '검증', focus() {}, undo() {}, redo() {},
			toggleFormat() {}, isFormatActive:() => false, getAlignment:() => 'left', setAlignment() {}, applyTextColor() {}, clearTextColors() {},
			getRecentTextColor:() => '', switchView() {}, getZoom:() => zoom, setZoom:value => { zoom = value; } };
		const toolbar = new WritingToolbar(writingPlugin, host, surface);
		const settings = toolbar.toolbarEl.querySelector('.is-settings');
		assert(settings.previousElementSibling.matches('.wm-paged-toolbar-spacer') && settings.nextElementSibling.matches('.is-zoom'), `${kind} settings are not immediately left of zoom`);
		toolbar.toolbarEl.querySelector('[aria-label="글꼴 두께"]').click();
		assert(toolbar.activePopover?.querySelector('[role="menuitemradio"][aria-checked="true"]'), 'Shared toolbar options lost their checked/role semantics');
		settings.querySelector('button').click();
		assert(opened === 1 && !toolbar.activePopover, `${kind} settings button lost its click action or popup cleanup`);
		const zoomIn = toolbar.toolbarEl.querySelector('[aria-label="확대 (Ctrl/Cmd+마우스 휠 위)"]');
		assert(zoomIn.disabled === (kind === 'markdown'), 'Refactor changed the Markdown zoom guard');
		if (kind === 'paged') { zoomIn.click(); assert(zoom === 1.1, 'Paged zoom button no longer works'); }
		toolbar.destroy(); assert(!host.querySelector('.wm-writing-toolbar, .wm-writing-widget-dock'), 'Toolbar destroy left UI behind'); host.remove();
	}
	const fontDescriptor = Object.getOwnPropertyDescriptor(window, 'queryLocalFonts');
	let fontQueries = 0;
	try {
		Object.defineProperty(window, 'queryLocalFonts', { configurable:true, value:async () => { fontQueries++; return [{family:' Zeta '},{family:'Alpha'},{family:'Alpha'},{family:''}]; } });
		const fonts = new InstalledFontCache();
		const first = fonts.load(document), concurrent = fonts.load(document);
		assert(first === concurrent, 'Font cache did not coalesce concurrent queries');
		assert((await first).join(',') === 'Alpha,Zeta' && fontQueries === 1, 'Font list sorting/deduplication changed');
		await fonts.load(document); assert(fontQueries === 1, 'Cached font query was repeated');
		assert((await new InstalledFontCache().load(document.implementation.createHTMLDocument())).length === 0, 'Font cache leaked into another document/window');
		Object.defineProperty(window, 'queryLocalFonts', { configurable:true, value:async () => { throw new Error('denied'); } });
		assert((await new InstalledFontCache().load(document)).length === 0, 'Font permission failure was not handled');
	} finally {
		if (fontDescriptor) Object.defineProperty(window, 'queryLocalFonts', fontDescriptor); else delete window.queryLocalFonts;
	}
	console.info('Real paged/Markdown toolbar settings placement, zoom, lifecycle and shared font cache passed');
	const scopeHost = document.body.createDiv({ cls: 'scope-host' });
	const leaf = { app, containerEl: scopeHost.createDiv() };
	leaf.containerEl.createDiv();
	const content = leaf.containerEl.createDiv();
	const source = content.createDiv({ cls: 'markdown-source-view mod-cm6' });
	const sizer = source.createDiv({ cls:'cm-editor' }).createDiv({ cls:'cm-scroller' }).createDiv({ cls:'cm-sizer' });
	const editor = sizer.createDiv({ cls: 'cm-content', text: '문서 서식 검사' });
	const reading = content.createDiv({ cls:'markdown-reading-view', text:'읽기 서식 검사' });
	leaf.view = new MarkdownView(leaf);
	leaf.view.file = { path: 'Project/3. 본문/story.md' };
	leaves.push(leaf);
	// Older vaults retain the former typography folder after registering projects.
	plugin.settings.applyToFolder = '4. 본문';
	styles.updateLeafStyles(leaf);
	assert(getComputedStyle(editor).fontSize === '24px', 'Legacy typography folder blocked a registered project note');
	assert(getComputedStyle(editor).color === 'rgb(129, 35, 35)', 'Registered project note lost its text color');
	assert(getComputedStyle(sizer).backgroundColor === 'rgb(221, 255, 255)', 'Registered project note lost its background');
	assert(getComputedStyle(reading).fontSize === '24px', 'Reading mode did not receive project typography');
	const recentLeaf = app.workspace.getMostRecentLeaf;
	app.workspace.getMostRecentLeaf = () => leaf;
	app.workspace.on = () => ({});
	app.workspace.offref = () => {};
	plugin.zenState = 'off';
	styles.toggleZenMode('wide');
	assert(plugin.zenState === 'wide' && document.body.classList.contains('wm-wide-mode'), 'Legacy typography folder blocked the wide shortcut');
	styles.toggleZenMode('wide');
	assert(plugin.zenState === 'off', 'Wide shortcut did not toggle off');
	styles.toggleZenMode('focus');
	assert(plugin.zenState === 'focus' && document.body.classList.contains('wm-focus-mode'), 'Legacy typography folder blocked the focus shortcut');
	styles.toggleZenMode('focus');
	assert(plugin.zenState === 'off' && !document.body.classList.contains('wm-focus-mode'), 'Focus shortcut did not toggle off');
	// A toolbar belongs to its document even when Obsidian's most recent leaf is elsewhere.
	const otherLeaf = { view: { file: { path:'Notes/other.md' } } };
	app.workspace.getMostRecentLeaf = () => otherLeaf;
	const modePlugin = { ...plugin, settings: { ...plugin.settings, writingWidgetOrder:[] },
		stopwatchManager: { subscribeWidget: () => () => {} },
		addDualColorControl() {},
		calculateAllCharCounts: text => ({ munpia:text.length, novelpia:text.length }),
		toggleZenMode: (mode, target) => styles.toggleZenMode(mode, target) };
	const modeHost = scopeHost.createDiv();
	const modeSurface = { kind:'markdown', leaf, getFile:() => leaf.view.file, getText:() => '문서',
		focus() {}, undo() {}, redo() {}, toggleFormat() {}, isFormatActive:() => false,
		getAlignment:() => null, setAlignment() {}, applyTextColor() {}, clearTextColors() {},
		getRecentTextColor:() => '', switchView() {}, getZoom:() => 1, setZoom() {} };
	const modeToolbar = new WritingToolbar(modePlugin, modeHost, modeSurface);
	modePlugin.saveSettings = async () => {
		Object.assign(plugin.settings, modePlugin.settings);
		styles.regenerateCSSTemplate();
		styles.updateAllLeafStyles();
	};
	modeToolbar.toolbarEl.querySelector('[aria-label="서식"]').click();
	const lineSlider = modeToolbar.activePopover.querySelector('input[aria-label="줄 간격"]');
	assert(lineSlider, 'Toolbar line-height control is missing');
	lineSlider.value = '2.3';
	lineSlider.dispatchEvent(new Event('input', { bubbles:true }));
	lineSlider.dispatchEvent(new Event('change', { bubbles:true }));
	await settle();
	assert(getComputedStyle(editor).lineHeight === '55.2px', 'Toolbar format slider did not update the Markdown editor');
	modeToolbar.closePopover();
	modeToolbar.toolbarEl.querySelector('.wm-writing-wide-mode-button').click();
	assert(plugin.zenState === 'wide', 'Wide icon ignored the toolbar document');
	modeToolbar.toolbarEl.querySelector('.wm-writing-wide-mode-button').click();
	modeToolbar.toolbarEl.querySelector('.wm-writing-focus-mode-button').click();
	assert(plugin.zenState === 'focus' && plugin.zenLeaf === leaf, 'Focus icon did not target the toolbar document');
	modeToolbar.toolbarEl.querySelector('.wm-writing-focus-mode-button').click();
	assert(plugin.zenState === 'off', 'Focus icon did not toggle off');
	modeToolbar.destroy(); modeHost.remove();
	app.workspace.getMostRecentLeaf = () => leaf;
	leaf.view.file = { path: 'Project-other/plain.md' };
	styles.updateLeafStyles(leaf);
	assert(!leaf.containerEl.hasAttribute('data-writing-menu-id'), 'Outside note retained scope marker');
	assert(!Array.from(leaf.containerEl.style).some(key => key.startsWith('--wm-')), 'Outside note retained plugin CSS variables');
	assert(getComputedStyle(editor).fontSize === '16px', 'Outside note retained custom font size');
	assert(getComputedStyle(editor).color !== 'rgb(129, 35, 35)', 'Outside note retained custom text color');
	assert(getComputedStyle(sizer).backgroundColor !== 'rgb(221, 255, 255)', 'Outside note retained project background');
	assert(getComputedStyle(reading).fontSize === '16px', 'Outside reading mode retained project typography');
	plugin.zenState = 'off';
	styles.toggleZenMode('wide');
	assert(plugin.zenState === 'off' && !document.body.classList.contains('wm-wide-mode'), 'Outside note entered wide mode through a shortcut');
	styles.toggleZenMode('focus');
	assert(plugin.zenState === 'off' && !document.body.classList.contains('wm-focus-mode'), 'Outside note entered focus mode through a shortcut');
	app.workspace.getMostRecentLeaf = recentLeaf;
	const toolbar = new ToolbarManager(plugin);
	const root = document.body.createDiv();
	root.createDiv({ cls: 'wm-paged-viewport' });
	const paged = Object.create(PagedWritingView.prototype);
	paged.file = { path: 'Project/test.md' };
	paged.leaf = { view: paged };
	toolbar.mountPagedToolbar(root, paged);
	assert(root.firstElementChild.matches('.wm-writing-toolbar'), 'Late-mounted toolbar was placed below the viewport');
	paged.file = { path: 'Notes/test.md' };
	toolbar.mountPagedToolbar(root, paged);
	assert(!root.querySelector('.wm-writing-toolbar'), 'Outside note retained toolbar');
	root.remove(); scopeHost.remove();
	console.info('Legacy vault folder regression, Markdown/reading styles, format slider, zen shortcuts/icons and project scope passed');

	const repository = { async saveForeshadowsState() {}, recordOperation() {}, async saveManifestState() {} };
	const sheet = createPlotWorkbookSheet('메인 시트', 10000, 80);
	const manifest = { activeSheetId: sheet.sheetId, sheets: [{ id: sheet.sheetId, name: sheet.name }], labels: [] };
	const session = new PlotWorkbookSession(repository, manifest, new Map([[sheet.sheetId, sheet]]), [], []);
	const cellValue = session.getCell.bind(session);
	let scrollCellText = '장면의 단서와 인물의 선택을 기록한 플롯 내용';
	session.getCell = (active, rowId, columnId) => active.columnOrder.indexOf(columnId) % 3 === 0
		? scrollCellText : cellValue(active, rowId, columnId);
	for (let index = 0; index < sheet.columnOrder.length; index++) sheet.columns[sheet.columnOrder[index]].title = `열 ${index + 1}`;
	const host = document.body.createDiv({ cls: 'plot-test-host' });
	host.style.display = 'none';
	const grid = new InfinitePlotSheet(host, plugin, 'Project', 'Project/Text', 'Project/Characters', session);
	clearTimeout(grid.frontmatterSyncTimer);
	grid.scheduleFrontmatterSync = () => {};
	host.style.display = '';
	await settle();
	const revealRows = grid.scrollLayout(sheet).rows;
	const revealColumns = grid.scrollLayout(sheet).columns;
	const revealBottom = grid.indexAt(revealRows, grid.logicalViewportHeight() - grid.columnHeaderHeight(sheet) - 2);
	const revealRight = grid.indexAt(revealColumns, grid.logicalViewportWidth() - grid.rowHeaderWidth(sheet) - 2);
	assert(grid.canvas.querySelector(`.wm-plotbook-cell[data-row="${revealBottom}"][data-column="${revealRight}"]`), 'Hidden → visible tab retained its zero-sized render range');
	const probeCell = grid.canvas.querySelector('.wm-plotbook-cell[data-row="3"][data-column="1"]');
	probeCell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
	assert(grid.selected.rowIndex === 3 && grid.selected.columnIndex === 1, 'Delegated pointer selection failed');
	const editCell = grid.beginEditingCell;
	let edited = false;
	grid.beginEditingCell = (cell, row, column) => { edited = cell === probeCell && row === 3 && column === 1; };
	probeCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
	assert(edited, 'Delegated double-click edit failed');
	grid.beginEditingCell = editCell;
	const dragHandlers = ['beginCellDrag', 'updateCellDragTarget', 'finishCellDrag', 'clearCellDrag'];
	const savedDragHandlers = dragHandlers.map(name => grid[name]);
	const dragEvents = [];
	for (const name of dragHandlers) grid[name] = () => dragEvents.push(name);
	for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) probeCell.dispatchEvent(new DragEvent(type, { bubbles: true }));
	assert(dragEvents.join(',') === dragHandlers.join(','), 'Delegated cell drag/drop failed');
	dragHandlers.forEach((name, index) => { grid[name] = savedDragHandlers[index]; });
	const oldMenu = grid.openCellMenu;
	let contextTarget = null;
	grid.openCellMenu = (_event, _cell, row, column) => { contextTarget = [row, column]; };
	probeCell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
	assert(contextTarget?.join(',') === '3,1', 'Delegated cell context menu failed');
	grid.openCellMenu = oldMenu;
	await settle();
	let axisCalls = 0;
	const axisLayout = grid.axisLayout.bind(grid);
	grid.axisLayout = sizes => { axisCalls++; return axisLayout(sizes); };
	const renderTimes = [];
	const render = grid.render.bind(grid);
	grid.render = (...args) => { const start = performance.now(); const result = render(...args); renderTimes.push(performance.now() - start); return result; };
	const assertCoverage = () => {
		const { rows, columns } = grid.scrollLayout(sheet);
		const top = grid.indexAt(rows, grid.logicalScrollTop());
		const bottom = grid.indexAt(rows, grid.logicalScrollTop() + grid.logicalViewportHeight() - grid.columnHeaderHeight(sheet) - 2);
		const left = grid.indexAt(columns, grid.logicalScrollLeft());
		const right = grid.indexAt(columns, grid.logicalScrollLeft() + grid.logicalViewportWidth() - grid.rowHeaderWidth(sheet) - 2);
		for (const row of [top, Math.floor((top + bottom) / 2), bottom]) for (const column of [left, Math.floor((left + right) / 2), right]) {
			assert(grid.canvas.querySelector(`.wm-plotbook-cell[data-row="${row}"][data-column="${column}"]`), `Blank cell ${row}, ${column}`);
		}
		for (const column of [left, right]) assert(grid.canvas.querySelector(`.wm-plotbook-column-header[data-column="${column}"]`), `Blank column header ${column}`);
	};
	for (let index = 1; index <= 24; index++) {
		grid.viewport.scrollTop = 2000 + (index % 2 ? index * 3100 : (25 - index) * 3100);
		grid.viewport.scrollLeft = 700 + index % 7 * 1500;
		grid.handleScroll();
		assertCoverage();
		await settle();
	}
	assert(axisCalls === 0, `Scroll rebuilt complete axes ${axisCalls} times`);
	const beforeBatch = renderTimes.length;
	for (let index = 0; index < 20; index++) grid.handleScroll();
	assert(renderTimes.length === beforeBatch, 'Normal scroll rendered synchronously more than once per frame');
	await settle();
	assert(renderTimes.length - beforeBatch <= 1, 'Normal scroll was not coalesced into one render frame');
	grid.viewport.scrollTop = 5000; grid.viewport.scrollLeft = 1000; grid.handleScroll();
	const beforeWheel = renderTimes.length;
	for (let i = 0; i < 20; i++) {
		const event = new WheelEvent('wheel', { deltaY: 1000, deltaX: 300, cancelable: true });
		grid.handleWheel(event);
		assert(event.defaultPrevented, 'Wheel exposed a compositor-led unrendered destination');
	}
	assert(grid.viewport.scrollTop === 5000 && renderTimes.length === beforeWheel, 'Wheel burst was not coalesced into one frame');
	await settle();
	assert(grid.renderedArea.top <= 25000 && grid.renderedArea.bottom >= 25000 + grid.logicalViewportHeight() - 50, 'Large wheel did not pre-render its destination');
	assert(grid.viewport.scrollTop === 25000 && grid.viewport.scrollLeft === 7000, 'Coalesced wheel did not apply the full movement');
	assertCoverage();
	await settle();
	const middle = new PointerEvent('pointerdown', { button: 1, clientX: 200, clientY: 200, bubbles: true, cancelable: true });
	grid.viewport.dispatchEvent(middle);
	assert(middle.defaultPrevented && grid.autoScroll, 'Middle-click native autoscroll was not synchronized');
	document.dispatchEvent(new PointerEvent('pointermove', { clientX: 330, clientY: 450, bubbles: true }));
	const beforeAuto = grid.viewport.scrollTop;
	await settle();
	assert(grid.viewport.scrollTop > beforeAuto, 'Middle-click scroll did not move');
	assertCoverage();
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
	assert(!grid.autoScroll && grid.autoScrollFrame === null, 'Escape did not stop middle-click scroll');
	const layers = [grid.cellsLayer, grid.rowHeadersLayer, grid.columnHeadersLayer];
	let fullClears = 0;
	for (const layer of layers) layer.empty = function() { fullClears++; this.replaceChildren(); };
	grid.viewport.scrollTop = grid.viewport.scrollHeight - grid.viewport.clientHeight;
	grid.handleScroll();
	await settle();
	assert(fullClears === 0, 'Automatic row extension cleared existing cell/header layers');
	assertCoverage();
	const scrollMetrics = { frames: renderTimes.length, maxRenderMs: Math.round(Math.max(...renderTimes)), meanRenderMs: +(renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length).toFixed(2), axisRebuildsDuringScrolling: 0, fullClears };
	const shortCellText = scrollCellText;
	scrollCellText = scrollCellText.repeat(60);
	const boundedCellRenderer = grid.renderSearchableCellText;
	const longCellMetrics = {};
	for (const mode of ['unbounded', 'bounded']) {
		grid.scrollRenderLatency = 16;
		grid.renderSearchableCellText = mode === 'bounded' ? boundedCellRenderer : function(cell, value, rowId, columnId) {
			cell.empty();
			if (value) this.renderSearchableText(cell.createSpan({ cls: 'wm-plotbook-cell-text' }), value, rowId, columnId);
		};
		grid.render(false);
		grid.canvas.getBoundingClientRect();
		const frames = [];
		for (let index = 1; index <= 8; index++) {
			const start = performance.now();
			grid.viewport.scrollTop = 3000 + index * 2600;
			grid.viewport.scrollLeft = 600 + (index % 4) * 1600;
			grid.handleScroll();
			grid.canvas.getBoundingClientRect();
			frames.push(performance.now() - start);
			await settle();
		}
		longCellMetrics[mode] = { maxFrameMs: Math.round(Math.max(...frames)), meanFrameMs: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2) };
		console.info(JSON.stringify({ scenario: `long-cell-layout-${mode}`, ...longCellMetrics[mode] }));
	}
	grid.renderSearchableCellText = boundedCellRenderer;
	assert(longCellMetrics.bounded.meanFrameMs < longCellMetrics.unbounded.meanFrameMs * .8, 'Bounded cell previews did not reduce long-text layout cost');
	const clipped = [...grid.canvas.querySelectorAll('.wm-plotbook-cell-text')].find(element => element.textContent && element.textContent.length < scrollCellText.length);
	assert(clipped && clipped.textContent.length < scrollCellText.length, 'Long cell DOM still contains the whole offscreen text');
	scrollCellText = shortCellText;
	grid.destroy(); host.remove();
	console.info(JSON.stringify(scrollMetrics));
	// Invoked by the CDP runner after the suite: these are trusted browser input
	// events, not calls to the grid's private event handlers.
	globalThis.beginNativePlotScrollCheck = () => {
		const nativeHost = document.body.createDiv({ cls: 'plot-test-host' });
		nativeHost.setCssStyles({ position: 'fixed', top: '0', left: '0', zIndex: '1000', background: 'white' });
		const native = new InfinitePlotSheet(nativeHost, plugin, 'Project', 'Project/Text', 'Project/Characters', session);
		clearTimeout(native.frontmatterSyncTimer); native.frontmatterSyncTimer = null; native.scheduleFrontmatterSync = () => {};
		native.viewport.scrollTop = 6000; native.viewport.scrollLeft = 1000; native.handleScroll();
		let trustedWheels = 0;
		native.viewport.addEventListener('wheel', event => { if (event.isTrusted) trustedWheels++; });
		globalThis.nativePlotScrollSnapshot = () => {
			const { rows, columns } = native.scrollLayout(sheet);
			const top = native.indexAt(rows, native.logicalScrollTop());
			const bottom = native.indexAt(rows, native.logicalScrollTop() + native.logicalViewportHeight() - native.columnHeaderHeight(sheet) - 2);
			const left = native.indexAt(columns, native.logicalScrollLeft());
			const right = native.indexAt(columns, native.logicalScrollLeft() + native.logicalViewportWidth() - native.rowHeaderWidth(sheet) - 2);
			for (const row of [top, bottom]) for (const column of [left, right]) assert(native.canvas.querySelector(`.wm-plotbook-cell[data-row="${row}"][data-column="${column}"]`), `Trusted input exposed blank ${row},${column}`);
			return { top: native.viewport.scrollTop, left: native.viewport.scrollLeft, autoScrolling: Boolean(native.autoScroll), trustedWheels };
		};
		globalThis.endNativePlotScrollCheck = () => { native.destroy(); nativeHost.remove(); };
		return globalThis.nativePlotScrollSnapshot();
	};

	const files = new Map();
	const directories = new Set();
	const adapter = {
		async exists(path) { return files.has(path) || directories.has(path); },
		async mkdir(path) { directories.add(path); },
		async write(path, value) { files.set(path, value); },
		async append(path, value) { files.set(path, (files.get(path) ?? '') + value); },
		async read(path) { if (!files.has(path)) throw new Error(`Missing test file ${path}`); return files.get(path); },
		async process(path, transform) { files.set(path, transform(files.get(path))); },
		async remove(path) { files.delete(path); },
		async list(path) { return { files: [...files.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')), folders: [] }; },
	};
	const colorPlugin = { ...plugin, settings: { ...plugin.settings }, app: { ...app, vault: { ...app.vault, adapter } }, async saveSettings() {} };
	const colorRepo = new PlotWorkbookRepository(colorPlugin, 'Project');
	const loaded = await colorRepo.loadOrCreate('test-project', '테스트');
	const colorSession = new PlotWorkbookSession(colorRepo, loaded.manifest, loaded.sheets, loaded.foreshadows, []);
	const colorSheet = colorSession.activeSheet;
	const colorHost = document.body.createDiv({ cls: 'plot-test-host' });
	const colorGrid = new InfinitePlotSheet(colorHost, colorPlugin, 'Project', 'Project/Text', 'Project/Characters', colorSession);
	clearTimeout(colorGrid.frontmatterSyncTimer); colorGrid.frontmatterSyncTimer = null; colorGrid.scheduleFrontmatterSync = () => {};
	const colorToolbar = new PlotWorkbookToolbar(colorPlugin, colorHost, colorSession, colorGrid, [], null, () => {});
	let settingsOpened = 0, settingsPage = '';
	colorPlugin.openSettings = () => { settingsOpened++; };
	colorPlugin.settingTab = { renderPage: page => { settingsPage = page; } };
	colorToolbar.toolbarEl.querySelector('[aria-label="플롯 매니저 설정"]').click();
	assert(settingsOpened === 1 && settingsPage === 'plot', 'Toolbar did not open plot manager settings directly');
	const expectedColors = { color: { light: '#123456', dark: '#bfcbd4' }, backgroundColor: { light: '#e6dacf', dark: '#45342e' } };
	for (const target of ['color', 'backgroundColor']) {
		const anchor = colorToolbar.toolbarEl.querySelector(`.wm-plotbook-color-control.is-${target === 'color' ? 'text' : 'background'} .wm-paged-text-color-chevron`);
		colorToolbar.openColorPopover(anchor, target);
		let picker = colorToolbar.activePopover.querySelector('input[type="color"]');
		picker.value = expectedColors[target].light;
		picker.dispatchEvent(new Event('input'));
		const dark = [...colorToolbar.activePopover.querySelectorAll('.wm-writing-color-mode-segmented button')].find(button => button.textContent === '다크');
		dark.click();
		assert(colorGrid.getSelectionStyle()[target].light === expectedColors[target].light, `${target}: pending light value was not flushed before switching modes`);
		picker = colorToolbar.activePopover.querySelector('input[type="color"]');
		picker.value = expectedColors[target].dark; picker.dispatchEvent(new Event('input'));
		colorToolbar.closePopover();
		assert(JSON.stringify(colorGrid.getSelectionStyle()[target]) === JSON.stringify(expectedColors[target]), `${target}: theme pair reverted on popover close`);
	}
	const [colorRow] = colorSheet.rowOrder;
	const [colorColumn] = colorSheet.columnOrder;
	colorSession.setCell(colorRow, colorColumn, '색상을 유지할 본문');
	colorGrid.applySelectionStyle({ fontSize: 15, bold: true });
	colorSession.resizeRow(colorRow, 70);
	colorSession.undo(); colorSession.redo();
	colorSession.setHeaderStyles([colorRow], [colorColumn], expectedColors);
	await settle();
	const coloredCell = colorGrid.canvas.querySelector('.wm-plotbook-cell[data-row="0"][data-column="0"]');
	assert(getComputedStyle(coloredCell).color === 'rgb(18, 52, 86)', 'Light text color did not survive another action');
	assert(getComputedStyle(coloredCell).backgroundColor === 'rgb(230, 218, 207)', 'Light background color did not survive another action');
	document.body.classList.add('theme-dark');
	assert(getComputedStyle(coloredCell).color === 'rgb(191, 203, 212)', 'Dark text color did not apply');
	assert(getComputedStyle(coloredCell).backgroundColor === 'rgb(69, 52, 46)', 'Dark background color did not apply');
	document.body.classList.remove('theme-dark');
	await colorRepo.waitForSheet(colorSheet.sheetId);
	const checkReload = async label => {
		const repo = new PlotWorkbookRepository(colorPlugin, 'Project');
		const data = await repo.loadOrCreate('test-project', '테스트');
		assert(!data.warnings.length, `${label}: repository emitted a recovery warning`);
		const restored = data.sheets.get(colorSheet.sheetId);
		for (const target of ['color', 'backgroundColor']) {
			assert(JSON.stringify(restored.cells[colorRow][colorColumn].style[target]) === JSON.stringify(expectedColors[target]), `${label}: cell lost ${target}`);
			assert(JSON.stringify(restored.columns[colorColumn].style[target]) === JSON.stringify(expectedColors[target]), `${label}: header lost ${target}`);
		}
		repo.dispose();
	};
	await checkReload('Journal reload');
	await colorSession.flush();
	await checkReload('Snapshot reload');
	colorToolbar.openSearch();
	assert(colorToolbar.activePopover.querySelector('.wm-search-help') && !colorToolbar.activePopover.querySelector('[class*="wiki-graph-"]'), 'Plot search still depended on wiki graph CSS classes');
	colorToolbar.activePopover.querySelector('.wm-plotbook-search-info').click();
	assert(getComputedStyle(colorToolbar.activePopover.querySelector('.wm-search-help')).display !== 'none', 'Shared search help did not open');
	assert(!colorToolbar.activePopover.textContent.includes('기존 열:') && !colorToolbar.activePopover.textContent.includes('행: 문법'), 'Search help still advertises removed selectors');
	colorToolbar.destroy(); colorGrid.destroy(); colorHost.remove(); colorSession.dispose();
	console.info('Light/dark color picker, edits, undo/redo, journal and snapshot reload passed');

	assert(JSON.stringify(parsePlotWorkbookSearch('@B #2-3 열쇠')) === JSON.stringify({ text: '열쇠', row: '2-3', column: 'B' }), 'Symbol query parsing failed');
	assert(JSON.stringify(parsePlotWorkbookSearch('열:"메인 플롯" 행:2-3 열쇠')) === JSON.stringify({ text: '열:"메인 플롯" 행:2-3 열쇠', row: '', column: '' }), 'Removed word selectors are still interpreted as filters');
	assert(parsePlotWorkbookSearch('C# #태그').text === 'C# #태그', 'Ordinary hash text was mistaken for a row selector');
	const searchSheet = createPlotWorkbookSheet('검색', 12, 7);
	const searchColumns = searchSheet.columnOrder;
	['text', 'plot', 'character', 'cast', 'foreshadow', 'status', 'date'].forEach((role, index) => { searchSheet.columns[searchColumns[index]].role = role; });
	searchSheet.columns[searchColumns[1]].title = '메인 플롯';
	searchSheet.columns[searchColumns[2]].title = '영희'; searchSheet.columns[searchColumns[2]].characterNotePath = 'Project/Characters/영희.md';
	searchSheet.rows[searchSheet.rowOrder[1]].parentRowId = searchSheet.rowOrder[0];
	searchSheet.rows[searchSheet.rowOrder[2]].parentRowId = searchSheet.rowOrder[0];
	const searchSession = new PlotWorkbookSession(repository, { activeSheetId: searchSheet.sheetId, sheets: [{ id: searchSheet.sheetId, name: searchSheet.name }] }, new Map([[searchSheet.sheetId, searchSheet]]), [], []);
	const searchRow = searchSheet.rowOrder[2];
	searchSession.setCells([{ rowId: searchRow, columnId: searchColumns[1], value: '낡은 열쇠를 발견했다.' },
		{ rowId: searchRow, columnId: searchColumns[2], value: '문을 연다.' },
		{ rowId: searchSheet.rowOrder[0], columnId: searchColumns[5], value: 'draft' },
		{ rowId: searchSheet.rowOrder[0], columnId: searchColumns[6], value: '2026-10-17' }]);
	const story = await searchSession.createForeshadow('사라진 반지', '왕실의 단서', { sheetId: searchSheet.sheetId, rowId: searchRow, columnId: searchColumns[1] });
	const searchHost = document.body.createDiv({ cls: 'plot-test-host' });
	const searchGrid = new InfinitePlotSheet(searchHost, plugin, 'Project', 'Project/Text', 'Project/Characters', searchSession);
	clearTimeout(searchGrid.frontmatterSyncTimer); searchGrid.frontmatterSyncTimer = null; searchGrid.scheduleFrontmatterSync = () => {};
	const task = searchGrid.canvas.querySelector('.wm-plotbook-foreshadow-task');
	assert(searchGrid.canvas.querySelector('.wm-plotbook-column-header[data-role="status"] .wm-plotbook-column-meta svg')?.dataset.icon === 'info', 'Status column header does not use the info icon');
	assert([...searchGrid.canvas.querySelectorAll('.wm-plotbook-row-header, .wm-plotbook-column-header')].every(header => getComputedStyle(header).fontSize === '10px'), 'Row/column header defaults differ from 10px');
	assert(searchGrid.headerDisplayStyle('row', {fontSize:17}).fontSize === 17 && searchGrid.headerDisplayStyle('column', {fontSize:18}).fontSize === 18, 'Default font size overwrote explicit user header styles');
	assert(task && !task.querySelector('svg') && task.querySelector('.wm-plotbook-foreshadow-marker')?.getAttribute('aria-label') === '미회수', 'Foreshadow cell did not use an accessible state marker');
	assert(!task.querySelector('.wm-plotbook-foreshadow-task-kind') && getComputedStyle(task).padding === '0px' && getComputedStyle(task).marginLeft === '0px', 'Foreshadow task retained duplicate inner spacing or trailing location text');
	assert([...searchGrid.canvas.querySelectorAll('.wm-plotbook-cell:not(.is-cast):not(.is-collapsed-row):not(.is-collapsed-column)')].every(cell => getComputedStyle(cell).padding === '5px'), 'Sheet cells do not share 5px padding');
	const emptyForeshadow = searchGrid.canvas.querySelector('.wm-plotbook-foreshadow-empty');
	assert(emptyForeshadow?.matches('.wm-plotbook-foreshadow-cell-item') && emptyForeshadow.parentElement.className === task.parentElement.className, 'Empty and filled foreshadow cells do not share the same structure');
	assert(getComputedStyle(emptyForeshadow).padding === getComputedStyle(task).padding && getComputedStyle(emptyForeshadow).margin === getComputedStyle(task).margin, 'Empty and filled foreshadow cell spacing differs');
	assert(emptyForeshadow.textContent === '', 'An empty foreshadow cell still displays placeholder text');
	const exactStory = await searchSession.createForeshadow('선택할 복선', '', { sheetId: searchSheet.sheetId, rowId: searchRow, columnId: searchColumns[1] });
	await settle();
	const exactStoryTask = [...searchGrid.canvas.querySelectorAll('.wm-plotbook-foreshadow-task')]
		.find(item => item.dataset.foreshadowId === exactStory.id);
	exactStoryTask.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));
	assert(globalThis.lastTestModal?.selectedId === exactStory.id,
		'Double-clicking a sheet foreshadow did not select that exact item in the manager');
	globalThis.lastTestModal.close();
	await searchSession.deleteForeshadow(exactStory.id); await settle();
	const sheetTag = searchGrid.canvas.querySelector('.wm-plotbook-foreshadow-task .wm-plotbook-foreshadow-marker');
	assert(sheetTag && sheetTag.textContent === '' && getComputedStyle(sheetTag).borderRadius === '3px' && getComputedStyle(sheetTag).backgroundColor === 'rgb(183, 152, 67)', 'Open sheet marker is not a textless amber rounded square');
	document.body.classList.add('theme-dark');
	assert(getComputedStyle(sheetTag).backgroundColor === 'rgb(210, 180, 93)', 'Dark open marker is not yellow');
	document.body.classList.remove('theme-dark');
	searchGrid.openStatusMenu(new MouseEvent('click'), searchSheet.rowOrder[0], searchColumns[5]);
	const statusMenu = globalThis.lastTestMenu;
	assert(statusMenu.items.slice(0, 4).map(item => item.icon).join(',') === 'circle-dashed,circle-dashed,circle-dashed,circle', 'Status menu icons did not use dashed/outline circles');
	assert(statusMenu.items.slice(0, 4).every(item => getComputedStyle(item.dom.querySelector('svg')).fill === 'none' || getComputedStyle(item.dom.querySelector('svg')).fill === 'rgba(0, 0, 0, 0)'), 'Status icon was filled');
	const statusColors = statusMenu.items.slice(0, 4).map(item => getComputedStyle(item.dom.querySelector('.menu-item-icon')).color);
	assert(new Set(statusColors).size === 4 && statusColors[0] === 'rgb(107, 112, 120)', 'Status colors were not a neutral/blue/amber/green palette');
	const draftCell = searchGrid.canvas.querySelector('.wm-plotbook-cell[data-row="0"][data-column="5"] .wm-plotbook-status-value');
	assert(getComputedStyle(draftCell).color === statusColors[1], 'Cell and menu status colors differ');
	await searchSession.renameStatus('draft', '검토 중'); await settle();
	assert(searchGrid.canvas.querySelector('.wm-plotbook-cell[data-row="0"][data-column="5"]').textContent.includes('검토 중'), 'Renaming a status did not refresh a live sheet');
	await searchSession.renameStatus('draft', '초고'); await settle();
	// Production workspace/dock structure: the scroll viewport must end above the
	// normal-flow tab bar, and the bar must end exactly at the workspace bottom.
	const dockHost = document.body.createDiv({ cls: 'wm-plotbook-view' });
	dockHost.style.cssText = 'height:420px;width:900px';
	const dockWorkspace = dockHost.createDiv({ cls:'wm-plotbook-workspace' });
	const dockGrid = new InfinitePlotSheet(dockWorkspace, plugin, 'Project', 'Project/Text', 'Project/Characters', searchSession);
	clearTimeout(dockGrid.frontmatterSyncTimer); dockGrid.frontmatterSyncTimer = null; dockGrid.scheduleFrontmatterSync = () => {};
	const dock = dockWorkspace.createDiv({ cls:'wm-plotbook-sheet-dock' });
	dock.createEl('button', { text:'메인 플롯' });
	await settle();
	const dockBounds = dock.getBoundingClientRect(), workspaceBounds = dockWorkspace.getBoundingClientRect();
	assert(Math.abs(dockBounds.bottom - workspaceBounds.bottom) < 1, 'A gap remains below the sheet tab dock');
	assert(dockGrid.viewport.getBoundingClientRect().bottom <= dockBounds.top + 1, 'Grid/scrollbar lies behind the tab dock');
	assert(dockGrid.viewport.scrollWidth > dockGrid.viewport.clientWidth, 'Dock fixture did not exercise horizontal scrolling');
	dockGrid.viewport.scrollLeft = 100; await settle();
	assert(dockGrid.viewport.scrollLeft > 0 && Math.abs(dock.getBoundingClientRect().bottom - workspaceBounds.bottom) < 1, 'Horizontal scrolling moved or obscured the sheet bar');
	dockGrid.destroy(); dockHost.remove();
	assert(getComputedStyle(searchGrid.canvas.querySelector('.wm-plotbook-foreshadow-task')).fontSize === '10px', 'Foreshadow task default font is not 10px');
	assert(getComputedStyle(searchGrid.canvas.querySelector('.is-foreshadow .wm-plotbook-foreshadow-empty')).fontSize === '10px', 'Empty foreshadow cell text retained a different default size');
	for (const cell of searchGrid.canvas.querySelectorAll('.wm-plotbook-cell')) assert(getComputedStyle(cell).fontSize === '10px', 'A sheet cell retained a different default font size');
	for (const query of ['@B #1-2 열쇠', '@"메인 플롯" #1-2 열쇠', '@C 영희', '@cast 영희', '@E 반지', '@foreshadow 단서', '@F 초고', '@G 2026']) {
		searchGrid.setSearchQuery(query, false);
		assert(searchGrid.getSearchSummary().matches > 0, `Search missed semantic content: ${query}`);
	}
	searchGrid.setSearchQuery('@E 새단서', false);
	assert(searchGrid.getSearchSummary().matches === 0, 'Unexpected foreshadow search match');
	const seqBeforeRegistryEdit = searchSheet.lastSeq;
	await searchSession.updateForeshadow(story.id, '새단서 반지', '왕실의 단서');
	assert(searchSheet.lastSeq === seqBeforeRegistryEdit && searchGrid.getSearchSummary().matches > 0, 'Foreshadow search remained stale until a reload');
	searchGrid.replaceAllSearch('바뀌면 안 됨');
	assert(story.title === '새단서 반지', 'Replace all modified a semantic registry value');
	searchGrid.setSearchQuery('@B 새본문', false);
	searchSession.setCell(searchRow, searchColumns[1], '새본문으로 바뀐다.');
	assert(searchGrid.getSearchSummary().matches === 1, 'Edited cell did not immediately enter the search index');
	searchGrid.replaceAllSearch('교체');
	assert(searchSession.getCell(searchSheet, searchRow, searchColumns[1]) === '교체으로 바뀐다.', 'Plain text replacement regressed');
	searchGrid.setSearchQuery('@E 반지', false);
	await settle();
	assert(searchGrid.canvas.querySelector('.wm-plotbook-foreshadow-task .wm-plotbook-search-hit')?.textContent === '반지', 'Foreshadow task title did not receive a background highlight');
	searchGrid.setSearchQuery('', false);
	assert(!searchGrid.element.hasClass('is-searching') && !searchGrid.canvas.querySelector('.wm-plotbook-search-hit'), 'Closing search left semantic highlights behind');
	const wrappingFixtures = [
		['한글 본문과 띄어쓰기를 이어 갑니다. '.repeat(160), 10, 180, 50],
		['iiiiiiii llll thin glyphs '.repeat(250), 4, 320, 120],
		['👩‍👩‍👧‍👦 👩🏽‍🚀 한글\n'.repeat(200), 13, 180, 64],
		['supercalifragilisticexpialidocious'.repeat(120), 18, 220, 70],
	];
	for (const zoom of [1, 1.6]) {
		searchGrid.setZoom(zoom); await settle();
		for (const [source, fontSize, width, height] of wrappingFixtures) {
			const boundedCell = searchGrid.canvas.createDiv({ cls: 'wm-plotbook-cell' });
			const referenceCell = searchGrid.canvas.createDiv({ cls: 'wm-plotbook-cell' });
			for (const cell of [boundedCell, referenceCell]) cell.setCssStyles({ top: '10px', left: '10px', width: `${width}px`, height: `${height}px`, fontSize: `${fontSize}px` });
			searchGrid.renderSearchableCellText(boundedCell, source, searchRow, searchColumns[1]);
			referenceCell.createSpan({ cls: 'wm-plotbook-cell-text', text: source });
			searchGrid.flushPendingCellText();
			const boundedText = boundedCell.querySelector('.wm-plotbook-cell-text').firstChild;
			const referenceText = referenceCell.firstElementChild.firstChild;
			const referenceBox = referenceCell.getBoundingClientRect();
			assert(source.startsWith(boundedText.textContent), 'Cell preview changed source text');
			for (let index = 0; index < source.length; index += 31) {
				const range = document.createRange(); range.setStart(referenceText, index); range.setEnd(referenceText, Math.min(source.length, index + 1));
				const rect = range.getBoundingClientRect();
				if (rect.top >= referenceBox.bottom || rect.bottom <= referenceBox.top) continue;
				assert(index < boundedText.length, 'Bounded preview omitted a visible character');
				range.setStart(boundedText, index); range.setEnd(boundedText, Math.min(boundedText.length, index + 1));
				assert(Math.abs(range.getBoundingClientRect().top - rect.top) < .6, 'Bounded preview changed visible native wrapping');
			}
			boundedCell.remove(); referenceCell.remove();
		}
	}
	searchGrid.setZoom(1); await settle();
	const completeCellSource = '끝까지 보존할 긴 본문입니다. '.repeat(220);
	searchSession.setCell(searchRow, searchColumns[1], completeCellSource);
	await settle(); searchGrid.select(2, 1, false); searchGrid.refreshSelectionPreview();
	assert(searchGrid.selectedCellPreviewContent.textContent === completeCellSource, 'Selected-cell preview lost offscreen source text');
	assert(searchGrid.selectionClipboardText() === completeCellSource, 'Clipboard copied a shortened preview instead of source text');
	const editedCell = searchGrid.canvas.querySelector('.wm-plotbook-cell[data-row="2"][data-column="1"]');
	searchGrid.beginEditingCell(editedCell, 2, 1);
	assert(searchGrid.editingCell.value === completeCellSource, 'Cell editing opened a shortened source value');
	searchGrid.editingCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	assert(searchSession.getCell(searchSheet, searchRow, searchColumns[1]) === completeCellSource, 'Preview measurement modified persisted data');
	searchGrid.destroy(); searchHost.remove();
	console.info('Search, bounded native wrapping at 100%/160%, full preview, clipboard and editing passed');

	const small = createPlotWorkbookSheet('메인 플롯', 18, 5);
	small.columns[small.columnOrder[1]].role = 'plot'; small.columns[small.columnOrder[1]].title = '서브 플롯';
	small.columns[small.columnOrder[3]].role = 'plot'; small.columns[small.columnOrder[3]].title = '연애';
	small.columns[small.columnOrder[4]].role = 'foreshadow';
	small.rows[small.rowOrder[1]].parentRowId = small.rowOrder[0];
	small.rows[small.rowOrder[2]].parentRowId = small.rowOrder[0];
	const emptyPlotSheet = createPlotWorkbookSheet('플롯 열 없는 시트', 3, 2);
	const smallManifest = { activeSheetId: small.sheetId, sheets: [{ id: small.sheetId, name: small.name }, { id: emptyPlotSheet.sheetId, name: emptyPlotSheet.name }] };
	const registry = new PlotWorkbookSession(repository, smallManifest, new Map([[small.sheetId, small], [emptyPlotSheet.sheetId, emptyPlotSheet]]), [], []);
	const plant = { sheetId: small.sheetId, rowId: small.rowOrder[2], columnId: small.columnOrder[1] };
	const sameLocation = (left, right) => left?.sheetId === right?.sheetId && left?.rowId === right?.rowId && left?.columnId === right?.columnId;
	// Hiding sheet controls must not relocate legacy cross-sheet/planned routes.
	const legacySheet = createPlotWorkbookSheet('기존 회수 시트', 3, 2);
	legacySheet.columns[legacySheet.columnOrder[0]].role = 'plot';
	registry.sheets.set(legacySheet.sheetId, legacySheet);
	registry.manifest.sheets.push({ id: legacySheet.sheetId, name: legacySheet.name });
	const legacyPayoff = { sheetId: legacySheet.sheetId, columnId: legacySheet.columnOrder[0], rowId: legacySheet.rowOrder[1] };
	const legacy = await registry.createForeshadow('기존 예정 경로', '기존 메모', plant, legacyPayoff, 'open');
	const legacyModal = new PlotWorkbookForeshadowModal(plugin, registry, plant).open();
	const legacyMemo = legacyModal.detailEl.querySelector('textarea');
	legacyMemo.value = '메모만 수정'; legacyMemo.dispatchEvent(new Event('input'));
	await legacyModal.saveDetail(legacyModal.detailEl.querySelector('.wm-plotbook-foreshadow-actions .mod-cta'));
	assert(legacy.status === 'open' && JSON.stringify(legacy.resolvedAt[0]) === JSON.stringify(legacyPayoff) && JSON.stringify(legacy.plantedAt[0]) === JSON.stringify(plant), 'Memo-only edit changed legacy planned/cross-sheet route');
	legacyModal.close();
	await registry.deleteForeshadow(legacy.id);
	const noPlotModal = new PlotWorkbookForeshadowModal(plugin, registry, { sheetId: emptyPlotSheet.sheetId, rowId: emptyPlotSheet.rowOrder[0], columnId: emptyPlotSheet.columnOrder[0] }).open();
	assert([...noPlotModal.detailEl.querySelectorAll('select')].length === 4 && [...noPlotModal.detailEl.querySelectorAll('select')].every(select => select.disabled), 'A sheet without plot columns must keep its own disabled pickers');
	noPlotModal.close();
	// Context defaults are draft-only, honor real plot columns/subrow order, and
	// never replace stored endpoints or silently re-fill a deliberately cleared row.
	const probe = await registry.createForeshadow('위치 기본값 검사', '', plant);
	const laterContext = { ...plant, columnId: small.columnOrder[3], rowId: small.rowOrder[8] };
	const laterModal = new PlotWorkbookForeshadowModal(plugin, registry, laterContext).open();
	assert(sameLocation(laterModal.draft.plant, plant) && sameLocation(laterModal.draft.payoff, laterContext), 'Later context was not used as the missing payoff default');
	assert(probe.resolvedAt.length === 0 && probe.status === 'open', 'Opening the modal wrote context defaults to storage');
	laterModal.contentEl.querySelector('.wm-plotbook-foreshadow-add').click();
	assert(sameLocation(laterModal.draft.plant, laterContext) && !laterModal.draft.payoff && laterModal.draft.status === 'open', 'New route must default only registration, leaving payoff empty');
	laterModal.detailEl.querySelector('[aria-label="등록 행"]').value = small.rowOrder[10];
	laterModal.detailEl.querySelector('[aria-label="등록 행"]').dispatchEvent(new Event('change'));
	assert(!laterModal.draft.payoff && laterModal.draft.status === 'open', 'Moving registration after payoff did not clear the earlier payoff');
	laterModal.close();
	const earlierContext = { ...plant, rowId: small.rowOrder[1] };
	const earlierModal = new PlotWorkbookForeshadowModal(plugin, registry, earlierContext).open();
	const payoffRows = earlierModal.detailEl.querySelector('[aria-label="회수 행"]');
	assert(!earlierModal.draft.payoff && payoffRows.value === '' && earlierModal.draft.status === 'open', 'Earlier context must leave payoff in its default unselected state');
	assert([...payoffRows.options].find(option => option.value === earlierContext.rowId).disabled && ![...payoffRows.options].find(option => option.value === plant.rowId).disabled, 'Payoff options did not compare subrows in actual row order');
	payoffRows.value = earlierContext.rowId; payoffRows.dispatchEvent(new Event('change'));
	assert(!earlierModal.draft.payoff, 'Programmatic input bypassed the earlier-payoff guard');
	earlierModal.close();
	const fallbackModal = new PlotWorkbookForeshadowModal(plugin, registry, { ...laterContext, columnId: small.columnOrder[4] }).open();
	assert(fallbackModal.draft.payoff.columnId === plant.columnId && fallbackModal.draft.payoff.rowId === laterContext.rowId, 'Non-plot context did not use the same row and leftmost plot column');
	fallbackModal.close();
	const noContextModal = new PlotWorkbookForeshadowModal(plugin, registry).open();
	assert(!noContextModal.draft.payoff, 'Opening the list without a cell invented a payoff location');
	noContextModal.close();
	assert(await registry.createForeshadow('잘못된 순서', '', plant, earlierContext) === null, 'Create accepted payoff before registration');
	await registry.resolveForeshadow(probe.id, earlierContext);
	assert(probe.resolvedAt.length === 0, 'Resolve bypassed chronology validation');
	assert(!await registry.saveForeshadowDetail(probe.id, { title: probe.title, note: '', plant, payoff: earlierContext, status: 'resolved' }), 'Save accepted payoff before registration');
	await registry.resolveForeshadow(probe.id, laterContext);
	const storedRoute = JSON.stringify(probe);
	await registry.addForeshadowPlant(probe.id, { ...plant, rowId: small.rowOrder[10] });
	assert(JSON.stringify(probe) === storedRoute, 'Moving registration after payoff bypassed chronology validation');
	const savedRouteModal = new PlotWorkbookForeshadowModal(plugin, registry, earlierContext).open();
	assert(sameLocation(savedRouteModal.draft.payoff, laterContext), 'Context defaults replaced a stored payoff');
	savedRouteModal.close();
	await registry.deleteForeshadow(probe.id);
	const firstListedForeshadow = await registry.createForeshadow('낡은 열쇠의 주인', '문 앞에서 다시 등장하는 단서.', plant);
	const secondListedForeshadow = await registry.createForeshadow('사라진 편지', '마지막 장면에서 회수.', { ...plant, rowId: small.rowOrder[5] });
	const modal = new PlotWorkbookForeshadowModal(plugin, registry, { ...plant, columnId: small.columnOrder[4] }, () => true).open();
	const find = label => modal.contentEl.querySelector(`[aria-label="${label}"]`);
	assert([...modal.listEl.querySelectorAll('.wm-plotbook-foreshadow-list-item')].map(item=>item.dataset.foreshadowId).join(',')
		=== `${firstListedForeshadow.id},${secondListedForeshadow.id}`,
		'Foreshadow cards are not ordered by sheet, registration row and plot column');
	assert(modal.detailEl.querySelectorAll('.wm-plotbook-foreshadow-edit-card select').length === 4 && !modal.previewEl.querySelector('select'), 'Edit card should have only column and row pickers');
	assert(!find('등록 시트') && !find('회수 시트') && !modal.detailEl.querySelector('input[type="checkbox"]'), 'Sheet pickers or completion checkbox remain');
	assert(getComputedStyle(modal.detailEl).padding === '30px', 'Detail padding differs from 30px');
	assert(getComputedStyle(modal.contentEl.querySelector('.wm-plotbook-foreshadow-sidebar')).padding === '30px 0px 0px 30px', 'Sidebar padding differs from 30px 0 0 30px');
	assert(getComputedStyle(modal.contentEl.querySelector('.wm-plotbook-foreshadow-sidebar')).borderRightWidth === '0px', 'Modal still has a sidebar divider');
	assert(getComputedStyle(modal.previewEl).backgroundColor === 'rgba(0, 0, 0, 0)', 'Timeline preview retained a background');
	assert(getComputedStyle(modal.contentEl.querySelector('.wm-plotbook-foreshadow-list-heading')).borderBottomWidth === '0px', 'List heading retained a bottom border');
	assert(find('등록 플롯 열').value === plant.columnId, 'Default plant was not the leftmost plot column');
	assert(find('등록 행').value === plant.rowId, 'Default plant did not use the context-menu row');
	assert([...find('등록 행').options].slice(0, 4).map(option => option.textContent).join(',') === '1행,1-1행,1-2행,2행', 'Subrows were not immediately below their parent');
	find('등록 행 선택').click();
	let rowPopup = document.querySelector('.wm-plotbook-row-popover');
	assert(rowPopup && rowPopup.querySelector('input[type="search"]'), 'Row dropdown did not open a search field');
	assert([...rowPopup.querySelectorAll('[role="option"]')].slice(0, 4).map(option => option.textContent).join(',') === '1행,1-1행,1-2행,2행', 'Searchable row dropdown changed parent/child ordering');
	let rowSearch = rowPopup.querySelector('input');
	rowSearch.value = '1-2'; rowSearch.dispatchEvent(new Event('input'));
	assert(rowPopup.querySelectorAll('[role="option"]').length === 1, 'Row search did not filter a subrow');
	rowSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	assert(!document.querySelector('.wm-plotbook-row-popover') && modal.draft.plant.rowId === plant.rowId && document.activeElement === find('등록 행 선택'), 'Row search selection lost location or keyboard focus');
	find('회수 행 선택').click();
	rowPopup = document.querySelector('.wm-plotbook-row-popover');
	assert(rowPopup.querySelector(`[data-value="${small.rowOrder[1]}"]`).disabled, 'Search popup allowed a payoff before registration');
	rowPopup.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	assert(!document.querySelector('.wm-plotbook-row-popover') && document.activeElement === find('회수 행 선택'), 'Escape did not close only the row popup');
	assert(modal.contentEl.querySelector('.wm-plotbook-foreshadow-card.is-active .wm-plotbook-foreshadow-item-row').textContent === '1-2', 'Selected subrow number was not displayed');
	const meta = modal.contentEl.querySelector('.wm-plotbook-foreshadow-item-meta');
	assert(meta.firstElementChild.matches('.wm-plotbook-foreshadow-marker') && meta.lastElementChild.matches('.wm-plotbook-foreshadow-item-row'), 'Sidebar marker/title/row metadata order is wrong');
	assert(getComputedStyle(meta.querySelector('.wm-plotbook-foreshadow-item-plot')).fontSize === '12px' && getComputedStyle(modal.contentEl.querySelector('.wm-plotbook-foreshadow-item-title')).fontSize === '14px', 'Sidebar typography differs from requested sizes');
	const selectedCard = modal.listEl.querySelector('.wm-plotbook-foreshadow-card.is-active');
	assert(selectedCard.tagName === 'DIV' && getComputedStyle(selectedCard).borderWidth === '2px' && getComputedStyle(selectedCard).borderColor === 'rgb(34, 34, 34)', 'Selected item is not a 2px monochrome div card');
	assert(getComputedStyle(selectedCard).padding === '0px' && getComputedStyle(selectedCard.parentElement).padding === '0px' && getComputedStyle(selectedCard).backgroundColor.endsWith('0.02)'), 'Selected region has extra padding or a strong background');
	assert(getComputedStyle(meta.querySelector('.wm-plotbook-foreshadow-marker')).backgroundColor === 'rgb(183, 152, 67)', 'Sidebar marker is not amber');
	const labels = [...modal.detailEl.querySelectorAll('.wm-plotbook-foreshadow-field-label')];
	assert(labels.map(label => label.textContent).join(',') === '제목,등록,회수,메모' && labels.every(label => getComputedStyle(label).fontSize === '12px' && getComputedStyle(label).fontWeight === '400'), 'Edit labels are inconsistent or bold');
	assert(getComputedStyle(modal.detailEl.querySelector('textarea')).borderWidth === '1px', 'Memo field has no visible border');
	assert([...modal.detailEl.querySelectorAll('select')].every(select => select.parentElement.querySelector('.wm-plotbook-foreshadow-point-icon svg')), 'Route picker is missing its left icon');
	document.body.classList.add('theme-dark');
	assert(getComputedStyle(selectedCard).borderColor === 'rgb(221, 221, 221)', 'Dark selection border did not follow monochrome theme');
	document.body.classList.remove('theme-dark');
	assert(!modal.previewEl.querySelector('.wm-plotbook-foreshadow-preview-heading, .wm-plotbook-foreshadow-timeline-hint'), 'Old timeline heading or hint remains');
	assert(Array.from(find('회수 플롯 열').options).every(option => small.columns[option.value]?.role === 'plot'), 'Non-plot column was selectable');
	modal.detailEl.style.maxHeight = '280px';
	modal.detailEl.scrollTop = 80;
	const detailScrollBefore = modal.detailEl.scrollTop;
	assert(detailScrollBefore > 0, 'Detail scroll fixture did not overflow');
	find('회수 플롯 열').focus({ preventScroll: true });
	find('회수 플롯 열').value = small.columnOrder[3]; find('회수 플롯 열').dispatchEvent(new Event('change'));
	assert(modal.detailEl.scrollTop === detailScrollBefore && document.activeElement === find('회수 플롯 열'), 'Route selection reset detail scroll or keyboard focus');
	modal.detailEl.style.maxHeight = '';
	find('회수 행').value = small.rowOrder[8]; find('회수 행').dispatchEvent(new Event('change'));
	const previewPlant = modal.previewEl.querySelector('.wm-plotbook-foreshadow-timeline-event.is-plant');
	const previewPayoff = modal.previewEl.querySelector('.wm-plotbook-foreshadow-timeline-event.is-payoff');
	assert(previewPlant.dataset.rowId === plant.rowId && previewPayoff.dataset.rowId === small.rowOrder[8], 'Unsaved route edits did not update the preview');
	assert(previewPlant.parentElement.classList.contains('is-plant') && previewPayoff.parentElement.classList.contains('is-payoff'), 'Timeline did not separate registration and payoff lanes');
	assert(modal.previewEl.querySelectorAll('.wm-plotbook-foreshadow-timeline-lane').length === 2, 'Timeline is not two columns');
	assert(modal.previewEl.querySelectorAll('.wm-plotbook-foreshadow-card').length === 2 && !modal.previewEl.querySelector('.wm-plotbook-foreshadow-timeline-location, .wm-plotbook-foreshadow-timeline-caption'), 'Timeline does not reuse complete list cards beside dots');
	assert(previewPlant.querySelector('.wm-plotbook-foreshadow-marker').getAttribute('aria-label') === '미회수' && previewPayoff.querySelector('.wm-plotbook-foreshadow-marker').getAttribute('aria-label') === '회수', 'Timeline markers must distinguish setup and payoff independently of overall status');
	assert([...modal.previewEl.querySelectorAll('.wm-plotbook-foreshadow-item-title')].every(card => card.textContent === modal.draft.title), 'Timeline card title differs from draft');
	assert(previewPlant.querySelector('.wm-plotbook-foreshadow-item-plot').textContent === '서브 플롯' && previewPlant.querySelector('.wm-plotbook-foreshadow-item-row').textContent === '1-2', 'Timeline registration column/row label is wrong');
	const pointBounds = previewPlant.querySelector('.wm-plotbook-foreshadow-timeline-dot').getBoundingClientRect();
	const cardBounds = previewPlant.querySelector('.wm-plotbook-foreshadow-card').getBoundingClientRect();
	assert(cardBounds.left > pointBounds.right && Math.abs((pointBounds.top + pointBounds.bottom - cardBounds.top - cardBounds.bottom) / 2) < 1, 'Timeline card is not aligned beside its point');
	let save = modal.contentEl.querySelector('.wm-plotbook-foreshadow-actions .mod-cta');
	await modal.saveDetail(save);
	const saved = registry.foreshadows.find(item => item.id === modal.selectedId);
	assert(saved.resolvedAt[0].columnId === small.columnOrder[3] && saved.status === 'resolved', 'Selecting a payoff did not save its location and completion state');
	const resolvedTag = modal.listEl.querySelector('.is-active .wm-plotbook-foreshadow-marker');
	assert(getComputedStyle(resolvedTag).backgroundColor === 'rgb(93, 144, 112)', 'Resolved marker is not green');
	document.body.classList.add('theme-dark');
	assert(getComputedStyle(resolvedTag).backgroundColor === 'rgb(135, 181, 150)', 'Dark resolved marker is not green');
	document.body.classList.remove('theme-dark');
	assert(registry.foreshadowsInRow(small.sheetId, small.rowOrder[8]).some(item => item.id === saved.id), 'Payoff row summary did not update');
	find('회수 행').value = ''; find('회수 행').dispatchEvent(new Event('change'));
	await modal.saveDetail(modal.contentEl.querySelector('.wm-plotbook-foreshadow-actions .mod-cta'));
	assert(saved.status === 'open' && saved.resolvedAt.length === 0, 'Clearing payoff did not restore open status');
	assert(!modal.draft.payoff && find('회수 행').value === '', 'Saving a deliberately cleared payoff re-applied its context default');
	find('회수 행').value = small.rowOrder[8]; find('회수 행').dispatchEvent(new Event('change'));
	await modal.saveDetail(modal.contentEl.querySelector('.wm-plotbook-foreshadow-actions .mod-cta'));
	assert(saved.status === 'resolved', 'Payoff completion did not save');
	modal.filterButton.click();
	assert(globalThis.lastTestMenu.items.map(item => item.title).join(',') === '전체,회수,미회수', 'Filter menu did not have the requested options');
	globalThis.lastTestMenu.items.find(item => item.title === '회수').click();
	assert(modal.listEl.querySelectorAll('.wm-plotbook-foreshadow-list-item').length === 1, 'Resolved filter failed');
	globalThis.lastTestMenu.items.find(item => item.title === '전체').click();
	const otherCard = [...modal.listEl.querySelectorAll('.wm-plotbook-foreshadow-card')].find(card => !card.classList.contains('is-active'));
	otherCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	assert(modal.draft.title === '사라진 편지' && document.activeElement === modal.listEl.querySelector('.is-active'), 'Div card lost keyboard activation or focus');
	modal.listEl.querySelector('.wm-plotbook-foreshadow-card:not(.is-active)').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
	assert(modal.selectedId === saved.id, 'Space did not activate the selected div card');
	modal.contentEl.querySelector('.wm-plotbook-foreshadow-delete').click();
	document.querySelector('.mod-warning').click();
	await settle();
	assert(!registry.foreshadows.some(item => item.id === saved.id), 'Delete did not remove the foreshadow');
	assert(!registry.foreshadowsInRow(small.sheetId, small.rowOrder[8]).some(item => item.id === saved.id), 'Delete left stale location index entries');
	modal.filter = 'all'; modal.renderList();
	modal.contentEl.querySelector('.wm-plotbook-foreshadow-add').click();
	assert(find('등록 행').value === plant.rowId && find('등록 플롯 열').value === plant.columnId, 'New item lost context defaults');
	const title = modal.contentEl.querySelector('.wm-plotbook-foreshadow-title-input');
	title.value = '창가에 남겨진 약속'; title.dispatchEvent(new Event('input'));
	const memo = modal.contentEl.querySelector('textarea'); memo.value = '같은 창가에서 두 인물이 다시 만나는 장면으로 이어집니다.'; memo.dispatchEvent(new Event('input'));
	find('회수 행').value = small.rowOrder[12]; find('회수 행').dispatchEvent(new Event('change'));
	await modal.saveDetail(modal.contentEl.querySelector('.wm-plotbook-foreshadow-actions .mod-cta'));
	// Multiple list cards still preserve scroll when a lower item is selected.
	const listSnapshot = registry.foreshadows.slice();
	for (let index = 0; index < 12; index++) registry.foreshadows.push({ ...listSnapshot[0], id: `scroll-card-${index}`, title: `목록 스크롤 ${index}` });
	modal.renderList();
	modal.listEl.scrollTop = 150;
	const listScrollBefore = modal.listEl.scrollTop;
	assert(listScrollBefore > 0, 'Card-list scroll fixture did not overflow');
	modal.listEl.querySelectorAll('.wm-plotbook-foreshadow-card')[6].click();
	assert(modal.listEl.scrollTop === listScrollBefore && document.activeElement === modal.listEl.querySelector('.is-active'), 'Selecting a card reset list scroll or focus');
	registry.foreshadows.splice(0, registry.foreshadows.length, ...listSnapshot);
	modal.selectedId = listSnapshot[listSnapshot.length - 1].id; modal.draft = null;
	modal.renderList(); modal.renderDetail(true);
	const trashSession = { manifest: { deletedSheets: Array.from({ length: 45 }, (_value, index) => ({ id: `deleted-${index}`, name: `시트 ${index + 1}`, deletedAt: index + 1 })) } };
	const trash = new PlotWorkbookSheetTrashModal(plugin, trashSession, () => {}).open();
	const trashList = trash.contentEl.querySelector('.wm-plotbook-sheet-trash-native-list');
	trashList.scrollTop = 260;
	const trashScrollBefore = trashList.scrollTop;
	assert(trashScrollBefore > 0, 'Trash-list fixture did not overflow');
	trashList.querySelectorAll('button')[12].focus({ preventScroll: true });
	trashList.querySelectorAll('button')[12].click();
	assert(trash.contentEl.querySelector('.wm-plotbook-sheet-trash-native-list').scrollTop === trashScrollBefore, 'Selecting a deleted sheet reset the list scroll');
	trash.close();
	modal.detailEl.scrollTop = 0;
	// Status settings use native section headers, reuse a live session, and retain
	// IDs/references when renaming or removing both default and custom choices.
	const statusRepo = new PlotWorkbookRepository(colorPlugin, 'StatusProject');
	const statusData = await statusRepo.loadOrCreate('status-project', '상태 프로젝트');
	const statusSession = new PlotWorkbookSession(statusRepo, statusData.manifest, statusData.sheets, [], []);
	const statusSheet = statusSession.activeSheet;
	const statusColumn = statusSheet.columnOrder[0], statusRow = statusSheet.rowOrder[0];
	statusSheet.columns[statusColumn].role = 'status';
	statusSession.setCell(statusRow, statusColumn, 'idea');
	const customStatus = await statusSession.addStatus('퇴고');
	const statusProject = { id:'status-project', name:'상태 프로젝트', rootFolder:'StatusProject' };
	const statusLeaves = [{ view: { getStatusSettingsSession: id => id === statusProject.id ? statusSession : null } }];
	const statusPlugin = { ...colorPlugin, projectContext: { ...plugin.projectContext, getProjects: () => [statusProject] }, app: { ...colorPlugin.app, workspace: { ...app.workspace, getLeavesOfType: () => statusLeaves } } };
	const settingsHost = document.body.createDiv();
	renderPlotWorkbookSettingsPage(settingsHost, statusPlugin); await settle();
	assert([...settingsHost.querySelectorAll('.setting-item-heading .setting-item-name')].map(item => item.textContent).join(',') === '인물,상태,가져오기', 'Plot settings headings did not match native grouping');
	assert(!settingsHost.querySelector('.setting-group-title') && settingsHost.textContent.includes('링크 열기') && settingsHost.textContent.includes('링크 형식'), 'Old import or character settings structure remains');
	let statusSettings = settingsHost.querySelectorAll('.wm-plotbook-status-setting');
	assert(statusSettings.length === 5, 'Project status settings did not include defaults and custom statuses');
	let palette = statusSettings[0].querySelector('input[type="color"]');
	assert(palette && statusSettings[0].querySelector('[aria-label="상태 색상 초기화"]'), 'Native status palette/reset controls are missing');
	assert(getComputedStyle(palette).gridRowStart === '2' && getComputedStyle(palette).gridColumnStart === '2', 'Palette is not on the row below delete');
	palette.value = '#8a6745'; palette.dispatchEvent(new Event('input'));
	palette.value = '#375b82'; palette.dispatchEvent(new Event('input')); await settle();
	assert(statusSession.statusColor('idea') === '#375b82' && settingsHost.querySelector('input[type="color"]') === palette, 'Native picker was remounted during input or rapid color writes lost their last value');
	statusSettings[0].querySelector('[aria-label="상태 색상 초기화"]').click(); await settle();
	assert(!statusSession.manifest.statuses.find(status => status.id === 'idea').color && statusSession.statusColor('idea').startsWith('var('), 'Reset did not restore the theme-aware default color');
	settingsHost.querySelector('[aria-label="상태 추가"]').click();
	let addEditor = document.querySelector('.wm-plotbook-status-modal');
	addEditor.querySelector('input').value = '출간 준비'; addEditor.querySelector('.mod-cta').click(); await settle();
	const addedInSettings = statusSession.getStatuses().find(status => status.name === '출간 준비');
	assert(addedInSettings && settingsHost.querySelectorAll('.wm-plotbook-status-setting').length === 6, 'Heading plus did not add a project status');
	await statusSession.deleteStatus(addedInSettings.id);
	// Refresh only the fixture after a direct session mutation.
	settingsHost.empty(); renderPlotWorkbookSettingsPage(settingsHost, statusPlugin); await settle();
	statusSettings = settingsHost.querySelectorAll('.wm-plotbook-status-setting');
	const customSetting = [...statusSettings].find(setting => setting.querySelector('.setting-item-name').textContent === '퇴고');
	palette = customSetting.querySelector('input[type="color"]');
	palette.value = '#81725e'; palette.dispatchEvent(new Event('input')); await settle();
	assert(statusSession.statusColor(customStatus.id) === '#81725e', 'Custom status color did not save');
	statusSettings[0].querySelector('[aria-label="상태 수정"]').click();
	let statusEditor = document.querySelector('.wm-plotbook-status-modal');
	statusEditor.querySelector('input').value = '구상'; statusEditor.querySelector('.mod-cta').click(); await settle();
	assert(statusSession.statusName('idea') === '구상' && statusSession.getCell(statusSheet, statusRow, statusColumn) === 'idea', 'Settings rename changed the cell ID or missed the live session');
	assert(!await statusSession.renameStatus('draft', '구상'), 'Duplicate status name was accepted');
	statusSettings = settingsHost.querySelectorAll('.wm-plotbook-status-setting');
	statusSettings[0].querySelector('[aria-label="상태 삭제"]').click();
	document.querySelector('.mod-warning').click(); await settle();
	assert(!statusSession.getStatuses().some(status => status.id === 'idea') && statusSession.statusName('idea') === '구상', 'Deleting default status lost history or did not remove its choice');
	await statusSession.renameStatus(customStatus.id, '최종 퇴고');
	await statusSession.deleteStatus(customStatus.id);
	const readOnlyRepo = new PlotWorkbookRepository(colorPlugin, 'StatusProject');
	const manifestBeforeRead = files.get('StatusProject/.writing-menu/plot/manifest.json');
	const restoredStatusManifest = await readOnlyRepo.loadExistingManifest();
	assert(files.get('StatusProject/.writing-menu/plot/manifest.json') === manifestBeforeRead, 'Reading status settings rewrote the manifest');
	const restoredStatusSession = new PlotWorkbookSession(readOnlyRepo, restoredStatusManifest, new Map(), [], []);
	assert(restoredStatusSession.statusName('idea') === '구상' && restoredStatusSession.statusName(customStatus.id) === '최종 퇴고' && restoredStatusSession.getStatuses().length === 3 && restoredStatusSession.statusColor(customStatus.id) === '#81725e', 'Status edits/colors/deletions did not survive repository reload');
	settingsHost.remove(); statusLeaves.length = 0;
	const closedSettingsHost = document.body.createDiv();
	renderPlotWorkbookSettingsPage(closedSettingsHost, statusPlugin); await settle();
	closedSettingsHost.querySelector('[aria-label="상태 수정"]').click();
	statusEditor = document.querySelector('.wm-plotbook-status-modal');
	statusEditor.querySelector('input').value = '집필 중'; statusEditor.querySelector('.mod-cta').click(); await settle();
	const closedManifest = await readOnlyRepo.loadExistingManifest();
	assert(closedManifest.statuses.some(status => status.id === 'draft' && status.name === '집필 중'), 'Closed-workbook status editing did not save');
	closedSettingsHost.remove();
	const absentHost = document.body.createDiv();
	const filesBeforeAbsentRead = files.size;
	renderPlotWorkbookSettingsPage(absentHost, { ...statusPlugin, projectContext: { getProjects: () => [{...statusProject, rootFolder:'NotCreated'}] } }); await settle();
	assert(files.size === filesBeforeAbsentRead, 'Opening settings created an unrequested workbook');
	absentHost.remove(); readOnlyRepo.dispose(); statusSession.dispose();
	await globalThis.runPlotChecklistSidebarChecks(colorPlugin);
	return { ok: true, scope: 'inside → outside cleared typography and toolbar', scroll: scrollMetrics,
		colors: 'light/dark picker mode changes, formatting, undo/redo, journal and snapshot reload passed',
		search: 'symbol-only operators, semantic column values, fresh registry/cell edits, safe replace and shared help passed',
		longCells: longCellMetrics,
		foreshadow: 'textless markers in both themes, ordered searchable row popup with keyboard/escape, context defaults and chronology guards passed',
		statuses: 'native palette/reset/add, serialized color writes, live/closed persistence and toolbar settings shortcut passed',
		dock: 'no bottom gap, scroll viewport above normal-flow sheet dock, 5px cell padding passed' };
}
