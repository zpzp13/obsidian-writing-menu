// Compare the reviewed baseline against current CSS using Obsidian's real stylesheet.
// State classes simulate hover/focus in BOTH stylesheets, without changing specificity.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/82109/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const after = await fs.readFile('styles.css', 'utf8');
const baselinePath = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11);
const reference = JSON.parse(await fs.readFile('scripts/fixtures/css-priority-reference.json', 'utf8'));
const reviewedPriority = reference.map(rule => `${rule.selector}{${rule.declarations.map(declaration => `${declaration.property}:${declaration.value}!important`).join(';')}}`).join('\n');
// The committed reference freezes the reviewed priorities, rather than requiring an untracked old build.
const before = baselinePath ? await fs.readFile(baselinePath, 'utf8') : after + '\n' + reviewedPriority;
const archive = await fs.readFile('C:/Users/82109/AppData/Local/Programs/Obsidian/resources/obsidian.asar');
const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
const entry = header.files['app.css'], offset = 8 + archive.readUInt32LE(4) + Number(entry.offset);
const native = archive.subarray(offset, offset + entry.size).toString();
const states = css => css.replace(/:(hover|focus-visible|focus-within|focus|active|disabled)\b/g, '.audit-$1');
const buttonClasses = new Set(['wm-dash-tab-btn','wm-dash-clock-text-action','wm-dash-deadline-edit','wm-dash-deadline-empty-button','wm-deadline-modal-day','wiki-graph-filter-info','wiki-graph-style-action','wm-spell-mobile-tool','wm-archive-mini-art','wm-paged-find-action','wm-paged-find-replace-button','wm-paged-text-color-chevron','wm-toolbar-select','wm-paged-zoom-reset','wm-paged-popover-item','wm-paged-size-option','wm-paged-alignment-option','wm-paged-color-reset','wm-paged-layout-preset','wm-paged-layout-preset-option','wm-paged-layout-cancel','wm-paged-layout-apply','wm-writing-widget-card','wm-writing-color-swatch','deus-composer-dropdown-item']);
const inputClasses = new Set(['wm-dash-clock-time','wm-deadline-modal-time','wiki-graph-filter-input','wiki-graph-style-key','wiki-graph-style-color','wm-plotbook-date-picker','wm-writing-format-slider']);
const cases = [];
function chain(selector) {
	const result = [{ tag: '', classes: [], attrs: {} }];
	const append = nodes => { for (const node of nodes) {
		if (node.type === 'combinator') result.push({ tag: '', classes: [], attrs: {} });
		else if (node.type === 'class') result.at(-1).classes.push(node.value);
		else if (node.type === 'tag') result.at(-1).tag = node.value;
		else if (node.type === 'attribute') result.at(-1).attrs[node.attribute] = node.value ?? '';
		else if (node.type === 'pseudo' && [':is', ':where'].includes(node.value)) append(node.nodes[0].nodes);
		else if (node.type === 'pseudo' && node.value.startsWith('::')) result.at(-1).pseudo = node.value;
	} };
	append(selectorParser().astSync(states(selector)).nodes[0].nodes);
	for (const node of result) {
		if (!node.tag) node.tag = node.classes.some(cls => buttonClasses.has(cls)) ? 'button' : node.classes.some(cls => inputClasses.has(cls)) ? 'input' : 'div';
		if (node.attrs['data-writing-menu-id'] !== undefined) node.classes.push('workspace-leaf-content', 'wm-styled-document');
		if (node.tag === 'input' && !node.attrs.type) node.attrs.type = node.classes.includes('wiki-graph-style-color') ? 'color' : 'text';
	}
	return result;
}
postcss.parse(baselinePath ? before : reviewedPriority).walkRules(rule => {
	const properties = rule.nodes.filter(node => node.type === 'decl' && node.important).map(node => node.prop);
	if (!properties.length) return;
	for (const selector of selectorParser().astSync(rule.selector).nodes.map(node => node.toString())) {
		if (/::(?:selection|.*thumb)/.test(selector)) continue; // covered by editor/toolbar interaction fixtures
		cases.push({ selector, properties, chain: chain(selector) });
	}
});
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
	const page = await browser.newPage();
	await page.route('**/*', route => route.abort());
	await page.setContent('<body><style id="native"></style><style id="plugin"></style></body>');
	await page.evaluate(css => document.querySelector('#native').textContent = css, states(native));
	const results = await page.evaluate(({ before, after, cases }) => {
		const style = document.querySelector('#plugin');
		const differences = [], checked = [];
		for (const theme of ['theme-light', 'theme-dark']) for (const test of cases) {
			document.body.className = theme;
			const host = document.createElement('section'); document.body.append(host);
			let target = host;
			for (const node of test.chain) {
				if (node.tag === 'body' || node.tag === 'html') { document.body.classList.add(...node.classes); continue; }
				const element = document.createElement(node.tag); element.className = node.classes.join(' ');
				for (const [key, value] of Object.entries(node.attrs)) element.setAttribute(key, value);
				target.append(element); target = element;
			}
			const pseudo = test.chain.at(-1).pseudo;
			style.textContent = before;
			const old = Object.fromEntries(test.properties.map(property => [property, getComputedStyle(target, pseudo).getPropertyValue(property)]));
			style.textContent = after;
			const next = Object.fromEntries(test.properties.map(property => [property, getComputedStyle(target, pseudo).getPropertyValue(property)]));
			for (const property of test.properties) {
				// A zero-width, absent border's currentColor cannot affect pixels.
				if (property === 'border' && /^0px none /.test(old[property]) && /^0px none /.test(next[property])) continue;
				if (old[property] !== next[property]) differences.push({ theme, selector: test.selector, property, before: old[property], after: next[property] });
			}
			checked.push({ theme, selector: test.selector, properties: test.properties });
			host.remove();
		}
		return { checked, differences };
	}, { before: states(before), after: states(after), cases });
	await fs.mkdir('.codex-tmp', { recursive: true });
	await fs.writeFile('.codex-tmp/css-cascade-results.json', JSON.stringify(results, null, 2));
	console.log(`${results.checked.length} selector/state/theme comparisons; ${results.differences.length} differences.`);
	if (results.differences.length) { console.log(JSON.stringify(results.differences, null, 2)); process.exitCode = 1; }
} finally { await browser.close(); }
