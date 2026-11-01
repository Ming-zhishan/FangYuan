import unittest,copy
from import_human_reviews import triage

def fixture():
    candidates=[
      {'id':'voice-x','sha256':'a'*64,'text':'我听着'},
      {'id':'voice-y','sha256':'b'*64,'text':'请继续'}
    ]
    portal={'focusGroups':[{'id':'01','name':'第一组','candidates':candidates}],
        'counts':{'samples':2,'retakes':0},'copyrightCleared':False,'productionReady':False}
    feedback={'schema':1,'purpose':'human_voice_preference_only',
        'humanCopyrightConsentVerified':False,'productionApproved':False,'qqSendApproved':False,
        'declaredSourceCount':2,'decisions':[{'group':'01','chosen':'unreviewed',
           'note':'','candidates':[{'id':x['id'],'sha256':x['sha256']} for x in candidates]}]}
    return portal,feedback
class UserVoiceReviewIngestTests(unittest.TestCase):
    def test_unreviewed_cannot_become_approved(self):
        a,b=fixture();r=triage(a,b)
        self.assertEqual(r['counts']['notReviewed'],1)
        self.assertEqual(r['counts']['preferred'],0)
        self.assertFalse(r['productionApproved'])
        self.assertFalse(r['qqReady'])
    def test_user_preference_is_not_release(self):
        a,b=fixture();b['decisions'][0]['chosen']='voice-x';r=triage(a,b)
        self.assertEqual(r['counts']['preferred'],1)
        self.assertEqual(r['records'][0]['preferredSha256'],'a'*64)
        self.assertFalse(r['records'][0]['productionReady'])
    def test_user_retake_flag(self):
        a,b=fixture();b['decisions'][0]['chosen']='none';r=triage(a,b)
        self.assertEqual(r['counts']['retake'],1)
    def test_unknown_choice_rejected(self):
        a,b=fixture();b['decisions'][0]['chosen']='never-existed'
        with self.assertRaisesRegex(ValueError,'Invalid chosen'):triage(a,b)
    def test_tampered_sha_rejected(self):
        a,b=fixture();b['decisions'][0]['candidates'][0]['sha256']='f'*64
        with self.assertRaisesRegex(ValueError,'hashes'):triage(a,b)
    def test_production_permission_forgery_rejected(self):
        a,b=fixture();b['qqSendApproved']=True
        with self.assertRaisesRegex(ValueError,'elevated'):triage(a,b)
    def test_long_note_rejected(self):
        a,b=fixture();b['decisions'][0]['note']='x'*1000
        with self.assertRaisesRegex(ValueError,'overlong'):triage(a,b)
    def test_stale_count_rejected(self):
        a,b=fixture();b['declaredSourceCount']=3
        with self.assertRaisesRegex(ValueError,'sample count'):triage(a,b)
    def test_duplicate_group_rejected(self):
        a,b=fixture();b['decisions']=[b['decisions'][0]]*2
        with self.assertRaisesRegex(ValueError,'exactly one'):triage(a,b)
if __name__=='__main__':
 unittest.main(verbosity=2)
