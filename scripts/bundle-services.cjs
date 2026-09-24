'use strict';
const fs=require('node:fs'),path=require('node:path');
const destination=path.resolve(process.argv[2]),root=path.resolve(__dirname,'..');
function copy(from,to){fs.mkdirSync(path.dirname(to),{recursive:true});fs.cpSync(from,to,{recursive:true,dereference:true,filter:p=>path.basename(p)!=='node_modules'});}
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
copy(path.join(root,'THIRD_PARTY.md'),path.join(destination,'THIRD_PARTY.md'));
console.log('Bundled NETGEAR AV Switchboard, Record Monitor, and Router Panel.');
