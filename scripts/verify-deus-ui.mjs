// Real Chromium DOM/CSS against production panel and a synthetic, offline Obsidian adapter.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { installObsidianDomHelpers } from './obsidian-dom-stub.mjs';
import { assertCssVisualParity, nativeObsidianCss } from './css-visual-parity.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/82109/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const obsidian = `
export class Component { children=[]; callbacks=[]; addChild(child){this.children.push(child);return child;} register(fn){this.callbacks.push(fn);} registerEvent(){} load(){} unload(){for(const child of this.children)child.unload();for(const fn of this.callbacks.splice(0))fn();} }
export class TFile {}
export class FileSystemAdapter { getFullPath(path){return 'C:/Synthetic Vault/'+path;} getBasePath(){return 'C:/Synthetic Vault';} }
export const Platform = {isDesktop:false};
export class Modal extends Component { constructor(app){super();this.app=app;} }
export class FuzzySuggestModal extends Modal {setPlaceholder(){} open(){} close(){}}
export class Notice {constructor(text){console.log(text);}}
export class Setting {
 constructor(parent){this.settingEl=parent.createDiv({cls:'setting-item'});this.nameEl=this.settingEl.createDiv({cls:'setting-item-name'});this.descEl=this.settingEl.createDiv({cls:'setting-item-description'});}
 setName(text){this.nameEl.textContent=text;return this;}setDesc(text){this.descEl.textContent=text;return this;}
 control(tag,type,fn){const el=this.settingEl.createEl(tag);if(type)el.type=type;const api={inputEl:el,selectEl:el,setValue(value){if(type==='checkbox')el.checked=value;else el.value=value;return this;},setDisabled(value){el.disabled=value;return this;},addOption(value,label){el.createEl('option',{text:label,attr:{value}});return this;},setButtonText(text){el.textContent=text;return this;},onClick(callback){el.onclick=callback;return this;},onChange(callback){el.onchange=()=>callback(type==='checkbox'?el.checked:el.value);return this;}};fn(api);return this;}
 addToggle(fn){return this.control('input','checkbox',fn);}addText(fn){return this.control('input','text',fn);}addDropdown(fn){return this.control('select','',fn);}addButton(fn){return this.control('button','button',fn);}
}
const registeredIcons=new Map();export function addIcon(name,svg){registeredIcons.set(name,svg);}
export class Menu {
 items=[];layout=[];cleanups=[];dom=document.createElement('div');bgEl=document.createElement('div');scrollEl=this.dom.createDiv({cls:'menu-scroll'});
 constructor(){this.dom.className='menu';this.bgEl.className='menu-bg';}
 onHide(fn){this.cleanups.push(fn);return this;}setUseNativeMenu(){return this;}
 hide(){this.dom.remove();this.bgEl.remove();for(const fn of this.cleanups.splice(0))fn();return this;}
 addItem(fn){const menu=this,dom=document.createElement('div');dom.className='menu-item';const icon=dom.createDiv({cls:'menu-item-icon'}),title=dom.createDiv({cls:'menu-item-title'});icon.hidden=true;
 const item={dom,title:'',icon:'',disabled:false,checked:false,callback:null,submenu:null,setSubmenu(){return this.submenu=new Menu();},setTitle(value){this.title=value;title.textContent=value;return this;},setIcon(value){this.icon=value;icon.hidden=false;setIcon(icon,value);return this;},setDisabled(value){this.disabled=value;return this;},setChecked(value){this.checked=value;return this;},onClick(value){this.callback=(...args)=>{menu.hide();return value(...args);};dom.onclick=this.callback;return this;}};
 fn(item);this.items.push(item);this.layout.push(dom);return this;}
 addSeparator(){const dom=document.createElement('div');dom.className='menu-separator';this.layout.push(dom);return this;}
 showAtMouseEvent(){this.scrollEl.replaceChildren();let group;for(const dom of this.layout){if(dom.classList.contains('menu-separator')){group=null;this.scrollEl.append(dom);}else{group??=this.scrollEl.createDiv({cls:'menu-group'});group.append(dom);}}globalThis.deusLastMenu=this;return this;}
 showAtPosition(position,doc=document){this.showAtMouseEvent();doc.body.append(this.bgEl,this.dom);this.dom.style.position='fixed';this.dom.style.left=position.x+'px';this.dom.style.top=position.y+'px';return this;}
}
export function setIcon(el,name){const custom=registeredIcons.get(name),path=name==='chevron-left'?'<path d="m15 18-6-6 6-6"/>':name==='chevron-right'?'<path d="m9 18 6-6-6-6"/>':'<rect x="5" y="5" width="14" height="14" rx="3"/>';el.innerHTML=custom??'<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">'+path+'</svg>';el.dataset.icon=name;}
export const normalizePath=path=>path;
export const requestUrl=async()=>{throw Error('Unexpected real API');};
export const prepareSimpleSearch=()=>()=>null;
export const MarkdownRenderer={render:async(_app,text,el)=>{for(const para of text.split(/\\n\\n+/)){const p=el.createEl('p');p.textContent=para;}}};
`;
const bundle = await build({ entryPoints: ['scripts/deus-ui-fixture.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', external: ['child_process', 'fs/promises', 'os', 'path'], plugins: [{ name: 'offline-ui', setup(builder) {
	builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'fixture' }));
	builder.onResolve({ filter: /WritingDocument$|AiChatPlotKnowledge$|AiChatContextModal$|wikiProfileUtils$|RagIndexService$|CliModelCatalog$/ }, args => ({ path: args.path, namespace: 'fixture' }));
	builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'obsidian' ? obsidian
		: args.path.endsWith('WritingDocument') ? 'export const getWritingDocument=()=>globalThis.deusFixtureDocument;export const getOpenWritingDocuments=()=>globalThis.deusNavigationDocuments??[globalThis.deusFixtureDocument];export const getWritingDocumentForView=view=>globalThis.deusNavigationDocuments?.find(document=>document.view===view)??null;'
		: args.path.endsWith('AiChatPlotKnowledge') ? 'export const readChatPlotPassages=async()=>globalThis.deusFixturePlots;'
		: args.path.endsWith('wikiProfileUtils') ? 'export const getWikiDisplayName=(_app,_plugin,file)=>file.basename;export const getWikiColor=()=>"#8a93dc";export const getWikiImgSrc=()=>"";'
		: args.path.endsWith('RagIndexService') ? 'export const ragIndex=()=>({tools:()=>({execute:async()=>({sources:[],warnings:[]})})});'
		: args.path.endsWith('CliModelCatalog') ? 'const efforts=["low","medium","high","xhigh","max"].map(id=>({id,label:id==="xhigh"?"Extra High":id[0].toUpperCase()+id.slice(1)}));export const listCliModels=async(options)=>{if(globalThis.deusCliCatalogWait)await globalThis.deusCliCatalogWait;return [{id:"configured-model",label:"Runtime model",isDefault:true,defaultEffort:"low",efforts},{id:"fixture-fast",label:"Runtime fast",isDefault:false,efforts:options.provider==="claude"?[]:[{id:"low",label:"Low"}]}];};'
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
	await page.evaluate(native => { const style=document.createElement('style');style.textContent=native;document.head.prepend(style); }, nativeObsidianCss);
	await page.addStyleTag({ content: '.deus-cli-preview{--text-on-accent:#000}' });
	for (const provider of ['gemini','claude','codex']) {
		await page.evaluate(provider => globalThis.deusUiCliPreview(provider), provider);
		const effort=page.locator('.deus-cli-preview input[type="range"]'), track=page.locator('.deus-cli-preview .deus-effort-track');
		const caption=provider==='gemini'?'Gemini':provider==='claude'?'Claude Code':'Codex';
		const captionCheck=async()=>{if(await page.locator('.deus-model-label').textContent()!==caption)throw Error('Provider caption contains model, effort or waiting status');};
		await captionCheck();await effort.focus();await effort.press('Home');
		if(await page.evaluate(()=>globalThis.deusUiCliPreviewValue())!=='low')throw Error('Keyboard first step is not Low');
		await effort.press('ArrowRight');if(await page.evaluate(()=>globalThis.deusUiCliPreviewValue())!=='medium')throw Error('Keyboard selection was not stored');
		await effort.press('End');if(await page.evaluate(()=>globalThis.deusUiCliPreviewValue())!==(provider==='gemini'?'high':'max'))throw Error('Keyboard last step is wrong');
		const range=await track.boundingBox();
		await page.mouse.click(range.x+14+(range.width-28)*.5,range.y+range.height/2);
		if(await page.evaluate(()=>globalThis.deusUiCliPreviewValue())!==(provider==='gemini'?'medium':'high'))throw Error('Clicking the track did not save the selected level');
		await page.mouse.down();await page.mouse.move(range.x+14+(range.width-28)*.75,range.y+range.height/2);await page.mouse.up();
		if(await page.evaluate(()=>globalThis.deusUiCliPreviewValue())!==(provider==='gemini'?'high':'xhigh'))throw Error('Dragging the thumb did not save the selected level');
		const geometry=await track.evaluate(track=>{
			const rect=track.getBoundingClientRect(),fill=track.querySelector('.deus-effort-fill'),thumb=track.querySelector('.deus-effort-thumb'),circle=thumb.getBoundingClientRect(),input=track.querySelector('input');
			const probe=document.createElement('span');probe.style.color='var(--interactive-accent)';track.append(probe);const accent=getComputedStyle(probe).color;probe.remove();
			const dots=[...track.querySelectorAll('.deus-effort-dots span')].map(dot=>{const r=dot.getBoundingClientRect();return[r.x,r.y,r.width,r.height];});
			const back=track.closest('.deus-model-menu').querySelector('.deus-model-back'),arrow=back.querySelector('svg').getBoundingClientRect(),label=back.querySelector('.deus-model-back-label').getBoundingClientRect();
			return{height:rect.height,width:rect.width,fill:fill.getBoundingClientRect().width,dots:dots.length,uniformDots:dots.every(([x,y,w,h])=>w===4&&h===4&&Math.abs(x-Math.round(x))<.02&&Math.abs(y-Math.round(y))<.02),outline:getComputedStyle(track).outlineStyle,progress:Number(input.value)/Number(input.max),color:getComputedStyle(thumb).backgroundColor,accent:getComputedStyle(fill).backgroundColor===accent,circle:[circle.width,circle.height],centered:Math.abs(circle.top+circle.height/2-rect.top-rect.height/2)<1,headerCentered:Math.abs(arrow.y+arrow.height/2-label.y-label.height/2)<.1,headerLeft:arrow.x-back.getBoundingClientRect().x<14};
		});
		if(geometry.height!==24||geometry.dots!==(provider==='gemini'?3:5)||!geometry.uniformDots||geometry.outline!=='none'||!geometry.headerCentered||!geometry.headerLeft||!geometry.accent||geometry.color!=='rgb(255, 255, 255)'||!geometry.centered||geometry.circle.join(',')!=='28,28'||Math.abs(geometry.fill-(14+(geometry.width-28)*geometry.progress))>1)throw Error('Control geometry, uniform markers, focus ring, left header alignment or theme accent failed: '+JSON.stringify(geometry));
		await effort.blur();await page.mouse.move(0,0);await captionCheck();
		for(const theme of ['dark','light']){
			await page.evaluate(theme=>{document.body.className='theme-'+theme;},theme);
			await page.screenshot({path:path.resolve('.codex-tmp/deus-ui/'+provider+'-effort-'+theme+'.png')});
			await page.locator('.deus-cli-preview .deus-effort-control').screenshot({path:path.resolve('.codex-tmp/deus-ui/'+provider+'-effort-bar-'+theme+'.png')});
		}
		const button=page.locator('.deus-model-selector'),popup=page.locator('.deus-model-menu');
		const anchorCheck=async()=>{const a=await button.boundingBox(),b=await popup.boundingBox();if(!b||b.y+b.height>a.y-5||b.x<7||b.x+b.width>page.viewportSize().width-7)throw Error('Dropdown is not above its button: '+JSON.stringify({a,b}));};
		await anchorCheck();await button.click();if(await popup.count())throw Error('Repeated click did not close dropdown');
		await button.click();if((await page.locator('.deus-provider-option').allTextContents()).join(',')!=='Gemini,Claude Code,Codex')throw Error('First click did not open the three providers in order');await anchorCheck();
		await page.locator('.deus-provider-option[data-provider="'+provider+'"]').click();await page.locator('.deus-model-option').first().waitFor();
		const next=provider==='gemini'?'gemini-3.5-flash-lite':'fixture-fast';
		await page.locator('.deus-model-option[data-model="'+next+'"]').click();if(await popup.count()||await button.getAttribute('aria-expanded')!=='false')throw Error('Model change left a stale open flag');
		await button.click();if(await page.locator('.deus-provider-option').count()!==3)throw Error('First click after model change was swallowed');
		await page.locator('.deus-provider-option[data-provider="'+provider+'"]').click();await page.locator('.deus-model-option[data-model="'+next+'"]').waitFor();
		if(await page.locator('.deus-model-option[data-model="'+next+'"]').getAttribute('aria-checked')!=='true')throw Error('Model choice was not restored');
		if(provider==='gemini'){
			const slider=popup.locator('input[type="range"]');await slider.press('Home');await slider.press('ArrowRight');
			const uniform=await popup.locator('.deus-effort-dots').evaluate(el=>{
				const dots=[...el.children],pixel=value=>Math.abs(value-Math.round(value))<.025,ratio=devicePixelRatio;
				return dots.length===4&&dots.every(dot=>{const r=dot.getBoundingClientRect();return Math.abs(r.width-r.height)<.01&&[r.x,r.y,r.width,r.height].every(value=>pixel(value*ratio));});
			});
			if(!uniform||await popup.locator('.deus-effort-value').textContent()!=='Low'||await popup.locator('.deus-effort-track').evaluate(el=>getComputedStyle(el).outlineStyle)!=='none')throw Error('Four-step Flash-Lite markers, level or focus ring failed');
			await popup.screenshot({path:path.resolve('.codex-tmp/deus-ui/gemini-lite-low.png')});
		}
		await page.locator('.deus-model-back').click();if(await page.locator('.deus-provider-option').count()!==3)throw Error('Back navigation lost provider order');await button.click();
		if(provider!=='gemini'){
			await page.evaluate(()=>globalThis.deusUiDeferModels());await button.click();await page.locator('.deus-provider-option[data-provider="'+provider+'"]').click();await captionCheck();await button.click();await page.evaluate(()=>globalThis.deusUiReleaseModels());
			if(await popup.count()||await button.getAttribute('aria-expanded')!=='false')throw Error('Delayed catalog reopened the closed dropdown');
		}
		await button.click();await popup.waitFor();await page.locator('.deus-input').click({position:{x:3,y:8}});if(await popup.count())throw Error('Outside click did not close dropdown');
	}
	console.log('PASS Chromium Deus panel, references checklist, local slash commands, title-only mention editing, streaming follow/pause/resume, draggable sidebar, sessions and accent citations', { ...result, wide, dragged, medium, compact, scrolling, navigation, command, upstreamCssComparisons: parity });
} finally { await browser.close(); }
