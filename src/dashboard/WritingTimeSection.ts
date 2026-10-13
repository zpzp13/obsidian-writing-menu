import { TFile, setIcon, normalizePath } from 'obsidian';

declare const moment: (date?: unknown, fmt?: string) => { format(f: string): string };
import type WritingMenuPlugin from '../../main';
import { WritingTimeStore, ModeTime } from './data/WritingTimeStore';
import { TaskParser } from './data/TaskParser';
import type { TimeModeConfig } from '../types';
import { watchDisconnect } from '../utils/domUtils';
import { getDnConfig } from '../utils/dailyNoteUtils';
import { toHMS, fmtTimeFull as fmtTime } from '../utils/timeUtils';
import { WritingTimeChart, type DailyModeTime } from './WritingTimeChart';

const getModeIcon = (mode: TimeModeConfig): string => {
	if (mode.icon) return mode.icon;
	const defaults: Record<string, string> = {
		draft: 'lightbulb', writing: 'pencil', editing: 'spell-check',
	};
	return defaults[mode.id] ?? 'clock';
};

interface ModeCardEls {
	timeEl: HTMLElement;
	percentEl: HTMLElement;
	goalEl: HTMLElement;
	progressEl: HTMLElement;
	averageEl: HTMLElement;
	barsEl: HTMLElement;
}

