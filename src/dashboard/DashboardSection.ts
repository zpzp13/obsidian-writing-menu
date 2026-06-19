import { setIcon, MarkdownView } from 'obsidian';
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
		const store = plugin.charStore;

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
		const getCurrentCounts = () => {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view?.file) return null;
			const content = view.editor.getValue();
			return {
				munpia:   calcVersionCharCount(content, 'munpia'),
				novelpia: calcVersionCharCount(content, 'novelpia'),
			};
		};
		this.renderStatsCard(statsItem, store, plugin, getCurrentCounts());
		const refreshStats = () => { statsItem.empty(); this.renderStatsCard(statsItem, store, plugin, getCurrentCounts()); };
		const modifyHandler = plugin.app.vault.on('modify', refreshStats);
		const editorHandler = plugin.app.workspace.on('editor-change', refreshStats);
		const leafHandler   = plugin.app.workspace.on('active-leaf-change', refreshStats);
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
				const setting = (plugin.app as any).setting;
				setting.open();
				setting.openTabById(plugin.manifest.id);
				setTimeout(() => plugin.settingTab?.renderPage(settingsPage), 20);
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

	private static renderStatsCard(
		container: HTMLElement,
		store: DailyCharStore,
		plugin: WritingMenuPlugin,
		currentCounts: { munpia: number; novelpia: number } | null = null,
	) {
		const goal    = plugin.settings.writingGoalChars ?? 0;
		const average = store.getDailyAverage();
		const mode    = plugin.settings.charCountMode ?? 'munpia';
		const count   = currentCounts?.[mode] ?? 0;

		const grid = container.createDiv({ cls: 'wm-dash-stats-grid' });

		// ── 오늘 카드 (좌열 2행 span) — 현재 노트 글자수 ──
		const todayCard = grid.createDiv({ cls: 'wm-dash-stat-card is-today' });
		const todayTop  = todayCard.createDiv({ cls: 'wm-dash-today-top' });
		todayTop.createDiv({ cls: 'wm-dash-today-label', text: 'TODAY' });
		const numStack = todayTop.createDiv({ cls: 'wm-dash-today-num-stack' });
		const display = plugin.settings.statCardDisplay ?? 'both';
		const plats = display === 'munpia' ? (['munpia'] as const)
		            : display === 'novelpia' ? (['novelpia'] as const)
		            : (['munpia', 'novelpia'] as const);
		for (const plat of plats) {
			const row = numStack.createDiv({ cls: 'wm-dash-today-num-row' });
			const logoEl = row.createDiv({ cls: 'wm-dash-platform-logo' });
			logoEl.innerHTML = plat === 'munpia' ? MUNPIA_SVG : NOVELPIA_SVG;
			const n = currentCounts?.[plat] ?? null;
			row.createDiv({ cls: 'wm-dash-stat-num wm-dash-today-num wm-dash-today-sum', text: n !== null ? `${n.toLocaleString()}자` : '—' });
		}
		const todayBot = todayCard.createDiv({ cls: 'wm-dash-today-bot' });
		const remain   = todayBot.createDiv({ cls: 'wm-dash-today-remain' });
		if (currentCounts !== null && goal > 0 && count >= goal) {
			remain.addClass('is-achieved');
			todayBot.addClass('is-achieved');
			remain.appendText('목표 달성!');
		} else if (currentCounts !== null && goal > 0) {
			remain.appendText('목표까지 ');
			remain.createSpan({ cls: 'wm-dash-today-remain-num', text: `${(goal - count).toLocaleString()}자` });
		}

		// ── 일평균 카드 (우상단) ──
		const avgCard = grid.createDiv({ cls: 'wm-dash-stat-card is-avg' });
		const avgRow = avgCard.createDiv({ cls: 'wm-dash-stat-row' });
		avgRow.createDiv({ cls: 'wm-dash-stat-lbl', text: '일평균' });
		avgRow.createDiv({ cls: 'wm-dash-stat-num', text: average > 0 ? average.toLocaleString() : '—' });

		// ── 목표 카드 (우하단) ──
		const goalCard = grid.createDiv({ cls: 'wm-dash-stat-card is-goal' });
		const goalRow  = goalCard.createDiv({ cls: 'wm-dash-stat-row' });
		goalRow.createDiv({ cls: 'wm-dash-stat-lbl', text: '목표' });
		goalRow.createDiv({ cls: 'wm-dash-stat-num', text: goal > 0 ? goal.toLocaleString() : '—' });
	}
}
