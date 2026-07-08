# Writing Menu — Obsidian Writing Assistant Plugin

A comprehensive writing environment plugin for Obsidian, tailored for novelists and writers. Integrates typography controls, custom dividers, focus mode, smart input, spell checker, word counter, daily work time tracker, calendar dashboard, version control, wiki view, and more into one plugin.

---

## Key Features

### Editor Typography
| Feature | Description |
|---------|-------------|
| Font / Size / Line Height / Width | Apply styles per note or folder |
| Focus Mode | Dims all lines except the current one |
| Typewriter Scroll | Keeps cursor vertically centered |
| Heading Rendering | Applies custom font/size/color to H1 in the editor |
| Zen Mode (F4) | Cycles through wide / focus / off |

### Custom Divider
| Feature | Description |
|---------|-------------|
| Text Divider | Replaces `***`, `---`, etc. with custom text (e.g. `✦ ✦ ✦`) |
| SVG Divider | Replaces dividers with a registered SVG graphic |
| Alignment | Left / center / right alignment |
| Folder Scope | Can be limited to a specific folder (shares the Typography folder setting) |

### Smart Input
| Feature | Description |
|---------|-------------|
| Smart Quotes | Automatically switches `"` to opening/closing curved quotes |
| Symbol Autocomplete | Trigger key brings up a symbol pair popup |
| Smart Enter | Pressing Enter inside quote/bracket pairs moves cursor to the next paragraph |
| Text Substitution | Rule-based auto-replacement: `-->` → `→`, `...` → `…`, etc. |

### Spell Checker
| Feature | Description |
|---------|-------------|
| Daum Engine | Fast spell check via the Daum web API |
| Proper Noun Dictionary | Register words to exclude from spell check results |
| Inline Correction UI | Review errors, apply suggestions, or manually edit — all from a single modal |

> **⚠️ Disclaimer**: The spell check feature uses unofficial third-party web APIs for **personal, non-commercial use only**. The developer of this plugin accepts **no legal responsibility** of any kind arising from the use of this feature. Users are solely responsible for ensuring their usage complies with the terms of service of the respective API providers.

### Word Count
| Feature | Description |
|---------|-------------|
| Platform Support | Munpia and Novelpia counting standards |
| Daily Net Count | Real-time net increase for the day, scoped to the tracking folder |
| Daily Note Record | Cumulative count written to the daily note frontmatter |
| Daily Average | Auto-calculated from daily note history |
| Goal Progress | Displays achievement rate against the daily goal |

### Work Time Tracker
| Feature | Description |
|---------|-------------|
| Custom Modes | Define modes such as drafting, writing, editing, etc. |
| Auto Accumulation | Detects typing and accumulates in 1-second increments |
| Frontmatter Save | Saves to the current note's frontmatter every 30 seconds |
| Daily Note Record | Logs per-project time in `{project}_{mode_key}` format |
| Badges | Shows progress against goal time and daily average |

### Calendar Dashboard (Sidebar)
| Feature | Description |
|---------|-------------|
| Date Strip / Monthly View | Toggle between compact strip and full calendar |
| Hover Preview | Popup showing tasks, word count, and work time per date |
| Tabs | Main dashboard / Tasks / Word count / Work time / Wiki / Version control |

### Task Management
| Feature | Description |
|---------|-------------|
| Auto Parsing | Parses `- [ ]` format tasks |
| Due Date Classification | Classifies tasks as today / upcoming / overdue based on `due:` or 📅 |
| Inline Add | Add tasks via popup; completion date recorded automatically |

### Version Control
| Feature | Description |
|---------|-------------|
| Snapshots | Save snapshots with a name and stage label |
| Side-by-side Diff | Visual diff view |
| Partial Revert | Restore only a selected range from a previous version |
| Stage Tags | Color-coded tags (draft, revision, production, etc.) |

