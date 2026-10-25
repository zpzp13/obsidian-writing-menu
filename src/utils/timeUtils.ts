import { wmT } from '../i18n/index';
import { scalarText } from './typeGuards';

/** seconds → "HH:MM:SS" (프론트매터 저장용) */
export function toHMS(sec: number): string {
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = sec % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 다른 Markdown 문서 전체를 붙여넣을 때 해당 문서의 누적 작업시간까지
 * 현재 문서로 복사되지 않도록, 맨 앞 YAML 블록의 추적 필드만 제거한다.
 * 본문 중간의 `---`나 일반 텍스트는 변경하지 않는다.
 */
export function stripTrackedTimeFieldsFromPaste(text: string, keys: string[]): string {
	if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return text;
	const frontmatterMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/);
	if (!frontmatterMatch) return text;

	const trackedKeys = new Set(keys.map(key => key.trim()).filter(Boolean));
	if (trackedKeys.size === 0) return text;

	const yaml = frontmatterMatch[1];
	const lines = yaml.split(/\r?\n/);
	const newline = text.startsWith('---\r\n') ? '\r\n' : '\n';
	const filtered = lines.filter(line => {
		// Only top-level scalar keys are time metadata. Indented/nested content is
		// deliberately left alone even if it contains the same text.
		if (/^[\t ]/.test(line)) return true;
		const separator = line.indexOf(':');
		if (separator < 0) return true;
		const rawKey = line.slice(0, separator).trim();
		const key = rawKey.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_m, doubleQuoted: string | undefined, singleQuoted: string | undefined) => doubleQuoted ?? singleQuoted ?? rawKey);
		return !trackedKeys.has(key);
	});

	if (filtered.length === lines.length) return text;
	const replacement = `---${newline}${filtered.join(newline)}${newline}---`;
	return replacement + text.slice(frontmatterMatch[0].length);
}

/** "HH:MM:SS" 또는 "MM:SS" 문자열 → seconds */
export function parseTimeHMS(val: unknown): number {
	if (!val) return 0;
	const parts = scalarText(val).trim().split(':').map(Number);
	if (parts.some(isNaN)) return 0;
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	return 0;
}

/** seconds → 한국어 표시 ("X시 MM분 SS초"). 0이면 "—" */
export function fmtTimeFull(sec: number): string {
	if (sec <= 0) return '—';
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = sec % 60;
	if (h > 0) return wmT("{0}시 {1}분 {2}초", h, String(m).padStart(2, '0'), String(s).padStart(2, '0'));
	if (m > 0) return wmT("{0}분 {1}초", m, String(s).padStart(2, '0'));
	return wmT("{0}초", s);
}

/** seconds → 콜론 표기 ("H:MM:SS" 또는 "M:SS"). 0이면 "—" */
export function fmtColons(sec: number): string {
	if (sec <= 0) return '—';
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = sec % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}
