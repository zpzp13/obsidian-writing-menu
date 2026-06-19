import { App, FuzzySuggestModal, TFile, setIcon, MarkdownRenderer, MarkdownView } from 'obsidian';
import { IWritingMenuPlugin } from '../types';

// ─── Mobile Preview Floating Window ──────────────────────────────────────────

export class FilePickerModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;
	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder('파일 검색...');
	}
	getItems(): TFile[] { return this.app.vault.getMarkdownFiles(); }
	getItemText(file: TFile): string { return file.basename; }
	onChooseItem(file: TFile) { this.onChoose(file); }
}

export class MobilePreviewFloating {
	private plugin: IWritingMenuPlugin;
	private floatEl: HTMLElement | null = null;
	private refreshTimer: number | null = null;
	private contentEl: HTMLElement | null = null;
	private bottomNotchEl: HTMLElement | null = null;
	private minimizeBtnEl: HTMLElement | null = null;
	private titleEl: HTMLElement | null = null;
	private previewFile: TFile | null = null;
	private isMinimized = false;
	private isDragging = false;
	private dragOffsetX = 0;
	private dragOffsetY = 0;
	private posX = 0;
	private posY = 0;
	private cleanupFns: (() => void)[] = [];

	constructor(plugin: IWritingMenuPlugin) {
		this.plugin = plugin;
	}

	isOpen(): boolean {
		return !!this.floatEl && activeDocument.body.contains(this.floatEl);
	}

