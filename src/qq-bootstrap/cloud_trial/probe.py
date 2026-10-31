"""Isolated, fail-closed Model Studio evaluation. Never imports a QQ sender.

Default action is an offline plan. Live calls require a separately approved receipt,
verified free-tier-only controls, and a DPAPI key supplied locally by the user.
"""
import argparse, asyncio, ctypes, hashlib, json, math, sqlite3, sys, time, uuid
from contextlib import closing
from pathlib import Path
import httpx

ROOT=Path(__file__).resolve().parents[3]
WORK=ROOT/'work/cloud-investigation'
MODELS={'qwen3.8-flash':(.8,2.7),'qwen3.8-2.4t-a95b':(12,36)}
BASE='https://ws-q0n1iz1i6a4vek1y.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
CAP_MICRO=4_500_000
MAX_CALLS=72
MAX_INPUT_BOUND=6000
MAX_OUTPUT=2048

class Blocked(RuntimeError): pass

def cost_micro(model,input_tokens,output_tokens):
 if model not in MODELS:raise Blocked('模型不在试验白名单')
 a,b=MODELS[model]
 return math.ceil(input_tokens*a+output_tokens*b)

def bounded_request(model,messages,seed):
 if not messages or any(m.get('role') not in {'system','user','assistant'} or not isinstance(m.get('content'),str) for m in messages):
  raise Blocked('仅接受已冻结的纯文本上下文')
 # Deliberately conservative estimate; not presented as a provider tokenizer count.
 bound=sum(len(m['content'].encode('utf-8'))+64 for m in messages)+128
 if bound>MAX_INPUT_BOUND:raise Blocked('上下文超出保守输入预算；保留原文并停止，不自动截断证据')
 request=dict(model=model,messages=messages,temperature=.6,top_p=.95,seed=seed,max_tokens=MAX_OUTPUT,
              stream=False,enable_thinking=(model=='qwen3.8-2.4t-a95b'),enable_search=False)
 if model=='qwen3.8-2.4t-a95b':request['thinking_budget']=512
 return request,bound

class Ledger:
 def __init__(self,path):
  self.path=Path(path)
  with closing(sqlite3.connect(self.path)) as db,db:
   db.execute('CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,model TEXT,held INTEGER,actual INTEGER,status TEXT,created REAL)')
 def reserve(self,model,bound):
  amount=cost_micro(model,bound,MAX_OUTPUT)
  with closing(sqlite3.connect(self.path)) as db,db:
   db.execute('BEGIN IMMEDIATE')
   count,used=db.execute('SELECT count(*),coalesce(sum(coalesce(actual,held)),0) FROM calls').fetchone()
   if count>=MAX_CALLS or used+amount>CAP_MICRO:raise Blocked('达到本地试验次数或4.5元保守预算')
   ident=str(uuid.uuid4());db.execute('INSERT INTO calls VALUES(?,?,?,NULL,?,?)',(ident,model,amount,'reserved',time.time()))
  return ident,amount
 def settle(self,ident,model,usage):
  prompt=usage.get('prompt_tokens');completion=usage.get('completion_tokens')
  if not isinstance(prompt,int) or not isinstance(completion,int) or min(prompt,completion)<0:
   return None  # No usage, timeout, or uncertain billing: retain the full reservation.
  actual=cost_micro(model,prompt,completion)
  with closing(sqlite3.connect(self.path)) as db,db:
   held=db.execute('SELECT held FROM calls WHERE id=?',(ident,)).fetchone()[0]
   db.execute('UPDATE calls SET actual=?,status=? WHERE id=?',(actual,'completed' if actual<=held else 'estimate_exceeded',ident))
  if actual>held:raise Blocked('实际用量超出保守预留；停止后续调用并人工核查')
  return actual
 def summary(self):
  with closing(sqlite3.connect(self.path)) as db:
   return db.execute('SELECT count(*),coalesce(sum(coalesce(actual,held)),0) FROM calls').fetchone()

def authorize(path,model):
 if not path.exists():raise Blocked('尚无用户授权及免费额度保护核验记录')
 data=json.loads(path.read_text(encoding='utf-8'))
 if not data.get('user_authorized_free_only_trial') or not data.get('free_tier_only_verified',{}).get(model):
  raise Blocked('未授权，或该模型的免费额度用完即停尚未核验')
 if data.get('cash_spend_authorized_cny')!=0 or data.get('region')!='cn-beijing':raise Blocked('本轮只允许北京地域免费试验')
 if time.time()>data.get('expires_unix',0):raise Blocked('授权核验记录已过期，需重新读取额度和保护状态')
 if data.get('max_calls')!=MAX_CALLS or data.get('gross_cost_cap_cny')!=4.5:raise Blocked('授权预算与已审阅试验方案不一致')
 return data

