"""Reliable direct replies for genuine QQ group @. Other chat stays with MaiBot."""
import asyncio
import datetime
from collections import deque
from contextlib import closing
import json
from pathlib import Path
import re
import sqlite3
import time
from conversation_journal import ConversationJournal,still_useful
from character.runtime import CharacterRuntime,simple_fallback
from chat_perception import qq_message_text,emoji_intent,StickerVision
ROOT=Path(__file__).resolve().parents[2]
GROUP='680823437'; BOT='3816636861'
DB=ROOT/'work/instance/data/character-group-direct.sqlite3'

def text_of(event):
    return qq_message_text(event)

def is_group(event):
    return event.get('post_type')=='message' and event.get('message_type')=='group' and str(event.get('group_id',''))==GROUP and str(event.get('user_id',''))!=BOT

def is_direct_at(event):
    if not is_group(event):return False
    parts=event.get('message',[])
    if isinstance(parts,list):
        return any(x.get('type')=='at' and str(x.get('data',{}).get('qq',x.get('data',{}).get('user_id','')))==BOT for x in parts if isinstance(x,dict))
    return isinstance(parts,str) and bool(re.search(r'\[CQ:at,qq='+BOT+r'(?:,|\])',parts))

def is_addressed(event):
    if not is_group(event):return False
    if is_direct_at(event):return True
    body=text_of(event)
    # Direct names and playful claims to Fang Yuan's title, without QQ @.
    return bool(body.startswith(('方源','古月方源','大爱仙尊','炼天魔尊'))
                or re.search(r'(?:^|[\s,，。！？!?：:])(?:方源|古月方源|大爱仙尊|炼天魔尊)(?=[\s,，。！？!?：:]|$)',body)
                or re.search(r'我(?:是|乃|叫|自称)(?:大爱仙尊|炼天魔尊)',body))

