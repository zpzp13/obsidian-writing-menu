import type { TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';

/** 활성 노트가 AI 기본 설정의 루트 폴더 하위에 있으면, 그 작품의 등장인물 폴더 경로를 반환. 스코프를 잡을 수 없으면 null. */
export function getScopedCharacterFolder(plugin: WritingMenuPlugin, activeFile: TFile | null): string | null {
	const root = plugin.settings.aiEpisodeRootFolder?.trim();
	const charSub = plugin.settings.aiEpisodeCharFolder?.trim();
	if (!root || !charSub || !activeFile) return null;
	const rootPrefix = root.endsWith('/') ? root : `${root}/`;
	if (!activeFile.path.startsWith(rootPrefix)) return null;
	return `${root}/${charSub}`;
}

/** 인물/화자 선택 모달에 띄울 노트 후보 목록. 스코프를 잡을 수 있으면 그 작품의 등장인물 폴더로 한정하고, 아니면(또는 폴더가 비어있으면) 볼트 전체로 폴백한다. */
export function getCharacterCandidateFiles(plugin: WritingMenuPlugin, activeFile: TFile | null): TFile[] {
	const all = plugin.app.vault.getMarkdownFiles();
	const scopedFolder = getScopedCharacterFolder(plugin, activeFile);
	if (!scopedFolder) return all;

	const prefix = scopedFolder.endsWith('/') ? scopedFolder : `${scopedFolder}/`;
	const scoped = all.filter(f => f.path.startsWith(prefix));
	return scoped.length > 0 ? scoped : all;
}
