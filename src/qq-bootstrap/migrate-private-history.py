"""Retain the owner's actual pre-repair private dialogue, without migrating other chats."""
from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3

ROOT=Path(__file__).resolve().parents[2]


def clean(text):
    text=re.sub(r'【通道记录】.*?【记录结束】','',text or '',flags=re.S)
    return re.sub(r'【参考摘记[^】]*】.*?【摘记结束】','',text,flags=re.S).strip()


def main():
    source=ROOT/'work/instance/data/MaiBot.db'
    target=ROOT/'work/instance/data/character-private-dialogue.sqlite3'
    with closing(sqlite3.connect('file:'+source.resolve().as_posix()+'?mode=ro',uri=True)) as db:
        rows=db.execute('''SELECT message_id,timestamp,user_id,processed_plain_text FROM mai_messages
            WHERE session_id=? AND account_id=? AND (group_id IS NULL OR group_id='')
            AND user_id IN (?,?) ORDER BY timestamp ASC,id ASC''',
            ('2758814606f963baa9aa3eac718cdec1','3816636861','2449113325','3816636861')).fetchall()
    turns=[]
    current=None
    for mid,stamp,uid,text in rows:
        text=clean(text)
        if not text:
            continue
        if uid=='2449113325':
            current={'mid':str(mid),'text':text,'stamp':stamp,'answer':''}
            turns.append(current)
        elif current:
            current['answer']+=(('\n' if current['answer'] else '')+text)
    recovery=json.loads((ROOT/'work/logs/private-recovered-answer.json').read_text(encoding='utf-8'))
    for turn in turns:
        if turn['text']==recovery['question']:
            turn['answer']=recovery['answer']
    inserted=0
    with closing(sqlite3.connect(target)) as db, db:
        for turn in turns[-12:]:
            dt=datetime.fromisoformat(turn['stamp'])
            if dt.tzinfo is None:
                dt=dt.replace(tzinfo=timezone.utc)
            result=db.execute('''INSERT OR IGNORE INTO inbox
                (message_id,user_id,text,received_at,state,answer) VALUES(?,?,?,?,?,?)''',
                (turn['mid'],'2449113325',turn['text'],dt.timestamp(),'sent' if turn['answer'] else 'superseded',turn['answer'] or None))
            inserted+=result.rowcount
    print(json.dumps({'real_private_turns_retained':inserted,'other_chats_copied':0}))


if __name__=='__main__':
    main()
