import asyncio,json,tempfile,time,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from account_brand import apply,validate,digest
from conversation_journal import ConversationJournal
from character.culture import context,FRIENDS
class BrandCultureTests(unittest.IsolatedAsyncioTestCase):
 async def test_approval_scope_and_at_most_once(self):
  plan={'account':'3816636861','action':'send_qzone_msg','content':'理论先成尊，证据还在一转。','ugc_right':16,'target_uins':['2449113325']}
  with tempfile.TemporaryDirectory() as t:
   approval=Path(t)/'approval';state=Path(t)/'state';send=AsyncMock(side_effect=[{'status':'ok','data':{'user_id':'3816636861'}},{'status':'ok','data':{'tid':'mock'}}])
   with self.assertRaises(PermissionError):await apply(plan,send,approval_file=approval,state_file=state)
   send.assert_not_awaited()
   with self.assertRaises(ValueError):validate({**plan,'ugc_right':1})
   with self.assertRaises(ValueError):validate({**plan,'target_uins':['999']})
   approval.write_text(json.dumps({'approved_sha256':digest(plan),'user_confirmed':True}),encoding='utf-8')
   await apply(plan,send,approval_file=approval,state_file=state)
   with self.assertRaises(ValueError):await apply(plan,send,approval_file=approval,state_file=state)
   self.assertEqual(send.await_count,2)
 def test_group_culture_does_not_learn_from_replayed_duplicates(self):
  with tempfile.TemporaryDirectory() as t:
   j=ConversationJournal(Path(t)/'j');e={'group_id':'680823437','user_id':'123','message_id':'1','time':time.time()}
   for _ in range(3):j.observe(e,'我信大睡理论')
   self.assertFalse(j.cultural_context('大睡理论'))
   j.observe({**e,'message_id':'2'},'大睡理论可行')
   self.assertIn('非正典',j.cultural_context('大睡理论'))
   self.assertFalse(j.cultural_context('今天吃什么'))
 def test_fan_and_fixed_identity_are_separate(self):
  self.assertIn('非原著',context('落魄谷中寒风吹'))
  self.assertIn('黄梓涵',FRIENDS['2171196385'])
  self.assertEqual(len(FRIENDS),5)
