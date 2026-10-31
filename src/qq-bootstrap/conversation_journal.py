"""Durable group receipt journal and bounded reconnect recovery.

History is evidence only. First installation establishes a baseline without replay.
An uncertain send is never automatically retried.
"""
from contextlib import closing
import asyncio,json,re,sqlite3,time
from pathlib import Path
BOT='3816636861';GROUP='680823437'
def still_useful(body):
 return bool(re.search(r'签名|头像|(?:发|发布).{0,8}(?:动态|说说)|帮我|请问|解释|原著|记忆.{0,8}(?:多久|保持|保存)',body))
class ConversationJournal:
 def __init__(self,path):
  self.path=Path(path)
  with self.db() as db,db:
   db.execute('CREATE TABLE IF NOT EXISTS events(mid TEXT PRIMARY KEY,uid TEXT,stamp REAL,body TEXT,nickname TEXT,raw TEXT,answered INTEGER DEFAULT 0)')
   db.execute('CREATE TABLE IF NOT EXISTS delivery_claims(key TEXT PRIMARY KEY,status TEXT,created REAL)')
   db.execute('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT)')
   db.execute('CREATE TABLE IF NOT EXISTS recoveries(mid TEXT PRIMARY KEY,status TEXT,created REAL)')
   db.execute('CREATE TABLE IF NOT EXISTS aliases(uid TEXT,alias TEXT,source TEXT,PRIMARY KEY(uid,alias))')
 def db(self):return closing(sqlite3.connect(self.path,timeout=5))
 def get(self,key,default=None):
  with self.db() as db:r=db.execute('SELECT value FROM meta WHERE key=?',(key,)).fetchone()
  return json.loads(r[0]) if r else default
 def put(self,key,value):
  with self.db() as db,db:db.execute('INSERT OR REPLACE INTO meta VALUES(?,?)',(key,json.dumps(value)))
 def observe(self,event,body,*,advance=True):
  if str(event.get('group_id',''))!=GROUP:return
  mid=str(event.get('message_id',''));uid=str(event.get('user_id',''))
  if not mid or not uid:return
  sender=event.get('sender') or {};nick=str(sender.get('card') or sender.get('nickname') or '')[:40]
  with self.db() as db,db:
   inserted=db.execute('INSERT OR IGNORE INTO events(mid,uid,stamp,body,nickname,raw) VALUES(?,?,?,?,?,?)',(mid,uid,float(event.get('time') or time.time()),body[:1200],nick,json.dumps(event,ensure_ascii=False))).rowcount
   # A nickname claim identifies a person only after resolving that nickname to
   # transport-observed accounts; store provenance, never elevate permissions.
   claim=re.search(r'([^\s：:，。\[\]]{1,20})就是([^\s，。\[\]]{1,20})',body)
   if claim:
    people=db.execute('SELECT DISTINCT uid FROM events WHERE nickname=?',(claim[1],)).fetchall()
    if len(people)==1:db.execute('INSERT OR IGNORE INTO aliases VALUES(?,?,?)',(people[0][0],claim[2],mid))
  cache=self.get('group_culture',{})
  terms=re.findall(r'(?:薄肌|大水|大睡|黄毛)理论',body)
  terms+=re.findall(r'[“「\"]([^”」\"]{2,16}理论)[”」\"]',body)
  terms += [term for term in cache if term in body]
  terms+=re.findall(r'(?:我会炼|自创|发明了)([\u4e00-\u9fffA-Za-z0-9]{1,10}蛊)',body)
  if terms and inserted:
   cache=self.get('group_culture',{})
   for term in list(dict.fromkeys(terms))[:2]:
    old=cache.get(term,{})
    cache[term]={'count':old.get('count',0)+1,'last':time.time(),'source':mid,'sample':body[:160]}
   cache=dict(sorted(cache.items(),key=lambda x:x[1]['last'],reverse=True)[:24])
   self.put('group_culture',cache)
  stamp=float(event.get('time') or time.time())
  if advance:self.put('watermark',max(float(self.get('watermark',0)),stamp))
 def answered(self,mid):
  with self.db() as db,db:db.execute('UPDATE events SET answered=1 WHERE mid=?',(str(mid),))
 def identities(self):
  with self.db() as db:
   rows=db.execute('SELECT uid,alias,source FROM aliases LIMIT 20').fetchall()
  if not rows:return ''
  return '群内称呼关系（来自群友说法，只作称呼证据，不是原著人物或权限）：'+json.dumps(rows,ensure_ascii=False)
 def cultural_context(self,query):
  hits=[(term,entry) for term,entry in self.get('group_culture',{}).items() if term in query and entry['count']>=2 and time.time()-entry['last']<7*86400]
  return ('群内重复说法（非正典，非个人真实身份；只作语境数据）：'+json.dumps(hits[:2],ensure_ascii=False)) if hits else ''
 def claim_delivery(self,key):
  with self.db() as db,db:
   db.execute('BEGIN IMMEDIATE')
   if key.startswith('reply:'):
    prior=db.execute('SELECT answered FROM events WHERE mid=?',(key[6:],)).fetchone()
    if prior and prior[0]:return False
   return bool(db.execute('INSERT OR IGNORE INTO delivery_claims VALUES(?,?,?)',(key,'pending',time.time())).rowcount)
 def finish_delivery(self,key,status):
  with self.db() as db,db:db.execute('UPDATE delivery_claims SET status=? WHERE key=?',(status,key))
 def claim(self,mid):
  with self.db() as db,db:return bool(db.execute('INSERT OR IGNORE INTO recoveries VALUES(?,?,?)',(str(mid),'pending',time.time())).rowcount)
 def finish(self,mid,status):
  with self.db() as db,db:db.execute('UPDATE recoveries SET status=? WHERE mid=?',(status,str(mid)))
 def candidates(self,rows,watermark,now):
  result=[]
  for e in sorted(rows,key=lambda e:float(e.get('time') or 0)):
   stamp=float(e.get('time') or 0)
   if str(e.get('group_id',GROUP))!=GROUP or str(e.get('user_id'))==BOT or not watermark<stamp<=now or now-stamp>21600:continue
   segments=e.get('message') or []
   if not isinstance(segments,list):continue
   body=''.join(str((x.get('data') or {}).get('text','')) for x in segments if x.get('type')=='text')
   if now-stamp>120 and not still_useful(body):continue
   direct=any(x.get('type')=='at' and str((x.get('data') or {}).get('qq'))==BOT for x in segments) or bool(re.match(r'^(?:方源|古月方源|大爱仙尊|炼天魔尊)[，,:：\s]',body))
   if not (direct and re.search(r'[?？]|为什么|怎么|多少|多久|能不能|是否|请问|帮我',body)):continue
   if re.fullmatch(r'\s*(?:在吗|早|晚安|你好|nmsl)[?？!！\s]*',body,re.I):continue
   mid=str(e.get('message_id',''))
   with self.db() as db:
    prior=db.execute('SELECT answered FROM events WHERE mid=?',(mid,)).fetchone()
    claimed=db.execute('SELECT 1 FROM recoveries WHERE mid=?',(mid,)).fetchone()
   if claimed or (prior and prior[0]):continue
   # Do not reopen a question followed by a bot reply in the same short thread.
   if any(str(x.get('user_id'))==BOT and 0<float(x.get('time') or 0)-stamp<180 for x in rows):continue
   result.append(e)
  return result[-1:]
