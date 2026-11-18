import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as zip from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { exportFixture, nodeExportHost } from './export-test-kit.mjs';
assert(!fs.existsSync('vendor/kordoc'), 'kordoc sources must not be vendored');
nodeExportHost();
const api=await exportFixture();
const {parseMarkdownDocument:parse, applyContentPolicy:policy, documentText:text, DEFAULT_CONTENT:content, DEFAULT_DOCUMENT_STYLE:style}=api;
const options={title:'원고 & 😀',style:{...style,fontFamily:'맑은 고딕',fontSize:17,lineSpacing:175,spaceAfter:7,firstLineIndent:13,marginTop:23,background:'#efe4cf'}};
const samples=['','\n','\n\n한글 English 😀 & < > " \' $& $$ ${x}\t탭\n\n다음\n\n\n','\t',' 앞 공백\t중간\t끝\t','\n \t\n\t\n끝\n','a\nb\n\n\n마지막\n','줄1  \n줄2\n'];
const xml=(bytes,p)=>zip.strFromU8(zip.unzipSync(bytes)[p]);
const dom=xml=>new DOMParser().parseFromString(xml,'text/xml');
const descendants=(node,tag)=>Array.from(node.getElementsByTagNameNS('*',tag));
const hwpxText=bytes=>descendants(dom(xml(bytes,'Contents/section0.xml')),'p').map(p=>descendants(p,'t').map(t=>Array.from(t.childNodes).map(n=>n.localName==='tab'?'\t':n.localName==='lineBreak'?'\n':n.textContent).join('')).join('')).join('\n');
const docxText=bytes=>descendants(dom(xml(bytes,'word/document.xml')),'p').map(p=>descendants(p,'r').map(r=>Array.from(r.childNodes).map(n=>n.localName==='t'?n.textContent:n.localName==='tab'?'\t':n.localName==='br'?'\n':'').join('')).join('')).join('\n');
fs.mkdirSync('.codex-tmp/export',{recursive:true});
for(const [i,sample] of samples.entries()){
    const doc=policy(parse('---\nsecret: hidden\n---\n'+sample,'Project/sample.md'),content,'hwpx');
    assert.equal(text(doc),sample,'IR source text '+i);
    for(const format of ['txt','docx','hwpx']){
        const result=await api.generateDocument(doc,format,options);
        const actual=format==='txt'?new TextDecoder().decode(result.bytes):format==='docx'?docxText(result.bytes):hwpxText(result.bytes);
        assert.equal(actual,text(doc),`${format} text ${i}`);
        assert.equal(result.pages,undefined,'Codecs must not load a bundled renderer');
        fs.writeFileSync(`.codex-tmp/export/sample-${i}.${format}`,result.bytes);
    }
}
const source='# 제목\n\n**굵게** *기울임* ~~취소~~ ![그림](pic.png)\n\n| A | B |\n| - | - |\n| 한글 | English |\n\n각주[^one].\n\n[^one]: 각주 본문\n';
const parsed=parse(source);
const inlineDocument=parse('<u>밑줄</u> <span style="color: #ff0000">빨강 **굵게**</span> ==강조== <span style="background-color: #abcdef">이전 배경</span>');
const inlineRuns=inlineDocument.blocks.flatMap(block=>block.runs??[]);
assert(inlineRuns.some(run=>run.text==='밑줄'&&run.underline),'Underline HTML was exported as literal tags');
assert(inlineRuns.some(run=>run.text==='굵게'&&run.bold&&run.color==='#ff0000'),'Nested Markdown/color HTML export lost formatting');
assert(inlineRuns.some(run=>run.text==='강조'&&run.background==='#ffff00'),'Native highlight export did not use yellow');
// `==` inside words / before a color emoji, and the <mark> form used where a highlight overlaps <span>.
const markRuns=parse('글==🟣보라==끝 <mark data-highlight="orange" style="background-color: var(--highlight-background-orange); color: inherit"><span style="color: #2b7339">주황</span></mark>').blocks.flatMap(block=>block.runs??[]);
assert(markRuns.some(run=>run.text==='보라'&&run.background==='#800080')&&!markRuns.some(run=>/==|🟣|<mark|<\/mark>/.test(run.text)),'Intraword colored highlight was exported as literal markers');
assert(markRuns.some(run=>run.text==='주황'&&run.background==='#ffa500'&&run.color==='#2b7339'),'HTML <mark> highlight lost its color or the text color');
assert(inlineRuns.some(run=>run.text==='이전 배경'&&run.background==='#ffff00'),'Legacy background HTML did not export as highlight');
assert.equal(text(inlineDocument),'밑줄 빨강 굵게 강조 이전 배경');
const nativeHighlights=parse('==🔴빨강== ==🟠주황== ==🟡노랑== ==🟢초록== ==🔵파랑== ==🟣보라== ==🟥**굵은 빨강**==');
assert.equal(text(nativeHighlights),'빨강 주황 노랑 초록 파랑 보라 굵은 빨강','Native color markers leaked into export text');
const highlightRuns=nativeHighlights.blocks.flatMap(block=>block.runs??[]).filter(run=>run.background);
assert.deepEqual(highlightRuns.map(run=>run.background),['#ff0000','#ffa500','#ffff00','#00ff00','#0000ff','#800080','#ff0000']);
assert(highlightRuns.at(-1).bold,'Colored highlight lost nested Markdown emphasis');
for(const format of ['docx','hwpx']) {
	const result=await api.generateDocument(inlineDocument,format,options),body=xml(result.bytes,format==='docx'?'word/document.xml':'Contents/section0.xml');
	assert.equal(format==='docx'?docxText(result.bytes):hwpxText(result.bytes),text(inlineDocument));
	assert(!body.includes('&lt;span')&&!body.includes('&lt;u&gt;'),'Formatting tags leaked into exported document text');
	assert(body.includes(format==='docx'?'w:u':'hp:run'),'Inline formatting was missing from the encoded document');
	const coloredOutput=await api.generateDocument(nativeHighlights,format,options);
	assert.equal(format==='docx'?docxText(coloredOutput.bytes):hwpxText(coloredOutput.bytes),text(nativeHighlights));
}
assert.equal(parsed.blocks[0].kind,'heading');assert(parsed.blocks.some(b=>b.kind==='table'));assert.equal(text({blocks:[{kind:'paragraph',runs:parsed.footnotes.one}]}),'각주 본문');
for(const mode of ['keep','text','exclude']){
    const doc=policy(parsed,{...content,headings:mode,tables:mode,footnotes:mode,images:mode,emphasis:mode==='keep',formatting:mode==='keep'},'hwpx');
    assert.equal(doc.blocks.some(b=>b.kind==='heading'),mode==='keep');assert.equal(doc.blocks.some(b=>b.kind==='table'),false);
    assert.equal(text(doc).includes('제목'),mode!=='exclude');assert.equal(text(doc).includes('각주 본문'),mode==='text');
    assert.equal(Object.keys(doc.footnotes).length>0,mode==='keep');
}

