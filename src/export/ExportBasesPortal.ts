import { Component } from 'obsidian';

/** Raise only this export's native popups, preserving their native DOM and focus lifecycle. */
export class ExportBasesPortal extends Component {
    private observer?: MutationObserver;
    private owned = new Set<HTMLElement>();
    private armed = false;
    private level = 0;

    constructor(private modalRoot: HTMLElement, private sourceHost: () => HTMLElement | undefined) { super(); }

    onload(): void {
        const doc = this.modalRoot.ownerDocument;
        const arm = (event: Event): void => {
            const target = event.target as Node | null;
            this.armed = !!target && (!!this.sourceHost()?.contains(target) || [...this.owned].some(menu => menu.contains(target)));
        };
        this.registerDomEvent(doc, 'pointerdown', arm, true);
        this.registerDomEvent(doc, 'keydown', arm, true);
        this.registerDomEvent(doc, 'contextmenu', arm, true);
        this.observer = new MutationObserver(records => {
            for (const menu of this.owned) if (!menu.isConnected) {
                menu.removeClass('wm-export-bases-portal'); menu.style.removeProperty('--wm-export-portal-level'); this.owned.delete(menu);
            }
            if (!this.armed && !this.sourceHost()?.querySelector('.has-active-menu')) return;
            for (const record of records) for (const node of Array.from(record.addedNodes)) {
                if (node.nodeType !== 1) continue;
                const menu = node as HTMLElement;
                if (this.owned.has(menu) || menu.parentElement !== doc.body || !menu.matches('.bases-toolbar-menu, .suggestion-bg, .suggestion-container, .combobox, .menu')) continue;
                this.owned.add(menu); menu.addClass('wm-export-bases-portal');
                menu.style.setProperty('--wm-export-portal-level', String(++this.level));
                // Moving a focused native combobox triggers focusout and closes it.
                // Keep the original body mount, positioning, focus and event handlers.
            }
        });
        this.observer.observe(doc.body, { childList: true });
        this.register(() => {
            this.closeMenus(); this.observer?.disconnect();
            for (const menu of this.owned) { menu.removeClass('wm-export-bases-portal'); menu.style.removeProperty('--wm-export-portal-level'); }
            this.owned.clear();
        });
    }

    closeMenus(): void {
        // Let the native controllers pop their scopes and dispose pages before removing DOM.
        const comboboxes = [...(this.sourceHost()?.querySelectorAll<HTMLElement>('.combobox-button.has-focus') ?? []), ...[...this.owned].flatMap(menu => [...menu.querySelectorAll<HTMLElement>('.combobox-button.has-focus')])];
        for (const button of comboboxes.reverse()) button.click();
        for (const button of Array.from(this.sourceHost()?.querySelectorAll<HTMLElement>('.has-active-menu') ?? [])) button.click();
        for (const menu of this.owned) if (menu.isConnected && menu.hasClass('suggestion-bg')) menu.click();
        this.armed = false;
    }
}
