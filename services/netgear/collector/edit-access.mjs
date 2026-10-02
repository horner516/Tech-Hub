// Edit PIN and unlock sessions for VLAN changes. Same model as Router Panel: viewing is open, a PIN set on the
// local-only settings page unlocks changes, and the browser holds an HttpOnly `sid` cookie (Tech Hub's gateway
// renames it to `techhub_netgear_edit`). Unlike Router Panel the PIN is stored only as a scrypt hash.
import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt=promisify(scryptCallback);
const RECORD=/^scrypt:([a-f0-9]{32}):([a-f0-9]{64})$/;

export const PIN_RULE='Use 4 to 64 characters.';
export const validPin=pin=>typeof pin==='string'&&pin.length>=4&&pin.length<=64;

export async function hashPin(pin){
 if(!validPin(pin))throw new Error(`Edit PIN: ${PIN_RULE}`);
 const salt=randomBytes(16).toString('hex');
 return `scrypt:${salt}:${(await scrypt(pin,salt,32)).toString('hex')}`;
}

export async function verifyPin(pin,record){
 const match=RECORD.exec(record||'');
 if(!match||typeof pin!=='string'||pin.length>64)return false;
 return timingSafeEqual(await scrypt(pin,match[1],32),Buffer.from(match[2],'hex'));
}

export const isPinRecord=record=>RECORD.test(record||'');
export const cookieSid=req=>/(?:^|;\s*)sid=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie??'')?.[1];

/**
 * Unlock sessions plus a lockout after repeated wrong PINs. The lockout is global rather than per address
 * because behind Tech Hub every request arrives from the gateway on 127.0.0.1.
 */
export function createEditSessions({ttlMs=12*3600_000,maxFailures=5,baseLockMs=30_000,maxLockMs=15*60_000,now=Date.now}={}){
 const sessions=new Map();
 let failures=0,lockedUntil=0;
 const prune=()=>{const t=now();for(const [sid,expires] of sessions)if(expires<=t)sessions.delete(sid)};
 return {
  ttlMs,
  /** Returns {ok:true,sid} or {ok:false,status,error,retryAfterMs?}. */
  async login(pin,record){
   const t=now();
   if(lockedUntil>t)return {ok:false,status:429,error:'Too many wrong PINs. Try again shortly.',retryAfterMs:lockedUntil-t};
   if(!await verifyPin(pin,record)){
    failures++;
    if(failures>=maxFailures)lockedUntil=t+Math.min(maxLockMs,baseLockMs*2**(failures-maxFailures));
    return {ok:false,status:403,error:'wrong PIN'};
   }
   failures=0;lockedUntil=0;prune();
   const sid=randomBytes(24).toString('hex');
   sessions.set(sid,t+ttlMs);
   return {ok:true,sid};
  },
  unlocked(sid){if(!sid)return false;const expires=sessions.get(sid);if(!expires)return false;if(expires<=now()){sessions.delete(sid);return false}return true},
  logout(sid){sessions.delete(sid)},
  /** Changing or removing the PIN ends every unlock. */
  revokeAll(){sessions.clear()},
 };
}