const rich=policy(parsed,{headings:'keep',tables:'keep',footnotes:'keep',images:'keep',emphasis:true,formatting:true,spaceIndent:false},'hwpx');
rich.resources=[{id:'pic.png',extension:'png',width:1,height:1,bytes:Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0l8AAAAASUVORK5CYII=','base64'))}];
for(const format of ['docx','hwpx']){
 const output=await api.generateDocument(rich,format,options);fs.writeFileSync('.codex-tmp/export/rich.'+format,output.bytes);
 const body=xml(output.bytes,format==='hwpx'?'Contents/section0.xml':'word/document.xml');assert(!body.includes(format==='hwpx'?'hp:tbl':'w:tbl'),'Tables export as plain text');assert((format==='hwpx'?hwpxText(output.bytes):docxText(output.bytes)).includes('한글\tEnglish'));assert(body.includes(format==='hwpx'?'hp:footNote':'w:footnoteReference'));assert(body.includes(format==='hwpx'?'hp:pic':'w:drawing'));
 const archive=zip.unzipSync(output.bytes);assert(Object.keys(archive).some(name=>/\.(?:png)$/.test(name)));
}
const indent=policy(parse('가\n나\n\n\t\n끝'),{...content,spaceIndent:true},'txt');assert.equal(text(indent),' 가\n 나\n\n\t\n 끝');
assert.equal(text(policy(parse('**본문**[^n]\n\n[^n]: **각주**'),{...content,footnotes:'keep'},'hwpx')).includes('본문'),true);
const styled=await api.generateDocument(policy(parse('\n본문\t끝\n\n', 'x'),content,'hwpx'),'hwpx',options);
const template=api.inspectHwpxTemplate(styled.bytes);
assert.equal(template.styles[0].style.fontSize,17);assert.equal(template.styles[0].style.background,'#efe4cf');assert(Math.abs(template.styles[0].style.marginTop-23)<.01);
const fromTemplate=api.createStyledHwpx(policy(parse('새 원고'),content,'hwpx'),{...options,template,style:template.styles[0].style});
const again=api.inspectHwpxTemplate(fromTemplate);assert.equal(again.styles[0].style.fontSize,17);assert.equal(again.styles[0].style.background,'#efe4cf');
assert.throws(()=>api.inspectHwpxTemplate(new Uint8Array([0,1,2])));
const merged=api.mergeDocuments([parse('둘'),parse('하나')]);assert.equal(text(merged),'둘\n\n하나');
const long=policy(parse(('한글 English 😀\t & <내용>\n\n').repeat(1500)),content,'hwpx');
const started=Date.now(), result=await api.generateDocument(long,'hwpx',options);assert.equal(hwpxText(result.bytes),text(long));assert.equal(result.pages,undefined);
fs.writeFileSync('.codex-tmp/export/long.hwpx',result.bytes);
console.log(`PASS renderer-free UTF-8/DOCX/HWPX Unicode, XML, tabs, leading/trailing/blank paragraphs; content modes; template style/background; long manuscript (${Date.now()-started}ms)`);
