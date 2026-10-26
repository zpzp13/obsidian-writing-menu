import { wmT } from '../i18n';
import type { DocumentResource } from './DocumentModel';

type ImageData = Omit<DocumentResource, 'id'>;
export const EXPORT_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']);

function rasterSize(bytes: Uint8Array, extension: 'png' | 'jpg'): { width: number; height: number } | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (extension === 'png' && bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) return { width: view.getUint32(16), height: view.getUint32(20) };
    if (extension === 'jpg') {
        for (let at = 2; at + 1 < bytes.length;) {
            if (bytes[at++] !== 255) continue;
            while (at < bytes.length && bytes[at] === 255) at++;
            const marker = bytes[at++];
            if (marker === undefined) break;
            if (marker === 0xd9 || marker === 0xda) break;
            if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7) continue;
            if (at + 2 > bytes.length) break;
            const length = view.getUint16(at); if (length < 2 || at + length > bytes.length) break;
            if (length >= 7 && [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: view.getUint16(at + 3), width: view.getUint16(at + 5) };
            at += length;
        }
    }
    return null;
}
/** Clipboard files can carry a PNG name while containing JPEG/WebP bytes. */
function imageType(bytes: Uint8Array, extension: string): string {
    const signature = Array.from(bytes.subarray(0, 12), byte => String.fromCharCode(byte)).join('');
    if (signature.startsWith('\x89PNG\r\n\x1a\n')) return 'png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
    if (signature.startsWith('GIF87a') || signature.startsWith('GIF89a')) return 'gif';
    if (signature.startsWith('RIFF') && signature.slice(8) === 'WEBP') return 'webp';
    if (signature.startsWith('BM')) return 'bmp';
    if (new TextDecoder().decode(bytes.subarray(0, 1024)).replace(/^\uFEFF/, '').trimStart().match(/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i)) return 'svg';
    return extension === 'jpeg' ? 'jpg' : extension;
}
function checkSize(width: number, height: number): void {
    if (!width || !height || width > 32768 || height > 32768 || width * height > 40_000_000) throw new Error(wmT('이미지 크기를 읽지 못했습니다.'));
}
/** Normalize vault-only browser image formats to a portable, embedded PNG. No URL fetching. */
export async function prepareExportImage(bytes: Uint8Array, extension: string, doc: Document): Promise<ImageData> {
    extension = imageType(bytes, extension);
    if (extension === 'png' || extension === 'jpg' || extension === 'jpeg') {
        const type = extension === 'jpeg' ? 'jpg' : extension, size = rasterSize(bytes, type);
        if (size) { checkSize(size.width, size.height); return { bytes, extension: type, ...size }; }
    }
    const mime = extension === 'svg' ? 'image/svg+xml' : extension === 'jpg' ? 'image/jpeg' : 'image/' + extension;
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime })), image = doc.createElement('img');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        image.src = url;
        await Promise.race([image.decode(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(wmT('이미지를 불러오지 못했습니다.'))), 30000); })]);
        const width = image.naturalWidth, height = image.naturalHeight; checkSize(width, height);
        const canvas = doc.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d'); if (!context) throw new Error(wmT('이미지를 불러오지 못했습니다.'));
        context.drawImage(image, 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error(wmT('이미지를 불러오지 못했습니다.'))), 'image/png'));
        return { bytes: new Uint8Array(await blob.arrayBuffer()), extension: 'png', width, height };
    } finally { clearTimeout(timer); image.removeAttribute('src'); URL.revokeObjectURL(url); }
}
