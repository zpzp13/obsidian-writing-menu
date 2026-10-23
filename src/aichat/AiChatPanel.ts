import { isComposingKey } from '../utils/inputCompatibility';
import { Component, MarkdownRenderer, Menu, Modal, Notice, Setting, TFile, normalizePath, setIcon, type HoverParent } from 'obsidian';
import { cliChatOptions } from './CliChatApi';
import { listCliModels } from './CliModelCatalog';
import { cliEffortLabel, selectedCliModel, supportedCliEffort } from './CliReasoning';
import { renderDeusProviderIcon, type DeusModelProvider } from './DeusProviderIcon';
import { renderDeusEffortControl } from './DeusEffortControl';
import { DeusModelDropdown } from './DeusModelDropdown';
import { geminiThinkingLevels, resolveGeminiThinking } from './GeminiThinking';
import type WritingMenuPlugin from '../../main';
import { getOpenWritingDocuments, getWritingDocument, getWritingDocumentForView } from '../writing/WritingDocument';
import { createDeusChatLayout } from './DeusChatLayout';
import { bindDeusSidebarResize, DEUS_SIDEBAR_BREAKPOINT } from './DeusSidebarResize';
import { createDeusComposerMenu } from './DeusComposerMenu';
import { alignDeusSubmenu } from './DeusMenus';
import { renderDeusNoteLinks } from './DeusNoteLinks';
import { renderDeusMentions, type DeusComposerInput } from './DeusComposerInput';
import { bindDeusScrollFollow } from './DeusScrollFollow';
import type { DeusPlotSelection } from './AiChatPlotKnowledge';
import { renderDeusCitationChips } from './DeusCitationChips';
import { deusPlotLocation } from './DeusPlotNavigation';
import { deusCitationLeaf } from './DeusCitationLeaf';
import { getWikiColor, getWikiDisplayName } from '../wiki/wikiProfileUtils';
import { renderChatAvatar } from './ChatAvatar';
import { AiChatRenameModal } from './AiChatRenameModal';
import { cliChatProvider, deusChatModels, effectiveChatModel, hasApiKeyForModel, selectChatModel } from './AiChatApi';
import { stripWrapping } from './AiChatContext';
import { AiChatStorage } from './AiChatStorage';
import { AiChatRequest, type ChatRequestOptions, type ChatRequestState } from './AiChatRequest';
import { ChatTextModal, type ChatContextItem } from './AiChatContextModal';
import type { AiChatMessage, AiChatSession, ChatEpisodeRangeCoverage } from './AiChatTypes';
import { AiChatKnowledge } from './AiChatKnowledge';
import { DEUS_CITATIONS, contextSourceText, prepareDeusMarkdown, locateChatQuote } from './AiChatPrompt';
import { ragIndex } from './rag/RagIndexService';
import { requestedEpisode, requestedEpisodeScope } from './rag/RagEpisodes';
import { DEUS_SKILLS, DEUS_REPLY_STYLE, resolveDeusIntent, deusSkillInstructions, parseDeusDialogue, parseDeusCommand } from './DeusSkills';
import { collectDeusScene, deusSourceAllowed } from './DeusSceneContext';
import type { DeusSkill } from './AiChatTypes';

const messageId = () => crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const report = (error: unknown) => new Notice(error instanceof Error ? error.message : String(error));

