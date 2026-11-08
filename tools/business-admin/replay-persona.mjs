#!/usr/bin/env node
/** Six bounded synthetic model-only turns. No tools, QQ, production config/database or automatic retry. */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1]
if(!args.includes('--before-root'))throw new Error('Provide --before-root pinned-baseline; default is plan only')
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),before=resolve(get('--before-root'))
const fixtures=readFileSync(join(repo,'tools/business-admin/persona-cases.jsonl'),'utf8').trim().split('\n').map(JSON.parse)
const out=join(repo,'tools/business-admin/private/persona-ab');mkdirSync(out,{recursive:true})
const sha=s=>createHash('sha256').update(s).digest('hex')
const cfg={enabled:true,ownerQQ:'100001',botQQ:'200001',ext:{principals:{enabled:true,businessAdmins:['100002'],friendship:'deep_allies',allyAttention:true}}}
const {relationshipFrame}=await import(pathToFileURL(join(repo,'src/fangyuan-agent/modules/principals/policy.mjs')))
const relationPolicy=readFileSync(join(repo,'src/fangyuan-agent/modules/principals/relationship-policy.txt'),'utf8')
const model='DeepSeek-V4.1-Flash',endpoint='http://127.0.0.1:11435'
if(!args.includes('--execute')){console.log(JSON.stringify({plan:true,cases:3,maximumCalls:6,mode:'synthetic model-only, no tools; combined persona and configured-relationship comparison'}));process.exit(0)}
if(!args.includes('--credential-file'))throw new Error('Explicit local credential file required')
const health=await fetch(endpoint+'/health',{signal:AbortSignal.timeout(5000)}).then(r=>r.json())
if(health.provider!=='tongji'||health.model!==model||health.cash_allowed!==false)throw new Error('Verified non-cash primary route required')
const token=JSON.parse(readFileSync(resolve(get('--credential-file')),'utf8').replace(/^\uFEFF/, '')).gateway_token
if(!token)throw new Error('Missing local credential')
let last=0
for(const [variant,root] of [['before',before],['after',repo]]){
 const core=readFileSync(join(root,'src/fangyuan-agent/modules/fangyuan/core.txt'),'utf8').trim()
 for(const c of fixtures){
  const chat=c.scene==='private'?{kind:'private',userId:c.speaker}:{kind:'group',groupId:'300001'}
  const rows=[...c.history,{uid:c.speaker,role:'user',text:c.userText,addressedUids:c.addressedUids||[]}]
  const input={scene:c.scene,current:{uid:c.speaker,text:c.userText,addressedUids:c.addressedUids||[]},history:c.history,execution:'isolated role dialogue; no external action tools'}
  const frame=variant==='after'?relationshipFrame(cfg,chat,rows,[c.speaker]):null
  const system=core+'\n'+(frame?relationPolicy+'\n【配置核实的当前身份与关系】'+JSON.stringify(frame):'')+'\n本次为隔离文字回放，不具备外部动作工具。只输出准备说的话，不写分析或舞台动作。'
  const conditions={variant,case_id:c.id,core_sha256:sha(core),input_sha256:sha(JSON.stringify(input)),system_sha256:sha(system),relationship:frame,model,max_tokens:4096,primary_only:true,sampling:'gateway controlled; no seed attestation',mode:'model_only_no_tools'}
  const file=join(out,sha(JSON.stringify(conditions))+'.json')
  if(existsSync(file)){console.log(JSON.stringify({case:c.id,variant,cached:true}));continue}
  const record={conditions,input,system,execution_status:'attempted',at:new Date().toISOString()};writeFileSync(file,JSON.stringify(record,null,2))
  if(last)await new Promise(r=>setTimeout(r,Math.max(0,21000-(Date.now()-last))));last=Date.now()
  try{
   const response=await fetch(endpoint+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},signal:AbortSignal.timeout(180000),body:JSON.stringify({model,stream:false,fy_background:false,fy_primary_only:true,max_tokens:4096,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}]})})
   if(!response.ok)throw new Error('guard_http_'+response.status)
   const result=await response.json();if(result.model!==model||!result.choices?.[0]?.message?.content)throw new Error('wrong_or_empty_model')
   Object.assign(record,{execution_status:'ok',text:result.choices[0].message.content,usage:result.usage,finish:result.choices[0].finish_reason})
  }catch(e){Object.assign(record,{execution_status:'failed_or_unknown',error:String(e.message).slice(0,100)})}
  writeFileSync(file,JSON.stringify(record,null,2));console.log(JSON.stringify({case:c.id,variant,status:record.execution_status,usage:record.usage}))
  if(record.execution_status!=='ok')process.exit(1)
 }
}
