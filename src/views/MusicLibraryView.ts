import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { Track } from '../dashboard/MusicPlayer';
import { refreshOverflowMarquee } from '../utils/domUtils';

export const MUSIC_LIBRARY_VIEW_TYPE = 'writing-menu-music-library';
const MUSIC_LIBRARY_WAVEFORM_BARS = 128;

function folderOf(track: Track): string {
	const index = track.path.lastIndexOf('/');
	return index >= 0 ? track.path.slice(0, index) : 'Local library';
}

function folderLabel(path: string): string {
	return path.split('/').filter(Boolean).pop() ?? 'Local library';
}

function formatAudioTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
	const whole = Math.floor(seconds);
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export class MusicLibraryView extends ItemView {
	private query = '';
	private listEl: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	private shuffleButton: HTMLButtonElement | null = null;
	private repeatButton: HTMLButtonElement | null = null;
	private repeatIcon = '';
	private lastPlaybackSignature = '';
	private renderRevision = 0;
	private waveformTrack: HTMLElement | null = null;
	private waveformFill: HTMLElement | null = null;
	private waveformKey = '';
	private waveformRevision = 0;
	private waveformPrefetchTimer = 0;
	private currentTimeEl: HTMLElement | null = null;
	private durationEl: HTMLElement | null = null;
	private volumeButton: HTMLButtonElement | null = null;
	private volumeInput: HTMLInputElement | null = null;
	private volumeIcon = '';
	private favoriteButton: HTMLButtonElement | null = null;
	private audioCover: HTMLImageElement | null = null;
	private audioBackdrop: HTMLElement | null = null;
	private audioTitle: HTMLElement | null = null;
	private audioFolder: HTMLElement | null = null;
	private audioPlayButton: HTMLButtonElement | null = null;
	private audioArtworkRevision = 0;
	private audioPlayIcon = '';
	private readonly handlePlayerUpdate = () => {
		const player = this.plugin.musicPlayer;
		this.updateAudioControls();
		const favorites = this.plugin.settings.musicFavorites ?? [];
		const signature = `${player?.currentTrack?.path ?? ''}|${player?.isPlaying ?? false}|${player?.playlist.length ?? 0}|${player?.mode ?? ''}|${favorites.join('\u0000')}`;
		if (signature === this.lastPlaybackSignature) return;
		this.lastPlaybackSignature = signature;
		this.updateModeControls();
		this.renderList();
	};

	constructor(leaf: WorkspaceLeaf, private plugin: WritingMenuPlugin) {
		super(leaf);
	}

	getViewType() { return MUSIC_LIBRARY_VIEW_TYPE; }
	getDisplayText() { return 'Music Library'; }
	getIcon() { return 'list-music'; }

	async onOpen() {
		this.render();
		this.plugin.musicPlayer?.subscribe(this.handlePlayerUpdate);
	}

	async onClose() {
		window.clearTimeout(this.waveformPrefetchTimer);
		this.plugin.musicPlayer?.unsubscribe(this.handlePlayerUpdate);
	}

	private render() {
		const content = this.containerEl.children[1] as HTMLElement;
		content.empty();
		content.addClass('wm-music-library-view');

		const header = content.createDiv({ cls: 'wm-music-library-header' });
		const heading = header.createDiv({ cls: 'wm-music-library-heading' });
		heading.createSpan({ cls: 'wm-music-library-kicker', text: 'LIBRARY' });
		this.countEl = heading.createSpan({ cls: 'wm-music-library-count' });
		const refresh = header.createEl('button', {
			cls: 'wm-music-library-action',
			attr: { type: 'button', 'aria-label': '음악 목록 새로고침' },
		});
		setIcon(refresh, 'refresh-cw');
		refresh.addEventListener('click', () => {
			void this.plugin.musicPlayer?.loadPlaylist().then(() => this.renderList());
		});

		const nowPlaying = content.createDiv({ cls: 'wm-music-library-now-playing' });
		this.renderAudioControls(nowPlaying);
		this.updateModeControls();

		this.listEl = content.createDiv({ cls: 'wm-music-library-list' });
		this.renderList();
	}

	private renderAudioControls(content: HTMLElement) {
		const player = this.plugin.musicPlayer;
		if (!player) return;
		this.waveformKey = '';
		this.volumeIcon = '';
		this.audioFolder = null;
		const audio = content.createDiv({ cls: 'wm-music-library-audio' });
		const foreground = audio.createDiv({ cls: 'wm-music-library-audio-foreground' });
		const artStage = foreground.createDiv({ cls: 'wm-music-library-audio-art-stage' });
		this.audioBackdrop = artStage.createDiv({
			cls: 'wm-music-library-audio-backdrop-region',
			attr: { 'aria-hidden': 'true' },
		});
		const art = artStage.createDiv({ cls: 'wm-music-library-audio-art' });
		this.audioCover = art.createEl('img', { cls: 'wm-music-library-audio-cover', attr: { alt: '' } });
		setIcon(art.createSpan({ cls: 'wm-music-library-audio-placeholder' }), 'music-2');
		const body = foreground.createDiv({ cls: 'wm-music-library-audio-body' });
		const copy = body.createDiv({ cls: 'wm-music-library-audio-copy' });
		this.audioTitle = copy.createDiv({ cls: 'wm-music-library-audio-title', text: '재생할 곡을 선택하세요' });
		const transport = body.createDiv({ cls: 'wm-music-library-audio-transport' });
		const volume = transport.createDiv({ cls: 'wm-music-library-volume' });
		this.volumeButton = volume.createEl('button', {
			cls: 'wm-music-library-volume-button wm-music-library-transport-button is-mode',
			attr: { type: 'button', 'aria-label': '볼륨 조절', 'aria-expanded': 'false' },
		});
		const volumeSliderOuter = volume.createDiv({ cls: 'wm-music-library-volume-slider-outer' });
		this.volumeInput = volumeSliderOuter.createEl('input', {
			cls: 'slider wm-music-vol-slider wm-music-library-volume-slider',
			attr: { type: 'range', min: '0', max: '100', step: '1', 'aria-label': '음량' },
		});
		this.volumeInput.addEventListener('input', () => {
			const value = Number(this.volumeInput?.value ?? player.volume * 100) / 100;
			player.volume = value;
			player.audio.volume = value;
			this.updateAudioControls();
		});
		this.volumeInput.addEventListener('change', () => player.setVolume(Number(this.volumeInput?.value ?? player.volume * 100) / 100));
		this.volumeButton.addEventListener('click', event => {
			event.stopPropagation();
			const open = !transport.hasClass('is-vol-open');
			transport.toggleClass('is-vol-open', open);
			this.volumeButton?.setAttribute('aria-expanded', String(open));
		});
		volumeSliderOuter.addEventListener('click', event => event.stopPropagation());
		this.registerDomEvent(transport.ownerDocument, 'click', event => {
			if (volume.contains(event.target as Node)) return;
			transport.removeClass('is-vol-open');
			this.volumeButton?.setAttribute('aria-expanded', 'false');
		});
		this.shuffleButton = transport.createEl('button', { cls: 'wm-music-library-transport-button is-mode', attr: { type: 'button', 'aria-label': '셔플' } });
		setIcon(this.shuffleButton, 'shuffle');
		const previous = transport.createEl('button', { cls: 'wm-music-library-transport-button', attr: { type: 'button', 'aria-label': '이전 곡' } });
		setIcon(previous, 'skip-back');
		this.audioPlayButton = transport.createEl('button', { cls: 'wm-music-library-transport-button is-primary', attr: { type: 'button', 'aria-label': '재생 또는 일시정지' } });
		setIcon(this.audioPlayButton, 'play');
		const next = transport.createEl('button', { cls: 'wm-music-library-transport-button', attr: { type: 'button', 'aria-label': '다음 곡' } });
		setIcon(next, 'skip-forward');
		this.repeatButton = transport.createEl('button', { cls: 'wm-music-library-transport-button is-mode', attr: { type: 'button', 'aria-label': '전체 반복' } });
		setIcon(this.repeatButton, 'repeat');
		this.favoriteButton = transport.createEl('button', {
			cls: 'wm-music-library-favorite-button wm-music-library-transport-button is-mode',
			attr: { type: 'button', 'aria-label': '즐겨찾기' },
		});
		setIcon(this.favoriteButton, 'heart');
		this.shuffleButton.addEventListener('click', () => player.setMode(player.mode === 'shuffle' ? 'loop' : 'shuffle'));
		previous.addEventListener('click', () => player.prev());
		this.audioPlayButton.addEventListener('click', () => player.togglePlay());
		next.addEventListener('click', () => player.next());
		this.repeatButton.addEventListener('click', () => player.setMode(player.mode === 'single' ? 'loop' : 'single'));
		this.favoriteButton.addEventListener('click', () => {
			if (player.currentTrack) void player.toggleFavorite(player.currentTrack);
		});

		const search = body.createDiv({ cls: 'wm-music-library-search' });
		setIcon(search.createSpan(), 'search');
		const input = search.createEl('input', {
			type: 'search',
			attr: { placeholder: 'Search library', 'aria-label': '음악 검색' },
		});
		input.value = this.query;
		input.addEventListener('input', () => {
			this.query = input.value.trim().toLocaleLowerCase();
			this.renderList();
		});

		const waveform = body.createDiv({
			cls: 'wm-music-library-waveform',
			attr: { role: 'slider', tabindex: '0', 'aria-label': '재생 위치', 'aria-valuemin': '0', 'aria-valuemax': '100' },
		});
		waveform.createSpan({ cls: 'wm-music-library-wave-loading', attr: { 'aria-hidden': 'true' } });
		this.waveformTrack = waveform.createDiv({ cls: 'wm-music-library-wave-layer is-track' });
		this.waveformFill = waveform.createDiv({ cls: 'wm-music-library-wave-layer is-fill' });
		const seekAt = (clientX: number) => {
			const bounds = waveform.getBoundingClientRect();
			if (bounds.width <= 0) return;
			player.seek(Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)));
			this.updateAudioControls();
		};
		waveform.addEventListener('pointerdown', event => {
			waveform.setPointerCapture(event.pointerId);
			seekAt(event.clientX);
		});
		waveform.addEventListener('pointermove', event => {
			if (!waveform.hasPointerCapture(event.pointerId)) return;
			seekAt(event.clientX);
		});
		waveform.addEventListener('keydown', event => {
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
			event.preventDefault();
			const duration = player.audio.duration;
			if (!Number.isFinite(duration) || duration <= 0) return;
			player.seek((player.audio.currentTime + (event.key === 'ArrowRight' ? 5 : -5)) / duration);
		});

		const footer = body.createDiv({ cls: 'wm-music-library-audio-footer' });
		this.currentTimeEl = footer.createSpan({ cls: 'wm-music-library-audio-time', text: '0:00' });
		this.durationEl = footer.createSpan({ cls: 'wm-music-library-audio-time', text: '0:00' });
		this.updateAudioControls();
	}

	private renderWaveform(key: string) {
		if (!this.waveformTrack || !this.waveformFill) return;
		const revision = ++this.waveformRevision;
		const player = this.plugin.musicPlayer;
		const track = player?.currentTrack ?? null;
		const waveform = this.waveformTrack.parentElement;
		this.waveformTrack.empty();
		this.waveformFill.empty();
		waveform?.removeClass('is-unavailable');
		waveform?.toggleClass('is-loading', !!track);
		const paint = (peaks: number[]) => {
			if (revision !== this.waveformRevision || key !== this.waveformKey) return;
			waveform?.removeClass('is-loading');
			waveform?.toggleClass('is-unavailable', peaks.length === 0);
			this.waveformTrack?.empty();
			this.waveformFill?.empty();
			for (const layer of [this.waveformTrack, this.waveformFill]) {
				if (layer) this.paintWaveformCanvas(layer, peaks);
			}
		};
		if (!track || !player) return;
		void player.getWaveform(track, MUSIC_LIBRARY_WAVEFORM_BARS).then(paint);
	}

	/** WaveSurfer의 bar renderer처럼 peak 배열을 고정 폭 canvas 막대로 그린다. */
	private paintWaveformCanvas(layer: HTMLElement, peaks: number[]): void {
		const host = layer.parentElement;
		const cssWidth = Math.max(1, Math.round(host?.clientWidth ?? 320));
		const cssHeight = Math.max(1, Math.round(host?.clientHeight ?? 34));
		const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
		const canvas = layer.createEl('canvas', { cls: 'wm-music-library-wave-canvas' });
		canvas.width = Math.round(cssWidth * pixelRatio);
		canvas.height = Math.round(cssHeight * pixelRatio);
		const context = canvas.getContext('2d');
		if (!context) return;
		context.scale(pixelRatio, pixelRatio);
		context.strokeStyle = getComputedStyle(layer).color;
		context.lineCap = 'round';
		const spacing = cssWidth / Math.max(1, peaks.length);
		context.lineWidth = Math.max(1, Math.min(2, spacing * .62));
		const halfHeight = cssHeight / 2;
		const amplitude = Math.max(1, halfHeight - 1.5);
		context.beginPath();
		peaks.forEach((peak, index) => {
			const height = Math.max(1.5, Math.min(amplitude, peak * amplitude));
			const x = (index + .5) * spacing;
			context.moveTo(x, halfHeight - height);
			context.lineTo(x, halfHeight + height);
		});
		context.stroke();
	}

	private updateAudioControls() {
		const player = this.plugin.musicPlayer;
		if (!player) return;
		const trackKey = player.currentTrack?.path ?? '';
		if (trackKey !== this.waveformKey) {
			this.waveformKey = trackKey;
			this.renderWaveform(trackKey);
			this.updateNowPlayingArtwork(trackKey);
		}
		const track = player.currentTrack;
		if (this.audioTitle) refreshOverflowMarquee(this.audioTitle, track?.name ?? '재생할 곡을 선택하세요');
		if (this.audioFolder) this.audioFolder.textContent = track ? folderLabel(folderOf(track)) : 'LOCAL LIBRARY';
		const playIcon = player.isPlaying ? 'pause' : 'play';
		if (this.audioPlayButton && playIcon !== this.audioPlayIcon) {
			this.audioPlayIcon = playIcon;
			setIcon(this.audioPlayButton, playIcon);
		}
		const duration = player.audio.duration;
		const ratio = Number.isFinite(duration) && duration > 0
			? Math.max(0, Math.min(1, player.audio.currentTime / duration))
			: 0;
		if (this.waveformFill) this.waveformFill.style.clipPath = `inset(0 ${100 - ratio * 100}% 0 0)`;
		const waveform = this.waveformFill?.parentElement;
		waveform?.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
		if (this.currentTimeEl) this.currentTimeEl.textContent = formatAudioTime(player.audio.currentTime);
		if (this.durationEl) this.durationEl.textContent = formatAudioTime(duration);
		if (this.volumeInput && document.activeElement !== this.volumeInput) this.volumeInput.value = String(Math.round(player.volume * 100));
		if (this.volumeInput) {
			const percent = Math.round(player.volume * 100);
			this.volumeInput.setCssStyles({
				background: `linear-gradient(to right, var(--wm-music-ui-accent) ${percent}%, var(--wm-music-wave-track) ${percent}%)`,
			});
		}
		if (this.volumeButton) {
			const icon = player.volume <= 0 ? 'volume-x' : player.volume < .5 ? 'volume-1' : 'volume-2';
			if (icon !== this.volumeIcon) {
				this.volumeIcon = icon;
				setIcon(this.volumeButton, icon);
			}
			this.volumeButton.setAttribute('aria-label', `볼륨 조절: ${Math.round(player.volume * 100)}%`);
		}
		if (this.favoriteButton) {
			const favorite = !!track && player.isFavorite(track);
			this.favoriteButton.toggleClass('is-favorite', favorite);
			this.favoriteButton.setAttribute('aria-pressed', String(favorite));
			this.favoriteButton.setAttribute('aria-label', favorite ? '즐겨찾기 해제' : '즐겨찾기');
			this.favoriteButton.disabled = !track;
		}
	}

	private updateNowPlayingArtwork(trackKey: string): void {
		const player = this.plugin.musicPlayer;
		const track = player?.currentTrack ?? null;
		const revision = ++this.audioArtworkRevision;
		this.audioCover?.removeAttribute('src');
		this.audioCover?.removeClass('is-loaded');
		this.audioBackdrop?.style.removeProperty('--wm-music-backdrop-image');
		this.audioBackdrop?.removeClass('is-loaded');
		if (!player || !track) return;
		void player.getCover(track).then(url => {
			if (!url || revision !== this.audioArtworkRevision || trackKey !== (player.currentTrack?.path ?? '')) return;
			if (this.audioCover) {
				this.audioCover.src = url;
				this.audioCover.addClass('is-loaded');
			}
			if (this.audioBackdrop) {
				this.audioBackdrop.style.setProperty('--wm-music-backdrop-image', `url("${url}")`);
				this.audioBackdrop.addClass('is-loaded');
			}
		});
	}

	private updateModeControls() {
		const activeMode = this.plugin.musicPlayer?.mode ?? 'loop';
		const shuffled = activeMode === 'shuffle';
		this.shuffleButton?.toggleClass('is-active', shuffled);
		this.shuffleButton?.setAttribute('aria-pressed', String(shuffled));
		const repeatIcon = activeMode === 'single' ? 'repeat-1' : 'repeat';
		if (this.repeatButton && repeatIcon !== this.repeatIcon) {
			this.repeatIcon = repeatIcon;
			setIcon(this.repeatButton, repeatIcon);
		}
		this.repeatButton?.toggleClass('is-active', activeMode === 'single');
		this.repeatButton?.setAttribute('aria-pressed', String(activeMode === 'single'));
		this.repeatButton?.setAttribute('aria-label', activeMode === 'single' ? '한 곡 반복' : '전체 반복');
	}

	private renderList() {
		const list = this.listEl;
		const player = this.plugin.musicPlayer;
		if (!list || !player) return;
		list.empty();
		const revision = ++this.renderRevision;
		const filtered = player.playlist.filter(track => {
			if (!this.query) return true;
			return `${track.name} ${track.path}`.toLocaleLowerCase().includes(this.query);
		});
		if (this.countEl) this.countEl.textContent = `${filtered.length} TRACKS`;

		if (filtered.length === 0) {
			const empty = list.createDiv({ cls: 'wm-music-library-empty' });
			setIcon(empty.createSpan(), 'disc-3');
			empty.createSpan({ text: this.query ? '검색 결과가 없습니다.' : '설정에서 음악 폴더를 지정해 주세요.' });
			return;
		}

		const filteredPaths = new Set(filtered.map(track => track.path));
		const favoriteTracks = player.favoriteTracks.filter(track => filteredPaths.has(track.path));
		const favorites = list.createDiv({ cls: 'wm-music-library-folder wm-music-library-favorites' });
		const favoriteHeader = favorites.createDiv({ cls: 'wm-music-library-folder-header' });
		const favoriteTitle = favoriteHeader.createSpan({ cls: 'wm-music-library-folder-title' });
		favoriteTitle.createSpan({ text: '즐겨찾기' });
		favoriteHeader.createSpan({ text: String(favoriteTracks.length) });
		if (favoriteTracks.length === 0) {
			favorites.createDiv({ cls: 'wm-music-library-favorites-empty', text: '즐겨찾기한 곡이 없습니다.' });
		} else {
			for (const track of favoriteTracks) {
				this.renderTrackRow(favorites, track, folderLabel(folderOf(track)), revision);
			}
		}

		const groups = new Map<string, Track[]>();
		for (const track of filtered) {
			const folder = folderOf(track);
			const tracks = groups.get(folder) ?? [];
			tracks.push(track);
			groups.set(folder, tracks);
		}

		for (const [folder, tracks] of groups) {
			const section = list.createDiv({ cls: 'wm-music-library-folder' });
			const folderHeader = section.createDiv({ cls: 'wm-music-library-folder-header' });
			folderHeader.createSpan({ text: folderLabel(folder) });
			folderHeader.createSpan({ text: String(tracks.length) });
			for (const track of tracks) {
				this.renderTrackRow(section, track, folderLabel(folder), revision);
			}
		}
	}

	private renderTrackRow(parent: HTMLElement, track: Track, meta: string, revision: number) {
		const player = this.plugin.musicPlayer;
		if (!player) return;
		const isCurrent = player.currentTrack?.path === track.path;
		const isFavorite = player.isFavorite(track);
		const row = parent.createDiv({
			cls: `wm-music-library-track${isCurrent ? ' is-current' : ''}`,
			attr: { role: 'button', tabindex: '0', 'aria-label': `${track.name} 재생` },
		});
		const art = row.createSpan({ cls: 'wm-music-library-track-art' });
		setIcon(art, 'music-2');
		void player.getCover(track).then(url => {
			if (!url || revision !== this.renderRevision || !row.isConnected) return;
			art.empty();
			const image = art.createEl('img', { cls: 'wm-music-library-track-cover', attr: { alt: '' } });
			image.src = url;
		});
		const copy = row.createSpan({ cls: 'wm-music-library-track-copy' });
		copy.createSpan({ cls: 'wm-music-library-track-title', text: track.name });
		copy.createSpan({ cls: 'wm-music-library-track-meta', text: meta });
		const action = row.createEl('button', {
			cls: 'wm-music-library-track-action',
			attr: { type: 'button', 'aria-label': isCurrent && player.isPlaying ? '일시정지' : '재생' },
		});
		setIcon(action, isCurrent && player.isPlaying ? 'pause' : 'play');
		const favorite = row.createEl('button', {
			cls: `wm-music-library-track-favorite${isFavorite ? ' is-favorite' : ''}`,
			attr: { type: 'button', 'aria-label': isFavorite ? '즐겨찾기 해제' : '즐겨찾기' },
		});
		setIcon(favorite, 'heart');

		const playTrack = () => {
			if (player.currentTrack?.path === track.path) player.togglePlay();
			else player.playInFolder(track);
		};
		row.addEventListener('click', event => {
			if ((event.target as HTMLElement).closest('button')) return;
			playTrack();
		});
		row.addEventListener('pointerenter', () => {
			window.clearTimeout(this.waveformPrefetchTimer);
			this.waveformPrefetchTimer = window.setTimeout(() => {
				void player.getWaveform(track, MUSIC_LIBRARY_WAVEFORM_BARS);
			}, 180);
		});
		row.addEventListener('pointerleave', () => window.clearTimeout(this.waveformPrefetchTimer));
		row.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			if ((event.target as HTMLElement).closest('button')) return;
			event.preventDefault();
			playTrack();
		});
		action.addEventListener('click', event => {
			event.stopPropagation();
			playTrack();
		});
		favorite.addEventListener('click', event => {
			event.stopPropagation();
			void player.toggleFavorite(track);
		});
	}
}
