import { wmT } from '../i18n/index';
import { normalizePath, type Vault } from 'obsidian';
import type { WritingProject } from '../types';
import type { PlotWorkbookSnapshotData } from './PlotWorkbookTypes';
import { newPlotWorkbookId } from './PlotWorkbookTypes';
import { plotExportFileName, savePlotMarkdown } from './PlotWorkbookMarkdownExport';
import { packPlotSnapshotData, unpackPlotSnapshotData, type PackedSnapshotData } from './PlotWorkbookSnapshotPacking';

const SNAPSHOT_KIND = 'writing-menu-plot-snapshot';
const PACKED_ENCODING = 'plot-workbook-templates-v1';
export const MAX_PLOT_SNAPSHOT_BYTES = 25 * 1024 * 1024;

export interface PlotWorkbookSnapshot {
	kind: typeof SNAPSHOT_KIND;
	formatVersion: 1;
	id: string;
	createdAt: string;
	project: Pick<WritingProject, 'id' | 'name' | 'rootFolder' | 'manuscriptFolder' | 'characterFolder'>;
	data: PlotWorkbookSnapshotData;
}

function parseSafeJson(source: string): unknown {
	return JSON.parse(source, (key, value: unknown) => {
		if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(wmT("허용하지 않는 데이터 키가 있습니다."));
		return value;
	});
}

