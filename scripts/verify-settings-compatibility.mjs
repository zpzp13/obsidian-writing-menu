import assert from 'node:assert/strict';
import { loadTsFixture } from './ts-fixture-loader.mjs';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['scripts/generate-settings-search.mjs', '--check']);
let modern = false, saves = 0, updates = 0, refresh = () => {};
class Element {
	constructor() { this.classes = new Set(); this.children = []; this.listeners = {}; }
	addClass(...values) { values.forEach(value => this.classes.add(value)); }
	addClasses(values) { this.addClass(...values); }
	removeClass(value) { this.classes.delete(value); }
	toggleClass(value, enabled) { enabled ? this.addClass(value) : this.removeClass(value); }
	empty() { for (const child of [...this.children]) child.remove(); }
	remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; this.removed = true; }
	createDiv(options = {}) { const element = new Element(); element.addClass(...(options.cls ?? '').split(' ').filter(Boolean)); element.textContent = options.text ?? ''; element.parentElement = this; this.children.push(element); return element; }
	createEl() { return this.createDiv(); }
	querySelectorAll() { return []; }
	closest(selector) { for (let element = this; element; element = element.parentElement) if (element.classes.has(selector.slice(1))) return element; return null; }
	setAttribute() {}
	addEventListener(type, callback) { this.listeners[type] = callback; }
	insertBefore() {}
}
const rows = [];
const rowsWithin = container => rows.filter(row => {
	for (let element = row.settingEl.parentElement; element; element = element.parentElement) if (element === container) return true;
	return false;
});
const namesWithin = container => rowsWithin(container).map(row => row.name);
class Setting {
	constructor(parent) { this.settingEl = parent.createDiv(); this.infoEl = this.settingEl.createDiv(); this.controlEl = this.settingEl.createDiv(); rows.push(this); }
	setName(value) { this.name = value; return this; }
	setDesc(value) { this.desc = value; return this; }
	setHeading() { return this; }
	control(callback) {
		const api = new Proxy({ inputEl: new Element() }, { get(target, key) { if (key in target) return target[key]; return (...args) => { if (key === 'onChange') target.change = args[0]; if (key === 'onClick') target.click = args[0]; if (key === 'setValue') target.value = args[0]; return api; }; } });
		callback(api); this.api = api; (this.controls ??= []).push(api); return this;
	}
	addText(callback) { return this.control(callback); }
	addTextArea(callback) { return this.control(callback); }
	addDropdown(callback) { return this.control(callback); }
	addExtraButton(callback) { return this.control(callback); }
	addButton(callback) { return this.control(callback); }
	addColorPicker(callback) { return this.control(callback); }
}
const i18n = loadTsFixture('src/i18n/index.ts');
const { WritingMenuSettingTab } = loadTsFixture('src/settings/index.ts', {
	'../i18n/index': i18n,
	obsidian: { App: class {}, Notice: class {}, PluginSettingTab: class { constructor(app) { this.app = app; this.containerEl = new Element(); } update() { updates++; refresh(); } }, Setting, setIcon() {}, Platform: { isMobile: false }, ToggleComponent: class {}, requireApiVersion: () => modern },
	'../wiki/WikiSettings': {}, '../plot-workbook/PlotWorkbookSettings': {}, '../wiki/WikiModals': {}, '../repetition/GaruAssets': {}, '../repetition/MorphAnalyzer': {}, '../aichat/DeusSettings': {}, '../fonts/MobileFontManager': { MOBILE_WEB_FONTS: [] },
});
const routes = [], settings = { hrContent: '✦ ✦ ✦', hrColor: '#123' };
let styleUpdates = 0;
const plugin = { manifest: { id: 'writing-menu' }, settings, saveSettings: async () => { saves++; }, leafStyleManager: { updateDynamicStyles: () => { styleUpdates++; } } };
const app = { vault: new Proxy({}, { get() { throw Error('Metadata must not touch the vault'); } }), setting: { openPagePath: (...args) => routes.push(args) } };
const tab = new WritingMenuSettingTab(app, plugin);
assert.deepEqual(tab.getSettingDefinitions(), []);
tab.renderPage('divider');
const legacyNames = rows.map(row => row.name);
assert(legacyNames.includes('내용')); assert.equal(routes.length, 0);
await rows.find(row => row.name === '내용').api.change('Test divider');
assert.equal(settings.hrContent, 'Test divider'); assert.equal(saves, 1);
tab.renderPage('misc');
assert.equal(namesWithin(tab.containerEl).filter(name => name === '고유명사 관리').length, 1, 'Legacy navigation must retain one proper-noun entry');
modern = true; settings.secretApiKey = 'PRIVATE_KEY_MUST_NOT_BE_INDEXED';
const definitions = tab.getSettingDefinitions();
assert(!JSON.stringify(definitions).includes(settings.secretApiKey));
const pages = definitions.flatMap(group => group.items);
const editor = definitions.find(group => group.heading === '편집기');
assert.equal(editor.items.filter(page => page.visible)[0].name, '도구', 'Tools must be first in the editor section');
const tools = pages.find(page => page.name === '도구');
assert.equal(tools.items.length, 1, 'Tools must contain a single native card');
assert.equal(tools.items[0].type, 'group', 'Tools navigation must use the native card renderer without a custom placeholder');
assert(!tools.items[0].render, 'An empty custom row would remove the card background and leave a stray divider');
const fonts = tools.items[0].items.find(page => page.type === 'page' && page.name === '글꼴');
assert.equal(typeof fonts.page, 'function', 'Fonts must open their own native page');
assert(!fonts.items, 'A native font page must not be wrapped in a custom setting card');
tab.renderPage('fonts'); assert.deepEqual(routes.at(-1), ['writing-menu', ['도구', '글꼴']]);
assert(pages.length >= 20);
assert(pages.filter(page => page.visible).length >= 19, 'Remaining navigation entries must stay visible');
assert.deepEqual(pages.filter(page => page.visible).slice(0, 6).map(page => page.name), ['프로젝트', '통계 범위', 'API', '제어', '스냅샷', '기타']);
const ai = pages.find(page => page.name === 'Deus AI');
assert(ai.items[0].aliases.includes('각주 열기'), 'Search must include inner settings labels');
const page = pages.find(page => page.name === '커스텀 구분선');
assert(!pages.some(page => page.id === 'document-styles' || page.name === '헤딩·각주 스타일'), 'Retired typography page remains indexed');
assert(!pages.some(page => page.name === '각주'), 'Retired footnote controls remain indexed');
rows.length = 0;
const wrapper = new Setting(new Element());
let cleanup = page.items[0].render(wrapper);
refresh = () => { cleanup(); cleanup = page.items[0].render(wrapper); };
assert.deepEqual(rows.slice(1).map(row => row.name), legacyNames);
assert(wrapper.infoEl.removed && wrapper.controlEl.removed, 'Native wrapper must not duplicate the old page heading');
assert(wrapper.settingEl.parentElement.classes.has('wm-settings-page-items'), 'The native page card must be distinguished from the section cards');
assert(!wrapper.settingEl.classes.has('wm-settings-page-items'), 'The card reset belongs on the host wrapper, not the custom page');
await rows.find(row => row.name === '내용').api.change('Native divider');
assert.equal(settings.hrContent, 'Native divider'); assert.equal(saves, 2);
tab.renderPage('divider'); assert.equal(updates, 1);
const sectionCount = wrapper.settingEl.children.length;
assert.deepEqual(namesWithin(wrapper.settingEl), legacyNames, 'Updating a reused native row must replace the existing controls');
for (let attempt = 0; attempt < 3; attempt++) {
	settings.hrColor = '#123456';
	const savesBefore = saves;
	await rowsWithin(wrapper.settingEl).find(row => row.name === '색상').controls[0].click();
	assert.equal(settings.hrColor, ''); assert.equal(saves, savesBefore + 1);
	assert.deepEqual(namesWithin(wrapper.settingEl), legacyNames, 'Repeated color resets must leave one copy of the divider controls');
	assert.equal(wrapper.settingEl.children.length, sectionCount, 'Repeated resets must leave one section card');
	assert.equal(rowsWithin(wrapper.settingEl).find(row => row.name === '색상').api.value, '#888888');
}
refresh = () => {};
cleanup();
assert(!wrapper.settingEl.parentElement.classes.has('wm-settings-page-items'), 'Native card styling must be restored when the custom page is torn down');
tab.renderPage('footnotes');
assert.deepEqual(routes.at(-1), ['writing-menu', []]);
tab.renderPage('document-styles');
assert.deepEqual(routes.at(-1), ['writing-menu', []]);
tab.renderPage('spellcheck-words');
const privateSpellingPage = pages.find(page => page.name === '기타').items.some(item => item.type === 'page' && item.name === '맞춤법 검사' && item.visible);
assert.deepEqual(routes.at(-1)[1], privateSpellingPage ? ['기타', '맞춤법 검사', '고유명사 관리'] : ['기타', '고유명사 관리']);
tab.renderPage('main'); assert.deepEqual(routes.at(-1)[1], []);

