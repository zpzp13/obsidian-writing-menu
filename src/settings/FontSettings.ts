import { App, SearchComponent, Setting, SettingPage, requireApiVersion } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { wmT } from '../i18n/index';
import { InstalledFontCache } from '../toolbar/InstalledFontCache';

const description = () => wmT("툴바에 표시할 글꼴입니다. 끌어서 순서를 바꾸거나 × 버튼으로 삭제할 수 있습니다.");

export function toolbarFonts(plugin: WritingMenuPlugin): string[] {
	return [...new Set([...(plugin.settings.customFonts ?? []), plugin.settings.fontFamily]
		.map(font => font?.trim()).filter((font): font is string => !!font && font !== 'inherit'))];
}

export function saveToolbarFonts(plugin: WritingMenuPlugin, fonts: string[]): void {
	plugin.settings.customFonts = [...fonts];
	if (!fonts.includes(plugin.settings.fontFamily)) plugin.settings.fontFamily = 'inherit';
	void plugin.saveSettings();
}

interface NativeFontPage extends SettingPage {
	values: string[];
	onChange: (fonts: string[]) => void;
}

/** The appearance tab's own font page, with its data redirected to this plugin.
 * This is an optional internal bridge: no core appearance preferences are changed.
 * If Obsidian changes the page shape, use the public-component renderer below.
 */
function nativeFontPage(app: App): NativeFontPage | null {
	const host = (app as App & { setting?: { settingTabs?: Array<{ id: string; getSettingDefinitions?: () => SettingDefinitionItem[] }> } }).setting;
	const appearance = host?.settingTabs?.find(tab => tab.id === 'appearance');
	const find = (items: SettingDefinitionItem[]): NativeFontPage | null => {
		if (requireApiVersion('1.13.0')) {
			for (const item of items) {
				if (!('type' in item)) continue;
				if (item.type === 'page' && item.page) {
					const page = item.page() as Partial<NativeFontPage>;
					if (Array.isArray(page.values) && typeof page.onChange === 'function' && typeof page.display === 'function') return page as NativeFontPage;
				}
				if (item.items) {
					const page = find(item.items);
					if (page) return page;
				}
			}
		}
		return null;
	};
	try { return find(appearance?.getSettingDefinitions?.() ?? []); }
	catch { return null; }
}

export function createToolbarFontSettingsPage(app: App, plugin: WritingMenuPlugin): SettingPage {
	if (requireApiVersion('1.13.0')) {
		const page = nativeFontPage(app);
		if (page) {
			page.values = toolbarFonts(plugin);
			page.onChange = fonts => saveToolbarFonts(plugin, fonts);
			const display = page.display.bind(page);
			page.display = () => {
				display();
				// Core's font stack description does not describe a toolbar's saved choices.
				page.containerEl.querySelector('.setting-page-desc')?.setText(description());
			};
			return page;
		}
		return new class extends SettingPage {
			display(): void {
				this.containerEl.empty();
				renderToolbarFontSettings(this.containerEl, plugin);
			}
		}();
	}
	throw new Error('Font setting pages require Obsidian 1.13.0.');
}

/** Older hosts retain the same native Setting/Search components and list classes. */
export function renderToolbarFontSettings(containerEl: HTMLElement, plugin: WritingMenuPlugin): void {
	containerEl.createEl('p', { cls: 'setting-page-desc', text: description() });
	const selectedGroup = containerEl.createDiv({ cls: 'setting-group mod-list' });
	const selectedList = selectedGroup.createDiv({ cls: 'setting-items' });
	const availableGroup = containerEl.createDiv({ cls: 'setting-group mod-list' });
	const searchHost = availableGroup.createDiv({ cls: 'setting-group-search' });
	const availableList = availableGroup.createDiv({ cls: 'setting-items' });
	const search = new SearchComponent(searchHost).setPlaceholder(wmT("폰트 이름을 입력해주세요..."));
	const cache = new InstalledFontCache();
	let draggedFont: string | null = null;
	const save = (fonts: string[]) => {
		saveToolbarFonts(plugin, fonts);
		renderSelected();
		renderAvailable();
	};
	const move = (font: string, target: number) => {
		const fonts = toolbarFonts(plugin);
		const from = fonts.indexOf(font);
		if (from < 0 || target < 0 || target >= fonts.length || from === target) return;
		fonts.splice(from, 1);
		fonts.splice(target, 0, font);
		save(fonts);
		selectedList.querySelectorAll<HTMLElement>('.mod-drag-handle')[target]?.focus();
	};
	const renderSelected = () => {
		selectedList.empty();
		const fonts = toolbarFonts(plugin);
		if (!fonts.length) new Setting(selectedList).setName(wmT("등록된 글꼴이 없습니다."));
		fonts.forEach((font, index) => {
			const row = new Setting(selectedList).setName(font);
			row.nameEl.setCssStyles({ fontFamily: font });
			row.addExtraButton(button => button.setIcon('x').setTooltip(wmT("삭제")).onClick(() => save(toolbarFonts(plugin).filter(value => value !== font))));
			row.addExtraButton(button => {
				button.setIcon('menu').setTooltip(wmT("끌어서 순서 변경"));
				const handle = button.extraSettingsEl;
				handle.addClass('mod-drag-handle');
				handle.draggable = true;
				handle.tabIndex = 0;
				handle.addEventListener('dragstart', event => { draggedFont = font; event.dataTransfer?.setData('text/plain', font); });
				handle.addEventListener('dragend', () => { draggedFont = null; });
				handle.addEventListener('keydown', event => {
					if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
					event.preventDefault();
					move(font, index + (event.key === 'ArrowUp' ? -1 : 1));
				});
			});
			row.settingEl.addEventListener('dragover', event => { if (draggedFont) event.preventDefault(); });
			row.settingEl.addEventListener('drop', event => {
				if (!draggedFont) return;
				event.preventDefault();
				move(draggedFont, index);
				draggedFont = null;
			});
		});
	};
	const renderAvailable = () => {
		availableList.empty();
		const query = search.getValue().trim();
		const registered = toolbarFonts(plugin);
		const matches = (cache.families ?? []).filter(font => !registered.includes(font) && font.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
		if (query && ![...registered, ...(cache.families ?? [])].some(font => font.toLocaleLowerCase() === query.toLocaleLowerCase())) matches.unshift(query);
		for (const font of matches) {
			const row = new Setting(availableList).setName(font);
			row.nameEl.setCssStyles({ fontFamily: font, color: 'var(--text-normal)' });
			row.settingEl.addClasses(['mod-action', 'tappable']);
			row.settingEl.tabIndex = 0;
			row.settingEl.setAttribute('role', 'button');
			const add = () => save([...toolbarFonts(plugin), font]);
			row.settingEl.addEventListener('click', add);
			row.settingEl.addEventListener('keydown', event => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault(); add();
			});
		}
	};
	search.onChange(renderAvailable);
	renderSelected();
	renderAvailable();
	void cache.load(containerEl.ownerDocument).then(() => { if (containerEl.isConnected) renderAvailable(); });
}
