import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditSessions,hashPin,verifyPin,validPin,cookieSid} from '../collector/edit-access.mjs';

test('PINs are stored as salted scrypt hashes and verified in constant time', async () => {
 const record=await hashPin('2468');
 assert.match(record,/^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/);
 assert.ok(!record.includes('2468'));
 assert.notEqual(record,await hashPin('2468'),'each hash gets its own salt');
 assert.equal(await verifyPin('2468',record),true);
 assert.equal(await verifyPin('2469',record),false);
 assert.equal(await verifyPin('2468','plaintext'),false);
 assert.equal(validPin('123'),false);
 assert.equal(validPin('1234'),true);
 await assert.rejects(hashPin('12'),/4 to 64/);
});

test('unlock sessions expire, can be revoked, and wrong PINs lock everyone out with backoff', async () => {
 let now=1_000_000;
 const record=await hashPin('2468'),sessions=createEditSessions({ttlMs:60_000,maxFailures:3,baseLockMs:10_000,now:()=>now});
 const ok=await sessions.login('2468',record);
 assert.equal(ok.ok,true);
 assert.match(ok.sid,/^[a-f0-9]{48}$/);
 assert.equal(sessions.unlocked(ok.sid),true);
 now+=60_001;
 assert.equal(sessions.unlocked(ok.sid),false,'expired');

 for(let i=0;i<2;i++)assert.equal((await sessions.login('0000',record)).status,403);
 assert.equal((await sessions.login('0000',record)).status,403,'third failure triggers the lock');
 const locked=await sessions.login('2468',record);
 assert.equal(locked.status,429,'even the right PIN waits out the lock');
 assert.equal(locked.retryAfterMs,10_000);
 now+=10_001;
 assert.equal((await sessions.login('0000',record)).status,403);
 assert.equal((await sessions.login('2468',record)).retryAfterMs,20_000,'lock doubles while failures continue');
 now+=20_001;
 const again=await sessions.login('2468',record);
 assert.equal(again.ok,true,'success clears the failure count');
 sessions.revokeAll();
 assert.equal(sessions.unlocked(again.sid),false);
});

test('only a well-formed sid cookie is read', () => {
 const sid='a'.repeat(48);
 assert.equal(cookieSid({headers:{cookie:`theme=dark; sid=${sid}`}}),sid);
 assert.equal(cookieSid({headers:{cookie:'sid=../../etc'}}),undefined);
 assert.equal(cookieSid({headers:{}}),undefined);
});
