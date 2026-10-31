"""One bounded, synthetic-only comparison: school DeepSeek vs current Qwen.

Three identical short prompts per provider, single batch, no private QQ data,
no group identity, no outbound QQ message. Prints answers for human review only.
"""
import asyncio,json,time
from pathlib import Path
import httpx
import tongji_provider as school

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'cloud-investigation/tongji-live-20261027/model-comparison.json'
STATE=json.loads((ROOT/'private/cloud-runtime.json').read_text(encoding='utf-8-sig'))
PROMPTS=[
 ('group-chat','你在一个普通技术群里。群友刚说“今天又加班到十点”，用一句自然的群友口吻接话，不超过30字。'),
 ('wordplay','有人先说“导管”，我接成“道馆”。我回一句“我每天都去那个道馆”，你接一句能接住这个双关的话，不超过25字。'),
 ('tool-json','只输出一行JSON，不要解释：{"tool":"commit","kind":"signature","content":"此路未尽"}'),
]


async def qwen(messages):
 tick=time.monotonic()
 async with httpx.AsyncClient(trust_env=False,timeout=30) as c:
  r=await c.post('http://127.0.0.1:11435/api/chat',headers={'Authorization':'Bearer '+STATE['gateway_token']},
                 json={'model':'fangyuan-cloud','stream':False,'think':False,'messages':messages})
  r.raise_for_status();p=r.json()
 return {'answer':p.get('message',{}).get('content',''),'model':p.get('model'),'route':p.get('character_route'),
         'seconds':round(time.monotonic()-tick,3),
         'usage':{'prompt_tokens':p.get('prompt_eval_count'),'completion_tokens':p.get('eval_count')}}


async def main():
 rows=[]
 for name,text in PROMPTS:
  messages=[{'role':'user','content':text}]
  row={'case':name}
  tick=time.monotonic()
  try:
   payload,route=await school.generate(messages,output_limit=600,scope='synthetic')
   usage=payload.get('usage') or {}
   row['school']={'ok':True,'answer':payload['choices'][0]['message']['content'],'reported_model':payload.get('reported_model'),
                  'seconds':round(time.monotonic()-tick,3),'usage':{k:usage.get(k) for k in ('prompt_tokens','completion_tokens','total_tokens')},
                  'reasoning_tokens':(usage.get('completion_tokens_details') or {}).get('reasoning_tokens')}
  except school.Blocked as e:row['school']={'ok':False,'error':e.code}
  try:row['qwen']={'ok':True,**await qwen(messages)}
  except Exception as e:row['qwen']={'ok':False,'error':type(e).__name__}
  rows.append(row);print(json.dumps({k:(v if k=='case' else {kk:vv for kk,vv in v.items() if kk!='answer'}) for k,v in row.items()},ensure_ascii=False),flush=True)
  await asyncio.sleep(6)
 OUT.write_text(json.dumps({'checked_at':time.time(),'synthetic_only':True,'qq_sends':0,
                            'same_prompts':True,'prompts':[p[1] for p in PROMPTS],'rows':rows},ensure_ascii=False,indent=2),encoding='utf-8')
 return 0

if __name__=='__main__':raise SystemExit(asyncio.run(main()))
