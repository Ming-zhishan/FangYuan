"""Read-only retrieval and context routing audit; isolated state databases."""
import asyncio, hashlib, json, sys, tempfile, time
from pathlib import Path
SETUP=Path(__file__).resolve().parents[1];ROOT=SETUP.parents[1];OUT=ROOT/'work/diag04'
sys.path.insert(0,str(SETUP))
from character_retrieval import ReviewedRetrieval
from character.runtime import CharacterRuntime
from character.knowledge import compile_references,anchors

async def main():
 r=ReviewedRetrieval(cpu=True);rows=[]
 for q in ['商心慈为什么在商队里帮助你？','太白云生和你是什么关系？','仙蛊唯一是什么意思？请给原文章节','春秋蝉为什么会威胁早期空窍？详细解释','你与白凝冰在三王传承怎样合作？','这项核对事务在原著第几章？']:
  tick=time.perf_counter()
  try: hits=await r.search(q);error=None
  except Exception as e: hits=[];error=repr(e)
  refs,ids=compile_references(q,hits)
  rows.append(dict(query=q,seconds=time.perf_counter()-tick,error=error,anchors=[c['id'] for c in anchors(q)],hits=hits,compiled=refs,used_ids=ids))
  print(json.dumps({'query':q,'hits':[h['id'] for h in hits],'compiled_ids':ids,'seconds':rows[-1]['seconds']},ensure_ascii=False),flush=True)
 (OUT/'retrieval-audit.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
 routes=[]
 with tempfile.TemporaryDirectory() as t:
  c=CharacterRuntime(r,world_path=Path(t)/'w',social_path=Path(t)/'s',owner='A')
  history=[dict(role='user',content='你在做什么？'),dict(role='assistant',content='在核对仙窍资源和耗材损耗。')]
  for i,q in enumerate(['你在做什么？','这项核对事务在原著第几章？','这事做完了没？','还在查那份清单吗？','然后呢？','我先去吃饭了。']):
   prepared=await c.prepare(q,'A','private:A',str(i),history)
   routes.append(dict(query=q,discussing_life=prepared['discussing_life'],history=prepared['history'],refs=prepared['references'],system=prepared['system']))
 (OUT/'context-routing-audit.json').write_text(json.dumps(routes,ensure_ascii=False,indent=2),encoding='utf-8')
 paths=list((ROOT/'outputs/方源人格优化-0.3').rglob('*'))+list((SETUP/'character').glob('*.py'))+[SETUP/'private_replies.py',SETUP/'character_retrieval.py',SETUP/'plugin-src/fangyuan-continuity/plugin.py',ROOT/'work/instance/config/bot_config.toml',ROOT/'work/instance/config/model_config.toml']
 hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths if p.is_file()}
 (OUT/'source-hashes-before.json').write_text(json.dumps(hashes,ensure_ascii=False,indent=2),encoding='utf-8')

if __name__=='__main__':asyncio.run(main())
