import { App, Modal, Editor, setIcon, setTooltip } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import charData from './charData.json';

interface CharCategory {
	id: string;
	label: string;
	icon: string;
	chars: string[];
}

type CharEntry = { title: string; aliases: string[] };
const CD = charData as Record<string, CharEntry>;

const CATEGORIES: CharCategory[] = [
	{ id: 'favorites', label: '즐겨찾기',   icon: '★', chars: [] },
	{ id: 'custom',    label: '사용자 지정', icon: '✎', chars: [] },
	{
		id: 'quotes', label: '따옴표', icon: '”', chars: [
			'”', '”', '‘', '’',
			'〝', '〞',
			'«', '»', '‹', '›',
			'„', '‟', '‚', '‛',
		],
	},
	{
		id: 'punctuation', label: '구두점', icon: '·', chars: [
			'·', '・', '…', '‥', '—', '–', '―', '‾',
			'※', '•', '‣', '⁃',
			'、', '。',
			'¡', '¿',
		],
	},
	{
		id: 'brackets', label: '괄호', icon: '〔', chars: [
			'「', '」', '『', '』',
			'【', '】', '《', '》', '〈', '〉',
			'〔', '〕', '〖', '〗', '〘', '〙', '〚', '〛',
			'（', '）', '［', '］', '｛', '｝',
			'⟨', '⟩', '⟦', '⟧',
			'⌈', '⌉', '⌊', '⌋',
		],
	},
	{
		id: 'math', label: '수학 기호', icon: '±', chars: [
			'−', '×', '÷', '≠', '≈', '≡',
			'≤', '≥', '≪', '≫', '±', '∓',
			'∞', '∑', '∏', '√', '∛', '∜',
			'∫', '∬', '∭', '∮', '∂', '∇',
			'∈', '∉', '∋', '∌', '∩', '∪',
			'⊂', '⊃', '⊄', '⊅', '⊆', '⊇',
			'⊕', '⊗', '⊥', '∧', '∨', '¬',
			'∀', '∃', '∄', '∅', '∴', '∵',
			'∝', '∠', '∟', '°', 'π',
		],
	},
	{
		id: 'fractions', label: '분수·지수', icon: '½', chars: [
			'½', '⅓', '⅔', '¼', '¾',
			'⅕', '⅖', '⅗', '⅘',
			'⅙', '⅚', '⅛', '⅜', '⅝', '⅞',
			'¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹', '⁰', 'ⁿ',
			'₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉', '₀',
		],
	},
	{
		id: 'arrows', label: '화살표', icon: '→', chars: [
			'→', '←', '↑', '↓', '↔', '↕',
			'↗', '↘', '↙', '↖',
			'↩', '↪', '↺', '↻',
			'⇒', '⇐', '⇑', '⇓', '⇔', '⇕',
			'⇗', '⇘', '⇙', '⇖',
			'➡', '⬅', '⬆', '⬇',
			'➤', '➜', '➔', '➞', '➢',
			'⟶', '⟵', '⟷', '⟹', '⟸', '⟺',
		],
	},
	{
		id: 'shapes', label: '별·도형', icon: '●', chars: [
			'★', '☆', '✦', '✧', '✩', '✪', '✫', '✬', '✭', '✮', '✯', '✰',
			'●', '○', '◉', '◎', '◆', '◇',
			'■', '□', '▲', '△', '▼', '▽',
			'◀', '▶', '◁', '▷',
			'◐', '◑', '◒', '◓', '◔', '◕',
			'♦', '♣', '♠', '♥', '♤', '♧', '♡', '♢',
			'⬛', '⬜', '⬟', '⬡', '⬢', '⬤',
		],
	},
	{
		id: 'currency', label: '통화', icon: '₩', chars: [
			'₩', '€', '£', '¥', '¢',
			'₽', '₺', '₹', '₦', '₪', '₫',
			'₭', '₮', '₱', '₲', '₳', '₴',
			'₵', '₸', '₼', '₾', '¤',
		],
	},
	{
		id: 'misc', label: '기타 기호', icon: '©', chars: [
			'©', '®', '™', '§', '¶', '†', '‡',
			'‰', '‱', '№', '℃', '℉', 'ℓ',
			'℅', '℗', '℠', '℡', '℮',
			'⁂', '⁎', '⁑', '※',
			'〄', '〒', '〓', '〠',
			'✓', '✔', '✗', '✘', '✕',
			'☑', '☒', '☐',
			'♪', '♫', '♬', '♩', '♭', '♮', '♯',
		],
	},
	{
		id: 'kr-circled', label: '한글(원)', icon: '㉠', chars: [
			'㉠', '㉡', '㉢', '㉣', '㉤', '㉥', '㉦', '㉧', '㉨', '㉩', '㉪', '㉫', '㉬', '㉭',
			'㉮', '㉯', '㉰', '㉱', '㉲', '㉳', '㉴', '㉵', '㉶', '㉷', '㉸', '㉹', '㉺', '㉻',
		],
	},
	{
		id: 'kr-paren', label: '한글(괄호)', icon: '㈎', chars: [
			'㈀', '㈁', '㈂', '㈃', '㈄', '㈅', '㈆', '㈇', '㈈', '㈉', '㈊', '㈋', '㈌', '㈍',
			'㈎', '㈏', '㈐', '㈑', '㈒', '㈓', '㈔', '㈕', '㈖', '㈗', '㈘', '㈙', '㈚', '㈛', '㈜',
		],
	},
	{
		id: 'alpha-circled', label: '영어(원)', icon: 'Ⓐ', chars: [
			'Ⓐ', 'Ⓑ', 'Ⓒ', 'Ⓓ', 'Ⓔ', 'Ⓕ', 'Ⓖ', 'Ⓗ', 'Ⓘ', 'Ⓙ', 'Ⓚ', 'Ⓛ', 'Ⓜ',
			'Ⓝ', 'Ⓞ', 'Ⓟ', 'Ⓠ', 'Ⓡ', 'Ⓢ', 'Ⓣ', 'Ⓤ', 'Ⓥ', 'Ⓦ', 'Ⓧ', 'Ⓨ', 'Ⓩ',
			'ⓐ', 'ⓑ', 'ⓒ', 'ⓓ', 'ⓔ', 'ⓕ', 'ⓖ', 'ⓗ', 'ⓘ', 'ⓙ', 'ⓚ', 'ⓛ', 'ⓜ',
			'ⓝ', 'ⓞ', 'ⓟ', 'ⓠ', 'ⓡ', 'ⓢ', 'ⓣ', 'ⓤ', 'ⓥ', 'ⓦ', 'ⓧ', 'ⓨ', 'ⓩ',
		],
	},
	{
		id: 'alpha-paren', label: '영어(괄호)', icon: '⒜', chars: [
			'⒜', '⒝', '⒞', '⒟', '⒠', '⒡', '⒢', '⒣', '⒤', '⒥', '⒦', '⒧', '⒨',
			'⒩', '⒪', '⒫', '⒬', '⒭', '⒮', '⒯', '⒰', '⒱', '⒲', '⒳', '⒴', '⒵',
		],
	},
	{
		id: 'num-circled', label: '숫자(원)', icon: '①', chars: [
			'①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
			'⑪', '⑫', '⑬', '⑭', '⑮',
		],
	},
	{
		id: 'num-paren', label: '숫자(괄호)', icon: '⑴', chars: [
			'⑴', '⑵', '⑶', '⑷', '⑸', '⑹', '⑺', '⑻', '⑼', '⑽',
			'⑾', '⑿', '⒀', '⒁', '⒂', '⒃', '⒄', '⒅', '⒆', '⒇',
		],
	},
	{
		id: 'roman', label: '숫자(로마)', icon: 'Ⅰ', chars: [
			'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ',
			'ⅰ', 'ⅱ', 'ⅲ', 'ⅳ', 'ⅴ', 'ⅵ', 'ⅶ', 'ⅷ', 'ⅸ', 'ⅹ', 'ⅺ', 'ⅻ',
		],
	},
	{
		id: 'num-dot', label: '숫자(온점)', icon: '⒈', chars: [
			'⒈', '⒉', '⒊', '⒋', '⒌', '⒍', '⒎', '⒏', '⒐', '⒑',
			'⒒', '⒓', '⒔', '⒕', '⒖', '⒗', '⒘', '⒙', '⒚', '⒛',
		],
	},
	{
		id: 'greek', label: '문자(그리스)', icon: 'α', chars: [
			'α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ',
			'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π',
			'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω',
			'Α', 'Β', 'Γ', 'Δ', 'Ε', 'Ζ', 'Η', 'Θ',
			'Ι', 'Κ', 'Λ', 'Μ', 'Ν', 'Ξ', 'Ο', 'Π',
			'Ρ', 'Σ', 'Τ', 'Υ', 'Φ', 'Χ', 'Ψ', 'Ω',
		],
	},
	{
		id: 'latin', label: '문자(라틴 확장)', icon: 'à', chars: [
			'à', 'á', 'â', 'ã', 'ä', 'å', 'æ', 'ç',
			'è', 'é', 'ê', 'ë', 'ì', 'í', 'î', 'ï',
			'ð', 'ñ', 'ò', 'ó', 'ô', 'õ', 'ö', 'ø',
			'ù', 'ú', 'û', 'ü', 'ý', 'þ', 'ÿ', 'ß',
			'À', 'Á', 'Â', 'Ã', 'Ä', 'Å', 'Æ', 'Ç',
			'È', 'É', 'Ê', 'Ë', 'Ì', 'Í', 'Î', 'Ï',
			'Ð', 'Ñ', 'Ò', 'Ó', 'Ô', 'Õ', 'Ö', 'Ø',
			'Ù', 'Ú', 'Û', 'Ü', 'Ý', 'Þ',
		],
	},
];

