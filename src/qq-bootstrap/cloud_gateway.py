"""Loopback-only shared Replyer: free-only Bailian or original local Ollama.
Cloud credentials are DPAPI protected and never returned to clients.
"""
import asyncio,hmac,json,sqlite3,time,uuid
from pathlib import Path
from contextlib import closing
import httpx
from fastapi import FastAPI,Request,HTTPException
from fastapi.responses import JSONResponse,StreamingResponse
from cloud_trial.probe import unprotect,MODELS
ROOT=Path(__file__).resolve().parents[2]
PRIVATE=ROOT/'work/private'
STATE=PRIVATE/'cloud-runtime.json'
DB=ROOT/'work/instance/data/cloud-free-usage.sqlite3'
BASE='https://ws-q0n1iz1i6a4vek1y.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
LOCAL='http://127.0.0.1:11434'
# Free-only model chain, strongest first. When one allocation is spent, another
# verified-free model is still much better for chat than the 8B local fallback.
FREE_CHAIN=('qwen3.8-2.4t-a95b','qwen3.8-flash')
SPENT={'local_free_reserve_exhausted','free_quota_expired','free_protection_missing','daily_free_budget_exhausted'}
LAST_REQUEST={}
# In-process only: a restart clears it, which is why health also reports the
# persisted last_cloud_error separately instead of treating either as current state.
LAST_SUCCESS={}
app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)

