import { Component, MarkdownRenderer, Menu, Notice, TFile, TFolder, setIcon, sanitizeHTMLToDom, App, type WorkspaceLeaf } from 'obsidian';
import ForceGraph, { type GraphData, type LinkObject, type NodeObject } from 'force-graph';
import type WritingMenuPlugin from '../../main';
import { getToneColor } from './WikiTypes';
import { FolderOrNoteSuggestModal, FolderSuggestModal, NoteSuggestModal, ImageSuggestModal, GenerateImageModal } from './WikiModals';
import { getWikiImgSrc, getWikiDisplayName, saveGeneratedProfileImage, applyProfileImage } from './wikiProfileUtils';

interface AppWithSettings extends App {
	setting?: { open(): void; openTabById(id: string): void };
}

interface WikiSearchEntry {
	file: TFile;
	displayName: string;
	foldedName: string;
	aliases: string[];
	foldedAliases: string[];
	tags: string[];
	foldedTags: string[];
	properties: Array<{ key: string; value: string; foldedKey: string; foldedValue: string }>;
	searchText: string;
}

interface WikiGraphRelationLabel {
	key: string;
	text: string;
	fromPath: string;
	toPath: string;
}

interface WikiGraphConnection {
	from: TFile;
	to: TFile;
	labels: WikiGraphRelationLabel[];
}

interface WikiGraphModel {
	files: TFile[];
	connections: WikiGraphConnection[];
	depthByPath: Map<string, number>;
}

interface WikiGraphTeam {
	path: string;
	name: string;
	depth: number;
}

interface WikiForceNode extends NodeObject {
	id: string;
	filePath: string;
	name: string;
	color: string;
	root: boolean;
	teamPath: string;
	teamName: string;
	teamTrail: WikiGraphTeam[];
	imageSrc: string;
	image?: HTMLImageElement;
	dimmed?: boolean;
	selected?: boolean;
}

interface WikiForceLink extends LinkObject<WikiForceNode> {
	id: string;
	source: string | WikiForceNode;
	target: string | WikiForceNode;
	labels: WikiGraphRelationLabel[];
	bidirectional: boolean;
	dashed: boolean;
	dimmed?: boolean;
}

interface WikiTeamForce {
	(alpha: number): void;
	initialize(nodes: WikiForceNode[]): void;
}

interface WikiGraphRelationLayout {
	labels: WikiGraphRelationLabel[];
	labelWidths: number[];
	separatorWidth: number;
	iconWidth: number;
	iconGap: number;
	totalWidth: number;
	x: number;
	y: number;
	angle: number;
	visualDirection: number;
}


export class WikiPanel {
	plugin: WritingMenuPlugin;
	private hostComponent: Component;
	currentFile: TFile | null = null;
	targetFolder: TFolder | null = null;
	private renderSeq = 0;
	private container: HTMLElement | null = null;
	private eventsRegistered = false;
	private rerenderTimer = 0;
	private graphActive = false;
	private tocCollapsed = false;
	private toolbarCollapseTimer = 0;
	private navigationHistory: string[] = [];
	private navigationIndex = -1;
	private historyBackButton: HTMLButtonElement | null = null;
	private historyForwardButton: HTMLButtonElement | null = null;
	private relationshipGraph: ForceGraph<WikiForceNode, WikiForceLink> | null = null;
	private graphResizeObserver: ResizeObserver | null = null;
	private graphThemeObserver: MutationObserver | null = null;
	private graphStyleCleanup: (() => void) | null = null;
	private graphRootFolder: TFolder | null = null;
	private graphSearchQuery = '';
	private graphSelectedNodePath = '';
	private graphZoomScale = 1;
	private graphSettingTimer = 0;
	private graphRelationPopover: HTMLElement | null = null;
	private graphRelationPopoverCleanup: (() => void) | null = null;
	private graphMetadataRerenderSuppressedUntil = new Map<string, number>();
	private toolbarPathElement: HTMLElement | null = null;
	private graphRelationRefreshSeq = 0;

	constructor(plugin: WritingMenuPlugin, hostComponent: Component) {
		this.plugin = plugin;
		this.hostComponent = hostComponent;
		this.hostComponent.register(() => this.destroy());

		if (plugin.settings.wikiLastFolderPath) {
			const f = plugin.app.vault.getAbstractFileByPath(plugin.settings.wikiLastFolderPath);
			if (f instanceof TFolder) this.targetFolder = f;
		}
		if (plugin.settings.wikiGraphRootFolderPath) {
			const folder = plugin.app.vault.getAbstractFileByPath(plugin.settings.wikiGraphRootFolderPath);
			if (folder instanceof TFolder) this.graphRootFolder = folder;
		}
		if (plugin.settings.wikiLastFilePath) {
			const f = plugin.app.vault.getAbstractFileByPath(plugin.settings.wikiLastFilePath);
			if (f instanceof TFile) {
				this.currentFile = f;
				this.navigationHistory = [f.path];
				this.navigationIndex = 0;
			}
		}
	}

	private get app() { return this.plugin.app; }

	suspend(): void {
		this.destroyRelationshipGraph();
	}

	private destroy(): void {
		window.clearTimeout(this.rerenderTimer);
		window.clearTimeout(this.toolbarCollapseTimer);
		window.clearTimeout(this.graphSettingTimer);
		this.graphMetadataRerenderSuppressedUntil.clear();
		this.destroyRelationshipGraph();
	}

	private destroyRelationshipGraph(): void {
		this.graphRelationRefreshSeq++;
		this.closeGraphRelationPopover();
		this.graphResizeObserver?.disconnect();
		this.graphResizeObserver = null;
		this.graphThemeObserver?.disconnect();
		this.graphThemeObserver = null;
		this.graphStyleCleanup?.();
		this.graphStyleCleanup = null;
		this.graphZoomScale = 1;
		this.relationshipGraph?._destructor();
		this.relationshipGraph = null;
	}

	async saveState() {
		this.plugin.settings.wikiLastFilePath = this.currentFile?.path || '';
		this.plugin.settings.wikiLastFolderPath = this.targetFolder?.path || '';
		this.plugin.settings.wikiGraphRootFolderPath = this.graphRootFolder?.path || '';
		await this.plugin.saveData(this.plugin.settings);
	}

	rerender() {
		if (this.container) void this.render(this.container);
	}

	openFile(file: TFile) {
		this.recordNavigation(file);
		this.currentFile = file;
		this.targetFolder = file.parent ?? this.targetFolder;
		this.rerender();
	}

	openFolderPicker() {
		new FolderOrNoteSuggestModal(this.app, (item) => {
			if (item instanceof TFolder) {
				this.targetFolder = item;
				this.currentFile = null;
			} else {
				this.recordNavigation(item);
				this.currentFile = item;
				this.targetFolder = item.parent ?? this.targetFolder;
			}
			void this.saveState();
			this.rerender();
		}).open();
	}

	private openGraphRootPicker(): void {
		new FolderSuggestModal(this.app, (folder) => {
			this.graphRootFolder = folder;
			void this.saveState();
			this.rerender();
		}).open();
	}

	private renderBreadcrumb(container: HTMLElement, path: string, placeholder: string): void {
		if (!path) {
			container.createSpan({ cls: 'wiki-bc-placeholder', text: placeholder });
			return;
		}
		path.split('/').forEach((part, index) => {
			if (index > 0) container.createSpan({ cls: 'wiki-bc-sep', text: ' / ' });
			container.createSpan({ cls: 'wiki-bc-seg', text: part });
		});
	}

	private updateToolbarPath(file: TFile | null): void {
		if (!this.toolbarPathElement) return;
		this.toolbarPathElement.empty();
		this.renderBreadcrumb(
			this.toolbarPathElement,
			file?.path.replace(/\.md$/, '') ?? '',
			'노트를 선택하십시오',
		);
	}

	private recordNavigation(file: TFile): void {
		if (this.navigationHistory[this.navigationIndex] === file.path) return;
		this.navigationHistory = this.navigationHistory.slice(0, this.navigationIndex + 1);
		this.navigationHistory.push(file.path);
		if (this.navigationHistory.length > 100) this.navigationHistory.shift();
		this.navigationIndex = this.navigationHistory.length - 1;
		this.updateHistoryButtons();
	}

	private navigateHistory(direction: -1 | 1): void {
		let nextIndex = this.navigationIndex + direction;
		while (nextIndex >= 0 && nextIndex < this.navigationHistory.length) {
			const target = this.app.vault.getAbstractFileByPath(this.navigationHistory[nextIndex]);
			if (target instanceof TFile) {
				this.navigationIndex = nextIndex;
				this.currentFile = target;
				this.targetFolder = target.parent ?? this.targetFolder;
				this.updateHistoryButtons();
				void this.saveState();
				this.rerender();
				return;
			}
			nextIndex += direction;
		}
		this.updateHistoryButtons();
	}

	private updateHistoryButtons(): void {
		const canGoBack = this.navigationIndex > 0;
		const canGoForward = this.navigationIndex >= 0
			&& this.navigationIndex < this.navigationHistory.length - 1;
		if (this.historyBackButton) {
			this.historyBackButton.disabled = !canGoBack;
			this.historyBackButton.toggleClass('wiki-btn-disabled', !canGoBack);
		}
		if (this.historyForwardButton) {
			this.historyForwardButton.disabled = !canGoForward;
			this.historyForwardButton.toggleClass('wiki-btn-disabled', !canGoForward);
		}
	}

	private navigateToWikiFile(file: TFile): void {
		this.recordNavigation(file);
		this.currentFile = file;
		this.targetFolder = file.parent ?? this.targetFolder;
		void this.saveState();
		this.rerender();
	}

	private openLinkInWiki(href: string, sourcePath: string, event: MouseEvent): boolean {
		if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
		const linkPath = href.split('#', 1)[0];
		if (!linkPath) return false;
		const target = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
		if (!(target instanceof TFile)) return false;
		event.preventDefault();
		event.stopPropagation();
		this.navigateToWikiFile(target);
		return true;
	}

	private scheduleRerender() {
		window.clearTimeout(this.rerenderTimer);
		this.rerenderTimer = window.window.setTimeout(() => this.rerender(), 350);
	}

	private isHostLeafActive(): boolean {
		const hostLeaf = (this.hostComponent as Component & { leaf?: WorkspaceLeaf }).leaf;
		return !hostLeaf || this.app.workspace.getMostRecentLeaf() === hostLeaf;
	}

