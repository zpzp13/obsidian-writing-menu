import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as fflate from 'fflate';
import { loadTsFixture } from './ts-fixture-loader.mjs';
import { hwpxText } from './hwpx-fixture.mjs';

const { createPlainHwpx } = loadTsFixture('src/export/HwpxDocument.ts', { fflate });

const text = '한글 English 😀 & < > " \' $& $$ $\' ${literal}\n\n  공백 유지\t탭\n끝';
for (const source of ['', text, '\n\n앞뒤 빈 줄\n\n\n', '처음\r\n\r\n마지막\r줄', '한글 원고 & <text> 😀\t'.repeat(3000) + '\n' + '문단\n'.repeat(1000)]) {
    const bytes = createPlainHwpx(source);
    const zip = Buffer.from(bytes);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.equal(zip.readUInt16LE(8), 0, 'mimetype must be uncompressed');
    assert.equal(zip.subarray(30, 30 + zip.readUInt16LE(26)).toString(), 'mimetype', 'mimetype must be the first ZIP entry');
    const files = fflate.unzipSync(bytes);
    assert.equal(fflate.strFromU8(files.mimetype), 'application/hwp+zip');
    for (const name of ['version.xml', 'Contents/header.xml', 'Contents/section0.xml', 'Contents/content.hpf', 'META-INF/container.xml', 'META-INF/manifest.xml']) assert(files[name], name);
    assert.equal(hwpxText(bytes), source.replace(/\r\n?/g, '\n'));
    assert.equal(fflate.strFromU8(files['Preview/PrvText.txt']), source.replace(/\r\n?/g, '\n'));
    const section = fflate.strFromU8(files['Contents/section0.xml']);
    assert.equal((section.match(/<hp:secPr\b/g) ?? []).length, 1);
    assert(!section.includes('linesegarray'), 'stale native line layout must not be copied');
    assert(!fflate.strFromU8(files['Contents/content.hpf']).includes('82109'), 'blank fixture must have no personal metadata');
}
for (const source of ['\0', '\u0001', '\ud800', '\ufffe']) assert.throws(() => createPlainHwpx(source), /제어 문자/);
assert.equal(hwpxText(createPlainHwpx('second')), 'second', 'exports must not mutate the shared blank');
assert(!fs.existsSync('src/export/converterScript.ts'));
assert(!fs.existsSync('scripts/converter.py'));
console.log('PASS native blank HWPX packaging, text/Unicode/XML/tab/blank paragraphs, long manuscripts, invalid characters and independent exports');
