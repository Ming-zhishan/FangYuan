import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import conversation from '../modules/conversation/index.mjs'
import { groupSocial,stripTerminalPunctuation,nameAttention } from '../modules/conversation/group-social.mjs'

function harness(t) {
  const dir=mkdtempSync(join(tmpdir(),'fy-group-social-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const hooks={},contexts=[],cfg={enabled:true,botQQ:'200001',ownerQQ:'100001',allow:{groups:['300001'],private:['100001']},group:{quietHours:[1,8]},ext:{conversation:{pacingEnabled:true,socialEnabled:true,stripTerminalPunctuation:true,reviewEnabled:false,ordinaryCooldownSec:120,maxOrdinaryPerHour:12}}}
  const rows=[],counts={last:0,turns:0},learning={permitted:()=>true,store:{conversationFrame:()=>rows,db:{prepare:()=>({get:()=>({at:counts.last}),all:()=>Array.from({length:counts.turns},(_,i)=>({at:Date.now()-(counts.turns-i)*20000}))})}}}
  const api={config:()=>cfg,dataDir:n=>join(dir,n),on:(k,f)=>(hooks[k]??=[]).push(f),context:f=>contexts.push(f),route(){},rule(){},log:{warn(){}},use:k=>k==='learning'?learning:null,core:{hub:{}}}
  const service=conversation.setup(api)
  const emit=async(k,...args)=>{for(const f of hooks[k]||[])await f(...args)}
  const filter=async(k,v,info)=>{for(const f of hooks[k]||[]){const n=await f(v,info);if(n===null)return null;if(n!==undefined)v=n}return v}
  return {cfg,rows,service,emit,filter,contexts,counts,dir,api}
}
const msg={kind:'group',chatId:'group:300001',groupId:'300001',userId:'100002',messageId:'41',text:'今天这游戏打得真刺激',mentioned:false}
test('ordinary daily discussion can enter consideration without novel keywords',async t=>{
  const h=harness(t),old=Math.random;Math.random=()=>0;t.after(()=>{Math.random=old})
  const now=Date.now();h.rows.push(...[3,2,1].map(n=>({role:'user',uid:'100002',at:now-n*1000,text:'今天这游戏打得真刺激'})))
  const d=await h.filter('group/decide',{reply:false,mode:'none',reason:'话题和她关系不大（相关度 0.00）'},{msg,policy:{interjectChance:.24,minRecentMessages:3,activeWindowSec:300,quietHours:[]},recentTexts:h.rows.map(r=>r.text),memScore:0})
  assert.equal(d.reply,true)
})
test('authenticated ban is remembered with actor, blocks sending, lift reopens; private context stays private',async t=>{
  const h=harness(t),now=Math.floor(Date.now()/1000)
  const event={self_id:200001,post_type:'notice',notice_type:'group_ban',sub_type:'ban',group_id:300001,user_id:200001,operator_id:100002,duration:600,time:now}
  await h.emit('onebot',event)
  assert.equal(await h.filter('send',[{type:'text',data:{text:'在'}}],{chatId:msg.chatId}),null)
  const context=h.contexts.map(f=>f({chat:{kind:'group',chatId:msg.chatId},sessionId:'s'})).join('\n')
  assert.match(context,/100002/);assert.match(context,/group_ban/)
  assert.equal(h.contexts.map(f=>f({chat:{kind:'private',chatId:'private:100001'},sessionId:'p'})).join('\n').includes('group_ban'),false)
  await h.emit('onebot',{...event,sub_type:'lift_ban',duration:0,time:now+1})
  assert.notEqual(await h.filter('send',[{type:'text',data:{text:'在'}}],{chatId:msg.chatId}),null)
})
test('direct noise complaint lowers participation and yields one acknowledgement',async t=>{
  const h=harness(t)
  await h.emit('message',{...msg,mentioned:true,text:'方源你太吵了，少说点'})
  const v=await h.service.review('知道了。',{chatId:msg.chatId,userText:'方源你太吵了，少说点'})
  const sent=await h.filter('send',[{type:'text',data:{text:v}}],{chatId:msg.chatId})
  assert.match(sent.map(x=>x.data?.text||'').join(''),/少说|安静|少插话/)
  const d=await h.filter('group/decide',{reply:true,mode:'interject'},{msg:{...msg,messageId:'42'},policy:{}})
  assert.equal(d.reply,false)
})
test('last send hook strips sentence ending punctuation while preserving code and other segments',async t=>{
  const h=harness(t),data=[{type:'reply',data:{id:'42'}},{type:'text',data:{text:'还来吗？！'}},{type:'image',data:{file:'safe-fixture'}}]
  const v=await h.filter('send',data,{chatId:msg.chatId})
  assert.equal(v[1].data.text,'还来吗');assert.deepEqual(v[0],data[0]);assert.deepEqual(v[2],data[2])
})
test('no hourly ceiling or burst quota truncates a continuing conversation',async t=>{
  const h=harness(t);h.cfg.ext.conversation.unlimitedParticipation=true;h.counts.turns=500;h.counts.last=Date.now()-30000
  for(const reason of ['这小时插话够多了','刚说了太多（4 次），歇一会儿']) {
    const d=await h.filter('group/decide',{reply:false,mode:'none',reason},{msg,policy:{interjectChance:.24,quietHours:[]},recentTexts:['甲','乙','丙']})
    assert.equal(d.reply,true);assert.equal(d.mode,'engaged')
  }
  h.counts.last=Date.now()-1000
  assert.equal((await h.filter('group/decide',{reply:true,mode:'engaged'},{msg,policy:{}})).reply,false,'short pacing interval remains')
  assert.equal((await h.filter('group/decide',{reply:false,mode:'none'},{msg:{...msg,mentioned:true},policy:{}})).reply,true,'actual @ still answers')
})
test('negation, quotations, complaints about others, other groups and replayed notices do not alter policy',async t=>{
  const h=harness(t)
  for(const text of ['方源你不算太吵','方源他们太吵了','有人说方源太吵了','如果方源太吵就少说点','他说“方源你太吵了”'])await h.emit('message',{...msg,text,mentioned:true})
  assert.equal(await h.service.review('在',{chatId:msg.chatId,userText:'在吗'}),'在')
  const event={self_id:200001,post_type:'notice',notice_type:'group_ban',sub_type:'ban',group_id:300001,user_id:200001,operator_id:100002,duration:600,time:Math.floor(Date.now()/1000)}
  for(const e of [{...event,self_id:900001},{...event,group_id:900001},{...event,time:event.time+3600}])await h.emit('onebot',e)
  assert.notEqual(await h.filter('send',[],{chatId:msg.chatId}),null)
  await h.emit('onebot',event);await h.emit('onebot',event)
  const saved=JSON.parse((await import('node:fs')).readFileSync(join(h.dir,'group-social.json'),'utf8'))
  assert.equal(saved.groups[msg.chatId].events.length,1)
  await h.emit('onebot',{...event,sub_type:'lift_ban',duration:0,time:event.time-1})
  assert.equal(await h.filter('send',[],{chatId:msg.chatId}),null,'late old lift cannot erase a newer ban')
  const reloaded=groupSocial({...h.api,on(){},context(){},route(){}})
  assert.equal(reloaded.muted(msg.chatId),true,'real event survives module reload')
})
test('noise damping expires without a quota and acknowledgement is attempted once',async t=>{
  const h=harness(t);let now=Date.now();const s=groupSocial({...h.api,on(){},context(){},route(){}},{clock:()=>now})
  await h.emit('message',{...msg,mentioned:true,text:'你太吵了，少说点'})
  const pending=await h.service.review('知道了',{chatId:msg.chatId,userText:'少说点'})
  const a=await h.filter('send',[{type:'text',data:{text:pending}}],{chatId:msg.chatId})
  const b=await h.filter('send',[{type:'text',data:{text:'在'}}],{chatId:msg.chatId})
  assert.equal(a.map(x=>x.data?.text).join('').split('我少插话').length,2)
  assert.equal(b.map(x=>x.data?.text).join('').includes('我少插话'),false)
  const later=groupSocial({...h.api,on(){},context(){},route(){}},{clock:()=>Date.now()+7500000})
  assert.equal(later.pace({reply:true,mode:'interject'},{msg,policy:{}},0,10000).reply,true)
  assert.equal(stripTerminalPunctuation('3.14\nhttps://example.test/a?\n```js\nx++;\n```\n好。'),'3.14\nhttps://example.test/a?\n```js\nx++;\n```\n好')
})
test('name calls and typo calls bypass admission and pacing; real estate does not',async t=>{
  const h=harness(t);h.counts.last=Date.now();h.counts.turns=500
  for(const text of ['方源','方源你怎么看','房源你怎么不说话','@方源 在吗','古月方源，来看看']) {
    const d=await h.filter('group/decide',{reply:false,mode:'none',reason:'刚说了太多'},{msg:{...msg,text},policy:{}})
    assert.equal(d.reply,true,text);assert.equal(d.mode,'must',text)
  }
  for(const text of ['出租房源有没有','房源信息更新了','最近租房太贵了'])assert.equal(nameAttention(text).mention,false,text)
  assert.equal(nameAttention('小说里的方源一直以永生为目标').mention,true)
})
