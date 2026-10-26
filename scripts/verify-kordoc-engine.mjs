// Offline download/worker contract checks; no network or external programs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import * as fflate from 'fflate';
import { build } from 'esbuild';
import { loadTsFixture } from './ts-fixture-loader.mjs';

globalThis.window = { crypto:webcrypto, btoa, setTimeout, clearTimeout };
const makeTar = entries => {
    const chunks=[];
    for(const {name,contents='',type='0'} of entries){
        const bytes=Buffer.from(contents), header=Buffer.alloc(512);
        header.write(name); header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124); header[156]=type.charCodeAt(0);
        chunks.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));
    }
    return Uint8Array.from(fflate.gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)])));
};
const archive=makeTar([{name:'package/package.json',contents:JSON.stringify({name:'test-engine',version:'1.0.0'})},{name:'package/index.js',contents:'export const engine = true;'},{name:'package/index.js.map',contents:'{}'},{name:'package/LICENSE',contents:'MIT'}]);
const compilerArchive=makeTar([{name:'package/package.json',contents:JSON.stringify({name:'esbuild-wasm',version:'0.17.3'})},{name:'package/esbuild.wasm',contents:'wasm fixture'},{name:'package/LICENSE',contents:'MIT'}]);
const fixtureLock={version:'4.24.9',protocol:2,entry:'node_modules/test-engine/index.js',packages:[{path:'node_modules/test-engine',name:'test-engine',version:'1.0.0',url:'https://registry.npmjs.org/test-engine/-/test-engine-1.0.0.tgz',integrity:'sha512-'+createHash('sha512').update(archive).digest('base64')}],compiler:{path:'compiler',name:'esbuild-wasm',version:'0.17.3',url:'https://registry.npmjs.org/esbuild-wasm/-/esbuild-wasm-0.17.3.tgz',integrity:'sha512-'+createHash('sha512').update(compilerArchive).digest('base64')}};
const unpack=loadTsFixture('src/export/KordocArchive.ts',{fflate}).unpackKordocPackage;
assert.equal(new TextDecoder().decode(unpack(archive).get('LICENSE')),'MIT'); assert(!unpack(archive).has('index.js.map'));
for(const name of ['package/../escape','package/../../outside','package/C:/outside','package/a\\b','/absolute']) assert.throws(()=>unpack(makeTar([{name,contents:'bad'}])));
assert.throws(()=>unpack(makeTar([{name:'package/link',type:'2'}])),/links/);

