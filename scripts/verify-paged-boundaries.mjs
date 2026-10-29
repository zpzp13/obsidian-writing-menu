import { PaginationEngine } from '../src/paged/PaginationEngine';

export async function runPagedBoundaryChecks(view, plugin) {
	const assert = (value, message) => { if (!value) throw new Error(message); };
	const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	const consistent = () => {
		const engine = new PaginationEngine(view.measurerEl, view.getPaginationGeometry());
		engine.updateInlineFormats(view.getInlineFormatRanges());
		assert(JSON.stringify(view.pages) === JSON.stringify(engine.paginate(view.getEditableData())), 'Incremental page boundaries differ from a fresh layout');
	};
	const source = ('경계에서 이어지는 문장\n\n').repeat(180);
	for (const zoom of [0.7, 1, 1.6]) {
		view.setZoom(zoom); view.setViewData(source, true);
		let blank = null;
		for (const page of view.pages.slice(0, -1)) {
			view.renderPageIfNeeded(page.index);
			const run = view.pageTextEls[page.index].querySelector('.wm-paged-paragraph:last-child > .wm-paged-text-run');
			if (run?.classList.contains('is-empty')) { blank = { index: page.index, offset: Number(run.dataset.from) }; break; }
		}
		assert(blank, 'Missing blank line on the last row of a page');
		view.placeCaretInPage(blank.index, blank.offset, false);
		view.editRootEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		assert(view.readSelection().head === blank.offset + 1, `Zoom ${zoom}: Enter left the native caret on the preceding page`);
		assert(view.getEditableData() === source.slice(0, blank.offset) + '\n' + source.slice(blank.offset), 'Boundary Enter changed another line');
		consistent();
		const beforeDelete = view.getEditableData(), head = view.readSelection().head;
		const start = view.domPointAtOffset(head), end = view.domPointAtOffset(head + 1);
		const event = new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true });
		Object.defineProperty(event, 'getTargetRanges', { value: () => [new StaticRange({ startContainer: start.node, startOffset: start.offset, endContainer: end.node, endOffset: end.offset })] });
		view.editRootEl.dispatchEvent(event);
		assert(view.getEditableData() === beforeDelete.slice(0, head - 1) + beforeDelete.slice(head), 'Blank-line Backspace consumed the following line');
		assert(view.readSelection().head === head - 1, 'Blank-line Backspace restored the wrong caret');
		consistent();
		const page = view.pages[1];
		view.placeCaretInPage(page.index, page.from, false);
		view.editRootEl.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentForward', bubbles: true, cancelable: true }));
		consistent();
	}
	const savedAlignment = plugin.settings.pagedDefaultAlignment;
	plugin.settings.pagedDefaultAlignment = 'justify';
	for (const zoom of [0.7, 1, 1.6]) {
		view.setZoom(zoom);
		view.setViewData(('문장과 English words를 페이지 경계 너머로 이어 씁니다. ').repeat(150), true);
		for (const page of view.pages) {
			view.renderPageIfNeeded(page.index);
			const text = view.pageTextEls[page.index];
			const bounds = text.getBoundingClientRect(), content = text.parentElement.getBoundingClientRect();
			assert(bounds.bottom <= content.bottom + 1,
				`Zoom ${zoom}: page ${page.index} clips a visual line (text ${bounds.height}px, content ${content.height}px)`);
		}
		const last = view.pageTextEls[0].lastElementChild;
		assert(getComputedStyle(last).textAlignLast === 'justify', 'A continued paragraph lost justification at the page bottom');
		assert(getComputedStyle(view.pageTextEls[view.pages.length - 1].lastElementChild).textAlignLast === 'auto', 'The true final line was stretched');
	}
	plugin.settings.pagedDefaultAlignment = savedAlignment;
	const savedTypewriter = plugin.settings.enableTypewriterScrolling;
	plugin.settings.enableTypewriterScrolling = true;
	view.setViewData(source, true);
	view.placeCaretInPage(Math.floor(view.pages.length / 2), view.pages[Math.floor(view.pages.length / 2)].from, false);
	view.centerActivePage(); await frame();
	const centered = view.viewportEl.scrollTop;
	view.viewportEl.scrollTop = centered + 100;
	view.centerActivePage(); await frame();
	assert(Math.abs(view.viewportEl.scrollTop - centered) < 1, 'Typing on the same page did not restore typewriter centering');
	plugin.settings.enableTypewriterScrolling = savedTypewriter;
	console.info('Paged Enter/Backspace, fresh-layout parity at 70/100/160%, continued justification and same-page centering passed');
}