### Plot Manager (F9)
| Feature | Description |
|---------|-------------|
| Structure | Episode › Chapter › Scene hierarchy for column management |
| Plot Lines | Per-scene memos for each plot line row |
| Character Rows | Per-scene appearance memos for each character |
| Markdown Storage | Each episode saved as a `.md` file; bidirectional sync |
| Character Notes | Create or link character notes; template support; auto-move to designated folder |
| Plot Timeline (F11) | Left-sidebar timeline view synced with the current selection |
| Bulk Operations | Bulk create / delete scenes via dropdown |
| Keyboard Shortcuts | Arrow keys to navigate, Enter/double-click to edit, Shift+F to search chapters, Ctrl+Wheel to zoom |

### Wiki View
| Feature | Description |
|---------|-------------|
| Card View | Folder-based card view for characters and settings |
| Groups & Sort | Custom grouping and sort rules, saved views |
| Relations | Strip list based on relation frontmatter keys |
| Profile Edit | Edit profile image and properties directly |

### Export
| Feature | Description |
|---------|-------------|
| TXT Export | Heading/footnote removal, indentation options |
| HWP Export | Windows only — uses a Python conversion script |
| Batch Export | Single file, folder, or multi-selection |

### Dictionary / Hanja (F3)
| Feature | Description |
|---------|-------------|
| Standard Korean Dictionary | Integration with the National Institute of Korean Language API |
| Hanja Conversion | Converts Korean to Hanja with optional bracket notation |

### Stopwatch (Pomodoro)
| Feature | Description |
|---------|-------------|
| Countdown Timer | Configurable countdown duration |
| Alarm Sound | Plays a sound when the timer ends |

### Music Player
| Feature | Description |
|---------|-------------|
| In-vault Playback | Plays audio files stored inside the vault |
| Playback Modes | Loop / single / shuffle |
| Favorites | Bookmark frequently played tracks |

### Special Characters
| Feature | Description |
|---------|-------------|
| Insert Panel | Browse and insert special characters |
| Favorites | Star frequently used characters |
| Custom Characters | Register custom characters with descriptions |

---

## Permissions & System Access

The **HWP export** feature requires elevated system access:

| Permission | Purpose |
|------------|---------|
| Filesystem (`fs`, `path`) | Writes a bundled Python script to the plugin directory; reads/writes files during export |
| Shell execution (`child_process`) | Spawns a Python 3 process to convert Markdown to HWP |

These permissions are used **exclusively** for HWP export on Windows. All other features use only the standard Obsidian Vault API. No data is sent to any external server — all processing is local.

---

## Installation

1. Obsidian Settings → Community Plugins → Install from file
2. Copy `manifest.json`, `main.js`, `styles.css` to `.obsidian/plugins/writing-menu/`
3. Enable the plugin

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `F3` | Dictionary / Hanja conversion |
| `F4` | Zen mode (wide / focus / off) |
| `F6` | Wiki folder/note selector |
| `F9` | Plot Manager open/close |
| `F11` | Plot Timeline sidebar open/close |
| `Alt+C` | Copy without headings/footnotes |

---

## Settings

Settings are organized as category pages:

| Category | Key Options |
|----------|-------------|
| Typography | Font, line height, line width, heading/footnote styles, focus/typewriter mode, custom divider |
| Smart Input | Smart quotes, symbol triggers, text substitution |
| Copy & Export | Heading/footnote exclusion, TXT/HWP path |
| Word Count & Work Time | Tracking folder, exclusion folders, daily note key, work modes |
| Calendar & Tasks | Task header, preview items |
| Version Control | Storage path, max snapshots, stage colors |
| Stopwatch | Timer duration, alarm sound |
| Music Player | Music folders, volume, playback mode |
| Wiki View | Card color, image/name/relation fields |
| Plot Manager | Root folder, plot subfolder, character subfolder, character note template, open mode |
| Dictionary | Standard Korean Dictionary API key |
| Spell Checker | Proper noun dictionary |
| Special Characters | Close-on-insert behavior, favorites |

---

## Data Files

| File | Description |
|------|-------------|
| `.writing-menu-today.json` | Today's word count snapshot (auto-managed) |
| `.writing-menu-versions/` | Version snapshot storage folder |
| Daily note frontmatter | Auto-recorded keys: `글자수`, `{project}_{mode}_시간`, etc. |

---

## Technical Structure

