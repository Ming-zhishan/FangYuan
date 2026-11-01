"""Offline prosody screening for original Fang Yuan voice R&D packs.
Acoustic proxies are not perceptual listening, identity verification or permission to clone.
Does not access QQ, original voice training data beyond the supplied reference WAV,
cloud services or any existing production module.
"""
from __future__ import annotations
import argparse,hashlib,json,math
from pathlib import Path
import librosa
import numpy as np
import soundfile as sf

def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def read(f):return json.loads(f.read_text(encoding='utf8'))
def analyze(path:Path) -> dict:
    y,sr=sf.read(path,always_2d=True)
    if len(y)<sr*.4 or not np.isfinite(y).all():raise ValueError('Too short, empty or nonfinite audio')
    if y.shape[1]>1:y=y.mean(axis=1)
    else:y=y[:,0]
    if sr!=24000:y=librosa.resample(y,orig_sr=sr,target_sr=24000)
    hop=256
    frame=2048
    rms=librosa.feature.rms(y=y,frame_length=frame,hop_length=hop)[0]
    if rms.max()<.001:raise ValueError('Silent waveform')
    speech_thr=max(.007,float(np.percentile(rms,90))*.17)
    voiced_mask=rms>=speech_thr
    f0=librosa.yin(y,sr=24000,fmin=60,fmax=400,frame_length=frame,hop_length=hop)
    m=min(len(f0),len(rms))
    pitch=f0[:m][voiced_mask[:m]]
    pitch=pitch[(pitch>=65)&(pitch<=380)]
    pitch=np.asarray(pitch)
    last=np.flatnonzero(voiced_mask)
    start_s=float(last[0]*hop/24000) if len(last) else float(len(y)/24000)
    tail_s=float((len(rms)-1-last[-1])*hop/24000) if len(last) else float(len(y)/24000)
    centroid=librosa.feature.spectral_centroid(y=y,sr=24000,hop_length=hop)[0]
    return {
      'duration_s':round(len(y)/24000,3),
      'speech_fraction':round(float(voiced_mask.mean()),4),
      'leading_silence_s':round(start_s,3),
      'trailing_silence_s':round(tail_s,3),
      'median_f0_hz':round(float(np.median(pitch)),1) if len(pitch)>4 else None,
      'f0_p10_hz':round(float(np.percentile(pitch,10)),1) if len(pitch)>4 else None,
      'f0_p90_hz':round(float(np.percentile(pitch,90)),1) if len(pitch)>4 else None,
      'spectral_centroid_hz':round(float(np.median(centroid)),1),
      'max_sample':round(float(np.max(np.abs(y))),5),
      'fullscale_samples':int(np.sum(np.abs(y)>=.999)),
      'rms':round(float(np.sqrt(np.mean(y*y))),5),
      'dc_offset':round(float(np.mean(y)),5),
    }
def review(reference:Path,manifests:list[Path]):
    ref=analyze(reference)
    result=[]
    seen=set()
    for path in manifests:
        source=read(path)
        key='samples' if 'samples' in source else 'entries'
        for row in source[key]:
            asset=path.parent/row['file']
            if row['id'] in seen:raise ValueError('Duplicate voice ID')
            seen.add(row['id'])
            if not asset.is_file() or sha(asset)!=row['sha256']:raise ValueError('Missing or corrupted voice '+row['id'])
            metrics=analyze(asset)
            refpitch=ref['median_f0_hz']
            p=metrics['median_f0_hz']
            pitch_delta=round(12*math.log2(p/refpitch),2) if p and refpitch else None
            # Watchdogs only; do not automatically pretend any voice matches the reference speaker.
            signal_ok=(metrics['fullscale_samples']==0 and .025<=metrics['rms']<=.35
                 and metrics['max_sample']<=.98 and abs(metrics['dc_offset'])<=.045)
            pace_ok=(.22<=metrics['speech_fraction']<=.99 and
                metrics['leading_silence_s']<1.5 and metrics['trailing_silence_s']<1.5)
            flags=[]
            if not signal_ok:flags.append('waveform_quality')
            if not pace_ok:flags.append('too_much_silence_or_little_speech')
            if pitch_delta is None or abs(pitch_delta)>7:flags.append('pitch_range_differs_from_reference')
            result.append({'id':row['id'],'text':row['text'],'category':row.get('scene','uncategorized'),
                 'delivery':row.get('delivery',''),
                 'audio':str(asset),'sha256':row['sha256'],'metrics':metrics,
                 'median_pitch_shift_semitones_vs_reference':pitch_delta,
                 'technical_signal_ok':signal_ok,'pace_proxy_ok':pace_ok,
                 'review_flags':flags,'human_listened':False,
                 'speaker_identity_confirmed':False,'production_ready':False})
    return {'schema':1,'reference_sha256':sha(reference),
       'reference_metrics':ref,'samples':result,
       'counts':{'total':len(result),'signal_ok':sum(x['technical_signal_ok'] for x in result),
                 'pace_ok':sum(x['pace_proxy_ok'] for x in result),
                 'with_flags':sum(bool(x['review_flags']) for x in result)},
       'limits':'Pitch and timing proxies are NOT proof of similarity, emotion, likeness, speaker identity or license.',
       'human_listened':False,'production_ready':False,'qq_ready':False}
if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--reference',required=True,type=Path)
    p.add_argument('--manifest',action='append',required=True,type=Path)
    p.add_argument('--out',required=True,type=Path)
    a=p.parse_args()
    if a.out.exists():raise SystemExit('Cannot overwrite existing report')
    r=review(a.reference,a.manifest)
    a.out.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'counts':r['counts'],'reference':r['reference_metrics'],
        'flags':[{'id':x['id'],'flags':x['review_flags'],'f0_delta':x['median_pitch_shift_semitones_vs_reference']}
                 for x in r['samples'] if x['review_flags']]},ensure_ascii=False,indent=2),flush=True)
