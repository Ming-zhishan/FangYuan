"""Small durable account-action dialogue with typed tools and owner approval.

Chat text never becomes an arbitrary OneBot action. Tool proposals are validated;
only a matching owner confirmation can unlock the first write of each kind.
"""
import asyncio,base64,hashlib,json,re,sqlite3,time,uuid
from contextlib import closing,asynccontextmanager
from pathlib import Path
import httpx,websockets
from character.culture import FRIENDS
from account_brand import validate as validate_brand_plan

ROOT=Path(__file__).resolve().parents[1];BOT='3816636861';OWNER='2449113325'
TOOLS={'signature':{'action':'set_self_longnick','interval':86400,'visibility':'QQ公开个人资料'},
       'avatar':{'action':'set_qq_avatar','interval':7*86400,'visibility':'QQ公开头像'},
       'post':{'action':'send_qzone_msg','interval':3*86400,'visibility':'仅指定好友2449113325可见，ugc_right=16'}}
UNAVAILABLE=('查看动态评论','回复动态评论','点赞好友动态','评论好友动态','转发好友动态')

@asynccontextmanager
async def connection():
 token=json.loads((ROOT/'private/connection.json').read_text(encoding='utf-8'))['onebot']
 async with websockets.connect('ws://127.0.0.1:3001',additional_headers={'Authorization':'Bearer '+token},open_timeout=5) as ws:
  async def rpc(action,params):
   echo='account-tool:'+uuid.uuid4().hex
   await ws.send(json.dumps({'action':action,'params':params,'echo':echo},ensure_ascii=False))
   deadline=time.monotonic()+20
   while True:
    if time.monotonic()>=deadline:raise TimeoutError('account RPC deadline')
    e=json.loads(await asyncio.wait_for(ws.recv(),max(.1,deadline-time.monotonic())))
    if e.get('echo')==echo:return e
  yield rpc

