"""Switch the shared Replyer without changing memories or resetting usage counters."""
import argparse,json,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def main():
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['local','cloud']);p.add_argument('--model',choices=['qwen3.8-2.4t-a95b','qwen3.8-flash'],default='qwen3.8-2.4t-a95b');a=p.parse_args()
 path=ROOT/'work/private/cloud-runtime.json';c=json.loads(path.read_text(encoding='utf-8'))
 if a.mode=='cloud':
  evidence=json.loads((ROOT/'work/cloud-investigation/free-only-evidence.json').read_text(encoding='utf-8-sig'))
  assert any(x['model']==a.model and x['state']=='On' for x in evidence),'未核验免费保护'
  assert c['free_only_verified'].get(a.model) is True and time.time()<c['stop_at_unix'][a.model],'免费保护或有效期不满足'
 c.update(mode=a.mode,model=a.model)
 if a.mode=='cloud':c.pop('last_cloud_error',None)
 temp=path.with_suffix('.switch.tmp');temp.write_text(json.dumps(c,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(path)
 print('已切换：'+('云端 '+a.model+'（仅免费额度，用尽停止云端）' if a.mode=='cloud' else '本地 Qwen3 8B（不调用云端）'))
if __name__=='__main__':main()
