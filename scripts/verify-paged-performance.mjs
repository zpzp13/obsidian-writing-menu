// Real Chromium layout regression checks; no vault, user files or Obsidian
// process is opened. Run with: node scripts/verify-paged-performance.mjs
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { builtinModules } from 'node:module';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { obsidianSearchStub } from './obsidian-search-stub.mjs';
import { installObsidianDomHelpers } from './obsidian-dom-stub.mjs';
import { assertCssVisualParity } from './css-visual-parity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const i18nSuite = process.argv.includes('--i18n');
const ragSettingsSuite = process.argv.includes('--rag-settings');
const reviewTabSuite = process.argv.includes('--review-tab');
const dashboardSuite = process.argv.includes('--dashboard') || ragSettingsSuite || reviewTabSuite;
const plotSuite = !dashboardSuite && (process.argv.includes('--plot') || i18nSuite);
const suite = i18nSuite ? (await import('./verify-i18n-ui.mjs')).runI18nUiChecks : dashboardSuite ? (await import('./verify-dashboard-ui-suite.mjs')).runDashboardChecks : plotSuite ? (await import('./verify-plot-ui-suite.mjs')).runPlotChecks : runPagedChecks;
const browserPath = process.env.PAGED_TEST_BROWSER || [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!browserPath) throw new Error('Set PAGED_TEST_BROWSER to an installed Chromium executable.');

if (plotSuite) {
	const source = ts.createSourceFile('main.ts',await readFile(path.join(root,'main.ts'),'utf8'),ts.ScriptTarget.Latest,true);
	const commands = [];
	const visit = node => {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'addCommand') {
			const properties = node.arguments[0]?.properties;
			const value = name => properties?.find(property=>property.name?.getText(source) === name)?.initializer;
			if (!value('icon') || !ts.isStringLiteral(value('icon')) || !value('icon').text) throw new Error(`Command without an icon: ${value('id')?.getText(source)}`);
			commands.push(value('id')?.getText(source));
		}
		ts.forEachChild(node,visit);
	};
	visit(source);
	if (!commands.length) throw new Error('No command registrations were checked');
	console.log(`All ${commands.length} registered plugin commands have explicit icons`);
}

