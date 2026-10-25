import type WritingMenuPlugin from '../../main';
import { extractAudioMetadata, type AudioMetadata } from './AudioMetadata';

export type PlaybackMode = 'loop' | 'single' | 'shuffle';

export interface Track {
	name: string;
	path: string;
	resourcePath: string;
}

export const AUDIO_EXTS = ['mp3', 'flac', 'wav', 'm4a', 'ogg'];

/** 트랙 경로에서 폴더 경로 추출 */
function folderOf(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx >= 0 ? path.substring(0, idx) : '';
}

export class MusicPlayer {
	readonly audio: HTMLAudioElement;
	playlist: Track[] = [];       // 전체 등록 폴더의 모든 트랙
	viewPlaylist: Track[] = [];   // 선택한 뷰의 결과 또는 폴더 범위 + 모드
	currentIndex = -1;
	isPlaying = false;
	mode: PlaybackMode;
	volume: number;
	currentFolderPath: string | null = null; // 현재 재생 범위 폴더 (셔플 범위 유지용)
	readonly coverCache = new Map<string, string | null>();
	private readonly metadataCache = new Map<string, AudioMetadata>();
	private readonly coverLoads = new Map<string, Promise<string | null>>();
	private playbackScopePaths: string[] | null = null;
	// Keep the audible track when a new filter excludes it; the next track comes from the new scope.
	private detachedTrack: Track | null = null;

	private callbacks = new Set<() => void>();
	private boundEnded: () => void;
	private boundTimeUpdate: () => void;
	private viewScopeFingerprint: string = '';

	constructor(private plugin: WritingMenuPlugin) {
		this.audio = new Audio();
		this.mode = plugin.settings.musicPlaybackMode ?? 'loop';
		this.volume = plugin.settings.musicVolume ?? 1.0;
		this.audio.volume = this.volume;

		this.boundEnded = () => this.onTrackEnd();
		this.boundTimeUpdate = () => this.notifyCallbacks();
		this.audio.addEventListener('ended', this.boundEnded);
		this.audio.addEventListener('timeupdate', this.boundTimeUpdate);
		this.audio.addEventListener('durationchange', this.boundTimeUpdate);
	}

	async loadPlaylist(): Promise<void> {
		const folders = (this.plugin.settings.musicFolderPaths ?? [])
			.map(p => p.replace(/\\/g, '/').replace(/\/?$/, '/'))
			.filter(p => p.length > 1);

		const wasTrack = this.currentTrack; // 현재 재생 중인 트랙 기억

		if (folders.length === 0) {
			this.playlist = [];
			this.viewPlaylist = [];
			this.currentIndex = -1;
			this.detachedTrack = null;
			this.audio.pause();
			this.audio.src = '';
			this.isPlaying = false;
			this.notifyCallbacks();
			return;
		}

		const files = this.plugin.app.vault.getFiles()
			.filter(f => AUDIO_EXTS.includes(f.extension.toLowerCase()))
			.filter(f => folders.some(folder =>
				(f.path + '/').startsWith(folder) ||
				f.path.startsWith(folder.replace(/\/$/, ''))
			));

		this.playlist = files.map(f => ({
			name: f.basename,
			path: f.path,
			resourcePath: this.plugin.app.vault.getResourcePath(f),
		}));

		const retained = this.playlist.find(track => track.path === wasTrack?.path) ?? null;
		this.rebuildPlaybackScope(retained);
		if (wasTrack && !retained) this.loadCurrent(this.isPlaying);
		else this.notifyCallbacks();
	}

	private computeFingerprint(tracks: Track[]): string {
		return JSON.stringify(tracks.map(t => t.path).sort());
	}

	private buildViewPlaylistFrom(tracks: Track[]) {
		const newFp = this.computeFingerprint(tracks);
		if (this.mode === 'shuffle' && newFp === this.viewScopeFingerprint) return;
		this.viewScopeFingerprint = newFp;
		if (this.mode === 'shuffle') {
			this.viewPlaylist = [...tracks];
			for (let i = this.viewPlaylist.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[this.viewPlaylist[i], this.viewPlaylist[j]] = [this.viewPlaylist[j], this.viewPlaylist[i]];
			}
		} else {
			this.viewPlaylist = [...tracks];
		}
	}

	private rebuildPlaybackScope(current: Track | null): void {
		let tracks: Track[];
		if (this.playbackScopePaths !== null) {
			const available = new Map(this.playlist.map(track => [track.path, track]));
			tracks = this.playbackScopePaths.flatMap(path => available.get(path) ?? []);
		} else {
			const folder = this.currentFolderPath ?? (this.playlist[0] ? folderOf(this.playlist[0].path) : null);
			tracks = folder === null ? this.playlist : this.playlist.filter(track => folderOf(track.path) === folder);
		}
		this.buildViewPlaylistFrom(tracks);
		this.currentIndex = current ? this.viewPlaylist.findIndex(track => track.path === current.path) : (this.viewPlaylist.length ? 0 : -1);
		this.detachedTrack = this.currentIndex < 0 ? current : null;
	}

