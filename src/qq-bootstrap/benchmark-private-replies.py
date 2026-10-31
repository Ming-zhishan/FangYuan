"""Replay the real missed question through the repair, using the actual local model."""
import asyncio
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import time

from private_replies import PrivateReplies
from character_retrieval import ReviewedRetrieval

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('channel',Path(__file__).with_name('character-channel.py'))
channel=importlib.util.module_from_spec(spec)
spec.loader.exec_module(channel)


async def main(argv=None):
    p=argparse.ArgumentParser()
    p.add_argument('--case',choices=['all','shadow'],default='all')
    args=p.parse_args(argv)
    capture=json.loads((ROOT/'work/logs/private-slow-failure-capture.json').read_text(encoding='utf-8'))
    report={'scope':'真实漏答问题的本地重放，实际模型和检索；未向QQ发送这些测试输出','qq_messages_sent':0,'cases':[]}
    with tempfile.TemporaryDirectory() as folder:
        boundary=channel.Boundary('2449113325',channel.EvidenceMemory(Path(folder)/'evidence.db'),mode='private_test')
        engine=PrivateReplies(boundary,ReviewedRetrieval(cpu=True),database=Path(folder)/'dialogue.db')
        sent=[]
        async def send(action):
            sent.append(action)
            return {'status':'ok','data':{'message_id':len(sent)}}
        try:
            queries=[capture['question'],'我纠结点什么外卖','仙蛊唯一是什么意思？','紫山真君为什么把影宗交给你？']
            if args.case=='shadow':
                queries=queries[-1:]
            for i,text in enumerate(queries):
                event={'post_type':'message','message_type':'private','user_id':'2449113325','message_id':'benchmark-'+str(i),
                       'message':[{'type':'text','data':{'text':text}}]}
                tick=time.monotonic()
                task=engine.submit(event,send)
                await task
                elapsed=round(time.monotonic()-tick,3)
                assert len(sent)==i+1, 'Direct question was silently dropped'
                answer=sent[-1]['params']['message']
                report['cases'].append({'query':text,'seconds':elapsed,'answer':answer,'single_final_message':True})
                (ROOT/'work/logs'/('private-speed-replay.json' if args.case=='all' else 'private-factual-thinking.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
                print(json.dumps(report['cases'][-1],ensure_ascii=True),flush=True)
                assert '没处理完' not in answer, 'Timeout feedback is not a substantive answer'
                if text==capture['question']:
                    assert '九转' in answer, 'Missed question still not answered substantively'
                if i>0 and '为什么' not in text:
                    assert elapsed<12, 'Warm private reply exceeds the latency acceptance limit'
        finally:
            await engine.close()


if __name__=='__main__':
    asyncio.run(main())
