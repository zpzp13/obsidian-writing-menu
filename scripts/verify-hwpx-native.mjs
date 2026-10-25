// Opt-in Windows integration check. Creates only synthetic documents in .codex-tmp.
// Hancom may display its own file-access approval dialog; this check never bypasses it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as childProcess from 'node:child_process';
import * as fflate from 'fflate';
import { loadTsFixture } from './ts-fixture-loader.mjs';
import { hwpxText } from './hwpx-fixture.mjs';

if (process.platform !== 'win32') throw Error('This optional native check requires Windows and Hancom Hangul.');
const directory = path.resolve('.codex-tmp/hwpx/native');
fs.mkdirSync(directory, { recursive: true });
const { createPlainHwpx } = loadTsFixture('src/export/HwpxDocument.ts', { fflate });
const { fillHancomTemplate, runDesktopCommand } = loadTsFixture('src/export/DesktopExport.ts', {
    obsidian: { Platform: { isDesktop: true, isWin: true }, Notice: class {} }, child_process: childProcess,
});
const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const native = async (script, input) => JSON.parse(await runDesktopCommand(powershell, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], JSON.stringify(input)));
const nativeScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$hwp = $null
try {
    $hwp = New-Object -ComObject HWPFrame.HwpObject
    $hwp.XHwpWindows.Item(0).Visible = $true
    [void]$hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule')
    $texts = @()
    foreach ($file in $request.files) {
        if (-not $hwp.Open([string]$file, '', 'forceopen:true')) { throw "Could not open $file" }
        $texts += [string]$hwp.GetTextFile('TEXT', '')
        if ($request.setup) {
            [void]$hwp.HAction.Run('SelectAll')
            [void]$hwp.HAction.GetDefault('CharShape', $hwp.HParameterSet.HCharShape.HSet)
            $hwp.HParameterSet.HCharShape.Height = 1700
            if (-not $hwp.HAction.Execute('CharShape', $hwp.HParameterSet.HCharShape.HSet)) { throw 'CharShape failed' }
            if (-not $hwp.SaveAs([string]$request.templateHwpx, 'HWPX', '')) { throw 'HWPX template save failed' }
            if (-not $hwp.SaveAs([string]$request.templateHwp, 'HWP', '')) { throw 'HWP template save failed' }
        } else {
            if (-not $hwp.SaveAs(([string]$file + '.roundtrip.hwpx'), 'HWPX', '')) { throw 'Roundtrip save failed' }
        }
        [void]$hwp.Clear(1)
    }
    [Console]::Out.Write((ConvertTo-Json -InputObject @($texts) -Compress))
} finally {
    if ($null -ne $hwp) {
        try { [void]$hwp.Clear(1); [void]$hwp.Quit() } catch {}
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp)
    }
}
`;
const text = '\n한글 English 😀 & < > " \' $& $$ ${literal}\n\n  공백 유지\t탭\n끝\n\n';
const plain = path.join(directory, 'plain.hwpx');
const templateHwpx = path.join(directory, 'template.hwpx'), templateHwp = path.join(directory, 'template.hwp');
fs.writeFileSync(plain, createPlainHwpx(text));
// Hangul 2022's TEXT API serializes supplementary characters as UTF-16 references.
// The HWPX XML is checked separately below so that serializer behavior cannot hide data loss.
const normalized = value => value.replace(/&#(\d+);/g, (entity, number) => Number(number) >= 0xd800 && Number(number) <= 0xdfff ? String.fromCharCode(Number(number)) : entity).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
console.log('Opening plain HWPX in Hancom and creating synthetic 17pt HWP/HWPX templates...');
const opened = await native(nativeScript, { files: [plain], setup: true, templateHwpx, templateHwp });
assert.equal(normalized(opened[0]), text.replace(/\n+$/, ''));
const hash = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const originals = [hash(templateHwp), hash(templateHwpx)];
const body = '\n\n새 원고 & <내용> 😀\t탭 $&\n\n다음 문단\n\n\n';
const outputs = [];
for (const template of [templateHwp, templateHwpx]) {
    const output = path.join(directory, path.extname(template).slice(1) + '-result.hwpx');
    console.log('Applying synthetic ' + path.extname(template) + ' template through the production PowerShell bridge...');
    await fillHancomTemplate(template, [{ path: output, text: body }]);
    outputs.push(output);
}
assert.deepEqual([hash(templateHwp), hash(templateHwpx)], originals, 'template originals changed');
console.log('Reopening and resaving the generated documents in Hancom...');
const reopened = await native(nativeScript, { files: [plain, ...outputs], setup: false });
assert.deepEqual(reopened.map(normalized), [text, body, body].map(value => value.replace(/\n+$/, '')));
for (const [filename, expected] of [[plain, text], ...outputs.map(filename => [filename, body])]) {
    assert.equal(hwpxText(fs.readFileSync(filename)), expected, 'all line breaks must survive native open/save');
    assert.equal(hwpxText(fs.readFileSync(filename + '.roundtrip.hwpx')), expected, 'leading/trailing blank paragraphs must survive resave');
}
const xml = (filename, entry) => fflate.strFromU8(fflate.unzipSync(fs.readFileSync(filename))[entry]);
const page = xml(templateHwpx, 'Contents/section0.xml').match(/<hp:pagePr\b[\s\S]*?<\/hp:pagePr>/)[0];
for (const filename of outputs) {
    assert(xml(filename, 'Contents/section0.xml').includes('😀'), 'HWPX must retain supplementary Unicode characters');
    assert.equal(xml(filename, 'Contents/section0.xml').match(/<hp:pagePr\b[\s\S]*?<\/hp:pagePr>/)[0], page);
    const section = xml(filename, 'Contents/section0.xml');
    const bodyRun = [...section.matchAll(/<hp:run charPrIDRef="(\d+)">([\s\S]*?)<\/hp:run>/g)].find(([, , contents]) => /<hp:t>[^<]/.test(contents));
    assert(bodyRun, 'body text run missing');
    const shape = xml(filename, 'Contents/header.xml').match(new RegExp('<hh:charPr id="' + bodyRun[1] + '"[^>]*>'))[0];
    assert(shape.includes('height="1700"'), 'template font size was not inherited');
}
console.log('PASS actual Hancom plain-HWPX open, HWP/HWPX template fill, Unicode/tab/blank paragraphs, original hashes, 17pt format, page settings and reopen/resave');