	/** The query's order is the source of truth when shuffle is disabled, including empty results. */
	setPlaybackScope(tracks: Track[]): void {
		const current = this.currentTrack;
		this.playbackScopePaths = [...new Set(tracks.map(track => track.path))];
		this.rebuildPlaybackScope(current);
		this.notifyCallbacks();
	}

	playInScope(track: Track, tracks: Track[]): void {
		if (!tracks.some(item => item.path === track.path)) return;
		this.playbackScopePaths = [...new Set(tracks.map(item => item.path))];
		this.rebuildPlaybackScope(track);
		if (this.currentIndex < 0) return;
		this.loadCurrent(true);
	}

	/** 트랙 선택 시 해당 폴더 범위로 재생목록 변경 후 재생 */
	playInFolder(track: Track) {
		this.playbackScopePaths = null;
		this.detachedTrack = null;
		const folder = folderOf(track.path);
		this.currentFolderPath = folder;
		const folderTracks = this.playlist.filter(t => folderOf(t.path) === folder);
		this.buildViewPlaylistFrom(folderTracks.length > 0 ? folderTracks : [track]);
		const idx = this.viewPlaylist.findIndex(t => t.path === track.path);
		this.currentIndex = idx >= 0 ? idx : 0;
		this.loadCurrent(true);
	}

	get currentTrack(): Track | null {
		return this.viewPlaylist[this.currentIndex] ?? this.detachedTrack;
	}

	loadCurrent(autoPlay: boolean) {
		const track = this.currentTrack;
		if (!track) {
			this.audio.src = '';
			this.isPlaying = false;
			this.notifyCallbacks();
			return;
		}
		if (this.audio.src !== track.resourcePath) {
			this.audio.src = track.resourcePath;
		}
		// 곡이 바뀐 사실을 play() 완료보다 먼저 알려 앨범아트와 곡 정보를 즉시 교체한다.
		this.notifyCallbacks();
		if (autoPlay) {
			this.audio.play().then(() => {
				this.isPlaying = true;
				this.notifyCallbacks();
			}).catch(() => {});
		} else {
			this.audio.pause();
			this.isPlaying = false;
			this.notifyCallbacks();
		}
	}

	play() {
		if (!this.currentTrack && this.viewPlaylist.length > 0) this.currentIndex = 0;
		if (!this.currentTrack) return;
		if (!this.audio.src || this.audio.src === window.location.href)
			this.audio.src = this.currentTrack.resourcePath;
		this.audio.play().then(() => {
			this.isPlaying = true;
			this.notifyCallbacks();
		}).catch(() => {});
	}

	pause() {
		this.audio.pause();
		this.isPlaying = false;
		this.notifyCallbacks();
	}

	togglePlay() { if (this.isPlaying) this.pause(); else this.play(); }

	next() {
		if (this.viewPlaylist.length === 0) return;
		this.currentIndex = (this.currentIndex + 1) % this.viewPlaylist.length;
		this.detachedTrack = null;
		this.loadCurrent(this.isPlaying);
	}

	prev() {
		if (this.viewPlaylist.length === 0) return;
		if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
		this.currentIndex = this.currentIndex < 0 ? this.viewPlaylist.length - 1 : (this.currentIndex - 1 + this.viewPlaylist.length) % this.viewPlaylist.length;
		this.detachedTrack = null;
		this.loadCurrent(this.isPlaying);
	}

	/** 현재 재생 시간과 무관하게 n 트랙 이동 (스트립 클릭용) */
	skip(offset: number) {
		const vp = this.viewPlaylist;
		if (vp.length === 0) return;
		const index = this.currentIndex < 0 ? (offset > 0 ? offset - 1 : offset) : this.currentIndex + offset;
		this.currentIndex = ((index % vp.length) + vp.length) % vp.length;
		this.detachedTrack = null;
		this.loadCurrent(this.isPlaying);
	}

	seek(ratio: number) {
		const dur = this.audio.duration;
		if (!isNaN(dur) && dur > 0)
			this.audio.currentTime = Math.max(0, Math.min(1, ratio)) * dur;
	}

	setVolume(v: number) {
		this.volume = Math.max(0, Math.min(1, v));
		this.audio.volume = this.volume;
		this.plugin.settings.musicVolume = this.volume;
		void this.plugin.saveSettings();
		this.notifyCallbacks();
	}

	setMode(m: PlaybackMode) {
		const wasTrack = this.currentTrack;
		if (m === 'shuffle' && this.mode !== 'shuffle') this.viewScopeFingerprint = '';
		this.mode = m;
		this.plugin.settings.musicPlaybackMode = m;
		void this.plugin.saveSettings();
		this.rebuildPlaybackScope(wasTrack);
		this.notifyCallbacks();
	}

	// ── 즐겨찾기 ──────────────────────────────────────────────────────────

	isFavorite(track: Track): boolean {
		return (this.plugin.settings.musicFavorites ?? []).includes(track.path);
	}

	async toggleFavorite(track: Track) {
		const favs: string[] = this.plugin.settings.musicFavorites ?? [];
		const idx = favs.indexOf(track.path);
		if (idx >= 0) favs.splice(idx, 1);
		else favs.unshift(track.path); // 최근 추가한 곡이 항상 즐겨찾기 목록 맨 위(표시 우선순위)에 오도록
		this.plugin.settings.musicFavorites = favs;
		await this.plugin.saveSettings();
		this.notifyCallbacks();
	}

