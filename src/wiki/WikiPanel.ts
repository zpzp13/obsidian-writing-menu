import { Component, MarkdownRenderer, Notice, TFile, TFolder, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { getToneColor } from './WikiTypes';
import { FolderOrNoteSuggestModal, ImageSuggestModal } from './WikiModals';


export class WikiPanel {
	plugin: WritingMenuPlugin;
	private hostComponent: Component;
	currentFile: TFile | null = null;
	targetFolder: TFolder | null = null;
	private stripMode: 'folder' | 'relation' = 'folder';
	private relationSource: TFile | null = null;
	private renderSeq = 0;
	private container: HTMLElement | null = null;
	private eventsRegistered = false;
	private rerenderTimer = 0;
	private stripScrollLeft = -1;
	private collapsedRelGroups = new Set<string>();
	private stripCollapsed = false;
	private tocCollapsed = false;

	constructor(plugin: WritingMenuPlugin, hostComponent: Component) {
		this.plugin = plugin;
		this.hostComponent = hostComponent;

		if (plugin.settings.wikiLastFolderPath) {
			const f = plugin.app.vault.getAbstractFileByPath(plugin.settings.wikiLastFolderPath);
			if (f instanceof TFolder) this.targetFolder = f;
		}
		if (plugin.settings.wikiLastFilePath) {
			const f = plugin.app.vault.getAbstractFileByPath(plugin.settings.wikiLastFilePath);
			if (f instanceof TFile) this.currentFile = f;
		}
	}

	private get app() { return this.plugin.app; }

	async saveState() {
		this.plugin.settings.wikiLastFilePath = this.currentFile?.path || '';
		this.plugin.settings.wikiLastFolderPath = this.targetFolder?.path || '';
		await this.plugin.saveSettings();
	}

	rerender() {
		if (this.container) this.render(this.container);
	}

	private scheduleRerender() {
		clearTimeout(this.rerenderTimer);
		this.rerenderTimer = window.setTimeout(() => this.rerender(), 350);
	}

	private registerEvents() {
		if (this.eventsRegistered) return;
		this.eventsRegistered = true;
		this.hostComponent.registerEvent(
			this.app.metadataCache.on('changed', () => this.scheduleRerender())
		);
		this.hostComponent.registerEvent(
			this.app.vault.on('create', () => this.scheduleRerender())
		);
		this.hostComponent.registerEvent(
			this.app.vault.on('delete', () => this.scheduleRerender())
		);
		this.hostComponent.registerEvent(
			this.app.vault.on('rename', () => this.scheduleRerender())
		);
	}

	private getFolderFiles(): TFile[] {
		if (!this.targetFolder) return [];
		const fp = this.targetFolder.path;
		return this.app.vault.getMarkdownFiles()
			.filter(f => this.plugin.settings.wikiIncludeSubfolders
				? f.path.startsWith(fp + '/') || f.parent?.path === fp
				: f.parent?.path === fp)
			.filter(f => f.name !== '_wiki.md')
			.sort((a, b) => a.basename.localeCompare(b.basename, 'ko', { sensitivity: 'base', numeric: true }));
	}

	private getImgSrc(file: TFile): string {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const val = String(fm?.[this.plugin.settings.wikiImageFieldName] || '');
		if (!val) return '';
		if (val.startsWith('[[') && val.endsWith(']]')) {
			const linked = this.app.metadataCache.getFirstLinkpathDest(val.slice(2, -2), file.path);
			return linked ? this.app.vault.getResourcePath(linked) : '';
		}
		const plain = this.app.vault.getAbstractFileByPath(val);
		if (plain instanceof TFile) return this.app.vault.getResourcePath(plain);
		return val;
	}

	private getDisplayName(file: TFile): string {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return String(fm?.[this.plugin.settings.wikiNameFieldName] || file.basename);
	}

	// ── 메인 렌더 ──────────────────────────────────────────────────────────

	async render(outerContainer: HTMLElement) {
		this.registerEvents();
		this.renderSeq++;
		const mySeq = this.renderSeq;
		this.container = outerContainer;
		outerContainer.empty();

		let wikiColor = this.plugin.settings.wikiColor || '#7025db';
		if (this.currentFile) {
			const cfm = this.app.metadataCache.getFileCache(this.currentFile)?.frontmatter;
			if (cfm?.['wikiColor']) wikiColor = cfm['wikiColor'];
		}
		outerContainer.style.setProperty('--wiki-accent-color', wikiColor);
		outerContainer.style.setProperty('--wiki-accent-text', getToneColor(wikiColor));
		outerContainer.style.setProperty('--wiki-profile-header-size', `${this.plugin.settings.wikiProfileHeaderSize ?? 18}px`);
		outerContainer.style.setProperty('--wiki-profile-key-size', `${this.plugin.settings.wikiProfileKeySize ?? 13}px`);
		this.renderToolbar(outerContainer);
		this.renderCardStrip(outerContainer);

		if (!this.targetFolder || this.renderSeq !== mySeq) return;

		if (this.currentFile) {
			const scrollArea = outerContainer.createDiv({ cls: 'wiki-scroll-area' });

			const infoRow = scrollArea.createDiv({ cls: 'wiki-info-row' });
			await this.createTOC(infoRow, scrollArea, this.currentFile);
			if (this.renderSeq !== mySeq) return;

			await this.createProfilePanel(infoRow, this.currentFile);
			if (this.renderSeq !== mySeq) return;

			const body = scrollArea.createDiv({ cls: 'obsiwiki-rendered-body' });
			await MarkdownRenderer.render(
				this.app,
				await this.app.vault.read(this.currentFile),
				body,
				this.currentFile.path,
				this.hostComponent,
			);

			body.addEventListener('click', (e) => {
				const link = (e.target as HTMLElement).closest('a.internal-link, a[data-href]') as HTMLElement | null;
				if (!link || !this.currentFile) return;
				e.preventDefault();
				e.stopPropagation();
				const href = link.getAttribute('data-href') || link.getAttribute('href');
				if (href) this.app.workspace.openLinkText(href, this.currentFile.path, true);
			}, true);

			const headers = body.querySelectorAll('h1, h2, h3, h4, h5, h6');
			let counters = [0, 0, 0, 0, 0, 0];
			headers.forEach((header) => {
				const level = parseInt(header.tagName.charAt(1));
				counters[level - 1]++;
				for (let i = level; i < 6; i++) counters[i] = 0;
				const numStr = counters.slice(0, level).join('.') + '.';
				const numSpan = createSpan({ cls: 'wiki-header-number', text: numStr });
				numSpan.addEventListener('click', (e) => {
					e.stopPropagation();
					const tocNums = scrollArea.querySelectorAll('.wiki-toc-number');
					for (const tocNum of Array.from(tocNums)) {
						if (tocNum.textContent === numStr) {
							const tocItem = tocNum.closest('.wiki-toc-item') as HTMLElement;
							if (tocItem) {
								this.scrollToElement(tocItem, scrollArea, 40);
							}
							break;
						}
					}
				});
				header.prepend(numSpan);
			});

			this.setupFootnotes(body, scrollArea);

			// ── 플로팅 네비게이션 버튼 (outerContainer 기준 absolute) ──
			const navBtns = outerContainer.createDiv({ cls: 'wiki-nav-buttons' });

			const topBtn = navBtns.createDiv({ cls: 'wiki-nav-btn', attr: { 'aria-label': '최상단으로' } });
			setIcon(topBtn, 'chevrons-up');
			topBtn.onclick = () => scrollArea.scrollTo({ top: 0, behavior: 'smooth' });

			const tocBtn = navBtns.createDiv({ cls: 'wiki-nav-btn', attr: { 'aria-label': '목차로' } });
			setIcon(tocBtn, 'list');
			tocBtn.onclick = () => {
				const toc = scrollArea.querySelector('.wiki-toc-container') as HTMLElement | null;
				if (toc) toc.scrollIntoView({ behavior: 'smooth', block: 'start' });
				else scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
			};

			const bottomBtn = navBtns.createDiv({ cls: 'wiki-nav-btn', attr: { 'aria-label': '최하단으로' } });
			setIcon(bottomBtn, 'chevrons-down');
			bottomBtn.onclick = () => scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'smooth' });
		}
	}

	// ── A. 툴바 ────────────────────────────────────────────────────────────

	private renderToolbar(outerContainer: HTMLElement) {
		const bar = outerContainer.createDiv({ cls: 'wiki-toolbar' });

		// 카드 목록 접기/펼치기 (맨 좌측)
		const collapseBtn = bar.createDiv({
			cls: 'wm-cal-icon-btn wiki-strip-collapse-btn',
			attr: { 'aria-label': this.stripCollapsed ? '카드 목록 펼치기' : '카드 목록 접기' },
		});
		setIcon(collapseBtn, this.stripCollapsed ? 'chevron-right' : 'chevron-down');
		collapseBtn.onclick = () => {
			this.stripCollapsed = !this.stripCollapsed;
			setIcon(collapseBtn, this.stripCollapsed ? 'chevron-right' : 'chevron-down');
			collapseBtn.setAttribute('aria-label', this.stripCollapsed ? '카드 목록 펼치기' : '카드 목록 접기');
			const stripEl = outerContainer.querySelector('.wiki-card-strip-wrap, .wiki-rel-list-wrap') as HTMLElement | null;
			if (stripEl) stripEl.classList.toggle('is-collapsed', this.stripCollapsed);
		};

		// 경로 영역 (경로 텍스트, 클릭 시 picker)
		const left = bar.createDiv({ cls: 'wiki-toolbar-left' });
		const bcPath = (this.stripMode === 'relation' && this.relationSource)
			? this.relationSource.path.replace(/\.md$/, '')
			: this.targetFolder?.path;
		const pathSpan = left.createSpan({ cls: 'wiki-bc-path' });
		if (bcPath) {
			bcPath.split('/').forEach((part, i) => {
				if (i > 0) pathSpan.createSpan({ cls: 'wiki-bc-sep', text: ' / ' });
				pathSpan.createSpan({ cls: 'wiki-bc-seg', text: part });
			});
		} else {
			pathSpan.createSpan({ cls: 'wiki-bc-placeholder', text: '폴더·노트 선택...' });
		}
		left.addEventListener('click', () => {
			new FolderOrNoteSuggestModal(this.app, (item) => {
				if (item instanceof TFolder) {
					this.targetFolder = item;
					this.currentFile = null;
					this.stripMode = 'folder';
				} else {
					this.currentFile = item;
					this.targetFolder = item.parent ?? this.targetFolder;
					this.relationSource = item;
					this.stripMode = 'relation';
				}
				this.saveState();
				this.rerender();
			}).open();
		});

		// 중간 spacer
		bar.createDiv({ cls: 'wiki-toolbar-spacer' });

		// 액션 버튼 (우측)
		const right = bar.createDiv({ cls: 'wiki-toolbar-right' });

		// 관계 보기 토글
		const relBtn = right.createDiv({
			cls: 'wm-cal-icon-btn' + (!this.currentFile ? ' wiki-btn-disabled' : '') + (this.stripMode === 'relation' ? ' is-active' : ''),
			attr: { 'aria-label': '관계 노트 목록 보기' },
		});
		setIcon(relBtn, 'list-tree');
		relBtn.onclick = () => {
			if (!this.currentFile) return;
			if (this.stripMode === 'relation') {
				this.stripMode = 'folder';
			} else {
				this.relationSource = this.currentFile;
				this.stripMode = 'relation';
			}
			this.rerender();
		};

		// 컬러 팔레트
		const paletteBtn = right.createDiv({
			cls: 'wm-cal-icon-btn wiki-toolbar-palette' + (!this.currentFile ? ' wiki-btn-disabled' : ''),
			attr: { 'aria-label': '위키 색상 변경' },
		});
		setIcon(paletteBtn, 'palette');
		if (this.currentFile) {
			const cf = this.currentFile;
			const curColor = String(this.app.metadataCache.getFileCache(cf)?.frontmatter?.['wikiColor']
				|| this.plugin.settings.wikiColor || '#7025db');
			const colorInp = paletteBtn.createEl('input', {
				attr: { type: 'color', value: curColor },
				cls: 'wiki-toolbar-palette-input',
			});
			colorInp.onclick = (e) => e.stopPropagation();
			colorInp.onchange = async () => {
				await this.app.fileManager.processFrontMatter(cf, f => { f['wikiColor'] = colorInp.value; });
				this.rerender();
			};
		}

		// 새 탭에서 열기
		const tabBtn = right.createDiv({ cls: 'wm-cal-icon-btn' + (!this.currentFile ? ' wiki-btn-disabled' : ''), attr: { 'aria-label': '새 탭에서 열기' } });
		setIcon(tabBtn, 'external-link');
		tabBtn.onclick = () => { if (this.currentFile) this.app.workspace.getLeaf('tab').openFile(this.currentFile); };

		// 위키 설정 (맨 우측)
		const settingsBtn = right.createDiv({ cls: 'wm-cal-icon-btn', attr: { 'aria-label': '위키 설정' } });
		setIcon(settingsBtn, 'settings');
		settingsBtn.onclick = () => {
			(this.app as any).setting?.open();
			(this.app as any).setting?.openTabById(this.plugin.manifest.id);
			setTimeout(() => { this.plugin.settingTab?.renderPage('wiki'); }, 60);
		};
	}

	// ── B. 카드 스트립 ─────────────────────────────────────────────────────

	private renderCardStrip(outerContainer: HTMLElement) {
		if (this.stripMode === 'relation' && this.relationSource) {
			this.renderRelationStrip(outerContainer);
			return;
		}

		if (!this.targetFolder) {
			const empty = outerContainer.createDiv({ cls: 'wiki-empty-state' });
			setIcon(empty.createDiv({ cls: 'wiki-empty-icon' }), 'book-open');
			empty.createDiv({ cls: 'wiki-empty-text', text: '폴더를 선택하세요' });
			empty.createDiv({ cls: 'wiki-empty-sub', text: '툴바의 › 버튼을 클릭하세요.' });
			return;
		}

		const files = this.getFolderFiles();
		if (files.length === 0) {
			const empty = outerContainer.createDiv({ cls: 'wiki-empty-state' });
			empty.createDiv({ cls: 'wiki-empty-text', text: '노트가 없습니다' });
			return;
		}

		const wrap = outerContainer.createDiv({ cls: 'wiki-card-strip-wrap' + (this.stripCollapsed ? ' is-collapsed' : '') });
		const strip = wrap.createDiv({ cls: 'wiki-card-strip' });
		const allCards: HTMLElement[] = [];

		files.forEach(f => {
			const isSelected = this.currentFile?.path === f.path;
			const card = this.buildCard(f, isSelected);
			strip.appendChild(card);
			allCards.push(card);
		});

		// 현재 선택 카드 인덱스 (preview 상태 추적)
		let previewedIdx = files.findIndex(f => f.path === this.currentFile?.path);
		if (previewedIdx < 0) previewedIdx = 0;

		// 시각 선택 갱신 + wiki color 즉시 반영 (rerender 없음)
		const previewSelect = (idx: number) => {
			allCards.forEach((c, i) => c.classList.toggle('is-selected', i === idx));
			previewedIdx = idx;
			if (idx >= 0 && idx < files.length) {
				const fm = this.app.metadataCache.getFileCache(files[idx])?.frontmatter;
				const wc = String(fm?.['wikiColor'] || this.plugin.settings.wikiColor || '#7025db');
				outerContainer.style.setProperty('--wiki-accent-color', wc);
				outerContainer.style.setProperty('--wiki-accent-text', getToneColor(wc));
			}
		};
		// 선택 확정 (rerender) — stripScrollLeft는 caller가 설정
		const commit = (idx: number) => {
			if (idx < 0 || idx >= files.length) return;
			if (files[idx].path === this.currentFile?.path) return;
			this.currentFile = files[idx];
			this.targetFolder = files[idx].parent ?? this.targetFolder;
			this.saveState();
			this.rerender();
		};
		// 스크롤 기준 중앙 카드 탐지
		const centerIdx = (): number => {
			const centerPos = strip.scrollLeft + strip.clientWidth / 2;
			const sr = strip.getBoundingClientRect();
			let bestIdx = 0, bestDist = Infinity;
			allCards.forEach((c, i) => {
				const cr = c.getBoundingClientRect();
				const cardCenter = strip.scrollLeft + (cr.left - sr.left) + cr.width / 2;
				const dist = Math.abs(cardCenter - centerPos);
				if (dist < bestDist) { bestDist = dist; bestIdx = i; }
			});
			return bestIdx;
		};

		// rAF: 스크롤 위치 복원 (renderSeq 게이트, stripScrollLeft 리셋 없음)
		const mySeq = this.renderSeq;
		let syncEnabled = false;
		let debounceTimer = 0;
		requestAnimationFrame(() => {
			if (this.renderSeq !== mySeq) return; // stale, skip
			if (this.stripScrollLeft >= 0) {
				strip.scrollLeft = this.stripScrollLeft;
				// -1 리셋 생략: 후속 rerender에서도 같은 위치 복원 가능
			}
			requestAnimationFrame(() => { syncEnabled = true; });
		});

		// 스크롤 → 위치 추적 + 시각 선택 + debounce commit (profile/body 업데이트)
		strip.addEventListener('scroll', () => {
			if (!syncEnabled) return;
			this.stripScrollLeft = strip.scrollLeft; // 항상 최신 위치 추적
			const idx = centerIdx();
			previewSelect(idx);
			clearTimeout(debounceTimer);
			debounceTimer = window.setTimeout(() => commit(idx), 300);
		}, { passive: true });

		// native image drag 차단
		strip.addEventListener('dragstart', e => e.preventDefault());

		// 드래그 스크롤 + 클릭 선택
		strip.addEventListener('mousedown', e => {
			e.preventDefault();
			const startX = e.pageX, startScrollLeft = strip.scrollLeft;
			let hasMoved = false;

			const onMove = (me: MouseEvent) => {
				const dx = me.pageX - startX;
				if (!hasMoved && Math.abs(dx) > 4) { hasMoved = true; strip.style.cursor = 'grabbing'; }
				if (hasMoved) strip.scrollLeft = startScrollLeft - dx;
			};

			const onUp = (ue: MouseEvent) => {
				strip.style.cursor = '';
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				clearTimeout(debounceTimer);
				if (hasMoved) {
					// 드래그 종료: scroll listener가 이미 stripScrollLeft 최신화
					commit(previewedIdx);
				} else {
					// 클릭: 현재 스크롤 위치 저장 후 commit
					this.stripScrollLeft = startScrollLeft;
					const t = document.elementFromPoint(ue.clientX, ue.clientY) as HTMLElement | null;
					const clicked = t?.closest('.wiki-card') as HTMLElement | null;
					const idx = clicked ? allCards.indexOf(clicked) : -1;
					if (idx >= 0) { previewSelect(idx); commit(idx); }
				}
			};

			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	}

	/** 단일 카드 DOM 생성 (폴더/관계 strip 공용) */
	private buildCard(f: TFile, isSelected: boolean): HTMLElement {
		const card = createDiv({ cls: 'wiki-card' + (isSelected ? ' is-selected' : '') });
		const name = this.getDisplayName(f);
		const imgSrc = this.getImgSrc(f);
		if (imgSrc) {
			const img = card.createEl('img', { cls: 'wiki-card-img' });
			img.src = imgSrc;
			img.draggable = false;
			img.onerror = () => {
				img.remove();
				card.createDiv({ cls: 'wiki-card-img wiki-card-img-placeholder' })
					.createSpan({ text: name.charAt(0).toUpperCase() });
			};
		} else {
			card.createDiv({ cls: 'wiki-card-img wiki-card-img-placeholder' })
				.createSpan({ text: name.charAt(0).toUpperCase() });
		}
		card.createDiv({ cls: 'wiki-card-name', text: name });
		return card;
	}

	/** 프론트매터 값에서 노트 링크들을 해석 (배열/쉼표문자열/[[..]] 혼합 처리) */
	private resolveLinks(value: unknown, srcPath: string): TFile[] {
		const raw: string[] = Array.isArray(value)
			? value.map(v => String(v))
			: String(value ?? '').split(',');
		const out: TFile[] = [];
		const seen = new Set<string>();
		for (let token of raw) {
			token = token.trim();
			if (!token) continue;
			const m = token.match(/^\[\[(.+?)(\|.*)?\]\]$/);
			const linkpath = m ? m[1] : token;
			const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, srcPath);
			if (dest instanceof TFile && !seen.has(dest.path)) { seen.add(dest.path); out.push(dest); }
		}
		return out;
	}

	// ── B-2. 관계 strip (프론트매터 키별 그룹) ───────────────────────────────

	private renderRelationStrip(outerContainer: HTMLElement) {
		const src = this.relationSource!;
		const fm = this.app.metadataCache.getFileCache(src)?.frontmatter;
		const fields = (this.plugin.settings.wikiRelationFields || '')
			.split(',').map(s => s.trim()).filter(Boolean);

		if (fields.length === 0) {
			const empty = outerContainer.createDiv({ cls: 'wiki-empty-state' });
			empty.createDiv({ cls: 'wiki-empty-text', text: '관계 프론트매터 키가 설정되지 않았습니다' });
			empty.createDiv({ cls: 'wiki-empty-sub', text: '플러그인 설정 → 위키 → 관계 필드에서 지정하세요.' });
			return;
		}

		const groups = fields
			.map(key => ({ key, files: fm ? this.resolveLinks(fm[key], src.path) : [] }))
			.filter(g => g.files.length > 0);

		if (groups.length === 0) {
			const empty = outerContainer.createDiv({ cls: 'wiki-empty-state' });
			empty.createDiv({ cls: 'wiki-empty-text', text: '관계 노트가 없습니다' });
			empty.createDiv({ cls: 'wiki-empty-sub', text: `「${src.basename}」에 ${fields.join(', ')} 값이 없습니다.` });
			return;
		}

		// 리스트 뷰 (프론트매터 키별 접힘/펼침 섹션, 중복 노트는 첫 그룹에만)
		const wrap = outerContainer.createDiv({ cls: 'wiki-rel-list-wrap' + (this.stripCollapsed ? ' is-collapsed' : '') });
		const list = wrap.createDiv({ cls: 'wiki-rel-list' });
		const seen = new Set<string>();

		groups.forEach(g => {
			const uniqueFiles = g.files.filter(f => !seen.has(f.path));
			uniqueFiles.forEach(f => seen.add(f.path));
			if (uniqueFiles.length === 0) return;

			const isCollapsed = this.collapsedRelGroups.has(g.key);
			const section = list.createDiv({ cls: 'wiki-rel-section' });

			// ── 섹션 헤더 (wm-vhv-group-header 스타일) ──
			const hdr = section.createDiv({ cls: 'wiki-rel-section-header' });
			hdr.createSpan({ cls: 'wiki-rel-section-label', text: g.key });
			const chevEl = hdr.createSpan({ cls: 'wiki-rel-section-chevron' });
			setIcon(chevEl, isCollapsed ? 'chevron-right' : 'chevron-down');

			const itemsEl = section.createDiv({ cls: 'wiki-rel-section-items' + (isCollapsed ? ' is-collapsed' : '') });

			hdr.addEventListener('click', () => {
				if (this.collapsedRelGroups.has(g.key)) {
					this.collapsedRelGroups.delete(g.key);
					itemsEl.removeClass('is-collapsed');
					setIcon(chevEl, 'chevron-down');
				} else {
					this.collapsedRelGroups.add(g.key);
					itemsEl.addClass('is-collapsed');
					setIcon(chevEl, 'chevron-right');
				}
			});

			// ── 카드 아이템 (이미지 + 이름 아래) ──
			uniqueFiles.forEach(f => {
				const isSelected = this.currentFile?.path === f.path;
				const item = itemsEl.createDiv({ cls: 'wiki-rel-item' + (isSelected ? ' is-selected' : '') });

				const imgSrc = this.getImgSrc(f);
				if (imgSrc) {
					const imgEl = item.createEl('img', { cls: 'wiki-rel-item-img' });
					imgEl.src = imgSrc;
					imgEl.onerror = () => {
						imgEl.remove();
						const ph = item.createDiv({ cls: 'wiki-rel-item-img-placeholder' });
						ph.createSpan({ text: this.getDisplayName(f).charAt(0).toUpperCase() });
					};
				} else {
					const ph = item.createDiv({ cls: 'wiki-rel-item-img-placeholder' });
					ph.createSpan({ text: this.getDisplayName(f).charAt(0).toUpperCase() });
				}

				item.createDiv({ cls: 'wiki-rel-item-name', text: this.getDisplayName(f) });
				item.onclick = () => {
					this.currentFile = f;
					this.targetFolder = f.parent ?? this.targetFolder;
					this.saveState();
					this.rerender();
				};
			});
		});
	}

	// ── C-1. TOC ────────────────────────────────────────────────────────────

	async createTOC(container: HTMLElement, scrollArea: HTMLElement, file: TFile) {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.headings || cache.headings.length === 0) return;

		const tocContainer = container.createDiv({ cls: 'wiki-toc-container' });
		const titleRow = tocContainer.createDiv({ cls: 'wiki-toc-title-row' });
		titleRow.createSpan({ cls: 'wiki-toc-title', text: '목차' });
		const tocChev = titleRow.createSpan({ cls: 'wiki-toc-chevron' });
		setIcon(tocChev, this.tocCollapsed ? 'chevron-right' : 'chevron-down');
		const list = tocContainer.createDiv({ cls: 'wiki-toc-list' + (this.tocCollapsed ? ' is-collapsed' : '') });
		titleRow.addEventListener('click', () => {
			this.tocCollapsed = !this.tocCollapsed;
			list.classList.toggle('is-collapsed', this.tocCollapsed);
			setIcon(tocChev, this.tocCollapsed ? 'chevron-right' : 'chevron-down');
		});

		let counters = [0, 0, 0, 0, 0, 0];
		cache.headings.forEach(h => {
			if (h.level > 6) return;
			counters[h.level - 1]++;
			for (let i = h.level; i < 6; i++) counters[i] = 0;
			const numStr = counters.slice(0, h.level).join('.') + '.';

			const item = list.createDiv({ cls: 'wiki-toc-item' });
			item.style.paddingLeft = `${(h.level - 1) * 12}px`;
			const numSpan = item.createSpan({ cls: 'wiki-toc-number', text: numStr });
			const textSpan = item.createSpan({ cls: 'wiki-toc-text' });
			MarkdownRenderer.render(this.app, h.heading, textSpan, file.path, this.hostComponent).then(() => {
				textSpan.querySelectorAll('p').forEach(p => { (p as HTMLElement).style.cssText = 'margin:0;display:inline;'; });
			});
			// 번호만 클릭 시 본문으로 이동 (아이템 전체 클릭 제거)
			numSpan.addEventListener('click', (e) => {
				e.stopPropagation();
				const allNums = scrollArea.querySelectorAll('.wiki-header-number');
				for (let i = 0; i < allNums.length; i++) {
					if (allNums[i].textContent === numStr) {
						const target = allNums[i].parentElement;
						if (!target) return;
						this.scrollToElement(target, scrollArea, 8);
						return;
					}
				}
			});
		});
	}

	// ── C-2. 프로필 패널 (컴팩트) ───────────────────────────────────────────

	async createProfilePanel(container: HTMLElement, file: TFile) {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) return;

		const pCon = container.createDiv({ cls: 'wiki-profile-container' });
		const wc = String(fm['wikiColor'] || this.plugin.settings.wikiColor || '#7025db');
		pCon.style.setProperty('--wiki-accent-color', wc);
		pCon.style.setProperty('--wiki-accent-text', getToneColor(wc));

		const displayName = this.getDisplayName(file);

		// 헤더: 이름 + 색상 선택
		const header = pCon.createDiv({ cls: 'wiki-profile-name-header' });
		header.createSpan({ cls: 'wiki-profile-name-text', text: displayName });

		// 이미지 영역 (풀너비)
		const imgSrc = this.getImgSrc(file);
		const imgCon = pCon.createDiv({ cls: 'wiki-profile-image-container' });
		if (imgSrc) {
			const img = imgCon.createEl('img', { cls: 'wiki-profile-image' });
			img.src = imgSrc;
			img.onerror = () => {
				img.remove();
				const ph = imgCon.createDiv({ cls: 'wiki-profile-img-placeholder' });
				ph.createSpan({ text: displayName.charAt(0).toUpperCase() });
				ph.onclick = () => this.openImagePicker(file);
			};
			img.onclick = () => this.openImagePicker(file);
		} else {
			const ph = imgCon.createDiv({ cls: 'wiki-profile-img-placeholder' });
			ph.createSpan({ text: displayName.charAt(0).toUpperCase() });
			ph.onclick = () => this.openImagePicker(file);
		}

		// 속성 (div 기반)
		const props = pCon.createDiv({ cls: 'wiki-props' });
		const timeKeyValues = Object.values(this.plugin.settings.timeKeys || {});
		const excluded = [
			this.plugin.settings.wikiImageFieldName,
			this.plugin.settings.wikiNameFieldName,
			'wikiColor', 'position', 'cssclasses',
			...timeKeyValues,
		];
		const coloredProps = (this.plugin.settings.wikiColoredProperties || '').split(',').map(s => s.trim()).filter(Boolean);

		for (const [k, v] of Object.entries(fm)) {
			if (excluded.includes(k) || (this.plugin.settings.wikiHiddenProperties || []).includes(k)) continue;
			const row = props.createDiv({ cls: 'wiki-prop-row' });
			row.createSpan({ cls: 'wiki-prop-key', text: k });
			const valEl = row.createDiv({ cls: 'wiki-prop-val' });
			if (coloredProps.includes(k)) { valEl.style.color = 'var(--wiki-accent-color)'; valEl.style.fontWeight = 'bold'; }
			await MarkdownRenderer.render(this.app, String(v), valEl, file.path, this.hostComponent);
			valEl.querySelectorAll('a.internal-link').forEach((link: HTMLElement) => {
				link.addEventListener('click', (e) => {
					e.preventDefault();
					const href = link.getAttribute('data-href') || link.getAttribute('href');
					if (href) this.app.workspace.openLinkText(href, file.path, true);
				});
			});
		}
	}

	private openImagePicker(file: TFile) {
		new ImageSuggestModal(this.app, async (f) => {
			const key = this.plugin.settings.wikiImageFieldName;
			if (!key) {
				new Notice('플러그인 설정에서 이미지 필드를 먼저 지정하세요.');
				return;
			}
			try {
				const linktext = this.app.metadataCache.fileToLinktext(f, file.path, false);
				await this.app.fileManager.processFrontMatter(file, fm => { fm[key.trim()] = `[[${linktext}]]`; });
				new Notice(`이미지 업데이트: ${key} = [[${f.name}]]`);
				// DOM 즉시 업데이트 (metadataCache 갱신 전에도 반영)
				const imgSrc = this.app.vault.getResourcePath(f);
				if (this.container) {
					this.container.querySelectorAll<HTMLImageElement>('.wiki-profile-image').forEach(img => { img.src = imgSrc; });
					this.container.querySelectorAll<HTMLImageElement>('.wiki-card.is-selected .wiki-card-img').forEach(img => { img.src = imgSrc; });
				}
			} catch (e) {
				console.error('[wiki] processFrontMatter 실패:', e);
				new Notice('이미지 프론트매터 업데이트 실패. 콘솔을 확인하세요.');
			}
		}).open();
	}

	private findScrollableParent(el: HTMLElement): HTMLElement | null {
		let cur = el.parentElement;
		while (cur) {
			if (cur.scrollHeight > cur.clientHeight + 1) return cur;
			cur = cur.parentElement as HTMLElement | null;
		}
		return null;
	}

	private scrollToElement(target: HTMLElement, _scrollArea: HTMLElement, offset = 8) {
		const scrollable = this.findScrollableParent(target);
		if (!scrollable) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
		const tr = target.getBoundingClientRect();
		const ar = scrollable.getBoundingClientRect();
		scrollable.scrollTo({ top: Math.max(0, scrollable.scrollTop + tr.top - ar.top - offset), behavior: 'smooth' });
	}

	// ── 각주 ────────────────────────────────────────────────────────────────

	private setupFootnotes(body: HTMLElement, scrollArea: HTMLElement) {
		let tooltip: HTMLElement | null = null;

		const scrollTo = (target: Element, offset = 8) => {
			this.scrollToElement(target as HTMLElement, scrollArea, offset);
		};

		body.querySelectorAll('.footnote-ref').forEach((fn) => {
			const link = fn.querySelector('a');
			if (!link) return;
			const fnId = (link.getAttribute('href') || '').replace('#', '');

			fn.addEventListener('mouseenter', () => {
				if (tooltip) tooltip.remove();
				const fnItem = body.querySelector(`.footnotes #${fnId.replace(':', '\\:')}`);
				if (!fnItem) return;
				tooltip = createDiv({ cls: 'wiki-footnote-tooltip' });
				const contentDiv = tooltip.createDiv();
				contentDiv.innerHTML = fnItem.innerHTML;
				contentDiv.querySelector('.footnote-backref')?.remove();
				document.body.appendChild(tooltip);
				tooltip.addClass('visible');
				const rect = (fn as HTMLElement).getBoundingClientRect();
				tooltip.style.left = `${rect.left}px`;
				tooltip.style.top = `${rect.bottom + 10}px`;
			});
			fn.addEventListener('mouseleave', () => { tooltip?.remove(); tooltip = null; });
			link.onclick = (e) => {
				e.preventDefault();
				const target = body.querySelector(`.footnotes #${fnId.replace(':', '\\:')}`);
				if (target) {
					scrollTo(target);
					(target as HTMLElement).addClass('wiki-highlight-flash');
					setTimeout(() => (target as HTMLElement).removeClass('wiki-highlight-flash'), 1000);
				}
			};
		});

		body.querySelectorAll('.footnote-backref').forEach(ref => {
			ref.addEventListener('click', (e) => {
				e.preventDefault();
				const refId = (ref.getAttribute('href') || '').replace('#', '');
				const target = body.querySelector(`#${refId}`) || body.querySelector(`#${refId.replace(/:/g, '\\:')}`);
				if (target) {
					scrollTo(target, 40);
					(target as HTMLElement).addClass('wiki-highlight-flash');
					setTimeout(() => (target as HTMLElement).removeClass('wiki-highlight-flash'), 1000);
				}
			});
		});
	}
}
