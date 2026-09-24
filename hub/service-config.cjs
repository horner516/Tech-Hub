'use strict';
const fs=require('node:fs'),path=require('node:path');
const {snapshot}=require('./backups.cjs');
const validationPath=fs.existsSync(path.join(__dirname,'../services/ultrix/src/validate-config.cjs'))?'../services/ultrix/src/validate-config.cjs':'../ultrix/src/validate-config.cjs';
const {validateRouterPanel,migrate}=require(validationPath);
const defaults={
 record:{devices:[],pollIntervalMs:2000,warnFreePercent:20,criticalFreePercent:10,controlEnabled:true,controlLocalOnly:true,confirmStop:true,allowFormat:false},
 // Router Panel (service id stays `ultrix` so existing installs, backups and sessions keep working).
 ultrix:{title:'Router Panel',mock:{enabled:false},activeRouter:'router-1',routers:[{id:'router-1',name:'Router 1',router:{type:'swp08',host:'',port:2000,matrix:1,extended:'auto',nameChars:'auto',allowRouting:true},levels:[{name:'Video',short:'V'}],sources:{},destinations:{},defaultProfile:'operator',profiles:{operator:{title:'Operator'},viewer:{title:'Viewer',readOnly:true}}}]}
};
function validate(id,value){
 if(!Object.hasOwn(defaults,id)||!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid service configuration');
 if(id==='record'){
  if(!Array.isArray(value.devices)||value.devices.length>128)throw Error('Devices must be an array of up to 128 recorders.');
  for(const d of value.devices)if(!['hyperdeck','kipro'].includes(d.type)||typeof d.host!=='string'||!d.host.trim()||/[\s/]/.test(d.host)|| (d.port!==undefined&&(!Number.isInteger(d.port)||d.port<1||d.port>65535)))throw Error('Each recorder needs type hyperdeck or kipro, a host, and a valid optional port.');
  if(!Number.isFinite(value.pollIntervalMs)||value.pollIntervalMs<250)throw Error('Poll interval must be at least 250 ms.');
  for(const key of ['warnFreePercent','criticalFreePercent'])if(value[key]!==undefined&&(!Number.isFinite(value[key])||value[key]<0||value[key]>100))throw Error('Free space thresholds must be between 0 and 100 percent.');
  if((value.criticalFreePercent??10)>(value.warnFreePercent??20))throw Error('Critical free space must not exceed the warning threshold.');
  for(const key of ['controlEnabled','controlLocalOnly','confirmStop','allowFormat'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw Error('Recorder control settings must be true or false.');
 }else{
  // Checks every saved router: type, host, port, levels (one for a Videohub), lists and profiles.
  value=validateRouterPanel(value);
  if(value.mock?.enabled)throw Error('Simulator mode is reserved for tests in the bundled service.');
 }
 return value;
}
function file(dir,id){if(!Object.hasOwn(defaults,id))throw Error('Unknown settings service');return path.join(dir,id,'config.json');}
function read(dir,id){const name=file(dir,id);if(!fs.existsSync(name))write(dir,id,structuredClone(defaults[id]));const value=JSON.parse(fs.readFileSync(name,'utf8'));return id==='ultrix'?migrate(value):value;}
function write(dir,id,input){const value=validate(id,input);const name=file(dir,id);if(fs.existsSync(name))snapshot(dir);fs.mkdirSync(path.dirname(name),{recursive:true,mode:0o700});fs.writeFileSync(name+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(name+'.tmp',name);}
module.exports={defaults,validate,file,read,write};
