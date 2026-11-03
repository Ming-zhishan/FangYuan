import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import learning from '../modules/learning/index.mjs'
import { LearningStore } from '../modules/learning/store.mjs'
import { catchupFrame,nextRecovery,catchupPrompt } from '../modules/learning/history.mjs'

test('real learning pulse recovers the newest offline gap before an old queued gap or reconciliation',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'fy-recovery-')),dispose=[],calls=[]
  const now=Date.now(),cfg={enabled:true,botQQ:'900001',allow:{groups:['200001','200002'],private:[]},ext:{learning:{enabled:true,modelEnabled:false,catchup:true}}}
  const call=async(action,params)=>{
    calls.push({action,params})
    return {messages:[{message_id:1,user_id:100001,time:Math.floor((now-10000)/1000),message:[{type:'text',data:{text:'合成消息'}}]}]}
  }
  const service=learning.setup({config:()=>cfg,dataDir:n=>join(dir,n),on(){},context(){},tool(){},rule(){},route(){},every(){},later(){},onDispose:f=>dispose.push(f),use(){},log:{warn(){}},core:{onebot:{state:'connected',call}}})
  t.after(()=>{for(const f of dispose)f();rmSync(dir,{recursive:true,force:true})})
  const db=service.store.db
  for(const [id,start,end,scope] of [['old',now-8*86400000,now-7*86400000,'group:200001'],['new',now-600000,now-1000,'group:200002']]){
    db.prepare('INSERT INTO gaps VALUES(?,?,?,?)').run(id,start,end,'last confirmed online to resumed connection; exact outage start unknown')
    db.prepare('INSERT INTO coverage(id,gap,scope) VALUES(?,?,?)').run(id,id,scope)
  }
  await service.pulse()
  assert.equal(String(calls[0].params.group_id),'200002')
  assert.equal(calls.length,1,'one bounded free recovery page, no model or send')
})

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'fy-catchup-frame-')),store=new LearningStore(join(dir,'isolated.db'))
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});return store
}
test('catchup sees later additions, withdrawal and sourced replies without crossing conversations',t=>{
  const s=fixture(t),at=Date.now()-60000,scope='group:200001'
  const first=s.observe({scope,uid:'100001',mid:'1',text:'@方源 你好',at,origin:'history',direct:true})
  s.observe({scope,uid:'100001',mid:'2',text:'补充：我刚才在说昨天那场',at:at+1000})
  s.observe({scope,uid:'100002',mid:'3',text:'刚才的问题已经解决了',at:at+2000})
  const bot=s.observe({scope,uid:'900001',mid:'4',text:'刚才实际的群回应',role:'bot',at:at+3000});s.linkMessage(bot.id,{replyMid:'3',addressedUids:['100002']})
  s.observe({scope:'private:100001',uid:'100001',mid:'5',text:'PRIVATE_CANARY',at:at+4000})
  const frame=catchupFrame(s,scope,[first]);assert.deepEqual(frame.map(x=>x.mid),['1','2','3','4']);assert.equal(frame.at(-1).replyMid,'3');assert.equal(JSON.stringify(frame).includes('PRIVATE_CANARY'),false)
  s.observe({scope,uid:'100001',mid:'6',text:'不用再回答旧问题',at:at+5000});assert.equal(catchupFrame(s,scope,[first]).at(-1).mid,'6','fresh context changes the snapshot used before send')
  assert.match(catchupPrompt('PERSONA_CANARY'),/是否简短解释晚回由语境决定，不强制解释/)
})
test('recovery respects retry time and revoked scopes while preserving all backlog',t=>{
  const s=fixture(t),now=Date.now()
  for(const [key,scope,retry,end] of [['revoked','group:200003',0,now],['retry','group:200002',now+100000,now-1],['allowed','group:200001',0,now-2]]){
    s.db.prepare('INSERT INTO gaps VALUES(?,?,?,?)').run(key,now-600000,end,'confirmed transport gap')
    s.db.prepare('INSERT INTO coverage(id,gap,scope,retryAt) VALUES(?,?,?,?)').run(key,key,scope,retry)
  }
  assert.equal(nextRecovery(s,{permitted:x=>x==='group:200001',now}).id,'allowed')
  assert.equal(s.db.prepare('SELECT count(*) n FROM coverage').get().n,3)
  assert.deepEqual(catchupFrame(s,'group:200001',[]),[])
})
