/** Convert only the typed straight quote; pairing belongs to the host editor. */
export function curvedQuoteAt(source: string, position: number, value: string): string | null {
	if (value !== '"' && value !== "'") return null;
	const open = value === '"' ? '“' : '‘';
	const close = value === '"' ? '”' : '’';
	const line = source.slice(source.lastIndexOf('\n', position - 1) + 1, position);
	// An apostrophe within a word always points inward.
	if (value === "'" && /[\p{L}\p{N}]$/u.test(line)) return close;
	if (line.lastIndexOf(open) > line.lastIndexOf(close)) return close;
	return !line || /[\s([{<「『【《—–]$/u.test(line) ? open : close;
}
