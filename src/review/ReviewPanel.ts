import { Component, Notice, sanitizeHTMLToDom, setIcon, type TFile } from 'obsidian';
import { MUNPIA_SVG } from '../assets/platformLogos';
import { wmT } from '../i18n/index';
import type WritingMenuPlugin from '../../main';
import { getWritingDocument } from '../writing/WritingDocument';
import { episodeNumber, linkTarget, readWorkMetadata, recordDayMetrics, registerWorkMetadata, type WorkField, type WorkMetadata } from './workMetadata';
import { chapterAfterRelease, fetchMunpiaChapters, fetchMunpiaNovel, parseMunpiaDate, parseMunpiaNovelId, preferenceAfterRelease, type MunpiaChapter, type MunpiaNovel } from './munpia';
import { clearChapterSnapshots, finalizeDayMetrics, recordChapters, recordPreference } from './munpiaTracking';
import { chapterNotes, readDayMetrics, type DayValues } from './chapterNotes';
import { MunpiaLoginModal, fetchMunpiaComments, scrapeComments, webviewSupported } from './munpiaWebview';
import { analyzeComments, digestThemes, dropCommentNumbers, loadDigest, maskHarsh, saveDigest, type StoredDigest, type Verdict } from './commentDigest';
import { buildCopyText } from '../export/CopyText';
import { renderChapterChart, renderThemes } from './ReviewCharts';

// Kept across tab switches for this session; comments are never written to disk.
const chapterCache = new Map<string, MunpiaChapter[]>();
const novelCache = new Map<string, MunpiaNovel>();
const storedCache = new Map<string, StoredDigest | null>();
const storedLoading = new Set<string>();
const autoLoaded = new Set<string>();
const fetchedAt = new Map<string, number>();

type Task = 'meta' | 'metrics' | 'comments';
/** A cell's change line; with `lead` it reads "직전 화 +23" (no trend icon). */
interface Delta { value: number; text: string; lead?: string }
const percent = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;

/** REVIEW tab: work metadata, Munpia metrics and retention, softened comment digest. Styled like the REVISION analysis cards. */
export class ReviewPanel extends Component {
	private busy: Task | null = null;
	private errors: Partial<Record<Task, string>> = {};
	private timer = 0;
	private controller: AbortController | null = null;
	private renderedPath = '';
	private retentionTab: 'free' | 'paid' | null = null;

	// Built right away (like RevisionPanel); onload only adds the event subscriptions.
	constructor(private root: HTMLElement, private plugin: WritingMenuPlugin) { super(); root.addClass('wm-revision-root', 'wm-rv-root'); this.render(); }

