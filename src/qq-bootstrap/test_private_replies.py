"""Regressions for missing direct questions, stale replies, timeout and duplicate events."""
import asyncio
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

from private_replies import PrivateReplies
spec=importlib.util.spec_from_file_location('channel',Path(__file__).with_name('character-channel.py'))
channel=importlib.util.module_from_spec(spec)
spec.loader.exec_module(channel)


class PrivateReplyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        folder=Path(self.tmp.name)
        self.boundary=channel.Boundary('2449113325',channel.EvidenceMemory(folder/'evidence.db'),mode='private_test')
        self.folder=folder
        self.sent=[]
        self.engine=None

    async def asyncTearDown(self):
        if self.engine:
            await self.engine.close()
        self.tmp.cleanup()

    def event(self,text='你现在实力咋样',mid='459896753',uid='2449113325'):
        return {'post_type':'message','message_type':'private','user_id':uid,'message_id':mid,'message':[{'type':'text','data':{'text':text}}]}

    async def send(self,action):
        self.sent.append(action)
        return {'status':'ok','data':{'message_id':len(self.sent)}}

    def make(self,generate,deadline=.2):
        self.engine=PrivateReplies(self.boundary,None,database=self.folder/'dialogue.db',generate=generate,deadline=deadline)
        return self.engine

    async def test_reported_question_gets_one_answer_without_a_planner(self):
        calls=[]
        async def generate(event,text,history):
            calls.append(text)
            return '我已是九转炼道尊者，但还没有得到永生。'
        engine=self.make(generate)
        await engine.submit(self.event(),self.send)
        self.assertEqual(calls,['你现在实力咋样'])
        self.assertEqual(len(self.sent),1)
        self.assertIn('九转',self.sent[0]['params']['message'])

    async def test_newest_message_preempts_old_generation_and_keeps_context(self):
        started=asyncio.Event()
        histories=[]
        inputs=[]
        async def generate(event,text,history):
            if text=='旧问题':
                started.set()
                await asyncio.sleep(10)
            histories.append(history)
            inputs.append(text)
            return '回答最新问题'
        engine=self.make(generate)
        old=engine.submit(self.event('旧问题','1'),self.send)
        await started.wait()
        new=engine.submit(self.event('最新问题','2'),self.send)
        await new
        await asyncio.gather(old,return_exceptions=True)
        self.assertEqual([x['params']['message'] for x in self.sent],['回答最新问题'])
        self.assertIn('旧问题',inputs[0])
        self.assertIn('最新问题',inputs[0])
        self.assertTrue(any('旧问题' in m['content'] for m in engine.history('2449113325','next')))

    async def test_timeout_is_explicit_instead_of_silence(self):
        async def generate(*args):
            await asyncio.sleep(10)
        engine=self.make(generate,deadline=.02)
        await engine.submit(self.event(),self.send)
        self.assertEqual(len(self.sent),1)
        self.assertIn('没处理完',self.sent[0]['params']['message'])

    async def test_duplicate_and_other_account_do_not_generate(self):
        async def generate(*args):
            return '在。'
        engine=self.make(generate)
        await engine.submit(self.event(),self.send)
        self.assertIsNone(engine.submit(self.event(),self.send))
        self.assertIsNone(engine.submit(self.event(uid='123',mid='other'),self.send))
        self.assertEqual(len(self.sent),1)

    async def test_casual_report_timeout_does_not_request_a_shorter_question(self):
        async def generate(*args):
            await asyncio.sleep(10)
        engine=self.make(generate,deadline=.02)
        await engine.submit(self.event('我要上厕所','casual-timeout'),self.send)
        self.assertEqual(self.sent[0]['params']['message'],'去吧。')


if __name__=='__main__':
    unittest.main()
