"""One multiplexed private receiver with verified friends and reply-only sends."""
import asyncio,json,time
from collections import OrderedDict
from friend_access import BOT

async def private_connection(upstream,boundary,engine,refresh_mode,*,refresh_interval=60):
 directory=boundary.friends;directory.invalidate()
 pending={};buffered=OrderedDict();wake=asyncio.Event();last_requested=0.
 async def rpc(action):
  echo='character-private:'+str(time.monotonic_ns())
  future=asyncio.get_running_loop().create_future();pending[echo]=future
  try:
   await upstream.send(json.dumps({**action,'echo':echo},ensure_ascii=False))
   return await asyncio.wait_for(future,9)
  finally:pending.pop(echo,None)

 async def send(action):
  action=dict(action);mid=action.pop('_private_reply_mid',None);refresh_mode()
  checked=boundary.outbound(action)
  if checked is None:raise RuntimeError('Private destination denied')
  if checked.get('action') in {'send_private_msg','send_msg'}:
   uid=str((checked.get('params') or {}).get('user_id',''))
   if not mid or not engine.authorize_send(uid,mid):raise RuntimeError('Private send has no pending reply')
  elif checked.get('action')!='get_image':raise RuntimeError('Unsupported private action')
  return await rpc(checked)

 async def receive():
  nonlocal last_requested
  async for raw in upstream:
   event=json.loads(raw);echo=event.get('echo')
   if echo in pending:
    if not pending[echo].done():pending[echo].set_result(event)
    continue
   if event.get('post_type')=='notice' and event.get('notice_type')=='friend_add':wake.set()
   if event.get('post_type')!='message' or event.get('message_type')!='private':continue
   uid=str(event.get('user_id',''))
   if not uid.isdigit() or uid==BOT or event.get('group_id'):continue
   refresh_mode()
   if directory.verified(uid):engine.submit(event,send)
   else:
    # Buffer during verification, without authorizing or answering strangers.
    buffered[(uid,str(event.get('message_id','')))]=event
    while len(buffered)>64:buffered.popitem(last=False)
    if time.monotonic()-last_requested>10:
     last_requested=time.monotonic();wake.set()

 async def refresh():
  first=True
  while True:
   login=await rpc({'action':'get_login_info','params':{}})
   if login.get('status')!='ok' or str((login.get('data') or {}).get('user_id'))!=BOT:raise RuntimeError('Incorrect QQ account')
   response=await rpc({'action':'get_friend_list','params':{'no_cache':True}})
   if response.get('status')!='ok':raise RuntimeError('QQ friendship unavailable')
   directory.replace(response.get('data'),BOT)
   print(json.dumps({'private_friends_verified':len(directory.ids),'ttl':directory.ttl}),flush=True)
   refresh_mode()
   for key,event in list(buffered.items()):
    buffered.pop(key,None)
    if directory.verified(key[0]) and time.time()-float(event.get('time') or time.time())<1200:engine.submit(event,send)
   if first:
    await engine.recover_pending(send);first=False
   try:await asyncio.wait_for(wake.wait(),refresh_interval)
   except TimeoutError:pass
   wake.clear()

 tasks=[asyncio.create_task(receive()),asyncio.create_task(refresh())]
 try:
  done,_=await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
  for task in done:task.result()
 finally:
  directory.invalidate()
  for task in tasks:task.cancel()
  await asyncio.gather(*tasks,return_exceptions=True)
  for future in pending.values():
   if not future.done():future.set_exception(ConnectionError('Private connection lost'))
  await engine.close()
