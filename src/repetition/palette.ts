// 강조 색상 기반 레벨 히트맵 팔레트. 실제 색상은 styles.css의 --wm-rep-level-1..6 / --wm-rep-c-other가 정의하며,
// 여기서는 인덱스 → CSS 클래스명만 매핑한다(색을 인라인 style로 박지 않아 개발자 도구에서 규칙이 그대로 보인다).
const LEVEL_COUNT = 6;

export function colorClass(i: number, isOther?: boolean): string {
	return isOther ? 'wm-rep-color-other' : `wm-rep-color-${(i % LEVEL_COUNT) + 1}`;
}
