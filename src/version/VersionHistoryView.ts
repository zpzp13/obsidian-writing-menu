import { ItemView, WorkspaceLeaf, setIcon, MarkdownView, MarkdownRenderer, TFile, Notice, Editor, normalizePath } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { VersionManager } from './manager';
import type { VersionEntry } from './types';
import { DiffWindow } from './DiffWindow';
import { EditVersionModal } from './EditVersionModal';

export const VERSION_HISTORY_VIEW_TYPE = 'writing-menu-version-history';

type Page = { type: 'list' } | { type: 'preview'; entry: VersionEntry };
type SortField = 'mdate' | 'cdate' | 'title' | 'filename';
type SortDir = 'asc' | 'desc';
interface DateGroup { label: string; entries: VersionEntry[]; }

export class VersionHistoryView extends ItemView {
	plugin: WritingMenuPlugin;
	private manager: VersionManager;
	private currentFile: TFile | null = null;
	private lastEditor: Editor | null = null;
	private page: Page = { type: 'list' };
	private isSearching = false;
	private searchQuery = '';
	private sortField: SortField = 'mdate';
	private sortDir: SortDir = 'desc';
	private stageFilters = new Set<string>();
	private charCountMode: 'munpia' | 'novelpia' = 'munpia';
	private collapsedGroups = new Set<string>();
	private listEl: HTMLElement | null = null;
	private allVersionsCached: VersionEntry[] = [];
	private bodyPreviewCache = new Map<string, string>();

	constructor(leaf: WorkspaceLeaf, plugin: WritingMenuPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.manager = new VersionManager(plugin.app, plugin);
	}

	getViewType() { return VERSION_HISTORY_VIEW_TYPE; }
	getDisplayText() { return '버전 기록'; }
	getIcon() { return 'history'; }