```
src/
  calendar/        Calendar view, date strip, hover preview popup
  dashboard/       Dashboard sections, word count & time renderers
    data/          DailyCharStore, WritingTimeStore, TaskParser
  editor/          Heading widget
  export/          TXT / HWP export
  preview/         Mobile preview
  settings/        Settings tab (page router)
  spellcheck/      Spell checker service & correction modal
  utils/           Date, time, DOM, daily note utilities
  plot/            Plot Manager & Timeline views
  version/         Version save & diff
  views/           Work time sidebar view
  wiki/            ObsiWiki panel & settings
main.ts            Plugin entry point
```

---

## License

MIT

---







# Writing Menu — Obsidian 창작 보조 플러그인

웹소설 집필에 특화된 Obsidian 플러그인입니다. 편집기 서식, 커스텀 구분선, 맞춤법 검사, 글자수 추적, 작업 시간 기록, 캘린더 대시보드, 버전 관리, 위키 기능을 하나의 플러그인으로 통합합니다.

---

## 주요 기능

### 편집기 서식
| 기능 | 설명 |
|------|------|
| 폰트 / 크기 / 행간 / 줄너비 | 노트 또는 폴더 단위로 스타일 적용 |
| 집중 모드 | 현재 줄 외 나머지를 흐리게 표시 |
| 타자기 스크롤 | 커서가 항상 화면 세로 중앙에 위치 |
| 헤딩 렌더링 | 편집 중에도 H1 글꼴·크기·색상 서식 즉시 반영 |
| 젠 모드 (F4) | 넓게 보기 / 집중 / 해제 순환 |

### 커스텀 구분선
| 기능 | 설명 |
|------|------|
| 텍스트 구분선 | `***`, `---` 등을 지정한 텍스트(예: `✦ ✦ ✦`)로 대체 |
| SVG 구분선 | 등록한 SVG 그래픽으로 구분선 대체 |
| 정렬 | 좌 / 중앙 / 우 정렬 선택 가능 |
| 폴더 범위 | 특정 폴더에만 적용 가능 (서식의 폴더 설정과 공유) |

### 스마트 입력
| 기능 | 설명 |
|------|------|
| 스마트 인용부호 | `"` 입력 시 열림/닫힘 둥근 따옴표 자동 전환 |
| 기호 자동완성 | 트리거 키 입력 시 기호 쌍 팝업 표시 |
| 스마트 엔터 | 따옴표·괄호·트리거 기호쌍 안에서 Enter 시 커서가 다음 단락으로 이동 |
| 텍스트 치환 | 규칙 기반 자동 치환: `-->` → `→`, `...` → `…` 등 |

### 맞춤법 검사
| 기능 | 설명 |
|------|------|
| Daum 엔진 | Daum 웹 API를 활용한 빠른 맞춤법 검사 |
| 고유명사 사전 | 검사 결과에서 제외할 단어 등록 |
| 교정 UI | 오류 검토, 제안 적용, 직접 수정을 하나의 모달에서 처리 |

> **⚠️ 이용 안내**: 본 맞춤법 검사 기능은 비공식 제3자 웹 API를 활용합니다. **개인의 비상업적 용도에 한해서만 이용**하시기 바랍니다. 본 기능의 사용으로 인해 발생하는 어떠한 법적 문제에 대해서도 **본 개발자는 일절 책임을 지지 않습니다**. 이용자는 해당 API 제공자의 이용 약관을 스스로 확인하고 준수할 책임이 있습니다.

### 글자수 추적
| 기능 | 설명 |
|------|------|
| 플랫폼 지원 | 문피아·노벨피아 기준 글자수 산출 |
| 일일 순 증가량 | 추적 폴더 기준 오늘 하루 순 증가량 실시간 계산 |
| 데일리노트 기록 | 누적 글자수를 데일리노트 프론트매터에 자동 기록 |
| 일평균 글자수 | 데일리노트 기반 자동 계산 |
| 목표 달성률 | 일일 목표 글자수 대비 달성률 표시 |

