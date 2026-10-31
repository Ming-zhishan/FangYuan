import test from 'node:test'
import assert from 'node:assert/strict'
import { adjustParticipation } from '../modules/conversation/participation.mjs'
test('a non-owner @ bypasses the native burst brake; ordinary engaged chatter still gives room to others',()=>{
  const burst={reply:false,mode:'none',reason:'刚说了太多'}
  assert.equal(adjustParticipation(burst,{mentioned:true,lastDeliveredAt:1000,now:1100}).reply,true)
  assert.equal(adjustParticipation({reply:true,mode:'engaged'},{lastDeliveredAt:1000,now:1100}).reply,false)
  assert.equal(adjustParticipation({reply:true,mode:'interject'},{lastDeliveredAt:1000,now:70000}).reply,true)
  assert.equal(adjustParticipation({reply:true,mode:'engaged'},{ordinaryTurnsLastHour:8}).reply,false)
  assert.equal(adjustParticipation(burst,{mentioned:true,ordinaryTurnsLastHour:8}).reply,true)
})