const obsidianStub = obsidianSearchStub + `
export class Scope { register() {} }
// Native SDK contract double; dropdown styling/keymap are supplied by Obsidian.
export const prepareFuzzySearch = prepareSimpleSearch;
export function parseFrontMatterAliases(fm) { return fm?.aliases ?? []; }
export function renderResults(el, text) { el.setText(text); }
export class AbstractInputSuggest {
 constructor(app, input) {
  this.app = app;
  const update = () => { this.items = this.getSuggestions(this.getValue()); };
  input.addEventListener('input', update); input.addEventListener('focus', update);
 }
 close() {}
}

export class Notice { constructor(message) { console.warn(message); } }
export class WorkspaceLeaf {}
export class App {}
export class FileSystemAdapter {}
export const requireApiVersion = () => true;
export const getLanguage = () => 'en';
export const moment = { locale: () => 'ko' };
export class TFile {}
export class TFolder {}
export class Component {
	constructor() { this.cleanups = []; this.children = []; }
	register(cleanup) { this.cleanups.push(cleanup); }
	registerEvent(ref) { this.register(() => ref?.off?.()); }
	registerDomEvent(element, name, action, options) { element.addEventListener(name, action, options); this.register(() => element.removeEventListener(name, action, options)); }
	load() { this.onload?.(); }
	unload() { this.onunload?.(); for (const child of this.children.splice(0)) child.unload(); for (const cleanup of this.cleanups.splice(0)) cleanup(); }
	addChild(child) { this.children.push(child); child.load(); return child; }
	removeChild(child) { this.children = this.children.filter(item => item !== child); child.unload(); return child; }
}
export function parseYaml() { return {}; }
export function stringifyYaml(value) { return Object.entries(value).map(([key, item]) => key + ': ' + item).join(String.fromCharCode(10)); }
export function getFrontMatterInfo(source) { const match = /^---\\r?\\n([\\s\\S]*?)\\r?\\n---(?:\\r?\\n|$)/.exec(source); return { exists: !!match, frontmatter: match?.[1] ?? '', contentStart: match?.[0].length ?? 0 }; }
// Minimal MarkdownRenderer contract double. Real Obsidian supplies the parser;
// the fixture checks asynchronous DOM/citation integration, not parser fidelity.
export class MarkdownRenderer {
	static async render(app, markdown, element) {
		const inline = (host, value) => {
			let rest = value;
			while (rest.length) {
				const at = rest.indexOf('**');
				if (at < 0) { host.appendText(rest); break; }
				const end = rest.indexOf('**', at + 2);
				if (end < 0) { host.appendText(rest); break; }
				host.appendText(rest.slice(0, at)); host.createEl('strong', {text:rest.slice(at + 2,end)}); rest=rest.slice(end+2);
			}
		};
		let list;
		for (const line of markdown.split(String.fromCharCode(10))) {
			if (!line.trim()) { list=undefined; continue; }
			if (line.startsWith('- ') || line.startsWith('* ')) { list ??= element.createEl('ul'); inline(list.createEl('li'), line.slice(2)); continue; }
			list=undefined;
			if (line.startsWith('## ')) inline(element.createEl('h2'),line.slice(3));
			else if (line.startsWith('> ')) inline(element.createEl('blockquote').createEl('p'),line.slice(2));
			else inline(element.createEl('p'),line);
		}
	}
}
export const Platform = { isMobile: false };
export function setTooltip(element,text) { element.setAttribute('aria-label',text); }
export function requestUrl(options) { if (globalThis.mockChatRequest) return globalThis.mockChatRequest(options); throw new Error('Network access is not allowed in UI regression tests'); }
export function normalizePath(value) { return value.replace(/\\\\/g, '/'); }
export function sanitizeHTMLToDom(value) { const t = document.createElement('template'); t.innerHTML = value; return t.content; }
export function setIcon(element, name) {
	element.replaceChildren();
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.dataset.icon = name;
	const shape = document.createElementNS(svg.namespaceURI, 'path');
	shape.setAttribute('d', name === 'plus' ? 'M12 5v14M5 12h14' : name === 'chevron-down' ? 'm6 9 6 6 6-6' : name === 'search' ? 'M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0' : name === 'columns-3' ? 'M3 3h18v18H3ZM9 3v18M15 3v18' : name === 'rows-3' ? 'M3 3h18v18H3ZM3 9h18M3 15h18' : 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0');
	const paths = {
		'square':'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
		'square-check':'m9 11 3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
		'check':'m20 6-11 11-5-5','x':'m18 6-12 12M6 6l12 12','ellipsis':'M5 12h.01M12 12h.01M19 12h.01',
		'arrow-up-right':'M7 7h10v10M7 17 17 7','panel-right':'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM15 3v18',
		'chevron-left':'m15 18-6-6 6-6','chevron-right':'m9 18 6-6-6-6',
		'info':'M12 8h.01M12 12v4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
		'calendar-days':'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01',
	};
	if(paths[name]) { shape.setAttribute('d',paths[name]);svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round'); }
	svg.appendChild(shape); element.appendChild(svg);
}
export class Modal {
	constructor(app) {
		globalThis.lastTestModal = this;
		this.app = app;
		this.scope = new Scope();
		this.containerEl = document.body.createDiv({ cls: 'modal-container' });
		this.modalEl = this.containerEl.createDiv({ cls: 'modal' });
		this.titleEl = this.modalEl.createDiv({ cls: 'modal-header' });
		this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
		this.closeButtonEl = this.modalEl.createDiv({ cls: 'modal-close-button clickable-icon', attr: { role:'button', 'aria-label':'닫기' } });
		setIcon(this.closeButtonEl, 'x');
		this.closeButtonEl.addEventListener('click', () => this.close());
	}
	setTitle(value) { this.titleEl.setText(value); }
	open() { this.onOpen?.(); return this; }
	close() { this.onClose?.(); this.containerEl.remove(); }
}
export class FuzzySuggestModal extends Modal { setPlaceholder(value) { this.placeholder = value; } }
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
	addText(render) {
		const input = this.controlEl.createEl('input', {type:'text'});
		render({inputEl:input,setValue(value) {input.value=value;return this;},setPlaceholder(value) {input.placeholder=value;return this;},onChange(action) {input.addEventListener('input',()=>action(input.value));return this;}});
		return this;
	}
	addTextArea(render) { const input = this.controlEl.createEl('textarea'); render({ inputEl: input, setValue(value) { input.value = value; return this; }, onChange(action) { input.addEventListener('input', () => action(input.value)); return this; } }); return this; }
	addToggle(render) { render(new ToggleComponent(this.controlEl)); return this; }
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
	setClass(value) { this.buttonEl.addClass(value); return this; }
	setWarning() { this.buttonEl.addClass('mod-warning'); return this; }
	setCta() { this.buttonEl.addClass('mod-cta'); return this; }
	setDisabled(value) { this.buttonEl.disabled = value; return this; }
	onClick(action) { this.buttonEl.addEventListener('click', action); return this; }
}
export class SearchComponent {
	constructor(parent) { this.inputEl = parent.createDiv({cls:'search-input-container'}).createEl('input',{type:'search'}); }
	setPlaceholder(value) {this.inputEl.placeholder=value;return this;}
	setValue(value) {this.inputEl.value=value;return this;}
	onChange(action) {this.inputEl.addEventListener('input',()=>action(this.inputEl.value));return this;}
}
export class TextComponent {
	constructor(parent) { this.inputEl = parent.createEl('input', {type:'text'}); }
	setValue(value) { this.inputEl.value = value; return this; }
	onChange(action) { this.inputEl.addEventListener('input', () => action(this.inputEl.value)); return this; }
}
export class ToggleComponent {
	constructor(parent) {this.toggleEl=parent.createDiv({cls:'checkbox-container'});this.inputEl=this.toggleEl.createEl('input',{type:'checkbox'});}
	setValue(value) {this.inputEl.checked=value;this.toggleEl.classList.toggle('is-enabled',value);return this;}
	setDisabled(value) {this.inputEl.disabled=value;return this;}
	onChange(action) {this.inputEl.addEventListener('change',()=>{this.setValue(this.inputEl.checked);action(this.inputEl.checked);});return this;}
}
export class Menu {
	constructor() { this.items = []; globalThis.lastTestMenu?.dom?.remove(); this.dom = document.body.createDiv({ cls:'menu' }); this.dom.hidden = true; globalThis.lastTestMenu = this; }
	addItem(render) {
		const dom = this.dom.createDiv({ cls:'menu-item' });
		const icon = dom.createSpan({ cls:'menu-item-icon' });
		const item = { dom, setTitle(value) { this.title = value; return this; }, setIcon(value) { this.icon = value; setIcon(icon, value); return this; }, setChecked(value) { this.checked = value; return this; }, setDisabled(value) { this.disabled = value; return this; }, onClick(fn) { this.click = fn; return this; },
			setSubmenu() { this.submenu = Object.create(Menu.prototype); this.submenu.items = []; this.submenu.dom = dom.createDiv({cls:'menu-submenu'}); return this.submenu; } };
		render(item); this.items.push(item); return this;
	}
	addSeparator() { return this; }
	showAtPosition() {}
	showAtMouseEvent() {}
	onHide(callback) { this.hideCallback = callback; }
	hide() { const callback = this.hideCallback; this.hideCallback = null; callback?.(); return this; }
}
export class TextFileView extends Component {
	constructor(leaf) {
		super();
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
export class FileView extends TextFileView {onload() {} async onLoadFile() {} async onUnloadFile() {}}
export class ItemView extends TextFileView {
	constructor(leaf) { super(leaf); this.contentEl = this.containerEl.createDiv({cls:'view-content'}); }
}
`;
const bundle = await build({
	absWorkingDir: root,
	stdin: {
		contents: (i18nSuite ? `import './src/i18n/obsidian';
			import { SpecialCharsModal } from './src/special-chars/SpecialCharsModal';
			import { MonthCalendar } from './src/dashboard/MonthCalendar';
			import { PagedFileConflictModal } from './src/paged/PagedFileConflictModal';
			import { PlotWorkbookRowPicker } from './src/plot-workbook/PlotWorkbookRowPicker';
			import { TFile } from 'obsidian';
			Object.assign(globalThis, {SpecialCharsModal,MonthCalendar,PagedFileConflictModal,PlotWorkbookRowPicker,TFile});` : '') + (plotSuite ? `import { InfinitePlotSheet } from './src/plot-workbook/InfinitePlotSheet';
			import { PlotWorkbookForeshadowModal } from './src/plot-workbook/PlotWorkbookForeshadowModal';
			import { PlotWorkbookSheetTrashModal } from './src/plot-workbook/PlotWorkbookSheetTrashModal';
			import { PlotWorkbookSession } from './src/plot-workbook/PlotWorkbookSession';
			import { PlotWorkbookSessionStore, plotWorkbookSessions } from './src/plot-workbook/PlotWorkbookSessionStore';
			import { PlotWorkbookSidebarView } from './src/plot-workbook/PlotWorkbookSidebarView';
			import { PlotWorkbookChecklistEditor } from './src/plot-workbook/PlotWorkbookChecklistEditor';
			import { parseChecklist } from './src/plot-workbook/PlotWorkbookChecklist';
			import { createPagedEditorContextMenu } from './src/paged/PagedEditorContextMenu';
			import { runPlotChecklistSidebarChecks } from './scripts/verify-plot-checklist-sidebar.mjs';
			import { installNativePlotSelectionChecks } from './scripts/verify-plot-selection.mjs';
			import { installMobileToolbarChecks } from './scripts/verify-mobile-toolbar.mjs';
			import { runMobileSettingsChecks } from './scripts/verify-mobile-settings.mjs';
			import { runPlotTransferChecks } from './scripts/verify-plot-transfer.mjs';
			import { PlotWorkbookToolbar } from './src/plot-workbook/PlotWorkbookToolbar';
			import { plotWorkbookMarkdown, plotExportFileName, savePlotMarkdown, PlotWorkbookMarkdownExportModal } from './src/plot-workbook/PlotWorkbookMarkdownExport';
			import { WritingToolbar } from './src/toolbar/WritingToolbar';
			import { InstalledFontCache } from './src/toolbar/InstalledFontCache';
			import { PlotWorkbookRepository } from './src/plot-workbook/PlotWorkbookRepository';
			import { renderPlotWorkbookSettingsPage } from './src/plot-workbook/PlotWorkbookSettings';
			import { parsePlotWorkbookSearch } from './src/plot-workbook/PlotWorkbookSearch';
			import { createPlotWorkbookSheet } from './src/plot-workbook/PlotWorkbookTypes';
			import { LeafStyleManager } from './src/editor/LeafStyleManager';
			import { ToolbarManager } from './src/toolbar/ToolbarManager';
			import { MarkdownView, Platform } from 'obsidian';
			import { DEFAULT_SETTINGS } from './src/types';
			globalThis.runPlotTransferChecks = runPlotTransferChecks;
			Object.assign(globalThis, { InfinitePlotSheet, PlotWorkbookForeshadowModal, PlotWorkbookSheetTrashModal, PlotWorkbookSession, PlotWorkbookSessionStore, plotWorkbookSessions, PlotWorkbookSidebarView, PlotWorkbookChecklistEditor, parseChecklist, createPagedEditorContextMenu, runPlotChecklistSidebarChecks, installNativePlotSelectionChecks, installMobileToolbarChecks, runMobileSettingsChecks, plotWorkbookMarkdown, plotExportFileName, savePlotMarkdown, PlotWorkbookMarkdownExportModal, PlotWorkbookToolbar, WritingToolbar, InstalledFontCache, PlotWorkbookRepository, renderPlotWorkbookSettingsPage, parsePlotWorkbookSearch, createPlotWorkbookSheet, LeafStyleManager, ToolbarManager, MarkdownView, Platform, DEFAULT_SETTINGS });` : '') + `import { PagedWritingView } from './src/paged/PagedWritingView';
			import { PaginationEngine } from './src/paged/PaginationEngine';
			import { serializePagedText } from './src/paged/textLayout';
			import { runPagedDocumentChecks } from './scripts/verify-paged-document.mjs';
			import { installNativePagedInputChecks } from './scripts/verify-paged-native-input.mjs';
			import { runZenFullscreenChecks } from './scripts/verify-zen-fullscreen.mjs';
			globalThis.runZenFullscreenChecks = runZenFullscreenChecks;
			Object.assign(globalThis, { PagedWritingView, PaginationEngine, serializePagedText, runPagedDocumentChecks, installNativePagedInputChecks, pagedNativeOnly:${process.argv.some(flag=>['--native-input-only','--same-line-input-only','--stability-only'].includes(flag))} });` + (dashboardSuite ? `import { runDashboardCoreChecks, runRagSettingsControlsChecks } from './scripts/verify-dashboard-overhaul.mjs'; Object.assign(globalThis, {runDashboardCoreChecks,runRagSettingsControlsChecks,runOnlyRagSettings:${ragSettingsSuite},runOnlyReviewTab:${reviewTabSuite}});` : ''),
		resolveDir: root,
		loader: 'js',
	},
	bundle: true,
	write: false,
	format: 'iife',
	platform: 'browser',
	external: [...builtinModules],
	plugins: [{
		name: 'minimal-obsidian-host',
		setup(builder) {
			builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
			builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: obsidianStub, loader: 'js' }));
			if (plotSuite) {
				builder.onResolve({ filter: /^(\.\/WritingToolbar|\.\.\/export)$/ }, args => ({ path: args.path, namespace: 'toolbar-test' }));
				builder.onLoad({ filter: /.*/, namespace: 'toolbar-test' }, args => ({ loader: 'js', contents: args.path.endsWith('WritingToolbar')
					? 'export class WritingToolbar { constructor(plugin, container) { this.toolbarEl = container.createDiv({cls:"wm-writing-toolbar wm-paged-toolbar"}); } destroy() { this.toolbarEl.remove(); } }'
					: 'export class HwpxExportModal {} export class TxtExportModal {} export class DocxExportModal {} export class DocumentExportModal {} export function setExportIcon() {} export function registerExportIcons() {}' }));
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
	if(globalThis.pagedNativeOnly){globalThis.installNativePagedInputChecks();return {nativeOnly:true};}
	await globalThis.runPagedDocumentChecks();
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
		const localSettings = new Map();
		const view = new PagedWritingView({ containerEl, app: { scope: {},
			loadLocalStorage: key => localSettings.get(key), saveLocalStorage: (key, value) => localSettings.set(key, value) } }, plugin);
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
let nativeSnapshotCss = '';
if (plotSuite || process.argv.includes('--native-snapshot-preview')) {
	const archive = await readFile('C:/Users/82109/AppData/Local/Programs/Obsidian/resources/obsidian.asar');
	const header = JSON.parse(archive.subarray(16,16+archive.readUInt32LE(12)).toString('utf8'));
	const entry = header.files['app.css'], offset = 8+archive.readUInt32LE(4)+Number(entry.offset);
	nativeSnapshotCss = archive.subarray(offset,offset+entry.size).toString('utf8');
}
const liveFonts = process.argv.includes('--live-fonts');
const fetchFixture = async url => { const response = await fetch(url); if (!response.ok) throw new Error(`Font fixture HTTP ${response.status}`); return Buffer.from(await response.arrayBuffer()); };
const fixtureFont = plotSuite ? liveFonts
	? await fetchFixture('https://hangeul.pstatic.net/hangeul_static/webfont/MaruBuri/MaruBuri-Regular.woff2')
	: await readFile('C:/Windows/Fonts/arial.ttf') : null;
const fixtureRidi = plotSuite && liveFonts ? await fetchFixture('https://ridicorp.com/wp-content/themes/ridicorp/css/font/RIDIBatang.otf') : fixtureFont;
const extraFonts = plotSuite && liveFonts ? new Map(await Promise.all([
	['pretendard','https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-Regular.woff2'],
	['nanummyeongjo','https://raw.githubusercontent.com/google/fonts/main/ofl/nanummyeongjo/NanumMyeongjo-Regular.ttf'],
	['nanumgothic','https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/NanumGothic-Regular.ttf'],
	['spoqahansansneo','https://raw.githubusercontent.com/spoqa/spoqa-han-sans/master/Subset/SpoqaHanSansNeo/SpoqaHanSansNeo-Regular.woff2'],
].map(async([id,url])=>[id,await fetchFixture(url)]))) : new Map();
const html = `<!doctype html><html><head><meta charset="utf-8">${dashboardSuite && nativeSnapshotCss ? '<link rel="stylesheet" href="/native-snapshot.css">' : ''}<link rel="stylesheet" href="/styles.css">
<style>:root { --font-text: Arial; --text-normal: #222; --text-muted: #777; --text-faint: #aaa; --background-primary: white; --background-modifier-border: #ddd; }
body { margin: 0; } .test-leaf { height: 800px; width: 1280px; } .test-leaf > div:last-child { height: 800px; }</style>
</head><body><script>(${installObsidianDomHelpers.toString()})();</script><script src="/bundle.js"></script><script>window.runPagedChecks = ${suite.toString()};</script></body></html>`;
const server = createServer((request, response) => {
	if(request.url === '/extra-fonts.json') {response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify([...extraFonts.keys()]));return;}
	if(request.url?.startsWith('/extra-font/')) {
		const bytes=extraFonts.get(request.url.slice('/extra-font/'.length));response.writeHead(bytes?200:404,{'Content-Type':'application/octet-stream'});response.end(bytes);return;
	}
	if (request.url === '/test-font.ttf' && fixtureFont) {
		response.writeHead(200, { 'Content-Type':'font/ttf' }); response.end(fixtureFont); return;
	}
	if (request.url === '/test-ridi.otf' && fixtureRidi) {
		response.writeHead(200, { 'Content-Type':'font/otf' }); response.end(fixtureRidi); return;
	}
	const [type, body] = request.url === '/bundle.js' ? ['text/javascript', bundle.outputFiles[0].text]
		: request.url === '/styles.css' ? ['text/css', css] : request.url === '/native-snapshot.css' ? ['text/css', nativeSnapshotCss] : ['text/html', html];
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
	if (plotSuite || dashboardSuite) await command('Emulation.setDeviceMetricsOverride', { width: 1100, height: 850, deviceScaleFactor: 1, mobile: false });
	await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
	for (let attempt = 0; attempt < 100; attempt++) {
		const ready = await command('Runtime.evaluate', { expression: 'typeof window.runPagedChecks === "function"', returnByValue: true });
		if (ready.result.value) break;
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	const result = await command('Runtime.evaluate', { expression: 'window.runPagedChecks()', awaitPromise: true, returnByValue: true });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
	console.log(JSON.stringify(result.result.value, null, 2));
	if (!plotSuite && !dashboardSuite) {
		await command('Emulation.setDeviceMetricsOverride',{width:2600,height:1000,deviceScaleFactor:1,mobile:false});
		const evaluate = async expression => {const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result.value;};
		try {
			await evaluate('runZenFullscreenChecks()');
			const inserted=(state,text)=>state.expected.slice(0,state.position)+text+state.expected.slice(state.position+1);
			for(const zoom of [0.7,1,1.6])for(const typewriter of [false,true]){
				await evaluate(`nativePagedProbe.begin(${zoom},false,false,true)`);
				await evaluate(`nativePagedProbe.setTypewriter(${typewriter})`);
				await evaluate('nativePagedProbe.startStability()');
				for(let i=0;i<70;i++){
					await command('Input.imeSetComposition',{text:'ㄴ',selectionStart:1,selectionEnd:1});
					await evaluate('new Promise(resolve=>setTimeout(resolve,10))');
					await command('Input.insertText',{text:'ㄴ'});
				}
				await evaluate('new Promise(resolve=>setTimeout(resolve,40))');
				const trace=await evaluate('nativePagedProbe.stability()');
				const tops=trace.map(s=>s.textTop),spread=Math.max(...tops)-Math.min(...tops);
				console.log(JSON.stringify({scenario:'soft-wrap-stability',zoom,typewriter,spread,inner:trace.filter(s=>s.inner.some(n=>n!==0)).slice(0,4),positions:trace.filter((s,i)=>i&&Math.abs(s.top-trace[i-1].top)>0.5).slice(0,8)}));
				if(spread>1)throw new Error(`Wrapping native input moved an unchanged page up/down (${zoom},typewriter=${typewriter}): ${spread}px`);
			}
			for(const zoom of [0.7,1,1.6]){
				await evaluate(`nativePagedProbe.begin(${zoom},false,false,true)`);
				await evaluate('nativePagedProbe.longBoundary()');
				await command('Input.imeSetComposition',{text:'ㅇ'.repeat(20),selectionStart:20,selectionEnd:20});
				await evaluate('new Promise(resolve=>setTimeout(resolve,30))');
				const state=await evaluate('nativePagedProbe.snapshot()'),refs=await evaluate('nativePagedProbe.previewGlyphs()');
				if(!refs.length)throw new Error('Missing the page handoff preview');
				await command('Input.insertText',{text:'ㅇ'.repeat(20)});
				await evaluate('new Promise(resolve=>setTimeout(resolve,30))');
				const committed=await evaluate(`nativePagedProbe.committedGlyphs(${JSON.stringify(refs)})`);
				const drift=Math.max(...refs.map((ref,i)=>Math.abs(ref.top-committed[i].top)));
				console.log(JSON.stringify({scenario:'preview-to-page-stability',zoom,previewOffset:state.previewOffsetError,drift}));
				if(state.previewOffsetError>0.02||drift>0.02)throw new Error(`Composition handoff shifted text vertically (${zoom}): preview=${state.previewOffsetError}px,glyph=${drift}px`);
			}
			if(!process.argv.includes('--stability-only')){
			await evaluate('nativePagedProbe.begin(1,false,false,true)');
			await evaluate('nativePagedProbe.uniformLastLine()');
			await command('Input.imeSetComposition',{text:'ㄴ',selectionStart:1,selectionEnd:1});
			await command('Input.insertText',{text:'ㄴ'});
			const uniformMismatch=await evaluate('nativePagedProbe.cachedDomMismatches()');
			if(uniformMismatch.length)throw new Error(`A full repeated-consonant page reused stale native composition DOM: ${JSON.stringify(uniformMismatch)}`);
			const retired=await evaluate('nativePagedProbe.retiredCompositionDom()');
			if(!retired.cleanBefore||retired.text!=='ㄴ'.repeat(3001)||retired.mismatches.length)throw new Error(`Late retired composition DOM survived a matching clean cache: ${JSON.stringify(retired.mismatches)}`);
			for(const blank of [false,true])for(const typewriter of [false,true])for(const zoom of [1,0.7,1.6]){
				await evaluate(`nativePagedProbe.begin(${zoom},${blank},false,true)`);
				await evaluate(`nativePagedProbe.setTypewriter(${typewriter})`);
				if(!blank)await evaluate('nativePagedProbe.lastLineStart()');
				const initial=await evaluate('nativePagedProbe.snapshot()');
				for(let i=0;i<8;i++){
					await command('Input.imeSetComposition',{text:'ㅇ',selectionStart:1,selectionEnd:1});
					await command('Input.insertText',{text:'ㅇ'});
				}
				let expected=inserted(initial,'ㅇ'.repeat(8));
				const point=await evaluate(`nativePagedProbe.caretPoint(${initial.position+4})`);
				await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
				await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
				const selected=await evaluate('nativePagedProbe.snapshot()');
				if(selected.text!==expected||!selected.selection)throw new Error(`Cannot set up the last-line same-row input case (${blank},${typewriter},${zoom})`);
				const at=selected.selection.head;
				for(let i=0;i<320;i++){
					await command('Input.imeSetComposition',{text:'ㄴ',selectionStart:1,selectionEnd:1});
					await command('Input.insertText',{text:'ㄴ'});
					expected=expected.slice(0,at+i)+'ㄴ'+expected.slice(at+i);
					const state=await evaluate('nativePagedProbe.snapshot()');
					if(state.text!==expected)throw new Error(`Same last-row ㅇ then ㄴ input duplicated text (blank=${blank},typewriter=${typewriter},zoom=${zoom},key=${i}): actual=${state.text.length},expected=${expected.length},events=${JSON.stringify(await evaluate('nativePagedProbe.diagnostics()'))}`);
					const mismatches=await evaluate('nativePagedProbe.cachedDomMismatches()');
					if(mismatches.length)throw new Error(`Same last-row repeated ㄴ left duplicate native text behind (blank=${blank},typewriter=${typewriter},zoom=${zoom},key=${i}): ${JSON.stringify(mismatches)}`);
				}
			}
			console.log('Last visual line: repeated ㅇ then repeated ㄴ inside that same line preserves exact source at all zooms with typewriter off/on');
			if(!process.argv.includes('--same-line-input-only')){
			for(const zoom of [0.7,1,1.6]){
				await evaluate(`nativePagedProbe.begin(${zoom},false,false,true)`);
				let crossed=false;
				for(let i=1;i<=32;i++){
					await command('Input.imeSetComposition',{text:'ㅇ'.repeat(i),selectionStart:i,selectionEnd:i});
					await evaluate('new Promise(resolve=>setTimeout(resolve,25))');
					const caret=await evaluate('nativePagedProbe.visualCaret()');
					if(caret.pageIndex>caret.nativePageIndex){
						crossed=true;
						if(Math.abs(caret.centerError)>2)throw new Error(`First glyph entering the next row did not center that page (${zoom}): ${JSON.stringify(caret)}`);
						await evaluate('nativePagedProbe.forceNativeCaretScroll()');
						const pinned=await evaluate('nativePagedProbe.visualCaret()');
						if(Math.abs(pinned.centerError)>2)throw new Error(`Native caret scrolling pulled the first overflow glyph out of center (${zoom}): ${JSON.stringify(pinned)}`);
						await command('Input.insertText',{text:'ㅇ'.repeat(i)});break;
					}
				}
				if(!crossed)throw new Error(`Missing a third-column to first-column overflow glyph (${zoom})`);
			}
			console.log('The first IME glyph crossing from column three to the next row centers immediately at 70/100/160%');
			for(const typewriter of [false,true])for(const zoom of [0.7,1,1.6]){
				await evaluate(`nativePagedProbe.begin(${zoom},false,false,true)`);
				await evaluate(`nativePagedProbe.setTypewriter(${typewriter})`);
				const initial=await evaluate('nativePagedProbe.snapshot()');
				for(let i=0;i<120;i++){
					await command('Input.imeSetComposition',{text:'ㅇ',selectionStart:1,selectionEnd:1});
					await command('Input.insertText',{text:'ㅇ'});
				}
				await command('Input.imeSetComposition',{text:'ㅇ',selectionStart:1,selectionEnd:1});
				await evaluate('new Promise(resolve=>setTimeout(resolve,25))');
				const point=await evaluate(`nativePagedProbe.caretPoint(${initial.position+40})`);
				await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
				await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
				// CDP supplies the platform IME commit separately from the mouse event.
				// Deliver it after the click, as a delayed Windows commit can arrive.
				await command('Input.insertText',{text:'ㅇ'});
				const selected=await evaluate('nativePagedProbe.snapshot()');
				let expected=inserted(initial,'ㅇ'.repeat(121));
				if(selected.composing||selected.text!==expected)throw new Error(`Clicking back into held text while the final glyph is composing changed source (typewriter=${typewriter},zoom=${zoom}): actual=${selected.text.length},expected=${expected.length},composing=${selected.composing},events=${JSON.stringify(await evaluate('nativePagedProbe.diagnostics()'))}`);
				const at=selected.selection.head;
				for(let i=0;i<60;i++){
					await command('Input.imeSetComposition',{text:'한',selectionStart:1,selectionEnd:1});
					await command('Input.insertText',{text:'한'});
					expected=expected.slice(0,at+i)+'한'+expected.slice(at+i);
					if((await evaluate('nativePagedProbe.snapshot()')).text!==expected)throw new Error(`Re-entering before the last IME glyph committed duplicated source (typewriter=${typewriter},zoom=${zoom},key=${i})`);
				}
			}
			console.log('Moving back into held text before its final IME glyph commits preserves exact source with typewriter off/on at 70/100/160%');
			for(const typewriter of [false,true])for(const zoom of [0.7,1,1.6]){
				await evaluate(`nativePagedProbe.begin(${zoom},false,false,true)`);
				await evaluate(`nativePagedProbe.setTypewriter(${typewriter})`);
				const initial=await evaluate('nativePagedProbe.snapshot()');
				for(let i=0;i<160;i++){
					await command('Input.imeSetComposition',{text:'ㅇ',selectionStart:1,selectionEnd:1});
					await command('Input.insertText',{text:'ㅇ'});
				}
				let expected=inserted(initial,'ㅇ'.repeat(160));
				if((await evaluate('nativePagedProbe.snapshot()')).text!==expected)throw new Error(`Initial held input differs before re-entering (typewriter=${typewriter},zoom=${zoom})`);
				for(const relative of [90,5,140]){
					const point=await evaluate(`nativePagedProbe.caretPoint(${initial.position+relative})`);
					await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
					await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
					const selected=await evaluate('nativePagedProbe.snapshot()');
					if(selected.text!==expected)throw new Error(`Moving the caret changed text (typewriter=${typewriter},zoom=${zoom},relative=${relative})`);
					const at=selected.selection.head;
					for(let i=0;i<100;i++){
						const char=['ㅇ','ㄹ','한','a'][i%4];
						await command('Input.imeSetComposition',{text:char,selectionStart:1,selectionEnd:1});
						await command('Input.insertText',{text:char});
						expected=expected.slice(0,at+i)+char+expected.slice(at+i);
						const state=await evaluate('nativePagedProbe.snapshot()');
						if(state.text!==expected){let diff=0;while(state.text[diff]===expected[diff]&&diff<expected.length)diff++;throw new Error(`Typing inside held input duplicated or lost text (typewriter=${typewriter},zoom=${zoom},relative=${relative},key=${i},at=${at}): actual=${state.text.length},expected=${expected.length},diff=${diff},context=${JSON.stringify([state.text.slice(diff-15,diff+40),expected.slice(diff-15,diff+40)])},events=${JSON.stringify(await evaluate('nativePagedProbe.diagnostics()'))}`);}
					}
				}
			}
			console.log('Re-entering the middle of page-bottom held input preserves exact source with typewriter off/on at 70/100/160%');
			for(const zoom of [0.7,1,1.6]){
				await evaluate(`nativePagedProbe.begin(${zoom},false,false,true,0)`);
				for(let i=0;i<100;i++){
					await command('Input.imeSetComposition',{text:'ㅇ',selectionStart:1,selectionEnd:1});
					await command('Input.insertText',{text:'ㅇ'});
				}
				const state=await evaluate('nativePagedProbe.snapshot()');
				if(state.staleFlow.length)throw new Error(`First-column held IME keys left visible following pages stale (${zoom}): ${JSON.stringify(state.staleFlow)}`);
				const flow=await evaluate('nativePagedProbe.visibleFlow(true)');
				if(flow.stale.length||!flow.boundariesMatch)throw new Error(`Held IME page flow differs from a fresh layout (${zoom}): ${JSON.stringify(flow)}`);
				if(state.text!==inserted(state,'ㅇ'.repeat(100)))throw new Error(`First-column held IME keys changed untyped text (${zoom})`);
				await evaluate(`nativePagedProbe.begin(${zoom},false,false,true,0)`);
				for(let i=1;i<=80;i+=8){
					await command('Input.imeSetComposition',{text:'ㅇ'.repeat(i),selectionStart:i,selectionEnd:i});
					await evaluate('new Promise(resolve=>setTimeout(resolve,20))');
					const preview=await evaluate('nativePagedProbe.previewFlow()');
					if(preview.stale.length)throw new Error(`First-column ongoing IME preview left following pages stale (${zoom}): ${JSON.stringify(preview)}`);
				}
				await command('Input.insertText',{text:'ㅇ'.repeat(73)});
				await evaluate(`nativePagedProbe.begin(${zoom},false,false,true,0)`);
				const latinKeys=[];
				for(let i=0;i<100;i++)latinKeys.push(command('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',text:'a',unmodifiedText:'a',autoRepeat:i>0}));
				await Promise.all(latinKeys);
				await command('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA'});
				const latinState=await evaluate('nativePagedProbe.snapshot()');
				if(latinState.staleFlow.length)throw new Error(`First-column held Latin keys left visible following pages stale (${zoom}): ${JSON.stringify(latinState.staleFlow)}`);
				if(latinState.text!==inserted(latinState,'a'.repeat(100)))throw new Error(`First-column held Latin keys changed untyped text (${zoom})`);
			}
			console.log('First-column held IME/Latin keys and ongoing composition update every visible following page at 70/100/160%');
			for(const zoom of [0.7,1,1.6]){
				await evaluate(`nativePagedProbe.begin(${zoom},false,false,true)`);
				for(let i=1;i<=80;i++){
					await command('Input.imeSetComposition',{text:'ㅇ'.repeat(i),selectionStart:i,selectionEnd:i});
					if(i%8===0){
						await evaluate('new Promise(resolve=>setTimeout(resolve,20))');
						await evaluate('nativePagedProbe.forceNativeCaretScroll()');
						const state=await evaluate('nativePagedProbe.snapshot()');
						if(state.columns!==3||state.previewOffsetError>1)throw new Error(`Preview layout lost the three-column page grid (${zoom}): ${state.previewOffsetError}px`);
						if(state.previewInEditor||state.foreignMutations.length||state.rootPages!==state.pages)throw new Error(`Composition changed the native editing tree outside its active page: ${JSON.stringify({columns:state.columns,previews:state.previews,foreignMutations:state.foreignMutations.slice(0,10)})}`);
						const caret=await evaluate('nativePagedProbe.visualCaret()');
						if(Math.abs(caret.centerError)>2)throw new Error(`Visible composing glyph lost centering (${zoom}): ${JSON.stringify(caret)}`);
					}
				}
				await command('Input.insertText',{text:'ㅇ'.repeat(80)});
				await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
				let state=await evaluate('nativePagedProbe.snapshot()');
				if(state.text!==inserted(state,'ㅇ'.repeat(80)))throw new Error(`Continuous composition changed untyped text at ${zoom}`);
				await evaluate(`nativePagedProbe.begin(${zoom},false,false,true)`);
				const pending=[],characters=['ㅇ','ㄹ','a','한'];let text='';
				for(let i=0;i<120;i++){
					const character=characters[i%characters.length];text+=character;
					pending.push(command('Input.imeSetComposition',{text:character,selectionStart:1,selectionEnd:1}));
					pending.push(command('Input.insertText',{text:character}));
				}
				await Promise.all(pending);
				await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
				state=await evaluate('nativePagedProbe.snapshot()');
				if(state.text!==inserted(state,text))throw new Error(`An unpaced 120-key mixed input burst changed untyped text at ${zoom}`);
				await evaluate(`nativePagedProbe.begin(${zoom},false,false,true)`);
				const keys=[];let latin='';
				for(let i=0;i<120;i++){
					const character='abcxyz'[i%6];latin+=character;
					keys.push(command('Input.dispatchKeyEvent',{type:'keyDown',key:character,code:'Key'+character.toUpperCase(),text:character,unmodifiedText:character,autoRepeat:i>0}));
				}
				await Promise.all(keys);
				await command('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ'});
				await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
				state=await evaluate('nativePagedProbe.snapshot()');
				if(state.text!==inserted(state,latin))throw new Error(`An unpaced 120-key Latin keyboard burst changed untyped text at ${zoom}`);
				const pinned=state.scrollTop;
				await evaluate('nativePagedProbe.manualScroll()');
				state=await evaluate('nativePagedProbe.snapshot()');
				if(state.expectedScrollTop!==null||Math.abs(state.scrollTop-pinned)<10)throw new Error('Manual wheel scrolling could not release typewriter pinning');
			}
			console.log('All input helpers enabled: 3-column row-end IME tree stability, in-progress page centering, 80-character preedit, unpaced 120-key mixed IME and 120-key Latin keyboard bursts passed at 70/100/160%');
			for (const zoom of [0.7,1,1.6]) for (const blank of [false,true]) {
				await evaluate(`nativePagedProbe.begin(${zoom},${blank})`);
				for(let i=0;i<8;i++) {
					await command('Input.imeSetComposition',{text:'ㅇ',selectionStart:1,selectionEnd:1});
					await evaluate('new Promise(resolve=>setTimeout(resolve,25))');
				}
				await command('Input.insertText',{text:'ㅇ'});
				await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
				const state=await evaluate('nativePagedProbe.snapshot()');
				if(state.text!==state.expected || (state.domText.match(/ㅇ/g)||[]).length!==1) throw new Error(`Native IME duplicated or lost input at justified boundary (${zoom},blank=${blank}): source=${state.text.length}, expected=${state.expected.length}`);
			}
			await evaluate('nativePagedProbe.begin(1,true)');
			await command('Input.imeSetComposition',{text:'ㅇ',selectionStart:1,selectionEnd:1});
			await evaluate('nativePagedProbe.duplicatePreeditDom()');
			await command('Input.insertText',{text:'ㅇ'});
			await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
			let state=await evaluate('nativePagedProbe.snapshot()');
			if(state.text!==state.expected||(state.domText.match(/ㅇ/g)||[]).length!==1)throw new Error('Retired IME DOM nodes were imported as repeated ㅇ text');
			for(const zoom of [0.7,1,1.6]){
				await evaluate(`nativePagedProbe.begin(${zoom},false,true)`);
				for(let i=0;i<50;i++){
					await command('Input.imeSetComposition',{text:'ㅇ',selectionStart:1,selectionEnd:1});
					if(i%3===0)await evaluate('new Promise(resolve=>setTimeout(resolve,20))');
					await command('Input.insertText',{text:'ㅇ'});
				}
				await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
				state=await evaluate('nativePagedProbe.snapshot()');
				if(state.text!==state.expected.slice(0,-1)+'ㅇ'.repeat(50))throw new Error('Fast final-page IME input duplicated or lost characters');
				if(state.scrollTrace.some((top,index)=>index>0&&top<state.scrollTrace[index-1]-2))throw new Error(`Final-page typewriter scroll moved backwards at ${zoom}: ${JSON.stringify(state.scrollTrace)}`);
			}
			console.log('Trusted Chromium IME: one ㅇ at justified page/blank boundaries at 70/100/160% passed');
			console.log('Retired preedit DOM recovery and 50 fast final-page IME keys without scroll reversal at 70/100/160% passed');
			}
			}
		} finally {await evaluate('nativePagedProbe.dispose()');}
	}
	if (i18nSuite) {
		const output = path.join(root, '.codex-tmp', 'i18n-ui'); await mkdir(output, { recursive: true });
		const shot = await command('Page.captureScreenshot', { format: 'png' });
		await writeFile(path.join(output, 'english-desktop.png'), Buffer.from(shot.data, 'base64'));
	}
	if (dashboardSuite && !ragSettingsSuite && !reviewTabSuite) {
		const evaluate = async expression => { const result = await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description); return result.result.value; };
		const output = path.join(root,'.codex-tmp','dashboard-overhaul'); await mkdir(output,{recursive:true});
		const capture = async name => {
			const shot=await command('Page.captureScreenshot',{format:'png'}); await writeFile(path.join(output,name+'.png'),Buffer.from(shot.data,'base64')); console.log('UI preview:',path.join(output,name+'.png'));
			await assertCssVisualParity({
				evaluate: (fn, data) => evaluate(`(${fn.toString()})(${JSON.stringify(data) ?? ''})`),
				capture: async () => Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'),
			}, name);
		};
		await evaluate('document.body.firstElementChild.hidden=true'); await capture('cards-chat-light');
		await evaluate('dashboardPreview.setTheme(true)'); await capture('cards-chat-dark');
		await evaluate('dashboardPreview.setTheme(false); dashboardPreview.showSnapshot(); new Promise(resolve=>setTimeout(resolve,80))'); await capture('manuscript-snapshot');
		await evaluate("lastTestModal.contentEl.querySelector('.wm-snapshot-compare-label input').checked=true;lastTestModal.contentEl.querySelector('.wm-snapshot-compare-label input').dispatchEvent(new Event('change'))"); await capture('manuscript-snapshot-diff');
		await evaluate('lastTestModal.close()');
		await command('Emulation.setDeviceMetricsOverride',{width:1000,height:1300,deviceScaleFactor:1,mobile:false});
		await evaluate('dashboardPreview.revisionOnly(); new Promise(resolve=>setTimeout(resolve,80))'); await capture('revision-dashboard-light');
		const wideCards=await evaluate("(()=>{const cards=[...dashboardPreview.demo.querySelectorAll('.wm-revision-tiles > .wm-analysis-card')].map(card=>{const b=card.getBoundingClientRect();return {top:b.top,left:b.left};});return cards;})()");
		if(wideCards.length!==6||![0,2,4].every(i=>Math.abs(wideCards[i].top-wideCards[i+1].top)<1&&wideCards[i].left<wideCards[i+1].left))throw new Error('Revision cards do not form the requested three paired rows: '+JSON.stringify(wideCards));
		await evaluate("document.querySelector('.wm-analysis-flow-hit').dispatchEvent(new Event('pointerenter'))");await capture('revision-tooltip-light');
		await evaluate("document.querySelector('.wm-analysis-flow-hit').dispatchEvent(new Event('pointerleave'))");
		await evaluate('dashboardPreview.setTheme(true);new Promise(resolve=>setTimeout(resolve,250))'); await capture('revision-dashboard-dark');
		const darkControl=await evaluate("(()=>{const b=document.querySelector('.wm-analysis-segment button[aria-pressed=true]'),s=getComputedStyle(b);return {color:s.color,page:s.getPropertyValue('--wm-dash-page')};})()");
		if(darkControl.color!=='rgb(30, 30, 30)')throw new Error('Dark segmented control lost contrast: '+JSON.stringify(darkControl));
		await evaluate("document.querySelector('.wm-analysis-repeat-bar').dispatchEvent(new Event('pointerenter'))");await capture('revision-tooltip-dark');
		await evaluate("document.querySelector('.wm-analysis-repeat-bar').dispatchEvent(new Event('pointerleave'))");
		await evaluate('dashboardPreview.setTheme(false);dashboardPreview.timeOnly();new Promise(resolve=>setTimeout(resolve,80))');await capture('worktime-light');
		await evaluate('dashboardPreview.setTheme(true);new Promise(resolve=>setTimeout(resolve,250))');await capture('worktime-dark');
		await evaluate('dashboardPreview.hideTime();dashboardPreview.setTheme(false)');
		await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
		await evaluate('new Promise(resolve=>setTimeout(resolve,80))');
		const narrowCards=await evaluate("(()=>{const cards=[...dashboardPreview.demo.querySelectorAll('.wm-revision-tiles > .wm-analysis-card')].map(card=>{const b=card.getBoundingClientRect();return {top:b.top,left:b.left,right:b.right};});return cards;})()");
		if(!narrowCards.every((card,i)=>Math.abs(card.left-narrowCards[0].left)<1&&card.right<=390&&(i===0||card.top>narrowCards[i-1].top)))throw new Error('Narrow Revision did not collapse to one column: '+JSON.stringify(narrowCards));
		await capture('revision-dashboard-mobile');
		await evaluate('dashboardPreview.mobile()'); await capture('chat-mobile');
		await command('Emulation.setDeviceMetricsOverride',{width:390,height:440,deviceScaleFactor:1,mobile:false});
		await evaluate('dashboardPreview.mobile(390)'); await capture('chat-mobile-keyboard');
		await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
		await evaluate('deusStylePreview()'); await capture('deus-answer-mobile-light');
		await evaluate('dashboardPreview.setTheme(true)'); await capture('deus-answer-mobile-dark');
		const deusOverflow=await evaluate("(()=>{const e=document.querySelector('.deus-message-assistant .deus-text-block');return {width:e.clientWidth,scroll:e.scrollWidth,badges:document.querySelectorAll('.deus-citation-chip').length};})()");
		if(deusOverflow.scroll>deusOverflow.width+1||!deusOverflow.badges)throw new Error('Deus answer overflow or missing citations: '+JSON.stringify(deusOverflow));
		await evaluate('dashboardPreview.setTheme(false)');
		await evaluate("document.body.classList.add('is-phone','is-mobile');dashboardPreview.showSnapshot();new Promise(resolve=>setTimeout(resolve,80))");
		const phoneSnapshot=await evaluate("(()=>{const m=lastTestModal.contentEl,s=m.querySelector('.modal-sidebar').getBoundingClientRect(),d=m.querySelector('.sync-history-content-container').getBoundingClientRect();return {sidebarBottom:s.bottom,detailTop:d.top,height:d.height,overflow:m.scrollWidth>m.clientWidth+1};})()");
		if(phoneSnapshot.sidebarBottom>phoneSnapshot.detailTop+1||phoneSnapshot.height<200||phoneSnapshot.overflow)throw new Error('Mobile snapshot panes overlap: '+JSON.stringify(phoneSnapshot));
		await capture('manuscript-snapshot-mobile');
	}
	if (plotSuite && !i18nSuite) {
		const evaluate = async expression => {
			const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
			if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || JSON.stringify(response.exceptionDetails));
			return response.result.value;
		};
		await command('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false});
		await evaluate('window.runMobileSettingsChecks()');
		await evaluate('window.installMobileToolbarChecks(); window.verifyMobileToolbarAnimation()');
		console.log('Mobile toolbar diagnosis:',await evaluate('window.diagnoseMobileToolbarNativeTiming()'));
		await evaluate('window.verifyMobileThemeGuard()');
		await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
		try {
			await evaluate('window.mobileFontProbe.open()');
			await command('Input.insertText',{text:'마루'});
			const point = await evaluate('window.mobileFontProbe.optionPoint()');
			await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
			let state = await evaluate('window.mobileFontProbe.snapshot()');
			if (!state.searchFocused || !state.popover) throw new Error(`Touch-down blurred or closed mobile font search: ${JSON.stringify(state)}`);
			await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
			await evaluate('new Promise(resolve=>setTimeout(resolve,80))');
			state = await evaluate('window.mobileFontProbe.snapshot()');
			if (state.font !== 'maruburi' || state.desktopFont !== 'serif' || !state.cssFont.startsWith('monospace') || state.popover || Math.abs(state.width-state.beforeWidth) < 1) throw new Error(`Trusted mobile font choice did not change rendered text independently of PC: ${JSON.stringify(state)}`);
			await evaluate('window.mobileFontProbe.open()');
			await command('Input.insertText',{text:'마루'});
			await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});
			await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
			await evaluate('new Promise(resolve=>setTimeout(resolve,80))');
			state = await evaluate('window.mobileFontProbe.snapshot()');
			if (state.font !== 'maruburi' || state.desktopFont !== 'serif' || state.popover || !state.cssFont.startsWith('monospace')) throw new Error(`Trusted Enter did not apply the mobile font independently of PC: ${JSON.stringify(state)}`);
			console.log('Trusted mobile touch/Enter font selection updates Markdown CSS and rendered glyph widths');
		} finally {
			await evaluate('window.mobileFontProbe.dispose()');
			await command('Emulation.setTouchEmulationEnabled',{enabled:false});
		}
		await command('Emulation.setDeviceMetricsOverride', {width:1100,height:850,deviceScaleFactor:1,mobile:false});
		const dragMouse = async ({from,to}) => {
			await command('Input.dispatchMouseEvent',{type:'mouseMoved',...from});
			await command('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});
			await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+18,y:from.y+8,button:'left',buttons:1});
			await command('Input.dispatchMouseEvent',{type:'mouseMoved',...to,button:'left',buttons:1});
			await command('Input.dispatchMouseEvent',{type:'mouseMoved',...to,button:'left',buttons:1});
			await command('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',buttons:0,clickCount:1});
			await evaluate('new Promise(resolve=>setTimeout(resolve,80))');
		};
		for (const zoom of [1,1.6]) for (const vertical of [false,true]) {
			try {
				await dragMouse(await evaluate(`window.beginNativePlotPreviewDragCheck(${zoom},${vertical})`));
				let state = await evaluate('window.nativePlotPreviewDragSnapshot()');
				if (!state.swapped || !state.trustedStarts || !state.trustedDrops || state.active) throw new Error(`Trusted preview swap failed at ${zoom},vertical=${vertical}: ${JSON.stringify(state)}`);
				await dragMouse(await evaluate('window.prepareNativePlotPreviewMove()'));
				state = await evaluate('window.nativePlotPreviewDragSnapshot()');
				if (!state.moved || state.trustedStarts < 2 || state.trustedDrops < 2 || state.active) throw new Error(`Trusted preview move failed at ${zoom},vertical=${vertical}: ${JSON.stringify(state)}`);
			} finally { await evaluate('window.endNativePlotPreviewDragCheck?.()'); }
		}
		console.log('Trusted browser preview body dragging without edge handles: horizontal/covered vertical cell swap and move at 100%/160% passed');
		const clickMouse = async (point,modifiers=0,clickCount=1) => {
			await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point,modifiers});
			await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,modifiers,clickCount});
			await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,modifiers,clickCount});
		};
		for (const zoom of [1,1.6]) {
			try {
				for (const mode of ['enter','double-click']) {
					const point = await evaluate(`window.plotSelectionProbe.beginEditor(${zoom})`);
					if (mode === 'enter') {
						await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});
						await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
					} else { await clickMouse(point); await clickMouse(point,0,2); }
					await evaluate('new Promise(resolve=>setTimeout(resolve,40))');
					const points = await evaluate(`window.plotSelectionProbe.editorPoints(${zoom})`);
					await clickMouse(points.from); // Collapse the initial select-all before selecting a new phrase.
					await dragMouse(points);
					const state = await evaluate('window.plotSelectionProbe.editorSnapshot()');
					if (!state.editing || !state.focused || !state.selected || state.drags || state.cellDrag || !state.unchanged) throw new Error(`Native textarea phrase selection failed (${mode},${zoom}): ${JSON.stringify(state)}`);
				}
				for (const kind of ['long-to-long','covered','short-to-long']) {
					const range = await evaluate(`window.plotSelectionProbe.beginRange(${zoom},${JSON.stringify(kind)})`);
					await clickMouse(range.point,8);
					await evaluate('new Promise(resolve=>setTimeout(resolve,50))');
					const state = await evaluate('window.plotSelectionProbe.rangeSnapshot()');
					if (JSON.stringify(state.bounds) !== JSON.stringify(range.bounds) || !state.previewHidden || !state.boxVisible || !state.unchanged || state.drags) throw new Error(`Native preview Shift+click range failed (${kind},${zoom}): ${JSON.stringify(state)}`);
				}
			} finally {await evaluate('window.plotSelectionProbe.dispose()');}
		}
		console.log('Trusted browser Enter/double-click textarea phrase selection and Shift+click ranges through previews at 100%/160% passed');
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
		await evaluate("document.body.classList.remove('theme-dark'); window.beginPlotSidebarPreview()");
		const sidebarScreenshot = await command('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
		await writeFile(path.join(root,'.codex-tmp','plot-sidebar-preview.png'),Buffer.from(sidebarScreenshot.data,'base64'));
		await evaluate("document.body.classList.add('theme-dark')");
		await evaluate('new Promise(resolve => setTimeout(resolve, 80))');
		const sidebarDarkScreenshot = await command('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
		await writeFile(path.join(root,'.codex-tmp','plot-sidebar-preview-dark.png'),Buffer.from(sidebarDarkScreenshot.data,'base64'));
		await evaluate("document.body.classList.remove('theme-dark'); window.previewPlotSidebarColumn('plot')");
		const timelineScreenshot = await command('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
		await writeFile(path.join(root,'.codex-tmp','plot-sidebar-timeline-preview.png'),Buffer.from(timelineScreenshot.data,'base64'));
		await evaluate('window.previewPlotSidebarRow()');
		const rowScreenshot = await command('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
		await writeFile(path.join(root,'.codex-tmp','plot-sidebar-row-preview.png'),Buffer.from(rowScreenshot.data,'base64'));
		await evaluate("window.previewPlotSidebarColumn('checklist'); window.previewPlotChecklistPopup()");
		const popupScreenshot = await command('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
		await writeFile(path.join(root,'.codex-tmp','plot-checklist-popup-preview.png'),Buffer.from(popupScreenshot.data,'base64'));
		await evaluate("document.body.classList.add('theme-dark')");
		await evaluate('new Promise(resolve => setTimeout(resolve, 80))');
		const popupDarkScreenshot = await command('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
		await writeFile(path.join(root,'.codex-tmp','plot-checklist-popup-preview-dark.png'),Buffer.from(popupDarkScreenshot.data,'base64'));
		await evaluate('window.endPlotSidebarPreview()');
		await evaluate("document.body.classList.remove('theme-dark')");
		if (nativeSnapshotCss) {
			await evaluate(`new Promise(resolve=>{const css=document.createElement('link');css.rel='stylesheet';css.href='/native-snapshot.css';css.onload=resolve;document.head.prepend(css);})`);
			await evaluate('window.verifyMobileFullWidthBackground()');
			await command('Emulation.setDeviceMetricsOverride',{width:1100,height:850,deviceScaleFactor:1,mobile:false});
			await evaluate(`(async()=>{document.body.addClass('theme-light'); window.snapshotPreviewModal = await window.beginPlotSnapshotPreview();})()`);
			const snapshotScreenshot = await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
			await writeFile(path.join(root,'.codex-tmp','plot-snapshot-manager.png'),Buffer.from(snapshotScreenshot.data,'base64'));
			await evaluate('window.snapshotRestorePreview = window.verifyPlotSnapshotNativeLayout(window.snapshotPreviewModal)');
			const restoreScreenshot = await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
			await writeFile(path.join(root,'.codex-tmp','plot-snapshot-restore.png'),Buffer.from(restoreScreenshot.data,'base64'));
			await evaluate('window.snapshotRestorePreview.close()');
			await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
			await evaluate(`document.body.addClass('is-mobile','is-phone'); new Promise(resolve=>setTimeout(resolve,60))`);
			const snapshotMobileScreenshot = await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
			await writeFile(path.join(root,'.codex-tmp','plot-snapshot-manager-mobile.png'),Buffer.from(snapshotMobileScreenshot.data,'base64'));
			await evaluate('window.snapshotRestorePreview = window.verifyPlotSnapshotNativeLayout(window.snapshotPreviewModal)');
			const restoreMobileScreenshot = await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
			await writeFile(path.join(root,'.codex-tmp','plot-snapshot-restore-mobile.png'),Buffer.from(restoreMobileScreenshot.data,'base64'));
			await evaluate('window.snapshotRestorePreview.close()');
			await evaluate(`window.snapshotPreviewModal.close(); document.body.removeClass('is-mobile','is-phone')`);
		}
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
