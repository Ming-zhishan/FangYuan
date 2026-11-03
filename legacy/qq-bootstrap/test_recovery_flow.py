import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from conversation_journal import recover
import unittest,tempfile,time
from pathlib import Path
from conversation_journal import ConversationJournal,BOT,GROUP
class RecoveryFlowTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.j=ConversationJournal(Path(self.tmp.name)/'j.sqlite3');self.now=time.time()
 def tearDown(self):self.tmp.cleanup()
 def event(self):return {'message_id':'m','time':self.now-60,'user_id':'123','group_id':GROUP,'message':[{'type':'at','data':{'qq':BOT}},{'type':'text','data':{'text':'这个要怎么做？'}}]}
 def test_baseline_and_reconnect_are_bounded(self):
  async def run():
   e=self.event();send=AsyncMock(return_value={'status':'ok','data':{'messages':[e]}})
   group=SimpleNamespace(journal=self.j,submit=lambda e,s:None)
   await recover(group,send)
   self.assertEqual(send.await_count,1) # first-install baseline never sends a message
   self.j.put('recovery_watermark',self.now-500)
   await recover(group,send)
   actions=[c.args[0]['action'] for c in send.await_args_list]
   self.assertEqual(actions.count('send_group_msg'),1)
   await recover(group,send)
   actions=[c.args[0]['action'] for c in send.await_args_list]
   self.assertEqual(actions.count('send_group_msg'),1)
  asyncio.run(run())

 def test_failed_history_processing_does_not_advance_recovery_cursor(self):
  async def run():
   old=self.now-500;self.j.put('recovery_watermark',old);self.j.put('watermark',self.now)
   e=self.event();send=AsyncMock(return_value={'status':'ok','data':{'messages':[e]}})
   def fail(e,s):raise RuntimeError('simulated interruption')
   await recover(SimpleNamespace(journal=self.j,submit=fail),send)
   self.assertEqual(self.j.get('recovery_watermark'),old)
   self.assertFalse(self.j.claim('m')) # uncertain attempt cannot be duplicated
  asyncio.run(run())
