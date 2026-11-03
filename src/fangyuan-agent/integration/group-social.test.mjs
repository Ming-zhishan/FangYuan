import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,mkdirSync,cpSync,writeFileSync } from 'node:fs'
import { resolve,join } from 'node:path'
import { pathToFileURL } from 'node:url'
const root=process.env.AURABOT_SOURCE_ROOT
if(!root)throw new Error('AURABOT_SOURCE_ROOT must identify the verified upstream; all runtime data and gateways below are isolated')
const {createFakeDsh}=await import(pathToFileURL(join(root,'test/helpers/fake-dsh.js')))
const {startMockOneBot}=await import(pathToFileURL(join(root,'test/helpers/mock-onebot.js')))
const until=async fn=>{const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,35))}throw new Error('Isolated group condition timed out')}
test('actual host: quota free ordinary chat, scoped platform ban/lift, adaptive quiet and final punctuation',async()=>{
  const base=resolve('../../tools/dialogue-quality/private/group-social-runtime');mkdirSync(base,{recursive:true});const dir=mkdtempSync(join(base,'host-'))
  process.env.AURABOT_DATA_DIR=dir;process.env.DSH_HOME=join(dir,'home');process.env.AURABOT_WORKSPACE=join(dir,'workspace')
  const owner='100001',bot='200001',group='300001',gateway=await startMockOneBot({selfId:bot})
  const modules=process.env.FY_TEST_MODULES_ROOT||resolve('modules');cpSync(modules,join(dir,'modules'),{recursive:true});mkdirSync(join(dir,'personas'));cpSync(resolve('personas/gu-yue-fang-yuan.md'),join(dir,'personas/gu-yue-fang-yuan.md'))
  const legacy=join(dir,'legacy.json');writeFileSync(legacy,'{"mode":"disabled"}')
  const patch=JSON.parse((await import('node:fs')).readFileSync(resolve('config.patch.json'),'utf8'))
  writeFileSync(join(dir,'config.json'),JSON.stringify({...patch,modules:{...patch.modules,conversation:{enabled:true,useBuiltin:false},principals:{enabled:true,useBuiltin:false}},enabled:true,dryRun:false,setupDone:true,botQQ:bot,ownerQQ:owner,allow:{groups:[group],private:[owner]},voice:{enabled:false},stickers:{enabled:false},gateway:'onebot',merge:{enabled:true,waitSec:.05,maxSec:.1},group:{interjectChance:1,minRelevance:0,minRecentMessages:1,cooldownSec:0,maxPerHour:0,quietHours:[0,0],burstMax:1},snowluma:{autoStart:false,autoAttach:false,httpUrl:gateway.httpUrl,wsUrl:gateway.wsUrl,httpToken:gateway.token,wsToken:gateway.token},ext:{...patch.ext,learning:{enabled:true,modelEnabled:false},conversation:{reviewEnabled:true,pacingEnabled:true,socialEnabled:true,stripTerminalPunctuation:true,unlimitedParticipation:true,ordinaryCooldownSec:1},liveGuard:{enforce:true,ownerOutbound:false,legacyModePath:legacy},principals:{enabled:true,businessAdmins:[],friendship:'deep_allies',allyAttention:false}}}))
  const seen=[],reviews=[],fake=createFakeDsh({brain:async({ctxText})=>{seen.push(ctxText);return '接得上，继续聊。'}})
  let host
  const push=(text,mid,at=false)=>gateway.push({message_type:'group',group_id:Number(group),user_id:Number(owner),message_id:mid,sender:{user_id:Number(owner),nickname:'合成群友'},message:[...(at?[{type:'at',data:{qq:bot}}]:[]),{type:'text',data:{text}}]})
  try{
    const {apply}=await import(pathToFileURL(join(root,'src/host.js')));host=apply(fake.ctx);await host.ready
    const original=host.onebot.call;host.onebot.call=async function(action,...args){if(action==='get_friend_list')return[{user_id:owner}];return original.call(this,action,...args)}
    await fake.call('/onebot/reconnect');await until(()=>gateway.connected()>0);assert.equal((await fake.call('/ext/live-guard/refresh')).json().ok,true)
    fake.ctx.get('aurabot').use('learning').reviewText=async p=>{reviews.push(p);return '{"change":false}'}
    const sent=()=>gateway.calls.filter(c=>c.action==='send_group_msg')
    push('今天游戏这一局很刺激',1)
    await until(()=>sent().length===1)
    assert.equal(sent()[0].params.message.filter(x=>x.type==='text').map(x=>x.data.text).join(''),'接得上，继续聊')
    const ban={post_type:'notice',notice_type:'group_ban',sub_type:'ban',group_id:Number(group),user_id:Number(bot),operator_id:100002,duration:600}
    gateway.push(ban)
    await until(async()=>Object.values((await fake.call('/ext/conversation/social-state')).json().groups).some(s=>s.muted))
    push('还在吗',2,true);await new Promise(r=>setTimeout(r,250));assert.equal(sent().length,1)
    gateway.push({...ban,sub_type:'lift_ban',duration:0})
    await until(async()=>Object.values((await fake.call('/ext/conversation/social-state')).json().groups).some(s=>!s.muted))
    push('现在解禁了',3,true);await until(()=>sent().length===2)
    assert.ok(seen.at(-1).includes('group_ban'));assert.ok(reviews.at(-1).includes('100002'))
    push('方源你太吵了，少说点',4,true);await until(()=>sent().length===3)
    assert.match(sent().at(-1).params.message.map(x=>x.data?.text||'').join(''),/我少插话/)
    push('普通讨论继续',5);await new Promise(r=>setTimeout(r,250));assert.equal(sent().length,3)
    push('房源你还在吗',6,false);await until(()=>sent().length===4)
    assert.equal(sent().at(-1).params.message.map(x=>x.data?.text||'').join('').includes('我少插话'),false)
    assert.deepEqual(host.getConfig().allow.groups,[group]);assert.equal(host.getConfig().ownerQQ,owner)
  }finally{if(host)host.setConfig({...host.getConfig(),enabled:false});fake.dispose();await gateway.close()}
})
