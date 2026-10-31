import asyncio,importlib.util,json,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch,AsyncMock
from types import SimpleNamespace
import httpx
import cloud_gateway as g
spec=importlib.util.spec_from_file_location('channel',Path(__file__).with_name('character-channel.py'))
channel=importlib.util.module_from_spec(spec);spec.loader.exec_module(channel)
class GuardTests(unittest.IsolatedAsyncioTestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();p=Path(self.tmp.name)
  self.cfg={'mode':'cloud','model':'qwen3.8-2.4t-a95b','gateway_token':'test','free_only_verified':{'qwen3.8-2.4t-a95b':True},'stop_at_unix':{'qwen3.8-2.4t-a95b':time.time()+30},'free_token_ceiling':{'qwen3.8-2.4t-a95b':5000}}
  self.state=p/'state.json';self.state.write_text(json.dumps(self.cfg),encoding='utf-8')
  self.patch=patch.multiple(g,STATE=self.state,DB=p/'usage.sqlite3');self.patch.start()
 def tearDown(self):self.patch.stop();self.tmp.cleanup()
 def test_free_guards_and_persistent_reservation(self):
  msg=[{'role':'user','content':'hi'}];g.reserve(self.cfg,self.cfg['model'],msg)
  with self.assertRaises(ValueError):g.reserve(self.cfg,self.cfg['model'],msg)
  for cfg in ({**self.cfg,'free_only_verified':{}},{**self.cfg,'stop_at_unix':{self.cfg['model']:0}}):
   with self.assertRaises(ValueError):g.reserve(cfg,self.cfg['model'],msg)
  with self.assertRaises(ValueError):g.reserve(self.cfg,'unapproved-model',msg)
 def test_legacy_reasoning_is_reserved_against_cumulative_stop(self):
  import sqlite3
  from contextlib import closing
  model=self.cfg['model'];cfg={**self.cfg,'usage_accounting_v2_since':time.time()-10}
  with closing(sqlite3.connect(g.DB)) as db,db:
   db.execute('CREATE TABLE calls(id TEXT PRIMARY KEY,model TEXT,held INTEGER,actual INTEGER,created REAL,status TEXT)')
   db.execute('INSERT INTO calls VALUES(?,?,?,?,?,?)',('old',model,1600,1600,time.time()-100,'complete'))
  # 1600 old receipt + 512 omitted reasoning + ~3138 new reservation > 5000.
  with self.assertRaisesRegex(ValueError,'local_free_reserve_exhausted'):g.reserve(cfg,model,[{'role':'user','content':'hi'}])
  with closing(sqlite3.connect(g.DB)) as db:self.assertEqual(db.execute('SELECT actual FROM calls WHERE id=?',('old',)).fetchone()[0],1600)
 def test_coupon_daily_budget_and_total_usage_guards(self):
  model=self.cfg['model'];msg=[{'role':'user','content':'hi'}]
  with self.assertRaisesRegex(ValueError,'coupon_mode'):g.reserve({**self.cfg,'coupon_mode':True},model,msg)
  with self.assertRaisesRegex(ValueError,'daily_free_budget'):g.reserve({**self.cfg,'daily_token_ceiling':1},model,msg)
  ident,amount=g.reserve(self.cfg,model,msg);g.settle(ident,amount,{'prompt_tokens':3,'completion_tokens':4,'total_tokens':9})
  g.settle(ident,amount,{'prompt_tokens':3,'completion_tokens':4,'total_tokens':7,'completion_tokens_details':{'text_tokens':4,'reasoning_tokens':5}})
  import sqlite3
  from contextlib import closing
  with closing(sqlite3.connect(g.DB)) as db:self.assertEqual(db.execute('SELECT actual FROM calls WHERE id=?',(ident,)).fetchone()[0],12)
  with self.assertRaisesRegex(ValueError,'missing_usage'):g.settle(ident,amount,{'prompt_tokens':3,'completion_tokens':4,'total_tokens':1})
  g.disable_cloud('daily_free_budget_exhausted');self.assertEqual(g.settings()['mode'],'cloud')
 async def test_unauthorized_requests_never_generate(self):
  async with httpx.AsyncClient(transport=httpx.ASGITransport(app=g.app),base_url='http://localhost') as c:
   with patch.object(g,'generate',new_callable=AsyncMock) as gen:
    r=await c.post('/api/chat',json={'messages':[]});self.assertEqual(r.status_code,401);gen.assert_not_awaited()
 async def test_cloud_403_latches_local_and_never_changes_cloud_model(self):
  seen=[]
  class Client:
   async def __aenter__(self):return self
   async def __aexit__(self,*args):pass
   async def post(self,url,**kwargs):
    seen.append(url)
    if url.startswith(g.BASE):return httpx.Response(403,request=httpx.Request('POST',url))
    return httpx.Response(200,json={'message':{'role':'assistant','content':'本地回答'},'eval_count':4},request=httpx.Request('POST',url))
  with patch.object(g.httpx,'AsyncClient',return_value=Client()),patch.object(g,'unprotect',return_value='FAKE-SECRET'):
   p,route=await g.generate([{'role':'user','content':'你好'}]);self.assertEqual(route,'local');self.assertEqual(p['model'],'fangyuan-eightb:latest')
   await g.generate([{'role':'user','content':'再问'}])
  self.assertEqual(sum(u.startswith(g.BASE) for u in seen),1)
  self.assertEqual(g.settings()['mode'],'local')
 def test_transient_timeout_does_not_silently_switch_future_turns_to_8b(self):
  g.disable_cloud('ReadTimeout');self.assertEqual(g.settings()['mode'],'cloud')
  g.disable_cloud('context_too_large');self.assertEqual(g.settings()['mode'],'cloud')
  g.disable_cloud('http_429');self.assertEqual(g.settings()['mode'],'cloud')
  g.disable_cloud('http_403');self.assertEqual(g.settings()['mode'],'local')
 def test_combined_mode_keeps_both_whitelists_and_blocks_other_people(self):
  mem=channel.EvidenceMemory(Path(self.tmp.name)/'memory.db');b=channel.Boundary('2449113325',mem,mode='both')
  self.assertTrue(b.allowed_event({'message_type':'private','user_id':'2449113325'}))
  self.assertTrue(b.allowed_event({'message_type':'group','user_id':'123','group_id':'680823437'}))
  self.assertFalse(b.allowed_event({'message_type':'private','user_id':'123'}))
  self.assertFalse(b.allowed_event({'message_type':'group','user_id':'123','group_id':'1'}))
  for action,params in [('send_private_msg',{'user_id':'2449113325','message':'hi'}),('send_group_msg',{'group_id':'680823437','message':'hi'})]:self.assertIsNotNone(b.outbound({'action':action,'params':params}))
  self.assertIsNone(b.outbound({'action':'send_private_msg','params':{'user_id':'123','message':'hi'}}))
if __name__=='__main__':unittest.main()
