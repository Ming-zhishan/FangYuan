import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync } from 'node:fs'
import { resolve,join } from 'node:path'
import { pathToFileURL } from 'node:url'
const root=process.env.AURABOT_SOURCE_ROOT
if(!root)throw new Error('Provide verified upstream; gateway and data below are isolated')
const {createFakeDsh}=await import(pathToFileURL(join(root,'test/helpers/fake-dsh.js')))
const {startMockOneBot}=await import(pathToFileURL(join(root,'test/helpers/mock-onebot.js')))
const until=async fn=>{let end=Date.now()+12000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,40))}throw new Error('Isolated host condition timed out')}
test('actual host routes public comment generation without private memory and writes only the verified reply target',async()=>{
  const base=resolve('../../tools/qzone-comments/private/host-test');mkdirSync(base,{recursive:true});const dir=mkdtempSync(join(base,'isolated-'));process.env.AURABOT_DATA_DIR=dir;process.env.DSH_HOME=join(dir,'home');process.env.AURABOT_WORKSPACE=join(dir,'workspace')
  const gateway=await startMockOneBot({selfId:'900001'});cpSync(process.env.FY_TEST_MODULES_ROOT||resolve('modules'),join(dir,'modules'),{recursive:true});mkdirSync(join(dir,'personas'));cpSync(resolve('personas/gu-yue-fang-yuan.md'),join(dir,'personas/gu-yue-fang-yuan.md'))
  const patch=JSON.parse(readFileSync(resolve('config.patch.json'),'utf8')),legacy=join(dir,'legacy.json');writeFileSync(legacy,'{"mode":"disabled"}')
  writeFileSync(join(dir,'config.json'),JSON.stringify({...patch,enabled:true,dryRun:false,setupDone:true,botQQ:'900001',ownerQQ:'100001',allow:{private:['100001'],groups:[]},qzoneSocial:{enabled:true,replyOwn:true,commentFriends:false,like:false},modules:{...patch.modules,conversation:{enabled:true,useBuiltin:false},'qzone-social':{enabled:true,useBuiltin:false}},snowluma:{autoStart:false,autoAttach:false,httpUrl:gateway.httpUrl,wsUrl:gateway.wsUrl,httpToken:gateway.token,wsToken:gateway.token},ext:{...patch.ext,fangyuan:{publicActions:false},learning:{enabled:true,modelEnabled:false},liveGuard:{enforce:true,legacyModePath:legacy}}}))
  const generations=[],calls=[],fake=createFakeDsh({brain:async p=>{generations.push(p);return '你这句来得巧。'}});let host
  const post={tid:'fake-post',user_id:'900001',content:'合成公开动态',feed_ref:{union_id:{uf_key:'issued'}}}
  const parent={comment_id:'1',user_id:'100001',nickname:'合成朋友',time:Date.now()/1000-20,content:'PUBLIC_COMMENT_CANARY 🍬',comment:{id:'1',user:{uin:'100001',uid:null}},reply_num:0,has_more_replies:false,replies:[]}
  try{
    const {apply}=await import(pathToFileURL(join(root,'src/host.js')));host=apply(fake.ctx);await host.ready
    const native=host.onebot.call;host.onebot.call=async function(action,params,...rest){
      if(action==='get_friend_list')return[{user_id:'100001'}]
      if(action==='get_qzone_msg_list')return{msglist:[post],has_more:false}
      if(action==='get_qzone_comment_list')return{comments:[parent],has_more:false}
      if(action==='get_qzone_comment_replies')return{replies:parent.replies,has_more:false}
      if(action==='comment_qzone'){calls.push(params);parent.replies.push({reply_id:'reply-1',user_id:'900001',content:params.content,time:Date.now()/1000,target_user_id:'100001'});return{comment_id:'reply-1'}}
      return native.call(this,action,params,...rest)
    }
    await fake.call('/onebot/reconnect');await until(()=>gateway.connected()>0);assert.equal((await fake.call('/ext/live-guard/refresh')).json().ok,true)
    const service=fake.ctx.get('aurabot');service.use('learning').store.observe({scope:'private:100001',uid:'100001',mid:'private-1',text:'PRIVATE_CANARY_DO_NOT_PUBLISH',at:Date.now()})
    const result=await service.use('qzone-social').run();assert.equal(result.sent,1);assert.equal(calls.length,1);assert.equal(calls[0].comment_id,'1');assert.equal(calls[0].reply_uin,'100001')
    assert.equal(generations.length,1);assert.ok(generations[0].persona.includes('古月方源'));assert.match(generations[0].text,/PUBLIC_COMMENT_CANARY/);assert.match(generations[0].text,/唐.*谐音/);assert.doesNotMatch(generations[0].text+generations[0].ctxText,/PRIVATE_CANARY_DO_NOT_PUBLISH/)
    assert.equal((await service.use('qzone-social').run()).sent,0);assert.equal(calls.length,1)
  }finally{if(host)host.setConfig({...host.getConfig(),enabled:false});fake.dispose();await gateway.close()}
})
