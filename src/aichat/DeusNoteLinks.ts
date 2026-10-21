import type { App, HoverParent } from 'obsidian';

/** Native vault links are independent of citations and never bind to arbitrary evidence. */
export function renderDeusNoteLinks(app: App, content: HTMLElement, sourcePath: string, hoverParent: HoverParent, report: (error: unknown) => void): void {
	const document = content.ownerDocument, nodes: Text[] = [], walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) if (!walker.currentNode.parentElement?.closest('a, pre, code, button')) nodes.push(walker.currentNode as Text);
	for (const node of nodes) {
		const matches = [...node.data.matchAll(/\[\[([^\]\n]+)\]\]/g)]; if (!matches.length) continue;
		const fragment = document.createElement('span'); let offset = 0;
		for (const match of matches) {
			fragment.appendText(node.data.slice(offset, match.index)); offset = match.index! + match[0].length;
			const [target, ...alias] = match[1].split('|'), linktext = target.trim();
			if (!linktext || /^[a-z][a-z\d+.-]*:/i.test(linktext) || /[\u0000-\u001f]/.test(linktext)) { fragment.appendText(match[0]); continue; }
			fragment.createEl('a', { cls: 'internal-link', text: alias.join('|').trim() || linktext.replace(/\.md(?=#|$)/i, ''), attr: { href: linktext, 'data-href': linktext } });
		}
		fragment.appendText(node.data.slice(offset)); node.replaceWith(...Array.from(fragment.childNodes));
	}
	for (const link of content.querySelectorAll<HTMLAnchorElement>('a.internal-link:not(.deus-citation-chip)')) {
		const linktext = link.dataset.href || link.getAttribute('href') || '';
		if (!linktext || /^[a-z][a-z\d+.-]*:/i.test(linktext)) continue;
		const open = (event: MouseEvent) => { if (event.button > 1) return; event.preventDefault(); event.stopImmediatePropagation(); void app.workspace.openLinkText(linktext, sourcePath, event.ctrlKey || event.metaKey || event.button === 1).catch(report); };
		link.addEventListener('click', open, true); link.addEventListener('auxclick', open, true);
		link.onmouseover = event => app.workspace.trigger('hover-link', { event, source: 'writing-menu-deus', hoverParent, targetEl: link, linktext, sourcePath });
	}
}
