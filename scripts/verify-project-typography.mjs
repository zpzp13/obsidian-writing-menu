// Real computed styles plus production project membership/leaf cleanup; no vault is opened.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';
import postcss from 'postcss';
import { loadTsFixture } from './ts-fixture-loader.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/82109/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
class MarkdownView {}
const { LeafStyleManager } = loadTsFixture('src/editor/LeafStyleManager.ts', {
	obsidian: { Platform:{ isMobile:false }, MarkdownView },
	'../paged/PagedWritingView': { PagedWritingView:class {} },
	'./repetitionHighlight': {}, './spellcheckHighlight': {},
});
const { ProjectContextService } = loadTsFixture('src/projects/ProjectContextService.ts', {
	obsidian: { normalizePath:path => path.replaceAll('\\', '/').replace(/\/{2,}/g, '/') },
});
const { DEFAULT_SETTINGS } = loadTsFixture('src/types.ts');
const settings = { ...DEFAULT_SETTINGS, fontFamily:'Arial', fontSize:24, lineHeight:2, fontColor:'#812323', backgroundColor:'transparent',
	projects:[{ id:'project', rootFolder:'Project' }],
	// Data from older versions must no longer control headings or footnotes.
	h1FontFamily:'Courier New', h1FontSize:99, h1LineHeight:5, h1Color:'#ff00ff',
	footnoteFontFamily:'Courier New', footnoteFontSize:99, footnoteLineHeight:5, footnoteColor:'#ff00ff',
};
const declarations = new Map([['--wm-h1-font-size', '99px'], ['--wm-footnote-font-size', '99px']]);
const attrs = new Map(), classes = new Set();
const container = {
	style:{ [Symbol.iterator]:() => declarations.keys(), removeProperty:key => declarations.delete(key) },
	setCssProps(value) { for (const [key, val] of Object.entries(value)) declarations.set(key, val); },
	addClass(...names) { names.forEach(name => classes.add(name)); },
	removeClass(...names) { names.forEach(name => classes.delete(name)); },
	toggleClass(name, on) { on ? classes.add(name) : classes.delete(name); },
	getAttribute:key => attrs.get(key), setAttribute:(key, value) => attrs.set(key, value),
	removeAttribute:key => attrs.delete(key), hasAttribute:key => attrs.has(key), querySelector:() => null,
};
const plugin = { settings, leafStyleVersions:new Map(), cssSettingsVersion:1, leafIdCounter:1 };
plugin.projectContext = new ProjectContextService(plugin);
const manager = new LeafStyleManager(plugin);
const leaf = { view:Object.assign(new MarkdownView(), { containerEl:container, file:{ path:'Project/note.md' } }) };
const scope = path => {
	leaf.view.file = { path }; manager.updateLeafStyles(leaf);
	return { classes:[...classes], attrs:Object.fromEntries(attrs), props:Object.fromEntries(declarations) };
};
for (const [path, inside] of [['Project/note.md', true], ['Project/sub/note.md', true], ['Project-other/note.md', false], ['Other/note.md', false]]) {
	const state = scope(path);
	assert.equal(state.classes.includes('wm-styled-document'), inside, path);
	assert.equal('data-writing-menu-id' in state.attrs, inside, path);
	assert(!Object.keys(state.props).some(key => /^--wm-(h1|footnote)-/.test(key)), 'Legacy inline values survived cleanup');
}
const inside = scope('Project/sub/note.md');
const outside = scope('Notes/outside.md');
const insideAgain = scope('Project/sub/note.md');
settings.projects = [];
const removedProject = scope('Project/sub/note.md');
assert.equal(removedProject.classes.includes('wm-styled-document'), false);

