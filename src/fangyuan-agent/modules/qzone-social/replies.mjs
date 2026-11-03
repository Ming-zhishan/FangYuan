import { createHash } from 'node:crypto'
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,32)
const numeric=x=>/^[1-9]\d{4,19}$/.test(String(x))
const keyOf=x=>x.reply_id??x.comment_id
export const cleanReply=x=>String(x??'').trim().replace(/[。！？!?，,；;：:…\.]+$/u,'')
const ordered=rows=>[...new Map(rows.filter(x=>keyOf(x)!=null).map(x=>[(x.reply_id!=null?'reply:':'comment:')+String(keyOf(x)),x])).values()].sort((a,b)=>(a.time??0)-(b.time??0))

/** Uses issued feed references and actual parent IDs; never invents a feed identity from a tid. */
export function createReplies({ config,ready,call,generate,load,save,clock=Date.now,relations=()=>[] }) {
  let data=load()||{version:1,handled:{},attempts:{},history:[],lastRun:0},busy=false,stopped=false
  if(data.version!==1)throw new Error('Unsupported space reply state version')
  const enabled=()=>!stopped && config().enabled===true && config().qzoneSocial?.enabled===true && config().qzoneSocial?.replyOwn===true && ready()
  const persist=()=>save(data)
  const read=(action,params)=>call(action,params,{timeoutMs:20000,retries:0})
  const mine=(row,identity)=>String(row.user_id)===identity.uin || identity.uid && row.uid===identity.uid
  const identity=async()=>{
    const me=await read('get_login_info',{})
    if(String(me?.user_id)!==String(config().botQQ))throw new Error('Space account mismatch')
    return {uin:String(me.user_id),uid:typeof me.uid==='string'?me.uid:null}
  }
  async function pages(action,params,field) {
    const all=[],seen=new Set();let cursor
    for(let n=0;n<50;n++) {
      const page=await read(action,{...params,...(cursor?{cursor}:{})})
      if(!Array.isArray(page?.[field]))throw new Error('Space page contract unavailable')
      all.push(...page[field])
      if(page.has_more===false)return {items:all,complete:true}
      if(page.has_more!==true || !page.next_cursor || seen.has(page.next_cursor))throw new Error('Space history coverage incomplete')
      cursor=page.next_cursor;seen.add(cursor)
    }
    throw new Error('Space pagination needs further investigation; no completion claimed')
  }
  async function thread(post,parent) {
    let replies=parent.replies||[]
    if(parent.has_more_replies!==false || parent.reply_num>replies.length) {
      const more=await pages('get_qzone_comment_replies',{feed_ref:post.feed_ref,comment:parent.comment},'replies')
      replies=[...replies,...more.items]
    }
    return ordered([{...parent,reply_id:null},...replies])
  }
  // Issued references may refresh after likes/reads. Durable identity is account + actual tid + parent.
  const sourceKey=(post,parent,row)=>hash([String(config().botQQ),post.tid,String(parent.comment_id),row.reply_id!=null?'reply':'comment',String(keyOf(row))])
  const threadKey=(post,parent)=>hash([String(config().botQQ),post.tid,String(parent.comment_id)])
  const view=rows=>rows.map(({comment_id,reply_id,user_id,uid,nickname,time,content,target_user_id})=>({comment_id,reply_id,user_id,uid,nickname,time,content,target_user_id}))
  function confirmed(rows,a,me) {
    return rows.find(row=>row.reply_id!=null && mine(row,me) && cleanReply(row.content)===a.text &&
      (row.target_user_id==null || String(row.target_user_id)===a.target) &&
      (a.commentId?String(keyOf(row))===a.commentId:Number(row.time)*1000>=a.at-5000))
  }
  function finish(a,found) {
    a.status='sent';a.commentId=String(keyOf(found));a.verifiedAt=clock()
    for(const source of a.sources)data.handled[source]='sent'
    data.history.unshift({at:a.at,verifiedAt:a.verifiedAt,kind:'reply',post:a.tid,parent:a.parent,text:a.text,commentId:a.commentId});data.history=data.history.slice(0,50);persist()
  }
  async function scan() {
    const me=await identity(),posts=await pages('get_qzone_msg_list',{format:'native',target_uin:me.uin},'msglist'),tasks=[]
    for(const post of posts.items) {
      if(String(post.user_id)!==me.uin || !post.feed_ref || !post.tid)continue
      const page=await pages('get_qzone_comment_list',{feed_ref:post.feed_ref},'comments')
      for(const parent of page.items) {
        if(parent.comment_id==null || !parent.comment)continue
        const rows=await thread(post,parent),tk=threadKey(post,parent)
        let attempt=data.attempts[tk]
        if(!attempt) {
          // Preserve an earlier attempt through the initial reference-key migration, including unknown writes.
          const legacy=Object.entries(data.attempts).find(([,a])=>a.tid===post.tid && a.parent===String(parent.comment_id) && (!a.owner || a.owner===me.uin))
          if(legacy){attempt=legacy[1];data.attempts[tk]=attempt;delete data.attempts[legacy[0]];persist()}
        }
        if(attempt && ['attempted','unknown','accepted_unverified'].includes(attempt.status)) {
          const found=confirmed(rows,attempt,me)
          if(found)finish(attempt,found)
          else {tasks.push({blocked:true,reason:'previous_write_unconfirmed',tid:post.tid,parent:parent.comment_id});continue}
        }
        const lastMine=rows.findLastIndex(row=>mine(row,me))
        const pending=rows.slice(lastMine+1).filter(row=>!mine(row,me) && !data.handled[sourceKey(post,parent,row)])
        if(pending.length)tasks.push({post,parent,rows,pending,tk,me,others:page.items.filter(x=>x!==parent).slice(-12).map(({comment_id,user_id,content})=>({comment_id,user_id,content}))})
      }
    }
    return tasks
  }
  async function run({ preview=false }={}) {
    if(!enabled())return {ok:false,reason:'space_replies_not_enabled_or_account_unverified'}
    if(busy)return {ok:false,reason:'busy'}
    busy=true
    try {
      const tasks=await scan();data.lastRun=clock();data.lastError='';persist()
      if(preview)return {ok:true,pending:tasks.filter(t=>!t.blocked).length,blocked:tasks.filter(t=>t.blocked).map(t=>({tid:t.tid,parent:t.parent,reason:t.reason}))}
      if(config().dryRun)return {ok:true,sent:0,reason:'dry_run_no_generation_or_write'}
      for(const task of tasks) {
        if(task.blocked)continue
        const {post,parent,rows,pending,tk,me,others}=task,last=pending.at(-1)
        if(!numeric(parent.user_id) || !numeric(last.user_id)) {data.lastError='comment_identity_unresolved';persist();continue}
        if(clock()-(data.lastSent||0)<30000)return {ok:true,sent:0,reason:'write_spacing'}
        const text=cleanReply(await generate({now:clock(),post:{tid:post.tid,content:post.content,images:post.images?.length||0},thread:view(rows),pending:view(pending),otherPublicComments:others,relationships:relations(pending.map(x=>String(x.user_id)))}))
        if(!enabled() || config().dryRun)return {ok:false,reason:'permission_changed'}
        if(text==='[沉默]') {for(const row of pending)data.handled[sourceKey(post,parent,row)]='declined';persist();continue}
        if(!text || text.length>2000 || /<(?:at|reply|sticker|voice)[:>]/i.test(text))throw new Error('Invalid space reply draft')
        const latest=await thread(post,parent)
        // Refresh the parent itself as well: later top-level edits/deletion must not be ignored.
        const refreshed=await pages('get_qzone_comment_list',{feed_ref:post.feed_ref},'comments')
        const current=refreshed.items.find(x=>String(x.comment_id)===String(parent.comment_id))
        if(!current || hash(view(await thread(post,current)))!==hash(view(rows)) || hash(view(latest))!==hash(view(rows)))continue
        const check=await identity()
        if(!enabled() || check.uin!==me.uin || config().dryRun)return {ok:false,reason:'permission_changed'}
        const a={status:'attempted',at:clock(),owner:me.uin,tid:post.tid,parent:String(parent.comment_id),target:String(last.user_id),text,sources:pending.map(row=>sourceKey(post,parent,row))}
        data.attempts[tk]=a;persist() // durable BEFORE a network write; no automatic resend on uncertainty
        try {
          const receipt=await call('comment_qzone',{tid:post.tid,target_uin:me.uin,comment_id:String(parent.comment_id),comment_uin:String(parent.user_id),reply_uin:String(last.user_id),reply_name:String(last.nickname||''),content:text},{timeoutMs:30000,retries:0})
          a.commentId=receipt?.comment_id!=null && String(receipt.comment_id)!==''?String(receipt.comment_id):null;a.status='accepted_unverified';persist()
          const found=confirmed(await thread(post,{...current,has_more_replies:true}),a,me)
          if(found) {data.lastSent=clock();finish(a,found);return {ok:true,sent:1,commentId:a.commentId}}
          a.status='unknown';persist();return {ok:false,sent:0,reason:'write_not_yet_verified_no_resend'}
        } catch(e) {a.status='unknown';a.error=String(e.message).slice(0,180);persist();return {ok:false,reason:'write_uncertain_no_resend'}}
      }
      return {ok:true,sent:0}
    } catch(e) {data.lastError=String(e.message).slice(0,200);persist();return {ok:false,reason:data.lastError}}
    finally {busy=false}
  }
  return {run,state:()=>({count:data.history.filter(x=>new Date(x.at+8*3600000).toISOString().slice(0,10)===new Date(clock()+8*3600000).toISOString().slice(0,10)).length,lastRun:data.lastRun,history:data.history,lastError:data.lastError||'',busy,uncertain:Object.values(data.attempts).filter(a=>a.status!=='sent').length}),dispose:()=>{stopped=true}}
}
