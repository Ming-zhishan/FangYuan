"""One persistent, bounded daily project, explicitly separated from original-book canon."""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import time

ROOT=Path(__file__).resolve().parents[3]
DEFAULT=ROOT/'work/instance/data/fangyuan-life.sqlite3'
PHASES=[
    ('核对仙窍资源点的供给和炼蛊耗材的损耗','先把重复消耗和可调配余量理清，仍在核对，没有宣称获得新成果'),
    ('对照刚核对的账目，调整一份仙材调配草案','仍是同一批资源和耗材，只在比较安排，没有实际宣称产量提升'),
    ('复核仙材调配草案，推敲耗损能否再压低一些','继续原来的资源调配事务，没有炼成新蛊、突破或推进大战'),
]


class LifeState:
    def __init__(self,path=DEFAULT):
        self.path=Path(path)
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db,db:
            db.execute('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS mentions (scope TEXT, message_id TEXT, mentioned_at REAL, PRIMARY KEY(scope,message_id))')

    def get(self,now=None,advance=False):
        now=time.time() if now is None else now
        with closing(sqlite3.connect(self.path)) as db,db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT payload FROM state WHERE id=1').fetchone()
            if row:
                state=json.loads(row[0])
            else:
                state={'schema':1,'project_id':'aperture-material-audit','phase':0,'started_at':now,'updated_at':now,
                       'provenance':'USER_AUTHORIZED_DAILY_FICTION','canon':False,'canonical_stage':'九转炼道尊者，未得永生'}
            if advance and now-state['updated_at']>=4*3600 and state['phase']<len(PHASES)-1:
                state['phase']+=1
                state['updated_at']=now
            state['activity'],state['continuity']=PHASES[state['phase']]
            state['availability']='有自己的事务，可以分心回几句话；不伪装成一直等消息，也不每轮声称忙得没空'
            db.execute('INSERT OR REPLACE INTO state VALUES(1,?)',(json.dumps(state,ensure_ascii=False),))
        return state

    def mention(self,scope,mid):
        with closing(sqlite3.connect(self.path)) as db,db:
            db.execute('INSERT OR IGNORE INTO mentions VALUES(?,?,?)',(scope,mid,time.time()))

    def prompt(self,text=''):
        import re
        s=self.get(advance=bool(re.search(r'上次|进展|后来.*怎样|处理完',text)))
        return ('【当前蛊界日常；用户允许的生活创作，不是原著记载】\n'
            f"持续事务：{s['activity']}。延续情况：{s['continuity']}。{s['availability']}。"
            '回答当下在做什么应基于此状态，不另开随机事件。问到原著是否记载该具体事务，才说明它是日常设定。')
