import asyncio,hashlib,json,tempfile,unittest
from pathlib import Path
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock,patch
from types import SimpleNamespace
from account_tasks import AccountTasks,OWNER,BOT
from character.discourse import assess,issues

class AccountTaskTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name);self.calls=[];self.sig='旧签名';self.fail=False;self.lost=False
  async def rpc(action,params):
   self.calls.append((action,params))
   if action=='get_login_info':return {'status':'ok','data':{'user_id':BOT}}
   if action=='get_friend_list':return {'status':'ok','data':[{'user_id':OWNER}]}
   if action=='get_stranger_info':return {'status':'ok','data':{'long_nick':self.sig}}
   if action=='send_private_msg':return {'status':'ok','data':{'message_id':'preview'}}
   if action=='set_self_longnick':
    if self.lost:raise TimeoutError('uncertain')
    if self.fail:return {'status':'failed','retcode':1,'data':{}}
    self.sig=params['longNick'];return {'status':'ok','retcode':0,'data':{'result':0}}
   if action=='send_qzone_msg':return {'status':'ok','retcode':0,'data':{'tid':'isolated-tid'}}
   if action=='set_qq_avatar':return {'status':'ok','retcode':0,'data':{'result':0}}
   raise AssertionError(action)
  @asynccontextmanager
  async def factory():yield rpc
  self.factory=factory
  self.planner=AsyncMock(return_value={'tool':'propose','kind':'signature','content':'众生求道，道不求我。'})
  self.a=AccountTasks(self.path/'tasks',planner=self.planner,rpc_factory=factory,policy_path=self.path/'policy')
 async def asyncTearDown(self):self.temp.cleanup()
 async def say(self,text,uid=OWNER,scope='group:680823437',mid=None):
  self.counter=getattr(self,'counter',0)+1
  return await self.a.handle(text,uid,scope,mid or str(self.counter))
 def writes(self):return [c for c in self.calls if c[0].startswith('set_') or c[0]=='send_qzone_msg']
 async def test_real_signature_dialogue_state_and_owner_readback(self):
  await self.say('你能不能改个签名');await self.say('足够嘉豪的')
  task=self.a.current(OWNER,'group:680823437');self.assertEqual(task['plan']['content'],'众生求道，道不求我。')
  self.assertNotIn('哪个',await self.say('可以，安排一啊'))
  self.assertNotIn('哪个',await self.say('把这个改成你QQ签名'))
  self.assertNotIn('哪个',await self.say('这个'))
  self.assertNotIn('哪个',await self.say('众生求道，道不求我'))
  self.assertEqual(self.writes(),[])
  task=self.a.current(OWNER,'group:680823437')
  result=await self.say('确认任务 '+task['id'],scope='private:'+OWNER)
  self.assertIn('回读',result);self.assertEqual(len(self.writes()),1)
  await self.say('确认任务 '+task['id'],scope='private:'+OWNER)
  self.assertEqual(len(self.writes()),1)
 async def test_unknown_friend_cannot_control_account_or_confirm(self):
  self.assertIn('授权',await self.say('改个签名',uid='999'))
  self.planner.assert_not_awaited()
  await self.say('改个签名',uid='2807839774');await self.say('就这个',uid='2807839774')
  task=self.a.current('2807839774','group:680823437')
  self.assertIn('首次',await self.say('确认任务 '+task['id'],uid='2807839774',scope='private:2807839774'))
  self.assertEqual(self.writes(),[])
 async def test_revision_invalidates_old_preview_and_cancel(self):
  await self.say('改个签名');await self.say('就这个');old=self.a.current(OWNER,'group:680823437')
  await self.say('换成“只问此心”');new=self.a.current(OWNER,'group:680823437')
  self.assertNotEqual(old['id'],new['id']);self.assertEqual(new['plan']['content'],'只问此心')
  self.assertIn('变更',await self.say('确认任务 '+old['id'],scope='private:'+OWNER))
  await self.say('取消任务 '+new['id'],scope='private:'+OWNER)
  self.assertEqual(self.a.get(new['id'])['state'],'cancelled');self.assertEqual(self.writes(),[])
 async def test_restart_keeps_reference_and_never_retries_uncertain(self):
  await self.say('改个签名');await self.say('就这个');task=self.a.current(OWNER,'group:680823437')
  self.a=AccountTasks(self.path/'tasks',planner=self.planner,rpc_factory=self.factory,policy_path=self.path/'policy')
  self.assertIn('交给',await self.say('就刚才那个'))
  self.lost=True;await self.say('确认任务 '+task['id'],scope='private:'+OWNER)
  self.assertEqual(self.a.get(task['id'])['state'],'unknown')
  await self.say('确认任务 '+task['id'],scope='private:'+OWNER);self.assertEqual(len(self.writes()),1)
 async def test_api_failure_does_not_claim_success_or_grant(self):
  await self.say('改个签名');await self.say('就这个');task=self.a.current(OWNER,'group:680823437');self.fail=True
  reply=await self.say('确认任务 '+task['id']+' 并授权低频',scope='private:'+OWNER)
  self.assertIn('没有改好',reply)
  with self.a.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM grants').fetchone()[0],0)
 async def test_post_instructions_and_visibility_no_phone_excuse(self):
  self.planner.return_value={'tool':'propose','kind':'post','content':'炼蛊尚且会失败，何况把人生押给一句包赢。'}
  await self.say('发个动态');self.assertNotIn('手机',await self.say('你自己发'))
  task=self.a.current(OWNER,'group:680823437')
  self.assertEqual(task['plan']['target_uins'],[OWNER]);self.assertEqual(task['plan']['ugc_right'],16)
  await self.say('确认任务 '+task['id'],scope='private:'+OWNER)
  self.assertEqual(self.writes()[0][0],'send_qzone_msg');self.assertFalse(self.a.get(task['id'])['result']['independent_readback'])
 async def test_autonomy_is_inert_without_owner_grant(self):
  await self.a.consider();self.planner.assert_not_awaited();self.assertEqual(self.calls,[])
 async def test_publish_request_goes_straight_to_owner_preview(self):
  self.planner.return_value={'tool':'propose','kind':'post','content':'炼蛊尚有失败，何况人生。'}
  reply=await self.say('发个动态')
  task=self.a.current(OWNER,'group:680823437')
  self.assertEqual(task['state'],'awaiting_owner');self.assertEqual(task['notified'],2)
  self.assertIn('所有者',reply);self.assertEqual(self.writes(),[])
 async def test_crash_after_durable_claim_never_reexecutes(self):
  await self.say('改个签名');await self.say('就这个');task=self.a.current(OWNER,'group:680823437')
  with self.a.db() as db,db:
   db.execute("UPDATE tasks SET state='executing' WHERE id=?",(task['id'],))
   db.execute('INSERT INTO attempts VALUES(?,?,?,?,?)',(task['id'],'fixture','signature',0,'pending'))
  self.a=AccountTasks(self.path/'tasks',planner=self.planner,rpc_factory=self.factory,policy_path=self.path/'policy')
  self.assertIn('待核查',await self.say('执行结果'))
  await self.say('确认任务 '+task['id'],scope='private:'+OWNER)
  self.assertEqual(self.writes(),[])
 async def test_edited_asset_and_private_information_are_rejected(self):
  for content in ['群里成飞扬的私事','联系电话13800000000','私聊记录如下']:
   with self.assertRaises(ValueError):self.a.create(OWNER,'private:'+OWNER,'post',content)
  self.assertEqual(self.writes(),[])
 async def test_multiple_owner_confirmations_after_message_coalescing(self):
  sig=self.a.create(OWNER,'private:'+OWNER,'signature','只问此心。')
  post=self.a.create(OWNER,'private:'+OWNER,'post','炼蛊尚有失败，何况人生。')
  await self.a.preview(sig);await self.a.preview(post)
  reply=await self.say('确认任务 '+sig['id']+'\n确认任务 '+post['id'],scope='private:'+OWNER)
  self.assertEqual(len(self.writes()),2);self.assertIn('回读',reply)
 async def test_shared_group_reference_is_available_only_in_same_group(self):
  await self.say('改个签名',uid='2807839774')
  self.assertIsNotNone(self.a.current('2171196385','group:680823437'))
  self.assertIsNone(self.a.current('2171196385','private:2171196385'))
  self.assertIsNone(self.a.current('999','group:680823437'))
 async def test_new_content_needs_owner_until_grant_and_respects_cooldown(self):
  await self.say('改个签名');await self.say('就这个');task=self.a.current(OWNER,'group:680823437')
  await self.say('确认任务 '+task['id']+' 并授权低频',scope='private:'+OWNER)
  new=self.a.create('2807839774','group:680823437','signature','此路仍长。')
  self.assertIn('低频',await self.a.submit_plan(new));self.assertEqual(len(self.writes()),1)
  with self.a.db() as db,db:db.execute('UPDATE attempts SET created=created-90000')
  self.assertIn('回读',await self.a.submit_plan(self.a.get(new['id'])))
  self.assertEqual(len(self.writes()),2)
 async def test_no_successful_preview_means_no_owner_execution(self):
  @asynccontextmanager
  async def broken():
   async def rpc(action,params):
    if action=='get_login_info':return {'status':'ok','data':{'user_id':BOT}}
    if action=='get_friend_list':return {'status':'ok','data':[{'user_id':OWNER}]}
    raise TimeoutError('owner preview uncertain')
   yield rpc
  self.a.rpc_factory=broken;await self.say('改个签名');await self.say('就这个')
  task=self.a.current(OWNER,'group:680823437')
  await self.say('确认任务 '+task['id'],scope='private:'+OWNER)
  self.assertEqual(self.writes(),[]);self.assertNotEqual(self.a.get(task['id'])['state'],'executing')
 async def test_avatar_and_image_post_use_only_hashed_staged_assets(self):
  folder=self.path/'instance/data/account-brand';folder.mkdir(parents=True)
  asset=folder/'candidate.jpg';asset.write_bytes(b'isolated image fixture')
  meta={'file':str(asset),'sha256':hashlib.sha256(asset.read_bytes()).hexdigest()}
  response=SimpleNamespace(content=asset.read_bytes(),raise_for_status=lambda:None)
  manager=AsyncMock();manager.__aenter__.return_value=SimpleNamespace(get=AsyncMock(return_value=response))
  with patch('account_tasks.ROOT',self.path),patch('account_brand.ROOT',self.path),patch('account_tasks.httpx.AsyncClient',return_value=manager):
   avatar=self.a.create(OWNER,'group:680823437','avatar',asset=meta);await self.a.preview(avatar)
   await self.say('确认任务 '+avatar['id'],scope='private:'+OWNER)
   post=self.a.create(OWNER,'group:680823437','post','炼蛊尚有失败。',asset=meta);await self.a.preview(post)
   await self.say('确认任务 '+post['id'],scope='private:'+OWNER)
  writes=self.writes();self.assertEqual([x[0] for x in writes],['set_qq_avatar','send_qzone_msg'])
  self.assertEqual(writes[1][1]['images'],[asset.as_uri()]);self.assertEqual(writes[1][1]['ugc_right'],16)
  self.assertTrue(self.a.get(avatar['id'])['result']['bytes_match_staged'])

