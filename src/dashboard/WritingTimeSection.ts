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
	timeEl:       HTMLElement;
	avgBadgeUpd:  (cur: number, ref: number) => void;
	goalBadgeUpd: (cur: number, ref: number) => void;
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

		// ── 헤더 컴팩트 요소 (모드 아이콘 + 모드명 + HH:MM:SS) ──
		let compactLogoEl: HTMLElement | undefined;
		let compactTimeEl: HTMLElement | undefined;
		if (compact) {
			compactLogoEl = compact.createDiv({ cls: 'wm-wt-compact-logo' });
			compactTimeEl = compact.createSpan({ cls: 'wm-dash-hdr-compact-num' });
		}

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
		// 이번 세션에서 데일리노트에 저장한 누적값 (파일 저장 없이 증분 업데이트용)
		const dnSaved = new Map<string, number>();

		// ── pending ──
		const loadPending = (file: TFile) => {
			for (const m of [...modes.map(m => m.id), 'total']) {
				const key = `${file.path}:${m}`;
				if (!plugin.pendingTimeUpdates.has(key))
					plugin.pendingTimeUpdates.set(key, { file, mode: m, seconds: 0 });
			}
			// dnSaved를 현재 pending 기준으로 초기화 — 재렌더 시 이미 저장된 값을 이중으로 저장하지 않음
			for (const m of [...modes.map(m => m.id), 'total']) {
				const key = `${file.path}:${m}`;
				dnSaved.set(key, plugin.pendingTimeUpdates.get(key)?.seconds ?? 0);
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
			if (isSaving) return;

			// 리셋 전에 delta 캡처
			const deltas: Record<string, number> = {};
			for (const m of modes)
				deltas[m.id] = plugin.pendingTimeUpdates.get(`${file.path}:${m.id}`)?.seconds ?? 0;
			const totalDelta = plugin.pendingTimeUpdates.get(`${file.path}:total`)?.seconds ?? 0;

			const hasUpdates = modes.some(m => deltas[m.id] > 0) || totalDelta > 0;
			if (!hasUpdates) return;

			const isActiveFile = app.workspace.getActiveFile()?.path === file.path;

			// 프로젝트 폴더 안 파일이면 데일리노트에 증분 저장 (파일 활성 여부 무관)
			const proj = getProjectName(file);
			if (proj) {
				const dnDeltas: Record<string, number> = {};
				let dnTotal = 0;
				for (const m of modes) {
					const key = `${file.path}:${m.id}`;
					const already = dnSaved.get(key) ?? 0;
					const delta = (deltas[m.id] ?? 0) - already;
					if (delta > 0) { dnDeltas[m.id] = delta; dnTotal += delta; }
				}
				const totalKey2 = `${file.path}:total`;
				const totalDnDelta = totalDelta - (dnSaved.get(totalKey2) ?? 0);
				if (Object.keys(dnDeltas).length > 0 || totalDnDelta > 0) {
					await saveDailyTime(proj, dnDeltas, Math.max(dnTotal, totalDnDelta > 0 ? totalDnDelta : 0));
					for (const m of modes) {
						const key = `${file.path}:${m.id}`;
						dnSaved.set(key, deltas[m.id] ?? 0);
					}
					if (totalDnDelta > 0) dnSaved.set(totalKey2, totalDelta);
				}
			}

			// 파일이 현재 편집 중이면 frontmatter 저장 건너뜀 (병합 충돌 방지)
			if (isActiveFile) return;

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

			// pending 리셋 + dnSaved 초기화 (파일 저장 완료)
			for (const m of [...modes.map(m => m.id), 'total']) {
				const entry = plugin.pendingTimeUpdates.get(`${file.path}:${m}`);
				if (entry) entry.seconds = 0;
			}
			dnSaved.clear();
		};

		// ── 배지 (퍼센트 + 아이콘) — DOM은 최초 1회 생성, 값 변경 시에만 갱신 ──
		const makeBadge = (el: HTMLElement, invertColors: boolean): ((cur: number, ref: number) => void) => {
			const iconEl = el.createSpan({ cls: 'wm-wt-badge-icon' });
			const textEl = el.createSpan();
			iconEl.setCssStyles({ display: 'none' });
			let lastIconName = '';

			return (cur: number, ref: number) => {
				if (ref <= 0 || cur < 60) {
					el.className = 'wm-wt-mc-badge is-neutral';
					iconEl.setCssStyles({ display: 'none' });
					textEl.textContent = '—';
					return;
				}
				const rawPct = ((cur - ref) / ref) * 100;
				const pct    = rawPct > 0 ? Math.round(rawPct) : Math.max(-99, Math.round(rawPct));
				if (pct === 0) {
					el.className = 'wm-wt-mc-badge is-neutral';
					iconEl.setCssStyles({ display: 'none' });
					textEl.textContent = '0%';
					return;
				}
				const isAbove = pct > 0;
				const cls = isAbove
					? (invertColors ? 'is-below' : 'is-above')
					: (invertColors ? 'is-above' : 'is-below');
				el.className = `wm-wt-mc-badge ${cls}`;
				const iconName = isAbove ? 'trending-up' : 'trending-down';
				if (iconName !== lastIconName) {
					setIcon(iconEl, iconName);
					lastIconName = iconName;
				}
				iconEl.setCssStyles({ display: '' });
				textEl.textContent = ` ${Math.abs(pct)}%`;
			};
		};

		const updateCardEls = (modeId: string, cur: number) => {
			const els  = modeCardEls.get(modeId);
			const mode = modes.find(m => m.id === modeId);
			if (!els || !mode) return;
			els.timeEl.textContent = fmtTime(cur);
			els.avgBadgeUpd(cur,  stat.avg[modeId] ?? 0);
			els.goalBadgeUpd(cur, mode.goalSeconds  ?? 0);
		};

		const updateCompact = (sec: number) => {
			if (!compactLogoEl || !compactTimeEl) return;
			const mode = modes.find(m => m.id === selectedMode);
			if (!mode) return;
			setIcon(compactLogoEl, getModeIcon(mode));
			compactTimeEl.textContent = toHMS(sec);
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

				modeCardEls.set(mode.id, {
					timeEl,
					avgBadgeUpd:  makeBadge(avgBadgeEl,  true),
					goalBadgeUpd: makeBadge(goalBadgeEl, true),
				});
				updateCardEls(mode.id, cur);

				modeCard.addEventListener('click', () => {
					grid.querySelectorAll<HTMLElement>('.wm-wt-mode-card').forEach(c => c.classList.remove('is-selected'));
					modeCard.classList.add('is-selected');
					selectedMode = mode.id;
					plugin.settings.currentTimeMode = mode.id;
					plugin.saveSettings().catch(() => {});
					updateStatsRow?.();
					const f = getTimeFile();
					if (f) {
						const t = WritingTimeStore.getFileTime(app, f, modes, totalKey, plugin.pendingTimeUpdates);
						updateCompact(t[mode.id] ?? 0);
					}
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
			updateStatsRow?.();
			updateCompact(time[selectedMode] ?? 0);
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
			if (now - plugin.lastTimeAccumAt < 900) return;
			plugin.lastTimeAccumAt = now;
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
			if (!container.isConnected) { window.clearInterval(uiInterval); window.clearInterval(accumInterval); return; }
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

		const avgModifyHandler = app.vault.on('modify', (modFile) => {
			// 데일리노트 폴더 파일 변경 시에만 평균 재계산 (작성 파일 자동저장은 무시)
			const { folder: dnFolder } = getDnConfig(plugin);
			if (dnFolder && modFile instanceof TFile && !modFile.path.startsWith(normalizePath(dnFolder) + '/')) return;
			window.clearTimeout(avgDebounceTimer);
			avgDebounceTimer = window.setTimeout(() => { void (async () => {
				// 타이핑 직후 2초 내에는 갱신 생략 (다음 자동저장 후 재시도)
				if (Date.now() - lastTyped < 2000) return;
				const f = trackingFile;
				const proj = getProjectName(f);
				stat = proj
					? await WritingTimeStore.averageDailyNotes(app, getDnConfig(plugin).folder, proj, modes)
					: await WritingTimeStore.averageFolder(app, getAvgFolder(f), modes);
				if (modeCardEls.size > 0) updateDisplay();
			})(); }, 3000);
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
