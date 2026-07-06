// TTA 표준 형태소 태그셋 → 한글 표시용 라벨 (자주 나오는 것만)
const POS_LABELS: Record<string, string> = {
	NNG: '명사', NNP: '고유명사', NNB: '의존명사', NP: '대명사', NR: '수사',
	VV: '동사', VA: '형용사', VX: '보조용언', VCP: '지정사', VCN: '지정사',
	MM: '관형사', MAG: '부사', MAJ: '부사', IC: '감탄사',
	EF: '종결어미', EC: '연결어미', EP: '선어말어미', ETN: '전성어미', ETM: '전성어미',
};

export function posLabel(pos: string): string {
	return POS_LABELS[pos] ?? pos;
}
