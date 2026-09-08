const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {loadConfig}=require('../hub/server.cjs');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tech-hub-native-'));const c=loadConfig(dir);c.host='127.0.0.1';fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(c));
 const app=spawn(path.resolve('dist/Tech Hub.app/Contents/MacOS/Tech Hub'),[],{env:{...process.env,TECH_HUB_DATA_DIR:dir},stdio:'ignore'});
 try{let state;for(let i=0;i<100;i++){try{state=await fetch('http://127.0.0.1:8700/api/status',{signal:AbortSignal.timeout(500)}).then(r=>r.json());if(state.services.every(s=>s.state==='running'))break;}catch{}await new Promise(r=>setTimeout(r,300));}assert(state?.services.every(s=>s.state==='running'));console.log('PASS: native Mac host starts all three packaged services.');}
 finally{app.kill('SIGTERM');for(let i=0;i<40;i++){try{await fetch('http://127.0.0.1:8700/api/status',{signal:AbortSignal.timeout(300)});}catch{break;}await new Promise(r=>setTimeout(r,300));}for(const port of [8700,8701,8702,8703,18701,18702,18703])await assert.rejects(fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(500)}));console.log('PASS: parent termination cleans up all seven listeners.');fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
