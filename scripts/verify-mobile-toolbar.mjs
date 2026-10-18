import { MarkdownView, Platform } from 'obsidian';
import { LeafStyleManager } from '../src/editor/LeafStyleManager';
import { WritingToolbar } from '../src/toolbar/WritingToolbar';
import { bindMobileToolbarLayout } from '../src/toolbar/MobileToolbarLayout';
import { DEFAULT_SETTINGS } from '../src/types';

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
		const text = content.createDiv({cls:'markdown-source-view mod-cm6'}).createDiv({cls:'cm-scroller'}).createDiv({cls:'cm-content',text:'WWiiiiWWiiii'});
		leaf.view = new MarkdownView(leaf); leaf.view.file = {path:'Project/mobile.md',extension:'md',basename:'mobile'};
		const plugin = {settings:{...structuredClone(DEFAULT_SETTINGS),fontFamily:'serif',customFonts:['monospace'],writingWidgetOrder:[]},
			app:{workspace:{getLeavesOfType:type=>type === 'markdown' ? [leaf] : [],getMostRecentLeaf:()=>leaf}},
			projectContext:{getProjectForPath:()=>({id:'project'})},leafStyleVersions:new Map(),cssSettingsVersion:1,leafIdCounter:1,
			stopwatchManager:{subscribeWidget:()=>()=>{}},calculateAllCharCounts:()=>({munpia:0,novelpia:0})};
		const styles = new LeafStyleManager(plugin);
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
			await settle();
			for (let cycle = 0; cycle < 2; cycle++) {await track(true);await track(false);}
			assert(clippedHostReads === 0,'Mobile layout still feeds the clipped host scrollHeight into animation sizing');
			assert(host.style.height && !host.style.maxHeight,'Mobile layout still switches max-height/intrinsic-height at animation endpoints');
			assert(Math.abs(host.getBoundingClientRect().top-header.getBoundingClientRect().bottom) < .5,'Mobile toolbar stopped tracking the native header');
			console.info('Mobile header hide/show: monotonic motion, stable intrinsic toolbar size and no clipped-host feedback passed');
		} finally {cleanup?.();assert(!host.style.height,'Mobile layout cleanup left a fixed toolbar height behind');}
	};
	let fixture, beforeWidth;
	const width = () => {const range = document.createRange();range.selectNodeContents(fixture.text);return range.getBoundingClientRect().width;};
	globalThis.mobileFontProbe = {
		async open() {
			fixture = mount(); await settle(); beforeWidth = width();
			fixture.toolbar.toolbarEl.querySelector('.is-font').click(); await settle();
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
			return {font:fixture.plugin.settings.fontFamily,cssFont:getComputedStyle(fixture.text).fontFamily,
				popover:Boolean(popover),searchFocused:popover?.querySelector('input') === document.activeElement,
				width:width(),beforeWidth};
		},
		dispose:()=>cleanup?.(),
	};
}
