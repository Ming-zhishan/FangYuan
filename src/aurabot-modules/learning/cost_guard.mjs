import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
export class BudgetDenied extends Error{
 constructor(code,info={}){super(code);this.name='BudgetDenied';this.code=code;this.info=info}
}
function validStr(s,name){if(typeof s!=='string'||!s.trim()||s.length>150)throw new BudgetDenied('invalid_'+name)}
function validInt(n,name){if(!Number.isSafeInteger(n)||n<0)throw new BudgetDenied('invalid_'+name)}
export class CostGuard{
 constructor({policy,dbPath,clock=()=>Date.now()}){
  this.policy=policy;this.clock=clock;
  fs.mkdirSync(path.dirname(dbPath),{recursive:true});
  this.db=new DatabaseSync(dbPath);
  this.db.exec("PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;");
  this.db.exec("CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,day TEXT NOT NULL,task_id TEXT NOT NULL,bucket TEXT NOT NULL,kind TEXT NOT NULL,provider TEXT NOT NULL,reserved_input INTEGER NOT NULL,reserved_output INTEGER NOT NULL,reserved_total INTEGER NOT NULL,status TEXT NOT NULL,actual_input INTEGER,actual_output INTEGER,actual_total INTEGER,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS calls_day_bucket ON calls(day,bucket);CREATE INDEX IF NOT EXISTS calls_task ON calls(task_id,bucket)");
 }
 close(){this.db.close()}
 reserve({id,taskId,bucket='test',kind='other',provider='mock',mode='mock',estimatedInputTokens=0,maxOutputTokens=0,simulation=false}){
  validStr(id,'id');validStr(taskId,'task');validStr(kind,'kind');
  if(!['test','background'].includes(bucket))throw new BudgetDenied('invalid_bucket');
  if(!['mock','local','paid'].includes(provider))throw new BudgetDenied('invalid_provider');
  validInt(estimatedInputTokens,'input');validInt(maxOutputTokens,'output');
  const required=estimatedInputTokens+maxOutputTokens,now=this.clock(),day=new Date(now).toISOString().slice(0,10);
  validInt(required,'total');
  if(provider!=='paid')return {allowed:true,charged:false,reexecute:true,estimatedTokens:0,reason:'mock_or_local_no_paid_tokens'};
  if(bucket==='test'&&this.policy.testing.requireExplicitLive&&mode!=='live')throw new BudgetDenied('paid_test_requires_live_mode');
  if(!simulation&&!this.policy.allowLiveInPrototype)throw new BudgetDenied('prototype_disallows_real_paid_call');
  const cfg=bucket==='test'?this.policy.testing:this.policy.background;
  if(bucket==='background'){
   const cap=cfg.maxOutputTokensByKind[kind]??cfg.maxOutputTokensByKind.other;
   if(maxOutputTokens>cap)throw new BudgetDenied('background_output_cap',{kind,cap});
  }
  if(required>cfg.perRequestReservedTokens)throw new BudgetDenied('per_request_cap',{required,cap:cfg.perRequestReservedTokens});
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const old=this.db.prepare('SELECT * FROM calls WHERE id=?').get(id);
   if(old){
    if(old.bucket!==bucket||old.task_id!==taskId||old.kind!==kind||old.reserved_total!==required)throw new BudgetDenied('reservation_id_conflict');
    this.db.exec('COMMIT');
    return {allowed:true,charged:true,duplicate:true,reexecute:false,status:old.status,estimatedTokens:old.reserved_total};
   }
   const totals=(where,args)=>this.db.prepare("SELECT COALESCE(SUM(CASE WHEN status='settled' THEN actual_total ELSE reserved_total END),0) t,COUNT(*) n FROM calls WHERE provider='paid' AND status!='confirmed_unsent' AND "+where).get(...args);
   const D=totals('bucket=? AND day=?',[bucket,day]);
   if(D.t+required>cfg.dailyReservedTokens)throw new BudgetDenied('daily_cap',{counted:D.t,required,cap:cfg.dailyReservedTokens});
   if(bucket==='test'){
    const T=totals('bucket=? AND task_id=?',[bucket,taskId]);
    if(T.t+required>cfg.perTaskReservedTokens)throw new BudgetDenied('per_task_cap',{counted:T.t,required,cap:cfg.perTaskReservedTokens});
    if(T.n>=cfg.maxPaidCallsPerTask)throw new BudgetDenied('per_task_call_cap',{calls:T.n});
    if(D.n>=cfg.maxPaidCallsPerDay)throw new BudgetDenied('daily_call_cap',{calls:D.n});
   }else{
    const H=totals('bucket=? AND created_ms>=?',[bucket,now-3600000]);
    if(H.n>=cfg.maxPaidCallsPerHour)throw new BudgetDenied('background_hour_cap',{calls:H.n});
   }
   this.db.prepare('INSERT INTO calls(id,day,task_id,bucket,kind,provider,reserved_input,reserved_output,reserved_total,status,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,day,taskId,bucket,kind,provider,estimatedInputTokens,maxOutputTokens,required,'reserved',now,now);
   this.db.exec('COMMIT');
   return {allowed:true,charged:true,reexecute:true,estimatedTokens:required,remainingDayTokens:cfg.dailyReservedTokens-D.t-required};
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 settle({id,actualInputTokens,actualOutputTokens}){
  validStr(id,'id');validInt(actualInputTokens,'input');validInt(actualOutputTokens,'output');
  const total=actualInputTokens+actualOutputTokens;validInt(total,'total');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const x=this.db.prepare('SELECT * FROM calls WHERE id=?').get(id);
   if(!x)throw new BudgetDenied('reservation_not_found');
   if(x.status==='settled'){
    if(x.actual_total!==total)throw new BudgetDenied('settlement_conflict');
    this.db.exec('COMMIT');return {alreadySettled:true,chargedTokens:total};
   }
   if(x.status==='confirmed_unsent')throw new BudgetDenied('settlement_after_confirmed_unsent');
   this.db.prepare("UPDATE calls SET status='settled',actual_input=?,actual_output=?,actual_total=?,updated_ms=? WHERE id=?").run(actualInputTokens,actualOutputTokens,total,this.clock(),id);
   this.db.exec('COMMIT');return {chargedTokens:total,overReserveTokens:Math.max(0,total-x.reserved_total)};
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 fail({id,confirmedNotSent=false}){
  validStr(id,'id');this.db.exec('BEGIN IMMEDIATE');
  try{
   const x=this.db.prepare('SELECT * FROM calls WHERE id=?').get(id);
   if(!x)throw new BudgetDenied('reservation_not_found');
   if(x.status==='settled')throw new BudgetDenied('cannot_fail_settled');
   const status=confirmedNotSent?'confirmed_unsent':'failed_or_unknown';
   this.db.prepare('UPDATE calls SET status=?,updated_ms=? WHERE id=?').run(status,this.clock(),id);
   this.db.exec('COMMIT');return {status,heldTokens:confirmedNotSent?0:x.reserved_total};
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 report(day=new Date(this.clock()).toISOString().slice(0,10)){
  const rows=this.db.prepare("SELECT bucket,status,COUNT(*) calls,COALESCE(SUM(CASE WHEN status='settled' THEN actual_total WHEN status='confirmed_unsent' THEN 0 ELSE reserved_total END),0) counted_tokens,COALESCE(SUM(CASE WHEN status='settled' THEN actual_input ELSE 0 END),0) actual_input_tokens,COALESCE(SUM(CASE WHEN status='settled' THEN actual_output ELSE 0 END),0) actual_output_tokens FROM calls WHERE day=? GROUP BY bucket,status ORDER BY bucket,status").all(day);
  return {day,rows,currencyCostKnown:false,notes:'Reserves are estimates. Provider usage can exceed them and is then counted in full. This module does not make API calls.'};
 }
}
