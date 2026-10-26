![Writing Menu — Obsidian을 위한 집필 작업 공간](assets/hero.png)

# Writing Menu

[![GitHub 스타](https://img.shields.io/github/stars/zpzp13/obsidian-writing-menu?style=flat&logo=github&label=stars&color=b699e2)](https://github.com/zpzp13/obsidian-writing-menu/stargazers)
[![GitHub 릴리스 다운로드](https://img.shields.io/github/downloads/zpzp13/obsidian-writing-menu/total?color=b699e2)](https://github.com/zpzp13/obsidian-writing-menu/releases)
[![최신 릴리스](https://img.shields.io/github/v/release/zpzp13/obsidian-writing-menu?color=b699e2)](https://github.com/zpzp13/obsidian-writing-menu/releases/latest)
[![MIT 라이선스](https://img.shields.io/github/license/zpzp13/obsidian-writing-menu?color=7c9e61)](LICENSE)

[English](README.md) | **한국어**

Obsidian에서 웹소설과 이야기를 쓰기 위한 집필 도구입니다. 원고 작성부터 플롯·인물 관리, 퇴고와 작품 자료 기반 AI 대화까지 한곳에서 진행합니다.

[최신 릴리스 다운로드](https://github.com/zpzp13/obsidian-writing-menu/releases/latest)

## 원고 작성

- Markdown과 여러 쪽 보기에서 공통 작성 툴바를 사용합니다. 여러 쪽 보기는 PC 전용입니다.
- 글꼴·행간·문단·글자색을 조절하고 집중 모드, 타자기 스크롤, 스마트 인용부호와 텍스트 치환을 사용합니다.
- 글자수 확인, 복사, TXT·DOCX·HWPX 내보내기를 지원합니다. 문서 선택과 서식 미리보기에서 여러 원고를 개별 저장하거나 하나로 병합합니다. Windows와 macOS에서 Python·Word·한글 설치 없이 문서를 생성하고 HWPX 템플릿의 서식을 적용합니다.

![같은 원고를 여러 페이지로 펼쳐 편집하는 화면](assets/multi-page.png)

<details>
<summary>Markdown 작성 화면</summary>

![Markdown 편집기와 작성 툴바](assets/markdown.png)

</details>

<details>
<summary>프로젝트 문서 서식</summary>

Style Settings에서 프로젝트 원고의 제목·각주·강조 서식을 설정합니다.

![프로젝트 문서의 헤딩과 각주를 설정하는 Style Settings 화면](assets/project-typography.png)

</details>

## 문서 내보내기

TXT·DOCX·HWPX 미리보기에서 내보낼 원고와 순서를 정하고, 개별 저장하거나 하나로 병합합니다. 글자·문단·용지를 조절하고 프리셋 또는 HWPX 템플릿의 서식을 적용합니다.

문서 목록은 Obsidian 1.10 이상에서 제공하는 Bases 코어 플러그인을 사용합니다.

![원고 병합 목록과 HWPX 문서 미리보기](assets/document-export.png)

<details>
<summary>내보내기 양식 설정</summary>

![글꼴·크기·두께·정렬·줄간격을 조절하며 문서를 미리 보는 화면](assets/document-export-formatting.png)

</details>

## 플롯 매니저

프로젝트별 시트에서 줄거리·인물·복선·체크리스트를 정리합니다.

- 행·열·하위 행, 상태·라벨과 셀 서식을 관리합니다.
- 선택한 행이나 열의 내용을 사이드바에서 카드로 확인하고 편집합니다.
- 검색, 여러 셀 붙여넣기, 실행 취소와 Markdown 내보내기를 지원합니다.
- 셀과 사이드바에서 `[[내부 링크]]`를 입력하면 노트를 제안하며, 링크를 눌러 원문으로 이동합니다.

![장면별 줄거리·인물·상태와 선택한 행을 함께 보여주는 플롯 시트](assets/plot-workbook.png)

<details>
<summary>내부 링크 자동완성</summary>

![플롯 셀에서 내부 링크를 입력하면 표시되는 노트 제안 목록](assets/plot-internal-links.png)

</details>

## Deus AI

작품의 본문·인물·플롯 자료를 찾아 질문에 답하는 AI 작업 공간입니다.

- **자료 조사:** 인물 관계, 회차별 사건과 행적을 조회하고 각주로 원문을 확인합니다.
- **참고 지정:** `@`로 노트를 추가하고 `+`에서 참고 자료의 포함 여부를 관리합니다.
- **캐릭터 대화:** `/character`로 현재 장면이나 가정한 상황의 대화를 시험합니다.
- **대화 관리:** 프로젝트별 세션 검색·고정·분기와 Markdown 내보내기를 지원합니다.

![원문 각주와 참고 회차를 함께 표시하는 작품 자료 기반 답변](assets/deus-research.png)

<details>
<summary>캐릭터 대화 화면</summary>

![엘리자베스와 다아시의 대사와 지문을 구분해 보여주는 캐릭터 대화](assets/deus-character-dialogue.png)

</details>

모델에서 Gemini, Claude Code (CLI), Codex (CLI)를 선택할 수 있습니다. Gemini는 API 키가 필요하며, CLI는 데스크톱에 설치하고 로그인한 도구를 사용합니다. CLI를 선택하면 설치된 도구에서 조회한 모델 목록과 모델별 effort를 고를 수 있습니다. CLI 경로·모델·effort는 Deus 설정에서도 지정하며, 경로가 비어 있으면 실행 파일을 자동으로 찾습니다. 프로젝트 컨텍스트·검색·출처 처리는 같은 흐름을 사용합니다. 각주는 기본으로 현재 탭에서 열며 설정에서 새 탭으로 변경할 수 있습니다.

<details>
<summary>CLI 모델과 추론 강도 선택</summary>

![Deus에서 Codex 모델 목록과 추론 강도를 선택하는 화면](assets/deus-model-selection.png)

</details>

## 퇴고와 스냅샷

- 현재 원고 또는 프로젝트 전체의 문장 길이·단락·대사 비율과 한국어 반복표현을 분석합니다.
- 원고 스냅샷을 비교하고 전체 또는 선택한 변경 구간을 복원합니다.
- 플롯은 Markdown 스냅샷으로 다른 기기에 전달하고 수동으로 복원합니다.

![프로젝트 전체의 문장·단락 길이와 서술·대사 구성 비율 분석](assets/revision-analysis.png)

<details>
<summary>원고 스냅샷 비교와 변경 구간 복원</summary>

![저장된 초고와 현재 원고를 비교하고 추가·삭제된 내용을 표시하는 화면](assets/manuscript-snapshots.png)

</details>

## 인물 위키

인물 프로필·이미지·속성을 관리하고 관계 그래프로 연결을 살펴봅니다.

![속성·인물 설정·연결된 관계를 정리한 엘리자베스 베넷의 위키 프로필](assets/character-profile.png)

<details>
<summary>인물 관계 그래프</summary>

![오만과 편견의 주요 인물을 연결한 관계 그래프](assets/character-relationships.png)

</details>

## 집필 대시보드

일정·할 일, 글자수·작업시간, 목표 진행률과 타이머를 확인합니다. 문피아·노벨피아 기준 글자수와 볼트 내 음악 재생도 지원합니다.

![글자수 추이·목표 진행률·타이머를 보여주는 집필 대시보드](assets/writing-dashboard.png)

<details>
<summary>달력·할 일·활동별 작업시간</summary>

![주간 일정과 집필 할 일, 기획·초고·퇴고 시간을 보여주는 화면](assets/calendar-and-writing-time.png)

</details>

## 모바일 도구

화면과 키보드에 맞춘 사전·맞춤법 교정·특수문자 입력을 제공합니다. 모바일 글꼴은 PC와 따로 선택하며 내려받은 글꼴은 오프라인에서도 사용할 수 있습니다.

<table>
  <tr><th>국어사전·한자 변환</th><th>맞춤법 교정</th><th>특수문자</th></tr>
  <tr>
    <td width="33%"><a href="assets/mobile-dictionary.png"><img src="assets/mobile-dictionary.png" alt="모바일 국어사전과 한자 변환" width="260"></a></td>
    <td width="33%"><a href="assets/mobile-spellcheck.png"><img src="assets/mobile-spellcheck.png" alt="본문과 연결된 한국어 맞춤법 교정 패널" width="260"></a></td>
    <td width="33%"><a href="assets/mobile-special-characters.png"><img src="assets/mobile-special-characters.png" alt="검색과 즐겨찾기를 지원하는 특수문자 입력" width="260"></a></td>
  </tr>
</table>

## 설치와 시작

1. [최신 릴리스](https://github.com/zpzp13/obsidian-writing-menu/releases/latest)에서 `writing-menu-*.zip` 파일을 내려받습니다.
2. ZIP을 풀고 `writing-menu` 폴더 전체를 볼트의 `.obsidian/plugins/`에 복사합니다.
3. Obsidian 커뮤니티 플러그인 설정에서 Writing Menu를 활성화합니다. 업데이트할 때 기존 `data.json`은 유지합니다.
4. 플러그인 설정에서 프로젝트와 본문·인물 폴더를 등록합니다. 사전과 Gemini는 사용할 서비스의 API 키를 추가합니다. CLI를 사용하려면 터미널에서 `claude auth login` 또는 `codex login`으로 먼저 로그인합니다.

사용할 명령의 단축키는 **Obsidian 설정 → 단축키 → Writing Menu**에서 지정합니다.

## 인터페이스 언어

인터페이스는 Obsidian의 언어 설정을 따릅니다. 한국어에서는 한국어로, 영어 및 다른 언어에서는 영어로 표시합니다. 앱 언어를 바꾼 뒤에는 Obsidian을 다시 시작하세요. 기존 노트, 프로젝트 이름, 사용자 지정 라벨, 통계 메타데이터 키는 유지됩니다. 사전·한자·맞춤법 검사·형태소 분석은 한국어용 기능입니다.

## 외부 서비스와 라이선스

HWPX 미리보기는 내보내기 설정의 **문서 엔진**에서 최초 1회 다운로드합니다. 고정 버전의 kordoc과 필요한 라이브러리를 npm 레지스트리에서 받아 무결성을 확인한 뒤 플러그인의 `kordoc-assets` 폴더에 저장합니다. 이후에는 Obsidian 내부 워커에서 엔진을 재사용하며 오프라인으로 처리합니다. 별도 Node.js·npm 설치나 실행 경로 설정은 필요하지 않고, 원고를 외부로 전송하지 않습니다. kordoc 소스는 플러그인 배포 파일에 번들하지 않습니다.

Deus AI는 대화와 참고 자료를 선택한 모델 제공자에게 Gemini API 또는 설치된 CLI를 통해 전송합니다. 사전과 맞춤법 검사는 각 외부 서비스를 사용하며, 모바일 글꼴과 선택적 분석 자산은 요청 시 내려받아 기기에 저장합니다. 맞춤법 검사는 비공식 API를 사용하므로 제공자의 이용 조건을 확인하세요.


[MIT 라이선스](LICENSE). Claudian 등 외부 구성 요소의 라이선스 고지는 해당 코드와 배포 파일에 포함합니다.

스크린샷은 예제·테스트 프로젝트를 사용합니다. 제인 오스틴의 [오만과 편견](https://www.gutenberg.org/ebooks/1342) 예제는 퍼블릭 도메인 영어 원문으로 구성했습니다. AI 대화와 사전·맞춤법 결과는 기능 설명용 예시이며, 모바일 이미지는 반응형 레이아웃 미리보기입니다.

[로고 SVG](assets/logo.svg)
