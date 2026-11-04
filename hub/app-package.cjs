'use strict';
const fs=require('node:fs'),path=require('node:path');
const version=v=>typeof v==='string'&&/^\d+\.\d+\.\d+$/.test(v);
function compare(a,b){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;}
function safePath(p){return typeof p==='string'&&p.length>0&&p.length<240&&!p.includes('\\')&&!p.includes(':')&&!p.includes('\0')&&!p.startsWith('/')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!/[ .]$/.test(s)&&! /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s));}
function validateManifest(m){
 if(!m||m.schemaVersion!==1||! /^[a-z][a-z0-9-]{1,39}$/.test(m.id)||!safePath(m.id)||['master','admin','hub','apps','backups','logs','constructor','prototype','hostname-id'].includes(m.id))throw Error('Invalid app identity');
 if(typeof m.name!=='string'||!m.name.trim()||m.name.length>80||typeof m.description!=='string'||m.description.length>240)throw Error('Invalid app description');
 if(!version(m.version)||!version(m.minHostVersion)||!['node','native','shared'].includes(m.runtime)||!safePath(m.entry))throw Error('Invalid app runtime or version');
 if(!/^#[a-f0-9]{6}$/i.test(m.accent)||!Array.isArray(m.permissions)||m.permissions.some(p=>!['network','device-control','data-files'].includes(p)))throw Error('Invalid app appearance or permissions');
 if(!Array.isArray(m.platforms)||!m.platforms.length||m.platforms.some(p=>!['darwin-arm64','win32-x64','linux-arm64','linux-x64','universal'].includes(p)))throw Error('Invalid app platforms');
 if(m.runtime==='shared'&&(!['dsan','power'].includes(m.engine)||m.id!==m.engine||compare(m.minHostVersion,'1.0.1')<0))throw Error('Invalid shared runtime engine');
 if(m.platforms.includes('universal')&&(m.platforms.length!==1||m.runtime==='native'||compare(m.minHostVersion,'1.0.1')<0))throw Error('Universal apps require a shared runtime and host 1.0.1');
 if(m.runtimeAPI!==undefined&&(m.runtimeAPI!==1||compare(m.minHostVersion,'1.0.1')<0))throw Error('Unsupported runtime API');
 return m;
}
function inspectArchive(bytes,{hostVersion,platform}){
 const Zip=require('adm-zip'),zip=new Zip(bytes),entries=zip.getEntries();if(entries.length>50000)throw Error('Too many package files');
 let total=0;const names=new Set();
 for(const e of entries){const name=e.entryName.replace(/\/$/,''),mode=e.header.attr>>>16;
  if(!safePath(name)||names.has(name.toLowerCase())||(mode&0xf000)===0xa000)throw Error('Unsafe or duplicate package path');names.add(name.toLowerCase());total+=e.header.size;if(total>1024*1024*1024||e.header.size>256*1024*1024)throw Error('Package exceeds extraction limit');
 }
 const manifestEntry=zip.getEntry('techhub-app.json');if(!manifestEntry||manifestEntry.header.size>16384)throw Error('Missing app manifest');
 const manifest=validateManifest(JSON.parse(manifestEntry.getData().toString('utf8')));
 if(compare(manifest.minHostVersion,hostVersion)>0||!(manifest.platforms.includes(platform)||manifest.platforms.includes('universal')&&['darwin-arm64','win32-x64','linux-arm64','linux-x64'].includes(platform)))throw Error('Package is incompatible with this host');
 if(!zip.getEntry(manifest.entry)||zip.getEntry(manifest.entry).isDirectory)throw Error('App entry point is missing');
 if(manifest.platforms.includes('universal')&&entries.some(e=>/\.(exe|dll|node|dylib|so|pyd)$/i.test(e.entryName)))throw Error('Universal apps cannot bundle native binaries');
 return {manifest,entries};
}
function inspectPackage(bytes,options){return inspectArchive(bytes,options).manifest;}
function extractPackage(bytes,destination,{id,version:expectedVersion,hostVersion,platform}){
 const {manifest,entries}=inspectArchive(bytes,{hostVersion,platform});
 if(manifest.id!==id||manifest.version!==expectedVersion)throw Error('Package identity does not match');
 for(const e of entries){const dest=path.join(destination,e.entryName);if(e.isDirectory)fs.mkdirSync(dest,{recursive:true});else{fs.mkdirSync(path.dirname(dest),{recursive:true});const bytes=e.getData();if(bytes.length!==e.header.size)throw Error('Package length mismatch');fs.writeFileSync(dest,bytes,{mode:(e.header.attr>>>16)&0o111?0o755:0o644});}}
 if(manifest.runtime==='native'&&process.platform!=='win32')fs.chmodSync(path.join(destination,manifest.entry),0o755);
 return manifest;
}
module.exports={validateManifest,inspectPackage,extractPackage,compare,safePath,version};
