'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createStaticServer}=require('../hub/static-tool-server.cjs');
test('browser tools serve local assets and SPA navigation without accepting uploads or exposing files',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'techhub-static-')),root=path.join(dir,'public');fs.mkdirSync(root);
 fs.writeFileSync(path.join(root,'index.html'),'<html><head><title>Local tool</title></head><body>Ready</body></html>');
 fs.writeFileSync(path.join(root,'file.wasm'),Buffer.from([0,97,115,109]));fs.writeFileSync(path.join(dir,'secret.txt'),'private');
 if(process.platform!=='win32')fs.symlinkSync(path.join(dir,'secret.txt'),path.join(root,'outside.txt'));
 const server=createStaticServer(root);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 assert.match(await fetch(base).then(r=>r.text()),/Local tool/);
 assert.equal((await fetch(base+'/workspace',{headers:{Accept:'text/html'}})).status,200);
 assert.equal((await fetch(base+'/missing.js',{headers:{Accept:'text/html'}})).status,404);
 assert.equal((await fetch(base+'/api/unknown',{headers:{Accept:'text/html'}})).status,404);
 assert.equal((await fetch(base+'/api/health').then(r=>r.json())).kind,'browser-tool');
 const worker=await fetch(base+'/sw.js').then(r=>r.text());assert.match(worker,/unregister/);assert(!worker.includes("'fetch'"));
 assert.equal((await fetch(base+'/file.wasm',{method:'HEAD'})).headers.get('content-length'),'4');
 assert.deepEqual(Buffer.from(await fetch(base+'/file.wasm').then(r=>r.arrayBuffer())),Buffer.from([0,97,115,109]));
 assert.equal((await fetch(base+'/%2e%2e%2fsecret.txt')).status,403);
 if(process.platform!=='win32')assert.equal((await fetch(base+'/outside.txt')).status,403);
 assert.equal((await fetch(base,{method:'POST',body:'EDID data'})).status,405);
});
test('health summaries distinguish device faults, unverified readings and tools with no devices',()=>{
 const {devices,summarize}=require('../hub/diagnostics.cjs');
 assert.deepEqual(summarize({devices:[{status:'connected'},{status:'offline'},{status:'unknown'},{status:'ready',problem:'fault'}]}),{kind:'devices',total:4,healthy:1,attention:2,unknown:1});
 assert.equal(summarize({kind:'browser-tool',devices:[]}).kind,'browser-tool');
 const rows=devices('rtoo',{amps:{one:{connected:true,status:{generalError:true}},two:{connected:false}}});
 assert.equal(summarize({devices:rows}).attention,2);
});
