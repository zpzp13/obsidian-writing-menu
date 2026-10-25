import { wmT } from '../i18n/index';
import { hasControlCharacters, replaceControlCharacters } from '../utils/typeGuards';
import { Modal, Notice, normalizePath, type App, type Vault } from 'obsidian';
import { plotColumnTitle } from './PlotWorkbookColumnPresentation';
import type { PlotWorkbookSession } from './PlotWorkbookSession';
import type { PlotWorkbookForeshadowLocation, PlotWorkbookSheet } from './PlotWorkbookTypes';

const singleLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();
const noteLink = (path: string): string => {
	const name = path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
	return `[${name.replace(/[\\[\]]/g, '\\$&')}](<${path.split('/').map(encodeURIComponent).join('/')}>)`;
};

/** A readable export only; the snapshot and journal remain the source of truth. */
export function plotWorkbookMarkdown(session: PlotWorkbookSession, sheet = session.activeSheet): string {
	const labels = session.rowLabels(sheet);
	const locationLabels = new Map([[sheet.sheetId, labels]]);
	const describeLocation = (point: PlotWorkbookForeshadowLocation): string => {
		const target = session.sheets.get(point.sheetId);
		if (!target?.rows[point.rowId] || !target.columns[point.columnId]) return wmT("삭제된 위치");
		if (!locationLabels.has(target.sheetId)) locationLabels.set(target.sheetId, session.rowLabels(target));
		return singleLine(`${target.name} · ${plotColumnTitle(target, point.columnId)} · ${locationLabels.get(target.sheetId)!.get(point.rowId) ?? '—'}`);
	};
	const frontmatter = ['---', 'writing_menu_export: plot-sheet',
		`project: ${JSON.stringify(session.manifest.projectName)}`,
		`sheet: ${JSON.stringify(sheet.name)}`, `sheet_id: ${JSON.stringify(sheet.sheetId)}`, '---'].join('\n');
	const sections = [frontmatter, `# ${singleLine(sheet.name)}`];
	for (const rowId of sheet.rowOrder) {
		const fields: string[] = [];
		for (const columnId of sheet.columnOrder) {
			const column = sheet.columns[columnId];
			if (!column) continue;
			let value = session.getCell(sheet, rowId, columnId);
			if (column.role === 'cast') value = session.getAppearancePaths(sheet, rowId, columnId).map(noteLink).join(', ');
			else if (column.role === 'status' && value) value = session.statusName(value);
			else if (column.role === 'foreshadow') {
				value = session.foreshadowsInRow(sheet.sheetId, rowId).map(item => [
					`- [${item.status === 'resolved' ? 'x' : ' '}] ${singleLine(item.title)}`,
					...item.plantedAt.map(point => wmT("  - 등록: {0}", describeLocation(point))),
					...item.resolvedAt.map(point => wmT("  - 회수: {0}", describeLocation(point))),
					...(item.note?.trim() ? [wmT("  - 메모: {0}", item.note.trim().replace(/\n/g, '\n    '))] : []),
				].join('\n')).join('\n');
			}
			if (!value.trim()) continue;
			const title = column.role === 'character' && column.characterNotePath
				? column.title || column.characterNotePath.split('/').pop()?.replace(/\.md$/i, '') || wmT("인물")
				: plotColumnTitle(sheet, columnId);
			fields.push(`### ${singleLine(title)}\n\n${value}`);
		}
		if (!fields.length && !sheet.rows[rowId]?.linkedNotePath) continue;
		sections.push(`## ${labels.get(rowId) ?? '—'}`);
		if (sheet.rows[rowId]?.linkedNotePath) sections.push(wmT("본문: {0}", noteLink(sheet.rows[rowId].linkedNotePath)));
		sections.push(...fields);
	}
	return `${sections.join('\n\n')}\n`;
}

export function plotExportFileName(name: string): string {
	const clean = replaceControlCharacters(name, '_').replace(/[<>:"/\\|?*]/g, '_').replace(/[.\s]+$/g, '').trim() || wmT("플롯");
	return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `_${clean}` : clean;
}

/** Creates a new visible note without overwriting any existing export. */
export async function savePlotMarkdown(vault: Vault, requestedPath: string, markdown: string): Promise<string> {
	const raw = requestedPath.trim().replace(/\\/g, '/');
	const parts = raw.split('/');
	if (!raw || raw.startsWith('/') || parts.some(part => !part || part === '.' || part === '..'
		|| /[<>:"|?*]/.test(part) || hasControlCharacters(part) || /[.\s]$/.test(part)
		|| /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
		throw new Error(wmT("볼트 내부의 올바른 파일 경로를 입력하세요."));
	}
	let path = normalizePath(raw);
	if (!/\.md$/i.test(path)) path += '.md';
	const stem = path.slice(0, -3);
	for (let index = 2; await vault.adapter.exists(path); index++) path = `${stem} (${index}).md`;
	const folders = path.split('/').slice(0, -1);
	for (let index = 1; index <= folders.length; index++) {
		const folder = folders.slice(0, index).join('/');
		if (!await vault.adapter.exists(folder)) await vault.createFolder(folder);
	}
	await vault.create(path, markdown);
	return path;
}

export class PlotWorkbookMarkdownExportModal extends Modal {
	constructor(app: App, private readonly session: PlotWorkbookSession, private readonly projectRoot: string) { super(app); }

	onOpen(): void {
		this.setTitle(wmT("Markdown으로 내보내기"));
		const sheet: PlotWorkbookSheet = this.session.activeSheet;
		this.contentEl.createEl('p', { text: wmT("현재 시트 '{0}'를 Markdown 파일로 저장합니다. 원본 플롯 데이터는 변경하지 않습니다.", sheet.name) });
		const field = this.contentEl.createEl('label', { cls: 'wm-plotbook-export-path' });
		field.createSpan({ text: wmT("저장 경로 (볼트 내부)") });
		const input = field.createEl('input', { type: 'text', attr: { 'aria-label': wmT("Markdown 저장 경로"), spellcheck: 'false' } });
		input.value = normalizePath(wmT("{0}내보내기/{1}.md", this.projectRoot ? `${this.projectRoot}/` : '', plotExportFileName(sheet.name)));
		const error = this.contentEl.createDiv({ cls: 'wm-plotbook-export-error', attr: { role: 'alert' } });
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: wmT("취소"), attr: { type: 'button' } }).addEventListener('click', () => this.close());
		const save = actions.createEl('button', { text: wmT("내보내기"), cls: 'mod-cta', attr: { type: 'button' } });
		const submit = async () => {
			if (save.disabled) return;
			save.disabled = true;
			error.setText('');
			try {
				const path = await savePlotMarkdown(this.app.vault, input.value, plotWorkbookMarkdown(this.session, sheet));
				this.close();
				new Notice(wmT("Markdown으로 내보냈습니다: {0}", path));
			} catch (cause) {
				error.setText(cause instanceof Error ? cause.message : String(cause));
				save.disabled = false;
			}
		};
		save.addEventListener('click', () => { void submit(); });
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void submit(); }
		});
		input.focus();
	}

	onClose(): void { this.contentEl.empty(); }
}
