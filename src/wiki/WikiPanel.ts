import { Component, MarkdownRenderer, Notice, TFile, TFolder, setIcon, sanitizeHTMLToDom } from 'obsidian';
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
	private stripGen = 0; // render()마다 증가 — commit()은 건드리지 않음
	private container: HTMLElement | null = null;
	private eventsRegistered = false;
	private rerenderTimer = 0;
	private stripScrollLeft = -1;
	private relListScrollTop = 0;
	private transitionActive = false;
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

	openFolderPicker() {
		new FolderOrNoteSuggestModal(this.app, (item) => {
			if (item instanceof TFolder) {
				this.targetFolder = item;
				this.currentFile = null;
				this.stripMode = 'folder';
				this.stripCollapsed = false;
			} else {
				this.currentFile = item;
				this.targetFolder = item.parent ?? this.targetFolder;
				this.relationSource = item;
				this.stripMode = 'relation';
				this.stripCollapsed = this.plugin.settings.wikiStripCollapsedDefault ?? false;
			}
			this.saveState();
			this.rerender();
		}).open();
	}

	private scheduleRerender() {
		window.clearTimeout(this.rerenderTimer);
		this.rerenderTimer = window.window.setTimeout(() => this.rerender(), 350);
	}

	private registerEvents() {
		if (this.eventsRegistered) return;
		this.eventsRegistered = true;
		this.hostComponent.registerEvent(
			this.app.metadataCache.on('changed', (changedFile) => {
				// 현재 폴더 또는 현재 파일에 관련된 변경만 rerender
				const fp = this.targetFolder?.path;
				if (!fp && changedFile.path !== this.currentFile?.path) return;
				if (fp) {
					const inFolder = this.plugin.settings.wikiIncludeSubfolders
						? changedFile.path.startsWith(fp + '/') || changedFile.parent?.path === fp
						: changedFile.parent?.path === fp;
					if (!inFolder && changedFile.path !== this.currentFile?.path) return;
				}
				this.scheduleRerender();
			})
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
		this.transitionActive = false;
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
		this.stripGen++; // strip 세대 증가 — 이전 strip의 stale 콜백 차단용
		this.renderToolbar(outerContainer);
		this.renderCardStrip(outerContainer);

		if (!this.targetFolder || this.renderSeq !== mySeq) return;

		if (this.currentFile) {
			await this.buildScrollArea(outerContainer, mySeq);
		}
	}

	// ── 스크롤 영역(TOC·프로필·본문·네비버튼) 빌드 ─────────────────────────
	// render() 와 commit (카드 선택) 양쪽에서 호출 — 툴바·카드스트립은 건드리지 않음

	private async buildScrollArea(outerContainer: HTMLElement, mySeq: number) {
		if (!this.currentFile) return;
		const file = this.currentFile;

		// 즉시 색상 업데이트
		const fm0 = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const wc0 = String(fm0?.['wikiColor'] || this.plugin.settings.wikiColor || '#7025db');
		outerContainer.style.setProperty('--wiki-accent-color', wc0);
		outerContainer.style.setProperty('--wiki-accent-text', getToneColor(wc0));

		// 기존 scrollArea 즉시 페이드아웃 (콘텐츠 빌드와 병렬 진행 → replaceWith 시 이미 투명)
		const existingScrollAreaOld = outerContainer.querySelector<HTMLElement>('.wiki-scroll-area');
		if (existingScrollAreaOld) {
			existingScrollAreaOld.setCssStyles({ transition: 'opacity 0.12s ease' });
			existingScrollAreaOld.setCssStyles({ opacity: '0' });
		}

		// navBtns 재사용 (fixed 요소, 위치 안정)
		const existingNavBtns = outerContainer.querySelector<HTMLElement>('.wiki-nav-buttons');
		if (existingNavBtns) { existingNavBtns.empty(); }
		const navBtns: HTMLElement = existingNavBtns ?? outerContainer.createDiv({ cls: 'wiki-nav-buttons' });

		// scrollArea를 detached 상태로 빌드 → 완성 후 replaceWith로 단번 교체
		// 빈 상태(깜빡임) 없이 old content → new content 원자적 전환
		const doc = outerContainer.ownerDocument;
		const scrollArea = doc.createElement('div') as HTMLElement;
		scrollArea.className = 'wiki-scroll-area';

		const infoRow = scrollArea.createDiv({ cls: 'wiki-info-row' });
		const body = scrollArea.createDiv({ cls: 'obsiwiki-rendered-body' });

		navBtns.createDiv({ cls: 'wiki-nav-btn', attr: { 'aria-label': '최상단으로' } });
		setIcon(navBtns.lastElementChild as HTMLElement, 'chevrons-up');
		(navBtns.lastElementChild as HTMLElement).onclick = () => scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
		navBtns.createDiv({ cls: 'wiki-nav-btn', attr: { 'aria-label': '목차로' } });
		setIcon(navBtns.lastElementChild as HTMLElement, 'list');
		(navBtns.lastElementChild as HTMLElement).onclick = () => {
			const toc = scrollArea.querySelector('.wiki-toc-container') as HTMLElement | null;
			if (toc) toc.scrollIntoView({ behavior: 'smooth', block: 'start' });
			else scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
		};
		navBtns.createDiv({ cls: 'wiki-nav-btn', attr: { 'aria-label': '최하단으로' } });
		setIcon(navBtns.lastElementChild as HTMLElement, 'chevrons-down');
		(navBtns.lastElementChild as HTMLElement).onclick = () => scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'smooth' });

		// transitionActive 해제: DOM 변화 없으므로 즉시 해제해도 spurious scroll 없음
		window.setTimeout(() => { if (this.renderSeq === mySeq) this.transitionActive = false; }, 50);

		// TOC + 프로필 병렬 빌드 (detached 상태에서)
		await Promise.all([
			this.createTOC(infoRow, scrollArea, file),
			this.createProfilePanel(infoRow, file),
		]);
		if (this.renderSeq !== mySeq) return;

		// 본문 빌드 (detached 상태에서)
		const fileContent = await this.app.vault.read(file);
		if (this.renderSeq !== mySeq) return;

		await MarkdownRenderer.render(this.app, fileContent, body, file.path, this.hostComponent);
		if (this.renderSeq !== mySeq) return;

		// 완성된 콘텐츠를 단번에 DOM에 반영 — 잔상/깜빡임 방지
		const existingScrollArea = outerContainer.querySelector<HTMLElement>('.wiki-scroll-area');
		if (existingScrollArea) {
			existingScrollArea.replaceWith(scrollArea);
		} else {
			outerContainer.insertBefore(scrollArea, navBtns);
		}

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
						if (tocItem) this.scrollToElement(tocItem, scrollArea, 40);
						break;
					}
				}
			});
			header.prepend(numSpan);
		});

		this.setupFootnotes(body, scrollArea);
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
			window.setTimeout(() => { this.plugin.settingTab?.renderPage('wiki'); }, 60);
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

		// 시각 선택 갱신 + 패널 색상 업데이트
		const previewSelect = (idx: number) => {
			allCards.forEach((c, i) => c.classList.toggle('is-selected', i === idx));
			if (idx >= 0 && idx < files.length) {
				const fm = this.app.metadataCache.getFileCache(files[idx])?.frontmatter;
				const wc = String(fm?.['wikiColor'] || this.plugin.settings.wikiColor || '#7025db');
				outerContainer.style.setProperty('--wiki-accent-color', wc);
				outerContainer.style.setProperty('--wiki-accent-text', getToneColor(wc));
			}
		};
		// 선택 확정 — scroll area만 교체, 툴바·카드스트립 유지 (깜빡임 방지)
		const commit = (idx: number) => {
			if (idx < 0 || idx >= files.length) return;
			if (files[idx].path === this.currentFile?.path) return;
			this.stripScrollLeft = strip.scrollLeft;
			this.currentFile = files[idx];
			this.targetFolder = files[idx].parent ?? this.targetFolder;
			this.saveState();
			previewSelect(idx);
			this.renderSeq++;
			const seq = this.renderSeq;
			this.transitionActive = true;
			this.buildScrollArea(outerContainer, seq).catch(() => {
				if (this.renderSeq === seq) this.transitionActive = false;
			});
		};
		// 현재 중앙에 가장 가까운 카드 인덱스 감지
		const snapIdx = (): number => {
			const snapCenter = strip.scrollLeft + strip.clientWidth / 2;
			let bestIdx = selectedIdx, bestDist = Infinity;
			allCards.forEach((c, i) => {
				const dist = Math.abs(c.offsetLeft + c.offsetWidth / 2 - snapCenter);
				if (dist < bestDist) { bestDist = dist; bestIdx = i; }
			});
			return bestIdx;
		};

		let selectedIdx = files.findIndex(f => f.path === this.currentFile?.path);
		if (selectedIdx < 0) selectedIdx = 0;

		const myStripGen = this.stripGen;
		let debounceTimer = 0;
		let suppressScrollHighlight = false;

		// 카드 선택: instant 위치 이동 + 즉시 commit
		const goCard = (newIdx: number) => {
			newIdx = Math.max(0, Math.min(files.length - 1, newIdx));
			selectedIdx = newIdx;
			previewSelect(newIdx);
			strip.focus({ preventScroll: true });
			window.clearTimeout(debounceTimer);
			const card = allCards[newIdx];
			const target = Math.max(0, card.offsetLeft + card.offsetWidth / 2 - strip.clientWidth / 2);
			// scrollTo 직후 scroll 이벤트에서 snapIdx()가 wrong index 반환하는 레이스 방지
			suppressScrollHighlight = true;
			strip.scrollTo({ left: target, behavior: 'instant' as ScrollBehavior });
			window.requestAnimationFrame(() => { suppressScrollHighlight = false; });
			commit(newIdx);
		};

		// 초기 scroll 위치 확정 전까지 숨김 → 플로팅 창에서 레이아웃이 늦게 잡힐 때 "scanning" 잔상 방지
		strip.setCssStyles({ visibility: 'hidden' });
		let initRetry = 0;
		const initStripPosition = () => {
			if (this.stripGen !== myStripGen) return;
			if (strip.clientWidth === 0 && initRetry < 10) { initRetry++; window.requestAnimationFrame(initStripPosition); return; }
			const nonSel = allCards.find((_, i) => i !== selectedIdx) ?? allCards[0];
			const cardW = nonSel?.offsetWidth ?? 56;
			const halfPad = Math.max(10, Math.floor((strip.clientWidth - cardW) / 2));
			strip.setCssStyles({ paddingLeft: `${halfPad}px` });
			strip.setCssStyles({ paddingRight: `${halfPad}px` });
			if (this.stripScrollLeft >= 0) {
				strip.scrollLeft = this.stripScrollLeft;
			} else {
				const card = allCards[selectedIdx];
				if (card) strip.scrollLeft = Math.max(0, card.offsetLeft + card.offsetWidth / 2 - strip.clientWidth / 2);
			}
			strip.setCssStyles({ visibility: '' });
		};
		window.requestAnimationFrame(initStripPosition);

		// scroll: 직접 라이브 하이라이트 + 200ms 후 commit
		// goCard() 직후 scroll 이벤트는 suppressScrollHighlight로 차단 → 잔상 방지
		strip.addEventListener('scroll', () => {
			this.stripScrollLeft = strip.scrollLeft;
			if (!suppressScrollHighlight) {
				const liveIdx = snapIdx();
				if (liveIdx !== selectedIdx) { selectedIdx = liveIdx; previewSelect(liveIdx); }
			}
			window.clearTimeout(debounceTimer);
			debounceTimer = window.window.setTimeout(() => {
				if (this.stripGen !== myStripGen) return;
				commit(selectedIdx);
			}, 200);
		}, { passive: true });

		// 방향키 (플로팅 창에서는 비활성화)
		const isFloating = strip.ownerDocument !== activeDocument;
		if (!isFloating) {
			strip.tabIndex = 0;
			strip.addEventListener('keydown', (e) => {
				if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goCard(selectedIdx + 1); }
				else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goCard(selectedIdx - 1); }
			});
		}

		// 카드 수가 적거나 플로팅 창에서 가로 스크롤이 없을 때 휠로 카드 이동
		let wheelAcc = 0;
		strip.addEventListener('wheel', (e) => {
			if (strip.scrollWidth <= strip.clientWidth + 1) {
				e.preventDefault();
				const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
				wheelAcc += e.deltaMode === 0 ? delta / 80 : delta;
				while (wheelAcc >= 1)  { wheelAcc -= 1; goCard(selectedIdx + 1); }
				while (wheelAcc <= -1) { wheelAcc += 1; goCard(selectedIdx - 1); }
			}
		}, { passive: false });

		// native image drag 차단
		strip.addEventListener('dragstart', e => e.preventDefault());

		// 드래그 스크롤 + 클릭 선택
		const stripDoc = strip.ownerDocument;
		strip.addEventListener('mousedown', e => {
			e.preventDefault();
			const cardOnDown = (e.target as HTMLElement).closest('.wiki-card') as HTMLElement | null;
			const idxOnDown = cardOnDown ? allCards.indexOf(cardOnDown) : -1;
			const startX = e.pageX, startScrollLeft = strip.scrollLeft;
			let hasMoved = false;

			const onMove = (me: MouseEvent) => {
				const dx = me.pageX - startX;
				if (!hasMoved && Math.abs(dx) > 4) { hasMoved = true; strip.setCssStyles({ cursor: 'grabbing' }); }
				if (hasMoved) strip.scrollLeft = startScrollLeft - dx;
			};

			const onUp = () => {
				strip.setCssStyles({ cursor: '' });
				stripDoc.removeEventListener('mousemove', onMove);
				stripDoc.removeEventListener('mouseup', onUp);
				if (this.stripGen !== myStripGen) return;
				if (hasMoved && Math.abs(strip.scrollLeft - startScrollLeft) > 4) {
					// 드래그 후: scroll 이벤트·debounce가 스냅 완료 감지해서 처리
				} else if (idxOnDown >= 0) {
					goCard(idxOnDown); // 클릭
				}
			};

			stripDoc.addEventListener('mousemove', onMove);
			stripDoc.addEventListener('mouseup', onUp);
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

		// 리스트 뷰 (프론트매터 키별 접힘/펼침 섹션)
		const wrap = outerContainer.createDiv({ cls: 'wiki-rel-list-wrap' + (this.stripCollapsed ? ' is-collapsed' : '') });
		const list = wrap.createDiv({ cls: 'wiki-rel-list' });

		window.requestAnimationFrame(() => { wrap.scrollTop = this.relListScrollTop; });

		groups.forEach(g => {
			if (g.files.length === 0) return;

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
			g.files.forEach(f => {
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
					this.relListScrollTop = wrap.scrollTop;
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
			item.setCssStyles({ paddingLeft: `${(h.level - 1) * 12}px` });
			const numSpan = item.createSpan({ cls: 'wiki-toc-number', text: numStr });
			const textSpan = item.createSpan({ cls: 'wiki-toc-text' });
			MarkdownRenderer.render(this.app, h.heading, textSpan, file.path, this.hostComponent).then(() => {
				textSpan.querySelectorAll('p').forEach(p => { (p as HTMLElement).setCssStyles({ 'margin': '0', 'display': 'inline' }); });
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
		const timeFmKeys = (this.plugin.settings.timeModes ?? []).map(m => m.frontmatterKey);
		const excluded = [
			this.plugin.settings.wikiImageFieldName,
			this.plugin.settings.wikiNameFieldName,
			this.plugin.settings.timeTotalKey ?? '총_시간',
			'wikiColor', 'position', 'cssclasses',
			...timeFmKeys,
		];
		const coloredProps = (this.plugin.settings.wikiColoredProperties || '').split(',').map(s => s.trim()).filter(Boolean);

		const hidden = this.plugin.settings.wikiHiddenProperties || [];
		const valEls: HTMLElement[] = [];
		const renderTasks: Promise<void>[] = [];
		for (const [k, v] of Object.entries(fm)) {
			if (excluded.includes(k) || hidden.includes(k)) continue;
			const row = props.createDiv({ cls: 'wiki-prop-row' });
			row.createSpan({ cls: 'wiki-prop-key', text: k });
			const valEl = row.createDiv({ cls: 'wiki-prop-val' });
			if (coloredProps.includes(k)) { valEl.setCssStyles({ color: 'var(--wiki-accent-color)', fontWeight: 'bold' }); }

			if (k === 'tags') {
				const tagList: string[] = Array.isArray(v) ? v : String(v).split(',').map(s => s.trim()).filter(Boolean);
				const tagWrap = valEl.createDiv({ cls: 'wiki-prop-tags' });
				for (const tag of tagList) {
					const t = tag.startsWith('#') ? tag : `#${tag}`;
					tagWrap.createEl('a', { cls: 'tag', text: t, href: t });
				}
				continue;
			}

			valEls.push(valEl);
			renderTasks.push(MarkdownRenderer.render(this.app, String(v), valEl, file.path, this.hostComponent));
		}
		await Promise.all(renderTasks);
		for (const valEl of valEls) {
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
				contentDiv.appendChild(sanitizeHTMLToDom(fnItem.innerHTML));
				contentDiv.querySelector('.footnote-backref')?.remove();
				activeDocument.body.appendChild(tooltip);
				tooltip.addClass('visible');
				const rect = (fn as HTMLElement).getBoundingClientRect();
				tooltip.setCssStyles({ left: `${rect.left}px` });
				tooltip.setCssStyles({ top: `${rect.bottom + 10}px` });
			});
			fn.addEventListener('mouseleave', () => { tooltip?.remove(); tooltip = null; });
			link.onclick = (e) => {
				e.preventDefault();
				const target = body.querySelector(`.footnotes #${fnId.replace(':', '\\:')}`);
				if (target) {
					scrollTo(target);
					(target as HTMLElement).addClass('wiki-highlight-flash');
					window.setTimeout(() => (target as HTMLElement).removeClass('wiki-highlight-flash'), 1000);
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
					window.setTimeout(() => (target as HTMLElement).removeClass('wiki-highlight-flash'), 1000);
				}
			});
		});
	}
}
