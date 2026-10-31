import test from 'node:test'
import assert from 'node:assert/strict'
import { mustRespond, applyReviewDecision } from '../modules/conversation/decision.mjs'
const md5='a'.repeat(32), asset={md5,name:'困惑猫',tags:['疑惑']}
const changed=text=>({change:true,text})
test('ordinary group chatter may be left alone while direct @ and private prompts still receive attention',()=>{
  assert.equal(mustRespond('group:123456',[{role:'user',text:'你又乱搞',direct:false}],'你又乱搞'),false)
  assert.equal(applyReviewDecision('我乱搞什么了？',changed('[沉默]'),{direct:false}).text,'[沉默]')
  assert.equal(mustRespond('group:123456',[{role:'user',text:'方源',direct:true}],'方源'),true)
  assert.equal(applyReviewDecision('在。',changed('[沉默]'),{direct:true}).text,'在。')
  assert.equal(mustRespond('private:123456',[],'你好'),true)
})
test('semantic reviewer may choose an existing sticker or enabled voice, without acquiring new recipients',()=>{
  const sticker=`<sticker:id:${md5}>`
  assert.equal(applyReviewDecision('这倒有意思。',changed(sticker),{catalog:[asset]}).text,sticker)
  assert.equal(applyReviewDecision('在。',changed('<voice>在。</voice>'),{voiceEnabled:true}).text,'<voice>在。</voice>')
  for(const text of ['<at:999999>在。','<reply:unknown>在。',`<sticker:id:${'b'.repeat(32)}>`,'<voice>在。</voice>'])assert.equal(applyReviewDecision('在。',changed(text),{catalog:[asset],voiceEnabled:false}).text,'在。')
  assert.equal(applyReviewDecision('在。',changed('<voice>在。'),{voiceEnabled:true}).text,'在。')
})
