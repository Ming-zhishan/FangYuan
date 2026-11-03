import asyncio,tempfile,unittest,time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from group_replies import GroupReplies,BOT,GROUP
class ConversationUpgradeTests(unittest.IsolatedAsyncioTestCase):
 async def test_continuation_and_burst_are_one_reply(self):
  with tempfile.TemporaryDirectory() as t:
   boundary=SimpleNamespace(friend='123',mode='both',allowed_event=lambda e:True)
   gen=AsyncMock(return_value='醒了再签。');send=AsyncMock(return_value={'status':'ok','data':{'message_id':'sent'}})
   g=GroupReplies(boundary,SimpleNamespace(search=AsyncMock(return_value=[])),database=Path(t)/'d',generate=gen)
   g.character=SimpleNamespace(commit=lambda *a:None)
   def ev(mid,body,at=False):return {'post_type':'message','message_type':'group','group_id':GROUP,'user_id':'123','message_id':mid,'message':([{'type':'at','data':{'qq':BOT}}] if at else [])+[{'type':'text','data':{'text':body}}]}
   a=g.submit(ev('a','大睡理论怎么样',True),send)
   await asyncio.sleep(.02)
   self.assertTrue(g.should_direct(ev('b','炼出来你敢吃吗')))
   b=g.submit(ev('b','炼出来你敢吃吗',True),send)
   await asyncio.gather(a,b,return_exceptions=True)
   self.assertEqual(send.await_count,1)
   self.assertIn('大睡理论',gen.call_args.args[1]);self.assertIn('敢吃',gen.call_args.args[1])
   self.assertTrue(g.should_direct(ev('c','再给我留一口')))
   g.observe(ev('end','先睡了'))
   self.assertFalse(g.should_direct(ev('later','再给我留一口')))
   await g.close()
