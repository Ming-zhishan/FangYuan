"""Local-only QQ emoji and sticker perception with bounded image input.

No arbitrary path reads, no remote OCR service, no external image upload.
Vision model: local Ollama qwen3.5:2b; bounded effort, no cloud image uploads.
"""
import asyncio
import base64
import json
from pathlib import Path
from collections import OrderedDict
from io import BytesIO
import re
from urllib.parse import urlparse
import httpx

FACE_HINTS=json.loads(Path(__file__).with_name('qq_faces.json').read_text(encoding='utf-8'))['faces']

STYLE_HINTS={
 '笑哭':'经常表示被逗笑、无语或觉得离谱，要看前后文',
 '贴贴':'表示亲近、撒娇、求安慰或开玩笑的亲昵',
 '捂脸':'无奈、尴尬或吐槽',
 '流汗':'尴尬、窘迫或玩笑',
 '微笑':'可能是真笑，也可能有反讽意味',
 '狗头':'调侃、反话或避免被当真',
 '裂开':'崩溃、绷不住',
 '呲牙':'开心、得意或玩笑'
}

def qq_message_text(event):
    parts=event.get('message',[])
    if isinstance(parts,str):
        return re.sub(r'\[CQ:at,[^\]]+\]','',parts).strip()
    if not isinstance(parts,list):return ''
    pieces=[]
    for seg in parts:
        if not isinstance(seg,dict):continue
        kind=seg.get('type')
        data=seg.get('data') or {}
        if kind=='text':pieces.append(str(data.get('text','')))
        elif kind=='at':
            uid=str(data.get('qq') or data.get('target_user_id') or '')
            name=str(data.get('name') or data.get('target_user_nickname') or data.get('target_user_cardname') or '')
            name=re.sub(r'[\x00-\x1f\r\n【】\[\]]','',name)[:32]
            if uid=='3816636861':
                pieces.append('[点名方源]')
            elif uid and uid not in ('all','0'):
                pieces.append('[对'+(name or 'QQ账号'+uid[:16])+'说]')
        elif kind=='face':
            face=str(data.get('id',''))
            raw=data.get('raw') or {}
            label=str(data.get('name') or (raw.get('faceText') if isinstance(raw,dict) else '') or FACE_HINTS.get(face) or ('QQ表情编号'+face)).strip('[]/')
            pieces.append('[表情:'+label+']')
        elif kind in ('mface','marketface','bface','sface'):
            label=str(data.get('summary') or data.get('name') or data.get('text') or '自定义表情')
            pieces.append('[表情:'+label[:60]+']')
            if kind in ('mface','marketface') and (data.get('url') or data.get('file')):
                pieces.append('[图片表情，内容待识别]')
        elif kind in ('image','sticker','mface','marketface'):
            label=str(data.get('summary') or data.get('name') or data.get('text') or '')
            pieces.append('[图片表情'+(':'+label[:45] if label else '，内容待识别')+']')
        elif kind=='reply':pieces.append('[引用回复]')
    return re.sub(r'【通道记录】.*?【记录结束】','', ''.join(pieces),flags=re.S).strip()

def emoji_intent(text):
    notes=[]
    for token,description in STYLE_HINTS.items():
        if '['+token+']' in text or '[表情:'+token+']' in text:
            notes.append(token+'：'+description)
    if any(x in text for x in ('😂','🤣','😭')):
        notes.append('笑哭/大哭 emoji：也可能是笑得绷不住或抽象吐槽，不一定真悲伤')
    if '🙃' in text or '🙂' in text:
        notes.append('微笑或倒脸 emoji：可能是反讽、无语或礼貌，依前文判断')
    if '🥹' in text or '🥺' in text:
        notes.append('可怜或含泪 emoji：可能撒娇、感动或开玩笑')
    return '；'.join(notes[:3])

def safe_qq_url(url):
    try:
        if not isinstance(url,str) or len(url)>1600:return False
        u=urlparse(url)
        host=(u.hostname or '').lower()
        return u.scheme=='https' and bool(host) and any(
            host==domain or host.endswith('.'+domain)
            for domain in ('qpic.cn','qq.com','qq.com.cn','gtimg.cn','qlogo.cn','tencent.com','tencent.com.cn')
        ) and not u.username and not u.password
    except (TypeError,ValueError):return False

