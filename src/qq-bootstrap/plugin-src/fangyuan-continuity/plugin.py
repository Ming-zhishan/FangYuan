"""Thin SDK-only bridge. Shared logic lives in versioned work/setup/character.

Uses public MaiBot 1.3.12 hooks; never imports or patches installed src modules.
"""
import copy
from datetime import datetime, timezone
from pathlib import Path
import re
import sys
from uuid import uuid4

from maibot_sdk import MaiBotPlugin, HookHandler
from maibot_sdk.types import HookOrder

# This plugin is deployed at work/instance/plugins/fangyuan-continuity/plugin.py.
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'work/setup'))
from character.runtime import CharacterRuntime
from character.prompts import PLANNER
from character.culture import who as member_name
from character_retrieval import ReviewedRetrieval

GROUP='680823437'
BOT='3816636861'


def plain(message):
    text=message.get('processed_plain_text')
    if text:
        return str(text)
    chunks=[]
    for segment in message.get('raw_message') or []:
        if segment.get('type')=='text':
            data=segment.get('data','')
            chunks.append(str(data.get('text','')) if isinstance(data,dict) else str(data))
    return ''.join(chunks)


def item(kind,text):
    return {'item_type':kind,'meta':{'item_id':str(uuid4()),'logical_turn_id':None,
            'timestamp':datetime.now(timezone.utc).isoformat()},'parts':[{'type':'text','text':text}]}


