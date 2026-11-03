import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'

const acknowledgement = '我少插话，先安静一阵'
const hash = x => createHash('sha256').update(x).digest('hex').slice(0,24)
const id = x => /^\d{5,12}$/.test(String(x))
export function nameAttention(text) {
  text=String(text)
  const canonical=/(?:古月方源|方源|大爱仙尊|炼天魔尊)/.test(text)
  const typo=/房源/.test(text) && !/(?:出租|出售|租赁|中介|房东|房价|租房|买房|房产|楼盘|房源信息|房源推荐|一套房源)/.test(text)
  const mention=canonical||typo
  const direct=mention && /(?:古月方源|方源|房源|大爱仙尊|炼天魔尊)(?:[，,:：!！?？\s]|$|你|在吗|在不在|说话|出来|回答|回我|装死|怎么|为何|为什么|能不能|觉得|看看|帮|来|别|少|太吵)/.test(text)
  return {mention,direct}
}
export function stripTerminalPunctuation(text) {
  let fenced=false
  return String(text).split('\n').map(line=>{
    if (/^\s*```/.test(line)) { fenced=!fenced;return line }
    if (fenced || /^(?: {4}|\t)/.test(line) || /https?:\/\/\S+\s*$/.test(line) || /[`|]\s*$/.test(line)) return line
    return line.replace(/[。！？!?，,；;：:、…\.]+\s*$/u,'')
  }).join('\n')
}

