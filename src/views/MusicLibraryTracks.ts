import { Component, setIcon } from 'obsidian';
import type { MusicPlayer, Track } from '../dashboard/MusicPlayer';
import type { AudioMetadata } from '../dashboard/AudioMetadata';
import { wmT } from '../i18n/index';

export interface MusicLibraryTrackGroup {
	key: string;
	label: string;
	tracks: Track[];
}

interface TrackGroup {
	el: HTMLElement;
	header: HTMLButtonElement;
	label: HTMLElement;
	count: HTMLElement;
	rows: HTMLElement;
}

interface TrackRow {
	el: HTMLElement;
	track: Track;
	title: HTMLElement;
	detail: HTMLElement;
	favorite: HTMLButtonElement;
	metadata: AudioMetadata | null;
}

let trackLabelId = 0;
let trackGroupId = 0;

/** Shared by the Bases view and the list used when Bases is unavailable. */
export class MusicLibraryTracks extends Component {
	private readonly rows = new Map<string, TrackRow>();
	private readonly groups = new Map<string, TrackGroup>();
	private readonly collapsedGroups: Set<string>;
	private metadataEnabled = true;
	private playbackTracks: Track[] = [];
	private scopeSignature = '';

	constructor(private containerEl: HTMLElement, private player: MusicPlayer, private options: {
		collapsedGroups?: string[];
		onCollapsedChange?: (keys: string[]) => void;
	} = {}) {
		super();
		this.collapsedGroups = new Set(options.collapsedGroups);
	}

	setCollapsedGroups(keys: string[]): void {
		this.collapsedGroups.clear();
		for (const key of keys) this.collapsedGroups.add(key);
	}

	setMetadataEnabled(enabled: boolean): void {
		if (this.metadataEnabled === enabled) return;
		this.metadataEnabled = enabled;
		for (const row of this.rows.values()) this.updateCopy(row);
	}

	render(groups: MusicLibraryTrackGroup[], emptyText: string): void {
		this.playbackTracks = [...new Map(groups.flatMap(group => group.tracks).map(track => [track.path, track])).values()];
		this.containerEl.querySelector('.wm-music-library-empty')?.remove();
		const usedRows = new Set<string>();
		const usedGroups = new Set<string>();
		let groupIndex = 0;
		for (const group of groups) {
			if (!group.tracks.length) continue;
			usedGroups.add(group.key);
			let section = this.groups.get(group.key);
			if (!section) {
				const el = this.containerEl.createDiv({ cls: 'wm-music-library-folder' });
				const rowsId = `wm-music-group-${++trackGroupId}`;
				const header = el.createEl('button', {
					cls: 'wm-music-library-folder-header',
					attr: { type: 'button', 'aria-controls': rowsId },
				});
				setIcon(header.createSpan({ cls: 'wm-music-library-folder-chevron' }), 'chevron-down');
				section = { el, header, label: header.createSpan({ cls: 'wm-music-library-folder-label' }), count: header.createSpan({ cls: 'wm-music-library-folder-count' }), rows: el.createDiv({ attr: { id: rowsId } }) };
				const target = section;
				header.addEventListener('click', () => {
					if (this.collapsedGroups.has(group.key)) this.collapsedGroups.delete(group.key);
					else this.collapsedGroups.add(group.key);
					this.applyCollapse(target, this.collapsedGroups.has(group.key));
					this.options.onCollapsedChange?.([...this.collapsedGroups]);
				});
				this.groups.set(group.key, section);
			}
			section.label.textContent = group.label;
			section.count.textContent = String(group.tracks.length);
			section.header.toggleClass('is-hidden', !group.label);
			this.applyCollapse(section, !!group.label && this.collapsedGroups.has(group.key));
			this.place(this.containerEl, section.el, groupIndex++);
			for (const [index, track] of group.tracks.entries()) {
				const key = `${group.key}\0${track.path}`;
				usedRows.add(key);
				const row = this.rows.get(key) ?? this.createRow(key, track);
				row.track = track;
				this.updateCopy(row);
				const current = this.player.currentTrack?.path === track.path;
				const favorite = this.player.isFavorite(track);
				row.el.toggleClass('is-current', current);
				row.favorite.toggleClass('is-favorite', favorite);
				row.favorite.setAttribute('aria-label', favorite ? wmT('즐겨찾기 해제') : wmT('즐겨찾기'));
				row.favorite.setAttribute('aria-pressed', String(favorite));
				this.place(section.rows, row.el, index);
			}
		}
		for (const [key, row] of this.rows) if (!usedRows.has(key)) {
			row.el.remove();
			this.rows.delete(key);
		}
		for (const [key, section] of this.groups) if (!usedGroups.has(key)) {
			section.el.remove();
			this.groups.delete(key);
		}
		if (!usedRows.size) {
			const empty = this.containerEl.createDiv({ cls: 'wm-music-library-empty' });
			setIcon(empty.createSpan(), 'disc-3');
			empty.createSpan({ text: emptyText });
		}
		const scopeSignature = JSON.stringify(this.playbackTracks.map(track => track.path));
		if (scopeSignature !== this.scopeSignature) {
			// Set before notifying subscribers, which can synchronously render this view again.
			this.scopeSignature = scopeSignature;
			this.player.setPlaybackScope(this.playbackTracks);
		}
	}