class GroupReplies:
    def __init__(self,boundary,retrieval,*,database=DB,generate=None,deadline=40):
        self.boundary=boundary
        self.database=Path(database)
        self.database.parent.mkdir(parents=True,exist_ok=True)
        self.character=CharacterRuntime(retrieval,owner=boundary.friend)
        self.social=self.character.social
        self.vision=StickerVision()
        self.generate=generate or self.model_reply
        self.deadline=deadline
        self.tasks={}
        self.bursts={}
        self.reply_locks={}
        self.session_until={}
        self.history=deque(maxlen=22)
        self.seen=set()
        self.limit=asyncio.Semaphore(2)
        self.live_human_seen=False
        self.last_human_at=time.monotonic()
        self.last_sent_at=0.
        self.last_peer=''
        self.last_peer_at=0.
        self.last_activity_uid=''
        self.last_direct_uid=''
        self.direct_counter=0
        self.proactive_times=deque(maxlen=12)
        self.proactive_unanswered=0
        self.recent_answers=deque(maxlen=9)
        self.group_generation_tasks=set()
        with closing(sqlite3.connect(self.database)) as db,db:
            db.execute('CREATE TABLE IF NOT EXISTS direct_replies (mid TEXT PRIMARY KEY, uid TEXT, question TEXT, answer TEXT, status TEXT, received_at REAL, elapsed REAL, qq_message_id TEXT)')
        self.journal=ConversationJournal(self.database.with_suffix(".events.sqlite3"))
        self.proactive_unanswered=int(self.journal.get("proactive_unanswered",0))
        self._load_recent_group_history()

    def _load_recent_group_history(self):
        # Direct replies bypass native storage. Merge the public receipt journal
        # and confirmed sends as well; restoring history never sends anything.
        merged={}
        def add(mid,uid,body,nickname,stamp):
            body=str(body or '').strip()
            uid=str(uid or '')
            if not body or not uid:return
            try:stamp=float(stamp or 0)
            except (TypeError,ValueError):stamp=0.
            role='assistant' if uid==BOT else 'user'
            merged[(role,str(mid))]=(stamp,len(merged),str(mid),uid,body,nickname)
        db_file=ROOT/'work/instance/data/MaiBot.db'
        if db_file.is_file():
            try:
                with closing(sqlite3.connect('file:'+db_file.resolve().as_posix()+'?mode=ro',uri=True,timeout=2)) as db:
                    columns={row[1] for row in db.execute('PRAGMA table_info(mai_messages)')}
                    clock=next((name for name in ('time','timestamp','created_at') if name in columns),'0')
                    rows=db.execute(
                      "SELECT message_id,user_id,processed_plain_text,coalesce(nullif(user_cardname,''),user_nickname,''),"+clock+
                      ' FROM mai_messages WHERE group_id=? ORDER BY id DESC LIMIT 32',(GROUP,)).fetchall()
                for row in reversed(rows):add(*row)
            except (OSError,sqlite3.Error) as exc:
                print(json.dumps({'group_native_context_error':type(exc).__name__}),flush=True)
        with self.journal.db() as db:
            for mid,uid,body,nickname,stamp in reversed(db.execute(
                    'SELECT mid,uid,body,nickname,stamp FROM events ORDER BY stamp DESC LIMIT 40').fetchall()):
                add(mid,uid,body,nickname,stamp)
        with closing(sqlite3.connect(self.database)) as db:
            direct=db.execute("SELECT mid,uid,question,answer,received_at,elapsed,qq_message_id FROM direct_replies "
                              "WHERE status IN ('sent','coalesced_sent') ORDER BY received_at DESC LIMIT 24").fetchall()
        delivered={str(row[0]):str(row[6] or 'reply:'+str(row[0])) for row in direct}
        with self.social.db() as db:
            # The attention route has separate confirmed sends; DMs never enter.
            for mid,uid,body,answer,stamp in reversed(db.execute(
                    "SELECT mid,uid,text,answer,created_at FROM interactions WHERE scope=? AND answer IS NOT NULL "
                    "AND answer!='' ORDER BY created_at DESC LIMIT 24",('group:'+GROUP,)).fetchall()):
                add(mid,uid,body,'',stamp)
                add(delivered.get(str(mid),'reply:'+str(mid)),BOT,answer,'',stamp+.001)
        for mid,uid,question,answer,stamp,elapsed,qq_mid in reversed(direct):
            add(mid,uid,question,'',stamp)
            add(str(qq_mid or 'reply:'+str(mid)),BOT,answer,'',stamp+float(elapsed or 0)+.001)
        for _,_,mid,uid,body,nickname in sorted(merged.values())[-self.history.maxlen:]:
            display=str(nickname or '').strip().replace('\n',' ')[:40]
            value=body[:400] if uid==BOT else '群友'+('“'+display+'”' if display else '')+'(QQ '+uid+')：'+body[:400]
            self.history.append({'role':'assistant' if uid==BOT else 'user','content':value})
            if uid!=BOT:
                self.seen.add(mid)
                self.last_activity_uid=uid
            else:self.recent_answers.append(body[:400])
        print(json.dumps({'group_context_restored':len(self.history)},ensure_ascii=True),flush=True)

    def observe(self,event):
        if not is_group(event):return
        mid=str(event.get('message_id',''))
        if not mid or mid in self.seen:return
        self.seen.add(mid)
        self.journal.observe(event,text_of(event))
        # Learn explicit public self-reports even when no reply is warranted.
        self.social.observe(str(event.get('user_id','')),'group:'+GROUP,mid,text_of(event))
        if len(self.seen)>1500:self.seen=set(list(self.seen)[-700:])
        body=text_of(event)
        if body:
            if re.search(r'先睡|睡觉|晚安|别回了|不聊了',body):self.session_until[str(event.get('user_id'))]=0
            self.live_human_seen=True
            self.last_human_at=time.monotonic()
            if re.search(r"(?:我要|我去|准备|先|该|要)?睡(?:了|觉)|晚安|别再叫我|别@我",body):
                self.journal.put("quiet_until:"+str(event.get("user_id")),time.time()+8*3600)
            self.proactive_unanswered=0
            self.journal.put("proactive_unanswered",0)
            self.last_activity_uid=str(event.get('user_id'))
            sender=event.get('sender') or {}
            display=str(sender.get('card') or sender.get('nickname') or '').replace('\n',' ').strip()[:40]
            self.history.append({'role':'user','content':'群友'+('“'+display+'”' if display else '')+'(QQ '+self.last_activity_uid+')：'+body[:400]})

    def observe_bot(self,action):
        if action.get('action') not in {'send_group_msg','send_msg'}:return
        p=action.get('params') or {}
        if str(p.get('group_id',''))!=GROUP:return
        m=p.get('message','')
        if isinstance(m,list):body=''.join(str(x.get('data',{}).get('text','')) for x in m if isinstance(x,dict) and x.get('type')=='text')
        else:body=str(m)
        if body.strip():
            self.history.append({'role':'assistant','content':body[:400]})
            self.recent_answers.append(body[:400])
            self.last_sent_at=time.monotonic()

    def should_direct(self,event):
        if not is_group(event) or not self.boundary.allowed_event(event):return False
        parts=event.get('message',[])
        if isinstance(parts,list) and not is_direct_at(event) and any(
                x.get('type')=='at' and str((x.get('data') or {}).get('qq','')) not in ('',BOT)
                for x in parts if isinstance(x,dict)):return False
        manager=getattr(getattr(self,'character',None),'account_tasks',None)
        if manager and manager.interested(text_of(event),str(event.get('user_id','')),'group:'+GROUP):return True
        if is_addressed(event):return True
        # Established dialogue has its own finite session; it is not an ambient
        # topic invitation and does not inherit the spontaneous cooldown.
        uid=str(event.get('user_id'));body=text_of(event)
        fallback=self.last_peer_at+125 if uid==self.last_peer else 0
        until=getattr(self,'session_until',{}).get(uid,fallback)
        return bool(body and time.monotonic()<until)

    def submit(self,event,send):
        if not self.should_direct(event):return None
        mid,uid=str(event.get('message_id','')),str(event.get('user_id',''))
        if not mid:return None
        context=list(self.history)[-10:]
        question=text_of(event) or '在吗'
        with closing(sqlite3.connect(self.database)) as db,db:
            inserted=db.execute('INSERT OR IGNORE INTO direct_replies(mid,uid,question,status,received_at) VALUES(?,?,?,?,?)',(mid,uid,question,'received',time.time())).rowcount
        if not inserted:return None
        age=time.time()-float(event.get('time') or time.time())
        if not event.get('_recovery') and age>120:
            if age<=21600 and still_useful(question) and time.time()-float(self.journal.get('late_ingress_recovery_at',0))>1800:
                self.journal.put('late_ingress_recovery_at',time.time())
                event={**event,'_recovery':True}
            else:
                self.journal.observe(event,question)
                self.update(mid,'expired_input')
                print(json.dumps({'group_expired_input':mid,'source_age_seconds':round(age)}),flush=True)
                return None
        self.observe(event)
        previous=self.bursts.get(uid)
        if previous and not previous['started']:
            old=self.tasks.get(previous['mid'])
            if old and not old.done():old.cancel()
            context=previous['context']
            parts=previous['parts']+[question]
            mids=previous['mids']+[mid]
        else:parts,mids=[question],[mid]
        self.bursts[uid]={'mid':mid,'parts':parts,'mids':mids,'context':context,'started':False}
        question='\n'.join(parts)
        event={**event,'_burst_mids':mids}
        if not re.search(r'先睡|睡觉|晚安|别回了|不聊了',question):self.session_until[uid]=time.monotonic()+180
        self.last_direct_uid=uid
        task=asyncio.create_task(self.run(event,question,context,send),name='group-direct-'+mid)
        self.tasks[mid]=task
        task.add_done_callback(lambda _,m=mid:self.tasks.pop(m,None))
        return task

    def update(self,mid,status,answer='',elapsed=None,qq_mid=None):
        with closing(sqlite3.connect(self.database)) as db,db:
            db.execute('UPDATE direct_replies SET status=?,answer=?,elapsed=?,qq_message_id=? WHERE mid=?',(status,answer,elapsed,str(qq_mid) if qq_mid is not None else None,mid))

    async def model_reply(self,event,question,history):
        return await self.character.generate(question,str(event['user_id']),'group:'+GROUP,str(event['message_id']),history,
                                             ambient=bool(event.get('_spontaneous')),identity_context=self.journal.identities()+self.journal.cultural_context(question),event=event)

    async def run(self,event,question,history,send):
        mid,uid=str(event['message_id']),str(event['user_id'])
        try:
            if not event.get('_recovery'):await asyncio.sleep(.8)
            state=self.bursts.get(uid)
            if state and state['mid']==mid:state['started']=True
            lock=self.reply_locks.setdefault(uid,asyncio.Lock())
            async with lock:
                await self._run(event,question,history,send)
        except asyncio.CancelledError:
            self.update(mid,'coalesced_or_cancelled');raise
        finally:
            if self.bursts.get(uid,{}).get('mid')==mid:self.bursts.pop(uid,None)

    async def _run(self,event,question,history,send):
        mid=str(event['message_id']); start=time.monotonic()
        try:
            async with self.limit:
                self.update(mid,'running')
                try:
                    flavor=emoji_intent(question)
                    if flavor:question+='\n【表情语气】'+flavor
                    if '[图片表情' in question:
                        try:
                            caption=await asyncio.wait_for(self.vision.explain(event,send),timeout=8)
                        except (TimeoutError,OSError):
                            caption=''
                        question+=('\n【本地图像识别】'+caption if caption else '\n【图片暂未识别】不要假装看清了。')
                    answer=await asyncio.wait_for(self.generate(event,question,history),timeout=self.deadline)
                    if not answer or not answer.strip():raise ValueError('Empty model answer')
                    answer=answer.strip()
                    if answer in {'[沉默]','沉默','[不参与]'}:
                        self.update(mid,'skipped');return
                except Exception as exc:
                    answer=simple_fallback(question) or '刚才卡了一下，这句没接住。'
                    print(json.dumps({'group_direct_fallback':mid,'reason':type(exc).__name__}),flush=True)
                if not self.boundary.allowed_event(event):
                    self.update(mid,'disabled',elapsed=round(time.monotonic()-start,2));return
                if not event.get('_recovery') and time.monotonic()-start>60:
                    self.update(mid,'expired',elapsed=round(time.monotonic()-start,2));return
                # Return the @ to an actual participant, not to the whole group.
                # Alternate mentions to avoid a notification on every single turn.
                self.direct_counter+=1
                peer=str(event.get('user_id',''))
                mention=bool(peer and peer.isdigit() and (
                    not is_direct_at(event) or self.direct_counter%2==0))
                if event.get('_recovery') or datetime.datetime.now().hour>=23 or datetime.datetime.now().hour<8:mention=False
                segments=([{'type':'at','data':{'qq':peer}},{'type':'text','data':{'text':' '+answer}}]
                          if mention else answer)
                if event.get('_recovery'):
                    segments=[{'type':'reply','data':{'id':mid}},{'type':'text','data':{'text':answer}}]
                response=await send({'action':'send_group_msg','params':{'group_id':GROUP,'message':segments},'_delivery_key':'reply:'+mid})
                if response.get('status')!='ok':raise RuntimeError('QQ rejected group send')
                elapsed=round(time.monotonic()-start,3)
                self.update(mid,'sent',answer,elapsed,(response.get('data') or {}).get('message_id'))
                self.journal.answered(mid)
                for covered in event.get('_burst_mids',[]):
                    if covered!=mid:
                        self.update(covered,'coalesced_sent',answer,elapsed,(response.get('data') or {}).get('message_id'))
                        self.journal.answered(covered)
                self.history.append({'role':'assistant','content':answer[:400]})
                self.recent_answers.append(answer[:400])
                self.last_sent_at=time.monotonic()
                self.last_peer=peer
                self.last_peer_at=self.last_sent_at
                self.character.commit(question,answer,str(event['user_id']),'group:'+GROUP,mid)
                print(json.dumps({'group_direct':'sent','source_message_id':mid,'elapsed':elapsed}),flush=True)
        except asyncio.CancelledError:
            self.update(mid,'cancelled',elapsed=round(time.monotonic()-start,2));raise
        except Exception as exc:
            self.update(mid,'failed',elapsed=round(time.monotonic()-start,2))
            print(json.dumps({'group_direct':'failed','source_message_id':mid,'reason':type(exc).__name__}),flush=True)

    async def idle_once(self,send,*,now=None,hour=None):
        """Quiet periods stay quiet; live event-driven participation stays enabled."""
        return False

    async def idle_loop(self,send):
        while True:
            await asyncio.sleep(30)
            await self.idle_once(send)

    async def close(self):
        for task in list(self.tasks.values()):task.cancel()
        await asyncio.gather(*self.tasks.values(),return_exceptions=True)

class NativeReplyThrottle:
    """At most one spontaneous MaiBot group send per newly received group message."""
    def __init__(self):
        self.last_incoming=None
        self.last_native_sent=None
    def observe(self,event):
        if is_group(event) and not is_direct_at(event):
            self.last_incoming=str(event.get('message_id',''))
    def permit(self,payload):
        p=payload.get('params') or {}
        if payload.get('action') not in {'send_group_msg','send_msg'} or str(p.get('group_id',''))!=GROUP:
            return True
        if not self.last_incoming or self.last_incoming==self.last_native_sent:
            return False
        self.last_native_sent=self.last_incoming
        return True
