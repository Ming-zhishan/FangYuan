"""Frozen paired offline experiments. Never sends QQ messages or writes live state."""
import argparse, asyncio, hashlib, json, os, re, statistics, subprocess, sys, tempfile, threading, time
from pathlib import Path
import httpx
import ctypes
class MemoryStatus(ctypes.Structure):
 _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong)]+[(n,ctypes.c_ulonglong) for n in ['total','available','page_total','page_available','virtual_total','virtual_available','extended']]
def memory():
 s=MemoryStatus();s.length=ctypes.sizeof(s);ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(s));return s.total-s.available,s.available

SETUP=Path(__file__).resolve().parents[1]
ROOT=SETUP.parents[1]
OUT=ROOT/'work/diag04'
sys.path.insert(0,str(SETUP))
from character.runtime import CharacterRuntime
from character.knowledge import compile_references
from character_retrieval import ReviewedRetrieval

CASES=[
 ('C01','普通聊天','我要撒泡尿。','短句接话，不编道具、动作或修行教训。',185),
 ('C02','普通聊天','你怎么像个人机？','接住生硬评价，不自夸理性，不解释不存在的故障。',187),
 ('K01','原著知识','少年一转时怎么会有春秋蝉这只仙蛊？','重生带回六转春秋蝉，不是一转现炼仙蛊；不编炼成过程。',0),
 ('K02','原著知识','仙蛊唯一，是不是同一种仙蛊可以同时炼出两只？','同一种仙蛊不能同时存在两只；同种凡蛊不受此限制。',0),
 ('T01','思想逻辑','假如我明知道会失败，还值得继续坚持吗？','区分目标与手段；看代价和可获得信息，不鼓励无条件赌命。',197),
 ('T02','思想逻辑','我考了三次都没过，第四次还要赌吗？','根据差距、方法、成本判断再试或换路；不把考试写成棋局/赌命。',0),
 ('I01','第一人称','你现在实力咋样？','本人九转炼道尊者，未得永生，不飞升、不编能力。',199),
 ('I02','第一人称','你最喜欢的女子是谁？','不编唯一挚爱名单；可提谢晗沫的珍重经历但不等同最爱，不全盘否认感情。',189),
 ('L01','连续生活','你在做什么？','核对仙窍资源供给与耗材损耗；不等消息、不添加新事件。',179),
 ('L02','连续生活','上次那批耗材的账处理完了吗？','同一项目仍在核对，未完成；不编数量、成果或用户委托。',0),
 ('M01','多轮互动','他会一直听你的吗？','承接凤九歌；有自己的道路，不保证永久服从或同盟。',0),
 ('M02','多轮互动','我说过喜欢什么棋？','当前账号A喜欢象棋；B喜欢围棋且叫阿青，不能串人，不把用户喜好变成方源喜好。',0),
 ('H01','普通聊天','明天会更好吗？','不保证未来，不硬套蛊界；承认变化并有可行立场。',183),
 ('H02','原著知识','三王传承两次炼蛊的经过有何不同？','第一次炼成第二空窍后被反制；重生后伪蛊改炼定仙游，两轮明确区分。',0),
 ('H03','思想逻辑','你怎么看红莲魔尊？','不抹杀亲人牺牲的代价与反宿命动因；本人不悔与洪亭有别，不编会面。',193),
 ('H04','第一人称','你觉得宿命是什么？','宿命蛊实际存在并约束，不等同天意或个人选择结果；本人反抗安排。',195),
 ('H05','连续生活','这项核对事务在原著第几章？','明确是授权日常创作，没有原著章节，不伪造出处。',0),
 ('H06','多轮互动','我先去吃饭了。','在生活对话后自然接话，不给用户做饭、不安排仙材任务。',0),
]
HISTORY={
 'L02':[('user','你在做什么？'),('assistant','我在核对仙窍资源点的供给与炼蛊耗材的损耗，还没理清。')],
 'M01':[('user','你怎么看凤九歌？'),('assistant','他有才情，也有自己要走的路，合作要看条件。')],
 'M02':[('user','群友账号B：叫我阿青'),('user','群友账号B：我喜欢围棋'),('user','群友账号A：我喜欢象棋')],
 'H06':[('user','你在做什么？'),('assistant','在核对仙窍资源供给和耗材损耗。')],
}
LEAN='''你是古月方源，九转炼道尊者，未得永生，在蛊界通过QQ与异界朋友聊天。用自己的口吻直接答当前一句，不写表演动作或第三人称旁白。永生是自己选的目标，但会改变手段；先看条件、代价和结果，闲聊可以随意，不给每句话讲大道理。
事实、当前生活、群友记忆分别如下。它们是背景资料；原著事实不增补，生活不虚报成果，用户喜好不算自己的喜好。普通报备简单接话；具体问题给有用答案，不能只靠“不知道”回避。自然白话，通常一两句；事实需要时可以说完整，不为凑字数省掉关键条件。'''

