import { setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { MusicPlayer, Track } from './MusicPlayer';
import { refreshOverflowMarquee, watchDisconnect } from '../utils/domUtils';

function folderName(track: Track | null): string {
	if (!track) return 'LOCAL LIBRARY';
	const parts = track.path.split('/');
	return parts.length > 1 ? parts[parts.length - 2] : 'LOCAL LIBRARY';
}

function control(parent: HTMLElement, icon: string, label: string, primary = false): HTMLButtonElement {
	const button = parent.createEl('button', {
		cls: `wm-archive-mini-control${primary ? ' is-primary' : ''}`,
		attr: { type: 'button', 'aria-label': label },
	});
	setIcon(button, icon);
	return button;
}

async function updateArtwork(
	host: HTMLElement,
	track: Track | null,
	player: MusicPlayer,
	isCurrent: () => boolean,
) {
	host.empty();
	if (!track) {
		setIcon(host.createSpan({ cls: 'wm-archive-mini-art-placeholder' }), 'music-2');
		return;
	}
	setIcon(host.createSpan({ cls: 'wm-archive-mini-art-placeholder' }), 'music-2');
	const url = await player.getCover(track);
	if (!url || !isCurrent()) return;
	host.empty();
	const image = host.createEl('img', { cls: 'wm-archive-mini-art-image', attr: { alt: '' } });
	image.src = url;
}

export class ArchiveMusicPlayerSection {
	static render(container: HTMLElement, plugin: WritingMenuPlugin, compact?: HTMLElement) {
		const player = plugin.musicPlayer;
		const root = container.createDiv({ cls: 'wm-dash-music-player wm-archive-mini-player' });

		if (!player) {
			root.createDiv({ cls: 'wm-dash-music-empty', text: '플레이어를 불러오는 중입니다.' });
			return;
		}
		if (player.playlist.length === 0) {
			const empty = root.createDiv({ cls: 'wm-archive-mini-empty' });
			setIcon(empty.createSpan(), 'disc-3');
			empty.createSpan({ text: '설정에서 음악 폴더를 지정해 주세요.' });
			const renderWhenPlaylistIsReady = () => {
				if (!root.isConnected) {
					player.unsubscribe(renderWhenPlaylistIsReady);
					return;
				}
				if (player.playlist.length === 0) return;
				player.unsubscribe(renderWhenPlaylistIsReady);
				container.empty();
				this.render(container, plugin, compact);
			};
			player.subscribe(renderWhenPlaylistIsReady);
			watchDisconnect(root, () => player.unsubscribe(renderWhenPlaylistIsReady));
			return;
		}

		let compactTrack: HTMLElement | null = null;
		if (compact) compactTrack = compact.createDiv({ cls: 'wm-music-compact-title' });

		const shell = root.createDiv({ cls: 'wm-archive-mini-shell' });
		const artRing = shell.createDiv({ cls: 'wm-archive-mini-art-ring' });
		const progressSvg = artRing.createSvg('svg', { cls: 'wm-archive-mini-progress', attr: { viewBox: '0 0 52 52', 'aria-hidden': 'true' } });
		progressSvg.createSvg('rect', { cls: 'wm-archive-mini-progress-track', attr: { x: '2', y: '2', width: '48', height: '48', rx: '12', pathLength: '100' } });
		const progressCircle = progressSvg.createSvg('rect', { cls: 'wm-archive-mini-progress-value', attr: { x: '2', y: '2', width: '48', height: '48', rx: '12', pathLength: '100' } });
		const art = artRing.createEl('button', {
			cls: 'wm-archive-mini-art',
			attr: { type: 'button', 'aria-label': '재생 또는 일시정지' },
		});

		const info = shell.createDiv({
			cls: 'wm-archive-mini-info',
			attr: { role: 'button', tabindex: '0', title: '음악 라이브러리 열기' },
		});
		const title = info.createDiv({ cls: 'wm-archive-mini-title' });
		const artist = info.createDiv({ cls: 'wm-archive-mini-artist' });
		const controls = shell.createDiv({ cls: 'wm-archive-mini-controls' });
		const previous = control(controls, 'skip-back', '이전 곡');
		const play = control(controls, player.isPlaying ? 'pause' : 'play', '재생 또는 일시정지', true);
		const next = control(controls, 'skip-forward', '다음 곡');

		previous.addEventListener('click', () => player.prev());
		play.addEventListener('click', () => player.togglePlay());
		next.addEventListener('click', () => player.next());
		art.addEventListener('click', () => player.togglePlay());
		const openLibrary = () => { void plugin.openMusicLibrarySidebar(); };
		info.addEventListener('click', openLibrary);
		info.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openLibrary();
		});

		let startX: number | null = null;
		let dragX = 0;
		shell.addEventListener('pointerdown', event => {
			if ((event.target as HTMLElement).closest('.wm-archive-mini-controls')) return;
			startX = event.clientX;
			dragX = 0;
		});
		shell.addEventListener('pointermove', event => {
			if (startX === null) return;
			dragX = event.clientX - startX;
			if (Math.abs(dragX) < 8) return;
			shell.setCssStyles({ transform: `translateX(${dragX * .35}px)` });
		});
		const finishSwipe = () => {
			if (startX === null) return;
			if (dragX > 54) player.prev();
			else if (dragX < -54) player.next();
			startX = null;
			dragX = 0;
			shell.setCssStyles({ transform: '' });
		};
		shell.addEventListener('pointerup', finishSwipe);
		shell.addEventListener('pointercancel', finishSwipe);

		let lastPath = '';
		let artRevision = 0;
		const update = () => {
			const track = player.currentTrack;
			const duration = player.audio.duration;
			const ratio = Number.isFinite(duration) && duration > 0
				? Math.max(0, Math.min(1, player.audio.currentTime / duration))
				: 0;
			progressCircle.style.strokeDashoffset = String(100 - ratio * 100);
			setIcon(play, player.isPlaying ? 'pause' : 'play');
			if (track?.path !== lastPath) {
				lastPath = track?.path ?? '';
				refreshOverflowMarquee(title, track?.name ?? '재생할 곡을 선택하세요');
				artist.textContent = folderName(track);
				if (compactTrack) refreshOverflowMarquee(compactTrack, track?.name ?? '—');
				const revision = ++artRevision;
				void updateArtwork(art, track, player, () => revision === artRevision && root.isConnected);
			}
		};

		update();
		player.subscribe(update);
		watchDisconnect(root, () => player.unsubscribe(update));
	}
}
