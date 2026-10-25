import { wmT } from '../i18n/index';
import { setIcon } from 'obsidian';
import { renderDeusProviderIcon, type DeusModelProvider } from './DeusProviderIcon';
import type { CliModelOption } from './CliReasoning';

interface ModelDropdownOptions {
	provider(): DeusModelProvider;
	models(provider: DeusModelProvider, signal: AbortSignal): CliModelOption[] | Promise<CliModelOption[]>;
	selected(provider: DeusModelProvider): string;
	choose(provider: DeusModelProvider, model: CliModelOption): void;
	control(host: HTMLElement, provider: DeusModelProvider, models: CliModelOption[]): (() => void) | undefined;
}
const providers = [{ id: 'gemini', label: 'Gemini' }, { id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }] as const;

/** A composer popover owns its inputs, without native Menu mouse/keyboard handlers. */
export class DeusModelDropdown {
	private dom: HTMLElement | null = null;
	private trigger: HTMLElement | null = null;
	private abort?: AbortController;
	private generation = 0;
	private cleanup?: () => void;
	private layoutControl?: () => void;
	constructor(private options: ModelDropdownOptions) {}
	toggle(trigger: HTMLElement): void { if (this.dom) this.close(); else this.open(trigger); }
	close(): void {
		this.generation++; this.abort?.abort(); this.abort = undefined; this.cleanup?.(); this.cleanup = undefined;
		this.layoutControl = undefined;
		this.dom?.remove(); this.dom = null; this.trigger?.setAttribute('aria-expanded', 'false'); this.trigger = null;
	}
	private open(trigger: HTMLElement): void {
		this.trigger = trigger; trigger.setAttribute('aria-expanded', 'true');
		const doc = trigger.ownerDocument, view = doc.defaultView; if (!view) return;
		const dom = this.dom = doc.body.createDiv({ cls: 'menu deus-compact-menu deus-model-menu', attr: { role: 'dialog', 'aria-label': wmT("AI 및 모델 선택") } });
		const outside = (event: PointerEvent) => { if (!dom.contains(event.target as Node) && !trigger.contains(event.target as Node)) this.close(); };
		const keys = (event: KeyboardEvent) => {
			if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); trigger.focus(); }
		};
		doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', keys, true); doc.addEventListener('scroll', this.position, true); view.addEventListener('resize', this.position);
		const resize = new ResizeObserver(this.position); resize.observe(dom); resize.observe(trigger); if (trigger.parentElement) resize.observe(trigger.parentElement);
		this.cleanup = () => { resize.disconnect(); doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', keys, true); doc.removeEventListener('scroll', this.position, true); view.removeEventListener('resize', this.position); };
		this.showProviders();
	}
	private position = (): void => {
		const dom = this.dom, trigger = this.trigger; if (!dom || !trigger) return;
		if (!trigger.isConnected) { this.close(); return; }
		const rect = trigger.getBoundingClientRect(), width = trigger.ownerDocument.defaultView?.innerWidth ?? 0;
		dom.style.maxHeight = `${Math.max(0, rect.top - 14)}px`;
		const popup = dom.getBoundingClientRect();
		dom.style.left = `${Math.max(8, Math.min(rect.left, width - popup.width - 8))}px`;
		dom.style.top = `${Math.max(8, rect.top - popup.height - 6)}px`;
		this.layoutControl?.();
	};
	private row(host: HTMLElement, label: string, provider: DeusModelProvider): HTMLButtonElement {
		const row = host.createEl('button', { cls: 'menu-item deus-model-row', attr: { type: 'button' } });
		renderDeusProviderIcon(row.createSpan({ cls: 'deus-model-row-icon', attr: { 'aria-hidden': 'true' } }), provider);
		row.createSpan({ cls: 'menu-item-title', text: label }); return row;
	}
	private showProviders(): void {
		this.generation++; this.abort?.abort(); const dom = this.dom; if (!dom) return;
		this.layoutControl = undefined;
		dom.empty();
		for (const provider of providers) {
			const row = this.row(dom, provider.label, provider.id); row.addClass('deus-provider-option'); row.dataset.provider = provider.id;
			row.setAttribute('aria-pressed', String(this.options.provider() === provider.id));
			setIcon(row.createSpan({ cls: 'deus-model-row-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-right');
			row.onclick = () => { void this.showModels(provider.id); };
		}
		this.position();
	}
	private async showModels(provider: DeusModelProvider): Promise<void> {
		const dom = this.dom; if (!dom) return;
		const generation = ++this.generation; this.abort?.abort(); const abort = this.abort = new AbortController();
		this.layoutControl = undefined;
		dom.empty();
		const back = dom.createEl('button', { cls: 'menu-item deus-model-row deus-model-back', attr: { type: 'button', 'aria-label': wmT("AI 목록으로 돌아가기") } });
		setIcon(back.createSpan({ cls: 'deus-model-row-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-left');
		back.createSpan({ cls: 'deus-model-back-label', text: providers.find(item => item.id === provider)!.label }); back.onclick = () => { this.showProviders(); this.dom?.querySelector<HTMLButtonElement>(`[data-provider="${provider}"]`)?.focus(); };
		const body = dom.createDiv({ cls: 'deus-model-list', attr: { 'aria-busy': 'true' } });
		this.position();
		try {
			const result = this.options.models(provider, abort.signal), models = Array.isArray(result) ? result : await result;
			if (generation !== this.generation || abort.signal.aborted || this.dom !== dom) return;
			body.empty(); body.setAttribute('aria-busy', 'false'); const rows: Array<{ model: CliModelOption; row: HTMLButtonElement }> = [];
			const controls = dom.createDiv({ cls: 'deus-model-controls' });
			const refresh = () => {
				const selected = this.options.selected(provider);
				for (const { model, row } of rows) row.setAttribute('aria-checked', String(selected ? selected === model.id : model.isDefault));
				controls.empty(); this.layoutControl = this.options.control(controls, provider, models); this.position();
			};
			for (const model of models) {
				const row = this.row(body, model.label, provider); row.addClass('deus-model-option'); row.dataset.model = model.id; row.setAttribute('role', 'radio');
				setIcon(row.createSpan({ cls: 'deus-model-row-check', attr: { 'aria-hidden': 'true' } }), 'check');
				row.onclick = () => { this.options.choose(provider, model); this.close(); }; rows.push({ row, model });
			}
			body.setAttribute('role', 'radiogroup'); body.setAttribute('aria-label', wmT("모델"));
			body.onkeydown = event => {
				if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
				event.preventDefault(); const index = rows.findIndex(item => item.row === dom.ownerDocument.activeElement);
				rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowUp' ? rows.length - 1 : 1)) % rows.length]?.row.focus();
			};
			refresh();
		} catch (error) {
			if (generation !== this.generation || abort.signal.aborted) return;
			body.empty(); body.createDiv({ cls: 'deus-model-loading', text: error instanceof Error ? error.message : String(error) });
			const retry = body.createEl('button', { cls: 'menu-item deus-model-row', text: wmT("다시 불러오기") }); retry.onclick = () => { void this.showModels(provider); }; this.position();
		}
	}
}