async function digest(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	const hash = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createPlotSnapshot(data: PlotWorkbookSnapshotData, project: WritingProject): PlotWorkbookSnapshot {
	return { kind: SNAPSHOT_KIND, formatVersion: 1, id: newPlotWorkbookId('snapshot'), createdAt: new Date().toISOString(),
		project: { id: project.id, name: project.name, rootFolder: project.rootFolder,
			manuscriptFolder: project.manuscriptFolder, characterFolder: project.characterFolder },
		data: JSON.parse(JSON.stringify(data)) as PlotWorkbookSnapshotData };
}

export async function plotSnapshotMarkdown(snapshot: PlotWorkbookSnapshot): Promise<string> {
	const packed = { ...snapshot, data: packPlotSnapshotData(snapshot.data) };
	const checksum = await digest({ encoding: PACKED_ENCODING, snapshot: packed });
	// Escape backticks so a cell containing a Markdown fence cannot terminate this block.
	const payload = JSON.stringify({ encoding: PACKED_ENCODING, snapshot: packed, checksum }, null, 2).replace(/`/g, '\\u0060');
	const line = (value: string) => value.replace(/[\r\n]/g, ' ');
	return ['---', 'writing_menu_snapshot: plot-workbook', 'snapshot_version: 1',
		`snapshot_title: ${JSON.stringify(snapshot.project.name)}`,
		`project_id: ${JSON.stringify(snapshot.project.id)}`, `project: ${JSON.stringify(snapshot.project.name)}`,
		`created: ${JSON.stringify(snapshot.createdAt)}`, '---', '', `# ${line(snapshot.project.name)} · 플롯 스냅샷`, '',
		`저장 시각: ${snapshot.createdAt}`, '',
		`시트 ${snapshot.data.manifest.sheets.length}개 · 휴지통 ${snapshot.data.manifest.deletedSheets?.length ?? 0}개 · 복선 ${snapshot.data.foreshadows.length}개`, '',
		...snapshot.data.manifest.sheets.map(ref => `- ${line(ref.name)}`), '',
		'이 파일은 수동으로 불러올 때만 적용됩니다. 아래 복원 데이터를 수정하면 무결성 검사에 실패할 수 있습니다.',
		'인물·본문 노트와 첨부파일 자체는 포함하지 않습니다. 해당 파일은 별도로 동기화해야 합니다.', '',
		'## 복원 데이터', '', '```json wm-plot-snapshot', payload, '```', ''].join('\n');
}

/** Rename display metadata only; the checksummed restoration payload remains byte-for-byte intact. */
export function renamePlotSnapshotMarkdown(markdown: string, title: string): string {
	const heading = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
	if (!heading || !/^writing_menu_snapshot: plot-workbook\r?$/m.test(heading)) throw new Error(wmT("플롯 스냅샷의 제목을 수정할 수 없습니다."));
	const name = title.trim();
	if (!name || name.length > 160 || /[\r\n]/.test(name)) throw new Error(wmT("제목은 한 줄로 160자 이내로 입력하세요."));
	const line = `snapshot_title: ${JSON.stringify(name)}`;
	const next = /^snapshot_title:.*$/m.test(heading) ? heading.replace(/^snapshot_title:.*$/m, line)
		: heading.replace(/\r?\n---(?:\r?\n|$)$/, `\n${line}\n---\n`);
	return next + markdown.slice(heading.length);
}

export async function readPlotSnapshot(markdown: string): Promise<PlotWorkbookSnapshot> {
	if (new TextEncoder().encode(markdown).length > MAX_PLOT_SNAPSHOT_BYTES) throw new Error(wmT("스냅샷 파일이 너무 큽니다. (최대 25MB)"));
	const blocks = [...markdown.matchAll(/^```json wm-plot-snapshot\r?\n([\s\S]*?)\r?\n```[ \t]*\r?$/gm)];
	if (blocks.length !== 1) throw new Error(wmT("복원용 플롯 스냅샷이 아닙니다. 일반 Markdown 내보내기 파일은 복원할 수 없습니다."));
	const envelope = parseSafeJson(blocks[0][1]) as { encoding?: string; snapshot: PlotWorkbookSnapshot; checksum: string };
	const snapshot = envelope?.snapshot;
	if (!snapshot || snapshot.kind !== SNAPSHOT_KIND || snapshot.formatVersion !== 1) throw new Error(wmT("지원하지 않는 스냅샷 형식입니다."));
	if (typeof snapshot.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(snapshot.id)
		|| typeof snapshot.createdAt !== 'string' || !Number.isFinite(Date.parse(snapshot.createdAt))
		|| !snapshot.project || ['id', 'name', 'rootFolder', 'manuscriptFolder', 'characterFolder'].some(key =>
			typeof snapshot.project[key as keyof typeof snapshot.project] !== 'string')) throw new Error(wmT("스냅샷의 프로젝트 정보가 올바르지 않습니다."));
	for (const path of [snapshot.project.rootFolder, snapshot.project.manuscriptFolder, snapshot.project.characterFolder]) {
		if (path && (/^[\\/]|^[a-z]:/i.test(path) || path.replace(/\\/g, '/').split('/').some(part => part === '..' || part === '.' || !part) || path.includes('\u0000'))) {
			throw new Error(wmT("스냅샷의 폴더 경로가 볼트 밖을 가리킵니다."));
		}
	}
	if (envelope.encoding !== undefined && envelope.encoding !== PACKED_ENCODING) throw new Error(wmT("지원하지 않는 스냅샷 저장 방식입니다."));
	const expected = await digest(envelope.encoding ? { encoding: envelope.encoding, snapshot } : snapshot);
	if (typeof envelope.checksum !== 'string' || envelope.checksum !== expected) throw new Error(wmT("스냅샷이 변경되었거나 손상되었습니다. 원본 파일을 다시 가져와주세요."));
	return envelope.encoding ? { ...snapshot, data: unpackPlotSnapshotData(snapshot.data as unknown as PackedSnapshotData) } : snapshot;
}

export function snapshotFileName(snapshot: PlotWorkbookSnapshot): string {
	return `${plotExportFileName(snapshot.project.name)}-${snapshot.createdAt.replace(/[:.]/g, '-')}-${snapshot.id}.md`;
}

export async function savePlotSnapshot(vault: Vault, folder: string, snapshot: PlotWorkbookSnapshot): Promise<string> {
	const normalized = normalizePath(folder.trim()).replace(/\/$/, '');
	if (!normalized || normalized.split('/').some(part => part.startsWith('.'))) throw new Error(wmT("동기화할 수 있도록 숨김 폴더가 아닌 일반 폴더를 선택해주세요."));
	const markdown = await plotSnapshotMarkdown(snapshot);
	if (new TextEncoder().encode(markdown).length > MAX_PLOT_SNAPSHOT_BYTES) throw new Error(wmT("스냅샷이 25MB를 초과하여 저장을 중단했습니다."));
	const path = await savePlotMarkdown(vault, `${normalized}/${snapshotFileName(snapshot)}`, markdown);
	const file = vault.getFileByPath(path);
	if (!file || await vault.read(file) !== markdown) throw new Error(wmT("스냅샷 저장 후 검증에 실패했습니다. 다시 저장해주세요."));
	return path;
}