	private registerEvents() {
		if (this.eventsRegistered) return;
		this.eventsRegistered = true;
		this.hostComponent.registerEvent(
			this.app.metadataCache.on('changed', (changedFile) => {
				// 그래프는 현재 배치/줌/선택 상태를 보존해야 하므로 볼트 변경으로 전체 재생성하지 않는다.
				// 프로필도 대시보드가 실제 활성 리프일 때 현재 노트가 바뀐 경우에만 갱신한다.
				if (this.graphActive || !this.isHostLeafActive() || changedFile.path !== this.currentFile?.path) return;
				const suppressedUntil = this.graphMetadataRerenderSuppressedUntil.get(changedFile.path) ?? 0;
				if (suppressedUntil > Date.now()) return;
				if (suppressedUntil) this.graphMetadataRerenderSuppressedUntil.delete(changedFile.path);
				this.scheduleRerender();
			})
		);
		this.hostComponent.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (this.graphActive || !this.isHostLeafActive() || file !== this.currentFile) return;
				this.currentFile = null;
				this.scheduleRerender();
			})
		);
		this.hostComponent.registerEvent(
			this.app.vault.on('rename', (file) => {
				if (this.graphActive || !this.isHostLeafActive() || file !== this.currentFile) return;
				void this.saveState();
				this.scheduleRerender();
			})
		);
	}

	private getFolderFiles(): TFile[] {
		if (!this.targetFolder) return [];
		const fp = this.targetFolder.path;
		return this.app.vault.getMarkdownFiles()
			.filter(f => this.plugin.settings.wikiIncludeSubfolders
				? fp === '' || f.path.startsWith(fp + '/') || f.parent?.path === fp
				: f.parent?.path === fp)
			.filter(f => f.name !== '_wiki.md')
			.sort((a, b) => a.basename.localeCompare(b.basename, 'ko', { sensitivity: 'base', numeric: true }));
	}

	private getImgSrc(file: TFile): string {
		return getWikiImgSrc(this.app, this.plugin, file);
	}

	private getDisplayName(file: TFile): string {
		return getWikiDisplayName(this.app, this.plugin, file);
	}

	// ── 메인 렌더 ──────────────────────────────────────────────────────────

	async render(outerContainer: HTMLElement) {
		this.registerEvents();
		this.renderSeq++;
		const mySeq = this.renderSeq;
		this.container = outerContainer;
		this.destroyRelationshipGraph();
		outerContainer.empty();

		let wikiColor = this.plugin.settings.wikiColor || '#7025db';
		if (this.currentFile) {
			const cfm = this.app.metadataCache.getFileCache(this.currentFile)?.frontmatter;
			if (typeof cfm?.['wikiColor'] === 'string') wikiColor = cfm['wikiColor'];
		}
		outerContainer.setCssProps({ '--wiki-accent-color': wikiColor, '--wiki-accent-text': getToneColor(wikiColor), '--wiki-profile-header-size': `${this.plugin.settings.wikiProfileHeaderSize ?? 18}px`, '--wiki-profile-key-size': `${this.plugin.settings.wikiProfileKeySize ?? 13}px` });
		this.renderToolbar(outerContainer);
		if (this.graphActive) {
			await this.renderRelationshipGraph(outerContainer, mySeq);
			return;
		}

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
		outerContainer.setCssProps({ '--wiki-accent-color': wc0, '--wiki-accent-text': getToneColor(wc0) });

		// 기존 scrollArea 즉시 페이드아웃 (콘텐츠 빌드와 병렬 진행 → replaceWith 시 이미 투명)
		const existingScrollAreaOld = outerContainer.querySelector<HTMLElement>('.wiki-scroll-area');
		if (existingScrollAreaOld) {
			existingScrollAreaOld.addClass('wm-fade-out');
		}

		// navBtns 재사용 (fixed 요소, 위치 안정)
		const existingNavBtns = outerContainer.querySelector<HTMLElement>('.wiki-nav-buttons');
		if (existingNavBtns) { existingNavBtns.empty(); }
		const navBtns: HTMLElement = existingNavBtns ?? outerContainer.createDiv({ cls: 'wiki-nav-buttons' });

		// scrollArea를 detached 상태로 빌드 → 완성 후 replaceWith로 단번 교체
		// 빈 상태(깜빡임) 없이 old content → new content 원자적 전환
		const scrollArea = outerContainer.createDiv({ cls: 'wiki-scroll-area' });
		scrollArea.detach();

		const infoRow = scrollArea.createDiv({ cls: 'wiki-info-row' });
		const body = scrollArea.createDiv({ cls: 'obsiwiki-rendered-body' });

		navBtns.createDiv({ cls: 'wiki-nav-btn', attr: { 'aria-label': '최상단으로' } });
		setIcon(navBtns.lastElementChild as HTMLElement, 'chevrons-up');
		(navBtns.lastElementChild as HTMLElement).onclick = () => scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
		navBtns.createDiv({ cls: 'wiki-nav-btn', attr: { 'aria-label': '목차로' } });
		setIcon(navBtns.lastElementChild as HTMLElement, 'list');
		(navBtns.lastElementChild as HTMLElement).onclick = () => {
			const toc = scrollArea.querySelector('.wiki-toc-container');
			if (toc) toc.scrollIntoView({ behavior: 'smooth', block: 'start' });
			else scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
		};
		navBtns.createDiv({ cls: 'wiki-nav-btn', attr: { 'aria-label': '최하단으로' } });
		setIcon(navBtns.lastElementChild as HTMLElement, 'chevrons-down');
		(navBtns.lastElementChild as HTMLElement).onclick = () => scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'smooth' });

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
			const link = (e.target as HTMLElement).closest('a.internal-link, a[data-href]');
			if (!link || !this.currentFile) return;
			const href = link.getAttribute('data-href') || link.getAttribute('href');
			if (href && this.openLinkInWiki(href, this.currentFile.path, e)) return;
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

			const chevron = createSpan({ cls: 'wiki-heading-chevron' });
			setIcon(chevron, 'chevron-down');
			chevron.addEventListener('click', (e) => {
				e.stopPropagation();
				const collapsed = header.classList.toggle('is-heading-collapsed');
				setIcon(chevron, collapsed ? 'chevron-right' : 'chevron-down');
				let sib = header.nextElementSibling;
				while (sib) {
					const m = /^H([1-6])$/.exec(sib.tagName);
					if (m && Number(m[1]) <= level) break;
					(sib as HTMLElement).style.display = collapsed ? 'none' : '';
					sib = sib.nextElementSibling;
				}
			});
			header.append(chevron);
		});

		this.setupFootnotes(body, scrollArea);
	}

	// ── A. 툴바 ────────────────────────────────────────────────────────────

	private renderToolbar(outerContainer: HTMLElement) {
		const wrap = outerContainer.createDiv({ cls: 'wiki-toolbar-wrap' });
		if (this.plugin.settings.wikiToolbarAutoHide) {
			wrap.addClass('is-collapsed');
			wrap.addEventListener('mouseenter', () => {
				window.clearTimeout(this.toolbarCollapseTimer);
				wrap.removeClass('is-collapsed');
			});
			wrap.addEventListener('mouseleave', () => {
				window.clearTimeout(this.toolbarCollapseTimer);
				this.toolbarCollapseTimer = window.setTimeout(() => wrap.addClass('is-collapsed'), 60);
			});
		}
		const bar = wrap.createDiv({ cls: 'wiki-toolbar' });

		this.historyBackButton = bar.createEl('button', {
			cls: 'wm-cal-icon-btn wiki-history-btn',
			attr: { type: 'button', 'aria-label': '이전 위키 노트' },
		});
		setIcon(this.historyBackButton, 'chevron-left');
		this.historyBackButton.addEventListener('click', () => this.navigateHistory(-1));

		this.historyForwardButton = bar.createEl('button', {
			cls: 'wm-cal-icon-btn wiki-history-btn',
			attr: { type: 'button', 'aria-label': '다음 위키 노트' },
		});
		setIcon(this.historyForwardButton, 'chevron-right');
		this.historyForwardButton.addEventListener('click', () => this.navigateHistory(1));
		this.updateHistoryButtons();

		// 현재 위키 노트 전용 경로. 폴더 범위는 그래프의 경로 메뉴에서만 다룬다.
		const left = bar.createDiv({ cls: 'wiki-toolbar-left' });
		const pathSpan = left.createSpan({ cls: 'wiki-bc-path' });
		this.toolbarPathElement = pathSpan;
		this.renderBreadcrumb(pathSpan, this.currentFile?.path.replace(/\.md$/, '') ?? '', '노트를 선택하십시오');
		pathSpan.addEventListener('click', () => {
			new NoteSuggestModal(this.app, (file) => {
				this.graphActive = false;
				this.navigateToWikiFile(file);
			}).open();
		});

		// 중간 spacer
		bar.createDiv({ cls: 'wiki-toolbar-spacer' });

		// 액션 버튼 (우측)
		const right = bar.createDiv({ cls: 'wiki-toolbar-right' });

		const graphBtn = right.createDiv({
			cls: 'wm-cal-icon-btn' + (this.graphActive ? ' is-active' : ''),
			attr: { 'aria-label': this.graphActive ? '인물 관계도 닫기' : '인물 관계도' },
		});
		setIcon(graphBtn, 'git-fork');
		graphBtn.onclick = () => {
			const nextGraphActive = !this.graphActive;
			if (!nextGraphActive && this.graphSelectedNodePath) {
				const selectedFile = this.app.vault.getAbstractFileByPath(this.graphSelectedNodePath);
				if (selectedFile instanceof TFile) {
					this.recordNavigation(selectedFile);
					this.currentFile = selectedFile;
					this.targetFolder = selectedFile.parent ?? this.targetFolder;
					void this.saveState();
				}
			}
			this.graphActive = nextGraphActive;
			this.graphSearchQuery = '';
			this.graphSelectedNodePath = this.graphActive ? (this.currentFile?.path ?? '') : '';
			if (this.graphActive && !this.graphRootFolder) {
				this.graphRootFolder = this.targetFolder ?? this.currentFile?.parent ?? null;
				if (!this.graphRootFolder) {
					this.openGraphRootPicker();
					return;
				}
				void this.saveState();
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
				await this.app.fileManager.processFrontMatter(cf, (f: Record<string, unknown>) => { f['wikiColor'] = colorInp.value; });
				this.rerender();
			};
		}

		// 새 탭에서 열기
		const tabBtn = right.createDiv({ cls: 'wm-cal-icon-btn' + (!this.currentFile ? ' wiki-btn-disabled' : ''), attr: { 'aria-label': '새 탭에서 열기' } });
		setIcon(tabBtn, 'external-link');
		tabBtn.onclick = () => { if (this.currentFile) void this.app.workspace.getLeaf('tab').openFile(this.currentFile); };

		// 위키 설정 (맨 우측)
		const settingsBtn = right.createDiv({ cls: 'wm-cal-icon-btn', attr: { 'aria-label': '위키 설정' } });
		setIcon(settingsBtn, 'settings');
		settingsBtn.onclick = () => {
			(this.app as AppWithSettings).setting?.open();
			(this.app as AppWithSettings).setting?.openTabById(this.plugin.manifest.id);
			window.setTimeout(() => { this.plugin.settingTab?.renderPage('wiki'); }, 60);
		};
	}

	// ── B. 검색 · 관계 그래프 ──────────────────────────────────────────────

	private foldSearchText(value: unknown): string {
		return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ').trim();
	}

	private valueToSearchText(value: unknown): string[] {
		if (value === null || value === undefined) return [];
		if (Array.isArray(value)) return value.flatMap(item => this.valueToSearchText(item));
		if (typeof value === 'object') {
			return Object.values(value as Record<string, unknown>).flatMap(item => this.valueToSearchText(item));
		}
		const text = String(value).trim();
		return text ? [text] : [];
	}

	private buildSearchIndex(files: TFile[] = this.getFolderFiles()): WikiSearchEntry[] {
		const hidden = new Set(this.plugin.settings.wikiHiddenProperties || []);
		const excluded = new Set([
			this.plugin.settings.wikiImageFieldName,
			'wikiColor',
			'position',
			'cssclasses',
			...hidden,
		]);
		return files.map(file => {
			const cache = this.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter ?? {};
			const displayName = this.getDisplayName(file);
			const aliases = this.valueToSearchText(fm['aliases'] ?? fm['alias']);
			const tagSet = new Set<string>();
			for (const tag of this.valueToSearchText(fm['tags'])) {
				for (const part of tag.split(/[\s,]+/)) {
					const cleaned = part.replace(/^#/, '').trim();
					if (cleaned) tagSet.add(cleaned);
				}
			}
			for (const tag of cache?.tags ?? []) {
				const cleaned = tag.tag.replace(/^#/, '').trim();
				if (cleaned) tagSet.add(cleaned);
			}
			const tags = Array.from(tagSet);
			const properties: WikiSearchEntry['properties'] = [];
			for (const [key, value] of Object.entries(fm)) {
				if (excluded.has(key) || key === 'aliases' || key === 'alias' || key === 'tags') continue;
				for (const text of this.valueToSearchText(value)) {
					properties.push({ key, value: text, foldedKey: this.foldSearchText(key), foldedValue: this.foldSearchText(text) });
				}
			}
			const foldedName = this.foldSearchText(displayName);
			const foldedAliases = aliases.map(value => this.foldSearchText(value));
			const foldedTags = tags.map(value => this.foldSearchText(value));
			return {
				file,
				displayName,
				foldedName,
				aliases,
				foldedAliases,
				tags,
				foldedTags,
				properties,
				searchText: [foldedName, ...foldedAliases, ...foldedTags, ...properties.flatMap(property => [property.foldedKey, property.foldedValue])].join('\n'),
			};
		});
	}

	private getRelationFields(): string[] {
		return (this.plugin.settings.wikiRelationFields || '')
			.split(',')
			.map(value => value.trim())
			.filter(Boolean);
	}

	private getGraphFiles(): TFile[] {
		if (!this.graphRootFolder) return [];
		const rootPath = this.graphRootFolder.path;
		return this.app.vault.getMarkdownFiles()
			.filter(file => rootPath === '' || file.path.startsWith(`${rootPath}/`) || file.parent?.path === rootPath)
			.filter(file => file.name !== '_wiki.md')
			.sort((a, b) => this.getDisplayName(a).localeCompare(
				this.getDisplayName(b),
				'ko',
				{ sensitivity: 'base', numeric: true },
			));
	}

	private getGraphAnchorFile(files: TFile[]): TFile {
		if (this.currentFile && files.some(file => file.path === this.currentFile?.path)) return this.currentFile;
		const graphPaths = new Set(files.map(file => file.path));
		const degree = new Map(files.map(file => [file.path, 0]));
		for (const from of files) {
			const frontmatter = this.app.metadataCache.getFileCache(from)?.frontmatter;
			for (const field of this.getRelationFields()) {
				for (const { file: to } of this.resolveRelationships(frontmatter?.[field], from.path, field)) {
					if (to.path === from.path || !graphPaths.has(to.path)) continue;
					degree.set(from.path, (degree.get(from.path) ?? 0) + 1);
					degree.set(to.path, (degree.get(to.path) ?? 0) + 1);
				}
			}
		}
		return [...files].sort((a, b) =>
			(degree.get(b.path) ?? 0) - (degree.get(a.path) ?? 0)
			|| this.getDisplayName(a).localeCompare(this.getDisplayName(b), 'ko', { sensitivity: 'base', numeric: true })
		)[0];
	}

	private getInlineRelationComments(file: TFile, content: string, fields: string[]): Map<string, string> {
		const comments = new Map<string, string>();
		const lines = content.split(/\r?\n/);
		if (lines[0]?.trim() !== '---') return comments;
		const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
		if (end < 0) return comments;
		let activeField = '';
		let fieldIndent = -1;
		for (let index = 1; index < end; index++) {
			const line = lines[index];
			const indent = line.match(/^\s*/)?.[0].length ?? 0;
			const field = fields.find(candidate => {
				const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				return new RegExp(`^\\s*["']?${escaped}["']?\\s*:`).test(line);
			});
			if (field) {
				activeField = field;
				fieldIndent = indent;
			} else if (activeField && line.trim() && !line.trimStart().startsWith('#') && indent <= fieldIndent) {
				activeField = '';
				fieldIndent = -1;
			}
			if (!activeField) continue;
			const link = line.match(/\[\[(.*?)\]\]/);
			const comment = line.match(/\s+#\s*(.*?)\s*$/);
			if (!link || !comment) continue;
			const linkpath = link[1].split('|')[0].trim();
			const target = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
			if (!(target instanceof TFile)) continue;
			comments.set(`${activeField}\u0000${target.path}`, comment[1].trim());
		}
		return comments;
	}

	private closeGraphRelationPopover(): void {
		this.graphRelationPopoverCleanup?.();
		this.graphRelationPopoverCleanup = null;
		this.graphRelationPopover?.remove();
		this.graphRelationPopover = null;
	}

	private openRelationLabelEditor(
		relation: WikiGraphRelationLabel,
		graphHost: HTMLElement,
		anchor: { clientX: number; clientY: number },
	): void {
		const source = this.app.vault.getAbstractFileByPath(relation.fromPath);
		const target = this.app.vault.getAbstractFileByPath(relation.toPath);
		if (!(source instanceof TFile) || !(target instanceof TFile)) return;
		this.closeGraphRelationPopover();
		const panel = graphHost.closest<HTMLElement>('.wiki-relation-graph-panel') ?? graphHost;
		const panelRect = panel.getBoundingClientRect();
		const popover = panel.createDiv({ cls: 'wiki-graph-relation-editor' });
		this.graphRelationPopover = popover;
		const graphNodes = this.relationshipGraph?.graphData().nodes ?? [];
		const sourceNode = graphNodes.find(node => node.filePath === source.path);
		const targetNode = graphNodes.find(node => node.filePath === target.path);
		const preview = popover.createDiv({ cls: 'wiki-graph-relation-editor-preview' });
		const createPreviewNode = (file: TFile, node: WikiForceNode | undefined) => {
			const item = preview.createDiv({ cls: 'wiki-graph-relation-preview-node' });
			const color = node?.color || String(
				this.app.metadataCache.getFileCache(file)?.frontmatter?.['wikiColor']
				|| this.plugin.settings.wikiColor
				|| '#7025db',
			);
			const circle = item.createDiv({ cls: 'wiki-graph-relation-preview-circle' });
			circle.setCssProps({ '--wiki-graph-preview-node-color': color });
			circle.createSpan({ cls: 'wiki-graph-relation-preview-initial', text: this.getDisplayName(file).slice(0, 1) });
			const imageSrc = node?.imageSrc || getWikiImgSrc(this.app, this.plugin, file);
			if (imageSrc) {
				const image = circle.createEl('img', {
					cls: 'wiki-graph-relation-preview-image',
					attr: { src: imageSrc, alt: '' },
				});
				image.addEventListener('error', () => image.remove());
			}
			item.createDiv({ cls: 'wiki-graph-relation-preview-name', text: this.getDisplayName(file) });
		};
		createPreviewNode(source, sourceNode);
		const connection = preview.createDiv({ cls: 'wiki-graph-relation-preview-connection' });
		const previewLabelWrap = connection.createDiv({ cls: 'wiki-graph-relation-preview-label' });
		const leadingChevron = previewLabelWrap.createSpan({ cls: 'wiki-graph-relation-preview-arrows' });
		setIcon(leadingChevron, 'chevrons-right');
		const previewLabel = previewLabelWrap.createSpan({ text: relation.text });
		const trailingChevron = previewLabelWrap.createSpan({ cls: 'wiki-graph-relation-preview-arrows' });
		setIcon(trailingChevron, 'chevrons-right');
		const previewTheme = this.getGraphTheme(graphHost);
		previewLabelWrap.setCssProps({
			'--wiki-graph-preview-relation-color': this.getGraphRelationLabelColor(relation.key, previewTheme.faint),
		});
		const input = connection.createEl('input', {
			cls: 'wiki-graph-relation-editor-input',
			attr: {
				type: 'text',
				placeholder: relation.key,
				'aria-label': '표시할 관계명',
			},
		});
		input.value = relation.text === relation.key ? '' : relation.text;
		input.addEventListener('input', () => previewLabel.setText(input.value.trim() || relation.key));
		createPreviewNode(target, targetNode);
		const actions = popover.createDiv({ cls: 'wiki-graph-relation-editor-actions' });
		const cancelButton = actions.createEl('button', { text: '닫기', attr: { type: 'button' } });
		const saveButton = actions.createEl('button', { text: '적용', cls: 'mod-cta', attr: { type: 'button' } });

		const x = Math.max(8, Math.min(panelRect.width - 328, anchor.clientX - panelRect.left + 10));
		const y = Math.max(52, Math.min(panelRect.height - 210, anchor.clientY - panelRect.top + 10));
		popover.setCssProps({
			'--wiki-graph-relation-editor-x': `${x}px`,
			'--wiki-graph-relation-editor-y': `${y}px`,
		});

		let saving = false;
		const save = async () => {
			if (saving) return;
			saving = true;
			saveButton.disabled = true;
			await this.updateInlineRelationComment(relation, input.value.trim());
			this.closeGraphRelationPopover();
		};
		cancelButton.addEventListener('click', () => this.closeGraphRelationPopover());
		popover.addEventListener('pointerdown', event => event.stopPropagation());
		popover.addEventListener('click', event => event.stopPropagation());
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				void save();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				this.closeGraphRelationPopover();
			}
		});
		saveButton.addEventListener('click', () => void save());

		const onOutsidePointerDown = (event: PointerEvent) => {
			if (!popover.contains(event.target as Node)) this.closeGraphRelationPopover();
		};
		window.setTimeout(() => panel.ownerDocument.addEventListener('pointerdown', onOutsidePointerDown, true), 0);
		this.graphRelationPopoverCleanup = () => panel.ownerDocument.removeEventListener('pointerdown', onOutsidePointerDown, true);
		window.setTimeout(() => input.focus(), 0);
	}

	private chooseRelationLabel(link: WikiForceLink, event: MouseEvent, graphHost: HTMLElement): void {
		const anchor = { clientX: event.clientX, clientY: event.clientY };
		if (link.labels.length === 1) {
			this.openRelationLabelEditor(link.labels[0], graphHost, anchor);
			return;
		}
		const menu = new Menu();
		for (const relation of link.labels) {
			const source = this.app.vault.getAbstractFileByPath(relation.fromPath);
			const target = this.app.vault.getAbstractFileByPath(relation.toPath);
			const sourceName = source instanceof TFile ? this.getDisplayName(source) : relation.fromPath;
			const targetName = target instanceof TFile ? this.getDisplayName(target) : relation.toPath;
			const custom = relation.text === relation.key ? '' : ` · ${relation.text}`;
			menu.addItem(item => item
				.setTitle(`${sourceName} → ${targetName} · ${relation.key}${custom}`)
				.setIcon('pencil')
				.onClick(() => this.openRelationLabelEditor(relation, graphHost, anchor)));
		}
		menu.showAtMouseEvent(event);
	}

	private async updateInlineRelationComment(relation: WikiGraphRelationLabel, value: string): Promise<void> {
		const source = this.app.vault.getAbstractFileByPath(relation.fromPath);
		if (!(source instanceof TFile)) return;
		const cleanValue = value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
		let updated = false;
		this.graphMetadataRerenderSuppressedUntil.set(source.path, Date.now() + 1800);
		try {
			await this.app.vault.process(source, content => {
				const newline = content.includes('\r\n') ? '\r\n' : '\n';
				const lines = content.split(/\r?\n/);
				if (lines[0]?.trim() !== '---') return content;
				const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
				if (end < 0) return content;
				let activeField = '';
				let fieldIndent = -1;
				const escapedField = relation.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const fieldPattern = new RegExp(`^\\s*["']?${escapedField}["']?\\s*:`);
				for (let index = 1; index < end; index++) {
					const line = lines[index];
					const indent = line.match(/^\s*/)?.[0].length ?? 0;
					if (fieldPattern.test(line)) {
						activeField = relation.key;
						fieldIndent = indent;
					} else if (activeField && line.trim() && !line.trimStart().startsWith('#') && indent <= fieldIndent) {
						activeField = '';
						fieldIndent = -1;
					}
					if (!activeField) continue;
					const link = line.match(/\[\[(.*?)\]\]/);
					if (!link) continue;
					const linkpath = link[1].split('|')[0].trim();
					const target = this.app.metadataCache.getFirstLinkpathDest(linkpath, source.path);
					if (!(target instanceof TFile) || target.path !== relation.toPath) continue;
					const linkEnd = (link.index ?? 0) + link[0].length;
					const suffix = line.slice(linkEnd);
					const commentMatch = suffix.match(/\s+#\s*.*$/);
					const base = (commentMatch?.index === undefined
						? line
						: line.slice(0, linkEnd + commentMatch.index)).trimEnd();
					lines[index] = cleanValue ? `${base} # ${cleanValue}` : base;
					updated = true;
					break;
				}
				return updated ? lines.join(newline) : content;
			});
			if (!updated) {
				this.graphMetadataRerenderSuppressedUntil.delete(source.path);
				new Notice('원본 프론트매터에서 해당 관계 링크를 찾지 못했습니다.');
				return;
			}
			const nextText = cleanValue || relation.key;
			const graph = this.relationshipGraph;
			if (graph) {
				for (const link of graph.graphData().links) {
					for (const label of link.labels) {
						if (label.fromPath !== relation.fromPath
							|| label.toPath !== relation.toPath
							|| label.key !== relation.key) continue;
						label.text = nextText;
					}
				}
				relation.text = nextText;
				graph.linkLabel(graph.linkLabel());
				graph.linkCanvasObject(graph.linkCanvasObject());
				graph.linkPointerAreaPaint(graph.linkPointerAreaPaint());
			}
			new Notice(cleanValue ? '그래프 관계명을 저장했습니다.' : '그래프 관계명을 기본값으로 되돌렸습니다.');
		} catch (error) {
			this.graphMetadataRerenderSuppressedUntil.delete(source.path);
			console.error('[writing-menu] Failed to update graph relation label', error);
			new Notice('그래프 관계명을 저장하지 못했습니다.');
		}
	}

	private async buildRelationshipGraphModel(source: TFile): Promise<WikiGraphModel> {
		const fields = this.getRelationFields();
		const sources = this.getGraphFiles();
		const graphPaths = new Set(sources.map(file => file.path));
		const inlineComments = new Map<string, Map<string, string>>(await Promise.all(sources.map(async file => [
			file.path,
			this.getInlineRelationComments(file, await this.app.vault.cachedRead(file), fields),
		] as const)));

		const filesByPath = new Map<string, TFile>(sources.map(file => [file.path, file]));
		const directed = new Map<string, WikiGraphConnection>();
		for (const from of sources) {
			const frontmatter = this.app.metadataCache.getFileCache(from)?.frontmatter;
			for (const field of fields) {
				for (const { file: to, label } of this.resolveRelationships(frontmatter?.[field], from.path, field, inlineComments.get(from.path))) {
					if (to.path === from.path || !graphPaths.has(to.path)) continue;
					const key = `${from.path}\u0000${to.path}`;
					const existing = directed.get(key);
					if (existing) {
						if (!existing.labels.some(item => item.key === label.key && item.text === label.text)) existing.labels.push(label);
					} else {
						directed.set(key, { from, to, labels: [label] });
					}
				}
			}
		}

		const connections = Array.from(directed.values());
		const adjacent = new Map<string, Set<string>>();
		const connect = (a: string, b: string) => {
			const neighbors = adjacent.get(a) ?? new Set<string>();
			neighbors.add(b);
			adjacent.set(a, neighbors);
		};
		for (const connection of connections) {
			connect(connection.from.path, connection.to.path);
			connect(connection.to.path, connection.from.path);
		}

		const depthByPath = new Map<string, number>([[source.path, 0]]);
		const queue = [source.path];
		while (queue.length > 0) {
			const path = queue.shift();
			if (!path) break;
			const depth = depthByPath.get(path) ?? 0;
			const neighbors = Array.from(adjacent.get(path) ?? []).sort((a, b) =>
				this.getDisplayName(filesByPath.get(a) ?? source).localeCompare(
					this.getDisplayName(filesByPath.get(b) ?? source),
					'ko',
					{ sensitivity: 'base', numeric: true },
				)
			);
			for (const neighbor of neighbors) {
				if (depthByPath.has(neighbor) || !filesByPath.has(neighbor)) continue;
				depthByPath.set(neighbor, depth + 1);
				queue.push(neighbor);
			}
		}

		const files = [...sources]
			.sort((a, b) => (depthByPath.get(a.path) ?? Number.MAX_SAFE_INTEGER) - (depthByPath.get(b.path) ?? Number.MAX_SAFE_INTEGER)
				|| this.getDisplayName(a).localeCompare(this.getDisplayName(b), 'ko', { sensitivity: 'base', numeric: true }));
		return {
			files,
			connections,
			depthByPath,
		};
	}

	private getGraphTeamTrail(file: TFile): WikiGraphTeam[] {
		const rootPath = this.graphRootFolder?.path ?? '';
		const parentPath = file.parent?.path ?? rootPath;
		if (parentPath === rootPath) {
			return [{ path: rootPath, name: this.graphRootFolder?.name || 'Vault', depth: 0 }];
		}
		const relative = rootPath && parentPath.startsWith(`${rootPath}/`)
			? parentPath.slice(rootPath.length + 1)
			: parentPath;
		const folders = relative.split('/').filter(Boolean);
		if (folders.length === 0) return [{ path: rootPath, name: this.graphRootFolder?.name || 'Vault', depth: 0 }];
		return folders.map((name, depth) => ({
			path: [rootPath, ...folders.slice(0, depth + 1)].filter(Boolean).join('/'),
			name,
			depth,
		}));
	}

	private toForceGraphData(source: TFile, model: WikiGraphModel): GraphData<WikiForceNode, WikiForceLink> {
		const nodes: WikiForceNode[] = model.files.map(file => {
			const root = file.path === source.path;
			const color = String(this.app.metadataCache.getFileCache(file)?.frontmatter?.['wikiColor']
				|| this.plugin.settings.wikiColor || '#7025db');
			const teamTrail = this.getGraphTeamTrail(file);
			const team = teamTrail[0];
			return {
				id: file.path,
				filePath: file.path,
				name: this.getDisplayName(file),
				color,
				root,
				teamPath: team.path,
				teamName: team.name,
				teamTrail,
				imageSrc: this.getImgSrc(file),
			};
		});

		type Pair = { a: string; b: string; ab: WikiGraphRelationLabel[]; ba: WikiGraphRelationLabel[] };
		const pairs = new Map<string, Pair>();
		for (const connection of model.connections) {
			const forward = connection.from.path.localeCompare(connection.to.path) <= 0;
			const a = forward ? connection.from.path : connection.to.path;
			const b = forward ? connection.to.path : connection.from.path;
			const key = `${a}\u0000${b}`;
			const pair = pairs.get(key) ?? { a, b, ab: [], ba: [] };
			const labels = forward ? pair.ab : pair.ba;
			for (const label of connection.labels) {
				if (!labels.some(item => item.key === label.key && item.text === label.text)) labels.push(label);
			}
			pairs.set(key, pair);
		}

		const links: WikiForceLink[] = Array.from(pairs.values()).map((pair, index) => {
			const both = pair.ab.length > 0 && pair.ba.length > 0;
			const forward = pair.ab.length > 0;
			const labels = [...pair.ab, ...pair.ba].filter((label, labelIndex, all) =>
				all.findIndex(item => item.key === label.key
					&& item.text === label.text
					&& item.fromPath === label.fromPath
					&& item.toPath === label.toPath) === labelIndex);
			return {
				id: `wiki-relation-${index}`,
				source: forward ? pair.a : pair.b,
				target: forward ? pair.b : pair.a,
				labels,
				bidirectional: both,
				dashed: labels.some(label => /(?:^|[\s_-])(former|past|ex)(?:$|[\s_-])|과거|이전|전(?:$|[\s_-])/i.test(`${label.key} ${label.text}`)),
			};
		});
		return { nodes, links };
	}

	private async refreshGraphRelations(): Promise<void> {
		const graph = this.relationshipGraph;
		if (!graph || !this.graphActive || !this.graphRootFolder) return;
		const refreshSeq = ++this.graphRelationRefreshSeq;
		const files = this.getGraphFiles();
		if (files.length === 0) return;
		const source = this.getGraphAnchorFile(files);
		const model = await this.buildRelationshipGraphModel(source);
		if (refreshSeq !== this.graphRelationRefreshSeq || this.relationshipGraph !== graph) return;

		const previousNodes = new Map(graph.graphData().nodes.map(node => [node.filePath, node]));
		const nextData = this.toForceGraphData(source, model);
		for (const node of nextData.nodes) {
			const previous = previousNodes.get(node.filePath);
			if (!previous) continue;
			node.x = previous.x;
			node.y = previous.y;
			node.vx = previous.vx;
			node.vy = previous.vy;
			node.image = previous.image;
		}

		const center = graph.centerAt();
		const zoom = graph.zoom();
		const alphaDecay = graph.d3AlphaDecay();
		graph.d3AlphaDecay(1).graphData(nextData);
		this.applyGraphPhysics(undefined, false);
		graph.centerAt(center.x, center.y, 0);
		graph.zoom(zoom, 0);
		window.requestAnimationFrame(() => {
			if (this.relationshipGraph !== graph) return;
			graph.d3AlphaDecay(alphaDecay);
			graph.centerAt(center.x, center.y, 0);
			graph.zoom(zoom, 0);
			this.applyGraphEmphasis(this.buildSearchIndex(model.files));
		});

		const panel = this.container?.querySelector<HTMLElement>('.wiki-relation-graph-panel');
		panel?.querySelector('.wiki-graph-no-relations')?.remove();
		if (panel && model.connections.length === 0) {
			panel.createDiv({ cls: 'wiki-graph-no-relations', text: '등록된 관계가 없습니다.' });
		}
	}

	private getGraphSearchMatches(query: string, entries: WikiSearchEntry[]): Set<string> | null {
		const trimmed = query.trim();
		if (!trimmed) return null;
		type GraphSearchToken = {
			kind: 'name' | 'tag' | 'property' | 'operator';
			value: string;
			propertyValue?: string;
		};
		const rawTokens = trimmed.match(/"(?:\\.|[^"])*"|\S+/g) ?? [];
		const cleanToken = (rawToken: string) => rawToken.startsWith('"') && rawToken.endsWith('"')
			? rawToken.slice(1, -1).replace(/\\"/g, '"')
			: rawToken;
		const tokens: GraphSearchToken[] = [];
		for (let index = 0; index < rawTokens.length; index++) {
			const raw = cleanToken(rawTokens[index]);
			const folded = this.foldSearchText(raw);
			if (!folded) continue;
			if (folded === 'and' || folded === 'or') {
				tokens.push({ kind: 'operator', value: folded });
				continue;
			}
			if (raw.startsWith('#')) {
				const value = this.foldSearchText(raw.slice(1));
				if (value) tokens.push({ kind: 'tag', value });
				continue;
			}
			if (raw.startsWith('.')) {
				const propertyQuery = raw.slice(1);
				const separator = propertyQuery.indexOf(':');
				const value = this.foldSearchText(separator < 0 ? propertyQuery : propertyQuery.slice(0, separator));
				const propertyValueParts = separator < 0 ? [] : [propertyQuery.slice(separator + 1)].filter(Boolean);
				if (separator >= 0) {
					while (index + 1 < rawTokens.length) {
						const nextRaw = cleanToken(rawTokens[index + 1]);
						const nextFolded = this.foldSearchText(nextRaw);
						if (nextRaw.startsWith('.') || nextRaw.startsWith('#') || nextFolded === 'and' || nextFolded === 'or') break;
						propertyValueParts.push(nextRaw);
						index++;
					}
				}
				const propertyValue = this.foldSearchText(propertyValueParts.join(' ')) || undefined;
				if (value) tokens.push({ kind: 'property', value, propertyValue });
				continue;
			}
			tokens.push({ kind: 'name', value: folded });
		}
		if (tokens.length === 0) return new Set<string>();
		const structuralOnly = tokens.some(token => token.kind === 'tag' || token.kind === 'property')
			&& tokens.every(token => token.kind !== 'name');
		const matchesFilter = (entry: WikiSearchEntry, token: GraphSearchToken): boolean => {
			if (token.kind === 'tag') {
				return entry.foldedTags.some(tag => tag === token.value || tag.startsWith(`${token.value}/`));
			}
			if (token.kind === 'property') {
				const frontmatter = this.app.metadataCache.getFileCache(entry.file)?.frontmatter ?? {};
				return Object.entries(frontmatter).some(([key, rawValue]) => {
					if (!this.foldSearchText(key).startsWith(token.value)) return false;
					if (!token.propertyValue) return true;
					return this.valueToSearchText(rawValue)
						.some(value => this.foldSearchText(value).includes(token.propertyValue ?? ''));
				});
			}
			return entry.foldedName.includes(token.value)
				|| entry.foldedAliases.some(alias => alias.includes(token.value));
		};

		const matchesEntry = (entry: WikiSearchEntry): boolean => {
			if (!structuralOnly) {
				return tokens.every(token => {
					const effective = token.kind === 'operator'
						? { kind: 'name' as const, value: token.value }
						: token;
					return matchesFilter(entry, effective);
				});
			}
			const orGroups: GraphSearchToken[][] = [[]];
			for (const token of tokens) {
				if (token.kind === 'operator') {
					if (token.value === 'or' && orGroups[orGroups.length - 1].length > 0) orGroups.push([]);
					continue;
				}
				orGroups[orGroups.length - 1].push(token);
			}
			return orGroups.some(group => group.length > 0 && group.every(token => matchesFilter(entry, token)));
		};

		return new Set(entries.filter(matchesEntry).map(entry => entry.file.path));
	}

	private applyGraphEmphasis(entries: WikiSearchEntry[]): void {
		const searchMatches = this.getGraphSearchMatches(this.graphSearchQuery, entries);

		const graph = this.relationshipGraph;
		if (!graph) return;
		const data = graph.graphData();
		const selectedPath = data.nodes.some(node => node.filePath === this.graphSelectedNodePath)
			? this.graphSelectedNodePath
			: '';
		const selectedNetwork = selectedPath ? new Set<string>([selectedPath]) : null;
		for (const link of data.links) {
			const sourcePath = typeof link.source === 'object' ? link.source.filePath : String(link.source);
			const targetPath = typeof link.target === 'object' ? link.target.filePath : String(link.target);
			if (selectedNetwork) {
				const connected = sourcePath === selectedPath || targetPath === selectedPath;
				link.dimmed = !connected;
				if (connected) {
					selectedNetwork.add(sourcePath);
					selectedNetwork.add(targetPath);
				}
			} else {
				const connectsMatches = searchMatches !== null
					&& searchMatches.has(sourcePath)
					&& searchMatches.has(targetPath);
				link.dimmed = searchMatches !== null && !connectsMatches;
			}
		}
		for (const node of data.nodes) {
			node.selected = node.filePath === selectedPath;
			node.dimmed = selectedNetwork
				? !selectedNetwork.has(node.filePath)
				: searchMatches !== null && !searchMatches.has(node.filePath);
		}
		graph.nodeCanvasObject(graph.nodeCanvasObject());
	}

	private getGraphPhysics(distance = this.plugin.settings.wikiGraphNodeDistance ?? 1.25) {
		const normalized = Math.max(0, Math.min(1, (distance - 0.6) / 2));
		return {
			linkDistance: 54 + normalized * 206,
			chargeStrength: -(130 + normalized * 820),
			linkStrength: 0.68 - normalized * 0.48,
		};
	}

	private applyGraphPhysics(distance = this.plugin.settings.wikiGraphNodeDistance ?? 1.25, reheat = true): void {
		const graph = this.relationshipGraph;
		if (!graph) return;
		const physics = this.getGraphPhysics(distance);
		graph.d3Force('link')?.distance?.(physics.linkDistance);
		graph.d3Force('link')?.strength?.(physics.linkStrength);
		graph.d3Force('charge')?.strength?.(physics.chargeStrength);
		graph.d3Force('center')?.strength?.(1);
		if (reheat) graph.d3ReheatSimulation();
	}

	private scaleGraphLayout(previousDistance: number, nextDistance: number): void {
		const graph = this.relationshipGraph;
		if (!graph || previousDistance <= 0 || previousDistance === nextDistance) return;
		const nodes = graph.graphData().nodes.filter(node => Number.isFinite(node.x) && Number.isFinite(node.y));
		if (nodes.length === 0) return;
		const centerX = nodes.reduce((sum, node) => sum + (node.x ?? 0), 0) / nodes.length;
		const centerY = nodes.reduce((sum, node) => sum + (node.y ?? 0), 0) / nodes.length;
		const scale = nextDistance / previousDistance;
		for (const node of nodes) {
			node.x = centerX + ((node.x ?? centerX) - centerX) * scale;
			node.y = centerY + ((node.y ?? centerY) - centerY) * scale;
			node.vx = 0;
			node.vy = 0;
			if (Number.isFinite(node.fx)) node.fx = centerX + ((node.fx ?? centerX) - centerX) * scale;
			if (Number.isFinite(node.fy)) node.fy = centerY + ((node.fy ?? centerY) - centerY) * scale;
		}
		graph.nodeCanvasObject(graph.nodeCanvasObject());
	}

	private selectGraphNode(filePath: string): void {
		const graph = this.relationshipGraph;
		if (!graph) return;
		this.closeGraphRelationPopover();
		this.graphSelectedNodePath = filePath;
		const selectedFile = this.app.vault.getAbstractFileByPath(filePath);
		this.updateToolbarPath(selectedFile instanceof TFile ? selectedFile : this.currentFile);
		const files = graph.graphData().nodes
			.map(node => this.app.vault.getAbstractFileByPath(node.filePath))
			.filter((file): file is TFile => file instanceof TFile);
		this.applyGraphEmphasis(this.buildSearchIndex(files));
	}

	private clearGraphNodeSelection(): void {
		const graph = this.relationshipGraph;
		if (!graph || !this.graphSelectedNodePath) return;
		this.closeGraphRelationPopover();
		this.graphSelectedNodePath = '';
		this.updateToolbarPath(this.currentFile);
		const files = graph.graphData().nodes
			.map(node => this.app.vault.getAbstractFileByPath(node.filePath))
			.filter((file): file is TFile => file instanceof TFile);
		this.applyGraphEmphasis(this.buildSearchIndex(files));
	}

	private canEditGraphLink(link: WikiForceLink): boolean {
		if (!this.graphSelectedNodePath) return false;
		const sourcePath = typeof link.source === 'object' ? link.source.filePath : String(link.source);
		const targetPath = typeof link.target === 'object' ? link.target.filePath : String(link.target);
		return sourcePath === this.graphSelectedNodePath || targetPath === this.graphSelectedNodePath;
	}

	private getGraphTheme(host: HTMLElement) {
		const styles = host.ownerDocument.defaultView?.getComputedStyle(host);
		const read = (name: string, fallback: string) => styles?.getPropertyValue(name).trim() || fallback;
		return {
			text: read('--text-normal', '#d7d7d7'),
			muted: read('--text-muted', '#999999'),
			faint: read('--text-faint', '#666666'),
			background: read('--background-primary', '#202020'),
			fontFamily: styles?.fontFamily.trim() || 'system-ui, sans-serif',
		};
	}

	private getGraphRelationLabelColor(label: string, fallback: string): string {
		const colors = this.plugin.settings.wikiGraphRelationLabelColors ?? {};
		const exact = colors[label];
		if (exact) return exact;
		const normalized = label.trim().toLocaleLowerCase();
		const matchingKey = Object.keys(colors).find(key => key.trim().toLocaleLowerCase() === normalized);
		return matchingKey ? colors[matchingKey] : fallback;
	}

	private getGraphRelationVisibilityScale(): number {
		return Math.max(0.25, Math.min(2, this.plugin.settings.wikiGraphRelationVisibilityScale ?? 0.72));
	}

	private refreshGraphRelationVisibility(): void {
		const graph = this.relationshipGraph;
		if (!graph) return;
		graph.linkVisibility(graph.linkVisibility());
		graph.nodeCanvasObject(graph.nodeCanvasObject());
	}

	private hashGraphTeam(value: string): number {
		let hash = 0;
		for (let index = 0; index < value.length; index++) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
		return Math.abs(hash) % 360;
	}

	private getConvexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
		if (points.length <= 2) return points;
		const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
		const cross = (origin: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
			(a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
		const lower: Array<{ x: number; y: number }> = [];
		for (const point of sorted) {
			while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
			lower.push(point);
		}
		const upper: Array<{ x: number; y: number }> = [];
		for (let index = sorted.length - 1; index >= 0; index--) {
			const point = sorted[index];
			while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
			upper.push(point);
		}
		lower.pop();
		upper.pop();
		return lower.concat(upper);
	}

	private getGraphRegionBoundary(
		points: Array<{ x: number; y: number }>,
		teamPath: string,
		padding: number,
	): Array<{ x: number; y: number }> {
		if (points.length === 0) return [];
		if (points.length === 1) {
			const radius = padding + 18;
			return Array.from({ length: 18 }, (_, index) => {
				const angle = Math.PI * 2 * index / 18;
				return {
					x: points[0].x + Math.cos(angle) * radius,
					y: points[0].y + Math.sin(angle) * radius,
				};
			});
		}

		let hull = this.getConvexHull(points);
		if (hull.length < 3) {
			let start = points[0];
			let end = points[1];
			let maxDistance = -1;
			for (let first = 0; first < points.length; first++) {
				for (let second = first + 1; second < points.length; second++) {
					const distance = (points[first].x - points[second].x) ** 2 + (points[first].y - points[second].y) ** 2;
					if (distance <= maxDistance) continue;
					maxDistance = distance;
					start = points[first];
					end = points[second];
				}
			}
			let dx = end.x - start.x;
			let dy = end.y - start.y;
			let length = Math.hypot(dx, dy);
			if (length < 1) {
				start = { x: start.x - 20, y: start.y };
				end = { x: end.x + 20, y: end.y };
				dx = end.x - start.x;
				dy = end.y - start.y;
				length = Math.hypot(dx, dy);
			}
			const direction = this.hashGraphTeam(teamPath) % 2 === 0 ? 1 : -1;
			const virtualHeight = Math.max(54, Math.min(120, length * 0.62));
			const virtualPoint = {
				x: (start.x + end.x) / 2 - dy / length * virtualHeight * direction,
				y: (start.y + end.y) / 2 + dx / length * virtualHeight * direction,
			};
			hull = this.getConvexHull([start, end, virtualPoint]);
		}

		const center = hull.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
		center.x /= hull.length;
		center.y /= hull.length;
		return hull.map(point => {
			const dx = point.x - center.x;
			const dy = point.y - center.y;
			const length = Math.hypot(dx, dy) || 1;
			return { x: point.x + dx / length * padding, y: point.y + dy / length * padding };
		});
	}

	private isGraphPointInside(
		point: { x: number; y: number },
		polygon: Array<{ x: number; y: number }>,
	): boolean {
		let inside = false;
		for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
			const a = polygon[current];
			const b = polygon[previous];
			if ((a.y > point.y) === (b.y > point.y)) continue;
			const crossingX = (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
			if (point.x < crossingX) inside = !inside;
		}
		return inside;
	}

	private getGraphRegionLabelPosition(
		boundary: Array<{ x: number; y: number }>,
		nodes: WikiForceNode[],
		excludedBoundaries: Array<Array<{ x: number; y: number }>>,
		placedLabels: Array<{ left: number; right: number; top: number; bottom: number }>,
		label: string,
		context: CanvasRenderingContext2D,
		globalScale: number,
		fontSize: number,
	): { x: number; y: number; box: { left: number; right: number; top: number; bottom: number } } {
		const xs = boundary.map(point => point.x);
		const ys = boundary.map(point => point.y);
		const minX = Math.min(...xs);
		const maxX = Math.max(...xs);
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);
		const width = context.measureText(label).width + 10 / globalScale;
		const height = (fontSize + 6) / globalScale;
		const candidates: Array<{ x: number; y: number }> = [{
			x: boundary.reduce((sum, point) => sum + point.x, 0) / boundary.length,
			y: boundary.reduce((sum, point) => sum + point.y, 0) / boundary.length,
		}];
		const gridSize = 9;
		for (let row = 0; row < gridSize; row++) {
			for (let column = 0; column < gridSize; column++) {
				candidates.push({
					x: minX + (maxX - minX) * (column + 0.5) / gridSize,
					y: minY + (maxY - minY) * (row + 0.5) / gridSize,
				});
			}
		}

		let best: { x: number; y: number; score: number; box: { left: number; right: number; top: number; bottom: number } } | null = null;
		for (const candidate of candidates) {
			const box = {
				left: candidate.x - width / 2,
				right: candidate.x + width / 2,
				top: candidate.y - height / 2,
				bottom: candidate.y + height / 2,
			};
			const samplePoints = [
				candidate,
				{ x: box.left, y: box.top },
				{ x: box.right, y: box.top },
				{ x: box.left, y: box.bottom },
				{ x: box.right, y: box.bottom },
			];
			if (!samplePoints.every(point => this.isGraphPointInside(point, boundary))) continue;
			if (excludedBoundaries.some(child => samplePoints.some(point => this.isGraphPointInside(point, child)))) continue;
			if (placedLabels.some(placed => !(box.right < placed.left || box.left > placed.right || box.bottom < placed.top || box.top > placed.bottom))) continue;

			let nearestNode = Number.POSITIVE_INFINITY;
			let overlapsNode = false;
			for (const node of nodes) {
				const nodeX = node.x ?? 0;
				const nodeY = node.y ?? 0;
				const nearestX = Math.max(box.left, Math.min(nodeX, box.right));
				const nearestY = Math.max(box.top, Math.min(nodeY, box.bottom));
				const clearance = Math.hypot(nodeX - nearestX, nodeY - nearestY) - 23;
				if (clearance < 3 / globalScale) overlapsNode = true;
				nearestNode = Math.min(nearestNode, clearance);
			}
			if (overlapsNode) continue;
			const centerBias = -Math.hypot(candidate.x - candidates[0].x, candidate.y - candidates[0].y) * 0.04;
			const score = nearestNode + centerBias;
			if (!best || score > best.score) best = { ...candidate, score, box };
		}

		if (best) return best;
		const fallback = candidates[0];
		return {
			...fallback,
			box: {
				left: fallback.x - width / 2,
				right: fallback.x + width / 2,
				top: fallback.y - height / 2,
				bottom: fallback.y + height / 2,
			},
		};
	}

	private drawGraphTeamRegions(
		context: CanvasRenderingContext2D,
		nodes: WikiForceNode[],
		globalScale: number,
		theme: ReturnType<WikiPanel['getGraphTheme']>,
	): void {
		const groups = new Map<string, { team: WikiGraphTeam; parentPath: string | null; nodes: WikiForceNode[] }>();
		for (const node of nodes) {
			if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
			for (let depth = 0; depth < node.teamTrail.length; depth++) {
				const team = node.teamTrail[depth];
				const parentPath = depth > 0 ? node.teamTrail[depth - 1].path : null;
				const group = groups.get(team.path) ?? { team, parentPath, nodes: [] };
				group.nodes.push(node);
				groups.set(team.path, group);
			}
		}
		if (groups.size === 0) return;

		const groupList = Array.from(groups.values());
		const childrenByParent = new Map<string, typeof groupList>();
		for (const group of groupList) {
			if (!group.parentPath) continue;
			const children = childrenByParent.get(group.parentPath) ?? [];
			children.push(group);
			childrenByParent.set(group.parentPath, children);
		}
		const boundaries = new Map<string, Array<{ x: number; y: number }>>();
		for (const group of [...groupList].sort((a, b) => b.team.depth - a.team.depth)) {
			const points = group.nodes.map(node => ({ x: node.x ?? 0, y: node.y ?? 0 }));
			for (const child of childrenByParent.get(group.team.path) ?? []) {
				points.push(...(boundaries.get(child.team.path) ?? []));
			}
			const padding = Math.max(22, 32 - group.team.depth * 5);
			boundaries.set(group.team.path, this.getGraphRegionBoundary(points, group.team.path, padding));
		}

		const placedLabels: Array<{ left: number; right: number; top: number; bottom: number }> = [];
		for (const group of groupList.sort((a, b) => a.team.depth - b.team.depth)) {
			const { team, nodes: teamNodes } = group;
			const boundary = boundaries.get(team.path) ?? [];
			if (boundary.length < 3) continue;
			const hue = this.hashGraphTeam(team.path);
			const fillAlpha = Math.min(0.2, 0.11 + team.depth * 0.035);
			const strokeAlpha = Math.min(0.72, 0.46 + team.depth * 0.08);
			context.save();
			context.fillStyle = `hsla(${hue}, 58%, 52%, ${fillAlpha})`;
			context.strokeStyle = `hsla(${hue}, 62%, 55%, ${strokeAlpha})`;
			context.lineWidth = 1 / globalScale;
			context.beginPath();
			context.moveTo(boundary[0].x, boundary[0].y);
			for (let index = 1; index < boundary.length; index++) context.lineTo(boundary[index].x, boundary[index].y);
			context.closePath();
			context.fill();
			context.stroke();

			const fontSize = team.depth === 0 ? 13 : 12;
			context.fillStyle = `hsla(${hue}, 70%, 62%, 0.9)`;
			context.font = `${team.depth === 0 ? 700 : 650} ${fontSize / globalScale}px ${theme.fontFamily}`;
			const excludedBoundaries = (childrenByParent.get(team.path) ?? [])
				.map(child => boundaries.get(child.team.path) ?? [])
				.filter(child => child.length >= 3);
			const labelPosition = this.getGraphRegionLabelPosition(
				boundary,
				teamNodes,
				excludedBoundaries,
				placedLabels,
				team.name,
				context,
				globalScale,
				fontSize,
			);
			placedLabels.push(labelPosition.box);
			context.textAlign = 'center';
			context.textBaseline = 'middle';
			context.fillText(team.name, labelPosition.x, labelPosition.y);
			context.restore();
		}
	}

	private drawGraphMapPin(
		context: CanvasRenderingContext2D,
		x: number,
		y: number,
		globalScale: number,
		color: string,
	): void {
		const size = 17 / globalScale;
		const scale = size / 24;
		const bottom = y - 25 - 3 / globalScale;
		context.save();
		context.translate(x - 12 * scale, bottom - 22 * scale);
		context.scale(scale, scale);
		context.strokeStyle = color;
		context.lineWidth = 1.8 / globalScale / scale;
		context.lineCap = 'round';
		context.lineJoin = 'round';
		context.beginPath();
		context.moveTo(20, 10);
		context.bezierCurveTo(20, 15, 12, 22, 12, 22);
		context.bezierCurveTo(12, 22, 4, 15, 4, 10);
		context.bezierCurveTo(4, 5.58, 7.58, 2, 12, 2);
		context.bezierCurveTo(16.42, 2, 20, 5.58, 20, 10);
		context.stroke();
		context.beginPath();
		context.arc(12, 10, 3, 0, Math.PI * 2);
		context.stroke();
		context.restore();
	}

	private drawGraphNode(
		node: WikiForceNode,
		context: CanvasRenderingContext2D,
		globalScale: number,
		theme: ReturnType<WikiPanel['getGraphTheme']>,
	): void {
		if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
		const x = node.x ?? 0;
		const y = node.y ?? 0;
		const radius = 21;
		context.save();
		context.globalAlpha = node.dimmed ? 0.14 : 1;
		context.beginPath();
		context.arc(x, y, radius, 0, Math.PI * 2);
		context.clip();
		if (node.image?.complete && node.image.naturalWidth > 0) {
			const sourceRatio = node.image.naturalWidth / node.image.naturalHeight;
			const size = radius * 2;
			let width = size;
			let height = size;
			if (sourceRatio > 1) width = size * sourceRatio;
			else height = size / Math.max(sourceRatio, 0.01);
			context.drawImage(node.image, x - width / 2, y - height / 2, width, height);
		} else {
			context.fillStyle = theme.background;
			context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
			context.fillStyle = node.color;
			context.font = `700 ${radius * 0.9}px ${theme.fontFamily}`;
			context.textAlign = 'center';
			context.textBaseline = 'middle';
			context.fillText(node.name.slice(0, 1), x, y + 1);
		}
		context.restore();

		context.save();
		context.globalAlpha = node.dimmed ? 0.14 : 1;
		context.beginPath();
		context.arc(x, y, radius, 0, Math.PI * 2);
		context.strokeStyle = node.color;
		context.lineWidth = 2.5 / globalScale;
		context.stroke();
		if (node.selected) this.drawGraphMapPin(context, x, y, globalScale, node.color);
		if (globalScale >= 0.48) {
			context.fillStyle = theme.text;
			context.font = `600 ${12 / globalScale}px ${theme.fontFamily}`;
			context.textAlign = 'center';
			context.textBaseline = 'top';
			context.fillText(node.name, x, y + radius + 6 / globalScale, 132 / globalScale);
		}
		context.restore();
	}

	private getGraphRelationLayouts(
		link: WikiForceLink,
		context: CanvasRenderingContext2D,
		globalScale: number,
		fontFamily: string,
	): WikiGraphRelationLayout[] {
		if (globalScale < this.getGraphRelationVisibilityScale()) return [];
		if (typeof link.source !== 'object' || typeof link.target !== 'object') return [];
		const source = link.source;
		const target = link.target;
		if (![source.x, source.y, target.x, target.y].every(value => Number.isFinite(value))) return [];
		const sx = source.x ?? 0;
		const sy = source.y ?? 0;
		const tx = target.x ?? 0;
		const ty = target.y ?? 0;
		const displayLabels = link.labels.filter((label, index, all) =>
			all.findIndex(item => item.key === label.key
				&& item.text === label.text
				&& item.fromPath === label.fromPath
				&& item.toPath === label.toPath) === index);
		const forward = displayLabels.filter(label => label.fromPath === source.id && label.toPath === target.id);
		const reverse = displayLabels.filter(label => label.fromPath === target.id && label.toPath === source.id);
		const dx = tx - sx;
		const dy = ty - sy;
		const lineLength = Math.hypot(dx, dy);
		if (lineLength < 0.01 || displayLabels.length === 0) return [];
		const unitX = dx / lineLength;
		const unitY = dy / lineLength;
		const relationGroups = link.bidirectional
			? [{ labels: forward, side: 1, direction: 1 }, { labels: reverse, side: -1, direction: -1 }]
			: [{ labels: displayLabels, side: 1, direction: 1 }];
		const getRelationEnd = (direction: number) => {
			const destination = direction > 0 ? target : source;
			const destinationX = direction > 0 ? tx : sx;
			const destinationY = direction > 0 ? ty : sy;
			const radius = 21;
			const distanceFromNode = Math.min(radius + 4 / globalScale, lineLength * 0.34);
			return {
				x: destinationX - unitX * direction * distanceFromNode,
				y: destinationY - unitY * direction * distanceFromNode,
			};
		};
		const rawAngle = Math.atan2(ty - sy, tx - sx);
		let angle = rawAngle;
		const angleFlipped = angle > Math.PI / 2 || angle < -Math.PI / 2;
		if (angleFlipped) angle += Math.PI;
		const layouts: WikiGraphRelationLayout[] = [];
		context.save();
		context.font = `650 ${11 / globalScale}px ${fontFamily}`;
		for (const group of relationGroups) {
			if (group.labels.length === 0) continue;
			const separator = ' · ';
			const labelWidths = group.labels.map(label => context.measureText(label.text).width);
			const separatorWidth = context.measureText(separator).width;
			const labelsWidth = labelWidths.reduce((sum, width) => sum + width, 0)
				+ separatorWidth * Math.max(0, group.labels.length - 1);
			const iconWidth = 7 / globalScale;
			const iconGap = 4 / globalScale;
			const totalWidth = labelsWidth + iconGap + iconWidth;
			const relationEnd = getRelationEnd(group.direction);
			const directionX = unitX * group.direction;
			const directionY = unitY * group.direction;
			const alongOffset = totalWidth / 2 + 6 / globalScale;
			let labelX = relationEnd.x - directionX * alongOffset;
			let labelY = relationEnd.y - directionY * alongOffset;
			const perpendicularOffset = (link.bidirectional ? 9 : 8) * group.side / globalScale;
			labelX -= unitY * perpendicularOffset;
			labelY += unitX * perpendicularOffset;
			layouts.push({
				labels: group.labels,
				labelWidths,
				separatorWidth,
				iconWidth,
				iconGap,
				totalWidth,
				x: labelX,
				y: labelY,
				angle,
				visualDirection: group.direction * (angleFlipped ? -1 : 1),
			});
		}
		context.restore();
		return layouts;
	}

	private drawGraphLinkOverlay(
		link: WikiForceLink,
		context: CanvasRenderingContext2D,
		globalScale: number,
		theme: ReturnType<WikiPanel['getGraphTheme']>,
	): void {
		const layouts = this.getGraphRelationLayouts(link, context, globalScale, theme.fontFamily);
		if (layouts.length === 0) return;
		context.save();
		context.globalAlpha = link.dimmed ? 0.12 : 0.88;
		for (const layout of layouts) {
			const { labels, labelWidths, separatorWidth, iconWidth, iconGap, totalWidth, x, y, angle, visualDirection } = layout;
			const separator = ' · ';
			context.font = `650 ${11 / globalScale}px ${theme.fontFamily}`;
				const iconOnLeft = visualDirection < 0;
				context.save();
				context.translate(x, y);
				context.rotate(angle);
				let cursorX = -totalWidth / 2;
				context.textAlign = 'left';
				context.textBaseline = 'middle';
				const drawChevron = (centerX: number, direction: number, color: string) => {
					const chevronWidth = 3.5 / globalScale;
					const chevronHeight = 7 / globalScale;
					context.save();
					context.strokeStyle = color;
					context.lineWidth = 1.5 / globalScale;
					context.lineCap = 'round';
					context.lineJoin = 'round';
					context.beginPath();
					context.moveTo(centerX - direction * chevronWidth / 2, -chevronHeight / 2);
					context.lineTo(centerX + direction * chevronWidth / 2, 0);
					context.lineTo(centerX - direction * chevronWidth / 2, chevronHeight / 2);
					context.stroke();
					context.restore();
				};
				const getLabelColor = (label: WikiGraphRelationLabel) => {
					const fallback = theme.faint;
					return link.dimmed ? theme.faint : this.getGraphRelationLabelColor(label.key, fallback);
				};
				if (iconOnLeft) {
					drawChevron(cursorX + iconWidth / 2, visualDirection, getLabelColor(labels[0]));
					cursorX += iconWidth + iconGap;
				}
				labels.forEach((label, index) => {
					context.fillStyle = getLabelColor(label);
					context.fillText(label.text, cursorX, 0);
					cursorX += labelWidths[index];
					if (index >= labels.length - 1) return;
					context.fillStyle = link.dimmed ? theme.faint : theme.muted;
					context.fillText(separator, cursorX, 0);
					cursorX += separatorWidth;
				});
				if (!iconOnLeft) {
					cursorX += iconGap;
					drawChevron(cursorX + iconWidth / 2, visualDirection, getLabelColor(labels[labels.length - 1]));
				}
				context.restore();
		}
		context.restore();
	}

	private paintGraphLinkPointerArea(
		link: WikiForceLink,
		color: string,
		context: CanvasRenderingContext2D,
		globalScale: number,
		fontFamily: string,
	): void {
		if (typeof link.source !== 'object' || typeof link.target !== 'object') return;
		if (![link.source.x, link.source.y, link.target.x, link.target.y]
			.every(value => Number.isFinite(value))) return;
		context.strokeStyle = color;
		context.lineWidth = 14 / globalScale;
		context.beginPath();
		context.moveTo(link.source.x ?? 0, link.source.y ?? 0);
		context.lineTo(link.target.x ?? 0, link.target.y ?? 0);
		context.stroke();

		context.fillStyle = color;
		for (const layout of this.getGraphRelationLayouts(link, context, globalScale, fontFamily)) {
			const horizontalPadding = 6 / globalScale;
			const hitHeight = 22 / globalScale;
			context.save();
			context.translate(layout.x, layout.y);
			context.rotate(layout.angle);
			context.fillRect(
				-layout.totalWidth / 2 - horizontalPadding,
				-hitHeight / 2,
				layout.totalWidth + horizontalPadding * 2,
				hitHeight,
			);
			context.restore();
		}
	}

	private createGraphTeamForce(): WikiTeamForce {
		let nodes: WikiForceNode[] = [];
		let topGroups: string[] = [];
		let childrenByParent = new Map<string, string[]>();
		const force = ((alpha: number) => {
			if (topGroups.length === 0) return;
			const physics = this.getGraphPhysics();
			const orbit = topGroups.length > 1
				? Math.min(420, Math.max(90, physics.linkDistance * 0.72 + topGroups.length * 7))
				: 0;
			const anchors = new Map<string, { x: number; y: number }>();
			topGroups.forEach((group, index) => {
				const angle = topGroups.length === 1 ? 0 : -Math.PI / 2 + Math.PI * 2 * index / topGroups.length;
				anchors.set(group, { x: Math.cos(angle) * orbit, y: Math.sin(angle) * orbit * 0.72 });
			});
			for (const node of nodes) {
				const topTeam = node.teamTrail[0];
				const topAnchor = topTeam ? anchors.get(topTeam.path) : undefined;
				if (!topAnchor) continue;
				const anchor = { ...topAnchor };
				for (let depth = 1; depth < node.teamTrail.length; depth++) {
					const parent = node.teamTrail[depth - 1];
					const team = node.teamTrail[depth];
					const siblings = childrenByParent.get(parent.path) ?? [team.path];
					const index = Math.max(0, siblings.indexOf(team.path));
					const angle = -Math.PI / 2 + Math.PI * 2 * index / Math.max(1, siblings.length);
					const radius = Math.max(42, physics.linkDistance * 0.36) / Math.pow(1.45, depth - 1);
					anchor.x += Math.cos(angle) * radius;
					anchor.y += Math.sin(angle) * radius * 0.78;
				}
				node.vx = (node.vx ?? 0) + (anchor.x - (node.x ?? 0)) * 0.1 * alpha;
				node.vy = (node.vy ?? 0) + (anchor.y - (node.y ?? 0)) * 0.1 * alpha;
			}
		}) as WikiTeamForce;
		force.initialize = nextNodes => {
			nodes = nextNodes;
			topGroups = Array.from(new Set(nodes.map(node => node.teamTrail[0]?.path).filter((path): path is string => Boolean(path))))
				.sort((a, b) => a.localeCompare(b));
			const childSets = new Map<string, Set<string>>();
			for (const node of nodes) {
				for (let depth = 1; depth < node.teamTrail.length; depth++) {
					const parentPath = node.teamTrail[depth - 1].path;
					const children = childSets.get(parentPath) ?? new Set<string>();
					children.add(node.teamTrail[depth].path);
					childSets.set(parentPath, children);
				}
			}
			childrenByParent = new Map(Array.from(childSets, ([path, children]) => [path, Array.from(children).sort((a, b) => a.localeCompare(b))]));
		};
		return force;
	}

	private renderGraphControls(panel: HTMLElement, files: TFile[]): void {
		const entries = this.buildSearchIndex(files);
		const controls = panel.createDiv({ cls: 'wiki-graph-controls' });
		const segment = controls.createDiv({ cls: 'wiki-graph-control-seg' });
		const thumb = segment.createDiv({ cls: 'wiki-graph-control-thumb' });
		type GraphControlPanel = 'path' | 'search' | 'style' | 'settings';
		const buttons = new Map<GraphControlPanel, HTMLButtonElement>();
		const panels = new Map<GraphControlPanel, HTMLElement>();
		let openPanel: GraphControlPanel | null = null;
		const syncThumb = (button: HTMLButtonElement) => {
			thumb.setCssProps({
				'--wiki-graph-control-x': `${button.offsetLeft}px`,
				'--wiki-graph-control-width': `${button.offsetWidth}px`,
				'--wiki-graph-control-height': `${button.offsetHeight}px`,
			});
		};
		const setOpenPanel = (next: GraphControlPanel | null) => {
			openPanel = next === openPanel ? null : next;
			for (const [key, button] of buttons) {
				const active = key === openPanel;
				button.setAttribute('aria-pressed', String(active));
				panels.get(key)?.toggleClass('is-open', active);
				if (active) syncThumb(button);
			}
			thumb.toggleClass('is-visible', openPanel !== null);
			if (openPanel === 'search') {
				window.requestAnimationFrame(() => {
					const input = panels.get('search')?.querySelector<HTMLInputElement>('.wiki-graph-filter-input');
					input?.focus({ preventScroll: true });
					input?.setSelectionRange(input.value.length, input.value.length);
				});
			}
		};
		for (const item of [
			{ key: 'path' as const, label: '경로' },
			{ key: 'search' as const, label: '검색' },
			{ key: 'style' as const, label: '속성' },
			{ key: 'settings' as const, label: '설정' },
		]) {
			const button = segment.createEl('button', {
				text: item.label,
				attr: { type: 'button', 'aria-pressed': 'false' },
			});
			buttons.set(item.key, button);
			button.addEventListener('click', event => {
				event.stopPropagation();
				setOpenPanel(item.key);
			});
		}

		const panelHost = controls.createDiv({ cls: 'wiki-graph-control-panels' });
		const queueSettingsSave = () => {
			window.clearTimeout(this.graphSettingTimer);
			this.graphSettingTimer = window.setTimeout(() => void this.plugin.saveData(this.plugin.settings), 160);
		};
		const pathPanel = panelHost.createDiv({ cls: 'wiki-graph-control-panel wiki-graph-path-panel' });
		panels.set('path', pathPanel);
		const graphPath = pathPanel.createSpan({ cls: 'wiki-bc-path wiki-graph-bc-path' });
		this.renderBreadcrumb(
			graphPath,
			this.graphRootFolder ? (this.graphRootFolder.path || 'Vault') : '',
			'경로를 지정해주십시오',
		);
		graphPath.addEventListener('click', event => {
			event.stopPropagation();
			this.openGraphRootPicker();
		});

		const searchPanel = panelHost.createDiv({ cls: 'wiki-graph-control-panel wiki-graph-search-panel' });
		panels.set('search', searchPanel);
		const searchBox = searchPanel.createDiv({ cls: 'wiki-graph-filter-box' });
		const searchIcon = searchBox.createSpan({ cls: 'wiki-graph-filter-icon' });
		setIcon(searchIcon, 'search');
		const searchInput = searchBox.createEl('input', {
			cls: 'wiki-graph-filter-input',
			attr: {
				type: 'search',
				placeholder: '검색...',
				spellcheck: 'false',
				'aria-label': '위키 그래프 검색',
			},
		});
		searchInput.value = this.graphSearchQuery;
		const searchInfo = searchBox.createEl('button', {
			cls: 'wiki-graph-filter-info',
			attr: { type: 'button', 'aria-label': '검색 구문' },
		});
		setIcon(searchInfo, 'info');
		const searchHelp = searchPanel.createDiv({ cls: 'wiki-graph-search-help' });
		const addSearchHelp = (syntax: string, description: string) => {
			const row = searchHelp.createDiv({ cls: 'wiki-graph-search-help-row' });
			row.createEl('strong', { text: syntax });
			row.createSpan({ text: description });
		};
		addSearchHelp('word', '파일 이름 또는 별칭');
		addSearchHelp('.key', '속성 키');
		addSearchHelp('.key:value', '속성값');
		addSearchHelp('#tag', '태그');
		addSearchHelp('and / or', '태그·속성 조건 조합');
		searchInfo.addEventListener('click', event => {
			event.stopPropagation();
			searchHelp.toggleClass('is-open', !searchHelp.hasClass('is-open'));
		});
		searchInput.addEventListener('input', () => {
			this.closeGraphRelationPopover();
			this.graphSearchQuery = searchInput.value;
			this.graphSelectedNodePath = '';
			this.applyGraphEmphasis(entries);
		});

		const stylePanel = panelHost.createDiv({ cls: 'wiki-graph-control-panel wiki-graph-style-panel' });
		panels.set('style', stylePanel);
		const notifyGraphStyleChange = () => {
			const EventConstructor = panel.ownerDocument.defaultView?.Event;
			if (EventConstructor) panel.ownerDocument.dispatchEvent(new EventConstructor('writing-menu-wiki-graph-style-change'));
		};
		const setRelationFields = (fields: string[]) => {
			this.plugin.settings.wikiRelationFields = Array.from(new Set(fields.map(field => field.trim()).filter(Boolean))).join(', ');
		};
		const configuredFields = this.getRelationFields();
		const propertyKeys = Array.from(new Set([
			...configuredFields,
			...Object.keys(this.plugin.settings.wikiGraphRelationLabelColors ?? {}),
		]));
		if (propertyKeys.join('\u0000') !== configuredFields.join('\u0000')) {
			setRelationFields(propertyKeys);
			queueSettingsSave();
		}
		const renderColorRow = (storedKey: string, storedColor: string, before?: HTMLElement) => {
			let currentKey = storedKey;
			const row = stylePanel.createDiv({ cls: 'wiki-graph-style-row' });
			if (before) stylePanel.insertBefore(row, before);
			const colorInput = row.createEl('input', {
				cls: 'wiki-graph-style-color',
				attr: { type: 'color', value: storedColor, 'aria-label': `${storedKey} 색상` },
			});
			const keyInput = row.createEl('input', {
				cls: 'wiki-graph-style-key',
				attr: { type: 'text', value: storedKey, placeholder: '속성', 'aria-label': '관계 속성' },
			});
			const deleteButton = row.createEl('button', {
				cls: 'wiki-graph-style-action',
				text: '삭제',
				attr: { type: 'button', 'aria-label': '관계 속성 삭제' },
			});
			keyInput.addEventListener('change', () => {
				const nextKey = keyInput.value.trim();
				if (!nextKey) {
					keyInput.value = currentKey;
					return;
				}
				if (nextKey === currentKey) return;
				if (this.getRelationFields().some(field => field === nextKey && field !== currentKey)) {
					keyInput.value = currentKey;
					new Notice('이미 추가된 속성입니다.');
					return;
				}
				const colors = { ...(this.plugin.settings.wikiGraphRelationLabelColors ?? {}) };
				const color = colors[currentKey] ?? colorInput.value;
				delete colors[currentKey];
				colors[nextKey] = color;
				setRelationFields(this.getRelationFields().map(field => field === currentKey ? nextKey : field));
				currentKey = nextKey;
				this.plugin.settings.wikiGraphRelationLabelColors = colors;
				colorInput.setAttribute('aria-label', `${nextKey} 색상`);
				queueSettingsSave();
				notifyGraphStyleChange();
				void this.refreshGraphRelations();
			});
			colorInput.addEventListener('input', () => {
				this.plugin.settings.wikiGraphRelationLabelColors = {
					...(this.plugin.settings.wikiGraphRelationLabelColors ?? {}),
					[currentKey]: colorInput.value,
				};
				queueSettingsSave();
				notifyGraphStyleChange();
			});
			deleteButton.addEventListener('click', () => {
				const colors = { ...(this.plugin.settings.wikiGraphRelationLabelColors ?? {}) };
				delete colors[currentKey];
				this.plugin.settings.wikiGraphRelationLabelColors = colors;
				setRelationFields(this.getRelationFields().filter(field => field !== currentKey));
				row.remove();
				queueSettingsSave();
				notifyGraphStyleChange();
				void this.refreshGraphRelations();
			});
		};
		for (const key of propertyKeys) {
			renderColorRow(key, this.plugin.settings.wikiGraphRelationLabelColors?.[key] ?? '#888888');
		}
		const addRow = stylePanel.createDiv({ cls: 'wiki-graph-style-row is-add' });
		const addColorInput = addRow.createEl('input', {
			cls: 'wiki-graph-style-color',
			attr: { type: 'color', value: '#888888', 'aria-label': '추가할 속성 색상' },
		});
		const addKeyInput = addRow.createEl('input', {
			cls: 'wiki-graph-style-key',
			attr: { type: 'text', placeholder: '속성', 'aria-label': '추가할 관계 속성' },
		});
		const addButton = addRow.createEl('button', {
			cls: 'wiki-graph-style-action',
			text: '추가',
			attr: { type: 'button', 'aria-label': '관계 속성 추가' },
		});
		const addColorSetting = () => {
			const key = addKeyInput.value.trim();
			if (!key) {
				addKeyInput.focus();
				return;
			}
			if (this.getRelationFields().includes(key)) {
				new Notice('이미 추가된 속성입니다.');
				addKeyInput.select();
				return;
			}
			this.plugin.settings.wikiGraphRelationLabelColors = {
				...(this.plugin.settings.wikiGraphRelationLabelColors ?? {}),
				[key]: addColorInput.value,
			};
			setRelationFields([...this.getRelationFields(), key]);
			renderColorRow(key, addColorInput.value, addRow);
			addKeyInput.value = '';
			queueSettingsSave();
			notifyGraphStyleChange();
			void this.refreshGraphRelations();
		};
		addButton.addEventListener('click', addColorSetting);
		addKeyInput.addEventListener('keydown', event => {
			if (event.key !== 'Enter') return;
			event.preventDefault();
			addColorSetting();
		});

		const settingsPanel = panelHost.createDiv({ cls: 'wiki-graph-control-panel wiki-graph-settings-panel' });
		panels.set('settings', settingsPanel);
		const createSlider = (
			label: string,
			value: number,
			min: number,
			max: number,
			step: number,
			onInput: (next: number) => void,
			onCommit?: (next: number) => void,
		) => {
			const row = settingsPanel.createDiv({ cls: 'wiki-graph-setting-row' });
			const head = row.createDiv({ cls: 'wiki-graph-setting-head' });
			head.createSpan({ text: label });
			const valueEl = head.createSpan({ cls: 'wiki-graph-setting-value' });
			const track = row.createDiv({ cls: 'wiki-graph-setting-slider' });
			const fill = track.createDiv({ cls: 'wiki-graph-setting-fill' });
			const input = track.createEl('input', {
				attr: {
					type: 'range',
					min: String(min),
					max: String(max),
					step: String(step),
					'aria-label': label,
				},
			});
			const update = (next: number) => {
				const clamped = Math.max(min, Math.min(max, next));
				input.value = String(clamped);
				valueEl.setText(`${clamped.toFixed(2)}×`);
				fill.setCssProps({ '--wiki-graph-slider-progress': `${(clamped - min) / (max - min) * 100}%` });
			};
			update(value);
			input.addEventListener('input', () => {
				const next = Number(input.value);
				update(next);
				onInput(next);
			});
			input.addEventListener('change', () => {
				const next = Number(input.value);
				onCommit?.(next);
				queueSettingsSave();
			});
		};
		createSlider('장력', this.plugin.settings.wikiGraphNodeDistance ?? 1.25, 0.6, 2.6, 0.05, value => {
			const previous = this.plugin.settings.wikiGraphNodeDistance ?? 1.25;
			this.plugin.settings.wikiGraphNodeDistance = value;
			this.applyGraphPhysics(value, false);
			this.scaleGraphLayout(previous, value);
		});
		createSlider('텍스트 표시 시작점', this.getGraphRelationVisibilityScale(), 0.25, 2, 0.05, value => {
			this.plugin.settings.wikiGraphRelationVisibilityScale = value;
			this.refreshGraphRelationVisibility();
		});

		controls.addEventListener('pointerdown', event => event.stopPropagation());
		panel.addEventListener('pointerdown', event => {
			if (event.target instanceof Node && !controls.contains(event.target)) setOpenPanel(null);
		});
	}

	private async renderRelationshipGraph(outerContainer: HTMLElement, renderSeq: number): Promise<void> {
		const panel = outerContainer.createDiv({ cls: 'wiki-relation-graph-panel is-workspace' });
		const files = this.graphRootFolder ? this.getGraphFiles() : [];
		this.renderGraphControls(panel, files);
		if (!this.graphRootFolder) {
			const empty = panel.createDiv({ cls: 'wiki-graph-empty' });
			setIcon(empty.createSpan({ cls: 'wiki-graph-empty-icon' }), 'git-fork');
			empty.createSpan({ text: '관계도를 만들 루트 폴더를 선택하세요.' });
			const selectButton = empty.createEl('button', { cls: 'mod-cta', text: '폴더 선택', attr: { type: 'button' } });
			selectButton.addEventListener('click', () => this.openGraphRootPicker());
			return;
		}

		if (files.length === 0) {
			const empty = panel.createDiv({ cls: 'wiki-graph-empty' });
			setIcon(empty.createSpan({ cls: 'wiki-graph-empty-icon' }), 'users');
			empty.createSpan({ text: '루트 폴더에 마크다운 노트가 없습니다.' });
			return;
		}
		const source = this.getGraphAnchorFile(files);
		const host = panel.createDiv({ cls: 'wiki-relation-graph' });
		const loading = host.createDiv({ cls: 'wiki-graph-empty', text: '관계 정보를 불러오는 중…' });
		const model = await this.buildRelationshipGraphModel(source);
		if (this.renderSeq !== renderSeq || !host.isConnected) return;
		loading.remove();
		if (model.connections.length === 0) panel.createDiv({ cls: 'wiki-graph-no-relations', text: '등록된 관계가 없습니다.' });
		void this.mountRelationshipGraph(host, source, model, renderSeq);
	}

	private async mountRelationshipGraph(host: HTMLElement, source: TFile, model: WikiGraphModel, renderSeq: number): Promise<void> {
		try {
			const data = this.toForceGraphData(source, model);
			let theme = this.getGraphTheme(host);
			const graph = new ForceGraph<WikiForceNode, WikiForceLink>(host);
			let initialViewApplied = false;
			const applyInitialView = () => {
				if (initialViewApplied || this.relationshipGraph !== graph || !host.isConnected) return;
				const selectedNode = data.nodes.find(node => node.filePath === this.graphSelectedNodePath);
				if (selectedNode && Number.isFinite(selectedNode.x) && Number.isFinite(selectedNode.y)) {
					initialViewApplied = true;
					const currentZoom = graph.zoom();
					const targetZoom = Number.isFinite(currentZoom)
						? Math.max(1.35, Math.min(2.2, currentZoom))
						: 1.35;
					graph.centerAt(selectedNode.x, selectedNode.y, 460);
					graph.zoom(targetZoom, 460);
					return;
				}
				initialViewApplied = true;
				graph.zoomToFit(420, 54);
			};
			graph
				.width(Math.max(1, host.clientWidth))
				.height(Math.max(1, host.clientHeight))
				.backgroundColor('rgba(0,0,0,0)')
				.nodeLabel(node => node.name)
				.nodeCanvasObject((node, context, globalScale) => this.drawGraphNode(node, context, globalScale, theme))
				.nodePointerAreaPaint((node, color, context) => {
					if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
					context.fillStyle = color;
					context.beginPath();
					context.arc(node.x ?? 0, node.y ?? 0, 24, 0, Math.PI * 2);
					context.fill();
				})
				.linkLabel(link => link.labels
					.filter((label, index, all) => all.findIndex(item => item.key === label.key && item.text === label.text) === index)
					.map(label => label.text)
					.join(' · '))
				.linkVisibility(() => this.graphZoomScale >= this.getGraphRelationVisibilityScale())
				.linkColor(link => link.dimmed ? theme.faint : theme.muted)
				.linkWidth(link => link.dimmed ? 0.55 : 1.25)
				.linkHoverPrecision(14)
				.linkPointerAreaPaint((link, color, context, globalScale) =>
					this.paintGraphLinkPointerArea(link, color, context, globalScale, theme.fontFamily))
				.linkLineDash(link => link.dashed ? [6, 4] : null)
				.linkDirectionalArrowLength(() => 0)
				.linkDirectionalArrowColor(link => link.dimmed ? theme.faint : theme.muted)
				.linkCanvasObjectMode(() => 'after')
				.linkCanvasObject((link, context, globalScale) => this.drawGraphLinkOverlay(link, context, globalScale, theme))
				.onRenderFramePre((context, globalScale) =>
					this.drawGraphTeamRegions(context, graph.graphData().nodes, globalScale, theme))
				.enableNodeDrag(true)
				.enableZoomInteraction(true)
				.enablePanInteraction(true)
				.minZoom(0.15)
				.maxZoom(8)
				.onZoom(transform => {
					this.graphZoomScale = transform.k;
					graph.linkVisibility(graph.linkVisibility());
				})
				.d3AlphaDecay(0.018)
				.d3VelocityDecay(0.28)
				.cooldownTime(model.files.length > 180 ? 10000 : 7000)
				.onNodeClick((node, event) => {
					const file = this.app.vault.getAbstractFileByPath(node.filePath);
					if (!(file instanceof TFile)) return;
					if (event.ctrlKey || event.metaKey || this.graphSelectedNodePath === node.filePath) {
						this.graphActive = false;
						this.navigateToWikiFile(file);
						return;
					}
					this.selectGraphNode(node.filePath);
				})
				.onBackgroundClick(() => this.clearGraphNodeSelection())
				.onLinkClick((link, event) => {
					event.stopPropagation();
					if (!this.canEditGraphLink(link)) return;
					this.chooseRelationLabel(link, event, host);
				})
				.onNodeDrag(() => {
					// force-graph가 드래그 중 simulation을 다시 데우므로 연결된 노드도 자연스럽게 반응한다.
				})
				.onNodeDragEnd(node => {
					node.fx = undefined;
					node.fy = undefined;
				})
				.onEngineStop(applyInitialView)
				.graphData(data);
			if (this.renderSeq !== renderSeq || !host.isConnected) {
				graph._destructor();
				return;
			}
			this.relationshipGraph = graph;
			const refreshGraphTheme = () => {
				if (this.relationshipGraph !== graph || !host.isConnected) return;
				theme = this.getGraphTheme(host);
				graph.nodeCanvasObject(graph.nodeCanvasObject());
			};
			this.graphThemeObserver = new MutationObserver(refreshGraphTheme);
			const themeObserverOptions: MutationObserverInit = {
				attributes: true,
				attributeFilter: ['class', 'style', 'data-theme'],
			};
			this.graphThemeObserver.observe(host.ownerDocument.body, themeObserverOptions);
			this.graphThemeObserver.observe(host.ownerDocument.documentElement, themeObserverOptions);
			host.ownerDocument.addEventListener('writing-menu-wiki-graph-style-change', refreshGraphTheme);
			this.graphStyleCleanup = () => host.ownerDocument.removeEventListener('writing-menu-wiki-graph-style-change', refreshGraphTheme);
			graph.d3Force('team', this.createGraphTeamForce());
			this.applyGraphPhysics();
			window.setTimeout(() => {
				applyInitialView();
			}, 520);

			for (const node of data.nodes) {
				if (!node.imageSrc) continue;
				const image = new host.ownerDocument.defaultView!.Image();
				image.decoding = 'async';
				image.onload = () => {
					if (this.relationshipGraph === graph) graph.nodeCanvasObject(graph.nodeCanvasObject());
				};
				image.src = node.imageSrc;
				node.image = image;
			}

			this.graphResizeObserver = new ResizeObserver(entries => {
				if (this.relationshipGraph !== graph) return;
				const box = entries[0]?.contentRect;
				if (!box || box.width <= 0 || box.height <= 0) return;
				graph.width(box.width).height(box.height);
			});
			this.graphResizeObserver.observe(host);
			this.applyGraphEmphasis(this.buildSearchIndex(model.files));
		} catch (error) {
			if (this.renderSeq !== renderSeq || !host.isConnected) return;
			host.empty();
			host.createDiv({ cls: 'wiki-graph-error', text: '관계 그래프를 불러오지 못했습니다.' });
			console.error('[writing-menu] Failed to render relationship graph', error);
		}
	}

	/** 관계 값은 옵시디언이 추적할 수 있는 순수 위키링크로 유지한다. */
	private resolveRelationships(
		value: unknown,
		srcPath: string,
		field: string,
		inlineComments?: Map<string, string>,
	): Array<{ file: TFile; label: WikiGraphRelationLabel }> {
		const raw: string[] = [];
		const appendText = (input: unknown) => {
			for (const part of String(input ?? '').split(',')) {
				const token = part.trim();
				if (token) raw.push(token);
			}
		};
		const append = (input: unknown) => {
			if (Array.isArray(input)) {
				for (const item of input) append(item);
				return;
			}
			appendText(input);
		};
		append(value);

		const out: Array<{ file: TFile; label: WikiGraphRelationLabel }> = [];
		const seen = new Set<string>();
		for (const item of raw) {
			const wikiLink = item.match(/^\[\[(.*?)\]\]$/);
			const linkpath = wikiLink ? wikiLink[1].split('|')[0].trim() : item;
			const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, srcPath);
			if (!(file instanceof TFile)) continue;
			const label = {
				key: field,
				text: inlineComments?.get(`${field}\u0000${file.path}`) || field,
				fromPath: srcPath,
				toPath: file.path,
			};
			const identity = `${file.path}\u0000${label.key}\u0000${label.text}`;
			if (seen.has(identity)) continue;
			seen.add(identity);
			out.push({ file, label });
		}
		return out;
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
			void MarkdownRenderer.render(this.app, h.heading, textSpan, file.path, this.hostComponent);
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
		pCon.setCssProps({ '--wiki-accent-color': wc, '--wiki-accent-text': getToneColor(wc) });

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
		const genBtn = imgCon.createDiv({ cls: 'wiki-profile-genimg-btn', attr: { 'aria-label': 'AI로 이미지 생성' } });
		setIcon(genBtn, 'sparkles');
		genBtn.onclick = (e) => { e.stopPropagation(); this.openGenerateImageModal(file); };

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
			if (coloredProps.includes(k)) { valEl.addClass('wm-wiki-accent-val'); }

			if (k === 'tags') {
				const tagList: string[] = Array.isArray(v) ? v.map(item => String(item)) : String(v).split(',').map(s => s.trim()).filter(Boolean);
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
					const href = link.getAttribute('data-href') || link.getAttribute('href');
					if (href && this.openLinkInWiki(href, file.path, e)) return;
				});
			});
		}
	}

	private openImagePicker(file: TFile) {
		new ImageSuggestModal(this.app, (f) => { void (async () => {
			try {
				await applyProfileImage(this.app, this.plugin, file, f, this.container);
			} catch (e) {
				console.error('[wiki] processFrontMatter 실패:', e);
				new Notice('이미지 프론트매터 업데이트 실패. 콘솔을 확인하세요.');
			}
		})(); }).open();
	}

	private openGenerateImageModal(file: TFile) {
		if (!this.plugin.settings.aiChatGeminiApiKey && !this.plugin.settings.aiImageOpenaiApiKey) {
			new Notice('플러그인 설정 > AI 페이지에서 Google AI Studio 또는 OpenAI 키를 먼저 등록하세요.');
			return;
		}
		new GenerateImageModal(
			this.app,
			{ gemini: this.plugin.settings.aiChatGeminiApiKey, openai: this.plugin.settings.aiImageOpenaiApiKey },
			this.plugin.settings.aiImageModel,
			this.plugin.settings.aiImageAspectRatio,
			this.plugin.settings.aiImageStyleReferencePath,
			async (base64) => {
				try {
					const imgFile = await saveGeneratedProfileImage(this.app, file, base64);
					await applyProfileImage(this.app, this.plugin, file, imgFile, this.container);
				} catch (e) {
					console.error('[wiki] 이미지 저장/적용 실패:', e);
					new Notice('이미지 저장 또는 프론트매터 업데이트 실패. 콘솔을 확인하세요.');
				}
			},
		).open();
	}

	private findScrollableParent(el: HTMLElement): HTMLElement | null {
		let cur = el.parentElement;
		while (cur) {
			if (cur.scrollHeight > cur.clientHeight + 1) return cur;
			cur = cur.parentElement;
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
