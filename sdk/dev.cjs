'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const {validate}=require('./validate.cjs'),{pack}=require('./package.cjs');
const excluded=new Set(['.git','.github','.codex','.agents','.DS_Store','dist','build','coverage','tests','test']);
function stage(source,dest){
 source=path.resolve(source);if(!fs.statSync(source).isDirectory())throw Error('Module directory required');
 function copy(from,to){fs.mkdirSync(to,{recursive:true});for(const entry of fs.readdirSync(from,{withFileTypes:true})){
  if(excluded.has(entry.name))continue;const src=path.join(from,entry.name),out=path.join(to,entry.name);
  if(entry.isSymbolicLink())throw Error('Bundle dependencies as regular files first: '+path.relative(source,src));
  if(entry.isDirectory())copy(src,out);else if(entry.isFile())fs.copyFileSync(src,out);else throw Error('Unsupported file: '+src);
 }}copy(source,dest);
}
function temporary(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'techhub-sdk-check-'));try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
function check(source){return temporary(dir=>{
 stage(source,dir);const {manifest,count}=validate(dir),errors=[];
 function syntax(folder){for(const e of fs.readdirSync(folder,{withFileTypes:true})){if(e.name==='node_modules')continue;const file=path.join(folder,e.name);if(e.isDirectory())syntax(file);else if(/\.(cjs|mjs|js)$/.test(e.name))try{execFileSync(process.execPath,['--check',file],{stdio:'pipe',timeout:10000});}catch(err){if(errors.length<20)errors.push({file:path.relative(dir,file),code:'SYNTAX',message:String(err.stderr||err.message).replaceAll(dir,'MODULE').slice(0,1800)});}}}syntax(dir);
 return {ok:!errors.length,module:{id:manifest.id,version:manifest.version},files:count,checks:['manifest','package paths','entry exists','JavaScript syntax (excluding dependencies)'],errors,notChecked:['device behavior','browser scripts embedded in HTML','dependency behavior','secrets','platform execution']};
});}
function context(source){const root=path.resolve(source),m=JSON.parse(fs.readFileSync(path.join(root,'techhub-app.json'),'utf8'));return {ok:true,module:{id:m.id,name:m.name,version:m.version,minHostVersion:m.minHostVersion,entry:m.entry},readFirst:[path.join(__dirname,'AI-START.md'),path.join(root,'MODULE-BRIEF.md')],commands:{check:`node ${JSON.stringify(__filename)} check ${JSON.stringify(root)}`,serve:`node ${JSON.stringify(__filename)} serve ${JSON.stringify(root)}`},contract:{runtime:'Node 24, helper API 1',platforms:['darwin-arm64','win32-x64','linux-arm64','linux-x64'],settings:'TECH_HUB_DATA_DIR',helper:'TECH_HUB_RUNTIME_API',transport:'HTTP/SSE through host; no WebSocket gateway'},note:'Paths in commands are illustrative; use your shell’s quoting. Read protocol details from the brief, not guessed SDK defaults.'};}
function init(target,id,name){
 if(!/^[a-z][a-z0-9-]{1,39}$/.test(id||''))throw Error('Use a stable lowercase module ID (2–40 characters)');
 if(!name||name.length>80)throw Error('Supply a module name (1–80 characters)');
 target=path.resolve(target);if(fs.existsSync(target))throw Error('Destination already exists; no files were changed');
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.cpSync(path.join(__dirname,'template'),target,{recursive:true});
 const file=path.join(target,'techhub-app.json'),m=JSON.parse(fs.readFileSync(file));Object.assign(m,{id,name,description:name+' module for Tech Hub'});fs.writeFileSync(file,JSON.stringify(m,null,2)+'\n');
 const serverFile=path.join(target,'server.cjs');fs.writeFileSync(serverFile,fs.readFileSync(serverFile,'utf8').replace("{label:'Example Meter'}",'{label:'+JSON.stringify(name)+'}'));
 const htmlFile=path.join(target,'public/index.html'),escaped=name.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));fs.writeFileSync(htmlFile,fs.readFileSync(htmlFile,'utf8').replaceAll('Example Meter',escaped));
 fs.writeFileSync(path.join(target,'AGENTS.md'),'# Module development\n\nRead MODULE-BRIEF.md and the SDK AI-START.md first. Use sdk/dev.cjs context and check for focused context and diagnostics. Read other guides on demand. Use fixtures by default; never invent protocol facts or claim hardware testing from simulated results. Keep the brief current and short.\n');
 fs.writeFileSync(path.join(target,'MODULE-BRIEF.md'),`# ${name}\n\nModule ID: ${id}\n\n## Goal\nDescribe one observable behavior.\n\n## Protocol evidence\nAdd official documentation, supported firmware, allowed commands, and sanitized fixture paths. Unknown until provided.\n\n## Development\nSDK location: ${__dirname}\nStart with AI-START.md. Checks: node SDK_PATH/dev.cjs check MODULE_DIR\nTests: add a focused test command after implementing the first behavior.\n\n## Current state\nStarter only; no devices configured.\n\n## Last verification / next step\nNot yet tested. Replace this section with concise results and remaining work.\n`);
 return {ok:true,directory:target,id,next:'Read MODULE-BRIEF.md and sdk/AI-START.md; run check and serve.'};
}
async function main(args){const [command,source,...rest]=args;if(command==='init')return init(source,rest[0],rest[1]);if(!source)throw Error('Usage: dev.cjs init DIR ID NAME | context DIR | check DIR | serve DIR [--viewer] | pack DIR OUTPUT.zip');
 if(command==='context')return context(source);if(command==='check')return check(source);
 if(command==='pack'){if(!rest[0])throw Error('Output ZIP path required');const output=path.resolve(rest[0]),root=path.resolve(source);if(output===root||output.startsWith(root+path.sep))throw Error('Write the ZIP outside the module directory');const result=check(source);if(!result.ok)return result;return temporary(dir=>{stage(source,dir);const m=pack(dir,output);return {ok:true,id:m.id,version:m.version,output};});}
 if(command==='serve'){if(rest.some(v=>v!=='--viewer'))throw Error('Only --viewer is supported');return require('./preview.cjs').serve(source,{viewer:rest.includes('--viewer')});}
 throw Error('Unknown command: '+command);
}
module.exports={stage,check,context,init};
if(require.main===module)main(process.argv.slice(2)).then(result=>{if(result){console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;}}).catch(e=>{console.log(JSON.stringify({ok:false,errors:[{code:'SDK_ERROR',message:e.message.slice(0,2000)}]}));process.exitCode=1;});

