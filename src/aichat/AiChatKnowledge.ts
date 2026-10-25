import { wmT } from '../i18n/index';
import type { TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { WritingProject } from '../types';
import type { WritingDocument } from '../writing/WritingDocument';
import type { AiChatMessage, AiChatTurnContext, ChatContextItem, ChatResearchCoverage, ChatEpisodeRangeCoverage } from './AiChatTypes';
import { contextSourceText, researchEvidenceText } from './AiChatPrompt';
import { fitCharacterProfile, selectChatPassages, type ChatPassage } from './AiChatRetrieval';
import { checkChatAbort } from './ChatStream';
import { ragIndex } from './rag/RagIndexService';
import { isCharacterResearch } from './rag/RagResearch';
import { isRelationshipResearch } from './rag/RagRelationships';
import { isEpisodeOverview, requestedEpisode, requestedEpisodeScope } from './rag/RagEpisodes';

export interface ChatKnowledgeInput {
	character: TFile | null;
	speaker: TFile | null;
	project: WritingProject | null;
	document: WritingDocument | null;
	openDocuments: WritingDocument[];
	attachments: ChatContextItem[];
	message: AiChatMessage;
	history: AiChatMessage[];
	/** Optional explicit caller limit. Normal chat leaves input sizing to the API. */
	budget?: number;
	requireComplete?: boolean;
	inheritScene?: boolean;
	signal?: AbortSignal;
}

/** Per-panel, bounded local index. Never embeds remotely or stores an index in the vault. */
export class AiChatKnowledge {
	constructor(private plugin: WritingMenuPlugin) {}
	async collect(input: ChatKnowledgeInput): Promise<AiChatTurnContext> {
		const { project, character, speaker, message, signal } = input, warnings: string[] = [];
		const budget = input.budget ?? Infinity;
		let research: ChatResearchCoverage | undefined;
		let episodeRange: ChatEpisodeRangeCoverage | undefined;
		let episode: number | undefined;
		const targetScope = requestedEpisodeScope(message.content);
		const targetEpisode = requestedEpisode(message.content);
		const automatic = input.requireComplete || this.plugin.settings.aiChatAutoContext !== false;
		if (input.requireComplete && !project) throw new Error(wmT("데우스가 전체 검색할 프로젝트를 선택해 주세요."));
		const sources: ChatContextItem[] = input.attachments.map(source => ({ ...source, kind: source.kind ?? (source.id.endsWith('-true') ? 'selection' : source.id.endsWith('-false') ? 'document' : 'reference') }));
		// Carry the most recent scene into a follow-up even if old turns are removed for the request budget.
		const independentRelationship = input.requireComplete && isRelationshipResearch(message.content) && !/이 상황|그 장면|이 장면|선택문|여기서/.test(message.content);
		if (input.inheritScene !== false && automatic && !independentRelationship && !targetScope && targetEpisode === undefined && !sources.some(source => source.kind === 'selection' || source.kind === 'document')) {
			const previous = [...input.history].reverse().find(turn => turn.role === 'user' && turn.context?.sources.some(source => source.kind === 'selection' || source.kind === 'document'));
			for (const source of previous?.context?.sources.filter(source => source.kind === 'selection' || source.kind === 'document') ?? []) sources.push({ ...source });
		}
		const scene = sources.filter(source => source.kind === 'selection' || source.kind === 'document').map(source => source.text).join('\n\n');
		let remaining = budget - sources.reduce((sum, source) => sum + contextSourceText(source).length + 20, 0);
		if (remaining < 1000) throw new Error(wmT("선택문과 첨부 자료가 참고 문맥 범위를 넘었습니다. 범위를 늘리거나 첨부 자료를 줄여 주세요. 선택문은 임의로 자르지 않았습니다."));
		const open = new Map(input.openDocuments.map(document => [document.path, document]));
		const read = async (file: TFile) => {
			checkChatAbort(signal);
			return open.get(file.path)?.read() ?? await this.plugin.app.vault.read(file);
		};
		if (character) {
		const characterText = await read(character);
		const core = characterText;
		const coreLimit = Number.isFinite(budget) ? Math.min(12000, Math.floor(remaining * (speaker ? 0.38 : 0.5))) : Infinity;
		const persona = fitCharacterProfile(core, { id: `persona:${character.path}`, title: `대화할 인물: ${character.basename}`, text: '', path: character.path, kind: 'character', automatic: true }, message.content, scene, coreLimit);
		sources.push(persona); remaining -= contextSourceText(persona).length + 20;
		if (core.length > coreLimit) warnings.push(wmT("인물 설정이 길어 핵심 성격과 질문 관련 구간을 발췌했습니다."));
		if (!core.trim()) warnings.push(wmT("대화할 인물의 설정이 비어 있습니다. 성격·가치관을 확인한 것처럼 답하지 마세요."));
		}
		if (speaker) {
			const speakerText = await read(speaker);
			const speakerLimit = Number.isFinite(budget) ? Math.min(6000, Math.floor(remaining * 0.4)) : Infinity;
			const profile = fitCharacterProfile(speakerText, { id: `speaker:${speaker.path}`, title: `상대역: ${speaker.basename}`, text: '', path: speaker.path, kind: 'character', automatic: true }, message.content, scene, speakerLimit);
			sources.push(profile); remaining -= contextSourceText(profile).length + 20;
			if (speakerText.length > speakerLimit) warnings.push(wmT("상대역 설정은 질문 관련 구간을 발췌했습니다."));
		}
		if (automatic && project && remaining > 500) {
			const previousTurns = input.history.filter(turn => turn.role === 'user').slice(-2);
			const followsPrevious = /그럼|그 사람|그때|그녀|그는|그 인물|왜|이유|좀 더|계속|자세/.test(message.content);
			const antecedents = followsPrevious
				? previousTurns[previousTurns.length - 1]?.context?.sources.filter(source => source.kind !== 'selection' && source.kind !== 'document').map(source => `${source.title}\n${source.text.slice(0, 800)}`).join('\n') ?? '' : '';
			const previousQuestions = followsPrevious ? previousTurns.map(turn => turn.content).join('\n') + '\n' + antecedents : '';
			const passages: ChatPassage[] = [];
			const service = ragIndex(this.plugin);
			try {
				episode = targetEpisode;
				const previous = previousTurns[previousTurns.length - 1];
				const relationFollowup = /^(?:좀\s*더\s*자세히?|더\s*자세히?|자세히|좀\s*더|계속)[\s.!?。？！]*$/.test(message.content.trim()) && previous?.context?.research?.purpose === 'relationship';
				const relationshipQuestion = isRelationshipResearch(message.content) ? message.content : relationFollowup
					? `${previous.context!.research!.characters.map(entity => entity.name).join('과 ')}의 관계\n${message.content}` : '';
				const relationship = input.requireComplete && !targetScope && episode === undefined && relationshipQuestion
					? await service.relationship(project, relationshipQuestion, Math.max(0, remaining - 1000), signal, previous?.content ?? '') : undefined;
				if (targetScope) {
					const result = await service.episodeRange(project, targetScope, Math.max(0, remaining - 1000), signal);
					passages.push(...result.sources); warnings.push(...result.warnings); episodeRange = result.coverage;
				} else if (episode !== undefined) {
					const result = await service.episode(project, episode, Math.max(0, remaining - 600), signal);
					passages.push(...result.sources); warnings.push(...result.warnings);
				} else if (relationship) {
					passages.push(...relationship.sources); warnings.push(...relationship.warnings); research = relationship.coverage;
				} else if (input.requireComplete && isCharacterResearch(message.content)) {
					const result = await service.research(project, message.content, Math.max(0, remaining - 1000), signal, previousTurns[previousTurns.length - 1]?.content ?? '', speaker?.path);
					passages.push(...result.sources); warnings.push(...result.warnings); research = result.coverage;
				} else {
					const result = await service.search(project, `${message.content}\n${scene.slice(0, 6000)}\n${previousQuestions.slice(0, 2000)}`, signal, 10, message.content, input.requireComplete);
					passages.push(...(input.requireComplete ? await service.expand(project, result.sources, Math.max(0, remaining - 600), signal) : result.sources)); warnings.push(...result.warnings);
				}
			} catch (error) { checkChatAbort(signal); if (input.requireComplete) throw error; warnings.push(wmT("프로젝트 검색 실패: {0}", error instanceof Error ? error.message : String(error))); }
			const selected = input.requireComplete ? passages.map(({ group, boost, ...source }) => source) : selectChatPassages(passages, Math.max(0, remaining - 600));
			if (input.requireComplete && selected.reduce((sum, source, index) => sum + (research || episodeRange ? researchEvidenceText(source, sources.length + index).length : contextSourceText(source, true).length + 40) + 4, 0) > remaining - 600)
				throw new Error(wmT("찾은 근거가 참고 문맥 한도를 넘었습니다. 근거 일부를 몰래 제외하지 않고 중단했습니다. 참고 문맥 한도를 늘리거나 질문 범위를 나눠 주세요."));
			for (const source of selected) if (episodeRange || !sources.some(item => item.path === source.path && item.text.includes(source.text))) sources.push(source);
			if (!selected.length) warnings.push(wmT("질문에 맞는 추가 자료를 찾지 못했습니다. 기본 인물 설정과 이번 상황을 근거로 답하고, 없는 사실은 추측으로 확정하지 마세요."));
		} else if (input.requireComplete) throw new Error(wmT("전체 프로젝트 검색에 필요한 참고 문맥이 부족합니다. 참고 문맥 한도를 늘리거나 직접 첨부한 자료를 줄여 주세요. 검색 없이 답변하지 않았습니다."));
		else if (!project && automatic) warnings.push(wmT("연결된 프로젝트가 없어 다른 노트·플롯은 검색하지 않았습니다."));
		checkChatAbort(signal);
		return { version: 1, engine: 'obsidian', projectRoot: project?.rootFolder, sources, warnings: [...new Set(warnings)],
			...(input.requireComplete ? { retrieval: { version: 1 as const, strategy: episodeRange && isEpisodeOverview(message.content) ? 'episode-range' as const : episode !== undefined && isEpisodeOverview(message.content) ? 'episode' as const : research?.purpose === 'relationship' ? 'character-relationship' as const : research ? 'character-history' as const : 'focused' as const } } : {}), research, episodeRange,
			searches: [{ name: episodeRange ? 'episode_range_read' : episode !== undefined ? 'episode_read' : research?.purpose === 'relationship' ? 'character_relationship' : research ? 'character_history' : 'search_sources', query: message.content, sourceIds: sources.filter(source => source.automatic).map(source => source.id) }] };
	}
}
