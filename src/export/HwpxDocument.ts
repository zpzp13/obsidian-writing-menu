import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { BLANK_HWPX_BASE64 } from './BlankHwpx';
import { wmT } from '../i18n/index';

function xmlText(text: string): string {
    for (const char of text) {
        const point = char.codePointAt(0)!;
        if ((point < 32 && point !== 9 && point !== 10 && point !== 13) || (point >= 0xd800 && point <= 0xdfff) || point === 0xfffe || point === 0xffff) {
            throw new Error(wmT('원고에 한글 문서에 저장할 수 없는 제어 문자가 있습니다.'));
        }
    }
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function textRun(text: string): string {
    if (!text) return '<hp:t/>';
    return '<hp:t>' + xmlText(text).replace(/\t/g, '<hp:tab width="0" leader="0" type="1"/>') + '</hp:t>';
}

/** Plain text only. Styles and section settings come from a real empty Hancom document. */
export function createPlainHwpx(text: string): Uint8Array {
    const bytes = Uint8Array.from(atob(BLANK_HWPX_BASE64), char => char.charCodeAt(0));
    const files = unzipSync(bytes);
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const section = strFromU8(files['Contents/section0.xml']);
    const paragraphs = lines.slice(1).map((line, index) =>
        `<hp:p id="${index + 1}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${textRun(line)}</hp:run></hp:p>`).join('');
    files['Contents/section0.xml'] = strToU8(section.replace('<hp:t/>', () => textRun(lines[0])).replace('</hs:sec>', () => paragraphs + '</hs:sec>'));
    files['Preview/PrvText.txt'] = strToU8(text.replace(/\r\n?/g, '\n'));
    const archive: Zippable = { mimetype: [files.mimetype, { level: 0 }] };
    for (const [name, data] of Object.entries(files)) if (name !== 'mimetype') archive[name] = data;
    return zipSync(archive);
}
