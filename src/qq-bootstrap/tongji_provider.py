"""Tongji's documented OpenAI endpoint; no private data until policy is verified.

No API keys, request bodies, response bodies, or exception messages are logged.
Budgets below are local limits, never statements of the university's quota.
"""
import asyncio,json,os,re,sqlite3,time,uuid
from contextlib import closing
from pathlib import Path
import httpx
from cloud_trial.probe import unprotect

ROOT=Path(__file__).resolve().parents[1]
CONFIG=ROOT/'private/tongji-runtime.json'
CREDENTIAL=ROOT/'private/tongji-credential.json'
KEY=ROOT/'private/tongji-llm-key.dpapi'
DB=ROOT/'instance/data/tongji-usage.sqlite3'
BASE='https://agi.tongji.edu.cn/v1'
ROUTE='tongji-school'
DEFAULTS={'base_url':BASE,'expected_display_name':'DeepSeek1017','model':None,
 'enabled':False,'free_only_verified':False,'synthetic_use_verified':False,
 'qq_use_verified':False,'external_friend_data_verified':False,
 'model_verified':False,'max_output_tokens':1024,'input_byte_limit':24000,
 'local_daily_token_limit':20000,'local_total_token_limit':100000,
 'local_daily_call_limit':20,'local_total_call_limit':60,'local_rpm':6,
 'timeout_seconds':15,'proxy_url':None,'verification_expires_at':0,
 'evidence':{},'cooldown_until':0,'temperature':0.7,
 'billing_mode':'unknown','credit_only_verified':False,'pricing_verified':False,
 'cash_charging_authorized':False,'input_points_per_million':30,
 'cached_input_points_per_million':0.6,'output_points_per_million':120,
 'local_daily_points_limit':1,'local_total_points_limit':3}
# Three roles (planner/replyer/helpers) may arrive together; keep a small cap.
_slot=asyncio.Semaphore(3)
_background_slot=asyncio.Semaphore(2)
_cooldown_until=0.

class Blocked(Exception):
 def __init__(self,code):self.code=code;super().__init__(code)

def settings():
 data=json.loads(CONFIG.read_text(encoding='utf-8-sig')) if CONFIG.exists() else {}
 return {**DEFAULTS,**data}

def endpoint(cfg):
 # A chat instruction or unverified config cannot redirect a university key.
 if cfg.get('base_url','').rstrip('/')!=BASE:raise Blocked('unverified_school_endpoint')
 proxy=cfg.get('proxy_url')
 if proxy and not re.fullmatch(r'http://127\.0\.0\.1:\d{2,5}',proxy):raise Blocked('unverified_proxy')
 return BASE

def credential():
 state=json.loads(CREDENTIAL.read_text(encoding='utf-8-sig')) if CREDENTIAL.exists() else {}
 if not state.get('new_key_confirmed') or not state.get('old_key_revoked_confirmed'):raise Blocked('new_key_rotation_required')
 # A stale environment variable must not override the newly rotated local key.
 key=(unprotect(KEY) if KEY.exists() else
      os.environ.get('TONGJI_LLM_API_KEY','') if state.get('storage')=='environment' and state.get('env_name')=='TONGJI_LLM_API_KEY' else '')
 if not isinstance(key,str) or len(key.strip())<16 or re.search(r'\s',key.strip()):raise Blocked('new_key_missing')
 return key.strip()

def verify(cfg,scope):
 endpoint(cfg)
 if scope not in {'qq','synthetic'}:raise Blocked('invalid_data_scope')
 required=['enabled','model_verified','synthetic_use_verified']
 if scope=='qq':required+=['qq_use_verified','external_friend_data_verified']
 if not all(cfg.get(k) is True for k in required):raise Blocked('school_policy_not_verified')
 if cfg.get('billing_mode')=='school_points':
  if not cfg.get('credit_only_verified') or not cfg.get('pricing_verified') or cfg.get('cash_charging_authorized') is not False:raise Blocked('school_points_policy_not_verified')
 elif cfg.get('free_only_verified') is not True:raise Blocked('school_policy_not_verified')
 if time.time()>=cfg.get('verification_expires_at',0):raise Blocked('school_verification_expired')
 if not isinstance(cfg.get('model'),str) or not cfg['model'].strip():raise Blocked('school_model_not_verified')

