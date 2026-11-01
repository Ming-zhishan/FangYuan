"""Canonical, hash-verified private F5 voice research index; never production-ready."""
from pathlib import Path
import argparse,hashlib,json,wave,array,math
def load(f):return json.loads(f.read_text(encoding='utf-8-sig'))
def digest(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def inspect_audio(f):
 with wave.open(str(f),'rb') as w:
  ch,sr,bits,frames=w.getnchannels(),w.getframerate(),w.getsampwidth(),w.getnframes()
  pcm=w.readframes(frames)
 if (ch,sr,bits)!=(1,24000,2) or frames<8000:raise ValueError('Unexpected PCM format')
 a=array.array('h');a.frombytes(pcm)
 peak=max(abs(v) for v in a)/32768.
 rms=math.sqrt(sum(v*v for v in a)/len(a))/32768.
 clipped=sum(abs(v)>=32766 for v in a)
 if peak>.97 or rms<.01 or clipped:raise ValueError('Audio technical gate failed')
 return {'seconds':round(frames/sr,3),'peak':round(peak,5),'rms':round(rms,5),'clipping':clipped}
def build(dirs,out):
 if out.exists():raise ValueError('Refusing overwrite')
 entries=[];ids=set()
 for d in dirs:
  m=load(d/('VOICE_LAB_FINAL.json' if (d/'VOICE_LAB_FINAL.json').exists() else 'VOICE_FACTORY_FINAL.json'))
  q=load(d/('VOICE_ASR_QA_REVISED.json' if (d/'VOICE_ASR_QA_REVISED.json').exists() else 'VOICE_ASR_FACTORY_FINAL.json'))
  qs={r['id']:r for r in q['records']}
  for x in (m.get('entries') or m.get('samples')):
   file=d/x['file'];id=x['id']
   if id in ids:raise ValueError('Duplicate id '+id)
   ids.add(id)
   if not file.is_file() or digest(file)!=x['sha256']:raise ValueError('Bad audio SHA '+id)
   result=qs[id]
   expect=result.get('expected',result.get('original',result.get('original_text')))
   if expect!=x['text']:raise ValueError('ASR text drift '+id)
   p=float(result.get('pinyin_sequence_agreement',result.get('pinyin_similarity')))
   entries.append({'id':id,'text':x['text'],'scene':x.get('scene','未分类'),
     'delivery':x.get('delivery',''),'researchPack':d.name,
     'file':str(file.resolve()),'sha256':x['sha256'],
     'asr':result.get('asr_text',result.get('recognized')),'pinyinScore':p,
     'audio':inspect_audio(file),'wordCorrectHumanVerified':False,
     'speakerRightsVerified':False,'humanListeningApproved':False,
     'publishable':False,'qqReady':False})
 data={'schema':1,'count':len(entries),'technicalPassed':len(entries),
  'phoneticGe90':sum(x['pinyinScore']>=.9 for x in entries),
  'lowScoreIds':[x['id'] for x in entries if x['pinyinScore']<.9],
  'humanListeningApproved':0,'speakerRightsVerified':False,
  'qqReady':False,'productionReady':False,'entries':entries}
 out.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 return {'count':data['count'],'technicalPassed':data['technicalPassed'],
 'phoneticGe90':data['phoneticGe90'],'lowScoreIds':data['lowScoreIds'],'qqReady':False}
if __name__=='__main__':
 p=argparse.ArgumentParser()
 p.add_argument('--pack',type=Path,action='append',required=True)
 p.add_argument('--out',type=Path,required=True)
 a=p.parse_args()
 print(json.dumps(build(a.pack,a.out),ensure_ascii=False,indent=2))
