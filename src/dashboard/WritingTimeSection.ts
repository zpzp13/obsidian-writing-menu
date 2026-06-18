import type WritingMenuPlugin from '../../main';
import { WritingTimeStore } from './data/WritingTimeStore';
import type { TFile } from 'obsidian';
import type { TimeModeConfig } from '../types';
import { renderModeStatBlock, updateModeStatBlock } from './WritingTimeStatBlock';
import { watchDisconnect } from '../utils/domUtils';
import type { ModeStatEls } from './WritingTimeStatBlock';

const N_CELLS      = 30;
const SEC_PER_CELL = 15 * 60;

const toHMS = (sec: number): string => {
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = sec % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const setGridOpacity = (grid: HTMLElement | undefined, opacity: string) => {
	grid?.querySelectorAll('.wm-wt-jinhaeng-cell')
		.forEach(c => (c as HTMLElement).style.opacity = opacity);
};

export class WritingTimeSection {
	static async render(container: HTMLElement, plugin: WritingMenuPlugin): Promise<void> {
		const { app, settings } = plugin;
		const modes: TimeModeConfig[] = settings.timeModes?.length
			? settings.timeModes
			: [
				{ id: 'draft',   label: '초고', frontmatterKey: '초고_시간', goalSeconds: 7200 },
				{ id: 'writing', label: '집필', frontmatterKey: '집필_시간', goalSeconds: 7200 },
				{ id: 'editing', label: '퇴고', frontmatterKey: '퇴고_시간', goalSeconds: 7200 },
			];
		const totalKey = settings.timeTotalKey ?? '총_시간';
		const fallbackFolder = settings.heatmapFolder ?? '';

		const avgFolderFor = (file: import('obsidian').TFile): string => {
			const level = settings.timeAvgFolderLevel ?? 0;
			let path = file.parent?.path ?? '';
			for (let i = 0; i < level; i++) {
				const up = path.lastIndexOf('/');
				if (up < 0) break;
				path = path.slice(0, up);
			}
			return path;
		};

		const initialFile = app.workspace.getActiveFile();
		let stat = await WritingTimeStore.averageFolder(
			app,
			initialFile ? avgFolderFor(initialFile) : fallbackFolder,
			modes,
		);

		const card = container.createDiv({ cls: 'wm-wt-card' });

		// ── 추적 상태 ──
		let selectedMode: string = plugin.settings.currentTimeMode ?? modes[0]?.id ?? '';
		// 존재하지 않는 모드가 선택돼 있으면 첫 번째로 리셋
		if (!modes.find(m => m.id === selectedMode)) selectedMode = modes[0]?.id ?? '';

		let trackingFile: TFile | null = null;
		let isTyping = false;
		let lastTyped = Date.now();
		let isSaving = false;

		// UI refs
		const valEls      = new Map<string, HTMLElement>();
		const hmEls       = new Map<string, HTMLElement>();
		const fillState   = new Map<string, number>();
		const btnGridEls  = new Map<string, HTMLElement>();
		const statEls     = new Map<string, ModeStatEls>();

		const setCmpRows = (mode: TimeModeConfig, cur: number) => {
			const els = statEls.get(mode.id);
			if (!els) return;
			const goal    = mode.goalSeconds ?? 0;
			const avg     = stat.avg[mode.id] ?? 0;
			const workCells = Math.min(Math.floor(cur / SEC_PER_CELL), N_CELLS);
			updateModeStatBlock(els, cur, goal, avg, workCells);
		};

		let popup: HTMLElement | null = null;
		const removePopup = () => { popup?.remove(); popup = null; };
		const showPopup = (e: MouseEvent, label: string, detail: string) => {
			removePopup();
			const doc = ((e.view as Window | null) ?? window).document;
			popup = doc.createElement('div');
			popup.className = 'wm-hm-popup';
			doc.body.appendChild(popup);
			const dateSpan = doc.createElement('span');
			dateSpan.className = 'wm-hm-popup-date';
			dateSpan.textContent = label;
			popup.appendChild(dateSpan);
			const countSpan = doc.createElement('span');
			countSpan.className = 'wm-hm-popup-count';
			countSpan.textContent = detail;
			popup.appendChild(countSpan);
			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			popup.style.left = `${rect.left + rect.width / 2}px`;
			popup.style.top  = `${rect.top - 6}px`;
		};

		// ── pendingTimeUpdates 로드 ──
		const loadPending = (file: TFile) => {
			for (const m of [...modes.map(m => m.id), 'total']) {
				const key = `${file.path}:${m}`;
				if (!plugin.pendingTimeUpdates.has(key)) {
					plugin.pendingTimeUpdates.set(key, { file, mode: m, seconds: 0 });
				}
			}
		};

		const savePending = async (file: TFile) => {
			if (isSaving) return;
			const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
			const updates: Record<string, string> = {};
			for (const m of modes) {
				const entry = plugin.pendingTimeUpdates.get(`${file.path}:${m.id}`);
				if (!entry || entry.seconds === 0) continue;
				const base = WritingTimeStore.parseTime(fm[m.frontmatterKey]);
				updates[m.frontmatterKey] = toHMS(base + entry.seconds);
			}
			const totalEntry = plugin.pendingTimeUpdates.get(`${file.path}:total`);
			if (totalEntry && totalEntry.seconds > 0) {
				const base = WritingTimeStore.parseTime(fm[totalKey]);
				updates[totalKey] = toHMS(base + totalEntry.seconds);
			}
			if (!Object.keys(updates).length) return;
			isSaving = true;
			try {
				await app.fileManager.processFrontMatter(file, (fmToUpdate) => Object.assign(fmToUpdate, updates));
			} finally {
				setTimeout(() => { isSaving = false; }, 200);
			}
			for (const m of [...modes.map(m => m.id), 'total']) {
				const entry = plugin.pendingTimeUpdates.get(`${file.path}:${m}`);
				if (entry) entry.seconds = 0;
			}
		};

		const buildHmCells = (
			hm: HTMLElement,
			workCells: number,
			avgIdx:  number | null,
			goalIdx: number | null,
			cur: number, avg: number, goal: number,
		) => {
			hm.empty();
			for (let i = 0; i < N_CELLS; i++) {
				const cell = hm.createDiv({ cls: 'wm-hm-cell' });
				if (goalIdx !== null && i === goalIdx) {
					cell.addClass('wm-wt-cell-goal');
					cell.addEventListener('mouseenter', (e) => showPopup(e, '목표', WritingTimeStore.formatTimeFull(goal)));
				} else if (avgIdx !== null && i === avgIdx) {
					cell.addClass('wm-wt-cell-avg');
					cell.addEventListener('mouseenter', (e) => showPopup(e, '평균', WritingTimeStore.formatTimeFull(avg)));
				} else if (i < workCells) {
					const pct      = workCells > 1 ? i / (workCells - 1) : 1;
					const levelIdx = Math.min(Math.floor(pct * 3) + 1, 4);
					cell.addClass(`level-${levelIdx}`);
					cell.addEventListener('mouseenter', (e) => showPopup(e, '작업 시간', WritingTimeStore.formatTimeFull(cur)));
				} else {
					cell.addClass('level-0');
				}
				cell.addEventListener('mouseleave', removePopup);
			}
		};

		const clearRefs = () => {
			valEls.clear(); hmEls.clear(); fillState.clear(); btnGridEls.clear();
			statEls.clear();
		};

		// buildCard: 파일 변경 시만 전체 재빌드
		const buildCard = (file: TFile) => {
			card.empty();
			clearRefs();

			const time = WritingTimeStore.getFileTime(app, file, modes, totalKey, plugin.pendingTimeUpdates);

			for (const mode of modes) {
				const cur   = time[mode.id] ?? 0;
				const avg   = stat.avg[mode.id] ?? 0;
				const goal  = mode.goalSeconds ?? 0;
				const isSel = mode.id === selectedMode;

				const modeRow = card.createDiv({ cls: 'wm-wt-mode-row' });
				modeRow.dataset.mode = mode.id;

				const modeDiv = modeRow.createDiv({ cls: 'wm-wt-mode' });
				modeDiv.dataset.mode = mode.id;

				const header = modeDiv.createDiv({ cls: 'wm-wt-mode-header' });
				header.createDiv({ cls: 'wm-wt-lbl', text: mode.label });
				const val = header.createDiv({ cls: 'wm-wt-val' });
				val.textContent = cur > 0 ? WritingTimeStore.formatTime(cur) : '';
				if (cur > 0) val.setAttribute('aria-label', WritingTimeStore.formatTimeFull(cur));
				valEls.set(mode.id, val);

				const hmArea = modeDiv.createDiv({ cls: 'wm-wt-hm-area' });

				const grid = hmArea.createDiv({ cls: 'wm-wt-jinhaeng-grid' });
				for (let i = 0; i < 4; i++) {
					const jcell = grid.createDiv({ cls: 'wm-wt-jinhaeng-cell' });
					jcell.style.opacity = isSel ? '0.88' : '0.15';
				}
				btnGridEls.set(mode.id, grid);

				const workCells = Math.min(Math.floor(cur / SEC_PER_CELL), N_CELLS);
				const avgIdx    = avg  > 0 ? Math.min(Math.floor(avg  / SEC_PER_CELL), N_CELLS - 1) : null;
				const goalIdx   = goal > 0 ? Math.min(Math.floor(goal / SEC_PER_CELL), N_CELLS - 1) : null;

				const hm = hmArea.createDiv({ cls: 'wm-wt-heatmap' });
				hmEls.set(mode.id, hm);
				fillState.set(mode.id, workCells);
				buildHmCells(hm, workCells, avgIdx, goalIdx, cur, avg, goal);

				grid.style.cursor = 'pointer';
				grid.addEventListener('click', (e) => {
					e.stopPropagation();
					if (selectedMode === mode.id) return;
					setGridOpacity(btnGridEls.get(selectedMode), '0.15');
					setGridOpacity(btnGridEls.get(mode.id), '0.88');
					selectedMode = mode.id;
					plugin.settings.currentTimeMode = mode.id;
					plugin.saveSettings().catch(() => {});
				});

				const els = renderModeStatBlock(hmArea);
				statEls.set(mode.id, els);
				setCmpRows(mode, cur);
			}
		};

		// updateDisplay: val + heatmap 셀 갱신 (1초마다)
		const updateDisplay = (file: TFile) => {
			const extMode = plugin.settings.currentTimeMode;
			if (extMode !== selectedMode && modes.find(m => m.id === extMode)) {
				setGridOpacity(btnGridEls.get(selectedMode), '0.15');
				setGridOpacity(btnGridEls.get(extMode), '0.88');
				selectedMode = extMode;
			}

			const time = WritingTimeStore.getFileTime(app, file, modes, totalKey, plugin.pendingTimeUpdates);

			for (const mode of modes) {
				const cur = time[mode.id] ?? 0;

				const val = valEls.get(mode.id);
				if (val) {
					const txt = cur > 0 ? WritingTimeStore.formatTime(cur) : '';
					if (val.textContent !== txt) val.textContent = txt;
					if (cur > 0) val.setAttribute('aria-label', WritingTimeStore.formatTimeFull(cur));
				}

				const newFill = Math.min(Math.floor(cur / SEC_PER_CELL), N_CELLS);
				if (newFill !== (fillState.get(mode.id) ?? -1)) {
					fillState.set(mode.id, newFill);
					const hm = hmEls.get(mode.id);
					if (hm) {
						const avg    = stat.avg[mode.id] ?? 0;
						const goal   = mode.goalSeconds ?? 0;
						const avgIdx  = avg  > 0 ? Math.min(Math.floor(avg  / SEC_PER_CELL), N_CELLS - 1) : null;
						const goalIdx = goal > 0 ? Math.min(Math.floor(goal / SEC_PER_CELL), N_CELLS - 1) : null;
						buildHmCells(hm, newFill, avgIdx, goalIdx, cur, avg, goal);
					}
				}
				setCmpRows(mode, cur);
			}
		};

		// ── 파일 전환 처리 ──
		const onFileChange = async (file: TFile | null) => {
			if (trackingFile && trackingFile !== file) await savePending(trackingFile);
			trackingFile = file;
			if (file) {
				loadPending(file);
				const folder = avgFolderFor(file);
				stat = await WritingTimeStore.averageFolder(app, folder, modes);
				for (const m of modes) fillState.set(m.id, -1);
			}
			removePopup();
			if (file) buildCard(file);
			else {
				card.empty();
				clearRefs();
				card.createDiv({ cls: 'wm-wt-empty', text: '열린 문서 없음' });
			}
		};

		// ── 초기화 ──
		trackingFile = initialFile;
		if (initialFile) {
			loadPending(initialFile);
			buildCard(initialFile);
		} else {
			card.createDiv({ cls: 'wm-wt-empty', text: '열린 문서 없음' });
		}
		card.addEventListener('mouseleave', removePopup);

		// ── 1초 누적 인터벌 ──
		const accumInterval = window.setInterval(() => {
			if (!plugin.settings.enableTimeTracking || !trackingFile) return;
			if (Date.now() - lastTyped > 1000) { isTyping = false; return; }
			if (!isTyping) return;
			const modeId = selectedMode;
			const modeKey  = `${trackingFile.path}:${modeId}`;
			const totalKey2 = `${trackingFile.path}:total`;
			const me = plugin.pendingTimeUpdates.get(modeKey)
				?? { file: trackingFile, mode: modeId, seconds: 0 };
			me.seconds++;
			plugin.pendingTimeUpdates.set(modeKey, me);
			const te = plugin.pendingTimeUpdates.get(totalKey2)
				?? { file: trackingFile, mode: 'total', seconds: 0 };
			te.seconds++;
			plugin.pendingTimeUpdates.set(totalKey2, te);
		}, 1000);

		// ── UI 갱신 인터벌 (1초) ──
		const uiInterval = window.setInterval(() => {
			if (!container.isConnected) { window.clearInterval(uiInterval); return; }
			const f = trackingFile ?? app.workspace.getActiveFile();
			if (f && valEls.size > 0) updateDisplay(f);
		}, 1000);

		// ── 에디터 변경 → 타이핑 감지 ──
		const editorHandler = app.workspace.on('editor-change', () => {
			if (isSaving) return;
			isTyping = true;
			lastTyped = Date.now();
		});

		// ── 파일 전환 ──
		const leafHandler = app.workspace.on('active-leaf-change', () => {
			const f = app.workspace.getActiveFile();
			if (!f || f === trackingFile) return;
			onFileChange(f).catch(() => {});
		});

		// ── vault.modify → 폴더 평균 재계산 ──
		let avgDebounceTimer = 0;
		const avgModifyHandler = app.vault.on('modify', () => {
			clearTimeout(avgDebounceTimer);
			avgDebounceTimer = window.setTimeout(async () => {
				const folder = trackingFile ? avgFolderFor(trackingFile) : fallbackFolder;
				const newStat = await WritingTimeStore.averageFolder(app, folder, modes);
				stat = newStat;
				for (const m of modes) fillState.set(m.id, -1);
			}, 2000);
		});

		// ── 컨테이너 해제 시 정리 ──
		watchDisconnect(container, () => {
			app.workspace.offref(leafHandler);
			app.workspace.offref(editorHandler);
			app.vault.offref(avgModifyHandler);
			clearTimeout(avgDebounceTimer);
			window.clearInterval(uiInterval);
			window.clearInterval(accumInterval);
			if (trackingFile) savePending(trackingFile).catch(() => {});
			removePopup();
		});
	}

}
