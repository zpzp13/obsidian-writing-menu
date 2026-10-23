import { Notice, type App } from 'obsidian';
import { hasControlCharacters } from '../utils/typeGuards';

/** Render vault links without interpreting cell contents as HTML or block markdown. */
export function renderPlotWorkbookLinks(
	parent: HTMLElement, value: string, app: App, sourcePath: string,
	renderText: (parent: HTMLElement, text: string, offset: number) => void = (element, text) => element.appendText(text),
): void {
	let offset = 0;
	for (const match of value.matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/g)) {
		const start = match.index;
		renderText(parent, value.slice(offset, start), offset);
		const separator = match[1].indexOf('|');
		const target = (separator < 0 ? match[1] : match[1].slice(0, separator)).trim();
		const alias = separator < 0 ? '' : match[1].slice(separator + 1).trim();
		if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || hasControlCharacters(target)) {
			renderText(parent, match[0], start);
		} else {
			const label = alias || target.replace(/\.md(?=#|$)/i, '');
			const link = parent.createEl('a', { cls: 'internal-link', attr: { href: target, 'data-href': target } });
			renderText(link, label, start + 2 + (alias ? separator + 1 + match[1].slice(separator + 1).indexOf(alias) : match[1].indexOf(target)));
			const open = (event: MouseEvent) => {
				if (event.button > 1) return;
				event.preventDefault(); event.stopPropagation();
				void app.workspace.openLinkText(target, sourcePath, event.ctrlKey || event.metaKey || event.button === 1)
					.catch(() => new Notice('내부링크를 열지 못했습니다.'));
			};
			link.addEventListener('click', open);
			link.addEventListener('auxclick', open);
			for (const type of ['pointerdown', 'dblclick', 'dragstart']) link.addEventListener(type, event => event.stopPropagation());
		}
		offset = start + match[0].length;
	}
	renderText(parent, value.slice(offset), offset);
}
