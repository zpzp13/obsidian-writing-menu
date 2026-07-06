import { setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { PlaybackMode, Track } from './MusicPlayer';
import { watchDisconnect } from '../utils/domUtils';

function formatTime(sec: number): string {
	if (isNaN(sec) || !isFinite(sec) || sec < 0) return '0:00';
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${m}:${s.toString().padStart(2, '0')}`;
}

function folderNameOf(trackPath: string): string {
	const idx = trackPath.lastIndexOf('/');
	if (idx < 0) return '';
	const folder = trackPath.substring(0, idx);
	return folder.split('/').pop() ?? folder;
}

const MODE_ICONS: Record<PlaybackMode, string> = {
	loop: 'repeat',
	single: 'repeat-1',
	shuffle: 'shuffle',
};

const MODE_LABELS: Record<PlaybackMode, string> = {
	loop: '반복 재생',
	single: '한 곡 재생',
	shuffle: '셔플',
};

function makeBtn(parent: HTMLElement, icon: string, label: string, extra = ''): HTMLElement {
	const btn = parent.createDiv({ cls: `wm-music-btn${extra ? ' ' + extra : ''}`, attr: { 'aria-label': label } });
	setIcon(btn, icon);
	return btn;
}

// ── 팝업 상태 ────────────────────────────────────────────────────────

interface PopupState {
	el: HTMLElement;
	plugin: WritingMenuPlugin;
	level: 'root' | 'folder';
	currentFolder: string;
	render: () => void;
}

let activePopup: PopupState | null = null;

function closePopup() {
	activePopup?.el.remove();
	activePopup = null;
}

// ── 재생목록 팝업 ────────────────────────────────────────────────────

function togglePlaylistPopup(anchor: HTMLElement, plugin: WritingMenuPlugin) {
	if (activePopup) { closePopup(); return; }
	openPlaylistPopup(anchor, plugin);
}

function openPlaylistPopup(anchor: HTMLElement, plugin: WritingMenuPlugin) {
	const mp = plugin.musicPlayer;
	if (!mp) return;

	const ownerDoc = anchor.ownerDocument;
	const ownerWin = ownerDoc.defaultView ?? window;
	const popup = ownerDoc.body.createDiv({ cls: 'wm-music-list-popup' });
	const rect = anchor.getBoundingClientRect();
	popup.setCssStyles({ top: `${rect.bottom + 6}px` });
	popup.setCssStyles({ left: `${rect.left}px` });

	const folders = (plugin.settings.musicFolderPaths ?? []).filter(p => p.trim());

	const state: PopupState = {
		el: popup,
		plugin,
		level: 'root',
		currentFolder: '',
		render: () => {},
	};
	activePopup = state;

	const renderFavs = (container: HTMLElement) => {
		const maxFavs = plugin.settings.musicFavoritesMax ?? 10;
		const favs = mp.favoriteTracks.slice(0, maxFavs);
		if (favs.length === 0) return false;

		container.createDiv({ cls: 'wm-music-list-section-label', text: '즐겨찾기' });
		for (const track of favs) {
			const isCurrent = mp.currentTrack?.path === track.path;
			const item = container.createDiv({ cls: `wm-music-list-item${isCurrent ? ' is-playing' : ''}` });
			setIcon(item.createDiv({ cls: 'wm-music-list-item-icon' }), isCurrent && mp.isPlaying ? 'volume-2' : 'music');
			item.createDiv({ cls: 'wm-music-list-item-name', text: track.name });
			const heartEl = item.createDiv({ cls: 'wm-music-list-item-unfav' });
			setIcon(heartEl, 'heart');
			heartEl.addEventListener('mousedown', (e) => { void (async () => {
				e.preventDefault();
				e.stopPropagation();
				await mp.toggleFavorite(track);
				state.render();
			})(); });
			item.addEventListener('mousedown', (e) => {
				if ((e.target as HTMLElement).closest('.wm-music-list-item-unfav')) return;
				e.preventDefault();
				e.stopPropagation();
				mp.playInFolder(track);
				state.render();
			});
		}
		return true;
	};

	const renderRootLevel = () => {
		state.level = 'root';
		popup.empty();
		const hasFavs = renderFavs(popup);
		if (hasFavs && folders.length > 0) popup.createDiv({ cls: 'wm-music-list-sep' });

		if (folders.length === 0) {
			if (!hasFavs) popup.createDiv({ cls: 'wm-music-list-empty', text: '등록된 폴더가 없습니다' });
			return;
		}
		popup.createDiv({ cls: 'wm-music-list-section-label', text: '음악 선택' });
		if (folders.length === 1) { renderFolderLevel(folders[0], false); return; }
		for (const folder of folders) {
			const item = popup.createDiv({ cls: 'wm-music-list-item' });
			setIcon(item.createDiv({ cls: 'wm-music-list-item-icon' }), 'folder');
			item.createDiv({ cls: 'wm-music-list-item-name', text: folder.split('/').pop() ?? folder });
			setIcon(item.createDiv({ cls: 'wm-music-list-item-chevron' }), 'chevron-right');
			item.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); renderFolderLevel(folder); });
		}
	};

	const renderTrackList = (list: HTMLElement, tracks: Track[], forFolder: string) => {
		for (const track of tracks) {
			const isCurrent = mp.currentTrack?.path === track.path;
			const item = list.createDiv({ cls: `wm-music-list-item${isCurrent ? ' is-playing' : ''}` });
			setIcon(item.createDiv({ cls: 'wm-music-list-item-icon' }), isCurrent && mp.isPlaying ? 'volume-2' : 'music');
			item.createDiv({ cls: 'wm-music-list-item-name', text: track.name });
			item.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				mp.playInFolder(track);
				renderFolderLevel(forFolder);
			});
		}
	};

	// standalone=false: 루트에서 "등록 폴더가 1개뿐이라 자동으로 펼쳐 보여주는" 경우 — 팝업을 비우지 않고
	// 즐겨찾기 섹션 뒤에 이어서 그린다 (등록 폴더가 1개일 때 즐겨찾기 목록이 즉시 지워져 안 보이던 버그 수정)
	const renderFolderLevel = (folderPath: string, standalone: boolean = true) => {
		if (standalone) {
			state.level = 'folder';
			state.currentFolder = folderPath;
			popup.empty();
		}
		const norm      = folderPath.replace(/\\/g, '/').replace(/\/?$/, '/');
		const allTracks = mp.playlist.filter(t => t.path.replace(/\\/g, '/').startsWith(norm));

		// 헤더: 최상위 설정 폴더이고 단일 폴더면 레이블만, 나머지는 뒤로가기
		const isTopFolder = folders.some(f => f.replace(/\\/g, '/').replace(/\/?$/, '/') === norm);
		if (!isTopFolder || folders.length > 1) {
			const hdr  = popup.createDiv({ cls: 'wm-music-list-hdr' });
			const back = hdr.createDiv({ cls: 'wm-music-btn wm-music-list-back' });
			setIcon(back, 'arrow-left');
			back.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const parentFolder = folders.find(f => {
					const fn = f.replace(/\\/g, '/').replace(/\/?$/, '/');
					return norm.startsWith(fn) && fn !== norm;
				});
				// 등록 폴더가 1개뿐이면 최상위 폴더로 돌아가는 것은 곧 루트(즐겨찾기 포함)로 돌아가는 것
				if (parentFolder && folders.length === 1) { renderRootLevel(); return; }
				if (parentFolder) renderFolderLevel(parentFolder);
				else renderRootLevel();
			});
			hdr.createDiv({ cls: 'wm-music-list-hdr-title', text: folderPath.split('/').pop() ?? folderPath });
		} else if (standalone) {
			popup.createDiv({ cls: 'wm-music-list-section-label', text: folderPath.split('/').pop() ?? folderPath });
		}

		if (allTracks.length === 0) {
			popup.createDiv({ cls: 'wm-music-list-empty', text: '오디오 파일이 없습니다' });
			return;
		}

		// 직계 하위 폴더 감지
		const subfolderPaths = new Set<string>();
		const directTracks: Track[] = [];
		for (const track of allTracks) {
			const rest     = track.path.replace(/\\/g, '/').slice(norm.length);
			const slashIdx = rest.indexOf('/');
			if (slashIdx >= 0) subfolderPaths.add(norm + rest.slice(0, slashIdx));
			else directTracks.push(track);
		}

		if (subfolderPaths.size > 0) {
			for (const subfolder of [...subfolderPaths].sort()) {
				const item = popup.createDiv({ cls: 'wm-music-list-item' });
				setIcon(item.createDiv({ cls: 'wm-music-list-item-icon' }), 'folder');
				item.createDiv({ cls: 'wm-music-list-item-name', text: subfolder.split('/').pop() ?? subfolder });
				setIcon(item.createDiv({ cls: 'wm-music-list-item-chevron' }), 'chevron-right');
				item.addEventListener('mousedown', (e) => {
					e.preventDefault();
					e.stopPropagation();
					renderFolderLevel(subfolder);
				});
			}
			if (directTracks.length > 0) {
				popup.createDiv({ cls: 'wm-music-list-sep' });
				renderTrackList(popup.createDiv({ cls: 'wm-music-list-tracks' }), directTracks, folderPath);
			}
		} else {
			renderTrackList(popup.createDiv({ cls: 'wm-music-list-tracks' }), allTracks, folderPath);
		}
	};

	state.render = () => {
		if (state.level === 'folder') renderFolderLevel(state.currentFolder);
		else renderRootLevel();
	};

	renderRootLevel();

	window.requestAnimationFrame(() => {
		if (!popup.isConnected) return;
		const pr = popup.getBoundingClientRect();
		if (pr.right > ownerWin.innerWidth - 10) popup.setCssStyles({ left: `${ownerWin.innerWidth - pr.width - 10}px` });
		if (pr.bottom > ownerWin.innerHeight - 10) popup.setCssStyles({ top: `${rect.top - pr.height - 6}px` });
	});

	// mousedown 기반 외부 클릭 감지 (click 이벤트와 충돌 방지)
	const onOutside = (e: MouseEvent) => {
		const target = e.target as Node;
		if (!popup.contains(target) && !anchor.contains(target)) {
			closePopup();
			ownerDoc.removeEventListener('mousedown', onOutside);
		}
	};
	// 팝업이 열린 직후 mousedown 이벤트를 바로 등록 (setTimeout 없음)
	window.requestAnimationFrame(() => {
		ownerDoc.addEventListener('mousedown', onOutside);
	});
}

// ── 볼륨 wrap ────────────────────────────────────────────────────────
// 네이티브 input[type=range] + CSS pseudo-element + JS linear-gradient fill
// 드래그 중: audio 직접 업데이트(saveSettings 없음), change(mouseup)에서 저장

function makeVolWrap(
	controls: HTMLElement,
	mp: { volume: number; audio: HTMLAudioElement; setVolume(v: number): void },
): { volBtn: HTMLElement; syncIcon: () => void } {
	const wrap = controls.createDiv({ cls: 'wm-music-vol-wrap' });
	const sliderOuter = wrap.createDiv({ cls: 'wm-music-vol-slider-outer' });

	const slider = sliderOuter.createEl('input', { type: 'range', cls: 'slider wm-music-vol-slider' });
	slider.min = '0'; slider.max = '100'; slider.step = '1';
	slider.value = String(Math.round(mp.volume * 100));

	// fill: JS gradient (thumb이 track보다 커서 overflow:hidden 불가)
	const updateFill = (v: number) => {
		const pct = Math.round(v * 100);
		slider.setCssStyles({ background: `linear-gradient(to right,
			var(--interactive-accent) ${pct}%,
			var(--background-modifier-border) ${pct}%)` });
	};
	updateFill(mp.volume);

	// 드래그 중: audio 즉시 반영, saveSettings/notifyCallbacks 없음
	slider.addEventListener('input', () => {
		const vol = parseInt(slider.value) / 100;
		mp.volume = vol;
		mp.audio.volume = vol;
		updateFill(vol);
		updateIcon();
	});
	// 릴리즈: 저장 + 전체 UI 알림
	slider.addEventListener('change', () => {
		mp.setVolume(parseInt(slider.value) / 100);
	});

	const volBtn = wrap.createDiv({ cls: 'wm-music-btn wm-dash-music-vol-btn' });
	const updateIcon = () => {
		const v = mp.volume;
		setIcon(volBtn, v === 0 ? 'volume-x' : v < 0.5 ? 'volume-1' : 'volume-2');
	};
	const syncIcon = () => {
		updateIcon();
		slider.value = String(Math.round(mp.volume * 100));
		updateFill(mp.volume);
	};
	updateIcon();

	const ownerDoc = controls.ownerDocument;
	let outsideHandler: ((ev: MouseEvent) => void) | null = null;
	const closeVol = () => {
		controls.removeClass('is-vol-open');
		if (outsideHandler) {
			ownerDoc.removeEventListener('mousedown', outsideHandler);
			outsideHandler = null;
		}
	};

	// stopPropagation으로 outsideHandler가 같은 이벤트를 받지 않도록 차단
	// preventDefault 제거: Obsidian scroll 리셋 방지
	volBtn.addEventListener('mousedown', (e) => {
		e.stopPropagation();
		if (controls.hasClass('is-vol-open')) {
			closeVol();
		} else {
			controls.addClass('is-vol-open');
			outsideHandler = (ev: MouseEvent) => {
				// controls 영역(prev/play/next/vol 전체) 내 클릭은 닫지 않음
				// volBtn 자체 클릭은 stopPropagation으로 여기 도달하지 않음
				if (!controls.contains(ev.target as Node)) closeVol();
			};
			ownerDoc.addEventListener('mousedown', outsideHandler);
		}
	});

	return { volBtn, syncIcon };
}

// ── 앨범아트 로드 ────────────────────────────────────────────────────

function loadCoverInto(imgSlot: HTMLElement, track: Track | null, plugin: WritingMenuPlugin) {
	imgSlot.empty();
	if (!track) {
		setIcon(imgSlot.createDiv({ cls: 'wm-music-strip-placeholder' }), 'music');
		return;
	}
	const mp = plugin.musicPlayer!;
	const applyImg = (url: string | null) => {
		if (!imgSlot.isConnected) return;
		imgSlot.empty();
		if (url) {
			const img = imgSlot.createEl('img', { cls: 'wm-music-strip-img' });
			img.src = url;
		} else {
			setIcon(imgSlot.createDiv({ cls: 'wm-music-strip-placeholder' }), 'music');
		}
	};
	const cached = mp.coverCache.get(track.path);
	if (cached !== undefined) { applyImg(cached); return; }
	setIcon(imgSlot.createDiv({ cls: 'wm-music-strip-placeholder' }), 'music');
	void mp.getCover(track).then(url => applyImg(url));
}

// art-wrap 구조 (hover title은 별도 label로 처리)
interface ArtWrap {
	wrap: HTMLElement;
	imgSlot: HTMLElement;
}

function makeArtWrap(parent: HTMLElement, cls: string): ArtWrap {
	const wrap = parent.createDiv({ cls: `wm-music-art-wrap ${cls}` });
	const imgSlot = wrap.createDiv({ cls: 'wm-music-art-img-slot' });
	return { wrap, imgSlot };
}

function updateArtWrap(aw: ArtWrap, track: Track | null, plugin: WritingMenuPlugin) {
	loadCoverInto(aw.imgSlot, track, plugin);
}

// ── 메인 렌더러 ────────────────────────────────────────────────────

export class MusicPlayerSection {
	static render(container: HTMLElement, plugin: WritingMenuPlugin, compact?: HTMLElement) {
		const mp = plugin.musicPlayer;
		const player = container.createDiv({ cls: 'wm-dash-music-player' });

		// ── 컴팩트: 현재 재생 곡명 ──
		let compactTrackEl: HTMLElement | undefined;
		if (compact) {
			compactTrackEl = compact.createDiv({ cls: 'wm-music-compact-title' });
			compactTrackEl.textContent = mp?.currentTrack?.name ?? '—';
		}

		if (!mp) {
			player.createDiv({ cls: 'wm-dash-music-empty', text: '플레이어를 불러오는 중…' });
			return;
		}
		if (mp.playlist.length === 0) {
			const empty = player.createDiv({ cls: 'wm-dash-music-empty' });
			setIcon(empty.createSpan({ cls: 'wm-dash-music-empty-icon' }), 'music');
			empty.createSpan({ text: '설정에서 음악 폴더를 지정해 주세요' });
			return;
		}

		// ── 헤더: [목록] [폴더명] [하트] [모드] ──
		const header = player.createDiv({ cls: 'wm-dash-music-header' });
		const listBtn = makeBtn(header, 'music', '재생목록', 'wm-dash-music-list-btn');
		listBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePlaylistPopup(listBtn, plugin); });

		// 헤더: 현재 폴더명 표시
		const folderEl = header.createDiv({ cls: 'wm-dash-music-folder' });
		folderEl.textContent = mp.currentTrack ? folderNameOf(mp.currentTrack.path) : '—';

		const favBtn = makeBtn(header, 'heart', '즐겨찾기', 'wm-dash-music-fav-btn');
		if (mp.currentTrack && mp.isFavorite(mp.currentTrack)) favBtn.addClass('is-fav');
		favBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (!mp.currentTrack) return;
			void mp.toggleFavorite(mp.currentTrack);
		});

		const modeBtn = makeBtn(header, MODE_ICONS[mp.mode], MODE_LABELS[mp.mode], 'wm-dash-music-mode-btn');
		modeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const modes: PlaybackMode[] = ['loop', 'single', 'shuffle'];
			mp.setMode(modes[(modes.indexOf(mp.mode) + 1) % modes.length]);
		});

		// ── 스트립 ──
		const strip = player.createDiv({ cls: 'wm-dash-music-strip' });

		// 아트 행
		const artRow = strip.createDiv({ cls: 'wm-dash-music-art-row' });
		const fp2aw = makeArtWrap(artRow, 'is-far-prev');
		const fp1aw = makeArtWrap(artRow, 'is-prev');
		const curAw = makeArtWrap(artRow, 'is-current');
		const fn1aw = makeArtWrap(artRow, 'is-next');
		const fn2aw = makeArtWrap(artRow, 'is-far-next');

		// 병합된 타이틀 컨테이너: 기본=현재곡, hover=이전/다음곡
		const trackTitleEl = strip.createDiv({ cls: 'wm-dash-music-track-title' });

		const refreshMarquee = (container: HTMLElement, text: string) => {
			container.empty();
			const span = container.createSpan({ cls: 'wm-track-title-inner', text });
			window.setTimeout(() => {
				const overflow = Math.round(container.scrollWidth - container.clientWidth);
				if (overflow > 0) {
					span.style.setProperty('--wm-scroll-dist', `-${overflow}px`);
					const dur = Math.min(30, Math.max(10, overflow / 4));
					span.style.setProperty('--wm-scroll-dur', `${dur.toFixed(1)}s`);
					span.addClass('wm-is-scrolling');
				}
			}, 80);
		};

		// 클릭: skip() 사용 (현재 재생 위치 무관하게 트랙 이동)
		fp2aw.wrap.addEventListener('click', (e) => { e.stopPropagation(); mp.skip(-2); });
		fp1aw.wrap.addEventListener('click', (e) => { e.stopPropagation(); mp.skip(-1); });
		curAw.wrap.addEventListener('click', (e) => { e.stopPropagation(); mp.togglePlay(); });
		fn1aw.wrap.addEventListener('click', (e) => { e.stopPropagation(); mp.skip(1); });
		fn2aw.wrap.addEventListener('click', (e) => { e.stopPropagation(); mp.skip(2); });

		// hover 이벤트: 이전/다음 wrap 호버 시 타이틀 컨테이너를 해당 곡명으로 전환
		const currentTrackName = () => mp.currentTrack?.name ?? '—';
		const attachHover = (aw: ArtWrap, getTrack: () => Track | null) => {
			aw.wrap.addEventListener('mouseenter', () => {
				const t = getTrack();
				if (t) {
					trackTitleEl.addClass('is-hover');
					refreshMarquee(trackTitleEl, t.name);
				}
			});
			aw.wrap.addEventListener('mouseleave', () => {
				trackTitleEl.removeClass('is-hover');
				refreshMarquee(trackTitleEl, currentTrackName());
			});
		};

		let lastStripKey = '';

		const buildStrip = () => {
			const vp = mp.viewPlaylist;
			const ci = mp.currentIndex;
			if (vp.length === 0) return;

			const key = `${ci}:${vp.length}:${vp[ci]?.path ?? ''}`;
			if (key === lastStripKey) return;
			lastStripKey = key;

			const getT = (offset: number): Track | null =>
				vp.length > 1 ? vp[(ci + offset + vp.length * 100) % vp.length] : null;

			updateArtWrap(fp2aw, getT(-2), plugin);
			updateArtWrap(fp1aw, getT(-1), plugin);
			updateArtWrap(curAw, mp.currentTrack, plugin);
			updateArtWrap(fn1aw, getT(1), plugin);
			updateArtWrap(fn2aw, getT(2), plugin);

			// 현재곡 제목 & 폴더명 갱신 (hover 중이 아닐 때만)
			if (!trackTitleEl.hasClass('is-hover')) {
				refreshMarquee(trackTitleEl, mp.currentTrack?.name ?? '—');
			}
			folderEl.textContent = mp.currentTrack ? folderNameOf(mp.currentTrack.path) : '—';
		};

		// hover 이벤트는 1회만 등록 — getT는 항상 최신 viewPlaylist/currentIndex 참조
		attachHover(fp2aw, () => mp.viewPlaylist.length > 1 ? mp.viewPlaylist[(mp.currentIndex - 2 + mp.viewPlaylist.length * 100) % mp.viewPlaylist.length] : null);
		attachHover(fp1aw, () => mp.viewPlaylist.length > 1 ? mp.viewPlaylist[(mp.currentIndex - 1 + mp.viewPlaylist.length * 100) % mp.viewPlaylist.length] : null);
		attachHover(fn1aw, () => mp.viewPlaylist.length > 1 ? mp.viewPlaylist[(mp.currentIndex + 1) % mp.viewPlaylist.length] : null);
		attachHover(fn2aw, () => mp.viewPlaylist.length > 1 ? mp.viewPlaylist[(mp.currentIndex + 2) % mp.viewPlaylist.length] : null);

		buildStrip();
		refreshMarquee(trackTitleEl, mp.currentTrack?.name ?? '—');
		if (compactTrackEl) refreshMarquee(compactTrackEl, mp.currentTrack?.name ?? '—');

		// ── 진행바 ──
		const progressRow = player.createDiv({ cls: 'wm-dash-music-progress-row' });
		const curTimeEl = progressRow.createSpan({ cls: 'wm-dash-music-time' });
		const bar = progressRow.createDiv({ cls: 'wm-dash-music-bar' });
		const fill = bar.createDiv({ cls: 'wm-dash-music-fill' });
		const remTimeEl = progressRow.createSpan({ cls: 'wm-dash-music-time' });

		const updateProgress = () => {
			const cur = mp.audio.currentTime;
			const dur = mp.audio.duration;
			curTimeEl.textContent = formatTime(cur);
			remTimeEl.textContent = (!isNaN(dur) && dur > 0) ? `-${formatTime(dur - cur)}` : '-0:00';
			fill.setCssStyles({ width: `${(!isNaN(dur) && dur > 0) ? (cur / dur) * 100 : 0}%` });
		};
		updateProgress();

		let seeking = false;
		const doSeek = (e: MouseEvent) => {
			const r = bar.getBoundingClientRect();
			mp.seek((e.clientX - r.left) / r.width);
		};
		bar.addEventListener('mousedown', (e) => { seeking = true; doSeek(e); });
		activeDocument.addEventListener('mousemove', (e) => { if (seeking) doSeek(e); });
		activeDocument.addEventListener('mouseup', () => { seeking = false; });

		// ── 컨트롤 ──
		const controls = player.createDiv({ cls: 'wm-dash-music-controls' });
		const prevBtn = makeBtn(controls, 'skip-back', '이전');
		const playBtn = makeBtn(controls, mp.isPlaying ? 'pause' : 'play', '재생/일시정지', 'wm-dash-music-play-btn');
		const nextBtn = makeBtn(controls, 'skip-forward', '다음');

		const { syncIcon: syncVolIcon } = makeVolWrap(controls, mp);

		prevBtn.addEventListener('click', (e) => { e.stopPropagation(); mp.prev(); });
		playBtn.addEventListener('click', (e) => { e.stopPropagation(); mp.togglePlay(); });
		nextBtn.addEventListener('click', (e) => { e.stopPropagation(); mp.next(); });

		// ── 구독 ──
		let lastCompactTrackName = mp.currentTrack?.name ?? '';
		const update = () => {
			updateProgress();
			setIcon(playBtn, mp.isPlaying ? 'pause' : 'play');
			setIcon(modeBtn, MODE_ICONS[mp.mode]);
			modeBtn.setAttribute('aria-label', MODE_LABELS[mp.mode]);
			favBtn.toggleClass('is-fav', mp.currentTrack ? mp.isFavorite(mp.currentTrack) : false);
			syncVolIcon();
			buildStrip();
			if (compactTrackEl) {
				const name = mp.currentTrack?.name ?? '—';
				if (name !== lastCompactTrackName) {
					lastCompactTrackName = name;
					refreshMarquee(compactTrackEl, name);
				}
			}
			if (activePopup?.plugin === plugin) activePopup.render();
		};
		mp.subscribe(update);

		// compact가 hidden→visible 될 때 overflow 재측정 (display:none 상태에서는 측정 불가)
		if (compact && compactTrackEl) {
			const trackEl = compactTrackEl;
			const obs = new MutationObserver(() => {
				if (compact.classList.contains('is-visible'))
					refreshMarquee(trackEl, mp.currentTrack?.name ?? '—');
			});
			obs.observe(compact, { attributes: true, attributeFilter: ['class'] });
			watchDisconnect(player, () => { mp.unsubscribe(update); obs.disconnect(); });
		} else {
			watchDisconnect(player, () => { mp.unsubscribe(update); });
		}
	}
}
