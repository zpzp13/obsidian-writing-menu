// Exercise the actual downloaded renderer in Chromium, where Node workers are absent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { browserCheck } from './export-browser-kit.mjs';

const lock=JSON.parse(fs.readFileSync('src/export/kordoc-engine-lock.json','utf8'));
const cacheRoot=process.env.KORDOC_TEST_MODULES || 'C:/Users/82109/AppData/Local/npm-cache/_npx/b9ff2de885da5574/node_modules';
const files=[];
function collect(directory,relative){
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
        const next=path.join(directory,entry.name), name=relative+'/'+entry.name;
        if(entry.isDirectory()&&entry.name!=='node_modules')collect(next,name);
        else if(entry.isFile()&&/\.(?:[cm]?js|json)$/.test(name)&&!name.endsWith('.map'))files.push([name,fs.readFileSync(next,'utf8')]);
    }
}
for(const pkg of lock.packages){
    const directory=path.join(cacheRoot,pkg.name);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8')).version,pkg.version);
    collect(directory,pkg.path);
}
const bridge=await build({entryPoints:['src/export/kordocWorker.ts'],bundle:true,platform:'browser',format:'esm',target:'chrome100',write:false,external:['./node_modules/kordoc/*'],metafile:true});
assert(Object.keys(bridge.metafile.inputs).every(name=>!name.includes('node_modules/kordoc/')));
const compiler=await build({entryPoints:['src/export/kordocCompilerWorker.ts'],bundle:true,platform:'browser',format:'iife',target:'chrome100',write:false,minify:true,define:{__WM_KORDOC_WORKER_SOURCE__:JSON.stringify(bridge.outputFiles[0].text)}});
const contents=`
import {compileKordocWorker,checkKordocWorker} from './src/export/KordocCompiler';
import {KordocRenderWorker} from './src/export/KordocEngine';
import {createStyledHwpx} from './src/export/StyledHwpxDocument';
import {parseMarkdownDocument} from './src/export/MarkdownDocument';
import {DEFAULT_DOCUMENT_STYLE} from './src/export/DocumentModel';
window.runExportChecks=async()=>{
    const check=(value,message)=>{if(!value)throw Error(message);};
    check(typeof window.require==='undefined','Test must run without Node integration');
    const NativeWorker=window.Worker;let created=0,terminated=0;
    window.Worker=class extends NativeWorker{constructor(...args){super(...args);created++;}terminate(){terminated++;super.terminate();}};
    try{
        const files=new Map(await(await fetch('/modules.json')).json());
        const wasm=new Uint8Array(await(await fetch('/esbuild.wasm')).arrayBuffer());
        const source=await compileKordocWorker(files,wasm);
        check(terminated===1,'Compiler worker retained WASM memory');
        await checkKordocWorker(source,'4.24.9',2);
        let reads=0;
        const plugin={app:{vault:{adapter:{read:async()=>{reads++;return source;}}}}};
        const renderer=new KordocRenderWorker(plugin);
        try{
            const document=parseMarkdownDocument('# 한글 제목\\n\\n엔진 본문 😀\\n\\n둘째 문단');
            const bytes=createStyledHwpx(document,{title:'문서',style:DEFAULT_DOCUMENT_STYLE});
            const before=created;
            const first=await renderer.render(bytes,new AbortController().signal);
            check(first.pages.length>0&&first.pages.every(p=>p.includes('<svg')),'Missing SVG pages');
            check(first.pages.join('').includes('엔진 본문'),'Korean manuscript missing');
            const second=await renderer.render(bytes,new AbortController().signal);
            check(second.pages.join('')===first.pages.join(''),'Repeated render changed');
            check(created===before+1&&reads===1,'Renderer did not reuse its warm browser worker');
            const imageDoc=parseMarkdownDocument('이미지 문서\\n\\n![pixel](pixel.png)');
            const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=';
            imageDoc.resources.push({id:'pixel.png',bytes:Uint8Array.from(atob(png),c=>c.charCodeAt(0)),extension:'png',width:1,height:1});
            const imageBytes=createStyledHwpx(imageDoc,{title:'이미지',style:DEFAULT_DOCUMENT_STYLE});
            const image=await renderer.render(imageBytes,new AbortController().signal);
            check(image.pages.join('').includes('data:image/png;base64,'+png),'Embedded image was not rendered');
            return 'PASS actual kordoc: browser-only install compilation, startup, Korean HWPX→SVG, embedded image, warm worker reuse, compiler disposal ('+source.length+' chars)';
        }finally{renderer.dispose();}
    }finally{window.Worker=NativeWorker;}
};`;
const result=await build({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'browser',format:'iife',target:'chrome124',write:false,
    define:{__WM_KORDOC_COMPILER_SOURCE__:JSON.stringify(compiler.outputFiles[0].text),__WM_DOCUMENT_WORKER_SOURCE__:'""'},
    plugins:[{name:'host',setup(b){
        b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'test'}));
        b.onResolve({filter:/^\.\/KordocAssets$/},()=>({path:'assets',namespace:'test'}));
        b.onLoad({filter:/.*/,namespace:'test'},({path:p})=>({contents:p==='obsidian'?'export const Platform={isDesktop:true};':'export const KORDOC_VERSION="4.24.9",KORDOC_PROTOCOL=2;export const getKordocAssetPaths=async()=>({worker:"worker.js"});'}));
    }}]});
await browserCheck({html:'<!doctype html><meta charset="utf-8"><script src="/bundle.js"></script>',bundle:result.outputFiles[0].text,css:'',run:'runExportChecks()',assets:{'/modules.json':['application/json',JSON.stringify(files)],'/esbuild.wasm':['application/wasm',fs.readFileSync('node_modules/esbuild-wasm/esbuild.wasm')]}});
