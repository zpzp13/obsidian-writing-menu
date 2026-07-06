import { setIcon } from 'obsidian';
import type { RepetitionKind, RepetitionResult } from './types';
import { colorClass } from './palette';

export const KIND_LABEL: Record<RepetitionKind, string> = { word: '단어', eojeol: '어절', eomi: '어미' };
export const KINDS: RepetitionKind[] = ['word', 'eojeol', 'eomi'];

export interface KindStat {
	kind: RepetitionKind;
	label: string;
	count: number;
}

/** 단어/어절/어미 각각의 반복 표현 "개수"(등장 횟수 총합이 아니라 서로 다른 반복 표현의 수) — 도넛 비율용 */
export function buildKindStats(result: RepetitionResult): KindStat[] {
	return KINDS.map(kind => ({
		kind,
		label: KIND_LABEL[kind],
		count: result[kind].length,
	}));
}

/** "Expences ⌄" 스타일 커스텀 드롭다운 — 색 점 + 라벨 + 화살표를 알약 모양 안에 표시 */
export function renderKindDropdown(
	container: HTMLElement,
	activeKind: RepetitionKind,
	result: RepetitionResult,
	onSelect: (kind: RepetitionKind) => void,
): void {
	const activeIdx = KINDS.indexOf(activeKind);
	const wrap = container.createDiv({ cls: 'wm-rep-dropdown' });
	const btn = wrap.createDiv({ cls: 'wm-rep-dropdown-btn' });
	btn.createSpan({ cls: ['wm-rep-dropdown-dot', colorClass(activeIdx)] });
	btn.createSpan({ cls: 'wm-rep-dropdown-label', text: `${KIND_LABEL[activeKind]} (${result[activeKind].length})` });
	const chevron = btn.createSpan({ cls: 'wm-rep-dropdown-chevron' });
	setIcon(chevron, 'chevron-down');

	const menu = wrap.createDiv({ cls: 'wm-rep-dropdown-menu is-hidden' });
	KINDS.forEach((kind, i) => {
		const item = menu.createDiv({ cls: 'wm-rep-dropdown-item' + (kind === activeKind ? ' is-active' : '') });
		item.createSpan({ cls: ['wm-rep-dropdown-dot', colorClass(i)] });
		item.createSpan({ text: `${KIND_LABEL[kind]} (${result[kind].length})` });
		item.addEventListener('click', (e) => {
			e.stopPropagation();
			menu.addClass('is-hidden');
			onSelect(kind);
		});
	});

	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		menu.toggleClass('is-hidden', !menu.hasClass('is-hidden'));
	});
	const closeOnOutsideClick = () => menu.addClass('is-hidden');
	document.addEventListener('click', closeOnOutsideClick);
}
