import type WritingMenuPlugin from '../../main';
import { WritingTimeStore } from './data/WritingTimeStore';
import type { TFile } from 'obsidian';
import type { WritingMenuSettings } from '../types';

const MODES = ['draft', 'writing', 'editing'] as const;
type Mode   = typeof MODES[number];

const N_CELLS      = 30;
const SEC_PER_CELL = 15 * 60;

const MODE_LABELS: Record<Mode, string> = {
	draft:   '초고',
	writing: '집필',
	editing: '퇴고',
};

type TimeKeys = WritingMenuSettings['timeKeys'];

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
		const keys:  TimeKeys = settings.timeKeys  ?? { draft: '초고_시간', writing: '집필_시간', editing: '퇴고_시간', total: '총_시간' };
		const goals = settings.timeGoals ?? { draft: 7200, writing: 7200, editing: 7200 };
		const folder = settings.heatmapFolder ?? '';

		const stat = await WritingTimeStore.averageFolder(app, folder, keys);

		const card = container.createDiv({ cls: 'wm-wt-card' });

		// ── 추적 상태 ──
		let selectedMode: Mode = (plugin.settings.currentTimeMode as Mode) ?? 'draft';
		let trackingFile: TFile | null = null;
		let isTyping = false;
		let lastTyped = Date.now();
		let isSaving = false;

		// UI refs
		const valEls     = new Map<Mode, HTMLElement>();
		const hmEls      = new Map<Mode, HTMLElement>();
		const fillState  = new Map<Mode, number>();
		const btnGridEls = new Map<Mode, HTMLElement>();
		const pctEls     = new Map<Mode, HTMLElement>();

		const setPct = (mode: Mode, cur: number) => {
			const el = pctEls.get(mode);
			if (!el) return;
			const avg = stat.avg[mode];
			if (avg <= 0 || cur <= 0) { el.textContent = ''; el.className = 'wm-wt-pct'; return; }
			const pct = Math.round((cur - avg) / avg * 100);
			el.textContent = `${Math.abs(pct)}% ${pct > 0 ? '↑' : '↓'}`;
			el.className = `wm-wt-pct ${pct > 0 ? 'is-above' : 'is-below'}`;
		};

		let popup: HTMLElement | null = null;
		const removePopup = () => { popup?.remove(); popup = null; };
		const showPopup = (target: HTMLElement, label: string, detail: string) => {
			removePopup();
			popup = document.body.createDiv({ cls: 'wm-hm-popup' });
			popup.createSpan({ cls: 'wm-hm-popup-date',  text: label });
			popup.createSpan({ cls: 'wm-hm-popup-count', text: detail });
			const rect = target.getBoundingClientRect();
			popup.style.left = `${rect.left + rect.width / 2}px`;
			popup.style.top  = `${rect.top - 6}px`;
		};

		// ── pendingTimeUpdates 로드 (delta 방식: seconds = 0으로 초기화) ──
		const loadPending = (file: TFile) => {
			for (const m of [...MODES, 'total' as const]) {
				const key = `${file.path}:${m}`;
				if (!plugin.pendingTimeUpdates.has(key)) {
					plugin.pendingTimeUpdates.set(key, { file, mode: m, seconds: 0 });
				}
			}
		};

		// ── frontmatter(base) + pending(delta) 저장 후 delta 리셋 ──
		const savePending = async (file: TFile) => {
			if (isSaving) return;
			const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
			const updates: Record<string, string> = {};
			for (const m of [...MODES, 'total' as const]) {
				const entry = plugin.pendingTimeUpdates.get(`${file.path}:${m}`);
				if (!entry || entry.seconds === 0) continue;
				const base = WritingTimeStore.parseTime(fm[keys[m]]);
				updates[keys[m]] = toHMS(base + entry.seconds);
			}
			if (!Object.keys(updates).length) return;
			isSaving = true;
			try {
				await app.fileManager.processFrontMatter(file, (fmToUpdate) => Object.assign(fmToUpdate, updates));
			} finally {
				setTimeout(() => { isSaving = false; }, 200);
			}
			// 저장 후 delta 리셋 (이중 합산 방지)
			for (const m of [...MODES, 'total' as const]) {
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
					cell.addEventListener('mouseenter', () => showPopup(cell, '목표', WritingTimeStore.formatTimeFull(goal)));
				} else if (avgIdx !== null && i === avgIdx) {
					cell.addClass('wm-wt-cell-avg');
					cell.addEventListener('mouseenter', () => showPopup(cell, '평균', WritingTimeStore.formatTimeFull(avg)));
				} else if (i < workCells) {
					const pct      = workCells > 1 ? i / (workCells - 1) : 1;
					const levelIdx = Math.min(Math.floor(pct * 3) + 1, 4);
					cell.addClass(`level-${levelIdx}`);
					cell.addEventListener('mouseenter', () => showPopup(cell, '작업 시간', WritingTimeStore.formatTimeFull(cur)));
				} else {
					cell.addClass('level-0');
				}
				cell.addEventListener('mouseleave', removePopup);
			}
		};

		// buildCard: 파일 변경 시만 전체 재빌드
		const buildCard = (file: TFile) => {
			card.empty();
			valEls.clear();
			hmEls.clear();
			fillState.clear();
			btnGridEls.clear();
			pctEls.clear();

			const time = WritingTimeStore.getFileTime(app, file, keys, plugin.pendingTimeUpdates);

			for (const mode of MODES) {
				const cur   = time[mode];
				const avg   = stat.avg[mode];
				const goal  = goals[mode] ?? 0;
				const isSel = mode === selectedMode;

				const modeDiv = card.createDiv({ cls: 'wm-wt-mode' });
				modeDiv.dataset.mode = mode;

				// 헤더: label(좌) | val(우)
				const header = modeDiv.createDiv({ cls: 'wm-wt-mode-header' });
				header.createDiv({ cls: 'wm-wt-lbl', text: MODE_LABELS[mode] });
				const val = header.createDiv({ cls: 'wm-wt-val' });
				val.textContent = cur > 0 ? WritingTimeStore.formatTime(cur) : '—';
				if (cur > 0) val.setAttribute('aria-label', WritingTimeStore.formatTimeFull(cur));
				valEls.set(mode, val);

				// hmArea: [2×2 버튼 좌측] [heatmap 우측]
				const hmArea = modeDiv.createDiv({ cls: 'wm-wt-hm-area' });

				// 2×2 모드 버튼 (항상 표시, 선택 시 lit)
				const grid = hmArea.createDiv({ cls: 'wm-wt-jinhaeng-grid' });
				for (let i = 0; i < 4; i++) {
					const jcell = grid.createDiv({ cls: 'wm-wt-jinhaeng-cell' });
					jcell.style.opacity = isSel ? '0.88' : '0.15';
				}
				btnGridEls.set(mode, grid);

				const workCells = Math.min(Math.floor(cur / SEC_PER_CELL), N_CELLS);
				const avgIdx    = avg  > 0 ? Math.min(Math.floor(avg  / SEC_PER_CELL), N_CELLS - 1) : null;
				const goalIdx   = goal > 0 ? Math.min(Math.floor(goal / SEC_PER_CELL), N_CELLS - 1) : null;

				const hm = hmArea.createDiv({ cls: 'wm-wt-heatmap' });
				hmEls.set(mode, hm);
				fillState.set(mode, workCells);
				buildHmCells(hm, workCells, avgIdx, goalIdx, cur, avg, goal);

				const pctEl = hmArea.createDiv({ cls: 'wm-wt-pct' });
				pctEls.set(mode, pctEl);
				setPct(mode, cur);

				// 모드 클릭: 2×2 버튼에만 한정, opacity 토글 (DOM 재빌드 없음)
				grid.style.cursor = 'pointer';
				grid.addEventListener('click', (e) => {
					e.stopPropagation();
					if (selectedMode === mode) return;
					setGridOpacity(btnGridEls.get(selectedMode), '0.15');
					setGridOpacity(btnGridEls.get(mode), '0.88');
					selectedMode = mode;
					plugin.settings.currentTimeMode = mode;
					plugin.saveSettings().catch(() => {});
				});
			}
		};

		// updateDisplay: val + heatmap 셀 갱신 (1초마다)
		const updateDisplay = (file: TFile) => {
			// 외부에서 currentTimeMode가 바뀌면 버튼 opacity 동기화
			const extMode = plugin.settings.currentTimeMode as Mode;
			if (extMode !== selectedMode) {
				setGridOpacity(btnGridEls.get(selectedMode), '0.15');
				setGridOpacity(btnGridEls.get(extMode), '0.88');
				selectedMode = extMode;
			}

			const time = WritingTimeStore.getFileTime(app, file, keys, plugin.pendingTimeUpdates);

			for (const mode of MODES) {
				const cur = time[mode];

				const val = valEls.get(mode);
				if (val) {
					const txt = cur > 0 ? WritingTimeStore.formatTime(cur) : '—';
					if (val.textContent !== txt) val.textContent = txt;
					if (cur > 0) val.setAttribute('aria-label', WritingTimeStore.formatTimeFull(cur));
				}

				const newFill = Math.min(Math.floor(cur / SEC_PER_CELL), N_CELLS);
				if (newFill !== (fillState.get(mode) ?? -1)) {
					fillState.set(mode, newFill);
					const hm = hmEls.get(mode);
					if (hm) {
						const avg   = stat.avg[mode];
						const goal  = goals[mode] ?? 0;
						const avgIdx  = avg  > 0 ? Math.min(Math.floor(avg  / SEC_PER_CELL), N_CELLS - 1) : null;
						const goalIdx = goal > 0 ? Math.min(Math.floor(goal / SEC_PER_CELL), N_CELLS - 1) : null;
						buildHmCells(hm, newFill, avgIdx, goalIdx, cur, avg, goal);
					}
				}
				setPct(mode, cur);
			}
		};

		// ── 파일 전환 처리 ──
		const onFileChange = async (file: TFile | null) => {
			if (trackingFile && trackingFile !== file) await savePending(trackingFile);
			trackingFile = file;
			if (file) loadPending(file);
			removePopup();
			if (file) buildCard(file);
			else {
				card.empty();
				valEls.clear();
				hmEls.clear();
				fillState.clear();
				btnGridEls.clear();
				card.createDiv({ cls: 'wm-wt-empty', text: '열린 문서 없음' });
			}
		};

		// ── 초기화 ──
		const initialFile = app.workspace.getActiveFile();
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
			const mode = selectedMode;
			const modeKey  = `${trackingFile.path}:${mode}`;
			const totalKey = `${trackingFile.path}:total`;
			const me = plugin.pendingTimeUpdates.get(modeKey)
				?? { file: trackingFile, mode, seconds: 0 };
			me.seconds++;
			plugin.pendingTimeUpdates.set(modeKey, me);
			const te = plugin.pendingTimeUpdates.get(totalKey)
				?? { file: trackingFile, mode: 'total' as const, seconds: 0 };
			te.seconds++;
			plugin.pendingTimeUpdates.set(totalKey, te);
		}, 1000);

		// ── UI 갱신 인터벌 (1초) ──
		const uiInterval = window.setInterval(() => {
			if (!container.isConnected) { window.clearInterval(uiInterval); return; }
			const f = trackingFile ?? app.workspace.getActiveFile();
			if (f && valEls.size > 0) updateDisplay(f);
		}, 1000);

		// ── 에디터 변경 → 타이핑 감지 (자체 저장 중 무시) ──
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

		// ── 컨테이너 해제 시 정리 ──
		const observer = new MutationObserver(() => {
			if (!container.isConnected) {
				app.workspace.offref(leafHandler);
				app.workspace.offref(editorHandler);
				window.clearInterval(uiInterval);
				window.clearInterval(accumInterval);
				if (trackingFile) savePending(trackingFile).catch(() => {});
				observer.disconnect();
				removePopup();
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
	}

}
