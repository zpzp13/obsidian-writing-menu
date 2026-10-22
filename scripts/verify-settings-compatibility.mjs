import assert from 'node:assert/strict';
import { loadTsFixture } from './ts-fixture-loader.mjs';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['scripts/generate-settings-search.mjs', '--check']);
let modern = false, saves = 0, updates = 0;
class Element {
	constructor() { this.classes = new Set(); this.children = []; this.listeners = {}; }
	addClass(...values) { values.forEach(value => this.classes.add(value)); }
	addClasses(values) { this.addClass(...values); }
	removeClass(value) { this.classes.delete(value); }
	toggleClass(value, enabled) { enabled ? this.addClass(value) : this.removeClass(value); }
	empty() { this.children = []; }
	remove() { this.removed = true; }
	createDiv() { const element = new Element(); element.parentElement = this; this.children.push(element); return element; }
	createEl() { return this.createDiv(); }
	querySelectorAll() { return []; }
	setAttribute() {}
	addEventListener(type, callback) { this.listeners[type] = callback; }
	insertBefore() {}
}
const rows = [];
class Setting {
	constructor(parent) { this.settingEl = parent.createDiv(); this.infoEl = this.settingEl.createDiv(); this.controlEl = this.settingEl.createDiv(); rows.push(this); }
	setName(value) { this.name = value; return this; }
	setDesc(value) { this.desc = value; return this; }
	control(callback) {
		const api = new Proxy({ inputEl: new Element() }, { get(target, key) { if (key in target) return target[key]; return (...args) => { if (key === 'onChange') target.change = args[0]; return api; }; } });
		callback(api); this.api = api; return this;
	}
	addText(callback) { return this.control(callback); }
	addDropdown(callback) { return this.control(callback); }
	addExtraButton(callback) { return this.control(callback); }
	addColorPicker(callback) { return this.control(callback); }
}
const { WritingMenuSettingTab } = loadTsFixture('src/settings/index.ts', {
	obsidian: { App: class {}, Notice: class {}, PluginSettingTab: class { constructor(app) { this.app = app; this.containerEl = new Element(); } update() { updates++; } }, Setting, setIcon() {}, Platform: { isMobile: false }, ToggleComponent: class {}, requireApiVersion: () => modern },
	'../wiki/WikiSettings': {}, '../plot-workbook/PlotWorkbookSettings': {}, '../wiki/WikiModals': {}, '../repetition/GaruAssets': {}, '../repetition/MorphAnalyzer': {}, '../aichat/DeusSettings': {}, '../fonts/MobileFontManager': { MOBILE_WEB_FONTS: [] },
});
const routes = [], settings = { footnoteFontFamily: 'inherit', footnoteFontSize: 13, footnoteLineHeight: 1.5, footnoteColor: '#123' };
const plugin = { manifest: { id: 'writing-menu' }, settings, saveSettings: async () => { saves++; } };
const app = { vault: new Proxy({}, { get() { throw Error('Metadata must not touch the vault'); } }), setting: { openPagePath: (...args) => routes.push(args) } };
const tab = new WritingMenuSettingTab(app, plugin);
assert.deepEqual(tab.getSettingDefinitions(), []);
tab.renderPage('footnotes');
const legacyNames = rows.map(row => row.name);
assert(legacyNames.includes('글꼴')); assert.equal(routes.length, 0);
await rows.find(row => row.name === '글꼴').api.change('Test font');
assert.equal(settings.footnoteFontFamily, 'Test font'); assert.equal(saves, 1);
modern = true; settings.secretApiKey = 'PRIVATE_KEY_MUST_NOT_BE_INDEXED';
const definitions = tab.getSettingDefinitions();
assert(!JSON.stringify(definitions).includes(settings.secretApiKey));
const pages = definitions.flatMap(group => group.items);
assert(pages.length >= 20);
assert(pages.filter(page => page.visible).length >= 20, 'Existing navigation entries must stay visible');
assert.deepEqual(pages.filter(page => page.visible).slice(0, 6).map(page => page.name), ['프로젝트', '통계 범위', 'API', '제어', '스냅샷', '기타']);
const ai = pages.find(page => page.name === 'Deus AI');
assert(ai.items[0].aliases.includes('각주 열기'), 'Search must include inner settings labels');
const page = pages.find(page => page.name === '각주');
rows.length = 0;
const wrapper = new Setting(new Element());
const cleanup = page.items[0].render(wrapper);
assert.deepEqual(rows.slice(1).map(row => row.name), legacyNames);
assert(wrapper.infoEl.removed && wrapper.controlEl.removed, 'Native wrapper must not duplicate the old page heading');
await rows.find(row => row.name === '글꼴').api.change('Native font');
assert.equal(settings.footnoteFontFamily, 'Native font'); assert.equal(saves, 2);
tab.renderPage('footnotes'); assert.equal(updates, 1);
cleanup(); tab.renderPage('footnotes');
assert.deepEqual(routes.at(-1), ['writing-menu', ['각주']]);
tab.renderPage('spellcheck-words');
const privateSpellingPage = pages.find(page => page.name === '기타').items.some(item => item.type === 'page' && item.name === '맞춤법 검사' && item.visible);
assert.deepEqual(routes.at(-1)[1], privateSpellingPage ? ['기타', '맞춤법 검사', '고유명사 관리'] : ['기타', '고유명사 관리']);
tab.renderPage('main'); assert.deepEqual(routes.at(-1)[1], []);
console.log('PASS legacy/native settings metadata, inner-label search, unchanged controls/saves, nested navigation, API-key exclusion and no vault access');
