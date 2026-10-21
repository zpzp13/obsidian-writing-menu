interface LineEdit { from: number; to: number; lines: string[] }

/** Exact, deliberately conservative merge. No fuzzy matching or patch insertion. */
export function mergePagedLines(base: string, local: string, remote: string): string | null {
	if (local === remote || remote === base) return local;
	if (local === base) return remote;
	const a = base.split('\n'), b = local.split('\n'), c = remote.split('\n');
	if (a.length * Math.max(b.length, c.length) > 1_000_000) return null;
	const changes = (next: string[]): LineEdit[] => {
		const width = next.length + 1, table = new Uint32Array((a.length + 1) * width);
		for (let i = a.length - 1; i >= 0; i--) for (let j = next.length - 1; j >= 0; j--)
			table[i * width + j] = a[i] === next[j] ? 1 + table[(i + 1) * width + j + 1]
				: Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
		const edits: LineEdit[] = []; let i = 0, j = 0, edit: LineEdit | undefined;
		while (i < a.length || j < next.length) {
			if (i < a.length && j < next.length && a[i] === next[j]) { edit = undefined; i++; j++; continue; }
			if (!edit) { edit = { from: i, to: i, lines: [] }; edits.push(edit); }
			if (j < next.length && (i === a.length || table[i * width + j + 1] >= table[(i + 1) * width + j])) edit.lines.push(next[j++]);
			else edit.to = ++i;
		}
		return edits;
	};
	const left = changes(b), right = changes(c);
	// Repeated nonempty lines make edit attribution ambiguous, particularly
	// deletion/reinsertion. Send those documents to review rather than guess.
	const seen = new Set<string>();
	for (const line of a) if (line.trim()) { if (seen.has(line)) return null; seen.add(line); }
	for (const x of left) for (const y of right)
		if (x.from <= y.to + 1 && y.from <= x.to + 1) return null;
	const result = [...a];
	for (const edit of [...left, ...right].sort((x, y) => y.from - x.from))
		result.splice(edit.from, edit.to - edit.from, ...edit.lines);
	return result.join('\n');
}
