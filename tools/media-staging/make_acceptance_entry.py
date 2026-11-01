"""Generate ONE friendly, private FangYuan media review entrypoint.

No copyrighted assets copied into the repository. Every WAV/JPG is read from
existing private task-owned research directories and SHA-256 verified.
All permissions and production flags remain closed.
"""
from pathlib import Path
import argparse,hashlib,json,datetime
from urllib.parse import quote

def js(f):return json.loads(f.read_text(encoding='utf-8-sig'))
def hashfile(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def build(root:Path,template:Path,out:Path,extra_lab:Path|None=None,clarity_lab:Path|None=None):
 if out.exists():raise ValueError('Review entrypoint already exists; use new version')
 owner=js(root/'.fangyuan-media-staging-root.json')
 if owner.get('purpose')!='isolated-fangyuan-media-staging':
  raise ValueError('Untrusted media task root')
 if not template.is_file():raise ValueError('Template missing')
 def check_voice(f):
  manifest=js(f/'VOICE_LAB_FINAL.json') if (f/'VOICE_LAB_FINAL.json').exists() else js(f/'VOICE_FACTORY_FINAL.json')
  qa=js(f/'VOICE_ASR_QA_REVISED.json') if (f/'VOICE_ASR_QA_REVISED.json').exists() else js(f/'VOICE_ASR_FACTORY_FINAL.json')
  qa_by={x['id']:x for x in qa['records']}
  result=[]
  for v in (manifest.get('entries') or manifest.get('samples')):
   file=f/v['file']
   if not file.is_file() or hashfile(file)!=v['sha256']:raise ValueError('Voice hash failure: '+str(file))
   a=qa_by.get(v['id'])
   if a is None:raise ValueError('No ASR QA for '+v['id'])
   score=a.get('pinyin_sequence_agreement',a.get('pinyin_similarity'))
   recognized=a.get('asr_text',a.get('recognized'))
   if a.get('expected',a.get('original',a.get('original_text')))!=v['text']:
    raise ValueError('ASR target text drift for '+v['id'])
   result.append({'id':v['id'],'name':v['text'],'scene':v.get('scene','未分类'),
    'delivery':v.get('delivery',''),'file':file.resolve().as_uri(),'sha256':v['sha256'],
    'duration':v.get('duration_s',v.get('audio_metrics',{}).get('duration_s')),
    'score':score,'recognized':recognized,'technical':v.get('clipped',0)==0,
    'verifiedByUser':False,'productionReady':False})
  return result
 v1=check_voice(root/'voice_zero_shot_v1')
 v2=check_voice(root/'voice_zero_shot_v2')
 v3=check_voice(root/'voice_scene_pack_v3')
 retakes=check_voice(root/'voice_retake_v4')
 repairs=check_voice(extra_lab) if extra_lab is not None else []
 clarity=check_voice(clarity_lab) if clarity_lab is not None else []
 all_base=v1+v2+v3
 if len(all_base)!=24 or len(retakes)!=6 or (extra_lab is not None and len(repairs)!=4) or (clarity_lab is not None and len(clarity)!=3):
  raise ValueError('Unexpected voice count; require manual schema adaptation')
 ids={x['id'] for x in all_base}
 if len(ids)!=24:raise ValueError('Duplicate base sample IDs')
 grouped=[
   {'name':'01 · 日常简短回应','id':'01','source':'fy-scene-v3-01','other':['fy-retake-v4-01a','fy-retake-v4-01b']},
   {'name':'02 · 理解对方意思','id':'02','source':'fy-scene-v3-02','other':['fy-retake-v4-02a','fy-retake-v4-02b']},
   {'name':'06 · 网络调侃','id':'06','source':'fy-scene-v3-06','other':['fy-retake-v4-06a']},
   {'name':'07 · 理性筹划','id':'07','source':'fy-scene-v3-07','other':['fy-retake-v4-07a']}
 ]
 by_id={x['id']:x for x in all_base+retakes+repairs+clarity}
 for g in grouped:
  ids=[g['source'],*g['other']]
  if extra_lab is not None:ids.append('fy-repair-v5-'+g['id'])
  if clarity_lab is not None and g['id']=='01':ids += ['fy-clarity-v6-01a','fy-clarity-v6-01b','fy-clarity-v6-01c']
  g['candidates']=[by_id[i] for i in ids]
 other=[x for x in all_base if x['id'] not in set(g['source'] for g in grouped)]
 guides=js(root/'meme_face_roi_guides_v1'/'FACE_EDIT_GUIDES_FINAL.json')
 images=[]
 for g in guides['items']:
  original=Path(g['baseline'])
  picture=Path(g['guidance'])
  if not original.is_file() or hashfile(original)!=g['baselineSha256'] or not picture.is_file():
   raise ValueError('Visual evidence not intact for '+g['id'])
  images.append({'id':g['id'],'original':original.resolve().as_uri(),'guide':picture.resolve().as_uri(),
     'preserve':g['preserve'],'changeOnly':g['change_only'],
     'editedCandidateAvailable':False,'productionReady':False})
 if len(images)!=2:raise ValueError('Expected two documented real reference photos')
 prosody=js(root/'VOICE_PROSODY_AUDIT_V3_FINAL.json')
 if prosody['counts']['total']!=24:raise ValueError('Voice objective-QA mismatch')
 manifest={
  'schema':1,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'focusGroups':grouped,'otherSamples':other,'images':images,
  'counts':{'samples':len(all_base),'retakes':len(retakes)+len(repairs)+len(clarity),
   'phoneticGreenBase':sum(x['score']>=.9 for x in all_base),
   'phoneticGreenRetakes':sum(x['score']>=.9 for x in retakes+repairs+clarity),
   'technicalBasePass':prosody['counts']['signal_ok'],
   'humanVoiceApproved':0,'highFidelityEditedMemes':0,'qqPublished':0},
  'copyrightCleared':False,'humanListenCompleted':False,'productionReady':False,
  'qaDisclaimer':'Automated ASR is not a human listening test. MIDI, consonants, emotion and likeness may differ.'
 }
 tpl=template.read_text(encoding='utf8')
 if tpl.count('__DATA__')!=1:raise ValueError('Bad template')
 payload=json.dumps(manifest,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('&','\\u0026').replace('>','\\u003e')
 html=tpl.replace('__DATA__',payload)
 if '<script src=' in html.lower() or '<iframe' in html.lower():
  raise ValueError('Browser entrypoint must remain entirely local')
 out.mkdir()
 try:
  (out/'方源媒体_开始验收.html').write_text(html,encoding='utf8')
  (out/'ENTRYPOINT_FINAL.json').write_text(json.dumps({
   'schema':1,'generatedAt':manifest['generatedAt'],'files':[{
    'id':x['id'],'sha256':x['sha256']} for x in all_base+retakes+repairs+clarity],
   'focusGroups':len(grouped),'humanApproved':0,'mediaPublished':0,
   'rebuildScript':'make_acceptance_entry.py','inputFilesPreserved':True,
   'entrypoint':'方源媒体_开始验收.html','offline':True},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 except Exception:
  for f in out.iterdir():f.unlink()
  out.rmdir()
  raise
 return {'entry':str(out/'方源媒体_开始验收.html'),
  'totalVoiceSamples':len(all_base)+len(retakes)+len(repairs)+len(clarity),
  'focusGroups':len(grouped),'reviewedByHuman':0,'newMemeEditsReady':0}
if __name__=='__main__':
 ap=argparse.ArgumentParser()
 ap.add_argument('--root',type=Path,required=True)
 ap.add_argument('--template',type=Path,required=True)
 ap.add_argument('--out',type=Path,required=True)
 ap.add_argument('--extra-lab',type=Path)
 ap.add_argument('--clarity-lab',type=Path)
 a=ap.parse_args()
 print(json.dumps(build(a.root,a.template,a.out,a.extra_lab,a.clarity_lab),ensure_ascii=False,indent=2))
