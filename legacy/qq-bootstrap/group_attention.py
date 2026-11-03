"""Continuous, event-driven group conversation participation for Fang Yuan.

Every human turn is observed, including messages without @ or bot name.
Messages are briefly coalesced; the character model chooses to join or stay
quiet using the *entire* local conversation instead of word triggers.
"""
import asyncio
from collections import deque
import json
import re
import time
from group_replies import is_group,is_addressed,is_direct_at,text_of,GROUP
from chat_perception import StickerVision,emoji_intent

SKIP_VALUES={'[沉默]','沉默','[不参与]','不参与','<silence>','skip','[skip]'}
OTHER_TARGET=re.compile(r'^(?:@|\[CQ:at,).*')
MULTI_PARTY=re.compile(r'[？?]|(?:你们|大家|有没有人|各位|咋办|怎么看|有人|聊聊|真的假的|我想|你觉得|啊这|笑死|卧槽|绷不住)')

class ConversationAttention:
    def __init__(self,group,send,*,debounce=1.4,cooldown=12.0,vision=None):
        self.group=group
        self.send=send
        self.debounce=debounce
        self.cooldown=cooldown
        self.vision=vision or group.vision
        self.pending=None
        self.sequence=0
        self.last_attempt=0.0
        self.sent_in_window=deque(maxlen=20)
        self.recent_human=deque(maxlen=30)
        self.stats={'observed':0,'eligible':0,'joined':0,'skipped':0,'superseded':0,'errors':0}
        self.running=set()
        self.prewarm_task=None
        if hasattr(self.vision,'warmup'):
            self.prewarm_task=asyncio.create_task(self.vision.warmup(),name='local-sticker-vision-prewarm')

    def observe(self,event):
        if not is_group(event) or not self.group.boundary.allowed_event(event):return
        body=text_of(event)
        if not body:return
        now=time.monotonic()
        self.stats['observed']+=1
        self.recent_human.append((now,str(event.get('user_id')),body))
        self.sequence+=1
        ver=self.sequence
        if self.pending and not self.pending.done():
            self.pending.cancel()
        # Explicit addressing has its own fast path, but still updates attention.
        if self.group.should_direct(event):
            return
        self.pending=asyncio.create_task(self._delayed(ver,event),name='group-attention-'+str(event.get('message_id')))
        self.running.add(self.pending)
        self.pending.add_done_callback(self.running.discard)

    def potential(self,event):
        if event.get('time') and time.time()-float(event['time'])>120:return False
        body=text_of(event)
        if not body:return False
        # Observe @other turns as context, but don't interrupt their conversation.
        parts=event.get('message',[])
        other_at=any(x.get('type')=='at' and str((x.get('data') or {}).get('qq','')) not in ('',self.group_id())
                     for x in parts if isinstance(x,dict)) if isinstance(parts,list) else False
        recent_bot=time.monotonic()-self.group.last_sent_at<150
        if re.search(r'睡觉|先睡了|晚安|别再叫我|别@我',body):return False
        if other_at:return False  # Someone explicitly addressed another group member; observe silently.
        recently_active=sum(1 for t,_,_ in self.recent_human if time.monotonic()-t<110)
        question=bool(MULTI_PARTY.search(body))
        sticker=any(x in body for x in ('[表情','[图片表情','😂','😭','🥹','🤣','[笑哭]','[贴贴]'))
        # Stickers are often full turns (e.g. 贴贴 or 笑哭) in small groups.
        # Let the character judge social relevance; don't auto-reply to each.
        return bool(recent_bot or recently_active>=2 or question or sticker or len(body)>=5)

    @staticmethod
    def group_id():
        from group_replies import BOT
        return BOT

    async def _delayed(self,version,event):
        try:
            await asyncio.sleep(self.debounce)
            if version!=self.sequence:return
            if not self.potential(event):
                self.stats['skipped']+=1
                return
            now=time.monotonic()
            self.sent_in_window=deque([t for t in self.sent_in_window if now-t<120],maxlen=20)
            if now-self.group.last_sent_at<self.cooldown or len(self.sent_in_window)>=5:
                self.stats['skipped']+=1
                return
            if self.group.limit.locked():
                self.stats['skipped']+=1
                return
            self.stats['eligible']+=1
            task=asyncio.create_task(self._respond(version,event),name='group-spontaneous-'+str(event.get('message_id')))
            self.running.add(task)
            task.add_done_callback(self.running.discard)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.stats['errors']+=1
            print(json.dumps({'group_attention_error':type(exc).__name__}),flush=True)

    async def _respond(self,version,event):
        mid=str(event.get('message_id',''))
        uid=str(event.get('user_id',''))
        raw=text_of(event)
        body=raw
        try:
            if '[图片表情' in raw:
                try:
                    caption=await asyncio.wait_for(self.vision.explain(event,self.send),timeout=8)
                except (TimeoutError,OSError):
                    caption=''
                body=raw + ('\n【本地图像识别】'+caption if caption else '\n【图片暂未识别】不猜测表情包上有什么。')
            flavor=emoji_intent(body)
            if flavor:body+='\n【表情语气参考】'+flavor
            if version!=self.sequence:return
            history=list(self.group.history)[-12:]
            if len(history)>=2 and history[-1].get('role')=='user':
                # Latest event has already been added to the observation history;
                # avoid repeating the same content twice with ambiguous authors.
                history=history[:-1]
            # LLM chooses interest in one generation (no separate slow Planner).
            question=body
            spontaneous_event={**event,'_spontaneous':True}
            async with self.group.limit:
                response=await asyncio.wait_for(
                    self.group.generate(spontaneous_event,question,history),timeout=38)
            response=(response or '').strip()
            if response and response.startswith('方源：'):
                response=response[3:].strip()
            if (not response or response.lower() in SKIP_VALUES or response.startswith('[沉默]') or
                response.startswith('【沉默】') or response.startswith('不参与')):
                self.stats['skipped']+=1
                print(json.dumps({'group_attention':'skip','mid':mid,'reason':'model_decision'}),flush=True)
                return
            now=time.monotonic()
            if (version!=self.sequence or now-self.group.last_sent_at<self.cooldown or
                    not self.group.boundary.allowed_event(event)):
                self.stats['superseded']+=1
                return
            self.sent_in_window=deque([t for t in self.sent_in_window if now-t<120],maxlen=20)
            if len(self.sent_in_window)>=5:return
            from difflib import SequenceMatcher
            if any(SequenceMatcher(None,response,old).ratio()>.68 for old in list(self.group.recent_answers)[-6:]):
                self.stats['skipped']+=1
                print(json.dumps({'group_attention':'skip','mid':mid,'reason':'repeat'}),flush=True)
                return
            # Ambient replies are not an @ notification unless the thread clearly
            # involves this person, to avoid nuisance in a tiny QQ group.
            reference_person=(self.group.last_peer==uid and now-self.group.last_peer_at<110)
            self.group.direct_counter+=1
            mention=reference_person and self.group.direct_counter%3==0 and uid.isdigit()
            if time.localtime().tm_hour>=23 or time.localtime().tm_hour<8:mention=False
            if hasattr(self.group,'journal') and time.time()<float(self.group.journal.get('quiet_until:'+uid,0)):mention=False
            segments=([{'type':'at','data':{'qq':uid}},{'type':'text','data':{'text':' '+response}}]
                      if mention else response)
            receipt=await self.send({'action':'send_group_msg','params':{'group_id':GROUP,'message':segments},'_delivery_key':'reply:'+mid})
            if receipt.get('status')!='ok':raise RuntimeError('QQ reject')
            self.group.history.append({'role':'assistant','content':response[:400]})
            self.group.recent_answers.append(response[:400])
            self.group.last_sent_at=time.monotonic()
            self.group.last_peer=uid
            self.group.last_peer_at=self.group.last_sent_at
            self.group.character.commit(raw,response,uid,'group:'+GROUP,mid)
            if hasattr(self.group,'journal'):self.group.journal.answered(mid)
            self.sent_in_window.append(self.group.last_sent_at)
            self.stats['joined']+=1
            print(json.dumps({'group_attention':'joined','mid':mid,'chars':len(response),'stats':self.stats},ensure_ascii=False),flush=True)
        except asyncio.CancelledError:raise
        except Exception as exc:
            self.stats['errors']+=1
            print(json.dumps({'group_attention':'failed','mid':mid,'reason':type(exc).__name__}),flush=True)

    async def close(self):
        if self.prewarm_task and not self.prewarm_task.done():
            self.prewarm_task.cancel()
        for task in list(self.running):
            task.cancel()
        tasks=list(self.running)+([self.prewarm_task] if self.prewarm_task else [])
        await asyncio.gather(*tasks,return_exceptions=True)
