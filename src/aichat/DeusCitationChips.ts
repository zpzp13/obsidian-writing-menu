import { detachedEl } from '../utils/dom';
import { Menu, type App, type HoverParent } from 'obsidian';
import type { ChatContextItem } from './AiChatTypes';
import type { DeusDisplayReference } from './AiChatPrompt';

/** Present supplied evidence as compact inline groups; every action keeps its exact source binding. */
export function renderDeusCitationChips(app: App, content: HTMLElement, host: HTMLElement, references: DeusDisplayReference[], hoverParent: HoverParent,
	open: (source: ChatContextItem, quote: string) => Promise<void>, report: (error: unknown) => void): void {
	if (!references.length) return;
	const prefix = `deus-source-${crypto.randomUUID()}-`;
	const visit = (reference: DeusDisplayReference) => { void open(reference.source, reference.quote ?? reference.source.text).catch(report); };
	const hover = (link: HTMLAnchorElement, reference: DeusDisplayReference) => {
		if (!reference.source.path || reference.source.kind === 'plot') return;
		link.addClass('internal-link'); link.dataset.href = reference.source.path;
		link.onmouseover = event => app.workspace.trigger('hover-link', { event, source: 'writing-menu-deus', hoverParent, targetEl: link, linktext: reference.source.path, sourcePath: reference.source.path });
	};
	const chip = (parent: HTMLElement, group: DeusDisplayReference[]) => {
		const first = group[0];
		const link = parent.createEl('a', { cls: 'deus-citation-chip', attr: { href: `#${prefix}${first.number}`, role: 'doc-noteref', 'aria-label': group.map(item => item.source.title).join(', '), 'data-citation-numbers': group.map(item => item.number).join(',') } });
		link.createSpan({ cls: 'deus-citation-count', text: `+${group.length}` });
		if (group.every(item => !item.quote)) link.addClass('is-reference-only');
		hover(link, first);
		link.onclick = event => {
			event.preventDefault(); event.stopPropagation();
			if (group.length === 1) { visit(first); return; }
			const menu = new Menu();
			for (const reference of group) menu.addItem(item => item.setTitle(`${reference.source.title}${reference.source.location ? ` · ${reference.source.location}` : ''}`).setIcon(reference.source.kind === 'plot' ? 'table-2' : 'file-text').onClick(() => visit(reference)));
			menu.showAtMouseEvent(event);
		};
	};
	const document = content.ownerDocument, walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT), nodes: Text[] = [];
	while (walker.nextNode()) if (!walker.currentNode.parentElement?.closest('a, pre, code, button')) nodes.push(walker.currentNode as Text);
	for (const node of nodes) {
		const groups = [...node.data.matchAll(/\[\d+\](?:[ \t]*(?:[,，][ \t]*)?\[\d+\])*/g)];
		if (!groups.length) continue;
		const fragment = detachedEl(document, 'span'); let offset = 0;
		for (const match of groups) {
			fragment.appendText(node.data.slice(offset, match.index)); offset = match.index + match[0].length;
			const numbers = [...new Set([...match[0].matchAll(/\[(\d+)\]/g)].map(item => Number(item[1])))];
			const known = numbers.map(number => references.find(reference => reference.number === number)).filter((reference): reference is DeusDisplayReference => Boolean(reference));
			if (!known.length) { fragment.appendText(match[0]); continue; }
			if (known.length) chip(fragment, known);
			for (const number of numbers.filter(number => !known.some(item => item.number === number))) fragment.appendText(` [${number}]`);
		}
		fragment.appendText(node.data.slice(offset)); node.replaceWith(...Array.from(fragment.childNodes));
	}
	const details = host.createEl('details', { cls: 'wm-chat-deus-sources', attr: { role: 'doc-endnotes', 'aria-label': '출처' } });
	details.createEl('summary', { cls: 'wm-chat-deus-sources-label', text: `출처 ${references.length}` });
	const list = details.createDiv({ cls: 'wm-chat-deus-source-list' });
	for (const reference of references) {
		const link = list.createEl('a', { cls: 'wm-chat-source-chip', text: `${reference.source.title}${reference.source.location ? ` · ${reference.source.location}` : ''}`, attr: { href: '#', id: `${prefix}${reference.number}`, 'aria-label': `출처: ${reference.source.title}` } });
		hover(link, reference); link.onclick = event => { event.preventDefault(); event.stopPropagation(); visit(reference); };
	}
}
