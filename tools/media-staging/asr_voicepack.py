"""Independent cached Whisper-small QA of private F5 audio assets.
No model downloads, production modifications, audio recording uploads, or QQ sends.
ASR/pinyin scores are engineering triage only, not proof of voice identity or consent.
"""
from pathlib import Path
import argparse,json,os,hashlib,difflib,time
from pypinyin import lazy_pinyin
import numpy as np
import soundfile as sf

def cjk(s):return ''.join(ch for ch in s if '\u3400'<=ch<='\u9fff')
def pinyin_similarity(a,b):
 return difflib.SequenceMatcher(None,lazy_pinyin(cjk(a)),lazy_pinyin(cjk(b)),autojunk=False).ratio()
def main(*,lab:Path,out:Path,cache:Path):
 if out.exists():raise ValueError('Output exists; never overwrite')
 manifest_path=lab/'VOICE_FACTORY_FINAL.json'
 if not manifest_path.exists():raise ValueError('Expected versioned F5 voice factory manifest')
 manifest=json.loads(manifest_path.read_text(encoding='utf8'))
 rows=manifest['samples']
 if not rows or any(x.get('qq_ready')!=False for x in rows):raise ValueError('Unexpected release state')
 snapshots=sorted(cache.glob('*/model.bin'))
 if not snapshots:raise ValueError('Cached Whisper-small weights missing, no network')
 model_dir=snapshots[-1].parent
 os.environ['HF_HUB_OFFLINE']='1'
 from faster_whisper import WhisperModel
 model=WhisperModel(str(model_dir),device='cpu',compute_type='int8',num_workers=1)
 results=[]
 for x in rows:
  audio=lab/x['file']
  if hashlib.sha256(audio.read_bytes()).hexdigest()!=x['sha256']:
    raise ValueError('Voice sample corrupted: '+x['id'])
  clips,info=model.transcribe(str(audio),language='zh',beam_size=5,
      condition_on_previous_text=False,vad_filter=False)
  segments=[{'start_s':round(s.start,3),'end_s':round(s.end,3),
             'text':s.text.strip(),'avg_logprob':round(s.avg_logprob,4)} for s in clips]
  recognized=''.join(s['text'] for s in segments)
  pinyin=round(pinyin_similarity(x['text'],recognized),4)
  character=round(difflib.SequenceMatcher(None,list(cjk(x['text'])),list(cjk(recognized)),autojunk=False).ratio(),4)
  rec={'id':x['id'],'original':x['text'],'recognized':recognized,'pinyin_similarity':pinyin,
       'raw_character_similarity':character,'segments':segments,
       'note':'Pinyin score can hide same-sounding wrong words and script differences',
       'editorial_approved':False,'qq_ready':False}
  results.append(rec)
  print(json.dumps({k:rec[k] for k in ['id','recognized','pinyin_similarity','raw_character_similarity']},
        ensure_ascii=False),flush=True)
 result={'model':'cached Whisper-small CPU-int8','source_manifest_sha256':hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
    'records':results,'phonetic_ge_0_90':sum(x['pinyin_similarity']>=.9 for x in results),
    'human_listened':False,'speaker_verified':False,'qq_ready':False}
 out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 return {'tested':len(results),'phonetic_ge_0_90':result['phonetic_ge_0_90'],
       'qq_ready':False}
if __name__=='__main__':
 p=argparse.ArgumentParser()
 p.add_argument('--lab',type=Path,required=True)
 p.add_argument('--out',type=Path,required=True)
 p.add_argument('--whisper-small-snapshots',type=Path,required=True)
 a=p.parse_args()
 print(json.dumps(main(lab=a.lab,out=a.out,cache=a.whisper_small_snapshots),ensure_ascii=False),flush=True)
