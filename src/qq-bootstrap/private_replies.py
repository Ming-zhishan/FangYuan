"""Persistent per-friend conversations; bounded coalescing and at-most-once sends."""
import asyncio,json,re,sqlite3,time
from contextlib import closing
from pathlib import Path
from character.runtime import CharacterRuntime,simple_fallback
from chat_perception import qq_message_text,emoji_intent,StickerVision

ROOT=Path(__file__).resolve().parents[2]
DB=ROOT/'work/instance/data/character-private-dialogue.sqlite3'

class PrivateReplies:
 def __init__(self,boundary,retrieval,*,database=DB,generate=None,deadline=40,debounce=.65):
  self.boundary=boundary;self.retrieval=retrieval;self.database=Path(database)
  self.generate=generate or self.model_reply;self.deadline=deadline;self.debounce=debounce
  self.tasks={};self.latest={};self.started=set();self.locks={};self.limit=asyncio.Semaphore(2)
  self.database.parent.mkdir(parents=True,exist_ok=True);self.vision=StickerVision()
  with self.db() as db,db:
   # Retain the original table intact for migration/rollback; new keys include uid.
   db.execute('CREATE TABLE IF NOT EXISTS private_inbox(uid TEXT,mid TEXT,text TEXT,received REAL,stamp REAL,state TEXT,answer TEXT,elapsed REAL,qq_mid TEXT,raw TEXT,PRIMARY KEY(uid,mid))')
   db.execute('CREATE TABLE IF NOT EXISTS private_deliveries(uid TEXT,mid TEXT,status TEXT,created REAL,PRIMARY KEY(uid,mid))')
   db.execute('CREATE TABLE IF NOT EXISTS private_meta(key TEXT PRIMARY KEY,value TEXT)')
   if not db.execute("SELECT 1 FROM private_meta WHERE key='legacy_migrated'").fetchone():
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='inbox'").fetchone():
     columns={r[1] for r in db.execute('PRAGMA table_info(inbox)')}
     revision='persona_revision' if 'persona_revision' in columns else "'legacy'"
     for mid,uid,text,received,state,answer,elapsed,qmid,rev in db.execute('SELECT message_id,user_id,text,received_at,state,answer,elapsed,delivered_message_id,'+revision+' FROM inbox').fetchall():
      safe='sent' if state=='sent' else 'legacy_closed'
      if rev!='v3':answer=None
      db.execute('INSERT OR IGNORE INTO private_inbox VALUES(?,?,?,?,?,?,?,?,?,?)',(uid,mid,text,received,received,safe,answer,elapsed,qmid,'{}'))
    db.execute("INSERT INTO private_meta VALUES('legacy_migrated','1')")
   db.execute("UPDATE private_inbox SET state='uncertain' WHERE state='sending'")
   db.execute("UPDATE private_inbox SET state='received' WHERE state IN ('running','queued')")
  isolated=self.database.resolve()!=DB.resolve()
  self.character=CharacterRuntime(retrieval,world_path=self.database.parent/'life.sqlite3' if isolated else None,
    social_path=self.database.parent/'social.sqlite3' if isolated else None,owner=boundary.friend)

 def db(self):return closing(sqlite3.connect(self.database,timeout=5))
 def history(self,uid,current,exclude=()):
  with self.db() as db:
   rows=db.execute("SELECT mid,text,answer,state FROM private_inbox WHERE uid=? AND mid!=? AND state IN ('sent','superseded','legacy_closed') ORDER BY received DESC,rowid DESC LIMIT 8",(str(uid),str(current))).fetchall()
  result=[]
  for mid,text,answer,state in reversed(rows):
   if mid in exclude:continue
   result.append({'role':'user','content':text[:1000]})
   if answer and state=='sent':result.append({'role':'assistant','content':answer[:800]})
  for item in result:item['scope']='private:'+str(uid)
  return result

 def update(self,uid,mid,state,answer=None,elapsed=None,qq_mid=None):
  with self.db() as db,db:db.execute('UPDATE private_inbox SET state=?,answer=?,elapsed=?,qq_mid=? WHERE uid=? AND mid=?',(state,answer,elapsed,str(qq_mid) if qq_mid is not None else None,str(uid),str(mid)))

 def submit(self,event,send):
  if event.get('post_type')!='message' or event.get('message_type')!='private' or event.get('group_id') or not self.boundary.allowed_event(event):return None
  uid,mid=str(event.get('user_id','')),str(event.get('message_id',''))
  text=qq_message_text(event)
  if not uid or not mid or not text:return None
  try:stamp=float(event.get('time') or time.time())
  except (ValueError,TypeError):return None
  if not time.time()-1200<=stamp<=time.time()+120:return None
  raw={k:event[k] for k in ('post_type','message_type','sub_type','user_id','message_id','time','message','sender') if k in event}
  with self.db() as db,db:
   inserted=db.execute('INSERT OR IGNORE INTO private_inbox VALUES(?,?,?,?,?,\'received\',NULL,NULL,NULL,?)',(uid,mid,text[:6000],time.time(),stamp,json.dumps(raw,ensure_ascii=False))).rowcount
  if not inserted:return None
  self.boundary.memory.observe(event,text)
  self.character.social.observe(uid,'private:'+uid,mid,text)
  return self.schedule(uid,mid,send)

 def schedule(self,uid,mid,send):
  old=self.tasks.get(uid)
  if old and not old.done() and old not in self.started:old.cancel()
  self.latest[uid]=mid
  task=asyncio.create_task(self.run(uid,mid,send),name='private-reply:'+uid+':'+mid)
  self.tasks[uid]=task
  def finished(done):
   self.started.discard(done)
   if self.tasks.get(uid) is done:self.tasks.pop(uid,None)
  task.add_done_callback(finished)
  return task

 def claim_send(self,uid,mid):
  with self.db() as db,db:
   db.execute('BEGIN IMMEDIATE')
   row=db.execute('SELECT state,received FROM private_inbox WHERE uid=? AND mid=?',(uid,mid)).fetchone()
   if not row or row[0]!='running':return False
   if db.execute('SELECT 1 FROM private_inbox WHERE uid=? AND received>? AND state NOT IN (\'expired\',\'legacy_closed\')',(uid,row[1])).fetchone():return False
   if not db.execute('INSERT OR IGNORE INTO private_deliveries VALUES(?,?,?,?)',(uid,mid,'pending',time.time())).rowcount:return False
   db.execute("UPDATE private_inbox SET state='sending' WHERE uid=? AND mid=?",(uid,mid))
   return True

 def authorize_send(self,uid,mid):
  with self.db() as db:return bool(db.execute("SELECT 1 FROM private_inbox i JOIN private_deliveries d ON i.uid=d.uid AND i.mid=d.mid WHERE i.uid=? AND i.mid=? AND i.state='sending' AND d.status='pending'",(str(uid),str(mid))).fetchone())

 async def run(self,uid,mid,send):
  sending=False;tick=time.monotonic();batch=[]
  try:
   await asyncio.sleep(self.debounce)
   self.started.add(asyncio.current_task())
   async with self.locks.setdefault(uid,asyncio.Lock()),self.limit:
    if self.latest.get(uid)!=mid:return
    with self.db() as db,db:
     rows=db.execute("SELECT mid,text,raw FROM private_inbox WHERE uid=? AND state IN ('received','running','superseded') AND received>=? ORDER BY received,rowid",(uid,time.time()-1200)).fetchall()
     if not rows:return
     if mid not in [x[0] for x in rows]:
      current=db.execute('SELECT mid,text,raw FROM private_inbox WHERE uid=? AND mid=?',(uid,mid)).fetchone()
      rows=rows[-11:]+([current] if current else [])
     batch=[x[0] for x in rows]
     db.execute("UPDATE private_inbox SET state='running' WHERE uid=? AND mid=? AND state NOT IN ('sent','sending','uncertain')",(uid,mid))
    event=json.loads(next(x[2] for x in rows if x[0]==mid));utterance='\n'.join(x[1] for x in rows)[-6000:];text=utterance
    if not self.boundary.allowed_event(event):self.update(uid,mid,'received');return
    flavor=emoji_intent(text)
    if flavor:text+='\n【表情语气】'+flavor
    images=[]
    for _,_,raw in rows:
     parts=json.loads(raw).get('message',[])
     if isinstance(parts,list):images.extend(p for p in parts if p.get('type') in {'image','sticker','mface','marketface'})
    if images:
     try:caption=await asyncio.wait_for(self.vision.explain({**event,'message':images[-1:]},send),8)
     except Exception:caption=''
     text+='\n【本地图像识别】'+caption if caption else '\n【图片暂未识别】没有看清，不能猜画面内容。'
    other_private=bool(re.search(r'私聊|私下',utterance) and re.search(r'原话|记录|发我|给我看|说了什么|聊了什么|说过什么',utterance) and not re.search(r'我(?:刚才|之前|上次)|我(?:跟你|和你)|我们|咱们',utterance))
    guard='别人的私聊不转。你自己的事，我们接着说。' if other_private else self.boundary.guarded_reply(event)
    try:
     answer=guard or await asyncio.wait_for(self.generate(event,text,self.history(uid,mid,exclude=batch)),self.deadline)
     answer=(answer or '').strip()
     if not answer:raise ValueError('empty_private_answer')
     if answer in {'[沉默]','沉默','[不参与]'}:answer='在，你接着说。'
    except Exception as exc:
     answer=simple_fallback(text) or '这条没处理完，刚才没接住。你可以接着说。'
     print(json.dumps({'private_model_fallback':mid,'error_type':type(exc).__name__}),flush=True)
    if self.latest.get(uid)!=mid:
     self.update(uid,mid,'superseded');return
    if not self.boundary.allowed_event(event):self.update(uid,mid,'received');return
    if time.monotonic()-tick>100:self.update(uid,mid,'expired');return
    if not self.claim_send(uid,mid):return
    sending=True
    result=await send({'action':'send_private_msg','params':{'user_id':uid,'message':answer},'_private_reply_mid':mid})
    if result.get('status')!='ok':raise RuntimeError('private_delivery_rejected')
    elapsed=round(time.monotonic()-tick,3)
    with self.db() as db,db:
     db.execute("UPDATE private_deliveries SET status='ok' WHERE uid=? AND mid=?",(uid,mid))
     db.execute("UPDATE private_inbox SET state='sent',text=?,answer=?,elapsed=?,qq_mid=? WHERE uid=? AND mid=?",(utterance,answer,elapsed,str((result.get('data') or {}).get('message_id')),uid,mid))
     for covered in batch:
      if covered!=mid:db.execute("UPDATE private_inbox SET state='coalesced' WHERE uid=? AND mid=? AND state NOT IN ('sent','sending','uncertain')",(uid,covered))
    try:self.character.commit(utterance,answer,uid,'private:'+uid,mid)
    except Exception as exc:
     print(json.dumps({'private_memory_commit_failed':mid,'error_type':type(exc).__name__,'delivery_preserved':True}),flush=True)
    print(json.dumps({'private_reply':'sent','source_message_id':mid,'seconds':elapsed,'chars':len(answer),'coalesced':len(batch)}),flush=True)
  except asyncio.CancelledError:
   if batch:self.update(uid,mid,'uncertain' if sending else 'received')
   raise
  except Exception as exc:
   self.update(uid,mid,'uncertain' if sending else 'received',elapsed=round(time.monotonic()-tick,3))
   print(json.dumps({'private_reply':'failed','source_message_id':mid,'error_type':type(exc).__name__,'send_uncertain':sending}),flush=True)

 async def model_reply(self,event,text,history):
  uid=str(event['user_id'])
  return await self.character.generate(text,uid,'private:'+uid,str(event['message_id']),history,event=event)

 async def recover_pending(self,send):
  with self.db() as db,db:
   db.execute("UPDATE private_inbox SET state='expired' WHERE state IN ('received','running','superseded') AND received<?",(time.time()-1200,))
   rows=db.execute("SELECT uid,mid,raw FROM private_inbox WHERE state IN ('received','superseded') ORDER BY received DESC,rowid DESC").fetchall()
  selected=set()
  for uid,mid,raw in rows:
   if uid in selected or uid in self.tasks or len(selected)>=3:continue
   if self.boundary.allowed_event(json.loads(raw)):
    selected.add(uid);self.schedule(uid,mid,send)
  print(json.dumps({'private_pending_recovery':len(selected),'uncertain_resends':0}),flush=True)
  return len(selected)

 async def close(self):
  active=set(self.tasks.values())|set(self.started)
  for task in active:task.cancel()
  await asyncio.gather(*active,return_exceptions=True)
