import { gunzipSync } from 'fflate';

/** Read regular npm tar files without permitting links or paths outside the package. */
export function unpackKordocPackage(compressed: Uint8Array): Map<string, Uint8Array> {
	const tar = gunzipSync(compressed), files = new Map<string, Uint8Array>();
	if (tar.length > 80 * 1024 * 1024) throw new Error('Document engine archive is too large.');
	const decoder = new TextDecoder();
	const text = (bytes: Uint8Array): string => { const value = decoder.decode(bytes), end = value.indexOf(String.fromCharCode(0)); return end < 0 ? value : value.slice(0, end); };
	let nextPath = '';
	for (let offset = 0; offset + 512 <= tar.length;) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every(byte => byte === 0)) break;
		const sizeText = text(header.subarray(124, 136)).trim();
		if (!/^[0-7]+$/.test(sizeText)) throw new Error('Invalid document engine archive size.');
		const size = parseInt(sizeText, 8), start = offset + 512;
		if (!Number.isSafeInteger(size) || start + size > tar.length) throw new Error('Truncated document engine archive.');
		const contents = tar.subarray(start, start + size), type = header[156];
		offset = start + Math.ceil(size / 512) * 512;
		if (type === 120) {
			// POSIX extended headers use byte lengths, including for UTF-8 paths.
			for (let at = 0; at < contents.length;) {
				const space = contents.indexOf(32, at);
				if (space < at) throw new Error('Invalid document engine archive metadata.');
				const lengthText = decoder.decode(contents.subarray(at, space));
				if (!/^\d+$/.test(lengthText)) throw new Error('Invalid document engine archive metadata.');
				const length = Number(lengthText);
				if (length <= space - at + 1 || at + length > contents.length) throw new Error('Invalid document engine archive metadata.');
				const record = decoder.decode(contents.subarray(space + 1, at + length - 1));
				if (record.startsWith('path=')) nextPath = record.slice(5);
				at += length;
			}
			continue;
		}
		if (type === 103) continue;
		if (type === 76) { nextPath = text(contents).replace(/\n$/, ''); continue; }
		const prefix = text(header.subarray(345, 500));
		const name = nextPath || (prefix ? prefix + '/' : '') + text(header.subarray(0, 100));
		nextPath = '';
		if (type === 53) continue;
		if (type !== 0 && type !== 48) throw new Error('Document engine archive links are not supported.');
		if (!name.startsWith('package/')) throw new Error('Invalid document engine package root.');
		const relative = name.slice(8);
		if (!relative || /[\\:]/.test(relative) || [...relative].some(char => char.charCodeAt(0) < 32) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid document engine archive path.');
		if (files.has(relative)) throw new Error('Duplicate document engine archive path.');
		// Source maps are not needed to run the downloaded engine.
		if (!relative.endsWith('.map')) files.set(relative, contents);
	}
	if (!files.has('package.json')) throw new Error('Document engine package manifest is missing.');
	return files;
}
