export interface AiChatSegment {
	type: 'narration' | 'dialogue';
	text: string;
}

export interface AiChatMessage {
	role: 'user' | 'assistant';
	/** user: 실제 입력한 대사/지문. assistant: 모델의 원본 응답(히스토리 재전송용) */
	content: string;
	/** role === 'user'일 때, 이 턴에서 사용자가 연기한 상대역(B) 노트 경로/표시 이름 */
	speakerPath?: string;
	speakerName?: string;
	/** role === 'user'일 때, 대사인지 지문인지 구분 (기본 dialogue) */
	kind?: 'dialogue' | 'narration';
	/** role === 'assistant'일 때, [지문]/[대사]를 순서대로 파싱한 렌더링용 세그먼트 (여러 개 가능) */
	segments?: AiChatSegment[];
	timestamp: number;
}

export interface AiChatSession {
	/** 세션 고유 ID (파일명이자 저장 키) */
	id: string;
	/** A: AI가 연기하는 인물 노트 경로 */
	characterPath: string;
	/** 히스토리에 표시되는 제목, 사용자가 수정 가능 (기본값: 인물 이름) */
	title: string;
	messages: AiChatMessage[];
	updatedAt: number;
}
