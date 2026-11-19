import { MarkdownView, Menu, editorInfoField } from 'obsidian';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { DEFAULT_SETTINGS } from '../src/types';
import { HighlightCommentService } from '../src/comments/HighlightCommentService';
import { HighlightCommentPanel } from '../src/comments/HighlightCommentPanel';
import { highlightCommentExtension } from '../src/editor/highlightCommentDecoration';
import { WritingToolbar } from '../src/toolbar/WritingToolbar';
import { RevisionPanel } from '../src/repetition/RevisionPanel';
import { PagedWritingView } from '../src/paged/PagedWritingView';
import { getWritingDocument, getWritingDocumentForView } from '../src/writing/WritingDocument';
import { renderChapterChart, renderThemes } from '../src/review/ReviewCharts';

export async function runCommentsGoalChecks() {
	const assert = (value, message) => { if (!value) throw new Error(message); };
	const settle = (ms = 350) => new Promise(resolve => setTimeout(resolve, ms));
	const events = () => { const refs = new Set(); return { on(name, callback) { const ref = { name, callback }; refs.add(ref); return ref; }, offref(ref) { refs.delete(ref); }, trigger(name, ...args) { for (const ref of refs) if (ref.name === name) ref.callback(...args); } }; };
	const workspace = events(), metadata = events(), vault = events();
	const themeStyle = document.head.createEl('style'); themeStyle.textContent = 'body{background:var(--background-primary);color:var(--text-normal)}button{color:var(--text-normal);background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:4px;padding:4px 8px}';
	const preview = document.body.createDiv({ cls: 'wm-hlc-test-preview' }); preview.setCssStyles({ padding: '24px', maxWidth: '1000px' });
	const editorHost = preview.createDiv();
	const file = { path: 'Project/note.md', basename: 'note', extension: 'md' };
	let recent, goal = '5,500자', total = 2000, saves = 0;
	workspace.getMostRecentLeaf = () => recent;
	workspace.getLeavesOfType = type => type === 'markdown' ? [{ view }] : type === 'writing-menu-paged-writing' && paged ? [{ view: paged }] : [];
	vault.getAbstractFileByPath = path => path === file.path ? file : null;
	metadata.getFileCache = () => ({ frontmatter: { 목표글자수: goal } });
	const app = { workspace, metadataCache: metadata, vault, scope: {} };
	const settings = structuredClone(DEFAULT_SETTINGS); settings.showGoalWidget = settings.showTimerWidget = true;
	const dailyListeners = new Set();
	const plugin = { app, settings, shouldApplyToFile: () => true, registerEvent() {}, projectContext: { getProjectForFile: () => ({rootFolder:'Project'}) },
		charStore: { getTodayTotal: () => total, subscribe: callback => { dailyListeners.add(callback); return () => dailyListeners.delete(callback); } },
		onPagedEditorChange: () => () => {}, notifyPagedEditorChanged() {}, updateCharCountDebounced() {}, saveData: async () => {},
		toolbarManager: { mountPagedToolbar() {}, removeToolbarFromLeaf() {}, refreshToolbar() {}, refreshToolbarSelection() {} },
		stopwatchSeconds: 0, stopwatchInterval: null, formatTime: () => '00:00',
		stopwatchManager: { subscribeWidget: () => () => {} }, formatCharCount: n => n.toLocaleString('en-US'),
		calculateAllCharCounts: text => ({ munpia: text.length, novelpia: text.length }), saveSettings: async () => { saves++; }, openSettings() {} };
	plugin.highlightComments = new HighlightCommentService(plugin); plugin.highlightComments.load();
	const leaf = { containerEl: editorHost, app }, view = new MarkdownView(leaf); recent = { view }; view.file = file;
	const source = '앞 ==🟡그는 칼을 들었다== 뒤\n\n다음 ==파란 하늘== 끝';
	const cm = new EditorView({ parent: editorHost, state: EditorState.create({ doc: source, extensions: [history(), editorInfoField.init(() => ({ file })), highlightCommentExtension(plugin)] }) });
	view.editor = { cm, getValue: () => cm.state.doc.toString(), posToOffset(pos) { return cm.state.doc.line(pos.line + 1).from + pos.ch; }, offsetToPos(offset) { const line = cm.state.doc.lineAt(offset); return { line: line.number - 1, ch: offset - line.from }; },
		getCursor(which) { return this.offsetToPos(which === 'to' ? cm.state.selection.main.to : cm.state.selection.main.from); }, focus() { cm.focus(); }, setSelection(from, to) { cm.dispatch({ selection: { anchor: this.posToOffset(from), head: this.posToOffset(to) } }); }, scrollIntoView() {} };
	let paged = null;
	const documentAdapter = getWritingDocument(plugin), service = plugin.highlightComments;
	const h = service.resolve(documentAdapter).highlights[0];
	const t = service.addComment(file.path, h, '복선을 더 넣기 <script>unsafe</script>');
	const commentsHost = preview.createDiv({ cls: 'wm-revision-root' }), panel = new HighlightCommentPanel(commentsHost, plugin, () => {});
	await settle();
	assert(commentsHost.querySelectorAll('.wm-hlc-item').length === 2, 'Live highlights missing');
	assert(!commentsHost.querySelector('script'), 'Comment text was interpreted as HTML');
	assert(editorHost.querySelector('.wm-hl-commented'), 'CM6 comment decoration missing');
	assert(!commentsHost.querySelector('textarea'), 'Reply boxes should stay closed until asked for');
	commentsHost.querySelector('[aria-label="답글 추가"]').click();
	const draft = commentsHost.querySelector('.wm-hlc-composer textarea'); draft.focus(); draft.value = '입력 중인 댓글'; draft.setSelectionRange(3, 5); draft.dispatchEvent(new Event('input'));
	service.setStatus(t.id, 'done'); await settle();
	assert(commentsHost.contains(draft) && draft.value === '입력 중인 댓글' && draft.selectionStart === 3 && draft.selectionEnd === 5, 'Background refresh lost comment input/cursor');
	draft.blur(); await settle(20); assert(commentsHost.querySelector('textarea').value === '입력 중인 댓글', 'Draft lost on deferred refresh');
	assert(Array.from(commentsHost.querySelectorAll('.wm-hlc-composer button')).some(b => b.textContent === '등록'), 'Reply button should read 등록');
	commentsHost.querySelector('.wm-hlc-composer').closest('.wm-hlc-item').querySelector('[aria-label="취소"]')?.click();
	panel.update(true); commentsHost.querySelector('.wm-hlc-comment-tools [aria-label="댓글 편집"]').click();
	assert(commentsHost.querySelector('.wm-hlc-comment-item.is-editing textarea')?.value.startsWith('복선을 더 넣기'), 'Edit box must start from the saved comment');
	panel.update(true);
	panel.filter.query = '복선'; panel.update(true);
	assert(commentsHost.querySelectorAll('.wm-hlc-item').length === 1 && commentsHost.querySelector('.wm-hlc-match'), 'Comment body search missing');
	panel.filter = { status: 'done', colors: ['yellow'], query: '' }; panel.update(true);
	assert(commentsHost.querySelectorAll('.wm-hlc-item').length === 1, 'State and color filters did not intersect');
	assert(!commentsHost.querySelector('[title]'), 'Native title tooltips must not double Obsidian tooltips');
	panel.filter = { status: 'all', colors: [], query: '' }; panel.update(true);
	const chip = label => Array.from(commentsHost.querySelectorAll('.wm-hlc-chips .wm-hlc-chip')).find(el => el.textContent.startsWith(label));
	assert(chip('색상').textContent === '색상0' && !chip('색상').querySelector('svg'), 'Colour chip should read 색상 0 without an arrow');
	chip('색상').click(); assert(commentsHost.querySelectorAll('.wm-hlc-color-pop .wm-hlc-color-option').length === 8, 'Colour chip did not expand into its menu');
	const allOption = commentsHost.querySelector('.wm-hlc-color-option');
	assert(allOption.textContent === '모두' && allOption.getAttribute('aria-checked') === 'true' && commentsHost.querySelector('.wm-hlc-color-pop.is-opening'), '모두 must be first and on by default; opening animates');
	commentsHost.querySelectorAll('.wm-hlc-color-option')[4].click();
	assert(!commentsHost.querySelector('.wm-hlc-color-pop.is-opening') && commentsHost.querySelector('.wm-hlc-color-option').getAttribute('aria-checked') === 'false', 'Picking a colour must not replay the animation or keep 모두 on');
	assert(getComputedStyle(commentsHost.querySelector('.wm-hlc-chips')).flexWrap === 'nowrap', 'Chip row must stay on one line');
	assert(Math.abs(commentsHost.querySelector('.wm-hlc-color-pop').getBoundingClientRect().width - commentsHost.querySelector('.wm-hlc-chip.is-colors').getBoundingClientRect().width) < 1, 'Colour menu must keep the chip width');
	assert(!commentsHost.querySelector('.wm-hlc-color-option .wm-hlc-color-dot, .wm-hlc-color-option svg'), 'Colour options are text only');
	commentsHost.querySelector('.wm-hlc-color-option').click(); assert(commentsHost.querySelector('.wm-hlc-color-pop'), 'Colour menu closed while picking');
	document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); assert(!commentsHost.querySelector('.wm-hlc-color-pop'), 'Outside click did not close the colour menu');
	panel.filter.colors = []; panel.update(true);
	chip('완료').click(); assert(getComputedStyle(commentsHost.querySelector('.wm-hlc-item.is-done .wm-hlc-rail'), '::after').borderLeftStyle !== 'dashed', 'Done rail must be a solid line'); assert(commentsHost.querySelectorAll('.wm-hlc-item').length === 1 && chip('완료').getAttribute('aria-pressed') === 'true', 'Status chip filter failed');
	const before = commentsHost.querySelector('.wm-hlc-item'); panel.update(); assert(commentsHost.querySelector('.wm-hlc-item') === before, 'Unchanged refresh rebuilt the list');
	chip('전체').click(); assert(commentsHost.querySelectorAll('.wm-hlc-item').length === 2 && !commentsHost.querySelector('.wm-hlc-color-pop'), 'All chip did not reset');
	service.removeHighlight(documentAdapter, h); assert(!documentAdapter.read().includes('==🟡'), 'Remove did not remove markup');
	assert(service.resolve(documentAdapter).anchors[0].state === 'detached', 'Removed highlight stayed attached');
	panel.update(true); assert(!commentsHost.querySelector('.wm-hlc-item.is-missing [aria-label="다시 하이라이트"]') && commentsHost.querySelector('.wm-hlc-item.is-missing'), 'Missing highlights must not offer re-highlighting');
	assert(getComputedStyle(commentsHost.querySelector('.wm-hlc-item:last-child .wm-hlc-rail'), '::after').display !== 'none', 'The timeline must end in a line');
	assert(getComputedStyle(commentsHost.querySelector('.wm-hlc-item.is-bare .wm-hlc-dot')).borderTopStyle === 'dashed', 'Highlights without comments need a dashed node');
	assert(getComputedStyle(commentsHost.querySelector('.wm-hlc-item.is-missing .wm-hlc-dot')).borderTopStyle === 'none', 'Missing items use the question-mark icon, not a ring');
	undo(cm); assert(documentAdapter.read() === source && service.resolve(documentAdapter).anchors[0].state === 'attached', 'Native undo did not restore anchor');
	cm.dispatch({ selection: { anchor: h.from + 4 } });
	const menu = new Menu(); workspace.trigger('editor-menu', menu, view.editor, { file, editor: view.editor });
	assert(menu.items.some(i => i.title === '코멘트 보기 (1)'), 'Generic MarkdownFileInfo menu target was not resolved');
	const toolbarHost = preview.createDiv({ cls: 'wm-markdown-toolbar-host' });
	const surface = { kind: 'markdown', leaf, getFile: () => file, getText: () => source, getZoom: () => 1, getAlignment: () => 'left', isFormatActive: () => false, getRecentTextColor: () => '' };
	settings.writingGoalChars = 5500; settings.goalCharBasis = 'munpia';
	const toolbar = new WritingToolbar(plugin, toolbarHost, surface); toolbar.updateWidgetCharCounts({ munpia: 4200, novelpia: 4100 }, { munpia: 10, novelpia: 10 });
	assert(toolbarHost.textContent.includes('목표까지 1,300') && !toolbarHost.textContent.includes('자자'), 'Goal must use the dashboard goal and full document');
	assert(toolbarHost.querySelectorAll('.is-goal circle.is-filled').length === 9, 'Progress dots incorrect');
	toolbarHost.querySelector('.is-goal').click(); assert(toolbar.activePopover.querySelector('.wm-dash-char-goal-track') && !toolbar.activePopover.querySelector('input'), 'Goal popover must reuse the dashboard goal bar'); toolbar.closePopover();
	settings.goalCharBasis = 'novelpia'; toolbar.updateWidgetCharCounts({ munpia: 4200, novelpia: 4100 }); assert(toolbarHost.textContent.includes('목표까지 1,400'), 'Goal basis ignored');
	settings.writingGoalChars = 4000; toolbar.updateWidgetCharCounts({ munpia: 4200, novelpia: 4100 }); assert(toolbarHost.querySelector('.is-goal.is-reached'), 'Reached state missing');
	settings.writingGoalChars = 5500; settings.goalCharBasis = 'munpia';
	for (const dark of [false, true]) {
		document.body.toggleClass('theme-dark', dark); document.body.toggleClass('theme-light', !dark);
		const color = getComputedStyle(toolbarHost.querySelector('.is-timer .wm-writing-widget-icon')).color;
		assert(color === (dark ? 'rgb(240, 192, 58)' : 'rgb(148, 108, 0)'), 'Timer theme color incorrect: ' + color);
	}
	toolbar.updateWidgetCharCounts({ munpia: 4200, novelpia: 4100 });
	const revisionHost = preview.createDiv(), revision = new RevisionPanel(revisionHost, plugin); revision.load(); await settle();
	assert(revisionHost.querySelector('.is-repetition .wm-revision-inline-refresh'), 'Refresh missing from repetition header');
	revisionHost.querySelector('[aria-label="하이라이트 코멘트로 전환"]').click(); assert(revision.commentsRoot.hidden === false, 'Revision comments toggle failed');
	revisionHost.querySelector('[aria-label="분석으로 전환"]').click(); assert(revision.analysisRoot.hidden === false, 'Analysis toggle failed');
	const pagedHost = preview.createDiv(); pagedHost.createDiv(); pagedHost.createDiv();
	paged = new PagedWritingView({ containerEl: pagedHost, app }, plugin); await paged.onOpen(); paged.file = file; paged.setViewData(source, true); recent = { view: paged };
	const pagedDocument = getWritingDocumentForView(paged), ph = service.resolve(pagedDocument).highlights[0];
	service.removeHighlight(pagedDocument, ph); paged.undo(); assert(paged.getViewData() === source, 'Paged highlight removal did not support undo');
	paged.restoreSelection({ anchor: 4, head: 6 }, true); const sr = pagedDocument.selectionSourceRange(); assert(sr.from > 4 && sr.to > sr.from, 'Paged selection did not map to source');
	const pagedMenu = new Menu(); workspace.trigger('editor-menu', pagedMenu, paged.getEditorAdapter(), { file, editor: paged.getEditorAdapter() }); assert(pagedMenu.items.some(i => String(i.title).startsWith('코멘트 보기')), 'Paged context menu failed');
	const oldPath = file.path; file.path = 'Project/renamed.md'; vault.trigger('rename', file, oldPath); assert(t.path === file.path, 'Renaming note lost comments');
	await settle(550); assert(saves > 0, 'Comment changes were not persisted');
	recent = { view }; panel.filter = { status: 'all', colors: [], query: '' }; panel.update(true);
	cm.dispatch({ changes: { from: cm.state.doc.length, insert: ' 끝에 덧붙임' } }); panel.update();
	const staleTarget = Array.from(commentsHost.querySelectorAll('.wm-hlc-item')).find(el => !el.classList.contains('is-missing'));
	staleTarget.click();
	const sel = cm.state.selection.main, picked = cm.state.doc.sliceString(sel.from, sel.to);
	assert(picked.includes('그는 칼을 들었다') || picked.includes('파란 하늘'), 'Navigation after an unrelated Markdown edit used a stale source: ' + picked);
	revisionHost.hidden = true; editorHost.hidden = true; pagedHost.hidden = true;
	toolbarHost.style.order = '-1'; preview.style.display = 'flex'; preview.style.flexDirection = 'column';
	globalThis.commentsGoalPreview = { preview, toolbar, panel, revision, service, paged, cm };
	// Opt-in visual preview of the REVIEW cards and charts with sample data (used by WM_COMMENTS_SHOT + WM_REVIEW_SHOT).
	globalThis.renderReviewChartsPreview = () => {
		const views = [2500, 1900, 1600, 1450, 1380, 1300, 1250, 1180, 1120, 1060, 990, 940, 900, 860, 820, 790, 760, 812, 700, 660, 640, 610, 590, 560, 540, 520, 500, 470, 420, 300];
		const chapters = views.map((count, index) => ({ id: index + 1, num: index + 1, title: `${index + 1}화`, views: count, likes: Math.round(count / 40 + (index % 3) * 4), comments: (index * 7) % 5, free: index < 25, createdAt: '' }));
		const shell = preview.createDiv({ cls: 'wm-cal-content' }), root = shell.createDiv({ cls: 'wm-revision-root wm-rv-root wm-rv-preview' }); root.style.width = '340px';
		const stack = root.createDiv({ cls: 'wm-rv-stack' });
		const head = title => { const h = stack.createDiv({ cls: 'wm-analysis-card-header wm-dash-group-hdr' }); h.createSpan({ cls: 'wm-dash-group-marker' }); h.createSpan({ cls: 'wm-dash-group-label', text: title }); return h; };
		const grid = (cells, title) => {
			const header = title ? head(title) : null;
			const outer = stack.createDiv({ cls: `wm-rv-grid is-${cells.length}` }), inner = outer.createDiv({ cls: 'wm-rv-grid-inner' });
			for (const [label, value, delta] of cells) {
				const cell = inner.createDiv({ cls: 'wm-rv-cell' });
				if (!delta) { cell.createDiv({ cls: 'wm-rv-cell-label', text: label }); cell.createDiv({ cls: 'wm-rv-cell-value', text: value }); continue; }
				if (delta[2]) {
					// 24-hour change: "직전 화" lead and a large signed number, no icon.
					const tone = delta[0] < 0 ? 'is-down' : delta[0] > 0 ? 'is-up' : 'is-flat';
					cell.createDiv({ cls: 'wm-rv-cell-label', text: label }); cell.createDiv({ cls: 'wm-rv-cell-value', text: value });
					const line = cell.createDiv({ cls: `wm-rv-cell-delta is-lead ${tone}` }); line.createSpan({ cls: 'wm-rv-cell-delta-lead', text: delta[2] }); line.createSpan({ cls: 'wm-rv-cell-delta-num', text: delta[1] });
					continue;
				}
				const tone = delta[0] < 0 ? 'is-down' : delta[0] > 0 ? 'is-up' : 'is-flat', body = cell.createDiv({ cls: 'wm-rv-cell-body' }), text = body.createDiv({ cls: 'wm-rv-cell-text' });
				text.createDiv({ cls: 'wm-rv-cell-label', text: label }); text.createDiv({ cls: 'wm-rv-cell-value', text: value }); text.createDiv({ cls: `wm-rv-cell-delta ${tone}`, text: delta[1] });
				if (tone === 'is-flat') continue;
				// Same markup Obsidian's setIcon renders for Lucide trending-up / trending-down.
				const lucide = delta[0] < 0 ? '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>' : '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>';
				body.createSpan({ cls: `wm-rv-cell-trend ${tone}` }).innerHTML = `<svg class="svg-icon" viewBox="1 6 22 12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${lucide}</svg>`;
			}
			return header;
		};
		const h = head('작품 정보'); h.createSpan({ cls: 'wm-rv-info', text: 'ⓘ' });
		const meta = stack.createDiv({ cls: 'wm-rv-meta' });
		for (const [key, tags] of [['회차', ['15화']], ['장르', ['현대 판타지', '헌터물', '회귀물']], ['등장', ['백지후', '백정문', '백종은', '한도은', '백중권', '백진하']], ['키워드', ['길드 운영', '철혈', '가문의 비전서', '극원 천무혈']]]) { meta.createDiv({ cls: 'wm-rv-meta-key', text: key }); const v = meta.createDiv({ cls: 'wm-rv-meta-value' }); for (const t of tags) v.createSpan({ cls: 'wm-rv-tag', text: t }); }
		meta.createDiv({ cls: 'wm-rv-meta-key', text: '줄거리' });
		meta.createDiv({ cls: 'wm-rv-meta-value wm-rv-story-text', text: '백종은과 한도은의 응원을 받은 뒤 증조부 백유천의 비전서를 극원 천무혈로 개방한다. 길드 운영은 철혈 노선으로 굳어진다.' });
		grid([['선호작', '1,284'], ['조회수', '239'], ['추천', '10'], ['댓글', '1']], '누적 지표');
		stack.createDiv({ cls: 'wm-rv-stamp', text: '2026.11.18 15:42 집계' });
		grid([['선호작', '12', [3, '+3', '직전 화']], ['조회수', '2,839', [-230, '−230', '직전 화']], ['추천', '10', [0, '±0', '직전 화']], ['댓글', '1', [-2, '−2', '직전 화']]], '24시간 지표');
		const retentionHead = grid([['직전 화 대비', '99%', [-1, '평균 하락폭보다 3.3%']], ['4화 대비', '84%', [-1, '직전 화보다 1.0%']]], '연독률');
		// Same markup as the panel's free/paid segment (the REVISION 단어/어절/어미 switch).
		const seg = retentionHead.createDiv({ cls: 'wm-rv-actions' }).createDiv({ cls: 'wm-segmented-control wm-analysis-segment', attr: { role: 'group' } });
		const thumb = seg.createSpan({ cls: 'wm-segmented-thumb is-still' });
		for (const [key, text] of [['free', '무료'], ['paid', '유료']]) { const b = seg.createEl('button', { text, attr: { type: 'button', 'aria-pressed': String(key === 'free') } }); if (key === 'free') requestAnimationFrame(() => thumb.setCssStyles({ width: `${b.offsetWidth}px`, height: `${b.offsetHeight}px`, transform: `translate(${b.offsetLeft}px, ${b.offsetTop}px)` })); }
		renderChapterChart(stack, chapters.filter(chapter => chapter.free), 18, 4, chapter => chapter.num === 18 ? 12 : null);
		// A long run (120화) scrolls sideways and opens on the current chapter.
		renderChapterChart(stack, Array.from({ length: 120 }, (_, index) => ({ id: index + 1, num: index + 1, title: `${index + 1}화`, views: Math.round(900 * Math.pow(0.985, index) + (index % 4) * 6), likes: 5, comments: 1, free: index < 30, createdAt: '' })), 100, 4);
		grid([['긍정', '12개'], ['혼합', '3개'], ['부정', '2개']], '댓글 반응');
		stack.createDiv({ cls: 'wm-rv-stamp', text: '2026.11.18 15:40 집계' });
		renderThemes(stack, [{ label: '주인공 매력', count: 9, tone: 'positive' }, { label: '전개 속도', count: 3, tone: 'mixed' }, { label: '설정 개연성', count: 2, tone: 'negative' }, { label: '기타', count: 3, tone: 'positive' }]);
		const box = stack.createDiv({ cls: 'wm-rv-judgment' }); box.createDiv({ cls: 'wm-rv-judgment-head', text: '◎ DEUS' });
		box.createDiv({ cls: 'wm-rv-judgment-text', text: '주인공의 결단 장면이 가장 잘 먹히고 있습니다. 설정 개연성 지적 중 지하철역 등장은 원고상 근거가 약해 타당한 편이고, 전개 속도 불만은 취향 차이로 보입니다.' });
		const thread = stack.createDiv({ cls: 'wm-rv-thread' });
		for (const [nick, time, text] of [['수달왕자', '11시간전', '벙커처럼 지은 거 알게된 사람들은 다 어떻게 될지 궁금하네요'], ['파프리나', '2026.11.17 14:26', '잘 보고 갑니다']]) {
			const r = thread.createDiv({ cls: 'wm-rv-reply' }), m = r.createDiv({ cls: 'wm-rv-reply-meta' });
			m.createSpan({ cls: 'wm-rv-reply-nick', text: nick }); m.createSpan({ cls: 'wm-rv-reply-dot', text: '·' }); m.createSpan({ cls: 'wm-rv-reply-time', text: time });
			r.createDiv({ cls: 'wm-rv-reply-text', text });
			const a = r.createDiv({ cls: 'wm-rv-reply-actions' }); a.createSpan({ cls: 'wm-rv-reaction', text: '👍 2' }); a.createSpan({ cls: 'wm-rv-reaction', text: '👎 0' });
		}
		const c = thread.createDiv({ cls: 'wm-rv-reply' }), cm = c.createDiv({ cls: 'wm-rv-reply-meta' });
		cm.createSpan({ cls: 'wm-rv-reply-nick', text: '기작경장' }); cm.createSpan({ cls: 'wm-rv-reply-dot', text: '·' }); cm.createSpan({ cls: 'wm-rv-reply-time', text: '2026.11.16 08:17' }); cm.createSpan({ cls: 'wm-rv-verdict is-unfounded', text: '근거 없음' });
		c.createDiv({ cls: 'wm-rv-reply-text', text: '회장 딸이 지하철역에 등장하는 설정이 어색하다는 지적' });
		c.createDiv({ cls: 'wm-rv-reply-reason', text: '원고에서 등장 이유가 설명되지 않아 개연성 지적은 타당합니다.' });
		const ca = c.createDiv({ cls: 'wm-rv-reply-actions' }); ca.createSpan({ cls: 'wm-rv-reaction', text: '👍 2' }); ca.createSpan({ cls: 'wm-rv-reaction', text: '👎 1' });
		return true;
	};
	globalThis.setCommentsGoalTheme = dark => { document.body.toggleClass('theme-dark', dark); document.body.toggleClass('theme-light', !dark); };
	return { ok: true, suite: 'copy / goal / highlight comments UI', themes: 2, nativeUndo: ['CM6', 'paged'] };
}
