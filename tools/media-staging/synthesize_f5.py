"""FangYuan private F5 zero-shot original voice pack builder.

Offline research only: caller supplies a permitted reference recording and matching reference
text, with a SHA-256. This does not certify speaker rights, human listening, or QQ sending.
All outputs go to one NEW task-owned directory. No model training or paid API invocation.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import numpy as np
import soundfile as sf

def sha(p:Path)->str:
    return hashlib.sha256(p.read_bytes()).hexdigest()
def validate(ref:Path,ref_sha:str,ref_text:str,script:Path,out:Path):
    if not(ref.is_file() and re.fullmatch(r'[0-9a-fA-F]{64}',ref_sha)):
        raise ValueError('Reference or SHA is missing')
    if sha(ref).lower()!=ref_sha.lower():raise ValueError('Reference audio SHA mismatch')
    if not ref_text or len(ref_text.strip())<7:raise ValueError('Reference transcript needed')
    if not script.is_file():raise ValueError('Original text script missing')
    data=json.loads(script.read_text(encoding='utf-8-sig'))
    if not isinstance(data,list) or not data:raise ValueError('Expected nonempty JSON array')
    ids=set()
    for x in data:
        if not isinstance(x,dict) or not re.fullmatch(r'[a-zA-Z0-9-]{3,80}',str(x.get('id',''))):
            raise ValueError('Unsafe or missing sample id')
        if x['id'] in ids:raise ValueError('Duplicate sample ID')
        ids.add(x['id'])
        if not isinstance(x.get('text'),str) or len(x['text'].strip())<3 or len(x['text'])>350:
            raise ValueError('Invalid sample text')
    if out.exists():raise ValueError('Refusing to overwrite existing output')
    marker=out.parent/'.fangyuan-media-staging-root.json'
    if not marker.is_file():raise ValueError('Missing owner marker')
    owner=json.loads(marker.read_text(encoding='utf-8-sig'))
    if owner.get('purpose')!='isolated-fangyuan-media-staging':
        raise ValueError('Output is not owned by media task')
    return data
def synthesise(*,reference:Path,ref_sha:str,ref_text:str,script:Path,out:Path,
               seed_start:int=18371,nfe:int=32,speed:float=.94,device:str='cuda'):
    clips=validate(reference,ref_sha,ref_text,script,out)
    # Never download a model as an unreviewed side effect of an offline run.
    os.environ.setdefault('HF_HUB_OFFLINE','1')
    os.environ.setdefault('TRANSFORMERS_OFFLINE','1')
    from f5_tts.api import F5TTS
    model=F5TTS(model='F5TTS_v1_Base',device=device)
    out.mkdir()
    results=[]
    try:
        for index,row in enumerate(clips):
            wav,sr,_=model.infer(ref_file=str(reference),ref_text=ref_text,
                   gen_text=row['text'],nfe_step=nfe,speed=speed,seed=seed_start+index,
                   show_info=lambda *_:None)
            arr=np.asarray(wav,dtype=np.float64)
            if arr.ndim!=1 or arr.size==0 or not np.isfinite(arr).all():
                raise RuntimeError('Invalid generated waveform')
            old_peak=float(np.max(np.abs(arr)))
            if not(.001<old_peak<8):raise RuntimeError('Suspicious generated peak')
            gain=min(1.,.89/old_peak)
            arr*=gain
            output=out/(row['id']+'.wav')
            sf.write(output,arr,sr,subtype='PCM_16')
            decoded,rate=sf.read(output,dtype='float64')
            rms=float(np.sqrt(np.mean(decoded**2)))
            clipping=int(np.sum(np.abs(decoded)>=.999))
            duration=len(decoded)/rate
            if rate<24000 or duration<.3 or duration>60 or rms<.01 or clipping>0:
                raise RuntimeError('Generated sample failed waveform checks: '+row['id'])
            results.append({
                'id':row['id'],'text':row['text'],'file':output.name,'sha256':sha(output),
                'duration_s':round(duration,3),'sample_rate':rate,
                'original_peak':round(old_peak,5),'output_peak':round(float(np.max(np.abs(decoded))),5),
                'rms':round(rms,5),'gain':round(gain,5),'clipped':clipping,
                'human_listened':False,'production_ready':False,'qq_ready':False})
        manifest={'schema':1,'reference_sha256':ref_sha,'voice_rights_file_not_independently_verified':True,
            'reference_text':ref_text,'nfe':nfe,'speed':speed,
            'output_count':len(results),'samples':results,'human_approved':False,
            'production_approved':False,'qq_send_approved':False}
        (out/'VOICE_FACTORY_FINAL.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        return {'directory':str(out),'samples':len(results),'technically_valid':len(results),
                'human_approved':0,'qq_ready':False}
    except Exception:
        # Do not keep misleading half-completed audio packs on errors.
        for f in out.glob('*'):
            if f.is_file():f.unlink()
        out.rmdir()
        raise
if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--reference',required=True,type=Path)
    p.add_argument('--reference-sha256',required=True)
    p.add_argument('--reference-text',required=True)
    p.add_argument('--script',required=True,type=Path)
    p.add_argument('--out',required=True,type=Path)
    p.add_argument('--nfe',type=int,default=32)
    p.add_argument('--speed',type=float,default=.94)
    p.add_argument('--seed-start',type=int,default=18371)
    p.add_argument('--device',default='cuda')
    p.add_argument('--dry-run',action='store_true')
    a=p.parse_args()
    if not(12<=a.nfe<=64 and .75<=a.speed<=1.2):raise SystemExit('Unsafe inference settings')
    clips=validate(a.reference,a.reference_sha256,a.reference_text,a.script,a.out)
    if a.dry_run:print(json.dumps({'status':'validated','clips':len(clips),'no_models_loaded':True}))
    else:print(json.dumps(synthesise(reference=a.reference,ref_sha=a.reference_sha256,
           ref_text=a.reference_text,script=a.script,out=a.out,seed_start=a.seed_start,
           nfe=a.nfe,speed=a.speed,device=a.device),ensure_ascii=False))