def fingerprint(plan):return hashlib.sha256(json.dumps(plan,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
def safe_public(text):
 return bool(isinstance(text,str) and 0<len(text)<=180 and not re.search(r'私聊|聊天记录|手机号|身份证|住址|群里|@|\[CQ:|https?://|\d{7,}',text) and
             not any(name in text for names in FRIENDS.values() for name in names))

class AccountTasks:
 def __init__(self,path=None,*,planner=None,rpc_factory=connection,policy_path=None):
  self.path=Path(path or ROOT/'instance/data/account-tasks.sqlite3');self.path.parent.mkdir(parents=True,exist_ok=True)
  self.planner=planner or self.plan;self.rpc_factory=rpc_factory
  self.policy_path=Path(policy_path or ROOT/'private/account-policy.json')
  with self.db() as db,db:
   db.execute('CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,uid TEXT,scope TEXT,kind TEXT,plan TEXT,state TEXT,created REAL,updated REAL,notified INTEGER DEFAULT 0,result TEXT)')
   db.execute('CREATE TABLE IF NOT EXISTS inputs(key TEXT PRIMARY KEY,response TEXT)')
   db.execute('CREATE TABLE IF NOT EXISTS grants(kind TEXT PRIMARY KEY,boundary TEXT,created REAL)')
   db.execute('CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,digest TEXT,kind TEXT,created REAL,status TEXT)')
   db.execute('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT)')
 def db(self):return closing(sqlite3.connect(self.path,timeout=5))
 def policy(self):
  base={'owner':OWNER,'suggesters':list(FRIENDS),'autonomy_enabled':True,'post_targets':[OWNER],'post_visibility':16}
  if self.policy_path.exists():base.update(json.loads(self.policy_path.read_text(encoding='utf-8')))
  # Owner and non-public default audience are never inferred from chat claims.
  if str(base['owner'])!=OWNER:raise ValueError('owner policy mismatch')
  return base
 def current(self,uid,scope):
  with self.db() as db:
   row=db.execute("SELECT * FROM tasks WHERE uid=? AND scope=? AND state NOT IN ('cancelled','superseded') AND updated>? ORDER BY updated DESC LIMIT 1",(str(uid),scope,time.time()-86400)).fetchone()
   if scope=='group:680823437' and str(uid) in FRIENDS:
    shared=db.execute("SELECT * FROM tasks WHERE scope=? AND state IN ('draft','needs_asset','awaiting_owner') AND updated>? ORDER BY updated DESC LIMIT 1",(scope,time.time()-1800)).fetchone()
    if shared and (not row or shared[7]>row[7]):row=shared
  return self.unpack(row) if row else None
 def get(self,ident):
  with self.db() as db:row=db.execute('SELECT * FROM tasks WHERE id=?',(ident,)).fetchone()
  return self.unpack(row) if row else None
 @staticmethod
 def unpack(row):
  keys=('id','uid','scope','kind','plan','state','created','updated','notified','result');d=dict(zip(keys,row));d['plan']=json.loads(d['plan']);d['result']=json.loads(d['result']) if d['result'] else {};return d
 def interested(self,text,uid,scope):
  raw=re.sub(r'【.*','',text,flags=re.S).strip()
  if re.search(r'(?:改|换|设置|签名|头像|发|发布|动态|说说|点赞|评论|转发|任务)',raw) and re.search(r'签名|头像|动态|说说|空间|任务\s*[0-9a-f]{8}',raw):return True
  task=self.current(uid,scope)
  if task and task['state']=='needs_asset' and '图片表情' in raw:return True
  return bool(task and (raw.strip('“”"。.!！ ')==str(task['plan'].get('content','')).strip('“”"。.!！ ') or
    re.search(r'这个|那个|刚才|安排|就它|可以|取消|撤销|别发|别改|换成|改成|嘉豪|足够|风格|进度|成功|执行结果|改好|发出|确认|低频|你自己发|你来发|发吧|你决定',raw)))
 def capabilities(self):
  return '账号工具：signature→set_self_longnick；avatar→set_qq_avatar（必须先选定暂存图片）；post→send_qzone_msg（支持已选图片，只限指定好友2449113325）。接口存在，首次实写仍须所有者预览确认；不得假称已改。当前未接通：'+ '、'.join(UNAVAILABLE)+'。没有手机不是接口限制。'
 async def plan(self,text,task,history):
  cfg=json.loads((ROOT/'private/cloud-runtime.json').read_text(encoding='utf-8'))
  # Post creation has no access to chat transcripts. It uses public creative themes only.
  is_post=bool(re.search(r'动态|说说|空间',text) or (task and task['kind']=='post'))
  data={'request':text[:500],'pending':task['plan'] if task else None,'history':[] if is_post else list(history)[-4:]}
  system=('你是方源的账号操作决策器。只输出JSON：{"tool":"propose|commit|cancel|decline|none","kind":"signature|avatar|post","content":"候选正文"}。'
   'propose表示构思或修改候选；commit仅表示请求执行当前候选，权限由程序另验；cancel取消；闲聊none；不想接受建议可以decline。'
   '结合pending理解这个、刚才那个、安排一啊、风格追补，已有内容不再问哪个。签名和说说为你自己原创的短句，现代自然、有方源判断，不堆身份，不编亲历，不冒充原著诗句。本人九转炼道尊者，仍追求永生，不能写成永生已成、十转或已灭全部尊者。'
   '说说只谈不含群友私事的公开蛊界观点或创作。不能输出私聊、群友名字、号码、隐私。头像的content留空，由程序选择明确给定的图片。'+self.capabilities())
  async with httpx.AsyncClient(trust_env=False,timeout=30) as c:
   r=await c.post('http://127.0.0.1:11435/api/chat',headers={'Authorization':'Bearer '+cfg['gateway_token']},json={'model':'fangyuan-eightb:latest','stream':False,'think':False,'messages':[{'role':'system','content':system},{'role':'user','content':json.dumps(data,ensure_ascii=False)}]})
   r.raise_for_status();payload=r.json()
  if payload.get('character_route') not in {'bailian-free','tongji-school'}:raise ValueError('planner cloud unavailable')
  raw=payload['message']['content'];match=re.search(r'\{.*\}',raw,re.S)
  choice=json.loads(match[0] if match else raw)
  if choice.get('tool') not in {'propose','commit','cancel','decline','none'} or choice.get('kind') not in TOOLS:raise ValueError('invalid tool choice')
  return choice
 def create(self,uid,scope,kind,content='',asset=None,previous=None):
  if kind not in TOOLS:raise ValueError('unsupported tool')
  plan={'account':BOT,'kind':kind,'content':content}
  if kind=='signature' and (not safe_public(content) or len(content)>80):raise ValueError('unsafe signature')
  if kind=='post':
   if not safe_public(content) or len(content)>160:raise ValueError('unsafe post')
   p=self.policy();plan.update(ugc_right=int(p['post_visibility']),target_uins=list(map(str,p['post_targets'])))
   if plan['ugc_right']!=16 or plan['target_uins']!=[OWNER]:raise ValueError('audience requires new operator review')
  if asset:plan.update(asset)
  ident=uuid.uuid4().hex[:8];now=time.time()
  with self.db() as db,db:
   if previous:db.execute("UPDATE tasks SET state='superseded',updated=? WHERE id=? AND state NOT IN ('executing','verified','accepted','unknown')",(now,previous['id']))
   db.execute('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)',(ident,str(uid),scope,kind,json.dumps(plan,ensure_ascii=False),'needs_asset' if kind=='avatar' and not asset else 'draft',now,now,0,None))
  return self.get(ident)
 async def submit_plan(self,task):
  """Only previously owner-granted, exactly matching boundaries avoid a preview."""
  with self.db() as db:row=db.execute('SELECT boundary FROM grants WHERE kind=?',(task['kind'],)).fetchone()
  if row:
   boundary=json.loads(row[0]);plan=task['plan']
   matches=(boundary['visibility']==TOOLS[task['kind']]['visibility'] and boundary.get('target_uins')==plan.get('target_uins') and boundary.get('ugc_right')==plan.get('ugc_right'))
   if plan.get('file'):matches=matches and any(x['sha256']==plan['sha256'] for x in boundary.get('assets',[]))
   if matches and task['state'] in {'draft','cooldown'}:
    with self.db() as db,db:db.execute("UPDATE tasks SET state='approved' WHERE id=? AND state IN ('draft','cooldown')",(task['id'],))
    return await self.execute(self.get(task['id']))
  return await self.preview(task)
 async def stage(self,event):
  from chat_perception import StickerVision,safe_qq_url
  if not event:return None
  for seg in event.get('message',[]) if isinstance(event.get('message'),list) else []:
   if seg.get('type')!='image':continue
   url=(seg.get('data') or {}).get('url','')
   if not safe_qq_url(url):continue
   data=await StickerVision()._fetch(url)
   if not data:continue
   content=base64.b64decode(data);folder=ROOT/'instance/data/account-brand';folder.mkdir(parents=True,exist_ok=True)
   sha=hashlib.sha256(content).hexdigest();file=folder/('candidate-'+sha+'.jpg');file.write_bytes(content)
   return {'file':str(file),'sha256':sha}
  return None
 async def preview(self,task):
  with self.db() as db,db:
   if not db.execute("UPDATE tasks SET notified=1,state='awaiting_owner',updated=? WHERE id=? AND notified=0 AND state IN ('draft','awaiting_owner')",(time.time(),task['id'])).rowcount:
    current=self.get(task['id'])
    return '候选已交给账号所有者确认，还没有执行。' if current and current['notified']==2 else '预览没有确认成功送达，还没有执行。'
  plan=task['plan'];interval=TOOLS[task['kind']]['interval']//3600
  message=f"方源账号操作待确认 #{task['id']}\n类型：{task['kind']}\n内容：{plan.get('content') or '候选头像图片见下方'}\n范围：仅修改机器人{BOT}；{TOOLS[task['kind']]['visibility']}\n未执行。回复：确认任务 {task['id']}；取消任务 {task['id']}。\n若允许以后同范围自主，回复：确认任务 {task['id']} 并授权低频（同类至少间隔{interval}小时；不含私聊/群内隐私）。"
  try:
   async with self.rpc_factory() as rpc:
    login=await rpc('get_login_info',{});friends=await rpc('get_friend_list',{})
    if str((login.get('data') or {}).get('user_id'))!=BOT or not any(str(x.get('user_id'))==OWNER for x in friends.get('data') or []):raise ValueError('owner not verified')
    body=message if not plan.get('file') else [{'type':'text','data':{'text':message+'\n配图：1张（本消息所附图片）'}},{'type':'image','data':{'file':Path(plan['file']).as_uri()}}]
    receipt=await rpc('send_private_msg',{'user_id':OWNER,'message':body,'auto_escape':True})
    if receipt.get('status')!='ok':raise ValueError('owner preview failed')
    with self.db() as db,db:db.execute('UPDATE tasks SET notified=2,result=? WHERE id=?',(json.dumps({'preview_message_id':(receipt.get('data') or {}).get('message_id'),'preview_delivered':True}),task['id']))
  except Exception as exc:
   with self.db() as db,db:db.execute('UPDATE tasks SET result=? WHERE id=?',(json.dumps({'preview_error':type(exc).__name__}),task['id']))
   return '候选已保存，但给账号所有者的预览没拿到成功回执；还没有修改。'
  return '候选已发给账号所有者确认，确认前不会修改。'
 async def execute(self,task,*,grant=False):
  plan=task['plan'];kind=task['kind'];key=fingerprint(plan)
  with self.db() as db,db:
   db.execute('BEGIN IMMEDIATE')
   current=db.execute('SELECT state FROM tasks WHERE id=?',(task['id'],)).fetchone()
   if not current or current[0] not in {'awaiting_owner','approved'}:return '这项任务已经处理或已取消，不重复执行。'
   last=db.execute('SELECT created FROM attempts WHERE kind=? ORDER BY created DESC LIMIT 1',(kind,)).fetchone()
   if last and time.time()-last[0]<TOOLS[kind]['interval']:
    db.execute("UPDATE tasks SET state='cooldown',updated=? WHERE id=?",(time.time(),task['id']))
    return '同类操作还在低频间隔内，这次先不重复改。'
   db.execute('INSERT INTO attempts VALUES(?,?,?,?,?)',(task['id'],key,kind,time.time(),'pending'))
   db.execute("UPDATE tasks SET state='executing',updated=? WHERE id=?",(time.time(),task['id']))
  result={};state='unknown';cancelled=False
  try:
   async with self.rpc_factory() as rpc:
    login=await rpc('get_login_info',{})
    if login.get('status')!='ok' or str((login.get('data') or {}).get('user_id'))!=BOT:raise ValueError('wrong robot account')
    if kind=='signature':
     before=await rpc('get_stranger_info',{'user_id':BOT,'no_cache':True});result['before_signature']=(before.get('data') or {}).get('long_nick')
     params={'longNick':plan['content']}
    elif kind=='avatar':
     validate_brand_plan({'account':BOT,'action':'set_qq_avatar','file':plan['file'],'sha256':plan['sha256']})
     file=Path(plan['file']).resolve();folder=(ROOT/'instance/data/account-brand').resolve()
     if not file.is_relative_to(folder) or hashlib.sha256(file.read_bytes()).hexdigest()!=plan['sha256']:raise ValueError('avatar asset changed')
     async with httpx.AsyncClient(trust_env=False,timeout=8) as c:
      old=await c.get('https://q1.qlogo.cn/g',params={'b':'qq','nk':BOT,'s':640});old.raise_for_status()
     backup=folder/('avatar-before-'+task['id']+'.jpg');backup.write_bytes(old.content);result['previous_avatar']=str(backup)
     params={'file':file.as_uri()}
    else:
     validate_brand_plan({'account':BOT,'action':'send_qzone_msg','content':plan['content'],'ugc_right':plan['ugc_right'],'target_uins':plan['target_uins']})
     friends=await rpc('get_friend_list',{})
     if friends.get('status')!='ok' or not set(plan['target_uins'])<={str(x.get('user_id')) for x in friends.get('data') or []}:raise ValueError('audience not verified')
     params={'content':plan['content'],'ugc_right':16,'target_uins':plan['target_uins']}
     if plan.get('file'):
      file=Path(plan['file']).resolve()
      if not file.is_relative_to((ROOT/'instance/data/account-brand').resolve()) or hashlib.sha256(file.read_bytes()).hexdigest()!=plan['sha256']:raise ValueError('post asset changed')
      params['images']=[file.as_uri()]
    receipt=await rpc(TOOLS[kind]['action'],params)
    result['receipt']={k:receipt.get(k) for k in ('status','retcode','data')}
    inner=receipt.get('data') or {}
    ok=receipt.get('status')=='ok' and receipt.get('retcode',0)==0 and (not isinstance(inner,dict) or inner.get('result',0)==0)
    state='accepted' if ok else 'failed'
    if kind=='signature' and ok:
     for _ in range(2):
      await asyncio.sleep(.5)
      after=await rpc('get_stranger_info',{'user_id':BOT,'no_cache':True})
      if (after.get('data') or {}).get('long_nick')==plan['content']:state='verified';break
     result['readback_matches']=state=='verified'
    if kind=='post' and ok:
     if not isinstance(inner,dict) or not inner.get('tid'):state='unknown'
     result['independent_readback']=False
    if kind=='avatar' and ok:
     try:
      async with httpx.AsyncClient(trust_env=False,timeout=8) as c:
       after=await c.get('https://q1.qlogo.cn/g',params={'b':'qq','nk':BOT,'s':640,'t':int(time.time())});after.raise_for_status()
      result['independent_readback']=True
      result['avatar_readback_sha256']=hashlib.sha256(after.content).hexdigest()
      result['bytes_match_staged']=result['avatar_readback_sha256']==plan['sha256']
      if result['bytes_match_staged']:state='verified'
     except Exception:result['independent_readback']=False
  except asyncio.CancelledError:result['error_type']='CancelledError';cancelled=True
  except Exception as exc:result['error_type']=type(exc).__name__
  with self.db() as db,db:
   db.execute('UPDATE tasks SET state=?,result=?,updated=? WHERE id=?',(state,json.dumps(result,ensure_ascii=False),time.time(),task['id']))
   db.execute('UPDATE attempts SET status=? WHERE id=?',(state,task['id']))
   if grant and state in {'verified','accepted'}:
    boundary={'visibility':TOOLS[kind]['visibility'],'target_uins':plan.get('target_uins'),'ugc_right':plan.get('ugc_right'),'assets':[{'file':plan['file'],'sha256':plan['sha256']}] if plan.get('file') else []}
    if plan.get('file'):
     old=db.execute('SELECT boundary FROM grants WHERE kind=?',(kind,)).fetchone()
     assets=(json.loads(old[0]).get('assets',[]) if old else [])+boundary['assets']
     boundary['assets']=list({item['sha256']:item for item in assets}.values())[-8:]
    db.execute('INSERT OR REPLACE INTO grants VALUES(?,?,?)',(kind,json.dumps(boundary),time.time()))
  if cancelled:raise asyncio.CancelledError()
  return {'verified':('签名' if kind=='signature' else '头像')+'已改好，资料回读也对上了。','accepted':'修改接口返回成功；页面效果还没完整核实。','failed':'接口拒绝了这次操作，没有改好。','unknown':'这次没有拿到可核实的结果，先不重复提交，也不说已经改好了。'}[state]
 async def handle(self,text,uid,scope,mid,history=(),event=None):
  uid=str(uid);raw=re.sub(r'\n【.*','',text,flags=re.S).strip();raw=re.sub(r'^\[点名方源\]\s*','',raw)
  if not self.interested(raw,uid,scope):return None
  if uid not in set(map(str,self.policy()['suggesters']))|{OWNER}:return '账号资料和动态操作只接授权账号的建议。正常聊天不受影响。'
  eventkey=f'{scope}:{uid}:{mid}'
  with self.db() as db,db:
   if not db.execute('INSERT OR IGNORE INTO inputs VALUES(?,NULL)',(eventkey,)).rowcount:
    row=db.execute('SELECT response FROM inputs WHERE key=?',(eventkey,)).fetchone();return row[0] or '这项任务已经在处理，先不重复提交。'
  async def respond():
   lines=[x.strip() for x in re.split(r'[\n；;]+',raw) if x.strip()]
   approval_pattern=r'(确认|取消)任务\s*([0-9a-f]{8})(?:\s*(并授权低频))?[。！!\s]*'
   if len(lines)>1 and len(lines)<=3 and all(re.fullmatch(approval_pattern,x) for x in lines):
    return '\n'.join([await self.handle(line,uid,scope,f'{mid}:approval:{i}') for i,line in enumerate(lines)])
   explicit=re.fullmatch(r'(确认|取消)任务\s*([0-9a-f]{8})(?:\s*(并授权低频))?[。！!\s]*',raw)
   if explicit:
    task=self.get(explicit[2])
    if uid!=OWNER or scope!='private:'+OWNER:return '首次操作需要账号所有者在私聊里确认对应任务。'
    if not task:return '这个任务编号不存在。'
    if explicit[1]=='取消':return self.cancel(task)
    if task['state']!='awaiting_owner' or task['notified']!=2:return '这个预览已变更、取消、尚未确认送达或处理过了，不能拿旧确认继续执行。'
    return await self.execute(task,grant=bool(explicit[3]))
   if re.search(r'(?:确认|取消)任务\s*[0-9a-f]{8}',raw):return '请把确认或取消命令单独发，不和改内容、闲聊混在一起；当前没有继续执行。'
   task=self.current(uid,scope)
   if task and task['state']=='awaiting_owner' and raw.strip('“”"。.!！ ')==str(task['plan'].get('content','')).strip('“”"。.!！ '):return '还是这句，已交给所有者确认，还没有修改。'
   if any(x in raw for x in UNAVAILABLE) or re.search(r'点赞|评论|转发',raw):return '签名、头像和说说有工具；空间评论、点赞、转发目前还没有接通，不能假装替你做。'
   if task and re.search(r'取消|撤销|别发|别改|算了不',raw):return self.cancel(task)
   if task and re.search(r'进度|改好|发出|成功|执行结果',raw):
    state='提交结果待核查，不自动重试' if task['state']=='executing' else task['state']
    return '任务'+task['id']+'当前状态：'+state+'。'+('还未完成所有者确认。' if task['state']=='awaiting_owner' else '')
   commit=bool(task and (re.fullmatch(r'(?:可以[，,\s]*)?(?:安排(?:一[下啊呀]?)?|就这个|就刚才那个|就它|执行|这个|你自己发|你来发|发吧|你决定)[。！!\s]*',raw) or re.search(r'把(?:这个|那个).{0,8}(?:改成|设为)|改成你.*签名',raw)))
   if commit:
    if task['state']=='needs_asset':return '还没选定要用的图片，不能凭空改或配图发布。候选图选定后再给所有者预览。'
    if task['state'] in {'verified','accepted','executing','unknown','failed'}:return '这项任务已提交过，不重复执行。当前状态：'+task['state']+'。'
    return await self.submit_plan(task)
   try:choice=await self.planner(raw,task,history)
   except Exception:return '工具还在，但这次没可靠理解成操作计划。已有候选不会丢；可以直接说就这个、取消或给出新内容。'
   if choice['tool']=='none':return None
   if choice['tool']=='decline':return '这个内容我不想拿来改资料或发动态，换个题材。'
   if choice['tool']=='cancel':return self.cancel(task) if task else '当前没有待办操作。'
   if choice['tool']=='commit':return await self.submit_plan(task) if task and task['state'] in {'draft','cooldown'} else '目前还没有可执行的新候选，或者候选已交给所有者确认。'
   kind=choice['kind'];content=choice.get('content','')
   # An explicitly quoted replacement is exact data, not a new creative prompt.
   replacement=re.search(r'(?:改成|换成|签名[：:]|内容[：:])\s*[“\"]?([^\n”\"]{1,180})',raw)
   if replacement and kind!='avatar' and not re.search(r'你.*签名',replacement[1]):content=replacement[1].strip('。 ')
   try:asset=await self.stage(event) if kind in {'avatar','post'} else None
   except Exception:return '候选图片没有可靠取到，原任务还在，没有提交接口。'
   if not asset and task and task['kind']==kind and task['plan'].get('file') and not re.search(r'去掉图|不要图',raw):asset={k:task['plan'][k] for k in ('file','sha256')}
   try:new=self.create(uid,scope,kind,content,asset,previous=task)
   except Exception:return '这份候选包含未获准的内容、范围或资源，没交给接口。'
   if kind=='post' and not asset and re.search(r'配图|带图|图片',raw):
    with self.db() as db,db:db.execute("UPDATE tasks SET state='needs_asset' WHERE id=?",(new['id'],))
    new['state']='needs_asset'
   if new['state']=='needs_asset':return '图片任务和草稿记下了。先选定一张图片，我会把候选和范围交给账号所有者确认。'
   label={'signature':'签名','avatar':'头像','post':'说说'}[kind]
   proposed=label+'候选：'+(content if kind!='avatar' else '使用这次选定的图片。')
   # A publish/replacement request already expresses the desire to act. Only
   # first-write owner approval remains; don't demand a second group command.
   explicit_action=(kind=='post' and bool(re.search(r'发|发布',raw))) or bool(replacement) or (kind=='avatar' and asset is not None)
   if explicit_action:return proposed+'\n'+await self.submit_plan(new)
   return proposed+'\n你认可就说“就这个”；首次执行还要账号所有者确认。'
  answer=await respond()
  with self.db() as db,db:db.execute('UPDATE inputs SET response=? WHERE key=?',(answer,eventkey))
  return answer
 def cancel(self,task):
  if task['state'] in {'executing','verified','accepted','unknown'}:return '这项已经提交过，不能把取消待办说成撤回成功；要改回去需另起候选。'
  with self.db() as db,db:db.execute("UPDATE tasks SET state='cancelled',updated=? WHERE id=?",(time.time(),task['id']))
  return '这项待办取消了，没有继续提交。'

 async def consider(self):
  """A live group turn may prompt a public-only idea, never private transcript reuse."""
  if not self.policy().get('autonomy_enabled'):return
  with self.db() as db,db:
   db.execute('BEGIN IMMEDIATE')
   grants={k:json.loads(b) for k,b in db.execute('SELECT kind,boundary FROM grants')}
   eligible=[]
   for kind,boundary in grants.items():
    last=db.execute('SELECT created FROM attempts WHERE kind=? ORDER BY created DESC LIMIT 1',(kind,)).fetchone()
    if last and time.time()-last[0]<TOOLS[kind]['interval']:continue
    if kind=='avatar' and len(boundary.get('assets',[]))<2:continue
    eligible.append(kind)
   if not eligible:return
   row=db.execute("SELECT value FROM meta WHERE key='last_idea'").fetchone()
   if row and time.time()-float(row[0])<86400:return
   db.execute("INSERT OR REPLACE INTO meta VALUES('last_idea',?)",(str(time.time()),))
  try:
   # No text/history from the triggering group or any private conversation.
   choice=await self.planner('自主公开创作机会。只在确有值得分享的短句时propose，否则decline。允许类别：'+','.join(eligible)+'。题材限已核蛊界判断、坚持与取舍，不声称新发生的亲历。',None,[])
   if choice.get('tool')!='propose' or choice.get('kind') not in eligible:return
   kind=choice['kind'];asset=None
   if kind=='avatar':
    with self.db() as db:last=db.execute("SELECT t.plan FROM attempts a JOIN tasks t ON a.id=t.id WHERE a.kind='avatar' ORDER BY a.created DESC LIMIT 1").fetchone()
    previous=json.loads(last[0]).get('sha256') if last else None
    asset=next((a for a in grants[kind]['assets'] if a['sha256']!=previous),None)
    if not asset:return
   task=self.create(OWNER,'autonomous:public-only',kind,choice.get('content',''),asset)
   with self.db() as db,db:db.execute("UPDATE tasks SET state='approved' WHERE id=?",(task['id'],))
   await self.execute(self.get(task['id']))
  except Exception as exc:print(json.dumps({'account_idea_failed':type(exc).__name__}),flush=True)
