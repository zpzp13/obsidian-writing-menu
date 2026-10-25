import type { TimeModeConfig } from '../types';
import { wmT } from './index';

/** Translate built-in labels at display time without rewriting saved names or metadata keys. */
export function timeModeLabel(mode: Pick<TimeModeConfig, 'id' | 'label'>): string {
	const defaults: Record<string, readonly string[]> = {
		draft: ['기획', '초고'], writing: ['초고', '집필'], editing: ['퇴고'],
	};
	return defaults[mode.id]?.includes(mode.label) ? wmT(mode.label) : mode.label;
}

export function dashboardSectionLabel(id: string, label: string): string {
	const defaults: Record<string, readonly string[]> = {
		calendar: ['일정'], timer: ['타이머'], chars: ['글자수'], time: ['작업 시간', '작업시간'], music: ['음악'],
	};
	return defaults[id]?.includes(label) ? wmT(label) : label;
}