export class SpecialCharsModal extends Modal {
	private plugin: WritingMenuPlugin;
	private editor: Editor | null;

	private activeCategoryId = 'favorites';
	private searchQuery = '';
	private focusZone: 'cat' | 'grid' = 'cat';
	private catFocusIdx = 0;
	private gridFocusIdx = 0;

	private catListEl!: HTMLElement;
	private gridEl!: HTMLElement;
	private searchInputEl!: HTMLInputElement;
	private addPopupEl!: HTMLElement;
	private addWrapEl!: HTMLElement;
	private addCharInputEl!: HTMLInputElement;
	private addPopupVisible = false;

	private renderedChars: string[] = [];
	private boundKeyDown: (e: KeyboardEvent) => void;
	private boundClickOutside: (e: MouseEvent) => void;

	constructor(app: App, plugin: WritingMenuPlugin, editor: Editor | null) {
		super(app);
		this.plugin = plugin;
		this.editor = editor;
		this.boundKeyDown = this.handleKeyDown.bind(this);
		this.boundClickOutside = this.handleClickOutside.bind(this);
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('wm-sc-modal');
		modalEl.addClass('wm-sc-modal-container');

		// 즐겨찾기 로드
		const favCat = CATEGORIES.find(c => c.id === 'favorites')!;
		favCat.chars = [...(this.plugin.settings.specialCharFavorites ?? [])];

		// 사용자 지정 로드 + CD에 설명 주입
		const customCat = CATEGORIES.find(c => c.id === 'custom')!;
		const customs = this.plugin.settings.specialCharCustom ?? [];
		customCat.chars = customs.map(c => c.char);
		for (const c of customs) {
			if (c.desc) CD[c.char] = { title: c.desc, aliases: [c.desc] };
		}

		// 초기 카테고리
		if (favCat.chars.length > 0) {
			this.activeCategoryId = 'favorites';
		} else if (customCat.chars.length > 0) {
			this.activeCategoryId = 'custom';
		} else {
			this.activeCategoryId = 'punctuation';
		}

		this.buildHeader(contentEl);
		this.buildBody(contentEl);

		this.catFocusIdx = CATEGORIES.findIndex(c => c.id === this.activeCategoryId);
		if (this.catFocusIdx < 0) this.catFocusIdx = 0;

		modalEl.addEventListener('keydown', this.boundKeyDown);
		modalEl.addEventListener('mousedown', this.boundClickOutside);

		window.requestAnimationFrame(() => {
			this.searchInputEl.focus();
			this.applyCatFocus();
		});
	}

