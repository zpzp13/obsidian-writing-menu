import { parseYaml } from 'obsidian';
import type { TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { extractHeadingSection } from './AiChatContext';

const CHAPTER_NAME_RE = /(\d+)\s*화/;

/** 활성 노트 파일명에서 회차 이름을 추출한다 ("6화", "제6화", "6화 - 제목" 등 지원). 못 찾으면 null. */
export function extractChapterName(activeFile: TFile | null): string | null {
	if (!activeFile) return null;
	const m = CHAPTER_NAME_RE.exec(activeFile.basename);
	return m ? `${m[1]}화` : null;
}

function chapterNumber(name: string): number | null {
	const m = CHAPTER_NAME_RE.exec(name);
	return m ? parseInt(m[1], 10) : null;
}

interface EpisodeFrontmatterChapter {
	name?: string;
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | null {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
	if (!match) return null;
	try {
		const data = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
		return { data, body: match[2] };
	} catch {
		return null;
	}
}

/** 활성 노트가 AI 기본 설정 루트 폴더 하위에 있으면 에피소드(플롯) 폴더 경로를 반환. 아니면 null. */
function getEpisodeDataFolder(plugin: WritingMenuPlugin, activeFile: TFile | null): string | null {
	const root = plugin.settings.aiEpisodeRootFolder?.trim();
	if (!root || !activeFile) return null;
	const rootPrefix = root.endsWith('/') ? root : `${root}/`;
	if (!activeFile.path.startsWith(rootPrefix)) return null;

	const dataSub = plugin.settings.aiEpisodeDataFolder?.trim() ?? '';
	return dataSub ? `${root}/${dataSub}` : root;
}

/** 에피소드 폴더 안의 모든 노트를 훑어, frontmatter에 등록된 (회차 이름 → 본문 섹션) 목록을 전부 모은다. */
async function collectAllChapters(plugin: WritingMenuPlugin, dataFolder: string): Promise<Array<{ num: number; name: string; text: string }>> {
	const prefix = dataFolder.endsWith('/') ? dataFolder : `${dataFolder}/`;
	const candidates = plugin.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(prefix));

	const chapters: Array<{ num: number; name: string; text: string }> = [];
	for (const file of candidates) {
		const raw = await plugin.app.vault.read(file);
		const parsed = parseFrontmatter(raw);
		if (!parsed) continue;

		const chs = Array.isArray(parsed.data.chapters) ? (parsed.data.chapters as EpisodeFrontmatterChapter[]) : [];
		for (const ch of chs) {
			if (!ch.name) continue;
			const num = chapterNumber(ch.name);
			if (num === null) continue;
			const section = extractHeadingSection(parsed.body, ch.name);
			if (section) chapters.push({ num, name: ch.name, text: section });
		}
	}
	return chapters;
}

/**
 * 활성 노트가 AI 기본 설정의 루트 폴더 하위에 있고, 파일명에서 회차를 인식할 수 있으면
 * 그 회차의 플롯 설계(에피소드 노트의 "## N화" 섹션)만 찾아 반환한다. 못 찾으면 null.
 */
export async function getEpisodePlotContext(plugin: WritingMenuPlugin, activeFile: TFile | null): Promise<string | null> {
	const dataFolder = getEpisodeDataFolder(plugin, activeFile);
	if (!dataFolder) return null;
	const chapterName = extractChapterName(activeFile);
	if (!chapterName) return null;

	const chapters = await collectAllChapters(plugin, dataFolder);
	const match = chapters.find(c => c.name === chapterName);
	return match ? match.text : null;
}

export interface PlotHistoryContext {
	/** 현재 회차보다 두 화 이상 이전까지의 플롯 (인물 관계·서사 흐름 파악용 배경 자료, 재서술 금지) */
	priorHistory: string;
	/** 바로 직전 화의 플롯 (## N-1화 섹션) — 이번 화 첫 씬이 직접 이어받을 수 있는 상황(현재 장소·인물 배치 등)이므로 배경과 분리해서 준다 */
	immediatePriorChapter: string;
	/** 이번 장면이 실제로 다뤄야 할, 현재 회차의 플롯 (## N화 섹션) */
	currentChapter: string;
}

/**
 * 회차 챗의 초안 패스용: 현재 회차의 플롯과, 그 이전까지의 배경 플롯을 분리해서 반환한다.
 * 배경(이전 화)과 실제로 이번에 써야 할 사건(현재 화)을 프롬프트에서 구분해야, 모델이 이번 화 플롯에서
 * 벗어나 엉뚱한 장면을 쓰는 걸 방지할 수 있다. 바로 직전 화는 다시 한번 별도로 분리하는데, 직전 화의
 * 마지막 장면(예: 술 마시다 지인이 먼저 뻗음) 상황이 이번 화 첫 씬으로 그대로 이어지는 경우가 많아서,
 * "재서술 금지"인 먼 배경과 "물리적 상황을 계속 이어받아야 하는" 직전 화를 같은 취급을 하면 안 되기 때문이다.
 */
export async function getFullPlotHistoryContext(plugin: WritingMenuPlugin, activeFile: TFile | null): Promise<PlotHistoryContext | null> {
	const dataFolder = getEpisodeDataFolder(plugin, activeFile);
	if (!dataFolder) return null;
	const chapterName = extractChapterName(activeFile);
	if (!chapterName) return null;
	const currentNum = chapterNumber(chapterName);
	if (currentNum === null) return null;

	const chapters = await collectAllChapters(plugin, dataFolder);
	const currentEntry = chapters.find(c => c.name === chapterName);
	if (!currentEntry) return null;

	const priorEntries = chapters.filter(c => c.num < currentNum).sort((a, b) => a.num - b.num);
	const immediateEntry = priorEntries.length > 0 ? priorEntries[priorEntries.length - 1] : null;
	const olderEntries = immediateEntry ? priorEntries.slice(0, -1) : [];

	return {
		priorHistory: olderEntries.map(c => `## ${c.name}\n\n${c.text}`).join('\n\n'),
		immediatePriorChapter: immediateEntry ? `## ${immediateEntry.name}\n\n${immediateEntry.text}` : '',
		currentChapter: `## ${currentEntry.name}\n\n${currentEntry.text}`,
	};
}

const PREVIOUS_CHAPTER_BODY_COUNT = 5;

/**
 * 직전 회차들의 실제 완성 본문(전체 줄거리 파악용 플롯 노트가 아니라, "본문" 폴더의 진짜 완성된 글)을 읽어온다.
 * 회차챗 초안이 직전 회차들과 문체가 이질감 없이 이어지도록 문체 참고용으로만 쓰인다. 최대 5화 전까지, 오래된
 * 순서로 이어붙여 반환한다. 1화이거나(직전 회차 없음), 본문 폴더 설정이 비어있거나, 본문 노트를 하나도
 * 못 찾으면 null을 반환한다.
 */
export async function getPreviousChapterBody(plugin: WritingMenuPlugin, activeFile: TFile | null): Promise<string | null> {
	const root = plugin.settings.aiEpisodeRootFolder?.trim();
	const bodySub = plugin.settings.aiEpisodeBodyFolder?.trim();
	if (!root || !bodySub || !activeFile) return null;
	const rootPrefix = root.endsWith('/') ? root : `${root}/`;
	if (!activeFile.path.startsWith(rootPrefix)) return null;

	const chapterName = extractChapterName(activeFile);
	if (!chapterName) return null;
	const currentNum = chapterNumber(chapterName);
	if (currentNum === null || currentNum <= 1) return null;

	const bodyFolder = `${root}/${bodySub}`;
	const prefix = bodyFolder.endsWith('/') ? bodyFolder : `${bodyFolder}/`;
	const candidates = plugin.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(prefix));

	const minNum = Math.max(1, currentNum - PREVIOUS_CHAPTER_BODY_COUNT);
	const chapters: Array<{ num: number; name: string; text: string }> = [];
	for (const f of candidates) {
		const num = chapterNumber(f.basename);
		if (num === null || num < minNum || num >= currentNum) continue;
		const content = (await plugin.app.vault.read(f)).trim();
		if (content) chapters.push({ num, name: f.basename, text: content });
	}
	if (chapters.length === 0) return null;

	chapters.sort((a, b) => a.num - b.num);
	return chapters.map(c => `## ${c.name}\n\n${c.text}`).join('\n\n');
}