def unprotect(path):
 class Blob(ctypes.Structure):
  _fields_=[('size',ctypes.c_ulong),('data',ctypes.POINTER(ctypes.c_ubyte))]
 encrypted=path.read_bytes();buf=(ctypes.c_ubyte*len(encrypted)).from_buffer_copy(encrypted)
 src=Blob(len(encrypted),buf);dest=Blob()
 if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(src),None,None,None,None,1,ctypes.byref(dest)):
  raise Blocked('密钥不能由当前Windows账号解密')
 try:return ctypes.string_at(dest.data,dest.size).decode('utf-8')
 finally:
  ctypes.memset(dest.data,0,dest.size)
  ctypes.windll.kernel32.LocalFree.argtypes=[ctypes.c_void_p]
  ctypes.windll.kernel32.LocalFree(dest.data)

async def invoke(client,ledger,model,messages,seed,receipt,key):
 authorize(receipt,model)
 req,bound=bounded_request(model,messages,seed)
 ident,held=ledger.reserve(model,bound)
 tick=time.perf_counter()
 # No retry, no redirects, no fallback to a paid provider or another cloud model.
 try:
  response=await client.post(BASE+'/chat/completions',json=req,headers={'Authorization':'Bearer '+key})
  if response.status_code!=200:
   # Do not log response bodies or arbitrary exception strings: they can contain credentials.
   return dict(ok=False,status=response.status_code,error='provider_http_error',reservation_micro_cny=held,id=ident,seconds=time.perf_counter()-tick)
  payload=response.json();usage=payload.get('usage') or {}
  actual=ledger.settle(ident,model,usage)
  if actual is None:return dict(ok=False,id=ident,error='missing_usage',reservation_micro_cny=held,seconds=time.perf_counter()-tick)
  return dict(ok=True,id=ident,model=model,answer=payload['choices'][0]['message'].get('content',''),
              usage=usage,cost_estimate_micro_cny=actual,reservation_micro_cny=held,
              finish_reason=payload['choices'][0].get('finish_reason'),seconds=time.perf_counter()-tick)
 except Blocked:raise
 except Exception as exc:
  return dict(ok=False,id=ident,error=type(exc).__name__,reservation_micro_cny=held,seconds=time.perf_counter()-tick)

def plan():
 return dict(live_calls=0,models=MODELS,max_calls=MAX_CALLS,max_output_tokens=MAX_OUTPUT,
             maximum_input_bound=MAX_INPUT_BOUND,local_gross_budget_cny=4.5,cash_authorization_cny=0,
             theoretical_full_batch_gross_cny=sum(cost_micro(m,MAX_INPUT_BOUND,MAX_OUTPUT)*36 for m in MODELS)/1_000_000,
             requirements=['用户确认仅免费试验','逐模型核实剩余额度与到期时间','逐模型开启用完即停并核验生效','本地输入专用API Key，以Windows DPAPI保存','只做隔离评测，暂不切换QQ正式服务'])

async def main():
 p=argparse.ArgumentParser();p.add_argument('--run',action='store_true');p.add_argument('--dataset',type=Path,default=WORK/'trial-dataset.json');args=p.parse_args()
 if not args.run:
  print('方源云端试验预览：尚未接入，也不会调用模型。')
  print('候选：Qwen3.8-Flash（日常）与 Qwen3.8-2.4T-A95B（原著讨论）。')
  print('计划：18道题，每种模型各做两遍，最多72次。')
  print('只准使用已核实的免费额度；现金支出授权：0元。')
  print('本地按标价记账，预算4.5元；按最大输入预留，整批约3.48元。')
  print('尚待确认开启免费额度用完即停，再在本机输入专用密钥。')
  print('现有QQ模型、资料库和记忆保持当前状态。')
  return
 receipt=WORK/'approved-free-trial.json'
 for model in MODELS:authorize(receipt,model)
 dataset=json.loads(args.dataset.read_text(encoding='utf-8'))
 key_path=ROOT/'work/private/bailian-trial-key.dpapi'
 key=unprotect(key_path)
 ledger=Ledger(WORK/'trial-ledger.sqlite3')
 results_path=WORK/'cloud-raw-results.jsonl'
 previous=[json.loads(s) for s in results_path.read_text(encoding='utf-8').splitlines()] if results_path.exists() else []
 if any(not r.get('ok') for r in previous):raise Blocked('已有未解决调用错误；保留费用预留，先核查再继续')
 completed={(r.get('model'),r.get('seed'),r.get('case_id')) for r in previous if r.get('ok')}
 async with httpx.AsyncClient(trust_env=False,follow_redirects=False,timeout=18) as client:
  for model in MODELS:
   for seed in (41,42):
    for case in dataset:
     if (model,seed,case['id']) in completed:continue
     result=await invoke(client,ledger,model,case['messages'],seed,receipt,key)
     result.update(case_id=case['id'],seed=seed)
     with (WORK/'cloud-raw-results.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(result,ensure_ascii=False)+'\n')
     print(json.dumps({k:result.get(k) for k in ['case_id','seed','ok','seconds','status']},ensure_ascii=False),flush=True)
     if not result['ok']:raise Blocked('首次云端错误即停止，保留预留费用，不反复重试')

if __name__=='__main__':
 try:asyncio.run(main())
 except Blocked as exc:print(str(exc),file=sys.stderr);sys.exit(2)
