/** Four bounded synthetic old/new model-only pairs; defaults to plan, no QQ or production mutation. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const args=process.argv.slice(2), get=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..')
const ids=['CAN-P01','CAN-P03','CAN-P04','CAN-P07']
const cases=readFileSync(join(repo,'tools/dialogue-quality/data/persona-cases.v1.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(c=>ids.includes(c.id))
if(cases.length!==4)throw new Error('Expected exactly four fixed scenarios')
if(!args.includes('--execute')){console.log(JSON.stringify({plan:true,cases:ids,maximumCalls:8,onlyChangedCondition:'effective persona core',otherFourCases:'not generated'}));process.exit(0)}
if(!get('--before-core')||!get('--credential-file'))throw new Error('Explicit frozen before-core and local credential file required')
const endpoint='http://127.0.0.1:11435',model='DeepSeek-V4.1-Flash'
const health=await fetch(endpoint+'/health',{signal:AbortSignal.timeout(5000)}).then(r=>r.json())
if(health.provider!=='tongji'||health.model!==model||health.cash_allowed!==false)throw new Error('Verified primary non-cash route required')
const token=JSON.parse(readFileSync(resolve(get('--credential-file')),'utf8').replace(/^\uFEFF/,'')).gateway_token
if(!token)throw new Error('Missing local credential')
const out=join(repo,'tools/dialogue-quality/private/persona-canon-20261103/model-ab');mkdirSync(out,{recursive:true})
const sha=s=>createHash('sha256').update(s).digest('hex')
const {relationshipFrame}=await import(pathToFileURL(join(repo,'src/fangyuan-agent/modules/principals/policy.mjs')))
const friendPolicy=readFileSync(join(repo,'src/fangyuan-agent/modules/principals/relationship-policy.txt'),'utf8')
const cfg={ownerQQ:'100001',botQQ:'200001',ext:{principals:{enabled:true,businessAdmins:['100002'],friendship:'deep_allies'}}}
let last=0
for(const variant of ['before','after']){
 const core=readFileSync(variant==='before'?resolve(get('--before-core')):join(repo,'src/fangyuan-agent/modules/fangyuan/core.txt'),'utf8').replaceAll('\r\n','\n').trim()
 for(const c of cases){
  const input={current:c.input,history:c.history,trusted_scene:c.trusted_scene}
  const friend=c.id==='CAN-P07'
  const frame=friend?relationshipFrame(cfg,{kind:'group'},[...c.history,{uid:c.input.uid,addressedUids:c.addressedUids}], [c.input.uid]):null
  const context=frame?friendPolicy+'\n'+JSON.stringify(frame):''
  const system=core+'\n'+context+'\n本次是隔离文字回放，没有外部动作工具。只输出准备说的话，不写分析或舞台动作。'
  const conditions={variant,case_id:c.id,case_version:c.version,input_sha256:sha(JSON.stringify(input)),core_sha256:sha(core),context_sha256:sha(context),system_sha256:sha(system),retrieval:'none',memory:'fixed synthetic history only',model,max_tokens:4096,primary_only:true,sampling:'gateway controlled; no seed attestation',mode:'model_only_no_tools'}
  const file=join(out,sha(JSON.stringify(conditions))+'.json')
  if(existsSync(file)){console.log(JSON.stringify({case:c.id,variant,cached:true}));continue}
  const record={conditions,input,system,execution_status:'attempted',at:new Date().toISOString()};writeFileSync(file,JSON.stringify(record,null,2))
  if(last)await new Promise(r=>setTimeout(r,Math.max(0,21000-(Date.now()-last))));last=Date.now()
  try{
   const response=await fetch(endpoint+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},signal:AbortSignal.timeout(180000),body:JSON.stringify({model,stream:false,max_tokens:4096,fy_primary_only:true,fy_background:false,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}]})})
   if(!response.ok)throw new Error('guard_http_'+response.status)
   const result=await response.json();if(result.model!==model||!result.choices?.[0]?.message?.content)throw new Error('wrong_or_empty_model')
   Object.assign(record,{execution_status:'ok',text:result.choices[0].message.content,finish:result.choices[0].finish_reason,usage:result.usage})
  }catch(e){Object.assign(record,{execution_status:'failed_or_unknown',error:String(e.message).slice(0,100)})}
  writeFileSync(file,JSON.stringify(record,null,2));console.log(JSON.stringify({case:c.id,variant,status:record.execution_status,usage:record.usage}))
  if(record.execution_status!=='ok')process.exit(1)
 }
}
