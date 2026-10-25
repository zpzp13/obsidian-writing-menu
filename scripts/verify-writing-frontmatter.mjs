import assert from 'node:assert/strict';
import * as stateApi from '@codemirror/state';
import { history, isolateHistory, undo } from '@codemirror/commands';
import yaml from 'js-yaml';
import { loadTsFixture } from './ts-fixture-loader.mjs';

class MarkdownView { getViewType() { return 'markdown'; } }
class TFile { constructor(path) { this.path = path; this.basename = 'note'; } }
// Match the SDK's offsets: from/to contain only the YAML, including its final newline.
function getFrontMatterInfo(source) {
	const match = /^---\r?\n([\s\S]*?)^(?:---|\.\.\.)(?:\r?\n|$)/m.exec(source);
	if (!match || match.index !== 0) return { exists: false, from: 0, to: 0, contentStart: 0, frontmatter: '' };
	const from = source.indexOf('\n') + 1;
	return { exists: true, from, to: from + match[1].length, contentStart: match[0].length, frontmatter: match[1] };
}
const obsidian = { MarkdownView, TFile, setIcon() {}, getFrontMatterInfo, parseYaml: yaml.load, stringifyYaml: yaml.dump };
const bindings = { obsidian, '@codemirror/state': stateApi };
const { processWritingFrontmatter } = loadTsFixture('src/writing/WritingFrontmatter.ts', bindings);
const tick = () => new Promise(resolve => setImmediate(resolve));
const file = new TFile('Project/note.md');
let disk = '---\n총_시간: "00:00:00"\n보존: [하나, 둘]\n---\n삭제할 본문 가나다라';
let notices = 0, directWrites = 0, duringWrite = null, saveCalls = 0;
const view = Object.assign(new MarkdownView(), { file, containerEl: { isConnected: true }, lastSavedData: disk, dirty: false, saving: false });
let recent = { view };
const cm = { state: stateApi.EditorState.create({ doc: disk, selection: { anchor: disk.length }, extensions: [history()] }),
	dispatch(spec) { cm.state = cm.state.update(spec).state; view.dirty = true; } };
view.editor = { cm, getValue: () => cm.state.doc.toString(),
	offsetToPos(offset) { const line = cm.state.doc.lineAt(offset); return { line: line.number - 1, ch: offset - line.from }; },
	transaction() { throw new Error('CM6 properties must keep automatic updates out of undo history'); } };
const backspace = () => cm.dispatch({ changes: { from: cm.state.doc.length - 1, to: cm.state.doc.length },
	annotations: [stateApi.Transaction.userEvent.of('delete.backward'), isolateHistory.of('full')] });
// Model TextFileView's native comparison and save-in-progress guard. This same
// IO sequence also reproduces a merge notice in the actual Obsidian host.
const receiveDisk = () => {
	if (view.saving) return;
	const before = view.lastSavedData; view.lastSavedData = disk;
	if (before === disk) return;
	if (view.dirty && view.editor.getValue() !== disk && view.editor.getValue() !== before) notices++;
};
view.save = async () => {
	saveCalls++;
	const snapshot = view.editor.getValue(); view.lastSavedData = snapshot; view.dirty = false; view.saving = true;
	try { await tick(); const action = duringWrite; duringWrite = null; action?.(); disk = snapshot; receiveDisk(); }
	finally { view.saving = false; }
};
const app = { workspace: { getMostRecentLeaf: () => recent, getLeavesOfType: type => type === 'markdown' ? [{ view }] : [],
	getActiveFile: () => recent.view.file, getActiveViewOfType: () => recent.view,
	on() { return {}; }, offref() {} },
	vault: { getAbstractFileByPath: () => null, on() { return {}; }, offref() {} },
	metadataCache: { getFileCache: () => ({ frontmatter: yaml.load(getFrontMatterInfo(disk).frontmatter) }) },
	fileManager: { async processFrontMatter(_file, update) {
		directWrites++; const info = getFrontMatterInfo(disk), props = info.exists ? yaml.load(info.frontmatter) : {};
		update(props); const next = '---\n' + yaml.dump(props) + '---\n' + disk.slice(info.contentStart);
		await tick(); disk = next; receiveDisk();
	} } };

