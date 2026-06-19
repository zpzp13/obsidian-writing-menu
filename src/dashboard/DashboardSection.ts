import { setIcon, MarkdownView, sanitizeHTMLToDom, App } from 'obsidian';

interface AppWithSettings extends App {
	setting?: { open(): void; openTabById(id: string): void };
}
import type WritingMenuPlugin from '../../main';
import { TaskParser } from './data/TaskParser';
import { TasksRenderer } from './TasksRenderer';
import { WritingTimeSection } from './WritingTimeSection';
import { MusicPlayerSection } from './MusicPlayerSection';
import type { DailyCharStore } from './data/DailyCharStore';
import type { DashSectionConfig } from '../types';
import { calcVersionCharCount } from '../version/charCount';
import { MUNPIA_SVG, NOVELPIA_SVG } from '../assets/platformLogos';
import { watchDisconnect } from '../utils/domUtils';

export class DashboardSection {
	private static collapsed = new Set<string>();

	static render(container: HTMLElement, plugin: WritingMenuPlugin, sections?: DashSectionConfig[]) {
		const wrap = container.createDiv({ cls: 'wm-dash' });

		const cfg = sections ?? plugin.settings.dashboardSections ?? [
			{ id: 'chars',  label: '글자수',   visible: true },
			{ id: 'time',   label: '작업시간', visible: true },
			{ id: 'tasks',  label: '할 일',    visible: true },
		];

		for (const sec of cfg) {
			if (!sec.visible) continue;
			if (sec.id === 'chars') {
				this.renderSection(wrap, '글자수', (body) => {
					body.addClass('no-item-dividers');
					this.renderCharsContent(body, plugin);
				}, 'writing-stats', plugin);
			} else if (sec.id === 'time') {
				this.renderSection(wrap, '작업 시간', (body) => {
					body.addClass('no-item-dividers');
					const slot = body.createDiv({ cls: 'wm-dash-group-item' });
					WritingTimeSection.render(slot, plugin).catch(() => {});
				}, 'writing-stats', plugin);
			} else if (sec.id === 'tasks') {
				this.renderSection(wrap, '할 일', (body) => {
					const slot = body.createDiv();
					TaskParser.loadTasks(plugin)
						.then(tasks => {
							slot.empty();
							TasksRenderer.render(slot, tasks, plugin);
						})
						.catch(() => {});
				}, 'calendar', plugin);
			} else if (sec.id === 'music') {
				this.renderSection(wrap, '음악', (body) => {
					body.addClass('no-item-dividers');
					const slot = body.createDiv({ cls: 'wm-dash-group-item' });
					MusicPlayerSection.render(slot, plugin);
				}, 'music', plugin);
			}
		}
	}

	static renderCharsOnly(container: HTMLElement, plugin: WritingMenuPlugin) {
		this.renderCharsContent(container, plugin);
	}

	private static renderCharsContent(root: HTMLElement, plugin: WritingMenuPlugin) {
		const store = plugin.charStore;
		const statsItem = root.createDiv({ cls: 'wm-dash-group-item' });

		// DOM 구조 한 번 생성, SVG 재파싱 없이 text node만 갱신하는 함수 반환
		const { updateChars, updateAvg } = this.buildStatsCardLive(statsItem, store, plugin);

		// 노트 글자수: 키 입력 즉시 반영 (디바운스 없음, DOM 재생성 없음)
		const refreshChars = () => {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view?.file) { updateChars(null); return; }
			const content = view.editor.getValue();
			updateChars({
				munpia:   calcVersionCharCount(content, 'munpia'),
				novelpia: calcVersionCharCount(content, 'novelpia'),
			});
		};

		refreshChars();

		const editorHandler = plugin.app.workspace.on('editor-change', refreshChars);
		const leafHandler   = plugin.app.workspace.on('active-leaf-change', () => { refreshChars(); updateAvg(); });
		// 일평균은 자동저장 시점에만 갱신
		const modifyHandler = plugin.app.vault.on('modify', updateAvg);

