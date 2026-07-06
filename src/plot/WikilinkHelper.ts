import type { App, TFile } from 'obsidian';

export interface WikilinkAC {
	isOpen(): boolean;
	dismiss(): void;
}

export function attachWikilinkAutocomplete(textarea: HTMLTextAreaElement, app: App): WikilinkAC {
	let dropdown: HTMLElement | null = null;
	let selectedIdx = 0;
	let items: { name: string; path: string }[] = [];
	let bracketStart = -1;

	const isOpen = () => !!dropdown;

	const dismiss = () => {
		dropdown?.remove();
		dropdown = null;
		selectedIdx = 0;
		items = [];
	};

	const updateHighlight = () => {
		if (!dropdown) return;
		const els = dropdown.querySelectorAll<HTMLElement>('.suggestion-item');
		els.forEach((el, i) => {
			el.classList.toggle('is-selected', i === selectedIdx);
		});
		els[selectedIdx]?.scrollIntoView({ block: 'nearest' });
	};

	const insertLink = (name: string) => {
		const pos = textarea.selectionStart;
		const val = textarea.value;
		textarea.value = val.slice(0, bracketStart) + `[[${name}]]` + val.slice(pos);
		const newPos = bracketStart + name.length + 4;
		textarea.setSelectionRange(newPos, newPos);
		dismiss();
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
	};

	const showDropdown = (query: string, bStart: number) => {
		dismiss();
		bracketStart = bStart;

		const files = app.vault.getMarkdownFiles();
		const q = query.toLowerCase();
		const filtered = q
			? files.filter(f => f.basename.toLowerCase().includes(q))
			: files.slice(0, 20);

		items = filtered.slice(0, 50).map(f => ({ name: f.basename, path: f.path }));
		if (items.length === 0) return;

		dropdown = activeDocument.body.createDiv({ cls: 'suggestion-container mod-small wm-wikilink-dropdown' });
		selectedIdx = 0;

		items.forEach(({ name, path }, i) => {
			const item = (dropdown as HTMLElement).createDiv({
				cls: 'suggestion-item' + (i === 0 ? ' is-selected' : ''),
			});
			item.createDiv({ cls: 'suggestion-title', text: name });
			const folderPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) + '/' : '';
			if (folderPath) {
				item.createDiv({ cls: 'suggestion-note wm-wikilink-suggestion-note', text: folderPath });
			}
			item.addEventListener('mousedown', (e) => {
				e.preventDefault();
				insertLink(name);
			});
		});

		const rect = textarea.getBoundingClientRect();
		dropdown.style.left = `${rect.left}px`;
		dropdown.style.minWidth = `${rect.width}px`;

		window.requestAnimationFrame(() => {
			if (!dropdown) return;
			const dh = dropdown.getBoundingClientRect().height;
			const top = rect.bottom + 2 + dh > window.innerHeight
				? rect.top - dh - 2
				: rect.bottom + 2;
			dropdown.style.top = `${top}px`;
		});
	};

	textarea.addEventListener('input', () => {
		const val = textarea.value;
		const pos = textarea.selectionStart;
		const before = val.slice(0, pos);

		const lastOpen = before.lastIndexOf('[[');
		if (lastOpen === -1) { dismiss(); return; }

		const afterBracket = before.slice(lastOpen + 2);
		if (afterBracket.includes(']]') || afterBracket.includes('\n')) { dismiss(); return; }

		showDropdown(afterBracket, lastOpen);
	});

	textarea.addEventListener('keydown', (e) => {
		if (!dropdown) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault(); e.stopImmediatePropagation();
			selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
			updateHighlight();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault(); e.stopImmediatePropagation();
			selectedIdx = Math.max(selectedIdx - 1, 0);
			updateHighlight();
		} else if (e.key === 'Enter') {
			e.preventDefault(); e.stopImmediatePropagation();
			if (items[selectedIdx] !== undefined) insertLink(items[selectedIdx].name);
		} else if (e.key === 'Escape') {
			e.preventDefault(); e.stopImmediatePropagation();
			dismiss();
		}
	});

	// Delay dismiss so mousedown on item fires before blur
	textarea.addEventListener('blur', () => { window.setTimeout(dismiss, 150); });

	return { isOpen, dismiss };
}

export function renderWithWikilinks(
	container: HTMLElement,
	text: string,
	app: App,
	getOpenMode: () => 'current' | 'tab' | 'window' = () => 'tab',
) {
	if (!text.includes('[[')) {
		container.textContent = text;
		return;
	}
	const parts = text.split(/(\[\[.*?\]\])/g);
	for (const part of parts) {
		if (!part) continue;
		if (part.startsWith('[[') && part.endsWith(']]')) {
			const linkText = part.slice(2, -2);
			const span = container.createEl('span', { cls: 'wm-plot-wikilink', text: linkText });
			span.addEventListener('click', (e) => {
				e.stopPropagation();
				const mode = getOpenMode();
				if (mode === 'current') {
					const resolved = app.metadataCache.getFirstLinkpathDest(linkText, '');
					if (resolved) {
						const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(false);
						void leaf.openFile(resolved);
					} else {
						void app.workspace.openLinkText(linkText, '', false);
					}
				} else if (mode === 'window') {
					void app.workspace.openLinkText(linkText, '', 'window');
				} else {
					void app.workspace.openLinkText(linkText, '', 'tab');
				}
			});
			span.addEventListener('dblclick', (e) => e.stopPropagation());
		} else {
			container.createSpan({ text: part });
		}
	}
}
