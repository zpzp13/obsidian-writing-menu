import { App, Modal, setIcon } from 'obsidian';

const BASE_URL = 'https://raw.githubusercontent.com/zpzp13/obsidian-writing-menu/main';

interface ReleaseNote {
	version: string;
	date: string;
	bannerUrl?: string;
	bannerUrls?: string[];
	new?: string[];
	improved?: string[];
	fixed?: string[];
}

const RELEASE_NOTES: ReleaseNote[] = [
	{
		version: '3.0.16',
		date: '2026-06-22',
		bannerUrls: [
			`${BASE_URL}/images/커스텀 구분선.png`,
			`${BASE_URL}/images/맞춤법 검사기.png`,
		],
		new: [
			'커스텀 구분선: --- 구분선을 이미지·SVG·CSS 스타일로 꾸밀 수 있습니다 (폴더 조건 적용 가능)',
			'맞춤법 검사기 (F9): Daum / 부산대 나라맞춤법 검사기 중 선택, 고유명사 사전 등록, 교정 제안 적용 지원 (비상업적 개인 이용 한정)',
		],
		improved: [
			'설정 UI 전면 재설계: 페이지별 그룹화, 항목별 설명 추가, 입력 컨트롤 크기 통일',
		],
	},
	{
		version: '3.0.15',
		date: '2026-06-21',
		bannerUrl: `${BASE_URL}/images/특수문자.png`,
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

		const urls = this.note.bannerUrls ?? (this.note.bannerUrl ? [this.note.bannerUrl] : []);
		if (urls.length) {
			const banner = contentEl.createDiv({ cls: 'wm-wn-banner' });
			for (const url of urls) {
				banner.createEl('img', { attr: { src: url, alt: `v${this.note.version} 업데이트` } });
			}
		}

		const body = contentEl.createDiv({ cls: 'wm-wn-body' });

		const header = body.createDiv({ cls: 'wm-wn-header' });
		header.createEl('h2', { cls: 'wm-wn-title', text: `v${this.note.version} 업데이트` });
		header.createEl('span', { cls: 'wm-wn-date', text: this.note.date });

		const sections: { key: keyof ReleaseNote; label: string; icon: string }[] = [
			{ key: 'new',      label: '새 기능',  icon: 'sparkles' },
			{ key: 'improved', label: '개선',     icon: 'arrow-up-circle' },
			{ key: 'fixed',    label: '버그 수정', icon: 'wrench' },
		];

		for (const { key, label, icon } of sections) {
			const items = this.note[key] as string[] | undefined;
			if (!items?.length) continue;

			const section = body.createDiv({ cls: 'wm-wn-section' });
			const sectionHeader = section.createDiv({ cls: 'wm-wn-section-header' });
			const iconEl = sectionHeader.createSpan({ cls: 'wm-wn-section-icon' });
			setIcon(iconEl, icon);
			sectionHeader.createEl('span', { cls: 'wm-wn-section-label', text: label });

			const list = section.createEl('ul', { cls: 'wm-wn-list' });
			for (const item of items) {
				list.createEl('li', { text: item });
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