export class AiChatPanel {
	private storage: AiChatStorage;
	private requests: AiChatRequest;
	private knowledge: AiChatKnowledge;
	private session: AiChatSession | null = null;
	private container: HTMLElement | null = null;
	private messagesEl: HTMLElement | null = null;
	private sendButton: HTMLButtonElement | null = null;
	private statusEl: HTMLElement | null = null;
	private modelDropdown?: DeusModelDropdown;
	private modelSettingsTimer = 0;
	private drafts = new Map<string, string>();
	private contexts = new Map<string, ChatContextItem[]>();
	private states = new Map<string, ChatRequestState>();
	private history = false;
	private historyQuery = '';
	private historySearchOpen = false;
	private projectExpansion = new Map<string, boolean>();
	private navigatorGeneration = 0;
	private layoutCleanup?: () => void;
	private syncNavigator?: () => void;
	private disposed = false;
	private generation = 0;
	private mode: 'character' | 'deus' = 'deus';
	private excludedContexts = new Map<string, Set<string>>();
	private referenceCatalog = new Map<string, ChatContextItem[]>();
	private selectedSkills = new Map<string, DeusSkill>();
	private refreshReferenceMenu?: () => void;
	private contextGeneration = 0;
	private contextTimer = 0;
	private hoverParent: HoverParent = { hoverPopover: null };
	private parkedSessions = new Map<string, AiChatSession>();
	private deusProjectRoot: string | undefined;
	private markdownComponent = new Component();
	private scrollFollow?: ReturnType<typeof bindDeusScrollFollow>;
	private messageGeneration = 0;
	private sceneView: { getDeusSceneSelection(): DeusPlotSelection | null } | null = null;
	constructor(private plugin: WritingMenuPlugin, host: Component) {
		host.addChild(this.markdownComponent);
		this.storage = new AiChatStorage(plugin.app); this.requests = new AiChatRequest(this.storage);
		this.knowledge = new AiChatKnowledge(plugin);
		plugin.registerHoverLinkSource('writing-menu-deus', { display: 'Deus AI', defaultMod: true });
		const rememberScene = (view: unknown) => {
			if (view && typeof (view as typeof this.sceneView)?.getDeusSceneSelection === 'function') this.sceneView = view as NonNullable<typeof this.sceneView>;
			else if (getWritingDocumentForView(view)) this.sceneView = null;
		};
		rememberScene(plugin.app.workspace.getMostRecentLeaf?.()?.view);
		host.registerEvent(plugin.app.workspace.on('active-leaf-change', leaf => { rememberScene(leaf?.view); this.refreshContextPreview(); }));
		host.registerEvent(plugin.app.workspace.on('editor-change', () => this.refreshContextPreview()));
		host.register(() => { this.disposed = true; this.generation++; this.contextGeneration++; this.navigatorGeneration++; this.layoutCleanup?.(); window.clearTimeout(this.contextTimer); if (this.modelSettingsTimer) { window.clearTimeout(this.modelSettingsTimer); void this.plugin.saveSettings().catch(report); } this.requests.stopAll(); this.hoverParent.hoverPopover?.unload(); });
	}
	private async ensureSession(): Promise<void> {
		if (this.mode === 'deus' && !this.session) {
			const project = this.plugin.settings.projects.find(item => item.rootFolder === this.deusProjectRoot)
				?? this.plugin.settings.projects.find(item => item.rootFolder === this.sceneView?.getDeusSceneSelection()?.projectRoot)
				?? this.plugin.projectContext.getProjectForFile(getWritingDocument(this.plugin)?.file ?? null)
				?? this.plugin.settings.projects[0];
			if (!project) return;
			this.deusProjectRoot = project.rootFolder;
			const entry = (await this.storage.listSessions()).find(item => item.mode === 'deus' && item.projectRoot === project.rootFolder);
			const session = entry ? await this.storage.loadById(entry.id) : await this.storage.createNewSession('', '새 대화');
			if (this.mode !== 'deus' || this.deusProjectRoot !== project.rootFolder || this.disposed || this.session) return;
			this.session = session;
			if (this.session) { this.session.mode = 'deus'; this.session.projectRoot = project.rootFolder; this.restoreSpeaker(this.session); }
			return;
		}

	}
	async render(container: HTMLElement): Promise<void> {
		this.container = container; const generation = ++this.generation;
		try { await this.ensureSession(); } catch (error) { report(error); }
		if (this.disposed || generation !== this.generation) return;
		this.layoutCleanup?.(); container.empty(); const layout = createDeusChatLayout(container);
		const sidebarResize = bindDeusSidebarResize(layout.root, layout.resizer, this.plugin.settings.aiChatSidebarWidth, width => { this.plugin.settings.aiChatSidebarWidth = width; void this.plugin.saveSettings().catch(report); });
		this.syncNavigator = () => {
			const wide = layout.root.clientWidth >= DEUS_SIDEBAR_BREAKPOINT;
			layout.root.classList.toggle('is-wide', wide); layout.root.classList.toggle('is-navigator-open', this.history);
			layout.sidebar.setAttribute('aria-hidden', String(!wide && !this.history));
			sidebarResize.sync();
		};
		const resize = new ResizeObserver(() => this.syncNavigator?.()); resize.observe(layout.root); this.syncNavigator();
		const closeNavigator = () => { this.history = false; this.syncNavigator?.(); this.container?.querySelector<HTMLButtonElement>('.deus-navigator-toggle')?.focus(); };
		layout.backdrop.onclick = closeNavigator;
		const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && this.history) { event.preventDefault(); closeNavigator(); } };
		layout.root.addEventListener('keydown', escape);
		this.layoutCleanup = () => { this.closeModelMenu(); resize.disconnect(); sidebarResize.dispose(); composerMenu.dispose(); this.scrollFollow?.dispose(); this.scrollFollow = undefined; this.refreshReferenceMenu = undefined; layout.root.removeEventListener('keydown', escape); this.syncNavigator = undefined; };
		void this.renderNavigator(layout.sidebar, closeNavigator);
		this.icon(layout.header, 'panel-left', '프로젝트와 세션 열기', () => { this.history = !this.history; this.syncNavigator?.(); }).addClass('deus-navigator-toggle');
		this.icon(layout.header, 'square-pen', '새 대화', () => void this.newSession());
		layout.header.createSpan({ cls: 'deus-session-name', text: this.session?.title || '새 대화' });
		if (this.session?.parentId) this.icon(layout.header, 'corner-up-left', '분기 전 대화', () => void this.loadSession(this.session!.parentId!));
		this.icon(layout.header, 'ellipsis', '대화 설정', event => this.menu(event)).addClass('deus-header-settings');
		this.messagesEl = layout.messages; this.scrollFollow = bindDeusScrollFollow(layout.messages); this.renderMessages(true);
		this.renderContexts(layout.contextRow);
		const input = layout.input;
		input.addEventListener('click', event => {
			const link = (event.target as HTMLElement).closest<HTMLElement>('[data-deus-mention]');
			if (!link) return; event.preventDefault();
			void this.plugin.app.workspace.openLinkText(link.dataset.deusMention!, '', event.ctrlKey || event.metaKey).catch(report);
		});
		const draftKey = this.session?.id ?? 'new'; input.value = this.drafts.get(draftKey) ?? '';
		const suggestions = layout.inputWrapper.createDiv({ cls: 'deus-composer-dropdown', attr: { role: 'listbox', 'aria-label': '스킬·노트 제안' } }); suggestions.hidden = true;
		let options: Array<{ label: string; detail: string; choose: () => void }> = [], selected = 0;
		const updateSuggestions = () => {
			const prefix = input.value.slice(0, input.selectionStart), match = /(?:^|\s)([@/])([^\s@/[\]]*)$/.exec(prefix);
			options = []; selected = 0; suggestions.empty();
			if (match) {
				const start = input.selectionStart - match[2].length - 1, end = input.selectionStart;
				const insert = (text: string) => { input.setRangeText(text, start, end, 'end'); this.drafts.set(draftKey, input.value); suggestions.hidden = true; input.focus(); this.refreshContextPreview(); };
				options = match[1] === '/' && !prefix.slice(0, start).trim()
					? DEUS_SKILLS.filter(skill => skill.label.toLocaleLowerCase().includes(match[2].toLocaleLowerCase()) || skill.command.includes(match[2].toLocaleLowerCase())).map(skill => ({ label: '/' + skill.command, detail: skill.description, choose: () => { if (this.session) this.selectedSkills.set(this.session.id, skill.id); insert(''); } }))
					: match[1] === '@' ? this.referenceFiles().filter(file => file.basename.toLocaleLowerCase().includes(match[2].toLocaleLowerCase())).map(file => ({ label: file.basename, detail: '', choose: () => insert('@[[' + file.path + ']] ') })) : [];
				for (const [index, option] of options.entries()) {
					const button = suggestions.createEl('button', { cls: 'deus-composer-dropdown-item', attr: { type: 'button', role: 'option', 'aria-selected': String(index === selected) } });
					button.id = `deus-option-${generation}-${index}`;
					const copy = button.createDiv({ cls: 'deus-composer-dropdown-copy' }); copy.createSpan({ cls: 'deus-composer-dropdown-label', text: option.label }); if (option.detail) copy.createSpan({ cls: 'deus-composer-dropdown-detail', text: option.detail });
					button.onmousedown = event => event.preventDefault(); button.onclick = () => option.choose();
				}
			}
			suggestions.hidden = !options.length;
			suggestions.classList.toggle('is-visible', !suggestions.hidden);
			input.setAttribute('aria-expanded', String(!suggestions.hidden));
		};
		input.oninput = () => { this.drafts.set(draftKey, input.value); updateSuggestions(); this.refreshContextPreview(); };
		input.onblur = () => { suggestions.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
		input.onkeydown = event => {
			if (isComposingKey(event)) return;
			if (!suggestions.hidden && options.length) {
				if (event.key === 'Escape') { event.preventDefault(); suggestions.hidden = true; return; }
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); selected = (selected + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length; suggestions.querySelectorAll<HTMLElement>('[role="option"]').forEach((item, index) => { item.setAttribute('aria-selected', String(index === selected)); if (index === selected) { item.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', item.id); } }); return; }
				if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') { event.preventDefault(); options[selected].choose(); return; }
			}
			if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void this.send(input.value); }
		};
		const footer = layout.inputToolbar;
		const plus = this.icon(footer, 'plus', '자료 추가', () => this.refreshContextPreview()); plus.addClass('deus-composer-plus');
		const composerMenu = createDeusComposerMenu(layout.popover, plus, {
			references: () => this.referenceChoices(), toggle: (source, checked) => this.toggleReference(source, checked),
		}); this.refreshReferenceMenu = composerMenu.refresh;
		footer.createDiv({ cls: 'deus-toolbar-spacer' });
		const model = footer.createEl('button', { cls: 'deus-toolbar-chip deus-model-selector', attr: { 'aria-label': '모델 선택', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', type: 'button' } });
		model.createSpan({ cls: 'deus-model-icon', attr: { 'aria-hidden': 'true' } });
		this.statusEl = model.createSpan({ cls: 'deus-model-label' });
		setIcon(model.createSpan({ cls: 'deus-model-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
		model.onclick = event => { event.stopPropagation(); this.modelMenu(); };
		this.sendButton = this.icon(footer, 'arrow-up', '보내기', () => { if (this.session && this.requests.isSending(this.session.id)) this.requests.stop(this.session.id); else void this.send(input.value); });
		this.updateComposer(); this.refreshContextPreview();
	}
	private rerender(): void { if (this.container?.isConnected && !this.disposed) void this.render(this.container); }
	private referenceFiles(): TFile[] {
		if (this.deusProjectRoot === undefined) return [];
		return this.plugin.app.vault.getMarkdownFiles().filter(file => this.plugin.projectContext.getProjectForFile(file)?.rootFolder === this.deusProjectRoot && !file.path.split('/').some(part => part.startsWith('.')));
	}
	private populateProjects(menu: Menu): void {
		for (const project of this.plugin.settings.projects) menu.addItem(item => item.setTitle(project.name || project.rootFolder).setChecked(project.rootFolder === this.deusProjectRoot).onClick(() => this.selectProject(project.rootFolder)));
	}
	private selectProject(root: string): void {
		if (root === this.deusProjectRoot) return;
		if (this.session) this.parkedSessions.set(`deus:${this.session.projectRoot}`, this.session);
		this.deusProjectRoot = root; this.session = this.parkedSessions.get(`deus:${root}`) ?? null;
		this.projectExpansion.set(root, true);
		this.historyQuery = ''; this.history = false; this.rerender();
	}
	private async renderNavigator(parent: HTMLElement, close: () => void): Promise<void> {
		const header = parent.createDiv({ cls: 'deus-navigator-header' });
		const brand = header.createSpan({ cls: 'deus-brand', text: 'DEUS' });
		brand.id = `deus-navigator-heading-${this.generation}`; parent.setAttribute('aria-labelledby', brand.id);
		const search = header.createDiv({ cls: 'wm-search-field wm-dict-search-box deus-session-search-field' });
		const input = search.createEl('input', { cls: 'deus-session-search', type: 'search', attr: { placeholder: '대화 검색', 'aria-label': '대화 검색' } }); input.value = this.historyQuery;
		const sync = () => { search.hidden = !this.historySearchOpen; brand.hidden = this.historySearchOpen; };
		input.oninput = () => { this.historyQuery = input.value; this.refreshSessionList(); };
		this.icon(header, 'search', '대화 검색', () => { this.historySearchOpen = !this.historySearchOpen; if (!this.historySearchOpen) { this.historyQuery = ''; input.value = ''; } sync(); this.refreshSessionList(); if (this.historySearchOpen) input.focus(); }).addClass('deus-navigator-search'); sync();
		this.icon(header, 'panel-left-close', '대화 목록 닫기', close).addClass('deus-navigator-close');
		const create = parent.createEl('button', { cls: 'deus-navigator-new', attr: { type: 'button' } });
		setIcon(create.createSpan({ attr: { 'aria-hidden': 'true' } }), 'square-pen'); create.createSpan({ text: '새 채팅' }); create.onclick = () => void this.newSession();
		const sessions = parent.createDiv({ cls: 'deus-session-list' });
		await this.renderHistory(sessions);
	}
	private closeModelMenu(): void { this.modelDropdown?.close(); }
	private saveModelChoice(): void {
		this.updateComposer(); window.clearTimeout(this.modelSettingsTimer);
		this.modelSettingsTimer = window.setTimeout(() => { this.modelSettingsTimer = 0; void this.plugin.saveSettings().catch(report); }, 150);
	}
	private selectedDropdownModel(provider: DeusModelProvider): string {
		const settings = this.plugin.settings;
		return provider === 'claude' ? settings.aiChatClaudeCliModel : provider === 'codex' ? settings.aiChatCodexCliModel
			: cliChatProvider(effectiveChatModel(settings)) ? settings.aiChatFreeModel : effectiveChatModel(settings);
	}
	private modelMenu(): void {
		const trigger = this.container?.querySelector<HTMLElement>('.deus-model-selector'); if (!trigger) return;
		this.modelDropdown ??= new DeusModelDropdown({
			provider: () => cliChatProvider(effectiveChatModel(this.plugin.settings)) ?? 'gemini',
			selected: provider => this.selectedDropdownModel(provider),
			models: (provider, signal) => provider === 'gemini'
				? deusChatModels(this.plugin.settings).filter(model => model.provider === 'gemini').map(model => ({ id: model.id, label: model.label, isDefault: model.id === this.selectedDropdownModel(provider), efforts: [] }))
				: listCliModels(cliChatOptions(this.plugin, provider, this.session?.projectRoot), signal),
			choose: (provider, model) => {
				const settings = this.plugin.settings; selectChatModel(settings, provider === 'gemini' ? model.id : provider + '-cli');
				if (provider !== 'gemini') {
					settings[provider === 'claude' ? 'aiChatClaudeCliModel' : 'aiChatCodexCliModel'] = model.id;
					const key = provider === 'claude' ? 'aiChatClaudeCliEffort' : 'aiChatCodexCliEffort'; settings[key] = supportedCliEffort(model, settings[key]);
				}
				this.saveModelChoice();
			},
			control: (host, provider, models) => {
				const settings = this.plugin.settings, id = this.selectedDropdownModel(provider);
				if (provider === 'gemini') {
					const selected = resolveGeminiThinking(id, settings.aiChatGeminiThinking[id]);
					return renderDeusEffortControl(host, { id, label: '', isDefault: false, defaultEffort: selected, efforts: geminiThinkingLevels(id).map(level => ({ id: level, label: cliEffortLabel(level) })) }, selected, value => { settings.aiChatGeminiThinking[id] = value; this.saveModelChoice(); }, 'Gemini 추론 강도');
				} else {
					const key = provider === 'claude' ? 'aiChatClaudeCliEffort' : 'aiChatCodexCliEffort', model = selectedCliModel(models, id);
					return renderDeusEffortControl(host, model, settings[key], value => { settings[key] = value; this.saveModelChoice(); });
				}
			},
		});
		this.modelDropdown.toggle(trigger);
	}
	private async prepareDeusSources(value: string, session: AiChatSession, signal?: AbortSignal, includeExcluded = false) {
		const project = this.plugin.settings.projects.find(item => item.rootFolder === session.projectRoot);
		const source = getWritingDocument(this.plugin), open = getOpenWritingDocuments(this.plugin);
		const plotSelection = this.sceneView?.getDeusSceneSelection() ?? undefined;
		const folder = project?.characterFolder?.replace(/\/$/, '');
		const candidates = this.referenceFiles().filter(file => folder && file.path.startsWith(folder + '/')).map(file => ({ path: file.path, name: getWikiDisplayName(this.plugin.app, this.plugin, file) }));
		const intent = resolveDeusIntent(value, this.selectedSkills.get(session.id) ?? 'auto', candidates);
		const excluded = includeExcluded ? new Set<string>() : this.excludedContexts.get(session.id) ?? new Set<string>();
		const attachments = (this.contexts.get(session.id) ?? []).filter(source => deusSourceAllowed(source, excluded)).map(item => ({ ...item }));
		const previous = [...session.messages].reverse().find(message => message.role === 'user');
		if (intent.skill === 'character' && intent.scene === 'active' && previous?.skill === 'character'
			&& /^(?:이어서|계속|다시|좀\s*더|조금\s*더|더\s|그\s*다음|방금|아까)/.test(value.trim()) && !/현재|선택한|지금\s*장면/.test(value)) {
			intent.scene = 'explicit'; intent.participants = [...(previous.participants ?? [])];
			for (const item of previous.context?.sources ?? []) if (['document','selection','plot'].includes(item.kind ?? '') && deusSourceAllowed(item, excluded) && !attachments.some(source => source.id === item.id)) attachments.push({ ...item });
		}
		// Collect the catalog independently, then apply each checkbox. Excluding a manuscript
		// must not silently uncheck its separately selected cast or plot rows.
		const scene = project ? await collectDeusScene(this.plugin, project, intent, attachments.some(item => item.kind === 'selection' || item.kind === 'document') ? null : source, open, new Set(), signal, plotSelection) : { sources: [], participants: intent.participants };
		intent.participants = scene.participants.filter(person => deusSourceAllowed({ id: `deus-cast:${person.path}`, kind: 'character', path: person.path, title: person.name, text: '' }, excluded));
		for (const match of value.matchAll(/@\[\[([^\]\n]+)\]\]/g)) {
			const path = match[1], file = this.plugin.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile) || this.plugin.projectContext.getProjectForFile(file)?.rootFolder !== session.projectRoot) throw new Error(`참고 노트를 현재 프로젝트에서 찾을 수 없습니다: ${path}`);
			const id = `deus-mentioned:${path}`;
			if (!excluded.has(id) && !excluded.has(`deus-cast:${path}`) && ![...attachments, ...scene.sources].some(item => item.path === path)) attachments.push({ id, kind: folder && path.startsWith(folder + '/') ? 'character' : 'reference', title: file.basename, path, text: open.find(document => document.path === path)?.read() ?? await this.plugin.app.vault.read(file) });
		}
		return { intent, attachments: [...attachments, ...scene.sources.filter(source => !attachments.some(item => item.path === source.path && item.text.includes(source.text)))].filter(source => deusSourceAllowed(source, excluded)), project, source, open };
	}
	private refreshContextPreview(): void {
		const generation = ++this.contextGeneration; window.clearTimeout(this.contextTimer);
		this.contextTimer = window.setTimeout(() => { void (async () => {
			const session = this.session, parent = this.container?.querySelector<HTMLElement>('.deus-context-row');
			if (!session || !parent || !parent.isConnected || this.disposed) return;
			try {
				const value = this.container?.querySelector<DeusComposerInput>('.deus-input')?.value ?? '';
				const prepared = await this.prepareDeusSources(value, session, undefined, true);
				if (generation !== this.contextGeneration || session !== this.session || this.disposed) return;
				this.referenceCatalog.set(session.id, prepared.attachments);
				parent.empty(); this.renderContexts(parent);
				this.refreshReferenceMenu?.();
			} catch (error) { if (generation === this.contextGeneration) { parent.empty(); parent.createSpan({ cls: 'wm-chat-source-warning', text: error instanceof Error ? error.message : String(error) }); } }
		})(); }, 250);
	}
	private icon(parent: HTMLElement, icon: string, title: string, action: (event: MouseEvent) => void): HTMLButtonElement {
		const button = parent.createEl('button', { cls: parent.matches('.deus-message-actions, .deus-user-msg-actions') ? 'deus-text-copy-btn' : 'deus-input-nav-btn', attr: { type: 'button', 'aria-label': title } }); setIcon(button, icon); button.onclick = action; return button;
	}
	private applyCharacterColor(parent: HTMLElement, file: TFile | null): void {
		if (!file) return;
		const color = getWikiColor(this.plugin.app, this.plugin, file);
		if (CSS.supports('color', color)) parent.style.setProperty('--wm-chat-character-color', color);
	}
	private avatar(parent: HTMLElement, file: TFile | null): void {
		renderChatAvatar(parent, this.plugin, file);
	}
	private restoreSpeaker(session: AiChatSession): void {
		if (!this.contexts.has(session.id)) {
			const previous = [...session.messages].reverse().find(message => message.role === 'user' && message.context);
			this.contexts.set(session.id, previous?.context?.sources.filter(source => !source.automatic && !source.id.startsWith('deus-mentioned:')).map(source => ({ ...source })) ?? []);
		}
	}
	private async renderHistory(parent: HTMLElement): Promise<void> {
		const generation = ++this.navigatorGeneration, root = this.deusProjectRoot;
		try {
			const entries = await this.storage.listSessions(); if (!parent.isConnected || generation !== this.navigatorGeneration || root !== this.deusProjectRoot) return;
			parent.empty();
			const rows = parent.createDiv({ cls: 'deus-session-rows' });
			const projectRoot = (entry: typeof entries[number]) => entry.projectRoot ?? this.plugin.projectContext.getProjectForFile(this.plugin.app.vault.getAbstractFileByPath(entry.characterPath) as TFile | null)?.rootFolder;
			const sessionRow = (parent: HTMLElement, entry: typeof entries[number]) => {
				const row = parent.createDiv({ cls: `deus-session-entry${this.session?.id === entry.id ? ' is-selected' : ''}`, attr: { 'data-session-id': entry.id } });
				const open = row.createEl('button', { cls: 'deus-session-open', attr: { type: 'button', 'aria-current': String(this.session?.id === entry.id) } });
				open.createSpan({ cls: 'deus-session-title', text: `${entry.pinned ? '★ ' : ''}${entry.title}` });
				if (this.requests.isSending(entry.id)) open.createSpan({ cls: 'deus-session-status', text: '응답 중' });
				open.onclick = () => void this.loadSession(entry.id);
				row.oncontextmenu = event => { event.preventDefault(); event.stopPropagation(); void this.sessionMenu(entry.id, event); };
				const actions = row.createDiv({ cls: 'deus-session-actions' });
				for (const [icon, title, action] of [['pencil', '제목 수정', 'rename'], [entry.pinned ? 'pin-off' : 'pin', entry.pinned ? '고정 해제' : '대화 고정', 'pin'], ['file-output', 'Markdown 내보내기', 'export'], ['trash-2', '대화 삭제', 'delete']] as const) {
					const button = this.icon(actions, icon, title, event => { event.stopPropagation(); void this.sessionAction(entry.id, action); }); button.disabled = action !== 'export' && this.requests.isSending(entry.id);
				}
			};
			const render = (query: string) => {
				rows.empty();
				const matching = entries.filter(entry => entry.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
				rows.createDiv({ cls: 'deus-navigator-section', text: '프로젝트' });
				const projects = rows.createDiv({ cls: 'deus-project-list' });
				for (const project of this.plugin.settings.projects) {
					const root = project.rootFolder, expanded = query ? true : this.projectExpansion.get(root) ?? root === this.deusProjectRoot;
					const group = projects.createDiv({ cls: 'deus-project-group', attr: { 'data-project-root': root } });
					const button = group.createEl('button', { cls: 'deus-project-item', attr: { type: 'button', 'aria-expanded': String(expanded), 'aria-current': String(root === this.deusProjectRoot) } });
					setIcon(button.createSpan({ attr: { 'aria-hidden': 'true' } }), expanded ? 'folder-open' : 'folder'); button.createSpan({ text: project.name || root });
					button.onclick = () => { if (root !== this.deusProjectRoot) this.selectProject(root); else { this.projectExpansion.set(root, !expanded); render(this.historyQuery); } };
					if (expanded) {
						const sessions = group.createDiv({ cls: 'deus-project-sessions' });
						for (const entry of matching.filter(entry => projectRoot(entry) === root)) sessionRow(sessions, entry);
					}
				}
				rows.createDiv({ cls: 'deus-navigator-section', text: query ? '검색 결과' : '최근' });
				const recent = rows.createDiv({ cls: 'deus-recent-sessions' });
				for (const entry of matching) sessionRow(recent, entry);
				if (!matching.length) recent.createDiv({ cls: 'deus-session-empty', text: query ? '일치하는 대화가 없습니다.' : '새 대화를 시작해 보세요.' });
			};
			render(this.historyQuery);
		} catch (error) { if (parent.isConnected && generation === this.navigatorGeneration) parent.createDiv({ cls: 'wm-chat-error', text: error instanceof Error ? error.message : String(error) }); }
	}
	private refreshSessionList(): void {
		const parent = this.container?.querySelector<HTMLElement>('.deus-session-list');
		if (parent?.isConnected && !this.disposed) void this.renderHistory(parent);
	}
	private async loadSession(id: string): Promise<void> {
		try {
			const generation = ++this.generation, session = await this.storage.loadById(id);
			if (this.disposed || generation !== this.generation || !session) return;
			this.session = session; this.mode = 'deus';
			const file = this.plugin.app.vault.getAbstractFileByPath(session.characterPath);
			if (session.mode !== 'deus') {
				session.projectRoot ??= file instanceof TFile ? this.plugin.projectContext.getProjectForFile(file)?.rootFolder : this.deusProjectRoot;
				if (file instanceof TFile) session.participants ??= [{ path: file.path, name: getWikiDisplayName(this.plugin.app, this.plugin, file) }];
			}
			session.mode = 'deus'; this.deusProjectRoot = session.projectRoot;
			this.restoreSpeaker(session);
			this.history = false; this.rerender();
		} catch (error) { report(error); }
	}
	private async newSession(): Promise<void> {
		try {
			this.session = await this.storage.createNewSession('', '새 대화');
			this.mode = 'deus'; this.session.mode = 'deus';
			this.session.projectRoot = this.deusProjectRoot;
			this.history = false;
			this.rerender();
		} catch (error) { report(error); }
	}
	private renderContexts(parent: HTMLElement): void {
		const session = this.session;
		const skill = session && this.selectedSkills.get(session.id);
		const input = this.container?.querySelector<DeusComposerInput>('.deus-input');
		if (input) input.placeholder = skill ? 'Character · Enter로 현재 장면 실행 · 다른 상황을 적어도 됩니다.' : '작품에 관해 물어보세요. @ 참고 자료 · / 스킬';
		if (skill) {
			const pill = parent.createDiv({ cls: 'deus-context-chip deus-active-skill' });
			pill.createSpan({text: DEUS_SKILLS.find(item => item.id === skill)?.label ?? skill});
			this.icon(pill, 'x', '스킬 해제', () => { this.selectedSkills.delete(session.id); this.refreshContextPreview(); }).className = 'deus-context-chip-remove';
		}
		parent.classList.toggle('has-content', Boolean(parent.children.length));
	}
	private referenceChoices() {
		const session = this.session; if (!session) return [];
		const current = [...(this.referenceCatalog.get(session.id) ?? []), ...(this.contexts.get(session.id) ?? [])];
		const previous = [...session.messages].reverse().find(message => message.role === 'user' && message.context)?.context?.sources ?? [];
		const excluded = this.excludedContexts.get(session.id) ?? new Set<string>();
		const key = (source: ChatContextItem) => source.kind === 'plot' ? source.id : source.path ?? source.id;
		const catalog = new Map<string, ChatContextItem>();
		for (const source of [...current, ...previous]) if (!catalog.has(key(source))) catalog.set(key(source), source);
		return [...catalog.values()].map(source => ({ source, checked: current.some(item => key(item) === key(source)) && deusSourceAllowed(source, excluded) }));
	}
	private toggleReference(source: ChatContextItem, checked: boolean): void {
		const session = this.session; if (!session) return;
		const excluded = this.excludedContexts.get(session.id) ?? new Set<string>();
		const key = source.kind === 'plot' ? source.id : source.path ? `${source.kind === 'character' ? 'deus-cast:' : ['selection','document'].includes(source.kind ?? '') ? 'deus-active:' : 'deus-mentioned:'}${source.path}` : source.id;
		if (checked) {
			excluded.delete(source.id); excluded.delete(key);
			if (source.path) for (const prefix of ['deus-active:', 'deus-cast:', 'deus-mentioned:']) excluded.delete(prefix + source.path);
			if (!(this.referenceCatalog.get(session.id) ?? []).some(item => item.id === source.id)) {
				const selected = this.contexts.get(session.id) ?? []; if (!selected.some(item => item.id === source.id)) selected.push({ ...source, automatic: false }); this.contexts.set(session.id, selected);
			}
		} else { excluded.add(source.id); excluded.add(key); }
		this.excludedContexts.set(session.id, excluded); this.refreshContextPreview();
	}
	private renderMessages(forceBottom = false): void {
		const parent = this.messagesEl; if (!parent?.isConnected) return;
		const generation = ++this.messageGeneration, renders: Promise<void>[] = [];
		if (forceBottom) this.scrollFollow?.follow();
		const scrollTicket = this.scrollFollow?.beginRender();
		this.markdownComponent.unload(); this.markdownComponent.load();
		const bottom = this.scrollFollow?.following ?? forceBottom, top = parent.scrollTop;
		parent.empty(); const session = this.session;
		if (!session?.messages.length) parent.createDiv({ cls: 'deus-welcome', text: '작품 자료를 묻거나, 지금 장면의 대화·묘사·문장을 함께 만들어 보세요.' });
		for (const [index, message] of session?.messages.entries() ?? []) {
			const row = parent.createDiv({ cls: 'deus-message deus-message-' + message.role });
			const body = row.createDiv({ cls: 'deus-message-content' });
			if (message.role === 'assistant') {
				const question = session!.messages[index - 1];
				const ordinary = !message.skill && question?.skill !== 'character' && question?.role === 'user' && /행적|요약|정리|분석|관계|설정|자료|조사|목록/.test(question.content) && resolveDeusIntent(question.content, 'auto', []).skill === 'research';
				renders.push(this.renderDeusAnswer(body, ordinary ? { ...message, skill: 'research' } : message, question?.context?.sources ?? [], bottom, question?.context?.episodeRange));
				if (message.status === 'interrupted') body.createDiv({ cls: 'u-muted deus-interrupted', text: '응답 중단됨' });
			} else { body.addClass('deus-user-text'); renderDeusMentions(body, message.content); renderDeusNoteLinks(this.plugin.app, body, `${session?.projectRoot ?? ''}/__deus__.md`, this.hoverParent, report); }
			const actions = row.createDiv({ cls: message.role === 'assistant' ? 'deus-message-actions' : 'deus-user-msg-actions' });
			if (message.role === 'assistant') actions.createDiv({ cls: 'wm-chat-variants', attr: { 'data-response-index': String(index) } });
			this.icon(actions, 'copy', '복사', () => void navigator.clipboard.writeText(message.content).catch(report));
			this.icon(actions, 'git-branch', '여기서 새 대화로 분기', () => void this.branch(session!, index));
			if (message.role === 'assistant') this.icon(actions, 'refresh-cw', '새 분기에서 다시 응답', () => void this.regenerate(session!, index));
			else this.icon(actions, 'pencil', '메시지 수정 후 분기', () => new ChatTextModal(this.plugin, '메시지 수정 후 분기', message.content, async value => {
				if (!value.trim()) return; const fork = await this.storage.fork(session!, index - 1); this.session = fork;
				this.contexts.set(fork.id, message.context?.sources.filter(source => !source.automatic || source.kind === 'selection').map(source => ({ ...source })) ?? []);
				this.rerender(); await this.send(value, { ...message, id: messageId(), content: value, context: undefined });
			}).open());
			const context = message.role === 'user' ? message.context : undefined;
			if (context) this.icon(actions, 'files', '참고 자료', () => new ChatTextModal(this.plugin, '이 질문에 전송한 참고 자료', [
				...context.sources.map(source => `${source.automatic ? '[자동 참고] ' : '[직접 첨부] '}${contextSourceText(source)}`),
				context.warnings.length ? `확인 범위\n${context.warnings.join('\n')}` : '',
				context.searches?.length ? `자료 조회 기록\n${context.searches.map(search => `${search.name === 'episode_range_read' ? '권·회차 범위 읽기' : search.name === 'episode_read' ? '회차 본문 전체 읽기' : search.name === 'character_history' ? '인물 행적 조사' : search.name === 'search_sources' ? '검색' : search.name === 'read_source' ? '원문 읽기' : '관련 자료'}${search.query ? `: ${search.query}` : ''} · ${search.sourceIds.length}구간${search.warning ? `\n${search.warning}` : ''}`).join('\n')}` : '',
			].filter(Boolean).join('\n\n')).open()).addClass('wm-chat-evidence');
		}
		const state = session ? this.states.get(session.id) : null;
		if (state?.status === 'sending' || state?.status === 'streaming') {
			const pending = parent.createDiv({ cls: 'deus-pending deus-message-content' });
			if (this.mode === 'deus' && state.text) renders.push(this.renderDeusAnswer(pending, { role: 'assistant', skill: session?.messages.at(-1)?.skill, participants: session?.messages.at(-1)?.participants, content: state.text, timestamp: 0 }, session?.messages.at(-1)?.context?.sources ?? [], bottom, session?.messages.at(-1)?.context?.episodeRange));
			else pending.setText(state.text || (state.phase === 'searching' ? '프로젝트 자료 찾는 중…' : state.phase === 'reading' ? '관련 원문 읽는 중…' : '응답 대기 중…'));
		}
		if (state?.status === 'error' || state?.status === 'stopped') {
			const error = parent.createDiv({ cls: 'wm-chat-error', text: state.error ?? '응답을 받지 못했습니다.' });
			if (state.text) {
				if (this.mode === 'deus') void this.renderDeusAnswer(parent.createDiv({ cls: 'deus-message-content' }), { role: 'assistant', content: state.text, timestamp: 0 }, session?.messages.at(-1)?.context?.sources ?? [], bottom, session?.messages.at(-1)?.context?.episodeRange);
				else error.createDiv({ cls: 'wm-chat-unsaved-response', text: state.text });
			}
			const last = session!.messages[session!.messages.length - 1];
			if (last?.role === 'user') { const retry = error.createEl('button', { text: '재시도' }); retry.onclick = () => void this.send(last.content, last, true); }
		}
		parent.scrollTop = bottom ? parent.scrollHeight : top; this.updateComposer();
		void Promise.all(renders).then(() => { if (generation !== this.messageGeneration || !parent.isConnected) return; if (scrollTicket !== undefined) this.scrollFollow?.endRender(scrollTicket, top); });
		if (session && !this.requests.isSending(session.id)) void this.renderVariants(parent, session);
	}
	private async renderDeusAnswer(parent: HTMLElement, message: AiChatMessage, sources: ChatContextItem[], _bottom: boolean, range?: ChatEpisodeRangeCoverage): Promise<void> {
		const prepared = prepareDeusMarkdown(message, sources);
		if (range) parent.createDiv({ cls: 'wm-chat-source-coverage', text: `${range.volume !== undefined ? `${range.volume}권 · ` : ''}${range.from}~${range.to}화 · ${range.includedEpisodes}개 회차 ${range.partial ? '발췌 기반' : '본문 전체'}`,
			attr: { title: `원문 ${range.sourceCharacters.toLocaleString()}자 중 ${range.includedCharacters.toLocaleString()}자 제공` } });
		const content = parent.createDiv({ cls: 'deus-text-block markdown-rendered' });
		const component = this.markdownComponent.addChild(new Component());
		let active = true; component.register(() => { active = false; });
		try {
			const skill = message.skill;
			const participants = message.participants?.length ? message.participants : sources.filter(source => source.kind === 'character' && source.path).map(source => ({ path: source.path!, name: source.title }));
			const fallbackName = participants.length === 1 ? participants[0].name : undefined;
			const dialogue = skill === 'character' ? parseDeusDialogue(prepared.markdown, fallbackName, participants.map(person => person.name)) : [];
			if (dialogue.length) {
				content.addClass('deus-character-chat');
				let speaker: string | undefined, body: HTMLElement | undefined;
				for (const segment of dialogue) {
					if (!active || !parent.isConnected) return;
					if (!body || segment.name !== speaker) {
						speaker = segment.name;
						const turn = content.createDiv({ cls: 'deus-character-turn wm-chat-message is-assistant' });
						if (speaker) {
							const matches = participants.filter(person => person.name === speaker);
							const path = matches.length === 1 ? matches[0].path : sources.find(source => source.kind === 'character' && source.title === speaker)?.path;
							const file = path ? this.plugin.app.vault.getAbstractFileByPath(path) : null;
							const heading = turn.createDiv({ cls: 'wm-chat-message-heading' });
							if (file instanceof TFile) { this.applyCharacterColor(turn, file); this.avatar(heading, file); }
							heading.createSpan({ cls: 'wm-chat-message-name', text: speaker });
						}
						body = turn.createDiv({ cls: 'wm-chat-message-body' });
					}
					const text = body.createDiv({ cls: `wm-chat-segment is-${segment.type} deus-character-text` });
					text.style.fontSize = `${segment.type === 'narration' ? this.plugin.settings.aiChatNarrationFontSize : this.plugin.settings.aiChatDialogueFontSize}em`;
					await MarkdownRenderer.render(this.plugin.app, segment.type === 'dialogue' ? stripWrapping(segment.text) : segment.text, text, this.session?.projectRoot ?? '', component);
				}
			} else await MarkdownRenderer.render(this.plugin.app, prepared.markdown, content, this.session?.projectRoot ?? '', component);
			if (!active || !parent.isConnected || this.disposed) { component.unload(); return; }
			const linkOrigin = sources.find(source => ['document','selection'].includes(source.kind ?? '') && source.path)?.path ?? `${this.session?.projectRoot ? this.session.projectRoot + '/' : ''}__deus__.md`;
			renderDeusNoteLinks(this.plugin.app, content, linkOrigin, this.hoverParent, report);
			renderDeusCitationChips(this.plugin.app, content, parent, prepared.references, this.hoverParent, (source, quote) => this.openCitation(source, quote), report);
			this.scrollFollow?.changed();
		} catch (error) {
			if (!parent.isConnected) return;
			content.setText(prepared.markdown); content.addClass('is-render-fallback');
			console.error('[Writing Menu] Deus Markdown render failed', error);
		}
	}
	private async renderVariants(parent: HTMLElement, session: AiChatSession): Promise<void> {
		try {
			const entries = await this.storage.listSessions();
			if (!parent.isConnected || this.session !== session) return;
			for (const slot of parent.querySelectorAll<HTMLElement>('.wm-chat-variants')) {
				const index = Number(slot.dataset.responseIndex), user = session.messages[index - 1];
				if (user?.role !== 'user') continue;
				const root = session.parentId && session.forkMessageId === user.id ? session.parentId : session.id;
				const variants = entries.filter(entry => entry.count > index && (entry.id === root || entry.parentId === root && entry.forkMessageId === user.id));
				variants.sort((a, b) => Number(b.id === root) - Number(a.id === root) || a.updatedAt - b.updatedAt);
				const active = variants.findIndex(entry => entry.id === session.id);
				if (variants.length < 2 || active < 0) continue;
				slot.empty();
				this.icon(slot, 'chevron-left', '이전 응답 분기', () => void this.loadSession(variants[active - 1].id)).disabled = active === 0;
				slot.createSpan({ text: `${active + 1} / ${variants.length}` });
				this.icon(slot, 'chevron-right', '다음 응답 분기', () => void this.loadSession(variants[active + 1].id)).disabled = active === variants.length - 1;
			}
		} catch { /* History errors remain visible in the history manager; never rewrite its index here. */ }
	}

	private async openCitation(source: ChatContextItem, quote: string): Promise<void> {
		if (source.kind === 'plot') {
			const project = this.plugin.settings.projects.find(project => project.rootFolder === this.session?.projectRoot);
			const location = deusPlotLocation(source, project?.rootFolder, quote);
			if (project && location && await this.plugin.openPlotWorkbookCell(project.id, location.sheetId, location.rowId, undefined, this.plugin.settings.aiChatCitationOpenMode ?? 'current', location.columnRole)) return;
			new Notice('연결된 플롯 행을 찾을 수 없습니다. 답변 당시의 근거를 표시합니다.');
			new ChatTextModal(this.plugin, `${source.title} · 저장된 근거`, quote).open(); return;
		}
		const file = source.path ? this.plugin.app.vault.getAbstractFileByPath(source.path) : null;
		if (file instanceof TFile && this.plugin.projectContext.getProjectForFile(file)?.rootFolder !== this.session?.projectRoot) {
			new ChatTextModal(this.plugin, `${source.title} · 현재 프로젝트 밖으로 이동한 근거`, quote).open(); return;
		}
		if (!(file instanceof TFile)) { new ChatTextModal(this.plugin, `${source.title} · 저장된 근거`, quote).open(); return; }
		const content = getOpenWritingDocuments(this.plugin).find(document => document.path === file.path)?.read() ?? await this.plugin.app.vault.read(file);
		const range = locateChatQuote(source, quote, content);
		if (!range) {
			new Notice('원문이 변경되었거나 위치를 확인할 수 없습니다. 답변 당시의 근거를 표시합니다.');
			new ChatTextModal(this.plugin, source.title, quote).open(); return;
		}
		const workspace = this.plugin.app.workspace;
		const leaf = deusCitationLeaf(workspace, this.plugin.settings.aiChatCitationOpenMode);
		if (getWritingDocumentForView(leaf.view)?.path !== file.path) await leaf.openFile(file, { eState: { line: content.slice(0, range.from).split('\n').length - 1 } });
		await workspace.revealLeaf(leaf);
		const document = getWritingDocumentForView(leaf.view);
		if (document?.path === file.path && document.isCurrent(content)) document.select(content, range.from, range.to);
		else new Notice('원문이 열리는 동안 변경되었습니다. 잘못된 구간은 선택하지 않았습니다.');
	}
	private updateComposer(): void {
		this.container?.querySelector<HTMLElement>('.deus-session-name')?.setText(this.session?.title || '새 대화');
		const sending = this.session ? this.requests.isSending(this.session.id) : false;
		const speaker = this.container?.querySelector<HTMLButtonElement>('.wm-chat-speaker');
		if (speaker) speaker.disabled = sending;
		if (this.sendButton) { setIcon(this.sendButton, sending ? 'square' : 'arrow-up'); this.sendButton.setAttribute('aria-label', sending ? '응답 수신 중단' : '보내기'); }
		const model = effectiveChatModel(this.plugin.settings);
		const provider = cliChatProvider(model) ?? 'gemini', label = provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex' : 'Gemini';
		const icon = this.container?.querySelector<HTMLElement>('.deus-model-icon'); if (icon) renderDeusProviderIcon(icon, provider);
		if (this.statusEl) {
			this.statusEl.setText(label); this.statusEl.parentElement?.setAttribute('title', label);
		}
	}
	private async send(value: string, existing?: AiChatMessage, retry = false): Promise<void> {
		const session = this.session;
		if (!session) return;
		if (!value.trim() && this.selectedSkills.get(session.id) === 'character') value = '현재 참고 중인 장면을 바탕으로 인물 간 대화를 작성해 주세요.';
		if (!value.trim()) return;
		const command = parseDeusCommand(value);
		if (command) {
			this.selectedSkills.set(session.id, command.skill); value = command.question;
			if (!value) { this.drafts.set(session.id, ''); const input = this.container?.querySelector<DeusComposerInput>('.deus-input'); if (input) { input.value = ''; input.placeholder = 'Character · Enter로 현재 장면 실행 · 다른 상황을 적어도 됩니다.'; } this.refreshContextPreview(); return; }
		} else if (!existing && /^\//.test(value.trim())) { new Notice('지원하지 않는 스킬입니다. /를 입력해 명령을 선택하세요.'); return; }
		if (this.requests.isSending(session.id)) return;
		if (existing && command) { existing.content = value; existing.skill = command.skill; }
		const selectedSkill = this.selectedSkills.get(session.id);
		if (selectedSkill && !value.replace(/@\[\[[^\]\n]+\]\]/g, '').trim()) {
			const tasks = { character: '지정한 인물들의 성격과 관계에 맞는 짧은 대화 장면을 작성해 주세요.', description: '지정한 자료에 어울리는 장면 묘사를 작성해 주세요.', dialogue: '지정한 인물의 말투에 맞는 대사를 제안해 주세요.', rewrite: '지정한 본문의 문장을 다듬어 주세요.', research: '지정한 자료의 핵심 내용을 정리해 주세요.' };
			value += '\n' + tasks[selectedSkill];
		}
		const settings = this.plugin.settings;
		const cooldown = this.states.get(session.id); if (cooldown?.retryAt && cooldown.retryAt > Date.now()) { new Notice(cooldown.error ?? 'API 재시도 시간까지 기다려 주세요.'); return; }
		const options: ChatRequestOptions = { keys: { nvidia: settings.aiChatApiKey, gemini: settings.aiChatGeminiApiKey }, model: effectiveChatModel(settings), temperature: settings.aiChatTemperature, maxTokens: settings.aiChatMaxOutputTokens, historyTurns: settings.aiChatHistoryTurns, stream: settings.aiChatStreaming, freeOnly: settings.aiChatFreeOnly };
		if (!cliChatProvider(options.model)) options.thinkingLevel = resolveGeminiThinking(options.model, settings.aiChatGeminiThinking[options.model]);
		if (!hasApiKeyForModel(options.keys, options.model)) { new Notice('선택한 모델의 API 키를 설정해 주세요.'); return; }
		let prepared: Awaited<ReturnType<AiChatPanel['prepareDeusSources']>>;
		try { prepared = await this.prepareDeusSources(value, session); } catch (error) { report(error); return; }
		const { intent, source, project, open: openDocuments } = prepared;
		const contexts = existing?.context ? existing.context.sources.filter(item => !item.automatic || item.kind === 'selection' || item.kind === 'document' || item.id.startsWith('deus-cast:')).map(item => ({ ...item })) : prepared.attachments;
		if (session.mode === 'deus' && !project) { new Notice('검색할 프로젝트를 선택해 주세요.'); return; }
		const cli = cliChatProvider(options.model);
		if (cli) {
			try { options.cli = cliChatOptions(this.plugin, cli, project?.rootFolder); } catch (error) { report(error); return; }
		}
		try { requestedEpisodeScope(value); } catch (error) { report(error); return; }
		const episodeTarget = requestedEpisode(value);
		session.projectRoot ??= project?.rootFolder;
		if (project && (session.mode === 'deus' || settings.aiChatAutoContext)) options.ragTools = ragIndex(this.plugin).tools(project, session.mode === 'deus');
		const excluded = new Set(this.excludedContexts.get(session.id) ?? []);
		if (options.ragTools && excluded.size) {
			const tools = options.ragTools;
			options.ragTools = { ...tools, execute: async (call, signal) => { const result = await tools.execute(call, signal); const sources = result.sources.filter(source => deusSourceAllowed(source, excluded)); return { ...result, sources, warnings: sources.length === result.sources.length ? result.warnings : [...result.warnings, '사용자가 제외한 참고 자료는 검색 결과에서도 제외했습니다.'] }; } };
		}
		const message: AiChatMessage = existing ?? { id: messageId(), role: 'user', content: value.trim(), kind: 'dialogue', speakerRole: 'author', speakerName: '사용자', skill: intent.skill, participants: intent.participants, timestamp: Date.now() };
		if (!session.messages.length && ['새 대화', '데우스'].includes(session.title)) session.title = value.trim().replace(/@\[\[([^\]\n]+)\]\]/g, (_match, path: string) => path.split('/').pop()?.replace(/\.md$/i, '') ?? path).slice(0, 60);
		this.drafts.set(session.id, ''); const input = this.container?.querySelector<DeusComposerInput>('.deus-input'); if (input) input.value = '';
		this.refreshContextPreview();
		this.scrollFollow?.follow();
		await this.requests.send(session, message, async signal => {
			const prompt = `${deusSkillInstructions({ ...intent, skill: message.skill ?? intent.skill, participants: message.participants ?? intent.participants })}\n${DEUS_REPLY_STYLE}`;
			// Retry numbered-episode questions from the current manuscript instead of
			// reusing unrelated frozen snippets collected by older plugin versions.
			if (!message.context || episodeTarget !== undefined || session.mode === 'deus') message.context = await this.knowledge.collect({ character: null, speaker: null, project: project ?? null, document: source, openDocuments, attachments: contexts, message, history: session.messages.filter(turn => turn.id !== message.id), signal, requireComplete: true, inheritScene: false });
			if (excluded.size && message.context.sources.some(source => !deusSourceAllowed(source, excluded))) {
				message.context.sources = message.context.sources.filter(source => deusSourceAllowed(source, excluded));
				message.context.warnings.push('사용자가 제외한 참고 자료는 검색 결과에서도 제외했습니다.');
				if (message.context.research) message.context.research.partial = true;
			}
			const scope = message.context?.episodeRange
				? '요청한 권·회차 범위의 모든 본문에서 근거를 준비했습니다. 제공된 범위와 발췌 한도를 지키며 요청한 범위 자체를 요약하세요. 이전 질문의 인물 소개나 범위 밖 회차로 대체하지 마세요.'
				: message.context?.searches?.some(search => search.name === 'episode_read')
				? '요청한 회차 본문 전체를 직접 읽고 최신 원문과 대조했습니다. 해당 회차의 줄거리·내용 질문에는 이 원문으로 답하세요. 전체 프로젝트를 검색했다고 말하지 마세요.'
				: 'Obsidian API로 현재 프로젝트 자료를 확인했습니다. 실제 검색·조사 범위는 제공된 확인 범위를 따르며, 관련 발췌만으로 모든 사건을 읽었다고 말하지 마세요.';
			const citations = message.skill === 'character' ? DEUS_CITATIONS.slice(DEUS_CITATIONS.indexOf('요약·해설')) : DEUS_CITATIONS;
			const format = message.skill === 'character' ? '\n최종 답변은 설명이나 목록 대신 캐릭터 장면만 출력하세요. 매 대사 앞에 [인물: 실제 화자 이름], 행동 앞에 [지문]을 사용하세요. 대사를 글머리표로 쓰거나 이름을 생략하지 마세요.' : '';
			return session.mode === 'deus' ? `${prompt}\n${citations}\n${scope} ${message.context?.retrieval ? '로컬 검색 계획으로 근거를 준비했습니다. 제공한 근거로 충분하면 바로 답하고, 필요한 경우에만 추가 조회하세요. read_source·related_sources의 source_id에는 현재 질문의 C1, C2 같은 citation_id도 사용할 수 있습니다. 행적 조사의 확인 범위·미전송 구간·짧게 발췌된 구간을 답변에 밝히고, 플롯의 계획과 본문에 확정된 사건, 회차 서술 순서와 작중 시간순을 구분하세요.' : '먼저 search_sources로 질문의 핵심 인물명·행위·관계를 다른 표현으로 풀어 추가 검색하세요.'} 원문의 앞뒤가 부족하면 read_source 또는 related_sources로 확인하세요. 검색된 발췌를 읽은 것과 전체 원문을 모두 읽은 것은 구별하세요. 자료에 없는 행적을 채우지 마세요.${format}` : prompt;
		}, options, state => { this.states.set(session.id, state); if (this.session?.id === session.id && !this.disposed) {
			if ((state.quota || state.status === 'error') && !this.drafts.get(session.id)) { this.drafts.set(session.id, value); const draft = this.container?.querySelector<DeusComposerInput>('.deus-input'); if (draft) draft.value = value; }
			this.renderMessages();
		} }, retry);
		if (!this.disposed) { this.refreshSessionList(); if (this.session?.id === session.id) this.renderMessages(); }
	}
	private async branch(session: AiChatSession, through: number, parentId = session.id): Promise<AiChatSession | null> {
		try { this.session = await this.storage.fork(session, through, parentId); this.restoreSpeaker(this.session); this.contexts.set(this.session.id, (this.contexts.get(session.id) ?? []).map(item => ({ ...item }))); this.rerender(); return this.session; }
		catch (error) { report(error); return null; }
	}
	private async regenerate(session: AiChatSession, index: number): Promise<void> {
		if (this.requests.isSending(session.id)) return;
		try {
			const user = session.messages[index - 1];
			const parent = session.parentId && session.forkMessageId === user?.id ? session.parentId : session.id;
			const fork = await this.branch(session, index - 1, parent);
			const last = fork?.messages[fork.messages.length - 1]; if (last?.role === 'user') await this.send(last.content, last, true);
		} catch (error) { report(error); }
	}
	private async sessionMenu(id: string, event: MouseEvent): Promise<void> {
		try {
			const session = this.session?.id === id ? this.session : await this.storage.loadById(id);
			if (session && !this.disposed) this.menu(event, session, true);
		} catch (error) { report(error); }
	}
	private async sessionAction(id: string, action: 'rename' | 'pin' | 'export' | 'delete'): Promise<void> {
		try {
			const session = this.session?.id === id ? this.session : await this.storage.loadById(id);
			if (!session || this.disposed || action !== 'export' && this.requests.isSending(id)) return;
			if (action === 'rename') this.renameSession(session);
			else if (action === 'pin') { session.pinned = !session.pinned; await this.storage.save(session); this.refreshSessionList(); }
			else if (action === 'export') this.exportSession(session);
			else this.confirmDeleteSession(session);
		} catch (error) { report(error); }
	}
	private renameSession(session: AiChatSession): void {
		new AiChatRenameModal(this.plugin.app, session.title, title => { session.title = title; void this.storage.save(session).then(() => { this.refreshSessionList(); this.updateComposer(); }).catch(report); }).open();
	}
	private confirmDeleteSession(session: AiChatSession): void {
		const modal = new Modal(this.plugin.app); modal.setTitle('이 대화를 삭제할까요?'); modal.contentEl.createEl('p', { text: '저장된 대화는 보관 사본으로 남습니다.' });
		new Setting(modal.contentEl).addButton(button => button.setButtonText('삭제').setClass('mod-warning').onClick(async () => { try { await this.storage.deleteSession(session.id); for (const [key, parked] of this.parkedSessions) if (parked.id === session.id) this.parkedSessions.delete(key); modal.close(); if (this.session?.id === session.id) { this.session = null; await this.newSession(); } else this.refreshSessionList(); } catch (error) { report(error); } })); modal.open();
	}
	private menu(event: MouseEvent, session = this.session, sidebar = false): void {
		const menu = new Menu();
		menu.setUseNativeMenu?.(false);
		if (!sidebar && !this.container?.querySelector('.deus-container.is-wide')) {
			menu.addItem(item => {
				item.setTitle('프로젝트').setIcon('folder');
				const submenu = (item as typeof item & { setSubmenu?: () => Menu }).setSubmenu?.();
				if (submenu) { this.populateProjects(submenu); alignDeusSubmenu(menu, item, submenu); }
				else item.onClick(() => { const projects = new Menu(); this.populateProjects(projects); projects.showAtMouseEvent(event); });
			});
			menu.addSeparator();
		}
		if (session) {
			menu.addItem(item => item.setTitle('제목 수정').setIcon('pencil').setDisabled(this.requests.isSending(session.id)).onClick(() => this.renameSession(session)));
			menu.addItem(item => item.setTitle(session.pinned ? '고정 해제' : '대화 고정').setIcon('pin').setDisabled(this.requests.isSending(session.id)).onClick(async () => { try { session.pinned = !session.pinned; await this.storage.save(session); this.refreshSessionList(); } catch (error) { report(error); } }));
			menu.addItem(item => item.setTitle('Markdown 내보내기').setIcon('file-output').onClick(() => this.exportSession(session)));
			menu.addItem(item => item.setTitle('대화 삭제').setIcon('trash-2').setDisabled(this.requests.isSending(session.id)).onClick(() => this.confirmDeleteSession(session)));
		}
		if (!sidebar) { menu.addSeparator(); menu.addItem(item => item.setTitle('Deus AI 설정').setIcon('settings').onClick(() => {
			const setting = (this.plugin.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
			setting?.open(); setting?.openTabById(this.plugin.manifest.id); this.plugin.settingTab?.renderPage('ai');
		})); } menu.showAtMouseEvent(event);
	}
	private exportSession(session: AiChatSession): void {
		const content = `---\nwriting_menu_export: ai-chat\n---\n\n# ${session.title}\n\n${session.messages.map(message => `## ${message.role === 'assistant' ? '응답' : message.speakerName ?? '작가'}\n\n${message.content}`).join('\n\n')}`;
		const modal = new Modal(this.plugin.app); modal.setTitle('대화 Markdown 저장');
		let path = `${session.projectRoot ? session.projectRoot + '/' : ''}대화-${Date.now()}.md`;
		new Setting(modal.contentEl).setName('저장 파일').addText(text => text.setValue(path).onChange(value => path = value));
		new Setting(modal.contentEl).addButton(button => button.setButtonText('저장').setCta().onClick(async () => {
			try { const target = normalizePath(path.trim()); if (!target.endsWith('.md') || /^[\\/]|:/.test(target) || target.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('볼트 내부의 새 Markdown 파일 경로를 지정해 주세요.'); await this.plugin.app.vault.create(target, content); modal.close(); new Notice('대화를 저장했습니다.'); }
			catch (error) { report(error); }
		})); modal.open();
	}
}
