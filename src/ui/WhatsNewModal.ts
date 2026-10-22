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
		version: '3.4.3',
		date: '2026-10-22',
		improved: [
			'사용하지 않는 색인 모델을 제거해 배포 용량을 줄였습니다.',
			'기존 디자인을 유지하며 CSS 호환성 코드를 정리했습니다.',
		],
		fixed: ['플러그인 소스 검사에서 의존성 설치가 실패하던 문제를 수정했습니다.'],
	},
	{
		version: '3.4.2',
		date: '2026-10-22',
		improved: [
			'Obsidian 1.13 이상에서 설정 검색을 지원합니다.',
			'파일 처리와 한글 입력·분석 기능의 안정성을 개선했습니다.',
			'기존 디자인을 유지하며 플러그인 검사 기준에 맞게 코드를 정리했습니다.',
		],
	},
	{
		version: '3.4.1',
		date: '2026-10-22',
		fixed: [
			'Obsidian 1.7.2에서도 여러 쪽 보기의 문서별 배율을 기기에 저장합니다.',
			'편집기·플롯·퇴고 차트·툴바의 스타일 처리를 공식 플러그인 검사 규칙에 맞게 정리했습니다.',
		],
	},
	{
		version: '3.4.0',
		date: '2026-10-21',
		new: [
			'여러 쪽 보기: PC에서 원고를 페이지로 펼쳐 편집하고 Markdown과 공통 작성 툴바를 사용합니다.',
			'플롯 매니저: 시트와 행·열 사이드바로 인물·상태·복선·체크리스트를 관리하고 Markdown으로 내보냅니다.',
			'Deus AI: 로컬 RAG로 작품 자료를 찾아 답변합니다. @노트 참고, /character 장면 대화와 프로젝트별 대화 관리를 지원합니다.',
			'스냅샷: 원고·플롯을 비교·복원하며 원고 변경 구간 선택과 기기 간 플롯 전달을 지원합니다.',
			'퇴고 매니저: 현재 원고 또는 프로젝트 전체의 문장·단락·반복표현을 분석합니다.',
		],
		improved: [
			'AI 출처: 각주로 원문을 확인하며 현재 탭·새 탭 열기를 설정할 수 있습니다.',
			'모바일: 글꼴 선택·오프라인 캐시를 지원하고 작성 툴바·사전·맞춤법·특수문자 화면을 정리했습니다.',
			'대시보드·위키: 집필 통계·일정과 인물 프로필·관계 그래프를 개선했습니다.',
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
		header.createSpan({ cls: 'wm-wn-date', text: this.note.date });

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
			sectionHeader.createSpan({ cls: 'wm-wn-section-label', text: label });

			const itemsEl = section.createDiv({ cls: 'wm-wn-items' });
			for (const item of items) {
				const text = typeof item === 'string' ? item : item.text;
				const bannerUrl = typeof item === 'object' ? item.bannerUrl : undefined;
				if (bannerUrl) {
					itemsEl.createDiv({ cls: 'wm-wn-item-banner' })
						.createEl('img', { attr: { src: bannerUrl, alt: text } });
				}
				itemsEl.createDiv({ cls: 'wm-wn-item' }).createSpan({ text });
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