const stored=new Map(), directories=new Set(), removed=[];
let downloads=0, networkFailure=false, badIntegrity=false, diskFailure=false, markerFailure=false, compilerFailure=false, startupFailure=false;
const adapter={
    exists:async filename=>stored.has(filename)||directories.has(filename),
    mkdir:async directory=>{directories.add(directory);},
    read:async filename=>{if(typeof stored.get(filename)!=='string')throw Error('missing');return stored.get(filename);},
    write:async(filename,value)=>{stored.set(filename,value);},
    writeBinary:async(filename,value)=>{if(diskFailure)throw Error('disk full');stored.set(filename,value);},
    rename:async(from,to)=>{if(stored.has(to)||directories.has(to))throw Error('Destination file already exists!');if(!stored.has(from))throw Error('Source file is missing');if(markerFailure&&/\/current-engine-[^/]+\.json$/.test(from)&&to.endsWith('/current.json'))throw Error('rename failed');stored.set(to,stored.get(from));stored.delete(from);},
    remove:async filename=>{stored.delete(filename);},
    rmdir:async directory=>{removed.push(directory);for(const filename of stored.keys())if(filename.startsWith(directory+'/'))stored.delete(filename);for(const dir of directories)if(dir===directory||dir.startsWith(directory+'/'))directories.delete(dir);},
};
const plugin={manifest:{id:'writing-menu',dir:'.obsidian/plugins/writing-menu'},app:{vault:{configDir:'.obsidian',adapter}}};
const assets=loadTsFixture('src/export/KordocAssets.ts',{
    './kordoc-engine-lock.json':fixtureLock,fflate,
    './KordocCompiler':{compileKordocWorker:async(files,wasm)=>{assert(files.has(fixtureLock.entry));assert.equal(new TextDecoder().decode(wasm),'wasm fixture');if(compilerFailure)throw Error('compile failed');return '/* browser worker */';},checkKordocWorker:async(source,version,protocol)=>{assert.equal(source,'/* browser worker */');assert.equal(version,fixtureLock.version);assert.equal(protocol,2);if(startupFailure)throw Error('worker failed to start');}},
    obsidian:{normalizePath:value=>value,requestUrl:async({url})=>{assert([fixtureLock.packages[0].url,fixtureLock.compiler.url].includes(url));downloads++;if(networkFailure)throw Error('offline');return{status:200,arrayBuffer:badIntegrity?new Uint8Array([1]).buffer:(url===fixtureLock.compiler.url?compilerArchive:archive).slice().buffer};}},
});
assert.equal(await assets.getKordocAssetStatus(plugin),'missing'); await assert.rejects(assets.getKordocAssetPaths(plugin),{name:'KordocNotInstalledError'});
const first=assets.downloadKordocAssets(plugin), same=assets.downloadKordocAssets(plugin); assert.equal(first,same); await first;
assert.equal(downloads,2); assert.equal(await assets.getKordocAssetStatus(plugin),'current');
const paths=await assets.getKordocAssetPaths(plugin);assert(stored.has(paths.worker)&&stored.has(paths.entry));assert(paths.worker.endsWith('/worker.js'));assert.equal(downloads,2,'Reading installed assets downloaded code');
const marker='.obsidian/plugins/writing-menu/kordoc-assets/current.json';
// Obsidian refuses rename-overwrite. Upgrading an existing protocol-1 install
// and reinstalling the current engine must both commit a different directory.
stored.set(marker,JSON.stringify({...JSON.parse(stored.get(marker)),protocol:1}));
assert.equal(await assets.getKordocAssetStatus(plugin),'outdated');
await assets.downloadKordocAssets(plugin);assert.equal(await assets.getKordocAssetStatus(plugin),'current');
assert.notEqual((await assets.getKordocAssetPaths(plugin)).worker,paths.worker);
const upgraded=stored.get(marker);await assets.downloadKordocAssets(plugin);assert.notEqual(stored.get(marker),upgraded);
const original=stored.get(marker);
for(const mode of ['network','integrity','disk','marker','compiler','startup']){
    networkFailure=mode==='network';badIntegrity=mode==='integrity';diskFailure=mode==='disk';markerFailure=mode==='marker';
    compilerFailure=mode==='compiler';startupFailure=mode==='startup';
    await assert.rejects(assets.downloadKordocAssets(plugin));
    assert.equal(stored.get(marker),original,'A failed install replaced the working marker');assert.equal(await assets.getKordocAssetStatus(plugin),'current');
}
networkFailure=badIntegrity=diskFailure=markerFailure=compilerFailure=startupFailure=false;assert.equal(removed.length,6);
stored.set(marker,JSON.stringify({...JSON.parse(original),protocol:1}));assert.equal(await assets.getKordocAssetStatus(plugin),'outdated');await assert.rejects(assets.getKordocAssetPaths(plugin),{name:'KordocNotInstalledError'});stored.set(marker,original);

