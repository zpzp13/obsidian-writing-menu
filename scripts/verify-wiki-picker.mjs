import assert from 'node:assert/strict';
import { loadTsFixture } from './ts-fixture-loader.mjs';

class TFolder { constructor(path) { this.path = path; } }
class TFile { constructor(path, parent) { this.path = path; this.parent = parent; } }
let picker;
class Picker { constructor(app, choose) { this.choose = choose; picker = this; } open() {} }
const { WikiPanel } = loadTsFixture('src/wiki/WikiPanel.ts', {
	obsidian: { TFolder, TFile },
	'force-graph': {},
	'./WikiTypes': {},
	'./WikiModals': { FolderOrNoteSuggestModal: Picker },
	'./wikiProfileUtils': {},
});
let saves = 0, renders = 0;
const oldFolder = new TFolder('Characters');
const graphFolder = new TFolder('World');
const previous = new TFile('Characters/Old.md', oldFolder);
const note = new TFile('World/New.md', graphFolder);
const plugin = {
	settings: {}, app: { vault: { getAbstractFileByPath: () => null } },
	saveData: async () => { saves++; },
};
const panel = new WikiPanel(plugin, { register() {} });
panel.rerender = () => { renders++; };
panel.currentFile = previous; panel.targetFolder = oldFolder;
panel.openFolderPicker(); picker.choose(graphFolder);
assert.equal(panel.graphRootFolder, graphFolder);
assert.equal(panel.graphActive, true);
assert.equal(plugin.settings.wikiGraphRootFolderPath, graphFolder.path);
assert.equal(panel.currentFile, previous, 'Choosing a graph folder must preserve the current profile');
assert.equal(panel.targetFolder, oldFolder, 'The old profile folder must not become the graph scope');
panel.openFolderPicker(); picker.choose(note);
assert.equal(panel.graphActive, false, 'Choosing a note must return to its profile even from graph mode');
assert.equal(panel.currentFile, note); assert.equal(panel.targetFolder, graphFolder);
assert.equal(plugin.settings.wikiLastFilePath, note.path);
assert.deepEqual(panel.navigationHistory, [note.path]);
assert.equal(panel.graphRootFolder, graphFolder);
const root = new TFolder(''); panel.openFolderPicker(); picker.choose(root);
assert.equal(panel.graphRootFolder, root); assert.equal(panel.graphActive, true);
assert.equal(plugin.settings.wikiGraphRootFolderPath, '');
assert.equal(saves, 3); assert.equal(renders, 3);
console.log('PASS command picker folder → graph path and graph mode, note → profile and history, preserved current profile, vault root and saved state');
