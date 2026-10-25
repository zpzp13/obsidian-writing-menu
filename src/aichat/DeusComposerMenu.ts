import { wmT } from '../i18n/index';
import type { ChatContextItem } from './AiChatTypes';

export interface DeusReferenceChoice { source: ChatContextItem; checked: boolean }
export function createDeusComposerMenu(host: HTMLElement, trigger: HTMLButtonElement, options: {
 references(): DeusReferenceChoice[];
 toggle(source: ChatContextItem, checked: boolean): void;
}) {
 const close = () => { host.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
 const render = () => {
  host.empty(); host.createDiv({ cls: 'deus-add-heading', text: wmT("참고 자료") });
  const body = host.createDiv({ cls: 'deus-add-list' });
  const groups = [[wmT("본문"), ['document', 'selection']], [wmT("인물"), ['character']], [wmT("플롯"), ['plot']], [wmT("참고 자료"), ['reference']]] as const;
  const choices = options.references();
  for (const [name, kinds] of groups) {
   const items = choices.filter(item => (kinds as readonly string[]).includes(item.source.kind ?? 'reference'));
   if (!items.length) continue;
   body.createDiv({ cls: 'deus-add-heading', text: name });
   for (const { source, checked } of items) {
    const label = body.createEl('label', { cls: 'deus-reference-option' });
    const checkbox = label.createEl('input', { type: 'checkbox', attr: { 'aria-label': source.title, 'data-source-id': source.id } }); checkbox.checked = checked;
    label.createSpan({ text: source.title + (source.location ? ' · ' + source.location : '') });
    checkbox.onchange = () => options.toggle(source, checkbox.checked);
   }
  }
  if (!choices.length) body.createDiv({ cls: 'deus-add-empty', text: wmT("참고 자료가 없습니다. @로 노트를 지정할 수 있습니다.") });
 };
 trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
 trigger.onclick = () => { if (!host.hidden) { close(); return; } render(); host.hidden = false; trigger.setAttribute('aria-expanded', 'true'); };
 const outside = (event: PointerEvent) => { if (!host.contains(event.target as Node) && !trigger.contains(event.target as Node)) close(); };
 const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !host.hidden) { event.preventDefault(); event.stopPropagation(); close(); trigger.focus(); } };
 host.ownerDocument.addEventListener('pointerdown', outside); host.parentElement?.addEventListener('keydown', escape);
 return { refresh: () => {
  if (host.hidden) return;
  const active = host.ownerDocument.activeElement, sourceId = active instanceof HTMLInputElement && host.contains(active) ? active.dataset.sourceId : undefined, top = host.scrollTop;
  render(); host.scrollTop = top;
  if (sourceId) [...host.querySelectorAll<HTMLInputElement>('input')].find(input => input.dataset.sourceId === sourceId)?.focus({ preventScroll: true });
 }, dispose: () => { host.ownerDocument.removeEventListener('pointerdown', outside); host.parentElement?.removeEventListener('keydown', escape); } };
}
