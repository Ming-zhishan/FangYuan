/** STAGING-ONLY adapter for existing Aurabot BackgroundModel.
 * All guard accounting uses mock transport in tests. No production deployment.
 */
import {createHash} from 'node:crypto';
import {BudgetDenied} from './cost_guard.mjs';
const digest=(s)=>createHash('sha256').update(s).digest('hex');
export class StagedLearningAdapter{
 constructor({guard,baseModel,store,simulate=false}){
  this.guard=guard;this.baseModel=baseModel;this.store=store;this.simulate=simulate;
  guard.db.exec("CREATE TABLE IF NOT EXISTS cached_model_response(id TEXT PRIMARY KEY,output TEXT NOT NULL,created_ms INTEGER NOT NULL)");
 }
 async ask(system,text,opts={}){
  if(opts.foreground===true)return this.baseModel.ask(system,text,opts);
  const maxTokens=opts.maxTokens??1200;
  const taskId=String(opts.jobId||'unassigned');
  const kind=/^book/.test(taskId)?'book':/^review/.test(taskId)?'review':/^life/.test(taskId)?'life':/^daily/.test(taskId)?'daily':'other';
  // Clamp only completion size; never truncate source content or evidence silently.
  const kindCap=this.guard.policy.background.maxOutputTokensByKind[kind]??this.guard.policy.background.maxOutputTokensByKind.other;
  const outputTokens=Math.min(maxTokens,kindCap);
  const promptHash=digest(system+'\0'+text+'\0'+outputTokens+'\0'+kind);
  // An unbound catchup/term request gets an exact-content key. No arbitrary chat text goes in the ledger.
  const effectiveTaskId=taskId==='unassigned'?'content:'+promptHash.slice(0,40):taskId;
  const id=digest('model-v1|'+effectiveTaskId+'|'+promptHash);
  const estimatedInputTokens=Buffer.byteLength(system+text,'utf8')+256;
  const r=this.guard.reserve({id,taskId:effectiveTaskId,bucket:'background',kind,provider:'paid',
   mode:'live',estimatedInputTokens,maxOutputTokens:outputTokens,simulation:this.simulate});
  if(!r.reexecute){
   const cached=this.guard.db.prepare('SELECT output FROM cached_model_response WHERE id=?').get(id);
   if(cached)return cached.output;
   throw new BudgetDenied('previous_attempt_uncertain_no_resend',{id,status:r.status});
  }
  try{
   // Internal BackgroundModel still enforces its own route identity and no-cash check.
   const answer=await this.baseModel.ask(system,text,{...opts,maxTokens:outputTokens,jobId:id});
   const outId=this.store.get('modelOutput:'+id);
   const row=outId?this.store.db.prepare('SELECT usage FROM model_outputs WHERE id=?').get(outId):null;
   const usage=row?.usage?JSON.parse(row.usage):null;
   if(!Number.isSafeInteger(usage?.prompt_tokens)||!Number.isSafeInteger(usage?.completion_tokens))
    throw new BudgetDenied('missing_confirmed_upstream_usage');
   this.guard.settle({id,actualInputTokens:usage.prompt_tokens,actualOutputTokens:usage.completion_tokens});
   this.guard.db.prepare('INSERT OR IGNORE INTO cached_model_response(id,output,created_ms) VALUES(?,?,?)')
    .run(id,answer,Date.now());
   return answer;
  }catch(e){
   try{this.guard.fail({id,confirmedNotSent:false})}catch{}
   throw e;
  }
 }
}

/** Local transport fixture: rejects any unexpected endpoint instead of opening a socket. */
export function mockProductionFetcher({onCompletion}={}){
 const calls=[];
 const fetcher=async (url,opts={})=>{
  const address=String(url);
  if(!address.startsWith('http://127.0.0.1:11435/'))throw Error('unexpected_network_endpoint');
  if(address.endsWith('/health'))return {ok:true,json:async()=>({provider:'tongji',model:'DeepSeek-V4.1-Flash',cash_allowed:false,local_usage_limits:'unrestricted'})};
  if(!address.endsWith('/v1/chat/completions'))throw Error('unexpected_endpoint');
  const body=JSON.parse(opts.body);
  calls.push({model:body.model,background:body.fy_background,max_tokens:body.max_tokens,messages:body.messages.length});
  const response=onCompletion?onCompletion(body):{model:'DeepSeek-V4.1-Flash',choices:[{message:{content:'{"text":"测试日常记录"}'}}],usage:{prompt_tokens:420,completion_tokens:53}};
  return {ok:true,json:async()=>response};
 };
 return {fetcher,calls};
}
