"""Keep the complete reviewed card body in both runtime cores. Default verifies; --write updates repository files only."""
from pathlib import Path
import argparse
import hashlib
import json
import re

repo = Path(__file__).resolve().parents[3]
card = repo/'src/fangyuan-agent/personas/gu-yue-fang-yuan.md'
body = re.sub(r'^---\r?\n[\s\S]*?\r?\n---\r?\n?', '', card.read_text(encoding='utf-8-sig')).replace('\r\n','\n').strip()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--write', action='store_true')
args = parser.parse_args()
sha = hashlib.sha256(body.encode()).hexdigest()
valid = True
for folder in (repo/'src/fangyuan-agent/modules/fangyuan', repo/'src/aurabot-modules/fangyuan'):
    meta = json.loads((folder/'core-provenance.json').read_text(encoding='utf-8-sig'))
    if args.write:
        meta.update(sourceSha256=sha, compression='none; verbatim normalized persona body')
        (folder/'core.txt').write_text(body+'\n',encoding='utf-8')
        (folder/'core-provenance.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    valid &= (folder/'core.txt').read_text(encoding='utf-8-sig').replace('\r\n','\n').strip()==body and meta.get('sourceSha256')==sha and meta.get('compression','').startswith('none;')
print(json.dumps({'mode':'write' if args.write else 'check','complete_body_chars':len(body),'both_runtime_cores_match':valid,'production_writes':0}))
raise SystemExit(0 if valid else 1)