const css = await readFile('styles.css', 'utf8');
const metadata = yaml.load(css.match(/\/\* @settings\s*([\s\S]+?)\*\//)[1]);
assert.equal(metadata.id, 'writing-menu-project-typography');
const variables = metadata.settings.filter(setting => setting.type.startsWith('variable-'));
assert.equal(variables.length, 34);
assert.equal(new Set(metadata.settings.map(setting => setting.id)).size, metadata.settings.length);
assert(variables.every(setting => setting.id.startsWith('wm-project-')), 'Style Settings must never write global native heading/footnote variables');
postcss.parse(css).walkRules(rule => {
	if (!rule.nodes.some(node => node.type === 'decl' && /var\(--wm-project-/.test(node.value))) return;
	assert(rule.selectors.every(selector => selector.startsWith('.wm-styled-document[data-writing-menu-id] ')), 'Unscoped typography rule: ' + rule.selector);
});
const archive = await readFile('C:/Users/82109/AppData/Local/Programs/Obsidian/resources/obsidian.asar');
const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
const entry = header.files['app.css'], offset = 8 + archive.readUInt32LE(4) + Number(entry.offset);
const native = archive.subarray(offset, offset + entry.size).toString();
const sourceHeadings = Array.from({ length:6 }, (_, i) => `<div class="cm-line HyperMD-header HyperMD-header-${i + 1}"><span class="cm-header cm-header-${i + 1}">Heading</span> <span class="cm-hmd-internal-link">link</span></div>`).join('');
const editor = `<div class="markdown-source-view mod-cm6"><div class="cm-editor cm-s-obsidian"><div class="cm-scroller"><div class="cm-content">${sourceHeadings}
	<div class="cm-line body-text">Body <span class="cm-footref cm-hmd-barelink"><span class="cm-underline">[^1]</span></span><span class="cm-footref cm-inline-footnote cm-formatting-inline-footnote">^[</span><span class="cm-footref cm-inline-footnote">inline note</span></div>
	<div class="cm-line HyperMD-footnote"><span class="cm-hmd-footnote cm-hmd-barelink cm-formatting">[^</span><span class="cm-hmd-footnote"><span class="cm-underline">1</span></span><span class="cm-hmd-footnote cm-formatting">]:</span> Definition <strong>bold</strong> <em>italic</em><span class="cm-hmd-footnote-url-title">title</span></div>
</div></div></div></div>`;
const rendered = Array.from({ length:6 }, (_, i) => `<h${i + 1}>Heading <a class="internal-link" href="#">link</a></h${i + 1}>`).join('') + `<p class="body-text">Body <sup class="footnote-ref"><a class="footnote-link" href="#fn-1">[1]</a></sup></p>
	<section class="footnotes"><hr><ol><li><p>Definition <strong>bold</strong> <em>italic</em></p></li></ol></section>`;
const content = `${editor}<div class="markdown-reading-view"><div class="markdown-preview-view markdown-rendered">${rendered}</div></div><div class="markdown-rendered embedded-preview">${rendered}</div>`;
const html = `<style id="native"></style><style id="plugin"></style><style id="style-settings"></style><style>
	html,body{height:auto}body{overflow:visible;contain:none}.markdown-preview-view{height:auto}
	*,*::before,*::after{transition:none!important;animation:none!important}
</style><body><section id="project">${content}</section><section id="outside">${content}</section></body>`;
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless:true });
const results = [];
try {
	const page = await browser.newPage();
	await page.route('**/*', route => route.abort()); await page.setContent(html);
	await page.locator('#native').evaluate((element, value) => element.textContent = value, native);
	await page.locator('#plugin').evaluate((element, value) => element.textContent = value, css);
	const applyScope = state => page.locator('#project').evaluate((element, state) => {
		element.className = state.classes.join(' '); element.style.cssText = '';
		element.removeAttribute('data-writing-menu-id');
		for (const [key, value] of Object.entries(state.attrs)) element.setAttribute(key, value);
		for (const [key, value] of Object.entries(state.props)) element.style.setProperty(key, value);
	}, state);
	const snapshot = async id => { await page.mouse.move(-10, -10); return page.locator(id).evaluate(element => [...element.querySelectorAll('*')].map(node => {
		const s = getComputedStyle(node); return [s.fontFamily, s.fontSize, s.color, s.lineHeight, s.fontWeight];
	})); };
	for (const theme of ['theme-light', 'theme-dark']) {
		await page.evaluate(theme => document.body.className = theme + ' css-settings-manager', theme);
		await page.locator('#style-settings').evaluate(element => element.textContent = '');
		await applyScope(inside);
		const defaultProject = await snapshot('#project'), defaultOutside = await snapshot('#outside');
		assert.notEqual(await page.locator('#project .HyperMD-header-1').evaluate(element => getComputedStyle(element).fontSize), '99px', 'Retired H1 setting still applies');
		for (const variant of [0, 1]) {
			const color = theme === 'theme-light' ? '#123456' : '#abcdef';
			const declarations = [];
			for (let n = 1; n <= 6; n++) declarations.push(`--wm-project-h${n}-font:Georgia;--wm-project-h${n}-size:${30 - n + variant}px;--wm-project-h${n}-line-height:1.7;--wm-project-h${n}-weight:500;--wm-project-h${n}-color:${color}`);
			declarations.push(`--wm-project-footnote-font:"Courier New";--wm-project-footnote-size:${9 + variant}px;--wm-project-footnote-line-height:1.5;--wm-project-footnote-color:${color}`);
			await page.locator('#style-settings').evaluate((element, data) => element.textContent = `body.${data.theme}.css-settings-manager{${data.declarations.join(';')}}`, { theme, declarations });
			const expectedColor = theme === 'theme-light' ? 'rgb(18, 52, 86)' : 'rgb(171, 205, 239)';
			for (let n = 1; n <= 6; n++) for (const selector of [`.HyperMD-header-${n}`, `.HyperMD-header-${n} .cm-header`, `.HyperMD-header-${n} .cm-hmd-internal-link`, `.markdown-rendered h${n}`, `.markdown-rendered h${n} a`]) {
				for (const actual of await page.locator('#project ' + selector).evaluateAll(elements => elements.map(element => {
					const s = getComputedStyle(element); return { font:s.fontFamily, size:s.fontSize, color:s.color, weight:s.fontWeight, line:s.lineHeight };
				}))) {
					assert.equal(actual.font, 'Georgia', selector + ' font'); assert.equal(actual.size, 30 - n + variant + 'px', selector + ' size');
					assert.equal(actual.color, expectedColor, selector + ' color'); assert.equal(actual.weight, '500', selector + ' weight');
					if (selector === `.HyperMD-header-${n}` || selector === `.markdown-rendered h${n}`) assert(Math.abs(Number.parseFloat(actual.line) - (30 - n + variant) * 1.7) < .01, selector + ' line-height');
				}
			}
			for (const selector of ['.HyperMD-footnote', '.HyperMD-footnote .cm-hmd-footnote', '.HyperMD-footnote .cm-underline', '.HyperMD-footnote strong', '.HyperMD-footnote .cm-hmd-footnote-url-title', '.cm-footref', '.cm-footref .cm-underline', '.footnotes', '.footnotes p', '.footnotes strong', 'sup.footnote-ref', 'sup.footnote-ref a']) {
				for (const actual of await page.locator('#project ' + selector).evaluateAll(elements => elements.map(element => {
					const s = getComputedStyle(element); return { font:s.fontFamily, size:s.fontSize, color:s.color, line:s.lineHeight };
				}))) {
					assert.equal(actual.font, '"Courier New"', selector + ' font'); assert.equal(actual.size, 9 + variant + 'px', selector + ' size');
					assert.equal(actual.color, expectedColor, selector + ' color');
					if (['.HyperMD-footnote', '.footnotes', '.footnotes p'].includes(selector)) assert(Math.abs(Number.parseFloat(actual.line) - (9 + variant) * 1.5) < .01, selector + ' line-height');
				}
			}
			for (const selector of ['.HyperMD-footnote .cm-underline', '.cm-footref .cm-underline', 'sup.footnote-ref a']) {
				const target = page.locator('#project ' + selector).first(); await target.hover({ force:true });
				assert.equal(await target.evaluate(element => getComputedStyle(element).color), expectedColor, selector + ' hover color');
			}
			assert.deepEqual(await snapshot('#outside'), defaultOutside, 'Global Style Settings variables leaked outside projects');
			const customized = await snapshot('#project');
			await applyScope(outside); assert.deepEqual(await snapshot('#project'), defaultOutside, 'Moving outside left project typography');
			await applyScope(insideAgain); assert.deepEqual(await snapshot('#project'), customized, 'Moving inside did not restore Style Settings');
			await applyScope(removedProject); assert.deepEqual(await snapshot('#project'), defaultOutside, 'Removing a project left scoped typography');
			await applyScope(inside);
			results.push({ theme, variant, passed:true });
		}
		await page.locator('#style-settings').evaluate(element => element.textContent = '');
		assert.deepEqual(await snapshot('#project'), defaultProject, 'Reset did not restore theme typography');
	}
	await mkdir('.codex-tmp/project-typography', { recursive:true });
	await writeFile('.codex-tmp/project-typography/results.json', JSON.stringify(results, null, 2) + '\n');
	console.log('PASS Style Settings metadata, H1–H6 and footnotes, live edits, both themes, native resets, retired inline cleanup, exact project boundaries, moves and project removal');
} finally { await browser.close(); }
