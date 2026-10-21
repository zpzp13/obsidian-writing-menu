import { App, Modal, setIcon } from 'obsidian';

const BASE_URL = 'https://raw.githubusercontent.com/zpzp13/obsidian-writing-menu/main';

type ReleaseItem = string | { text: string; bannerUrl: string };

interface ReleaseNote {
	version: string;
	date: string;
	new?: ReleaseItem[];
	improved?: ReleaseItem[];
	fixed?: ReleaseItem[];
	notice?: ReleaseItem[];
}

const RELEASE_NOTES: ReleaseNote[] = [
	{
		version: '3.4.0',
		date: '2026-10-21',
		new: [
			'여러 쪽 보기: 하나의 Markdown 원고를 여러 페이지로 펼쳐 편집합니다. 페이지 사이의 커서 이동·드래그 선택·한글 조합 입력과 확대·축소를 지원합니다. (PC 전용)',
			'공통 작성 툴바: Markdown과 여러 쪽 보기에서 글꼴·크기·서식·글자색, 복사·내보내기, 길게 보기·집중 모드, 글자수·타이머·작업시간을 같은 툴바로 사용합니다.',
			'플롯 매니저 전면 개편: 프로젝트별 시트에서 행·열·하위 행, 인물·상태·라벨·복선과 셀 서식을 관리합니다. 검색, 여러 셀 편집·붙여넣기, 실행 취소·다시 실행과 이전 플롯 가져오기를 지원합니다.',
			'플롯 사이드바와 체크리스트: 프로젝트·시트·행 또는 열을 선택해 연결된 내용을 카드로 확인하고 수정합니다. 체크리스트 항목 추가·수정·이동·완료 처리를 표·팝업·사이드바에서 함께 사용합니다.',
			'원고 스냅샷: 이름·메모·상태·고정으로 기록을 관리하고, 변경된 글자와 접힌 동일 구간을 비교하며 전체 또는 선택한 변경 구간만 복원합니다.',
			'퇴고 매니저: 기존 반복표현 화면을 단락·문장·반복표현 분석으로 개편했습니다. 현재 원고 또는 프로젝트 전체를 분석하고 해당 문맥으로 이동합니다.',
			'Deus AI: 기존 AI 챗을 프로젝트 자료 조사와 집필 보조 공간으로 통합했습니다. 본문·인물·플롯 검색, 인물 관계·회차·행적 조회, @노트 참고와 내부 노트 링크를 지원합니다.',
			'Character 스킬: /character로 현재 원고·선택문·플롯 장면이나 직접 제시한 가정 상황을 인물별 프로필·대사·지문이 있는 캐릭터 대화로 시험합니다.',
			'AI 프로젝트·세션 관리: 넓은 창의 크기 조절 가능한 사이드바에서 대화를 검색·고정·수정·내보내기하고 새 대화로 분기합니다. 참고 자료의 포함 여부는 입력창 +에서 관리합니다.',
			'플롯 스냅샷 전달: 시트 서식·복선·체크리스트를 포함한 Markdown 스냅샷을 저장해 다른 기기로 전달하고 현재 프로젝트에 수동 복원합니다.',
			'모바일 글꼴: PC와 별도로 리디바탕·마루 부리·나눔명조·나눔고딕·프리텐다드·스포카 한 산스 네오를 선택하고 기기에 캐시해 오프라인에서도 사용합니다.',
		],
		improved: [
			'여러 쪽 보기: 긴 원고의 입력·재페이지화·타자기 스크롤을 최적화하고, 페이지 경계의 방향키·Backspace·선택·우클릭 명령을 보완했습니다. 배율은 문서별로 기기에 저장합니다.',
			'플롯 편집: 큰 시트의 고속 스크롤, 긴 셀의 줄바꿈·미리보기·편집창 크기, 검색 결과 이동과 선택 동작을 다듬고 읽기용 Markdown 내보내기를 추가했습니다.',
			'모바일 작성 환경: 순정 헤더를 따라 편집 툴바를 표시하고, 좁은 화면과 키보드에 맞춰 메뉴·사전·특수문자·맞춤법 직접 수정창을 배치합니다.',
			'AI 출처: 각주를 일관된 +n 버튼으로 표시하고 접힌 출처 목록, 원문 위치 이동과 Obsidian Ctrl/Cmd 미리보기에 연결했습니다. 기본으로 현재 탭에서 열며 설정에서 새 탭으로 바꿀 수 있습니다.',
			'AI 대화: @참고를 제목 링크로 표시하고, 일반 답변과 캐릭터 대화를 구분합니다. 스트리밍을 따라 스크롤하며 위로 스크롤하면 따라가기를 멈춥니다.',
			'AI 설정: 기본 검색·회차 조회·인물 행적 조회를 알아둬야 할 것들에 모았습니다. 사용하지 않는 프롬프트 노트·인물 설정 헤딩·확인·동의 항목을 정리하고 스트리밍과 Character 글자 크기 설정은 유지합니다.',
			'대시보드와 위키: 집필 통계·작업시간·달력·할 일 표시를 정리하고 인물 카드·프로필·관계 그래프와 프로젝트 연동을 보완했습니다.',
		],
		fixed: [
			'여러 쪽 보기 저장을 직렬화하고 외부 변경·Sync 충돌 시 양쪽 원문을 보존합니다. 검토 중 새로운 변경이 오면 오래된 선택으로 덮어쓰지 않습니다.',
			'원고·플롯 복원 전에 백업을 검증하고, 비교 후 바뀐 문서의 오래된 복원을 차단합니다. 원고의 변경 구간 복원은 한 번의 실행 취소로 되돌릴 수 있습니다.',
			'모바일 헤더 전환 때 툴바가 늦게 나타나거나 겹치는 문제와 플롯 선택·검색·체크리스트 편집의 동기화를 수정했습니다.',
			'Gemini 429 사용 한도와 503 서버 오류를 구분하고 제공된 재시도 시각을 안내합니다. 중단한 스트림의 늦은 응답과 잘못된 API 응답 형식 처리를 보강했습니다.',
			'퇴고 프로젝트 분석에서 하위 프로젝트를 제외하고 저장 전 편집을 반영합니다. 패널을 닫은 뒤 불필요한 원고 읽기를 중단합니다.',
		],
		notice: [
			'여러 쪽 보기·새 플롯 매니저부터 Deus AI까지 누적된 개편 사항을 안내합니다. 기존 원고·대화 기록은 보존합니다.',
			'이전 초고·이미지 생성, 단어장, 기억·임시 대화와 검증 전 초안 기능을 정리했습니다. AI 문맥·출력 토큰은 사용자 설정과 실제 제공자 한도를 따릅니다.',
		],
	},
	{
		version: '3.1.2',
		date: '2026-07-08',
		notice: [
		],
	},
	{
		version: '3.0.16',
		date: '2026-06-23',
		new: [
			{ text: '커스텀 구분선: --- 구분선을 이미지·SVG·CSS 스타일로 꾸밀 수 있습니다 (폴더 조건 적용 가능)', bannerUrl: `${BASE_URL}/images/커스텀구분선.png` },
			{ text: '맞춤법 검사기 (F8): Daum 웹 API 기반 맞춤법 검사, 고유명사 사전 등록, 교정 제안 적용 지원 (비상업적 개인 이용 한정)', bannerUrl: `${BASE_URL}/images/맞춤법검사기.png` },
		],
		improved: [
			'설정 UI 전면 재설계: 기능별 페이지 그룹화, 항목별 설명 추가, 입력 컨트롤 크기 통일',
		],
	},
	{
		version: '3.0.15',
		date: '2026-06-21',
		new: [
			'특수문자 모달 (F10): 즐겨찾기 등록/관리, 사용자 지정 특수문자 추가 지원',
		],
		improved: [
			'일평균 글자수 실시간 반영 — 이전에는 타이핑을 다시 해야 갱신됐던 문제 해결',
			'모드별 작업시간 평균 업데이트 오류 수정',
			'글자수 카드 렌더링 최적화 (DOM 재생성 → text node 갱신)',
			'타자기 스크롤: 엔터 입력 시 화면 흔들림 현상 해결',
		],
		fixed: [
			'설정 UI 각종 레이아웃 정리 (작업 모드 섹션, 음악 폴더 버튼 위치 등)',
		],
	},
];

