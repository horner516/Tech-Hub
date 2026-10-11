'use strict';
// Build once: exactly these bytes are installed on both supported platforms.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),Zip=require('adm-zip');
const {pack}=require('../sdk/package.cjs');
const resources=path.resolve(process.argv[2]),releaseVersion=require('../package.json').version,output=path.resolve('dist/app-packages-universal'),stage=fs.mkdtempSync(path.join(os.tmpdir(),'techhub-packages-'));
function copyTree(from,to){if(path.basename(from)==='.env.example')return;const st=fs.statSync(from);if(st.isDirectory()){fs.mkdirSync(to,{recursive:true});for(const name of fs.readdirSync(from).sort())copyTree(path.join(from,name),path.join(to,name));}else{fs.copyFileSync(from,to);fs.chmodSync(to,0o644);}}
fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});const catalog={schemaVersion:1,apps:[]};
const specs=[
 ['rtoo','R-Too','Read-only d&b amplifier fleet monitoring over OCA/AES70','node','server.js','#eab308'],
 ['dsan','D’san Ready','Limitimer and PerfectCue','shared','index.html','#ff8a1f'],
 ['power','Power Monitor','Power distribution monitoring','shared','web/index.html','#4ade80'],
 ['netgear','NETGEAR AV Switchboard','Switch discovery and monitoring','node','netgear/collector/server.mjs','#22d3ee'],
 ['record','Record Monitor','HyperDeck and AJA Ki Pro recorders','node','record/server.js','#ef4444'],
 ['ultrix','Router Panel','Ultrix and Videohub routing','node','ultrix/src/main.js','#3b82f6']
];
try{for(const [id,name,description,runtime,entry,accent]of specs){
 const {version,minHostVersion}=require('../modules.json')[id];
 const dir=path.join(stage,id);fs.mkdirSync(dir);
 if(id==='rtoo')copyTree(path.join(resources,id),dir);
 else if(id==='dsan')copyTree('services/dsan/index.html',path.join(dir,'index.html'));
 else if(id==='power')copyTree('services/power/web',path.join(dir,'web'));
 else copyTree(path.join(resources,id),path.join(dir,id));
 const manifest={schemaVersion:1,id,name,description,version,minHostVersion,runtime,...(runtime==='shared'?{engine:id}:id==='rtoo'?{runtimeAPI:1}:{}),entry,accent,permissions:['network','data-files',...(['dsan','netgear','record','ultrix'].includes(id)?['device-control']:[])],platforms:['universal']};
 fs.writeFileSync(path.join(dir,'techhub-app.json'),JSON.stringify(manifest,null,2));const filename=`techhub-app-${id}-${version}-universal.zip`,dest=path.join(output,filename);pack(dir,dest);const bytes=fs.readFileSync(dest);
 catalog.apps.push({id,name,description,version,minHostVersion,developer:'Tech Hub',sourceUrl:`https://github.com/horner516/Tech-Hub/tree/main/services/${id}`,permissions:manifest.permissions,packages:{universal:{url:`https://github.com/horner516/Tech-Hub/releases/download/v${releaseVersion}/${filename}`,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length}}});
 }
 fs.writeFileSync(path.join(output,'catalog.json'),JSON.stringify(catalog,null,2));
 fs.copyFileSync(path.join(output,'catalog.json'),path.resolve('dist/tech-hub-catalog.json'));
 const all=new Zip();all.addLocalFolder(output);all.writeZip(path.resolve('dist/Tech-Hub-All-Apps.zip'));
 console.log('Packaged six universal modules. Lux Link is paused.');
}finally{fs.rmSync(stage,{recursive:true,force:true});}
