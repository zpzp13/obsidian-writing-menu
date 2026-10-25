import assert from 'node:assert/strict';
import * as stateApi from '@codemirror/state';
import * as viewApi from '@codemirror/view';
import { loadTsFixture } from './ts-fixture-loader.mjs';

class MarkdownView {}
const { getSmartQuoteExtension } = loadTsFixture('src/editor/extensions.ts', {
	'@codemirror/state':stateApi, '@codemirror/view':viewApi,
	obsidian:{ MarkdownView }, './HeadingRawWidget':{},
});
let inProject = true, nativeCalls = 0;
const dom = {};
const leaf = { view:Object.assign(new MarkdownView(), { file:{ path:'Project/note.md' }, containerEl:{ contains:element => element === dom } }) };
const plugin = { settings:{ enableSmartQuotes:true }, app:{ workspace:{ getLeavesOfType:() => [leaf] } }, shouldApplyToFile:() => inProject };
// Obsidian installs its straight-quote auto-pair handler before plugin extensions.
const nativePairs = viewApi.EditorView.inputHandler.of((view, from, to, text) => {
	if (!['"', "'"].includes(text)) return false;
	nativeCalls++;
	view.dispatch({ changes:{ from, to, insert:text + view.state.doc.sliceString(from, to) + text }, selection:{ anchor:from + 1 } });
	return true;
});
const view = { dom, state:null, dispatch(spec) { this.state = this.state.update(spec).state; } };
const reset = (doc = '', from = doc.length, to = from) => {
	view.state = stateApi.EditorState.create({ doc, selection:{ anchor:from, head:to }, extensions:[nativePairs, getSmartQuoteExtension(plugin)] });
};
const type = text => {
	const { from, to } = view.state.selection.main;
	for (const handler of view.state.facet(viewApi.EditorView.inputHandler)) if (handler(view, from, to, text, () => view.state.update(view.state.replaceSelection(text)))) return;
	view.dispatch(view.state.replaceSelection(text));
};
for (const [straight, open, close] of [['"', '“', '”'], ["'", '‘', '’']]) {
	reset(); type(straight);
	assert.equal(view.state.doc.toString(), open + close, 'Native auto-pair swallowed smart quotes');
	assert.equal(view.state.selection.main.head, 1);
	type('한글'); type(straight);
	assert.equal(view.state.doc.toString(), open + '한글' + close, 'Closing quote duplicated the auto-inserted closer');
	assert.equal(view.state.selection.main.head, 4);
	reset('앞 선택 뒤', 2, 4); type(straight);
	assert.equal(view.state.doc.toString(), '앞 ' + open + '선택' + close + ' 뒤');
	assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), '선택', 'Wrapping quotes lost the selection');
}
assert.equal(nativeCalls, 0, 'Native input ran before the project smart quote extension');
inProject = false; reset(); type('"'); assert.equal(view.state.doc.toString(), '""', 'Smart quotes escaped project scope');
inProject = true; plugin.settings.enableSmartQuotes = false; reset(); type("'"); assert.equal(view.state.doc.toString(), "''", 'Disabled smart quotes still replaced straight quotes');
plugin.settings.enableSmartQuotes = true; reset('본문'); type('x'); assert.equal(view.state.doc.toString(), '본문x');
console.log('PASS real CodeMirror input precedence, double/single curly pairs, Korean text, closing traversal, selected-text wrapping, toggle and project boundaries');
