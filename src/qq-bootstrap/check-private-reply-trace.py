"""Reproduce the reported unanswered question from the actual captured server trace."""
from pathlib import Path
import argparse
import asyncio
import importlib.util
import json
import re

ROOT=Path(__file__).resolve().parents[2]


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--capture',action='store_true')
    p.add_argument('--replay',action='store_true')
    args=p.parse_args()
    if args.replay:
        spec=importlib.util.spec_from_file_location('private_benchmark',Path(__file__).with_name('benchmark-private-replies.py'))
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        asyncio.run(module.main([]))
        return
    capture=ROOT/'work/logs/private-slow-failure-capture.json'
    if args.capture:
        text=(ROOT/'work/logs/maibot.err.log').read_text(encoding='utf-8-sig')
        text=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',text)
        start=text.rfind('\n',0,text.index('你现在实力咋样'))+1
        trace=text[start:]
        records=[line for line in trace.splitlines() if any(term in line for term in ['你现在实力咋样','Planner 已结束本轮思考','[消息发送服务]','你怎么不回我'])]
        capture.write_text(json.dumps({'question':'你现在实力咋样','source_message_id':'459896753','received_at':'2026-10-21T20:27:59+08:00','trace':records},ensure_ascii=False,indent=2),encoding='utf-8')
    data=json.loads(capture.read_text(encoding='utf-8'))
    answered=any('[消息发送服务]' in line for line in data['trace'])
    print(json.dumps({'question_received':True,'planner_ended_without_reply':not answered,'trace_records':len(data['trace'])}))
    assert answered, 'Received a direct private question, but no answer was sent before the next complaint'


if __name__=='__main__':
    main()
