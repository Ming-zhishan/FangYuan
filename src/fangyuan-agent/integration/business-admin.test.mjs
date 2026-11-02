import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = process.env.AURABOT_SOURCE_ROOT
if (!root) throw new Error('Set AURABOT_SOURCE_ROOT to the isolated prepared upstream')
const { createFakeDsh } = await import(pathToFileURL(join(root, 'test/helpers/fake-dsh.js')))
const { startMockOneBot } = await import(pathToFileURL(join(root, 'test/helpers/mock-onebot.js')))
const { levelFor } = await import(pathToFileURL(join(root, 'src/chat/access.js')))
const OWNER='10000001', ADMIN='10000003', OTHER='10000005', BOT='20000002', GROUP='20000004'
const adminOnly = process.env.FY_ADMIN_ONLY_TEST === '1'
const until = async fn => { const end=Date.now()+12000; while(Date.now()<end) { if(await fn())return; await new Promise(r=>setTimeout(r,30)) } throw new Error('Expected isolated host condition not reached') }

test('business admin has real Bot control and deep-friend context without full access, identity merging or group enablement', async () => {
  const base=resolve('../../tools/business-admin/private/runtime-tests');mkdirSync(base,{recursive:true})
  const dir=mkdtempSync(join(base,'principals-'));process.env.AURABOT_DATA_DIR=dir;process.env.DSH_HOME=join(dir,'home');process.env.AURABOT_WORKSPACE=join(dir,'workspace')
  const gateway=await startMockOneBot({selfId:BOT})
  cpSync(process.env.FY_TEST_MODULES_ROOT || resolve('modules'),join(dir,'modules'),{recursive:true});mkdirSync(join(dir,'personas'),{recursive:true})
  cpSync(process.env.FY_TEST_PERSONA || resolve('personas/gu-yue-fang-yuan.md'),join(dir,'personas/gu-yue-fang-yuan.md'))
  const legacy=join(dir,'legacy.json');writeFileSync(legacy,'{"mode":"disabled"}')
  const patch=JSON.parse(readFileSync(resolve('config.patch.json'),'utf8'))
  writeFileSync(join(dir,'config.json'),JSON.stringify({...patch,enabled:true,dryRun:false,setupDone:true,botQQ:BOT,ownerQQ:OWNER,ownerLevel:'full',gateway:'onebot',allow:{private:[OWNER,ADMIN,OTHER],groups:[]},merge:{enabled:true,waitSec:0.05,maxSec:0.1,groupWaitSec:0.05,groupMaxSec:0.1},voice:{enabled:false},stickers:{enabled:false},snowluma:{autoStart:false,autoAttach:false,httpUrl:gateway.httpUrl,wsUrl:gateway.wsUrl,httpToken:gateway.token,wsToken:gateway.token},modules:{...patch.modules,principals:{enabled:true,useBuiltin:false}},ext:{...patch.ext,fangyuan:{...patch.ext.fangyuan,scopedMemory:true},principals:{enabled:true,businessAdmins:[ADMIN],friendship:adminOnly?'':'deep_allies',allyAttention:!adminOnly},learning:{enabled:true,modelEnabled:false},liveGuard:{enforce:true,temporaryPrivate:true,ownerOutbound:true,ownerGroupOutbound:false,legacyModePath:legacy}}}))
  const directoryResults=[]
  const fake=createFakeDsh({brain:async({text,callTool})=>{
    if(text.includes('检查业务权限'))directoryResults.push(await callTool('fy_friend_directory',{}))
    return '合成回应'
  }})
  let host, mid=1
  const push=(uid,text,extra={})=>gateway.push({message_type:'private',user_id:Number(uid),message_id:mid++,sender:{user_id:Number(uid),nickname:'同名操作者'},message:[{type:'text',data:{text}}],...extra})
  try {
    const {apply}=await import(pathToFileURL(join(root,'src/host.js')));host=apply(fake.ctx);await host.ready
    const original=host.onebot.call
    host.onebot.call=async function(action,...args){if(action==='get_friend_list')return[OWNER,ADMIN,OTHER].map(user_id=>({user_id}));return original.call(this,action,...args)}
    await fake.call('/onebot/reconnect');await until(()=>gateway.connected()>0)
    assert.equal((await fake.call('/ext/live-guard/refresh')).json().ok,true)
    const cfg=host.getConfig();assert.equal(levelFor(cfg,{kind:'private',userId:OWNER}),'full');assert.equal(levelFor(cfg,{kind:'private',userId:ADMIN}),'social')
    push(ADMIN,'检查业务权限');await until(()=>directoryResults.length===1)
    assert.equal(directoryResults[0].ok,true)
    assert.match(fake.turns.at(-1).ctxText, /"managementRole":"business_admin"/)
    if (adminOnly) {
      assert.doesNotMatch(fake.turns.at(-1).ctxText, /"relationship":"deep_friend"|【已核实的身份与关系如何参与决定】/)
    } else assert.match(fake.turns.at(-1).ctxText, /"relationship":"deep_friend"/)
    assert.ok([...fake.agents.values()].some(a=>a.preset==='aurabot-social'))
    push(ADMIN,'/权限');await until(()=>gateway.calls.some(c=>JSON.stringify(c.params).includes('Bot业务管理员：不含电脑')))
    push(ADMIN,'/model fake-1');await until(()=>host.getConfig().model.model==='fake-1')
    push(ADMIN,'/off');await until(()=>host.getConfig().enabled===false)
    push(ADMIN,'/on');await until(()=>host.getConfig().enabled===true)
    const before=fake.turns.length;push(OTHER,'/off');await until(()=>fake.turns.length>before);assert.equal(host.getConfig().enabled,true)
    assert.doesNotMatch(fake.turns.at(-1).ctxText, /"relationship":"deep_friend"/)
    // Only the isolated fake host enables a synthetic group for this behavior check.
    if (!adminOnly) {
    const publicCfg=host.getConfig();host.setConfig({...publicCfg,allow:{...publicCfg.allow,groups:[GROUP]},group:{...publicCfg.group,interjectChance:0},ext:{...publicCfg.ext,principals:{...publicCfg.ext.principals,allyAttention:true}}})
    const beforeAlly=fake.turns.length
    gateway.push({message_type:'group',group_id:Number(GROUP),user_id:Number(OTHER),message_id:mid++,sender:{user_id:Number(OTHER),nickname:'旁人'},message:[{type:'at',data:{qq:ADMIN}},{type:'text',data:{text:'这件事你说清楚'}}]})
    await until(()=>fake.turns.length>beforeAlly)
    assert.match(fake.turns.at(-1).ctxText,/"uid":"10000003","managementRole":"business_admin","bond":\{"uid":"10000003","relationship":"deep_friend"/)
    await until(()=>gateway.calls.some(c=>c.action==='send_group_msg'))
    const beforeCooldown=fake.turns.length
    gateway.push({message_type:'group',group_id:Number(GROUP),user_id:Number(OTHER),message_id:mid++,sender:{user_id:Number(OTHER),nickname:'旁人'},message:[{type:'at',data:{qq:ADMIN}},{type:'text',data:{text:'再问一次'}}]})
    await new Promise(r=>setTimeout(r,400));assert.equal(fake.turns.length,beforeCooldown,'friend attention must respect cooldown')
    const pause=host.getConfig();host.setConfig({...pause,allow:{...pause.allow,groups:[]}})
    }
    const hub=fake.ctx.get('aurabot').hub
    hub.simulateTurn('mixed',[ADMIN,OTHER]);assert.equal(hub.turnSendersAllManagers('mixed'),false)
    hub.simulateTurn('managed',[ADMIN]);assert.equal(hub.turnSendersAllManagers('managed'),true);assert.equal(hub.turnSendersAllOwner('managed'),false)
    const state=host.getConfig();host.setConfig({...state,ext:{...state.ext,principals:{...state.ext.principals,businessAdmins:[]}}})
    const old=fake.turns.length;push(ADMIN,'/off');await until(()=>fake.turns.length>old);assert.equal(host.getConfig().enabled,true)
    push(OWNER,'/off');await until(()=>host.getConfig().enabled===false)
    push(OWNER,'/on');await until(()=>host.getConfig().enabled===true)
    assert.deepEqual(host.getConfig().allow.groups,[])
    assert.equal(host.getConfig().ownerQQ,OWNER)
  } finally {if(host)host.setConfig({...host.getConfig(),enabled:false});fake.dispose();await gateway.close()}
})
