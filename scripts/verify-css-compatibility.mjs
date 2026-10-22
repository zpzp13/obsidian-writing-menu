// Render the CSS replacements against the previous release, including clipping and wrapping.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/82109/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const baseline = process.argv.find(value => value.startsWith('--baseline='))?.slice(11);
const before = baseline ? await readFile(baseline, 'utf8') : execFileSync('git', ['show', '3.4.2:styles.css'], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, windowsHide: true });
const after = await readFile('styles.css', 'utf8');
const html = `<!doctype html><meta charset="utf-8"><style id="plugin"></style><style>
:root{--background-primary:#fff;--background-secondary:#eee;--text-normal:#222;--text-muted:#666;--interactive-accent:#ca5d3a;--font-interface:Arial;--wm-music-card-bg:#abc;--wm-paged-render-margin-top:0px;--wm-paged-render-margin-right:0px;--wm-paged-render-margin-bottom:0px;--wm-paged-render-margin-left:0px;--wm-paged-render-font-size:14px;--wm-paged-render-indent:12px}
body{margin:0;padding:20px;font:14px/1.8 Arial;background:var(--background-primary);color:var(--text-normal)}
body.theme-dark{--background-primary:#222;--background-secondary:#333;--text-normal:#ddd;--text-muted:#aaa}
*,*::before,*::after{animation:none;transition:none}section{margin-bottom:25px;position:relative}button{font:inherit}
</style><body><section class="wm-calendar-agenda"><div class="wm-cal-week-grid">${Array.from({length:14},(_,i)=>`<div class="wm-cal-week-cell">${i+1}</div>`).join('')}</div></section>
<section class="wm-cal-task-dock"><div class="is-calendar-docked"><div class="wm-task-item"><div class="wm-task-item-content"><div class="wm-task-item-main"><div class="wm-task-item-title-row">Calendar task with wrapped text</div><div class="wm-task-item-meta">Date and project</div></div></div></div></div></section>
<section style="padding:14px"><div class="wm-music-library-audio-art-stage"><div style="height:260px;width:350px;background:linear-gradient(45deg,#85a,#ce7)">Album artwork</div></div></section>
<section class="wm-paged-editor-root" style="height:130px"><div class="wm-paged-page-content">${'<p class="wm-paged-paragraph starts-paragraph">Page clipping at the last line. 들여쓰기와 긴 문장.</p>'.repeat(15)}</div></section>
<section><div class="wm-analysis-progress" role="status">Analysis progress must remain accessible without drawing pixels.</div><span>Analysis panel</span></section>
<section class="wm-chat-root"><div class="wm-chat-toolbar"><span>Session</span><button>Chat</button><button>Options</button></div></section>
<section class="deus-container"><div class="deus-composer-dropdown-copy"><span class="deus-composer-dropdown-label">character</span><span class="deus-composer-dropdown-detail">A description long enough to wrap within a narrow window</span></div><div class="deus-message-content"><p>Linked evidence <a class="deus-citation-chip" href="#">+2</a></p></div></section></body>`;
await mkdir('.codex-tmp/css-compatibility', { recursive: true });
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
	const page = await browser.newPage(); await page.route('**/*', route => route.abort());
	for (const width of [320, 700]) for (const theme of ['theme-light', 'theme-dark']) {
		await page.setViewportSize({ width, height: 1200 }); await page.setContent(html);
		await page.evaluate(theme => document.body.className = theme, theme);
		const screenshots = [];
		for (const [name, css] of [['previous', before], ['current', after]]) {
			await page.evaluate(css => document.querySelector('#plugin').textContent = css, css);
			const image = await page.screenshot({ fullPage: true, animations: 'disabled' }); screenshots.push(image);
			await writeFile(`.codex-tmp/css-compatibility/${theme}-${width}-${name}.png`, image);
		}
		assert(screenshots[0].equals(screenshots[1]), `CSS pixels changed: ${theme} ${width}px. Inspect .codex-tmp/css-compatibility.`);
		assert.equal(await page.locator('[role="status"]').textContent(), 'Analysis progress must remain accessible without drawing pixels.');
		console.log(`PASS unchanged calendar/music/page/chat pixels: ${theme}, ${width}px`);
	}
} finally { await browser.close(); }
