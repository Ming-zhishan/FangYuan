"""Synthetic replay of the live failure cases; no QQ traffic, no private data."""
import asyncio,json,tempfile,time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import tongji_provider as school
from character.runtime import CharacterRuntime

CASES=[
 ('date','今天几号'),
 ('insult-date','你妈死了，问你几号都不知道'),
 ('meta','你拿token喂我我就听话了？'),
 ('news','姆巴佩最近在国外社交平台上的争议发言'),
 ('exam','西安电子科技大学大学物理下期中考考点'),
 ('model','你现在接的什么模型'),
]

async def main():
 rows=[]
 with tempfile.TemporaryDirectory() as t:
  bot=CharacterRuntime(SimpleNamespace(search=AsyncMock(return_value=[])),world_path=Path(t)/'w',social_path=Path(t)/'s',owner='synthetic-owner')
  for i,(name,text) in enumerate(CASES):
   c=await bot.prepare(text,'synthetic_A','group:680823437','synthetic-'+name,[])
   messages=bot.messages(c)
   tick=time.monotonic()
   try:
    payload,route=await school.generate(messages,output_limit=500,scope='synthetic')
    rows.append({'case':name,'question':text,'answer':payload['choices'][0]['message']['content'],
                 'seconds':round(time.monotonic()-tick,2),'usage':payload.get('usage')})
   except school.Blocked as e:
    rows.append({'case':name,'question':text,'error':e.code})
   print(json.dumps({k:rows[-1].get(k) for k in ('case','answer','error','seconds')},ensure_ascii=False),flush=True)
   await asyncio.sleep(4)
 out=Path(__file__).resolve().parents[1]/'cloud-investigation/tongji-live-20261027/quality-replay-20261028.json'
 out.write_text(json.dumps({'synthetic_only':True,'qq_sends':0,'rows':rows},ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'saved':str(out)},ensure_ascii=False))

asyncio.run(main())
