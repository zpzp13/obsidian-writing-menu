import { wmT } from '../i18n/index';
import { computeLineDiff, type DiffHunk } from './diff';

export interface SnapshotComparison { before: string; current: string; hunks: DiffHunk[] }
export function compareSnapshot(before: string, current: string): SnapshotComparison {
	return { before, current, hunks: computeLineDiff(before, current) };
}

/** Line arrays retain CRLF characters and the terminal-empty-line sentinel. */
export function restoreSnapshotHunks(comparison: SnapshotComparison, selected: ReadonlySet<number>): string {
	const lines = comparison.current ? comparison.current.split('\n') : [];
	const indexes = [...selected].sort((a, b) => b - a);
	for (const index of indexes) {
		const hunk = comparison.hunks[index];
		if (!hunk || hunk.type === 'equal') throw new Error(wmT("복원할 변경 구간을 다시 선택해 주세요."));
		lines.splice(hunk.bStart, hunk.bLines.length, ...hunk.aLines);
	}
	return lines.join('\n');
}
