import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { loadTsFixture } from './ts-fixture-loader.mjs';

class Component {
	cleanups = [];
	addChild(child) { child.onload?.(); this.cleanups.push(() => child.unload?.()); return child; }
	register(fn) { this.cleanups.push(fn); }
	unload() { this.cleanups.forEach(fn => fn()); }
}
class TFile {
	constructor(path) { this.path = path; this.extension = path.split('.').at(-1); }
}
class BasesView extends Component {
	// The real controller assigns config only after the factory has returned.
	constructor(controller) { super(); this.app = controller.app; }
}
class Tracks extends Component {
	constructor(container, player, options) { super(); this.options = options; }
	setCollapsedGroups(keys) { this.collapsed = keys; }
	setMetadataEnabled(enabled) { this.metadataEnabled = enabled; }
	render(groups, emptyText) { this.result = { groups, emptyText }; }
}
let modern = true;
const { MusicLibraryBases, registerMusicLibraryBases, MUSIC_LIBRARY_BASES_TYPE } = loadTsFixture('src/views/MusicLibraryBases.ts', {
	obsidian: { Component, TFile, BasesView, requireApiVersion: () => modern, normalizePath: path => path.replaceAll('\\', '/').replace(/\/+$/, ''), parseYaml: yaml.load, stringifyYaml: yaml.dump },
	'./MusicLibraryTracks': { MusicLibraryTracks: Tracks },
});

function fixture(folders = ['Music/Pop "mix"']) {
	const plugin = new Component();
	const files = new Map(folders.map(path => [path, { path }]));
	const contents = new Map();
	const subscriptions = new Set();
	let saves = 0, writes = 0, registered;
	Object.assign(plugin, {
		settings: { musicFolderPaths: folders, musicFavorites: [] },
		saveSettings: async () => { saves++; },
		musicPlayer: { playlist: [], subscribe: cb => subscriptions.add(cb), unsubscribe: cb => subscriptions.delete(cb) },
		registerBasesView: (type, options) => { registered = { type, options }; return true; },
		app: { vault: {
			getAbstractFileByPath: path => files.get(path) ?? null,
			create: async (path, text) => { assert(!files.has(path)); const file = new TFile(path); files.set(path, file); contents.set(path, text); writes++; return file; },
			read: async file => contents.get(file.path),
			process: async (file, change) => { contents.set(file.path, change(contents.get(file.path))); writes++; },
		} },
	});
	return { plugin, files, contents, subscriptions, counts: () => ({ saves, writes }), registration: () => registered };
}

const empty = fixture([]);
assert.equal(await new MusicLibraryBases(empty.plugin).getFile(), null);
assert.deepEqual(empty.counts(), { saves: 0, writes: 0 });

const f = fixture();
const occupied = 'Music/Pop "mix"/Music Library.base';
f.files.set(occupied, new TFile(occupied)); f.contents.set(occupied, 'Do not replace user data');
const store = registerMusicLibraryBases(f.plugin);
assert(store instanceof MusicLibraryBases);
assert.equal(f.registration().type, MUSIC_LIBRARY_BASES_TYPE);
const [file, same] = await Promise.all([store.getFile(), store.getFile()]);
assert.equal(file, same);
assert.equal(file.path, 'Music/Pop "mix"/Music Library 2.base');
assert.equal(f.contents.get(occupied), 'Do not replace user data');
assert.equal(f.plugin.settings.musicLibraryBasePath, file.path);
assert.deepEqual(f.counts(), { saves: 1, writes: 1 });
const original = yaml.load(f.contents.get(file.path));
assert(original.formulas.wmMusicLibrary.includes('file.inFolder("Music/Pop \\"mix\\"")'));
assert.equal(original.views.length, 2);
assert(original.views.every(view => view.type === MUSIC_LIBRARY_BASES_TYPE));
assert.deepEqual(original.views[0].groupBy, { property: 'file.folder', direction: 'ASC' });
await store.getFile(); assert.equal(f.counts().writes, 1, 'Unchanged settings must not rewrite the base');