	async onOpen() {
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				const view = leaf?.view;
				if (view instanceof MarkdownView) {
					const isSameFile = view.file?.path === this.currentFile?.path;
					this.currentFile = view.file;
					this.lastEditor = view.editor;
					if (!isSameFile) this.page = { type: 'list' };
					this.refresh();
				}
			})
		);
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		this.currentFile = activeView?.file ?? null;
		this.lastEditor = activeView?.editor ?? null;
		await this.refresh();
	}

	async onClose() {
		document.querySelector('.wm-ver-popup')?.remove();
		document.querySelector('.wm-diff-window')?.remove();
	}

	async refresh() {
		const container = this.containerEl.children[1] as HTMLElement;
		document.querySelector('.wm-ver-popup')?.remove();
		this.bodyPreviewCache.clear();

		// 오프-DOM 버퍼에서 렌더링 완료 후 한 번에 교체 → 깜빡임 방지
		const buf = document.createElement('div') as HTMLElement;
		buf.addClass('version-control-view');
		await this.renderUI(buf);

		const prevFocus = document.activeElement as HTMLElement | null;
		container.empty();
		container.addClass('version-control-view');
		while (buf.firstChild) container.appendChild(buf.firstChild);
		if (prevFocus && document.body.contains(prevFocus)) prevFocus.focus();
	}

	private refreshListOnly() {
		if (!this.listEl) return;
		this.renderList(this.listEl, this.sortAndFilter(this.allVersionsCached), this.allVersionsCached);
	}

	private async renderUI(container: HTMLElement) {
		if (this.page.type === 'preview') {
			await this.renderPreviewPage(container);
		} else {
			await this.renderListPage(container);
		}
	}

	// ── 목록 페이지 ──────────────────────────────────────────────────────────

	private async renderListPage(container: HTMLElement) {
		const root = container.createDiv({ cls: 'wm-vhv-root' });

		if (this.currentFile) {
			await this.manager.migrateCharCounts(this.currentFile);
			const manifest = await this.manager.getManifest(this.currentFile);
			this.allVersionsCached = manifest.versions;
		} else {
			this.allVersionsCached = [];
		}

		const isFilterActive = this.sortField !== 'mdate' || this.sortDir !== 'desc' || this.stageFilters.size > 0;

		// ── 헤더 ─────────────────────────────────────────────────────────
		const header = root.createDiv({ cls: 'wm-vhv-header' + (this.isSearching ? ' is-searching' : '') });

		const normalRow = header.createDiv({ cls: 'wm-vhv-normal-row' });
		const titleGroup = normalRow.createDiv({ cls: 'wm-vhv-title-group' });
		const titleIconEl = titleGroup.createDiv({ cls: 'wm-vhv-title-icon' });
		setIcon(titleIconEl, 'file-text');
		titleGroup.createDiv({
			cls: 'wm-vhv-title-text',
			text: this.currentFile ? this.currentFile.basename : '버전 기록'
		});

		// searchWrap: 입력창(평소 width:0) + 돋보기 버튼을 함께 담아 "입력창이 돋보기를 감싸며 확장"하는 구조
		const searchWrap = normalRow.createDiv({ cls: 'wm-vhv-search-wrap' });
		const searchInput = searchWrap.createEl('input', {
			attr: { type: 'text', placeholder: '버전 이름 또는 설명…' },
			cls: 'wm-vhv-search-input'
		}) as HTMLInputElement;
		searchInput.value = this.searchQuery;
		searchInput.addEventListener('input', () => {
			this.searchQuery = searchInput.value;
			this.refreshListOnly();
		});
		searchInput.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				this.isSearching = false;
				this.searchQuery = '';
				header.removeClass('is-searching');
				searchInput.value = '';
				this.refreshListOnly();
			}
		});
		const searchBtn = searchWrap.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': '검색' } });
		setIcon(searchBtn, 'search');
		searchBtn.addEventListener('click', () => {
			if (this.isSearching) {
				this.isSearching = false;
				this.searchQuery = '';
				header.removeClass('is-searching');
				searchInput.value = '';
				this.refreshListOnly();
			} else {
				this.isSearching = true;
				header.addClass('is-searching');
				setTimeout(() => searchInput.focus(), 50);
			}
		});

		const actions = normalRow.createDiv({ cls: 'wm-vhv-actions' });

		// 2. 필터/정렬
		const filterBtn = actions.createEl('button', {
			cls: `clickable-icon${isFilterActive ? ' is-active' : ''}`,
			attr: { 'aria-label': '정렬 및 필터' }
		});
		setIcon(filterBtn, 'list-filter');
		filterBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (document.querySelector('.wm-ver-popup')) { document.querySelector('.wm-ver-popup')?.remove(); return; }
			this.showSortDropdown(filterBtn);
		});

		// 3. 글자수 기준
		const charBtn = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': '글자수 기준' } });
		setIcon(charBtn, 'type');
		charBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (document.querySelector('.wm-ver-popup')) { document.querySelector('.wm-ver-popup')?.remove(); return; }
			this.showCharModeDropdown(charBtn);
		});

		// 4. 버전 저장
		const saveBtn = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': '버전 저장' } });
		setIcon(saveBtn, 'square-pen');
		saveBtn.addEventListener('click', async () => {
			if (!this.currentFile || !this.lastEditor) { new Notice('마크다운 노트를 먼저 열어주세요.'); return; }
			const now = new Date();
			const name = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
			await this.manager.saveVersion(this.currentFile, name, this.lastEditor.getValue());
			await this.refresh();
		});

		// ── 목록 영역 ─────────────────────────────────────────────────────
		this.listEl = root.createDiv({ cls: 'wm-vhv-list' });

		if (!this.currentFile) {
			this.renderEmpty(this.listEl, '마크다운 노트를 열면\n버전 기록이 표시됩니다.');
		} else if (this.allVersionsCached.length === 0) {
			this.renderEmpty(this.listEl, '저장된 버전이 없습니다.\n상단 버튼으로 현재 원고를 기록하세요.');
		} else {
			this.renderList(this.listEl, this.sortAndFilter(this.allVersionsCached), this.allVersionsCached);
		}
	}

	// ── 정렬/필터 드롭다운 ──────────────────────────────────────────────────

	private showSortDropdown(anchor: HTMLElement) {
		document.querySelector('.wm-ver-popup')?.remove();

		const popup = document.body.createDiv({ cls: 'wm-ver-popup' });
		const rect = anchor.getBoundingClientRect();
		popup.style.top = `${rect.bottom + 4}px`;
		popup.style.left = `${rect.left}px`;

		const addSep = () => popup.createDiv({ cls: 'wm-ver-popup-separator' });
		const addSectionLabel = (text: string, icon: string) => {
			const el = popup.createDiv({ cls: 'wm-ver-popup-section-label' });
			const iconEl = el.createDiv({ cls: 'wm-ver-popup-icon' });
			setIcon(iconEl, icon);
			el.createDiv({ cls: 'wm-ver-popup-label', text });
		};

		const makeItem = (icon: string, label: string, isActive: boolean) => {
			const item = popup.createDiv({ cls: `wm-ver-popup-item${isActive ? ' is-active' : ''}` });
			const iconEl = item.createDiv({ cls: 'wm-ver-popup-icon' });
			setIcon(iconEl, icon);
			item.createDiv({ cls: 'wm-ver-popup-label', text: label });
			const checkEl = item.createDiv({ cls: 'wm-ver-popup-check' });
			if (isActive) setIcon(checkEl, 'check');
			return { item, checkEl };
		};

		// ─ Section 1: 정렬 기준 ─
		addSectionLabel('정렬 기준', 'arrow-up-down');
		const fields: { label: string; value: SortField; icon: string }[] = [
			{ label: '수정 날짜', value: 'mdate', icon: 'clock' },
			{ label: '생성 날짜', value: 'cdate', icon: 'calendar' },
			{ label: '제목', value: 'title', icon: 'type' },
			{ label: '파일 이름', value: 'filename', icon: 'file-text' },
		];
		const fieldCheckEls = new Map<SortField, HTMLElement>();
		const fieldItems = new Map<SortField, HTMLElement>();
		for (const f of fields) {
			const { item, checkEl } = makeItem(f.icon, f.label, this.sortField === f.value);
			fieldCheckEls.set(f.value, checkEl);
			fieldItems.set(f.value, item);
			item.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.sortField === f.value) return;
				const prev = fieldItems.get(this.sortField);
				const prevCk = fieldCheckEls.get(this.sortField);
				if (prev) prev.removeClass('is-active');
				if (prevCk) prevCk.empty();
				this.sortField = f.value;
				item.addClass('is-active');
				setIcon(checkEl, 'check');
				this.refreshListOnly();
			});
		}

		addSep();

		// ─ Section 2: 순서 ─
		addSectionLabel('순서', 'list-ordered');
		const dirs: { label: string; value: SortDir; icon: string }[] = [
			{ label: '오름차순', value: 'asc', icon: 'arrow-up-narrow-wide' },
			{ label: '내림차순', value: 'desc', icon: 'arrow-down-wide-narrow' },
		];
		const dirCheckEls = new Map<SortDir, HTMLElement>();
		const dirItems = new Map<SortDir, HTMLElement>();
		for (const d of dirs) {
			const { item, checkEl } = makeItem(d.icon, d.label, this.sortDir === d.value);
			dirCheckEls.set(d.value, checkEl);
			dirItems.set(d.value, item);
			item.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.sortDir === d.value) return;
				const prev = dirItems.get(this.sortDir);
				const prevCk = dirCheckEls.get(this.sortDir);
				if (prev) prev.removeClass('is-active');
				if (prevCk) prevCk.empty();
				this.sortDir = d.value;
				item.addClass('is-active');
				setIcon(checkEl, 'check');
				this.refreshListOnly();
			});
		}

		addSep();

		// ─ Section 3: 상태 필터 (설정에서 정의된 stages 사용) ─
		addSectionLabel('상태 필터', 'filter');
		const configuredStages = this.plugin.settings.versionStages ?? [];
		for (const s of configuredStages) {
			const isChecked = this.stageFilters.has(s.name);
			const item = popup.createDiv({ cls: `wm-ver-popup-item${isChecked ? ' is-active' : ''}` });
			const dot = item.createDiv({ cls: 'wm-ver-popup-stage-dot' });
			dot.style.borderColor = s.color;
			if (isChecked) dot.style.backgroundColor = s.color;
			item.createDiv({ cls: 'wm-ver-popup-label', text: s.name });
			const checkEl = item.createDiv({ cls: 'wm-ver-popup-check' });
			if (isChecked) setIcon(checkEl, 'check');
			item.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.stageFilters.has(s.name)) {
					this.stageFilters.delete(s.name);
					item.removeClass('is-active');
					dot.style.backgroundColor = '';
					checkEl.empty();
				} else {
					this.stageFilters.add(s.name);
					item.addClass('is-active');
					dot.style.backgroundColor = s.color;
					setIcon(checkEl, 'check');
				}
				this.refreshListOnly();
			});
		}

		requestAnimationFrame(() => {
			const pr = popup.getBoundingClientRect();
			if (pr.right > window.innerWidth - 10) popup.style.left = `${window.innerWidth - pr.width - 10}px`;
			if (pr.bottom > window.innerHeight - 10) popup.style.top = `${rect.top - pr.height - 4}px`;
		});
		this.setupPopupAutoClose(popup);
	}

	private showCharModeDropdown(anchor: HTMLElement) {
		document.querySelector('.wm-ver-popup')?.remove();

		const popup = document.body.createDiv({ cls: 'wm-ver-popup' });
		const rect = anchor.getBoundingClientRect();
		popup.style.top = `${rect.bottom + 4}px`;
		popup.style.left = `${rect.left}px`;

		const modes: { label: string; value: 'munpia' | 'novelpia'; desc: string }[] = [
			{ label: '문피아', value: 'munpia', desc: '공백 포함, 줄바꿈 제외' },
			{ label: '노벨피아', value: 'novelpia', desc: '공백·줄바꿈 모두 제외' },
		];
		const current = this.charCountMode;

		for (const m of modes) {
			const item = popup.createDiv({ cls: `wm-ver-popup-item${current === m.value ? ' is-active' : ''}` });
			const labelGroup = item.createDiv({ cls: 'wm-ver-popup-label-group' });
			labelGroup.createDiv({ cls: 'wm-ver-popup-label', text: m.label });
			labelGroup.createDiv({ cls: 'wm-ver-popup-sublabel', text: m.desc });
			if (current === m.value) {
				const checkEl = item.createDiv({ cls: 'wm-ver-popup-check' });
				setIcon(checkEl, 'check');
			}
			item.addEventListener('click', (e) => {
				e.stopPropagation();
				popup.remove();
				this.charCountMode = m.value;
				this.refreshListOnly();
			});
		}

		requestAnimationFrame(() => {
			const pr = popup.getBoundingClientRect();
			if (pr.right > window.innerWidth - 10) popup.style.left = `${window.innerWidth - pr.width - 10}px`;
			if (pr.bottom > window.innerHeight - 10) popup.style.top = `${rect.top - pr.height - 4}px`;
		});
		this.setupPopupAutoClose(popup);
	}

	private setupPopupAutoClose(popup: HTMLElement) {
		setTimeout(() => {
			const close = (e: MouseEvent) => {
				if (!popup.contains(e.target as Node)) { popup.remove(); document.removeEventListener('click', close); }
			};
			document.addEventListener('click', close);
		}, 10);
	}

	// ── 정렬 / 필터 ──────────────────────────────────────────────────────────

	private sortAndFilter(versions: VersionEntry[]): VersionEntry[] {
		let result = [...versions];
		if (this.searchQuery.trim()) {
			const q = this.searchQuery.toLowerCase();
			result = result.filter(v =>
				v.name.toLowerCase().includes(q) ||
				(v.description ?? '').toLowerCase().includes(q)
			);
		}
		if (this.stageFilters.size > 0) {
			result = result.filter(v => this.stageFilters.has(v.stage ?? ''));
		}
		const dir = this.sortDir === 'asc' ? 1 : -1;
		switch (this.sortField) {
			case 'mdate': case 'cdate':
				result.sort((a, b) => dir * (a.timestamp - b.timestamp));
				break;
			case 'title':
				result.sort((a, b) => dir * a.name.localeCompare(b.name, 'ko'));
				break;
			case 'filename':
				result.sort((a, b) => dir * a.fileName.localeCompare(b.fileName));
				break;
		}
		return result;
	}

	private renderEmpty(container: HTMLElement, msg: string) {
		const el = container.createDiv({ cls: 'wm-vhv-empty' });
		el.createEl('p', { text: msg });
	}

	private renderList(container: HTMLElement, versions: VersionEntry[], allVersions: VersionEntry[]) {
		container.empty();

		const pinnedAll = allVersions.filter(v => v.pinned);
		const regularFiltered = versions.filter(v => !v.pinned);

		if (pinnedAll.length === 0 && regularFiltered.length === 0) {
			this.renderEmpty(container, (this.searchQuery || this.stageFilters.size > 0)
				? '조건에 맞는 버전이 없습니다.'
				: '저장된 버전이 없습니다.\n상단 버튼으로 현재 원고를 기록하세요.');
			return;
		}

		// 버전 순번: 타임스탬프 오름차순 정렬 후 1부터 번호 부여
		const sortedByTime = [...allVersions].sort((a, b) => a.timestamp - b.timestamp);
		const numMap = new Map(sortedByTime.map((v, i) => [v.id, i + 1]));

		// 고정됨 섹션 (필터 무관, 항상 최상단)
		if (pinnedAll.length > 0) {
			this.renderGroup(container, { label: '고정됨', entries: pinnedAll }, numMap);
		}

		// 일반 섹션 (non-pinned, 필터 적용)
		if (regularFiltered.length > 0) {
			const groups = this.groupByDate(regularFiltered);
			for (const group of groups) {
				this.renderGroup(container, group, numMap);
			}
		}
	}

	private groupByDate(versions: VersionEntry[]): DateGroup[] {
		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const yesterdayStart = todayStart - 86400000;
		const weekStart = todayStart - (now.getDay() || 7) * 86400000;
		const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

		const order: string[] = [];
		const map = new Map<string, VersionEntry[]>();
		const push = (label: string, v: VersionEntry) => {
			if (!map.has(label)) { map.set(label, []); order.push(label); }
			map.get(label)!.push(v);
		};

		for (const v of versions) {
			const ts = v.timestamp;
			const d = new Date(ts);
			if (ts >= todayStart) push('오늘', v);
			else if (ts >= yesterdayStart) push('어제', v);
			else if (ts >= weekStart) push('이번 주', v);
			else if (ts >= monthStart) push('이번 달', v);
			else {
				const label = d.getFullYear() === now.getFullYear()
					? `${d.getMonth() + 1}월`
					: `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
				push(label, v);
			}
		}
		return order.map(label => ({ label, entries: map.get(label)! }));
	}

	// ── 날짜 그룹 ────────────────────────────────────────────────────────────

	private renderGroup(container: HTMLElement, group: DateGroup, numMap: Map<string, number>) {
		const groupEl = container.createDiv({ cls: 'wm-vhv-group' });
		const isCollapsed = this.collapsedGroups.has(group.label);

		const groupHeader = groupEl.createDiv({ cls: 'wm-vhv-group-header' });
		groupHeader.createDiv({ cls: 'wm-vhv-group-label', text: group.label });
		const chevron = groupHeader.createDiv({ cls: 'wm-vhv-group-chevron' });
		setIcon(chevron, isCollapsed ? 'chevron-right' : 'chevron-down');

		groupHeader.addEventListener('click', () => {
			const nowCollapsed = this.collapsedGroups.has(group.label);
			if (nowCollapsed) {
				this.collapsedGroups.delete(group.label);
				itemsEl.removeClass('is-collapsed');
				setIcon(chevron, 'chevron-down');
			} else {
				this.collapsedGroups.add(group.label);
				itemsEl.addClass('is-collapsed');
				setIcon(chevron, 'chevron-right');
			}
		});

		const itemsEl = groupEl.createDiv({ cls: 'wm-vhv-group-items' + (isCollapsed ? ' is-collapsed' : '') });
		group.entries.forEach(entry => this.renderItem(itemsEl, entry, numMap.get(entry.id) ?? 0));
	}

	// ── 항목 ─────────────────────────────────────────────────────────────────

	private renderItem(container: HTMLElement, entry: VersionEntry, versionNum: number) {
		const item = container.createDiv({ cls: 'wm-vhv-item' });

		item.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).closest('.wm-vhv-action-btn')) return;
			this.page = { type: 'preview', entry };
			this.refresh();
		});

		// 상단 행: 이름 (단일줄, 생략) + 호버 액션 바 (topRow 내부, 제목줄에 정확히 정렬)
		const topRow = item.createDiv({ cls: 'wm-vhv-item-top' });
		topRow.createDiv({ cls: 'wm-vhv-item-name', text: entry.name });
		const actionsEl = topRow.createDiv({ cls: 'wm-vhv-item-actions' });

		// 고정
		const pinBtn = actionsEl.createEl('button', { cls: 'wm-vhv-action-btn', attr: { 'aria-label': entry.pinned ? '고정 해제' : '고정' } });
		setIcon(pinBtn, entry.pinned ? 'pin-off' : 'pin');
		pinBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			if (!this.currentFile) return;
			const newPinned = !entry.pinned;
			entry.pinned = newPinned;
			await this.manager.updateVersion(this.currentFile, entry.id, { pinned: newPinned });
			this.refreshListOnly();
		});

		// 버전 비교
		const compareBtn = actionsEl.createEl('button', { cls: 'wm-vhv-action-btn', attr: { 'aria-label': '버전 비교' } });
		setIcon(compareBtn, 'git-compare-arrows');
		compareBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			if (!this.currentFile) return;
			const win = new DiffWindow(this.app, this.plugin, this.currentFile, entry, this.lastEditor, 'current');
			await win.open();
		});

		// 편집
		const editBtn = actionsEl.createEl('button', { cls: 'wm-vhv-action-btn', attr: { 'aria-label': '편집' } });
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (!this.currentFile) return;
			new EditVersionModal(this.app, this.plugin, this.currentFile, entry, this.manager, () => this.refresh()).open();
		});

		// 새 탭에서 열기
		const openBtn = actionsEl.createEl('button', { cls: 'wm-vhv-action-btn', attr: { 'aria-label': '새 탭에서 열기' } });
		setIcon(openBtn, 'external-link');
		openBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			if (!this.currentFile) return;
			const content = await this.manager.readVersion(this.currentFile, entry);
			const safeName = entry.name.replace(/[\\/:*?"<>|]/g, '-');
			const baseName = `${this.currentFile.basename} - ${safeName}`;
			const dir = this.currentFile.parent?.path ?? '';
			const makeNewPath = (suffix = '') => normalizePath(dir ? `${dir}/${baseName}${suffix}.md` : `${baseName}${suffix}.md`);
			let newPath = makeNewPath();
			let c = 1;
			while (await this.app.vault.adapter.exists(newPath)) newPath = makeNewPath(` (${c++})`);
			try {
				const newFile = await this.app.vault.create(newPath, content);
				await this.app.workspace.getLeaf('tab').openFile(newFile);
			} catch (err) { new Notice('노트 생성에 실패했습니다.'); console.error(err); }
		});

		// 복원
		const restoreBtn = actionsEl.createEl('button', { cls: 'wm-vhv-action-btn', attr: { 'aria-label': '이 버전으로 복원' } });
		setIcon(restoreBtn, 'rotate-ccw');
		restoreBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			if (!this.currentFile || !this.lastEditor) { new Notice('편집 중인 노트가 없습니다.'); return; }
			await this.manager.restoreVersion(this.currentFile, entry, this.lastEditor);
			new Notice(`"${entry.name}"으로 복원했습니다.`);
			await this.refresh();
		});

		// 상태 (SVG circle 아이콘 — 다른 버튼과 동일한 파이프라인)
		const stageBtn = actionsEl.createEl('button', { cls: 'wm-vhv-action-btn wm-vhv-action-stage', attr: { 'aria-label': '상태' } });
		setIcon(stageBtn, 'circle-dashed');
		stageBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (document.querySelector('.wm-ver-popup')) { document.querySelector('.wm-ver-popup')?.remove(); return; }
			this.showStageDropdown(entry, stageBtn);
		});

		// 삭제
		const deleteBtn = actionsEl.createEl('button', { cls: 'wm-vhv-action-btn wm-vhv-action-danger', attr: { 'aria-label': '삭제' } });
		setIcon(deleteBtn, 'trash-2');
		deleteBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			if (!this.currentFile) return;
			await this.manager.deleteVersion(this.currentFile, entry);
			await this.refresh();
		});

		// 설명 (없으면 본문 프리뷰로 대체)
		const descEl = item.createDiv({ cls: 'wm-vhv-item-desc' });
		if (entry.description) {
			descEl.setText(entry.description);
		} else if (this.currentFile) {
			const cacheKey = entry.id;
			if (this.bodyPreviewCache.has(cacheKey)) {
				const cached = this.bodyPreviewCache.get(cacheKey)!;
				if (cached) descEl.setText(cached); else descEl.remove();
			} else {
				this.manager.readVersion(this.currentFile, entry).then(content => {
					const preview = content
						.replace(/^---[\s\S]*?^---\s*/m, '')
						.replace(/^#{1,6}\s+.+$/gm, '')
						.replace(/[*_~`>!]/g, '')
						.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
						.replace(/\n+/g, ' ')
						.trim()
						.slice(0, 300);
					this.bodyPreviewCache.set(cacheKey, preview);
					if (!descEl.isConnected) return;
					if (preview) descEl.setText(preview); else descEl.remove();
				}).catch(() => {
					this.bodyPreviewCache.set(cacheKey, '');
					descEl.remove();
				});
			}
		} else {
			descEl.remove();
		}

		// 하단 행: [tag V{n}] [날짜] · · · [글자수] [상태 텍스트]
		const bottomRow = item.createDiv({ cls: 'wm-vhv-item-bottom' });

		const verTag = bottomRow.createDiv({ cls: 'wm-vhv-item-ver' });
		const verIconEl = verTag.createDiv({ cls: 'wm-vhv-item-ver-icon' });
		setIcon(verIconEl, 'tag');
		verTag.createSpan({ cls: 'wm-vhv-item-ver-num', text: `V${versionNum}` });

		bottomRow.createSpan({ cls: 'wm-vhv-item-date', text: this.formatItemDate(entry.timestamp) });
		const rightGroup = bottomRow.createDiv({ cls: 'wm-vhv-item-right' });
		if (entry.stage) rightGroup.createSpan({ cls: 'wm-vhv-item-stage', text: entry.stage });
		rightGroup.createSpan({ cls: 'wm-vhv-item-chars', text: this.formatCharCount(entry) });
	}

	// ── 상태 드롭다운 ─────────────────────────────────────────────────────────

	private showStageDropdown(entry: VersionEntry, anchor: HTMLElement) {
		document.querySelector('.wm-ver-popup')?.remove();
		const popup = document.body.createDiv({ cls: 'wm-ver-popup' });
		const rect = anchor.getBoundingClientRect();
		popup.style.top = `${rect.bottom + 4}px`;
		popup.style.left = `${rect.left}px`;

		const stages = this.plugin.settings.versionStages ?? [];
		for (const s of stages) {
			const isActive = entry.stage === s.name;
			const itemEl = popup.createDiv({ cls: `wm-ver-popup-item${isActive ? ' is-active' : ''}` });
			const dot = itemEl.createDiv({ cls: 'wm-ver-popup-stage-dot' });
			dot.style.borderColor = s.color;
			itemEl.createDiv({ cls: 'wm-ver-popup-label', text: s.name });
			if (isActive) { const ck = itemEl.createDiv({ cls: 'wm-ver-popup-check' }); setIcon(ck, 'check'); }
			itemEl.addEventListener('click', async (e) => {
				e.stopPropagation();
				const newStage = isActive ? undefined : s.name;
				entry.stage = newStage;
				if (this.currentFile) await this.manager.updateVersion(this.currentFile, entry.id, { stage: newStage });
				popup.remove();
				this.refreshListOnly();
			});
		}

		if (entry.stage) {
			popup.createDiv({ cls: 'wm-ver-popup-separator' });
			const clearEl = popup.createDiv({ cls: 'wm-ver-popup-item' });
			const iconEl = clearEl.createDiv({ cls: 'wm-ver-popup-icon' });
			setIcon(iconEl, 'ban');
			clearEl.createDiv({ cls: 'wm-ver-popup-label', text: '없음' });
			clearEl.addEventListener('click', async (e) => {
				e.stopPropagation();
				entry.stage = undefined;
				if (this.currentFile) await this.manager.updateVersion(this.currentFile, entry.id, { stage: undefined });
				popup.remove();
				this.refreshListOnly();
			});
		}

		requestAnimationFrame(() => {
			const pr = popup.getBoundingClientRect();
			if (pr.right > window.innerWidth - 10) popup.style.left = `${window.innerWidth - pr.width - 10}px`;
			if (pr.bottom > window.innerHeight - 10) popup.style.top = `${rect.top - pr.height - 4}px`;
		});
		this.setupPopupAutoClose(popup);
	}

	// ── 미리보기 페이지 ──────────────────────────────────────────────────────

	private async renderPreviewPage(container: HTMLElement) {
		const entry = (this.page as { type: 'preview'; entry: VersionEntry }).entry;
		const root = container.createDiv({ cls: 'version-control-content' });

		const panelHeader = root.createDiv({ cls: 'v-panel-header' });
		const backBtn = panelHeader.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': '뒤로' } });
		setIcon(backBtn, 'chevron-left');
		backBtn.addEventListener('click', () => { this.page = { type: 'list' }; this.refresh(); });

		const titleGroup = panelHeader.createDiv();
		titleGroup.style.cssText = 'flex:1; min-width:0;';
		const h3 = titleGroup.createEl('h3', { text: entry.name });
		h3.style.cssText = 'white-space: normal; overflow: visible; text-overflow: unset; word-break: break-word;';

		const main = root.createDiv({ cls: 'v-main' });
		const previewContent = main.createDiv({ cls: 'v-preview-panel-content' });
		if (this.currentFile) {
			try {
				const content = await this.manager.readVersion(this.currentFile, entry);
				const previewEl = previewContent.createDiv({ cls: 'v-version-content-preview' });
				await MarkdownRenderer.render(this.app, content, previewEl, this.currentFile.path, this);
			} catch {
				previewContent.createDiv({ text: '미리보기를 불러올 수 없습니다.' });
			}
		}
	}


	// ── 헬퍼 ─────────────────────────────────────────────────────────────────

	private formatItemDate(timestamp: number): string {
		const now = Date.now();
		const d = new Date(timestamp);
		const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

		if (timestamp >= todayStart.getTime()) {
			const h = d.getHours(), m = d.getMinutes();
			const ampm = h < 12 ? '오전' : '오후';
			return `${ampm} ${h % 12 || 12}:${m.toString().padStart(2, '0')}`;
		}

		const days = Math.floor((now - timestamp) / 86400000);
		if (days === 1) return '어제';
		if (days < 7) return `${days}일 전`;
		if (days < 14) return '일주일 전';
		if (days < 21) return '2주 전';
		if (days < 28) return '3주 전';
		if (days < 35) return '한 달 전';

		return `${d.getMonth() + 1}월 ${d.getDate().toString().padStart(2, '0')}, ${d.getFullYear()}`;
	}

	private formatCharCount(entry: VersionEntry): string {
		const count = this.charCountMode === 'munpia'
			? (entry.charCountTotal ?? entry.charCount)
			: entry.charCount;
		return `${count.toLocaleString()}자`;
	}
}
