import { App, Modal, Editor, EditorPosition, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { DictEntry } from './types';
import { callStdictSearch, callStdictAutocomplete, callStdictView } from './api';
import { normalizeQuery, getWordAtCursor } from './utils';

export class DictionaryModal extends Modal {
	private plugin: WritingMenuPlugin;
	private editor: Editor | null;
	private from: EditorPosition | null;
	private to: EditorPosition | null;

	private searchQuery: string;
	private entries: DictEntry[] = [];
	private selectedIdx = 0;
	private viewCache = new Map<string, string[]>();
	private acCache = new Map<string, DictEntry[]>();

	private leftColEl!: HTMLElement;
	private rightColEl!: HTMLElement;
	private applyBtnEl!: HTMLButtonElement;
	private bracketBtnEl!: HTMLElement;
	private searchInputEl!: HTMLInputElement;
	private searchBoxEl!: HTMLElement;
	private dropdownEl!: HTMLElement;
	private dropdownNavIdx = -1;

	constructor(app: App, plugin: WritingMenuPlugin, editor: Editor | null, word: string, from: EditorPosition | null, to: EditorPosition | null) {
		super(app);
		this.plugin = plugin;
		this.editor = editor;
		this.from = from;
		this.to = to;
		this.searchQuery = word;
	}

	async onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('wm-dict-modal');
		modalEl.addClass('wm-dict-modal-container');

		// ── 헤더 ───────────────────────────────────────────────────

		const header = contentEl.createDiv({ cls: 'wm-dict-header' });

		const searchContainer = header.createDiv({ cls: 'wm-dict-search-container' });
		const searchBox = searchContainer.createDiv({ cls: 'wm-dict-search-box' });
		this.searchBoxEl = searchBox;

		const inputRow = searchBox.createDiv({ cls: 'wm-dict-search-input-row' });

		const searchInput = inputRow.createEl('input', { cls: 'wm-dict-search' });
		searchInput.type = 'text';
		searchInput.value = this.searchQuery;
		searchInput.placeholder = '검색어 입력 후 엔터';
		this.searchInputEl = searchInput;

		const searchIconEl = inputRow.createDiv({ cls: 'wm-dict-search-icon' });
		setIcon(searchIconEl, 'search');

		this.dropdownEl = searchContainer.createDiv({ cls: 'wm-dict-dropdown' });
		this.dropdownEl.setCssStyles({ display: 'none' });

		// ── 검색바 이벤트 ──────────────────────────────────────────

		let debounceTimer: number | null = null;
		let acPaused = false;

		searchInput.addEventListener('focus', () => {
			if (!searchInput.value.trim()) this.showRecentDropdown();
		});

		searchInput.addEventListener('keydown', (e: KeyboardEvent) => { void (async () => {
			if (e.key === 'Escape') {
				if (this.dropdownEl.style.display !== 'none') {
					this.hideDropdown();
					e.stopPropagation();
				}
				return;
			}
			if (e.key === 'Enter') {
				e.stopPropagation();
				if (this.dropdownEl.style.display !== 'none' && this.dropdownNavIdx >= 0) {
					this.selectDropdownItem();
					return;
				}
				const q = searchInput.value.trim();
				if (q) {
					acPaused = true;
					if (debounceTimer) { window.clearTimeout(debounceTimer); debounceTimer = null; }
					this.hideDropdown();
					this.searchQuery = q;
					await this.saveRecentSearch(q);
					await this.doSearch();
				}
			}
		})(); });

		searchInput.addEventListener('input', () => {
			acPaused = false;
			if (debounceTimer) window.clearTimeout(debounceTimer);
			const q = searchInput.value.trim();
			if (!q) { this.showRecentDropdown(); return; }
			if (!this.plugin.settings.stdictApiKey) { this.hideDropdown(); return; }
			debounceTimer = window.setTimeout(() => { void (async () => {
				if (acPaused) return;
				const current = searchInput.value.trim();
				if (!current) return;
				let results = this.acCache.get(current);
				if (!results) {
					results = await callStdictAutocomplete(current, this.plugin.settings.stdictApiKey);
					this.acCache.set(current, results);
				}
				if (acPaused || searchInput.value.trim() !== current) return;
				this.showAcDropdown(results, current);
			})(); }, 150);
		});

		searchInput.addEventListener('blur', () => {
			window.setTimeout(() => this.hideDropdown(), 160);
		});

		// ── 바디 ──────────────────────────────────────────────────

		const body = contentEl.createDiv({ cls: 'wm-dict-body' });
		this.leftColEl = body.createDiv({ cls: 'wm-dict-left' });
		this.rightColEl = body.createDiv({ cls: 'wm-dict-right' });

		// ── 푸터 ──────────────────────────────────────────────────

		const footer = contentEl.createDiv({ cls: 'wm-dict-footer' });
		const footerLeft = footer.createDiv({ cls: 'wm-dict-footer-left' });

		const applyBtn = footerLeft.createEl('button', { cls: 'wm-dict-apply-btn', text: '한자 변환' });
		applyBtn.addEventListener('click', () => this.apply());
		this.applyBtnEl = applyBtn;

		const bracketBtn = footerLeft.createEl('button', { cls: 'wm-dict-bracket-btn' });
		const bracketIcon = bracketBtn.createDiv({ cls: 'wm-dict-bracket-icon' });
		setIcon(bracketIcon, 'square-check-big');
		bracketBtn.createEl('span', { text: '괄호 병기' });
		if (this.plugin.settings.hanjaBracketMode) bracketBtn.addClass('is-checked');
		bracketBtn.addEventListener('click', () => { void (async () => {
			this.plugin.settings.hanjaBracketMode = !this.plugin.settings.hanjaBracketMode;
			await this.plugin.saveSettings();
			bracketBtn.toggleClass('is-checked', this.plugin.settings.hanjaBracketMode);
		})(); });
		this.bracketBtnEl = bracketBtn;

		footer.createEl('button', { cls: 'wm-dict-footer-btn', text: '닫기' })
			.addEventListener('click', () => this.close());

		// ── 키보드 네비게이션 (scope) ─────────────────────────────

		this.scope.register([], 'ArrowDown', (e: KeyboardEvent) => {
			e.preventDefault();
			if (this.dropdownEl.style.display !== 'none') {
				acPaused = true;
				this.navigateDropdown(1);
			} else if (this.selectedIdx < this.entries.length - 1) {
				this.selectedIdx++;
				this.renderLeft();
				this.renderRight();
				this.scrollToSelected();
			}
			return false;
		});

		this.scope.register([], 'ArrowUp', (e: KeyboardEvent) => {
			e.preventDefault();
			if (this.dropdownEl.style.display !== 'none') {
				acPaused = true;
				this.navigateDropdown(-1);
			} else if (this.selectedIdx > 0) {
				this.selectedIdx--;
				this.renderLeft();
				this.renderRight();
				this.scrollToSelected();
			}
			return false;
		});

		this.scope.register(['Alt'], 'Enter', () => {
			this.apply();
			return false;
		});

		await this.doSearch();
		searchInput.focus();
		searchInput.select();
	}

	// ── 드롭다운 — 최근 검색어 ─────────────────────────────────────

	private showRecentDropdown() {
		const recents = this.plugin.settings.recentSearches ?? [];
		this.dropdownEl.empty();
		this.dropdownNavIdx = -1;

		if (recents.length === 0) { this.hideDropdown(); return; }

		recents.slice(0, 10).forEach(word => {
			const item = this.dropdownEl.createDiv({ cls: 'wm-dict-dropdown-item' });
			item.setAttribute('data-word', word);

			item.createEl('span', { cls: 'wm-dict-drop-word', text: word });

			const removeBtn = item.createDiv({ cls: 'wm-dict-drop-remove' });
			setIcon(removeBtn, 'x');
			removeBtn.addEventListener('mousedown', (e: MouseEvent) => { void (async () => {
				e.preventDefault();
				e.stopPropagation();
				await this.removeRecentSearch(word);
			})(); });

			item.addEventListener('mousedown', (e: MouseEvent) => { void (async () => {
				if ((e.target as HTMLElement).closest('.wm-dict-drop-remove')) return;
				e.preventDefault();
				this.searchInputEl.value = word;
				this.searchQuery = word;
				this.hideDropdown();
				await this.saveRecentSearch(word);
				await this.doSearch();
			})(); });
		});

		const clearAll = this.dropdownEl.createDiv({ cls: 'wm-dict-drop-clear-all' });
		clearAll.createEl('span', { text: '최근 검색어 모두 삭제' });
		clearAll.addEventListener('mousedown', (e: MouseEvent) => { void (async () => {
			e.preventDefault();
			this.plugin.settings.recentSearches = [];
			await this.plugin.saveSettings();
			this.hideDropdown();
		})(); });

		this.openDropdown();
	}

	// ── 드롭다운 — 자동완성 ────────────────────────────────────────

	private showAcDropdown(entries: DictEntry[], query: string) {
		this.dropdownEl.empty();
		this.dropdownNavIdx = -1;

		if (entries.length === 0) { this.hideDropdown(); return; }

		const seen = new Set<string>();
		const unique = entries.filter(e => {
			if (seen.has(e.word)) return false;
			seen.add(e.word);
			return true;
		});

		unique.slice(0, 8).forEach(entry => {
			const item = this.dropdownEl.createDiv({ cls: 'wm-dict-dropdown-item' });
			item.setAttribute('data-word', entry.word);

			const wordEl = item.createEl('span', { cls: 'wm-dict-dropdown-word' });
			this.renderHighlight(wordEl, entry.word, query);

			item.addEventListener('mousedown', (e: MouseEvent) => { void (async () => {
				e.preventDefault();
				this.searchInputEl.value = entry.word;
				this.searchQuery = entry.word;
				this.hideDropdown();
				await this.saveRecentSearch(entry.word);
				await this.doSearch();
			})(); });
		});

		this.openDropdown();
	}

	private openDropdown() {
		this.dropdownEl.setCssStyles({ display: 'block' });
		this.searchBoxEl.addClass('is-open');
	}

	private hideDropdown() {
		this.dropdownEl.setCssStyles({ display: 'none' });
		this.dropdownNavIdx = -1;
		this.searchBoxEl?.removeClass('is-open');
	}

	// ── 드롭다운 키보드 네비게이션 ───────────────────────────────────

	private navigateDropdown(dir: 1 | -1) {
		const items = Array.from(this.dropdownEl.querySelectorAll<HTMLElement>('.wm-dict-dropdown-item'));
		if (items.length === 0) return;

		items.forEach(el => el.removeClass('is-focused'));

		const next = this.dropdownNavIdx + dir;
		if (next < 0) { this.dropdownNavIdx = -1; return; }
		this.dropdownNavIdx = Math.min(next, items.length - 1);
		items[this.dropdownNavIdx].addClass('is-focused');
		items[this.dropdownNavIdx].scrollIntoView({ block: 'nearest' });
	}

	private selectDropdownItem() {
		const items = Array.from(this.dropdownEl.querySelectorAll<HTMLElement>('.wm-dict-dropdown-item'));
		const item = items[this.dropdownNavIdx];
		if (!item) return;
		const word = item.getAttribute('data-word');
		if (!word) return;
		this.searchInputEl.value = word;
		this.searchQuery = word;
		this.hideDropdown();
		void this.saveRecentSearch(word).then(() => this.doSearch());
	}

	// ── 최근 검색어 관리 ──────────────────────────────────────────

	private async saveRecentSearch(word: string) {
		if (!word) return;
		const recents = (this.plugin.settings.recentSearches ?? []).filter(w => w !== word);
		recents.unshift(word);
		this.plugin.settings.recentSearches = recents.slice(0, 10);
		await this.plugin.saveSettings();
	}

	private async removeRecentSearch(word: string) {
		this.plugin.settings.recentSearches = (this.plugin.settings.recentSearches ?? []).filter(w => w !== word);
		await this.plugin.saveSettings();
		this.showRecentDropdown();
	}

	// ── 검색 ────────────────────────────────────────────────────────

	private async doSearch() {
		this.entries = [];
		this.selectedIdx = 0;
		this.leftColEl.empty();
		this.rightColEl.empty();
		this.rightColEl.createEl('div', { cls: 'wm-dict-loading', text: '검색 중…' });

		if (this.plugin.settings.stdictApiKey) {
			this.entries = await callStdictSearch(normalizeQuery(this.searchQuery), this.plugin.settings.stdictApiKey);
		}

		this.renderLeft();
		this.renderRight();
	}

	// ── 좌열 ────────────────────────────────────────────────────────

	private renderLeft() {
		this.leftColEl.empty();
		if (this.entries.length === 0) return;

		this.entries.forEach((entry, idx) => {
			const item = this.leftColEl.createDiv({ cls: 'wm-dict-left-item' });
			if (this.selectedIdx === idx) item.addClass('is-active');

			const wordEl = item.createEl('span', { cls: 'wm-dict-left-word', text: entry.word });
			if (entry.supNo > 0) wordEl.createEl('sup', { text: String(entry.supNo) });

			item.addEventListener('click', () => {
				this.selectedIdx = idx;
				this.renderLeft();
				this.renderRight();
			});
		});
	}

	private scrollToSelected() {
		const items = this.leftColEl.querySelectorAll('.wm-dict-left-item');
		const active = items[this.selectedIdx] as HTMLElement | undefined;
		active?.scrollIntoView({ block: 'nearest' });
	}

	// ── 우열 ────────────────────────────────────────────────────────

	private renderRight() {
		this.rightColEl.empty();

		if (this.entries.length === 0) {
			const msg = this.plugin.settings.stdictApiKey
				? '검색 결과가 없습니다.'
				: '설정에서 표준국어대사전 API 키를 입력해 주세요.';
			this.rightColEl.createEl('div', { cls: 'wm-dict-loading', text: msg });
			this.updateFooter(false);
			return;
		}

		const entry = this.entries[this.selectedIdx];
		if (!entry) return;

		const view = this.rightColEl.createDiv({ cls: 'wm-dict-view' });

		if (entry.origin) {
			view.createEl('div', { cls: 'wm-dict-origin-text', text: entry.origin });
		}

		if (entry.pos) {
			const posEl = view.createEl('div', { cls: 'wm-dict-pos-tag', text: `「${entry.pos}」` });
			if (!entry.origin) posEl.addClass('wm-dict-pos-first');
		}

		if (entry.senses.length > 0) {
			const defsEl = view.createDiv({ cls: 'wm-dict-defs' });
			entry.senses.forEach(sense => {
				const senseEl = defsEl.createDiv({ cls: 'wm-dict-sense' });
				if (sense.no) senseEl.createEl('span', { cls: 'wm-dict-sense-no', text: `「${sense.no}」` });
				senseEl.createEl('span', { text: sense.definition });
			});
		}

		const exSection = view.createDiv({ cls: 'wm-dict-examples-section' });
		const divider = exSection.createDiv({ cls: 'wm-dict-examples-divider' });
		divider.createEl('span', { text: '용례' });
		const exList = exSection.createDiv({ cls: 'wm-dict-examples-list' });
		exList.createEl('div', { cls: 'wm-dict-loading-small', text: '로딩 중…' });
		void this.loadExamples(entry, exList);

		this.updateFooter(!!entry.origin);
	}

	private async loadExamples(entry: DictEntry, container: HTMLElement) {
		let examples = this.viewCache.get(entry.targetCode);
		if (!examples) {
			examples = await callStdictView(entry.targetCode, this.plugin.settings.stdictApiKey);
			this.viewCache.set(entry.targetCode, examples);
		}
		if (!container.isConnected) return;
		container.empty();
		if (examples.length === 0) {
			container.createEl('div', { cls: 'wm-dict-example', text: '용례가 없습니다.' });
			return;
		}
		const circled = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
		examples.slice(0, 10).forEach((ex, i) => {
			const exEl = container.createDiv({ cls: 'wm-dict-example' });
			exEl.createEl('span', { cls: 'wm-dict-example-no', text: circled[i] ?? `(${i + 1})` });
			exEl.createEl('span', { text: ' ' });
			this.renderHighlight(exEl, ex, entry.word);
		});
	}

	private renderHighlight(container: HTMLElement, text: string, highlight: string) {
		if (!highlight) { container.createEl('span', { text }); return; }
		const lower = text.toLowerCase();
		const hl = highlight.toLowerCase();
		let cursor = 0;
		let idx = lower.indexOf(hl, cursor);
		if (idx === -1) { container.createEl('span', { text }); return; }
		while (idx !== -1) {
			if (idx > cursor) container.createEl('span', { text: text.slice(cursor, idx) });
			container.createEl('mark', { cls: 'wm-dict-highlight', text: text.slice(idx, idx + highlight.length) });
			cursor = idx + highlight.length;
			idx = lower.indexOf(hl, cursor);
		}
		if (cursor < text.length) container.createEl('span', { text: text.slice(cursor) });
	}

	private updateFooter(hasOrigin: boolean) {
		const canApply = hasOrigin && !!this.editor;
		this.applyBtnEl.disabled = !canApply;
		this.bracketBtnEl.toggleClass('is-disabled', !hasOrigin);
	}

	// ── 적용 ────────────────────────────────────────────────────────

	private apply() {
		const entry = this.entries[this.selectedIdx];
		if (!entry?.origin || !this.editor || !this.from || !this.to) return;
		const cleanWord = normalizeQuery(entry.word);
		const replacement = this.plugin.settings.hanjaBracketMode
			? `${cleanWord}(${entry.origin})`
			: entry.origin;
		this.editor.replaceRange(replacement, this.from, this.to);
		this.close();
	}

	onClose() { this.contentEl.empty(); }
}

export async function openDictionary(plugin: WritingMenuPlugin) {
	const activeEditor = plugin.app.workspace.activeEditor?.editor ?? null;
	let word = '';
	let from: EditorPosition | null = null;
	let to: EditorPosition | null = null;

	if (activeEditor) {
		const wordInfo = getWordAtCursor(activeEditor);
		if (wordInfo) {
			word = wordInfo.text;
			from = wordInfo.from;
			to = wordInfo.to;
		} else {
			from = activeEditor.getCursor();
			to = activeEditor.getCursor();
		}
	}

	new DictionaryModal(plugin.app, plugin, activeEditor, word, from, to).open();
}
