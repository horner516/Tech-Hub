import test from 'node:test';
import assert from 'node:assert/strict';
import {assignableProfile} from '../collector/av-ui.mjs';

// Shape returned by /api/v1/profile/list; the AV UI only offers profiles with exactly one static VLAN.
const groups=[
 {name:'Default',profileType:'Default',vlans:[{vlanId:1,static:true}]},
 {name:'Video',profileType:'Data',vlans:[{vlanId:10,static:true}]},
 {name:'Dante',profileType:'Audio Dante',vlans:[{vlanId:11,static:true},{vlanId:12,static:true}]},
 {name:'Dynamic',profileType:'Data',vlans:[{vlanId:20,static:false}]},
];

test('profile lookup follows the AV UI rule: one static VLAN, and its profileType is sent', () => {
 assert.deepEqual(assignableProfile(groups,10),{name:'Video',profileType:'Data',vlanId:10});
 assert.deepEqual(assignableProfile(groups,1),{name:'Default',profileType:'Default',vlanId:1});
 assert.equal(assignableProfile(groups,11),null,'multi-VLAN profiles are not port-assignable');
 assert.equal(assignableProfile(groups,20),null,'non-static VLANs are not offered');
 assert.equal(assignableProfile(groups,99),null);
});
