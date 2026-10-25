import { wmT } from '../i18n/index';
import { setIcon } from 'obsidian';

/** Visibility is local to this settings control and never stored with the key. */
export function configureApiKeyInput(input: HTMLInputElement): void {
	const wrap = input.parentElement!.createDiv({ cls: 'wm-api-key-field' });
	wrap.appendChild(input);
	input.autocomplete = 'off';
	input.spellcheck = false;
	const toggle = wrap.createEl('button', { cls: 'clickable-icon wm-api-key-visibility', attr: { type: 'button' } });
	let hidden = true;
	const render = () => {
		input.type = hidden ? 'password' : 'text';
		toggle.toggleClass('is-active', hidden);
		toggle.setAttribute('aria-pressed', String(hidden));
		toggle.setAttribute('aria-label', hidden ? wmT("API 키 표시") : wmT("API 키 숨기기"));
		setIcon(toggle, hidden ? 'eye-off' : 'eye');
	};
	toggle.addEventListener('pointerdown', event => event.preventDefault());
	toggle.addEventListener('click', () => { hidden = !hidden; render(); });
	render();
}
