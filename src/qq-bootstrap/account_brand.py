"""Approval-bound account operations, intentionally separate from chat actions.

Dry-run by default. A human-approved exact plan hash must be supplied through the
private approval file by the operator after chat approval. Never auto-approve.
"""
import asyncio,hashlib,json,time
from pathlib import Path
import httpx,websockets
ROOT=Path(__file__).resolve().parents[1]
ALLOWED={'2807839774','2171196385','2602295827','932314136','2449113325'}
def digest(plan):return hashlib.sha256(json.dumps(plan,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
def validate(plan):
 if str(plan.get('account'))!='3816636861':raise ValueError('wrong account')
 if plan.get('action')=='send_qzone_msg':
  if plan.get('ugc_right')!=16 or not set(map(str,plan.get('target_uins',[]))) or not set(map(str,plan['target_uins']))<=ALLOWED:raise ValueError('audience must be explicit five-person subset')
  if not isinstance(plan.get('content'),str) or not 1<=len(plan['content'])<=160:raise ValueError('content length')
 elif plan.get('action')=='set_qq_avatar':
  path=Path(plan['file']).resolve();base=(ROOT/'instance/data/account-brand').resolve()
  if not path.is_relative_to(base) or not path.is_file():raise ValueError('avatar must be staged')
  if hashlib.sha256(path.read_bytes()).hexdigest()!=plan.get('sha256'):raise ValueError('asset changed')
 else:raise ValueError('unsupported action')
 return digest(plan)
async def apply(plan,send,*,approval_file=None,state_file=None):
 key=validate(plan)
 approval_file=approval_file or ROOT/'private/account-brand-approval.json'
 approval=json.loads(approval_file.read_text(encoding='utf-8')) if approval_file.exists() else {}
 if approval.get('approved_sha256')!=key or not approval.get('user_confirmed'):raise PermissionError('explicit user approval required')
 state_file=state_file or ROOT/'instance/data/account-brand/changes.json'
 state=json.loads(state_file.read_text(encoding='utf-8')) if state_file.exists() else {}
 if key in state:raise ValueError('already attempted; do not retry uncertain writes')
 interval=7*86400 if plan['action']=='set_qq_avatar' else 3*86400
 if any(v['action']==plan['action'] and time.time()-v['time']<interval for v in state.values()):raise ValueError('frequency limit')
 login=await send('get_login_info',{});assert str((login.get('data') or {}).get('user_id'))=='3816636861'
 if plan['action']=='set_qq_avatar':
  async with httpx.AsyncClient(trust_env=False,timeout=8) as c:
   r=await c.get('https://q1.qlogo.cn/g?b=qq&nk=3816636861&s=640');r.raise_for_status()
  (state_file.parent/('previous-avatar-'+str(int(time.time()))+'.jpg')).write_bytes(r.content)
 state[key]={'action':plan['action'],'time':time.time(),'status':'pending','plan':plan}
 state_file.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
 params={k:plan[k] for k in ('content','ugc_right','target_uins') if k in plan} if plan['action']=='send_qzone_msg' else {'file':Path(plan['file']).as_uri()}
 result=await send(plan['action'],params)
 state[key].update(status=result.get('status'),receipt=result.get('data'))
 state_file.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8');return result
if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('plan',type=Path);args=parser.parse_args()
 p=json.loads(args.plan.read_text(encoding='utf-8'));print(json.dumps({'valid':True,'sha256':validate(p),'executed':False}))
