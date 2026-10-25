import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { loadTsFixture } from './ts-fixture-loader.mjs';

const i18n = loadTsFixture('src/i18n/index.ts');
const { en } = loadTsFixture('src/i18n/en.ts');
const placeholders = text => [...text.matchAll(/\{(\d+)\}/g)].map(match => match[1]).sort();
for (const [source, english] of Object.entries(en)) {
	assert(english.trim(), `Empty translation: ${source}`);
	assert.deepEqual(placeholders(english), placeholders(source), `Translation parameters changed: ${source}`);
}
const files = ['main.ts', ...fs.readdirSync('src', { recursive: true }).filter(file => file.endsWith('.ts') && !file.startsWith('repetition/vendor')).map(file => 'src/' + file)];
let usages = 0;
for (const file of files) {
	if (file.replaceAll('\\', '/').startsWith('src/i18n/')) continue;
	const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
	const visit = node => {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'wmT') {
			const key = node.arguments[0];
			if (ts.isStringLiteralLike(key)) {
				assert(Object.hasOwn(en, key.text), `Missing English translation in ${file}: ${key.text}`);
				for (const index of placeholders(key.text)) assert(Number(index) < node.arguments.length - 1, `Missing parameter in ${file}: ${key.text}`);
				usages++;
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(ast);
}

for (const locale of ['ko', 'ko-KR', 'KO_kr']) {
	i18n.setLanguage(locale); assert.equal(i18n.getLanguage(), 'ko'); assert.equal(i18n.wmT('프로젝트'), '프로젝트');
}
for (const locale of ['en', 'en-GB', 'fr', '']) {
	i18n.setLanguage(locale); assert.equal(i18n.getLanguage(), 'en'); assert.equal(i18n.wmT('프로젝트'), 'Projects');
}
assert.equal(i18n.getLocale(), 'en-US');
assert.equal(i18n.wmT('사용자 입력 {0}', '$& {1} [[노트]]'), '사용자 입력 $& {1} [[노트]]');
assert.equal(i18n.wmT('원문 {0}자 중 {1}자 제공', 100, 20), 'Included 20 of 100 source characters');
assert.equal(i18n.wmT('없는 번역'), '없는 번역');
assert.equal(i18n.wmT('constructor'), 'constructor');

// Exercise the supported SDK API and the 1.7.2 fallback without reading global storage.
for (const [modern, appLanguage, momentLanguage, expected] of [[true, 'en', 'ko', 'en'], [true, 'ko', 'en', 'ko'], [false, 'en', 'ko', 'ko'], [false, 'ko', 'en-gb', 'en']]) {
	let calls = 0;
	loadTsFixture('src/i18n/obsidian.ts', {
		obsidian: { requireApiVersion: version => { assert.equal(version, '1.8.7'); return modern; }, getLanguage: () => { calls++; return appLanguage; }, moment: { locale: () => momentLanguage } },
		'./index': i18n,
	});
	assert.equal(i18n.getLanguage(), expected); assert.equal(calls, modern ? 1 : 0);
}

const bindings = { '../i18n/index': i18n, '../../i18n/index': i18n };
const { DEFAULT_SETTINGS } = loadTsFixture('src/types.ts');
const snapshot = JSON.stringify(DEFAULT_SETTINGS);
const { timeModeLabel, dashboardSectionLabel } = loadTsFixture('src/i18n/labels.ts', { './index': i18n });
const { plotWorkbookStatusName } = loadTsFixture('src/plot-workbook/PlotWorkbookStatus.ts', bindings);
const { fmtTimeFull, toHMS } = loadTsFixture('src/utils/timeUtils.ts', bindings);
const { WritingTimeStore } = loadTsFixture('src/dashboard/data/WritingTimeStore.ts', { ...bindings, obsidian: {} });
const { resolveDeusIntent, deusReplyLanguage } = loadTsFixture('src/aichat/DeusSkills.ts', bindings);
i18n.setLanguage('en');
assert.equal(timeModeLabel(DEFAULT_SETTINGS.timeModes[0]), 'Planning');
assert.equal(timeModeLabel({ id: 'draft', label: '나의 기획' }), '나의 기획');
assert.equal(timeModeLabel({ id: 'custom', label: '기획' }), '기획');
assert.equal(dashboardSectionLabel('time', '작업시간'), 'Writing time');
assert.equal(plotWorkbookStatusName({ id: 'revised', name: '수정' }), 'Revised');
assert.equal(plotWorkbookStatusName({ id: 'revised', name: '최종 확인' }), '최종 확인');
assert.equal(plotWorkbookStatusName({ id: 'custom', name: '수정' }), '수정');
assert.equal(fmtTimeFull(3661), '1h 01m 01s');
assert.equal(WritingTimeStore.formatTime(3661), '1h 1m');
assert.equal(WritingTimeStore.formatTimeFull(3661), '1h 1m 1s');
assert.equal(toHMS(3661), '01:01:01');
assert.equal(DEFAULT_SETTINGS.dailyCharCountKey, '글자수');
assert.equal(DEFAULT_SETTINGS.timeModes[0].frontmatterKey, '초고_시간');
assert.equal(JSON.stringify(DEFAULT_SETTINGS), snapshot, 'Localization mutated saved defaults');
for (const [question, skill, scene] of [
	['Write a conversation in the current scene', 'character', 'active'],
	['Imagine a roleplay at a cafe', 'character', 'explicit'],
	['Describe this scene', 'description', 'active'],
	['Suggest dialogue for Mira', 'dialogue', 'active'],
	['Polish the selected text', 'rewrite', 'active'],
	['Who is Mira?', 'research', 'none'],
]) { const intent = resolveDeusIntent(question, 'auto', []); assert.equal(intent.skill, skill, question); assert.equal(intent.scene, scene, question); }
assert(deusReplyLanguage().includes('English'));
i18n.setLanguage('ko');
assert.equal(fmtTimeFull(3661), '1시 01분 01초');
assert.equal(WritingTimeStore.formatTimeFull(3661), '1시간 1분 1초');
assert.equal(deusReplyLanguage(), '');
console.log(`PASS ${Object.keys(en).length} translations, ${usages} call sites, SDK compatibility, literal interpolation, English skills and unchanged stored data`);
