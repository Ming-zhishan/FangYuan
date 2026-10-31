import test from 'node:test'
import assert from 'node:assert/strict'
import { currentBatch } from '../modules/conversation/current-batch.mjs'
import { applyReviewDecision } from '../modules/conversation/decision.mjs'
test('current batch identifies the new speaker without re-enqueueing an older phone question',()=>{
  const rows=[{id:'old',role:'user',uid:'111111',text:'全部手机号记得吗'},{id:'now',role:'user',uid:'222222',text:'你又乱搞'}]
  const b=currentBatch(rows,'你又乱搞')
  assert.deepEqual(b.sourceIds,['now']);assert.deepEqual(b.senderUids,['222222'])
})
test('review may remove a stale @ or correct it to an actual current speaker, never to a guessed account',()=>{
  const options={currentSenderUids:['222222']}
  assert.equal(applyReviewDecision('<at:111111>旧题', {change:true,text:'这句不是在说我。'},options).text,'这句不是在说我。')
  assert.equal(applyReviewDecision('<at:111111>旧题', {change:true,text:'<at:222222>这句接住了。'},options).text,'<at:222222>这句接住了。')
  assert.equal(applyReviewDecision('在。',{change:true,text:'<at:333333>来。'},options).text,'在。')
})

test('a historical substring cannot become the current speaker or authorize a wrong @', () => {
  const rows=[
    {id:'old',role:'user',uid:'111111',text:'在',direct:true},
    {id:'now',role:'user',uid:'222222',text:'你在吗',direct:false}
  ]
  const batch=currentBatch(rows,'你在吗')
  assert.deepEqual(batch.sourceIds,['now'])
  assert.deepEqual(batch.senderUids,['222222'])
  assert.equal(batch.matchQuality,'whole_turn_exact')
  assert.equal(applyReviewDecision('我在。',{change:true,text:'<at:111111>怎么了？'},{currentSenderUids:batch.senderUids}).text,'我在。')
})
test('a quoted old turn is not a source or recipient of a new reply', () => {
  const rows=[
    {id:'old',role:'user',uid:'111111',text:'今晚开会吗'},
    {id:'now',role:'user',uid:'222222',text:'那就明天'}
  ]
  const batch=currentBatch(rows,'> 今晚开会吗\n那就明天')
  assert.deepEqual(batch.sourceIds,[])
  assert.deepEqual(batch.senderUids,[])
  assert.equal(batch.matchQuality,'unresolved')
})
test('a multiline batch recognizes independent exact messages, not contained phrases', () => {
  const rows=[
    {id:'stale',role:'user',uid:'333333',text:'哥们'},
    {id:'a',role:'user',uid:'111111',text:'不是哥们'},
    {id:'b',role:'user',uid:'222222',text:'你又乱搞'}
  ]
  const batch=currentBatch(rows,'不是哥们\n你又乱搞')
  assert.deepEqual(batch.sourceIds,['a','b'])
  assert.deepEqual(batch.senderUids,['111111','222222'])
  assert.equal(batch.matchQuality,'multi_message_lines')
})
test('identical remembered phrases by multiple people have ambiguous speaker provenance', () => {
  const rows=[
    {id:'first',role:'user',uid:'111111',text:'难绷'},
    {id:'second',role:'user',uid:'222222',text:'难绷'}
  ]
  const batch=currentBatch(rows,'难绷')
  assert.deepEqual(batch.sourceIds,[])
  assert.deepEqual(batch.senderUids,[])
  assert.equal(batch.matchQuality,'ambiguous_sender')
})
