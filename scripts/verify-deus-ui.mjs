// Real Chromium DOM/CSS against production panel and a synthetic, offline Obsidian adapter.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { installObsidianDomHelpers } from './obsidian-dom-stub.mjs';
import { assertCssVisualParity } from './css-visual-parity.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/82109/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const obsidian = `
export class Component { children=[]; callbacks=[]; addChild(child){this.children.push(child);return child;} register(fn){this.callbacks.push(fn);} registerEvent(){} load(){} unload(){for(const child of this.children)child.unload();for(const fn of this.callbacks.splice(0))fn();} }
export class TFile {}
export class Modal extends Component { constructor(app){super();this.app=app;} }
export class FuzzySuggestModal extends Modal {setPlaceholder(){} open(){} close(){}}
export class Notice {constructor(text){console.log(text);}}
export class Setting {
 constructor(parent){this.settingEl=parent.createDiv({cls:'setting-item'});this.nameEl=this.settingEl.createDiv({cls:'setting-item-name'});this.descEl=this.settingEl.createDiv({cls:'setting-item-description'});}
 setName(text){this.nameEl.textContent=text;return this;}setDesc(text){this.descEl.textContent=text;return this;}
 control(tag,type,fn){const el=this.settingEl.createEl(tag);if(type)el.type=type;const api={inputEl:el,setValue(value){if(type==='checkbox')el.checked=value;else el.value=value;return this;},addOption(value,label){el.createEl('option',{text:label,attr:{value}});return this;},setButtonText(text){el.textContent=text;return this;},onClick(callback){el.onclick=callback;return this;},onChange(callback){el.onchange=()=>callback(type==='checkbox'?el.checked:el.value);return this;}};fn(api);return this;}
 addToggle(fn){return this.control('input','checkbox',fn);}addText(fn){return this.control('input','text',fn);}addDropdown(fn){return this.control('select','',fn);}addButton(fn){return this.control('button','button',fn);}
}
export class Menu {items=[];addItem(fn){const item={title:'',icon:'',disabled:false,checked:false,callback:null,submenu:null,setSubmenu(){return this.submenu=new Menu();},setTitle(value){this.title=value;return this;},setIcon(value){this.icon=value;return this;},setDisabled(value){this.disabled=value;return this;},setChecked(value){this.checked=value;return this;},onClick(value){this.callback=value;return this;}};fn(item);this.items.push(item);return this;}addSeparator(){return this;}showAtMouseEvent(){globalThis.deusLastMenu=this;} }
export function setIcon(el,name){el.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3" fill="none" stroke="currentColor"/></svg>';el.dataset.icon=name;}
export const normalizePath=path=>path;
export const requestUrl=async()=>{throw Error('Unexpected real API');};
export const prepareSimpleSearch=()=>()=>null;
export const MarkdownRenderer={render:async(_app,text,el)=>{for(const para of text.split(/\\n\\n+/)){const p=el.createEl('p');p.textContent=para;}}};
`;
const bundle = await build({ entryPoints: ['scripts/deus-ui-fixture.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', plugins: [{ name: 'offline-ui', setup(builder) {
	builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'fixture' }));
	builder.onResolve({ filter: /WritingDocument$|AiChatPlotKnowledge$|AiChatContextModal$|wikiProfileUtils$|RagIndexService$/ }, args => ({ path: args.path, namespace: 'fixture' }));
	builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'obsidian' ? obsidian
		: args.path.endsWith('WritingDocument') ? 'export const getWritingDocument=()=>globalThis.deusFixtureDocument;export const getOpenWritingDocuments=()=>globalThis.deusNavigationDocuments??[globalThis.deusFixtureDocument];export const getWritingDocumentForView=view=>globalThis.deusNavigationDocuments?.find(document=>document.view===view)??null;'
		: args.path.endsWith('AiChatPlotKnowledge') ? 'export const readChatPlotPassages=async()=>globalThis.deusFixturePlots;'
		: args.path.endsWith('wikiProfileUtils') ? 'export const getWikiDisplayName=(_app,_plugin,file)=>file.basename;export const getWikiColor=()=>"#8a93dc";export const getWikiImgSrc=()=>"";'
		: args.path.endsWith('RagIndexService') ? 'export const ragIndex=()=>({tools:()=>({execute:async()=>({sources:[],warnings:[]})})});'
		: 'export class ChatTextModal {open(){}};' }));
} }] });
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 480, height: 900 }, deviceScaleFactor: 1 });
	page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
	page.on('pageerror', error => console.error(error.message));
	await page.route('**/*', route => route.abort());
	await page.setContent('<meta charset="utf-8"><body class="theme-dark"></body>');
	await page.evaluate(installObsidianDomHelpers);
	await page.addStyleTag({ content: `:root{--background-primary:#1e1e1e;--background-secondary:#292929;--background-modifier-border:#383838;--background-modifier-hover:#333;--text-normal:#ddd;--text-muted:#999;--text-faint:#888;--interactive-accent:#ab9df2;--font-interface:Arial;--font-text:Georgia}.theme-light{--background-primary:#fff;--background-secondary:#f4f4f4;--background-modifier-border:#ddd;--background-modifier-hover:#eee;--text-normal:#222;--text-muted:#666;--text-faint:#888;--interactive-accent:#705dc7}body{margin:0;background:var(--background-primary);color:var(--text-normal)}button{font:inherit;color:inherit;cursor:pointer}.wm-chat-panel{width:480px;height:900px}textarea{color:var(--text-normal);font-family:inherit}.u-muted{color:var(--text-muted)}` });
	await page.addStyleTag({ content: await readFile('styles.css', 'utf8') });
	await page.addStyleTag({ content: await readFile('C:/Users/82109/Desktop/Obsidian/Test/.obsidian/plugins/realclaudian/styles.css', 'utf8') });
	await page.addScriptTag({ content: `for(const proto of [HTMLElement.prototype, Document.prototype]){proto.createEl=function(tag,options={}){const el=document.createElement(tag);if(options.cls)el.className=options.cls;if(options.text)el.textContent=options.text;for(const [key,value]of Object.entries(options.attr||{}))el.setAttribute(key,value);if(options.type)el.type=options.type;this.appendChild(el);return el;};proto.createDiv=function(options){return this.createEl('div',typeof options==='string'?{cls:options}:options);};proto.createSpan=function(options){return this.createEl('span',options);};}HTMLElement.prototype.empty=function(){this.replaceChildren();};HTMLElement.prototype.setText=function(text){this.textContent=text;};HTMLElement.prototype.addClass=function(...names){this.classList.add(...names);};HTMLElement.prototype.appendText=function(text){this.append(document.createTextNode(text));};` });
	await page.addScriptTag({ content: 'if(!crypto.randomUUID)crypto.randomUUID=()=>"fixture-"+Math.random().toString(36).slice(2);' });
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	const result = await page.evaluate(() => globalThis.deusUiRun());
	const parity = await page.evaluate(() => {
		if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
		const reference = document.createElement('div'); reference.style.cssText = 'position:absolute;left:-10000px;width:480px;height:900px;font-size:14px';
		reference.innerHTML = '<div class="claudian-container"><div class="claudian-chat-panel"><div class="claudian-messages-wrapper"><div class="claudian-messages"><div class="claudian-message claudian-message-user"><div class="claudian-message-content">질문</div></div></div></div><div class="claudian-input-composer"><div class="claudian-input-container"><div class="claudian-input-wrapper"><div class="claudian-context-row has-content"><div class="claudian-context-chip">참고 자료</div></div><textarea class="claudian-input"></textarea><div class="claudian-input-toolbar"><button class="claudian-toolbar-chip">모델</button></div></div></div></div></div></div>';
		document.body.append(reference);
		const comparisons = [['messages',['gap','flexDirection']],['input-wrapper',['display','flexDirection','borderTopWidth','borderRadius']],['input',['padding','borderTopWidth','backgroundColor']],['context-chip',['height','padding','borderRadius']],['input-toolbar',['padding','display']],['toolbar-chip',['height','padding']],['message-user > .deus-message-content',['padding']]];
		const results=[];
		for(const theme of ['theme-dark','theme-light']) {
			document.body.className=theme;
			const citation = document.querySelector('.deus-citation-chip'), chipStyle = getComputedStyle(citation);
			if(chipStyle.fontSize !== '12px' || chipStyle.textDecorationLine !== 'none')throw Error(theme+' citation font or underline changed');
			if(theme === 'theme-light') {
				const ctx=document.createElement('canvas').getContext('2d');ctx.fillStyle=chipStyle.backgroundColor;ctx.fillRect(0,0,1,1);
				const [r,g,b]=ctx.getImageData(0,0,1,1).data;if((r+g+b)/3 > 245 || r === g && g === b)throw Error('Light citation lost its accent background');
			}
			for(const [name,properties]of comparisons) {
				const actual=document.querySelector('.deus-'+name), expected=reference.querySelector('.claudian-'+name.replaceAll('deus-','claudian-'));
				if(!actual||!expected)throw Error('Missing parity element: '+name);
				for(const property of properties){const a=getComputedStyle(actual)[property],b=getComputedStyle(expected)[property];if(a!==b)throw Error(theme+' '+name+' '+property+': '+a+' != Claudian '+b);results.push(property);}
			}
		}
		document.body.className='theme-dark';reference.remove();return results.length;
	});
	await mkdir('.codex-tmp/deus-ui', { recursive: true });
	await page.screenshot({ path: path.resolve('.codex-tmp/deus-ui/panel.png') });
	await assertCssVisualParity({ evaluate: (fn, data) => page.evaluate(fn, data), capture: () => page.screenshot() }, 'deus-panel');
	await page.locator('.deus-composer-plus').click();
	await page.screenshot({ path: path.resolve('.codex-tmp/deus-ui/references.png') });
	await assertCssVisualParity({ evaluate: (fn, data) => page.evaluate(fn, data), capture: () => page.screenshot() }, 'deus-references');
	await page.locator('.deus-composer-plus').click();
	await page.setViewportSize({ width: 1100, height: 900 });
	const wide = await page.evaluate(() => globalThis.deusUiResize(1100));
	await page.locator('[data-project-root="Story"] [data-session-id="another"]').hover();
	const hoverBackground = await page.locator('[data-project-root="Story"] [data-session-id="another"]').evaluate(el=>getComputedStyle(el).backgroundColor);
	if(hoverBackground !== 'rgba(0, 0, 0, 0)')throw Error('Session hover still adds a background');
	const grip = await page.locator('.deus-session-resizer').boundingBox();
	await page.mouse.move(grip.x+2,grip.y+150);await page.mouse.down();await page.mouse.move(grip.x+42,grip.y+150);await page.mouse.up();
	const dragged = await page.evaluate(() => document.querySelector('.deus-navigator').getBoundingClientRect().width);
	if(dragged < 230)throw Error('Sidebar pointer resize did not change its width');
	await page.screenshot({ path: path.resolve('.codex-tmp/deus-ui/panel-wide.png') });
	await assertCssVisualParity({ evaluate: (fn, data) => page.evaluate(fn, data), capture: () => page.screenshot() }, 'deus-wide');
	await page.evaluate(() => { document.body.className = 'theme-light'; });
	await page.screenshot({ path: path.resolve('.codex-tmp/deus-ui/panel-light.png') });
	await assertCssVisualParity({ evaluate: (fn, data) => page.evaluate(fn, data), capture: () => page.screenshot() }, 'deus-light');
	await page.evaluate(() => { document.body.className = 'theme-dark'; });
	await page.setViewportSize({ width: 620, height: 900 });
	const medium = await page.evaluate(() => globalThis.deusUiResize(620));
	await page.setViewportSize({ width: 480, height: 900 });
	const compact = await page.evaluate(() => globalThis.deusUiResize(480));
	const editor=page.locator('.deus-input');await editor.fill('@아린');await editor.press('Enter');await editor.pressSequentially(' 다음 대사');await editor.press('Shift+Enter');await editor.pressSequentially('이어서');
	const mentionEditing=await editor.evaluate(el=>({value:el.value,text:el.textContent,links:el.querySelectorAll('a[data-deus-mention]').length}));
	if(mentionEditing.value!=='@[[Story/인물/아린.md]]  다음 대사\n이어서'||mentionEditing.text.includes('Story/')||mentionEditing.links!==1)throw Error('Native typing/newline corrupted title-only mention: '+JSON.stringify(mentionEditing));
	await editor.evaluate(el=>{el.value='지금 상황에 맞는 대화가 뭘까?';el.dispatchEvent(new Event('input'));});
	const scrolling=await page.evaluate(()=>globalThis.deusUiStreamingCheck());
	const navigation = await page.evaluate(() => globalThis.deusUiNavigationCheck());
	const command = await page.evaluate(() => globalThis.deusUiCommandRequestCheck());
	console.log('PASS Chromium Deus panel, references checklist, local slash commands, title-only mention editing, streaming follow/pause/resume, draggable sidebar, sessions and accent citations', { ...result, wide, dragged, medium, compact, scrolling, navigation, command, upstreamCssComparisons: parity });
} finally { await browser.close(); }