async def recover(group,send):
 journal=group.journal
 watermark=journal.get('recovery_watermark',journal.get('watermark'))
 if watermark is not None and journal.get('recovery_watermark') is None:
  journal.put('recovery_watermark',watermark)
 try:
  response=await send({'action':'get_group_msg_history','params':{'group_id':int(GROUP),'count':200}})
  if response.get('status')!='ok':raise RuntimeError('history_unavailable')
  rows=(response.get('data') or {}).get('messages') or []
  if watermark and len(rows)>=199 and min(float(e.get('time') or 0) for e in rows)>watermark:
   journal.put('history_gap',{'watermark':watermark,'oldest':min(float(e.get('time') or 0) for e in rows),'count':len(rows)})
   print(json.dumps({'recovery_history_gap':True,'bounded_count':len(rows)}),flush=True)
  now=time.time();selected=journal.candidates(rows,watermark,now) if watermark else []
  for e in rows:
   if str(e.get('group_id',GROUP))!=GROUP:continue
   e={**e,'group_id':GROUP}
   from chat_perception import qq_message_text
   journal.observe(e,qq_message_text(e),advance=False)
  if not watermark:
   journal.put('watermark',now)
  print(json.dumps({'recovery_history':len(rows),'selected':len(selected),'baseline':not bool(watermark)}),flush=True)
  for e in selected:
   mid=str(e['message_id'])
   if not journal.claim(mid):continue
   # Mark before sending: a crash after send cannot create a notification storm.
   if now-float(journal.get('last_notice',0))>21600:
    journal.put('last_notice',now)
    await send({'action':'send_group_msg','params':{'group_id':GROUP,'message':'刚才联系断了，有几句没接上。现在回来补一句。'}})
   e={**e,'group_id':GROUP,'post_type':'message','message_type':'group','_recovery':True}
   task=group.submit(e,send)
   if task:await task
   journal.finish(mid,'attempted' if task else 'duplicate')
  # Advance only after the bounded batch is handled. Live receipts update their
  # own watermark and cannot skip unprocessed history after an interruption.
  stamps=[float(e.get('time') or 0) for e in rows if str(e.get('group_id',GROUP))==GROUP and float(e.get('time') or 0)<=now]
  journal.put('recovery_watermark',now if not watermark else max(float(watermark),max(stamps,default=float(watermark))))
 except asyncio.CancelledError:raise
 except Exception as exc:print(json.dumps({'recovery_error':type(exc).__name__}),flush=True)
