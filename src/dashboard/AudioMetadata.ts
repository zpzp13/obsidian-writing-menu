export interface AudioMetadata {
	title: string;
	artist: string;
}

function decodeText(bytes: Uint8Array, encoding = 'utf-8'): string {
	return new TextDecoder(encoding).decode(bytes).split('\u0000').map(part => part.trim()).filter(Boolean).join(' / ');
}

function syncSafe(bytes: Uint8Array, offset: number): number {
	return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) |
		((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
}

/** Read display tags without decoding audio; untagged files keep their filename. */
export function extractAudioMetadata(buffer: ArrayBuffer): AudioMetadata {
	const metadata: AudioMetadata = { title: '', artist: '' };
	const bytes = new Uint8Array(buffer);
	const view = new DataView(buffer);
	if (bytes.length >= 10 && decodeText(bytes.subarray(0, 3)) === 'ID3') {
		const version = bytes[3];
		if (version < 2 || version > 4 || (version === 2 && (bytes[5] & 0x40))) return metadata;
		let tag = bytes.subarray(10, Math.min(bytes.length, 10 + syncSafe(bytes, 6)));
		if (bytes[5] & 0x80) tag = tag.filter((byte, index) => byte !== 0 || tag[index - 1] !== 0xff);
		const tagView = new DataView(tag.buffer, tag.byteOffset, tag.byteLength);
		let offset = 0;
		if (version >= 3 && (bytes[5] & 0x40) && tag.length >= 4) {
			offset = version === 4 ? syncSafe(tag, 0) : tagView.getUint32(0) + 4;
		}
		const headerSize = version === 2 ? 6 : 10;
		while (offset + headerSize <= tag.length) {
			const id = decodeText(tag.subarray(offset, offset + (version === 2 ? 3 : 4)));
			const size = version === 2
				? (tag[offset + 3] << 16) | (tag[offset + 4] << 8) | tag[offset + 5]
				: version === 4 ? syncSafe(tag, offset + 4) : tagView.getUint32(offset + 4);
			if (size <= 0 || offset + headerSize + size > tag.length) break;
			const flags = version === 2 ? 0 : tag[offset + 9];
			const unsupported = flags & (version === 4 ? 0x4d : 0xe0);
			if (!unsupported && ['TIT2', 'TT2', 'TPE1', 'TP1'].includes(id)) {
				let data = tag.subarray(offset + headerSize, offset + headerSize + size);
				if (version === 4 && (flags & 0x02) && !(bytes[5] & 0x80)) data = data.filter((byte, index) => byte !== 0 || data[index - 1] !== 0xff);
				const encoding = ['windows-1252', 'utf-16', 'utf-16be', 'utf-8'][data[0]];
				if (encoding) {
					const text = decodeText(data.subarray(1), encoding);
					if (id === 'TIT2' || id === 'TT2') metadata.title = text;
					else metadata.artist = text;
				}
			}
			offset += headerSize + size;
		}
	} else if (bytes.length >= 4 && decodeText(bytes.subarray(0, 4)) === 'fLaC') {
		let offset = 4;
		while (offset + 4 <= bytes.length) {
			const type = bytes[offset] & 0x7f;
			const last = !!(bytes[offset] & 0x80);
			const size = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
			const end = offset + 4 + size;
			if (end > bytes.length) break;
			if (type === 4 && size >= 8) {
				let cursor = offset + 8 + view.getUint32(offset + 4, true);
				if (cursor + 4 > end) break;
				const count = view.getUint32(cursor, true);
				cursor += 4;
				for (let index = 0; index < count && cursor + 4 <= end; index++) {
					const length = view.getUint32(cursor, true);
					cursor += 4;
					if (cursor + length > end) break;
					const comment = decodeText(bytes.subarray(cursor, cursor + length));
					const separator = comment.indexOf('=');
					const key = comment.slice(0, separator).toUpperCase();
					const value = comment.slice(separator + 1);
					if (key === 'TITLE') metadata.title = value;
					if (key === 'ARTIST') metadata.artist = metadata.artist ? `${metadata.artist} / ${value}` : value;
					cursor += length;
				}
			}
			if (last) break;
			offset = end;
		}
	}
	if (bytes.length >= 128 && decodeText(bytes.subarray(-128, -125)) === 'TAG') {
		metadata.title ||= decodeText(bytes.subarray(-125, -95), 'windows-1252');
		metadata.artist ||= decodeText(bytes.subarray(-95, -65), 'windows-1252');
	}
	return metadata;
}