	onunload(): void {
		this.rows.clear();
		this.groups.clear();
	}

	private place(parent: HTMLElement, el: HTMLElement, index: number): void {
		const next = parent.children[index];
		if (next !== el) parent.insertBefore(el, next ?? null);
	}

	private applyCollapse(group: TrackGroup, collapsed: boolean): void {
		group.el.toggleClass('is-collapsed', collapsed);
		group.rows.hidden = collapsed;
		group.header.setAttribute('aria-expanded', String(!collapsed));
	}

	private updateCopy(row: TrackRow): void {
		const metadata = this.metadataEnabled ? row.metadata : null;
		row.title.textContent = metadata?.title.trim() || row.track.name;
		const artist = metadata?.artist.trim() ?? '';
		row.detail.textContent = artist;
		row.detail.hidden = !artist;
	}

	private createRow(key: string, track: Track): TrackRow {
		const titleId = `wm-music-track-${++trackLabelId}`;
		const el = this.containerEl.createDiv({
			cls: 'wm-music-library-track',
			// aria-label also creates an Obsidian hover tooltip; use the visible title instead.
			attr: { role: 'button', tabindex: '0', 'aria-labelledby': titleId },
		});
		const art = el.createSpan({ cls: 'wm-music-library-track-art' });
		setIcon(art, 'music-2');
		const copy = el.createSpan({ cls: 'wm-music-library-track-copy' });
		const row: TrackRow = {
			el, track,
			title: copy.createSpan({ cls: 'wm-music-library-track-title', attr: { id: titleId } }),
			detail: copy.createSpan({ cls: 'wm-music-library-track-meta' }),
			favorite: el.createEl('button', { cls: 'wm-music-library-track-favorite', attr: { type: 'button' } }),
			metadata: null,
		};
		this.rows.set(key, row);
		setIcon(row.favorite, 'heart');
		void this.player.getCover(track).then(url => {
			if (!url || this.rows.get(key) !== row || !el.isConnected) return;
			art.empty();
			art.createEl('img', { cls: 'wm-music-library-track-cover', attr: { alt: '', src: url } });
		});
		void this.player.getMetadata(track).then(metadata => {
			if (this.rows.get(key) !== row) return;
			row.metadata = metadata;
			this.updateCopy(row);
		});
		const play = () => {
			if (this.player.currentTrack?.path === row.track.path) {
				this.player.setPlaybackScope(this.playbackTracks);
				this.player.togglePlay();
			} else this.player.playInScope(row.track, this.playbackTracks);
		};
		el.addEventListener('click', event => {
			if (!(event.target as HTMLElement).closest('button')) play();
		});
		el.addEventListener('keydown', event => {
			if ((event.key !== 'Enter' && event.key !== ' ') || (event.target as HTMLElement).closest('button')) return;
			event.preventDefault();
			play();
		});
		row.favorite.addEventListener('click', event => {
			event.stopPropagation();
			void this.player.toggleFavorite(row.track);
		});
		return row;
	}
}
