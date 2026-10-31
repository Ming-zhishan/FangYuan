import asyncio,json,tempfile,time,unittest
from pathlib import Path
from unittest.mock import AsyncMock,patch
from types import SimpleNamespace
import httpx
import tongji_provider as t
import cloud_gateway as g
from account_tasks import AccountTasks

class SchoolTests(unittest.IsolatedAsyncioTestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  self.cfg={**t.DEFAULTS,'enabled':True,'free_only_verified':True,'synthetic_use_verified':True,'model_verified':True,'model':'DeepSeek1017','verification_expires_at':time.time()+1000,'qq_use_verified':True,'external_friend_data_verified':True}
  self.pathpatch=patch.multiple(t,DB=self.root/'usage.sqlite',_slot=asyncio.Semaphore(1),_cooldown_until=0);self.pathpatch.start()
  self.cfgpatch=patch.object(t,'settings',return_value=self.cfg);self.cfgpatch.start()
  self.keypatch=patch.object(t,'credential',return_value='FAKE-NEW-KEY-DO-NOT-LOG');self.keypatch.start()
 def tearDown(self):self.pathpatch.stop();self.cfgpatch.stop();self.keypatch.stop();self.tmp.cleanup()
 def client(self,payload=None,*,status=200,kind='application/json',raw=None):
  self.sent=[]
  payload=payload or {'model':'upstream-display-name','choices':[{'message':{'content':'<think>private reasoning</think>你这需求转得够快。','reasoning_content':'private reasoning'},'finish_reason':'stop'}],'usage':{'prompt_tokens':10,'completion_tokens':15,'total_tokens':25}}
  content=raw if raw is not None else json.dumps(payload).encode()
  sent=self.sent
  class Response:
   status_code=status;headers={'content-type':kind}
   async def __aenter__(self):return self
   async def __aexit__(self,*args):pass
   async def aiter_bytes(self):yield content
  class Client:
   async def __aenter__(self):return self
   async def __aexit__(self,*args):pass
   def stream(self,method,url,**kwargs):sent.append((method,url,kwargs));return Response()
  return patch.object(t.httpx,'AsyncClient',return_value=Client())
 async def test_school_request_uses_official_endpoint_and_portable_fields(self):
  with self.client():p,route=await t.generate([{'role':'user','content':'合成测试'}])
  self.assertEqual(route,'tongji-school');self.assertEqual(p['model'],'DeepSeek1017')
  self.assertEqual(p['choices'][0]['message']['content'],'你这需求转得够快。')
  self.assertNotIn('reasoning',json.dumps(p))
  req=self.sent[0];self.assertEqual(req[1],t.BASE+'/chat/completions')
  self.assertEqual(set(req[2]['json']),{'model','messages','max_tokens','stream','temperature'})
  self.assertFalse(req[2]['json']['stream']);self.assertFalse(req[2].get('follow_redirects',False))
 async def test_no_policy_or_unapproved_friend_data_never_sends(self):
  for field in ('enabled','free_only_verified','synthetic_use_verified','qq_use_verified','external_friend_data_verified','model_verified'):
   with patch.object(t,'settings',return_value={**self.cfg,field:False}),patch.object(t.httpx,'AsyncClient') as client:
    with self.assertRaises(t.Blocked):await t.generate([{'role':'user','content':'not sent'}])
    client.assert_not_called()
 async def test_synthetic_permission_does_not_unlock_qq(self):
  self.cfg.update(qq_use_verified=False,external_friend_data_verified=False)
  with self.client():await t.generate([{'role':'user','content':'only synthetic'}],scope='synthetic')
  with self.assertRaises(t.Blocked):await t.generate([{'role':'user','content':'not authorized'}],scope='qq')
 def test_expiry_endpoint_and_proxy_are_strict(self):
  for cfg in ({**self.cfg,'base_url':'https://api.deepseek.com/v1'},{**self.cfg,'base_url':t.BASE+'@evil.example'},{**self.cfg,'proxy_url':'http://unverified-proxy.example:80'},{**self.cfg,'verification_expires_at':0}):
   with self.assertRaises(t.Blocked):t.verify(cfg,'qq')
 def test_new_key_rotation_confirmation_is_mandatory(self):
  self.keypatch.stop()
  with patch.object(t,'CREDENTIAL',self.root/'missing.json'),patch.object(t,'unprotect') as read:
   with self.assertRaisesRegex(t.Blocked,'rotation'):t.credential()
   read.assert_not_called()
 def test_stale_environment_key_cannot_override_new_protected_key(self):
  self.keypatch.stop()
  meta=self.root/'credential.json';meta.write_text(json.dumps({'new_key_confirmed':True,'old_key_revoked_confirmed':True,'storage':'Windows DPAPI CurrentUser'}))
  keyfile=self.root/'new.dpapi';keyfile.write_bytes(b'fixture')
  with patch.object(t,'CREDENTIAL',meta),patch.object(t,'KEY',keyfile),patch.object(t,'unprotect',return_value='FAKE-FRESH-KEY-SYNTHETIC'),patch.dict('os.environ',{'TONGJI_LLM_API_KEY':'FAKE-OLD-KEY-NEVER-USE'}):
   self.assertEqual(t.credential(),'FAKE-FRESH-KEY-SYNTHETIC')
 def test_embedded_reasoning_split_and_incomplete_tags(self):
  self.assertEqual(t.content_only('<think>x</think>正文'),'正文')
  self.assertEqual(t.content_only('tail reasoning</think>正文'),'正文')
  with self.assertRaises(t.Blocked):t.content_only('<think>unclosed private reasoning')
  with self.assertRaises(t.Blocked):t.content_only(None)
 def test_sse_reasoning_never_enters_answer(self):
  parts=[{'id':'x','choices':[{'index':0,'delta':{'reasoning_content':'hidden'}}]},
   {'choices':[{'index':0,'delta':{'content':'<thi'}}]},
   {'choices':[{'index':0,'delta':{'content':'nk>hidden</think>正文'},'finish_reason':'stop'}]},
   {'choices':[],'usage':{'prompt_tokens':4,'completion_tokens':5,'total_tokens':9}}]
  raw=('\n'.join('data: '+json.dumps(x) for x in parts)+'\ndata: [DONE]\n').encode()
  p=t.parse_response(raw,'text/event-stream');self.assertEqual(p['choices'][0]['message']['content'],'正文');self.assertEqual(p['usage']['total_tokens'],9)
  with self.assertRaises(t.Blocked):t.parse_response(b'data: {"choices": []}\n','text/event-stream')
 async def test_redirect_and_error_body_are_not_followed_or_exposed(self):
  self.cfg['local_daily_token_limit']=100000
  for status in (302,401,403,429,500):
   t._cooldown_until=0
   with self.client(status=status,raw=b'echo FAKE-NEW-KEY-DO-NOT-LOG'):
    with self.assertRaises(t.Blocked) as e:await t.generate([{'role':'user','content':'test'}])
   self.assertEqual(e.exception.code,t.http_error(status));self.assertNotIn('FAKE',str(e.exception))
 async def test_failure_opens_circuit_without_second_http_request(self):
  with self.client(status=429):
   with self.assertRaises(t.Blocked):await t.generate([{'role':'user','content':'test'}])
   with self.assertRaisesRegex(t.Blocked,'circuit_open'):await t.generate([{'role':'user','content':'test'}])
  self.assertEqual(len(self.sent),1)
 async def test_local_budget_blocks_before_http(self):
  self.cfg['local_total_token_limit']=1
  with patch.object(t.httpx,'AsyncClient') as c:
   with self.assertRaisesRegex(t.Blocked,'token_limit'):await t.generate([{'role':'user','content':'test'}])
   c.assert_not_called()
 def test_old_endpoint_cannot_receive_rotated_key(self):
  with self.assertRaisesRegex(t.Blocked,'unverified_school_endpoint'):t.endpoint({**self.cfg,'base_url':'https://llmapi.tongji.edu.cn/v1'})
 def test_http_failure_layers_are_distinct(self):
  def error(status,text):return t.http_error(status,json.dumps({'error':{'message':text}}).encode())
  self.assertEqual(error(403,'当前网络环境不支持'),'school_network_policy_denied')
  self.assertEqual(error(401,'invalid key'),'school_authentication_failed')
  self.assertEqual(error(403,'模型无权限'),'school_model_permission_denied')
  self.assertEqual(error(403,'积分不足'),'school_quota_exhausted')
  self.assertEqual(error(429,'rate limit'),'school_rate_limited')
 async def test_points_are_not_treated_as_free_or_cash(self):
  self.cfg.update(billing_mode='school_points',free_only_verified=False,credit_only_verified=False,pricing_verified=True)
  with self.assertRaisesRegex(t.Blocked,'points_policy'):t.verify(self.cfg,'synthetic')
  self.cfg['credit_only_verified']=True;t.verify(self.cfg,'synthetic')
  self.cfg['cash_charging_authorized']=True
  with self.assertRaisesRegex(t.Blocked,'points_policy'):t.verify(self.cfg,'synthetic')
 async def test_points_reservation_and_settlement_keep_school_units(self):
  import sqlite3
  from contextlib import closing
  self.cfg.update(billing_mode='school_points',free_only_verified=False,credit_only_verified=True,pricing_verified=True)
  with self.client():await t.generate([{'role':'user','content':'test'}],scope='synthetic')
  with closing(sqlite3.connect(t.DB)) as db:row=db.execute('SELECT held_micropoints,actual_micropoints FROM calls').fetchone()
  self.assertGreater(row[0],row[1]);self.assertEqual(row[1],10*30+15*120)
 async def test_points_cap_blocks_before_request(self):
  self.cfg.update(billing_mode='school_points',free_only_verified=False,credit_only_verified=True,pricing_verified=True,local_total_points_limit=.001)
  with patch.object(t.httpx,'AsyncClient') as c:
   with self.assertRaisesRegex(t.Blocked,'points_limit'):await t.generate([{'role':'user','content':'test'}],scope='synthetic')
   c.assert_not_called()
 async def test_busy_never_waits_in_a_long_queue(self):
  await t._slot.acquire();start=time.monotonic()
  try:
   with self.assertRaisesRegex(t.Blocked,'busy'):await t.generate([{'role':'user','content':'test'}])
  finally:t._slot.release()
  self.assertLess(time.monotonic()-start,.8)
 async def test_missing_usage_retains_reservation(self):
  import sqlite3
  from contextlib import closing
  p={'choices':[{'message':{'content':'正文'}}]}
  with self.client(p):await t.generate([{'role':'user','content':'test'}])
  with closing(sqlite3.connect(t.DB)) as db:
   row=db.execute('SELECT actual,held,status FROM calls').fetchone()
  self.assertIsNone(row[0]);self.assertGreater(row[1],0);self.assertEqual(row[2],'usage_unavailable')
 async def test_tool_planner_accepts_school_route_without_running_qq(self):
  a=AccountTasks(self.root/'tasks')
  response=SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'character_route':'tongji-school','message':{'content':'{"tool":"propose","kind":"signature","content":"此路未尽。"}'}})
  manager=AsyncMock();manager.__aenter__.return_value=SimpleNamespace(post=AsyncMock(return_value=response))
  with patch('account_tasks.httpx.AsyncClient',return_value=manager):choice=await a.plan('改个签名',None,[])
  self.assertEqual(choice['kind'],'signature')

