'use strict';
const fs=require('node:fs'),path=require('node:path');
const destination=path.resolve(process.argv[2]),root=path.resolve(__dirname,'..');
function copy(from,to){fs.mkdirSync(path.dirname(to),{recursive:true});fs.cpSync(from,to,{recursive:true,dereference:true,filter:p=>path.basename(p)!=='node_modules'});}
if(!process.argv.includes('--host-only')){
for(const id of ['pixel-peeker','otter-edid-editor']){
 const target=path.join(destination,id),source=path.join(root,'services',id);
 copy(path.join(source,'dist'),path.join(target,'public'));
 copy(path.join(root,'hub/static-tool-server.cjs'),path.join(target,'server.cjs'));
 for(const name of ['LICENSE','ATTRIBUTIONS.md','README.md','UPSTREAM.json'])copy(path.join(source,name),path.join(target,name));
 fs.writeFileSync(path.join(target,'THIRD_PARTY-LICENSES.txt'),require('./frontend-licenses.cjs').frontendLicenses(source));
}
const lux=path.join(destination,'lux');
for(const name of ['electron','lib','package.json'])copy(path.join(root,'services/lux',name),path.join(lux,name));
copy(path.join(root,'services/lux/desktop-web'),path.join(lux,'dashboard'));
copy(path.join(root,'hub/lux-server.cjs'),path.join(lux,'server.cjs'));
require('./package-rtoo.cjs').stageRtoo(path.join(destination,'rtoo'));
for(const id of ['record','ultrix']){
 const source=path.join(root,'services',id),target=path.join(destination,id);
 for(const name of (id==='record'?['server.js','public','LICENSE','README.md']:['src','public','package.json','README.md']))copy(path.join(source,name),path.join(target,name));
}
const source=path.join(root,'services','netgear'),target=path.join(destination,'netgear');
for(const name of ['collector','out','package.json'])copy(path.join(source,name),path.join(target,name));
const copied=new Set();
function dependency(name,from){
 if(copied.has(name))return;copied.add(name);
 const manifest=require.resolve(name+'/package.json',{paths:[from]}),data=JSON.parse(fs.readFileSync(manifest,'utf8'));
 copy(path.dirname(manifest),path.join(target,'node_modules',name));
 for(const child of Object.keys(data.dependencies||{}))dependency(child,path.dirname(manifest));
}
dependency('net-snmp',source);
}
// Hub dependencies are separate from the NETGEAR collector's dependency tree.
const hubCopied=new Set();
function hubDependency(name,from){
 if(hubCopied.has(name))return;hubCopied.add(name);
 // Some packages intentionally hide package.json behind an exports map.
 let directory=path.dirname(require.resolve(name,{paths:[from]})),manifest,data;
 while(true){
  manifest=path.join(directory,'package.json');
  if(fs.existsSync(manifest)){data=JSON.parse(fs.readFileSync(manifest,'utf8'));if(data.name===name)break;}
  const parent=path.dirname(directory);if(parent===directory)throw Error('Unable to locate dependency '+name);directory=parent;
 }

 copy(path.dirname(manifest),path.join(destination,'node_modules',name));
 for(const child of Object.keys(data.dependencies||{}))hubDependency(child,path.dirname(manifest));
}
hubDependency('bonjour-service',root);
hubDependency('adm-zip',root);
copy(path.join(root,'THIRD_PARTY.md'),path.join(destination,'THIRD_PARTY.md'));
console.log('Bundled NETGEAR AV Switchboard, Record Monitor, and Router Panel.');

copy(path.join(root,'services/ultrix/src/validate-config.cjs'),path.join(destination,'hub/router-validation.cjs'));
