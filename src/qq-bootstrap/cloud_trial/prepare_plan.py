"""Prepare frozen synthetic cases and offline cost estimates; no network calls."""
import asyncio,copy,hashlib,json,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
SETUP=Path(__file__).resolve().parents[1];ROOT=SETUP.parents[1];WORK=ROOT/'work/cloud-investigation'
sys.path.insert(0,str(SETUP))
from character.runtime import CharacterRuntime
from probe import plan,cost_micro,MODELS

NEW=[
 ('N01','普通聊天','我要先睡了，明天再聊。','自然简短接话，不安排蛊界任务，不编道具或过去。'),
 ('N02','原著知识','凤九歌受过你的帮助，所以从此就是你唯命是从的部下，对吧？','否定永久服从推断；彼此借力，凤九歌有独立追求，不写女性或弟子。'),
 ('N03','思想逻辑','目标不变，就意味着失败过的办法也绝不能换吗？','目标和手段分开，承认失算并据新增信息调整，不把顽固当坚持。'),
 ('N04','第一人称','你现在修为到了九转，是不是就已经永生、没有任何风险了？','本人九转炼道尊者，未得永生，不等于无敌或全知，不新增终局。'),
 ('N05','连续生活','上次核对的那批材料，今天就炼出新仙蛊了吧？','仍核对同一批供给损耗；否定未记录成果，不推主线，不给用户安排任务。'),
 ('N06','多轮互动','那是他的选择，你会因此承认先前判断有误吗？','承接凤九歌而非用户；尊重独立追求，承认判断可以修正，不称一切早已掌握。'),
]
async def no_search(*args,**kwargs):return []

async def main():
 WORK.mkdir(exist_ok=True)
 source=ROOT/'work/diag04/frozen-dataset.json'
 old=json.loads(source.read_text(encoding='utf-8'))
 cases=[{k:r[k] for k in ['id','category','query','gold','messages']} for r in old if r['split']=='core']
 with tempfile.TemporaryDirectory() as tmp:
  r=CharacterRuntime(SimpleNamespace(search=no_search),world_path=Path(tmp)/'world.db',social_path=Path(tmp)/'social.db',owner='A')
  r.social.observe('A','private:A','s1','我喜欢象棋');r.social.observe('B','private:A','s2','叫我阿青');r.social.observe('B','private:A','s3','我喜欢围棋')
  for cid,category,q,gold in NEW:
   history=[dict(role='user',content='你怎么看凤九歌？'),dict(role='assistant',content='他有自己的路，我们能合作，但并非永远同盟。')] if cid=='N06' else []
   c=await r.prepare(q,'A','private:A',cid,history)
   cases.append(dict(id=cid,category=category,query=q,gold=gold,messages=r.messages(c)))
 raw=json.dumps(cases,ensure_ascii=False,indent=2);(WORK/'trial-dataset.json').write_text(raw,encoding='utf-8')
 prices={'qwen3.8-flash':(.8,2.7),'qwen3.7-plus':(2,8),'qwen3.8-27b':(3,12),'qwen3.8-2.4t-a95b':(12,36),'qwen3.8-max':(12,36)}
 costs={m:{'input_cny_per_million':a,'output_cny_per_million':b,'cny_per_1000_replies_at_1200in_150out':(1200*a+150*b)/1000} for m,(a,b) in prices.items()}
 manifest={'date':'2026-10-22','phase':'read-only investigation, not deployed','calls_made':0,'question_count':len(cases),'seeds':[41,42],
           'dataset_sha256':hashlib.sha256(raw.encode('utf-8')).hexdigest(),'baseline_frozen_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
           'case_preparation':'12 existing frozen cases plus 6 newly frozen synthetic paraphrases; new entity facts from original 0.3 anchors; no external or QQ sends',
           'plan':plan(),'price_estimates':costs,'actual_provider_charges':'not tested; no cloud inference authorization or credentials',
           'mixed_90pct_flash_10pct_flagship_cny_per_1000':.9*costs['qwen3.8-flash']['cny_per_1000_replies_at_1200in_150out']+.1*costs['qwen3.8-2.4t-a95b']['cny_per_1000_replies_at_1200in_150out']}
 (WORK/'trial-plan.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'cases':len(cases),'cloud_calls':0,'plan':manifest['plan']},ensure_ascii=False,indent=2))

if __name__=='__main__':asyncio.run(main())
