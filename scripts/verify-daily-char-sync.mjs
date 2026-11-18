import assert from 'node:assert/strict';
import moment from 'moment';
import yaml from 'js-yaml';
import DiffMatchPatch from 'diff-match-patch';
import { loadTsFixture } from './ts-fixture-loader.mjs';

const { readDailyCharCount, writeDailyCharCount } = loadTsFixture('src/dashboard/data/DailyCharRecord.ts');
const date = moment().subtract(1, 'day').format('YYYY-MM-DD'), key = '글자수';
const dmp = new DiffMatchPatch();
const source = frontmatter => `---\n${yaml.dump(frontmatter)}---\n`;
const parse = text => yaml.load(text.slice(4, text.lastIndexOf('---')));
const merge = (base, local, remote) => dmp.patch_apply(dmp.patch_make(base, local), remote)[0];
const checked = count => { const fm = {}; writeDailyCharCount(fm, date, key, count); return fm; };

// Sync uses a text merge, not numeric addition: even four-digit inputs can become millions.
const legacy = count => source({ [key]: count });
const corrupt = parse(merge(legacy(7), legacy(2973), legacy(2977)));
assert.equal(corrupt[key], 2972973, 'Fixture no longer reproduces the Sync digit-splicing failure');
let replay = merge(legacy(2977), legacy(0), legacy(3012));
replay = merge(legacy(7), legacy(2977), replay);
replay = merge(legacy(0), legacy(2977), replay);
assert.equal(parse(replay)[key], 2_973_012_977, 'Repeated stale writes must reproduce the reported billion-character value');

for (const count of [0, 2977, 3012, 2_973_012_977]) {
	const fm = checked(count);
	assert.equal(readDailyCharCount(fm, date, key), count, 'A genuine large count must remain supported');
}
assert.equal(readDailyCharCount({ [key]: 2977 }, date, key), 2977, 'Legacy daily notes must remain readable');
for (const invalid of [Infinity, NaN, -1, 1.5, '2977', Number.MAX_SAFE_INTEGER + 1]) {
	assert.equal(readDailyCharCount({ [key]: invalid }, date, key), null);
}
const intact = checked(2977);
assert.equal(readDailyCharCount({ ...intact, [key]: 2_973_012_977 }, date, key), 2977, 'A spliced scalar must use the checked count');
assert.equal(readDailyCharCount(intact, '2000-01-01', key), null, 'A receipt from another day must not validate');
const damaged = structuredClone(intact);
damaged._writing_menu_char_counts[key] = damaged._writing_menu_char_counts[key].replace('2977', '2973012977');
assert.equal(readDailyCharCount(damaged, date, key), null, 'A spliced receipt must not validate');
for (const badRecords of [null, [], 'bad']) {
	assert.equal(readDailyCharCount({ [key]: 2_973_012_977, _writing_menu_char_counts: badRecords }, date, key), null);
}
const custom = { other: 'keep' };
writeDailyCharCount(custom, date, 'daily_chars', 3012);
writeDailyCharCount(custom, date, key, 2977);
assert.equal(readDailyCharCount(custom, date, 'daily_chars'), 3012);
assert.equal(custom.other, 'keep');

const mergedNotes = [];
for (const base of [7, 2973, 2977]) for (const local of [2973, 2977, 3012]) for (const remote of [2973, 2977, 3012]) {
	const fm = parse(merge(source(checked(base)), source(checked(local)), source(checked(remote))));
	const result = readDailyCharCount(fm, date, key);
	assert(result === null || [base, local, remote].includes(result), 'Sync synthesized an accepted count');
	mergedNotes.push(fm);
}

class TFile {
	constructor(path) {
		Object.assign(this, { path, extension: 'md', basename: path.split('/').pop().slice(0, -3), parent: { path: 'Daily' } });
	}
}
const obsidian = { TFile, normalizePath: value => value };
const { DailyCharStore } = loadTsFixture('src/dashboard/data/DailyCharStore.ts', { obsidian });
const previousWindow = globalThis.window, previousMoment = globalThis.moment;
globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
globalThis.moment = moment;
try {
	const file = new TFile(`Daily/${date}.md`);
	let fm = { ...intact, [key]: 2_973_012_977 }, writes = 0;
	const stored = { countPolicyVersion: 2, charMode: 'munpia', today: { date: moment().format('YYYY-MM-DD'), start: {}, current: {} } };
	const plugin = {
		settings: { dailyNotesFolder: 'Daily', dailyNotesFormat: 'YYYY-MM-DD', dailyCharCountKey: key, charCountMode: 'munpia' },
		projectContext: { getStatisticsScopeSignature: () => '*', isInStatisticsScope: () => false },
		app: {
			vault: { adapter: { read: async () => JSON.stringify(stored) }, getMarkdownFiles: () => [file], getAbstractFileByPath: () => file },
			metadataCache: { getFileCache: () => ({ frontmatter: fm }) },
			workspace: { getActiveFile: () => null },
			fileManager: { processFrontMatter: async (_file, update) => { writes++; update(fm); } },
		},
	};
	const store = new DailyCharStore(plugin);
	await store.init();
	assert.deepEqual(store.getDailySeries(1), [2977], 'Dashboard still consumed the corrupted scalar');
	for (const merged of [...mergedNotes, damaged]) {
		fm = merged;
		await store.refreshDailyHistory();
		assert.equal(store.getDailySeries(1)[0], readDailyCharCount(fm, date, key) ?? 0);
	}
	fm = checked(2977);
	await store.writeCharCountToDailyNote(date, 2977);
	assert.equal(writes, 0, 'Unchanged counts must not repeatedly rewrite the shared daily note');
	await store.writeCharCountToDailyNote(date, 2978);
	assert.equal(writes, 1);
	assert.equal(readDailyCharCount(fm, date, key), 2978);
	await store.writeCharCountToDailyNote(date, 2978);
	assert.equal(writes, 1);
	await store.writeCharCountToDailyNote(date, Infinity);
	assert.equal(writes, 1);
} finally {
	globalThis.window = previousWindow;
	globalThis.moment = previousMoment;
}
console.log('PASS Sync digit-splicing reproduction, checked daily records, merged-note dashboard totals, legacy notes and duplicate-write prevention');
