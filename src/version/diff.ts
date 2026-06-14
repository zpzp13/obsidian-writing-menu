import dmp from 'diff-match-patch';

export const DIFF_DELETE = -1;
export const DIFF_INSERT = 1;
export const DIFF_EQUAL = 0;

export type DiffHunkType = 'equal' | 'insert' | 'delete' | 'replace';

export interface DiffHunk {
	type: DiffHunkType;
	aStart: number;
	bStart: number;
	aLines: string[];
	bLines: string[];
}

export interface InlineSeg {
	op: number;
	text: string;
}

// ── LCS-based line diff (reliable, no external line-encoding tricks) ────

function lcsOps(linesA: string[], linesB: string[]): { op: number; line: string }[] {
	const m = linesA.length, n = linesB.length;
	if (m === 0 && n === 0) return [];

	// Size guard: if too large, return naive replace
	if (m * n > 6_000_000) {
		return [
			...linesA.map(line => ({ op: DIFF_DELETE, line })),
			...linesB.map(line => ({ op: DIFF_INSERT, line })),
		];
	}

	// DP table using typed array for speed
	const dp = new Int32Array((m + 1) * (n + 1));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (linesA[i - 1] === linesB[j - 1]) {
				dp[i * (n + 1) + j] = dp[(i - 1) * (n + 1) + (j - 1)] + 1;
			} else {
				const up = dp[(i - 1) * (n + 1) + j];
				const left = dp[i * (n + 1) + (j - 1)];
				dp[i * (n + 1) + j] = up > left ? up : left;
			}
		}
	}

	// Backtrack
	const ops: { op: number; line: string }[] = [];
	let i = m, j = n;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
			ops.push({ op: DIFF_EQUAL, line: linesA[i - 1] });
			i--; j--;
		} else if (j > 0 && (i === 0 || dp[i * (n + 1) + (j - 1)] >= dp[(i - 1) * (n + 1) + j])) {
			ops.push({ op: DIFF_INSERT, line: linesB[j - 1] });
			j--;
		} else {
			ops.push({ op: DIFF_DELETE, line: linesA[i - 1] });
			i--;
		}
	}
	ops.reverse();
	return ops;
}

export function computeLineDiff(textA: string, textB: string): DiffHunk[] {
	const linesA = textA ? textA.split('\n') : [];
	const linesB = textB ? textB.split('\n') : [];

	// Trim common prefix
	let prefixLen = 0;
	const minLen = Math.min(linesA.length, linesB.length);
	while (prefixLen < minLen && linesA[prefixLen] === linesB[prefixLen]) prefixLen++;

	// Trim common suffix (only from non-prefix region)
	let suffixLen = 0;
	while (
		suffixLen < linesA.length - prefixLen &&
		suffixLen < linesB.length - prefixLen &&
		linesA[linesA.length - 1 - suffixLen] === linesB[linesB.length - 1 - suffixLen]
	) suffixLen++;

	const aEnd = linesA.length - suffixLen;
	const bEnd = linesB.length - suffixLen;
	const midA = linesA.slice(prefixLen, aEnd);
	const midB = linesB.slice(prefixLen, bEnd);

	const ops = lcsOps(midA, midB);

	// Build hunk list from ops
	const hunks: DiffHunk[] = [];
	let aIdx = 0;
	let bIdx = 0;

	// Prefix equal hunk
	if (prefixLen > 0) {
		hunks.push({ type: 'equal', aStart: 0, bStart: 0, aLines: linesA.slice(0, prefixLen), bLines: linesB.slice(0, prefixLen) });
		aIdx = prefixLen;
		bIdx = prefixLen;
	}

	// Middle hunks
	let i = 0;
	while (i < ops.length) {
		const op = ops[i].op;
		if (op === DIFF_EQUAL) {
			const eqLines: string[] = [];
			while (i < ops.length && ops[i].op === DIFF_EQUAL) { eqLines.push(ops[i].line); i++; }
			hunks.push({ type: 'equal', aStart: aIdx, bStart: bIdx, aLines: eqLines, bLines: [...eqLines] });
			aIdx += eqLines.length;
			bIdx += eqLines.length;
		} else {
			const delLines: string[] = [];
			const insLines: string[] = [];
			while (i < ops.length && ops[i].op === DIFF_DELETE) { delLines.push(ops[i].line); i++; }
			while (i < ops.length && ops[i].op === DIFF_INSERT) { insLines.push(ops[i].line); i++; }
			if (delLines.length > 0 && insLines.length > 0) {
				hunks.push({ type: 'replace', aStart: aIdx, bStart: bIdx, aLines: delLines, bLines: insLines });
			} else if (delLines.length > 0) {
				hunks.push({ type: 'delete', aStart: aIdx, bStart: bIdx, aLines: delLines, bLines: [] });
			} else if (insLines.length > 0) {
				hunks.push({ type: 'insert', aStart: aIdx, bStart: bIdx, aLines: [], bLines: insLines });
			}
			aIdx += delLines.length;
			bIdx += insLines.length;
		}
	}

	// Suffix equal hunk
	if (suffixLen > 0) {
		hunks.push({ type: 'equal', aStart: aIdx, bStart: bIdx, aLines: linesA.slice(aEnd), bLines: linesB.slice(bEnd) });
	}

	return hunks;
}

// ── Word-level inline diff (kept as diff-match-patch) ────────────────────

export function computeInlineDiff(lineA: string, lineB: string): InlineSeg[] {
	const engine = new dmp();
	const diffs = engine.diff_main(lineA, lineB);
	engine.diff_cleanupSemantic(diffs);
	return diffs.map(([op, text]) => ({ op, text }));
}
