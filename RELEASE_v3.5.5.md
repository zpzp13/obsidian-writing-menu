# 3.5.5 업데이트 내용

## 새로운 기능

### 1. 에디터 툴바의 위젯 기능이 개편되었습니다.

- 이제 위젯은 별도의 공간으로 분리되며, 플러그인 설정 → 편집기 → 위젯에서 정렬 순서를 조정할 수 있습니다.
- 목표 글자수와 작업 시간 위젯이 새롭게 추가되었습니다.

![에디터 위젯의 정렬과 순서 변경 데모](https://github.com/zpzp13/obsidian-writing-menu/releases/download/3.5.5/01-editor-widgets.gif)

[데모 영상 보기 · 22초 · MP4](https://github.com/zpzp13/obsidian-writing-menu/releases/download/3.5.5/01-editor-widgets.mp4)

### 2. 에디터 툴바의 글자색/하이라이트를 분리하고, 마크다운 뷰와 여러 쪽 보기의 글자 서식을 통일했습니다.

- 이제 마크다운 뷰와 여러 쪽 보기의 각 영역에서 지정된 서식이 다른 영역에서도 똑같이 적용됩니다. 예를 들어, 마크다운 뷰에서 HTML로 작성된 글자색이 여러 쪽 보기에도 반영되는 식입니다.

![글자색과 하이라이트를 적용하고 두 보기에서 서식을 확인하는 데모](https://github.com/zpzp13/obsidian-writing-menu/releases/download/3.5.5/02-shared-text-formatting.gif)

[데모 영상 보기 · 28초 · MP4](https://github.com/zpzp13/obsidian-writing-menu/releases/download/3.5.5/02-shared-text-formatting.mp4)

### 3. 하이라이트 주석이 추가되었습니다.

- 에디터에서 우클릭 혹은 툴바의 아이콘을 사용해 하이라이트를 적용하면, 메모를 입력할 수 있습니다.
- 메모는 별도의 팝업창에서 등록할 수도 있지만, 대시보드 → REVISION 탭의 툴바 메뉴 '하이라이트 코멘트로 전환'을 통해 종합적으로 관리할 수 있습니다. 대시보드의 주석 관리 센터는 타임라인 형태로, 글의 흐름에 따라 직관적으로 메모를 확인할 수 있습니다.

![하이라이트에 메모를 남기고 타임라인에서 관리하는 데모](https://github.com/zpzp13/obsidian-writing-menu/releases/download/3.5.5/03-highlight-comments.gif)

[데모 영상 보기 · 28초 · MP4](https://github.com/zpzp13/obsidian-writing-menu/releases/download/3.5.5/03-highlight-comments.mp4)

### 4. 대시보드에 Review 탭이 추가되었습니다.

- 이제 Review 탭에서 문피아 웹사이트에 등록된 내 작품의 지표를 추적할 수 있습니다.
- 플러그인 설정 → 대시보드 → 리뷰 혹은 대시보드 → REVIEW 탭에서 작품 링크(문피아만 가능)를 등록할 수 있습니다.
- REVIEW 탭의 작품 정보와 댓글 반응은 DEUS AI와 연동되어 있습니다. Google API, Claude Code, Codex를 연결해 보세요. 단, CLI는 제공사에서 유료 모델로 취급하고 있어 별도의 결제가 필요합니다. 타사의 제공 정책과 Writing Menu는 아무런 상관없습니다. Writing Menu는 그 어떤 유료 결제도 강요하지 않습니다.
- 작품 정보와 일부 지표(24시간 지표)는 각 노트의 프론트매터로 저장됩니다. 24시간 지표의 경우 공개 후 24시간 동안 주기적으로 데이터를 수집합니다.
- 댓글 반응은 문피아 로고 아이콘 → 옵시디언 내장 웹뷰에서 로그인한 뒤, 등록된 작품과 현재 노트의 회차를 추적해 댓글을 가져옵니다. 가져온 댓글은 DEUS AI의 판단에 따라 부정적인 댓글을 숨기거나 순화하여 사용자에게 제공합니다. 연재 시 악플을 보고 싶지 않은 분들께 유용합니다.

![Review 탭에서 작품 지표와 댓글 반응을 확인하는 데모](https://github.com/zpzp13/obsidian-writing-menu/releases/download/3.5.5/04-review-dashboard.gif)

[데모 영상 보기 · 27초 · MP4](https://github.com/zpzp13/obsidian-writing-menu/releases/download/3.5.5/04-review-dashboard.mp4)

> 데모에는 공개용으로 작성한 가상 원고를 사용했습니다. Review 데모의 지표와 댓글은 가상 자료이며, AI 분석은 미리 작성한 예시입니다.

## 고친 것

1. 에디터 툴바의 아이콘 위치를 직관적으로 변경했습니다.
2. 변경 사항에 따른 불필요한 코드를 정리했습니다.
3. 플러그인 설정창에서 불필요한 요소를 정리했습니다.

[데모 영상 4개 한 번에 내려받기 · ZIP](https://github.com/zpzp13/obsidian-writing-menu/releases/download/3.5.5/writing-menu-3.5.5-demos.zip)
