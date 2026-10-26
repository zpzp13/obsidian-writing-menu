# 3.5.1 자동 검사 개선 — 3.5.2 배포

검증 날짜: 2026-10-26. 3.5.1에서 보고된 문제를 수정하고 3.5.2로 배포합니다.

로컬 검사 결과는 오류 0개, 소스 진단 3개·CSS 경고 13개·동작 경고 2종을 합산해 **18개 / 상한 20개**입니다. 소스의 권고 진단도 합계에 포함했습니다. 외부 검사기의 집계 방식은 다를 수 있습니다.

## 수정

- JSZip과 docx의 IE용 스크립트 주입·동적 함수 생성 폴리필을 기본 Promise·함수 콜백 타이머·언어 기능으로 교체했습니다. lodash의 전역 객체 탐지도 globalThis를 사용합니다. 고정된 의존성의 구조가 바뀌면 빌드를 중단합니다.
- 생성된 main.js와 문자열에 포함된 워커를 AST로 검사하며, 생성자 별칭도 확인합니다. 문자열 코드 생성을 금지한 브라우저 유사 환경에서 ZIP·DOCX를 생성하는 검사도 통과했습니다.
- 임시 내보내기 파일은 경로와 객체를 확인한 뒤 FileManager.trashFile()로 정리합니다.
- 중복된 표준 box-decoration-break 선언 2개를 제거하고 Chromium 접두사 선언을 유지했습니다. 320px·700px 및 밝은·어두운 테마의 변경 전후 픽셀이 같습니다.
- 배포 파일을 main.js, manifest.json, styles.css로 제한했습니다. 워커는 main.js에 포함됩니다. 로컬 ZIP은 매번 빈 디렉터리에서 만듭니다.
- 일반 빌드의 고정된 외부 볼트 자동 배포를 제거했습니다. 개발 배포는 WRITING_MENU_DEPLOY_DIR를 명시합니다.
- GitHub Actions가 Node 22.17.1과 잠금 파일로 빌드하고, 연속 빌드의 바이트 일치와 번들 정책을 검사한 동일 파일에 출처 증명을 생성해 릴리스합니다.

## 유지한 항목

| 항목 | 이유 |
| --- | --- |
| fs·child_process | 사용자가 선택한 외부 내보내기 폴더·HWPX 템플릿·파일 선택기·CLI 연결에 필요합니다. CLI는 shell:false와 인자 배열·표준 입력을 사용합니다. |
| 볼트 파일 열거·클립보드 | 문서 선택기·위키·음악·통계·검색 및 사용자가 실행하는 복사·붙여넣기에 필요합니다. |
| localStorage | 기기별 페이지 줌과 Obsidian 1.7.2 및 업그레이드·다운그레이드 시 기존 저장값을 유지합니다. |
| fetch | Gemini SSE의 점진적 응답과 취소를 유지합니다. 현재 requestUrl은 응답을 버퍼링하며 일반 요청에는 requestUrl을 사용합니다. |
| keyCode | 구버전 Chromium의 한글 조합 종료 Enter에서 isComposing:false·229 입력을 보호합니다. 표준 상태를 먼저 확인합니다. |
| caretRangeFromPoint | 표준 caretPositionFromPoint가 없는 최소 지원 런타임의 대체 경로입니다. |
| CSS 부분 지원 경고 | 실제 사용하는 들여쓰기·줄바꿈 장식·밑줄 구문과 비의미적 div 레이아웃을 유지합니다. |
| !important 2개 | 집중 모드에서 Obsidian이 인라인으로 저장한 패널 flex 값을 덮어씁니다. |

## 검증

- 핵심 회귀 검사 28개
- 브라우저 문서 내보내기·임시 파일 정리
- CSS 픽셀 비교와 프로덕션 빌드 재현성
- 릴리스 파일 3개와 태그·버전 일치

실제 kordoc 엔진 다운로드·렌더링은 로컬 합성 검사에 포함하지 않았습니다. GitHub 출처 증명은 GitHub Actions에서 생성됩니다.

[GitHub artifact attestations 공식 문서](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
