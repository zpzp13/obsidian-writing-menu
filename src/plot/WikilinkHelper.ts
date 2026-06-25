import type { App } from 'obsidian';

export interface WikilinkAC {
	isOpen(): boolean;
	dismiss(): void;
}

export function attachWikilinkAutocomplete(textarea: HTMLTextAreaElement, app: App): WikilinkAC {
	let dropdown: HTMLElement | null = null;
	let selectedIdx = 0;
	let items: string[] = [];
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
		dropdown.querySelectorAll<HTMLElement>('.suggestion-item').forEach((el, i) => {
			el.classList.toggle('is-selected', i === selectedIdx);
		});
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

		items = filtered.slice(0, 10).map(f => f.basename);
		if (items.length === 0) return;

		dropdown = document.body.createDiv({ cls: 'suggestion-container mod-small' });
		selectedIdx = 0;

		items.forEach((name, i) => {
			const item = (dropdown as HTMLElement).createDiv({
				cls: 'suggestion-item' + (i === 0 ? ' is-selected' : ''),
			});
			item.textContent = name;
			item.addEventListener('mousedown', (e) => {
				e.preventDefault();
				insertLink(name);
			});
		});

		const rect = textarea.getBoundingClientRect();
		Object.assign((dropdown as HTMLElement).style, {
			position: 'fixed',
			zIndex: '10002',
			left: `${rect.left}px`,
			minWidth: `${rect.width}px`,
		});

		requestAnimationFrame(() => {
			if (!dropdown) return;
			const dh = dropdown.getBoundingClientRect().height;
			const top = rect.bottom + 2 + dh > window.innerHeight
				? rect.top - dh - 2
				: rect.bottom + 2;
			(dropdown as HTMLElement).style.top = `${top}px`;
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
			if (items[selectedIdx] !== undefined) insertLink(items[selectedIdx]);
		} else if (e.key === 'Escape') {
			e.preventDefault(); e.stopImmediatePropagation();
			dismiss();
		}
	});

	// Delay dismiss so mousedown on item fires before blur
	textarea.addEventListener('blur', () => { setTimeout(dismiss, 150); });

	return { isOpen, dismiss };
}

export function renderWithWikilinks(container: HTMLElement, text: string, app: App) {
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
				void app.workspace.openLinkText(linkText, '', false);
			});
			span.addEventListener('dblclick', (e) => e.stopPropagation());
		} else {
			container.createSpan({ text: part });
		}
	}
}
