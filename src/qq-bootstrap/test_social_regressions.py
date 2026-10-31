import asyncio,tempfile,time,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from chat_perception import qq_message_text
from group_replies import GroupReplies
from character.runtime import CharacterRuntime
class SocialRegressionTests(unittest.IsolatedAsyncioTestCase):
 def test_face_transport_and_builtin(self):
  self.assertEqual(qq_message_text({'message':[{'type':'face','data':{'id':'182'}}]}),'[表情:笑哭]')
  self.assertEqual(qq_message_text({'message':[{'type':'face','data':{'id':'9999','raw':{'faceText':'[贴贴]'}}}]}),'[表情:贴贴]')
 def test_followup_addressing_someone_else_is_not_direct(self):
  g=GroupReplies.__new__(GroupReplies);g.boundary=SimpleNamespace(allowed_event=lambda e:True);g.last_peer='123';g.last_peer_at=time.monotonic()
  e={'post_type':'message','message_type':'group','group_id':'680823437','user_id':'123','message_id':'m','message':[{'type':'at','data':{'qq':'456'}},{'type':'text','data':{'text':'方源是不是没回你'}}]}
  self.assertFalse(g.should_direct(e))
 async def test_invented_gu_is_banter_without_vector_search(self):
  with tempfile.TemporaryDirectory() as t:
   search=AsyncMock(return_value=[]);r=CharacterRuntime(SimpleNamespace(search=search),world_path=Path(t)/'w',social_path=Path(t)/'s',owner='123')
   c=await r.prepare('我会炼jj变大蛊','123','group:680823437','new')
   search.assert_not_awaited()
   self.assertIn('自创',c['system'])
   self.assertTrue(r.check('蛊方讲究君臣佐使，药性相合。',c))
class CanonFollowupTests(unittest.IsolatedAsyncioTestCase):
 async def test_followup_keeps_canonical_evidence_across_provider_fallback(self):
  with tempfile.TemporaryDirectory() as t:
   r=CharacterRuntime(SimpleNamespace(search=AsyncMock(return_value=[])),world_path=Path(t)/'w',social_path=Path(t)/'s',owner='123')
   history=[{'role':'user','content':'你以前有没有看走眼过？'},{'role':'assistant','content':'三王传承那回，我被白凝冰和铁若男反制。'}]
   c=await r.prepare('你那时候怎么翻盘的？','123','group:680823437','followup',history)
   self.assertIn('K-THREE',c['references'])
   self.assertTrue(r.check('后来我故意放水，等她们松懈时反手翻盘。',c))
   self.assertTrue(r.check('那轮被反制了，后来换路子，改炼定仙游脱身。',c))
   self.assertFalse(r.check('那次被反制后，我用了春秋蝉重生，后来改炼定仙游。',c))
 async def test_invented_local_inventory_is_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   r=CharacterRuntime(SimpleNamespace(search=AsyncMock(return_value=[])),world_path=Path(t)/'w',social_path=Path(t)/'s',owner='123')
   c=await r.prepare('我会炼jj变大蛊','123','group:680823437','fake',[])
   self.assertTrue(r.check('我这儿有本《蛊界禁忌录》，拿给你看看。',c))
class LocalGroundingTests(unittest.IsolatedAsyncioTestCase):
 async def test_local_model_cannot_expand_injected_lived_memory(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as t:
   r=CharacterRuntime(SimpleNamespace(search=AsyncMock(return_value=[])),world_path=Path(t)/'w',social_path=Path(t)/'s',owner='123')
   invented='后来我故意放水，反手击败了所有敌人。'
   client=SimpleNamespace(post=AsyncMock(return_value=SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'character_route':'local','model':'fangyuan-eightb:latest','message':{'content':invented}})))
   manager=AsyncMock();manager.__aenter__.return_value=client
   with patch('character.runtime.httpx.AsyncClient',return_value=manager):
    answer=await r.generate('刚被朋友坑了，你以前有没有看走眼过？','123','group:680823437','local-memory',[])
   self.assertTrue(r.last_trace['memory_candidates'])
   self.assertNotEqual(answer,invented)
   self.assertTrue(r.last_trace['fallback'])
   self.assertEqual(client.post.await_count,1)
 async def test_direct_ollama_without_gateway_keeps_canonical_fallback(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as t:
   r=CharacterRuntime(SimpleNamespace(search=AsyncMock(return_value=[])),world_path=Path(t)/'w',social_path=Path(t)/'s',owner='123')
   invented='故意放水就解决了。'
   client=SimpleNamespace(post=AsyncMock(return_value=SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'model':'fangyuan-eightb:latest','message':{'content':invented}})))
   manager=AsyncMock();manager.__aenter__.return_value=client
   with patch('character.runtime.ROOT',Path(t)),patch('character.runtime.httpx.AsyncClient',return_value=manager):
    answer=await r.generate('三王传承后来怎么脱身的？','123','group:680823437','no-gateway',[])
   self.assertNotEqual(answer,invented)
   self.assertIn('重生',answer)
   self.assertTrue(r.last_trace['fallback'])
if __name__=='__main__':unittest.main()