class StaleInputTests(unittest.IsolatedAsyncioTestCase):
 async def test_old_at_joke_is_dropped_and_recovery_request_is_bounded(self):
  from group_replies import GroupReplies,GROUP
  from types import SimpleNamespace
  import time
  with tempfile.TemporaryDirectory() as t:
   b=SimpleNamespace(friend=OWNER,mode='both',allowed_event=lambda e:True)
   gen=AsyncMock(return_value='这项记下了。');send=AsyncMock(return_value={'status':'ok','data':{}})
   g=GroupReplies(b,SimpleNamespace(search=AsyncMock(return_value=[])),database=Path(t)/'d',generate=gen)
   def event(mid,body):return {'post_type':'message','message_type':'group','group_id':GROUP,'user_id':OWNER,'message_id':mid,'time':time.time()-3300,'message':[{'type':'at','data':{'qq':BOT}},{'type':'text','data':{'text':body}}]}
   self.assertIsNone(g.submit(event('old','浑身充满力量'),send));gen.assert_not_awaited()
   task=g.submit(event('useful','帮我改个签名'),send);self.assertIsNotNone(task);await task
   self.assertEqual(send.await_count,1);self.assertIsNone(g.submit(event('later','帮我改个签名'),send))
   await g.close()

class DiscourseTests(unittest.TestCase):
 def test_structure_repeat_is_caught_even_when_words_are_new(self):
  h=[{'role':'assistant','content':'薄肌蛊，主材低体脂仙元，副作用力量掉光。你确定？'},
     {'role':'assistant','content':'材料是脸皮碎片，副作用智商下降。你确定？'}]
  state=assess('换个不加班蛊',h)
  self.assertTrue(issues('主材是老板眼泪，副作用脑子缩水。你确定？',state))
  self.assertFalse(issues('你这蛊还没炼，需求先转了三回。',state))
 def test_complex_fiction_and_real_canon_are_not_blanket_banned(self):
  deep=assess('认真设计原创不加班蛊，完整推演失效条件')
  self.assertTrue(deep['elaborate']);self.assertFalse(issues('材料是某种设定资源，副作用是临时失明。',deep))
  self.assertFalse(assess('原著定仙游真正的蛊方是什么')['hypothetical'])
  self.assertTrue(issues('这蛊我炼过。',assess('我要闹钟永动蛊')))

if __name__=='__main__':unittest.main()
