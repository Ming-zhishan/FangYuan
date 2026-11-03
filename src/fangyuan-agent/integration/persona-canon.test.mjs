import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = process.env.AURABOT_SOURCE_ROOT
const friendship = process.env.FY_TEST_FRIENDSHIP === 'deep_allies'
if (!root) throw new Error('Set AURABOT_SOURCE_ROOT to an isolated upstream source copy')
const { createFakeDsh } = await import(pathToFileURL(join(root,'test/helpers/fake-dsh.js')))
const { startMockOneBot } = await import(pathToFileURL(join(root,'test/helpers/mock-onebot.js')))
const until = async fn => { const end=Date.now()+10000; while(Date.now()<end) { if(await fn()) return; await new Promise(r=>setTimeout(r,30)) } throw new Error('Expected isolated persona condition not reached') }

test('actual host loads the full reviewed persona and supplies it to generation and reply review', async () => {
  const base=resolve('../../tools/dialogue-quality/private/persona-canon-runtime');mkdirSync(base,{recursive:true})
  const dir=mkdtempSync(join(base,'full-card-'));process.env.AURABOT_DATA_DIR=dir;process.env.DSH_HOME=join(dir,'home');process.env.AURABOT_WORKSPACE=join(dir,'workspace')
  const owner='100001', bot='200001', gateway=await startMockOneBot({selfId:bot})
  const moduleSource = process.env.FY_TEST_MODULES_ROOT || resolve('modules')
  cpSync(moduleSource,join(dir,'modules'),{recursive:true});mkdirSync(join(dir,'personas'))
  cpSync(process.env.FY_TEST_PERSONA || resolve('personas/gu-yue-fang-yuan.md'),join(dir,'personas/gu-yue-fang-yuan.md'))
  const core=readFileSync(join(moduleSource,'fangyuan/core.txt'),'utf8').trim()
  const patch=JSON.parse(readFileSync(resolve('config.patch.json'),'utf8'));const legacy=join(dir,'legacy.json');writeFileSync(legacy,'{"mode":"disabled"}')
  writeFileSync(join(dir,'config.json'),JSON.stringify({...patch,enabled:true,dryRun:false,setupDone:true,botQQ:bot,ownerQQ:owner,allow:{private:[owner],groups:[]},voice:{enabled:false},stickers:{enabled:false},gateway:'onebot',merge:{enabled:true,waitSec:0.05,maxSec:0.1},snowluma:{autoStart:false,autoAttach:false,httpUrl:gateway.httpUrl,wsUrl:gateway.wsUrl,httpToken:gateway.token,wsToken:gateway.token},modules:{...patch.modules,conversation:{enabled:true,useBuiltin:false},principals:{enabled:friendship,useBuiltin:false}},ext:{...patch.ext,learning:{enabled:true,modelEnabled:false},conversation:{reviewEnabled:true},liveGuard:{enforce:true,ownerOutbound:false,legacyModePath:legacy},principals:{enabled:friendship,businessAdmins:[],friendship:friendship?'deep_allies':'',allyAttention:false}}}))
  const seen=[], reviews=[]
  const fake=createFakeDsh({brain:async ({persona,text,ctxText})=>{ seen.push({persona,text,ctxText});return '合成回执' }})
  let host
  try {
    const {apply}=await import(pathToFileURL(join(root,'src/host.js')));host=apply(fake.ctx);await host.ready
    const native=host.onebot.call;host.onebot.call=async function(action,...args){return action==='get_friend_list'?[{user_id:owner}]:native.call(this,action,...args)}
    await fake.call('/onebot/reconnect');await until(()=>gateway.connected()>0)
    assert.equal((await fake.call('/ext/live-guard/refresh')).json().ok,true)
    const service=fake.ctx.get('aurabot');service.use('learning').reviewText=async prompt=>{reviews.push(prompt);return '{"change":false}'}
    gateway.push({message_type:'private',user_id:Number(owner),message_id:1,sender:{user_id:Number(owner),nickname:'合成用户'},message:[{type:'text',data:{text:'你会为了不丢脸而放弃原来的目标吗？'}}]})
    await until(()=>reviews.length===1 && gateway.calls.some(c=>c.action==='send_private_msg'))
    assert.equal(seen[0].persona.replaceAll('\r\n','\n'),core.replaceAll('\r\n','\n'))
    assert.ok(reviews[0].includes(core),'review must receive the same full effective persona')
    if (friendship) {
      assert.match(seen[0].ctxText, /"relationship":"deep_friend"/)
      assert.match(reviews[0], /deep_friend/)
    }
    assert.equal(service.use('fangyuan').personaCore(),core)
    assert.deepEqual(host.getConfig().allow.groups,[])
  } finally {if(host)host.setConfig({...host.getConfig(),enabled:false});fake.dispose();await gateway.close()}
})
