"""Smoke-test the single stable private review link in real Microsoft Edge."""
from pathlib import Path
import argparse,hashlib,json,subprocess,tempfile,re,shutil
from bs4 import BeautifulSoup
def check(root:Path,edge:Path):
 root=root.resolve()
 file=root/'CURRENT_REVIEW.html'
 version=json.loads((root/'CURRENT_REVIEW_META.json').read_text(encoding='utf8'))
 if hashlib.sha256(file.read_bytes()).hexdigest()!=version['sourceSha256']:
  raise ValueError('Canonical alias differs from approved version')
 with tempfile.TemporaryDirectory(prefix='_edge_current_review_',dir=root) as profile:
  cmd=[str(edge),'--headless=new','--disable-gpu','--no-first-run',
       '--no-default-browser-check','--user-data-dir='+profile,
       '--virtual-time-budget=2500','--dump-dom',file.as_uri()]
  result=subprocess.run(cmd,capture_output=True,timeout=45)
  if result.returncode!=0:raise RuntimeError('Edge failed to open canonical review')
  soup=BeautifulSoup(result.stdout.decode('utf8','replace'),'html.parser')
  assert len(soup.select('#focus > .card'))==4
  assert len(soup.select('#focus audio'))==17
  assert len(soup.select('#focus .option:not([hidden]) audio'))==8
  assert len(soup.select('#other-list audio'))==20
  assert len(soup.select('#faces figure'))==2
  assert '导出审核结果' in soup.get_text()
  data=json.loads(soup.select_one('#review-data').text)
  assert version['voiceSamples']==37
  assert not data['productionReady'] and not data['copyrightCleared']
 report={'passed':True,'aliasSha256':version['sourceSha256'],
   'version':version['version'],'focus':4,'visibleComparisonAudio':8,
   'totalPrivateAudio':37,'images':2,'userApprovalRecorded':False,'qqReady':False}
 dest=root/'CURRENT_REVIEW_BROWSER_QA.json'
 if dest.exists():raise ValueError('Refusing to overwrite validation report')
 dest.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 return report
if __name__=='__main__':
 p=argparse.ArgumentParser()
 p.add_argument('--root',type=Path,required=True)
 p.add_argument('--edge',type=Path,required=True)
 a=p.parse_args()
 print(json.dumps(check(a.root,a.edge),ensure_ascii=False,indent=2))