	onClose() {
		this.modalEl.removeEventListener('keydown', this.boundKeyDown);
		this.modalEl.removeEventListener('mousedown', this.boundClickOutside);
		this.contentEl.empty();
	}

	// ── 헤더 (full-width: 타이틀 + 추가버튼 + 검색창) ────────────────

	private buildHeader(container: HTMLElement) {
		const header = container.createDiv({ cls: 'wm-sc-header' });
		header.createDiv({ cls: 'wm-sc-title', text: '특수문자' });

		// 사용자 지정 추가 버튼 (타이틀 바로 다음)
		this.buildAddButton(header);

		// 검색창
		const searchWrap = header.createDiv({ cls: 'wm-sc-search-wrap' });
		const searchIcon = searchWrap.createDiv({ cls: 'wm-sc-search-icon' });
		setIcon(searchIcon, 'search');
		const input = searchWrap.createEl('input', {
			cls: 'wm-sc-search',
			attr: { placeholder: '검색… (예: 화살표, 별, 체크)', type: 'text' },
		});
		this.searchInputEl = input;
		input.addEventListener('input', () => {
			this.searchQuery = input.value;
			this.renderGrid();
		});
	}

	// ── 사용자 지정 추가 버튼 + 팝오버 ──────────────────────────────

	private buildAddButton(container: HTMLElement) {
		const wrap = container.createDiv({ cls: 'wm-sc-add-wrap' });
		this.addWrapEl = wrap;

		const btn = wrap.createDiv({ cls: 'wm-sc-add-btn' });
		setIcon(btn, 'plus');
		setTooltip(btn, '사용자 지정 특수문자 추가');

		const popup = wrap.createDiv({ cls: 'wm-sc-add-popup is-hidden' });
		this.addPopupEl = popup;

		// 문자 입력
		const charRow = popup.createDiv({ cls: 'wm-sc-add-row' });
		const charInput = charRow.createEl('input', {
			attr: { type: 'text', placeholder: '특수문자', maxlength: '4' },
		});
		this.addCharInputEl = charInput;

		// 이름/설명 입력
		const descRow = popup.createDiv({ cls: 'wm-sc-add-row' });
		const descInput = descRow.createEl('input', {
			attr: { type: 'text', placeholder: '이름 또는 설명' },
		});

		// 추가 버튼
		const submitBtn = popup.createEl('button', { cls: 'wm-sc-add-submit', text: '추가' });

		const doAdd = () => {
			const char = charInput.value.trim();
			const desc = descInput.value.trim();
			if (!char) { charInput.focus(); return; }
			const customs = this.plugin.settings.specialCharCustom ?? [];
			if (!customs.some(c => c.char === char)) {
				customs.push({ char, desc });
				this.plugin.settings.specialCharCustom = customs;
				this.plugin.saveSettings().catch(() => {});
				if (desc) CD[char] = { title: desc, aliases: [desc] };
				const customCat = CATEGORIES.find(c => c.id === 'custom')!;
				customCat.chars = customs.map(c => c.char);
			}
			charInput.value = '';
			descInput.value = '';
			this.hideAddPopup();
			this.activeCategoryId = 'custom';
			this.catFocusIdx = CATEGORIES.findIndex(c => c.id === 'custom');
			this.renderCatList();
			this.renderGrid();
			this.searchInputEl.focus();
		};

		submitBtn.addEventListener('click', doAdd);
		descInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
		charInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') descInput.focus(); });

		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (this.addPopupVisible) {
				this.hideAddPopup();
			} else {
				this.showAddPopup();
			}
		});
	}

	private showAddPopup() {
		this.addPopupEl.removeClass('is-hidden');
		this.addPopupVisible = true;
		this.addCharInputEl.focus();
	}

	private hideAddPopup() {
		this.addPopupEl.addClass('is-hidden');
		this.addPopupVisible = false;
	}

	private handleClickOutside(e: MouseEvent) {
		if (this.addPopupVisible && !this.addWrapEl.contains(e.target as Node)) {
			this.hideAddPopup();
		}
	}

	// ── 바디 (카테고리 좌 + 그리드 우) ──────────────────────────────

	private buildBody(container: HTMLElement) {
		const body = container.createDiv({ cls: 'wm-sc-body' });

		const catList = body.createDiv({ cls: 'wm-sc-cat-list' });
		catList.tabIndex = -1;
		this.catListEl = catList;
		this.renderCatList();

		const gridWrap = body.createDiv({ cls: 'wm-sc-grid-wrap' });
		const grid = gridWrap.createDiv({ cls: 'wm-sc-grid' });
		grid.tabIndex = -1;
		this.gridEl = grid;
		this.renderGrid();
	}

	// ── 카테고리 목록 ─────────────────────────────────────────────────

	private renderCatList() {
		this.catListEl.empty();
		for (const cat of CATEGORIES) {
			const isEmpty = (cat.id === 'favorites' || cat.id === 'custom') && cat.chars.length === 0;
			const isActive = cat.id === this.activeCategoryId;

			const item = this.catListEl.createDiv({
				cls: `wm-sc-cat-item${isActive ? ' is-active' : ''}${isEmpty ? ' is-empty' : ''}`,
			});
			item.createSpan({ cls: 'wm-sc-cat-icon', text: cat.icon });
			item.createSpan({ cls: 'wm-sc-cat-label', text: cat.label });

			item.addEventListener('click', () => {
				this.activeCategoryId = cat.id;
				this.searchQuery = '';
				this.searchInputEl.value = '';
				this.catFocusIdx = CATEGORIES.indexOf(cat);
				this.focusZone = 'cat';
				this.searchInputEl.focus();
				this.renderCatList();
				this.renderGrid();
			});
		}
		this.applyCatFocus();
	}

	// ── 그리드 ───────────────────────────────────────────────────────

	private renderGrid() {
		this.gridEl.empty();
		this.gridEl.removeClass('is-empty');
		this.renderedChars = this.getFilteredChars();
		const favs = new Set(this.plugin.settings.specialCharFavorites ?? []);

		if (this.renderedChars.length === 0) {
			this.gridEl.addClass('is-empty');
			this.gridEl.createDiv({ cls: 'wm-sc-grid-empty' }).createSpan({ text: '결과 없음' });
			return;
		}

		for (let i = 0; i < this.renderedChars.length; i++) {
			const ch = this.renderedChars[i];
			const cell = this.gridEl.createDiv({ cls: 'wm-sc-cell' });
			cell.dataset.idx = String(i);
			cell.createSpan({ cls: 'wm-sc-cell-char', text: ch });

			const entry = CD[ch];
			if (entry?.title) setTooltip(cell, entry.title, { delay: 0 });

			const starBtn = cell.createDiv({ cls: `wm-sc-cell-star${favs.has(ch) ? ' is-fav' : ''}` });
			setIcon(starBtn, 'star');

			starBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.toggleFavorite(ch);
				this.renderGrid();
				this.renderCatList();
			});

			cell.addEventListener('click', () => this.insert(ch));

			cell.addEventListener('mouseenter', () => {
				this.gridFocusIdx = i;
				this.applyGridFocus();
			});
		}
		this.gridFocusIdx = 0;
		if (this.focusZone === 'grid') this.applyGridFocus();
	}

	private getFilteredChars(): string[] {
		const q = this.searchQuery.trim();
		if (!q) {
			const cat = CATEGORIES.find(c => c.id === this.activeCategoryId);
			return cat ? [...cat.chars] : [];
		}
		const ql = q.toLowerCase();
		const seen = new Set<string>();
		const results: string[] = [];
		for (const cat of CATEGORIES) {
			if (cat.id === 'favorites') continue;
			for (const ch of cat.chars) {
				if (seen.has(ch)) continue;
				seen.add(ch);
				const entry = CD[ch];
				const titleMatch = entry?.title?.toLowerCase().includes(ql) ?? false;
				const aliasMatch = (entry?.aliases ?? []).some(t => t.toLowerCase().includes(ql));
				if (ch.includes(q) || titleMatch || aliasMatch) results.push(ch);
			}
		}
		return results;
	}

	// ── 즐겨찾기 ─────────────────────────────────────────────────────

	private toggleFavorite(ch: string) {
		const favs = this.plugin.settings.specialCharFavorites ?? [];
		const idx = favs.indexOf(ch);
		if (idx >= 0) {
			favs.splice(idx, 1);
		} else {
			favs.unshift(ch);
		}
		this.plugin.settings.specialCharFavorites = favs;
		this.plugin.saveSettings().catch(() => {});
		const favCat = CATEGORIES.find(c => c.id === 'favorites')!;
		favCat.chars = [...favs];
	}

	// ── 삽입 ─────────────────────────────────────────────────────────

	private insert(ch: string) {
		if (this.editor) {
			this.editor.replaceSelection(ch);
		} else {
			this.app.workspace.activeEditor?.editor?.replaceSelection(ch);
		}
		if (this.plugin.settings.specialCharCloseOnInsert ?? true) {
			this.close();
		}
	}

	// ── 키보드 내비게이션 ─────────────────────────────────────────────

	private handleKeyDown(e: KeyboardEvent) {
		const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'];
		if (!navKeys.includes(e.key)) return;

		if (this.addPopupVisible) {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this.hideAddPopup();
				this.searchInputEl.focus();
			}
			return;
		}

		e.preventDefault();
		e.stopPropagation();

		if (this.focusZone === 'cat') {
			switch (e.key) {
				case 'ArrowUp':
					this.catFocusIdx = Math.max(0, this.catFocusIdx - 1);
					this.selectCatByIdx(this.catFocusIdx);
					break;
				case 'ArrowDown':
					this.catFocusIdx = Math.min(CATEGORIES.length - 1, this.catFocusIdx + 1);
					this.selectCatByIdx(this.catFocusIdx);
					break;
				case 'ArrowRight':
				case 'Enter':
					if (this.renderedChars.length > 0) {
						this.focusZone = 'grid';
						this.gridFocusIdx = 0;
						this.applyGridFocus();
					}
					break;
				case 'Escape':
					this.close();
					break;
			}
		} else {
			const cols = this.getGridCols();
			switch (e.key) {
				case 'ArrowRight':
					this.gridFocusIdx = Math.min(this.renderedChars.length - 1, this.gridFocusIdx + 1);
					this.applyGridFocus();
					break;
				case 'ArrowLeft': {
					const col = this.gridFocusIdx % cols;
					if (col === 0) {
						this.focusZone = 'cat';
						this.applyCatFocus();
					} else {
						this.gridFocusIdx--;
						this.applyGridFocus();
					}
					break;
				}
				case 'ArrowDown':
					this.gridFocusIdx = Math.min(this.renderedChars.length - 1, this.gridFocusIdx + cols);
					this.applyGridFocus();
					break;
				case 'ArrowUp':
					if (this.gridFocusIdx < cols) {
						this.focusZone = 'cat';
						this.applyCatFocus();
					} else {
						this.gridFocusIdx = Math.max(0, this.gridFocusIdx - cols);
						this.applyGridFocus();
					}
					break;
				case 'Enter':
					if (this.renderedChars[this.gridFocusIdx]) {
						this.insert(this.renderedChars[this.gridFocusIdx]);
					}
					break;
				case 'Escape':
					this.close();
					break;
			}
		}
	}

	private getGridCols(): number {
		const computed = window.getComputedStyle(this.gridEl).gridTemplateColumns;
		if (!computed || computed === 'none') return 6;
		return computed.trim().split(/\s+/).length;
	}

	private selectCatByIdx(idx: number) {
		const cat = CATEGORIES[idx];
		if (!cat) return;
		this.activeCategoryId = cat.id;
		this.searchQuery = '';
		this.searchInputEl.value = '';
		this.renderCatList();
		this.renderGrid();
	}

	private applyCatFocus() {
		this.catListEl.querySelectorAll<HTMLElement>('.wm-sc-cat-item').forEach((el, i) => {
			el.toggleClass('is-focused', i === this.catFocusIdx);
			if (i === this.catFocusIdx) el.scrollIntoView({ block: 'nearest' });
		});
	}

	private applyGridFocus() {
		this.gridEl.querySelectorAll<HTMLElement>('.wm-sc-cell').forEach((el, i) => {
			el.toggleClass('is-focused', i === this.gridFocusIdx);
			if (i === this.gridFocusIdx) el.scrollIntoView({ block: 'nearest' });
		});
	}
}

export function openSpecialChars(plugin: WritingMenuPlugin): void {
	const editor = plugin.app.workspace.activeEditor?.editor ?? null;
	new SpecialCharsModal(plugin.app, plugin, editor).open();
}
