import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LearningStore } from '../modules/learning/store.mjs'
import { describeDeliveredMessage, messageLinks, deliveryFingerprint } from '../modules/learning/message-context.mjs'

test('real image receipt retains the asset meaning; an unknown picture never acquires an invented caption', () => {
  const stickers=[{md5:'aa'.repeat(16),name:'困惑猫',tags:['疑惑']}]
  assert.match(describeDeliveredMessage([{type:'image',data:{file:'aa'.repeat(16)+'.gif'}}],{stickers}), /困惑猫/)
  assert.match(describeDeliveredMessage([{type:'image',data:{file:'bb'.repeat(16)+'.gif'}}],{stickers}), /内容未识别/)
  assert.doesNotMatch(describeDeliveredMessage([{type:'image',data:{file:'bb'.repeat(16)+'.gif'}}],{stickers}), /困惑猫/)
  assert.match(describeDeliveredMessage([{type:'record',data:{file:'secret audio bytes'}}],{note:'[语音·edge] 在，刚看到。'}), /语音.*在，刚看到/)
})
test('voice delivery notes survive removal of reply and @ controls without crossing a chat boundary',()=>{
  const voice={type:'record',data:{file:'base64://same real audio'}}
  const envelope=[{type:'reply',data:{id:'m1'}},{type:'at',data:{qq:'100001'}},{type:'text',data:{text:' '}},voice]
  assert.equal(deliveryFingerprint('group:123456',envelope),deliveryFingerprint('group:123456',[voice]))
  assert.notEqual(deliveryFingerprint('group:123456',envelope),deliveryFingerprint('private:123456',[voice]))
})

test('source links distinguish an @ to someone else and resolve a quote only inside the same chat', (t) => {
  const dir=mkdtempSync(join(tmpdir(),'fy-links-'))
  const s=new LearningStore(join(dir,'state.sqlite3'));t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true})})
  const p='group:123456', other='group:654321'
  s.observe({scope:p,uid:'222222',mid:'image1',text:'[图片:困惑猫]',role:'bot',origin:'gateway_receipt'})
  s.observe({scope:other,uid:'333333',mid:'private-source',text:'别的群不可见'})
  const user=s.observe({scope:p,uid:'444444',mid:'m2',text:'你又乱搞',direct:false})
  s.linkMessage(user.id,messageLinks({sender:{card:'群友'},message:[{type:'at',data:{qq:'555555'}},{type:'reply',data:{id:'image1'}}]}))
  const row=s.conversationFrame(p).find(r=>r.mid==='m2')
  assert.deepEqual(row.addressedUids,['555555']);assert.equal(row.quote.text,'[图片:困惑猫]')
  s.linkMessage(user.id,{replyMid:'private-source',addressedUids:[]})
  assert.equal(s.conversationFrame(p).find(r=>r.mid==='m2').quote,null)
  s.forgetSource(s.db.prepare('SELECT id FROM messages WHERE mid=? AND scope=?').get('image1',p).id)
  assert.equal(s.conversationFrame(p).find(r=>r.mid==='m2').quote,null)
})
