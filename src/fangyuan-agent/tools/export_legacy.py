"""Read-only, source-preserving export. Never execute the old bot or write its databases."""
from pathlib import Path
import sqlite3,json,hashlib,re,argparse

def export(source, target):
    source=Path(source).resolve(strict=True); target=Path(target).resolve()
    if source==target:raise ValueError('Source and target must differ')
    with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as db:
        db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
        if db.execute('SELECT COUNT(*) FROM interactions').fetchone()[0]>10000:raise ValueError('More than 10000 interactions; use an explicit paged export rather than silently truncating')
        interactions=[dict(zip(['scope','mid','uid','text','answer','created_at'],r)) for r in db.execute('SELECT scope,mid,uid,text,answer,created_at FROM interactions ORDER BY created_at,rowid LIMIT 10000')]
        facts=[dict(zip(['id','uid','scope','slot','content','source_mid','created_at','kind','active'],r)) for r in db.execute('SELECT id,uid,scope,slot,content,source_mid,created_at,kind,active FROM facts')]
    target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists():raise ValueError('Export exists; select a fresh snapshot instead of replacing it')
    payload={'format':'fangyuan-legacy-social-v1','source':str(source),'source_read_only':True,'interactions':interactions,'facts':facts}
    target.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    return {'rows':len(interactions),'facts':len(facts),'snapshot_sha256':hashlib.sha256(target.read_bytes()).hexdigest()}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('target');args=p.parse_args()
    print(json.dumps(export(args.source,args.target)))
