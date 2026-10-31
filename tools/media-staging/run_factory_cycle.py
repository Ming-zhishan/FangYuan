"""Repeatable, single-writer private FangYuan meme-factory cycle.
Stages independent TrendRadar crawl -> immutable source shadow -> cumulative research SQLite.
Does not modify producer research, DSH, Aurabot, QQ, other worktrees, or release assets.
No arbitrary daily quantity or frequency cap; every new source snapshot is considered.
"""
from pathlib import Path
import argparse, json, os, subprocess, sys, hashlib, datetime, uuid, shutil, time

def j(f):return json.loads(f.read_text(encoding='utf-8-sig'))
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def get_crawl_db(root):
    files=sorted((root/'output_live'/'news').glob('????-??-??.db'))
    if not files:raise ValueError('No NewsNow crawl database available')
    return files[-1]
def verified_owner(root):
    data=j(root/'.fangyuan-media-staging-root.json')
    if data.get('purpose')!='isolated-fangyuan-media-staging' or data.get('allowNewChildren')!=True:
        raise ValueError('Untrusted private factory root')
def run_process(cmd,*,cwd=None,env=None,timeout=240,log=None):
    proc=subprocess.run([str(x) for x in cmd],cwd=cwd,env=env,
                        stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    data=proc.stdout.decode('utf-8','replace')
    if log is not None:log.write_text(data,encoding='utf8')
    if proc.returncode!=0:raise RuntimeError('Command returned '+str(proc.returncode)+': '+data[-1400:])
    return data
def cycle(*,root,crawler,crawler_python,research,external,source_shadow,factory_js,node='node',
          refresh=False):
    root=root.resolve();crawler=crawler.resolve()
    verified_owner(root)
    if crawler==research.resolve():raise ValueError('Crawler must be an isolated copy')
    if not(crawler/'trendradar'/'__main__.py').exists():raise ValueError('TrendRadar isolated copy missing')
    if not (crawler/'config'/'config.yaml').is_file():raise ValueError('TrendRadar isolated config missing')
    cfg=(crawler/'config'/'config.yaml').read_text(encoding='utf-8-sig')
    if 'schedule:\n  enabled: false' not in cfg.replace('\r\n','\n'):
        raise ValueError('Do not enable duplicate scheduling in isolated source copy')
    if not(source_shadow.exists() and factory_js.exists()):raise ValueError('Required media code unavailable')
    lock=root/'.fangyuan-factory-single-writer.lock'
    # Never delete somebody else's existing lock, even if it looks stale.
    try:
        fd=os.open(str(lock),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    except FileExistsError:raise ValueError('Another media factory cycle already owns this resource')
    with os.fdopen(fd,'w',encoding='utf8') as f:
        f.write(json.dumps({'pid':os.getpid(),'createdAt':time.time(),'scope':'private meme factory'})+'\n')
    run_dir=None
    try:
        stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        run_dir=root/('cycle-'+stamp+'-'+uuid.uuid4().hex[:6])
        run_dir.mkdir()
        (run_dir/'.fangyuan-media-staging-root.json').write_text(json.dumps({
            'purpose':'isolated-fangyuan-media-staging','allowNewChildren':True}),encoding='utf8')
        if refresh:
            env=os.environ.copy()
            env['PYTHONPATH']=str(crawler)
            env['TREND_RADAR_NO_BROWSER']='1'
            run_process([crawler_python,'-m','trendradar'],cwd=crawler,env=env,timeout=240,
                        log=run_dir/'CRAWLER_STDOUT.log')
        crawl_db=get_crawl_db(crawler)
        current_hash=sha(crawl_db)
        last=root/'LATEST.json'
        previous=None
        if last.is_file():
            historic=j(last)
            previous=Path(historic['factoryDir'])
            if not previous.exists():raise ValueError('Last committed factory path is absent; stop')
            if historic.get('crawlDbSha256')==current_hash:
                # No source change: no duplicated observations or useless copies.
                shutil.rmtree(run_dir)
                return {'status':'no_new_snapshot','sourceSha256':current_hash,'cyclesNotDuplicated':True}
        shadow=run_dir/'shadow'
        run_process([sys.executable,source_shadow,'--research',research,
             '--crawl-root',crawler,'--external',external,'--out',shadow],timeout=70,
             log=run_dir/'SHADOW_STDOUT.log')
        factory=run_dir/'factory'
        cmd=[node,factory_js,'--media-root',shadow,'--out',factory]
        if previous:cmd+=['--previous',previous]
        run_process(cmd,timeout=70,log=run_dir/'FACTORY_STDOUT.log')
        result=j(factory/'FACTORY_FINAL.json')
        if result.get('productionReady')!=False or result.get('qqReady')!=False:
            raise RuntimeError('Research candidate was accidentally enabled')
        report={'status':'offline_complete','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'crawlDbSha256':current_hash,'crawlerSource':str(crawl_db),'factoryDir':str(factory),
           'shadowDir':str(shadow),'stats':result['stats'],
           'publisherModified':False,'productionReady':False,'qqSent':False}
        (run_dir/'CYCLE_FINAL.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        new_latest=root/('LATEST.json.stage-'+uuid.uuid4().hex[:7])
        new_latest.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        os.replace(new_latest,last)
        return report
    except Exception as e:
        if run_dir and run_dir.exists():shutil.rmtree(run_dir,ignore_errors=True)
        error=root/('FAILED-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:6]+'.txt')
        error.write_text(str(e),encoding='utf8')
        raise
    finally:
        # We created this exact lock via O_EXCL and own it for this process.
        try:lock.unlink()
        except FileNotFoundError:pass
if __name__=='__main__':
    a=argparse.ArgumentParser()
    for x in ['root','crawler','crawler-python','research','external','source-shadow','factory-js']:
        a.add_argument('--'+x,required=True,type=Path)
    a.add_argument('--node',default='node')
    a.add_argument('--refresh',action='store_true')
    arg=a.parse_args()
    print(json.dumps(cycle(root=arg.root,crawler=arg.crawler,crawler_python=arg.crawler_python,
             research=arg.research,external=arg.external,source_shadow=arg.source_shadow,
             factory_js=arg.factory_js,node=arg.node,refresh=arg.refresh),ensure_ascii=False,indent=2))
