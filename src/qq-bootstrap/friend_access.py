"""Short-lived, fail-closed QQ friendship evidence; no friend approval actions."""
import time
BOT='3816636861'
class FriendDirectory:
 def __init__(self,ttl=180):self.ids=set();self.checked_at=0.;self.ttl=ttl
 @property
 def ready(self):return self.checked_at>0 and time.monotonic()-self.checked_at<self.ttl
 def invalidate(self):self.ids=set();self.checked_at=0.
 def replace(self,rows,account):
  if str(account)!=BOT or not isinstance(rows,list):
   self.invalidate();raise ValueError('Unverified QQ friend directory')
  ids=set()
  for row in rows:
   if not isinstance(row,dict):raise ValueError('Invalid friend list')
   uid=str(row.get('user_id') or row.get('uin') or '')
   if not uid.isdigit():raise ValueError('Invalid friend account')
   if uid!=BOT:ids.add(uid)
  self.ids=ids;self.checked_at=time.monotonic()
 def verified(self,uid):return self.ready and str(uid) in self.ids