// Render the custom content plus the visible child links, as the native host does.
const flatten = items => items.flatMap(item => item.type === 'group' ? flatten(item.items) : [item]);
const misc = pages.find(page => page.name === '기타');
const miscWrapper = new Setting(new Element());
const miscCleanup = misc.items[0].render(miscWrapper);
const links = flatten(misc.items).filter(item => item.type === 'page' && item.visible);
assert.equal(namesWithin(miscWrapper.settingEl).filter(name => name === '고유명사 관리').length, 0);
for (const link of links) new Setting(miscWrapper.settingEl.parentElement).setName(link.name);
assert.equal(namesWithin(miscWrapper.settingEl.parentElement).filter(name => name === '고유명사 관리').length, 1, 'Native misc page must show one proper-noun entry');
const spellingGroup = misc.items.find(item => item.type === 'group' && item.heading === '맞춤법 검사');
assert(spellingGroup?.items.some(item => item.type === 'page' && item.name === '고유명사 관리' && item.visible), 'The native navigation entry must remain grouped and searchable');
miscCleanup();

// Divider reset continues to use the native refresh path.
settings.hrColor = '#123456';
const divider = pages.find(page => page.name === '커스텀 구분선');
const dividerWrapper = new Setting(new Element());
let dividerCleanup = divider.items[0].render(dividerWrapper);
const dividerNames = namesWithin(dividerWrapper.settingEl);
refresh = () => { dividerCleanup(); dividerCleanup = divider.items[0].render(dividerWrapper); };
const styleUpdatesBefore = styleUpdates;
await rowsWithin(dividerWrapper.settingEl).find(row => row.name === '색상').controls[0].click();
assert.equal(settings.hrColor, ''); assert.equal(styleUpdates, styleUpdatesBefore + 1);
assert.deepEqual(namesWithin(dividerWrapper.settingEl), dividerNames, 'Divider reset must also avoid duplicate controls');
assert.equal(rowsWithin(dividerWrapper.settingEl).find(row => row.name === '색상').api.value, '#888888');
refresh = () => {}; dividerCleanup();
i18n.setLanguage('en');
const englishPages = tab.getSettingDefinitions().flatMap(group => group.items);
assert.deepEqual(englishPages.filter(page => page.visible).slice(0, 6).map(page => page.name), ['Projects', 'Statistics scope', 'API', 'Controls', 'Snapshots', 'Other']);
const englishAi = englishPages.find(page => page.name === 'Deus AI');
assert(englishAi.items[0].aliases.includes('Open citations'));
assert(englishAi.items[0].aliases.includes('각주 열기'));
assert(!JSON.stringify(englishPages).includes(settings.secretApiKey));
tab.renderPage('spellcheck-words');
assert.deepEqual(routes.at(-1), ['writing-menu', ['Other', 'Proper nouns']]);
const englishDivider = englishPages.find(page => page.name === 'Custom divider');
const englishWrapper = new Setting(new Element());
const englishCleanup = englishDivider.items[0].render(englishWrapper);
assert(namesWithin(englishWrapper.settingEl).includes('Content'));
assert(namesWithin(englishWrapper.settingEl).includes('Alignment'));
const englishSaves = saves;
await rowsWithin(englishWrapper.settingEl).find(row => row.name === 'Content').api.change('My English divider');
assert.equal(settings.hrContent, 'My English divider'); assert.equal(saves, englishSaves + 1);
englishCleanup(); i18n.setLanguage('ko');
console.log('PASS legacy/native settings metadata, repeated native refresh and color resets, single grouped proper-noun navigation, inner-label search, saves and API-key exclusion');