class GatewayRoutingTests(unittest.IsolatedAsyncioTestCase):
 def setUp(self):
  self.payload={'model':'DeepSeek1017','choices':[{'message':{'content':'正文'},'finish_reason':'stop'}],'usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2}}
 async def test_primary_school_route_is_the_actual_returned_provider(self):
  with patch.object(g,'settings',return_value={'provider':'tongji','mode':'cloud'}),patch.object(t,'generate',AsyncMock(return_value=(self.payload,'tongji-school'))) as generate,patch.object(g,'_generate_bailian_or_local',AsyncMock()) as old:
   p,route=await g.generate([{'role':'user','content':'synthetic'}]);self.assertEqual(route,'tongji-school');old.assert_not_awaited();self.assertEqual(p['model'],'DeepSeek1017')
 async def test_school_failure_falls_back_once_and_retains_provenance(self):
  with patch.object(g,'settings',return_value={'provider':'tongji','mode':'cloud'}),patch.object(t,'generate',AsyncMock(side_effect=t.Blocked('school_http_429'))),patch.object(g,'_generate_bailian_or_local',AsyncMock(return_value=({'model':'qwen'},'bailian-free'))) as old:
   p,route=await g.generate([{'role':'user','content':'synthetic'}]);self.assertEqual(route,'bailian-free');self.assertEqual(p['primary_error'],'school_http_429');self.assertEqual(old.await_count,1)
 async def test_unknown_provider_never_sends_any_request(self):
  with patch.object(g,'settings',return_value={'provider':'unknown','mode':'cloud'}),patch.object(g,'_generate_bailian_or_local',AsyncMock()) as old:
   with self.assertRaises(Exception):await g.generate([{'role':'user','content':'synthetic'}])
   old.assert_not_awaited()
 def test_bailian_fault_does_not_disable_school_primary(self):
  with tempfile.TemporaryDirectory() as temp:
   state=Path(temp)/'state.json';state.write_text(json.dumps({'provider':'tongji','mode':'cloud'}))
   with patch.object(g,'STATE',state):g.disable_cloud('http_403')
   value=json.loads(state.read_text());self.assertEqual(value['mode'],'cloud');self.assertTrue(value['bailian_blocked'])
 def test_concurrent_config_updates_preserve_both_fields(self):
  from concurrent.futures import ThreadPoolExecutor
  from model_config import update
  with tempfile.TemporaryDirectory() as temp:
   state=Path(temp)/'state.json';state.write_text('{}')
   with ThreadPoolExecutor(2) as pool:
    list(pool.map(lambda i:update(state,lambda c:c.update({str(i):i})),[1,2]))
   self.assertEqual(json.loads(state.read_text()),{'1':1,'2':2})
 async def test_streaming_gateway_returns_only_final_content(self):
  with patch.object(g,'settings',return_value={'gateway_token':'fake'}),patch.object(g,'generate',AsyncMock(return_value=(self.payload,'tongji-school'))):
   async with httpx.AsyncClient(transport=httpx.ASGITransport(app=g.app),base_url='http://localhost') as c:
    r=await c.post('/v1/chat/completions',headers={'Authorization':'Bearer fake'},json={'messages':[{'role':'user','content':'synthetic'}],'stream':True})
  self.assertEqual(r.status_code,200);self.assertIn('[DONE]',r.text);self.assertIn('DeepSeek1017',r.text);self.assertNotIn('reasoning_content',r.text)

class ToolCallTests(unittest.IsolatedAsyncioTestCase):
 """The planner needs native tool calls; the gateway must not strip them."""
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  self.cfg={**t.DEFAULTS,'enabled':True,'free_only_verified':True,'synthetic_use_verified':True,'model_verified':True,'model':'DeepSeek1017','verification_expires_at':time.time()+1000,'qq_use_verified':True,'external_friend_data_verified':True}
  self.pathpatch=patch.multiple(t,DB=self.root/'usage.sqlite',_slot=asyncio.Semaphore(1),_cooldown_until=0);self.pathpatch.start()
  self.cfgpatch=patch.object(t,'settings',return_value=self.cfg);self.cfgpatch.start()
  self.keypatch=patch.object(t,'credential',return_value='FAKE-NEW-KEY-DO-NOT-LOG');self.keypatch.start()
  self.tools=[{'type':'function','function':{'name':'reply','description':'回复','parameters':{'type':'object','properties':{'text':{'type':'string'}},'required':['text']}}}]
 def tearDown(self):self.pathpatch.stop();self.cfgpatch.stop();self.keypatch.stop();self.tmp.cleanup()
 def client(self,payload):
  self.sent=[];content=json.dumps(payload).encode();sent=self.sent
  class Response:
   status_code=200;headers={'content-type':'application/json'}
   async def __aenter__(self):return self
   async def __aexit__(self,*args):pass
   async def aiter_bytes(self):yield content
  class Client:
   async def __aenter__(self):return self
   async def __aexit__(self,*args):pass
   def stream(self,method,url,**kwargs):sent.append(kwargs);return Response()
  return patch.object(t.httpx,'AsyncClient',return_value=Client())
 async def test_tool_call_turn_returns_calls_and_no_fake_text(self):
  payload={'model':'DeepSeek1017','choices':[{'message':{'content':None,'tool_calls':[{'id':'call_1','type':'function','function':{'name':'reply','arguments':'{"text":"收到"}'}}]},'finish_reason':'tool_calls'}],'usage':{'prompt_tokens':5,'completion_tokens':5,'total_tokens':10}}
  with self.client(payload):p,route=await t.generate([{'role':'user','content':'调用工具'}],tools=self.tools,tool_choice='auto')
  self.assertEqual(route,'tongji-school')
  self.assertEqual(p['choices'][0]['message']['tool_calls'][0]['function']['name'],'reply')
  self.assertEqual(p['choices'][0]['finish_reason'],'tool_calls')
  self.assertIn('tools',self.sent[0]['json']);self.assertEqual(self.sent[0]['json']['tool_choice'],'auto')
 async def test_tool_round_messages_are_accepted(self):
  payload={'model':'DeepSeek1017','choices':[{'message':{'content':'好'},'finish_reason':'stop'}],'usage':{'prompt_tokens':5,'completion_tokens':1,'total_tokens':6}}
  msgs=[{'role':'assistant','content':None,'tool_calls':[{'id':'c1','type':'function','function':{'name':'reply','arguments':'{}'}}]},
        {'role':'tool','content':'{"ok":true}','tool_call_id':'c1'}]
  with self.client(payload):p,_=await t.generate(msgs)
  self.assertEqual(p['choices'][0]['message']['content'],'好')
  self.assertEqual(self.sent[0]['json']['messages'][0]['tool_calls'][0]['id'],'c1')
  self.assertEqual(self.sent[0]['json']['messages'][1]['tool_call_id'],'c1')
 async def test_gateway_forwards_tools_and_streams_tool_calls(self):
  payload={'model':'DeepSeek1017','choices':[{'message':{'content':'','tool_calls':[{'id':'c1','type':'function','function':{'name':'reply','arguments':'{}'}}]},'finish_reason':'tool_calls'}],'usage':{}}
  school=AsyncMock(return_value=(payload,'tongji-school'))
  with patch.object(g,'settings',return_value={'gateway_token':'fake','provider':'tongji','mode':'cloud'}),patch.object(t,'generate',school):
   async with httpx.AsyncClient(transport=httpx.ASGITransport(app=g.app),base_url='http://localhost') as c:
    r=await c.post('/v1/chat/completions',headers={'Authorization':'Bearer fake'},json={'messages':[{'role':'user','content':'x'}],'stream':True,'tools':self.tools})
  self.assertEqual(r.status_code,200);self.assertIn('tool_calls',r.text);self.assertIn('[DONE]',r.text)
  self.assertEqual(school.await_args.kwargs['tools'][0]['function']['name'],'reply')

if __name__=='__main__':unittest.main()
