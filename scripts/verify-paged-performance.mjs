// Real Chromium layout regression checks; no vault, user files or Obsidian
// process is opened. Run with: node scripts/verify-paged-performance.mjs
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plotSuite = process.argv.includes('--plot');
const suite = plotSuite ? (await import('./verify-plot-ui-suite.mjs')).runPlotChecks : runPagedChecks;
const browserPath = process.env.PAGED_TEST_BROWSER || [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!browserPath) throw new Error('Set PAGED_TEST_BROWSER to an installed Chromium executable.');

const obsidianStub = `
export class Scope { register() {} }
export class Notice { constructor(message) { console.warn(message); } }
export class WorkspaceLeaf {}
export class App {}
export class TFile {}
export function parseYaml() { return {}; }
export const Platform = { isMobile: false };
export function normalizePath(value) { return value.replace(/\\\\/g, '/'); }
export function sanitizeHTMLToDom(value) { const t = document.createElement('template'); t.innerHTML = value; return t.content; }
export function setIcon(element, name) {
	element.replaceChildren();
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.dataset.icon = name;
	const shape = document.createElementNS(svg.namespaceURI, 'path');
	shape.setAttribute('d', name === 'plus' ? 'M12 5v14M5 12h14' : name === 'chevron-down' ? 'm6 9 6 6 6-6' : name === 'search' ? 'M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0' : name === 'columns-3' ? 'M3 3h18v18H3ZM9 3v18M15 3v18' : name === 'rows-3' ? 'M3 3h18v18H3ZM3 9h18M3 15h18' : 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0');
	svg.appendChild(shape); element.appendChild(svg);
}
export class Modal {
	constructor(app) {
		this.app = app;
		this.containerEl = document.body.createDiv({ cls: 'modal-container' });
		this.modalEl = this.containerEl.createDiv({ cls: 'modal' });
		this.titleEl = this.modalEl.createDiv({ cls: 'modal-header' });
		this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
	}
	setTitle(value) { this.titleEl.setText(value); }
	open() { this.onOpen?.(); return this; }
	close() { this.onClose?.(); this.containerEl.remove(); }
}
export class FuzzySuggestModal extends Modal {}
export class Setting {
	constructor(parent) {
		this.settingEl = parent.createDiv({ cls: 'setting-item' });
		const info = this.settingEl.createDiv({ cls: 'setting-item-info' });
		this.nameEl = info.createDiv({ cls: 'setting-item-name' });
		this.descEl = info.createDiv({ cls: 'setting-item-description' });
		this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
	}
	setClass(value) { this.settingEl.addClass(value); return this; }
	setName(value) { this.nameEl.textContent = value; return this; }
	setDesc(value) { this.descEl.textContent = value; return this; }
	addButton(render) { render(new ButtonComponent(this.controlEl)); return this; }
	addDropdown(render) {
		const select = this.controlEl.createEl('select');
		const dropdown = { addOption(value, label) { select.createEl('option', { value, text:label }); return this; }, setValue(value) { select.value = value; return this; }, onChange(action) { select.addEventListener('change', () => action(select.value)); return this; } };
		render(dropdown); return this;
	}
	addExtraButton(render) {
		const button = new ButtonComponent(this.controlEl);
		button.setIcon = name => { setIcon(button.buttonEl, name); return button; };
		button.setTooltip = value => { button.buttonEl.setAttribute('aria-label', value); return button; };
		render(button); return this;
	}
	addColorPicker(render) {
		const input = this.controlEl.createEl('input', { type:'color' });
		const picker = { setValue(value) { input.value = value; return this; }, onChange(action) { input.addEventListener('input', () => action(input.value)); return this; } };
		render(picker); return this;
	}
}
export class ButtonComponent {
	constructor(parent) { this.buttonEl = parent.createEl('button'); }
	setButtonText(value) { this.buttonEl.textContent = value; return this; }
	setWarning() { this.buttonEl.addClass('mod-warning'); return this; }
	setDisabled(value) { this.buttonEl.disabled = value; return this; }
	onClick(action) { this.buttonEl.addEventListener('click', action); return this; }
}
export class SearchComponent {}
export class ToggleComponent {}
export class Menu {
	constructor() { this.items = []; globalThis.lastTestMenu?.dom?.remove(); this.dom = document.body.createDiv({ cls:'menu' }); this.dom.hidden = true; globalThis.lastTestMenu = this; }
	addItem(render) {
		const dom = this.dom.createDiv({ cls:'menu-item' });
		const icon = dom.createSpan({ cls:'menu-item-icon' });
		const item = { dom, setTitle(value) { this.title = value; return this; }, setIcon(value) { this.icon = value; setIcon(icon, value); return this; }, setChecked(value) { this.checked = value; return this; }, setDisabled() { return this; }, onClick(fn) { this.click = fn; return this; } };
		render(item); this.items.push(item); return this;
	}
	addSeparator() { return this; }
	showAtPosition() {}
	showAtMouseEvent() {}
}
export class TextFileView {
	constructor(leaf) {
		this.leaf = leaf;
		this.app = leaf.app;
		this.containerEl = leaf.containerEl;
		this.cleanups = [];
		this.file = { path: 'Project/performance.md', basename: 'performance' };
	}
	register(cleanup) { this.cleanups.push(cleanup); }
	requestSave() {}
}
export class MarkdownView extends TextFileView {}
`;
const bundle = await build({
	absWorkingDir: root,
	stdin: {
		contents: (plotSuite ? `import { InfinitePlotSheet } from './src/plot-workbook/InfinitePlotSheet';
			import { PlotWorkbookForeshadowModal } from './src/plot-workbook/PlotWorkbookForeshadowModal';
			import { PlotWorkbookSheetTrashModal } from './src/plot-workbook/PlotWorkbookSheetTrashModal';
			import { PlotWorkbookSession } from './src/plot-workbook/PlotWorkbookSession';
			import { PlotWorkbookToolbar } from './src/plot-workbook/PlotWorkbookToolbar';
			import { WritingToolbar } from './src/toolbar/WritingToolbar';
			import { InstalledFontCache } from './src/toolbar/InstalledFontCache';
			import { PlotWorkbookRepository } from './src/plot-workbook/PlotWorkbookRepository';
			import { renderPlotWorkbookSettingsPage } from './src/plot-workbook/PlotWorkbookSettings';
			import { parsePlotWorkbookSearch } from './src/plot-workbook/PlotWorkbookSearch';
			import { createPlotWorkbookSheet } from './src/plot-workbook/PlotWorkbookTypes';
			import { LeafStyleManager } from './src/editor/LeafStyleManager';
			import { ToolbarManager } from './src/toolbar/ToolbarManager';
			import { MarkdownView } from 'obsidian';
			import { DEFAULT_SETTINGS } from './src/types';
			Object.assign(globalThis, { InfinitePlotSheet, PlotWorkbookForeshadowModal, PlotWorkbookSheetTrashModal, PlotWorkbookSession, PlotWorkbookToolbar, WritingToolbar, InstalledFontCache, PlotWorkbookRepository, renderPlotWorkbookSettingsPage, parsePlotWorkbookSearch, createPlotWorkbookSheet, LeafStyleManager, ToolbarManager, MarkdownView, DEFAULT_SETTINGS });` : '') + `import { PagedWritingView } from './src/paged/PagedWritingView';
			import { PaginationEngine } from './src/paged/PaginationEngine';
			import { serializePagedText } from './src/paged/textLayout';
			Object.assign(globalThis, { PagedWritingView, PaginationEngine, serializePagedText });`,
		resolveDir: root,
		loader: 'js',
	},
	bundle: true,
	write: false,
	format: 'iife',
	platform: 'browser',
	plugins: [{
		name: 'minimal-obsidian-host',
		setup(builder) {
			builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
			builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: obsidianStub, loader: 'js' }));
			if (plotSuite) {
				builder.onResolve({ filter: /^(\.\/WritingToolbar|\.\.\/export)$/ }, args => ({ path: args.path, namespace: 'toolbar-test' }));
				builder.onLoad({ filter: /.*/, namespace: 'toolbar-test' }, args => ({ loader: 'js', contents: args.path.endsWith('WritingToolbar')
					? 'export class WritingToolbar { constructor(plugin, container) { this.toolbarEl = container.createDiv({cls:"wm-writing-toolbar wm-paged-toolbar"}); } destroy() { this.toolbarEl.remove(); } }'
					: 'export class HwpExportModal {} export class TxtExportModal {}' }));
			}
		},
	}],
});

