import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { exportFixture,nodeExportHost } from './export-test-kit.mjs';
import { loadTsFixture } from './ts-fixture-loader.mjs';
const host=nodeExportHost(),api=await exportFixture();
const sources=new Map([['Project/a.md','---\nsecret: hidden\n---\n\n# 제목\n\n본문 $& 😀\t탭\n\n'],['Project/nested/b.md','둘째\n=====\n\n본문 B'],['Project/keep.txt.md','파일 이름 유지']]);
const files=[...sources.keys()].map(path=>Object.assign(new host.TFile(),{path,basename:path.split('/').pop().slice(0,-3),name:path.split('/').pop(),extension:'md',stat:{mtime:1,size:10}}));
const output=new Map(),reads=[],writes=[],notices=[];let denied=false,view;
const plugin={settings:{hwpTemplatePath:'C:\\Windows\\saved.hwpx',hwpExportPath:''},app:{workspace:{getLeavesOfType:type=>view&&view.type===type?[{view}]:[]},metadataCache:{getFirstLinkpathDest:()=>null},vault:{getMarkdownFiles:()=>files,read:async f=>{reads.push(f.path);return sources.get(f.path);},readBinary:async()=>{throw Error('Unexpected resource read');}}}};
const external=p=>assert(p.startsWith('/external')||p.startsWith('C:\\external'),p);
host.fs={existsSync:p=>output.has(p),realpathSync:p=>p,readFileSync:p=>{external(p);if(!output.has(p))throw Error('ENOENT');return output.get(p);},mkdirSync:p=>external(p),writeFileSync:(p,b,o)=>{external(p);if(denied)throw Error('EACCES Permission denied');if(o?.flag==='wx'&&output.has(p))throw Error('EEXIST');output.set(p,b);writes.push({p,b});}};
let generated=0;const engine={template:async b=>api.inspectHwpxTemplate(b),generate:async(d,f,o)=>{generated++;return api.generateDocument(d,f,o);},dispose(){}};
const service=new api.ExportService(plugin,engine),options={title:'제목',style:api.DEFAULT_DOCUMENT_STYLE};
for(const win of [false,true]){
    host.Platform.isWin=win;host.Platform.isMacOS=!win;const root=win?'C:\\external':'/external';
    assert(!api.defaultTemplateEnabled(win?'/Users/me/template.hwpx':'C:\\Windows\\template.hwpx'));
    assert(api.defaultTemplateEnabled(root+(win?'\\':'/')+'template.hwpx'));
    for(const format of ['txt','docx','hwpx']){
        const result=await service.generate([files[1],files[0]],format,api.DEFAULT_CONTENT,options,false,'');
        assert.equal(result[0].file,files[1]);assert.equal(result[0].name,'b.'+format);
        const before=generated;const again=await service.generate([files[1],files[0]],format,api.DEFAULT_CONTENT,options,false,'');assert.equal(generated,before);assert.equal(result[0].generated.bytes,again[0].generated.bytes,'Preview cache must preserve bytes');
        const saved=await service.write(result,root,format,'Project',true,'');assert.equal(saved.saved.length,2);assert(saved.saved[0].includes('nested'));assert.equal(writes.at(-1).b,result[1].generated.bytes);
        await assert.rejects(service.write(result,root,format,'Project',true,''),/이미 있습니다/);
        const merged=await service.generate([files[1],files[0]],format,{...api.DEFAULT_CONTENT,headings:'exclude'},options,true,'병합');assert(merged[0].generated.text.startsWith('\n본문 B\n\n\n'));
    }
    const named=await service.generate([files[2]],'txt',api.DEFAULT_CONTENT,options,false,files[2].basename);assert.equal(named[0].name,'keep.txt.txt');
}
host.Platform.isWin=false;host.Platform.isMacOS=true;
view=Object.assign(new host.PagedWritingView(),{file:files[0],type:'paged',save:async()=>sources.set(files[0].path,'방금 입력한 원고\n\n')});
const fresh=await service.generate([files[0]],'txt',api.DEFAULT_CONTENT,options,false,'fresh');assert.equal(fresh[0].generated.text,'방금 입력한 원고\n\n');
view=Object.assign(new host.MarkdownView(),{file:files[0],type:'markdown',save:async()=>sources.set(files[0].path,'Markdown 최신 원고')});assert.equal((await service.generate([files[0]],'txt',api.DEFAULT_CONTENT,options,false,'fresh'))[0].generated.text,'Markdown 최신 원고');view=undefined;
const templatePath='/external/원본 $(&literal).hwpx',bytes=api.createStyledHwpx(api.parseMarkdownDocument('원본 본문'),{...options,style:{...options.style,fontSize:17,background:'#f3e5d7'}});output.set(templatePath,bytes);const hash=createHash('sha256').update(bytes).digest('hex');
const template=await service.loadTemplate(templatePath);assert.equal(template.styles[0].style.fontSize,17);assert.equal(createHash('sha256').update(output.get(templatePath)).digest('hex'),hash);
await assert.rejects(service.loadTemplate('/external/legacy.hwp'),/HWPX/);await assert.rejects(service.loadTemplate('/external/missing.hwpx'),/찾을/);output.set('/external/broken.hwpx',new Uint8Array([1,2]));await assert.rejects(service.loadTemplate('/external/broken.hwpx'));
const generatedTemplate=await service.generate([files[0]],'hwpx',api.DEFAULT_CONTENT,{...options,template,style:template.styles[0].style},false,'원본 $(&literal)');await assert.rejects(service.write(generatedTemplate,'/external','hwpx','',false,templatePath,true),/템플릿 원본/);
for(const name of ['../escape','con','x\u0000','bad/name','trailing.'])assert.throws(()=>api.exportFileName(name,'txt'));
await assert.rejects(service.write(fresh,'relative','txt','',false,''),/전체 경로/);
const duplicate=[{...fresh[0],file:files[0],name:'same.txt'},{...fresh[0],file:files[1],name:'same.txt'}];const beforeWrites=writes.length;await assert.rejects(service.write(duplicate,'/external/duplicates','txt','',false,''),/같은 이름/);assert.equal(writes.length,beforeWrites,'Preflight errors wrote partial outputs');
denied=true;const failed=await service.write(fresh,'/external/denied','txt','',false,'');assert.equal(failed.saved.length,0);assert(failed.error.includes('Permission denied'));denied=false;
assert(reads.every(p=>p.startsWith('Project/')),'Sources bypassed Vault API');
const migrated=api.exportDefaults({fontSize:20,lineHeight:1.7,exportDefaultSpaceIndent:true,exportDefaultExcludeHeadings:true,hwpTemplatePath:'legacy.hwp',hwpExportPath:'saved'});assert.equal(migrated.style.fontSize,15);assert.equal(migrated.content.headings,'exclude');assert(migrated.content.spaceIndent);const independent=api.exportDefaults({documentExportDefaults:migrated});independent.style.fontSize=9;assert.equal(migrated.style.fontSize,15);
// Native picker contract: only fixed source, stdin mode and shell:false. Never launch an app.
let childFailure='',childOutput='';const commands=[],pickerNotices=[],bridgePlatform={isDesktop:true,isWin:true,isMacOS:false};
const desktop=loadTsFixture('src/export/DesktopExport.ts',{
 obsidian:{Platform:bridgePlatform,Notice:class{constructor(m){pickerNotices.push(m);}}},'../utils/nodeShims':{joinPath:(...parts)=>parts.join('\\')},
 child_process:{spawn(command,args,options){const events={},out={},err={};const record={command,args,options,input:''};commands.push(record);return{stdout:{setEncoding(){},on:(n,fn)=>out[n]=fn},stderr:{setEncoding(){},on:(n,fn)=>err[n]=fn},on:(n,fn)=>events[n]=fn,stdin:{on(){},end(input){record.input=input;queueMicrotask(()=>{if(childFailure){err.data?.({toString:()=>childFailure});events.close(1);}else{out.data?.({toString:()=>childOutput});events.close(0);}});}}};}}
});
assert.equal(await desktop.pickExternalPath('folder'),null);childOutput='C:\\selected\\한글 $(&anything) & spaces';assert.equal(await desktop.pickExternalPath('file'),childOutput);const call=commands.at(-1);assert.equal(call.input,'file');assert.equal(call.options.shell,false);assert(call.options.windowsHide);assert(!call.args.join(' ').includes(childOutput));const script=Buffer.from(call.args.at(-1),'base64').toString('utf16le');assert(script.includes('*.hwpx')&&script.includes('finally'));assert(!/HWPFrame|SaveAs|ComObject|\.hwp\|/i.test(script));
bridgePlatform.isWin=false;bridgePlatform.isMacOS=true;childOutput='/Users/한글/문서 폴더/';assert.equal(await desktop.pickExternalPath('folder'),childOutput);assert.deepEqual(commands.at(-1).args,['-e','POSIX path of (choose folder)']);childFailure='User canceled. (-128)';assert.equal(await desktop.pickExternalPath('folder'),null);assert.equal(pickerNotices.length,0);childFailure='dialog unavailable';assert.equal(await desktop.pickExternalPath('folder'),null);assert.equal(pickerNotices.length,1);
for(const file of fs.readdirSync('src/export').filter(p=>p.endsWith('.ts')))assert(!/HWPFrame|fillHancomTemplate|spawn\(['"]python|converter\.py/.test(fs.readFileSync('src/export/'+file,'utf8')),file);
console.log('PASS Vault source boundary, fresh Markdown/Paged input, Windows/macOS codecs, byte cache, order/hierarchy/merge, filenames, template hash/errors, collision/permission errors, migration and fixed native pickers');
