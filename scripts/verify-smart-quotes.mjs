import assert from 'node:assert/strict';
import * as stateApi from '@codemirror/state';
import * as viewApi from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import { loadTsFixture } from './ts-fixture-loader.mjs';

class MarkdownView {}
const { getSmartQuoteExtension } = loadTsFixture('src/editor/extensions.ts', {
	'@codemirror/state':stateApi, '@codemirror/view':viewApi,
	obsidian:{ MarkdownView }, './HeadingRawWidget':{},
});
let inProject = true, nativeCalls = 0, autoPair = true;
const dom = {};
const leaf = { view:Object.assign(new MarkdownView(), { file:{ path:'Project/note.md' }, containerEl:{ contains:element => element === dom } }) };
const plugin = { settings:{ enableSmartQuotes:true }, app:{ workspace:{ getLeavesOfType:() => [leaf] } }, shouldApplyToFile:() => inProject };
const addPair = stateApi.StateEffect.define({map:(position,changes)=>changes.mapPos(position,-1,stateApi.MapMode.TrackAfter)??undefined});
const nativeTag = stateApi.Annotation.define();
const pairs = stateApi.StateField.define({create:()=>[],update:(positions,tr)=>[
	...positions.map(pos=>tr.changes.mapPos(pos,1,stateApi.MapMode.TrackAfter)).filter(pos=>pos!==null),
	...tr.effects.filter(effect=>effect.is(addPair)).map(effect=>effect.value),
]});
const config = stateApi.EditorState.languageData.of(()=>[{closeBrackets:{brackets:autoPair?['(', '[', '{', '"', "'"]:['*','_','`']}}]);
// The host owns pairing/traversal and tracks each closer with a state effect.
const nativePairs = viewApi.EditorView.inputHandler.of((view, from, to, text) => {
	const allowed=view.state.languageDataAt('closeBrackets',from)[0].brackets;
	const opener=text==='”'?'“':text==='’'?'‘':text;
	if(!allowed.includes(opener))return false;
	if(from===to && view.state.field(pairs).includes(from) && view.state.sliceDoc(from,from+1)===text){
		nativeCalls++;view.dispatch({selection:{anchor:from+1},annotations:nativeTag.of('skip')});return true;
	}
	if (!['"', "'"].includes(text)) return false;
	if(from===to && /[\p{L}\p{N}]/u.test(view.state.sliceDoc(from-1,from)))return false;
	nativeCalls++;
	const selected=view.state.sliceDoc(from,to);
	view.dispatch({changes:from===to?{from,to,insert:text+text}:[{from,insert:text},{from:to,insert:text}],
		selection:{anchor:from+1,head:from+1+selected.length},effects:addPair.of(from+1+selected.length),annotations:nativeTag.of('pair'),userEvent:'input.type'});
	return true;
});
const view = {dom,state:null,lastTransaction:null,dispatch(spec){
	const tr=spec instanceof stateApi.Transaction?spec:this.state.update(spec);
	this.lastTransaction=tr;this.state=tr.state;
	for(const listener of this.state.facet(viewApi.EditorView.updateListener))listener({view:this,state:this.state});
}};
view.dispatch=view.dispatch.bind(view);
const reset = (doc = '', from = doc.length, to = from) => {
	view.state = stateApi.EditorState.create({ doc, selection:{ anchor:from, head:to }, extensions:[pairs, config, nativePairs, history(), getSmartQuoteExtension(plugin)] });
};
const type = text => {
	const { from, to } = view.state.selection.main;
	for (const handler of view.state.facet(viewApi.EditorView.inputHandler)) if (handler(view, from, to, text, () => view.state.update(view.state.replaceSelection(text)))) return;
	view.dispatch({...view.state.replaceSelection(text),userEvent:'input.type'});
};
for (const [straight, open, close] of [['"', '“', '”'], ["'", '‘', '’']]) {
	reset(); type(straight);
	assert.equal(view.state.doc.toString(), open+close, 'Quote conversion intercepted native automatic closing');
	assert.equal(view.state.selection.main.head, 1);
	assert.deepEqual(view.state.field(pairs),[1],'Quote conversion moved the native pair marker');
	assert.equal(view.lastTransaction.annotation(nativeTag),'pair','Native annotations were lost');
	assert(view.state.languageDataAt('closeBrackets',1)[0].brackets.includes(open),'Native pair deletion cannot recognize the converted opener');
	type('한글'); type(straight);
	assert.equal(view.state.doc.toString(), open + '한글' + close, 'Closing quote was not converted');
	assert.equal(view.state.selection.main.head, 4);
	assert.equal(view.lastTransaction.annotation(nativeTag),'skip','The native handler did not traverse its closer');
	reset('앞 선택 뒤', 2, 4); type(straight);
	assert.equal(view.state.doc.toString(), '앞 ' + open + '선택' + close + ' 뒤', 'Native wrapping was lost');
	assert.equal(view.state.sliceDoc(view.state.selection.main.from,view.state.selection.main.to),'선택');
	reset();type(open);assert.equal(view.state.doc.toString(),open,'An explicitly typed curved quote was changed');
	autoPair=false;reset(open + '한글 ');type(straight);assert.equal(view.state.doc.toString(),open+'한글 '+close,'Whitespace before a closing quote changed its direction');autoPair=true;
	reset();type(straight);assert(undo(view));assert.equal(view.state.doc.toString(),'');assert(redo(view));assert.equal(view.state.doc.toString(),open+close);
	autoPair=false;reset();type(straight);assert.equal(view.state.doc.toString(),open,'Plugin ignored the disabled native automatic closing setting');autoPair=true;
}
assert(nativeCalls>0,'Plugin replaced the native input handler');
inProject = false; reset(); type('"'); assert.equal(view.state.doc.toString(), '""', 'Smart quotes escaped project scope');
inProject = true; plugin.settings.enableSmartQuotes = false; reset(); type("'"); assert.equal(view.state.doc.toString(), "''", 'Disabled smart quotes still replaced straight quotes');
plugin.settings.enableSmartQuotes = true; reset('본문'); type('x'); assert.equal(view.state.doc.toString(), '본문x');
reset('don');type("'");type('t');assert.equal(view.state.doc.toString(),'don’t');
reset();view.dispatch({changes:{from:0,insert:'"pasted"'},userEvent:'input.paste'});assert.equal(view.state.doc.toString(),'"pasted"');
console.log('PASS native pairing/traversal, pair markers, annotations, wrapping, native setting, undo/redo, Korean text, apostrophes, paste and project scope');
