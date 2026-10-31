import unittest,tempfile,time
from pathlib import Path
from conversation_journal import ConversationJournal,BOT,GROUP
class RecoveryTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.j=ConversationJournal(Path(self.tmp.name)/'j.sqlite3');self.now=time.time()
 def tearDown(self):self.tmp.cleanup()
 def event(self,mid='m',stamp=None,uid='123',text='这个要怎么做？',group=GROUP):
  return {'message_id':mid,'time':stamp or self.now-60,'user_id':uid,'group_id':group,'sender':{'nickname':'君莫笑'},'message':[{'type':'at','data':{'qq':BOT}},{'type':'text','data':{'text':text}}]}
 def test_expiry_scope_and_greetings(self):
  e=self.event();self.assertEqual(self.j.candidates([e],self.now-500,self.now),[e])
  for bad in [self.event(text='早'),self.event(group='1'),self.event(stamp=self.now-22000),self.event(uid=BOT)]:self.assertEqual(self.j.candidates([bad],self.now-30000,self.now),[])
 def test_only_latest_one_and_no_answered_or_uncertain_replay(self):
  e=self.event();old=self.event(mid='old',stamp=self.now-100)
  self.assertEqual(self.j.candidates([old,e],self.now-500,self.now),[e]);self.assertTrue(self.j.claim('m'));self.assertFalse(self.j.claim('m'))
  self.assertEqual(self.j.candidates([e],self.now-500,self.now),[])
  self.j.observe(old,'旧问题');self.j.answered('old');self.assertEqual(self.j.candidates([old],self.now-500,self.now),[])
 def test_persistence_alias_and_watermark_monotonic(self):
  self.j.observe(self.event(),'问题')
  claim=self.event(mid='alias',uid='456',text='君莫笑就是成飞扬',stamp=self.now-30);claim['sender']={'nickname':'青盲哑狗'}
  self.j.observe(claim,'君莫笑就是成飞扬');self.j.put('proactive_unanswered',1)
  reopened=ConversationJournal(self.j.path);self.assertIn('成飞扬',reopened.identities());self.assertEqual(reopened.get('proactive_unanswered'),1)
  reopened.observe(self.event(mid='older',stamp=self.now-200),'过去');self.assertEqual(reopened.get('watermark'),self.now-30)
 def test_bot_followup_prevents_reopening_thread(self):
  e=self.event();reply=self.event(mid='reply',uid=BOT,stamp=self.now-50)
  self.assertEqual(self.j.candidates([e,reply],self.now-500,self.now),[])
if __name__=='__main__':unittest.main()
