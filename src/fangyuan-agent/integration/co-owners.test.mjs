import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
const root=process.env.AURABOT_SOURCE_ROOT
if(!root)throw Error('Provide separate prepared co-owner native source')
const {createFakeDsh}=await import(pathToFileURL(join(root,'test/helpers/fake-dsh.js')))
const {startMockOneBot}=await import(pathToFileURL(join(root,'test/helpers/mock-onebot.js')))
const access=await import(pathToFileURL(join(root,'src/chat/access.js')))
const {createDangerGuard}=await import(pathToFileURL(join(root,'src/security/danger.js')))
const until=async f=>{let end=Date.now()+12000;while(Date.now()<end){if(await f())return;await new Promise(r=>setTimeout(r,30))}throw Error('Expected isolated condition missing')}
const OWNER='100001',CO='100002',BUS='100003',OTHER='100004',BOT='200001',GROUP='300001'
test('actual host co-owner gets full private preset and owner-only tools; revocation, mixed senders and groups remain constrained',async()=>{
  const base=resolve('../../tools/business-admin/private/co-owner-tests');mkdirSync(base,{recursive:true});const dir=mkdtempSync(join(base,'host-'))
  process.env.AURABOT_DATA_DIR=dir;process.env.DSH_HOME=join(dir,'home');process.env.AURABOT_WORKSPACE=join(dir,'workspace')
  cpSync(process.env.FY_TEST_MODULES_ROOT||resolve('modules'),join(dir,'modules'),{recursive:true});mkdirSync(join(dir,'personas'));cpSync(resolve('personas/gu-yue-fang-yuan.md'),join(dir,'personas/gu-yue-fang-yuan.md'))
  const legacy=join(dir,'legacy.json');writeFileSync(legacy,'{"mode":"disabled"}')
  const gateway=await startMockOneBot({selfId:BOT});const patch=JSON.parse(readFileSync(resolve('config.patch.json')))
  writeFileSync(join(dir,'config.json'),JSON.stringify({...patch,enabled:true,dryRun:false,setupDone:true,botQQ:BOT,ownerQQ:OWNER,ownerLevel:'full',allow:{private:[OWNER,CO,BUS,OTHER],groups:[]},merge:{enabled:true,waitSec:.05,maxSec:.1},modules:{...patch.modules,principals:{enabled:true,useBuiltin:false}},snowluma:{autoStart:false,autoAttach:false,httpUrl:gateway.httpUrl,wsUrl:gateway.wsUrl,httpToken:gateway.token,wsToken:gateway.token},ext:{...patch.ext,learning:{enabled:true,modelEnabled:false},principals:{enabled:true,coOwners:[CO],businessAdmins:[BUS],friendship:'deep_allies'},liveGuard:{enforce:true,legacyModePath:legacy}}}))
  const fullGuards=[],turns=[],fake=createFakeDsh({brain:async p=>{turns.push(p);return '已接住本轮合成内容'}})
  const on=fake.ctx.on.bind(fake.ctx);fake.ctx.on=(name,fn)=>{if(name==='tools/pre-execute')fullGuards.push(fn);return on(name,fn)}
  let host,mid=1
  const push=(uid,text)=>gateway.push({message_type:'private',user_id:Number(uid),message_id:mid++,sender:{user_id:Number(uid),nickname:'同名操作者'},message:[{type:'text',data:{text}}]})
  try{
    const {apply}=await import(pathToFileURL(join(root,'src/host.js')));host=apply(fake.ctx);await host.ready
    const native=host.onebot.call;host.onebot.call=async function(a,...args){if(a==='get_friend_list')return[OWNER,CO,BUS,OTHER].map(user_id=>({user_id}));return native.call(this,a,...args)}
    await fake.call('/onebot/reconnect');await until(()=>gateway.connected()>0);assert.equal((await fake.call('/ext/live-guard/refresh')).json().ok,true)
    const cfg=host.getConfig()
    for(const uid of [OWNER,CO]){assert.equal(access.levelFor(cfg,{kind:'private',userId:uid}),'full');assert.equal(access.profileToolVisible(cfg,'qqNickname',{kind:'private',userId:uid}),true)}
    assert.equal(access.levelFor(cfg,{kind:'group',userId:CO,groupId:GROUP}),'social');assert.equal(access.levelFor(cfg,{kind:'private',userId:BUS}),'social')
    push(CO,'共同所有者检查');await until(()=>turns.length===1);assert.equal(turns[0].preset,'aurabot-private');assert.match(turns[0].ctxText,/"managementRole":"co_owner"/);assert.match(turns[0].ctxText,/"ownerConversation":true/)
    const fullAgent=[...fake.agents.values()].find(a=>a.preset==='aurabot-private');assert.ok(fullAgent)
    const exec={name:'pwsh',arguments:{command:'Get-Date'},agent:fullAgent}
    host.hub.simulateTurn(fullAgent.session.id,[CO])
    const guard=fullGuards.at(-1);assert.equal((await guard(exec,()=>({kind:'allow'}))).kind,'allow')
    host.hub.simulateTurn(fullAgent.session.id,[CO,OTHER]);assert.equal((await guard(exec,()=>({kind:'allow'}))).kind,'deny')
    host.hub.simulateTurn(fullAgent.session.id,[CO])
    push(CO,'/权限');await until(()=>gateway.calls.some(c=>JSON.stringify(c.params).includes('所有者：拥有')))
    push(CO,'/off');await until(()=>!host.getConfig().enabled);push(OWNER,'/on');await until(()=>host.getConfig().enabled)
    const latest=host.getConfig();host.setConfig({...latest,ext:{...latest.ext,principals:{...latest.ext.principals,coOwners:[]}}})
    assert.equal((await guard(exec,()=>({kind:'allow'}))).kind,'deny','already mounted full tool loses permission immediately')
    assert.equal(access.isOwner(host.getConfig(),OWNER),true);assert.equal(access.isOwner(host.getConfig(),CO),false)
    const count=turns.length;push(CO,'/off');await until(()=>turns.length>count);assert.equal(host.getConfig().enabled,true);assert.equal(turns.at(-1).preset,'aurabot-social')
    assert.equal(host.getConfig().ownerQQ,OWNER);assert.deepEqual(host.getConfig().allow.groups,[])
  }finally{if(host)host.setConfig({...host.getConfig(),enabled:false});fake.dispose();await gateway.close()}
})
test('danger confirmation belongs to the requesting owner and rechecks revocation',async()=>{
  let cfg={ownerQQ:OWNER,ext:{principals:{enabled:true,coOwners:[CO]}},security:{dangerConfirm:true}},asked=[]
  const guard=createDangerGuard({getConfig:()=>cfg,ownerQQ:()=>OWNER,chatOfSession:()=>`private:${CO}`,deliver:async(c,t)=>asked.push(c),timeoutMs:2000})
  const exec={name:'pwsh',arguments:{command:'shutdown /s'},agent:{session:{id:'synthetic'}}}
  const run=guard.preExecute(exec,()=>({kind:'allow'}));await until(()=>asked.length===1)
  assert.deepEqual(asked,[`private:${CO}`]);assert.equal(guard.handleReply(`private:${CO}`,OWNER,'确认'),false)
  assert.equal(guard.handleReply(`private:${CO}`,CO,'确认'),true);assert.equal((await run).kind,'allow')
  const again=guard.preExecute(exec,()=>({kind:'allow'}));await until(()=>asked.length===2);cfg.ext.principals.coOwners=[]
  assert.equal(guard.handleReply(`private:${CO}`,CO,'确认'),false);assert.equal((await again).kind,'deny')
})
