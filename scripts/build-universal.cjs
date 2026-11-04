'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'techhub-universal-'));
try{
 for(const id of ['pixel-peeker','otter-edid-editor']){
  execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-b'],{cwd:path.resolve('services',id),env:{...process.env,VITE_TECH_HUB_MANAGED:'1'},stdio:'inherit'});
  execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{cwd:path.resolve('services',id),env:{...process.env,VITE_TECH_HUB_MANAGED:'1'},stdio:'inherit'});
 }
 execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build','--config','desktop/vite.config.ts'],{cwd:path.resolve('services/lux'),stdio:'inherit'});
 execFileSync(process.execPath,['node_modules/next/dist/bin/next','build'],{cwd:path.resolve('services/netgear'),stdio:'inherit'});
 execFileSync(process.execPath,['scripts/bundle-services.cjs',dir],{stdio:'inherit'});
 execFileSync(process.execPath,['scripts/package-apps.cjs',dir],{stdio:'inherit'});
}finally{fs.rmSync(dir,{recursive:true,force:true});}
