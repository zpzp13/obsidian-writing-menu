import { setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { PlotProject, PlotCharacter, PlotScene } from './PlotTypes';
import { getAllScenes, newId } from './PlotTypes';
import { attachWikilinkAutocomplete, renderWithWikilinks } from './WikilinkHelper';

interface Layout2Callbacks {
	onSave(): void;
}

export class Layout2Canvas {
	private wrapper: HTMLElement;

	constructor(
		private container: HTMLElement,
		private project: PlotProject,
		private plugin: WritingMenuPlugin,
		private callbacks: Layout2Callbacks,
	) {
		this.wrapper = container.createDiv({ cls: 'wm-plot-canvas-wrapper' });
	}

	render() {
		this.wrapper.empty();
		const scenes = getAllScenes(this.project);

		const table = this.wrapper.createEl('table', { cls: 'wm-plot-table wm-plot-canvas-table wm-plot-grid-lines' });

		this.renderThead(table, scenes);
		this.renderTbody(table, scenes);
	}

	getTableEl(): HTMLElement {
		return this.wrapper;
	}

	private renderThead(table: HTMLTableElement, scenes: PlotScene[]) {
		const thead = table.createEl('thead');

		// Episode row
		const epRow = thead.createEl('tr');
		epRow.createEl('th', {
			cls: 'wm-plot-sticky-col wm-plot-corner-cell',
			attr: { rowspan: '3' },
			text: '인물',
		});
		for (const ep of this.project.episodes) {
			const chCount = ep.chapters.reduce((s, ch) => s + ch.scenes.length, 0) || 1;
			epRow.createEl('th', { attr: { colspan: String(chCount) }, text: ep.name, cls: 'wm-plot-ep-header' });
		}
		if (scenes.length === 0) epRow.createEl('th');

		// Chapter row
		const chRow = thead.createEl('tr');
		for (const ep of this.project.episodes) {
			for (const ch of ep.chapters) {
				const scCount = ch.scenes.length || 1;
				chRow.createEl('th', { attr: { colspan: String(scCount) }, text: ch.name, cls: 'wm-plot-ch-header' });
			}
		}
		if (scenes.length === 0) chRow.createEl('th');

		// Scene row
		const scRow = thead.createEl('tr');
		for (const sc of scenes) {
			scRow.createEl('th', { text: sc.name, cls: 'wm-plot-sc-header' });
		}
		if (scenes.length === 0) scRow.createEl('th', { text: '(장면 없음)' });
	}

	private renderTbody(table: HTMLTableElement, scenes: PlotScene[]) {
		const tbody = table.createEl('tbody');

		for (const char of this.project.characters) {
			const tr = tbody.createEl('tr', { cls: 'wm-plot-char-row', attr: { 'data-char-id': char.id } });

			// Label
			const labelTd = tr.createEl('td', { cls: 'wm-plot-sticky-col wm-plot-char-label' });
			if (char.color) labelTd.style.borderLeft = `3px solid ${char.color}`;
			const nameSpan = labelTd.createEl('span', { text: char.name, cls: 'wm-plot-char-name' });
			nameSpan.setAttribute('contenteditable', 'true');
			nameSpan.addEventListener('blur', () => {
				char.name = nameSpan.textContent?.trim() || char.name;
				this.callbacks.onSave();
			});
			const delBtn = labelTd.createEl('button', { cls: 'wm-plot-header-btn wm-plot-del-btn', attr: { title: '삭제' } });
			setIcon(delBtn, 'trash-2');
			delBtn.addEventListener('click', () => { this.deleteCharacter(char.id); });

			// Scene cells
			if (scenes.length === 0) {
				tr.createEl('td', { cls: 'wm-plot-cell wm-plot-char-cell' });
			} else {
				for (const sc of scenes) {
					this.renderCharCell(tr, char, sc);
				}
			}
		}
	}

	private renderCharCell(tr: HTMLTableRowElement, char: PlotCharacter, sc: PlotScene) {
		const key = `${char.id}__${sc.id}`;
		const cell = this.project.charCells[key];
		const td = tr.createEl('td', { cls: 'wm-plot-cell wm-plot-char-cell' });
		if (cell?.content) td.addClass('is-filled');

		const inner = td.createDiv({ cls: 'wm-plot-cell-inner' });

		if (cell?.content) {
			inner.setAttribute('draggable', 'true');
			const textDiv = inner.createDiv({ cls: 'wm-plot-cell-text' });
			renderWithWikilinks(textDiv, cell.content, this.plugin.app, () => this.plugin.settings.plotLinkOpenMode ?? 'tab');

			inner.addEventListener('dragstart', (e) => {
				e.dataTransfer!.setData('text/plain', key);
				e.dataTransfer!.effectAllowed = 'move';
			});
		}

		// Drop target
		td.addEventListener('dragover', (e) => { e.preventDefault(); td.addClass('wm-plot-drop-over'); });
		td.addEventListener('dragleave', () => td.removeClass('wm-plot-drop-over'));
		td.addEventListener('drop', (e) => {
			e.preventDefault();
			td.removeClass('wm-plot-drop-over');
			const srcKey = e.dataTransfer!.getData('text/plain');
			const dstKey = key;
			if (srcKey === dstKey) return;
			this.moveCharCell(srcKey, dstKey, char.id, sc.id);
		});

		// Click to edit (use closest to handle clicks on child text nodes)
		td.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).closest('[draggable]')) return;
			this.openCellEditor(td, char.id, sc.id);
		});
	}

	private moveCharCell(srcKey: string, dstKey: string, dstCharId: string, dstSceneId: string) {
		const src = this.project.charCells[srcKey];
		if (!src) return;
		const dst = this.project.charCells[dstKey];
		if (dst) {
			const [srcCharId, srcSceneId] = srcKey.split('__');
			this.project.charCells[srcKey] = { ...dst, charId: srcCharId, sceneId: srcSceneId };
		} else {
			delete this.project.charCells[srcKey];
		}
		this.project.charCells[dstKey] = { ...src, charId: dstCharId, sceneId: dstSceneId };
		this.callbacks.onSave();
		this.render();
	}

	private openCellEditor(td: HTMLElement, charId: string, sceneId: string) {
		td.empty();
		const key = `${charId}__${sceneId}`;
		const cell = this.project.charCells[key];

		const textarea = td.createEl('textarea', { cls: 'wm-plot-cell-editor' });
		textarea.value = cell?.content || '';

		const ac = attachWikilinkAutocomplete(textarea, this.plugin.app);
		textarea.focus();

		const save = () => {
			ac.dismiss();
			const val = textarea.value.trim();
			if (val) {
				this.project.charCells[key] = { charId, sceneId, content: val };
			} else {
				delete this.project.charCells[key];
			}
			this.callbacks.onSave();
			this.render();
		};

		textarea.addEventListener('blur', save);
		textarea.addEventListener('keydown', (e) => {
			if (ac.isOpen()) return;
			if (e.key === 'Escape') { e.preventDefault(); this.render(); }
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
		});
	}

	// ── Public mutations ────────────────────────────────────────────────────

	addCharacter() {
		const n = this.project.characters.length + 1;
		this.project.characters.push({ id: newId(), name: `인물 ${n}` });
		this.callbacks.onSave();
		this.render();
	}

	private deleteCharacter(charId: string) {
		this.project.characters = this.project.characters.filter(c => c.id !== charId);
		for (const key of Object.keys(this.project.charCells)) {
			if (key.startsWith(charId + '__')) delete this.project.charCells[key];
		}
		this.callbacks.onSave();
		this.render();
	}

	destroy() {
		this.wrapper.empty();
	}
}
