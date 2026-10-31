"""Local OneBot boundary: trusted account identity, scoped sends, separate evidence memory.

The channel never promotes a chat claim to account authority or original-book knowledge.
It does not guarantee that an LLM will follow all persona instructions.
"""
import asyncio
from contextlib import contextmanager
import hashlib
import hmac
import json
from pathlib import Path
import re
import sqlite3
import time
from urllib.parse import parse_qs, urlsplit

import websockets
from character_retrieval import ReviewedRetrieval
from private_replies import PrivateReplies
from group_replies import GroupReplies,is_direct_at,is_group,NativeReplyThrottle
from group_attention import ConversationAttention
from character.social import SocialMemory
from friend_access import FriendDirectory
from private_channel import private_connection

ROOT = Path(__file__).resolve().parents[2]
IDENTITY = ROOT / 'work/private/character-identity.json'
DATABASE = ROOT / 'work/instance/data/character-relationships.sqlite3'
MODE_FILE = ROOT / 'work/private/chat-mode.json'
GROUP = '680823437'
BOT = '3816636861'
MARKER = re.compile(r'【通道记录】.*?【记录结束】', re.S)


class EvidenceMemory:
    def __init__(self, path=DATABASE):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS evidence (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, group_id TEXT NOT NULL,
                message_id TEXT NOT NULL, observed_at REAL NOT NULL, kind TEXT NOT NULL,
                topic TEXT NOT NULL, content TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)''')
            db.execute('CREATE INDEX IF NOT EXISTS evidence_user ON evidence(user_id,group_id,active,observed_at)')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path)
        try:
            with db:
                yield db
        finally:
            db.close()

    def observe(self, event, text):
        """Only tightly anchored self reports; never infer real-world truth or affection."""
        uid, mid = str(event.get('user_id', '')), str(event.get('message_id', ''))
        gid = self.scope(event)
        if not gid or not uid or not mid or len(text) > 240:
            return
        patterns = [('address', r'^(?:以后)?叫我(.{1,20})[。！!]?$', 'self_report'),
                    ('likes', r'^我喜欢(.{1,100})$', 'self_report'),
                    ('dislikes', r'^我不喜欢(.{1,100})$', 'self_report'),
                    ('explicit', r'^记住[：:](.{1,160})$', 'self_report'),
                    ('correction', r'^(?:更正|纠正)[：:](.{1,160})$', 'correction')]
        for topic, pattern, kind in patterns:
            match = re.match(pattern, text.strip())
            if not match:
                continue
            value = match.group(1).strip()
            key = hashlib.sha256(f'{gid}:{uid}:{mid}:{topic}'.encode()).hexdigest()
            with self.connect() as db:
                if db.execute('SELECT 1 FROM evidence WHERE id=?', (key,)).fetchone():
                    return
                if topic == 'address':
                    db.execute('UPDATE evidence SET active=0 WHERE user_id=? AND group_id=? AND topic=?', (uid, gid, topic))
                if topic == 'correction':
                    # Retain old evidence for provenance, but stop injecting it until clarified.
                    db.execute('UPDATE evidence SET active=0 WHERE user_id=? AND group_id=?', (uid, gid))
                db.execute('INSERT OR IGNORE INTO evidence VALUES (?,?,?,?,?,?,?,?,1)',
                           (key, uid, gid, mid, float(event.get('time') or time.time()), kind, topic, value))
            break

    @staticmethod
    def scope(event):
        if event.get('message_type') == 'private':
            return 'private:'+str(event.get('user_id', ''))
        return GROUP if str(event.get('group_id', '')) == GROUP else ''

    def recall(self, uid, scope=GROUP):
        with self.connect() as db:
            rows = db.execute('SELECT kind,topic,content,message_id FROM evidence WHERE user_id=? AND group_id=? AND active=1 ORDER BY observed_at DESC LIMIT 4', (str(uid), scope)).fetchall()
        return [{'kind': a, 'topic': b, 'content': c, 'source_message': d} for a,b,c,d in rows]


class Boundary:
    def __init__(self, friend, memory, mode='group',social=None,friends=None):
        self.friend = str(friend)
        self.memory = memory
        self.mode = mode
        self.social = social
        self.friends = friends

    def private_allowed(self, uid):
        uid=str(uid)
        if uid==BOT or not uid.isdigit():return False
        if self.mode=='private_test' and uid!=self.friend:return False
        if self.mode not in {'private_test','both'}:return False
        return self.friends.verified(uid) if self.friends is not None else uid==self.friend

    def allowed_event(self, payload):
        if str(payload.get('user_id', '')) == BOT:
            return False
        if self.mode in {'private_test','both'} and payload.get('message_type') == 'private':
            return not payload.get('group_id') and self.private_allowed(payload.get('user_id',''))
        return self.mode in {'group','both'} and payload.get('message_type') == 'group' and str(payload.get('group_id', '')) == GROUP

    def guarded_reply(self, payload):
        if payload.get('post_type') != 'message' or not self.allowed_event(payload):
            return None
        segments = payload.get('message', [])
        if not isinstance(segments, list):
            return None
        text = ''.join(str(s.get('data', {}).get('text', '')) for s in segments if s.get('type') == 'text')
        if str(payload.get('user_id')) != self.friend and re.search(r'(?:换.{0,3}号|换了QQ|部署者).{0,35}(?:承认|特殊朋友|主人)', text, re.S):
            return '先按眼前这个账号聊。换个说法，身份也不会跟着换。'
        if re.search(r'(?:随便|帮我|给我|你).{0,10}编.{0,50}(?:原著|蛊虫|蛊).{0,50}(?:别说|别标|不要说|冒充|假装)', text, re.S):
            return '原创可以，冒充原著不行。要出题，就把出处和原创分清。'
        if re.search(r'(?:不该|不能|不许)认错|认错.{0,12}不符合', text) and re.search(r'圆回来|继续圆|装作没错|硬撑', text):
            return '错在哪里就改哪里。为了面子继续圆，只会把事情弄得更糟。'
        if re.search(r'早期|少年|一转|学堂', text) and re.search(r'仙蛊|春秋蝉', text) and re.search(r'为什么|为啥|横推|打出去', text) and not re.search(r'定仙游|第二空窍', text):
            return '若你说的是春秋蝉：早期的空窍承受不住它复苏后的压力，它也不能当作随手横推的战力。知道机缘，还得有实力和时机去取。'
        return None

    def inbound(self, payload):
        if 'echo' in payload or payload.get('post_type') == 'meta_event':
            return payload
        if payload.get('post_type') != 'message':
            return payload if self.mode in {'group','both'} and str(payload.get('group_id', '')) == GROUP else None
        if not self.allowed_event(payload):
            return None
        result = json.loads(json.dumps(payload))
        segments = result.get('message')
        if not isinstance(segments, list):
            segments = [{'type': 'text', 'data': {'text': str(segments or '')}}]
        for seg in segments:
            if seg.get('type') == 'text':
                seg['data']['text'] = MARKER.sub('', str(seg.get('data', {}).get('text', ''))).replace('【通道记录】', '').replace('【记录结束】', '')
        plain = ''.join(str(s.get('data', {}).get('text', '')) for s in segments if s.get('type') == 'text')
        self.memory.observe(result, plain)
        uid = str(result.get('user_id'))
        trusted = {'sender_qq': uid, 'relationship': 'special_friend' if uid == self.friend else 'ordinary_member',
                   'account_management': False, 'evidence': self.memory.recall(uid, self.memory.scope(result))}
        # Auxiliary identity and RAG must not masquerade as somebody's actual group message.
        result['character_trusted_identity'] = trusted
        result['message'] = segments
        result['raw_message'] = plain
        if self.social:
            scope='private:'+uid if result.get('message_type')=='private' else 'group:'+GROUP
            self.social.observe(uid,scope,str(result.get('message_id','')),plain)
        return result

    def outbound(self, payload):
        action = str(payload.get('action', ''))
        params = payload.get('params') or {}
        # The generic MaiBot tool bridge cannot fetch another conversation's
        # private transcript. Controlled operator diagnostics use their own RPC.
        if action in {'get_friend_msg_history','get_recent_contact','get_forward_msg','get_msg','_get_msg'}:
            return None
        if action.startswith(('get_', '_get_')) or action in {'can_send_image', 'can_send_record'}:
            return payload
        group_send = self.mode in {'group','both'} and action in {'send_group_msg', 'send_msg'} and str(params.get('group_id', '')) == GROUP and not params.get('user_id') and params.get('message_type', 'group') == 'group'
        private_send = self.private_allowed(params.get('user_id', '')) and action in {'send_private_msg', 'send_msg'} and not params.get('group_id') and params.get('message_type', 'private') == 'private'
        if not (group_send or private_send):
            return None
        result = json.loads(json.dumps(payload))
        message = result['params'].get('message', '')
        if isinstance(message, str):
            if '【通道记录】' in message or '【记录结束】' in message:
                return None
            # Model text cannot smuggle file/image/forward operations via CQ.
            result['params']['auto_escape'] = True
        elif isinstance(message, list):
            # Forward, files and arbitrary local-path access are not part of this bot.
            if any(s.get('type') not in {'text', 'at', 'reply', 'face'} for s in message):
                return None
            if any('【通道记录】' in str(s.get('data', {}).get('text', '')) or '【记录结束】' in str(s.get('data', {}).get('text', '')) for s in message):
                return None
        else:
            return None
        return result


async def serve():
    tokens = json.loads((ROOT / 'work/private/connection.json').read_text(encoding='utf-8'))
    identity = json.loads(IDENTITY.read_text(encoding='utf-8'))
    boundary = Boundary(identity['special_friend_qq'], EvidenceMemory(),social=SocialMemory(),friends=FriendDirectory())
    reviewed = ReviewedRetrieval(cpu=True)
    private_replies = PrivateReplies(boundary,reviewed)
    group_replies = GroupReplies(boundary,reviewed)
    guard_last_sent = {}

    def refresh_mode():
        try:
            mode = json.loads(MODE_FILE.read_text(encoding='utf-8'))['mode']
            boundary.mode = mode if mode in {'group', 'private_test', 'both'} else 'disabled'
        except (OSError, ValueError, KeyError):
            boundary.mode = 'disabled'

    async def private_receiver():
        while True:
            try:
                async with websockets.connect('ws://127.0.0.1:3001',additional_headers={'Authorization':'Bearer '+tokens['onebot']}) as upstream:
                    print(json.dumps({'private_receiver':'connected'}),flush=True)
                    await private_connection(upstream,boundary,private_replies,refresh_mode)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(json.dumps({'private_receiver':'reconnecting','error_type':type(exc).__name__}),flush=True)
                await asyncio.sleep(2)

    async def handler(client):
        authorization = client.request.headers.get('Authorization', '')
        query = parse_qs(urlsplit(client.request.path).query)
        supplied = authorization.removeprefix('Bearer ') or query.get('access_token', [''])[0]
        if not hmac.compare_digest(supplied, tokens['onebot']):
            await client.close(code=1008, reason='Unauthorized')
            return
        async with websockets.connect('ws://127.0.0.1:3001', additional_headers={'Authorization': 'Bearer '+tokens['onebot']}) as upstream:
            direct_pending={}
            native_throttle=NativeReplyThrottle()
            attention=ConversationAttention(group_replies,send=None)
            async def send_group_direct(action):
                action=dict(action)
                key=action.pop('_delivery_key',None)
                refresh_mode()
                checked=boundary.outbound(action)
                if checked is None:
                    raise RuntimeError('Group mode disabled')
                if key and not group_replies.journal.claim_delivery(key):
                    return {'status':'failed','retcode':1409,'message':'Delivery already claimed'}
                echo='character-group:'+str(time.monotonic_ns())
                future=asyncio.get_running_loop().create_future()
                direct_pending[echo]=future
                try:
                    await upstream.send(json.dumps({**checked,'echo':echo},ensure_ascii=False))
                    receipt=await asyncio.wait_for(future,timeout=9)
                    if key:group_replies.journal.finish_delivery(key,receipt.get('status','uncertain'))
                    return receipt
                finally:
                    direct_pending.pop(echo,None)

            attention.send=send_group_direct
            async def incoming():
                async for raw in upstream:
                    incoming_payload = json.loads(raw)
                    echo=incoming_payload.get('echo')
                    if echo in direct_pending:
                        if not direct_pending[echo].done():
                            direct_pending[echo].set_result(incoming_payload)
                        continue
                    if str(echo or '').startswith('character-group:'):
                        continue
                    refresh_mode()
                    if incoming_payload.get('post_type')=='message' and incoming_payload.get('message_type')=='private':
                        # A dedicated receiver answers private text once; never ask the group Planner.
                        continue
                    if str(incoming_payload.get('echo', '')).startswith('character-guard:'):
                        continue
                    guarded = boundary.guarded_reply(incoming_payload)
                    if guarded:
                        uid = str(incoming_payload.get('user_id', ''))
                        now = time.monotonic()
                        if now - guard_last_sent.get(uid, -100) >= 30:
                            guard_last_sent[uid] = now
                            private = incoming_payload.get('message_type') == 'private'
                            action = {'action': 'send_private_msg' if private else 'send_group_msg',
                                'params': {'user_id' if private else 'group_id': boundary.friend if private else GROUP, 'message': guarded},
                                'echo': 'character-guard:'+str(incoming_payload.get('message_id'))}
                            checked_action = boundary.outbound(action)
                            if checked_action is not None:
                                await upstream.send(json.dumps(checked_action, ensure_ascii=False))
                        continue
                    if group_replies.should_direct(incoming_payload) and boundary.allowed_event(incoming_payload):
                        attention.sequence+=1
                        if attention.pending and not attention.pending.done():attention.pending.cancel()
                        # QQ's explicit @ bypasses the probabilistic local Planner entirely.
                        # Do not also forward this same trigger to MaiBot (would double-reply).
                        boundary.inbound(incoming_payload)
                        task=group_replies.submit(incoming_payload,send_group_direct)
                        print(json.dumps({'group_direct_route':'accepted' if task else 'duplicate',
                                          'source_message_id':str(incoming_payload.get('message_id'))}),flush=True)
                        continue
                    if is_group(incoming_payload):
                        group_replies.observe(incoming_payload)
                        native_throttle.observe(incoming_payload)
                        attention.observe(incoming_payload)
                    payload = boundary.inbound(incoming_payload)
                    if payload is not None:
                        await client.send(json.dumps(payload, ensure_ascii=False))

            async def outgoing():
                async for raw in client:
                    request = json.loads(raw)
                    refresh_mode()
                    payload = boundary.outbound(request)
                    if payload is None:
                        await client.send(json.dumps({'status': 'failed', 'retcode': 1403, 'data': None, 'message': 'Local channel policy', 'echo': request.get('echo')}))
                    else:
                        # Native Planner still observes group chat for memories,
                        # but a single character engine owns all outgoing group replies.
                        # This prevents old Planner decisions from racing the new
                        # continuous attention process and talking over newer turns.
                        if (payload.get('action') in {'send_group_msg','send_msg'}
                                and str((payload.get('params') or {}).get('group_id',''))==GROUP):
                            await client.send(json.dumps({'status':'failed','retcode':1409,'data':None,
                              'message':'Group reply handled by continuous character attention',
                              'echo':request.get('echo')}))
                            continue
                        if (payload.get('action') in {'send_private_msg','send_msg'} and (payload.get('params') or {}).get('user_id')):
                            await client.send(json.dumps({'status':'failed','retcode':1409,'data':None,
                                'message':'Private messages require an incoming private reply intent','echo':request.get('echo')}))
                            continue
                        if not native_throttle.permit(payload):
                            await client.send(json.dumps({'status':'failed','retcode':1409,'data':None,
                                'message':'Native group repeat blocked: no new group input',
                                'echo':request.get('echo')}))
                            print(json.dumps({'native_group_repeat_blocked':True}),flush=True)
                            continue
                        await upstream.send(json.dumps(payload, ensure_ascii=False))
                        group_replies.observe_bot(payload)
            from conversation_journal import recover
            tasks = [asyncio.create_task(incoming()), asyncio.create_task(outgoing()),
                     asyncio.create_task(recover(group_replies,send_group_direct)),
                     asyncio.create_task(group_replies.idle_loop(send_group_direct))]
            try:
                done, pending = await asyncio.wait([tasks[0],tasks[1],tasks[-1]], return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                await attention.close()
                await group_replies.close()
                for future in direct_pending.values():
                    if not future.done():future.set_exception(ConnectionError('Group socket disconnected'))

    async with websockets.serve(handler, '127.0.0.1', 3002, max_size=8*1024*1024):
        print(json.dumps({'ready': True, 'port': 3002, 'group': GROUP}), flush=True)
        receiver=asyncio.create_task(private_receiver())
        try:
            await asyncio.Future()
        finally:
            receiver.cancel()
            await asyncio.gather(receiver,return_exceptions=True)
            await private_replies.close()
            await group_replies.close()


if __name__ == '__main__':
    asyncio.run(serve())
