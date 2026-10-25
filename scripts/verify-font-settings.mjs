import assert from 'node:assert/strict';
import { loadTsFixture } from './ts-fixture-loader.mjs';

let saves = 0, coreSaves = 0, modern = true;
const coreFonts = ['Core interface font'];
const description = { setText(value) { this.textContent = value; } };
class NativeFontPage {
	constructor() { this.values = [...coreFonts]; this.onChange = () => coreSaves++; this.containerEl = { querySelector: () => description }; }
	display() { this.displayed = true; }
	hide() { this.hidden = true; }
}
const obsidian = { App: class {}, SettingPage: class {}, requireApiVersion: () => modern };
const { toolbarFonts, saveToolbarFonts, createToolbarFontSettingsPage } = loadTsFixture('src/settings/FontSettings.ts', { obsidian });
const plugin = { settings: { customFonts: ['Arial', 'Georgia', 'Arial'], fontFamily: 'Consolas' }, saveSettings: async () => { saves++; } };
assert.deepEqual(toolbarFonts(plugin), ['Arial', 'Georgia', 'Consolas']);
const app = { setting: { settingTabs: [{ id: 'appearance', getSettingDefinitions: () => [
	{ type: 'group', items: [{ type: 'page', name: 'Localized native font page', page: () => new NativeFontPage() }] },
] }] } };
const page = createToolbarFontSettingsPage(app, plugin);
assert(page instanceof NativeFontPage, 'Use the actual core page instance and lifecycle');
assert.deepEqual(page.values, ['Arial', 'Georgia', 'Consolas']);
page.display(); assert(page.displayed);
assert(description.textContent.includes('툴바'), 'Do not claim the saved choices are a font fallback stack');
page.values.splice(1, 0, page.values.splice(2, 1)[0]); page.onChange(page.values);
assert.deepEqual(plugin.settings.customFonts, ['Arial', 'Consolas', 'Georgia']);
assert.equal(plugin.settings.fontFamily, 'Consolas', 'Reordering must retain the selected font');
assert.notEqual(plugin.settings.customFonts, page.values, 'Native page must not own the persisted array');
page.values.splice(1, 1); page.onChange(page.values);
assert.equal(plugin.settings.fontFamily, 'inherit', 'Deleting the selected font must remove it from the toolbar too');
assert.deepEqual(toolbarFonts(plugin), ['Arial', 'Georgia']);
page.values.push('New font'); page.onChange(page.values);
assert.deepEqual(plugin.settings.customFonts, ['Arial', 'Georgia', 'New font']);
assert.equal(plugin.settings.fontFamily, 'inherit', 'Adding a saved choice must not apply a different font');
page.values.length = 0; page.onChange(page.values);
assert.deepEqual(toolbarFonts(plugin), []); assert.equal(plugin.settings.fontFamily, 'inherit');
assert.equal(saves, 4); assert.equal(coreSaves, 0); assert.deepEqual(coreFonts, ['Core interface font']);
page.hide(); assert(page.hidden);
assert(createToolbarFontSettingsPage({}, plugin) instanceof obsidian.SettingPage, 'A missing native bridge must fall back to public components');
assert(createToolbarFontSettingsPage({ setting: { settingTabs: [{ id: 'appearance', getSettingDefinitions() { throw Error('Changed host'); } }] } }, plugin) instanceof obsidian.SettingPage);
modern = false;
assert.throws(() => createToolbarFontSettingsPage(app, plugin), /1\.13\.0/);
saveToolbarFonts(plugin, ['Georgia']); assert.equal(saves, 5);
console.log('PASS core font page reuse, ordered toolbar choices, active-font deletion, add/delete persistence, core preference isolation and version fallback');
