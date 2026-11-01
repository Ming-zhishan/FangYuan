"""Import FangYuan one-page reviewer choices safely into PRIVATE R&D triage.

Feedback expresses which audio *sounds preferable* to the user. It does NOT
approve speaker rights, Bot deployment, QQ sends or public re-use.
"""
from __future__ import annotations
import argparse,hashlib,json,re
from pathlib import Path

def jsonfile(path:Path):
 return json.loads(path.read_text(encoding='utf-8-sig'))
def load_portal(html:Path):
 text=html.read_text(encoding='utf8')
 match=re.search(r'<script id="review-data" type="application/json">([\s\S]*?)</script>',text)
 if not match:raise ValueError('Cannot locate private review evidence')
 d=json.loads(match.group(1))
 if d.get('copyrightCleared') is not False or d.get('productionReady') is not False:
  raise ValueError('Portal permissions unexpectedly open')
 return d

def triage(portal:dict,feedback:dict):
 if feedback.get('schema')!=1 or feedback.get('purpose')!='human_voice_preference_only':
  raise ValueError('Unexpected feedback schema or purpose')
 for k in ['humanCopyrightConsentVerified','productionApproved','qqSendApproved']:
  if feedback.get(k) is not False:raise ValueError('Unacceptable elevated feedback permission')
 groups={str(g['id']):g for g in portal['focusGroups']}
 decisions=feedback.get('decisions')
 if not isinstance(decisions,list) or len(decisions)!=len(groups):
  raise ValueError('Expect exactly one feedback choice for each focus group')
 if feedback.get('declaredSourceCount') != portal['counts']['samples']+portal['counts']['retakes']:
  raise ValueError('Portal/feedback sample count differs')
 seen=set()
 result=[]
 for row in decisions:
  gid=str(row.get('group',''))
  if gid not in groups or gid in seen:raise ValueError('Unrecognized or duplicate group ID')
  seen.add(gid)
  g=groups[gid]
  expected={x['id']:x['sha256'] for x in g['candidates']}
  supplied={x['id']:x['sha256'] for x in row.get('candidates',[])}
  if supplied!=expected:raise ValueError('Audio file hashes do not match current review portal')
  chosen=row.get('chosen')
  if chosen not in [*expected,'none','unreviewed']:
   raise ValueError('Invalid chosen audio ID')
  note=row.get('note','')
  if not isinstance(note,str) or len(note)>400:raise ValueError('Invalid or overlong review note')
  action='listen_pending' if chosen=='unreviewed' else ('human_requested_retake' if chosen=='none' else 'human_preferred_take')
  result.append({'id':gid,'title':g['name'],'action':action,
    'preferredAudioId':chosen if chosen in expected else None,
    'preferredSha256':expected.get(chosen),
    'note':note,'subjectivePreferenceOnly':True,
    'copyrightCleared':False,'speakerRightsVerified':False,
    'productionReady':False})
 result.sort(key=lambda x:x['id'])
 return {'schema':1,'records':result,'counts':{
   'preferred':sum(x['action']=='human_preferred_take' for x in result),
   'retake':sum(x['action']=='human_requested_retake' for x in result),
   'notReviewed':sum(x['action']=='listen_pending' for x in result)},
    'nextAction':'Refine acoustic samples and show comparison again, not deploy to QQ.',
    'qqReady':False,'publisherChanges':False,'productionApproved':False}

def import_review(html:Path,feedback_file:Path,out:Path):
 if out.exists():raise ValueError('Cannot overwrite any previous review triage')
 d=triage(load_portal(html),jsonfile(feedback_file))
 d['sourceFeedbackSha256']=hashlib.sha256(feedback_file.read_bytes()).hexdigest()
 out.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 return {'result':str(out),'counts':d['counts'],'qqReady':False}
if __name__=='__main__':
 parser=argparse.ArgumentParser()
 parser.add_argument('--portal',required=True,type=Path)
 parser.add_argument('--feedback',required=True,type=Path)
 parser.add_argument('--out',required=True,type=Path)
 args=parser.parse_args()
 print(json.dumps(import_review(args.portal,args.feedback,args.out),ensure_ascii=False,indent=2))