export class WritingTimeSection {
	static async render(container: HTMLElement, plugin: WritingMenuPlugin, compact?: HTMLElement): Promise<void> {
		const { app, settings } = plugin;
		const modes: TimeModeConfig[] = settings.timeModes?.length
			? settings.timeModes
			: [
				{ id: 'draft',   label: '기획', icon: 'lightbulb',  frontmatterKey: '초고_시간', goalSeconds: 7200 },
				{ id: 'writing', label: '초고', icon: 'pencil',      frontmatterKey: '집필_시간', goalSeconds: 7200 },
				{ id: 'editing', label: '퇴고', icon: 'spell-check', frontmatterKey: '퇴고_시간', goalSeconds: 7200 },
			];
		const totalKey = settings.timeTotalKey ?? '총_시간';


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
		const card = container.createDiv({ cls: 'wm-wt-card' });

		// ── 헤더 컴팩트 요소 (모드 아이콘 + 모드명 + HH:MM:SS) ──
		let compactLogoEl: HTMLElement | undefined;
		let compactTimeEl: HTMLElement | undefined;
		if (compact) {
			compactLogoEl = compact.createDiv({ cls: 'wm-wt-compact-logo' });
			compactTimeEl = compact.createSpan({ cls: 'wm-dash-hdr-compact-num' });
		}

		let selectedMode = plugin.settings.currentTimeMode ?? modes[0]?.id ?? '';
		if (!modes.find(m => m.id === selectedMode)) selectedMode = modes[0]?.id ?? '';

		let trackingFile:   TFile | null = null;
		let isTyping        = false;
		let lastTyped       = 0;
		let isSaving        = false;
		let isDailySaving   = false;
		let saveTickCount   = 0;
		let lastRenderedRevision = plugin.timeTrackingRevision;
		let timeChart: WritingTimeChart | null = null;
		let chartHistory: DailyModeTime[] = [];
		let chartLoadRevision = 0;
		let chartReloadTimer = 0;
		let reloadChartHistory: (file: TFile | null) => Promise<void> = async () => {};

		const modeCardEls = new Map<string, ModeCardEls>();
		// ── pending ──
		const loadPending = (file: TFile) => {
			for (const m of [...modes.map(m => m.id), 'total']) {
				const key = `${file.path}:${m}`;
				if (!plugin.pendingTimeUpdates.has(key))
					plugin.pendingTimeUpdates.set(key, { file, mode: m, seconds: 0, dailySavedSeconds: 0 });
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
			// 현재 편집 중인 파일과 같으면 병합 충돌 유발 — 저장 건너뜀
			if (app.workspace.getActiveFile()?.path === dnFile.path) return;
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
			if (isSaving || plugin.pendingTimeSaveInFlight.has(file.path)) return;
			plugin.pendingTimeSaveInFlight.add(file.path);

			try {
				// 리셋 전에 delta 캡처
				const deltas: Record<string, number> = {};
				for (const m of modes)
					deltas[m.id] = plugin.pendingTimeUpdates.get(`${file.path}:${m.id}`)?.seconds ?? 0;
				const totalDelta = plugin.pendingTimeUpdates.get(`${file.path}:total`)?.seconds ?? 0;

				const hasUpdates = modes.some(m => deltas[m.id] > 0) || totalDelta > 0;
				if (!hasUpdates) return;

				const isActiveFile = app.workspace.getActiveFile()?.path === file.path;
				const proj = getProjectName(file);
				if (proj) {
					const dnDeltas: Record<string, number> = {};
					for (const m of modes) {
						const entry = plugin.pendingTimeUpdates.get(`${file.path}:${m.id}`);
						const delta = (entry?.seconds ?? 0) - (entry?.dailySavedSeconds ?? 0);
						if (delta > 0) dnDeltas[m.id] = delta;
					}
					const totalEntry = plugin.pendingTimeUpdates.get(`${file.path}:total`);
					const totalDnDelta = (totalEntry?.seconds ?? 0) - (totalEntry?.dailySavedSeconds ?? 0);
					if (Object.keys(dnDeltas).length > 0 || totalDnDelta > 0) {
						await saveDailyTime(proj, dnDeltas, Math.max(0, totalDnDelta));
						for (const m of [...modes.map(m => m.id), 'total']) {
							const entry = plugin.pendingTimeUpdates.get(`${file.path}:${m}`);
							if (entry) entry.dailySavedSeconds = entry.seconds;
						}
						window.clearTimeout(chartReloadTimer);
						chartReloadTimer = window.setTimeout(() => { void reloadChartHistory(trackingFile); }, 300);
					}
				}

				// 파일이 현재 편집 중이면 frontmatter 저장 건너뜀 (병합 충돌 방지)
				if (isActiveFile) return;

				isSaving = true;
				await app.fileManager.processFrontMatter(file, (fm2: Record<string, unknown>) => {
					for (const m of modes) {
						if (deltas[m.id] === 0) continue;
						fm2[m.frontmatterKey] = toHMS(WritingTimeStore.parseTime(fm2[m.frontmatterKey]) + deltas[m.id]);
					}
					if (totalDelta > 0)
						fm2[totalKey] = toHMS(WritingTimeStore.parseTime(fm2[totalKey]) + totalDelta);
				});
				for (const m of [...modes.map(m => m.id), 'total']) {
					const entry = plugin.pendingTimeUpdates.get(`${file.path}:${m}`);
					if (entry) { entry.seconds = 0; entry.dailySavedSeconds = 0; }
				}
			} finally {
				plugin.pendingTimeSaveInFlight.delete(file.path);
				window.setTimeout(() => { isSaving = false; }, 200);
			}
		};

		const updateCardEls = (modeId: string, cur: number) => {
			const els  = modeCardEls.get(modeId);
			const mode = modes.find(candidate => candidate.id === modeId);
			if (!els || !mode) return;
			const goal = Math.max(0, mode.goalSeconds ?? 0);
			const percent = goal > 0 ? Math.round(cur / goal * 100) : 0;
			els.timeEl.textContent = formatCardTime(cur);
			els.percentEl.textContent = goal > 0 ? `${percent}%` : '—';
			els.goalEl.textContent = goal > 0 ? `of ${formatCardTime(goal)}` : '목표 없음';
			els.progressEl.setCssStyles({ width: `${goal > 0 ? Math.max(0, Math.min(100, percent)) : 0}%` });
		};

		const formatCardTime = (seconds: number): string => {
			const safe = Math.max(0, Math.round(seconds));
			const hours = Math.floor(safe / 3600);
			const minutes = Math.floor((safe % 3600) / 60);
			if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
			if (minutes > 0) return `${minutes}m`;
			return `${safe}s`;
		};

		const updateCompact = (sec: number) => {
			if (!compactLogoEl || !compactTimeEl) return;
			const mode = modes.find(m => m.id === selectedMode);
			if (!mode) return;
			setIcon(compactLogoEl, getModeIcon(mode));
			compactTimeEl.textContent = toHMS(sec);
		};

		const getTimeFile = (): TFile | null => trackingFile ?? app.workspace.getActiveFile();
		const getLiveDailyDelta = (file: TFile | null): Record<string, number> => {
			const result: Record<string, number> = {};
			if (!file) return result;
			for (const mode of modes) {
				const entry = plugin.pendingTimeUpdates.get(`${file.path}:${mode.id}`);
				result[mode.id] = Math.max(0, (entry?.seconds ?? 0) - (entry?.dailySavedSeconds ?? 0));
			}
			return result;
		};
		const updateModeHistoryCards = (file: TFile | null) => {
			const live = getLiveDailyDelta(file);
			for (const mode of modes) {
				const els = modeCardEls.get(mode.id);
				if (!els) continue;
				const recent = chartHistory.slice(-7).map((row, index, rows) => {
					const pending = index === rows.length - 1 ? Math.max(0, live[mode.id] ?? 0) : 0;
					return Math.max(0, row.values[mode.id] ?? 0) + pending;
				});
				const average = recent.length > 0
					? Math.round(recent.reduce((sum, value) => sum + value, 0) / recent.length)
					: 0;
				els.averageEl.textContent = `avg ${formatCardTime(average)}`;
				els.barsEl.empty();
				const max = Math.max(1, ...recent);
				for (const value of recent) {
					const bar = els.barsEl.createSpan();
					bar.setCssStyles({ height: `${value > 0 ? Math.max(10, value / max * 100) : 5}%` });
				}
			}
		};

		reloadChartHistory = async (file: TFile | null) => {
			if (!file || !timeChart) return;
			const revision = ++chartLoadRevision;
			const { folder, format } = getDnConfig(plugin);
			const rows = await WritingTimeStore.getDailyHistory(
				app,
				folder,
				format,
				modes,
				30,
				getProjectName(file),
			);
			if (revision !== chartLoadRevision || !timeChart) return;
			chartHistory = rows;
			timeChart.setHistory(rows, getLiveDailyDelta(file));
			updateModeHistoryCards(file);
		};

		// ── buildCard ──
		const buildCard = () => {
			chartLoadRevision++;
			timeChart?.destroy();
			timeChart = null;
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
				const selectedCheck = modeCard.createSpan({
					cls: 'wm-wt-mode-selected-check',
					attr: { 'aria-hidden': 'true' },
				});
				setIcon(selectedCheck, 'star');

				const chipWrap = modeCard.createDiv({ cls: 'wm-wt-mc-chip-wrap' });
				const iconEl   = chipWrap.createSpan({ cls: 'wm-wt-mc-chip-icon' });
				setIcon(iconEl, getModeIcon(mode));
				chipWrap.createSpan({ cls: 'wm-wt-mc-chip-label', text: mode.label });

				const progressTrack = modeCard.createDiv({ cls: 'wm-wt-mc-progress-track' });
				const progressEl = progressTrack.createDiv({ cls: 'wm-wt-mc-progress-fill' });
				const body = modeCard.createDiv({ cls: 'wm-wt-mc-body' });
				const metricRow = body.createDiv({ cls: 'wm-wt-mc-metric-row' });
				const timeEl = metricRow.createDiv({ cls: 'wm-wt-mc-time' });
				const percentEl = metricRow.createDiv({ cls: 'wm-wt-mc-percent' });
				const goalEl = body.createDiv({ cls: 'wm-wt-mc-goal' });
				const footer = modeCard.createDiv({ cls: 'wm-wt-mc-footer' });
				const averageBlock = footer.createDiv({ cls: 'wm-wt-mc-average' });
				const averageEl = averageBlock.createDiv({ cls: 'wm-wt-mc-average-value', text: 'avg 0s' });
				averageBlock.createDiv({ cls: 'wm-wt-mc-average-label', text: 'last 7 days' });
				const barsEl = footer.createDiv({ cls: 'wm-wt-mc-mini-bars', attr: { 'aria-hidden': 'true' } });
				modeCardEls.set(mode.id, { timeEl, percentEl, goalEl, progressEl, averageEl, barsEl });
				updateCardEls(mode.id, cur);

				modeCard.addEventListener('click', () => {
					grid.querySelectorAll<HTMLElement>('.wm-wt-mode-card').forEach(c => c.classList.remove('is-selected'));
					modeCard.classList.add('is-selected');
					selectedMode = mode.id;
					plugin.settings.currentTimeMode = mode.id;
					plugin.saveSettings().catch(() => {});
					const f = getTimeFile();
					if (f) {
						const t = WritingTimeStore.getFileTime(app, f, modes, totalKey, plugin.pendingTimeUpdates);
						updateCompact(t[mode.id] ?? 0);
					}
				});
			}

			timeChart = new WritingTimeChart(card, modes);
			void reloadChartHistory(timeFile);
			updateCompact(time[selectedMode] ?? 0);
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
			timeChart?.setLive(getLiveDailyDelta(timeFile));
			updateModeHistoryCards(timeFile);
			updateCompact(time[selectedMode] ?? 0);
			lastRenderedRevision = plugin.timeTrackingRevision;
		};

		// ── 파일 전환 ──
		const onFileChange = async (file: TFile | null) => {
			const previousFile = trackingFile;
			// Switch the tracking target before awaiting disk I/O. Otherwise an edit or
			// paste made immediately after changing documents can be charged to the old
			// file while its pending frontmatter update is still being saved.
			trackingFile = file;
			isTyping = false;
			lastTyped = 0;
			if (previousFile && previousFile !== file) await savePending(previousFile);
			if (file) {
				loadPending(file);
				buildCard();
			} else {
				chartLoadRevision++;
				timeChart?.destroy();
				timeChart = null;
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
			if (!container.isConnected) { window.clearInterval(accumInterval); return; }
			if (!plugin.settings.enableTimeTracking) return;
			if (Date.now() - lastTyped > 1000) { isTyping = false; return; }
			if (!isTyping) return;
			const target = trackingFile;
			if (!target) return;
			// 추적 폴더가 지정된 경우, 해당 폴더 안 파일만 시간 누적
			if (settings.trackingFolder && !getProjectName(target)) return;
			// 대시보드/캘린더 등 여러 인스턴스가 동시에 떠 있어도 실제 1초당 한 번만 누적되도록 공유 타임스탬프로 잠금
			const now = Date.now();
			// setInterval 지터로 1,000ms보다 조금 일찍 실행돼도 다음 초를 놓치지 않도록
			// 여유를 둔다. 여러 대시보드 인스턴스의 중복 저장은 공용 저장 잠금이 막는다.
			if (now - plugin.lastTimeAccumAt < 900) return;
			plugin.lastTimeAccumAt = now;
			// Every visible dashboard instance owns a timer. Always read the shared mode
			// setting here so a stale, background instance cannot charge another mode.
			const activeMode = modes.some(mode => mode.id === plugin.settings.currentTimeMode)
				? plugin.settings.currentTimeMode
				: selectedMode;
			const mKey = `${target.path}:${activeMode}`;
			const tKey = `${target.path}:total`;
			const me = plugin.pendingTimeUpdates.get(mKey) ?? { file: target, mode: activeMode, seconds: 0, dailySavedSeconds: 0 };
			me.seconds++;
			plugin.pendingTimeUpdates.set(mKey, me);
			const te = plugin.pendingTimeUpdates.get(tKey) ?? { file: target, mode: 'total', seconds: 0, dailySavedSeconds: 0 };
			te.seconds++;
			plugin.pendingTimeUpdates.set(tKey, te);
			plugin.timeTrackingRevision++;
		}, 1000);

		// ── UI 갱신 + 30초마다 자동 저장 ──
		const uiInterval = window.setInterval(() => { void (async () => {
			if (!container.isConnected) { window.clearInterval(uiInterval); window.clearInterval(accumInterval); return; }
			if (lastRenderedRevision !== plugin.timeTrackingRevision || plugin.settings.currentTimeMode !== selectedMode) {
				if (modeCardEls.size > 0) updateDisplay();
			}
			saveTickCount++;
			if (saveTickCount >= 30 && trackingFile) {
				saveTickCount = 0;
				const hasPending = [...modes.map(mode => mode.id), 'total']
					.some(modeId => (plugin.pendingTimeUpdates.get(`${trackingFile!.path}:${modeId}`)?.seconds ?? 0) > 0);
				if (hasPending) await savePending(trackingFile);
			}
		})(); }, 1000);

		const editorHandler = app.workspace.on('editor-change', (_editor, info) => {
			if (isSaving) return;
			const editedFile = info.file;
			const activeFile = app.workspace.getActiveFile();
			// Ignore programmatic/background changes and events from another Markdown
			// leaf. This also prevents a large paste in a newly selected document from
			// keeping the previous document's timer alive.
			if (!editedFile || !activeFile || !trackingFile) return;
			if (editedFile.path !== activeFile.path || editedFile.path !== trackingFile.path) return;
			isTyping  = true;
			lastTyped = Date.now();
		});

		const leafHandler = app.workspace.on('active-leaf-change', () => {
			const f = app.workspace.getActiveFile();
			if (!f || f === trackingFile) return;
			void onFileChange(f).catch(() => {});
		});

		const chartModifyHandler = app.vault.on('modify', (file) => {
			if (!(file instanceof TFile) || !TaskParser.isDailyNoteFile(file, plugin)) return;
			window.clearTimeout(chartReloadTimer);
			chartReloadTimer = window.setTimeout(() => { void reloadChartHistory(trackingFile); }, 300);
		});

		watchDisconnect(container, () => {
			app.workspace.offref(leafHandler);
			app.workspace.offref(editorHandler);
			app.vault.offref(chartModifyHandler);
			window.clearTimeout(chartReloadTimer);
			window.clearInterval(uiInterval);
			window.clearInterval(accumInterval);
			chartLoadRevision++;
			timeChart?.destroy();
			timeChart = null;
			if (trackingFile) savePending(trackingFile).catch(() => {});
		});
	}
}
