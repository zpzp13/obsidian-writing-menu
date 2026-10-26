# Writing Menu 3.5.0

2026-10-26 · Obsidian 1.7.2 이상

## 문서 내보내기

- TXT·DOCX·HWPX를 하나의 내보내기 창에서 선택합니다. DOCX와 HWPX는 생성된 문서를 바로 미리 봅니다.
- 문서 트리·검색·Bases 보기에서 원고를 고르고, 선택 순서를 바꿔 개별 저장하거나 하나로 병합합니다. 체크는 내보내기 포함 여부를, 문서 이름 선택은 미리 볼 원고를 바꿉니다.
- 글꼴·크기·두께·색, 문단 정렬·들여쓰기·줄간격, 용지·여백을 조절하고 사용자 프리셋으로 저장합니다.
- 속성·헤딩·표·각주·강조·이미지·서식의 포함 여부를 선택합니다. 서식을 켜면 DOCX·HWPX에 헤딩 서식과 실제 각주를 반영합니다.
- Windows와 macOS에서 Python·Word·한글 설치 없이 문서를 생성합니다. HWPX 템플릿에서 쪽 설정과 본문 서식을 읽어 적용합니다. `.hwp`는 한글에서 `.hwpx`로 저장한 뒤 사용하세요.
- HWPX 템플릿의 본문·로고·고정 표·머리말·꼬리말은 복제하지 않습니다.

![문서 선택·병합과 HWPX 미리보기](https://raw.githubusercontent.com/zpzp13/obsidian-writing-menu/3.5.0/assets/document-export.png)

<details>
<summary>내보내기 양식 설정</summary>

![글자·문단·용지 서식과 문서 미리보기](https://raw.githubusercontent.com/zpzp13/obsidian-writing-menu/3.5.0/assets/document-export-formatting.png)

</details>

## 집필 환경

- Obsidian 언어 설정에 따라 한국어 또는 영어 UI를 표시합니다. 한국어 이외의 언어에는 영어를 사용하며, 원고와 사용자 지정 이름은 그대로 유지합니다.
- Style Settings에서 프로젝트 원고의 제목·각주·강조 등 서식을 조절합니다.
- 툴바에 표시할 글꼴을 등록하고 순서를 바꿉니다. 글꼴 두께 선택과 수치 슬라이더 조작도 개선했습니다.
- Markdown과 여러 쪽 보기에서 넓게 보기·집중 모드 버튼의 상태가 맞지 않던 문제를 수정했습니다.

<details>
<summary>Style Settings 프로젝트 문서 서식</summary>

![프로젝트 문서의 제목과 각주 서식 설정](https://raw.githubusercontent.com/zpzp13/obsidian-writing-menu/3.5.0/assets/project-typography.png)

</details>

## 플롯과 Deus AI

- 플롯 셀과 사이드바에서 `[[내부 링크]]` 및 노트 자동완성을 지원합니다. 별칭과 제목 위치를 포함한 링크로 원문을 엽니다.
- Deus AI에서 Gemini 외에 Claude Code·Codex CLI를 선택합니다. CLI는 데스크톱에 설치하고 로그인한 도구를 사용합니다.
- 설치된 CLI에서 제공하는 모델 목록과 모델별 추론 강도(effort)를 선택합니다. 실행 파일 경로·모델·effort는 Deus 설정에서도 지정합니다.
- 플롯 출처 각주가 해당 시트와 행으로 이동하도록 수정했습니다. 현재 탭·새 탭 열기 설정도 반영합니다.

![DEUS의 Codex 모델·추론 강도 선택](https://raw.githubusercontent.com/zpzp13/obsidian-writing-menu/3.5.0/assets/deus-model-selection.png)

<details>
<summary>플롯 내부 링크 자동완성</summary>

![플롯 셀의 내부 링크 노트 제안](https://raw.githubusercontent.com/zpzp13/obsidian-writing-menu/3.5.0/assets/plot-internal-links.png)

</details>

## 음악과 안정성

- 음악 라이브러리의 Bases 보기와 곡 정보 관리를 개선했습니다. 오디오 메타데이터를 읽고 재생 상태를 처리하는 흐름을 보완했습니다.
- 플러그인 내부 저장소의 플롯·백업 자료가 집필 통계에 포함되지 않도록 수정했습니다.
- Obsidian 기본 설정 화면의 내용이 중복 표시되던 문제를 수정했습니다.
- 기능 안내와 스크린샷을 최신 화면에 맞게 정리했습니다.

## 업데이트 안내

- 최소 지원 버전은 Obsidian 1.7.2입니다. 여러 쪽 보기·문서 내보내기·CLI 제공자는 데스크톱 전용입니다.
- 내보내기 문서 목록은 Obsidian 1.10 이상의 Bases 코어 플러그인을 사용합니다.
- 내보내기 기본 서식은 새 기본값으로 한 번 이관됩니다. 저장 경로·템플릿 경로·사용자 프리셋은 보존합니다.
- 외부 URL 이미지는 내보내기에서 다운로드하지 않습니다. Vault 안의 지원 이미지 파일을 사용하세요.
- Word·한글에서 사용하는 글꼴과 자동 쪽 나눔에 따라 실제 배치가 미리보기와 달라질 수 있습니다.

[전체 변경 내역: 3.4.4 → 3.5.0](https://github.com/zpzp13/obsidian-writing-menu/compare/3.4.4...3.5.0)
