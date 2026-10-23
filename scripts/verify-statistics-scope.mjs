import assert from 'node:assert/strict';
import moment from 'moment';
import { loadTsFixture } from './ts-fixture-loader.mjs';

class TFile {
	constructor(path, count = 100) {
		Object.assign(this, { path, count, extension: 'md', basename: path.split('/').pop().slice(0, -3),
			parent: { path: path.slice(0, path.lastIndexOf('/')) }, stat: { ctime: Date.now() } });
	}
}
const obsidian = { TFile, normalizePath: path => path.replaceAll('\\', '/').replace(/\/{2,}/g, '/') };
const { ProjectContextService } = loadTsFixture('src/projects/ProjectContextService.ts', { obsidian });
const { DailyCharStore } = loadTsFixture('src/dashboard/data/DailyCharStore.ts', { obsidian });
const internalPaths = ['.writing-menu/plot/sheets/root.md', 'Project/.writing-menu/plot/sheets/plot.md',
	'Project/.writing-menu/plot/transfer-backups/backup.md', 'Project/Nested/.writing-menu/paged-conflicts/conflict.md'];
const manuscriptPath = 'Project/본문/1.md';
const project = { id: 'project', rootFolder: 'Project', statisticsEnabled: true, statisticsFolders: [], statisticsExcludeFolders: [] };
const settings = { projects: [project], restrictStatisticsToProjects: false };
const context = new ProjectContextService({ settings });
for (const restrict of [false, true]) {
	settings.restrictStatisticsToProjects = restrict;
	for (const path of [...internalPaths, 'Project/.writing-menu', 'Project\\.writing-menu\\plot\\sheet.md']) {
		assert.equal(context.isInStatisticsScope(path), false, path);
		assert.equal(context.getStatisticsProjectForPath(path), null, path);
	}
	for (const path of [manuscriptPath, 'Project/.writing-menu.md', 'Project/.writing-menu-notes/chapter.md', 'Project/.hidden/note.md']) {
		assert.equal(context.isInStatisticsScope(path), true, path);
		assert.equal(context.getStatisticsProjectForPath(path), project, path);
	}
	assert.equal(context.isInStatisticsScope('Outside/note.md'), !restrict);
}
assert.equal(context.getProjectForPath(internalPaths[1]), project, 'Plot project ownership must remain available');
project.statisticsFolders = ['Project/.writing-menu/plot'];
assert.equal(context.isInStatisticsScope(internalPaths[1]), false, 'An explicit include must not admit plugin storage');
assert.equal(context.isInStatisticsScope(manuscriptPath), false);
project.statisticsFolders = ['Project/본문'];
assert.equal(context.isInStatisticsScope(manuscriptPath), true);
project.statisticsExcludeFolders = ['Project/본문'];
assert.equal(context.isInStatisticsScope(manuscriptPath), false);
project.statisticsExcludeFolders = [];
project.statisticsFolders = [];
project.statisticsEnabled = false;
assert.equal(context.isInStatisticsScope(manuscriptPath), false);
project.statisticsEnabled = true;

const previousWindow = globalThis.window, previousMoment = globalThis.moment;
const timers = new Map(); let timerId = 0;
globalThis.window = {
	setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
	clearTimeout(id) { timers.delete(id); },
};
globalThis.moment = moment;
try {
	for (const restrict of [false, true]) {
		const date = moment().format('YYYY-MM-DD'), reads = [], records = new Map();
		const paths = [manuscriptPath, ...internalPaths];
		const files = new Map(paths.map(path => [path, new TFile(path, path === manuscriptPath ? 160 : 2000)]));
		const stored = { charMode: 'munpia', today: { date,
			start: Object.fromEntries(paths.map(path => [path, 100])),
			current: Object.fromEntries(paths.map(path => [path, path === manuscriptPath ? 150 : 900])),
			carried: Object.fromEntries(paths.map(path => [path, path === manuscriptPath ? 7 : 300])),
		} };
		const plugin = { lastTypedAt: 0, settings: { projects: [project], restrictStatisticsToProjects: restrict,
			charCountMode: 'munpia', dailyNotesFolder: 'Daily', dailyNotesFormat: 'YYYY-MM-DD' }, app: {
			vault: { adapter: { read: async () => JSON.stringify(stored), write: async () => {} },
				getMarkdownFiles: () => [...files.values()], getAbstractFileByPath: path => files.get(path),
				cachedRead: async file => { reads.push(file.path); return '가'.repeat(file.count); },
				create: async path => { const file = new TFile(path); files.set(path, file); return file; } },
			metadataCache: { getFileCache: () => null }, workspace: { getActiveFile: () => null },
			fileManager: { processFrontMatter: async (file, update) => { const fm = {}; update(fm); records.set(file.path, fm); } },
		} };
		plugin.projectContext = new ProjectContextService(plugin);
		const store = new DailyCharStore(plugin);
		await store.init();
		assert.equal(store.getTodayTotal(), 57, 'Saved plot deltas and carried counts must be excluded');
		assert.equal(store.getTodayTotalForFolder('Project'), 57);
		assert.equal(store.getTodayTotalForFolder('Project/.writing-menu'), 0);
		assert.deepEqual(store.getTodayFileBreakdown(), [{ path: manuscriptPath, name: '1', written: 57, total: 150 }]);
		for (const path of internalPaths) {
			store.updateLiveCount(files.get(path), 3000);
			await store.onFileModify(files.get(path));
		}
		assert.equal(timers.size, 0, 'Plot edits must not schedule tracking or persistence');
		assert.deepEqual(reads, []);
		await store.onFileModify(files.get(manuscriptPath));
		for (const [id, timer] of [...timers]) {
			if (timer.delay === 3000) { timers.delete(id); timer.callback(); }
		}
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(store.getTodayTotal(), 67, 'Ordinary manuscript saves must still count');
		store.updateLiveCount(files.get(manuscriptPath), 170);
		assert.equal(store.getTodayTotal(), 77, 'Live manuscript edits must still count');
		plugin.settings.charCountMode = 'novelpia';
		await store.reinitSnapshot();
		assert.equal(store.getTodayTotal(), 77, 'Changing count mode must preserve only manuscript deltas');
		assert.deepEqual([...new Set(reads)], [manuscriptPath], 'Snapshots must not read plot or internal backup content');
		store.updateLiveCount(files.get(manuscriptPath), 180);
		assert.equal(store.getTodayTotal(), 97);
		await store.syncTodayRecord();
		assert.equal(records.get(`Daily/${date}.md`).글자수, 97, 'Daily notes must receive the filtered total');
		store.destroy();
		assert.equal(timers.size, 0);
	}
} finally {
	globalThis.window = previousWindow;
	globalThis.moment = previousMoment;
}
console.log('PASS plugin storage exclusion, project membership, saved daily totals, live edits, snapshots, mode changes and daily note writes');
