// ── 퇴고 매니저 공용 타입 ──────────────────────────────────────────────────

/** garu-ko 형태소 분석 결과 토큰 (문서 원본 텍스트 기준 문자 오프셋) */
export interface MorphToken {
	/** 표면형(활용형은 정규화된 어간으로 옴, 조사/어미는 원형 그대로) */
	text: string;
	/** Sejong 품사 태그 (NNG, NNP, VV, VA, EF, EC, ETM 등) */
	pos: string;
	/** 이 형태소가 속한 어절의 원본 텍스트 시작 오프셋 */
	start: number;
	/** 이 형태소가 속한 어절의 원본 텍스트 끝 오프셋 */
	end: number;
}

export type RepetitionKind = 'word' | 'eojeol' | 'eomi';

/** 원본 문서 기준 등장 구간. word는 해당 단어만, eojeol/eomi는 어절 전체 범위. */
export interface Occurrence {
	start: number;
	end: number;
	/** Sejong 품사 태그 (예: NNG, VV) */
	pos: string;
}

/** 현재 문서에서 집계된 반복 표현 하나 (단어/어절/어미 공통) */
export interface RepetitionEntry {
	text: string;
	count: number;
	occurrences: Occurrence[];
}

export interface RepetitionResult {
	word: RepetitionEntry[];
	eojeol: RepetitionEntry[];
	eomi: RepetitionEntry[];
}

/** 단어장 표의 한 행 */
export interface DictEntry {
	word: string;
	candidates: string[];
}
