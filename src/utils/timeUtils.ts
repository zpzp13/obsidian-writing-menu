/** seconds → "HH:MM:SS" (프론트매터 저장용) */
export function toHMS(sec: number): string {
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = sec % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "HH:MM:SS" 또는 "MM:SS" 문자열 → seconds */
export function parseTimeHMS(val: unknown): number {
	if (!val) return 0;
	const parts = String(val).trim().split(':').map(Number);
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
	if (h > 0) return `${h}시 ${String(m).padStart(2, '0')}분 ${String(s).padStart(2, '0')}초`;
	if (m > 0) return `${m}분 ${String(s).padStart(2, '0')}초`;
	return `${s}초`;
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
