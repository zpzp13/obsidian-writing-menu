// Opt-in native application check. COM is used by this test only, never by the plugin.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as childProcess from 'node:child_process';
import * as zip from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { exportFixture,nodeExportHost } from './export-test-kit.mjs';
import { loadTsFixture } from './ts-fixture-loader.mjs';
if(process.platform!=='win32')throw Error('Windows native check requires Windows.');
nodeExportHost();const api=await exportFixture();const dir=path.resolve('.codex-tmp/export-native');fs.mkdirSync(dir,{recursive:true});
const source='\n\n한글 English 😀 & < > " \' $&\t탭\n다음 줄\n\n끝\n\n\n';const doc=api.applyContentPolicy(api.parseMarkdownDocument(source),api.DEFAULT_CONTENT,'hwpx');
const style={...api.DEFAULT_DOCUMENT_STYLE,fontFamily:'맑은 고딕',fontSize:17,lineSpacing:180,spaceAfter:7,firstLineIndent:13,marginTop:23,marginRight:18,background:'#efe4cf'};
const template=path.join(dir,'template.hwpx');fs.writeFileSync(template,api.createStyledHwpx(api.parseMarkdownDocument('템플릿 원본'),{title:'양식',style}));const hash=()=>createHash('sha256').update(fs.readFileSync(template)).digest('hex'),before=hash();const model=api.inspectHwpxTemplate(fs.readFileSync(template));
const plain=path.join(dir,'plain.hwpx'),templated=path.join(dir,'templated.hwpx'),word=path.join(dir,'manuscript.docx');
fs.writeFileSync(plain,api.createStyledHwpx(doc,{title:'기본',style:api.DEFAULT_DOCUMENT_STYLE}));fs.writeFileSync(templated,api.createStyledHwpx(doc,{title:'양식',style:model.styles[0].style,template:model}));fs.writeFileSync(word,await api.createDocx(doc,{title:'원고',style}));assert.equal(hash(),before);
const rich=api.applyContentPolicy(api.parseMarkdownDocument('# 제목\n\n**강조** ![그림](pic.png)\n\n| A | B |\n| - | - |\n| 표 본문 | English |\n\n본문[^n]\n\n[^n]: 각주 본문'),{...api.DEFAULT_CONTENT,headings:'keep',tables:'keep',footnotes:'keep',images:'keep',emphasis:true},'hwpx');
rich.resources=[{id:'pic.png',extension:'png',width:1,height:1,bytes:Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0l8AAAAASUVORK5CYII=','base64'))}];
const richPath=path.join(dir,'rich.hwpx');fs.writeFileSync(richPath,api.createStyledHwpx(rich,{title:'rich',style}));
const {runDesktopCommand}=loadTsFixture('src/export/DesktopExport.ts',{obsidian:{Platform:{isDesktop:true,isWin:true},Notice:class{}},child_process:childProcess});
const script=String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$result = @{ hangul = @(); word = 'unavailable' }
$hwp = $null
try {
    if ($null -ne [Type]::GetTypeFromProgID('HWPFrame.HwpObject')) {
        $hwp = New-Object -ComObject HWPFrame.HwpObject
        $hwp.XHwpWindows.Item(0).Visible = $false
        [void]$hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule')
        foreach ($file in $request.hwpx) {
            if (-not $hwp.Open([string]$file, 'HWPX', 'forceopen:true')) { throw ('Open failed: ' + $file) }
            $text = [string]$hwp.GetTextFile('TEXT', '')
            if (-not $hwp.SaveAs(([string]$file + '.roundtrip.hwpx'), 'HWPX', '')) { throw ('Save failed: ' + $file) }
            $result.hangul += $text
            [void]$hwp.Clear(1)
        }
    }
} finally {
    if ($null -ne $hwp) { try { [void]$hwp.Clear(1); [void]$hwp.Quit() } catch {}; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp) }
}
$wordApp = $null
try {
    if ($null -ne [Type]::GetTypeFromProgID('Word.Application')) {
        $wordApp = New-Object -ComObject Word.Application
        $wordApp.Visible = $false
        $document = $wordApp.Documents.Open([string]$request.docx)
        try { $result.word = [string]$document.Content.Text; $document.SaveAs2(([string]$request.docx + '.roundtrip.docx'), 16) }
        finally { $document.Close(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
    }
} finally { if ($null -ne $wordApp) { $wordApp.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordApp) } }
[Console]::Out.Write((ConvertTo-Json -InputObject $result -Compress -Depth 5))
`;
const command=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
const result=JSON.parse(await runDesktopCommand(command,['-NoLogo','-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],JSON.stringify({hwpx:[plain,templated,richPath],docx:word})));
const normalize=s=>s.replace(/&#(\d+);/g,(m,n)=>Number(n)>=0xd800&&Number(n)<=0xdfff?String.fromCharCode(Number(n)):m).replace(/\r\n?|\u000b/g,'\n').replace(/\n+$/,'');
const hwpxText=bytes=>{const entries=zip.unzipSync(bytes),d=new DOMParser().parseFromString(zip.strFromU8(entries['Contents/section0.xml']),'text/xml');return Array.from(d.getElementsByTagNameNS('*','p')).map(p=>Array.from(p.getElementsByTagNameNS('*','t')).map(t=>Array.from(t.childNodes).map(n=>n.localName==='tab'?'\t':n.localName==='lineBreak'?'\n':n.textContent).join('')).join('')).join('\n');};
if(result.hangul.length){assert.equal(result.hangul.length,3);for(const text of result.hangul.slice(0,2))assert.equal(normalize(text),normalize(doc.blocks.map(block=>block.runs.map(run=>run.text.replace(/\n/g,'')).join('')).join('\n')));for(const file of [plain,templated]){assert.equal(hwpxText(fs.readFileSync(file+'.roundtrip.hwpx')),source,'Native resave lost line breaks/tabs');}const reopened=api.inspectHwpxTemplate(fs.readFileSync(templated+'.roundtrip.hwpx')).styles[0].style;assert.equal(reopened.fontSize,17);assert.equal(reopened.fontFamily,'맑은 고딕');assert.equal(reopened.background,style.background);assert.equal(reopened.lineSpacing,style.lineSpacing);assert(Math.abs(reopened.marginTop-style.marginTop)<.01);assert.equal(hash(),before);const richArchive=zip.unzipSync(fs.readFileSync(richPath+'.roundtrip.hwpx')),richXml=zip.strFromU8(richArchive['Contents/section0.xml']);for(const tag of ['footNote','tbl','pic'])assert(richXml.includes('<hp:'+tag),'Native resave lost '+tag);assert(richXml.includes('각주 본문')&&richXml.includes('표 본문'),'Native rich text loss');console.log('PASS actual Hancom open/resave, Unicode/tabs/blank paragraphs, template font/spacing/margins/background and unchanged original hash');}else console.log('UNVERIFIED: Hancom not installed');
if(result.word==='unavailable')console.log('UNVERIFIED: Microsoft Word not installed');else{assert.equal(normalize(result.word),normalize(source));console.log('PASS actual Microsoft Word open/resave');}
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify({date:new Date().toISOString(),hangul:result.hangul.length?'passed':'unavailable',word:result.word==='unavailable'?'unavailable':'passed',templateSha256:before},null,2));