async function runPagedChecks() {
	const { PagedWritingView, PaginationEngine, serializePagedText } = globalThis;
	const assert = (condition, message) => { if (!condition) throw new Error(message); };
	// Hidden Windows headless windows can suspend compositor callbacks even with
	// background throttling disabled. Keep the editor's queued work deterministic
	// while still using Chromium's real text/selection/layout implementation.
	window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 16);
	window.cancelAnimationFrame = handle => window.clearTimeout(handle);
	const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	const metrics = [];
	const helpers = {
		empty() { this.replaceChildren(); },
		addClass(...names) { this.classList.add(...names); },
		removeClass(...names) { this.classList.remove(...names); },
		hasClass(name) { return this.classList.contains(name); },
		toggleClass(name, value) { this.classList.toggle(name, value); },
		setText(value) { this.textContent = value; },
		setCssStyles(values) { Object.assign(this.style, values); },
		createEl(tag, options = {}) {
			const element = document.createElement(tag);
			if (options.cls) element.className = options.cls;
			if (options.text) element.textContent = options.text;
			if (options.type) element.type = options.type;
			if (options.placeholder) element.placeholder = options.placeholder;
			for (const [key, value] of Object.entries(options.attr || {})) element.setAttribute(key, value);
			this.appendChild(element);
			return element;
		},
		createDiv(options = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); },
		createSpan(options = {}) { return this.createEl('span', options); },
	};
	Object.assign(HTMLElement.prototype, helpers);
	globalThis.activeDocument = document;
	globalThis.activeWindow = window;
	const settings = {
		fontFamily: 'Arial', fontSize: 16, fontWeight: 400, lineHeight: 1.9,
		paragraphSpacing: 0, indentation: 0, backgroundColor: 'inherit',
		enableFocusMode: false, enableTypewriterScrolling: true, enableSmartInput: false,
		hrEnabled: false,
	};
	const plugin = {
		settings,
		projectContext: { getProjectForFile: () => ({ id: 'test-project' }) },
		toolbarManager: { mountPagedToolbar() {}, removeToolbarFromLeaf() {}, refreshToolbar() {}, refreshToolbarSelection() {} },
		notifyPagedEditorChanged() {}, updateCharCountDebounced() {}, async saveData() {},
	};
	const mounted = [];
	async function makeView(source) {
		const containerEl = document.body.createDiv({ cls: 'test-leaf' });
		containerEl.createDiv();
		containerEl.createDiv();
		const view = new PagedWritingView({ containerEl, app: { scope: {} } }, plugin);
		await view.onOpen();
		view.setViewData(source, true);
		mounted.push(view);
		await frame();
		return view;
	}
	function checkPages(view) {
		// Flush the viewport change produced by typewriter centering as well; native
		// scroll delivery is compositor-driven and can be suspended when headless.
		view.renderVisiblePages();
		const source = view.getEditableData();
		let cursor = 0;
		for (const page of view.pages) {
			assert(page.from === cursor && page.to >= page.from, `Noncontiguous page ${page.index}`);
			cursor = page.to;
		}
		assert(cursor === source.length, 'Page ranges do not cover the source');
		for (const index of view.getVisibleRenderPageIndices(view.cachedSelection)) {
			const page = view.pages[index];
			const text = view.pageTextEls[index];
			assert(text, `Missing visible page interior ${index}`);
			assert(serializePagedText(text) === source.slice(page.from, page.to), `Stale visible page ${index}`);
		}
	}
	function selectOffset(view, position) {
		view.cachedSelection = { anchor: position, head: position };
		view.cachedSelectionPageIndex = view.findPageIndex(position);
		view.renderPageIfNeeded(view.cachedSelectionPageIndex);
		view.restoreSelection(view.cachedSelection, true);
	}
	function imeInsert(view, text, duplicateFinalInput = true) {
		const editor = view.editRootEl;
		const selection = document.getSelection();
		const start = view.readSelection().head;
		editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		const node = selection.focusNode;
		assert(node.nodeType === Node.TEXT_NODE, 'IME test needs a text node caret');
		const offset = selection.focusOffset;
		node.insertData(offset, text);
		selection.setBaseAndExtent(node, offset + text.length, node, offset + text.length);
		editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: text, isComposing: true }));
		editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
		if (duplicateFinalInput) editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
		assert(view.readSelection().head === start + text.length, 'Caret shifted or lost after IME commit');
	}

	try {
		const source = '가나다라마바사아자차카타파하 장면과 사건을 이어 쓰는 긴 문장입니다. '.repeat(6000).slice(0, 197378);
		console.info('Starting 197,378-character Chromium input checks');
		const coldStart = performance.now();
		const view = await makeView(source);
		metrics.push({ scenario: 'cold-197378', ms: Math.round(performance.now() - coldStart), pages: view.pages.length });
		console.info(JSON.stringify(metrics[metrics.length - 1]));
		const measurements = [];
		const measure = view.pagination.measureLineWindow.bind(view.pagination);
		view.pagination.measureLineWindow = (text, ...args) => {
			measurements.push(text.length);
			if (text.length >= 20_000) console.warn(`Long measurement: ${text.length} characters`);
			return measure(text, ...args);
		};
		const middlePage = Math.floor(view.pages.length / 2);
		selectOffset(view, view.pages[middlePage].from + 20);
		const expectedInsertFrom = view.cachedSelection.head;
		let committed = '';
		const durations = [];
		for (let index = 0; index < 80; index++) {
			const before = performance.now();
			imeInsert(view, '한');
			durations.push(performance.now() - before);
			committed += '한';
			await frame();
			if ((index + 1) % 20 === 0) console.info(`Committed ${index + 1} IME syllables`);
		}
		assert(view.getEditableData() === source.slice(0, expectedInsertFrom) + committed + source.slice(expectedInsertFrom), 'IME duplication or data loss');
		metrics.push({ scenario: '80-IME-middle', maxMs: Math.round(Math.max(...durations)), meanMs: +(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2), measuredMaxChars: Math.max(0, ...measurements) });
		console.info(JSON.stringify(metrics[metrics.length - 1]));
		checkPages(view);

		for (const zoom of [0.7, 1.6, 1]) {
			view.setZoom(zoom);
			await frame();
			const pageIndex = view.findPageIndex(view.cachedSelection.head);
			selectOffset(view, view.pages[pageIndex].to - 2);
			const beforeSource = view.getEditableData();
			const from = view.cachedSelection.head;
			const before = performance.now();
			imeInsert(view, '한글입력');
			await frame();
			assert(view.getEditableData() === beforeSource.slice(0, from) + '한글입력' + beforeSource.slice(from), `Zoom ${zoom}: source changed`);
			checkPages(view);
			metrics.push({ scenario: `page-boundary-zoom-${zoom}`, ms: Math.round(performance.now() - before) });
		}
		assert(Math.max(0, ...measurements) < 20_000, 'Boundary edit measured the long document suffix');
		selectOffset(view, view.cachedSelection.head);
		const cleanStart = measurements.length;
		view.editRootEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '한' }));
		assert(measurements.length === cleanStart, 'Unchanged final input triggered layout measurement');

		// A stale cached paragraph and equal-length edits must never authorize old
		// suffix reuse based only on the newest edit hint.
		const engine = new PaginationEngine(view.measurerEl, view.getPaginationGeometry());
		const original = '가나다라마바사'.repeat(1500);
		engine.paginate(original);
		const earlier = original.slice(0, 130) + ' '.repeat(25) + original.slice(155);
		const edited = earlier.slice(0, 900) + '바' + earlier.slice(901);
		const actual = engine.paginate(edited, 0, 0, () => false, { from: 900, to: 901, insertLength: 1 });
		const reference = new PaginationEngine(view.measurerEl, view.getPaginationGeometry()).paginate(edited);
		assert(JSON.stringify(actual) === JSON.stringify(reference), 'Stale cached edit hint changed the page boundaries');
		metrics.push({ scenario: 'stale-equal-length-hint', pages: actual.length, ok: true });
		const direct = new PaginationEngine(view.measurerEl, view.getPaginationGeometry());
		direct.measureAllLines = direct.measureLineWindow.bind(direct);
		const fullNodeReference = direct.paginate(edited);
		assert(JSON.stringify(reference) === JSON.stringify(fullNodeReference), 'Bounded measurement changed visual line boundaries');
		metrics.push({ scenario: 'window-vs-full-layout', pages: reference.length, ok: true });
		for (const [name, text, formats, indentation] of [
			['mixed-unicode', '한글 English ffi e\u0301 👩‍💻 😀 문장, 괄호(내용)와 탭\t '.repeat(250), [], 24],
			['inline-formatting', '한글과 italic bold text를 함께 표시합니다. '.repeat(250), [
				{ from: 31, to: 4300, kind: 'bold' }, { from: 4500, to: 6500, kind: 'italic' },
			], 0],
		]) {
			view.measurerEl.style.setProperty('--wm-paged-render-indent', `${indentation}px`);
			const bounded = new PaginationEngine(view.measurerEl, view.getPaginationGeometry());
			const unbounded = new PaginationEngine(view.measurerEl, view.getPaginationGeometry());
			bounded.updateInlineFormats(formats);
			unbounded.updateInlineFormats(formats);
			const actualLines = bounded.measureAllLines(text, true, 0);
			const expectedLines = unbounded.measureLineWindow(text, true, 0);
			assert(JSON.stringify(actualLines) === JSON.stringify(expectedLines), `${name}: windowed visual lines differ from full DOM layout`);
			metrics.push({ scenario: name, visualLines: actualLines.length, ok: true });
		}
		view.applyPaginationMeasurementVariables();

		// Do not let a repeating fixture hide the cost of a genuinely unique long
		// paragraph or the normal many-paragraph document case.
		let seed = 417;
		const nextCharacter = () => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return String.fromCharCode(0xac00 + seed % 11172);
		};
		const unique = Array.from({ length: 197378 }, nextCharacter).join('');
		for (const [name, content] of [
			['unique-unbroken', unique],
			['many-paragraphs', unique.match(/.{1,140}/g).join('\n')],
		]) {
			const documentView = await makeView(content);
			const pageIndex = Math.floor(documentView.pages.length / 2);
			selectOffset(documentView, documentView.pages[pageIndex].from + 15);
			const samples = [];
			for (let index = 0; index < 30; index++) {
				const start = performance.now();
				imeInsert(documentView, 'ㄱ');
				samples.push(performance.now() - start);
				await frame();
			}
			checkPages(documentView);
			metrics.push({ scenario: name, maxMs: Math.round(Math.max(...samples)), meanMs: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2) });
			console.info(JSON.stringify(metrics[metrics.length - 1]));
		}
		return { ok: true, metrics, browser: navigator.userAgent };
	} finally {
		for (const view of mounted) {
			await view.onClose();
			for (const cleanup of view.cleanups) cleanup();
			view.containerEl.remove();
		}
	}
}

