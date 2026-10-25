import { wmT } from '../i18n/index';
import { Component, ItemView, MarkdownRenderer, WorkspaceLeaf, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { Track } from '../dashboard/MusicPlayer';
import { refreshOverflowMarquee } from '../utils/domUtils';
import { MusicLibraryTracks, type MusicLibraryTrackGroup } from './MusicLibraryTracks';

export const MUSIC_LIBRARY_VIEW_TYPE = 'writing-menu-music-library';
let musicLibraryVolumeId = 0;

/*!
 * Wave shaping adapted for SVG from FHRha/LiquidSeekBar:
 * https://github.com/FHRha/LiquidSeekBar/blob/c31d5e8e032b148bb18f012d3341c3d4d549f2d9/src/components/common/LiquidSeekBar.tsx
 * Modified to keep the native range control, a flat thumb junction and browser-driven animation.
 *
 * MIT License
 * Copyright (c) 2026 FHRha
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY.
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
function liquidWavePath(width: number, time: number, layer: number): string {
	const strength = Math.min(1, width / 48);
	const frequency = 2 * Math.PI / (layer === 0 ? 132 : 112);
	const amplitude = (layer === 0 ? 10.8 : 10) * (0.86 + 0.14 * Math.sin(time));
	const warpFrequency = layer === 0 ? 0.012 : 0.016;
	const warpAmplitude = layer === 0 ? 0.65 : 0.45;
	const taper = Math.min(40, width * 0.7);
	const sample = (x: number) => {
		const t = Math.min(1, Math.max(0, (width - x) / taper));
		const envelope = t * t * (3 - 2 * t);
		const derivative = t < 1 ? -6 * t * (1 - t) / taper : 0;
		const warp = x * warpFrequency + time;
		const angle = frequency * x + Math.sin(warp) * warpAmplitude + layer * Math.PI * 0.9 - time;
		const angleSlope = frequency + Math.cos(warp) * warpAmplitude * warpFrequency;
		const harmonic = 2 * angle - Math.PI / 2;
		const rounded = Math.max(0, Math.min(1, (Math.sin(angle) + 0.18 * Math.sin(harmonic) + 1) / 2.18));
		const height = amplitude * Math.pow(rounded, 1.35);
		const heightSlope = amplitude * 1.35 * Math.pow(rounded, 0.35)
			* (Math.cos(angle) + 0.36 * Math.cos(harmonic)) / 2.18 * angleSlope;
		return {
			y: 12 - strength * height * envelope,
			slope: -strength * (heightSlope * envelope + height * derivative),
		};
	};
	const number = (value: number) => String(Number(value.toFixed(3)));
	const segments = Math.max(2, Math.ceil(width / 12));
	let previous = sample(0);
	let path = `M0 ${number(previous.y)}`;
	for (let segment = 1; segment <= segments; segment++) {
		const x = width * segment / segments;
		const start = width * (segment - 1) / segments;
		const next = sample(x);
		const step = (x - start) / 3;
		path += `C${number(start + step)} ${number(previous.y + previous.slope * step)} ${number(x - step)} ${number(next.y - next.slope * step)} ${number(x)} ${number(next.y)}`;
		previous = next;
	}
	return `${path}V16H0Z`;
}

function liquidWaveFrames(width: number, layer: number): Keyframe[] {
	// Sample densely; Web Animations interpolates without a JS frame loop.
	return Array.from({ length: 65 }, (_, index) => ({
		d: `path("${liquidWavePath(width, index * Math.PI / 32, layer)}")`,
	}));
}

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
	private listEl: HTMLElement | null = null;
	private baseRender: Component | null = null;
	private basePath = '';
	private fallbackTracks: MusicLibraryTracks | null = null;
	private shuffleButton: HTMLButtonElement | null = null;
	private repeatButton: HTMLButtonElement | null = null;
	private repeatIcon = '';
	private lastPlaybackSignature = '';
	private renderRevision = 0;
	private progressEl: HTMLElement | null = null;
	private liquidAnimations: Animation[] = [];
	private liquidLayers: { svg: SVGSVGElement; effect: KeyframeEffect; layer: number }[] = [];
	private liquidWidth = -1;
	private liquidMotionQuery: MediaQueryList | null = null;
	private liquidAnimating: boolean | null = null;
	private seekInput: HTMLInputElement | null = null;
	private trackKey: string | null = null;
	private currentTimeEl: HTMLElement | null = null;
	private durationEl: HTMLElement | null = null;
	private volumeButton: HTMLButtonElement | null = null;
	private volumeInput: HTMLInputElement | null = null;
	private volumeIcon = '';
	private favoriteButton: HTMLButtonElement | null = null;
	private audioCover: HTMLImageElement | null = null;
	private audioBackdrop: HTMLElement | null = null;
	private audioTitle: HTMLElement | null = null;
	private audioArtist: HTMLElement | null = null;
	private audioPlayButton: HTMLButtonElement | null = null;
	private audioArtworkRevision = 0;
	private audioPlayIcon = '';
	private readonly handlePlayerUpdate = () => {
		const player = this.plugin.musicPlayer;
		this.updateAudioControls();
		const favorites = this.plugin.settings.musicFavorites ?? [];
		const signature = JSON.stringify([player?.currentTrack?.path, player?.isPlaying, player?.playlist.length, player?.mode, favorites, this.plugin.settings.musicFolderPaths]);
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
		this.renderRevision++;
		this.audioArtworkRevision++;
		this.progressEl?.removeClass('is-playing');
		for (const animation of this.liquidAnimations) animation.cancel();
		this.liquidAnimating = false;
		this.plugin.musicPlayer?.unsubscribe(this.handlePlayerUpdate);
	}

	private render() {
		const content = this.containerEl.children[1] as HTMLElement;
		content.empty();
		content.addClass('wm-music-library-view');

		const nowPlaying = content.createDiv({ cls: 'wm-music-library-now-playing' });
		this.renderAudioControls(nowPlaying);
		this.updateModeControls();

		this.listEl = content.createDiv({ cls: 'wm-music-library-list' });
		this.renderList();
	}

	private renderAudioControls(content: HTMLElement) {
		const player = this.plugin.musicPlayer;
		if (!player) return;
		this.trackKey = null;
		this.volumeIcon = '';
		const audio = content.createDiv({ cls: 'wm-music-library-audio' });
		const foreground = audio.createDiv({ cls: 'wm-music-library-audio-foreground' });
		const artStage = foreground.createDiv({ cls: 'wm-music-library-audio-art-stage' });
		this.audioBackdrop = artStage.createDiv({
			cls: 'wm-music-library-audio-backdrop-region',
			attr: { 'aria-hidden': 'true' },
		});
		const art = artStage.createDiv({ cls: 'wm-music-library-audio-art' });
		this.audioCover = art.createEl('img', { cls: 'wm-music-library-audio-cover', attr: { alt: '' } });
		this.audioCover.hidden = true;
		setIcon(art.createSpan({ cls: 'wm-music-library-audio-placeholder' }), 'music-2');
		const progress = foreground.createDiv({ cls: 'wm-music-library-progress' });
		this.progressEl = progress;
		const progressResizeObserver = new ResizeObserver(() => this.updateAudioControls());
		progressResizeObserver.observe(progress);
		this.register(() => progressResizeObserver.disconnect());
		const liquid = progress.createDiv({
			cls: 'wm-music-library-liquid',
			attr: { 'aria-hidden': 'true' },
		});
		for (const animation of this.liquidAnimations) animation.cancel();
		this.liquidAnimations = [];
		this.liquidAnimating = null;
		this.liquidMotionQuery = (progress.ownerDocument.defaultView ?? window).matchMedia('(prefers-reduced-motion: reduce)');
		const motionQuery = this.liquidMotionQuery;
		const onMotionChange = () => this.updateLiquidMotion();
		motionQuery.addEventListener('change', onMotionChange);
		this.register(() => motionQuery.removeEventListener('change', onMotionChange));
		this.liquidLayers = [];
		this.liquidWidth = -1;
		for (const [index, layer] of ['back', 'front'].entries()) {
			const wave = liquid.createSvg('svg', {
				cls: ['wm-music-library-liquid-wave', `is-${layer}`],
				attr: { viewBox: '0 0 1 16', preserveAspectRatio: 'none' },
			});
			const path = wave.createSvg('path', { attr: { d: liquidWavePath(1, 0, index) } });
			const animation = path.animate(liquidWaveFrames(1, index), {
				duration: index === 0 ? 4800 : 3600,
				iterations: Infinity,
				easing: 'linear',
			});
			this.liquidAnimations.push(animation);
			this.liquidLayers.push({ svg: wave, effect: animation.effect as KeyframeEffect, layer: index });
		}
		this.seekInput = progress.createEl('input', {
			cls: 'wm-music-library-seek',
			attr: { type: 'range', min: '0', max: '1000', step: '1', 'aria-label': wmT("재생 위치") },
		});
		this.seekInput.addEventListener('input', () => {
			player.seek(Number(this.seekInput?.value ?? 0) / 1000);
			this.updateAudioControls();
		});
		const body = foreground.createDiv({ cls: 'wm-music-library-audio-body' });
		const footer = body.createDiv({ cls: 'wm-music-library-audio-footer' });
		this.currentTimeEl = footer.createSpan({ cls: 'wm-music-library-audio-time', text: '0:00' });
		this.durationEl = footer.createSpan({ cls: 'wm-music-library-audio-time', text: '0:00' });
		const copy = body.createDiv({ cls: 'wm-music-library-audio-copy' });
		this.audioTitle = copy.createDiv({ cls: 'wm-music-library-audio-title', text: wmT("재생할 곡을 선택하세요") });
		this.audioArtist = copy.createDiv({ cls: 'wm-music-library-audio-artist' });
		const transport = body.createDiv({ cls: 'wm-music-library-audio-transport' });
		const volume = transport.createDiv({ cls: 'wm-music-library-volume' });
		this.volumeButton = volume.createEl('button', {
			cls: 'wm-music-library-volume-button wm-music-library-transport-button is-mode',
			attr: { type: 'button', 'aria-label': wmT("볼륨 조절"), 'aria-expanded': 'false' },
		});
		const volumeSliderOuter = volume.createDiv({ cls: 'wm-music-library-volume-slider-outer' });
		const volumeId = `wm-library-volume-${++musicLibraryVolumeId}`;
		volumeSliderOuter.id = volumeId;
		this.volumeButton.setAttribute('aria-controls', volumeId);
		this.volumeInput = volumeSliderOuter.createEl('input', {
			cls: 'slider wm-music-vol-slider wm-music-library-volume-slider',
			attr: { type: 'range', min: '0', max: '100', step: '1', 'aria-label': wmT("음량"), 'aria-orientation': 'vertical' },
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
			body.toggleClass('is-vol-open', open);
			this.volumeButton?.setAttribute('aria-expanded', String(open));
		});
		volumeSliderOuter.addEventListener('click', event => event.stopPropagation());
		volume.addEventListener('keydown', event => {
			if (event.key !== 'Escape') return;
			transport.removeClass('is-vol-open');
			body.removeClass('is-vol-open');
			this.volumeButton?.setAttribute('aria-expanded', 'false');
			this.volumeButton?.focus();
		});
		this.registerDomEvent(transport.ownerDocument, 'click', event => {
			if (volume.contains(event.target as Node)) return;
			transport.removeClass('is-vol-open');
			body.removeClass('is-vol-open');
			this.volumeButton?.setAttribute('aria-expanded', 'false');
		});
		this.shuffleButton = transport.createEl('button', { cls: 'wm-music-library-transport-button is-mode', attr: { type: 'button', 'aria-label': wmT("셔플") } });
		setIcon(this.shuffleButton, 'shuffle');
		const previous = transport.createEl('button', { cls: 'wm-music-library-transport-button', attr: { type: 'button', 'aria-label': wmT("이전 곡") } });
		setIcon(previous, 'skip-back');
		this.audioPlayButton = transport.createEl('button', { cls: 'wm-music-library-transport-button is-primary', attr: { type: 'button', 'aria-label': wmT("재생 또는 일시정지") } });
		setIcon(this.audioPlayButton, 'play');
		const next = transport.createEl('button', { cls: 'wm-music-library-transport-button', attr: { type: 'button', 'aria-label': wmT("다음 곡") } });
		setIcon(next, 'skip-forward');
		this.repeatButton = transport.createEl('button', { cls: 'wm-music-library-transport-button is-mode', attr: { type: 'button', 'aria-label': wmT("전체 반복") } });
		setIcon(this.repeatButton, 'repeat');
		this.favoriteButton = transport.createEl('button', {
			cls: 'wm-music-library-favorite-button wm-music-library-transport-button is-mode',
			attr: { type: 'button', 'aria-label': wmT("즐겨찾기") },
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

		this.updateAudioControls();
	}

	private updateLiquidGeometry(width: number): void {
		const nextWidth = Math.max(1, Number(width.toFixed(2)));
		if (Math.abs(nextWidth - this.liquidWidth) < .2) return;
		this.liquidWidth = nextWidth;
		for (const { svg, effect, layer } of this.liquidLayers) {
			svg.setAttribute('viewBox', `0 0 ${nextWidth} 16`);
			effect.setKeyframes(liquidWaveFrames(nextWidth, layer));
		}
	}

	private updateLiquidMotion(): void {
		const animate = !!this.progressEl?.hasClass('is-playing') && !this.liquidMotionQuery?.matches;
		if (animate === this.liquidAnimating) return;
		this.liquidAnimating = animate;
		for (const animation of this.liquidAnimations) {
			if (animate) void animation.play();
			else animation.pause();
		}
	}

	private updateAudioControls() {
		const player = this.plugin.musicPlayer;
		if (!player) return;
		const trackKey = player.currentTrack?.path ?? '';
		if (trackKey !== this.trackKey) {
			this.trackKey = trackKey;
			this.updateNowPlayingTrack(trackKey);
		}
		const track = player.currentTrack;
		const playIcon = player.isPlaying ? 'pause' : 'play';
		if (this.audioPlayButton && playIcon !== this.audioPlayIcon) {
			this.audioPlayIcon = playIcon;
			setIcon(this.audioPlayButton, playIcon);
		}
		const duration = player.audio.duration;
		const canSeek = !!track && Number.isFinite(duration) && duration > 0;
		const ratio = canSeek
			? Math.max(0, Math.min(1, player.audio.currentTime / duration))
			: 0;
		if (this.progressEl) {
			const playedWidth = 6 + Math.max(0, this.progressEl.clientWidth - 12) * ratio;
			this.updateLiquidGeometry(playedWidth);
			// Match the native 12px thumb's center, including at either end of the track.
			this.progressEl.style.setProperty('--wm-music-progress', `calc(6px + (100% - 12px) * ${ratio})`);
			this.progressEl.toggleClass('has-progress', ratio > 0);
			this.progressEl.toggleClass('is-playing', canSeek && player.isPlaying);
			this.updateLiquidMotion();
		}
		if (this.seekInput) {
			this.seekInput.value = String(Math.round(ratio * 1000));
			this.seekInput.disabled = !canSeek;
			this.seekInput.setAttribute('aria-valuetext', `${formatAudioTime(player.audio.currentTime)} / ${formatAudioTime(duration)}`);
		}
		if (this.currentTimeEl) this.currentTimeEl.textContent = formatAudioTime(player.audio.currentTime);
		if (this.durationEl) this.durationEl.textContent = formatAudioTime(duration);
		if (this.volumeInput && document.activeElement !== this.volumeInput) this.volumeInput.value = String(Math.round(player.volume * 100));
		if (this.volumeInput) {
			const percent = Math.round(player.volume * 100);
			this.volumeInput.setCssStyles({
				background: `linear-gradient(to right, var(--wm-music-ui-accent) ${percent}%, var(--wm-music-progress-track) ${percent}%)`,
			});
		}
		if (this.volumeButton) {
			const icon = player.volume <= 0 ? 'volume-x' : player.volume < .5 ? 'volume-1' : 'volume-2';
			if (icon !== this.volumeIcon) {
				this.volumeIcon = icon;
				setIcon(this.volumeButton, icon);
			}
			this.volumeButton.setAttribute('aria-label', wmT("볼륨 조절: {0}%", Math.round(player.volume * 100)));
		}
		if (this.favoriteButton) {
			const favorite = !!track && player.isFavorite(track);
			this.favoriteButton.toggleClass('is-favorite', favorite);
			this.favoriteButton.setAttribute('aria-pressed', String(favorite));
			this.favoriteButton.setAttribute('aria-label', favorite ? wmT("즐겨찾기 해제") : wmT("즐겨찾기"));
			this.favoriteButton.disabled = !track;
		}
	}

	private updateNowPlayingTrack(trackKey: string): void {
		const player = this.plugin.musicPlayer;
		const track = player?.currentTrack ?? null;
		const revision = ++this.audioArtworkRevision;
		if (this.audioCover) {
			// Hide immediately so clearing src cannot fade a broken-image icon into view.
			this.audioCover.hidden = true;
			this.audioCover.removeClass('is-loaded');
			this.audioCover.removeAttribute('src');
		}
		this.audioBackdrop?.style.removeProperty('--wm-music-backdrop-image');
		this.audioBackdrop?.removeClass('is-loaded');
		if (this.audioTitle) refreshOverflowMarquee(this.audioTitle, track?.name ?? wmT("재생할 곡을 선택하세요"));
		if (this.audioArtist) {
			this.audioArtist.textContent = '';
			this.audioArtist.hidden = true;
		}
		if (!player || !track) return;
		void player.getMetadata(track).then(metadata => {
			if (revision !== this.audioArtworkRevision || trackKey !== (player.currentTrack?.path ?? '')) return;
			if (this.audioTitle) refreshOverflowMarquee(this.audioTitle, metadata.title || track.name);
			if (this.audioArtist) {
				this.audioArtist.textContent = metadata.artist;
				this.audioArtist.hidden = !metadata.artist;
			}
		});
		void player.getCover(track).then(async url => {
			if (!url || revision !== this.audioArtworkRevision || trackKey !== (player.currentTrack?.path ?? '')) return;
			const cover = this.audioCover;
			if (!cover) return;
			cover.src = url;
			try {
				await cover.decode();
			} catch {
				if (revision === this.audioArtworkRevision) cover.removeAttribute('src');
				return;
			}
			if (revision !== this.audioArtworkRevision || trackKey !== (player.currentTrack?.path ?? '') || cover !== this.audioCover) return;
			cover.addClass('is-loaded');
			cover.hidden = false;
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
		this.repeatButton?.setAttribute('aria-label', activeMode === 'single' ? wmT("한 곡 반복") : wmT("전체 반복"));
	}

	private renderList() {
		const list = this.listEl;
		if (!list) return;
		const revision = ++this.renderRevision;
		const bases = this.plugin.musicLibraryBases;
		if (!bases) {
			this.renderFallback(wmT('필터를 사용하려면 베이스 코어 플러그인을 켜 주세요.'));
			return;
		}
		void bases.getFile().then(async file => {
			if (revision !== this.renderRevision || !list.isConnected) return;
			if (!file) { this.renderFallback(); return; }
			if (this.basePath === file.path && this.baseRender) return;
			this.clearList();
			list.addClass('wm-music-library-bases');
			this.basePath = file.path;
			const component = this.addChild(new Component());
			this.baseRender = component;
			await MarkdownRenderer.render(this.app, `![[${file.path}]]`, list, '', component);
		}).catch(error => {
			console.error('Music library Bases render failed', error);
			if (revision === this.renderRevision) this.renderFallback(wmT('라이브러리 필터를 불러오지 못했습니다.'));
		});
	}

	private clearList(): void {
		if (this.baseRender) this.removeChild(this.baseRender);
		if (this.fallbackTracks) this.removeChild(this.fallbackTracks);
		this.baseRender = null;
		this.fallbackTracks = null;
		this.basePath = '';
		this.listEl?.removeClass('wm-music-library-bases');
		this.listEl?.empty();
	}

	private renderFallback(message = ''): void {
		const list = this.listEl;
		const player = this.plugin.musicPlayer;
		if (!list || !player) return;
		if (!this.fallbackTracks) {
			this.clearList();
			if (message) list.createDiv({ cls: 'wm-music-library-filter-status', text: message });
			this.fallbackTracks = this.addChild(new MusicLibraryTracks(list.createDiv(), player));
		}
		const folders = new Map<string, Track[]>();
		for (const track of player.playlist) {
			const folder = folderOf(track);
			const tracks = folders.get(folder) ?? [];
			tracks.push(track);
			folders.set(folder, tracks);
		}
		const groups: MusicLibraryTrackGroup[] = [{
			key: 'favorites', label: wmT('즐겨찾기'),
			tracks: player.favoriteTracks,
		}, ...[...folders].map(([folder, tracks]) => ({
			key: folder, label: folderLabel(folder),
			tracks,
		}))];
		this.fallbackTracks.render(groups, wmT('설정에서 음악 폴더를 지정해 주세요.'));
	}
}
