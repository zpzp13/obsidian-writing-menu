import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as zip from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { exportFixture, nodeExportHost } from './export-test-kit.mjs';
const provenance=JSON.parse(fs.readFileSync('vendor/kordoc/provenance.json','utf8'));assert.equal(provenance.version,'4.24.6');assert.equal(provenance.revision,'71666c52fe6321e2ad1df8dfbc21b58693bd6ae3');
for(const file of provenance.files){const code=fs.readFileSync(file.output,'utf8');assert.equal(createHash('sha256').update(code).digest('hex'),file.outputSha256,file.output);assert(!/\b(?:Buffer|process|require|nodeStream)\b/.test(code),file.output+' contains a Node-only API');}
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
        if(format==='hwpx')assert(result.pages.length>0,'HWPX generated SVG missing');
        fs.writeFileSync(`.codex-tmp/export/sample-${i}.${format}`,result.bytes);
    }
}
const source='# 제목\n\n**굵게** *기울임* ~~취소~~ ![그림](pic.png)\n\n| A | B |\n| - | - |\n| 한글 | English |\n\n각주[^one].\n\n[^one]: 각주 본문\n';
const parsed=parse(source);
assert.equal(parsed.blocks[0].kind,'heading');assert(parsed.blocks.some(b=>b.kind==='table'));assert.equal(text({blocks:[{kind:'paragraph',runs:parsed.footnotes.one}]}),'각주 본문');
for(const mode of ['keep','text','exclude']){
    const doc=policy(parsed,{...content,headings:mode,tables:mode,footnotes:mode,images:mode,emphasis:mode==='keep'},'hwpx');
    assert.equal(doc.blocks.some(b=>b.kind==='heading'),mode==='keep');assert.equal(doc.blocks.some(b=>b.kind==='table'),mode==='keep');
    assert.equal(text(doc).includes('제목'),mode!=='exclude');assert.equal(text(doc).includes('각주 본문'),mode==='text');
    assert.equal(Object.keys(doc.footnotes).length>0,mode==='keep');
}

const rich=policy(parsed,{headings:'keep',tables:'keep',footnotes:'keep',images:'keep',emphasis:true,spaceIndent:false},'hwpx');
rich.resources=[{id:'pic.png',extension:'png',width:1,height:1,bytes:Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0l8AAAAASUVORK5CYII=','base64'))}];
for(const format of ['docx','hwpx']){
 const output=await api.generateDocument(rich,format,options);fs.writeFileSync('.codex-tmp/export/rich.'+format,output.bytes);
 const body=xml(output.bytes,format==='hwpx'?'Contents/section0.xml':'word/document.xml');assert(body.includes(format==='hwpx'?'hp:tbl':'w:tbl'));assert(body.includes(format==='hwpx'?'hp:footNote':'w:footnoteReference'));assert(body.includes(format==='hwpx'?'hp:pic':'w:drawing'));
 const archive=zip.unzipSync(output.bytes);assert(Object.keys(archive).some(name=>/\.(?:png)$/.test(name)));
 if(format==='hwpx')assert(output.pages.some(page=>page.includes('data:image/png;base64')),'HWPX embedded image preview missing');
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
const started=Date.now(), result=await api.generateDocument(long,'hwpx',options);assert.equal(hwpxText(result.bytes),text(long));assert(result.pages.length>1);
fs.writeFileSync('.codex-tmp/export/long.hwpx',result.bytes);
console.log(`PASS UTF-8/DOCX/HWPX Unicode, XML, tabs, leading/trailing/blank paragraphs; content modes; template style/background; ${result.pages.length} long-manuscript pages (${Date.now()-started}ms)`);