// Separate, scoped evidence ledger: never manufacture a chat message or mutate affinity scores.
export function groupSocial(api, { clock=Date.now }={}) {
  const file=api.dataDir('group-social.json')
  let data={version:1,groups:{}}
  try { const saved=JSON.parse(readFileSync(file,'utf8'));if(saved.version===1 && saved.groups)data=saved } catch(e) { if(e.code!=='ENOENT') api.log.warn('群事件状态不可读，需核查本地记录') }
  const settings=()=>api.config().ext?.conversation || {}
  const allowed=scope=>settings().socialEnabled===true && String(scope).startsWith('group:') && (api.config().allow?.groups || []).map(String).includes(String(scope).slice(6))
  const state=scope=>data.groups[scope]??={events:[],targets:{},noise:null,snapshot:null}
  const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(data));renameSync(file+'.tmp',file)}
  const muted=scope=>{
    if(!allowed(scope))return false
    const s=state(scope),self=String(api.config().botQQ),now=clock()
    const personal=s.targets[self],all=s.targets['0']
    return Boolean(personal?.until>now || all?.until>now && !['owner','admin'].includes(s.snapshot?.role))
  }
  function notice(e) {
    const scope='group:'+e.group_id,now=clock(),at=Number(e.time)*1000
    if(!allowed(scope) || String(e.self_id)!==String(api.config().botQQ) || e.post_type!=='notice' || e.notice_type!=='group_ban' || !['ban','lift_ban'].includes(e.sub_type) || !(id(e.user_id)||String(e.user_id)==='0') || !(id(e.operator_id)||String(e.operator_id)==='0') || !Number.isFinite(at) || at<=0 || at>now+30000 || !Number.isFinite(Number(e.duration)) || Number(e.duration)<0)return
    const s=state(scope),target=String(e.user_id),key=hash(JSON.stringify([e.time,e.group_id,target,e.operator_id,e.sub_type,e.duration]))
    if(s.events.some(x=>x.id===key))return
    const row={id:key,kind:'group_ban',subtype:e.sub_type,at,receivedAt:now,target,operator:String(e.operator_id),durationSec:Number(e.duration),source:'authenticated_onebot_notice',motive:'unknown'}
    s.events.push(row);s.events=s.events.slice(-40)
    if(!s.targets[target] || s.targets[target].at<=at)s.targets[target]={at,until:e.sub_type==='ban'?(target==='0'?Number.MAX_SAFE_INTEGER:at+Number(e.duration)*1000):0,source:key}
    save()
  }
  async function incoming(msg) {
    if(!allowed(msg.chatId) || msg.kind!=='group' || !id(msg.userId) || !msg.messageId)return
    const text=String(msg.text||'').trim()
    if(!/(?:太吵|好吵|很吵|别(?:再)?刷屏|不要(?:再)?刷屏|少(?:说|讲|发|插话)(?:一?点)?|安静(?:一?点|会|些)|闭嘴|别(?:再)?说了)/.test(text))return
    // Quoted speech, negation, general discussion, or an explicitly different target is not feedback to us.
    if(/[「」“”"『』]|(?:有人|他说|她说|如果|假如|要是|并不|不是|不觉得|不算|没有|他们|她们|邻居|隔壁|楼上|楼下|别人).{0,8}(?:吵|刷屏|少说|闭嘴)/.test(text))return
    const named=/(?:古月方源|方源|大爱仙尊|炼天魔尊|机器人|\bbot\b)/i.test(text)
    const others=(Array.isArray(msg.raw?.message)?msg.raw.message:[]).filter(s=>s.type==='at' && String(s.data?.qq)!==String(api.config().botQQ))
    if(others.length)return
    let targeted=msg.mentioned===true || named
    if(!targeted && msg.replyId && api.core.onebot?.call)try {const quoted=await api.core.onebot.call('get_msg',{message_id:msg.replyId},{timeoutMs:3000,retries:0});targeted=String(quoted?.sender?.user_id)===String(api.config().botQQ)}catch{}
    if(!targeted)return
    const s=state(msg.chatId),now=clock(),key=hash(msg.chatId+'|'+msg.messageId)
    if(s.noise?.source===key)return
    const repeated=s.noise && now-s.noise.at<600000
    s.noise={source:key,mid:String(msg.messageId),uid:String(msg.userId),at:now,hushUntil:now+1200000,until:now+7200000,ackPending:!repeated,ackAttemptedAt:repeated?s.noise.ackAttemptedAt:0}
    s.events.push({id:key,kind:'noise_feedback',at:now,operator:String(msg.userId),sourceMid:String(msg.messageId),scope:msg.chatId});s.events=s.events.slice(-40);save()
  }
  function pace(decision,info,last,turns) {
    const {msg,policy={},recentTexts=[]}=info,scope=msg.chatId,now=clock()
    if(!allowed(scope))return decision
    if(muted(scope))return {reply:false,mode:'none',reason:'平台禁言仍在生效'}
    const s=state(scope),noise=s.noise
    if(noise?.ackPending && noise.until>now && noise.mid===String(msg.messageId))return {reply:true,mode:'must',reason:'已按当前反馈降频，简短说明一次'}
    const attention=nameAttention(msg.text)
    if(attention.direct)return {reply:true,mode:'must',reason:'明确叫到方源或常见同音误写，优先回应'}
    if(msg.mentioned || decision.mode==='must')return decision
    if(noise?.until>now && (noise.hushUntil>now || last && now-last<600000))return {reply:false,mode:'none',reason:'该群嫌吵反馈后的自适应安静期'}
    if(attention.mention)return {reply:true,mode:'interject',reason:'当前消息提到了方源，结合上下文决定是否参与'}
    // Compatibility for hosts retaining a keyword-only admission gate; all other native brakes stand.
    const hour=new Date(now).getHours(),[a,b]=policy.quietHours||[],quiet=a!==b && (a<b?hour>=a&&hour<b:hour>=a||hour<b)
    const quotaBlocked=settings().unlimitedParticipation===true && /^(?:这小时插话够多了|刚说了太多)/.test(String(decision.reason))
    if(quotaBlocked && !quiet && Number(policy.interjectChance)>0 && last && now-last<180000)return {reply:true,mode:'engaged',reason:'继续当前话题，不按次数中断；仍按短间隔和现场复核'}
    if(!decision.reply && (String(decision.reason).startsWith('话题和她关系不大') || quotaBlocked) && !quiet && recentTexts.filter(t=>String(t).trim()).length>=(policy.minRecentMessages||3) && Math.random()<Number(policy.interjectChance||0))return {reply:true,mode:'interject',reason:'活跃的普通话题，按间隔参与，不按每小时次数消失'}
    return decision
  }
  const context=scope=>{
    if(!allowed(scope))return ''
    const s=state(scope),recent=s.events.filter(e=>clock()-e.at<7*86400000).slice(-12)
    if(!recent.length && !s.snapshot)return ''
    return '【可信平台事件与群交流反馈，仅限本群】'+JSON.stringify({events:recent,currentlyMuted:muted(scope),snapshot:s.snapshot,noise:s.noise?.until>clock()?{hushUntil:s.noise.hushUntil,reducedUntil:s.noise.until,ackPending:s.noise.ackPending}:null})+'\n禁言与解除禁言是平台事实，按target和operator认人；operator=0或仅有状态查询时操作者未知。动机未知，不能仅凭一次禁言就断言恶意或按按钮机械加减好感；可结合真实上下文形成有来源、可修正的相处看法。到期只表示已知时长结束，不能虚构谁主动解禁。当前在线不证明以前未被禁言。不要把本群事件或身份带去其他场景。嫌吵降频是已经实施的行为，必要时简短说明一次，不重复广播'
  }
  function send(segments,{chatId}={}) {
    if(muted(chatId))return null
    if(!Array.isArray(segments))return segments
    let out=segments.map(x=>x.type==='text' && settings().stripTerminalPunctuation===true?{...x,data:{...x.data,text:stripTerminalPunctuation(x.data?.text||'')}}:x)
    if(allowed(chatId) && state(chatId).noise?.ackPending && state(chatId).noise.until>clock()) {
      if(!out.some(x=>x.type==='text' && x.data?.text?.includes(acknowledgement)))out=[...out,{type:'text',data:{text:acknowledgement}}]
      // A send attempt is not a receipt; uncertainty must never generate repeated acknowledgements.
      state(chatId).noise.ackPending=false;state(chatId).noise.ackAttemptedAt=clock();save()
    }
    return out
  }
  let refreshing=false,disposed=false
  async function refresh() {
    if(refreshing || !settings().socialEnabled || !api.core.onebot?.call || api.use('live-guard')?.ready?.()===false)return
    refreshing=true
    try {for(const gid of api.config().allow?.groups||[]) {
      const scope='group:'+gid;if(!allowed(scope)||disposed)continue
      const started=clock(),before=state(scope).targets[String(api.config().botQQ)]?.source,beforeAll=state(scope).targets['0']?.source
      try {
        const member=await api.core.onebot.call('get_group_member_info',{group_id:Number(gid),user_id:Number(api.config().botQQ),no_cache:true},{timeoutMs:5000,retries:0})
        if(disposed || !allowed(scope) || String(member?.user_id)!==String(api.config().botQQ) || String(member?.group_id)!==String(gid))continue
        const s=state(scope),until=Number(member.shut_up_timestamp)*1000
        s.snapshot={at:clock(),source:'get_group_member_info',role:member.role,personalUntil:Number.isFinite(until)?until:null,operator:'unknown'}
        if(Number.isFinite(until) && until>=0 && s.targets[String(api.config().botQQ)]?.source===before)s.targets[String(api.config().botQQ)]={at:started,until,source:'member_snapshot'}
        const group=await api.core.onebot.call('get_group_info',{group_id:Number(gid)},{timeoutMs:5000,retries:0})
        if(disposed || !allowed(scope))continue
        if(String(group?.group_id)===String(gid) && [-1,0,true,false].includes(group.group_all_shut)) {
          const all=group.group_all_shut===-1 || group.group_all_shut===true
          s.snapshot.allMuted=all
          if(s.targets['0']?.source===beforeAll)s.targets['0']={at:started,until:all?Number.MAX_SAFE_INTEGER:0,source:'group_snapshot'}
        }
        save()
      } catch(e) {api.log.warn('群禁言状态补查失败，保留已有平台证据')}
    }}finally{refreshing=false}
  }
  api.on('onebot',notice);api.on('message',incoming);api.on('send',send)
  api.rule?.(()=>settings().stripTerminalPunctuation===true?'QQ聊天文字每个消息气泡的结尾不加标点；内部标点可保留，代码、网址和准确数据保持原样':'')
  api.later?.(1500,refresh);api.every?.(60000,refresh,'只读补查已许可群的个人禁言状态');api.onDispose?.(()=>{disposed=true})
  api.route('/social-state',async()=>({ok:true,enabled:settings().socialEnabled===true,stripTerminalPunctuation:settings().stripTerminalPunctuation===true,groups:Object.fromEntries(Object.entries(data.groups).filter(([scope])=>allowed(scope)).map(([scope,s])=>[scope,{muted:muted(scope),events:s.events.length,snapshot:s.snapshot,noise:s.noise}]))}))
  api.route('/social-refresh',async()=>{await refresh();return {ok:true}})
  return {pace,context,muted,isAddressed:(scope,text)=>allowed(scope)&&nameAttention(text).direct}
}
