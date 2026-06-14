import { setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { HeatmapRenderer } from './HeatmapRenderer';
import { TaskParser } from './data/TaskParser';
import { TasksRenderer } from './TasksRenderer';
import { WritingTimeSection } from './WritingTimeSection';
import type { HeatmapStore } from './data/HeatmapStore';

export class DashboardSection {
	private static collapsed = new Set<string>();

	static render(container: HTMLElement, plugin: WritingMenuPlugin) {
		const wrap = container.createDiv({ cls: 'wm-dash' });
		const store = plugin.heatmapStore;

		this.renderSection(wrap, '글자수', (body) => {
			body.addClass('no-item-dividers');
			const statsItem   = body.createDiv({ cls: 'wm-dash-group-item' });
			const heatmapItem = body.createDiv({ cls: 'wm-dash-group-item' });
			this.renderStatsCard(statsItem, store, plugin);
			HeatmapRenderer.render(heatmapItem, store, plugin);

			// 파일 수정 시 stats 카드 실시간 갱신
			const modifyHandler = plugin.app.vault.on('modify', () => {
				statsItem.empty();
				this.renderStatsCard(statsItem, store, plugin);
			});
			const observer = new MutationObserver(() => {
				if (!body.isConnected) {
					plugin.app.vault.offref(modifyHandler);
					observer.disconnect();
				}
			});
			observer.observe(document.body, { childList: true, subtree: true });
		});

		this.renderSection(wrap, '작업 시간', (body) => {
			body.addClass('no-item-dividers');
			const slot = body.createDiv({ cls: 'wm-dash-group-item' });
			WritingTimeSection.render(slot, plugin).catch(() => {});
		});

		this.renderSection(wrap, '할 일', (body) => {
			const slot = body.createDiv();
			TaskParser.loadTasks(plugin)
				.then(tasks => {
					slot.empty();
					if (tasks.length > 0) TasksRenderer.render(slot, tasks, plugin);
				})
				.catch(() => {});
		});
	}

	private static renderSection(
		container: HTMLElement,
		title: string,
		fn: (body: HTMLElement) => void,
	) {
		const isCollapsed = this.collapsed.has(title);
		const group = container.createDiv({ cls: 'wm-dash-group' });

		const hdr = group.createDiv({ cls: 'wm-dash-group-hdr' });
		hdr.createSpan({ cls: 'wm-dash-group-label', text: title });
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

	private static renderStatsCard(container: HTMLElement, store: HeatmapStore, plugin: WritingMenuPlugin) {
		const folder     = plugin.settings.heatmapFolder ?? '';
		const todayTotal = folder ? store.getTodayTotalForFolder(folder) : store.getTodayTotal();
		const goal       = plugin.settings.writingGoalChars ?? 0;
		const average    = store.getDailyAverage();

		const grid = container.createDiv({ cls: 'wm-dash-stats-grid' });

		// ── 오늘 카드 (좌열 2행 span) ──
		// top (목표 카드 높이에 매핑): '오늘' + 숫자
		// bot (일평균 카드 높이에 매핑): '목표까지~'  → 일직선 정렬
		const todayCard = grid.createDiv({ cls: 'wm-dash-stat-card is-today' });
		const todayTop  = todayCard.createDiv({ cls: 'wm-dash-today-top' });
		todayTop.createDiv({ cls: 'wm-dash-today-label', text: 'TODAY' });
		todayTop.createDiv({ cls: 'wm-dash-stat-num wm-dash-today-num', text: todayTotal.toLocaleString() });
		const todayBot = todayCard.createDiv({ cls: 'wm-dash-today-bot' });
		const remain   = todayBot.createDiv({ cls: 'wm-dash-today-remain' });
		if (goal > 0 && todayTotal >= goal) {
			remain.textContent = '목표 달성!';
		} else if (goal > 0) {
			remain.appendText('목표까지 ');
			remain.createSpan({ cls: 'wm-dash-today-remain-num', text: `${(goal - todayTotal).toLocaleString()}자` });
			remain.appendText(' 남았어요');
		}

		// ── 목표 카드 (우상단) ──
		const goalCard = grid.createDiv({ cls: 'wm-dash-stat-card is-goal' });
		const goalRow  = goalCard.createDiv({ cls: 'wm-dash-stat-row' });
		goalRow.createDiv({ cls: 'wm-dash-stat-lbl', text: '목표' });
		goalRow.createDiv({ cls: 'wm-dash-stat-num', text: goal > 0 ? goal.toLocaleString() : '—' });
		const cog = goalCard.createDiv({ cls: 'wm-dash-stat-cog' });
		setIcon(cog, 'settings');
		cog.setAttribute('aria-label', '글자수 설정');
		cog.addEventListener('click', (e) => {
			e.stopPropagation();
			const setting = (plugin.app as any).setting;
			setting.open();
			setting.openTabById(plugin.manifest.id);
			setTimeout(() => plugin.settingTab?.renderPage('calendar-chars'), 20);
		});

		// ── 일평균 카드 (우하단) ──
		const avgCard = grid.createDiv({ cls: 'wm-dash-stat-card is-avg' });
		const avgRow = avgCard.createDiv({ cls: 'wm-dash-stat-row' });
		avgRow.createDiv({ cls: 'wm-dash-stat-lbl', text: '일평균' });
		avgRow.createDiv({ cls: 'wm-dash-stat-num', text: average > 0 ? average.toLocaleString() : '—' });
	}
}