// Control: the previous save-then-processFrontMatter sequence must reproduce
// the native notice even though no external device changed the body.
const initial = disk;
backspace(); duringWrite = backspace; await view.save();
await app.fileManager.processFrontMatter(file, fm => { fm.총_시간 = '00:00:30'; });
assert.equal(notices, 1, 'The fixture did not reproduce the original local merge notice');
cm.state = stateApi.EditorState.create({ doc: initial, selection: { anchor: initial.length }, extensions: [history()] });
disk = initial; view.lastSavedData = initial; view.dirty = false; notices = 0; directWrites = 0; saveCalls = 0;

// Exercise the real 30-second dashboard callback, rather than a copy of it.
const intervals = new Map(); let timerId = 0;
const previousWindow = globalThis.window;
globalThis.window = { setInterval(action) { const id = ++timerId; intervals.set(id, action); return id; },
	clearInterval(id) { intervals.delete(id); }, setTimeout: () => 1, clearTimeout() {} };
class Element {
	constructor() { this.isConnected = true; this.dataset = {}; }
	createDiv() { return new Element(); } createSpan() { return new Element(); }
	empty() {} setCssStyles() {} addEventListener() {}
}
const { WritingTimeSection } = loadTsFixture('src/dashboard/WritingTimeSection.ts', { ...bindings,
	'./data/WritingTimeStore': { WritingTimeStore: { getFileTime: () => ({ writing: 0, total: 0 }), getDailyHistory: async () => [],
		parseTime: value => typeof value === 'string' ? value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) : 0 } },
	'./data/TaskParser': { TaskParser: { isDailyNoteFile: () => false } },
	'./WritingTimeChart': { WritingTimeChart: class { destroy() {} setHistory() {} setLive() {} } },
	'../utils/domUtils': { watchDisconnect() {} },
});
const plugin = { app, settings: { enableTimeTracking: true, currentTimeMode: 'writing', timeTotalKey: '총_시간',
	timeModes: [{ id: 'writing', label: '초고', frontmatterKey: '초고_시간', goalSeconds: 7200 }] },
	projectContext: { getStatisticsProjectForPath: () => null, isInStatisticsScope: () => true },
	pendingTimeUpdates: new Map(), pendingTimeSaveInFlight: new Set(), timeTrackingRevision: 0,
	onPagedEditorChange: () => () => {}, saveSettings: async () => {} };