	onload(): void {
		// Clicking inside this panel activates its own leaf; re-rendering then would swap the button under the
		// pointer (the click is lost) and reset the scroll, so only re-render when the manuscript changed.
		this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => { if ((getWritingDocument(this.plugin)?.path ?? '') !== this.renderedPath) this.schedule(); }));
		this.registerEvent(this.plugin.app.metadataCache.on('changed', file => { if (file.path === getWritingDocument(this.plugin)?.path) this.schedule(); }));
	}
	onunload(): void { window.clearTimeout(this.timer); this.controller?.abort(); }
	private schedule(): void { window.clearTimeout(this.timer); this.timer = window.setTimeout(() => this.render(), 150); }

	private projectKey(file: TFile): string { return this.plugin.projectContext.getProjectForFile(file)?.id ?? 'default'; }
	private novelId(file: TFile): string { return this.plugin.settings.reviewMunpiaNovels?.[this.projectKey(file)] ?? ''; }

	private render(): void {
		const document = getWritingDocument(this.plugin);
		this.renderedPath = document?.path ?? '';
		// Rebuilding empties the panel for a moment; keep the scroll position of whatever scrolls it.
		const scroller = scrollParent(this.root), scrollTop = scroller?.scrollTop ?? 0;
		this.buildView(document);
		if (scroller) scroller.scrollTop = scrollTop;
	}
	private buildView(document: ReturnType<typeof getWritingDocument>): void {
		this.root.empty();
		const toolbar = this.root.createDiv({ cls: 'wm-dashboard-toolbar wm-revision-toolbar' });
		setIcon(toolbar.createSpan({ cls: 'wm-rv-toolbar-icon', attr: { 'aria-hidden': 'true' } }), 'file-text');
		toolbar.createSpan({ cls: 'wm-revision-title', text: document?.file.basename ?? wmT('원고를 열어 주세요.') });
		const actions = toolbar.createDiv({ cls: 'wm-revision-toolbar-actions' });
		const novel = document ? this.novelId(document.file) : '';
		if (novel) this.icon(actions, 'refresh-cw', wmT('문피아 새로고침'), () => void this.loadMunpia(novel));
		this.icon(actions, 'settings', wmT('리뷰 설정'), () => this.plugin.openSettings('review'));
		if (!document) return;
		const episode = episodeNumber(this.plugin, document.file);
		const stack = this.root.createDiv({ cls: 'wm-rv-stack' });
		this.renderMeta(stack, document.file);
		if (novel) {
			if (!chapterCache.has(novel) && !autoLoaded.has(novel) && !this.busy) { autoLoaded.add(novel); window.setTimeout(() => void this.loadMunpia(novel), 0); }
			this.renderMetrics(stack, document.file, novel, episode);
		} else this.renderLink(stack, document.file);
		this.renderComments(stack, document.file, novel, episode);
	}

	// ── building blocks ──────────────────────────────────────────────
	private icon(parent: HTMLElement, icon: string, label: string, action: () => void, disabled = false): HTMLButtonElement {
		const button = parent.createEl('button', { cls: 'clickable-icon wm-cal-icon-btn', attr: { type: 'button', 'aria-label': label } });
		setIcon(button, icon); button.disabled = disabled || this.busy !== null; button.onclick = action; return button;
	}
	private section(parent: HTMLElement, title: string, modifier: string, info?: string): { card: HTMLElement; actions: HTMLElement } {
		const card = parent.createDiv({ cls: `wm-analysis-card wm-dash-char-main wm-rv-section is-${modifier}` });
		const header = card.createDiv({ cls: 'wm-analysis-card-header wm-dash-group-hdr' });
		header.createSpan({ cls: 'wm-dash-group-marker' }); header.createSpan({ cls: 'wm-dash-group-label', text: title });
		if (info) infoIcon(header, info);
		return { card, actions: header.createDiv({ cls: 'wm-rv-actions' }) };
	}
	private status(card: HTMLElement, task: Task, running: string): boolean {
		if (this.busy === task) { card.createDiv({ cls: 'wm-rv-status', text: running }); return true; }
		if (this.errors[task]) card.createDiv({ cls: 'wm-rv-status is-error', text: this.errors[task] });
		return false;
	}
	private async run(task: Task, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
		if (this.busy) return;
		this.busy = task; delete this.errors[task]; this.controller = new AbortController(); this.render();
		try { await work(this.controller.signal); }
		catch (error) { if (!this.controller.signal.aborted) this.errors[task] = error instanceof Error ? error.message : String(error); }
		finally { this.busy = null; this.controller = null; this.render(); }
	}

	// ── 작품 정보 ─────────────────────────────────────────────────────
	private renderMeta(parent: HTMLElement, file: TFile): void {
		const { card, actions } = this.section(parent, wmT('작품 정보'), 'meta');
		const register = () => void this.run('meta', async signal => {
			const document = getWritingDocument(this.plugin);
			if (!document) throw new Error(wmT('원고를 열어 주세요.'));
			await registerWorkMetadata(this.plugin, document, signal);
			new Notice(wmT('프론트매터에 작품 정보를 기록했습니다. 편집기에서 되돌릴 수 있습니다.'));
		});
		const meta = readWorkMetadata(this.plugin, file);
		this.icon(actions, 'bot', wmT('AI로 등록: 원고를 읽고 회차·장르·등장인물·줄거리를 이 노트의 프론트매터에 기록합니다.'), register);
		if (this.status(card, 'meta', wmT('원고를 읽고 정리하는 중…'))) return;
		if (!Object.keys(meta).length) {
			card.createDiv({ cls: 'wm-analysis-empty', text: wmT('아직 등록된 정보가 없습니다. 오른쪽 위 아이콘을 누르면 AI가 원고를 읽고 이 노트의 프론트매터에 기록합니다.') });
			return;
		}
		const list = (value: WorkMetadata[WorkField]): string[] => Array.isArray(value) ? value : value === undefined ? [] : [String(value)];
		const facts = card.createDiv({ cls: 'wm-rv-meta' });
		for (const key of ['회차', '장르', '등장', '키워드'] as const) {
			if (meta[key] === undefined) continue;
			facts.createDiv({ cls: 'wm-rv-meta-key', text: key });
			const cell = facts.createDiv({ cls: 'wm-rv-meta-value' });
			for (const item of list(meta[key])) cell.createSpan({ cls: 'wm-rv-tag', text: key === '회차' ? wmT('{0}화', item) : linkTarget(item) });
		}
		const story = String(meta['요약'] ?? '').trim();
		if (story) {
			facts.createDiv({ cls: 'wm-rv-meta-key', text: wmT('줄거리') });
			facts.createDiv({ cls: 'wm-rv-meta-value wm-rv-story-text', text: story });
		}
	}
	/** Bordered label/value cells; the column count follows the panel width (see CSS). */
	private grid(parent: HTMLElement, cells: Array<{ label: string; value: string; delta?: Delta | null; swatch?: string }>): void {
		const grid = parent.createDiv({ cls: `wm-rv-grid is-${cells.length}` });
		const inner = grid.createDiv({ cls: 'wm-rv-grid-inner' });
		for (const cell of cells) {
			const item = inner.createDiv({ cls: 'wm-rv-cell' });
			// Delta cells are a two-column grid: label/value/delta text, then a large trend icon at the bottom right.
			// A delta with a lead ("직전 화 +23") has no icon: small lead, large signed number.
			const tone = cell.delta ? (cell.delta.value < 0 ? 'is-down' : cell.delta.value > 0 ? 'is-up' : 'is-flat') : '';
			const body = cell.delta && !cell.delta.lead ? item.createDiv({ cls: 'wm-rv-cell-body' }) : null;
			const text = body ? body.createDiv({ cls: 'wm-rv-cell-text' }) : item;
			const label = text.createDiv({ cls: 'wm-rv-cell-label' });
			if (cell.swatch) label.createSpan({ cls: `wm-rv-tone is-${cell.swatch}` });
			label.appendText(cell.label);
			text.createDiv({ cls: 'wm-rv-cell-value', text: cell.value });
			if (!cell.delta) continue;
			if (cell.delta.lead) {
				const line = text.createDiv({ cls: `wm-rv-cell-delta is-lead ${tone}` });
				line.createSpan({ cls: 'wm-rv-cell-delta-lead', text: cell.delta.lead });
				line.createSpan({ cls: 'wm-rv-cell-delta-num', text: cell.delta.text });
				continue;
			}
			text.createDiv({ cls: `wm-rv-cell-delta ${tone}`, text: cell.delta.text });
			if (!body || tone === 'is-flat') continue;
			const trend = body.createSpan({ cls: `wm-rv-cell-trend ${tone}`, attr: { 'aria-hidden': 'true' } });
			setIcon(trend, cell.delta.value < 0 ? 'trending-down' : 'trending-up');
			// Lucide draws the trend in y 7–17 of a 24 box; crop to the drawing so it sits flush with the bottom.
			trend.querySelector('svg')?.setAttribute('viewBox', '1 6 22 12');
		}
	}

	// ── 문피아 ────────────────────────────────────────────────────────
	private renderLink(parent: HTMLElement, file: TFile): void {
		const { card } = this.section(parent, wmT('누적 지표'), 'link');
		card.createDiv({ cls: 'wm-analysis-empty', text: wmT('연재 중인 문피아 작품을 연결하면 회차 지표와 연독률을 보여 줍니다. 프로젝트마다 한 작품씩 연결합니다.') });
		const row = card.createDiv({ cls: 'wm-rv-link-row' });
		const input = row.createEl('input', { type: 'text', attr: { placeholder: wmT('문피아 작품 링크 또는 번호'), 'aria-label': wmT('문피아 작품 링크 또는 번호') } });
		const connect = () => {
			const id = parseMunpiaNovelId(input.value);
			if (!id) { new Notice(wmT('작품 번호를 찾지 못했습니다. 작품 페이지 주소를 붙여넣어 주세요.')); return; }
			this.plugin.settings.reviewMunpiaNovels = { ...this.plugin.settings.reviewMunpiaNovels, [this.projectKey(file)]: id };
			void this.plugin.saveSettings(); void this.loadMunpia(id);
		};
		this.icon(row, 'link', wmT('연결'), connect);
		input.addEventListener('keydown', event => { if (event.key === 'Enter') connect(); });
	}
	private async loadMunpia(novel: string): Promise<void> {
		await this.run('metrics', async () => {
			const [chapters, info] = await Promise.all([fetchMunpiaChapters(novel), fetchMunpiaNovel(novel)]);
			chapterCache.set(novel, chapters); novelCache.set(novel, info); fetchedAt.set(novel, Date.now());
			recordPreference(this.plugin, novel, info.preference);
			recordChapters(this.plugin, novel, chapters);
			await finalizeDayMetrics(this.plugin, novel, chapters);
		});
	}
	private renderMetrics(parent: HTMLElement, file: TFile, novel: string, episode: number | null): void {
		const { card, actions } = this.section(parent, wmT('누적 지표'), 'metrics');
		this.icon(actions, 'unlink', wmT('연결 해제: 이 프로젝트와 문피아 작품의 연결을 끊습니다.'), () => {
			const next = { ...this.plugin.settings.reviewMunpiaNovels }; delete next[this.projectKey(file)];
			this.plugin.settings.reviewMunpiaNovels = next; void this.plugin.saveSettings(); this.render();
		});
		const chapters = chapterCache.get(novel), info = novelCache.get(novel);
		if (this.status(card, 'metrics', wmT('문피아에서 회차 정보를 가져오는 중…')) && !chapters) return;
		if (!chapters) { card.createDiv({ cls: 'wm-analysis-empty', text: wmT('새로고침을 눌러 회차 지표를 가져오세요. 작품 {0}', novel) }); return; }
		const current = episode ? chapters.find(chapter => chapter.num === episode) : undefined;
		if (!current) {
			card.createDiv({ cls: 'wm-analysis-empty', text: episode ? wmT('이 노트의 회차({0}화)를 문피아 회차 목록에서 찾지 못했습니다.', episode) : wmT('이 노트의 회차 번호를 알 수 없습니다. 프론트매터에 회차를 적거나 AI로 등록하세요.') });
			return;
		}
		this.grid(card, [
			...(info?.preference != null ? [{ label: wmT('선호작'), value: info.preference.toLocaleString() }] : []),
			{ label: wmT('조회수'), value: current.views.toLocaleString() },
			{ label: wmT('추천'), value: current.likes.toLocaleString() },
			{ label: wmT('댓글'), value: current.comments.toLocaleString() },
		]);
		const at = fetchedAt.get(novel);
		if (at) card.createDiv({ cls: 'wm-rv-stamp', text: wmT('{0} 집계', formatStamp(at)) });
		this.renderDay(parent, novel, chapters, current, this.projectKey(file));
		this.renderRetention(parent, novel, chapters, current, this.projectKey(file));
	}
	private dayMetrics(novel: string, chapter: MunpiaChapter) {
		const released = parseMunpiaDate(chapter.createdAt);
		return {
			day: chapterAfterRelease(this.plugin.settings.reviewMunpiaChapterSnapshots?.[`${novel}:${chapter.id}`] ?? [], released, chapter),
			preference: preferenceAfterRelease(this.plugin.settings.reviewMunpiaSnapshots?.[novel] ?? [], released),
		};
	}
	/** The first 24 hours after this chapter went up, from recorded snapshots; final values go into the note's frontmatter. */
	/** A chapter's 24-hour figures: its note's frontmatter when written, else the recorded snapshots. */
	private dayValues(novel: string, chapter: MunpiaChapter, notes: Map<number, TFile>): DayValues {
		const note = notes.get(chapter.num), saved = note ? readDayMetrics(this.plugin, note) : {};
		if (saved.views !== undefined) return saved;
		const { day, preference } = this.dayMetrics(novel, chapter);
		return { ...(preference.state !== 'unknown' ? { preference: preference.delta } : {}), ...(day.state !== 'unknown' ? { views: day.views, likes: day.likes, comments: day.comments } : {}) };
	}
	/** 24-hour cells, each with the change against the previous chapter's 24 hours: "직전 화" small, the signed number large, no trend icon. */
	private dayCells(values: DayValues, previous: DayValues): Array<{ label: string; value: string; delta: Delta | null }> {
		const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toLocaleString()}`;
		const cell = (key: keyof DayValues, label: string) => {
			const value = values[key], before = previous[key];
			if (value === undefined) return [];
			return [{ label, value: value.toLocaleString(), delta: before === undefined ? null : { value: value - before, text: signed(value - before), lead: wmT('직전 화') } }];
		};
		return [...cell('preference', wmT('선호작')), ...cell('views', wmT('조회수')), ...cell('likes', wmT('추천')), ...cell('comments', wmT('댓글'))];
	}
	private renderDay(parent: HTMLElement, novel: string, chapters: MunpiaChapter[], current: MunpiaChapter, projectKey: string): void {
		const document = getWritingDocument(this.plugin);
		const isNote = !!document && episodeNumber(this.plugin, document.file) === current.num;
		const saved = isNote ? readDayMetrics(this.plugin, document.file) : {};
		const notes = chapterNotes(this.plugin, projectKey), before = chapters.find(chapter => chapter.num === current.num - 1);
		const previous = before ? this.dayValues(novel, before, notes) : {};
		if (saved.views !== undefined) {
			const { card } = this.section(parent, wmT('24시간 지표'), 'day', wmT('공개 후 24시간 시점의 수치입니다. 이 노트의 프론트매터에 기록된 값입니다. 선호작은 작품 전체에서 늘어난 수입니다.'));
			this.grid(card, this.dayCells(saved, previous));
			return;
		}
		const { day, preference } = this.dayMetrics(novel, current);
		const info = day.state === 'tracking' ? wmT('공개 후 {0}시간째입니다. 24시간이 될 때까지 지금 수치를 보여 줍니다. 선호작은 작품 전체에서 늘어난 수입니다.', day.hours)
			: day.state === 'done' ? wmT('공개 후 24시간 시점의 수치입니다. 선호작은 작품 전체에서 늘어난 수입니다. 이 노트의 프론트매터에도 기록합니다.')
				: this.plugin.settings.reviewMunpiaAutoTrack ? wmT('이 회차는 공개 후 24시간 무렵의 기록이 없습니다.')
					: wmT('공개 후 24시간 수치는 기록이 있어야 계산됩니다. 설정 › 리뷰에서 자동 기록을 켜 주세요.');
		const { card } = this.section(parent, wmT('24시간 지표'), 'day', info);
		const cells = this.dayCells({ ...(preference.state !== 'unknown' ? { preference: preference.delta } : {}), ...(day.state !== 'unknown' ? { views: day.views, likes: day.likes, comments: day.comments } : {}) }, previous);
		if (cells.length) this.grid(card, cells);
		else card.createDiv({ cls: 'wm-analysis-empty', text: wmT('아직 이 회차의 24시간 기록이 없습니다.') });
		// Final figures only (24 hours have passed): into the open chapter note, then the snapshots go.
		if (day.state === 'done' && isNote && document) {
			try {
				recordDayMetrics(this.plugin, document, { views: day.views, likes: day.likes, comments: day.comments, ...(preference.state === 'done' ? { preference: preference.delta } : {}) });
				clearChapterSnapshots(this.plugin, novel, current.id);
			} catch (error) { console.warn('Writing Menu: 24-hour metrics were not written', error); }
		}
	}
	private renderRetention(parent: HTMLElement, novel: string, chapters: MunpiaChapter[], current: MunpiaChapter, projectKey: string): void {
		const { card, actions } = this.section(parent, wmT('연독률'), 'retention');
		const views = (num: number) => chapters.find(chapter => chapter.num === num)?.views ?? 0;
		const ratio = (num: number, base: number) => num !== base && views(base) > 0 && views(num) > 0 ? views(num) / views(base) : null;
		// 4화 is the usual base (the first chapters lose readers fastest); fall back to 1화 before then.
		const base = current.num > 4 && views(4) > 0 ? 4 : 1;
		const previous = ratio(current.num, current.num - 1), fromBase = ratio(current.num, base), earlier = ratio(current.num - 1, base);
		// Average chapter-to-chapter drop up to this chapter, to judge this one against.
		const drops = chapters.filter(chapter => chapter.num > 1 && chapter.num <= current.num).map(chapter => ratio(chapter.num, chapter.num - 1)).filter((value): value is number => value !== null).map(value => 1 - value);
		const averageDrop = drops.length ? drops.reduce((sum, value) => sum + value, 0) / drops.length : null;
		const pct = (value: number) => `${Math.abs(value * 100).toFixed(1)}%`;
		const dropDelta = previous === null || averageDrop === null ? null : (() => {
			const difference = (1 - previous) - averageDrop;
			// Arrow and colour: this chapter lost fewer (up) or more (down) readers than the average.
			return { value: -difference, text: wmT('평균 하락폭보다 {0}', pct(difference)) };
		})();
		const baseDelta = fromBase === null || earlier === null ? null : { value: fromBase / earlier - 1, text: wmT('직전 화보다 {0}', pct(fromBase / earlier - 1)) };
		this.grid(card, [
			{ label: wmT('직전 화 대비'), value: percent(previous), delta: dropDelta },
			{ label: base === 4 ? wmT('4화 대비') : wmT('1화 대비'), value: percent(fromBase), delta: baseDelta },
		]);
		// Free and paid chapters on separate tabs: paid views run far lower, so the paid run gets its own
		// scale with the first paid chapter as its base.
		const firstPaid = chapters.find(chapter => !chapter.free && chapter.num > base);
		const tab = firstPaid ? this.retentionTab ?? (current.free ? 'free' : 'paid') : 'free';
		if (firstPaid) segment(actions, { free: wmT('무료'), paid: wmT('유료') }, tab, wmT('연독률 구간'), value => { this.retentionTab = value as 'free' | 'paid'; this.render(); });
		const shown = tab === 'paid' && firstPaid ? chapters.filter(chapter => !chapter.free) : chapters.filter(chapter => chapter.free);
		// 선호작 (24시간) per chapter: the chapter note's frontmatter, else the live snapshots.
		const notes = chapterNotes(this.plugin, projectKey);
		renderChapterChart(card, shown, current.num, tab === 'paid' && firstPaid ? firstPaid.num : base, chapter => {
			const note = notes.get(chapter.num), saved = note ? readDayMetrics(this.plugin, note).preference : undefined;
			if (saved !== undefined) return saved;
			const { preference } = this.dayMetrics(novel, chapter);
			return preference.state === 'unknown' ? null : preference.delta;
		});
	}

	// ── 댓글 반응 ─────────────────────────────────────────────────────
	private renderComments(parent: HTMLElement, file: TFile, novel: string, episode: number | null): void {
		const { card, actions } = this.section(parent, wmT('댓글 반응'), 'comments');
		if (!webviewSupported()) { card.createDiv({ cls: 'wm-analysis-empty', text: wmT('댓글 정리는 데스크톱 옵시디언에서만 사용할 수 있습니다.') }); return; }
		const chapter = novel && episode ? chapterCache.get(novel)?.find(item => item.num === episode) : undefined;
		const key = chapter ? `${novel}:${chapter.id}` : '';
		if (chapter && !storedCache.has(key) && !storedLoading.has(key)) {
			storedLoading.add(key);
			void loadDigest(this.plugin.app, novel, chapter.id).then(digest => { storedCache.set(key, digest); storedLoading.delete(key); this.render(); });
		}
		const stored = key ? storedCache.get(key) ?? null : null;
		const unread = chapter ? Math.max(0, chapter.comments - (stored?.seen.length ?? 0)) : 0;
		const login = () => new MunpiaLoginModal(this.plugin.app, () => this.render()).open();
		const analyze = () => void this.run('comments', async signal => {
			if (!novel) throw new Error(wmT('먼저 문피아 작품을 연결해 주세요.'));
			if (!episode) throw new Error(wmT('이 노트의 회차 번호를 알 수 없습니다.'));
			const chapters = chapterCache.get(novel) ?? await fetchMunpiaChapters(novel); chapterCache.set(novel, chapters);
			const target = chapters.find(item => item.num === episode);
			if (!target) throw new Error(wmT('이 노트의 회차({0}화)를 문피아 회차 목록에서 찾지 못했습니다.', episode));
			if (target.comments === 0) throw new Error(wmT('이 회차에는 아직 댓글이 없습니다.'));
			const targetKey = `${novel}:${target.id}`;
			// Munpia's comment API first; reading the viewer page is only the fallback.
			// Every run analyzes all comments from scratch, so counts, themes and the judgment always reflect the whole set.
			const fetched = await fetchMunpiaComments(novel, target.id);
			let items = fetched.items;
			if (!items.length && !fetched.loginRequired) {
				const url = this.plugin.settings.reviewMunpiaCommentUrl.replace('{novel}', novel).replace('{chapter}', String(target.id)).replace('{num}', String(target.num));
				items = (await scrapeComments(url, this.plugin.settings.reviewMunpiaCommentSelector)).comments.map(text => ({ id: textId(text), nick: '', text, time: '' }));
			}
			if (!items.length) throw new Error(fetched.loginRequired ? wmT('로그인이 필요한 댓글입니다. 로그인을 먼저 해 주세요.') : wmT('댓글을 찾지 못했습니다. 설정 › 리뷰에서 예비용 주소와 선택자를 확인해 주세요.'));
			const document = getWritingDocument(this.plugin);
			const manuscript = document?.path === file.path ? buildCopyText(document.read(), { includeComments: false, includeHeadings: true, includeFootnotes: false, includeMarkdown: false, includeHtml: false }) : '';
			const { digest, added } = await analyzeComments(this.plugin, items, manuscript, `${file.basename} (${episode}화)`, { version: 1, novel, chapterId: target.id, num: target.num }, null, signal);
			await saveDigest(this.plugin.app, digest); storedCache.set(targetKey, digest);
			new Notice(wmT('댓글 {0}개를 분석했습니다.', added));
		});
		const loginButton = this.icon(actions, 'log-in', wmT('문피아 로그인: 문피아 창에서 직접 로그인합니다. 비밀번호는 저장하지 않습니다.'), login);
		loginButton.empty(); loginButton.addClass('wm-rv-munpia-login'); loginButton.appendChild(sanitizeHTMLToDom(MUNPIA_SVG));
		this.icon(actions, 'bot', wmT('AI 댓글 분석: 이 회차 댓글 전체를 긍정·혼합·부정으로 나누고, 비판은 AI가 원고와 대조합니다. 누를 때마다 처음부터 다시 분석합니다.'), analyze, !novel || !episode);
		if (this.status(card, 'comments', wmT('댓글을 읽고 정리하는 중… 부정 댓글 원문은 화면에 표시하지 않습니다.'))) return;
		if (!stored) {
			card.createDiv({ cls: 'wm-analysis-empty', text: chapter ? wmT('이 회차 댓글 {0}개. 오른쪽 위에서 로그인한 뒤 AI 아이콘을 누르면 정리해 드립니다. 부정 댓글 원문은 보여 주지 않습니다.', chapter.comments) : wmT('오른쪽 위에서 로그인한 뒤 AI 아이콘을 누르면 이 회차 댓글을 정리해 드립니다. 부정 댓글 원문은 보여 주지 않습니다.') });
			return;
		}
		if (unread) card.createDiv({ cls: 'wm-rv-unread' }).createSpan({ cls: 'wm-rv-unread-pill', text: wmT('새 댓글 {0}개', unread) });
		this.grid(card, [
			{ label: wmT('긍정'), value: wmT('{0}개', stored.counts.positive), swatch: 'positive' },
			{ label: wmT('혼합'), value: wmT('{0}개', stored.counts.mixed), swatch: 'mixed' },
			{ label: wmT('부정'), value: wmT('{0}개', stored.counts.negative), swatch: 'negative' },
		]);
		card.createDiv({ cls: 'wm-rv-stamp', text: wmT('{0} 집계', formatStamp(stored.updatedAt)) });
		// Grouped statistics, then the AI's overall judgment of them.
		const themes = digestThemes(stored);
		if (themes.length) renderThemes(card, themes);
		const judgment = stored.overall || stored.summary;
		if (judgment) {
			const box = card.createDiv({ cls: 'wm-rv-judgment' });
			const head = box.createDiv({ cls: 'wm-rv-judgment-head' });
			setIcon(head.createSpan({ cls: 'wm-rv-judgment-icon', attr: { 'aria-hidden': 'true' } }), 'bot'); head.createSpan({ text: 'DEUS' });
			box.createDiv({ cls: 'wm-rv-judgment-text', text: dropCommentNumbers(judgment) });
		}
		this.renderCommentList(card, stored);
	}
	/** Comments laid out like Munpia's own list, newest first. Criticism shows the AI's gist and check instead of the wording; its label sits on the right. */
	private renderCommentList(card: HTMLElement, stored: StoredDigest): void {
		const rows = [
			...stored.positives.map(comment => ({ nick: comment.nick, time: comment.time, likes: comment.likes, dislikes: comment.dislikes, text: maskHarsh(comment.text), critique: null })),
			...stored.critiques.map(critique => ({ nick: critique.nick ?? '', time: critique.time ?? '', likes: critique.likes, dislikes: critique.dislikes, text: dropCommentNumbers(critique.gist), critique })),
		].sort((a, b) => (parseMunpiaDate(b.time) || 0) - (parseMunpiaDate(a.time) || 0));
		if (!rows.length) return;
		const head = card.createDiv({ cls: 'wm-rv-subhead wm-rv-subhead-row' });
		head.createSpan({ text: wmT('댓글 {0}', rows.length) });
		infoIcon(head, wmT('분석한 댓글 {0}개 · 비난만 있는 댓글 {1}개와 무관한 댓글 {2}개는 숨겼습니다. 부정·혼합 댓글은 원문 대신 요지만 저장합니다.', stored.seen.length, stored.counts.insult, stored.counts.offtopic));
		const list = card.createDiv({ cls: 'wm-rv-thread' });
		for (const row of rows) {
			const item = list.createDiv({ cls: `wm-rv-reply${row.critique ? ' is-critique' : ''}` });
			const meta = item.createDiv({ cls: 'wm-rv-reply-meta' });
			meta.createSpan({ cls: 'wm-rv-reply-nick', text: row.nick || wmT('익명') });
			if (row.time) { meta.createSpan({ cls: 'wm-rv-reply-dot', text: '·' }); meta.createSpan({ cls: 'wm-rv-reply-time', text: relativeTime(row.time) }); }
			if (row.critique) meta.createSpan({ cls: `wm-rv-verdict is-${row.critique.verdict}`, text: verdictLabel(row.critique.verdict) });
			item.createDiv({ cls: 'wm-rv-reply-text', text: row.text });
			if (row.critique?.reason) item.createDiv({ cls: 'wm-rv-reply-reason', text: dropCommentNumbers(row.critique.reason) });
			if (row.likes !== undefined || row.dislikes !== undefined) {
				const reactions = item.createDiv({ cls: 'wm-rv-reply-actions' });
				for (const [icon, value, cls] of [['thumbs-up', row.likes ?? 0, 'is-like'], ['thumbs-down', row.dislikes ?? 0, 'is-dislike']] as const) {
					const reaction = reactions.createSpan({ cls: `wm-rv-reaction ${cls}` });
					setIcon(reaction.createSpan({ cls: 'wm-rv-reaction-icon', attr: { 'aria-hidden': 'true' } }), icon); reaction.createSpan({ text: String(value) });
				}
			}
		}
	}
}

function verdictLabel(verdict: Verdict): string {
	return { valid: wmT('타당함'), partly: wmT('일부 타당'), taste: wmT('취향 차이'), misread: wmT('오해'), unfounded: wmT('근거 없음') }[verdict];
}

/** "N분전 / N시간전" within a day, otherwise "YYYY.MM.DD HH:mm" — the way Munpia lists comments. */
function relativeTime(value: string): string {
	const time = parseMunpiaDate(value);
	if (Number.isNaN(time)) return value.slice(0, 16);
	const minutes = Math.floor((Date.now() - time) / 60_000);
	if (minutes >= 0 && minutes < 60) return wmT('{0}분전', Math.max(1, minutes));
	if (minutes >= 0 && minutes < 24 * 60) return wmT('{0}시간전', Math.floor(minutes / 60));
	return formatStamp(time);
}
function formatStamp(time: number): string {
	const date = new Date(time), pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Stable id for comments read from the page (no API id available). */
function textId(text: string): string {
	let hash = 0;
	for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
	return `t${(hash >>> 0).toString(36)}`;
}

/** Nearest ancestor that actually scrolls (the panel itself or a view container). */
function scrollParent(element: HTMLElement): HTMLElement | null {
	for (let node: HTMLElement | null = element; node; node = node.parentElement) {
		if (node.scrollHeight > node.clientHeight && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
	}
	return null;
}

/** The REVISION tab's segmented switch (단어/어절/어미), same markup and styles. */
function segment(parent: HTMLElement, values: Record<string, string>, value: string, label: string, change: (value: string) => void): void {
	const group = parent.createDiv({ cls: 'wm-segmented-control wm-analysis-segment', attr: { role: 'group', 'aria-label': label } });
	const thumb = group.createSpan({ cls: 'wm-segmented-thumb is-still', attr: { 'aria-hidden': 'true' } });
	for (const [key, text] of Object.entries(values)) {
		const button = group.createEl('button', { text, attr: { type: 'button', 'data-value': key, 'aria-pressed': String(key === value) } });
		button.onclick = () => { if (key !== value) change(key); };
		if (key === value) window.requestAnimationFrame(() => thumb.setCssStyles({ width: `${button.offsetWidth}px`, height: `${button.offsetHeight}px`, transform: `translate(${button.offsetLeft}px, ${button.offsetTop}px)` }));
	}
}

/** Info icon whose description shows as Obsidian's own tooltip (re-enabled on the icon; the dashboard cards turn tooltips off). */
function infoIcon(parent: HTMLElement, text: string): void {
	setIcon(parent.createSpan({ cls: 'wm-rv-info', attr: { tabindex: '0', role: 'img', 'aria-label': text } }), 'info');
}
