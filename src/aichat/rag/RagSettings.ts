import { wmT } from '../../i18n/index';
import { Setting } from 'obsidian';
/** Search behavior belongs to read-only guidance, not request admission settings. */
export function renderRagSettings(container: HTMLElement): void {
	new Setting(container).setName(wmT("기본 검색")).setDesc(wmT("Obsidian API로 현재 프로젝트의 본문·인물·설정·플롯을 읽고 검색합니다. 모델 다운로드나 벡터 색인 없이 사용할 수 있습니다."));
	new Setting(container).setName(wmT("회차 조회")).setDesc(wmT("특정 회차의 내용은 해당 본문을 직접 읽어 답합니다."));
	new Setting(container).setName(wmT("인물 행적 조회")).setDesc(wmT("이름·별칭과 플롯 연결로 관련 원문을 모읍니다. 확인한 자료 범위와 답변에 포함한 발췌 범위를 구분해 표시합니다."));
}
