import { wmT } from '../i18n/index';
import { setIcon } from 'obsidian';
import { PlotWorkbookChecklistEditor } from './PlotWorkbookChecklistEditor';
import type { PlotWorkbookSession } from './PlotWorkbookSession';
import { DEFAULT_PLOTBOOK_FONT_SIZE, type PlotWorkbookForeshadowLocation } from './PlotWorkbookTypes';

export class PlotWorkbookChecklistPopover {
	private readonly element: HTMLElement;
	private readonly editor: PlotWorkbookChecklistEditor;
	private readonly document: Document;
	private readonly unsubscribe: () => void;
	private readonly resize: ResizeObserver;
	private readonly previousFocus: HTMLElement | null;
	private closed = false;
	private anchorBounds: DOMRect;

	constructor(anchor: HTMLElement, session: PlotWorkbookSession, location: PlotWorkbookForeshadowLocation, onSidebar: () => void, private readonly onClose: () => void, private readonly resolveAnchor: () => HTMLElement | null = () => anchor) {
		this.document = anchor.ownerDocument;
		this.anchorBounds = anchor.getBoundingClientRect();
		this.previousFocus = this.document.activeElement as HTMLElement | null;
		this.element = this.document.body.createDiv({ cls: 'wm-plotbook-checklist-popover', attr: { role: 'dialog', 'aria-label': wmT("체크리스트 편집") } });
		const header = this.element.createDiv({ cls: 'wm-plotbook-checklist-popover-heading', attr: { role: 'toolbar', 'aria-label': wmT("체크리스트 도구") } });
		const filters = header.createDiv({cls:'wm-plotbook-checklist-filters',attr:{role:'group','aria-label':wmT("체크리스트 표시")}});
		for(const [value,label] of [['all',wmT("전체")],['pending',wmT("미완료")]] as const) {
			const button = filters.createEl('button',{text:label,attr:{type:'button','data-completed-filter':value,'aria-pressed':String(value === 'all')}});
			button.addEventListener('click',()=>{
				this.editor.setHideCompleted(value === 'pending');
				filters.querySelectorAll<HTMLButtonElement>('button').forEach(item=>item.setAttribute('aria-pressed',String(item === button)));
			});
		}
		const sidebar = header.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': wmT("사이드바에서 보기") } });
		setIcon(sidebar, 'panel-right');
		sidebar.addEventListener('click', () => { this.close(); onSidebar(); });
		const close = header.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': wmT("닫기") } });
		setIcon(close, 'x'); close.addEventListener('click', () => this.close());
		const composer = this.element.createDiv({ cls: 'wm-plotbook-checklist-popover-composer' });
		this.editor = new PlotWorkbookChecklistEditor(this.element, session, location, composer);
		const updateFontSize = () => {
			const style = session.getCellStyle(session.activeSheet, location.rowId, location.columnId);
			this.editor.element.style.fontSize = `${style.fontSize ?? DEFAULT_PLOTBOOK_FONT_SIZE}px`;
		};
		updateFontSize();
		this.position();
		this.resize = new ResizeObserver(() => { if (!this.closed) this.position(); });
		this.resize.observe(this.element);
		this.document.addEventListener('pointerdown', this.outside, true);
		this.document.addEventListener('keydown', this.keydown, true);
		this.document.addEventListener('scroll', this.onLayoutChange, true);
		this.document.defaultView?.addEventListener('resize', this.onLayoutChange);
		this.unsubscribe = session.subscribe(() => {
			if (session.activeSheet.sheetId !== location.sheetId || !session.activeSheet.rows[location.rowId]
				|| session.activeSheet.columns[location.columnId]?.role !== 'checklist') this.close();
			else updateFontSize();
		});
		this.editor.focus();
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		const restoreFocus = this.element.contains(this.document.activeElement);
		this.resize.disconnect();
		this.document.removeEventListener('pointerdown', this.outside, true);
		this.document.removeEventListener('keydown', this.keydown, true);
		this.document.removeEventListener('scroll', this.onLayoutChange, true);
		this.document.defaultView?.removeEventListener('resize', this.onLayoutChange);
		this.unsubscribe(); this.editor.destroy(); this.element.remove(); this.onClose();
		if (restoreFocus && this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
	}

	private position(): void {
		// Editing can rebuild/hide the virtual cell while the popup resizes.
		// Its original position stays valid until the surrounding layout moves.
		const rect = this.anchorBounds;
		const viewport = this.document.documentElement;
		this.element.style.width = `${Math.min(300, viewport.clientWidth - 24)}px`;
		this.element.style.left = `${Math.max(12, Math.min(rect.left, viewport.clientWidth - this.element.offsetWidth - 12))}px`;
		this.element.style.top = `${Math.max(12, Math.min(rect.bottom + 6, viewport.clientHeight - this.element.offsetHeight - 12))}px`;
	}

	private readonly onLayoutChange = (event: Event): void => {
		if (this.closed || (event.type === 'scroll' && this.element.contains(event.target as Node | null))) return;
		const anchor = this.resolveAnchor();
		if (anchor?.isConnected) {
			const bounds = anchor.getBoundingClientRect();
			if (bounds.width > 0 && bounds.height > 0) this.anchorBounds = bounds;
		}
		this.position();
	};

	private readonly outside = (event: PointerEvent) => {
		if (!this.editor.hasOpenMenu && !this.element.contains(event.target as Node)) this.close();
	};
	private readonly keydown = (event: KeyboardEvent) => {
		if (event.isComposing || this.editor.hasOpenMenu) return;
		if (event.key === 'Escape') {
			if ((event.target as Element | null)?.matches('.wm-plotbook-checklist-title-input')) return;
			event.preventDefault(); event.stopPropagation(); this.close();
		} else if (event.key === 'Tab') {
			const controls = [...this.element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')].filter(element => element.offsetParent !== null);
			const next = event.shiftKey ? controls[controls.length - 1] : controls[0];
			if (next && (!this.element.contains(event.target as Node) || event.target === (event.shiftKey ? controls[0] : controls[controls.length - 1]))) {
				event.preventDefault(); next.focus();
			}
		}
	};
}