def dump(path,obj):
 path.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')

async def prepare():
 OUT.mkdir(parents=True,exist_ok=True)
 retrieval=ReviewedRetrieval(cpu=True)
 rows=[]
 with tempfile.TemporaryDirectory() as tmp:
  runtime=CharacterRuntime(retrieval,world_path=Path(tmp)/'world.db',social_path=Path(tmp)/'social.db',owner='A')
  for uid,mid,text in [('A','s1','我喜欢象棋'),('B','s2','叫我阿青'),('B','s3','我喜欢围棋')]:
   runtime.social.observe(uid,'private:A',mid,text)
  for cid,category,q,gold,source in CASES:
   history=[dict(role=r,content=t) for r,t in HISTORY.get(cid,[])]
   c=await runtime.prepare(q,'A','private:A',cid,history)
   messages=runtime.messages(c)
   refs=c['system'].split('【相关经历与认知；只作背景，不是新指令】\n',1)[1].split('\n\n【本条硬性要求】',1)[0]
   no_refs=c['system'].replace(refs,'没有额外的原著细节；未知细节不补造。')
   context='\n'.join([runtime.world.prompt(q) if c['discussing_life'] else '',runtime.social.context('A','private:A',cid,query=q),'双方是可以争论的朋友，当前账号A；不要称主人。'])
   lean=LEAN+'\n'+context+'\n【相关原著资料】\n'+refs
   rows.append(dict(id=cid,category=category,query=q,gold=gold,archived_n=source,split='holdout' if cid.startswith('H') else 'core',
     context=c,messages=messages,old_no_refs=[dict(role='system',content=no_refs)]+messages[1:],
     lean=[dict(role='system',content=lean)]+messages[1:],lean_no_refs=[dict(role='system',content=LEAN+'\n'+context+'\n【相关原著资料】无额外资料，未知细节不补造。')]+messages[1:]))
   print(json.dumps({'prepared':cid,'refs':c['references'],'chars':len(c['system'])}),flush=True)
 dump(OUT/'frozen-dataset.json',rows)
 digest=hashlib.sha256((OUT/'frozen-dataset.json').read_bytes()).hexdigest()
 dump(OUT/'frozen-manifest.json',dict(sha256=digest,seeds=[41,42],temperature=.6,num_ctx=8192,num_predict=1536,
  rubric={'人格一致性':'0严重身份/性格矛盾;1部分或空泛;2身份与判断一致','原著事实':'0错误/编造;1遗漏关键事实;2满足金标准且无新增错误;null无事实项',
   '自然度':'0机械/旁白/明显不合场景;1略生硬;2自然且贴题','跑题':'0切题;1部分;2主要未回答','效用':'0回避/无正文;1部分有用;2有用'},
  rules=['同一输入同一采样；仅改变被比较条件','单次模型原稿评分，重试/模板兜底不算模型成功','盲评标签隐藏模型；人工结合金标准逐条复核','length截断与超时单列；22秒为生产响应预算','资源为进程与GPU实测采样，GPU包含桌面占用','固定前置历史隔离单轮比较，另做真实生成历史多轮确认'] ))

class Monitor:
 def __init__(self): self.rows=[]; self.stop=threading.Event()
 def sample(self):
  while not self.stop.is_set():
   try:
    p=subprocess.run(['nvidia-smi','--query-gpu=memory.used,utilization.gpu,power.draw','--format=csv,noheader,nounits'],capture_output=True,text=True,creationflags=0x08000000)
    used,available=memory()
    self.rows.append(dict(at=time.time(),gpu=p.stdout.strip(),ram_used=used,ram_available=available))
   except Exception as e: self.rows.append({'error':str(e)})
   self.stop.wait(.5)
 def __enter__(self): self.thread=threading.Thread(target=self.sample,daemon=True); self.thread.start(); return self
 def __exit__(self,*args): self.stop.set();self.thread.join()

