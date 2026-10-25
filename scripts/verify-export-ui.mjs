import assert from 'node:assert/strict';
import * as fflate from 'fflate';
import { loadTsFixture } from './ts-fixture-loader.mjs';

class Element {
    constructor() { this.children = []; }
    empty() { this.children = []; }
    createEl(tag, options = {}) { const child = new Element(); Object.assign(child, { tag, ...options }); this.children.push(child); return child; }
    createSpan(options) { return this.createEl('span', options); }
    createDiv(options) { return this.createEl('div', options); }
    addClass() {}
    setCssStyles() {}
    addEventListener() {}
}
const rows = [];
class Setting {
    constructor(host) { this.settingEl = host.createDiv(); this.controlEl = this.settingEl.createDiv(); this.controls = []; rows.push(this); }
    setName(name) { this.name = name; return this; }
    setDesc(desc) { this.desc = desc; return this; }
    control(callback) {
        const control = { setValue(value) { this.value = value; return this; }, setDisabled(value) { this.disabled = value; return this; },
            setIcon() { return this; }, setTooltip() { return this; }, setButtonText(value) { this.label = value; return this; }, setCta() { return this; },
            onChange(fn) { this.change = fn; return this; }, onClick(fn) { this.click = fn; return this; } };
        this.controls.push(control); callback(control); return this;
    }
    addText(callback) { return this.control(callback); }
    addToggle(callback) { return this.control(callback); }
    addButton(callback) { return this.control(callback); }
    addExtraButton(callback) { return this.control(callback); }
}
class TFile {}
class TFolder {}
const platform = { isDesktop: true, isWin: true, isMacOS: false };
const obsidian = { Platform: platform, TFile, TFolder, Setting, Vault: {}, TAbstractFile: class {}, TextComponent: class {}, setIcon() {},
    Modal: class { constructor(app) { this.app = app; this.contentEl = new Element(); } close() { this.onClose(); } } };
const { HwpxExportModal, BatchExportModal } = loadTsFixture('src/export/index.ts', {
    fflate, obsidian, '../paged/PagedWritingView': { PagedWritingView: class {} },
});
const calls = [];
const plugin = { app: {}, settings: { hwpTemplatePath: 'C:\\양식.hwpx', exportDefaultSpaceIndent: true, exportDefaultExcludeHeadings: true },
    getDefaultExportPath: () => 'destination', openFolderPicker: async () => null,
    convertToHwpx: (...args) => calls.push(args), convertFilesToHwpx: (...args) => calls.push(args), convertFilesToHwpxMerged: (...args) => calls.push(args) };
const file = Object.assign(new TFile(), { path: 'Project/1.md', basename: '1', extension: 'md' });
const findToggle = () => rows.find(row => row.name === '템플릿 사용').controls[0];
const exportButton = () => rows.flatMap(row => row.controls).find(control => control.label === '내보내기');
let modal = new HwpxExportModal(plugin.app, plugin, file); modal.onOpen();
assert.equal(findToggle().value, true); assert.equal(findToggle().disabled, false);
findToggle().change(false); exportButton().click();
assert.equal(calls.at(-1).at(-1), false);
assert.equal(calls.at(-1)[1], '1.hwpx');
assert.equal(plugin.settings.hwpTemplatePath, 'C:\\양식.hwpx', 'plain export must not clear the configured template');
rows.length = 0;
platform.isWin = false; platform.isMacOS = true;
modal = new HwpxExportModal(plugin.app, plugin, file); modal.onOpen();
assert.equal(findToggle().value, false); assert.equal(findToggle().disabled, true);
assert(rows.find(row => row.name === '템플릿 사용').desc.includes('Windows'));
exportButton().click(); assert.equal(calls.at(-1).at(-1), false);
rows.length = 0;
platform.isWin = true; platform.isMacOS = false;
const second = Object.assign(new TFile(), { path: 'Project/2.md', basename: '2', extension: 'md' });
modal = new BatchExportModal(plugin.app, plugin, [second, file], 'hwpx');
modal.renderFileList = () => {}; modal.onOpen();
assert.equal(findToggle().value, true);
findToggle().change(false);
rows.find(row => row.name === '파일 병합').controls[0].change(true);
modal.sortedFiles = [second, file]; // User drag order and exclusion remain the batch source of truth.
exportButton().click();
assert.deepEqual(calls.at(-1)[0], [second, file]);
assert(calls.at(-1)[2].endsWith('.hwpx'));
assert.equal(calls.at(-1).at(-1), false);
console.log('PASS Windows template defaults, explicit plain mode, unchanged template settings, disabled macOS templates and merged export order/options');
