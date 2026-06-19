# Writing Menu — Obsidian Writing Assistant Plugin

A comprehensive writing environment plugin for Obsidian, tailored for novelists and writers. Integrates typography controls, focus mode, smart input, word counter, daily work time tracker, calendar dashboard, version control, and wiki view into one plugin.

## Key Features
- **Typography**: Font, size, line height, line width per note or folder
- **Focus Mode & Typewriter Scroll**: Distraction-free writing
- **Smart Input**: Auto quotes, symbol triggers, text substitution, smart enter
- **Char Count**: Munpia/Novelpia format tracking with daily notes integration
- **Work Time Tracker**: Per-mode (draft/writing/editing) time tracking saved to frontmatter
- **Calendar Dashboard**: Date strip, monthly view, hover preview with tasks/char count/time
- **Version Control**: Snapshot, side-by-side diff, partial revert
- **Wiki View**: Card view for characters/settings with custom groups and relations
- **Export**: TXT/HWP export, heading/footnote exclusion
- **Music Player**: In-vault audio playback

---

(한국어 설명은 아래를 참조하세요 / Korean documentation below)

---

# Writing Menu — Obsidian 창작 보조 플러그인

웹소설 집필에 특화된 Obsidian 플러그인입니다. 편집기 서식, 글자수 추적, 작업 시간 기록, 캘린더 대시보드, 버전 관리, 위키 기능을 하나로 통합합니다.

---

## 주요 기능

### 편집기 서식
- **폰트 / 크기 / 행간 / 줄 너비** — 노트 단위로 스타일 적용, 특정 폴더에만 적용 가능
- **집중 모드 (Focus Mode)** — 현재 문장 외 흐리게 표시
- **타자기 스크롤** — 커서가 항상 화면 중앙에 위치
- **헤딩 렌더링** — 편집 중에도 H1~H6 글꼴·크기·색상 서식 즉시 반영
- **젠 모드 (F4)** — 넓게 보기 / 집중 모드

### 스마트 입력
- **스마트 인용부호** — `"` 입력 시 열림/닫힘 자동 전환
- **기호 자동완성** — 트리거 키를 통한 자동완성 지원
- **스마트 엔터** — 쌍따옴표, 괄호, 등록된 트리거 쌍 안에서 Enter 시 커서가 다음 단락으로 넘어갑니다.
- **텍스트 치환** — `-->` → `→`, `...` → `…` 등 규칙 기반 자동 치환

### 글자수 추적
- 문피아·노벨피아 글자수 추적 지원
- 추적 폴더 기준 오늘 하루 순 증가량 실시간 계산
- 일일 글자수: 데일리노트 '글자수' 프로퍼티에 누적 기록
- 일평균 글자수: 데일리노트 기반 자동 계산
- 목표 글자수 대비 달성률 표시

### 작업 시간 추적
- 초고·집필·퇴고 등 커스텀 작업 모드 설정 가능
- 타이핑 감지 후 1초 단위 자동 누적
- 30초마다 현재 노트 프론트매터에 저장 (`초고_시간`, `집필_시간` 등)
- 프로젝트별 데일리노트 기록: `{프로젝트명}_{모드키}` 형식
- 목표 시간 대비 / 일평균 대비 배지 표시


### 캘린더 대시보드 (사이드바)
- 날짜 스트립 / 월별 달력 전환
- 각 날짜 호버 시 미리보기 팝업:
  - 할 일 목록 (완료 토글 가능)
  - 해당 날짜 글자수 / 일평균 글자수
  - 작업 모드별 시간 및 합계
- 탭: 메인 대시보드 / 할 일 / 글자수 / 작업시간 / 위키 / 버전관리

### 할 일 관리
- `- [ ]` 형식 태스크 자동 파싱
- 마감일(`due:`, 📅 이모지) 기반 오늘/예정/지연 분류
- 인라인 추가 팝업, 완료 시 날짜 자동 기록