// A persistent local worker is started once and reused for successive documents.
const workers=[];let responseMode='success';
class Worker {
    constructor(filename){assert(filename.startsWith('blob:'));this.requests=[];this.terminated=false;workers.push(this);if(responseMode!=='startup-wait')queueMicrotask(()=>this.onmessage?.({data:{kind:'ready',version:'4.24.9',protocol:2}}));}
    postMessage(request,transfer){assert.equal(request.bytes,transfer[0]);this.requests.push(request);if(responseMode==='wait')return;queueMicrotask(()=>this.onmessage?.({data:{id:request.id,kind:'rendered',pages:['<svg>본문</svg>'],warnings:['layout warning']}}));}
    terminate(){this.terminated=true;}
}
globalThis.Worker=Worker;
const engine=loadTsFixture('src/export/KordocEngine.ts',{
    obsidian:{Platform:{isDesktop:true}},'./DocumentEngine':{DocumentWorker:class{}},
    './KordocAssets':{KORDOC_VERSION:'4.24.9',KORDOC_PROTOCOL:2,getKordocAssetPaths:async()=>({worker:'plugin/engine/worker.js'})},
});
const renderPlugin={app:{vault:{adapter:{read:async()=>'/* browser engine */'}}}}, renderer=new engine.KordocRenderWorker(renderPlugin), bytes=new Uint8Array([1,2,3]);
assert.deepEqual(await renderer.render(bytes,new AbortController().signal),{pages:['<svg>본문</svg>'],warnings:['layout warning']});
await renderer.render(bytes,new AbortController().signal);assert.equal(workers.length,1,'A new worker was started for every preview');
renderer.cancelGeneration();assert(!workers[0].terminated,'Cancelling an idle preview discarded its warm engine');
responseMode='wait';const abort=new AbortController(), stopped=assert.rejects(renderer.render(bytes,abort.signal),{name:'AbortError'});
for(let attempt=0;workers[0].requests.length<3&&attempt<100;attempt++)await new Promise(resolve=>setImmediate(resolve));
abort.abort();await stopped;assert(workers[0].terminated);
responseMode='success';await renderer.render(bytes,new AbortController().signal);assert.equal(workers.length,2);renderer.dispose();assert(workers[1].terminated);
await assert.rejects(renderer.render(bytes,new AbortController().signal),{name:'AbortError'});
responseMode='startup-wait';const startingRenderer=new engine.KordocRenderWorker(renderPlugin), startupStopped=assert.rejects(startingRenderer.render(bytes,new AbortController().signal),{name:'AbortError'});
for(let attempt=0;workers.length<3&&attempt<100;attempt++)await new Promise(resolve=>setImmediate(resolve));
startingRenderer.dispose();await startupStopped;assert(workers[2].terminated,'Closing during startup leaked a worker');responseMode='success';

let cancelled=0,disposed=0;
const documentEngine=new engine.KordocDocumentEngine(renderPlugin,{generate:async()=>({bytes,text:'본문',warnings:[]}),template:async()=>({styles:[]}),cancelGeneration:()=>{},dispose:()=>{disposed++;}},
    {render:async()=>({pages:['<svg/>'],warnings:['layout warning']}),cancelGeneration:()=>{cancelled++;},dispose:()=>{disposed++;}});
const hwpx=await documentEngine.generate({},'hwpx',{});assert.deepEqual(hwpx.pages,['<svg/>']);assert.deepEqual(hwpx.warnings,['layout warning']);
assert.equal((await documentEngine.generate({},'txt',{})).pages,undefined);documentEngine.dispose();assert(disposed===2&&cancelled>0);

const realLock=JSON.parse(fs.readFileSync('src/export/kordoc-engine-lock.json','utf8'));
for(const pkg of [...realLock.packages,realLock.compiler]){assert(pkg.url.startsWith('https://registry.npmjs.org/'));assert(pkg.integrity.startsWith('sha512-'));assert(pkg.version&&!pkg.version.includes('^'));assert(!pkg.path.includes('..'));}
const bridge=await build({entryPoints:['src/export/kordocWorker.ts'],bundle:true,platform:'browser',format:'esm',target:'chrome100',write:false,external:['./node_modules/kordoc/*'],metafile:true});
assert(bridge.outputFiles[0].text.includes('./'+realLock.entry));assert(Object.keys(bridge.metafile.inputs).every(name=>!name.startsWith('node_modules/kordoc/')));
const codecs=await build({entryPoints:['src/export/documentWorker.ts'],bundle:true,platform:'browser',format:'iife',write:false,metafile:true});
assert(Object.keys(codecs.metafile.inputs).every(name=>!/(?:vendor|node_modules)\/kordoc\//.test(name)));
assert(!fs.existsSync('src/export/KordocCli.ts'),'npx implementation was retained');
console.log('PASS pinned downloads, SHA-512, tar path/link rejection, atomic installation/failure recovery, no background downloads, persistent worker reuse/cancellation/disposal, render warnings and renderer-free plugin builds. No real network or engine execution.');
