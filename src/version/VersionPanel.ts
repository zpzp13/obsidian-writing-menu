import { setIcon, Notice, MarkdownView, MarkdownRenderer, TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { VersionManager } from './manager';
import type { VersionEntry } from './types';
import { DiffWindow } from './DiffWindow';
import { EditVersionModal } from './EditVersionModal';

type Page = { type: 'list' } | { type: 'preview'; entry: VersionEntry };

export class VersionPanel {
	static render(container: HTMLElement, plugin: WritingMenuPlugin): void {
		const manager = new VersionManager(plugin.app, plugin);
		let currentFile: TFile | null = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
		let lastEditor = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
		let page: Page = { type: 'list' };
		let allVersions: VersionEntry[] = [];
		let charCountMode: 'munpia' | 'novelpia' = 'munpia';
		let searchQuery = '';
		let isSearching = false;
		let stageFilters = new Set<string>();
		let sortField: 'mdate' | 'cdate' | 'title' | 'filename' = 'mdate';
		let sortDir: 'asc' | 'desc' = 'desc';
		let listElRef: HTMLElement | null = null;
		let filterBtnRef: HTMLElement | null = null;
		const collapsedGroups = new Set<string>();
		const bodyPreviewCache = new Map<string, string>();

		const refresh = async () => {
			if (!container.isConnected) return;
			container.empty();
			listElRef = null;
			filterBtnRef = null;
			if (currentFile) {
				await manager.migrateCharCounts(currentFile);
				const manifest = await manager.getManifest(currentFile);
				allVersions = manifest.versions;
			} else {
				allVersions = [];
			}
			if (page.type === 'preview') {
				renderPreviewPage(container, page.entry);
			} else {
				renderListPage(container);
			}
		};

		// ── 이벤트 구독 ──────────────────────────────────────────────────────────
		const leafHandler = plugin.app.workspace.on('active-leaf-change', (leaf) => {
			const view = leaf?.view;
			if (view instanceof MarkdownView) {
				const isSameFile = view.file?.path === currentFile?.path;
				currentFile = view.file;
				lastEditor = view.editor;
				if (!isSameFile) { page = { type: 'list' }; bodyPreviewCache.clear(); }
				refresh().catch(() => {});
			}
		});

		const observer = new MutationObserver(() => {
			if (!container.isConnected) {
				plugin.app.workspace.offref(leafHandler);
				observer.disconnect();
			}
		});
		observer.observe(activeDocument.body, { childList: true, subtree: true });

		// ── 날짜 포맷 ──────────────────────────────────────────────────────────
		const formatDate = (ts: number): string => {
			const d = new Date(ts), now = new Date();
			const pad = (n: number) => String(n).padStart(2, '0');
			if (d.toDateString() === now.toDateString())
				return `오늘 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
			const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
			if (d.toDateString() === yesterday.toDateString())
				return `어제 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
			if (d.getFullYear() === now.getFullYear())
				return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
			return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
		};

		const formatCharCount = (entry: VersionEntry): string => {
			const n = charCountMode === 'novelpia' ? entry.charCount : (entry.charCountTotal ?? entry.charCount);
			return `${(n ?? 0).toLocaleString()}자`;
		};

		const groupByDate = (versions: VersionEntry[]) => {
			const now = new Date();
			const todayStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
			const yesterdayStart = todayStart - 86400000;
			const weekStart   = todayStart - (now.getDay() || 7) * 86400000;
			const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
			const order: string[] = [];
			const map = new Map<string, VersionEntry[]>();
			const push = (label: string, v: VersionEntry) => {
				if (!map.has(label)) { map.set(label, []); order.push(label); }
				map.get(label)!.push(v);
			};
			for (const v of versions) {
				const ts = v.timestamp;
				if (ts >= todayStart) push('오늘', v);
				else if (ts >= yesterdayStart) push('어제', v);
				else if (ts >= weekStart) push('이번 주', v);
				else if (ts >= monthStart) push('이번 달', v);
				else {
					const d = new Date(ts);
					push(d.getFullYear() === now.getFullYear()
						? `${d.getMonth()+1}월`
						: `${d.getFullYear()}년 ${d.getMonth()+1}월`, v);
				}
			}
			return order.map(label => ({ label, entries: map.get(label)! }));
		};

		// ── 정렬/필터 ──────────────────────────────────────────────────────────
		const sortAndFilter = (versions: VersionEntry[]): VersionEntry[] => {
			let result = [...versions];
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase();
				result = result.filter(v => v.name.toLowerCase().includes(q) || (v.description ?? '').toLowerCase().includes(q));
			}
			if (stageFilters.size > 0) {
				result = result.filter(v => stageFilters.has(v.stage ?? ''));
			}
			const dir = sortDir === 'asc' ? 1 : -1;
			switch (sortField) {
				case 'mdate': case 'cdate':
					result.sort((a, b) => dir * (a.timestamp - b.timestamp));
					break;
				case 'title':
					result.sort((a, b) => dir * a.name.localeCompare(b.name, 'ko'));
					break;
				case 'filename':
					result.sort((a, b) => dir * (a.fileName ?? '').localeCompare(b.fileName ?? ''));
					break;
			}
			return result;
		};

		// ── 목록만 새로고침 (헤더 유지) ──────────────────────────────────────────
		const renderListContent = (listEl: HTMLElement) => {
			listEl.empty();
			if (!currentFile) {
				listEl.createDiv({ cls: 'wm-vhv-empty' }).createEl('p', { text: '마크다운 노트를 열면\n버전 기록이 표시됩니다.' });
				return;
			}
			if (allVersions.length === 0) {
				listEl.createDiv({ cls: 'wm-vhv-empty' }).createEl('p', { text: '저장된 버전이 없습니다.\n상단 버튼으로 현재 원고를 기록하세요.' });
				return;
			}
			const sortedAll = [...allVersions].sort((a, b) => a.timestamp - b.timestamp);
			const numMap = new Map(sortedAll.map((v, i) => [v.id, i + 1]));
			const filtered = sortAndFilter(allVersions);
			const pinnedAll = allVersions.filter(v => v.pinned);
			const regularFiltered = filtered.filter(v => !v.pinned);
			if (pinnedAll.length === 0 && regularFiltered.length === 0) {
				listEl.createDiv({ cls: 'wm-vhv-empty' }).createEl('p', { text: '조건에 맞는 버전이 없습니다.' });
				return;
			}
			if (pinnedAll.length > 0) renderGroup(listEl, '고정됨', pinnedAll, numMap);
			for (const g of groupByDate(regularFiltered)) renderGroup(listEl, g.label, g.entries, numMap);
		};

		const refreshListOnly = () => {
			if (!listElRef) { refresh().catch(() => {}); return; }
			renderListContent(listElRef);
			if (filterBtnRef) filterBtnRef.classList.toggle('is-active', stageFilters.size > 0);
		};

		// ── 팝업 유틸 ──────────────────────────────────────────────────────────
		const setupPopupAutoClose = (popup: HTMLElement) => {
			window.setTimeout(() => {
				const close = (e: MouseEvent) => {
					if (!popup.contains(e.target as Node)) { popup.remove(); activeDocument.removeEventListener('click', close); }
				};
				activeDocument.addEventListener('click', close);
			}, 10);
		};

		const showSortDropdown = (anchor: HTMLElement) => {
			activeDocument.querySelector('.wm-ver-popup')?.remove();
			const popup = activeDocument.body.createDiv({ cls: 'wm-ver-popup' });
			const rect = anchor.getBoundingClientRect();
			popup.setCssStyles({ top: `${rect.bottom + 4}px` });
			popup.setCssStyles({ left: `${rect.left}px` });

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

			// 정렬 기준
			addSectionLabel('정렬 기준', 'arrow-up-down');
			const fields: Array<{ label: string; value: typeof sortField; icon: string }> = [
				{ label: '수정 날짜', value: 'mdate', icon: 'clock' },
				{ label: '생성 날짜', value: 'cdate', icon: 'calendar' },
				{ label: '제목',     value: 'title',    icon: 'type' },
				{ label: '파일 이름', value: 'filename', icon: 'file-text' },
			];
			const fieldItems = new Map<string, HTMLElement>();
			const fieldChecks = new Map<string, HTMLElement>();
			for (const f of fields) {
				const { item, checkEl } = makeItem(f.icon, f.label, sortField === f.value);
				fieldItems.set(f.value, item); fieldChecks.set(f.value, checkEl);
				item.addEventListener('click', (e) => {
					e.stopPropagation();
					if (sortField === f.value) return;
					fieldItems.get(sortField)?.removeClass('is-active'); fieldChecks.get(sortField)?.empty();
					sortField = f.value;
					item.addClass('is-active'); setIcon(checkEl, 'check');
					refreshListOnly();
				});
			}

			addSep();

			// 순서
			addSectionLabel('순서', 'list-ordered');
			const dirs: Array<{ label: string; value: typeof sortDir; icon: string }> = [
				{ label: '오름차순', value: 'asc',  icon: 'arrow-up-narrow-wide' },
				{ label: '내림차순', value: 'desc', icon: 'arrow-down-wide-narrow' },
			];
			const dirItems = new Map<string, HTMLElement>();
			const dirChecks = new Map<string, HTMLElement>();
			for (const d of dirs) {
				const { item, checkEl } = makeItem(d.icon, d.label, sortDir === d.value);
				dirItems.set(d.value, item); dirChecks.set(d.value, checkEl);
				item.addEventListener('click', (e) => {
					e.stopPropagation();
					if (sortDir === d.value) return;
					dirItems.get(sortDir)?.removeClass('is-active'); dirChecks.get(sortDir)?.empty();
					sortDir = d.value;
					item.addClass('is-active'); setIcon(checkEl, 'check');
					refreshListOnly();
				});
			}

			addSep();

			// 상태 필터
			addSectionLabel('상태 필터', 'filter');
			const configuredStages: Array<{ name: string; color: string }> =
				(plugin.settings as any).versionStages ?? [
					{ name: '초고', color: '#94a3b8' },
					{ name: '집필', color: '#60a5fa' },
					{ name: '퇴고', color: '#34d399' },
				];
			for (const s of configuredStages) {
				const isChecked = stageFilters.has(s.name);
				const item = popup.createDiv({ cls: `wm-ver-popup-item${isChecked ? ' is-active' : ''}` });
				const dot = item.createDiv({ cls: 'wm-ver-popup-stage-dot' });
				dot.setCssProps({ '--stage-color': s.color });
				if (isChecked) dot.addClass('is-filled');
				item.createDiv({ cls: 'wm-ver-popup-label', text: s.name });
				const checkEl = item.createDiv({ cls: 'wm-ver-popup-check' });
				if (isChecked) setIcon(checkEl, 'check');
				item.addEventListener('click', (e) => {
					e.stopPropagation();
					if (stageFilters.has(s.name)) {
						stageFilters.delete(s.name);
						item.removeClass('is-active'); dot.removeClass('is-filled'); checkEl.empty();
					} else {
						stageFilters.add(s.name);
						item.addClass('is-active'); dot.addClass('is-filled'); setIcon(checkEl, 'check');
					}
					refreshListOnly();
				});
			}

			window.requestAnimationFrame(() => {
				const pr = popup.getBoundingClientRect();
				if (pr.right > window.innerWidth - 10) popup.setCssStyles({ left: `${window.innerWidth - pr.width - 10}px` });
				if (pr.bottom > window.innerHeight - 10) popup.setCssStyles({ top: `${rect.top - pr.height - 4}px` });
			});
			setupPopupAutoClose(popup);
		};

		const showCharModeDropdown = (anchor: HTMLElement) => {
			activeDocument.querySelector('.wm-ver-popup')?.remove();
			const popup = activeDocument.body.createDiv({ cls: 'wm-ver-popup' });
			const rect = anchor.getBoundingClientRect();
			popup.setCssStyles({ top: `${rect.bottom + 4}px` });
			popup.setCssStyles({ left: `${rect.left}px` });
			const modes: Array<{ label: string; value: typeof charCountMode; desc: string }> = [
				{ label: '문피아',   value: 'munpia',   desc: '공백 포함, 줄바꿈 제외' },
				{ label: '노벨피아', value: 'novelpia', desc: '공백·줄바꿈 모두 제외' },
			];
			for (const m of modes) {
				const item = popup.createDiv({ cls: `wm-ver-popup-item${charCountMode === m.value ? ' is-active' : ''}` });
				const labelGroup = item.createDiv({ cls: 'wm-ver-popup-label-group' });
				labelGroup.createDiv({ cls: 'wm-ver-popup-label', text: m.label });
				labelGroup.createDiv({ cls: 'wm-ver-popup-sublabel', text: m.desc });
				if (charCountMode === m.value) setIcon(item.createDiv({ cls: 'wm-ver-popup-check' }), 'check');
				item.addEventListener('click', (e) => {
					e.stopPropagation();
					popup.remove();
					charCountMode = m.value;
					refreshListOnly();
				});
			}
			window.requestAnimationFrame(() => {
				const pr = popup.getBoundingClientRect();
				if (pr.right > window.innerWidth - 10) popup.setCssStyles({ left: `${window.innerWidth - pr.width - 10}px` });
				if (pr.bottom > window.innerHeight - 10) popup.setCssStyles({ top: `${rect.top - pr.height - 4}px` });
			});
			setupPopupAutoClose(popup);
		};

		// ── 목록 페이지 ──────────────────────────────────────────────────────────
		const renderListPage = (ct: HTMLElement) => {
			const root = ct.createDiv({ cls: 'wm-vhv-root' });

			const header = root.createDiv({ cls: 'wm-vhv-header' });
			const normalRow = header.createDiv({ cls: 'wm-vhv-normal-row' });

			// 파일 아이콘
			const titleIconEl = normalRow.createDiv({ cls: 'wm-cal-icon-btn' });
			setIcon(titleIconEl, 'file-text');

			// 제목 그룹 (검색 시 숨김)
			const titleGroup = normalRow.createDiv({ cls: 'wm-vhv-title-group' });
			titleGroup.createSpan({ cls: 'wiki-bc-seg', text: currentFile ? currentFile.basename : '버전 기록' });

			// 검색 영역
			const searchWrap = normalRow.createDiv({ cls: 'wm-vhv-search-wrap' });
			const searchInput = searchWrap.createEl('input', {
				attr: { type: 'text', placeholder: '버전 이름 또는 설명…' },
				cls: 'wm-vhv-search-input',
			});
			searchInput.value = searchQuery;
			searchInput.addEventListener('input', () => {
				searchQuery = searchInput.value;
				refreshListOnly();
			});
			searchInput.addEventListener('keydown', (e) => {
				if (e.key === 'Escape') {
					isSearching = false; searchQuery = '';
					header.removeClass('is-searching');
					searchInput.value = '';
					refreshListOnly();
				}
			});
			const searchBtn = searchWrap.createDiv({ cls: 'wm-cal-icon-btn', attr: { 'aria-label': '검색' } });
			setIcon(searchBtn, 'search');
			if (isSearching) { header.addClass('is-searching'); window.setTimeout(() => searchInput.focus(), 50); }
			searchBtn.addEventListener('click', () => {
				if (isSearching) {
					isSearching = false; searchQuery = '';
					header.removeClass('is-searching');
					searchInput.value = '';
					refreshListOnly();
				} else {
					isSearching = true;
					header.addClass('is-searching');
					window.setTimeout(() => searchInput.focus(), 50);
				}
			});

			// 액션 버튼들
			const actions = normalRow.createDiv({ cls: 'wm-vhv-actions' });

			const filterBtn = actions.createDiv({ cls: `wm-cal-icon-btn${stageFilters.size > 0 ? ' is-active' : ''}`, attr: { 'aria-label': '정렬 및 필터' } });
			setIcon(filterBtn, 'list-filter');
			filterBtnRef = filterBtn;
			filterBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (activeDocument.querySelector('.wm-ver-popup')) { activeDocument.querySelector('.wm-ver-popup')?.remove(); return; }
				showSortDropdown(filterBtn);
			});

			const charBtn = actions.createDiv({ cls: `wm-cal-icon-btn${charCountMode === 'novelpia' ? ' is-active' : ''}`, attr: { 'aria-label': '글자수 기준' } });
			setIcon(charBtn, 'type');
			charBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (activeDocument.querySelector('.wm-ver-popup')) { activeDocument.querySelector('.wm-ver-popup')?.remove(); return; }
				showCharModeDropdown(charBtn);
			});

			const saveBtn = actions.createDiv({ cls: 'wm-cal-icon-btn', attr: { 'aria-label': '버전 저장' } });
			setIcon(saveBtn, 'square-pen');
			saveBtn.addEventListener('click', async () => {
				if (!currentFile || !lastEditor) { new Notice('마크다운 노트를 먼저 열어주세요.'); return; }
				const now = new Date();
				const name = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
				await manager.saveVersion(currentFile, name, lastEditor.getValue());
				await refresh();
			});

			const settingsBtn = actions.createDiv({ cls: 'wm-cal-icon-btn', attr: { 'aria-label': '버전 관리 설정' } });
			setIcon(settingsBtn, 'settings');
			settingsBtn.addEventListener('click', () => {
				(plugin.app as any).setting?.open();
				(plugin.app as any).setting?.openTabById(plugin.manifest.id);
				window.setTimeout(() => { plugin.settingTab?.renderPage('version-control'); }, 60);
			});

			// 목록
			const listEl = root.createDiv({ cls: 'wm-vhv-list' });
			listElRef = listEl;
			renderListContent(listEl);
		};

		const renderGroup = (ct2: HTMLElement, label: string, entries: VersionEntry[], numMap: Map<string, number>) => {
			const groupEl = ct2.createDiv({ cls: 'wm-vhv-group' });
			const isCollapsed = collapsedGroups.has(label);
			const groupHeader = groupEl.createDiv({ cls: 'wm-vhv-group-header' });
			groupHeader.createDiv({ cls: 'wm-vhv-group-label', text: label });
			const chevron = groupHeader.createDiv({ cls: 'wm-vhv-group-chevron' });
			setIcon(chevron, isCollapsed ? 'chevron-right' : 'chevron-down');
			const itemsEl = groupEl.createDiv({ cls: 'wm-vhv-group-items' + (isCollapsed ? ' is-collapsed' : '') });
			groupHeader.addEventListener('click', () => {
				if (collapsedGroups.has(label)) {
					collapsedGroups.delete(label); itemsEl.removeClass('is-collapsed'); setIcon(chevron, 'chevron-down');
				} else {
					collapsedGroups.add(label); itemsEl.addClass('is-collapsed'); setIcon(chevron, 'chevron-right');
				}
			});
			entries.forEach(entry => renderItem(itemsEl, entry, numMap.get(entry.id) ?? 0));
		};

		const renderItem = (container2: HTMLElement, entry: VersionEntry, versionNum: number) => {
			const item = container2.createDiv({ cls: 'wm-vhv-item' });
			item.addEventListener('click', (e) => {
				if ((e.target as HTMLElement).closest('.wm-vhv-action-btn')) return;
				page = { type: 'preview', entry };
				refresh().catch(() => {});
			});

			const topRow = item.createDiv({ cls: 'wm-vhv-item-top' });
			topRow.createDiv({ cls: 'wm-vhv-item-name', text: entry.name });
			const actionsEl = topRow.createDiv({ cls: 'wm-vhv-item-actions' });

			const makeBtn = (label: string, icon: string, onClick: (e: MouseEvent) => void) => {
				const btn = actionsEl.createEl('button', { cls: 'wm-vhv-action-btn', attr: { 'aria-label': label } });
				setIcon(btn, icon);
				btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
				return btn;
			};

			makeBtn(entry.pinned ? '고정 해제' : '고정', entry.pinned ? 'pin-off' : 'pin', async () => {
				if (!currentFile) return;
				entry.pinned = !entry.pinned;
				await manager.updateVersion(currentFile, entry.id, { pinned: entry.pinned });
				refresh().catch(() => {});
			});

			makeBtn('버전 비교', 'git-compare-arrows', async () => {
				if (!currentFile) return;
				const win = new DiffWindow(plugin.app, plugin, currentFile, entry, lastEditor, 'current');
				await win.open();
			});

			makeBtn('편집', 'pencil', () => {
				if (!currentFile) return;
				new EditVersionModal(plugin.app, plugin, currentFile, entry, manager, () => refresh().catch(() => {})).open();
			});

			makeBtn('상태', 'circle-dashed', (e) => {
				activeDocument.querySelector('.wm-ver-popup')?.remove();
				const popup = activeDocument.body.createDiv({ cls: 'wm-ver-popup' });
				const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
				popup.setCssStyles({ top: `${rect.bottom + 4}px` });
				popup.setCssStyles({ left: `${rect.left}px` });
				const configuredStages: Array<{ name: string; color: string }> =
					(plugin.settings as any).versionStages ?? [
						{ name: '초고', color: '#94a3b8' },
						{ name: '집필', color: '#60a5fa' },
						{ name: '퇴고', color: '#34d399' },
					];
				const noneItem = popup.createDiv({ cls: `wm-ver-popup-item${!entry.stage ? ' is-active' : ''}` });
				noneItem.createDiv({ cls: 'wm-ver-popup-stage-dot wm-ver-popup-stage-dot-none' });
				noneItem.createDiv({ cls: 'wm-ver-popup-label', text: '없음' });
				if (!entry.stage) setIcon(noneItem.createDiv({ cls: 'wm-ver-popup-check' }), 'check');
				noneItem.addEventListener('click', async (ev) => {
					ev.stopPropagation(); popup.remove();
					if (!currentFile) return;
					entry.stage = undefined;
					await manager.updateVersion(currentFile, entry.id, { stage: undefined });
					refresh().catch(() => {});
				});
				popup.createDiv({ cls: 'wm-ver-popup-separator' });
				for (const s of configuredStages) {
					const isActive = entry.stage === s.name;
					const stageItem = popup.createDiv({ cls: `wm-ver-popup-item${isActive ? ' is-active' : ''}` });
					const dot = stageItem.createDiv({ cls: 'wm-ver-popup-stage-dot' });
					dot.setCssProps({ '--stage-color': s.color });
					if (isActive) dot.addClass('is-filled');
					stageItem.createDiv({ cls: 'wm-ver-popup-label', text: s.name });
					if (isActive) setIcon(stageItem.createDiv({ cls: 'wm-ver-popup-check' }), 'check');
					stageItem.addEventListener('click', async (ev) => {
						ev.stopPropagation(); popup.remove();
						if (!currentFile) return;
						entry.stage = s.name;
						await manager.updateVersion(currentFile, entry.id, { stage: s.name });
						refresh().catch(() => {});
					});
				}
				window.requestAnimationFrame(() => {
					const pr = popup.getBoundingClientRect();
					if (pr.right > window.innerWidth - 10) popup.setCssStyles({ left: `${window.innerWidth - pr.width - 10}px` });
					if (pr.bottom > window.innerHeight - 10) popup.setCssStyles({ top: `${rect.top - pr.height - 4}px` });
				});
				setupPopupAutoClose(popup);
			});

			makeBtn('이 버전으로 복원', 'rotate-ccw', async () => {
				if (!currentFile || !lastEditor) { new Notice('편집 중인 노트가 없습니다.'); return; }
				await manager.restoreVersion(currentFile, entry, lastEditor);
				new Notice(`"${entry.name}"으로 복원했습니다.`);
				refresh().catch(() => {});
			});

			makeBtn('삭제', 'trash-2', async () => {
				if (!currentFile) return;
				await manager.deleteVersion(currentFile, entry);
				refresh().catch(() => {});
			});

			const descEl = item.createDiv({ cls: 'wm-vhv-item-desc' });
			if (entry.description) {
				descEl.setText(entry.description);
			} else if (currentFile) {
				const cached = bodyPreviewCache.get(entry.id);
				if (cached !== undefined) {
					if (cached) descEl.setText(cached); else descEl.remove();
				} else {
					manager.readVersion(currentFile, entry).then(content => {
						const preview = content
							.replace(/^---[\s\S]*?^---\s*/m, '').replace(/^#{1,6}\s+.+$/gm, '')
							.replace(/[*_~`>!]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
							.replace(/\n+/g, ' ').trim().slice(0, 300);
						bodyPreviewCache.set(entry.id, preview);
						if (!descEl.isConnected) return;
						if (preview) descEl.setText(preview); else descEl.remove();
					}).catch(() => { bodyPreviewCache.set(entry.id, ''); descEl.remove(); });
				}
			} else { descEl.remove(); }

			const bottomRow = item.createDiv({ cls: 'wm-vhv-item-bottom' });
			const verTag = bottomRow.createDiv({ cls: 'wm-vhv-item-ver' });
			const verIconEl = verTag.createDiv({ cls: 'wm-vhv-item-ver-icon' });
			setIcon(verIconEl, 'tag');
			verTag.createSpan({ cls: 'wm-vhv-item-ver-num', text: `V${versionNum}` });
			bottomRow.createSpan({ cls: 'wm-vhv-item-date', text: formatDate(entry.timestamp) });
			const rightGroup = bottomRow.createDiv({ cls: 'wm-vhv-item-right' });
			if (entry.stage) rightGroup.createSpan({ cls: 'wm-vhv-item-stage', text: entry.stage });
			rightGroup.createSpan({ cls: 'wm-vhv-item-chars', text: formatCharCount(entry) });
		};

		// ── 미리보기 페이지 ──────────────────────────────────────────────────────
		const renderPreviewPage = (ct: HTMLElement, entry: VersionEntry) => {
			const root = ct.createDiv({ cls: 'wm-vhv-root' });

			const header = root.createDiv({ cls: 'wm-vhv-header' });
			const normalRow = header.createDiv({ cls: 'wm-vhv-normal-row' });

			const backBtn = normalRow.createDiv({ cls: 'wm-cal-icon-btn', attr: { 'aria-label': '목록으로' } });
			setIcon(backBtn, 'chevron-left');
			backBtn.addEventListener('click', () => { page = { type: 'list' }; refresh().catch(() => {}); });

			const titleGroup = normalRow.createDiv({ cls: 'wm-vhv-title-group' });
			titleGroup.createSpan({ cls: 'wiki-bc-seg', text: entry.name });

			const actions = normalRow.createDiv({ cls: 'wm-vhv-actions' });
			const restoreBtn = actions.createDiv({ cls: 'wm-cal-icon-btn', attr: { 'aria-label': '이 버전으로 복원' } });
			setIcon(restoreBtn, 'rotate-ccw');
			restoreBtn.addEventListener('click', async () => {
				if (!currentFile || !lastEditor) { new Notice('편집 중인 노트가 없습니다.'); return; }
				await manager.restoreVersion(currentFile, entry, lastEditor);
				new Notice(`"${entry.name}"으로 복원했습니다.`);
				page = { type: 'list' };
				refresh().catch(() => {});
			});

			const body = root.createDiv({ cls: 'wm-vhv-preview-body' });
			if (currentFile) {
				manager.readVersion(currentFile, entry).then(content => {
					if (!body.isConnected) return;
					MarkdownRenderer.render(plugin.app, content, body, currentFile!.path, plugin as any).catch(() => {});
				}).catch(() => {
					body.createEl('p', { text: '내용을 불러올 수 없습니다.' });
				});
			}
		};

		// 초기 렌더
		refresh().catch(() => {});
	}
}
