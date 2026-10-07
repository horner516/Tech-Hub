// Client for the switch's AV UI web API: the same API the switch's own AV interface uses, shared across the AV line
// (M4250, M4300, M4350, M4500). Current firmware serves it on HTTPS 4443; older firmware on 443 or HTTP 80.
// VLAN changes use its profile-assign and save calls (captured from the AV UI on an M4250, 2026-10-01), which apply
// the whole AV network profile. Never use the ConfigAgent REST API's (HTTPS 8443) raw PVID/membership writes.
import http from 'node:http';
import https from 'node:https';

const parseEndpoints=value=>value.split(',').map(item=>{const [protocol,port]=item.trim().split(':');return {protocol,port:Number(port)}}).filter(item=>['http','https'].includes(item.protocol)&&item.port>0);
// NETGEAR_AV_ENDPOINTS exists so tests can point at a mock on an unprivileged port.
const AV_ENDPOINTS=parseEndpoints(process.env.NETGEAR_AV_ENDPOINTS||'https:4443,https:443,http:80');
const preferred=new Map();// switch ip -> endpoint that last accepted a login, tried first next time

export function avRequest(endpoint,ip,pathname,{method='GET',headers={},body,timeout=8000}={}){return new Promise((resolve,reject)=>{const {protocol,port}=endpoint,payload=body===undefined?null:JSON.stringify(body),client=protocol==='https'?https:http,request=client.request({protocol:`${protocol}:`,hostname:ip,port,path:pathname,method,rejectUnauthorized:false,agent:false,headers:{Accept:'application/json',...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}),...headers}},response=>{let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.on('end',()=>{let data={};try{data=text?JSON.parse(text):{}}catch{}resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,data})})});request.setTimeout(timeout,()=>request.destroy(new Error('AV interface request timed out')));request.on('error',reject);if(payload)request.write(payload);request.end()})}

const respFailure=(data,what)=>data?.resp?.respCode===0?null:`${what} failed (${data?.resp?.respMsg||`code ${data?.resp?.respCode??'unknown'}`})`;

/** Log in, run `work(av)` with an authenticated session, and always log out (sessions on the switch are limited). */
export async function withAvSession(ip,username,password,work){
 if(!username?.trim()||!password)throw new Error('AV interface username and password are required');
 const known=preferred.get(ip),candidates=known?[known,...AV_ENDPOINTS.filter(item=>item!==known)]:AV_ENDPOINTS;
 let login=null,endpoint=null,lastLoginError=null;
 for(const candidate of candidates){
  try{
   const response=await avRequest(candidate,ip,'/api/v1/login',{method:'POST',body:{user:{name:username.trim(),password}}});
   if(response.ok&&response.data?.resp){login=response;endpoint=candidate;break}
   // The AV interface answered but refused the login: other ports won't help, so stop here.
   if(response.status===401||response.status===403||response.data?.resp)throw Object.assign(new Error(`AV login refused (${response.data?.resp?.respMsg||`HTTP ${response.status}`}). Check the switch admin login in Server settings.`),{final:true});
   lastLoginError=`${candidate.protocol}:${candidate.port} HTTP ${response.status}`;
  }catch(e){if(e.final)throw e;lastLoginError=`${candidate.protocol}:${candidate.port} ${e.message}`}
 }
 if(!login)throw new Error(`AV login failed (${lastLoginError||'switch unavailable'})`);
 const loginData=login.data,session=loginData?.user?.session;
 if(loginData?.resp?.respCode!==0||!session)throw new Error(respFailure(loginData,'AV login')||'AV login failed (no session)');
 preferred.set(ip,endpoint);
 const av={ip,endpoint,request:(pathname,options={})=>avRequest(endpoint,ip,pathname,{...options,headers:{Session:session,...options.headers}})};
 try{return await work(av)}
 finally{av.request('/api/v1/logout',{timeout:2500}).catch(()=>{})}
}

/** AV profiles as the switch returns them (`groups`), flattened to one entry per profile VLAN (`profiles`). */
export async function listProfiles(av){
 const endpoints=['/api/v1/profile/list','/api/v1/profile/list_ex'],attempts=[];
 for(const endpoint of endpoints){
  const response=await av.request(endpoint);
  if(response.status===404){attempts.push(`${endpoint} (404)`);continue}
  if(!response.ok)throw new Error(`AV profile API returned HTTP ${response.status} at ${endpoint}`);
  const data=response.data;
  if(data?.resp?.respCode!==0)throw new Error(`AV profile API failed (code ${data?.resp?.respCode??'unknown'})`);
  const groups=Array.isArray(data.profileList)?data.profileList:[];
  const profiles=groups.flatMap(group=>{if(!group)return[];if(!Array.isArray(group.vlans))return[group];const {vlans,...profile}=group;return vlans.map(vlan=>({...profile,...vlan}))});
  if(!profiles.length)throw new Error(`The switch returned no configured AV profiles from ${endpoint}`);
  return {profiles,groups,endpoint};
 }
 throw new Error(`This firmware did not expose a supported AV profile route: ${attempts.join(', ')}`);
}

/**
 * The profile a port can be assigned to for `vlanId`, using the AV UI's own rule: a profile with exactly one,
 * static VLAN. Returns {name, profileType, vlanId} or null.
 */
export function assignableProfile(groups,vlanId){
 const group=groups.find(item=>Array.isArray(item?.vlans)&&item.vlans.length===1&&item.vlans[0]?.static&&Number(item.vlans[0].vlanId)===vlanId&&item.profileType);
 return group?{name:String(group.name??''),profileType:String(group.profileType),vlanId}:null;
}

export const profileAssignment={
 ready:true,
 reason:null,
 /** Same request the AV UI sends when a port is moved to a profile ("Untaged" is NETGEAR's spelling). */
 async assign(av,{port,profile}){
  const response=await av.request('/api/v1/profile/port',{method:'POST',body:{portToProfile:{vlanId:profile.vlanId,profileType:profile.profileType,Untaged:[port.number]}}});
  if(!response.ok)throw Object.assign(new Error(`The AV interface rejected the change (HTTP ${response.status}). Nothing was confirmed.`),{status:502});
  const failure=respFailure(response.data,'The AV profile change');
  if(failure)throw Object.assign(new Error(failure),{status:502});
 },
 /** The AV UI's Save button: running config → startup config. */
 async save(av){
  const response=await av.request('/api/v1/switch_config',{method:'POST',body:{switchConfig:{save:true}},timeout:30000});
  const failure=!response.ok?`Save failed (HTTP ${response.status})`:respFailure(response.data,'Save');
  if(failure)throw new Error(failure);
 },
};
