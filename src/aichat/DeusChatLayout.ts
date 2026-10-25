import { wmT } from '../i18n/index';
/*
 * Chat layout adapted from Claudian 2.3.14 (Zve composer layout).
 * Copyright (c) 2025 Yishen Tu. MIT License; see docs/licenses/Claudian-LICENSE.txt.
 * Presentation only: no provider, request, model, or command execution dependencies.
 */
import { createDeusComposerInput } from './DeusComposerInput';
export function createDeusChatLayout(container: HTMLElement) {
	const root = container.createDiv({ cls: 'deus-container' });
	const sidebar = root.createEl('aside', { cls: 'deus-navigator' });
	const resizer = root.createDiv({ cls: 'deus-session-resizer', attr: { role: 'separator', tabindex: '0', 'aria-label': wmT("프로젝트 패널 너비"), 'aria-orientation': 'vertical' } });
	const backdrop = root.createEl('button', { cls: 'deus-navigator-backdrop', attr: { type: 'button', 'aria-label': wmT("대화 목록 닫기") } });
	const panel = root.createDiv({ cls: 'deus-chat-panel' });
	const header = panel.createDiv({ cls: 'deus-header deus-input-nav-content' });
	const messagesWrapper = panel.createDiv({ cls: 'deus-messages-wrapper' });
	const messages = messagesWrapper.createDiv({ cls: 'deus-messages', attr: { role: 'log', 'aria-label': wmT("Deus AI 대화") } });
	const inputComposer = panel.createDiv({ cls: 'deus-input-composer' });
	const inputContainer = inputComposer.createDiv({ cls: 'deus-input-container' });
	const inputWrapper = inputContainer.createDiv({ cls: 'deus-input-wrapper' });
	const contextRow = inputWrapper.createDiv({ cls: 'deus-context-row' });
	const input = createDeusComposerInput(inputWrapper);
	input.placeholder = wmT("작품에 관해 물어보세요. @ 참고 자료 · / 스킬");
	const inputToolbar = inputWrapper.createDiv({ cls: 'deus-input-toolbar' });
	const popover = inputWrapper.createDiv({ cls: 'deus-add-popover', attr: { role: 'dialog', 'aria-label': wmT("자료 추가") } }); popover.hidden = true;
	return { root, sidebar, resizer, backdrop, panel, header, messagesWrapper, messages, inputComposer, inputContainer, inputWrapper, contextRow, input, inputToolbar, popover };
}