		watchDisconnect(root, () => {
			plugin.app.vault.offref(modifyHandler);
			plugin.app.workspace.offref(editorHandler);
			plugin.app.workspace.offref(leafHandler);
		});
	}

	private static renderSection(
		container: HTMLElement,
		title: string,
		fn: (body: HTMLElement) => void,
		settingsPage?: string,
		plugin?: WritingMenuPlugin,
	) {
		const isCollapsed = this.collapsed.has(title);
		const group = container.createDiv({ cls: 'wm-dash-group' });

		const hdr = group.createDiv({ cls: 'wm-dash-group-hdr' });
		hdr.createSpan({ cls: 'wm-dash-group-label', text: title });

		if (settingsPage && plugin) {
			const cog = hdr.createDiv({ cls: 'wm-dash-group-cog' });
			setIcon(cog, 'settings');
			cog.setAttribute('aria-label', `${title} 설정`);
			cog.addEventListener('click', (e) => {
				e.stopPropagation();
				const setting = (plugin.app as AppWithSettings).setting;
				setting?.open();
				setting?.openTabById(plugin.manifest.id);
				window.setTimeout(() => plugin.settingTab?.renderPage(settingsPage), 20);
			});
		}

		const chevron = hdr.createDiv({ cls: 'wm-dash-group-chevron' });
		setIcon(chevron, isCollapsed ? 'chevron-right' : 'chevron-down');

		const body = group.createDiv({ cls: 'wm-dash-group-body' + (isCollapsed ? ' is-collapsed' : '') });
		fn(body);

		hdr.addEventListener('click', () => {
			if (this.collapsed.has(title)) {
				this.collapsed.delete(title);
				body.removeClass('is-collapsed');
				setIcon(chevron, 'chevron-down');
			} else {
				this.collapsed.add(title);
				body.addClass('is-collapsed');
				setIcon(chevron, 'chevron-right');
			}
		});
	}

	private static buildStatsCardLive(
		container: HTMLElement,
		store: DailyCharStore,
		plugin: WritingMenuPlugin,
	): {
		updateChars(counts: { munpia: number; novelpia: number } | null): void;
		updateAvg(): void;
	} {
		const display = plugin.settings.statCardDisplay ?? 'both';
		const plats = display === 'munpia' ? (['munpia'] as const)
		            : display === 'novelpia' ? (['novelpia'] as const)
		            : (['munpia', 'novelpia'] as const);

		const grid = container.createDiv({ cls: 'wm-dash-stats-grid' });

		// ── 오늘 카드 — SVG는 최초 1회만 생성 ──
		const todayCard = grid.createDiv({ cls: 'wm-dash-stat-card is-today' });
		const todayTop  = todayCard.createDiv({ cls: 'wm-dash-today-top' });
		todayTop.createDiv({ cls: 'wm-dash-today-label', text: 'TODAY' });
		const numStack  = todayTop.createDiv({ cls: 'wm-dash-today-num-stack' });
		const numEls    = new Map<string, HTMLElement>();
		for (const plat of plats) {
			const row    = numStack.createDiv({ cls: 'wm-dash-today-num-row' });
			const logoEl = row.createDiv({ cls: 'wm-dash-platform-logo' });
			logoEl.appendChild(sanitizeHTMLToDom(plat === 'munpia' ? MUNPIA_SVG : NOVELPIA_SVG));
			numEls.set(plat, row.createDiv({ cls: 'wm-dash-stat-num wm-dash-today-num wm-dash-today-sum', text: '—' }));
		}
		const todayBot = todayCard.createDiv({ cls: 'wm-dash-today-bot' });
		const remainEl = todayBot.createDiv({ cls: 'wm-dash-today-remain' });

		// ── 일평균 카드 ──
		const avgCard  = grid.createDiv({ cls: 'wm-dash-stat-card is-avg' });
		const avgRow   = avgCard.createDiv({ cls: 'wm-dash-stat-row' });
		avgRow.createDiv({ cls: 'wm-dash-stat-lbl', text: '일평균' });
		const avgNumEl = avgRow.createDiv({ cls: 'wm-dash-stat-num', text: '—' });

		// ── 목표 카드 ──
		const goal     = plugin.settings.writingGoalChars ?? 0;
		const goalCard = grid.createDiv({ cls: 'wm-dash-stat-card is-goal' });
		const goalRow  = goalCard.createDiv({ cls: 'wm-dash-stat-row' });
		goalRow.createDiv({ cls: 'wm-dash-stat-lbl', text: '목표' });
		goalRow.createDiv({ cls: 'wm-dash-stat-num', text: goal > 0 ? goal.toLocaleString() : '—' });

		// 글자수 text node만 갱신 (DOM 재생성 없음)
		const updateChars = (counts: { munpia: number; novelpia: number } | null) => {
			const mode        = plugin.settings.charCountMode ?? 'munpia';
			const currentGoal = plugin.settings.writingGoalChars ?? 0;
			for (const plat of plats) {
				const el = numEls.get(plat);
				if (el) el.textContent = counts ? `${counts[plat].toLocaleString()}자` : '—';
			}
			const count = counts?.[mode] ?? 0;
			remainEl.empty();
			todayBot.removeClass('is-achieved');
			remainEl.removeClass('is-achieved');
			if (counts !== null && currentGoal > 0 && count >= currentGoal) {
				remainEl.addClass('is-achieved');
				todayBot.addClass('is-achieved');
				remainEl.appendText('목표 달성!');
			} else if (counts !== null && currentGoal > 0) {
				remainEl.appendText('목표까지 ');
				remainEl.createSpan({ cls: 'wm-dash-today-remain-num', text: `${(currentGoal - count).toLocaleString()}자` });
			}
		};

		// 일평균 text node만 갱신
		const updateAvg = () => {
			const avg = store.getDailyAverage();
			avgNumEl.textContent = avg > 0 ? avg.toLocaleString() : '—';
		};

		updateAvg();
		return { updateChars, updateAvg };
	}
}
