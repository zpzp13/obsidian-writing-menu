// Offline Obsidian adapter. Production export views and codecs are used unchanged.
export function installExportUiHost() {
    const make = (parent, tag, options = {}) => {
        if (typeof options === 'string') options = { cls: options };
        const el = document.createElement(tag);
        if (options.cls) el.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
        if (options.text !== undefined) el.textContent = options.text;
        for (const [key, value] of Object.entries(options.attr || {})) el.setAttribute(key, value);
        for (const key of ['type', 'value', 'placeholder']) if (options[key] !== undefined) el[key] = options[key];
        parent.append(el); return el;
    };
    Object.assign(HTMLElement.prototype, {
        createDiv(options) { return make(this, 'div', options); }, createSpan(options) { return make(this, 'span', options); },
        createEl(tag, options) { return make(this, tag, options); }, empty() { this.replaceChildren(); },
        setText(text) { this.textContent = text; }, appendText(text) { this.append(document.createTextNode(text)); },
        addClass(...names) { this.classList.add(...names); }, addClasses(names) { this.classList.add(...names); },
        removeClass(...names) { this.classList.remove(...names); }, hasClass(name) { return this.classList.contains(name); },
        toggleClass(name, value) { this.classList.toggle(name, value); },
    });
    class Component {
        callbacks = []; loaded = false;
        load() { if (!this.loaded) { this.loaded = true; this.onload?.(); } }
        unload() { if (this.loaded) { this.loaded = false; for (const callback of this.callbacks.splice(0)) callback(); } }
        register(callback) { this.callbacks.push(callback); }
        registerEvent() {}
        registerDomEvent(el, type, callback, options) { el.addEventListener(type, callback, options); this.register(() => el.removeEventListener(type, callback, options)); }
    }
    class Modal extends Component {
        constructor(app) {
            super(); this.app = app; this.containerEl = document.body.createDiv({ cls: 'modal-container' });
            this.modalEl = this.containerEl.createDiv({ cls: 'modal' });
            this.modalEl.createDiv({ cls: 'modal-close-button' }); this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
        }
        open() { this.load(); this.onOpen(); }
        close() { this.onClose(); this.unload(); this.containerEl.remove(); }
    }
    class TFile {
        constructor(path) {
            this.path = path; this.name = path.split('/').pop(); this.basename = this.name.replace(/\.[^.]+$/, '');
            this.extension = this.name.split('.').pop(); this.parent = { path: path.split('/').slice(0, -1).join('/') }; this.stat = { mtime: 1, size: 1 };
        }
    }
    class TFolder { constructor(path) { this.path = path; this.name = path.split('/').pop(); this.children = []; } }
    class ToggleComponent {
        constructor(parent) { this.toggleEl = parent.createDiv({ cls: 'checkbox-container' }); this.inputEl = this.toggleEl.createEl('input', { type: 'checkbox' }); }
        setValue(value) { this.inputEl.checked = value; this.toggleEl.toggleClass('is-enabled', value); return this; }
        setDisabled(value) { this.inputEl.disabled = value; return this; }
        onChange(callback) { this.inputEl.addEventListener('change', () => { this.setValue(this.inputEl.checked); callback(this.inputEl.checked); }); return this; }
    }
    class ColorComponent {
        constructor(parent) { this.inputEl = parent.createEl('input', { type: 'color' }); }
        setValue(value) { this.inputEl.value = value; return this; }
        setDisabled(value) { this.inputEl.disabled = value; return this; }
        onChange(callback) { this.inputEl.addEventListener('input', () => callback(this.inputEl.value)); return this; }
    }
    class ExtraButtonComponent {
        constructor(parent) { this.extraSettingsEl = parent.createEl('button', { type: 'button' }); }
        setIcon(icon) { this.extraSettingsEl.dataset.icon = icon; return this; }
        setDisabled(value) { this.extraSettingsEl.disabled = value; return this; }
        setTooltip(text) { this.extraSettingsEl.setAttribute('aria-label', text); return this; }
        onClick(callback) { this.extraSettingsEl.addEventListener('click', callback); return this; }
    }
    const output = new Map(), texts = new Map(), icons = new Map(), notices = [], definitions = new Map(), embeds = new Map();
    const files = ['Project/a.md', 'Project/part/b.md', 'Project/part/c.md', 'Elsewhere/z.md'].map(path => new TFile(path));
    const objects = new Map(files.map(file => [file.path, file]));
    files.forEach((file, index) => texts.set(file.path, '\n# ' + file.basename + '\n\n본문 ' + index + ' English 😀\t탭 & < >\n다음\n\n'));
    const host = window.__exportHost = {
        App: class {}, Component, Modal, TFile, TFolder, ToggleComponent, ColorComponent, ExtraButtonComponent,
        Platform: { isDesktop: true, isWin: false, isMacOS: true }, MarkdownView: class {}, PagedWritingView: class {},
        BasesView: class extends Component { constructor(controller) { super(); this.controller = controller; } },
        normalizePath: path => path.replace(/\\/g, '/'), parseYaml: JSON.parse, stringifyYaml: JSON.stringify, requireApiVersion: () => true,
        Notice: class { constructor(text) { notices.push(text); } }, addIcon: (name, svg) => icons.set(name, svg),
        setIcon: (el, name) => { el.innerHTML = '<svg viewBox="0 0 100 100">' + (icons.get(name) || '<path d="M20 20h60v60H20Z"/>') + '</svg>'; },
        pick: async () => null,
        fs: {
            existsSync: path => output.has(path), readFileSync: path => { if (!output.has(path)) throw Error('ENOENT'); return output.get(path); },
            realpathSync: path => path, mkdirSync: () => {}, writeFileSync: (path, bytes, options) => {
                if (host.denied) throw Error('EACCES: Permission denied');
                if (options?.flag === 'wx' && output.has(path)) throw Error('EEXIST'); output.set(path, bytes);
            },
        },
    };
    const refresh = embed => {
        const base = JSON.parse(texts.get(embed.path)), config = base.views[embed.index];
        const root = JSON.parse(base.filters.and.find(value => value.startsWith('file.inFolder('))?.slice(14, -1) || '""');
        const members = JSON.parse(base.formulas.wmExportIncluded.split('.contains')[0]);
        const selected = files.filter(file => !root || file.path.startsWith(root + '/')).filter(file => !config.filters || members.includes(file.path));
        const groups = new Map();
        for (const file of selected) { const key = config.groupBy ? file.parent.path : ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(file); }
        const view = definitions.get(config.type).factory({}, embed.table);
        view.config = { get: key => config[key], getOrder: () => config.order, getDisplayName: key => base.properties[key]?.displayName || key, getSort: () => config.sort };
        view.data = { groupedData: [...groups].map(([key, items]) => ({ hasKey: () => !!key, key: { toString: () => key }, entries: items.map(file => ({ file, getValue: key => ({ toString: () => key === 'file.folder' ? file.parent.path : file.basename }) })) })) };
        embed.view?.unload(); embed.view = view; view.load(); view.onDataUpdated();
    };
    host.MarkdownRenderer = { render: async (app, source, parent, sourcePath, owner) => {
        const path = source.slice(3, -2), base = JSON.parse(texts.get(path));
        const toolbar = parent.createDiv({ cls: 'bases-toolbar' }); const table = parent.createDiv({ cls: 'bases-view' });
        const embed = { path, table, index: 0 }; embeds.set(path, embed);
        base.views.forEach((view, index) => {
            const button = toolbar.createEl('button', { text: view.name, attr: { 'data-view': view.type } });
            button.addEventListener('click', () => { embed.index = index; refresh(embed); });
        });
        owner.register(() => { embed.view?.unload(); embeds.delete(path); }); refresh(embed);
    } };
    const app = {
        vault: {
            getMarkdownFiles: () => files, read: async file => texts.get(file.path), getAbstractFileByPath: path => objects.get(path), on: () => ({}),
            create: async (path, source) => { const file = new TFile(path); objects.set(path, file); texts.set(path, source); return file; },
            process: async (file, transform) => { const next = transform(texts.get(file.path)); texts.set(file.path, next); if (embeds.has(file.path)) refresh(embeds.get(file.path)); },
        }, fileManager: { trashFile: async file => { objects.delete(file.path); texts.delete(file.path); } },
        workspace: { getLeavesOfType: () => [] }, metadataCache: { getFirstLinkpathDest: () => null },
    };
    const plugin = {
        app, settings: { hwpTemplatePath: 'C:\\Windows\\old.hwpx', hwpExportPath: '', customFonts: [], pagedInlineFormats: {}, pagedTextColors: {}, pagedTextBackgrounds: {}, pagedParagraphAlignments: {} },
        saveSettings: async () => {}, registerBasesView: (type, definition) => { definitions.set(type, definition); return true; },
        projectContext: { getProjectForFile: () => ({ rootFolder: 'Project' }), getProjects: () => [{ rootFolder: 'Project', name: '원고 프로젝트' }] },
    };
    window.fixture = { host, files, texts, output, notices, TFolder, plugin, objects };
    document.body.classList.add('theme-light'); window.activeDocument = document;
}
