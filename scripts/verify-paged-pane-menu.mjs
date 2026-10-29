import assert from 'node:assert/strict';
import { loadTsFixture } from './ts-fixture-loader.mjs';

class FileView { onPaneMenu(menu) { menu.items.push('split right','split down'); } }
class MarkdownView extends FileView {
	onPaneMenu(menu,source) {
		super.onPaneMenu(menu,source);
		assert.equal(this.getMode(),'source');
		assert.equal(this.getState().file,this.file.path);
		assert(this.editor);
		menu.items.push('rename','delete','reading view','source mode','add property','find','replace','export PDF');
		this.app.workspace.trigger('file-menu',menu,this.file,source,this.leaf);
		menu.find=()=>this.showSearch(false);menu.replace=()=>this.showSearch(true);
		menu.read=()=>this.onSwitchView();menu.pdf=()=>this.printToPdf();
	}
}
const { PagedWritingView }=loadTsFixture('src/paged/PagedWritingView.ts',{
	obsidian:{FileView,MarkdownView,Modal:class{},Scope:class{}}, 'diff-match-patch':{},
});
const leaf={},file={path:'project/note.md'},calls=[];
const view=Object.assign(Object.create(PagedWritingView.prototype),{
	leaf,file,app:{vault:{getConfig:()=> 'visible'},workspace:{trigger:(event,menu,actualFile,source,actualLeaf)=>{
		assert.equal(event,'file-menu');assert.equal(actualFile,file);assert.equal(actualLeaf,leaf);assert.equal(source,'more-options');menu.items.push('third-party file action');
	}}},
	getEditorAdapter:()=>({}),getState:()=>({file:file.path}),
	openFindBar:replace=>calls.push(['find',replace]),openInSourceView:async(mode='source')=>calls.push(['mode',mode]),
});
leaf.view=view;
const menu={items:[]};view.onPaneMenu(menu,'more-options');
assert.equal(menu.items.length,11,'Paged menu lost native Markdown or third-party file actions');
menu.find();menu.replace();menu.read();await menu.pdf();
assert.deepEqual(calls,[['find',false],['find',true],['mode','preview'],['mode','source']]);
console.log('PASS native Markdown menu delegation, file/leaf/source identity, file-menu extensions, find/replace, reading view and PDF action routing');
