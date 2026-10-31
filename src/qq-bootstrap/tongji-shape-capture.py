"""Structure-only capture of one synthetic chat response.

Records the JSON skeleton and short type markers. Never prints the key or the
Authorization header. Content preview is limited to this synthetic sentence.
"""
import asyncio,json,time
from pathlib import Path
import httpx
import tongji_provider as school

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'cloud-investigation/tongji-live-20261027/response-shape.json'


def shape(value,depth=0):
 if depth>4:return type(value).__name__
 if isinstance(value,dict):return {k:shape(v,depth+1) for k,v in value.items()}
 if isinstance(value,list):return [shape(value[0],depth+1)] if value else []
 if isinstance(value,str):return 'str:'+value[:120].replace('\n',' ')+('' if len(value)<=120 else '...')
 return type(value).__name__+':'+str(value)[:40]


async def main():
 cfg=school.settings();key=school.credential()
 body={'model':cfg['model'],'messages':[{'role':'user','content':'只回答两个字：收到'}],
       'stream':False,'max_tokens':32,'temperature':0.7}
 out={'checked_at':time.time(),'endpoint':school.BASE+'/chat/completions','model':cfg['model'],
      'synthetic_only':True,'max_tokens':32,'attempts':1}
 try:
  async with httpx.AsyncClient(trust_env=False,timeout=20,follow_redirects=False) as c:
   r=await c.post(school.BASE+'/chat/completions',json=body,headers={'Authorization':'Bearer '+key})
  out['status']=r.status_code
  out['content_type']=r.headers.get('content-type','')
  out['safe_headers']={k:v for k,v in r.headers.items() if k.lower().startswith('x-') and 'key' not in k.lower()}
  raw=r.content[:20000]
  try:
   payload=json.loads(raw)
   out['shape']=shape(payload)
  except Exception:
   out['shape']='non_json';out['body_preview']=raw[:300].decode('utf-8','replace')
 except Exception as e:out['error_type']=type(e).__name__
 OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(out,ensure_ascii=False)[:3000])
 return 0

if __name__=='__main__':raise SystemExit(asyncio.run(main()))
