"""Build an isolated, immutable media-source shadow for a fresh TrendRadar crawl.
Never write, checkpoint or migrate the original producer's research DB.
"""
from pathlib import Path
import argparse, sqlite3, shutil, json, hashlib, datetime, os
from PIL import Image

def digest(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def read(f):return json.loads(f.read_text(encoding='utf-8-sig'))
def safe_db_snapshot(src,dest):
    conn=sqlite3.connect(f'file:{src.as_posix()}?mode=ro',uri=True)
    try:
        snapshot=sqlite3.connect(dest)
        try:conn.backup(snapshot)
        finally:snapshot.close()
    finally:conn.close()
def build(*,research,crawl_root,external,dest):
    if dest.exists():raise ValueError('Refusing overwrite')
    research=research.resolve()
    config=research/'meme_pipeline_lab'
    original=config/'originals'
    source_db=config/'research.sqlite3'
    trend_news=(crawl_root/'output_live'/'news')
    files=sorted(trend_news.glob('????-??-??.db'))
    if not files:raise ValueError('Fresh independent crawler has not produced news DB')
    db_file=files[-1]
    if not(source_db.exists() and original.exists()):raise ValueError('Producer assets missing')
    # Source tree and private factory destination cannot overlap.
    if research in dest.resolve().parents or dest.resolve() in research.parents:
        raise ValueError('Research/destination overlap')
    manifest_root=dest.parent/'.fangyuan-media-staging-root.json'
    owner=read(manifest_root)
    if owner.get('purpose')!='isolated-fangyuan-media-staging':raise ValueError('Invalid owner')
    source_index=read(config/'全部素材_逐帧格式与指纹核验.json')
    originals=[item for item in source_index['items'] if item['path'].startswith('originals/')]
    extras=read(external/'EXTERNAL_REFERENCE_MANIFEST.json')['items']
    # Verify exact resolved containment; manifests must never escape the media research tree.
    for item in originals:
        src=(config/item['path']).resolve()
        if not src.is_relative_to(config.resolve()):raise ValueError('Unsafe original media path')
        if not src.is_file() or digest(src)!=item['sha256']:raise ValueError('Corrupt baseline original: '+str(src))
    for item in extras:
        if item.get('status')!='acquired':continue
        src=external/item['file']
        if not src.exists() or digest(src)!=item['sha256']:raise ValueError('External research original changed')
    # Query crawled rows READ ONLY; snapshot SQLite will be independent.
    with sqlite3.connect(f'file:{db_file.as_posix()}?mode=ro',uri=True) as c:
        rows=c.execute('SELECT platform_id,title,url,rank FROM news_items').fetchall()
        platforms=c.execute('SELECT id,name FROM platforms').fetchall()
    if not rows:raise ValueError('Crawler returned no headlines')
    dest.mkdir(parents=False)
    try:
        dest_lab=dest/'meme_pipeline_lab'
        dest_org=dest_lab/'originals'
        dest_org.mkdir(parents=True)
        for item in originals:
            src=config/item['path']
            shutil.copyfile(src,dest_lab/item['path'])
            if digest(dest_lab/item['path'])!=item['sha256']:raise ValueError('Copy corrupted')
        additional=[]
        for item in extras:
            if item.get('status')!='acquired':continue
            src=external/item['file']
            name='external_'+src.name
            dst=dest_org/name
            shutil.copyfile(src,dst)
            if digest(dst)!=item['sha256']:raise ValueError('Copy corrupted external')
            additional.append({'path':'originals/'+name,'format':item['format'],
                'width':item['width'],'height':item['height'],'frames':item['frames'],
                'duration_ms':0,'bytes':item['bytes'],'sha256':item['sha256'],
                'sourcePage':item['sourcePage'],'reusePermission':'unverified'})
        next_index={'analysed':len(originals)+len(additional),
            'items':originals+additional,'originalMedia':len(originals)+len(additional),
            'noProductionPublication':True,'rightsVerified':False}
        (dest_lab/'全部素材_逐帧格式与指纹核验.json').write_text(json.dumps(next_index,ensure_ascii=False,indent=2),encoding='utf8')
        safe_db_snapshot(source_db,dest_lab/'research.sqlite3')
        out=dest_lab/'trendradar_research'/'output_live'
        news=out/'news';news.mkdir(parents=True)
        safe_db_snapshot(db_file,news/db_file.name)
        platform_names=dict(platforms)
        counts={name:[] for name in platform_names}
        for platform,title,url,rank in rows:counts.setdefault(platform,[]).append({'title':title,'url':url,'rank':rank})
        synopsis={'crawl_count':1,'raw_items':len(rows),
            'platforms':{p:{'name':platform_names.get(p,p),'count':len(v),
                'top20':sorted(v,key=lambda x:x['rank'] if x['rank'] is not None else 99999)[:20]}
                for p,v in counts.items()},
            'keyword_matches':[],'source':'independent TrendRadar crawler; no production writes',
            'captured_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        (out/'current_snapshot_summary.json').write_text(json.dumps(synopsis,ensure_ascii=False,indent=2),encoding='utf8')
        info={'created_at':synopsis['captured_at'],'source_db':str(db_file),'trending_raw_count':len(rows),
             'platforms':len(counts),'baseline_originals':len(originals),
             'new_research_originals':len(additional),'originals_total':len(originals)+len(additional),
             'fresh_crawl_sha256':digest(db_file),'baseline_db_sha256':digest(source_db),
             'external_rights_unverified':True,'output_ready_for_qq':False,'producer_db_changed':False}
        (dest/'SHADOW_FINAL.json').write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    except Exception:
        shutil.rmtree(dest,ignore_errors=True)
        raise
    return info
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for a in ['research','crawl-root','external','out']:p.add_argument('--'+a,required=True,type=Path)
 args=vars(p.parse_args())
 print(json.dumps(build(research=args['research'],crawl_root=args['crawl_root'],
     external=args['external'],dest=args['out']),ensure_ascii=False,indent=2))
