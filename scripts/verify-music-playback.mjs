import assert from 'node:assert/strict';
import { loadTsFixture } from './ts-fixture-loader.mjs';

class AudioMock {
	src = ''; currentTime = 0; duration = 180; volume = 1; plays = 0; paused = true;
	listeners = new Map();
	addEventListener(event, callback) { this.listeners.set(event, callback); }
	removeEventListener(event) { this.listeners.delete(event); }
	play() { this.plays++; this.paused = false; return Promise.resolve(); }
	pause() { this.paused = true; }
}
globalThis.Audio = AudioMock;
globalThis.window = { location: { href: 'app://obsidian' } };
const { MusicPlayer } = loadTsFixture('src/dashboard/MusicPlayer.ts');
const track = name => ({ name: name.split('/').at(-1), path: `Music/${name}.mp3`, resourcePath: `app://Music/${name}.mp3` });
const [a, b, c, d] = ['Pop/A', 'Pop/B', 'Pop/C', 'Jazz/D'].map(track);
const plugin = {
	settings: { musicFolderPaths: ['Music'], musicFavorites: [] },
	saveSettings: async () => {},
	app: { vault: {
		getFiles: () => [a, b, c, d].map(item => ({ path: item.path, basename: item.name, extension: 'mp3' })),
		getResourcePath: file => `app://${file.path}`,
		adapter: {
			readBinary: async () => new ArrayBuffer(32),
		},
	} },
};
const player = new MusicPlayer(plugin);
await player.loadPlaylist();
const paths = () => player.viewPlaylist.map(item => item.path);
player.setPlaybackScope([d, b]);
player.playInScope(b, [d, b]); await Promise.resolve();
player.audio.currentTime = 42;
player.setMode('shuffle');
assert.deepEqual(new Set(paths()), new Set([d.path, b.path]), 'Shuffle must exclude filtered-out songs, even in the same folder');
assert.equal(player.currentTrack.path, b.path);
assert.equal(player.audio.currentTime, 42);
const shuffled = paths(); player.setMode('shuffle'); assert.deepEqual(paths(), shuffled, 'Repeated updates must not reshuffle');
player.setMode('loop');
assert.deepEqual(paths(), [d.path, b.path], 'Turning shuffle off must restore Bases ordering across folders');
player.next(); assert.equal(player.currentTrack.path, d.path);
player.audio.currentTime = 0; player.prev(); assert.equal(player.currentTrack.path, b.path);
await player.loadPlaylist(); assert.deepEqual(paths(), [d.path, b.path], 'Reloading files must retain the filtered scope');

player.setPlaybackScope([c, a]);
assert.equal(player.currentTrack.path, b.path, 'Filtering out an audible song must not change its title or interrupt audio');
assert.equal(player.audio.src, b.resourcePath);
player.setMode('shuffle'); assert.deepEqual(new Set(paths()), new Set([c.path, a.path]));
player.setMode('loop'); assert.deepEqual(paths(), [c.path, a.path]);
player.next(); assert.equal(player.currentTrack.path, c.path, 'Next starts at the first result when the old track was filtered out');
player.setPlaybackScope([]); player.setMode('shuffle');
assert.deepEqual(paths(), [], 'Empty results must never fall back to every song in the folder');
assert.equal(player.currentTrack.path, c.path);
player.audio.listeners.get('ended')(); assert.equal(player.isPlaying, false);
player.setMode('loop'); player.setPlaybackScope([d]); player.next(); assert.equal(player.currentTrack.path, d.path);
player.playInFolder(a); player.setMode('shuffle'); assert.deepEqual(new Set(paths()), new Set([a.path, b.path, c.path]), 'Explicit folder playback must still work');
player.setMode('loop');

// Exercise the production list's connection to the player, rather than only its queue methods.
class Element {
	children = []; events = new Map(); isConnected = true;
	querySelector() { return null; }
	createDiv() { return this.createEl(); }
	createSpan() { return this.createEl(); }
	createEl() { const child = new Element(); child.parent = this; this.children.push(child); return child; }
	setAttribute() {} toggleClass() {} addEventListener(name, callback) { this.events.set(name, callback); }
	insertBefore(child, next) { child.remove(); child.parent = this; this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, child); }
	remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
	empty() { this.children = []; }
}
const { MusicLibraryTracks } = loadTsFixture('src/views/MusicLibraryTracks.ts', {
	obsidian: { Component: class {}, setIcon() {} },
});
const tracks = new MusicLibraryTracks(new Element(), player);
tracks.render([{ key: 'Pop', label: 'Pop', tracks: [b] }, { key: 'Jazz', label: 'Jazz', tracks: [d] }], 'empty');
assert.deepEqual(paths(), [b.path, d.path], 'The rendered query must become the playback scope');
const row = tracks.rows.get(`Jazz\0${d.path}`);
row.el.events.get('click')({ target: { closest: () => null } });
assert.equal(player.currentTrack.path, d.path);
player.setMode('shuffle'); assert.deepEqual(new Set(paths()), new Set([b.path, d.path]));
player.setMode('loop'); assert.deepEqual(paths(), [b.path, d.path]);
tracks.render([{ key: 'Pop', label: 'Pop', tracks: [c, a] }], 'empty');
assert.deepEqual(paths(), [c.path, a.path]); assert.equal(player.currentTrack.path, d.path);
player.skip(-1); assert.equal(player.currentTrack.path, a.path);
tracks.render([], 'empty'); player.setMode('shuffle'); assert.deepEqual(paths(), []);
player.destroy();
console.log('PASS filtered and sorted playback, shuffle on/off, scope changes, empty results, folder playback and rendered query scope');
