"""Read-only account quota probe for the Tongji platform.

No inference call, no write, no key or Authorization header is ever printed.
A 403/404 here only means "this read path is unavailable"; it is not a balance.
"""
import asyncio,json,time
from pathlib import Path
import httpx
import tongji_provider as school

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'cloud-investigation/tongji-live-20261027/quota-readonly.json'
SAFE=('total_usage','total_granted','hard_limit_usd','soft_limit_usd','object','balance','quota','used_quota','expires_at','plan_name','plan_type','status','expired_time')


async def probe(client,path):
 item={'path':path,'method':'GET'}
 try:
  r=await client.get(school.BASE.rsplit('/v1',1)[0]+path,headers={'Authorization':'Bearer '+school.credential()})
  item['status']=r.status_code;item['content_type']=r.headers.get('content-type','')
  try:
   payload=r.json()
  except Exception:
   item['body']='non_json';return item
  if isinstance(payload,dict):
   item['fields']={k:payload[k] for k in SAFE if k in payload}
   err=payload.get('error')
   if isinstance(err,dict):item['error_code']=err.get('code');item['error_message']=str(err.get('message',''))[:120]
   if 'message' in payload and 'fields' not in item:item['message']=str(payload['message'])[:120]
  else:item['body_type']=type(payload).__name__
 except Exception as e:item['error_type']=type(e).__name__
 return item


async def main():
 key_ok=True
 try:school.credential()
 except school.Blocked as e:key_ok=False
 out={'checked_at':time.time(),'base':school.BASE,'key_present':key_ok,'inference_requests':0,'writes':0,'probes':[]}
 if key_ok:
  async with httpx.AsyncClient(trust_env=False,timeout=10,follow_redirects=False) as c:
   for path in ('/v1/dashboard/billing/subscription','/v1/dashboard/billing/usage','/v1/dashboard/billing/credit_grants'):
    out['probes'].append(await probe(c,path))
 OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(out,ensure_ascii=False))
 return 0

if __name__=='__main__':raise SystemExit(asyncio.run(main()))