class StickerVision:
    def __init__(self):
        self.cache=OrderedDict()
        self.lock=asyncio.Semaphore(1)

    async def warmup(self):
        # Background preload avoids 20+ second first-image cold starts.
        # Keeps the local vision model ready without sending user images.
        try:
            async with httpx.AsyncClient(base_url='http://127.0.0.1:11434',
                                         trust_env=False,timeout=45) as client:
                response=await client.post('/api/generate',json={
                    'model':'qwen3.5:2b','prompt':'','stream':False,'keep_alive':'25m'})
                response.raise_for_status()
            return True
        except (TimeoutError,OSError,httpx.HTTPError):
            return False
    async def _fetch(self,url):
        if not safe_qq_url(url):return None
        async with httpx.AsyncClient(trust_env=False,follow_redirects=False,timeout=5) as client:
            async with client.stream('GET',url) as response:
                if response.status_code!=200:return None
                content=bytearray()
                async for block in response.aiter_bytes():
                    content.extend(block)
                    if len(content)>2_500_000:return None
        from PIL import Image
        from PIL import Image as PILImage
        PILImage.MAX_IMAGE_PIXELS=6_000_000
        with Image.open(BytesIO(content)) as image:
            image.seek(0)
            image=image.convert('RGB')
            image.thumbnail((384,384))
            output=BytesIO()
            image.save(output,format='JPEG',quality=76)
            return base64.b64encode(output.getvalue()).decode('ascii')
    async def explain(self,event,resolver=None):
        segments=event.get('message',[])
        if not isinstance(segments,list):return ''
        for seg in segments:
            if not isinstance(seg,dict):continue
            if seg.get('type') not in ('image','sticker','mface','marketface'):continue
            label=str((seg.get('data') or {}).get('summary') or '').strip('[]/ ')
            if label in set(FACE_HINTS.values()) | set(STYLE_HINTS):
                return 'QQ附带的表情标签是“'+label+'”；没有据此识别画面中的人物或细节。'
        links=[]
        for seg in segments:
            if not isinstance(seg,dict) or seg.get('type') not in ('image','sticker','mface','marketface'):continue
            data=seg.get('data') or {}
            url=str(data.get('url',''))
            if url and safe_qq_url(url):links.append(url)
        if not links and resolver:
            for seg in segments:
                if not isinstance(seg,dict) or seg.get('type') not in ('image','sticker','mface','marketface'):continue
                file=str((seg.get('data') or {}).get('file',''))
                if not file or len(file)>200 or '..' in file or file.startswith(('/', '\\\\')):continue
                try:
                    reply=await asyncio.wait_for(resolver({'action':'get_image','params':{'file':file}}),timeout=5)
                    url=str((reply.get('data') or {}).get('url',''))
                    if safe_qq_url(url):links.append(url);break
                except (TimeoutError,KeyError,ValueError,httpx.HTTPError):continue
        if not links:return ''
        key=links[0]
        if key in self.cache:return self.cache[key]
        async with self.lock:
            try:
                encoded=await asyncio.wait_for(self._fetch(key),timeout=6)
                if not encoded:return ''
                payload={'model':'qwen3.5:2b','stream':False,'think':False,
                  'messages':[{'role':'user','content':'用一句短句描述可见表情或文字。看不清直说，不猜身份或隐含情绪。','images':[encoded]}],
                  'options':{'num_ctx':1024,'num_predict':40},'keep_alive':'25m'}
                async with httpx.AsyncClient(base_url='http://127.0.0.1:11434',trust_env=False,timeout=18) as client:
                    response=await client.post('/api/chat',json=payload)
                    response.raise_for_status()
                    summary=(response.json().get('message') or {}).get('content','').strip()[:200]
                if re.search(r'无法.{0,10}(?:图像|图片|分析|识别)|上传图片|不能.{0,8}(?:识别|查看)|很乐意提供',summary):
                    return ''
                if summary:
                    self.cache[key]=summary
                    if len(self.cache)>80:self.cache.popitem(last=False)
                return summary
            except (TimeoutError,ValueError,OSError,httpx.HTTPError,ImportError):
                return ''
