import { BasesView, Component, TFile, normalizePath, parseYaml, stringifyYaml, requireApiVersion, setIcon } from 'obsidian';
import type { QueryController } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { AUDIO_EXTS } from '../dashboard/MusicPlayer';
import { wmT } from '../i18n/index';
import { MusicLibraryTracks, type MusicLibraryTrackGroup } from './MusicLibraryTracks';

export const MUSIC_LIBRARY_BASES_TYPE = 'writing-menu-music-tracks';
const SCOPE = 'wmMusicLibrary';
const FAVORITE = 'wmMusicFavorite';
const SHOW_METADATA = 'wmMusicShowMetadata';

function object(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function musicFolders(plugin: WritingMenuPlugin): string[] {
	return [...new Set(plugin.settings.musicFolderPaths.map(path => normalizePath(path.trim())).filter(path => path && path !== '/'))];
}

function formulas(plugin: WritingMenuPlugin): Record<string, string> {
	const folders = musicFolders(plugin);
	const scope = folders.map(path => `file.inFolder(${JSON.stringify(path)})`).join(' || ') || 'false';
	return {
		[SCOPE]: `${JSON.stringify(AUDIO_EXTS)}.contains(file.ext.lower()) && (${scope})`,
		[FAVORITE]: `${JSON.stringify(plugin.settings.musicFavorites ?? [])}.contains(file.path)`,
	};
}

function defaultBase(plugin: WritingMenuPlugin): Record<string, unknown> {
	const order = ['file.name', 'file.folder'];
	const sort = [{ property: 'file.name', direction: 'ASC' }];
	return {
		filters: { and: [`formula.${SCOPE}`] },
		formulas: formulas(plugin),
		properties: {
			'file.name': { displayName: wmT('곡 제목') },
			'file.folder': { displayName: wmT('폴더') },
			'file.ext': { displayName: wmT('파일 형식') },
			[`formula.${SCOPE}`]: { displayName: wmT('음악 라이브러리') },
			[`formula.${FAVORITE}`]: { displayName: wmT('즐겨찾기') },
		},
		views: [
			{ type: MUSIC_LIBRARY_BASES_TYPE, name: wmT('전체'), order, sort, groupBy: { property: 'file.folder', direction: 'ASC' } },
			{ type: MUSIC_LIBRARY_BASES_TYPE, name: wmT('즐겨찾기'), order, sort, filters: { and: [`formula.${FAVORITE}`] } },
		],
	};
}

/** A normal .base file lets the native toolbar persist edits without private APIs. */
export class MusicLibraryBases extends Component {
	private pending: Promise<TFile | null> | null = null;
	private opened = false;
	private fingerprint = '';

	constructor(private plugin: WritingMenuPlugin) { super(); }

	onload(): void {
		const player = this.plugin.musicPlayer;
		const update = () => {
			if (!this.opened || JSON.stringify(formulas(this.plugin)) === this.fingerprint) return;
			void this.getFile().catch(error => console.error('Music library Bases update failed', error));
		};
		player?.subscribe(update);
		this.register(() => player?.unsubscribe(update));
	}

	getFile(): Promise<TFile | null> {
		this.opened = true;
		if (!this.pending) this.pending = this.sync().finally(() => { this.pending = null; });
		return this.pending;
	}

	private async sync(): Promise<TFile | null> {
		const { plugin } = this;
		const folders = musicFolders(plugin);
		if (!folders.length) return null;
		let file = plugin.app.vault.getAbstractFileByPath(plugin.settings.musicLibraryBasePath ?? '');
		if (!(file instanceof TFile) || file.extension !== 'base') {
			const folder = plugin.app.vault.getAbstractFileByPath(folders[0]);
			const prefix = folder ? `${folders[0]}/` : '';
			let path = `${prefix}Music Library.base`;
			for (let suffix = 2; plugin.app.vault.getAbstractFileByPath(path); suffix++) path = `${prefix}Music Library ${suffix}.base`;
			file = await plugin.app.vault.create(path, stringifyYaml(defaultBase(plugin)));
			plugin.settings.musicLibraryBasePath = file.path;
			await plugin.saveSettings();
		}
		if (!(file instanceof TFile)) throw new Error('Invalid music library base file');
		const baseFile = file;
		// Only these two plugin-owned formulas change; preserve user filters, views and sorting.
		let snapshot: string;
		do {
			const managed = formulas(plugin);
			snapshot = JSON.stringify(managed);
			this.fingerprint = snapshot;
			const source = await plugin.app.vault.read(baseFile);
			const config = object(parseYaml(source) as unknown);
			if (!config) throw new Error('Invalid music library base');
			const current = config.formulas === undefined ? {} : object(config.formulas);
			if (!current) throw new Error('Invalid music library formulas');
			if (Object.entries(managed).some(([key, value]) => current[key] !== value)) {
				await plugin.app.vault.process(baseFile, latest => {
					const latestConfig = object(parseYaml(latest) as unknown);
					if (!latestConfig) throw new Error('Invalid music library base');
					const latestFormulas = latestConfig.formulas === undefined ? {} : object(latestConfig.formulas);
					if (!latestFormulas) throw new Error('Invalid music library formulas');
					latestConfig.formulas = { ...latestFormulas, ...managed };
					return stringifyYaml(latestConfig);
				});
			}
		} while (JSON.stringify(formulas(plugin)) !== snapshot);
		return baseFile;
	}
}

export function registerMusicLibraryBases(plugin: WritingMenuPlugin): MusicLibraryBases | null {
	if (requireApiVersion('1.10.0')) {
		class MusicLibraryBasesView extends BasesView {
			readonly type = MUSIC_LIBRARY_BASES_TYPE;
			private tracks: MusicLibraryTracks;
			private playbackSignature = '';
			private toolbarHost: HTMLElement | null;
			private metadataItem: HTMLElement | null = null;
			private metadataButton: HTMLButtonElement | null = null;

			constructor(controller: QueryController, parent: HTMLElement, private plugin: WritingMenuPlugin) {
				super(controller);
				this.toolbarHost = parent.parentElement;
				const container = parent.createDiv({ cls: 'wm-music-library-base-tracks' });
				this.tracks = this.addChild(new MusicLibraryTracks(container, plugin.musicPlayer!, {
					onCollapsedChange: keys => this.config.set('wmMusicCollapsedGroups', keys),
				}));
				const player = plugin.musicPlayer;
				const update = () => {
					const signature = JSON.stringify([player?.currentTrack?.path, player?.isPlaying, player?.playlist.map(track => track.path), plugin.settings.musicFavorites]);
					if (signature === this.playbackSignature) return;
					this.playbackSignature = signature;
					this.onDataUpdated();
				};
				player?.subscribe(update);
				this.register(() => player?.unsubscribe(update));
				this.register(() => {
					this.metadataItem?.remove();
					this.toolbarHost?.removeClass('wm-music-library-base');
				});
			}

			private updateMetadataToolbar(enabled: boolean): void {
				const toolbar = this.toolbarHost?.querySelector<HTMLElement>(':scope > .bases-header .bases-toolbar');
				if (!toolbar) return;
				this.toolbarHost?.addClass('wm-music-library-base');
				if (!this.metadataItem || !toolbar.contains(this.metadataItem)) {
					this.metadataItem?.remove();
					this.metadataItem = toolbar.createDiv({ cls: ['bases-toolbar-item', 'wm-music-library-metadata-toggle'] });
					this.metadataButton = this.metadataItem.createEl('button', {
						cls: ['clickable-icon', 'text-icon-button'],
						attr: { type: 'button', 'aria-label': wmT('메타데이터 표시') },
					});
					setIcon(this.metadataButton.createSpan({ cls: 'text-button-icon' }), 'tags');
					this.metadataButton.addEventListener('click', () => {
						const next = this.config.get(SHOW_METADATA) === false;
						this.config.set(SHOW_METADATA, next);
						this.tracks.setMetadataEnabled(next);
						this.updateMetadataToolbar(next);
					});
				}
				const properties = toolbar.querySelector('.bases-toolbar-properties-menu');
				if (properties && this.metadataItem.nextElementSibling !== properties) toolbar.insertBefore(this.metadataItem, properties);
				this.metadataButton?.setAttribute('aria-pressed', String(enabled));
				this.metadataButton?.toggleClass('is-active', enabled);
			}

			onDataUpdated(): void {
				const player = this.plugin.musicPlayer;
				if (!player || !this.data || !this.config) return;
				// Bases assigns config after the view factory returns, before its first data update.
				const collapsed = this.config.get('wmMusicCollapsedGroups');
				this.tracks.setCollapsedGroups(Array.isArray(collapsed) ? collapsed.filter((key): key is string => typeof key === 'string') : []);
				const showMetadata = this.config.get(SHOW_METADATA) !== false;
				this.tracks.setMetadataEnabled(showMetadata);
				this.updateMetadataToolbar(showMetadata);
				const available = new Map(player.playlist.map(track => [track.path, track]));
				const groups: MusicLibraryTrackGroup[] = this.data.groupedData.map(group => ({
					key: JSON.stringify(group.hasKey() ? ['group', group.key?.toString()] : ['ungrouped']),
					label: group.hasKey() ? group.key?.toString() ?? '' : '',
					tracks: group.entries.flatMap(entry => {
						const track = available.get(entry.file.path);
						if (!track) return [];
						return [track];
					}),
				}));
				this.tracks.render(groups, player.playlist.length ? wmT('검색 결과가 없습니다.') : wmT('설정에서 음악 폴더를 지정해 주세요.'));
			}
		}
		if (!plugin.registerBasesView(MUSIC_LIBRARY_BASES_TYPE, {
			name: wmT('음악 라이브러리'),
			icon: 'list-music',
			factory: (controller, container) => new MusicLibraryBasesView(controller, container, plugin),
		})) return null;
		return plugin.addChild(new MusicLibraryBases(plugin));
	}
	return null;
}
