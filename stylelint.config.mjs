import { readFileSync } from 'node:fs';
import obsidianCss from 'stylelint-config-obsidianmd';

const { minAppVersion } = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
// Official Obsidian/Electron mapping; keep the minimum app version and CSS target in sync.
const runtimeVersions = [['1.4.5', 25], ['1.5.8', 28], ['1.6.5', 30], ['1.7.4', 31], ['1.9.12', 37], ['1.11.4', 39], ['1.13.4', 43]];
const compare = (a, b) => { const right = b.split('.').map(Number); return a.split('.').map(Number).reduce((result, value, index) => result || Math.sign(value - (right[index] ?? 0)), 0); };
const electron = runtimeVersions.filter(([version]) => compare(minAppVersion, version) >= 0).at(-1)?.[1];
if (!electron) throw new Error('Add an explicit CSS runtime mapping for this minimum app version.');

export default {
	// The full Obsidian review rules, without the theme preset's unrelated formatting convention.
	plugins: obsidianCss.plugins,
	rules: {
		...obsidianCss.rules,
		'block-no-empty': true,
		'declaration-block-no-duplicate-properties': true,
		'declaration-no-important': [true, { severity: 'warning' }],
		'selector-disallowed-list': [[/:has\(/], { severity: 'warning' }],
		'plugin/no-unsupported-browser-features': [true, { browsers: [`electron >= ${electron}`], ignorePartialSupport: false, severity: 'warning' }],
	},
};
