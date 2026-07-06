import type WritingMenuPlugin from '../../main';

export type PlaybackMode = 'loop' | 'single' | 'shuffle';

export interface Track {
	name: string;
	path: string;
	resourcePath: string;
}

const AUDIO_EXTS = ['mp3', 'flac', 'wav', 'm4a', 'ogg'];

/** 트랙 경로에서 폴더 경로 추출 */
function folderOf(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx >= 0 ? path.substring(0, idx) : '';
}

export class MusicPlayer {
	readonly audio: HTMLAudioElement;
	playlist: Track[] = [];       // 전체 등록 폴더의 모든 트랙
	viewPlaylist: Track[] = [];   // 현재 재생 범위 (선택한 폴더 + 모드)
	currentIndex = -1;
	isPlaying = false;
	mode: PlaybackMode;
	volume: number;
	currentFolderPath: string | null = null; // 현재 재생 범위 폴더 (셔플 범위 유지용)
	readonly coverCache = new Map<string, string | null>();

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

		// 현재 재생 범위 재빌드 (같은 폴더 유지)
		if (wasTrack) {
			const folder = folderOf(wasTrack.path);
			const folderTracks = this.playlist.filter(t => folderOf(t.path) === folder);
			if (folderTracks.length > 0) {
				this.buildViewPlaylistFrom(folderTracks);
				const newIdx = this.viewPlaylist.findIndex(t => t.path === wasTrack.path);
				this.currentIndex = newIdx >= 0 ? newIdx : 0;
				// 재생 중이었으면 src만 갱신, play() 다시 호출 안 함
				const newTrack = this.currentTrack;
				if (newTrack && this.audio.src !== newTrack.resourcePath) {
					// 다른 파일이 됐을 때만 src 교체
					this.loadCurrent(this.isPlaying);
				}
				this.notifyCallbacks();
				return;
			}
		}

		// 재생 중인 트랙이 없거나 폴더가 사라진 경우
		// currentFolderPath → 없으면 playlist 첫 트랙의 폴더 → 그것도 없으면 전체
		const fallbackFolder = this.currentFolderPath
			?? (this.playlist[0] ? folderOf(this.playlist[0].path) : null);
		const fallbackScope = fallbackFolder
			? this.playlist.filter(t => folderOf(t.path) === fallbackFolder)
			: this.playlist;
		this.buildViewPlaylistFrom(fallbackScope.length > 0 ? fallbackScope : this.playlist);
		this.currentIndex = this.viewPlaylist.length > 0 ? 0 : -1;
		if (!wasTrack || !this.isPlaying) {
			this.notifyCallbacks();
		}
	}

	private computeFingerprint(tracks: Track[]): string {
		return tracks.map(t => t.path).sort().join('|');
	}

	private buildViewPlaylistFrom(tracks: Track[]) {
		const newFp = this.computeFingerprint(tracks);
		if (this.mode === 'shuffle' && newFp === this.viewScopeFingerprint) return;
		this.viewScopeFingerprint = newFp;
		if (this.mode === 'shuffle') {
			this.viewPlaylist = [...tracks].sort(() => Math.random() - 0.5);
		} else {
			this.viewPlaylist = [...tracks];
		}
	}

	/** 트랙 선택 시 해당 폴더 범위로 재생목록 변경 후 재생 */
	playInFolder(track: Track) {
		const folder = folderOf(track.path);
		this.currentFolderPath = folder;
		const folderTracks = this.playlist.filter(t => folderOf(t.path) === folder);
		this.buildViewPlaylistFrom(folderTracks.length > 0 ? folderTracks : [track]);
		const idx = this.viewPlaylist.findIndex(t => t.path === track.path);
		this.currentIndex = idx >= 0 ? idx : 0;
		this.loadCurrent(true);
	}

	get currentTrack(): Track | null {
		return this.viewPlaylist[this.currentIndex] ?? null;
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
		this.loadCurrent(this.isPlaying);
	}

	prev() {
		if (this.viewPlaylist.length === 0) return;
		if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
		this.currentIndex = (this.currentIndex - 1 + this.viewPlaylist.length) % this.viewPlaylist.length;
		this.loadCurrent(this.isPlaying);
	}

	/** 현재 재생 시간과 무관하게 n 트랙 이동 (스트립 클릭용) */
	skip(offset: number) {
		const vp = this.viewPlaylist;
		if (vp.length === 0) return;
		this.currentIndex = (this.currentIndex + offset + vp.length * 100) % vp.length;
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
		// 현재 폴더 범위 유지하며 재빌드
		const currentFolder = wasTrack
			? folderOf(wasTrack.path)
			: (this.currentFolderPath ?? (this.playlist[0] ? folderOf(this.playlist[0].path) : null));
		const scope = currentFolder
			? this.playlist.filter(t => folderOf(t.path) === currentFolder)
			: this.playlist;
		this.buildViewPlaylistFrom(scope.length > 0 ? scope : this.playlist);
		if (wasTrack) {
			const newIdx = this.viewPlaylist.findIndex(t => t.path === wasTrack.path);
			this.currentIndex = newIdx >= 0 ? newIdx : 0;
		}
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

	// ── 앨범아트 ──────────────────────────────────────────────────────────

	async getCover(track: Track): Promise<string | null> {
		if (this.coverCache.has(track.path)) return this.coverCache.get(track.path)!;
		try {
			const buf = await this.plugin.app.vault.adapter.readBinary(track.path);
			const url = extractID3Cover(buf);
			this.coverCache.set(track.path, url);
			return url;
		} catch {
			this.coverCache.set(track.path, null);
			return null;
		}
	}

	// ── 이벤트 ──────────────────────────────────────────────────────────

	private onTrackEnd() {
		if (this.mode === 'single') {
			this.audio.currentTime = 0;
			this.audio.play().catch(() => {});
		} else {
			this.next();
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
		this.callbacks.clear();
		this.coverCache.clear();
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