class FangyuanPlugin(MaiBotPlugin):
    async def on_config_update(self,scope,config_data,version):
        # No plugin-local mutable settings; shared code/config changes are applied by a managed restart.
        return None

    async def on_load(self):
        self.runtime=CharacterRuntime(ReviewedRetrieval(cpu=True))
        self.contexts={}
        self.pending={}
        self.repairs={}
        self.outbound_claims=set()
        self.ctx.logger.info('方源连续生活插件已加载：公开 SDK hooks，原著库不写回。')

    async def on_unload(self):
        self.contexts.clear()
        self.pending.clear()

    async def target(self,sid):
        result=await self.ctx.chat.get_stream_by_group_id(GROUP)
        stream=result.get('stream') or {}
        expected=str(stream.get('session_id') or stream.get('stream_id') or '')
        actual=str(sid or '')
        if actual.startswith('maisaka:'):
            actual=actual[len('maisaka:'):]
        return bool(expected) and actual==expected

    async def incoming(self,kwargs):
        sid,mid=str(kwargs.get('session_id','')),str(kwargs.get('reply_message_id',''))
        if not await self.target(sid):
            return None
        if mid:
            result=await self.ctx.message.get_by_id(mid,chat_id=sid)
            message=result.get('message') or {}
        else:
            result=await self.ctx.message.get_recent(sid,limit=12)
            recent=sorted(result.get('messages') or [],key=lambda m:float(m.get('timestamp') or 0),reverse=True)
            message=next((m for m in recent if str((m.get('message_info') or {}).get('user_info',{}).get('user_id'))!=BOT),{})
        group=(message.get('message_info') or {}).get('group_info') or {}
        if str(group.get('group_id'))!=GROUP:
            return None
        return message

    @HookHandler('maisaka.planner.before_request',order=HookOrder.LATE,timeout_ms=6000)
    async def planner(self,**kwargs):
        if await self.target(kwargs.get('session_id')):
            items=copy.deepcopy(kwargs.get('items') or [])
            system=next((x for x in items if x.get('item_type')=='SystemMessageItem'),None)
            if system:
                system['parts'].append({'type':'text','text':'\n'+PLANNER})
            else:
                items.insert(0,item('SystemMessageItem',PLANNER))
            kwargs['items']=items
        return {'action':'continue','modified_kwargs':kwargs}

    @HookHandler('maisaka.replyer.before_request',order=HookOrder.LATE,timeout_ms=6000)
    async def select_model(self,**kwargs):
        message=await self.incoming(kwargs)
        if message:
            from character.knowledge import anchors
            text=plain(message)
            serious=bool(anchors(text) or self.runtime.retrieval.relevant(text) or
                         re.search(r'深入|详细|认真推演|明天.*更好|失败|坚持',text))
            kwargs['model_name']='fangyuan-cloud' if (ROOT/'work/private/cloud-runtime.json').exists() else ('fangyuan-reply-thinking' if serious and not re.match(r'^快答[：:\s]',text) else 'fangyuan-local')
        return {'action':'continue','modified_kwargs':kwargs}

    @HookHandler('maisaka.replyer.before_model_request',order=HookOrder.LATE,timeout_ms=8000)
    async def context(self,**kwargs):
        message=await self.incoming(kwargs)
        if not message:
            return {'action':'continue'}
        sid=str(kwargs['session_id'])
        hook_mid=str(kwargs.get('reply_message_id',''))
        mid=str(message.get('message_id',''))
        uid=str(message['message_info']['user_info']['user_id'])
        result=await self.ctx.message.get_recent(sid,limit=12)
        recent=sorted(result.get('messages') or [],key=lambda m:float(m.get('timestamp') or 0))
        history=[]
        for old in recent:
            if str(old.get('message_id'))==mid:
                break
            old_uid=str((old.get('message_info') or {}).get('user_info',{}).get('user_id',''))
            text=plain(old)
            if not text:
                continue
            role='assistant' if old_uid==BOT else 'user'
            history.append({'role':role,'content':text if role=='assistant' else (member_name(old_uid) or f'群友账号{old_uid}')+f'：{text}'})
        c=await self.runtime.prepare(plain(message),uid,'group:'+GROUP,mid,history)
        key=(sid,hook_mid)
        if kwargs.get('retry_count',0) and key in self.repairs:
            c['system']+='\n上一稿已拦截，请具体纠正：'+'；'.join(self.repairs[key])
        self.contexts[key]=c
        # Replyer request has no tool calls. Preserve any unexpected extension protocol unchanged.
        if any(x.get('item_type') not in {'SystemMessageItem','UserMessageItem','AssistantMessageItem'} for x in kwargs.get('items',[])):
            return {'action':'continue'}
        kinds={'system':'SystemMessageItem','user':'UserMessageItem','assistant':'AssistantMessageItem'}
        kwargs['items']=[item(kinds[m['role']],m['content']) for m in self.runtime.messages(c)]
        # Native history/reply target is read through SDK, not reconstructed from injected transport notes.
        if len(self.contexts)>64:
            stale=next(iter(self.contexts))
            self.contexts.pop(stale,None)
            self.repairs.pop(stale,None)
        return {'action':'continue','modified_kwargs':kwargs}

    @HookHandler('maisaka.replyer.after_response',order=HookOrder.LATE,timeout_ms=3000)
    async def check_response(self,**kwargs):
        key=(str(kwargs.get('session_id','')),str(kwargs.get('reply_message_id','')))
        c=self.contexts.get(key)
        if not c:
            return {'action':'continue'}
        answer=str(kwargs.get('response') or '').strip()
        errors=self.runtime.check(answer,c)
        if errors and int(kwargs.get('retry_count',0))<1:
            self.repairs[key]=errors
            kwargs.update(retry=True,retry_reason='；'.join(errors))
        else:
            if errors:
                answer=self.runtime.fallback(c)
                kwargs['output_items']=[item('AssistantMessageItem',answer)]
            self.pending[key]={'context':c,'answer':answer}
            if len(self.pending)>64:
                self.pending.pop(next(iter(self.pending)))
            self.ctx.logger.info('方源回复检查 mid=%s retry=%s fallback=%s',c['mid'],kwargs.get('retry_count'),bool(errors))
        return {'action':'continue','modified_kwargs':kwargs}

    @HookHandler('send_service.after_send',timeout_ms=3000)
    async def delivered(self,**kwargs):
        if not kwargs.get('sent'):
            return {'action':'continue'}
        message=kwargs.get('message') or {}
        group=(message.get('message_info') or {}).get('group_info') or {}
        if str(group.get('group_id'))!=GROUP:
            return {'action':'continue'}
        sid=str(message.get('session_id',''))
        answer=plain(message).strip()
        matches=[(k,v) for k,v in self.pending.items() if k[0]==sid and v['answer'].strip()==answer]
        if len(matches)==1:
            key,pending=matches[0]
            c=pending['context']
            self.runtime.commit(c['text'],answer,c['uid'],c['scope'],c['mid'])
            self.pending.pop(key,None)
        return {'action':'continue'}

    @HookHandler('send_service.before_send',order=HookOrder.LATE,timeout_ms=3000)
    async def prevent_duplicate(self,**kwargs):
        message=kwargs.get('message') or {}
        sid=str(message.get('session_id',''))
        answer=plain(message).strip()
        matches=[(k,v) for k,v in self.pending.items() if k[0]==sid and v['answer'].strip()==answer]
        if len(matches)==1:
            key,pending=matches[0]
            c=pending['context']
            marker=(c['scope'],c['mid'])
            if marker in self.outbound_claims or self.runtime.social.answered(*marker):
                self.ctx.logger.info('方源防重复已拦截：mid=%s',c['mid'])
                return {'action':'abort','reason':'同一真实群消息只允许一条回复'}
            # Reserve the turn before sending, since after_send callbacks are not
            # guaranteed to match the pending item and had left answer=NULL.
            self.outbound_claims.add(marker)
            self.runtime.social.record_reply(c['scope'],c['mid'],answer)
            if len(self.outbound_claims)>200:
                self.outbound_claims=set(list(self.outbound_claims)[-100:])
            self.ctx.logger.info('方源防重复已预留：mid=%s',c['mid'])
        return {'action':'continue'}


def create_plugin():
    return FangyuanPlugin()