const css = await readFile(path.join(root, 'styles.css'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">
<style>:root { --font-text: Arial; --text-normal: #222; --text-muted: #777; --text-faint: #aaa; --background-primary: white; --background-modifier-border: #ddd; }
body { margin: 0; } .test-leaf { height: 800px; width: 1280px; } .test-leaf > div:last-child { height: 800px; }</style>
</head><body><script src="/bundle.js"></script><script>window.runPagedChecks = ${suite.toString()};</script></body></html>`;
const server = createServer((request, response) => {
	const [type, body] = request.url === '/bundle.js' ? ['text/javascript', bundle.outputFiles[0].text]
		: request.url === '/styles.css' ? ['text/css', css] : ['text/html', html];
	response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
	response.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(path.join(tmpdir(), 'writing-menu-paged-check-'));
const browser = spawn(browserPath, [
	'--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
	'--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
	'--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
	const endpoint = await new Promise((resolve, reject) => {
		let output = '';
		const timeout = setTimeout(() => reject(new Error('Chromium debugger did not start')), 15000);
		browser.once('error', reject);
		browser.stderr.on('data', data => {
			output += data.toString();
			const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (match) { clearTimeout(timeout); resolve(match[1]); }
		});
	});
	const debugPort = new URL(endpoint).port;
	const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
	socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
	await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
	const pending = new Map();
	let nextId = 1;
	socket.onmessage = event => {
		const data = JSON.parse(event.data);
		if (data.method === 'Runtime.consoleAPICalled') {
			console.log(...data.params.args.map(arg => arg.value ?? arg.description));
		}
		if (data.id && pending.has(data.id)) {
			const { resolve, reject, timeout } = pending.get(data.id);
			clearTimeout(timeout);
			pending.delete(data.id);
			if (data.error) reject(new Error(JSON.stringify(data.error)));
			else resolve(data.result);
		}
	};
	const command = (method, params = {}) => new Promise((resolve, reject) => {
		const id = nextId++;
		const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 120000);
		pending.set(id, { resolve, reject, timeout });
		socket.send(JSON.stringify({ id, method, params }));
	});
	await command('Runtime.enable');
	await command('Emulation.setFocusEmulationEnabled', { enabled: true });
	if (plotSuite) await command('Emulation.setDeviceMetricsOverride', { width: 1100, height: 850, deviceScaleFactor: 1, mobile: false });
	await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
	for (let attempt = 0; attempt < 100; attempt++) {
		const ready = await command('Runtime.evaluate', { expression: 'typeof window.runPagedChecks === "function"', returnByValue: true });
		if (ready.result.value) break;
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	const result = await command('Runtime.evaluate', { expression: 'window.runPagedChecks()', awaitPromise: true, returnByValue: true });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
	console.log(JSON.stringify(result.result.value, null, 2));
	if (plotSuite) {
		const evaluate = async expression => {
			const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
			if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || JSON.stringify(response.exceptionDetails));
			return response.result.value;
		};
		try {
			const start = await evaluate('window.beginNativePlotScrollCheck()');
			for (let burst = 0; burst < 3; burst++) {
				await Promise.all(Array.from({ length: 8 }, () => command('Input.dispatchMouseEvent', {
					type: 'mouseWheel', x: 500, y: 300, deltaX: 120, deltaY: 1200,
				})));
				await evaluate('new Promise(resolve => setTimeout(resolve, 80))');
				const state = await evaluate('window.nativePlotScrollSnapshot()');
				if (state.top <= start.top || !state.trustedWheels) throw new Error('Trusted wheel input did not scroll the grid');
			}
			await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 300, button: 'middle', clickCount: 1 });
			await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500, y: 300, button: 'middle', clickCount: 1 });
			const beforeAuto = await evaluate('window.nativePlotScrollSnapshot()');
			if (!beforeAuto.autoScrolling) throw new Error('Trusted middle-click did not start synchronized autoscroll');
			await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 560 });
			await evaluate('new Promise(resolve => setTimeout(resolve, 100))');
			const afterAuto = await evaluate('window.nativePlotScrollSnapshot()');
			if (afterAuto.top <= beforeAuto.top) throw new Error('Trusted middle-click autoscroll did not move');
			await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
			await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
			if ((await evaluate('window.nativePlotScrollSnapshot()')).autoScrolling) throw new Error('Trusted Escape did not stop autoscroll');
			console.log('Trusted browser wheel flings, middle-click autoscroll and Escape passed');
		} finally {
			await evaluate('window.endNativePlotScrollCheck?.()');
		}
		const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
		await mkdir(path.join(root, '.codex-tmp'), { recursive: true });
		await writeFile(path.join(root, '.codex-tmp', 'foreshadow-modal-preview.png'), Buffer.from(screenshot.data, 'base64'));
		await evaluate("document.body.classList.add('theme-dark')");
		const darkScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
		await writeFile(path.join(root, '.codex-tmp', 'foreshadow-modal-preview-dark.png'), Buffer.from(darkScreenshot.data, 'base64'));
		await evaluate("document.body.classList.remove('theme-dark')");
	}
} finally {
	socket?.close();
	browser.kill();
	await new Promise(resolve => server.close(resolve));
	// Delete only the profile directory created by this test runner.
	if (path.dirname(profile) === tmpdir() && path.basename(profile).startsWith('writing-menu-paged-check-')) {
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
	}
}
