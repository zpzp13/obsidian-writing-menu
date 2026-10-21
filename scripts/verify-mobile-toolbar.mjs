import { MarkdownView, Platform } from 'obsidian';
import { LeafStyleManager } from '../src/editor/LeafStyleManager';
import { WritingToolbar } from '../src/toolbar/WritingToolbar';
import { bindMobileToolbarLayout } from '../src/toolbar/MobileToolbarLayout';
import { DEFAULT_SETTINGS } from '../src/types';
import { observeThemeMode } from '../src/utils/themeColor';

// Standalone mobile-like fixtures; no user vault files or font downloads.
export function installMobileToolbarChecks() {
	const assert = (condition,message) => {if (!condition) throw new Error(message);};
	const settle = () => new Promise(resolve=>setTimeout(resolve,55));
	let cleanup;
	const mount = () => {
		cleanup?.();
		const wasMobile = Platform.isMobile; Platform.isMobile = true;
		const addedMobile = !document.body.hasClass('is-mobile'); document.body.addClass('is-mobile');
		const previousPopoverLayer = document.body.style.getPropertyValue('--layer-popover');
		document.body.style.setProperty('--layer-popover','2200');
		const outer = document.body.createDiv({cls:'wm-mobile-toolbar-probe'});
		outer.setCssStyles({position:'fixed',left:'0',top:'0',width:'390px',height:'600px',zIndex:'2100',background:'white'});
		const nativeStyle = outer.createEl('style');
		nativeStyle.textContent = `.wm-mobile-toolbar-probe > .workspace-leaf-content {display:flex;flex-direction:column;height:100%;}
		.wm-mobile-toolbar-probe .view-header {position:fixed;top:24px;left:0;width:390px;height:48px;transition:transform 160ms linear,opacity 160ms linear;}
		.wm-mobile-toolbar-probe.is-hidden-header .view-header {transform:translateY(-72px);opacity:0;}
		.wm-mobile-toolbar-probe .view-content {flex:1 1 auto;min-height:0;}`;
		const leaf = {containerEl:outer.createDiv({cls:'workspace-leaf-content wm-markdown-toolbar-leaf'})};
		const header = leaf.containerEl.createDiv({cls:'view-header'});
		const host = leaf.containerEl.createDiv({cls:'wm-markdown-toolbar-host is-mobile-mount'});
		const content = leaf.containerEl.createDiv({cls:'view-content'});
		const source = content.createDiv({cls:'markdown-source-view mod-cm6'});
		const scroller = source.createDiv({cls:'cm-editor'}).createDiv({cls:'cm-scroller'});
		const text = scroller.createDiv({cls:'cm-sizer'}).createDiv({cls:'cm-content',text:'WWiiiiWWiiii'});
		const reading = content.createDiv({cls:'markdown-reading-view'}).createDiv({cls:'markdown-preview-view'});
		reading.createDiv({cls:'markdown-preview-sizer',text:'읽기 배경 검사'});
		leaf.view = new MarkdownView(leaf); leaf.view.file = {path:'Project/mobile.md',extension:'md',basename:'mobile'};
		const plugin = {settings:{...structuredClone(DEFAULT_SETTINGS),fontFamily:'serif',customFonts:['monospace'],writingWidgetOrder:[]},
			app:{workspace:{getLeavesOfType:type=>type === 'markdown' ? [leaf] : [],getMostRecentLeaf:()=>leaf}},
			projectContext:{getProjectForPath:()=>({id:'project'})},leafStyleVersions:new Map(),cssSettingsVersion:1,leafIdCounter:1,
			stopwatchManager:{subscribeWidget:()=>()=>{}},calculateAllCharCounts:()=>({munpia:0,novelpia:0})};
		const styles = new LeafStyleManager(plugin);
		plugin.mobileFonts = { ensureSelected:async () => {}, cssFamily:() => plugin.settings.mobileFontFamily === 'maruburi' ? 'monospace' : 'inherit' };
		plugin.saveSettings = async () => {styles.regenerateCSSTemplate();styles.updateAllLeafStyles();};
		styles.updateLeafStyles(leaf);
		const surface = {kind:'markdown',leaf,getFile:()=>leaf.view.file,getText:()=>text.textContent,focus() {},undo() {},redo() {},
			toggleFormat() {},isFormatActive:()=>false,getAlignment:()=>null,setAlignment() {},applyTextColor() {},clearTextColors() {},getRecentTextColor:()=>'',switchView() {},getZoom:()=>1,setZoom() {}};
		const toolbar = new WritingToolbar(plugin,host,surface), unbind = bindMobileToolbarLayout(leaf.containerEl,host);
		cleanup = () => {unbind();toolbar.destroy();outer.remove();Platform.isMobile = wasMobile;if(addedMobile)document.body.removeClass('is-mobile');
			if(previousPopoverLayer)document.body.style.setProperty('--layer-popover',previousPopoverLayer);else document.body.style.removeProperty('--layer-popover');cleanup = null;};
		return {outer,header,host,content,text,plugin,toolbar};
	};
	globalThis.verifyMobileToolbarAnimation = async () => {
		const {outer,header,host,content} = mount();
		const wasDark = document.body.hasClass('theme-dark');
		let clippedHostReads = 0;
		const heightGetter = Object.getOwnPropertyDescriptor(Element.prototype,'scrollHeight').get;
		Object.defineProperty(host,'scrollHeight',{configurable:true,get() {clippedHostReads++;return heightGetter.call(this);}});
		const track = async hidden => {
			outer.toggleClass('is-hidden-header',hidden);
			let previous = content.getBoundingClientRect().top, maxReversal = 0;
			for (let index = 0; index < 18; index++) {
				await new Promise(resolve=>requestAnimationFrame(resolve));
				const top = content.getBoundingClientRect().top;
				maxReversal = Math.max(maxReversal,hidden ? top-previous : previous-top);
				previous = top;
			}
			assert(maxReversal < 1,`Mobile toolbar layout reverses during its ${hidden ? 'hide' : 'show'} animation: ${maxReversal}`);
		};
		try {
			for (const dark of [false,true]) {
				document.body.toggleClass('theme-dark',dark);
				for (const element of [host,host.querySelector('.wm-writing-toolbar')]) {
					const style = getComputedStyle(element);
					assert(style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.backgroundImage === 'none','Mobile toolbar still has a background');
					assert(style.borderBottomWidth === '0px','Mobile toolbar still has a bottom border');
				}
			}
			document.body.toggleClass('theme-dark',wasDark);
			await settle();
			for (let cycle = 0; cycle < 2; cycle++) {await track(true);await track(false);}
			assert(clippedHostReads === 0,'Mobile layout still feeds the clipped host scrollHeight into animation sizing');
			assert(!host.style.height && !host.style.maxHeight,'Mobile layout still resizes the host during native navigation transitions');
			assert(Math.abs(host.getBoundingClientRect().top-header.getBoundingClientRect().bottom) < .5,'Mobile toolbar stopped tracking the native header');
			console.info('Mobile header hide/show: shared compositor motion, fixed editor viewport and no per-frame height writes passed');
		} finally {document.body.toggleClass('theme-dark',wasDark);cleanup?.();assert(!host.style.height,'Mobile layout cleanup left a fixed toolbar height behind');}
	};
	globalThis.diagnoseMobileToolbarNativeTiming = async () => {
		const {outer,header,host,content} = mount();
		// Obsidian 1.14.4 app.css: opacity .2s; transform .3s, both ease-in-out.
		header.style.transition = 'opacity 0.2s ease-in-out, transform 0.3s ease-in-out';
		const heights = new Set(), editorHeights = new Set();
		let fullyOpaqueWhileMoving = 0;
		try {
			await settle();outer.addClass('is-hidden-header');await new Promise(resolve=>setTimeout(resolve,360));
			outer.removeClass('is-hidden-header');
			for(let index=0;index<25;index++) {
				await new Promise(resolve=>requestAnimationFrame(resolve));
				const style=getComputedStyle(header), transform=new DOMMatrixReadOnly(style.transform);
				if(Number(style.opacity) === 1 && Math.abs(transform.m42) > .5)fullyOpaqueWhileMoving++;
				heights.add(host.style.height);editorHeights.add(content.getBoundingClientRect().height.toFixed(2));
			}
			assert(fullyOpaqueWhileMoving > 0,'Native timing fixture failed to reproduce independent movement and opacity');
			assert(heights.size === 1 && editorHeights.size === 1,'Native navigation still changes toolbar or editor viewport height on each animation frame');
			const diagnosis={fullyOpaqueWhileMoving,toolbarHeightSteps:heights.size,editorViewportHeightSteps:editorHeights.size};
			console.info('Mobile toolbar structural diagnosis: '+JSON.stringify(diagnosis));
			return diagnosis;
		} finally {cleanup?.();}
	};
	globalThis.verifyMobileThemeGuard = async () => {
		let restyles=0;const original=document.body.classList.contains('theme-dark');
		const stop=observeThemeMode(document,()=>restyles++);
		try {
			document.body.addClass('is-hidden-nav');await settle();document.body.removeClass('is-hidden-nav');await settle();
			assert(restyles===0,'Mobile navigation still triggers a global editor restyle');
			document.body.toggleClass('theme-dark',!original);await settle();
			assert(restyles===1,'A real theme change no longer refreshes editor styles');
		}finally{stop();document.body.toggleClass('theme-dark',original);}
		console.info('Mobile header classes no longer invalidate all document styles; real theme changes still refresh once');
	};
	globalThis.verifyMobileFullWidthBackground = async () => {
		const {outer,content,text,plugin} = mount(), wasDark=document.body.hasClass('theme-dark');
		try {
			content.style.padding='0 18px';
			plugin.settings.backgroundColor={light:'#e5f0ee',dark:'#233344'};
			for(const dark of [false,true]) {
				document.body.toggleClass('theme-dark',dark);await plugin.saveSettings();
				const expected=dark?'rgb(35, 51, 68)':'rgb(229, 240, 238)';
				for(const element of [content,...content.querySelectorAll('.markdown-source-view,.cm-editor,.cm-scroller,.cm-sizer,.markdown-reading-view,.markdown-preview-view,.markdown-preview-sizer')])
					assert(getComputedStyle(element).backgroundColor===expected,'Native mobile CSS left an uncolored editor/reading gutter');
				assert(Math.abs(content.getBoundingClientRect().width-outer.getBoundingClientRect().width)<1,'Mobile paper background does not span the viewport');
				assert(getComputedStyle(text.parentElement).paddingLeft==='40px','Mobile full-width color changed the text inset');
			}
			console.info('Native mobile paper background: full-width editing/reading canvas in both themes with text padding retained passed');
		} finally {document.body.toggleClass('theme-dark',wasDark);cleanup?.();}
	};
	let fixture, beforeWidth;
	const width = () => {const range = document.createRange();range.selectNodeContents(fixture.text);return range.getBoundingClientRect().width;};
	globalThis.mobileFontProbe = {
		async open() {
			fixture = mount(); await settle(); beforeWidth = width();
			fixture.toolbar.toolbarEl.querySelector('.is-font').click(); await settle();
			assert(!fixture.toolbar.activePopover.textContent.includes('PC와 별도로 적용합니다.'),'Removed mobile font guidance returned');
			assert(fixture.toolbar.activePopover.querySelectorAll('.wm-paged-popover-item').length===7,'Mobile dropdown does not initially show all six supplied fonts and the system font');
			for(const [kind,width] of [['font',180],['weight',108],['size',94],['format',96]]) {
				const button=fixture.toolbar.toolbarEl.querySelector('.is-'+kind);
				assert(button.getBoundingClientRect().width>=width,'Mobile '+kind+' selector is still compressed');
			}
		},
		async optionPoint() {
			await settle();
			const option = fixture.toolbar.activePopover?.querySelector('.wm-paged-popover-item');
			assert(option,'Mobile font search did not produce a selectable option');
			const bounds = option.getBoundingClientRect();
			const point = {x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2};
			assert(option.contains(document.elementFromPoint(point.x,point.y)),'Native mobile font choice is obscured in the test fixture');
			return point;
		},
		snapshot() {
			const popover = fixture.toolbar.activePopover;
			return {font:fixture.plugin.settings.mobileFontFamily,desktopFont:fixture.plugin.settings.fontFamily,cssFont:getComputedStyle(fixture.text).fontFamily,
				popover:Boolean(popover),searchFocused:popover?.querySelector('input') === document.activeElement,
				width:width(),beforeWidth};
		},
		dispose:()=>cleanup?.(),
	};
}