original.filters.and.push('file.ext == "flac"');
original.views[0].sort[0].direction = 'DESC';
original.formulas.userFormula = 'file.size / 1024';
f.contents.set(file.path, yaml.dump(original));
f.plugin.settings.musicFavorites = ['Music/Pop "mix"/Sting.mp3'];
f.plugin.settings.musicFolderPaths.push('Music/K-Pop');
for (const callback of f.subscriptions) callback();
await store.getFile();
const updated = yaml.load(f.contents.get(file.path));
assert.deepEqual(updated.filters, original.filters);
assert.deepEqual(updated.views, original.views);
assert.equal(updated.formulas.userFormula, original.formulas.userFormula);
assert.equal(updated.formulas.wmMusicFavorite, '["Music/Pop \\"mix\\"/Sting.mp3"].contains(file.path)');
assert(updated.formulas.wmMusicLibrary.includes('file.inFolder("Music/K-Pop")'));

f.contents.set(file.path, 'views: [invalid');
await assert.rejects(store.getFile());
assert.equal(f.contents.get(file.path), 'views: [invalid', 'Invalid user YAML must remain recoverable');

const track = path => ({ path, name: path.split('/').at(-1), resourcePath: path });
const a = track('Music/A.mp3'), b = track('Music/B.flac');
f.plugin.musicPlayer.playlist = [a, b];
const entry = item => ({ file: item, getValue: property => ({ isTruthy: () => true, toString: () => property === 'file.folder' ? 'Music' : '' }) });
const controller = {
	config: { get: () => [], set: () => {} },
	data: { groupedData: [{ hasKey: () => false, entries: [entry(b), entry(track('Outside.mp3')), entry(a)] }] },
};
const view = f.registration().options.factory(controller, { createDiv: () => ({}) });
assert.equal(view.config, undefined, 'Construction must not require a ready Bases config');
assert.doesNotThrow(() => view.onDataUpdated(), 'Ignore player updates before Bases is ready');
Object.assign(view, controller);
view.onDataUpdated();
assert.deepEqual(view.tracks.result.groups[0].tracks.map(track => track.path), [b.path, a.path], 'Respect Bases ordering and exclude unregistered music');
assert.deepEqual(view.tracks.collapsed, []);
assert.equal(view.tracks.metadataEnabled, true);
view.config = { get: key => key === 'wmMusicShowMetadata' ? false : [], set: () => {} };
view.onDataUpdated();
assert.equal(view.tracks.metadataEnabled, false);
const collapsedKey = JSON.stringify(['group', 'Music/Pop']);
view.config = { get: () => [collapsedKey], set: () => {} };
view.onDataUpdated();
assert.deepEqual(view.tracks.collapsed, [collapsedKey], 'Restore collapsed groups after config is assigned');
const group = (label, item) => ({ hasKey: () => true, key: { toString: () => label }, entries: [entry(item)] });
view.data = { groupedData: [group('Music/Pop', a), group('Music/Bgm', b)] };
view.onDataUpdated();
assert.equal(view.tracks.result.groups[0].key, collapsedKey);
view.data.groupedData.reverse(); view.onDataUpdated();
assert.equal(view.tracks.result.groups[1].key, collapsedKey, 'Group identity must survive reordering');
view.unload(); store.unload();
assert.equal(f.subscriptions.size, 0);

modern = false;
const old = fixture(); assert.equal(registerMusicLibraryBases(old.plugin), null); assert.equal(old.registration(), undefined);
modern = true;
const disabled = fixture(); disabled.plugin.registerBasesView = () => false;
assert.equal(registerMusicLibraryBases(disabled.plugin), null);
console.log('Music library Bases passed: native registration, escaped audio scope, durable views, concurrent creation, user filter preservation, favorites/folders sync, query ordering, cleanup and older/disabled Bases.');
