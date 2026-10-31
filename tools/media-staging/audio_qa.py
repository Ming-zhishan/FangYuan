# Offline voice QA companion for FangYuan media factory.
# Objective audio checks + traditional/simplified-resistant pinyin concordance.
# Never considers source attribution, consent, subjective similarity or QQ delivery solved.
from __future__ import annotations
import argparse
import difflib
import hashlib
import json
import math
import re
from pathlib import Path
import numpy as np
import soundfile as sf
from pypinyin import lazy_pinyin

CJK=re.compile(r'[\u3400-\u9fff]')
def phonemes(s: str) -> list[str]:
    # The offline ASR may emit Traditional Chinese for a Simplified Chinese prompt.
    return lazy_pinyin(''.join(CJK.findall(s)),errors='ignore')
def raw_char_score(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, CJK.findall(a), CJK.findall(b),autojunk=False).ratio()
def pinyin_score(a: str,b: str) -> float:
    return difflib.SequenceMatcher(None,phonemes(a),phonemes(b),autojunk=False).ratio()
def audio_metrics(file:Path) -> dict:
    waveform,sr=sf.read(file,always_2d=True,dtype='float64')
    if not waveform.size or not np.isfinite(waveform).all():raise ValueError('Invalid or empty waveform')
    peak=float(np.max(np.abs(waveform)))
    rms=float(np.sqrt(np.mean(waveform*waveform)))
    dc=float(np.mean(waveform))
    clipped=int(np.sum(np.abs(waveform)>=0.999))
    seconds=len(waveform)/sr
    technical=(
        sr>=24000 and 1<=seconds<=18 and .025<=rms<=.35 and peak<=.97
        and clipped==0 and abs(dc)<=.05 and waveform.shape[1]==1
    )
    return {'duration_s':round(seconds,3),'sample_rate':sr,'channels':waveform.shape[1],
            'peak':round(peak,5),'rms':round(rms,5),'dc':round(dc,5),
            'clipped_samples':clipped,'technical_pass':technical}
def inspect(lab:Path):
    original=json.loads((lab/'VOICE_LAB_FINAL.json').read_text(encoding='utf8'))
    asr=json.loads((lab/'VOICE_ASR_QA_FINAL.json').read_text(encoding='utf8'))
    records={x['id']:x for x in asr['records']}
    report=[]
    for e in original['entries']:
        source=lab/e['file']
        if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest()!=e['sha256']:
            raise ValueError('Source SHA-256 missing/mismatched: '+e['id'])
        if e['id'] not in records:raise ValueError('Missing ASR evidence: '+e['id'])
        z=records[e['id']]
        if z['expected']!=e['text']:raise ValueError('ASR expected text mismatch: '+e['id'])
        metrics=audio_metrics(source)
        character=raw_char_score(e['text'],z['recognized'])
        pronunciation=pinyin_score(e['text'],z['recognized'])
        report.append({
            'id':e['id'],'original_text':e['text'],'asr_text':z['recognized'],
            'raw_character_agreement':round(character,4),
            'pinyin_sequence_agreement':round(pronunciation,4),
            'script_difference_can_affect_character_score':True,
            'phonetic_review':'likely_intelligible' if pronunciation>=.90 else 'needs_repeat_generation',
            'audio':metrics,'sha256':e['sha256'],
            'human_listened':False,'speaker_identity_verified':False,
            'published':False,'qq_ready':False})
    return {'schema':1,'source_voice':str(lab),
      'disclaimer':'Pinyin matching can hide homophone word errors; NOT human intelligibility or word-level correctness.',
      'records':report,
      'technical_pass_count':sum(r['audio']['technical_pass'] for r in report),
      'pinyin_agreement_ge_0_90_count':sum(r['pinyin_sequence_agreement']>=.90 for r in report),
      'production_approved':False,'qq_send_approved':False}
if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--lab',type=Path,required=True)
    ap.add_argument('--out',type=Path,required=True)
    args=ap.parse_args()
    if args.out.exists():raise SystemExit('Refuse to overwrite QA file')
    result=inspect(args.lab)
    args.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'count':len(result['records']),'technical_pass':result['technical_pass_count'],
         'pinyin_agreement_ge_0_90':result['pinyin_agreement_ge_0_90_count'],
         'scores':[(x['id'],x['raw_character_agreement'],x['pinyin_sequence_agreement']) for x in result['records']]},
         ensure_ascii=False,indent=2))