	get favoriteTracks(): Track[] {
		// musicFavorites 배열의 순서(최근 추가 순)를 그대로 유지 — 재생목록 순서로 필터링하면
		// "최대 표시 수" 초과 시 방금 추가한 곡이 잘려서 안 보이는 문제가 있었음
		const byPath = new Map(this.playlist.map(t => [t.path, t]));
		const favs = this.plugin.settings.musicFavorites ?? [];
		return favs.map(p => byPath.get(p)).filter((t): t is Track => !!t);
	}

	// ── 앨범아트 · 메타데이터 ─────────────────────────────────────────────

	getCover(track: Track): Promise<string | null> {
		if (this.coverCache.has(track.path)) return Promise.resolve(this.coverCache.get(track.path)!);
		const pending = this.coverLoads.get(track.path);
		if (pending) return pending;
		const task = this.loadTrackInfo(track);
		this.coverLoads.set(track.path, task);
		return task;
	}

	async getMetadata(track: Track): Promise<AudioMetadata> {
		if (!this.metadataCache.has(track.path)) await this.getCover(track);
		return this.metadataCache.get(track.path) ?? { title: '', artist: '' };
	}

	private async loadTrackInfo(track: Track): Promise<string | null> {
		try {
			const buf = await this.plugin.app.vault.adapter.readBinary(track.path);
			this.metadataCache.set(track.path, extractAudioMetadata(buf));
			const url = extractID3Cover(buf);
			this.coverCache.set(track.path, url);
			return url;
		} catch {
			this.coverCache.set(track.path, null);
			this.metadataCache.set(track.path, { title: '', artist: '' });
			return null;
		} finally {
			this.coverLoads.delete(track.path);
		}
	}

	// ── 이벤트 ──────────────────────────────────────────────────────────

	private onTrackEnd() {
		if (this.mode === 'single') {
			this.audio.currentTime = 0;
			this.audio.play().catch(() => {});
		} else {
			if (this.viewPlaylist.length) this.next();
			else this.pause();
		}
	}

	subscribe(cb: () => void) { this.callbacks.add(cb); }
	unsubscribe(cb: () => void) { this.callbacks.delete(cb); }
	private notifyCallbacks() { this.callbacks.forEach(cb => cb()); }

	destroy() {
		this.audio.pause();
		this.audio.src = '';
		this.audio.removeEventListener('ended', this.boundEnded);
		this.audio.removeEventListener('timeupdate', this.boundTimeUpdate);
		this.audio.removeEventListener('durationchange', this.boundTimeUpdate);
		this.callbacks.clear();
		this.coverCache.clear();
		this.metadataCache.clear();
		this.coverLoads.clear();
	}
}

// ── ID3v2 APIC 파싱 ─────────────────────────────────────────────────────

function extractID3Cover(buf: ArrayBuffer): string | null {
	const bytes = new Uint8Array(buf);
	if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
	const v = bytes[3];
	const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) |
	             ((bytes[8] & 0x7f) << 7)  |  (bytes[9] & 0x7f);
	let pos = 10;
	const end = Math.min(10 + size, bytes.length);

	while (pos < end - 10) {
		const frameId = String.fromCharCode(bytes[pos], bytes[pos+1], bytes[pos+2], bytes[pos+3]);
		const frameSize = v >= 4
			? ((bytes[pos+4] & 0x7f) << 21) | ((bytes[pos+5] & 0x7f) << 14) |
			  ((bytes[pos+6] & 0x7f) << 7)  |  (bytes[pos+7] & 0x7f)
			: (bytes[pos+4] << 24) | (bytes[pos+5] << 16) | (bytes[pos+6] << 8) | bytes[pos+7];

		if (frameSize <= 0 || pos + 10 + frameSize > end) break;

		if (frameId === 'APIC') {
			let i = pos + 10 + 1; // encoding byte
			while (i < end && bytes[i] !== 0) i++; i++; // mime + null
			i++; // picture type
			// description (may be UTF-16 with BOM)
			const enc = bytes[pos + 10];
			if (enc === 1 || enc === 2) {
				// UTF-16: null terminator is 2 bytes
				while (i + 1 < end && !(bytes[i] === 0 && bytes[i+1] === 0)) i++;
				i += 2;
			} else {
				while (i < end && bytes[i] !== 0) i++; i++;
			}
			if (i >= end) break;
			const imgBytes = bytes.subarray(i, pos + 10 + frameSize);
			let mime = 'image/jpeg';
			if (imgBytes.length > 1 && imgBytes[0] === 0x89 && imgBytes[1] === 0x50) mime = 'image/png';
			// btoa for large arrays — avoid spread to prevent stack overflow
			let b64 = '';
			for (let j = 0; j < imgBytes.length; j++) b64 += String.fromCharCode(imgBytes[j]);
			return `data:${mime};base64,${btoa(b64)}`;
		}
		pos += 10 + frameSize;
	}
	return null;
}
