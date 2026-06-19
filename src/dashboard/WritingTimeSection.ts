import { TFile, setIcon, normalizePath } from 'obsidian';

declare const moment: (date?: unknown, fmt?: string) => { format(f: string): string };
import type WritingMenuPlugin from '../../main';
import { WritingTimeStore, ModeTime } from './data/WritingTimeStore';
import type { TimeModeConfig } from '../types';
import { watchDisconnect } from '../utils/domUtils';
import { getDnConfig } from '../utils/dailyNoteUtils';
import { toHMS, fmtTimeFull as fmtTime } from '../utils/timeUtils';

const getModeIcon = (mode: TimeModeConfig): string => {
	if (mode.icon) return mode.icon;
	const defaults: Record<string, string> = {
		draft: 'lightbulb', writing: 'pencil', editing: 'spell-check',
	};
	return defaults[mode.id] ?? 'clock';
};

interface ModeCardEls {
	timeEl:      HTMLElement;
	avgBadgeEl:  HTMLElement;
	goalBadgeEl: HTMLElement;
}

export class WritingTimeSection {
	static async render(container: HTMLElement, plugin: WritingMenuPlugin): Promise<void> {
		const { app, settings } = plugin;
		const modes: TimeModeConfig[] = settings.timeModes?.length
			? settings.timeModes
			: [
				{ id: 'draft',   label: '기획', icon: 'lightbulb',  frontmatterKey: '초고_시간', goalSeconds: 7200 },
				{ id: 'writing', label: '초고', icon: 'pencil',      frontmatterKey: '집필_시간', goalSeconds: 7200 },
				{ id: 'editing', label: '퇴고', icon: 'spell-check', frontmatterKey: '퇴고_시간', goalSeconds: 7200 },
			];
		const totalKey = settings.timeTotalKey ?? '총_시간';


		const getAvgFolder = (file: TFile | null): string => {
			if (!file) return settings.trackingFolder ?? '';
			const level = settings.timeAvgFolderLevel ?? 0;
			let path = file.parent?.path ?? '';
			for (let i = 0; i < level; i++) {
				const up = path.lastIndexOf('/');
				if (up < 0) break;
				path = path.slice(0, up);
			}
			return path;
		};

		// 현재 파일이 속한 프로젝트명 (trackingFolder 직하위 폴더명)
		const getProjectName = (file: TFile | null): string | null => {
			const trackingFolder = settings.trackingFolder;
			if (!trackingFolder || !file) return null;
			const norm = normalizePath(trackingFolder);
			const filePath = file.path;
			if (!filePath.startsWith(norm + '/')) return null;
			const excludes = (settings.timeExcludeFolders ?? []).map(f => normalizePath(f));
			if (excludes.some(ex => filePath.startsWith(ex + '/') || filePath === ex)) return null;
			const rel = filePath.slice(norm.length + 1);
			const slash = rel.indexOf('/');
			return slash >= 0 ? rel.slice(0, slash) : norm.split('/').pop() ?? norm;
		};

		const initialFile = app.workspace.getActiveFile();
		const initialProj = getProjectName(initialFile);
		let stat = initialProj
			? await WritingTimeStore.averageDailyNotes(app, getDnConfig(plugin).folder, initialProj, modes)
			: await WritingTimeStore.averageFolder(app, getAvgFolder(initialFile), modes);

		const card = container.createDiv({ cls: 'wm-wt-card' });

		let selectedMode = plugin.settings.currentTimeMode ?? modes[0]?.id ?? '';
		if (!modes.find(m => m.id === selectedMode)) selectedMode = modes[0]?.id ?? '';

		let updateStatsRow: (() => void) | null = null;
		let trackingFile:   TFile | null = null;
		let isTyping        = false;
		let lastTyped       = Date.now();
		let isSaving        = false;
		let isDailySaving   = false;
		let avgDebounceTimer = 0;
		let saveTickCount   = 0;

		const modeCardEls = new Map<string, ModeCardEls>();

		// ── pending ──
		const loadPending = (file: TFile) => {
			for (const m of [...modes.map(m => m.id), 'total']) {
				const key = `${file.path}:${m}`;
				if (!plugin.pendingTimeUpdates.has(key))
					plugin.pendingTimeUpdates.set(key, { file, mode: m, seconds: 0 });
			}
		};

		// ── 데일리노트에 프로젝트별 시간 기록 ──
		const saveDailyTime = async (
			projectName: string,
			deltas: Record<string, number>,
			totalDelta: number,
		) => {
			if (isDailySaving) return;
			const { folder, format } = getDnConfig(plugin);
			const name = moment().format(format);
			const dnPath = folder ? `${folder}/${name}.md` : `${name}.md`;
			let dnFile = app.vault.getAbstractFileByPath(dnPath);
			if (!(dnFile instanceof TFile)) {
				try { dnFile = await app.vault.create(dnPath, '---\n---\n'); } catch { return; }
			}
			if (!(dnFile instanceof TFile)) return;
			isDailySaving = true;
			try {
				await app.fileManager.processFrontMatter(dnFile, (fm2: Record<string, unknown>) => {
					for (const m of modes) {
						const delta = deltas[m.id] ?? 0;
						if (delta === 0) continue;
						const dailyKey = `${projectName}_${m.frontmatterKey}`;
						fm2[dailyKey] = toHMS(WritingTimeStore.parseTime(fm2[dailyKey]) + delta);
					}
					if (totalDelta > 0) {
						const dailyTotalKey = `${projectName}_${totalKey}`;
						fm2[dailyTotalKey] = toHMS(WritingTimeStore.parseTime(fm2[dailyTotalKey]) + totalDelta);
					}
				});
			}
			finally { window.setTimeout(() => { isDailySaving = false; }, 200); }
		};

		// ── 현재 파일에 저장 + 데일리노트에도 기록 ──
		const savePending = async (file: TFile) => {
			if (isSaving) return;

			// 리셋 전에 delta 캡처
			const deltas: Record<string, number> = {};
			for (const m of modes)
				deltas[m.id] = plugin.pendingTimeUpdates.get(`${file.path}:${m.id}`)?.seconds ?? 0;
			const totalEntry = plugin.pendingTimeUpdates.get(`${file.path}:total`);
			const totalDelta = totalEntry?.seconds ?? 0;

			const hasUpdates = modes.some(m => deltas[m.id] > 0) || totalDelta > 0;
			if (!hasUpdates) return;

			isSaving = true;
			try {
				await app.fileManager.processFrontMatter(file, (fm2: Record<string, unknown>) => {
					for (const m of modes) {
						if (deltas[m.id] === 0) continue;
						fm2[m.frontmatterKey] = toHMS(WritingTimeStore.parseTime(fm2[m.frontmatterKey]) + deltas[m.id]);
					}
					if (totalDelta > 0)
						fm2[totalKey] = toHMS(WritingTimeStore.parseTime(fm2[totalKey]) + totalDelta);
				});
			} finally { window.setTimeout(() => { isSaving = false; }, 200); }

			// 프로젝트 폴더 안 파일이면 데일리노트에도 기록
			const proj = getProjectName(file);
			if (proj) await saveDailyTime(proj, deltas, totalDelta);

			// pending 리셋
			for (const m of [...modes.map(m => m.id), 'total']) {
				const entry = plugin.pendingTimeUpdates.get(`${file.path}:${m}`);
				if (entry) entry.seconds = 0;
			}
		};

		// ── 배지 (퍼센트 + 아이콘) ──
		const updateBadge = (el: HTMLElement, cur: number, ref: number, invertColors = false) => {
			el.empty();
			if (ref <= 0) {
				el.textContent = '—';
				el.className = 'wm-wt-mc-badge is-neutral';
				return;
			}
			const pct     = Math.round(((cur - ref) / ref) * 100);
			const isAbove = pct > 0;
			const isBelow = pct < 0;
			if (pct === 0) {
				el.textContent = '0%';
				el.className = 'wm-wt-mc-badge is-neutral';
				return;
			}
			let cls = 'is-neutral';
			if (isAbove) cls = invertColors ? 'is-below' : 'is-above';
			if (isBelow) cls = invertColors ? 'is-above' : 'is-below';
			el.className  = `wm-wt-mc-badge ${cls}`;
			const iconEl  = el.createSpan({ cls: 'wm-wt-badge-icon' });
			setIcon(iconEl, isAbove ? 'trending-up' : 'trending-down');
			el.createSpan({ text: ` ${Math.abs(pct)}%` });
		};

		const updateCardEls = (modeId: string, cur: number) => {
			const els  = modeCardEls.get(modeId);
			const mode = modes.find(m => m.id === modeId);
			if (!els || !mode) return;
			els.timeEl.textContent = fmtTime(cur);
			updateBadge(els.avgBadgeEl,  cur, stat.avg[modeId]  ?? 0, true);
			updateBadge(els.goalBadgeEl, cur, mode.goalSeconds   ?? 0, true);
		};

		const getTimeFile = (): TFile | null => trackingFile ?? app.workspace.getActiveFile();

		// ── buildCard ──
		const buildCard = () => {
			card.empty();
			modeCardEls.clear();

			const timeFile = getTimeFile();
			const time: ModeTime = timeFile
				? WritingTimeStore.getFileTime(app, timeFile, modes, totalKey, plugin.pendingTimeUpdates)
				: Object.fromEntries([...modes.map(m => [m.id, 0]), ['total', 0]]) as ModeTime;

			const grid = card.createDiv({ cls: 'wm-wt-mode-grid' });

			for (const mode of modes) {
				const cur        = time[mode.id] ?? 0;
				const isSelected = mode.id === selectedMode;

				const modeCard = grid.createDiv({ cls: `wm-wt-mode-card${isSelected ? ' is-selected' : ''}` });
				modeCard.dataset.mode = mode.id;

				const chipWrap = modeCard.createDiv({ cls: 'wm-wt-mc-chip-wrap' });
				const iconEl   = chipWrap.createSpan({ cls: 'wm-wt-mc-chip-icon' });
				setIcon(iconEl, getModeIcon(mode));
				chipWrap.createSpan({ cls: 'wm-wt-mc-chip-label', text: mode.label });

				const body   = modeCard.createDiv({ cls: 'wm-wt-mc-body' });
				const timeEl = body.createDiv({ cls: 'wm-wt-mc-time', text: fmtTime(cur) });

				const cmps = body.createDiv({ cls: 'wm-wt-mc-comparisons' });

				const goalRow = cmps.createDiv({ cls: 'wm-wt-mc-cmp-row' });
				goalRow.createSpan({ cls: 'wm-wt-mc-cmp-lbl', text: '목표 대비' });
				const goalBadgeEl = goalRow.createSpan({ cls: 'wm-wt-mc-badge is-neutral' });

				const avgRow = cmps.createDiv({ cls: 'wm-wt-mc-cmp-row' });
				avgRow.createSpan({ cls: 'wm-wt-mc-cmp-lbl', text: '평균 대비' });
				const avgBadgeEl = avgRow.createSpan({ cls: 'wm-wt-mc-badge is-neutral' });

				modeCardEls.set(mode.id, { timeEl, avgBadgeEl, goalBadgeEl });
				updateCardEls(mode.id, cur);

				modeCard.addEventListener('click', () => {
					grid.querySelectorAll<HTMLElement>('.wm-wt-mode-card').forEach(c => c.classList.remove('is-selected'));
					modeCard.classList.add('is-selected');
					selectedMode = mode.id;
					plugin.settings.currentTimeMode = mode.id;
					plugin.saveSettings().catch(() => {});
					updateStatsRow?.();
				});
			}

			// ── 목표 / 일평균 통합 카드 ──
			const statCard = grid.createDiv({ cls: 'wm-wt-mode-card wm-wt-stat-combined' });

			const chipWrap = statCard.createDiv({ cls: 'wm-wt-mc-chip-wrap' });
			const chipIcon = chipWrap.createSpan({ cls: 'wm-wt-mc-chip-icon' });
			setIcon(chipIcon, 'bar-chart-2');
			chipWrap.createSpan({ cls: 'wm-wt-mc-chip-label', text: '목표 & 평균' });

			const body = statCard.createDiv({ cls: 'wm-wt-mc-body' });

			const goalCol = body.createDiv({ cls: 'wm-wt-sc-col' });
			const goalStatNum = goalCol.createSpan({ cls: 'wm-wt-mc-time' });
			goalCol.createSpan({ cls: 'wm-wt-mc-badge wm-wt-sc-badge-goal', text: '목표' });

			const avgCol = body.createDiv({ cls: 'wm-wt-sc-col' });
			const avgStatNum = avgCol.createSpan({ cls: 'wm-wt-mc-time' });
			avgCol.createSpan({ cls: 'wm-wt-mc-badge wm-wt-sc-badge-avg', text: '평균' });

			updateStatsRow = () => {
				const mode = modes.find(m => m.id === selectedMode);
				const avgSec = stat.avg[selectedMode] ?? 0;
				goalStatNum.textContent = mode?.goalSeconds ? fmtTime(mode.goalSeconds) : '—';
				avgStatNum.textContent  = avgSec > 0 ? fmtTime(avgSec) : '—';
			};
			updateStatsRow();
		};

		// ── updateDisplay ──
		const updateDisplay = () => {
			const extMode = plugin.settings.currentTimeMode;
			if (extMode && extMode !== selectedMode && modes.find(m => m.id === extMode)) {
				selectedMode = extMode;
				buildCard();
				return;
			}
			const timeFile = getTimeFile();
			if (!timeFile) return;
			const time = WritingTimeStore.getFileTime(app, timeFile, modes, totalKey, plugin.pendingTimeUpdates);
			for (const mode of modes) updateCardEls(mode.id, time[mode.id] ?? 0);
			updateStatsRow?.();
		};

		// ── 파일 전환 ──
		const onFileChange = async (file: TFile | null) => {
			if (trackingFile && trackingFile !== file) await savePending(trackingFile);
			trackingFile = file;
			if (file) {
				loadPending(file);
				const proj = getProjectName(file);
				stat = proj
					? await WritingTimeStore.averageDailyNotes(app, getDnConfig(plugin).folder, proj, modes)
					: await WritingTimeStore.averageFolder(app, getAvgFolder(file), modes);
				buildCard();
			} else {
				card.empty(); modeCardEls.clear();
				card.createDiv({ cls: 'wm-wt-empty', text: '열린 문서 없음' });
			}
		};

		// ── 초기화 ──
		trackingFile = initialFile;
		if (initialFile) {
			loadPending(initialFile);
			buildCard();
		} else {
			card.createDiv({ cls: 'wm-wt-empty', text: '열린 문서 없음' });
		}

		// ── 1초 누적 ──
		const accumInterval = window.setInterval(() => {
			if (!plugin.settings.enableTimeTracking) return;
			if (Date.now() - lastTyped > 1000) { isTyping = false; return; }
			if (!isTyping) return;
			const target = trackingFile;
			if (!target) return;
			const mKey = `${target.path}:${selectedMode}`;
			const tKey = `${target.path}:total`;
			const me = plugin.pendingTimeUpdates.get(mKey) ?? { file: target, mode: selectedMode, seconds: 0 };
			me.seconds++;
			plugin.pendingTimeUpdates.set(mKey, me);
			const te = plugin.pendingTimeUpdates.get(tKey) ?? { file: target, mode: 'total', seconds: 0 };
			te.seconds++;
			plugin.pendingTimeUpdates.set(tKey, te);
		}, 1000);

		// ── UI 갱신 + 30초마다 자동 저장 ──
		const uiInterval = window.setInterval(() => { void (async () => {
			if (!container.isConnected) { window.clearInterval(uiInterval); return; }
			saveTickCount++;
			if (saveTickCount >= 30 && trackingFile) {
				saveTickCount = 0;
				await savePending(trackingFile);
			}
			if (modeCardEls.size > 0) updateDisplay();
		})(); }, 1000);

		const editorHandler = app.workspace.on('editor-change', () => {
			if (isSaving) return;
			isTyping  = true;
			lastTyped = Date.now();
		});

		const leafHandler = app.workspace.on('active-leaf-change', () => {
			const f = app.workspace.getActiveFile();
			if (!f || f === trackingFile) return;
			void onFileChange(f).catch(() => {});
		});

		const avgModifyHandler = app.vault.on('modify', () => {
			window.clearTimeout(avgDebounceTimer);
			avgDebounceTimer = window.setTimeout(() => { void (async () => {
				const f = trackingFile;
				const proj = getProjectName(f);
				stat = proj
					? await WritingTimeStore.averageDailyNotes(app, getDnConfig(plugin).folder, proj, modes)
					: await WritingTimeStore.averageFolder(app, getAvgFolder(f), modes);
				if (modeCardEls.size > 0) updateDisplay();
			})(); }, 2000);
		});

		watchDisconnect(container, () => {
			app.workspace.offref(leafHandler);
			app.workspace.offref(editorHandler);
			app.vault.offref(avgModifyHandler);
			window.clearTimeout(avgDebounceTimer);
			window.clearInterval(uiInterval);
			window.clearInterval(accumInterval);
			if (trackingFile) savePending(trackingFile).catch(() => {});
		});
	}
}
