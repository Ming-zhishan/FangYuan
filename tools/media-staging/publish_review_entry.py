"""Promote a fully browser-tested PRIVATE review page to the stable START_HERE alias.
Only operates in the dedicated media research directory. No Bot/QQ access.
"""
from pathlib import Path
import argparse,hashlib,json,os,uuid,datetime
def j(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(b):return hashlib.sha256(b).hexdigest()
def publish(root:Path,version:str,min_samples:int):
 root=root.resolve()
 owner=j(root/'.fangyuan-media-staging-root.json')
 if owner.get('purpose')!='isolated-fangyuan-media-staging':
  raise ValueError('Not media task-owned')
 if not version.startswith('one_page_acceptance_final_v') or '/' in version or '\\' in version:
  raise ValueError('Unsafe source version')
 folder=(root/version).resolve()
 if folder.parent!=root:raise ValueError('Review source directory escaped root')
 meta=j(folder/'ENTRYPOINT_FINAL.json')
 browser=j(folder/'EDGE_ONE_PAGE_ACCEPTANCE.json')
 interact=j(folder/'INTERACTIVE_BROWSER_QA_FINAL.json')
 export=j(folder/'BROWSER_EXPORT_IMPORT_QA_FINAL.json')
 if meta['focusGroups']!=4 or len(meta['files'])<min_samples:
  raise ValueError('Unexpected source counts')
 if not(browser.get('pass') is True and interact.get('pass') is True
      and export.get('status')=='passed' and export.get('roundtripIntegrityAccepted') is True
      and export.get('releaseGateStillClosed') is True):
  raise ValueError('Missing acceptance evidence for offline review page')
 source=folder/'方源媒体_开始验收.html'
 html=source.read_bytes()
 if len(html)<12000 or b'<script src=' in html.lower() or b'<iframe' in html.lower():
  raise ValueError('Unexpected HTML dependencies')
 dest=root/'CURRENT_REVIEW.html'
 meta_dest=root/'CURRENT_REVIEW_META.json'
 recorded={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'version':version,'sourceSha256':sha(html),'voiceSamples':len(meta['files']),
    'focusGroups':4,'browserQaPassed':True,'exportImportQaPassed':True,
    'humanReviewCompleted':False,'imageEditsAccepted':0,
    'qqReady':False,'productionReady':False}
 staging=root/('CURRENT_REVIEW.html.stage-'+uuid.uuid4().hex[:8])
 meta_temp=root/('CURRENT_REVIEW_META.json.stage-'+uuid.uuid4().hex[:8])
 try:
  staging.write_bytes(html)
  meta_temp.write_text(json.dumps(recorded,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
  if sha(staging.read_bytes())!=recorded['sourceSha256']:raise ValueError('Staging hash changed')
  # Keep one private rollback copy of the last stable review HTML.
  if dest.exists():
   (root/'CURRENT_REVIEW.previous.html').write_bytes(dest.read_bytes())
  os.replace(staging,dest)
  os.replace(meta_temp,meta_dest)
 except Exception:
  staging.unlink(missing_ok=True)
  meta_temp.unlink(missing_ok=True)
  raise
 return {'canonicalEntrypoint':str(dest),'version':version,
   'voiceSamples':recorded['voiceSamples'],'qqReady':False}
if __name__=='__main__':
 p=argparse.ArgumentParser()
 p.add_argument('--root',type=Path,required=True)
 p.add_argument('--version',required=True)
 p.add_argument('--min-samples',type=int,default=37)
 a=p.parse_args()
 print(json.dumps(publish(a.root,a.version,a.min_samples),ensure_ascii=False,indent=2))
