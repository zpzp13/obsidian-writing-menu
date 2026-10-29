import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MarkdownView } from 'obsidian';
import { getTypewriterExtension } from '../src/editor/extensions';

// Real CodeMirror layout: native scrolling and typewriter centering must share
// one scroll target, including multiple edits before the next layout frame.
export async function runEditorScrollingChecks() {
	const assert = (value, message) => { if (!value) throw new Error(message); };
	const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	const host = document.body.createDiv({ cls: 'wm-styled-document' });
	host.dataset.writingMenuId = 'scroll-test';
	document.body.classList.add('writing-menu-typewriter-active');
	const leaf = { view: Object.assign(Object.create(MarkdownView.prototype), { containerEl: host, file: { path: 'project/test.md' } }) };
	let inProject = true;
	const plugin = { settings: { enableTypewriterScrolling: true },
		app: { workspace: { getLeavesOfType: () => [leaf] } }, shouldApplyToFile: () => inProject };
	const view = new EditorView({ parent: host, state: EditorState.create({
		doc: ('한글 문장과 English words를 이어 쓰는 줄입니다.\n').repeat(120),
		extensions: [EditorView.lineWrapping, EditorView.theme({ '&': { height: '320px' }, '.cm-scroller': { overflow: 'auto' } }), getTypewriterExtension(plugin)],
	}) });
	const centerError = () => {
		const rect = view.coordsAtPos(view.state.selection.main.head);
		const viewport = view.scrollDOM.getBoundingClientRect();
		return Math.abs((rect.top + rect.bottom) / 2 - viewport.top - view.scrollDOM.clientTop - view.scrollDOM.clientHeight / 2);
	};
	const input = text => {
		const head = view.state.selection.main.head;
		view.dispatch({ changes: { from: head, insert: text }, selection: { anchor: head + text.length }, userEvent: 'input.type', scrollIntoView: true });
	};
	try {
		view.focus();
		view.dispatch({ selection: { anchor: view.state.doc.line(70).from } });
		input('한'); input('\n'); input('글');
		await frame();
		assert(centerError() < 2, 'CodeMirror native scrolling overrode typewriter centering');
		for (let index = 0; index < 8; index++) {
			input('\n다음 줄');
			await frame();
			assert(centerError() < 2, 'Enter did not keep the current caret at the center');
			const stable = view.scrollDOM.scrollTop;
			await frame();
			assert(Math.abs(view.scrollDOM.scrollTop - stable) < 1, 'Typewriter scrolling oscillated after layout settled');
		}
		input('긴 문장이 자동으로 줄바꿈되는 입력입니다. '.repeat(30));
		await frame();
		assert(centerError() < 2, 'Wrapped input did not center its final visual line');
		const head = view.state.selection.main.head;
		view.dispatch({ changes: { from: head - 1, to: head }, selection: { anchor: head - 1 }, userEvent: 'delete.backward', scrollIntoView: true });
		await frame();
		assert(centerError() < 2, 'Backspace did not keep the caret centered');
		view.scrollDOM.scrollTop += 100;
		await frame();
		const beforeMove = view.scrollDOM.scrollTop;
		input('x');
		view.dispatch({ selection: { anchor: view.state.doc.line(15).from }, userEvent: 'select' });
		await Promise.resolve();
		await frame();
		const afterMove = view.scrollDOM.scrollTop;
		assert(Math.abs(afterMove - beforeMove) < 1, 'An old input position was centered after the user moved the cursor');
		await frame();
		assert(view.scrollDOM.scrollTop === afterMove, 'A stale input scroll ran after a cursor move');
		inProject = false;
		const before = view.scrollDOM.scrollTop;
		view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' });
		await frame();
		assert(Math.abs(view.scrollDOM.scrollTop - before) < 2, 'Typewriter centering escaped project scope');
		console.info('Real CodeMirror rapid input, repeated Enter, wrapped lines, Backspace, stable centering, stale selection and project scope passed');
	} finally {
		view.destroy(); host.remove(); document.body.classList.remove('writing-menu-typewriter-active');
	}
}