def settings():return json.loads(STATE.read_text(encoding='utf-8'))
def reserve(cfg,model,messages):
 if cfg.get('coupon_mode',False):raise ValueError('coupon_mode_not_authorized')
 if model not in MODELS or cfg.get('free_only_verified',{}).get(model) is not True:raise ValueError('free_protection_missing')
 if time.time()>=cfg['stop_at_unix'][model]:raise ValueError('free_quota_expired')
 bound=sum(len(m['content'].encode('utf-8'))+64 for m in messages)+512
 if bound>24000:raise ValueError('context_too_large')
 amount=bound+2048+(512 if model=="qwen3.8-2.4t-a95b" else 0)
 with closing(sqlite3.connect(DB)) as db,db:
  db.execute('CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,model TEXT,held INTEGER,actual INTEGER,created REAL,status TEXT)')
  db.execute('BEGIN IMMEDIATE')
  used=db.execute('SELECT coalesce(sum(coalesce(actual,held)),0) FROM calls WHERE model=?',(model,)).fetchone()[0]
  cutoff=cfg.get('usage_accounting_v2_since',0)
  # Old receipts omitted reasoning. Reserve its full known bound for the
  # cumulative stop as well as the daily warning; never rewrite old receipts.
  legacy=db.execute('SELECT count(*) FROM calls WHERE created<? AND model=?',(cutoff,model)).fetchone()[0]*512 if model=='qwen3.8-2.4t-a95b' else 0
  used+=legacy
  if used+amount>cfg['free_token_ceiling'][model]:raise ValueError('local_free_reserve_exhausted')
  daily=db.execute('SELECT coalesce(sum(coalesce(actual,held)),0) FROM calls WHERE created>=?',(int(time.time()//86400)*86400,)).fetchone()[0]
  legacy_daily=db.execute('SELECT count(*) FROM calls WHERE created>=? AND created<? AND model=?',(int(time.time()//86400)*86400,cutoff,'qwen3.8-2.4t-a95b')).fetchone()[0]*512
  ceiling=cfg.get('daily_token_ceiling',160000)
  if daily+legacy_daily+amount>ceiling:
   # Blocked turns must leave the same evidence a warning did: the ledger plus
   # this line is the only local proof of why cloud stopped.
   blocked=cfg.get('daily_budget_action','stop')!='warn'
   print(json.dumps({'daily_budget_exceeded':True,'action':'stop' if blocked else 'warn',
     'used':daily+legacy_daily,'reservation':amount,'daily_ceiling':ceiling,
     'period':'utc-day','resets_at_local':'08:00'},ensure_ascii=True),flush=True)
   if blocked:raise ValueError('daily_free_budget_exhausted')
  ident=str(uuid.uuid4());db.execute('INSERT INTO calls VALUES(?,?,?,NULL,?,?)',(ident,model,amount,time.time(),'reserved'))
 return ident,amount

def settle(ident,amount,usage):
 a,b=usage.get('prompt_tokens'),usage.get('completion_tokens')
 if not isinstance(a,int) or not isinstance(b,int) or min(a,b)<0:raise ValueError('missing_usage')
 reported=usage.get('total_tokens',a+b)
 if not isinstance(reported,int) or isinstance(reported,bool) or reported<a+b:raise ValueError('missing_usage')
 details=usage.get("completion_tokens_details") or {}
 text,reasoning=details.get("text_tokens"),details.get("reasoning_tokens")
 extra=a+text+reasoning if isinstance(text,int) and isinstance(reasoning,int) and min(text,reasoning)>=0 else a+b
 total=max(reported,a+b,extra)
 with closing(sqlite3.connect(DB)) as db,db:
  db.execute('UPDATE calls SET actual=?,status=? WHERE id=?',(total,'complete' if total<=amount else 'estimate_exceeded',ident))
 if total>amount:raise ValueError('estimate_exceeded')

def disable_cloud(reason):
 # Only billing/protection failures latch. Network blips and a single upstream
 # 400 affect this turn only: latching on those kept the bot on the 8B local
 # model for hours after one transient rejection.
 permanent=reason not in {'daily_free_budget_exhausted','context_too_large','ReadTimeout','ConnectTimeout','ConnectError','RemoteProtocolError','http_400','http_429','http_500','http_502','http_503'}
 def change(cfg):
  cfg.update(last_cloud_error=reason,error_at=time.time())
  if permanent:
   if cfg.get('provider','bailian')=='tongji':cfg['bailian_blocked']=True
   else:cfg['mode']='local'
 from model_config import update
 update(STATE,change)

def model_chain(cfg):
 primary=cfg.get('model')
 rest=[m for m in FREE_CHAIN if m!=primary and cfg.get('free_only_verified',{}).get(m) is True]
 return ([primary] if primary else [])+rest

async def _generate_bailian_or_local(messages,thinking=False,output_limit=2048,force_local=False,tools=None,tool_choice=None):
 if not messages or any(m.get('role') not in {'system','user','assistant','tool'} or not isinstance(m.get('content'),(str,type(None))) for m in messages):raise HTTPException(400,'text_messages_only')
 cfg=settings();model=cfg['model'];tick=time.monotonic();route='local';reason=None;payload=None
 if cfg.get('mode')=='cloud' and not force_local and not cfg.get('bailian_blocked',False):
  for cand in model_chain(cfg):
   try:
    ident,amount=reserve(cfg,cand,messages)
    do_think=cand=='qwen3.8-2.4t-a95b'  # This endpoint rejects enable_thinking=False (isolated 400 evidence).
    req=dict(model=cand,messages=messages,stream=False,max_tokens=min(2048,max(1024,int(output_limit))),temperature=.6,top_p=.95,
             enable_thinking=do_think,enable_search=False)
    if do_think:req['thinking_budget']=512
    if tools:
     req['tools']=tools
     if tool_choice:req['tool_choice']=tool_choice
    key=unprotect(PRIVATE/'bailian-trial-key.dpapi')
    async with httpx.AsyncClient(trust_env=False,follow_redirects=False,timeout=28 if thinking else 20) as c:
     r=await c.post(BASE+'/chat/completions',json=req,headers={'Authorization':'Bearer '+key})
     if r.status_code==400 and 'enable_thinking' in req:
      # This gateway family has rejected enable_thinking before. Retry the same
      # model without the flag instead of dropping the turn to the local model.
      req.pop('enable_thinking',None);req.pop('thinking_budget',None)
      r=await c.post(BASE+'/chat/completions',json=req,headers={'Authorization':'Bearer '+key})
    if r.status_code!=200:
     # Keep the upstream reason visible: a bare http_400 cannot be diagnosed
     # afterwards, and the body carries no credentials.
     print(json.dumps({'upstream_error':r.status_code,'model':cand,'body':r.text[:400]},ensure_ascii=True),flush=True)
     raise ValueError('http_'+str(r.status_code))
    payload=r.json();settle(ident,amount,payload.get('usage') or {})
    if not payload['choices'][0]['message'].get('content','').strip():raise ValueError('empty_cloud_answer')
    model=cand;route='bailian-free';reason=None;break
   except Exception as e:
    reason=str(e) if type(e) is ValueError and str(e) in {'coupon_mode_not_authorized','daily_free_budget_exhausted','free_protection_missing','free_quota_expired','context_too_large','local_free_reserve_exhausted','missing_usage','estimate_exceeded','empty_cloud_answer','http_400','http_401','http_403','http_429','http_500','http_502','http_503'} else type(e).__name__
    # A spent allocation is a reason to try the next free model, not to shut
    # cloud off; a network blip is not a reason to burn another model's quota.
    if reason in SPENT:continue
    break
  if route!='bailian-free':disable_cloud(reason)
 if route=='local':
  # 16s was shorter than a cold 8B load, so the only remaining free fallback
  # timed out exactly when cloud was blocked. 30s stays inside the caller's 35s.
  async with httpx.AsyncClient(trust_env=False,timeout=30) as c:
   r=await c.post(LOCAL+'/api/chat',json={'model':'fangyuan-eightb:latest','messages':messages,'stream':False,'think':False,'keep_alive':'30m','options':{'temperature':.6,'num_ctx':8192,'num_predict':512}})
   r.raise_for_status();p=r.json()
  model='fangyuan-eightb:latest'
  payload={'id':'local-'+str(uuid.uuid4()),'object':'chat.completion','created':int(time.time()),'model':model,'choices':[{'index':0,'message':p['message'],'finish_reason':'stop'}], 'usage':{'prompt_tokens':p.get('prompt_eval_count',0),'completion_tokens':p.get('eval_count',0),'total_tokens':p.get('prompt_eval_count',0)+p.get('eval_count',0)}}
 payload['model']=model
 print(json.dumps({'reply_route':route,'model':model,'seconds':round(time.monotonic()-tick,3),'fallback_reason':reason,'usage':payload.get('usage')},ensure_ascii=True),flush=True)
 return payload,route

async def generate(messages,thinking=False,output_limit=2048,tools=None,tool_choice=None,background=False,primary_only=False):
 global LAST_REQUEST,LAST_SUCCESS
 cfg=settings();provider=cfg.get('provider','bailian');tick=time.monotonic()
 if provider not in {'bailian','tongji','local'}:raise HTTPException(503,'unknown_provider')
 if provider=='tongji' and cfg.get('mode')=='cloud':
  import tongji_provider as school
  try:
   payload,route=await asyncio.wait_for(school.generate(messages,output_limit=output_limit,scope='qq',tools=tools,tool_choice=tool_choice,deadline=240 if background else 45 if primary_only else None,background=background),245 if background else 50)
   print(json.dumps({'reply_route':route,'model':payload['model'],'seconds':round(time.monotonic()-tick,3),'usage':payload.get('usage')},ensure_ascii=True),flush=True)
  except Exception as exc:
   reason=exc.code if isinstance(exc,school.Blocked) else type(exc).__name__
   if background or primary_only:
    LAST_REQUEST={'route':'unavailable','primary_error':reason,'seconds':round(time.monotonic()-tick,3)}
    raise HTTPException(503,('background_primary_unavailable:' if background else 'primary_unavailable:')+reason) from None
   fallback=cfg.get('tongji_fallback','bailian')
   print(json.dumps({'primary_provider':'tongji','fallback_reason':reason,'fallback_to':fallback}),flush=True)
   try:
    remaining=max(1,90-(time.monotonic()-tick))
    payload,route=await asyncio.wait_for(_generate_bailian_or_local(messages,thinking=thinking,output_limit=output_limit,force_local=fallback!='bailian',tools=tools,tool_choice=tool_choice),remaining)
    payload['primary_error']=reason
   except Exception:
    LAST_REQUEST={'route':'unavailable','primary_error':reason,'seconds':round(time.monotonic()-tick,3)}
    raise HTTPException(503,'model_temporarily_unavailable') from None
 else:
  payload,route=await _generate_bailian_or_local(messages,thinking=thinking,output_limit=output_limit,force_local=provider=='local',tools=tools,tool_choice=tool_choice)
 LAST_REQUEST={'route':route,'model':payload.get('model'),'seconds':round(time.monotonic()-tick,3),'primary_error':payload.get('primary_error')}
 if route!='unavailable':
  LAST_SUCCESS={'at':time.time(),'model':payload.get('model'),'route':route,
                'seconds':LAST_REQUEST['seconds'],'primary_error':payload.get('primary_error')}
 return payload,route

@app.middleware('http')
async def authenticate(request:Request,call_next):
 if request.url.path!='/health':
  token=settings()['gateway_token']
  if not hmac.compare_digest(request.headers.get('authorization',''),'Bearer '+token):return JSONResponse(status_code=401,content={'error':'unauthorized'})
 return await call_next(request)

@app.get('/health')
async def health():
 c=settings();provider=c.get('provider','bailian');configured=c.get('model')
 local_usage_limits='enforced'
 if provider=='tongji':
  from tongji_provider import settings as school_settings
  school=school_settings();configured=school.get('model')
  if school.get('unrestricted_usage_authorized') is True:local_usage_limits='unrestricted'
 last=LAST_REQUEST or {};err=c.get('last_cloud_error');err_at=c.get('error_at')
 def iso(ts):
  try:return time.strftime('%Y-%m-%d %H:%M:%S',time.localtime(ts))
  except Exception:return None
 # runtime_state describes this process only; last_error is the persisted
 # record and may predate it, so one must never be read as the other.
 state=('idle' if not last else
        'unavailable' if last.get('route')=='unavailable' else
        'degraded' if last.get('primary_error') else 'ok')
 return {'ok':True,'mode':c.get('mode'),'provider':provider,'background_primary_only':True,
  'model':configured,'configured_model':configured,
  'last_served_model':last.get('model'),'last_reply_route':last.get('route'),
  'last_fallback_reason':last.get('primary_error'),'runtime_state':state,
  'last_request':last,
  'last_error':({'reason':err,'at':err_at,'iso':iso(err_at),'persisted':True,
                 'note':'persisted value; may predate current process'} if err else None),
  'last_success':({'at':LAST_SUCCESS.get('at'),'iso':iso(LAST_SUCCESS.get('at')),
                   'model':LAST_SUCCESS.get('model'),'route':LAST_SUCCESS.get('route'),
                   'since_process_start':True} if LAST_SUCCESS else None),
  'cash_allowed':False,
  'local_usage_limits':local_usage_limits,
  'last_cloud_error':err}

@app.get('/v1/models')
async def models():return {'object':'list','data':[{'id':'fangyuan-cloud','object':'model','owned_by':'local-free-guard'}]}

@app.post('/api/chat')
async def ollama(request:Request):
 body=await request.json();p,route=await generate(body.get('messages'),thinking=body.get('think',False),output_limit=1280 if body.get('character_profile')=='fiction' else 2048);u=p.get('usage',{})
 return {'model':p['model'],'message':p['choices'][0]['message'],'done':True,'done_reason':p['choices'][0].get('finish_reason'),'prompt_eval_count':u.get('prompt_tokens'),'eval_count':u.get('completion_tokens'),'character_route':route}

@app.post('/v1/chat/completions')
async def completions(request:Request):
 body=await request.json()
 requested=body.get('max_completion_tokens',body.get('max_tokens',2048))
 if isinstance(requested,bool) or not isinstance(requested,int) or requested<1:raise HTTPException(400,'invalid_output_limit')
 p,route=await generate(body.get('messages'),thinking=bool(body.get('enable_thinking',False)),output_limit=min(32768 if body.get('fy_background') is True else 8192,max(16,requested)),tools=body.get('tools'),tool_choice=body.get('tool_choice'),background=body.get('fy_background') is True,primary_only=body.get('fy_primary_only') is True)
 if not body.get('stream'):return p
 async def stream():
  message=p['choices'][0]['message'];base={'id':p.get('id','fy-'+str(uuid.uuid4())),'object':'chat.completion.chunk','created':int(time.time()),'model':p['model']}
  if message.get('reasoning_content'):
   yield 'data: '+json.dumps({**base,'choices':[{'index':0,'delta':{'reasoning_content':message['reasoning_content']},'finish_reason':None}]},ensure_ascii=False)+'\n\n'
  calls=message.get('tool_calls')
  if calls:
   delta={'role':'assistant','tool_calls':[{'index':i,'id':c.get('id'),'type':'function','function':c.get('function')} for i,c in enumerate(calls)]}
   yield 'data: '+json.dumps({**base,'choices':[{'index':0,'delta':delta,'finish_reason':None}]},ensure_ascii=False)+'\n\n'
   yield 'data: '+json.dumps({**base,'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls'}],'usage':p.get('usage',{})})+'\n\n'
  else:
   yield 'data: '+json.dumps({**base,'choices':[{'index':0,'delta':{'role':'assistant','content':message.get('content','')},'finish_reason':None}]},ensure_ascii=False)+'\n\n'
   yield 'data: '+json.dumps({**base,'choices':[{'index':0,'delta':{},'finish_reason':'stop'}],'usage':p.get('usage',{})})+'\n\n'
  yield 'data: [DONE]\n\n'
 return StreamingResponse(stream(),media_type='text/event-stream')

if __name__=='__main__':
 import uvicorn
 uvicorn.run(app,host='127.0.0.1',port=11435,access_log=False,log_level='warning')
