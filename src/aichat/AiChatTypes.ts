export interface AiChatSegment {
	type: 'narration' | 'dialogue';
	text: string;
}

export type DeusSkill = 'research' | 'character' | 'description' | 'dialogue' | 'rewrite';
export interface DeusParticipant { path: string; name: string }

export interface AiChatMessage {
	id?: string;
	role: 'user' | 'assistant';
	skill?: DeusSkill;
	participants?: DeusParticipant[];
	/** user: 실제 입력한 대사/지문. assistant: 모델의 원본 응답(히스토리 재전송용) */
	content: string;
	/** role === 'user'일 때, 이 턴에서 사용자가 연기한 상대역(B) 노트 경로/표시 이름 */
	speakerPath?: string;
	speakerName?: string;
	speakerRole?: 'author' | 'character';
	/** role === 'user'일 때, 대사인지 지문인지 구분 (기본 dialogue) */
	kind?: 'dialogue' | 'narration';
	/** role === 'assistant'일 때, [지문]/[대사]를 순서대로 파싱한 렌더링용 세그먼트 (여러 개 가능) */
	segments?: AiChatSegment[];
	status?: 'complete' | 'interrupted';
	/** reference links bind a supplied source without claiming a verbatim quote. */
	citations?: Array<{ number: number; sourceId: string; quote: string; kind?: 'reference' }>;
	/** Frozen evidence for this turn. Never promote hypothetical replies into project facts. */
	context?: AiChatTurnContext;
	usage?: Array<{ promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number }>;
	timestamp: number;
}

export interface ChatContextItem {
	id: string;
	title: string;
	text: string;
	path?: string;
	kind?: 'selection' | 'document' | 'plot' | 'character' | 'reference';
	location?: string;
	automatic?: boolean;
	contentHash?: string;
	from?: number;
	to?: number;
}

export interface AiChatTurnContext {
	version: 1;
	projectRoot?: string;
	sources: ChatContextItem[];
	warnings: string[];
	engine?: 'local-hybrid' | 'obsidian';
	searches?: Array<{ name: string; query?: string; sourceIds: string[]; warning?: string }>;
	/** Locally prepared evidence; old sessions retain the original tool-first behavior. */
	retrieval?: { version: 1; strategy: 'focused' | 'character-history' | 'character-relationship' | 'episode' | 'episode-range' };
	research?: ChatResearchCoverage;
	episodeRange?: ChatEpisodeRangeCoverage;
}

export interface ChatEpisodeRangeCoverage {
	from: number; to: number; volume?: number;
	inspectedEpisodes: number; includedEpisodes: number;
	sourceCharacters: number; includedCharacters: number; partial: boolean;
}

export interface ChatResearchCoverage {
	purpose?: 'relationship';
	characters: Array<{ id: string; name: string }>;
	inspectedDocuments: number;
	matchedDocuments: number;
	matchedPassages: number;
	includedDocuments: number;
	includedPassages: number;
	shortenedPassages: number;
	partial: boolean;
}

export interface AiChatSession {
	skill?: DeusSkill;
	participants?: DeusParticipant[];
	/** Missing means the legacy character chat. */
	mode?: 'character' | 'deus';
	/** 세션 고유 ID (파일명이자 저장 키) */
	id: string;
	/** A: AI가 연기하는 인물 노트 경로 */
	characterPath: string;
	/** 히스토리에 표시되는 제목, 사용자가 수정 가능 (기본값: 인물 이름) */
	title: string;
	messages: AiChatMessage[];
	updatedAt: number;
	pinned?: boolean;
	parentId?: string;
	forkMessageId?: string;
	projectRoot?: string;
	speakerPath?: string;
	contextPaths?: string[];
}