### 버전 관리
- 스냅샷 저장 (이름·단계 지정)
- 사이드 바이 사이드 diff 뷰
- 특정 구간만 이전 버전으로 되돌리기
- 단계별 색상 태그 (초고·퇴고·연출 등)

### 위키 뷰
- 폴더 단위 인물·설정 카드 뷰
- 커스텀 그룹·정렬 규칙, 저장된 뷰
- 관계 프론트매터 키 기반 스트립 목록
- 프로필 이미지·속성 편집

### 내보내기
- TXT 내보내기 (헤딩·각주 제거, 공백 들여쓰기 옵션)
- HWP 내보내기 (Windows, Python 변환 스크립트 사용)
- 단일 파일 / 폴더 / 다중 선택 일괄 내보내기

### 사전 / 한자 변환 (F3)
- 표준국어대사전 API 연동
- 한자 변환 (괄호 병기 모드 포함)

### 포모도로 스톱워치 
- 상태바/대시보드 위젯 지원
- 종료 시 알림음

### 음악 플레이어
- 볼트 내 오디오 파일 재생
- 반복·단일·셔플 모드, 즐겨찾기

---

## 설치

1. Obsidian 설정 → 커뮤니티 플러그인 → 파일에서 설치
2. `manifest.json`, `main.js`, `styles.css` 를 `.obsidian/plugins/writing-menu/` 에 복사
3. 플러그인 활성화

---

## 데이터 파일

| 파일 | 설명 |
|------|------|
| `.writing-menu-today.json` | 오늘 글자수 스냅샷 (자동 관리) |
| `.writing-menu-versions/` | 버전 스냅샷 저장 폴더 |
| 데일리노트 프론트매터 | `글자수`, `{프로젝트}_{모드}_시간` 등 자동 기록 |

---

## 설정

설정창은 **카테고리 페이지** 방식으로 구성됩니다.

| 카테고리 | 주요 항목 |
|----------|-----------|
| 서식 | 폰트, 행간, 줄너비, 헤딩·각주 서식, 집중/타자기 모드 |
| 입력 보조 | 스마트 인용부호, 기호 트리거, 텍스트 치환 |
| 복사 및 내보내기 | 헤딩·각주 제외 복사, TXT/HWP 경로 |
| 글자수 & 작업 시간 | 추적 폴더, 제외 폴더, 데일리노트 키, 작업 모드 설정 |
| 캘린더 & 일정 관리 | 히트맵 색상, 할 일 헤더, 미리보기 항목 |
| 버전 관리 | 저장 경로, 최대 보관 수, 단계 색상 |
| 스톱워치 | 타이머 시간, 알림음 |
| 음악 | 음악 폴더, 볼륨, 재생 모드 |
| 위키 | 카드 색상, 이미지·이름 필드, 관계 필드 |
| 사전 | 표준국어대사전 API 키 |

---

## 단축키

| 단축키 | 기능 |
|--------|------|
| `F3` | 사전 / 한자 변환 |
| `F4` | 젠 모드 (넓게/집중/해제 순환) |
| `F6` | 위키 폴더·노트 선택 |
| `Alt+C` | 헤딩·각주 제외 복사 |

---

## 기술 구조

```
src/
  calendar/        캘린더 뷰, 날짜 스트립, 미리보기 팝업
  dashboard/       대시보드 섹션, 글자수·시간 렌더러
    data/          DailyCharStore, WritingTimeStore, TaskParser
  editor/          헤딩 위젯
  export/          TXT/HWP 내보내기
  preview/         모바일 미리보기
  settings/        설정 탭 (페이지 라우터)
  utils/           날짜, 시간, DOM, 데일리노트 유틸리티
  version/         버전 저장·diff
  views/           작업시간 사이드바 뷰
  wiki/            옵시위키 패널·설정
main.ts            플러그인 진입점
```

---

## 라이선스

MIT