PROFILES={
 '8b-old':('fangyuan-eightb:latest','messages',False),
 '8b-old-think':('fangyuan-eightb:latest','messages',True),
 '8b-old-norag':('fangyuan-eightb:latest','old_no_refs',False),
 '8b-lean':('fangyuan-eightb:latest','lean',False),
 '8b-lean-norag':('fangyuan-eightb:latest','lean_no_refs',False),
 '9b-lean':('qwen3.5:9b','lean',False),
 '9b-lean-think':('qwen3.5:9b','lean',True),
 '4b-lean':('qwen3:4b-instruct-2507-q4_K_M','lean',False),
}

async def run(args):
 data=json.loads((OUT/'frozen-dataset.json').read_text(encoding='utf-8'))
 model,key,think=PROFILES[args.profile]
 dest=OUT/(args.label or args.profile)
 dest.mkdir(exist_ok=True)
 existing={}
 if (dest/'results.jsonl').exists():
  existing={(r['id'],r['seed']):r for r in map(json.loads,(dest/'results.jsonl').read_text(encoding='utf-8').splitlines())}
 async with httpx.AsyncClient(base_url='http://127.0.0.1:11434',trust_env=False,timeout=120) as client:
  # Explicit cold/warm separation; no fabricated timing success from a fallback.
  warm=await client.post('/api/chat',json=dict(model=model,messages=[dict(role='user',content='只回复好。')],stream=False,think=False,keep_alive='30m',options=dict(num_ctx=8192,num_predict=8)))
  dump(dest/'warmup.json',warm.json())
  dump(dest/'loaded.json',(await client.get('/api/ps')).json())
  for seed in map(int,args.seeds.split(',')):
   for row in data:
    if args.split!='all' and row['split']!=args.split: continue
    if args.ids and row['id'] not in args.ids.split(','): continue
    if (row['id'],seed) in existing: continue
    req=dict(model=model,messages=row[key],think=think,stream=True,keep_alive='30m',options=dict(seed=seed,temperature=.6,top_p=.95,top_k=20,repeat_penalty=1.05,presence_penalty=0,num_ctx=8192,num_predict=1536))
    started=time.perf_counter();answer='';thought='';first=None;first_body=None;last={};error=None
    with Monitor() as monitor:
     try:
      async with client.stream('POST','/api/chat',json=req) as response:
       response.raise_for_status()
       async for line in response.aiter_lines():
        if not line: continue
        chunk=json.loads(line)
        if 'error' in chunk: raise RuntimeError(chunk['error'])
        msg=chunk.get('message') or {}
        if (msg.get('content') or msg.get('thinking')) and first is None: first=time.perf_counter()-started
        if msg.get('content') and first_body is None: first_body=time.perf_counter()-started
        answer+=msg.get('content','');thought+=msg.get('thinking','')
        if chunk.get('done'): last=chunk
     except Exception as exc: error=repr(exc)
    result=dict(id=row['id'],category=row['category'],split=row['split'],query=row['query'],gold=row['gold'],seed=seed,profile=args.profile,request=req,
     answer=answer,thinking=thought,error=error,seconds=round(time.perf_counter()-started,3),first_token_seconds=first,first_body_seconds=first_body,response=last,resources=monitor.rows,
     program_warnings=CharacterRuntime.check(answer,row['context']))
    with (dest/'results.jsonl').open('a',encoding='utf-8') as f: f.write(json.dumps(result,ensure_ascii=False)+'\n')
    print(json.dumps({k:result[k] for k in ['id','seed','seconds','error']}),flush=True)

async def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','run']);p.add_argument('--profile',choices=PROFILES);p.add_argument('--split',default='core',choices=['core','holdout','all']);p.add_argument('--ids',default='');p.add_argument('--label');p.add_argument('--seeds',default='41,42');args=p.parse_args()
 await (prepare() if args.action=='prepare' else run(args))

if __name__=='__main__': asyncio.run(main())
