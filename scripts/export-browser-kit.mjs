import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export async function browserCheck({ html, bundle, css, run, capture, assets = {} }) {
    const executable = process.env.PAGED_TEST_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    if (!executable) throw Error('Set PAGED_TEST_BROWSER to Chromium.');
    const server=createServer((req,res)=>{const [type,data]=assets[req.url] || (req.url==='/bundle.js'?['text/javascript',bundle]:req.url==='/styles.css'?['text/css',css]:['text/html',html]);res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(data);});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'wm-export-browser-'));
    const child=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    let socket;
    try {
        const endpoint=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Chromium start timeout')),15000);child.once('error',reject);child.stderr.on('data',b=>{output+=b;const m=output.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
        const targets=await(await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
        let id=0;const pending=new Map();socket.onmessage=e=>{const d=JSON.parse(e.data);if(d.method==='Runtime.consoleAPICalled'&&d.params.type==='error')console.error(...d.params.args.map(a=>a.value||a.description));if(pending.has(d.id)){const p=pending.get(d.id);pending.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error(JSON.stringify(d.error))):p.resolve(d.result);}};
        const command=(method,params={})=>new Promise((resolve,reject)=>{const current=++id,timer=setTimeout(()=>reject(Error('CDP timeout '+method)),60000);pending.set(current,{resolve,reject,timer});socket.send(JSON.stringify({id:current,method,params}));});
        const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails));return r.result.value;};
        await command('Runtime.enable');await command('Emulation.setDeviceMetricsOverride',{width:1200,height:880,deviceScaleFactor:1,mobile:false});await command('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
        for(let n=0;n<100;n++){if(await evaluate('typeof window.runExportChecks === "function"'))break;await new Promise(resolve=>setTimeout(resolve,50));}
        console.log(await evaluate(run));
        if(capture)await capture({command,evaluate});
    } finally {socket?.close();child.kill();await new Promise(resolve=>setTimeout(resolve,400));server.close();if(path.dirname(profile)===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('wm-export-browser-'))try{fs.rmSync(profile,{recursive:true,force:true});}catch{} }
}
