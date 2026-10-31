"""One bounded synthetic live call to the school endpoint.

No private data, no QQ record, no group identity. Output is capped so a single
call cannot consume meaningful quota. The key is never printed.
"""
import asyncio,json,sqlite3,time
from contextlib import closing
from pathlib import Path
import tongji_provider as school

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'cloud-investigation/tongji-live-20261027/synthetic-live-probe.json'
MESSAGES=[{'role':'system','content':'你是接口连通性测试对象。只回答一句中文，不要展开。'},
          {'role':'user','content':'用一句话回答：二加二等于几？并说明你是哪个模型。'}]


def ledger(ident):
 with closing(sqlite3.connect(school.DB)) as db,db:
  row=db.execute('SELECT held,actual,held_micropoints,actual_micropoints,status FROM calls WHERE id=?',(ident,)).fetchone()
 return None if not row else {'held_tokens':row[0],'actual_tokens':row[1],'held_micropoints':row[2],'actual_micropoints':row[3],'status':row[4]}


async def main():
 cfg=school.settings()
 out={'checked_at':time.time(),'base_url':cfg['base_url'],'model_configured':cfg.get('model'),
      'scope':'synthetic','synthetic_only':True,'qq_sends':0,'max_output':400,'attempts':1}
 tick=time.monotonic()
 try:
  payload,route=await school.generate(MESSAGES,output_limit=400,scope='synthetic')
  out.update(ok=True,route=route,reported_model=payload.get('reported_model'),
             answer=payload['choices'][0]['message']['content'],
             finish_reason=payload['choices'][0].get('finish_reason'),
             usage=payload.get('usage'),seconds=round(time.monotonic()-tick,3))
  with closing(sqlite3.connect(school.DB)) as db,db:
   ident=db.execute('SELECT id FROM calls ORDER BY created DESC LIMIT 1').fetchone()[0]
  out['ledger']=ledger(ident)
  answer=out['answer']
  out['checks']={'has_visible_answer':bool(answer.strip()),'no_think_tag':'<think' not in answer.lower(),
                 'no_reasoning_leak':'reasoning_content' not in json.dumps(payload,ensure_ascii=False),
                 'upstream_model_reported':bool(out['reported_model'])}
 except school.Blocked as e:
  out.update(ok=False,error=e.code,seconds=round(time.monotonic()-tick,3))
 except Exception as e:
  out.update(ok=False,error=type(e).__name__,seconds=round(time.monotonic()-tick,3))
 OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
 printable={k:v for k,v in out.items() if k!='answer'}
 print(json.dumps(printable,ensure_ascii=False))
 return 0 if out.get('ok') else 2

if __name__=='__main__':raise SystemExit(asyncio.run(main()))
