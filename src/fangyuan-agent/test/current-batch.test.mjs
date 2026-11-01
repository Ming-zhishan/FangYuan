import test from 'node:test'
import assert from 'node:assert/strict'
import { currentBatch } from '../modules/conversation/current-batch.mjs'
import { applyReviewDecision } from '../modules/conversation/decision.mjs'
test('current batch identifies the new speaker without re-enqueueing an older phone question',()=>{
  const rows=[{id:'old',role:'user',uid:'111111',text:'全部手机号记得吗'},{id:'now',role:'user',uid:'222222',text:'你又乱搞'}]
  const b=currentBatch(rows,'你又乱搞')
  assert.deepEqual(b.sourceIds,['now']);assert.deepEqual(b.senderUids,['222222'])
})

test('an old short answer inside a new sentence does not become a current speaker',()=>{
  const rows=[{id:'old',role:'user',uid:'100001',text:'好'},{id:'now',role:'user',uid:'100002',text:'今天心情好些了'}]
  assert.deepEqual(currentBatch(rows,'今天心情好些了').sourceIds,['now'])
  assert.deepEqual(currentBatch(rows,'今天心情好些了').senderUids,['100002'])
})
test('review may remove a stale @ or correct it to an actual current speaker, never to a guessed account',()=>{
  const options={currentSenderUids:['222222']}
  assert.equal(applyReviewDecision('<at:111111>旧题', {change:true,text:'这句不是在说我。'},options).text,'这句不是在说我。')
  assert.equal(applyReviewDecision('<at:111111>旧题', {change:true,text:'<at:222222>这句接住了。'},options).text,'<at:222222>这句接住了。')
  assert.equal(applyReviewDecision('在。',{change:true,text:'<at:333333>来。'},options).text,'在。')
})
