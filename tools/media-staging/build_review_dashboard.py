"""Render a private, read-only FangYuan media factory dashboard.
Input: cumulative own SQLite, shadow source (all rights unverified), original F5 R&D output.
Output: one brand-new task-owned folder with a static local HTML and fingerprint manifest.
"""
from pathlib import Path
from urllib.parse import urlparse
import argparse, hashlib, json, sqlite3, datetime

def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def read(f):return json.loads(f.read_text(encoding='utf-8-sig'))
def assemble(*,factory_dir,shadow_dir,voice_lab,template,outdir,extra_voice_lab=None,face_guides=None,prosody_report=None):
    if outdir.exists():raise ValueError('output exists; refuse overwrite')
    owner=read(outdir.parent/'.fangyuan-media-staging-root.json')
    if owner.get('purpose')!='isolated-fangyuan-media-staging' or owner.get('allowNewChildren')!=True:
        raise ValueError('no media task ownership marker')
    factory=read(factory_dir/'FACTORY_FINAL.json')
    if factory.get('qqReady')!=False or factory.get('sourceRightsApproved')!=False:
        raise ValueError('Unexpected release status')
    with sqlite3.connect(f'file:{(factory_dir/"factory.sqlite3").as_posix()}?mode=ro',uri=True) as con:
        leads=[{'id':x[0],'platform':x[1],'title':x[2],'url':x[3],
                'rank':x[4],'priority':x[5]}
               for x in con.execute("SELECT id,platform,title,url,rank,priority FROM leads ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'background' THEN 1 ELSE 2 END,last_seen DESC,rank ASC")]
    if len(leads)!=factory['stats']['leads']:raise ValueError('Factory DB/JSON drift')
    source_root=shadow_dir/'meme_pipeline_lab'
    external_index=read(shadow_dir/'SHADOW_FINAL.json')
    if external_index['originals_total']!=factory['stats']['originalMedia']:
        raise ValueError('Source shadow integrity changed')
    known_names={
       'bear_turn_reference.gif':'熊大回眸',
       'cat_smoke_reference.gif':'猫咪气到冒烟',
       'classic_question_person_reference.jpg':'经典真人问号',
       'classic_reverse_person_reference.gif':'真人真香反转',
       'cow_truck_reference.gif':'一车牛来',
       'jiahao_reference.jpg':'嘉豪校园',
       'shan_shen_bu_reference.gif':'闪身步',
       'wild_dog_milk_reference.jpg':'野生狗奶',
       'external_not-bro-shark.png':'不是哥们·鲨鱼',
       'external_not-bro-tom.jpg':'不是哥们·汤姆',
       'external_elegant-penguin.jpg':'高雅企鹅'
    }
    origin_index=read(source_root/'全部素材_逐帧格式与指纹核验.json')
    origin_meta={x['path']:x for x in origin_index['items']}
    memelist=[]
    for item in factory['originals']:
        file=source_root/item['relative']
        if not file.is_file() or sha(file)!=item['sha256']:raise ValueError('Original file mismatch')
        name=file.name
        meta=origin_meta.get(item['relative'],{})
        memelist.append({
            'id':item['id'],'title':known_names.get(name,name),'file':file.resolve().as_uri(),
            'width':item['width'],'height':item['height'],'frames':item['frames'],
            'sha256':item['sha256'],'bytes':item['bytes'],
            'license':False,'note':'研究原图未获发布许可；不可自动使用。',
            'sourceUrl':meta.get('sourcePage')
        })
    if len(memelist)!=11:raise ValueError('Expected 11 complete real original references')
    voice_manifest=read(voice_lab/'VOICE_LAB_FINAL.json')
    checks=read(voice_lab/'VOICE_ASR_QA_REVISED.json')
    by_id={r['id']:r for r in checks['records']}
    voices=[]
    for item in voice_manifest['entries']:
        file=voice_lab/item['file']
        if sha(file)!=item['sha256'] or item['id'] not in by_id:raise ValueError('Voice file/QA mismatch')
        qa=by_id[item['id']]
        voices.append({
           'id':item['id'],'file':file.resolve().as_uri(),
           'text':item['text'],'recognized':qa['asr_text'],
           'pinyin':qa['pinyin_sequence_agreement'],'rawChars':qa['raw_character_agreement'],
           'technical':qa['audio']['technical_pass'],'duration':qa['audio']['duration_s'],
           'sampleRate':qa['audio']['sample_rate'],'clipped':qa['audio']['clipped_samples'],
           'peak':qa['audio']['peak'],'sha256':item['sha256'],
           'scene':'未分类','delivery':'','qqReady':False
        })
    for lab in (extra_voice_lab or []):
        newer=read(lab/'VOICE_FACTORY_FINAL.json')
        check=read(lab/'VOICE_ASR_FACTORY_FINAL.json')
        reviewed={r['id']:r for r in check['records']}
        for item in newer['samples']:
            wav=lab/item['file']
            if not wav.is_file() or sha(wav)!=item['sha256']:
                raise ValueError('Additional voice WAV fingerprint failed')
            if item['id'] not in reviewed:raise ValueError('Missing extra-batch ASR')
            qa=reviewed[item['id']]
            voices.append({'id':item['id'],'file':wav.resolve().as_uri(),'text':item['text'],
                'recognized':qa['recognized'],'pinyin':qa['pinyin_similarity'],
                'rawChars':qa['raw_character_similarity'],'technical':item['clipped']==0 and item['rms']>0.01,
                'duration':item['duration_s'],'sampleRate':item['sample_rate'],'clipped':item['clipped'],
                'peak':item['output_peak'],'sha256':item['sha256'],
                'scene':item.get('scene','未分类'),'delivery':item.get('delivery',''),
                'qqReady':False})
    if len(set(x['id'] for x in voices))!=len(voices):raise ValueError('Duplicate voice IDs')
    if prosody_report is not None:
        prosody=read(prosody_report)
        by_prosody={x['id']:x for x in prosody['samples']}
        if set(by_prosody)!=set(x['id'] for x in voices):
            raise ValueError('Prosody rows do not match selected voice samples')
        for v in voices:
            row=by_prosody[v['id']]
            if row['sha256']!=v['sha256']:raise ValueError('Prosody sample hash mismatch')
            v['pitch_delta']=row['median_pitch_shift_semitones_vs_reference']
            v['prosody_flags']=row['review_flags']
    guides=[]
    if face_guides is not None:
        evidence=read(face_guides/'FACE_EDIT_GUIDES_FINAL.json')
        for item in evidence['items']:
            guide=Path(item['guidance'])
            if not guide.is_file():raise ValueError('Missing ROI guide')
            mask=Path(item['mask'])
            if not mask.is_file():raise ValueError('Missing ROI mask')
            guides.append({'id':item['id'],'preview':guide.resolve().as_uri(),
                'mask':mask.resolve().as_uri(),'sourceSha256':item['baselineSha256'],
                'preserve':item['preserve'],'changeOnly':item['change_only'],
                'editedCompleted':False,'rightsVerified':False})
    template_text=template.read_text(encoding='utf8')
    if template_text.count('__MEDIA_FACTORY_PAYLOAD__')!=1:raise ValueError('Unexpected template')
    payload={
       'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
       'stats':factory['stats'],'leads':leads,'memelist':memelist,'voices':voices,'guides':guides,
       'allAssetsResearchOnly':True,'qqReady':False
    }
    body=json.dumps(payload,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
    page=template_text.replace('__MEDIA_FACTORY_PAYLOAD__',body)
    if '<script src=' in page.lower():raise ValueError('No external JS')
    outdir.mkdir()
    try:
        (outdir/'FangYuan_媒体工厂_本地审核与试听.html').write_text(page,encoding='utf8')
        info={'generatedAt':payload['createdAt'],'source':str(factory_dir),
            'leadCount':len(leads),'originalCount':len(memelist),'audioCount':len(voices),
            'verified_sha256':{'originals':{x['id']:x['sha256'] for x in memelist},
                               'voices':{x['id']:x['sha256'] for x in voices}},
            'permissions':'private research only','productionApproved':False,'qqSendApproved':False}
        (outdir/'DASHBOARD_FINAL.json').write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        (outdir/'README.txt').write_text('Open the HTML on TJ in Microsoft Edge. The media files remain in the private research directories. No network or QQ send performed by the dashboard.\n',encoding='utf8')
    except Exception:
        for f in outdir.iterdir():f.unlink()
        outdir.rmdir()
        raise
    return {'output':str(outdir),'leads':len(leads),'realOriginals':len(memelist),
            'voiceSamples':len(voices),'mediaCopied':0,'qqReady':False}
if __name__=='__main__':
  p=argparse.ArgumentParser()
  for x in ['factory-dir','shadow-dir','voice-lab','template','outdir']:p.add_argument('--'+x,required=True,type=Path)
  p.add_argument('--extra-voice-lab',type=Path,action='append')
  p.add_argument('--face-guides',type=Path)
  p.add_argument('--prosody-report',type=Path)
  d=vars(p.parse_args())
  print(json.dumps(assemble(**{x.replace('-','_'):value for x,value in d.items()}),ensure_ascii=False,indent=2))