	open() {
		if (this.isOpen()) return;

		const el = activeDocument.createElement('div') as HTMLElement;
		el.className = 'wm-float-preview';
		this.posX = Math.max(20, window.innerWidth - 340);
		this.posY = 40;
		el.setCssStyles({ left: `${this.posX}px` });
		el.setCssStyles({ top: `${this.posY}px` });

		// ── Top notch (44px) — hover reveals: [minimize | title | close] ──
		const topNotch = el.createDiv('wm-float-top-notch');
		const topMenu = topNotch.createDiv('wm-float-top-menu');

		const leftCol = topMenu.createDiv('wm-float-notch-col wm-float-notch-left');
		const minimizeBtn = leftCol.createDiv('wm-float-notch-btn clickable-icon');
		setIcon(minimizeBtn, 'minus');
		this.minimizeBtnEl = minimizeBtn;
		minimizeBtn.onclick = (e) => { e.stopPropagation(); this.toggleMinimize(); };

		const centerCol = topMenu.createDiv('wm-float-notch-col wm-float-notch-center');
		const titleSpan = centerCol.createEl('span', { text: '파일 없음', cls: 'wm-float-note-title' });
		this.titleEl = titleSpan;
		centerCol.onclick = (e) => {
			e.stopPropagation();
			new FilePickerModal(this.plugin.app, (file) => {
				this.previewFile = file;
				void this.renderContent();
			}).open();
		};
		centerCol.addClass('wm-clickable');

		const rightCol = topMenu.createDiv('wm-float-notch-col wm-float-notch-right');
		const closeBtn = rightCol.createDiv('wm-float-notch-btn clickable-icon');
		setIcon(closeBtn, 'x');
		closeBtn.onclick = () => this.close();

		// ── Content area ──
		const contentEl = el.createDiv('wm-float-content');
		this.contentEl = contentEl;

		// ── Bottom notch (44px) — hover reveals: [prev | settings | next] ──
		const bottomNotch = el.createDiv('wm-float-bottom-notch');
		this.bottomNotchEl = bottomNotch;
		const bottomMenu = bottomNotch.createDiv('wm-float-bottom-menu');

		const prevCol = bottomMenu.createDiv('wm-float-notch-col');
		const prevBtn = prevCol.createDiv('wm-float-notch-btn clickable-icon');
		setIcon(prevBtn, 'chevron-left');
		prevBtn.onclick = (e) => { e.stopPropagation(); this.navigateNote(-1); };

		const settingsCol = bottomMenu.createDiv('wm-float-notch-col');
		const settingsBtn = settingsCol.createDiv('wm-float-notch-btn clickable-icon');
		setIcon(settingsBtn, 'settings');
		settingsBtn.onclick = (e) => { e.stopPropagation(); this.showPreviewSettings(settingsBtn); };

		const nextCol = bottomMenu.createDiv('wm-float-notch-col');
		const nextBtn = nextCol.createDiv('wm-float-notch-btn clickable-icon');
		setIcon(nextBtn, 'chevron-right');
		nextBtn.onclick = (e) => { e.stopPropagation(); this.navigateNote(1); };

		activeDocument.body.appendChild(el);
		this.floatEl = el;

		// Drag from anywhere — threshold-based to preserve button clicks
		let dragStartX = 0, dragStartY = 0, hasDragged = false;
		const DRAG_THRESHOLD = 5;

		const onDown = (e: MouseEvent) => {
			this.isDragging = true;
			hasDragged = false;
			dragStartX = e.clientX;
			dragStartY = e.clientY;
			this.dragOffsetX = e.clientX - this.posX;
			this.dragOffsetY = e.clientY - this.posY;
		};
		const onMove = (e: MouseEvent) => {
			if (!this.isDragging) return;
			if (!hasDragged && Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > DRAG_THRESHOLD) {
				hasDragged = true;
			}
			if (hasDragged) {
				this.posX = e.clientX - this.dragOffsetX;
				this.posY = e.clientY - this.dragOffsetY;
				el.setCssStyles({ left: `${this.posX}px` });
				el.setCssStyles({ top: `${this.posY}px` });
			}
		};
		const onUp = () => { this.isDragging = false; };
		// Capture-phase click suppressor: if user dragged, cancel the resulting click
		const onClickCapture = (e: MouseEvent) => { if (hasDragged) { e.stopPropagation(); hasDragged = false; } };

		el.addEventListener('mousedown', onDown);
		el.addEventListener('click', onClickCapture, true);
		activeDocument.addEventListener('mousemove', onMove);
		activeDocument.addEventListener('mouseup', onUp);
		this.cleanupFns.push(
			() => el.removeEventListener('mousedown', onDown),
			() => el.removeEventListener('click', onClickCapture, true),
			() => activeDocument.removeEventListener('mousemove', onMove),
			() => activeDocument.removeEventListener('mouseup', onUp),
		);

		// Keyboard nav: arrow keys while hovering the preview window
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'ArrowLeft') { e.preventDefault(); this.navigateNote(-1); }
			else if (e.key === 'ArrowRight') { e.preventDefault(); this.navigateNote(1); }
		};
		const onMouseEnter = () => activeDocument.addEventListener('keydown', onKeyDown);
		const onMouseLeave = () => activeDocument.removeEventListener('keydown', onKeyDown);
		el.addEventListener('mouseenter', onMouseEnter);
		el.addEventListener('mouseleave', onMouseLeave);
		this.cleanupFns.push(
			() => el.removeEventListener('mouseenter', onMouseEnter),
			() => el.removeEventListener('mouseleave', onMouseLeave),
			() => activeDocument.removeEventListener('keydown', onKeyDown),
		);

		void this.renderContent();
	}

	private toggleMinimize() {
		this.isMinimized = !this.isMinimized;
		if (!this.floatEl) return;
		this.floatEl.toggleClass('is-minimized', this.isMinimized);
		if (this.minimizeBtnEl) setIcon(this.minimizeBtnEl, this.isMinimized ? 'maximize-2' : 'minus');
	}

	private getSiblingFiles(): TFile[] {
		const file = this.previewFile ?? this.plugin.app.workspace.getActiveFile();
		if (!file) return [];
		const folder = file.parent;
		if (!folder) return [];
		return folder.children
			.filter((f): f is TFile => f instanceof TFile && f.extension === 'md')
			.sort((a, b) => a.basename.localeCompare(b.basename, 'ko'));
	}

	private navigateNote(direction: 1 | -1) {
		const siblings = this.getSiblingFiles();
		if (siblings.length === 0) return;
		const current = this.previewFile ?? this.plugin.app.workspace.getActiveFile();
		if (!current) { this.previewFile = siblings[0]; void this.renderContent(); return; }
		const idx = siblings.findIndex(f => f.path === current.path);
		const nextIdx = idx === -1 ? 0 : idx + direction;
		if (nextIdx < 0 || nextIdx >= siblings.length) return;
		this.previewFile = siblings[nextIdx];
		void this.renderContent();
	}

	private showPreviewSettings(anchor: HTMLElement) {
		const existing = activeDocument.querySelector('.wm-preview-dropdown');
		if (existing) { existing.remove(); return; }

		const dropdown = activeDocument.createElement('div') as HTMLElement;
		dropdown.className = 'wm-preview-dropdown writing-menu-dropdown';
		dropdown.addClass('wm-measure-offscreen');
		activeDocument.body.appendChild(dropdown);

		this.buildPreviewSettingsMenu(dropdown);

		// Position above anchor
		const anchorRect = anchor.getBoundingClientRect();
		const ddRect = dropdown.getBoundingClientRect();
		let top = anchorRect.top - ddRect.height - 6;
		let left = anchorRect.left + anchorRect.width / 2 - ddRect.width / 2;
		top = Math.max(8, top);
		left = Math.max(8, Math.min(window.innerWidth - ddRect.width - 8, left));
		dropdown.removeClass('wm-measure-offscreen');
		dropdown.setCssProps({ '--dd-top': `${top}px`, '--dd-left': `${left}px` });

		const closeDropdown = (e: MouseEvent) => {
			if (!dropdown.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
				dropdown.remove();
				activeDocument.removeEventListener('click', closeDropdown);
			}
		};
		window.setTimeout(() => activeDocument.addEventListener('click', closeDropdown), 10);
	}

	private buildPreviewSettingsMenu(container: HTMLElement) {
		const pt = this.plugin.settings.previewTypography;
		const save = async () => { await this.plugin.saveSettings(); this.renderContent(); };

		// Font family — same row style as main dropdown
		const fontDiv = container.createDiv('writing-menu-control');
		const fontLG = fontDiv.createDiv('writing-menu-control-label-group');
		const hanIcon = fontLG.createSpan('writing-menu-icon');
		hanIcon.setText('한');
		hanIcon.addClass('wm-han-icon-text');
		fontLG.createEl('label', { text: '글꼴' });
		const fontInput = fontDiv.createEl('input', { type: 'text', value: pt.fontFamily });
		fontInput.addClass('wm-preview-text-input');
		fontInput.onchange = (e) => { pt.fontFamily = (e.target as HTMLInputElement).value; void save(); };

		void this.plugin.addCompactStepper(container, '글자 크기', pt.fontSize, 1, 1, async (v) => { pt.fontSize = v; await save(); }, 'type');
		void this.plugin.addCompactStepper(container, '줄간격', pt.lineHeight, 0.1, 0, async (v) => { pt.lineHeight = v; await save(); }, 'align-justify');
		void this.plugin.addCompactStepper(container, '문단간격', pt.paragraphSpacing, 0.5, 0, async (v) => { pt.paragraphSpacing = v; await save(); }, 'pilcrow');
		void this.plugin.addCompactStepper(container, '들여쓰기', pt.indentation, 5, 0, async (v) => { pt.indentation = v; await save(); }, 'indent');

		this.plugin.addSeparator(container);

		this.buildSingleColorRow(container, '글자색', 'palette', pt.textColor, async (v) => { pt.textColor = v; await save(); });
		this.buildSingleColorRow(container, '배경색', 'droplet', pt.bgColor, async (v) => { pt.bgColor = v; await save(); });
	}

	private buildSingleColorRow(container: HTMLElement, label: string, icon: string, value: string, onChange: (v: string) => void | Promise<void>) {
		const div = container.createDiv('writing-menu-control');
		const lg = div.createDiv('writing-menu-control-label-group');
		const iconSpan = lg.createSpan('writing-menu-icon');
		setIcon(iconSpan, icon);
		lg.createEl('label', { text: label });
		const input = div.createEl('input', { type: 'color' });
		const hex = value.startsWith('#') ? value : '#000000';
		input.value = hex;
		input.addClass('wm-compact-color-input');
		input.onchange = (e) => { void onChange((e.target as HTMLInputElement).value); };
	}

	scheduleRefresh(delay = 400) {
		if (this.refreshTimer) window.window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.window.setTimeout(() => { void this.renderContent(); }, delay);
	}

	async renderContent() {
		const el = this.contentEl;
		if (!el) return;
		el.empty();

		const pt = this.plugin.settings.previewTypography;
		el.setCssStyles({ fontFamily: pt.fontFamily === 'inherit' ? 'var(--font-text)' : pt.fontFamily });
		el.setCssStyles({ fontSize: `${pt.fontSize}px` });
		el.setCssStyles({ lineHeight: String(pt.lineHeight) });
		el.setCssStyles({ color: pt.textColor });
		el.setCssStyles({ backgroundColor: pt.bgColor });
		el.setCssProps({ '--wm-preview-indent': pt.indentation > 0 ? `${pt.indentation}px` : '0', '--wm-preview-para': `${pt.paragraphSpacing}em` });

		const file = this.previewFile ?? this.plugin.app.workspace.getActiveFile();
		if (this.titleEl) {
			const name = file ? file.basename : '파일 없음';
			this.titleEl.textContent = name.length > 16 ? name.slice(0, 16) + '…' : name;
		}

		if (!file) {
			el.createEl('p', { text: '편집 중인 파일이 없습니다.', cls: 'wm-preview-empty' });
			return;
		}

		const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const content = (!this.previewFile && activeView?.file === file)
			? activeView.editor.getValue()
			: await this.plugin.app.vault.read(file);

		await MarkdownRenderer.render(this.plugin.app, content, el, file.path, this.plugin);

		// Double-click: jump to source line in editor
		el.addEventListener('dblclick', (e) => { void (async () => {
			const target = e.target as HTMLElement;
			const block = target.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote');
			if (!block) return;
			const text = block.textContent?.trim() ?? '';
			if (text.length < 3) return;

			const targetFile = this.previewFile ?? this.plugin.app.workspace.getActiveFile();
			if (!targetFile) return;

			const source = await this.plugin.app.vault.read(targetFile);
			const lines = source.split('\n');
			const needle = text.replace(/\s+/g, ' ').trim();

			const stripMd = (line: string) => line
				.replace(/^#{1,6}\s+/, '')
				.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
				.replace(/`[^`]+`/g, '')
				.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
				.replace(/\s+/g, ' ')
				.trim();

			// Find the preceding heading sibling in rendered HTML → narrow search scope
			let startLine = 0;
			let prevEl: Element | null = block.previousElementSibling;
			while (prevEl) {
				if (/^H[1-6]$/.test(prevEl.tagName)) break;
				prevEl = prevEl.previousElementSibling;
			}
			if (prevEl) {
				const headingText = prevEl.textContent?.replace(/\s+/g, ' ').trim() ?? '';
				for (let i = 0; i < lines.length; i++) {
					if (/^#{1,6}\s/.test(lines[i]) && stripMd(lines[i]) === headingText) {
						startLine = i; break;
					}
				}
			}

			let matchLine = -1;

			// Pass 1: near-exact full match (single-line para / heading), search from section start
			for (let i = startLine; i < lines.length; i++) {
				const stripped = stripMd(lines[i]);
				if (!stripped) continue;
				const cmp = Math.min(stripped.length, needle.length);
				if (cmp < 4) continue;
				if (stripped.slice(0, cmp) === needle.slice(0, cmp)) {
					if (cmp / Math.max(stripped.length, needle.length) >= 0.8) {
						matchLine = i; break;
					}
				}
				// Stop at next heading if we've already passed the section start
				if (i > startLine && /^#{1,6}\s/.test(lines[i]) && prevEl) break;
			}

			// Pass 2: first line of a multi-line paragraph, within section
			if (matchLine === -1) {
				for (let i = startLine; i < lines.length; i++) {
					if (/^#{1,6}\s/.test(lines[i])) {
						if (i > startLine) break; // left the section
						continue;
					}
					const stripped = stripMd(lines[i]);
					if (!stripped || stripped.length < 6) continue;
					const cmp = Math.min(stripped.length, needle.length);
					if (cmp < 6) continue;
					if (needle.slice(0, cmp) === stripped.slice(0, cmp)) {
						if (cmp / stripped.length >= 0.85) { matchLine = i; break; }
					}
				}
			}
			if (matchLine === -1) return;

			// Highlight block in preview
			block.addClass('wm-preview-highlight');
			window.setTimeout(() => block.removeClass('wm-preview-highlight'), 1800);

			const leaf = this.plugin.app.workspace.getMostRecentLeaf();
			if (!leaf) return;
			await leaf.openFile(targetFile);

			const jumpToLine = () => {
				const view = leaf.view;
				if (!(view instanceof MarkdownView) || !view.editor) return;
				// Find paragraph end (next empty line)
				let endLine = matchLine;
				while (endLine + 1 < lines.length && lines[endLine + 1].trim() !== '') endLine++;
				view.editor.setSelection(
					{ line: matchLine, ch: 0 },
					{ line: endLine, ch: lines[endLine].length }
				);
				view.editor.scrollIntoView({ from: { line: matchLine, ch: 0 }, to: { line: endLine, ch: 0 } }, true);
				view.editor.focus();
			};
			jumpToLine();
			window.setTimeout(jumpToLine, 80);
		})(); });
	}

	close() {
		if (this.refreshTimer) window.window.clearTimeout(this.refreshTimer);
		this.cleanupFns.forEach(fn => fn());
		this.cleanupFns = [];
		activeDocument.querySelector('.wm-preview-dropdown')?.remove();
		this.floatEl?.remove();
		this.floatEl = null;
		this.contentEl = null;
		this.titleEl = null;
	}
}
