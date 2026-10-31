"""Download an official local-only candidate; never remove or switch the production model."""
import json
from pathlib import Path
import time
import httpx

ROOT=Path(__file__).resolve().parents[3]
with httpx.Client(base_url='http://127.0.0.1:11434',trust_env=False,timeout=httpx.Timeout(1800,read=120)) as client:
    last=0
    with client.stream('POST','/api/pull',json={'model':'qwen3.5:9b','stream':True}) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if not line:
                continue
            data=json.loads(line)
            if data.get('error'):
                raise RuntimeError(data['error'])
            if time.monotonic()-last>20 or data.get('status')=='success':
                print(json.dumps({k:v for k,v in data.items() if k in {'status','completed','total'}},ensure_ascii=False),flush=True)
                last=time.monotonic()
    (ROOT/'work/diag04/candidate-pull.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
