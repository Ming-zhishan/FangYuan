import copy,unittest
from build_voice_focus import validate_feedback

def fixture():
 m={'sourceIndexSha256':'a'*64,'reviewSetId':'b'*64,
    'records':[{'id':'clip-a','sha256':'c'*64,'sourceSha256':'d'*64}]}
 f={'schema':1,'purpose':'voice_direction_feedback','sourceIndexSha256':m['sourceIndexSha256'],
    'reviewSetId':m['reviewSetId'],'direction':'unreviewed','productionApproved':False,'qqSendApproved':False,
    'records':[{**m['records'][0],'choice':'unreviewed','note':''}]}
 return m,f
class FeedbackGateTests(unittest.TestCase):
 def test_skipped_is_not_approved(self):
  m,f=fixture();r=validate_feedback(m,f)
  self.assertEqual(r['direction'],'unreviewed');self.assertFalse(r['productionApproved'])
 def test_changed_audio_rejected(self):
  m,f=fixture();f['records'][0]['sha256']='e'*64
  with self.assertRaisesRegex(ValueError,'Audio changed'):validate_feedback(m,f)
 def test_changed_preview_set_rejected(self):
  m,f=fixture();f['reviewSetId']='f'*64
  with self.assertRaisesRegex(ValueError,'Stale preview'):validate_feedback(m,f)
 def test_release_permission_rejected(self):
  m,f=fixture();f['qqSendApproved']=True
  with self.assertRaisesRegex(ValueError,'Elevated'):validate_feedback(m,f)
 def test_duplicate_rows_rejected(self):
  m,f=fixture();f['records']*=2
  with self.assertRaisesRegex(ValueError,'Wrong review set'):validate_feedback(m,f)
if __name__=='__main__':unittest.main(verbosity=2)
