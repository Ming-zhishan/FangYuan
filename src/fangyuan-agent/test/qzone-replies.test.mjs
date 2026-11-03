import test from 'node:test'
import assert from 'node:assert/strict'
import { createReplies } from '../modules/qzone-social/replies.mjs'
import module from '../modules/qzone-social/index.mjs'
import { mkdtempSync,rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function fixture(options={}) {
  let now=Date.now(),saved=null,drafts=0
  const cfg={enabled:true,dryRun:false,botQQ:'900001',qzoneSocial:{enabled:true,replyOwn:true}}
  const parent={comment_id:'0',user_id:'100001',uid:null,nickname:'合成朋友',time:Math.floor(now/1000)-20,content:'你怎么看这个',reply_num:1,has_more_replies:false,comment:{id:'0',user:{uin:'100001',uid:null}},replies:[{reply_id:'0',user_id:'100002',nickname:'另一位朋友',time:Math.floor(now/1000)-10,content:'还有前面的问题',target_user_id:'900001'}]}
  const post={tid:'synthetic-post',user_id:'900001',content:'合成公开动态',feed_ref:{union_id:{uf_key:'issued-synthetic-reference'}}},calls=[],generated=[]
  const call=async(action,params,opts)=>{
    calls.push({action,params,opts})
    if(action==='get_login_info')return{user_id:cfg.botQQ}
    if(action==='get_qzone_msg_list')return{msglist:[post],has_more:false}
    if(action==='get_qzone_comment_list')return{comments:[parent],has_more:false}
    if(action==='get_qzone_comment_replies')return{replies:parent.replies,has_more:false}
    if(action==='comment_qzone') {
      if(options.failWrite)throw new Error('lost response')
      if(!options.noReadback)parent.replies.push({reply_id:'confirmed-1',user_id:'900001',time:Math.floor(now/1000),content:params.content,target_user_id:String(params.reply_uin)})
      return options.noId?{comment_id:''}:{comment_id:'confirmed-1'}
    }
    throw new Error('Unexpected action')
  }
  const make=()=>createReplies({config:()=>cfg,ready:()=>true,call,clock:()=>now,load:()=>saved,save:x=>{saved=structuredClone(x)},generate:async frame=>{drafts++;generated.push(frame);if(options.duringDraft)options.duringDraft({cfg,parent});return options.silence?'[沉默]':'前后两句都看到了。'}})
  return {cfg,parent,post,calls,generated,make,advance:n=>{now+=n},get saved(){return saved},get drafts(){return drafts}}
}
test('reply binds the actual post, parent and newest speaker; aggregates the full thread without private memory',async()=>{
  const f=fixture(),s=f.make(),result=await s.run();assert.equal(result.sent,1)
  const sent=f.calls.find(c=>c.action==='comment_qzone');assert.deepEqual(sent.params,{tid:'synthetic-post',target_uin:'900001',comment_id:'0',comment_uin:'100001',reply_uin:'100002',reply_name:'另一位朋友',content:'前后两句都看到了'})
  assert.equal(sent.opts.retries,0);assert.equal(f.generated[0].pending.length,2,'root and reply sharing ID 0 remain distinct')
  assert.equal(f.saved.history[0].commentId,'confirmed-1')
  f.advance(60000);assert.equal((await f.make().run()).sent,0);assert.equal(f.drafts,1,'reload cannot repeat the reply')
})
test('response lost or accepted without a readable comment is uncertain and never blindly resent',async()=>{
  for(const options of [{failWrite:true},{noReadback:true}]){
    const f=fixture(options),s=f.make();assert.equal((await s.run()).ok,false)
    f.post.feed_ref={...f.post.feed_ref,like_key:'refreshed-issued-reference'}
    f.parent.replies.push({reply_id:'later-user',user_id:'100002',time:Date.now()/1000,content:'又说一句'})
    await f.make().run();assert.equal(f.calls.filter(x=>x.action==='comment_qzone').length,1);assert.equal(f.drafts,1)
  }
})
test('missing ID can be resolved only by actual thread readback; later readback resolves an uncertain attempt',async()=>{
  const f=fixture({noId:true});assert.equal((await f.make().run()).sent,1)
  const g=fixture({noReadback:true});await g.make().run();g.parent.replies.push({reply_id:'confirmed-1',user_id:'900001',content:'前后两句都看到了',target_user_id:'100002',time:Date.now()/1000});await g.make().run();assert.equal(g.saved.history.length,1);assert.equal(g.drafts,1)
})
test('explicit silence is durable for those sources but a new follow-up can be considered',async()=>{
  const f=fixture({silence:true});assert.equal((await f.make().run()).sent,0);await f.make().run();assert.equal(f.drafts,1)
  f.parent.replies.push({reply_id:'followup',user_id:'100002',content:'这个新问题呢',time:Date.now()/1000});await f.make().run();assert.equal(f.drafts,2)
})
test('disabled, preview and dry run cannot send; revoked permission during generation discards the draft',async()=>{
  for(const change of ['enabled','dryRun']){
    const f=fixture();f.cfg[change]=change==='dryRun';await f.make().run();assert.equal(f.drafts,0);assert.equal(f.calls.some(c=>c.action==='comment_qzone'),false)
  }
  const p=fixture();assert.equal((await p.make().run({preview:true})).pending,1);assert.equal(p.drafts,0)
  const f=fixture({duringDraft:({cfg})=>{cfg.enabled=false}});await f.make().run();assert.equal(f.calls.some(c=>c.action==='comment_qzone'),false)
})
test('new context, missing author identity and foreign posts cannot receive a stale or misdirected reply',async()=>{
  const changed=fixture({duringDraft:({parent})=>parent.replies.push({reply_id:'withdrawn',user_id:'100002',content:'不用回了',time:Date.now()/1000})});await changed.make().run();assert.equal(changed.calls.some(c=>c.action==='comment_qzone'),false)
  const unknown=fixture();unknown.parent.user_id=null;await unknown.make().run();assert.equal(unknown.drafts,0)
  const foreign=fixture();foreign.post.user_id='100001';await foreign.make().run();assert.equal(foreign.drafts,0)
})
test('module generation has no tools and receives only the effective persona and public comment frame',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'fy-qzone-module-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const f=fixture(),seen=[]
  const s=module.setup({config:()=>f.cfg,dataDir:n=>join(dir,n),every(){},onDispose(){},route(){},use:k=>k==='live-guard'?{ready:()=>true}:k==='fangyuan'?{personaCore:()=> 'ACCEPTED_PERSONA'}:null,core:{onebot:{call:async(a,p,o)=>{if(a==='get_login_info')return{user_id:'900001'};if(a==='get_qzone_msg_list')return{msglist:[f.post],has_more:false};if(a==='get_qzone_comment_list')return{comments:[f.parent],has_more:false};if(a==='get_qzone_comment_replies')return{replies:f.parent.replies,has_more:false};throw new Error('no test write')}},hub:{runSystemTurn:async(...args)=>{seen.push(args);return '[沉默]'}}}})
  await s.run();assert.equal(seen.length,1);assert.match(seen[0][2],/ACCEPTED_PERSONA/);assert.equal(seen[0][3].noTools,true);assert.match(seen[0][2],/是否|可以直接接话/)
})
