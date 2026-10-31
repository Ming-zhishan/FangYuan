import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pokeModule from '../../aurabot-modules/poke-interaction/index.mjs'

const poke = (extra = {}) => ({
  post_type:'notice', notice_type:'notify', sub_type:'poke',
  user_id:'111111', group_id:'333333', target_id:'999999',
  time:Math.floor(Date.now()/1000), ...extra
})
function mock(t, sharedDir) {
  const dir=sharedDir || mkdtempSync(join(tmpdir(),'fangyuan-poke-'))
  if(!sharedDir)t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const calls=[], cfg={enabled:true,botQQ:'999999',allow:{groups:['333333']}}
  const settings={enabled:false,liveSend:false}
  let handler=null, frame=[], muted=false, admitted=true, brokenSend=false
  const api={
    config:()=>cfg, settings:()=>settings, dataDir:name=>join(dir,name),
    core:{mutes:{muted:()=>muted}},
    use:name=>name==='learning'?{permitted:()=>admitted,store:{conversationFrame:()=>frame},
      publicRelationship:()=>({kind:'friend',affinity:5})}:null,
    on:(event,fn)=>{if(event==='poke')handler=fn},
    sendText:async(chatId,text)=>{calls.push({chatId,text});if(brokenSend)throw Error('network outcome unknown')},
    log:{warn:()=>{}}
  }
  pokeModule.setup(api)
  return {dir,calls,cfg,settings,emit:event=>handler(event),frame:xs=>{frame=xs},
    setMuted:value=>{muted=value},setAdmitted:value=>{admitted=value},failSend:value=>{brokenSend=value}}
}

test('default module settings and a single opt-in do not send or consume QQ pokes',async t=>{
  const h=mock(t)
  assert.equal(await h.emit(poke()),false)
  h.settings.enabled=true
  assert.equal(await h.emit(poke()),false)
  assert.equal(h.calls.length,0)
})
test('explicit double opt-in allows one QQ text and enforces durable no-spam state',async t=>{
  const h=mock(t)
  h.settings.enabled=true;h.settings.liveSend=true
  assert.equal(await h.emit(poke()),true)
  assert.equal(h.calls.length,1)
  assert.equal(h.calls[0].chatId,'group:333333')
  assert.ok(h.calls[0].text.length <= 10)
  assert.equal(await h.emit(poke()),true)
  assert.equal(h.calls.length,1)
  const state=JSON.parse(readFileSync(join(h.dir,'poke-gate.json'),'utf8'))
  assert.equal(state.attempts.length,1)
  const second=mock(t,h.dir)
  second.settings.enabled=true;second.settings.liveSend=true
  assert.equal(await second.emit(poke()),true)
  assert.equal(second.calls.length,0,'restart must not repeat an attempted poke')
})
test('no unauthorized group, third-party poke, bot self poke or muted scene triggers a send',async t=>{
  const h=mock(t)
  h.settings.enabled=true;h.settings.liveSend=true
  assert.equal(await h.emit(poke({group_id:'444444'})),false)
  assert.equal(await h.emit(poke({target_id:'222222'})),false)
  assert.equal(await h.emit(poke({user_id:'999999'})),false)
  h.setMuted(true)
  assert.equal(await h.emit(poke()),true)
  h.setMuted(false);h.setAdmitted(false)
  assert.equal(await h.emit(poke()),true)
  assert.equal(h.calls.length,0)
})
test('sensitive conversation and corrupt rate-limit state always result in silence',async t=>{
  const h=mock(t)
  h.settings.enabled=true;h.settings.liveSend=true
  h.frame([{at:Date.now()-1000,text:'家人受伤了，得去急救'}])
  assert.equal(await h.emit(poke()),true)
  assert.equal(h.calls.length,0)
  h.frame([])
  writeFileSync(join(h.dir,'poke-gate.json'),'{invalid-json')
  assert.equal(await h.emit(poke()),true)
  assert.equal(h.calls.length,0)
})
test('send uncertainty records an attempt and never blindly retries',async t=>{
  const h=mock(t)
  h.settings.enabled=true;h.settings.liveSend=true;h.failSend(true)
  assert.equal(await h.emit(poke()),true)
  assert.equal(await h.emit(poke()),true)
  assert.equal(h.calls.length,1)
  const state=JSON.parse(readFileSync(join(h.dir,'poke-gate.json'),'utf8'))
  assert.equal(state.attempts[0].status,'attempted')
})

test('concurrent identical poke notifications cannot cause two sends', async t => {
  const h=mock(t)
  h.settings.enabled=true;h.settings.liveSend=true
  const [first,second]=await Promise.all([h.emit(poke()),h.emit(poke())])
  assert.equal(first,true);assert.equal(second,true)
  assert.equal(h.calls.length,1)
})
