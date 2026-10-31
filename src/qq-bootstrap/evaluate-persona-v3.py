"""Exercise live local generation with held-out phrasing and multi-turn contexts; no QQ sends."""
import argparse
import asyncio
import importlib.util
import json
from pathlib import Path
import tempfile
import time

from character_retrieval import ReviewedRetrieval
from private_replies import PrivateReplies

ROOT=Path(__file__).resolve().parents[2]
QUESTIONS=[('P01','你现在实力咋样？'),('P02','你在做什么？'),('P03','你怎么不回我？'),
 ('P04','明天会更好吗？'),('P05','我要撒泡尿。'),('P06','你怎么像个人机？'),
 ('P07','你最喜欢的女子是谁？'),('P08','你怎么看凤九歌？'),('P09','你怎么看红莲魔尊？'),
 ('P10','你觉得宿命是什么？'),('P11','假如我明知道会失败，还值得继续坚持吗？')]
spec=importlib.util.spec_from_file_location('channel',Path(__file__).with_name('character-channel.py'))
channel=importlib.util.module_from_spec(spec)
spec.loader.exec_module(channel)


async def main():
    p=argparse.ArgumentParser()
    p.add_argument('--label',required=True)
    p.add_argument('--ids',default='')
    p.add_argument('--multi',action='store_true')
    args=p.parse_args()
    cases=[x for x in QUESTIONS if not args.ids or x[0] in args.ids.split(',')]
    report={'label':args.label,'model':'fangyuan-eightb:latest','qq_messages_sent':0,'cases':[]}
    with tempfile.TemporaryDirectory() as folder:
        folder=Path(folder)
        boundary=channel.Boundary('2449113325',channel.EvidenceMemory(folder/'evidence.db'),mode='private_test')
        engine=PrivateReplies(boundary,ReviewedRetrieval(cpu=True),database=folder/'dialogue.db')
        history=[]
        for uid,text in cases:
            engine.character.last_trace={}
            event={'post_type':'message','message_type':'private','user_id':'2449113325','message_id':'eval-'+args.label+'-'+uid,
                'message':[{'type':'text','data':{'text':text}}]}
            tick=time.monotonic()
            try:
                answer=await asyncio.wait_for(engine.model_reply(event,text,history if args.multi else []),timeout=30)
                error=None
            except Exception as exc:
                answer=''
                error=type(exc).__name__
            row={'id':uid,'query':text,'answer':answer,'seconds':round(time.monotonic()-tick,3),'error':error,
                 'trace':engine.character.last_trace}
            report['cases'].append(row)
            if args.multi and answer:
                engine.character.commit(text,answer,'2449113325','private:2449113325',event['message_id'])
                history += [{'role':'user','content':text},{'role':'assistant','content':answer}]
            (ROOT/'work/logs'/('persona-'+args.label+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps({'case':uid,'seconds':row['seconds'],'error':error}),flush=True)
        await engine.close()


if __name__=='__main__':
    asyncio.run(main())