### 작업 시간 추적
| 기능 | 설명 |
|------|------|
| 커스텀 모드 | 기획·초고·퇴고 등 원하는 작업 모드 직접 설정 |
| 자동 누적 | 타이핑 감지 후 1초 단위로 자동 누적 |
| 프론트매터 저장 | 30초마다 현재 노트 프론트매터에 자동 저장 |
| 데일리노트 기록 | `{프로젝트명}_{모드키}` 형식으로 기록 |
| 배지 표시 | 목표 시간 대비 / 일평균 대비 달성 배지 표시 |

### 캘린더 대시보드 (사이드바)
| 기능 | 설명 |
|------|------|
| 날짜 스트립 / 월별 달력 | 컴팩트 스트립과 전체 달력 전환 |
| 호버 미리보기 | 날짜에 마우스를 올리면 할 일·글자수·작업시간 팝업 표시 |
| 탭 구성 | 메인 대시보드 / 할 일 / 글자수 / 작업시간 / 위키 / 버전관리 |

### 할 일 관리
| 기능 | 설명 |
|------|------|
| 자동 파싱 | `- [ ]` 형식 태스크 자동 파싱 |
| 마감일 분류 | `due:` 또는 📅 기반으로 오늘/예정/지연 분류 |
| 인라인 추가 | 팝업으로 할 일 추가, 완료 시 날짜 자동 기록 |

### 버전 관리
| 기능 | 설명 |
|------|------|
| 스냅샷 저장 | 이름과 단계를 지정하여 스냅샷 저장 |
| 사이드 바이 사이드 diff | 버전 간 변경 내용 시각적 비교 |
| 구간 되돌리기 | 특정 구간만 이전 버전으로 선택 복원 |
| 단계 태그 | 초고·퇴고·연출 등 색상 코드 단계 태그 |

### 플롯 매니저 (F9)
| 기능 | 설명 |
|------|------|
| 구조 | 에피소드 › 회차 › 장면 계층으로 열 관리 |
| 플롯 라인 행 | 장면별 플롯 메모 |
| 인물 행 | 장면별 등장인물 역할 메모 |
| 마크다운 저장 | 에피소드별 `.md` 파일 저장, 양방향 동기화 |
| 캐릭터 노트 | 노트 생성 또는 연결, 템플릿 적용, 지정 폴더 자동 이동 |
| 플롯 타임라인 (F11) | 선택 셀에 연동되는 왼쪽 사이드바 타임라인 뷰 |
| 일괄 작업 | 장면 일괄 생성 / 삭제 드롭다운 |
| 단축키 | 방향키 이동, Enter/더블클릭 편집, Shift+F 회차 검색, Ctrl+휠 확대/축소 |

### 위키 뷰
| 기능 | 설명 |
|------|------|
| 카드 뷰 | 폴더 단위 인물·설정 카드 뷰 |
| 그룹·정렬 | 커스텀 그룹 규칙, 정렬 규칙, 저장된 뷰 |
| 관계 시각화 | 관계 프론트매터 키 기반 스트립 목록 |
| 프로필 편집 | 프로필 이미지·속성 직접 편집 |

### 내보내기
| 기능 | 설명 |
|------|------|
| TXT 내보내기 | 헤딩·각주 제거, 공백 들여쓰기 옵션 |
| HWP 내보내기 | Windows 전용, Python 변환 스크립트 사용 |
| 일괄 내보내기 | 단일 파일 / 폴더 / 다중 선택 일괄 처리 |

### 사전 / 한자 변환 (F3)
| 기능 | 설명 |
|------|------|
| 표준국어대사전 | 국립국어원 API 연동 검색 |
| 한자 변환 | 괄호 병기 모드 포함 |

### 포모도로 스톱워치
| 기능 | 설명 |
|------|------|
| 카운트다운 | 설정 가능한 카운트다운 타이머 |
| 알람음 | 타이머 종료 시 효과음 재생 |

### 음악 플레이어
| 기능 | 설명 |
|------|------|
| 볼트 내 재생 | 볼트에 저장된 오디오 파일 재생 |
| 재생 모드 | 반복 / 한 곡 반복 / 셔플 |
| 즐겨찾기 | 자주 듣는 트랙 북마크 |

