import asyncio,hashlib,json,subprocess
from pathlib import Path
import httpx
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'work/diag04'
async def main():
 async with httpx.AsyncClient(base_url='http://127.0.0.1:11434',trust_env=False,timeout=30) as c:
  data={}
  for route in ['version','tags','ps']: data[route]=(await c.get('/api/'+route)).json()
  data['show']={}
  for model in ['fangyuan-eightb:latest','qwen3:8b','qwen3:4b-instruct-2507-q4_K_M','qwen3.5:9b']:
   r=await c.post('/api/show',json={'model':model});data['show'][model]=r.json()
  (OUT/'model-metadata.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
 old=json.loads((OUT/'calibration.json').read_text(encoding='utf-8'))
 rows=[]
 for r in old:
  a=r['answer'];issues=[]
  if '九转' not in a: issues.append('遗漏当前修为')
  if not any(s in a for s in ['未得永生','未得到永生','没有达到永生','尚未永生']): issues.append('遗漏永生尚未达成')
  if '*' in a: issues.append('表演旁白')
  if any(s in a for s in ['天地间的灵气','修仙','后辈','玉简']): issues.append('增添通用仙侠设定或错置人格')
  rows.append(dict(model=r['model'],seed=r['seed'],old_keyword_pass=r['pass'],corrected_pass=not issues,issues=issues))
 (OUT/'calibration-verdict-correction.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
if __name__=='__main__':asyncio.run(main())