export function getLatestReleaseNote(): ReleaseNote | null {
	return RELEASE_NOTES[0] ?? null;
}

export function shouldShowWhatsNew(lastSeenVersion: string | undefined, currentVersion: string): boolean {
	if (!lastSeenVersion) return true;
	return lastSeenVersion !== currentVersion;
}

export class WhatsNewModal extends Modal {
	constructor(app: App, private note: ReleaseNote, private onCloseCb?: () => void) {
		super(app);
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		modalEl.addClass('wm-whats-new-modal');
		contentEl.empty();

		const body = contentEl.createDiv({ cls: 'wm-wn-body' });

		const header = body.createDiv({ cls: 'wm-wn-header' });
		header.createEl('h2', { cls: 'wm-wn-title', text: `v${this.note.version} 업데이트` });
		header.createEl('span', { cls: 'wm-wn-date', text: this.note.date });

		const sections: { key: keyof ReleaseNote; label: string; icon: string }[] = [
			{ key: 'notice',   label: '공지',      icon: 'megaphone' },
			{ key: 'new',      label: '새 기능',   icon: 'sparkles' },
			{ key: 'improved', label: '개선',      icon: 'arrow-up-circle' },
			{ key: 'fixed',    label: '버그 수정',  icon: 'wrench' },
		];

		for (const { key, label, icon } of sections) {
			const items = this.note[key] as ReleaseItem[] | undefined;
			if (!items?.length) continue;

			const section = body.createDiv({ cls: 'wm-wn-section' });
			const sectionHeader = section.createDiv({ cls: 'wm-wn-section-header' });
			const iconEl = sectionHeader.createSpan({ cls: 'wm-wn-section-icon' });
			setIcon(iconEl, icon);
			sectionHeader.createEl('span', { cls: 'wm-wn-section-label', text: label });

			const itemsEl = section.createDiv({ cls: 'wm-wn-items' });
			for (const item of items) {
				const text = typeof item === 'string' ? item : item.text;
				const bannerUrl = typeof item === 'object' ? item.bannerUrl : undefined;
				if (bannerUrl) {
					itemsEl.createDiv({ cls: 'wm-wn-item-banner' })
						.createEl('img', { attr: { src: bannerUrl, alt: text } });
				}
				itemsEl.createDiv({ cls: 'wm-wn-item' }).createEl('span', { text });
			}
		}

		const footer = body.createDiv({ cls: 'wm-wn-footer' });
		const closeBtn = footer.createEl('button', { cls: 'mod-cta', text: '확인' });
		closeBtn.addEventListener('click', () => this.close());
	}

	onClose() {
		this.contentEl.empty();
		this.onCloseCb?.();
	}
}