### 특수문자
| 기능 | 설명 |
|------|------|
| 삽입 패널 | 특수문자 검색 및 삽입 |
| 즐겨찾기 | 자주 쓰는 특수문자 별표 등록 |
| 사용자 지정 | 설명과 함께 커스텀 특수문자 등록 |

---

## 권한 및 시스템 접근

**HWP 내보내기** 기능은 다음의 시스템 권한을 사용합니다:

| 권한 | 용도 |
|------|------|
| 파일시스템 (`fs`, `path`) | 플러그인 디렉토리에 Python 변환 스크립트 저장, 내보내기 시 파일 읽기/쓰기 |
| 셸 실행 (`child_process`) | Python 3 프로세스를 실행하여 Markdown을 HWP로 변환 |

해당 권한은 Windows HWP 내보내기 기능에만 사용됩니다. 나머지 모든 기능은 Obsidian 기본 Vault API만 사용하며, 외부 서버로 데이터를 전송하지 않습니다.

---

## 설치

1. Obsidian 설정 → 커뮤니티 플러그인 → 파일에서 설치
2. `manifest.json`, `main.js`, `styles.css`를 `.obsidian/plugins/writing-menu/`에 복사
3. 플러그인 활성화

---

## 단축키

| 단축키 | 기능 |
|--------|------|
| `F3` | 사전 / 한자 변환 |
| `F4` | 젠 모드 (넓게 / 집중 / 해제 순환) |
| `F6` | 위키 폴더·노트 선택 |
| `F9` | 플롯 매니저 열기/닫기 |
| `F11` | 플롯 타임라인 사이드바 열기/닫기 |
| `Alt+C` | 헤딩·각주 제외 복사 |

---

## 설정

설정창은 카테고리 페이지 방식으로 구성됩니다:

| 카테고리 | 주요 항목 |
|----------|-----------|
| 서식 | 폰트, 행간, 줄너비, 헤딩·각주 서식, 집중/타자기 모드, 커스텀 구분선 |
| 입력 보조 | 스마트 인용부호, 기호 트리거, 텍스트 치환 |
| 복사 및 내보내기 | 헤딩·각주 제외 복사, TXT/HWP 경로 |
| 글자수 & 작업 시간 | 추적 폴더, 제외 폴더, 데일리노트 키, 작업 모드 |
| 캘린더 & 일정 관리 | 할 일 헤더, 미리보기 항목 |
| 버전 관리 | 저장 경로, 최대 보관 수, 단계 색상 |
| 스톱워치 | 타이머 시간, 알람음 |
| 음악 플레이어 | 음악 폴더, 볼륨, 재생 모드 |
| 위키 뷰 | 카드 색상, 이미지·이름·관계 필드 |
| 플롯 매니저 | 루트 폴더, 플롯 폴더명, 캐릭터 폴더명, 캐릭터 노트 템플릿, 열기 방식 |
| 사전 | 표준국어대사전 API 키 |
| 맞춤법 검사 | 고유명사 사전 |
| 특수문자 | 삽입 후 닫기 설정, 즐겨찾기 |

---

## 데이터 파일

| 파일 | 설명 |
|------|------|
| `.writing-menu-today.json` | 오늘 글자수 스냅샷 (자동 관리) |
| `.writing-menu-versions/` | 버전 스냅샷 저장 폴더 |
| 데일리노트 프론트매터 | `글자수`, `{프로젝트}_{모드}_시간` 등 자동 기록 |

---

## 기술 구조

```
src/
  calendar/        캘린더 뷰, 날짜 스트립, 미리보기 팝업
  dashboard/       대시보드 섹션, 글자수·시간 렌더러
    data/          DailyCharStore, WritingTimeStore, TaskParser
  editor/          헤딩 위젯
  export/          TXT / HWP 내보내기
  preview/         모바일 미리보기
  settings/        설정 탭 (페이지 라우터)
  spellcheck/      맞춤법 검사 서비스 및 교정 모달
  utils/           날짜, 시간, DOM, 데일리노트 유틸리티
  plot/            플롯 매니저·타임라인 뷰
  version/         버전 저장·diff
  views/           작업시간 사이드바 뷰
  wiki/            위키 패널·설정
main.ts            플러그인 진입점
```

---

## 라이선스

MIT
