import * as fflate from 'fflate';

/** Extract just our plain paragraphs, including empty first/last paragraphs and tab controls. */
export function hwpxText(bytes) {
    const files = fflate.unzipSync(bytes);
    const section = fflate.strFromU8(files['Contents/section0.xml']);
    return [...section.matchAll(/<hp:p\b[^>]*>([\s\S]*?)<\/hp:p>/g)].map(([, paragraph]) =>
        [...paragraph.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>|<hp:t\s*\/>/g)].map(([, value = '']) =>
            value.replace(/<hp:tab\b[^>]*\/>/g, '\t').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).join('')).join('\n');
}
