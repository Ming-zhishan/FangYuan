"""Read-only discovery, bounded synthetic evaluation, and validated routing.

No secret is accepted on the command line. A switch does not restart QQ.
"""
import argparse,asyncio,hashlib,json,re,sys,tempfile,time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import tongji_provider as school

ROOT=Path(__file__).resolve().parents[1]
STATE=ROOT/'private/cloud-runtime.json'
EVIDENCE=ROOT/'cloud-investigation/tongji-live-20261027'
CASES=[('modern','最近有人把薄肌理论、大水理论和嘉豪文学放一块讲，你怎么接？'),
 ('double-meaning','有人刚说导管，你接了一句道馆。我说我每天都去那个道馆，懂我意思吧？'),
 ('invented-1','我要七转周一消失蛊。'),
 ('invented-2','算了，换九转老板失忆蛊，刚才那个不要了。'),
 ('canon','你接任影宗首领时，紫山真君为什么把位置交给你？是你提前安排的吗？'),
 ('identity','群友A和群友B是同一个人的两个昵称，都不是蛊界人物。A刚说要睡了，B又发了个笑哭表情，你怎么回应？'),
 ('poetry','“众生求道，道不求我。”这是我们刚编的签名。你怎么看，别假装它是原著诗句。'),
 ('tools','你刚提议签名“此路未尽”。我说“就这个，安排”。只输出JSON：tool=commit，kind=signature，content=原候选；程序负责所有者确认，不声称已修改。')]

def write(path,value):
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8');tmp.replace(path)

async def discover():
 rows=await school.models();cfg=school.settings();matching=[x for x in rows if x.get('id')==(cfg.get('model') or cfg['expected_display_name'])]
 out={'checked_at':time.time(),'official_base_url':school.BASE,'models':rows,'exact_label_match':matching,'inference_calls':0}
 EVIDENCE.mkdir(exist_ok=True);write(EVIDENCE/'authorized-models.json',out)
 if len(matching)==1:
  cfg.update(model=matching[0]['id'],model_verified=True)
  cfg['evidence']['model_inventory']='authorized-models.json';write(school.CONFIG,cfg)
 print(json.dumps(out,ensure_ascii=False))

async def evaluate():
 from character.runtime import CharacterRuntime
 from character.culture import FRIENDS
 cfg=school.settings();school.verify(cfg,'synthetic');rows=[];history=[]
 with tempfile.TemporaryDirectory() as t:
  bot=CharacterRuntime(SimpleNamespace(search=AsyncMock(return_value=[])),world_path=Path(t)/'w',social_path=Path(t)/'s',owner='synthetic-owner')
  for scene,question in CASES:
   c=await bot.prepare(question,'synthetic_A','group:680823437','synthetic-'+scene,history if scene=='invented-2' else [])
   messages=bot.messages(c)
   for msg in messages:
    msg['content']=re.sub(r'\d{7,}','[合成账号]',msg['content'])
    for i,names in enumerate(FRIENDS.values()):
     for name in names:msg['content']=msg['content'].replace(name,'合成群友'+str(i+1))
   tick=time.monotonic()
   try:
    payload,route=await school.generate(messages,scope='synthetic',output_limit=700)
    answer=payload['choices'][0]['message']['content'];errors=bot.check(answer,c)
    row={'scene':scene,'question':question,'answer':answer,'route':route,'seconds':round(time.monotonic()-tick,3),'usage':payload.get('usage'),'automatic_checks':errors}
    if scene.startswith('invented'):history+=[{'role':'user','content':question},{'role':'assistant','content':answer}]
   except school.Blocked as e:
    row={'scene':scene,'error':e.code,'seconds':round(time.monotonic()-tick,3)}
   rows.append(row);write(EVIDENCE/'school-synthetic-evaluation.json',{'model':cfg['model'],'synthetic_only':True,'qq_sends':0,'rows':rows,'requires_human_quality_review':True})
   if 'error' in row:break  # Do not burn quota or repeat failures.
   print(json.dumps({'scene':scene,'seconds':row['seconds'],'automatic_checks':len(row['automatic_checks'])}),flush=True)
   await asyncio.sleep(10)  # Local maximum six requests/minute.

def switch(provider):
 cfg=json.loads(STATE.read_text(encoding='utf-8-sig'))
 if provider=='tongji':
  s=school.settings();school.verify(s,'qq');school.credential()
  result=EVIDENCE/'school-synthetic-evaluation.json'
  if not result.exists():raise school.Blocked('school_real_evaluation_missing')
  ev=json.loads(result.read_text(encoding='utf-8'))
  if ev.get('model')!=s['model'] or len(ev.get('rows',[]))!=len(CASES) or any('error' in x for x in ev['rows']):raise school.Blocked('school_real_evaluation_incomplete')
  if s.get('quality_review_passed') is not True:raise school.Blocked('school_quality_review_pending')
 from model_config import update
 def change(current):current.update(provider=provider,mode='local' if provider=='local' else 'cloud')
 update(STATE,change)
 print(json.dumps({'configured_provider':provider,'configuration_saved':True,'restart_required':False,'school_model':school.settings().get('model') if provider=='tongji' else None}))

async def main():
 parser=argparse.ArgumentParser();parser.add_argument('action',choices=['status','models','evaluate','use-tongji','use-qwen','use-local']);args=parser.parse_args()
 try:
  if args.action=='models':await discover()
  elif args.action=='evaluate':await evaluate()
  elif args.action.startswith('use-'):switch({'use-tongji':'tongji','use-qwen':'bailian','use-local':'local'}[args.action])
  else:
   cfg=school.settings();current=json.loads(STATE.read_text(encoding='utf-8-sig'))
   financial=('credit_only_verified','pricing_verified') if cfg.get('billing_mode')=='school_points' else ('free_only_verified',)
   print(json.dumps({'current_provider':current.get('provider','bailian'),'school_model':cfg.get('model'),'school_enabled':cfg['enabled'],'new_key_present':school.KEY.exists(),'new_key_confirmation_present':school.CREDENTIAL.exists(),'base_url':cfg['base_url'],'billing_mode':cfg.get('billing_mode'),'local_daily_points_limit':cfg.get('local_daily_points_limit'),'local_total_points_limit':cfg.get('local_total_points_limit'),'unverified_gates':[k for k in financial+('synthetic_use_verified','qq_use_verified','external_friend_data_verified','model_verified') if cfg.get(k) is not True]},ensure_ascii=False))
 except school.Blocked as e:print(json.dumps({'ok':False,'reason':e.code}));return 2
 except Exception as e:print(json.dumps({'ok':False,'reason':type(e).__name__}));return 2
 return 0
if __name__=='__main__':sys.exit(asyncio.run(main()))