try {
	await WritingTimeSection.render(new Element(), plugin);
	plugin.pendingTimeUpdates.get(file.path + ':writing').seconds = 30;
	plugin.pendingTimeUpdates.get(file.path + ':total').seconds = 30;
	backspace(); duringWrite = backspace;
	const uiTick = [...intervals.values()][1];
	for (let second = 0; second < 30; second++) uiTick();
	for (let turn = 0; turn < 20 && plugin.pendingTimeSaveInFlight.size; turn++) await tick();
	assert.equal(directWrites, 0, 'Background time accounting wrote the open Markdown file as an external change');
	assert.equal(notices, 0, 'Backspace during the 30-second time save raised a merge notice');
	assert.equal(saveCalls, 1, 'The current manuscript and its time were not saved together');
	assert.equal(plugin.pendingTimeUpdates.get(file.path + ':total').seconds, 0, 'Persisted time remained pending');
	await view.save();
	assert.equal(disk, view.editor.getValue(), 'A deletion made during the write was lost');
	assert(disk.endsWith('삭제할 본문 가나'), 'The two Backspaces were not preserved');
	const info = getFrontMatterInfo(disk), properties = yaml.load(info.frontmatter);
	assert.equal(properties.총_시간, '00:00:30'); assert.equal(properties.초고_시간, '00:00:30');
	assert.deepEqual(properties.보존, ['하나', '둘'], 'An unrelated property was changed');
	assert.equal(cm.state.selection.main.head, cm.state.doc.length, 'Property insertion moved the typing caret');
	assert(undo(cm), 'Background properties erased the preceding typing history');
	assert(view.editor.getValue().endsWith('삭제할 본문 가나다'), 'Undo did not undo the last Backspace');
	assert.equal(yaml.load(getFrontMatterInfo(view.editor.getValue()).frontmatter).총_시간, '00:00:30', 'Undo reverted background time accounting');

	// No global notice suppression: actual competing disk changes still reach the native guard.
	disk = disk.replace('삭제할 본문', '외부 본문'); receiveDisk();
	assert.equal(notices, 1, 'A real external body conflict was hidden');

	// A closed file uses Obsidian's atomic property processor and never touches this editor.
	view.containerEl.isConnected = false; const beforeClosed = view.editor.getValue();
	await processWritingFrontmatter(app, file, fm => { fm.총_시간 = '00:01:00'; });
	assert.equal(directWrites, 1); assert.equal(view.editor.getValue(), beforeClosed);
	view.containerEl.isConnected = true;

	// Insert a missing header without changing an empty or CRLF body; reject invalid YAML.
	for (const source of ['', '첫줄\r\n둘째\r\n', '---\n---\n본문', '---\n보존: 값\n...\n본문']) {
		cm.state = stateApi.EditorState.create({ doc: source });
		const normalized = view.editor.getValue(), body = normalized.slice(getFrontMatterInfo(normalized).contentStart);
		await processWritingFrontmatter(app, file, fm => { fm.총_시간 = '00:00:01'; });
		assert.equal(disk.slice(getFrontMatterInfo(disk).contentStart), body);
		assert.equal(yaml.load(getFrontMatterInfo(disk).frontmatter).총_시간, '00:00:01');
	}
	for (const source of ['---\n[broken\n---\n본문', '---\n- 목록\n---\n본문']) {
		cm.state = stateApi.EditorState.create({ doc: source }); const before = disk;
		await assert.rejects(processWritingFrontmatter(app, file, fm => { fm.총_시간 = '00:00:01'; }));
		assert.equal(view.editor.getValue(), source); assert.equal(disk, before);
	}
	// Open-file IO failures retain the committed buffer. Clear its accounting
	// delta once, while still reporting the error; retry only the native write.
	cm.state = stateApi.EditorState.create({ doc: '---\n총_시간: "00:00:00"\n---\n보존 본문' });
	const nativeSave = view.save; let pending = 30;
	view.save = async () => { throw new Error('native disk failure'); };
	await assert.rejects(processWritingFrontmatter(app, file, fm => { fm.총_시간 = '00:00:' + pending; }, () => { pending = 0; }), /native disk failure/);
	assert.equal(pending, 0, 'A native write failure left an already-applied time delta pending');
	view.save = nativeSave; await view.save();
	assert.equal(yaml.load(getFrontMatterInfo(disk).frontmatter).총_시간, '00:00:30');
	assert(disk.endsWith('보존 본문'));
	view.containerEl.isConnected = false; const processClosed = app.fileManager.processFrontMatter; let closedApplied = false;
	app.fileManager.processFrontMatter = async () => { throw new Error('closed disk failure'); };
	await assert.rejects(processWritingFrontmatter(app, file, () => {}, () => { closedApplied = true; }), /closed disk failure/);
	assert.equal(closedApplied, false, 'A failed closed-file write discarded pending time');
	app.fileManager.processFrontMatter = processClosed;
} finally { globalThis.window = previousWindow; }
console.log('PASS real 30-second time callback, Backspaces during IO, one native writer, time/property preservation, caret and undo, closed files, YAML boundaries and genuine conflicts');