def call_limits(cfg,output_limit,deadline=None,background=False):
 cap=min(32768,int(cfg.get('background_max_output_tokens',32768))) if background else min(8192,int(cfg['max_output_tokens']))
 output=min(cap,max(16,int(output_limit)))
 wait=min(300,max(30,int(deadline or cfg.get('background_timeout_seconds',240)))) if background else min(60,max(18,int(deadline))) if deadline else min(60,max(3,int(cfg['timeout_seconds'])))
 return output,wait

def reserve(cfg,messages,output,tools=None):
 bound=sum(len(m['content'].encode('utf-8'))+len(m.get('reasoning_content','').encode('utf-8'))+64+(len(json.dumps(m.get('tool_calls'),ensure_ascii=False)) if m.get('tool_calls') else 0) for m in messages)+512
 if tools:bound+=len(json.dumps(tools,ensure_ascii=False))
 foreground_bound=262144 if cfg.get('unrestricted_usage_authorized') is True else 65536
 context_limit=min(262144,int(cfg.get('background_input_byte_limit',24000))) if cfg.get('_background') else min(foreground_bound,int(cfg['input_byte_limit']))
 if bound>context_limit:raise Blocked('school_context_too_large')
 # Keep an extra reasoning allowance until the model's exact accounting is known.
 held=bound+output+4096;now=time.time();day=int(now//86400)*86400
 DB.parent.mkdir(parents=True,exist_ok=True)
 with closing(sqlite3.connect(DB,timeout=3)) as db,db:
  db.execute('CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,model TEXT,scope TEXT,held INTEGER,actual INTEGER,created REAL,status TEXT)')
  db.execute('BEGIN IMMEDIATE')
  columns={x[1] for x in db.execute('PRAGMA table_info(calls)')}
  for name in ('held_micropoints','actual_micropoints'):
   if name not in columns:db.execute('ALTER TABLE calls ADD COLUMN '+name+' INTEGER')
  total,n=db.execute('SELECT coalesce(sum(coalesce(actual,held)),0),count(*) FROM calls').fetchone()
  daily,calls=db.execute('SELECT coalesce(sum(coalesce(actual,held)),0),count(*) FROM calls WHERE created>=?',(day,)).fetchone()
  rpm=db.execute('SELECT count(*) FROM calls WHERE created>?',(now-60,)).fetchone()[0]
  unrestricted=cfg.get('unrestricted_usage_authorized') is True
  if not unrestricted and (total+held>cfg['local_total_token_limit'] or daily+held>cfg['local_daily_token_limit']):raise Blocked('school_local_token_limit')
  if (not unrestricted and (n>=cfg['local_total_call_limit'] or calls>=cfg['local_daily_call_limit'])) or rpm>=cfg['local_rpm']:raise Blocked('school_local_rate_limit')
  points=None
  if cfg.get('billing_mode')=='school_points':
   # Micropoints use 1e6 units/point. Ignore cache discounts conservatively.
   points=round(bound*cfg['input_points_per_million']+(output+4096)*cfg['output_points_per_million'])
   used=db.execute('SELECT coalesce(sum(coalesce(actual_micropoints,held_micropoints)),0) FROM calls').fetchone()[0]
   today=db.execute('SELECT coalesce(sum(coalesce(actual_micropoints,held_micropoints)),0) FROM calls WHERE created>=?',(day,)).fetchone()[0]
   if not unrestricted and (used+points>int(cfg['local_total_points_limit']*1_000_000) or today+points>int(cfg['local_daily_points_limit']*1_000_000)):raise Blocked('school_local_points_limit')
  ident=uuid.uuid4().hex
  db.execute('INSERT INTO calls(id,model,scope,held,actual,created,status,held_micropoints) VALUES(?,?,?,?,NULL,?,?,?)',(ident,cfg['model'],cfg['_scope'],held,now,'reserved',points))
 return ident,held

def settle(ident,held,usage):
 values=[usage.get(k) for k in ('prompt_tokens','completion_tokens')]
 valid=all(isinstance(x,int) and not isinstance(x,bool) and x>=0 for x in values)
 actual=None
 if valid:
  total=usage.get('total_tokens',sum(values))
  if isinstance(total,int) and not isinstance(total,bool) and total>=sum(values):actual=total
 with closing(sqlite3.connect(DB)) as db,db:
  db.execute('UPDATE calls SET actual=?,status=? WHERE id=?',(actual,'usage_unavailable' if actual is None else 'complete' if actual<=held else 'estimate_exceeded',ident))
  cfg=settings()
  if actual is not None and cfg.get('billing_mode')=='school_points':
   cost=round(values[0]*cfg['input_points_per_million']+max(values[1],actual-values[0])*cfg['output_points_per_million'])
   db.execute('UPDATE calls SET actual_micropoints=? WHERE id=?',(cost,ident))
 if actual is not None and actual>held:raise Blocked('school_estimate_exceeded')

def content_only(value):
 if isinstance(value,list):value=''.join(x.get('text','') for x in value if isinstance(x,dict) and x.get('type')=='text' and isinstance(x.get('text'),str))
 if not isinstance(value,str):raise Blocked('school_invalid_content')
 # Strip embedded reasoning as well as the separate reasoning_content channel.
 value=re.sub(r'<think\b[^>]*>.*?</think\s*>','',value,flags=re.S|re.I)
 value=re.sub(r'<think\b[^>]*>.*$','',value,flags=re.S|re.I)
 if re.search(r'</think\s*>',value,re.I):value=re.split(r'</think\s*>',value,flags=re.I)[-1]
 value=value.strip()
 if not value:raise Blocked('school_no_final_answer')
 return value

def http_error(status,raw=b''):
 """Classify server refusal without returning credential-bearing error bodies."""
 try:
  payload=json.loads(raw[:32768]);err=payload.get('error') or payload
  message=' '.join(str(err.get(k,'')) for k in ('message','msg','code','type')) if isinstance(err,dict) else ''
 except Exception:message=''
 if status==403 and re.search(r'网络环境|network.*(?:support|allow|zone)|network_not',message,re.I):return 'school_network_policy_denied'
 if status==401:return 'school_authentication_failed'
 if status==402 or (status in (403,429) and re.search(r'积分不足|余额不足|额度不足|欠费|quota|insufficient|credit.*(?:exhaust|limit)',message,re.I)):return 'school_quota_exhausted'
 if status==403 and re.search(r'模型|model|permission',message,re.I):return 'school_model_permission_denied'
 if status==403:return 'school_forbidden'
 if status==429:return 'school_rate_limited'
 return 'school_http_'+str(status)

def parse_response(raw,content_type):
 if len(raw)>1_000_000:raise Blocked('school_response_too_large')
 if 'text/event-stream' in content_type:
  pieces=[];reasoning=[];usage={};last={};finished=False
  for line in raw.decode('utf-8').splitlines():
   if not line.startswith('data:'):continue
   data=line[5:].strip()
   if data=='[DONE]':finished=True;break
   p=json.loads(data);last=p
   if p.get('usage'):usage=p['usage']
   for choice in p.get('choices') or []:
    if choice.get('index',0)!=0:continue
    delta=choice.get('delta') or {}
    if isinstance(delta.get('content'),str):pieces.append(delta['content'])
    if isinstance(delta.get('reasoning_content'),str):reasoning.append(delta['reasoning_content'])
    if choice.get('finish_reason'):finished=True
  if not finished:raise Blocked('school_incomplete_stream')
  final={'role':'assistant','content':content_only(''.join(pieces))}
  if reasoning:final['reasoning_content']=''.join(reasoning)
  return {'id':last.get('id'),'model':last.get('model'),'choices':[{'index':0,'message':final,'finish_reason':'stop'}],'usage':usage}
 p=json.loads(raw)
 try:c=p['choices'][0];message=c['message']
 except (KeyError,IndexError,TypeError):raise Blocked('school_invalid_response') from None
 raw_content=message.get('content') if isinstance(message,dict) else None
 calls=message.get('tool_calls') if isinstance(message,dict) else None
 if calls:
  # A tool-call turn legitimately carries no user-facing text.
  final={'role':'assistant','content':content_only(raw_content) if raw_content else ''}
  if isinstance(message.get('reasoning_content'),str):final['reasoning_content']=message['reasoning_content']
  final['tool_calls']=[{'id':x.get('id'),'type':'function','function':{'name':(x.get('function') or {}).get('name'),'arguments':(x.get('function') or {}).get('arguments','{}')}} for x in calls if isinstance(x,dict)]
  return {'id':p.get('id'),'model':p.get('model'),'choices':[{'index':0,'message':final,'finish_reason':c.get('finish_reason','tool_calls')}],'usage':p.get('usage') or {}}
 # This deployment is a reasoning model: when max_tokens is exhausted by
 # reasoning, content is null while reasoning is present. Report it as such
 # instead of a generic content error.
 if (raw_content is None or raw_content=='') and isinstance(message,dict) and (message.get('reasoning') or message.get('reasoning_content')):
  raise Blocked('school_reasoning_exhausted')
 answer=content_only(raw_content)
 final={'role':'assistant','content':answer}
 if isinstance(message.get('reasoning_content'),str):final['reasoning_content']=message['reasoning_content']
 return {'id':p.get('id'),'model':p.get('model'),'choices':[{'index':0,'message':final,'finish_reason':c.get('finish_reason','stop')}],'usage':p.get('usage') or {}}

async def models():
 cfg=settings();base=endpoint(cfg);key=credential()
 try:
  async with httpx.AsyncClient(trust_env=False,proxy=cfg.get('proxy_url'),timeout=8,follow_redirects=False) as client:
   r=await client.get(base+'/models',headers={'Authorization':'Bearer '+key})
  if r.status_code!=200:raise Blocked(http_error(r.status_code,r.content))
  p=r.json()
  # Only public model metadata, never arbitrary error bodies or account secrets.
  return [{k:x[k] for k in ('id','root','parent','owned_by','context_length','max_model_len','max_output_tokens') if k in x} for x in p.get('data',[]) if isinstance(x,dict)]
 except Blocked:raise
 except Exception as e:raise Blocked('school_'+type(e).__name__) from None

def _text_content(value):
 if isinstance(value,str):return value
 if isinstance(value,list) and all(isinstance(b,dict) and b.get('type')=='text' and isinstance(b.get('text'),str) for b in value):return '\n'.join(b['text'] for b in value)
 raise Blocked('school_text_messages_only')

def _clean_message(m):
 """Keep only OpenAI chat fields; tool loops need tool_calls and tool results."""
 role=m.get('role')
 if role in {'system','developer','user'}:
  return {'role':'system' if role=='developer' else role,'content':_text_content(m.get('content'))}
 if role=='assistant':
  content=_text_content(m.get('content')) if m.get('content') is not None else None
  calls=m.get('tool_calls')
  if not isinstance(content,(str,type(None))) or (not isinstance(content,str) and not calls):raise Blocked('school_text_messages_only')
  out={'role':'assistant','content':content if isinstance(content,str) else ''}
  if isinstance(m.get('reasoning_content'),str):out['reasoning_content']=m['reasoning_content']
  if calls:
   out['tool_calls']=[{'id':c.get('id'),'type':'function','function':{'name':c['function']['name'],'arguments':c['function'].get('arguments','{}')}} for c in calls if isinstance(c,dict) and isinstance(c.get('function'),dict) and c['function'].get('name')]
   if not out['tool_calls']:raise Blocked('school_text_messages_only')
  return out
 if role=='tool':
  if not m.get('tool_call_id'):raise Blocked('school_text_messages_only')
  out={'role':'tool','content':_text_content(m.get('content')),'tool_call_id':m['tool_call_id']}
  if isinstance(m.get('name'),str):out['name']=m['name']
  return out
 raise Blocked('school_text_messages_only')

async def generate(messages,*,output_limit=1024,scope='qq',tools=None,tool_choice=None,deadline=None,background=False):
 global _cooldown_until
 cfg=settings();verify(cfg,scope);key=credential()
 if time.monotonic()<_cooldown_until:raise Blocked('school_circuit_open')
 cleaned=[_clean_message(m) for m in messages] if messages else []
 if not cleaned:raise Blocked('school_text_messages_only')
 background_acquired=False
 if background:
  try:await asyncio.wait_for(_background_slot.acquire(),.25);background_acquired=True
  except TimeoutError:raise Blocked('school_background_busy') from None
 try:await asyncio.wait_for(_slot.acquire(),.25)
 except (TimeoutError,asyncio.CancelledError) as e:
  if background_acquired:_background_slot.release()
  if isinstance(e,asyncio.CancelledError):raise
  raise Blocked('school_busy') from None
 try:
  output,wait=call_limits(cfg,output_limit,deadline,background)
  cfg['_scope']=scope;cfg['_background']=background;ident,held=reserve(cfg,cleaned,output,tools)
  # No provider-specific Qwen fields or forced reasoning toggle.
  request={'model':cfg['model'],'messages':cleaned,'stream':False,'max_tokens':output,'temperature':min(1,max(0,float(cfg.get('temperature',.7))))}
  if tools:
   request['tools']=tools
   if tool_choice:request['tool_choice']=tool_choice
  try:
   async with asyncio.timeout(wait),httpx.AsyncClient(trust_env=False,proxy=cfg.get('proxy_url'),follow_redirects=False,timeout=wait) as client:
    async with client.stream('POST',endpoint(cfg)+'/chat/completions',json=request,headers={'Authorization':'Bearer '+key}) as r:
     chunks=[];size=0
     async for chunk in r.aiter_bytes():
      size+=len(chunk)
      if size>1_000_000:raise Blocked('school_response_too_large')
      chunks.append(chunk)
     if r.status_code!=200:raise Blocked(http_error(r.status_code,b''.join(chunks)))
     raw=b''.join(chunks)
     try:payload=parse_response(raw,r.headers.get('content-type',''))
     except Blocked as failure:
      if failure.code=='school_reasoning_exhausted' and 'text/event-stream' not in r.headers.get('content-type',''):
       try:usage=json.loads(raw).get('usage') or {}
       except (ValueError,AttributeError):usage={}
       settle(ident,held,usage)
      raise
   settle(ident,held,payload['usage'])
   # Keep the upstream-reported name for evidence; routing label stays authoritative.
   payload['reported_model']=payload.get('model');payload['model']=cfg['model']
   return payload,ROUTE
  except asyncio.CancelledError:
   # A cancelled request says nothing about the health of another, shorter request.
   raise
  except Exception as e:
   code=e.code if isinstance(e,Blocked) else 'school_'+type(e).__name__
   # A content-shape problem means the endpoint answered; it must not trip the
   # transport breaker or block the next, differently-budgeted attempt.
   if code not in {'school_reasoning_exhausted','school_invalid_response',
                   'school_no_final_answer','school_invalid_content','school_text_messages_only',
                   'school_busy','school_context_too_large','school_estimate_exceeded'} and not (background and code=='school_TimeoutError'):
    _cooldown_until=time.monotonic()+120
   raise Blocked(code) from None
 finally:
  _slot.release()
  if background_acquired:_background_slot.release()
