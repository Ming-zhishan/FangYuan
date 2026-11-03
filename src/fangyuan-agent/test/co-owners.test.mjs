import test from 'node:test'
import assert from 'node:assert/strict'
import {coOwners,fullOwners,isFullOwner,roleOf,businessAdmins} from '../modules/principals/policy.mjs'
const cfg=()=>({ownerQQ:'100001',botQQ:'200001',ext:{principals:{enabled:true,coOwners:['100002'],businessAdmins:['100002','100003']}}})
test('explicit owner set is exact, deduplicated and independent from ordinary business admins',()=>{
  const c=cfg();c.ext.principals.coOwners.push('100002','100001','200001','100003x',100004,'all',' 100005 ')
  assert.deepEqual(coOwners(c),['100002']);assert.deepEqual(fullOwners(c),['100001','100002'])
  assert.equal(roleOf(c,'100002'),'co_owner');assert.deepEqual(businessAdmins(c),['100003'])
  assert.equal(isFullOwner(c,'100003'),false);assert.equal(isFullOwner(c,'200001'),false)
})
test('removal and disabling take effect immediately; primary owner remains',()=>{
  const c=cfg();c.ext.principals.coOwners=[];assert.equal(isFullOwner(c,'100002'),false)
  c.ext.principals.coOwners=['100002'];c.ext.principals.enabled=false
  assert.equal(isFullOwner(c,'100002'),false);assert.equal(isFullOwner(c,'100001'),true)
})
