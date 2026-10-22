import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ESLint } from 'eslint';
import stylelint from 'stylelint';
import { sourceWarnings, cssWarnings, capabilities, sourceKey, cssKey, capabilityKey } from './warning-policy.mjs';

const registry = JSON.parse(fs.readFileSync('scripts/warning-exceptions.json', 'utf8'));
const [source, css] = await Promise.all([new ESLint().lintFiles(['main.ts', 'src']), stylelint.lint({ files: 'styles.css' })]);
const raw = { source: sourceWarnings(source), css: cssWarnings(css.results), capabilities: capabilities() };
fs.mkdirSync('.codex-tmp/warning-audit', { recursive: true });
fs.writeFileSync('.codex-tmp/warning-audit/raw.json', JSON.stringify(raw, null, 2) + '\n');
const failures = [];
for (const [category, key] of [['source', sourceKey], ['css', cssKey], ['capabilities', capabilityKey]]) {
	const actual = new Map();
	for (const item of raw[category]) actual.set(key(item), (actual.get(key(item)) ?? 0) + 1);
	const expected = new Map();
	for (const item of registry[category]) {
		assert(item.reason?.trim() && item.tests?.length, 'Every exception needs a reason and test references');
		for (const test of item.tests) assert(fs.existsSync(test), `Missing exception test: ${test}`);
		assert(!expected.has(key(item)), 'Duplicate exception: ' + key(item));
		expected.set(key(item), item.count);
	}
	for (const [id, count] of actual) if (expected.get(id) !== count) failures.push(`${category}: new/changed diagnostic or capability: ${id} (${count})`);
	for (const [id, count] of expected) if (actual.get(id) !== count) failures.push(`${category}: stale exception: ${id}`);
}
const errors = [...raw.source, ...raw.css].filter(item => item.severity === 'error');
const summary = { errors: errors.length, rawSourceWarnings: raw.source.length - errors.filter(item => item.file !== 'styles.css').length, rawCssWarnings: raw.css.length - errors.filter(item => item.file === 'styles.css').length, reviewedCapabilitySites: raw.capabilities.length, unregisteredOrStale: failures.length };
fs.writeFileSync('.codex-tmp/warning-audit/summary.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
for (const item of [...raw.source, ...raw.css]) console.log(`${item.file}:${item.line} ${item.rule}: ${item.message}`);
assert.equal(errors.length, 0, 'Source/CSS errors are never exceptions');
assert.equal(failures.length, 0, failures.join('\n'));
console.log('PASS full Obsidian recommended source rules, all Obsidian CSS review rules, exact exception counts and capability inventory. Raw diagnostics retained in .codex-tmp/warning-audit/raw.json');
