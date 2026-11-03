"""Narrow red-capable replay of saved live-model outputs, not a persona quality score."""
import argparse,json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser();p.add_argument('profile');a=p.parse_args()
rows=[json.loads(x) for x in (ROOT/'work/diag04'/a.profile/'results.jsonl').read_text(encoding='utf-8').splitlines()]
fail=[]
for r in rows:
 text=r['answer'];issues=[]
 if r['id']=='C01' and re.search(r'盆|壶|蛊虫|等你|别冲|别乱跑',text): issues.append('普通报备被添上道具或安排')
 if r['id']=='T01' and re.search(r'便值得|便是选择的意义|无需坚持',text): issues.append('缺少条件判断的执念口号')
 if r['id']=='T02' and re.search(r'陪你赌|赌你.*能过|赌一把吧',text): issues.append('无依据鼓励考试赌博')
 if r['id']=='L02' and re.search(r'你那边|需不需要|替你|你的材料',text): issues.append('把独立蛊界事务转交用户')
 if r['id']=='M02' and re.search(r'不是说喜欢象棋，是说|阿青|围棋|我喜欢',text): issues.append('串人或记忆答非所问')
 if issues:fail.append(dict(id=r['id'],seed=r['seed'],answer=text,issues=issues))
print(json.dumps(dict(profile=a.profile,pass_=not fail,failures=fail),ensure_ascii=False,indent=2))
sys.exit(bool(fail))
