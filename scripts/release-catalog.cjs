'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Zip=require('adm-zip');
const dir=path.resolve(process.argv[2]||'installers'),catalog=JSON.parse(fs.readFileSync(path.join(dir,'tech-hub-catalog.json'))),apps=new Map(catalog.apps.map(a=>[a.id,a]));
for(const a of apps.values())for(const p of Object.values(a.packages)){const bytes=fs.readFileSync(path.join(dir,path.basename(new URL(p.url).pathname)));if(bytes.length!==p.size||crypto.createHash('sha256').update(bytes).digest('hex')!==p.sha256)throw Error('Release package does not match catalog');}
fs.writeFileSync(path.join(dir,'tech-hub-catalog.json'),JSON.stringify({schemaVersion:1,apps:[...apps.values()]},null,2));
require('./package-sdk.cjs').packageSDK(path.join(dir,'Tech-Hub-SDK.zip'));
for(const name of fs.readdirSync(dir))if(/\.(zip|dmg|exe|tar\.gz)$/.test(name))fs.writeFileSync(path.join(dir,name+'.sha256'),crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex')+'  '+name+'\n');
