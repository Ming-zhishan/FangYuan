"""Build a small, volume-matched listening set from existing PCM16 files.
No synthesis, downloads, production writes, or inferred human approval.
"""
from pathlib import Path
import argparse,hashlib,json,wave

SELECTED=[('fy-original-01','平静陈述'),('fy-clarity-v6-01a','日常接话'),('fy-scene-v3-05','熟人调侃')]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pcm(p):
 import numpy as np
 with wave.open(str(p),'rb') as f:
  if f.getnchannels()!=1 or f.getsampwidth()!=2 or f.getcomptype()!='NONE':raise ValueError('Require mono PCM16 WAV')
  return np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(np.float64)/32768,f.getframerate()
def build(index,reference,reference_sha,template,out):
 import numpy as np
 if out.exists():raise ValueError('Refusing to overwrite previous review')
 owner=json.loads((out.parent/'.fangyuan-media-staging-root.json').read_text(encoding='utf-8-sig'))
 if owner.get('purpose')!='isolated-fangyuan-media-staging' or owner.get('allowNewChildren') is not True:
  raise ValueError('Output parent is not owned by this media task')
 if sha(reference)!=reference_sha:raise ValueError('Reference hash changed')
 rows=json.loads(index.read_text(encoding='utf-8-sig'))['entries'];by={x['id']:x for x in rows}
 selected=[by[cid] for cid,_ in SELECTED]
 for x in selected:
  if x['pinyinScore']!=1 or sha(Path(x['file']))!=x['sha256']:raise ValueError('Candidate evidence mismatch')
 sources=[('reference',reference,'目标原声','我清楚地知道，人与人的路都是不可复制的。我走在我自己的人生路上。')]
 sources += [(x['id'],Path(x['file']),scene,x['text']) for x,(_,scene) in zip(selected,SELECTED)]
 prepared=[]
 for cid,path,scene,text in sources:
  if out.resolve().is_relative_to(path.parent.resolve()):raise ValueError('Output overlaps input audio folder')
  y,sr=pcm(path);rms=float(np.sqrt(np.mean(y*y)))
  if rms<.001:raise ValueError('Silent input')
  gain=.1/rms;peak=float(np.max(np.abs(y)))*gain
  if peak>.95:raise ValueError('Cannot match RMS without clipping; do not silently compress')
  encoded=np.rint(y*gain*32768).clip(-32768,32767).astype('<i2')
  if np.max(np.abs(encoded.astype(np.int32)))>=32767:raise ValueError('Clipped preview')
  prepared.append((cid,path,scene,text,sr,gain,encoded))
 out.mkdir(parents=True)
 records=[]
 for cid,path,scene,text,sr,gain,a in prepared:
  target=out/(cid+'.wav')
  with wave.open(str(target),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(sr);f.writeframes(a.tobytes())
  check,rate=pcm(target);rms=float(np.sqrt(np.mean(check*check)))
  if abs(rms-.1)>.0001 or len(check)!=len(a) or rate!=sr:raise ValueError('Preview roundtrip failed')
  records.append({'id':cid,'file':target.name,'sourceSha256':sha(path),'sha256':sha(target),'scene':scene,'text':text,
   'seconds':round(len(a)/sr,3),'sampleRate':sr,'rms':round(rms,6),'gain':round(gain,6),
   'peak':round(float(np.max(np.abs(check))),6),'humanListeningApproved':False})
 manifest={'schema':1,'purpose':'voice_direction_review','sourceIndexSha256':sha(index),
  'processing':'Linear gain only; equal whole-clip RMS 0.1, not LUFS normalization. Pitch, timing, text unchanged.',
  'records':records,'newSynthesizedAudio':0,'productionApproved':False,'qqSendApproved':False}
 manifest['reviewSetId']=hashlib.sha256(json.dumps(records,sort_keys=True).encode()).hexdigest()
 payload=json.dumps(manifest,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
 html=template.read_text(encoding='utf8');assert html.count('__DATA__')==1
 (out/'index.html').write_text(html.replace('__DATA__',payload),encoding='utf8')
 (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 return {'clips':len(records),'totalSeconds':round(sum(x['seconds'] for x in records),3),'newSynthesizedAudio':0,'humanApproved':False}

def validate_feedback(manifest,feedback):
 if feedback.get('purpose')!='voice_direction_feedback' or feedback.get('schema')!=1:raise ValueError('Wrong feedback')
 if feedback.get('productionApproved') is not False or feedback.get('qqSendApproved') is not False:raise ValueError('Elevated permission')
 if feedback.get('sourceIndexSha256')!=manifest['sourceIndexSha256']:raise ValueError('Stale source index')
 if feedback.get('reviewSetId')!=manifest['reviewSetId']:raise ValueError('Stale preview set')
 if feedback.get('direction') not in ('continue','change','unreviewed'):raise ValueError('Invalid direction')
 expected={x['id']:x for x in manifest['records']};rows=feedback.get('records',[])
 if len(rows)!=len(expected) or len({x['id'] for x in rows})!=len(expected):raise ValueError('Wrong review set')
 for row in rows:
  x=expected.get(row['id'])
  if not x or any(row.get(k)!=x[k] for k in ('sha256','sourceSha256')):raise ValueError('Audio changed')
  if row.get('choice') not in ('keep','pronunciation','delivery','synthetic','unreviewed'):raise ValueError('Invalid choice')
  if not isinstance(row.get('note',''),str) or len(row.get('note',''))>400:raise ValueError('Invalid note')
 return {'validated':True,'subjectiveOnly':True,'direction':feedback['direction'],'productionApproved':False}
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for n in ('index','reference','template','out'):p.add_argument('--'+n,required=True,type=Path)
 p.add_argument('--reference-sha256',required=True)
 a=p.parse_args();print(json.dumps(build(a.index,a.reference,a.reference_sha256,a.template,a.out)))
