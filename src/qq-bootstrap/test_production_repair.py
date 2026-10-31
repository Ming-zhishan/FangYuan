import asyncio,tempfile,unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
from character.runtime import CharacterRuntime
from character.culture import context
from character.prompts import style_intent
from conversation_journal import ConversationJournal
from group_replies import GroupReplies
import cloud_gateway as gateway

class ProductionRepairTests(unittest.IsolatedAsyncioTestCase):
 def runtime(self,t):
  return CharacterRuntime(SimpleNamespace(search=AsyncMock(return_value=[])),world_path=Path(t)/'w',social_path=Path(t)/'s',owner='2449113325')
 async def test_idle_never_calls_generation_or_transport(self):
  g=GroupReplies.__new__(GroupReplies);g.generate=AsyncMock();send=AsyncMock()
  for hour in (3,12,23):self.assertFalse(await g.idle_once(send,hour=hour))
  g.generate.assert_not_awaited();send.assert_not_awaited()
 async def test_only_nearest_actual_answer_can_ground_followup(self):
  with tempfile.TemporaryDirectory() as t:
   r=self.runtime(t)
   history=[{'role':'assistant','content':'三王传承那回遭白凝冰反制。'},
            {'role':'user','content':'电鳗发电机'}, {'role':'assistant','content':'这广告又追到群里了。'}]
   c=await r.prepare('你那时候怎么做到的？','2171196385','group:680823437','new',history)
   self.assertNotIn('K-THREE',c['references'])
   idle=await r.prepare('不要改写上次聊天','2171196385','group:680823437','idle-1',history[:1])
   self.assertNotIn('K-THREE',idle['references'])
 async def test_untrusted_local_casual_output_is_not_sent_as_persona(self):
  with tempfile.TemporaryDirectory() as t:
   r=self.runtime(t);invented='黄梓涵现在在哪？一起搞点事，我这道馆不收闲人。'
   response=SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'character_route':'local','model':'fangyuan-eightb:latest','message':{'content':invented}})
   manager=AsyncMock();manager.__aenter__.return_value=SimpleNamespace(post=AsyncMock(return_value=response))
   with patch('character.runtime.httpx.AsyncClient',return_value=manager):
    direct=await r.generate('来个电鳗发电机','2171196385','group:680823437','local1')
    ambient=await r.generate('来个电鳗发电机','2171196385','group:680823437','local2',ambient=True)
   self.assertNotEqual(direct,invented);self.assertEqual(ambient,'[沉默]')
   self.assertTrue(r.last_trace['fallback'])
 async def test_unfounded_third_party_invitation_is_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   r=self.runtime(t);c=await r.prepare('来个电鳗发电机','2807839774','group:680823437','third')
   self.assertTrue(r.check('黄梓涵现在在哪？一起搞点事？',c))
   self.assertFalse(r.check('这广告都追到群里来了。',c))
 def test_word_sense_is_scoped_and_literal_context_wins(self):
  self.assertIn('指自慰',context('你喜欢道馆吗',scope='group:680823437'))
  self.assertNotIn('指自慰',context('你喜欢道馆吗',scope='private:2449113325'))
  literal=context('下个道馆在哪',history=[{'role':'user','content':'我正在玩宝可梦，差最后一枚徽章'}],scope='group:680823437')
  self.assertIn('明确字面线索',literal);self.assertNotIn('指自慰',literal)
  self.assertIn('七日世界',context('七日世界电鳗发电机怎么造',scope='group:680823437'))
  self.assertIn('抱怨交流体验',style_intent('你叽里呱啦说什么'))
 def test_delivery_claim_survives_restart_and_competing_consumers(self):
  with tempfile.TemporaryDirectory() as t:
   path=Path(t)/'j';a=ConversationJournal(path);b=ConversationJournal(path)
   with ThreadPoolExecutor(2) as pool:
    results=list(pool.map(lambda journal:journal.claim_delivery('reply:123'),[a,b]))
   self.assertEqual(sum(results),1)
   # A timeout/crash after the pending claim does not permit an automatic resend.
   self.assertFalse(ConversationJournal(path).claim_delivery('reply:123'))
   a.finish_delivery('reply:123','ok');self.assertFalse(b.claim_delivery('reply:123'))
   a.observe({'group_id':'680823437','user_id':'1','message_id':'old'},'已答问题')
   a.answered('old');self.assertFalse(b.claim_delivery('reply:old'))
 def test_daily_warning_does_not_bypass_cumulative_or_coupon_guards(self):
  with tempfile.TemporaryDirectory() as t,patch.object(gateway,'DB',Path(t)/'usage'):
   import time
   model='qwen3.8-2.4t-a95b';cfg={'daily_budget_action':'warn','daily_token_ceiling':1,'free_only_verified':{model:True},'free_token_ceiling':{model:5000},'stop_at_unix':{model:time.time()+60}}
   messages=[{'role':'user','content':'你好'}]
   gateway.reserve(cfg,model,messages)
   with self.assertRaisesRegex(ValueError,'local_free_reserve_exhausted'):gateway.reserve(cfg,model,messages)
   with self.assertRaisesRegex(ValueError,'coupon_mode_not_authorized'):gateway.reserve({**cfg,'coupon_mode':True},model,messages)

 async def test_context_feedback_and_unsupported_definition_guards(self):
  with tempfile.TemporaryDirectory() as t:
   r=self.runtime(t)
   c=await r.prepare('你叽里呱啦说什么','2171196385','group:680823437','feedback')
   # The instruction lives in the system prompt; the last turn stays the bare
   # utterance so the model does not answer a line from the history instead.
   self.assertIn('批评你上一答',r.messages(c)[0]['content'])
   self.assertTrue(r.messages(c)[-1]['content'].endswith('你叽里呱啦说什么'))
   c=await r.prepare('黄毛理论算不算执行到位','2171196385','group:680823437','definition')
   self.assertTrue(r.check('黄毛理论的核心是你得先有个对象。',c))

if __name__=='__main__':unittest.main()
